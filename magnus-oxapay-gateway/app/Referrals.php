<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Referral program: every customer has a personal link. When a new customer arrives through it and makes their first
 * top-up of at least referral.min_amount, both get bonus credit in MagnusBilling:
 *   the friend:   referral.friend_percent of that top-up's credit (welcome bonus)
 *   the referrer: referral.percent of it
 * each capped at referral.max_bonus. Abuse rules: no self-referral, only customers who never paid before, accounts
 * younger than referral.max_account_age_days (when MagnusBilling says), at most referral.max_per_month rewards per
 * referrer in 30 days. Every reward is idempotent and logged; admins are told.
 */
final class Referrals
{
    /** @var App */
    private $app;

    public function __construct(App $app)
    {
        $this->app = $app;
    }

    public function enabled(): bool
    {
        return !empty($this->app->config['referral']['enabled']);
    }

    private function cfg(string $key, $default = null)
    {
        return $this->app->config['referral'][$key] ?? $default;
    }

    private function t(string $table): string
    {
        return $this->app->db()->table($table);
    }

    // -------------------------------------------------------------------- links

    /** The customer's referral code, created on first use. */
    public function codeFor(string $username): string
    {
        $db = $this->app->db();
        $row = $db->one('SELECT code FROM ' . $this->t('ref_codes') . ' WHERE username = ?', [strtolower($username)]);
        if ($row !== null) {
            return (string) $row['code'];
        }
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        for ($try = 0; $try < 5; $try++) {
            $code = '';
            for ($i = 0; $i < 8; $i++) {
                $code .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
            try {
                $db->insert('ref_codes', ['code' => $code, 'username' => strtolower($username), 'display' => $username, 'created_at' => time()]);
                return $code;
            } catch (\PDOException $e) {
                $row = $db->one('SELECT code FROM ' . $this->t('ref_codes') . ' WHERE username = ?', [strtolower($username)]);
                if ($row !== null) {
                    return (string) $row['code'];
                }
            }
        }
        throw new \RuntimeException('Could not create a referral code.');
    }

    /**
     * @return array{code:string, web:string, telegram:string}
     */
    public function links(string $username): array
    {
        $code = $this->codeFor($username);
        $bot = ltrim((string) ($this->app->config['telegram']['bot_username'] ?? ''), '@');

        return [
            'code' => $code,
            'web' => $this->app->baseUrl() . '/?ref=' . $code,
            'telegram' => $bot !== '' && $this->app->telegramEnabled() ? 'https://t.me/' . $bot . '?start=r_' . $code : '',
        ];
    }

    public static function normalizeCode(string $code): string
    {
        $code = strtoupper(trim($code));

        return preg_match('/^[A-Z2-9]{6,12}$/', $code) ? $code : '';
    }

    public function referrerFor(string $code): ?string
    {
        $code = self::normalizeCode($code);
        if ($code === '') {
            return null;
        }
        $row = $this->app->db()->one('SELECT display FROM ' . $this->t('ref_codes') . ' WHERE code = ?', [$code]);

        return $row !== null ? (string) $row['display'] : null;
    }

    /**
     * @return array{friends:int, rewarded:int, earned:float}
     */
    public function stats(string $username): array
    {
        $row = $this->app->db()->one(
            'SELECT COUNT(*) AS friends, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS rewarded,
                    SUM(CASE WHEN status = ? THEN referrer_bonus ELSE 0 END) AS earned
             FROM ' . $this->t('referrals') . ' WHERE referrer = ?',
            ['rewarded', 'rewarded', strtolower($username)]
        );

        return ['friends' => (int) ($row['friends'] ?? 0), 'rewarded' => (int) ($row['rewarded'] ?? 0), 'earned' => (float) ($row['earned'] ?? 0)];
    }

    // ------------------------------------------------------------ attach & pay

    /**
     * Notes that $user (a MagnusBilling row) came through $code, when a payment is started.
     * Invalid or unfair cases are ignored silently: the payment itself always goes ahead.
     */
    public function attach(string $code, array $user): void
    {
        if (!$this->enabled()) {
            return;
        }
        $referrer = $this->referrerFor($code);
        $friend = (string) ($user['username'] ?? '');
        if ($referrer === null || $friend === '' || strcasecmp($referrer, $friend) === 0) {
            return;
        }
        $db = $this->app->db();
        if ($db->one('SELECT 1 FROM ' . $this->t('referrals') . ' WHERE friend = ?', [strtolower($friend)]) !== null) {
            return; // already referred once
        }
        $paid = $db->one('SELECT 1 FROM ' . $db->table('orders') . " WHERE LOWER(username) = LOWER(?) AND status = 'credited'", [$friend]);
        if ($paid !== null) {
            return; // not a new customer
        }
        $maxAge = (int) $this->cfg('max_account_age_days', 30);
        $created = strtotime((string) ($user['creationdate'] ?? ''));
        if ($maxAge > 0 && $created !== false && $created > 0 && $created < time() - $maxAge * 86400) {
            return; // an existing account
        }
        try {
            $db->insert('referrals', [
                'id' => bin2hex(random_bytes(8)),
                'code' => self::normalizeCode($code),
                'referrer' => strtolower($referrer),
                'friend' => strtolower($friend),
                'status' => 'pending',
                'created_at' => time(),
            ]);
            $this->app->log('info', 'Referral noted', ['referrer' => $referrer, 'friend' => $friend]);
        } catch (\PDOException $e) {
            // friend is unique: a parallel payment noted it first
        }
    }

    /**
     * Called once an order is credited. Pays the bonuses on the friend's first qualifying top-up.
     */
    public function onCredited(array $order): void
    {
        if (!$this->enabled()) {
            return;
        }
        $db = $this->app->db();
        $ref = $db->one('SELECT * FROM ' . $this->t('referrals') . " WHERE friend = ? AND status = 'pending'", [strtolower((string) $order['username'])]);
        if ($ref === null || (float) $order['amount'] < (float) $this->cfg('min_amount', 10)) {
            return;
        }
        $recent = $db->one(
            'SELECT COUNT(*) AS n FROM ' . $this->t('referrals') . " WHERE referrer = ? AND status = 'rewarded' AND rewarded_at > ?",
            [(string) $ref['referrer'], time() - 30 * 86400]
        );
        if ((int) ($recent['n'] ?? 0) >= (int) $this->cfg('max_per_month', 20)) {
            $db->run('UPDATE ' . $this->t('referrals') . " SET status = 'rejected', note = ? WHERE id = ?", ['monthly limit reached', $ref['id']]);
            return;
        }
        // Claim it: only one process pays a referral.
        if ($db->run('UPDATE ' . $this->t('referrals') . " SET status = 'paying', order_id = ? WHERE id = ? AND status = 'pending'", [(string) $order['id'], $ref['id']]) !== 1) {
            return;
        }

        $credit = (float) $order['credit'];
        $max = (float) $this->cfg('max_bonus', 20);
        $friendBonus = round(min($credit * (float) $this->cfg('friend_percent', 5) / 100, $max), 2);
        $referrerBonus = round(min($credit * (float) $this->cfg('percent', 5) / 100, $max), 2);
        $magnus = $this->app->magnus();
        $done = [];
        try {
            if ($friendBonus > 0) {
                $magnus->addCredit((int) $order['magnus_user_id'], number_format($friendBonus, 2, '.', ''), 'Welcome bonus, referral #' . $ref['id']);
                $done[] = 'friend';
            }
            $referrer = $this->app->payments()->lookupUser((string) $ref['referrer']);
            if ($referrer === null) {
                throw new \RuntimeException('referrer account not found');
            }
            if ($referrerBonus > 0) {
                $magnus->addCredit((int) $referrer['id'], number_format($referrerBonus, 2, '.', ''), 'Referral bonus for ' . $order['username'] . ', referral #' . $ref['id']);
                $done[] = 'referrer';
            }
            $db->run('UPDATE ' . $this->t('referrals') . " SET status = 'rewarded', friend_bonus = ?, referrer_bonus = ?, rewarded_at = ? WHERE id = ?",
                [$friendBonus, $referrerBonus, time(), $ref['id']]);
        } catch (\Throwable $e) {
            $note = 'paid: ' . ($done === [] ? 'nothing' : implode(', ', $done)) . '; error: ' . $e->getMessage();
            $db->run('UPDATE ' . $this->t('referrals') . " SET status = 'failed', note = ? WHERE id = ?", [substr($note, 0, 500), $ref['id']]);
            $this->app->log('error', 'Referral bonus failed', ['referral' => $ref['id'], 'note' => $note]);
            $this->tellAdmins('🚨 <b>Referral bonus failed</b> for <code>' . self::e((string) $ref['referrer']) . '</code> → <code>'
                . self::e((string) $order['username']) . '</code> (' . self::e($note) . "). Add the missing bonus by hand with /addcredit.");
            return;
        }
        $this->app->log('info', 'Referral rewarded', ['referral' => $ref['id'], 'friend_bonus' => $friendBonus, 'referrer_bonus' => $referrerBonus]);
        $this->tell($this->app->customers()->chatsForUsername((string) $ref['referrer']),
            '🎁 <b>Referral bonus</b>' . "\nYour friend <code>" . self::e((string) $order['username']) . '</code> made their first top-up. <b>+'
            . self::e(number_format($referrerBonus, 2)) . '</b> credit was added to <code>' . self::e((string) $ref['referrer']) . '</code>. Thank you!');
        $friendChats = $this->app->customers()->chatsForUsername((string) $order['username']);
        if (!empty($order['tg_chat_id'])) {
            $friendChats[] = (string) $order['tg_chat_id'];
        }
        $this->tell(array_unique($friendChats), '🎁 <b>Welcome bonus</b>' . "\n<b>+" . self::e(number_format($friendBonus, 2))
            . '</b> extra credit was added to <code>' . self::e((string) $order['username']) . '</code> because a friend invited you.');
        $this->tellAdmins('🎁 Referral: <code>' . self::e((string) $ref['referrer']) . '</code> invited <code>' . self::e((string) $order['username'])
            . '</code>. Bonuses: ' . self::e(number_format($referrerBonus, 2)) . ' / ' . self::e(number_format($friendBonus, 2)) . '.');
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function recent(int $limit = 8): array
    {
        return $this->app->db()->all('SELECT * FROM ' . $this->t('referrals') . ' ORDER BY created_at DESC LIMIT ' . max(1, $limit));
    }

    // ---------------------------------------------------------------- helpers

    /**
     * @param string[] $chats
     */
    private function tell(array $chats, string $html): void
    {
        if (!$this->app->telegramEnabled()) {
            return;
        }
        foreach ($chats as $chat) {
            try {
                $this->app->bot()->sendTo((string) $chat, $html);
            } catch (\Throwable $e) {
            }
        }
    }

    private function tellAdmins(string $html): void
    {
        if ($this->app->telegramEnabled() && !empty($this->app->config['telegram']['notify_admins'])) {
            $this->tell(array_map('strval', (array) $this->app->config['telegram']['admin_chat_ids']), $html);
        }
    }

    private static function e(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
