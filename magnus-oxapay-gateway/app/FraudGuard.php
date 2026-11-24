<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Watches MagnusBilling calls for signs of fraud (stolen SIP passwords, hacked phones, abuse) and alerts admins
 * in Telegram, every 5 minutes from cron. It reads call records directly from the MagnusBilling database; it never
 * changes them. Blocking goes through the MagnusBilling API, like the bot's Block button.
 *
 * Checks (0 turns a check off):
 *   daily_limit   a customer's calls cost more than this today (per-customer limits: /limit in the bot)
 *   hour_limit    ... or more than this in the last hour (a sudden spike)
 *   max_rate      a call cost more than this per minute (expensive destinations)
 *   risky_prefixes calls to premium / satellite number ranges
 *   max_calls     more calls at the same time than this
 * With auto_block on, a customer over the daily or hourly limit is blocked at once (admins can unblock).
 */
final class FraudGuard
{
    /** @var App */
    private $app;

    /** @var MagnusDb */
    private $magnus;

    public function __construct(App $app, ?MagnusDb $magnus = null)
    {
        $this->app = $app;
        $this->magnus = $magnus ?? new MagnusDb($app);
    }

    private function cfg(string $key, $default = null)
    {
        return $this->app->config['fraud'][$key] ?? $default;
    }

    /**
     * @return string summary for the command line
     */
    public function run(): string
    {
        if (empty($this->cfg('enabled', true))) {
            return 'off';
        }
        try {
            $pdo = $this->magnus->pdo();
            $now = (string) $pdo->query('SELECT NOW()')->fetchColumn(); // the database's clock and time zone, like the CDRs
        } catch (\Throwable $e) {
            $flag = 'fraud:dberror:' . date('Y-m-d');
            if ($this->app->db()->kvGet($flag) === null) {
                $this->app->db()->kvSet($flag, '1');
                $this->app->log('error', 'Fraud guard cannot read the MagnusBilling database', ['error' => $e->getMessage()]);
            }
            return 'cannot read the MagnusBilling database: ' . $e->getMessage();
        }
        $nowTs = (int) strtotime($now);
        $date = date('Y-m-d', $nowTs);
        $issues = 0;

        // 1. Spending today and in the last hour.
        foreach ([
            ['day', $date . ' 00:00:00', 'today'],
            ['hour', date('Y-m-d H:i:s', $nowTs - 3600), 'in the last hour'],
        ] as [$type, $since, $label]) {
            $default = (float) $this->cfg($type === 'day' ? 'daily_limit' : 'hour_limit', 0);
            $stmt = $pdo->prepare(
                'SELECT c.id_user, u.username, SUM(c.sessionbill) AS spend, COUNT(*) AS calls
                 FROM pkg_cdr c JOIN pkg_user u ON u.id = c.id_user
                 WHERE c.starttime >= ? GROUP BY c.id_user, u.username'
            );
            $stmt->execute([$since]);
            foreach ($stmt->fetchAll() as $row) {
                $username = (string) $row['username'];
                $limit = $type === 'day' ? $this->dailyLimit($username, $default) : $default;
                $spend = (float) $row['spend'];
                if ($limit <= 0 || $spend < $limit) {
                    continue;
                }
                $key = 'fraud:' . $type . ':' . strtolower($username) . ':' . ($type === 'day' ? $date : date('Y-m-d-H', $nowTs));
                $issues += (int) $this->issue((int) $row['id_user'], $username, $key, true,
                    '💸 Spent <b>' . self::e(self::n($spend)) . '</b> ' . $label . ' (limit ' . self::e(self::n($limit)) . ') in '
                    . (int) $row['calls'] . ' call' . ((int) $row['calls'] === 1 ? '' : 's') . '.');
            }
        }

        // 2. Expensive and risky calls since the last check.
        $issues += $this->expensiveCalls($pdo, $date);

        // 3. Too many calls at the same time.
        $maxCalls = (int) $this->cfg('max_calls', 0);
        if ($maxCalls > 0) {
            $stmt = $pdo->prepare(
                'SELECT o.id_user, u.username, COUNT(*) AS n FROM pkg_call_online o JOIN pkg_user u ON u.id = o.id_user
                 GROUP BY o.id_user, u.username HAVING COUNT(*) > ?'
            );
            $stmt->bindValue(1, $maxCalls, \PDO::PARAM_INT);
            $stmt->execute();
            foreach ($stmt->fetchAll() as $row) {
                $key = 'fraud:calls:' . strtolower((string) $row['username']) . ':' . date('Y-m-d-H', $nowTs);
                $issues += (int) $this->issue((int) $row['id_user'], (string) $row['username'], $key, false,
                    '📞 <b>' . (int) $row['n'] . '</b> calls at the same time right now (limit ' . $maxCalls . ').');
            }
        }

        if (random_int(1, 20) === 1) {
            $this->app->db()->run(
                'DELETE FROM ' . $this->app->db()->table('kv') . " WHERE k LIKE 'fraud:%' AND k <> 'fraud:last_cdr' AND updated_at < ?",
                [time() - 3 * 86400]
            );
        }

        return $issues . ' alert' . ($issues === 1 ? '' : 's');
    }

    private function expensiveCalls(\PDO $pdo, string $date): int
    {
        $db = $this->app->db();
        $last = $db->kvGet('fraud:last_cdr');
        if ($last === null) {
            // First run: start from now instead of alerting about old calls.
            $db->kvSet('fraud:last_cdr', (string) (int) $pdo->query('SELECT COALESCE(MAX(id), 0) FROM pkg_cdr')->fetchColumn());
            return 0;
        }
        $maxRate = (float) $this->cfg('max_rate', 0);
        $prefixes = array_values(array_filter(array_map('strval', (array) $this->cfg('risky_prefixes', []))));
        $stmt = $pdo->prepare(
            'SELECT c.id, c.id_user, u.username, c.calledstation, c.sessiontime, c.sessionbill
             FROM pkg_cdr c JOIN pkg_user u ON u.id = c.id_user WHERE c.id > ? ORDER BY c.id LIMIT 5000'
        );
        $stmt->execute([(int) $last]);
        $rows = $stmt->fetchAll();
        if ($rows === []) {
            return 0;
        }
        $db->kvSet('fraud:last_cdr', (string) end($rows)['id']);

        $found = [];
        foreach ($rows as $row) {
            $number = ltrim(preg_replace('/^(\+|00)/', '', (string) $row['calledstation']) ?? '', '+');
            $seconds = (int) $row['sessiontime'];
            $cost = (float) $row['sessionbill'];
            // Price per minute, counting at least one minute (calls are usually billed by the minute).
            $perMinute = $cost / max($seconds, 60) * 60;
            $risky = '';
            foreach ($prefixes as $prefix) {
                if ($prefix !== '' && strpos($number, $prefix) === 0) {
                    $risky = $prefix;
                    break;
                }
            }
            if (($maxRate > 0 && $perMinute > $maxRate) || $risky !== '') {
                $found[(string) $row['username']][] = ['id_user' => (int) $row['id_user'], 'number' => $number, 'seconds' => $seconds,
                    'cost' => $cost, 'rate' => $perMinute, 'risky' => $risky];
            }
        }

        $issues = 0;
        foreach ($found as $username => $calls) {
            $username = (string) $username; // numeric usernames such as 100234 become integer array keys
            usort($calls, static function (array $a, array $b): int {
                return $b['rate'] <=> $a['rate'];
            });
            $lines = [];
            foreach (array_slice($calls, 0, 3) as $call) {
                $lines[] = '• <code>' . self::e(self::mask($call['number'])) . '</code> ' . gmdate('i:s', min($call['seconds'], 3599))
                    . ', cost ' . self::e(self::n($call['cost'])) . ' (' . self::e(self::n($call['rate'])) . '/min)'
                    . ($call['risky'] !== '' ? ' · premium/satellite range ' . self::e($call['risky']) : '');
            }
            $more = count($calls) > 3 ? "\n…and " . (count($calls) - 3) . ' more' : '';
            $issues += (int) $this->issue($calls[0]['id_user'], $username, 'fraud:rate:' . strtolower($username) . ':' . $date, false,
                '🌍 ' . count($calls) . ' expensive call' . (count($calls) === 1 ? '' : 's')
                . ($maxRate > 0 ? ' (over ' . self::e(self::n($maxRate)) . '/min)' : '') . ":\n" . implode("\n", $lines) . $more);
        }

        return $issues;
    }

    /**
     * Alerts admins once per $key, unless an admin said "OK today" for this customer. Returns true if alerted.
     */
    private function issue(int $idUser, string $username, string $key, bool $blockable, string $detail): bool
    {
        $db = $this->app->db();
        if ($this->isOkToday($username) || $db->kvGet($key) !== null) {
            return false;
        }
        $db->kvSet($key, (string) time());

        $blocked = false;
        if ($blockable && !empty($this->cfg('auto_block', false))) {
            try {
                $this->app->magnus()->updateRecord('user', $idUser, ['active' => 0]);
                $blocked = true;
                $this->app->log('warning', 'Fraud guard blocked an account', ['user' => $username, 'reason' => strip_tags($detail)]);
            } catch (\Throwable $e) {
                $this->app->log('error', 'Fraud guard could not block an account', ['user' => $username, 'error' => $e->getMessage()]);
            }
        }
        $this->app->log('warning', 'Fraud guard alert', ['user' => $username, 'reason' => strip_tags($detail), 'blocked' => $blocked]);

        if (!$this->app->telegramEnabled()) {
            return true;
        }
        $bot = $this->app->bot();
        $text = "🛡 <b>Fraud guard</b>: <code>" . self::e($username) . "</code>\n" . $detail
            . ($blocked ? "\n⛔ <b>Blocked automatically.</b> The customer cannot call until you unblock it." : '');
        $buttons = [];
        if (strlen($username) <= 50) {
            $buttons = ['reply_markup' => ['inline_keyboard' => [
                [
                    $blocked ? ['text' => '✅ Unblock', 'callback_data' => 'adm:unblock:' . $username] : ['text' => '⛔ Block', 'callback_data' => 'adm:block:' . $username],
                    ['text' => '🙈 OK today', 'callback_data' => 'adm:fraudok:' . $username],
                ],
                [['text' => '👤 Account', 'callback_data' => 'adm:account:' . $username]],
            ]]];
        }
        $bot->broadcastAdmins($text, $buttons);
        if ($blocked) {
            foreach ($this->app->customers()->chatsForUsername($username) as $chat) {
                try {
                    $bot->sendTo($chat, '⛔ <b>Account paused</b>' . "\nWe paused <code>" . self::e($username)
                        . '</code> because of unusual call spending, to protect your balance. Please contact support to turn it back on.');
                } catch (\Throwable $e) {
                }
            }
        }

        return true;
    }

    // ----------------------------------------------------- per-customer limits

    public function dailyLimit(string $username, ?float $default = null): float
    {
        $row = $this->app->db()->one('SELECT daily_limit FROM ' . $this->app->db()->table('fraud_limits') . ' WHERE username = ?', [strtolower($username)]);

        return $row !== null ? (float) $row['daily_limit'] : (float) ($default ?? $this->cfg('daily_limit', 0));
    }

    public function hasOwnLimit(string $username): bool
    {
        return $this->app->db()->one('SELECT 1 FROM ' . $this->app->db()->table('fraud_limits') . ' WHERE username = ?', [strtolower($username)]) !== null;
    }

    /**
     * @param float|null $limit null = back to the default, 0 = no daily limit for this customer
     */
    public function setDailyLimit(string $username, ?float $limit, string $actor): void
    {
        $db = $this->app->db();
        $table = $db->table('fraud_limits');
        $db->run("DELETE FROM {$table} WHERE username = ?", [strtolower($username)]);
        if ($limit !== null) {
            $db->insert('fraud_limits', ['username' => strtolower($username), 'daily_limit' => $limit, 'updated_by' => substr($actor, 0, 100), 'updated_at' => time()]);
        }
        $this->app->log('info', 'Daily spending limit changed', ['user' => $username, 'limit' => $limit, 'admin' => $actor]);
    }

    /** An admin pressed "OK today": no more alerts or automatic blocks for this customer until midnight. */
    public function okToday(string $username): void
    {
        $this->app->db()->kvSet('fraud:ok:' . strtolower($username) . ':' . date('Y-m-d'), '1');
    }

    public function isOkToday(string $username): bool
    {
        return $this->app->db()->kvGet('fraud:ok:' . strtolower($username) . ':' . date('Y-m-d')) !== null;
    }

    // ---------------------------------------------------------------- helpers

    private static function n(float $value): string
    {
        return number_format($value, 2);
    }

    /** +4479•••1234: enough to recognise a number in an alert, not the whole number. */
    private static function mask(string $number): string
    {
        return strlen($number) > 8 ? substr($number, 0, 4) . '•••' . substr($number, -4) : $number;
    }

    private static function e(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
