<?php

declare(strict_types=1);

namespace Gateway;

/**
 * More bot features, kept apart from TelegramBot for readability:
 *
 * Customers: 🆘 support chat, 🏦 bank transfer with receipt, 🎟 promo codes, 📞 call history, low-balance alerts.
 * Admins:    support replies, bank transfer approval, block/unblock, new SIP password, change plan, live calls,
 *            promo code management, daily report, view-only admins.
 */
trait BotExtras
{
    /** Admin buttons that view-only admins may use. */
    private static $viewerCommands = ['panel', 'recent', 'stats', 'order', 'account', 'find', 'findu', 'sip', 'live',
        'linked', 'calls', 'cust', 'banks', 'promos', 'settings', 'botprofile', 'fraud', 'ref'];

    // ------------------------------------------------------------ public hooks

    public function sendTo(string $chatId, string $html, array $extra = []): void
    {
        $this->say($chatId, $html, $extra);
    }

    /**
     * Sends to every admin and view-only admin.
     */
    public function broadcastAdmins(string $html, array $extra = []): void
    {
        $chats = array_unique(array_map('strval', array_merge(
            (array) $this->app->config['telegram']['admin_chat_ids'],
            (array) ($this->app->config['telegram']['viewer_chat_ids'] ?? [])
        )));
        foreach ($chats as $chat) {
            try {
                $this->say($chat, $html, $extra);
            } catch (\Throwable $e) {
                $this->app->log('warning', 'Admin message failed', ['chat' => $chat, 'error' => $e->getMessage()]);
            }
        }
    }

    public function lowBalanceAlert(string $chatId, string $username, float $credit): void
    {
        $this->say(
            $chatId,
            "⚠️ <b>Low balance</b>\nAccount <code>" . self::e($username) . '</code> has <b>' . self::e(number_format($credit, 2))
            . '</b> credit left. Tap an amount to top up now:',
            $this->quickTopupKeyboard($username)
        );
    }

    /**
     * One-tap top-up buttons: each one creates the payment straight away (callback qt:<amount>:<username>).
     *
     * @param string|null $again amount of the last payment, shown first as "same again"
     */
    private function quickTopupKeyboard(string $username, ?string $again = null): array
    {
        if (strlen($username) > 56 || !preg_match('/^[\x21-\x7e]+$/', $username)) {
            return [];
        }
        $pay = $this->app->config['payments'];
        $amounts = [];
        foreach ((array) $pay['presets'] as $preset) {
            $preset = (float) $preset;
            if ($preset >= (float) $pay['min_amount'] && $preset <= (float) $pay['max_amount']) {
                $amounts[] = $preset;
            }
        }
        $rows = [];
        if ($again !== null && (float) $again >= (float) $pay['min_amount'] && (float) $again <= (float) $pay['max_amount']) {
            $rows[] = [['text' => '⚡ ' . $this->payments()->money($again, true) . ' again', 'callback_data' => 'qt:' . self::amountKey($again) . ':' . $username]];
        }
        $row = [];
        foreach (array_slice($amounts, 0, 3) as $amount) {
            $row[] = ['text' => '💳 ' . $this->payments()->money($amount, true), 'callback_data' => 'qt:' . self::amountKey($amount) . ':' . $username];
        }
        if ($row !== []) {
            $rows[] = $row;
        }
        $rows[] = [['text' => 'Other amount', 'callback_data' => 'usr:' . $username]];

        return ['reply_markup' => ['inline_keyboard' => $rows]];
    }

    /** Short amount for callback data: 25, 12.5 */
    private static function amountKey($amount): string
    {
        return rtrim(rtrim(number_format((float) $amount, 2, '.', ''), '0'), '.');
    }

    /**
     * A one-tap top-up button was pressed.
     */
    private function quickTopup(string $chatId, string $data): void
    {
        $parts = explode(':', $data, 3);
        if (count($parts) !== 3 || !preg_match('/^\d{1,7}(\.\d{1,2})?$/', $parts[1])) {
            return;
        }
        if (!$this->app->db()->rateLimit('tg_quick:' . $chatId, 10, 600)) {
            $this->say($chatId, 'You have started several payments in a short time. Please wait a few minutes.');
            return;
        }
        $this->clearSession($chatId);
        $this->createPayment($chatId, $parts[2], $parts[1]);
    }

    public function dailyReport(): void
    {
        $payments = $this->payments();
        $db = $this->app->db();
        $todayStart = (int) strtotime('today');
        $yesterday = $payments->totalsBetween($todayStart - 86400, $todayStart);
        $today = $payments->totalsBetween($todayStart, time() + 1);
        $week = $payments->totalsSince(time() - 7 * 86400);
        $attention = (int) ($db->one(
            'SELECT COUNT(*) AS c FROM ' . $db->table('orders') . " WHERE status IN ('credit_failed', 'review', 'underpaid', 'crediting')"
        )['c'] ?? 0);
        $banks = (int) ($db->one('SELECT COUNT(*) AS c FROM ' . $db->table('manual_payments') . " WHERE status = 'waiting'")['c'] ?? 0);
        $low = $db->all('SELECT k, v FROM ' . $db->table('kv') . " WHERE k LIKE 'lowbal:%' ORDER BY updated_at DESC LIMIT 5");
        $counts = $this->app->customers()->counts();
        $health = [];
        foreach (['magnusbilling' => 'MagnusBilling', 'oxapay' => 'OxaPay'] as $key => $label) {
            $health[] = $label . ' ' . ($db->kvGet('health:' . $key . ':alerted') === '1' ? '🚨' : '✅');
        }

        $lines = [
            '📊 <b>Daily report</b> · ' . date('d M Y'),
            'Yesterday: <b>' . $yesterday['count'] . '</b> top-ups · <b>' . self::e($payments->money($yesterday['amount'])) . '</b>',
            'Today so far: ' . $today['count'] . ' · ' . self::e($payments->money($today['amount'])),
            'Last 7 days: ' . $week['count'] . ' · ' . self::e($payments->money($week['amount'])),
            'Linked customers: ' . $counts['linked'] . ' · bot users: ' . $counts['users'],
        ];
        if ($attention > 0) {
            $lines[] = '⚠️ Orders needing attention: <b>' . $attention . '</b> (open 📋 Recent orders)';
        }
        if ($banks > 0) {
            $lines[] = '🏦 Bank transfers waiting: <b>' . $banks . '</b>';
        }
        if ($low !== []) {
            $lines[] = '🪫 Low balance: ' . self::e(implode(', ', array_map(static function (array $row): string {
                return substr((string) $row['k'], 7) . ' (' . $row['v'] . ')';
            }, $low)));
        }
        $lines[] = 'Health: ' . implode(' · ', $health);
        $this->broadcastAdmins(implode("\n", $lines), ['reply_markup' => ['inline_keyboard' => [[['text' => '🛠 Admin panel', 'callback_data' => 'adm:panel']]]]]);
    }

    // ---------------------------------------------------------------- support

    private function startSupport(string $chatId): void
    {
        $this->setSession($chatId, 'support', []);
        $this->say($chatId, "🆘 <b>Support</b>\nWrite your message for our team. You can also send a photo or a file.", $this->cancelKeyboard());
    }

    /**
     * Customer message (text or media) for the support team.
     */
    private function forwardSupport(string $chatId, array $message): void
    {
        if (!$this->app->db()->rateLimit('support:' . $chatId, 6, 600)) {
            $this->say($chatId, 'You have sent several messages. Please wait a few minutes for our reply.');
            return;
        }
        $this->clearSession($chatId);
        $linked = $this->app->customers()->linkedUsername($chatId);
        $header = '🆘 <b>Support message</b> from ' . self::e($this->actor) . ($linked !== null ? ' · account <code>' . self::e($linked) . '</code>' : '');
        $buttons = ['reply_markup' => ['inline_keyboard' => [[['text' => '↩️ Reply', 'callback_data' => 'adm:reply:' . $chatId]]]]];
        foreach ((array) $this->app->config['telegram']['admin_chat_ids'] as $admin) {
            try {
                if (isset($message['text'])) {
                    $this->say((string) $admin, $header . "\n\n" . self::e((string) $message['text']), $buttons);
                } else {
                    $this->say((string) $admin, $header);
                    $this->tg()->call('copyMessage', ['chat_id' => $admin, 'from_chat_id' => $chatId, 'message_id' => $message['message_id']] + $buttons);
                }
            } catch (\Throwable $e) {
                $this->app->log('warning', 'Support forward failed', ['chat' => $admin, 'error' => $e->getMessage()]);
            }
        }
        $this->say($chatId, '✅ Sent to our team. We will reply here.');
    }

    // ---------------------------------------------------------- bank transfer

    private function bankEnabled(): bool
    {
        return trim((string) ($this->app->config['payments']['bank_instructions'] ?? '')) !== '';
    }

    private function startBank(string $chatId): void
    {
        if (!$this->bankEnabled()) {
            $this->say($chatId, 'Bank transfer is not available. Please pay with crypto.');
            return;
        }
        $session = $this->getSession($chatId);
        $username = (string) ($session['data']['username'] ?? ($this->app->customers()->linkedUsername($chatId) ?? ''));
        if ($username === '') {
            $this->startTopup($chatId, null, null);
            return;
        }
        $pay = $this->app->config['payments'];
        $this->setSession($chatId, 'bank_amount', ['username' => $username]);
        $this->say($chatId, '🏦 <b>Bank transfer</b> for <code>' . self::e($username) . "</code>\nHow much will you transfer? ("
            . self::e($this->payments()->money($pay['min_amount'])) . ' – ' . self::e($this->payments()->money($pay['max_amount'])) . ')', $this->cancelKeyboard());
    }

    private function bankAmount(string $chatId, array $data, string $text): void
    {
        $amount = $this->payments()->parseAmount($text);
        $reference = 'UC-' . strtoupper(bin2hex(random_bytes(3)));
        $this->setSession($chatId, 'bank_receipt', ['username' => $data['username'], 'amount' => $amount, 'reference' => $reference]);
        $this->say($chatId, implode("\n", [
            '🏦 <b>Transfer ' . self::e($this->payments()->money($amount)) . '</b>',
            self::e((string) $this->app->config['payments']['bank_instructions']),
            '',
            'Reference: <code>' . self::e($reference) . '</code>',
            'After paying, send a <b>photo or PDF of the receipt</b> here.',
        ]), $this->cancelKeyboard());
    }

    private function bankReceipt(string $chatId, array $data, array $message): void
    {
        if (!isset($message['photo']) && !isset($message['document'])) {
            $this->say($chatId, 'Please send a <b>photo or PDF</b> of the transfer receipt, or tap Cancel.', $this->cancelKeyboard());
            return;
        }
        $id = bin2hex(random_bytes(6));
        $this->app->db()->insert('manual_payments', [
            'id' => $id,
            'chat_id' => $chatId,
            'username' => (string) $data['username'],
            'amount' => (string) $data['amount'],
            'currency' => (string) $this->app->config['payments']['currency'],
            'reference' => (string) $data['reference'],
            'status' => 'waiting',
            'created_at' => time(),
        ]);
        $this->clearSession($chatId);
        $caption = "🏦 <b>Bank transfer to check</b>\nAccount <code>" . self::e((string) $data['username']) . '</code> · <b>'
            . self::e($this->payments()->money($data['amount'])) . '</b> · ref <code>' . self::e((string) $data['reference']) . "</code>\nFrom " . self::e($this->actor);
        $buttons = ['reply_markup' => ['inline_keyboard' => [[
            ['text' => '✅ Approve', 'callback_data' => 'adm:bankok:' . $id],
            ['text' => '❌ Reject', 'callback_data' => 'adm:bankno:' . $id],
        ]]]];
        foreach ((array) $this->app->config['telegram']['admin_chat_ids'] as $admin) {
            try {
                $this->tg()->call('copyMessage', [
                    'chat_id' => $admin, 'from_chat_id' => $chatId, 'message_id' => $message['message_id'],
                    'caption' => $caption, 'parse_mode' => 'HTML',
                ] + $buttons);
            } catch (\Throwable $e) {
                $this->app->log('warning', 'Receipt forward failed', ['chat' => $admin, 'error' => $e->getMessage()]);
            }
        }
        $this->app->log('info', 'Bank transfer receipt received', ['id' => $id, 'user' => $data['username'], 'amount' => $data['amount']]);
        $this->say($chatId, '✅ Receipt received. We will add the credit as soon as we have checked the transfer, and tell you here.');
    }

    private function bankDecision(string $chatId, string $id, bool $approve): void
    {
        $row = $this->app->db()->one('SELECT * FROM ' . $this->app->db()->table('manual_payments') . ' WHERE id = ?', [$id]);
        if ($row === null || $row['status'] !== 'waiting') {
            $this->say($chatId, 'That transfer was already handled.');
            return;
        }
        $money = $this->payments()->money($row['amount'], false, (string) $row['currency']);
        $this->askConfirm(
            $chatId,
            ($approve ? '✅ Approve' : '❌ Reject') . ' the bank transfer of <b>' . self::e($money) . '</b> for <code>' . self::e((string) $row['username'])
            . '</code> (ref <code>' . self::e((string) $row['reference']) . '</code>)?' . ($approve ? "\nThe credit is added right away." : ''),
            ['type' => $approve ? 'bank_approve' : 'bank_reject', 'id' => $id]
        );
    }

    private function sendBankList(string $chatId): void
    {
        $rows = $this->app->db()->all('SELECT * FROM ' . $this->app->db()->table('manual_payments') . " WHERE status = 'waiting' ORDER BY created_at DESC LIMIT 10");
        if (!$this->bankEnabled() && $rows === []) {
            $this->say($chatId, 'Bank transfer is off. Turn it on under ⚙️ Settings → 🏦 Bank details.');
            return;
        }
        if ($rows === []) {
            $this->say($chatId, 'No bank transfers waiting.');
            return;
        }
        $lines = ['🏦 <b>Bank transfers waiting</b>'];
        $buttons = [];
        foreach ($rows as $row) {
            $money = $this->payments()->money($row['amount'], false, (string) $row['currency']);
            $lines[] = date('d M H:i', (int) $row['created_at']) . ' · <code>' . self::e((string) $row['username']) . '</code> · ' . self::e($money) . ' · ' . self::e((string) $row['reference']);
            $buttons[] = [
                ['text' => '✅ ' . $row['username'] . ' ' . $money, 'callback_data' => 'adm:bankok:' . $row['id']],
                ['text' => '❌ Reject', 'callback_data' => 'adm:bankno:' . $row['id']],
            ];
        }
        $this->say($chatId, implode("\n", $lines) . "\n\nThe receipts were sent to you when they arrived.", ['reply_markup' => ['inline_keyboard' => $buttons]]);
    }

    // ------------------------------------------------------------- promo code

    private function startPromo(string $chatId): void
    {
        $session = $this->getSession($chatId);
        if ($session['state'] !== 'await_amount') {
            $this->say($chatId, 'Start with 💳 Top up, then tap 🎟 Promo code.');
            return;
        }
        $this->setSession($chatId, 'await_promo', $session['data']);
        $this->say($chatId, '🎟 Send your <b>promo code</b>.', $this->cancelKeyboard());
    }

    private function acceptPromo(string $chatId, array $data, string $text): void
    {
        $promo = $this->app->promos()->validate($text);
        $this->askAmount($chatId, (string) $data['username'], (string) $promo['code'], (float) $promo['percent']);
    }

    // ---------------------------------------------------------- call history

    private function sendCalls(string $chatId, string $username, bool $admin): void
    {
        $user = $this->payments()->lookupUser($username);
        if ($user === null) {
            $this->say($chatId, 'Account not found.');
            return;
        }
        try {
            $calls = $this->app->magnus()->calls((int) $user['id'], 10);
        } catch (\Throwable $e) {
            $this->app->log('warning', 'Call history failed', ['user' => $username, 'error' => $e->getMessage()]);
            $this->say($chatId, 'Call history is unavailable right now.');
            return;
        }
        if ($calls === []) {
            $this->say($chatId, 'No calls yet on <code>' . self::e((string) $user['username']) . '</code>.');
            return;
        }
        $lines = ['📞 <b>Latest calls</b> · <code>' . self::e((string) $user['username']) . '</code>'];
        $spent = 0.0;
        foreach ($calls as $call) {
            $seconds = (int) ($call['sessiontime'] ?? 0);
            $cost = (float) ($call['sessionbill'] ?? 0);
            $spent += $cost;
            $lines[] = self::e(substr((string) ($call['starttime'] ?? ''), 5, 11)) . ' · ' . self::e((string) ($call['calledstation'] ?? ''))
                . ' · ' . sprintf('%d:%02d', intdiv($seconds, 60), $seconds % 60) . ' · ' . self::e(number_format($cost, 4));
        }
        $lines[] = 'Total of these calls: <b>' . self::e(number_format($spent, 2)) . '</b>';
        $this->say($chatId, implode("\n", $lines), $admin && strlen((string) $user['username']) <= 50
            ? ['reply_markup' => ['inline_keyboard' => [[['text' => '« Account', 'callback_data' => 'adm:account:' . $user['username']]]]]]
            : []);
    }

    // ----------------------------------------------------- admin: extra buttons

    /**
     * Admin buttons not handled by TelegramBot::onAdminButton(). Returns false if unknown.
     */
    private function onAdminButtonExtra(string $chatId, string $command, string $arg): bool
    {
        switch ($command) {
            case 'reply':
                $this->setSession($chatId, 'adm_reply', ['chat' => $arg]);
                $this->say($chatId, '↩️ Type your reply.', $this->cancelKeyboard());
                return true;
            case 'banks':
                $this->sendBankList($chatId);
                return true;
            case 'bankok':
            case 'bankno':
                $this->bankDecision($chatId, $arg, $command === 'bankok');
                return true;
            case 'calls':
                $this->sendCalls($chatId, $arg, true);
                return true;
            case 'live':
                $this->sendLiveCalls($chatId);
                return true;
            case 'block':
            case 'unblock':
                $user = $this->payments()->lookupUser($arg);
                if ($user === null) {
                    $this->say($chatId, 'Account not found.');
                    return true;
                }
                $this->askConfirm($chatId, ($command === 'block' ? '⛔ Block' : '✅ Unblock') . ' account <code>' . self::e((string) $user['username']) . '</code>?'
                    . ($command === 'block' ? "\nThe customer cannot call or log in until you unblock it." : ''), [
                    'type' => 'user_active', 'username' => (string) $user['username'], 'active' => $command === 'block' ? 0 : 1,
                ]);
                return true;
            case 'sippw':
                $this->askSipPassword($chatId, $arg);
                return true;
            case 'sippwgen':
                $this->clearSession($chatId);
                $this->confirmSipPassword($chatId, $arg, null);
                return true;
            case 'plan':
                $this->askPlan($chatId, $arg);
                return true;
            case 'setplan':
                [$planId, $username] = array_pad(explode(':', $arg, 2), 2, '');
                $this->confirmPlan($chatId, $username, (int) $planId);
                return true;
            case 'promos':
                $this->sendPromos($chatId);
                return true;
            case 'promonew':
                $this->setSession($chatId, 'adm_promo_code', []);
                $this->say($chatId, "🎟 <b>New promo code</b> (1/4)\nSend the code (3–20 letters and digits), e.g. <code>WELCOME10</code>.", $this->cancelKeyboard());
                return true;
            case 'promouses':
            case 'promodays':
                $session = $this->getSession($chatId);
                $expected = $command === 'promouses' ? 'adm_promo_uses' : 'adm_promo_days';
                if ($session['state'] !== $expected) {
                    $this->say($chatId, 'That button has expired. Open 🎟 Promo codes again.');
                    return true;
                }
                $this->promoStep($chatId, $session, $arg);
                return true;
            case 'promooff':
                $this->askConfirm($chatId, '⛔ Disable promo code <code>' . self::e($arg) . '</code>?', ['type' => 'promo_off', 'code' => $arg]);
                return true;
            case 'setlow':
            case 'sethour':
            case 'setbank':
                $names = ['setlow' => 'low_balance', 'sethour' => 'report_hour', 'setbank' => 'bank_instructions'];
                $questions = [
                    'setlow' => '🪫 Send the balance below which linked customers get a low-balance alert (e.g. <code>2</code>), or <code>0</code> to turn alerts off.',
                    'sethour' => '📊 Send the hour for the daily report (0–23, server time ' . date('H:i') . '), or <code>off</code>.',
                    'setbank' => "🏦 Send the bank details customers should transfer to (bank, IBAN, name...).\nSend <code>off</code> to turn bank transfer off.",
                ];
                $this->setSession($chatId, 'adm_setting', ['name' => $names[$command]]);
                $this->say($chatId, $questions[$command], $this->cancelKeyboard());
                return true;
            case 'theme':
                $current = Settings::normalizeTheme((string) ($this->app->config['site']['theme'] ?? 'voip'));
                $base = $this->app->baseUrl();
                $buttons = [];
                foreach (Settings::THEMES as $key => $label) {
                    $row = [['text' => $label . ($key === $current ? ' ✓' : ''), 'callback_data' => 'adm:settheme:' . $key]];
                    if (preg_match('#^https?://#', $base)) {
                        $row[] = ['text' => '👀 Preview', 'url' => $base . '/?preview=' . $key];
                    }
                    $buttons[] = $row;
                }
                $buttons[] = [['text' => '« Settings', 'callback_data' => 'adm:settings']];
                $this->say(
                    $chatId,
                    "🎨 <b>Website theme</b>\nTap a theme to switch to it, or 👀 Preview to look first. Previews don't change anything for customers.",
                    ['reply_markup' => ['inline_keyboard' => $buttons]]
                );
                return true;
            case 'settheme':
                $this->askSettingChange($chatId, 'theme', $arg);
                return true;
            case 'reportnow':
                $this->dailyReport();
                return true;
            case 'botprofile':
                $this->sendBotProfile($chatId);
                return true;
            case 'fraud':
                $this->sendFraudSettings($chatId);
                return true;
            case 'ref':
                $this->sendReferralSettings($chatId);
                return true;
            case 'reftoggle':
                $this->askSettingChange($chatId, 'ref_enabled', empty($this->app->config['referral']['enabled']) ? 'on' : 'off');
                return true;
            case 'refset':
                $name = $arg === 'friend' ? 'ref_friend_percent' : 'ref_percent';
                $this->setSession($chatId, 'adm_setting', ['name' => $name]);
                $this->say($chatId, $arg === 'friend'
                    ? '🎁 Welcome bonus for the <b>invited friend</b>, in % of their first top-up? (e.g. <code>5</code>, or <code>0</code> for none)'
                    : '🎁 Bonus for the <b>customer who invites</b>, in % of the friend\'s first top-up? (e.g. <code>5</code>, or <code>0</code> for none)',
                    $this->cancelKeyboard());
                return true;
            case 'fraudset':
                $names = ['daily' => 'fraud_daily', 'hour' => 'fraud_hour', 'rate' => 'fraud_rate', 'calls' => 'fraud_calls'];
                if (!isset($names[$arg])) {
                    return true;
                }
                $questions = [
                    'daily' => '💸 Alert when a customer\'s calls cost more than how much <b>per day</b>? (e.g. <code>50</code>, or <code>off</code>)',
                    'hour' => '⏱ Alert when a customer\'s calls cost more than how much <b>in one hour</b>? (e.g. <code>20</code>, or <code>off</code>)',
                    'rate' => '🌍 Alert on calls that cost more than how much <b>per minute</b>? (e.g. <code>1</code>, or <code>off</code>)',
                    'calls' => '📞 Alert when a customer has more than how many <b>calls at the same time</b>? (e.g. <code>10</code>, or <code>off</code>)',
                ];
                $this->setSession($chatId, 'adm_setting', ['name' => $names[$arg]]);
                $this->say($chatId, $questions[$arg], $this->cancelKeyboard());
                return true;
            case 'fraudauto':
                $this->askSettingChange($chatId, 'fraud_autoblock', empty($this->app->config['fraud']['auto_block']) ? 'on' : 'off');
                return true;
            case 'fraudok':
                $this->app->fraudGuard()->okToday($arg);
                $this->say($chatId, '🙈 OK. No more fraud alerts for <code>' . self::e($arg) . '</code> today.');
                $this->notifyOtherAdmins($chatId, '🛡 ' . self::e($this->actor) . ' marked <code>' . self::e($arg) . '</code> as OK for today.');
                return true;
            case 'botdesc':
            case 'botabout':
                $name = $command === 'botdesc' ? 'bot_description' : 'bot_about';
                $max = $command === 'botdesc' ? BotProfile::DESCRIPTION_MAX : BotProfile::SHORT_DESCRIPTION_MAX;
                $this->setSession($chatId, 'adm_setting', ['name' => $name]);
                $this->say($chatId, $command === 'botdesc'
                    ? "✏️ Send the new <b>description</b>, up to {$max} characters.\nCustomers see it in an empty chat with the bot, before they press START. Line breaks and emoji are fine.\nSend <code>default</code> to go back to the standard text."
                    : "✏️ Send the new <b>About</b> text, up to {$max} characters.\nIt is shown on the bot's profile and when someone shares the bot.\nSend <code>default</code> to go back to the standard text.", $this->cancelKeyboard());
                return true;
            case 'botdefault':
                $this->askConfirm($chatId, '↩️ Go back to the standard bot description and About text?', ['type' => 'bot_default']);
                return true;
            case 'botsync':
                $this->say($chatId, '🔄 ' . $this->applyBotProfile());
                $this->sendBotProfile($chatId);
                return true;
        }

        return false;
    }

    // ---------------------------------------------------------------- referrals

    /**
     * /start r_<code>: remembered for this chat for 30 days and used for its payments.
     */
    private function acceptReferral(string $chatId, string $code, bool $admin): void
    {
        $referrals = $this->app->referrals();
        $code = Referrals::normalizeCode($code);
        if ($referrals->enabled() && $code !== '' && $referrals->referrerFor($code) !== null) {
            $this->app->db()->kvSet('ref:chat:' . $chatId, (string) json_encode(['code' => $code, 'until' => time() + 30 * 86400]));
            $r = $this->app->config['referral'];
            $this->say($chatId, '🎁 <b>A friend invited you!</b>' . "\nYou get <b>" . self::e(rtrim(rtrim(number_format((float) $r['friend_percent'], 2), '0'), '.'))
                . '%</b> extra credit on your first top-up of ' . self::e($this->payments()->money($r['min_amount'])) . ' or more.');
        }
        $this->sendWelcome($chatId, $admin);
    }

    private function chatReferral(string $chatId): string
    {
        $saved = json_decode((string) $this->app->db()->kvGet('ref:chat:' . $chatId), true);

        return is_array($saved) && (int) ($saved['until'] ?? 0) > time() ? (string) ($saved['code'] ?? '') : '';
    }

    /**
     * /invite: the customer's own referral links (needs a linked account).
     */
    private function sendReferral(string $chatId): void
    {
        $referrals = $this->app->referrals();
        if (!$referrals->enabled()) {
            $this->say($chatId, 'The referral program is not running at the moment.');
            return;
        }
        $username = $this->app->customers()->linkedUsername($chatId);
        if ($username === null) {
            $this->say($chatId, 'Link your Telegram to your account first: ask us for an invite link, or open the customer panel and tap Connect Telegram.');
            return;
        }
        $r = $this->app->config['referral'];
        $links = $referrals->links($username);
        $stats = $referrals->stats($username);
        $percent = static function ($value): string {
            return rtrim(rtrim(number_format((float) $value, 2), '0'), '.') . '%';
        };
        $lines = [
            '🎁 <b>Invite friends, get bonus credit</b>',
            'When a friend tops up ' . self::e($this->payments()->money($r['min_amount'])) . ' or more for the first time, you get <b>'
                . self::e($percent($r['percent'])) . '</b> of it as credit, and they get <b>' . self::e($percent($r['friend_percent'])) . '</b> extra.',
            '',
            'Your link: ' . self::e($links['web']),
        ];
        if ($links['telegram'] !== '') {
            $lines[] = 'Telegram: ' . self::e($links['telegram']);
        }
        $lines[] = '';
        $lines[] = 'Friends invited: <b>' . $stats['friends'] . '</b> · rewarded: <b>' . $stats['rewarded'] . '</b> · you earned: <b>'
            . self::e(number_format($stats['earned'], 2)) . '</b>';
        $share = 'https://t.me/share/url?url=' . rawurlencode($links['telegram'] !== '' ? $links['telegram'] : $links['web'])
            . '&text=' . rawurlencode('Cheap international calls with ' . $this->app->config['site']['name'] . '. Use my link for extra credit:');
        $this->say($chatId, implode("\n", $lines), ['reply_markup' => ['inline_keyboard' => [[['text' => '📤 Share with a friend', 'url' => $share]]]]]);
    }

    private function sendReferralSettings(string $chatId): void
    {
        $r = $this->app->config['referral'];
        $percent = static function ($value): string {
            return rtrim(rtrim(number_format((float) $value, 2), '0'), '.') . '%';
        };
        $lines = [
            '🎁 <b>Referrals</b>: <b>' . (!empty($r['enabled']) ? 'on' : 'off') . '</b>',
            'Every customer has an invite link (in the panel and with /invite in the bot).',
            'On a new friend\'s first top-up of ' . self::e($this->payments()->money($r['min_amount'])) . ' or more:',
            '• the customer who invited gets <b>' . self::e($percent($r['percent'])) . '</b> as credit',
            '• the friend gets <b>' . self::e($percent($r['friend_percent'])) . '</b> extra',
            'At most ' . self::e(number_format((float) $r['max_bonus'], 2)) . ' credit each, ' . (int) $r['max_per_month'] . ' rewards per customer a month'
                . ((int) $r['max_account_age_days'] > 0 ? ', only accounts newer than ' . (int) $r['max_account_age_days'] . ' days' : '') . ' <i>(config.php)</i>.',
        ];
        $recent = $this->app->referrals()->recent(6);
        if ($recent !== []) {
            $lines[] = '';
            $lines[] = '<b>Latest</b>';
            $icons = ['pending' => '⏳', 'paying' => '🔄', 'rewarded' => '✅', 'failed' => '🚨', 'rejected' => '⛔'];
            foreach ($recent as $row) {
                $lines[] = ($icons[$row['status']] ?? '•') . ' <code>' . self::e((string) $row['referrer']) . '</code> → <code>' . self::e((string) $row['friend']) . '</code>'
                    . ($row['status'] === 'rewarded' ? ' · ' . self::e(number_format((float) $row['referrer_bonus'], 2)) . ' / ' . self::e(number_format((float) $row['friend_bonus'], 2)) : '')
                    . (!empty($row['note']) ? ' · ' . self::e((string) $row['note']) : '');
            }
        }
        $this->say($chatId, implode("\n", $lines), ['reply_markup' => ['inline_keyboard' => [
            [['text' => !empty($r['enabled']) ? '⏸ Turn off' : '▶️ Turn on', 'callback_data' => 'adm:reftoggle']],
            [['text' => '✏️ Inviter bonus %', 'callback_data' => 'adm:refset:percent'], ['text' => '✏️ Friend bonus %', 'callback_data' => 'adm:refset:friend']],
            [['text' => '« Settings', 'callback_data' => 'adm:settings']],
        ]]]);
    }

    // ------------------------------------------------------------- fraud guard

    private function sendFraudSettings(string $chatId): void
    {
        $f = $this->app->config['fraud'];
        $limit = static function ($value): string {
            return (float) $value > 0 ? '<b>' . number_format((float) $value, 2) . '</b>' : '<b>off</b>';
        };
        $custom = $this->app->db()->all('SELECT username, daily_limit FROM ' . $this->app->db()->table('fraud_limits') . ' ORDER BY username LIMIT 15');
        $lines = [
            '🛡 <b>Fraud guard</b>' . (empty($f['enabled']) ? ' (off in config.php)' : ''),
            'Checked every 5 minutes from MagnusBilling\'s call records. Admins get an alert with Block and OK buttons.',
            '',
            '💸 Daily limit per customer: ' . $limit($f['daily_limit']),
            '⏱ Hourly limit per customer: ' . $limit($f['hour_limit']),
            '🌍 Expensive calls: over ' . $limit($f['max_rate']) . ' per minute',
            '📡 Premium/satellite ranges: ' . self::e(implode(', ', (array) $f['risky_prefixes']) ?: 'none') . ' <i>(config.php)</i>',
            '📞 Calls at once: more than ' . ((int) $f['max_calls'] > 0 ? '<b>' . (int) $f['max_calls'] . '</b>' : '<b>off</b>'),
            '⛔ Block automatically over the daily/hourly limit: <b>' . (!empty($f['auto_block']) ? 'on' : 'off') . '</b>',
        ];
        if ($custom !== []) {
            $lines[] = '';
            $lines[] = '<b>Own daily limits</b> (/limit username amount):';
            foreach ($custom as $row) {
                $lines[] = '• <code>' . self::e((string) $row['username']) . '</code>: ' . $limit($row['daily_limit']);
            }
        } else {
            $lines[] = '';
            $lines[] = 'Give one customer a different daily limit with /limit username amount.';
        }
        $this->say($chatId, implode("\n", $lines), ['reply_markup' => ['inline_keyboard' => [
            [['text' => '💸 Daily limit', 'callback_data' => 'adm:fraudset:daily'], ['text' => '⏱ Hourly limit', 'callback_data' => 'adm:fraudset:hour']],
            [['text' => '🌍 Per-minute price', 'callback_data' => 'adm:fraudset:rate'], ['text' => '📞 Calls at once', 'callback_data' => 'adm:fraudset:calls']],
            [['text' => !empty($f['auto_block']) ? '⛔ Auto-block: turn off' : '⛔ Auto-block: turn on', 'callback_data' => 'adm:fraudauto']],
            [['text' => '« Settings', 'callback_data' => 'adm:settings']],
        ]]]);
    }

    /**
     * /limit <username> <amount|off|default>
     */
    private function commandLimit(string $chatId, array $args): void
    {
        $username = (string) ($args[0] ?? '');
        $value = strtolower((string) ($args[1] ?? ''));
        if ($username === '' || $value === '') {
            $this->say($chatId, "Usage: <code>/limit username 100</code> sets that customer's daily spending limit.\n"
                . '<code>/limit username off</code> turns it off for them, <code>/limit username default</code> goes back to the normal limit.');
            return;
        }
        $user = $this->payments()->lookupUser($username);
        if ($user === null) {
            throw new UserError('unknown_user', 'No account found with that username.');
        }
        $name = (string) $user['username'];
        if ($value === 'default') {
            $limit = null;
        } elseif ($value === 'off') {
            $limit = 0.0;
        } else {
            $limit = (float) Settings::validateAmount($value);
        }
        $this->askConfirm($chatId, '🛡 ' . ($limit === null ? 'Use the normal daily limit for <code>' . self::e($name) . '</code>?'
            : ($limit > 0 ? 'Alert when <code>' . self::e($name) . '</code> spends more than <b>' . number_format($limit, 2) . '</b> a day?'
                : 'Turn the daily limit off for <code>' . self::e($name) . '</code>?')), [
            'type' => 'fraud_limit', 'username' => $name, 'limit' => $limit,
        ]);
    }

    // ------------------------------------------------------------- bot profile

    private function sendBotProfile(string $chatId): void
    {
        $profile = new BotProfile($this->app);
        $description = $profile->description();
        $about = $profile->shortDescription();
        $origin = static function (bool $custom): string {
            return $custom ? 'custom' : 'standard';
        };
        $lines = [
            '🤖 <b>Bot profile</b>',
            'What people see before they press START, and on the bot\'s profile.',
            '',
            '<b>Description</b> · ' . $origin($profile->isCustom('long')) . ' · ' . BotProfile::length($description) . '/' . BotProfile::DESCRIPTION_MAX,
            '<blockquote>' . self::e($description) . '</blockquote>',
            '<b>About</b> · ' . $origin($profile->isCustom('short')) . ' · ' . BotProfile::length($about) . '/' . BotProfile::SHORT_DESCRIPTION_MAX,
            '<blockquote>' . self::e($about) . '</blockquote>',
            '<b>Command menu</b>: ' . count($profile->commands('customer')) . ' commands for customers, '
                . count($profile->commands('admin')) . ' for admins (in admin chats only).',
        ];
        $keyboard = [
            [['text' => '✏️ Description', 'callback_data' => 'adm:botdesc'], ['text' => '✏️ About text', 'callback_data' => 'adm:botabout']],
        ];
        if ($profile->isCustom('long') || $profile->isCustom('short')) {
            $keyboard[] = [['text' => '↩️ Standard texts', 'callback_data' => 'adm:botdefault']];
        }
        $keyboard[] = [['text' => '🔄 Send to Telegram again', 'callback_data' => 'adm:botsync']];
        $keyboard[] = [['text' => '« Settings', 'callback_data' => 'adm:settings']];
        $this->say($chatId, implode("\n", $lines), ['reply_markup' => ['inline_keyboard' => $keyboard]]);
    }

    /**
     * Sends the profile to Telegram and describes the result in one short line.
     */
    private function applyBotProfile(): string
    {
        $result = (new BotProfile($this->app))->apply();
        $this->app->log('info', 'Bot profile sent to Telegram', $result + ['admin' => $this->actor]);
        if ($result['warnings'] === []) {
            return 'Updated in Telegram. The description only shows in an empty chat, so open the bot from another account to see it.';
        }

        return "Updated in Telegram, with problems:\n• " . self::e(implode("\n• ", $result['warnings']));
    }

    /**
     * Admin text for the extra flows. Returns false if the state is not ours.
     */
    private function onAdminTextExtra(string $chatId, array $session, string $text): bool
    {
        $data = $session['data'];
        switch ($session['state']) {
            case 'adm_reply':
                $this->clearSession($chatId);
                $target = (string) $data['chat'];
                $this->say($target, "💬 <b>Support</b>\n\n" . self::e($text), ['reply_markup' => ['inline_keyboard' => [[['text' => '↩️ Reply', 'callback_data' => 'sup']]]]]);
                $this->say($chatId, '✅ Reply sent.');
                $this->notifyOtherAdmins($chatId, '💬 ' . self::e($this->actor) . ' replied to a support message.');
                $this->app->log('info', 'Support reply sent', ['to' => $target, 'admin' => $this->actor]);
                return true;
            case 'adm_promo_code':
            case 'adm_promo_percent':
            case 'adm_promo_uses':
            case 'adm_promo_days':
                $this->promoStep($chatId, $session, $text);
                return true;
            case 'adm_sippw_custom':
                $this->clearSession($chatId);
                $this->confirmSipPassword($chatId, (string) $data['sip'], $text);
                return true;
        }

        return false;
    }

    /**
     * Confirmed admin actions for the extra flows. Returns false if the type is not ours.
     */
    private function runConfirmedExtra(string $chatId, array $action): bool
    {
        $magnus = $this->app->magnus();
        switch ($action['type'] ?? '') {
            case 'fraud_limit':
                $limit = $action['limit'] === null ? null : (float) $action['limit'];
                $this->app->fraudGuard()->setDailyLimit((string) $action['username'], $limit, $this->actor);
                $this->say($chatId, '✅ Saved. ' . ($limit === null ? 'The normal daily limit applies to <code>' . self::e((string) $action['username']) . '</code>.'
                    : 'Daily limit for <code>' . self::e((string) $action['username']) . '</code>: <b>' . ($limit > 0 ? number_format($limit, 2) : 'off') . '</b>.'));
                $this->notifyOtherAdmins($chatId, '🛡 ' . self::e($this->actor) . ' changed the daily limit of <code>' . self::e((string) $action['username']) . '</code>.');
                return true;
            case 'bot_default':
                $settings = $this->app->settings();
                $settings->set('bot_description', '', $this->actor);
                $settings->set('bot_about', '', $this->actor);
                $this->say($chatId, '✅ Standard texts restored. ' . $this->applyBotProfile());
                $this->sendBotProfile($chatId);
                $this->notifyOtherAdmins($chatId, '🤖 ' . self::e($this->actor) . ' restored the standard bot description.');
                return true;
            case 'user_active':
                $user = $this->payments()->lookupUser((string) $action['username']);
                if ($user === null) {
                    throw new UserError('unknown_user', 'Account not found any more.');
                }
                $this->updateMagnus('user', (int) $user['id'], ['active' => (int) $action['active']]);
                $verb = (int) $action['active'] ? 'unblocked' : 'blocked';
                $this->say($chatId, ((int) $action['active'] ? '✅' : '⛔') . ' Account <code>' . self::e((string) $user['username']) . '</code> ' . $verb . '.');
                $this->notifyOtherAdmins($chatId, '👤 ' . self::e($this->actor) . ' ' . $verb . ' account <code>' . self::e((string) $user['username']) . '</code>');
                $this->app->log('info', 'Admin ' . $verb . ' an account', ['user' => $user['username'], 'admin' => $this->actor]);
                return true;

            case 'sip_password':
                $sip = $magnus->findSip((string) $action['sip']);
                if ($sip === null) {
                    throw new UserError('not_found', 'SIP account not found any more.');
                }
                $this->updateMagnus('sip', (int) $sip['id'], ['secret' => (string) $action['password']]);
                $this->say($chatId, "🔑 New SIP password for <code>" . self::e((string) $sip['name']) . '</code>: <code>' . self::e((string) $action['password'])
                    . "</code>\nThe customer must update it on their phone or softphone.");
                $this->notifyOtherAdmins($chatId, '🔑 ' . self::e($this->actor) . ' set a new SIP password for <code>' . self::e((string) $sip['name']) . '</code>');
                $this->app->log('info', 'Admin changed a SIP password', ['sip' => $sip['name'], 'admin' => $this->actor]);
                return true;

            case 'user_plan':
                $user = $this->payments()->lookupUser((string) $action['username']);
                if ($user === null) {
                    throw new UserError('unknown_user', 'Account not found any more.');
                }
                $this->updateMagnus('user', (int) $user['id'], ['id_plan' => (int) $action['plan']]);
                $this->say($chatId, '📦 Account <code>' . self::e((string) $user['username']) . '</code> is now on plan <b>' . self::e((string) $action['plan_name']) . '</b>.');
                $this->notifyOtherAdmins($chatId, '📦 ' . self::e($this->actor) . ' moved <code>' . self::e((string) $user['username']) . '</code> to plan ' . self::e((string) $action['plan_name']));
                $this->app->log('info', 'Admin changed a plan', ['user' => $user['username'], 'plan' => $action['plan'], 'admin' => $this->actor]);
                return true;

            case 'bank_approve':
            case 'bank_reject':
                $table = $this->app->db()->table('manual_payments');
                $approve = $action['type'] === 'bank_approve';
                $claimed = $this->app->db()->run(
                    'UPDATE ' . $table . " SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'waiting'",
                    [$approve ? 'approving' : 'rejected', substr($this->actor, 0, 100), time(), (string) $action['id']]
                );
                $row = $this->app->db()->one('SELECT * FROM ' . $table . ' WHERE id = ?', [(string) $action['id']]);
                if (!$claimed || $row === null) {
                    $this->say($chatId, 'That transfer was already handled.');
                    return true;
                }
                $money = $this->payments()->money($row['amount'], false, (string) $row['currency']);
                if (!$approve) {
                    $this->say((string) $row['chat_id'], '❌ We could not confirm your bank transfer of ' . self::e($money) . ' (ref <code>' . self::e((string) $row['reference'])
                        . '</code>). Please contact support.', ['reply_markup' => ['inline_keyboard' => [[['text' => '🆘 Support', 'callback_data' => 'sup']]]]]);
                    $this->say($chatId, '❌ Rejected. The customer was told.');
                    $this->notifyOtherAdmins($chatId, '🏦 ' . self::e($this->actor) . ' rejected a bank transfer of ' . self::e($money) . ' for <code>' . self::e((string) $row['username']) . '</code>');
                    return true;
                }
                $order = $this->payments()->createManualOrder((string) $row['username'], (string) $row['amount'], (string) $row['chat_id'], (string) $row['reference']);
                $order = $this->payments()->markPaid((string) $order['id'], $this->actor);
                $this->app->db()->run('UPDATE ' . $table . " SET status = 'approved', order_id = ? WHERE id = ?", [(string) $order['id'], (string) $action['id']]);
                $this->say($chatId, $this->orderText($order, true));
                $this->notifyOtherAdmins($chatId, '🏦 ' . self::e($this->actor) . ' approved a bank transfer of ' . self::e($money) . ' for <code>' . self::e((string) $row['username']) . '</code>');
                return true;

            case 'promo_new':
                $this->app->promos()->create((string) $action['code'], (string) $action['percent'], (int) $action['uses'], (int) $action['days'], $this->actor);
                $this->say($chatId, '🎟 Promo code <code>' . self::e((string) $action['code']) . '</code> is active. Share this link: '
                    . self::e($this->app->baseUrl() . '/?promo=' . $action['code']));
                $this->notifyOtherAdmins($chatId, '🎟 ' . self::e($this->actor) . ' created promo code <code>' . self::e((string) $action['code']) . '</code> (+' . self::e((string) $action['percent']) . '%)');
                return true;

            case 'promo_off':
                $this->app->promos()->disable((string) $action['code'], $this->actor);
                $this->say($chatId, '⛔ Promo code <code>' . self::e((string) $action['code']) . '</code> disabled.');
                return true;
        }

        return false;
    }

    /**
     * MagnusBilling update with a friendly error (e.g. missing update permission).
     */
    private function updateMagnus(string $module, int $id, array $fields): void
    {
        try {
            $this->app->magnus()->updateRecord($module, $id, $fields);
        } catch (\Throwable $e) {
            if (stripos($e->getMessage(), 'invalid API action') !== false) {
                throw new UserError('missing_permission', 'The MagnusBilling API key has no update permission yet. Run install.sh again to grant it.', 503);
            }
            throw new UserError('billing_error', 'MagnusBilling: ' . $e->getMessage(), 502);
        }
    }

    // ------------------------------------------------- admin: account actions

    private function askSipPassword(string $chatId, string $query): void
    {
        $accounts = $this->app->adminTools()->findSipAccounts($query);
        if ($accounts === []) {
            $this->say($chatId, 'No SIP account found.');
            return;
        }
        if (count($accounts) > 1) {
            $buttons = [];
            foreach (array_slice($accounts, 0, 8) as $sip) {
                if (strlen((string) $sip['name']) <= 50) {
                    $buttons[] = [['text' => '🔑 ' . $sip['name'], 'callback_data' => 'adm:sippw:' . $sip['name']]];
                }
            }
            $this->say($chatId, 'Which SIP account?', ['reply_markup' => ['inline_keyboard' => $buttons]]);
            return;
        }
        $this->setSession($chatId, 'adm_sippw_custom', ['sip' => (string) $accounts[0]['name']]);
        $this->say($chatId, '🔑 New SIP password for <code>' . self::e((string) $accounts[0]['name']) . '</code>: type one (6–30 characters), or tap Generate.', ['reply_markup' => ['inline_keyboard' => [
            [['text' => '🎲 Generate password', 'callback_data' => 'adm:sippwgen:' . $accounts[0]['name']]],
            [['text' => 'Cancel', 'callback_data' => 'cancel']],
        ]]]);
    }

    private function confirmSipPassword(string $chatId, string $sip, ?string $password): void
    {
        if ($password === null) {
            do {
                $password = substr(str_replace(['+', '/', '='], '', base64_encode(random_bytes(12))), 0, 12);
            } while (!MagnusBilling::isSafeValue($password) || strlen($password) < 12);
        } else {
            $password = $this->app->adminTools()->normalizeNewPassword($password);
        }
        $this->askConfirm($chatId, '🔑 Set the SIP password of <code>' . self::e($sip) . '</code> to <code>' . self::e($password) . "</code>?\nPhones using the old password stop working until updated.", [
            'type' => 'sip_password', 'sip' => $sip, 'password' => $password,
        ]);
    }

    private function askPlan(string $chatId, string $username): void
    {
        try {
            $plans = $this->app->magnus()->plans();
        } catch (\Throwable $e) {
            $plans = [];
        }
        $buttons = [];
        foreach (array_slice($plans, 0, 10) as $plan) {
            if (isset($plan['id'], $plan['name']) && strlen($username) <= 40) {
                $buttons[] = [['text' => '📦 ' . $plan['name'], 'callback_data' => 'adm:setplan:' . (int) $plan['id'] . ':' . $username]];
            }
        }
        if ($buttons === []) {
            $this->say($chatId, 'No plans found in MagnusBilling.');
            return;
        }
        $buttons[] = [['text' => 'Cancel', 'callback_data' => 'cancel']];
        $this->say($chatId, '📦 New plan for <code>' . self::e($username) . '</code>?', ['reply_markup' => ['inline_keyboard' => $buttons]]);
    }

    private function confirmPlan(string $chatId, string $username, int $planId): void
    {
        $name = '#' . $planId;
        try {
            foreach ($this->app->magnus()->plans() as $plan) {
                if ((int) ($plan['id'] ?? 0) === $planId) {
                    $name = (string) $plan['name'];
                }
            }
        } catch (\Throwable $e) {
        }
        $this->askConfirm($chatId, '📦 Move <code>' . self::e($username) . '</code> to plan <b>' . self::e($name) . '</b>?', [
            'type' => 'user_plan', 'username' => $username, 'plan' => $planId, 'plan_name' => $name,
        ]);
    }

    private function sendLiveCalls(string $chatId): void
    {
        try {
            $calls = $this->app->magnus()->liveCalls(30);
        } catch (\Throwable $e) {
            $this->say($chatId, 'Live calls are unavailable right now.');
            return;
        }
        if ($calls === []) {
            $this->say($chatId, '📞 No calls in progress.', ['reply_markup' => ['inline_keyboard' => [[['text' => '🔄 Refresh', 'callback_data' => 'adm:live']]]]]);
            return;
        }
        $lines = ['📞 <b>Live calls</b> (' . count($calls) . ')'];
        foreach (array_slice($calls, 0, 25) as $call) {
            $seconds = (int) ($call['duration'] ?? 0);
            $lines[] = '<code>' . self::e((string) ($call['sip_account'] ?? '?')) . '</code> → ' . self::e((string) ($call['ndiscado'] ?? ''))
                . ' · ' . sprintf('%d:%02d', intdiv($seconds, 60), $seconds % 60) . ' · ' . self::e((string) ($call['status'] ?? ''));
        }
        $this->say($chatId, implode("\n", $lines), ['reply_markup' => ['inline_keyboard' => [[['text' => '🔄 Refresh', 'callback_data' => 'adm:live']]]]]);
    }

    // ------------------------------------------------------- admin: promos

    private function sendPromos(string $chatId): void
    {
        $rows = $this->app->promos()->all();
        $lines = ['🎟 <b>Promo codes</b>'];
        $buttons = [[['text' => '➕ New promo code', 'callback_data' => 'adm:promonew']]];
        foreach ($rows as $row) {
            $state = !(int) $row['active'] ? 'off' : ($row['expires_at'] !== null && (int) $row['expires_at'] < time() ? 'expired' : 'active');
            $lines[] = '<code>' . self::e((string) $row['code']) . '</code> · +' . self::e(rtrim(rtrim((string) $row['percent'], '0'), '.')) . '% · used '
                . (int) $row['uses'] . ((int) $row['max_uses'] > 0 ? '/' . (int) $row['max_uses'] : '')
                . ($row['expires_at'] !== null ? ' · until ' . date('d M', (int) $row['expires_at']) : '') . ' · ' . $state;
            if ($state === 'active' && count($buttons) < 8) {
                $buttons[] = [['text' => '⛔ Disable ' . $row['code'], 'callback_data' => 'adm:promooff:' . $row['code']]];
            }
        }
        if ($rows === []) {
            $lines[] = 'No codes yet.';
        }
        $buttons[] = [['text' => '« Admin panel', 'callback_data' => 'adm:panel']];
        $this->say($chatId, implode("\n", $lines), ['reply_markup' => ['inline_keyboard' => $buttons]]);
    }

    /**
     * New promo wizard: code -> percent -> max uses -> days valid -> confirm.
     */
    private function promoStep(string $chatId, array $session, string $input): void
    {
        $data = $session['data'];
        switch ($session['state']) {
            case 'adm_promo_code':
                $data['code'] = Promos::normalizeCode($input);
                $this->setSession($chatId, 'adm_promo_percent', $data);
                $this->say($chatId, "🎟 <b>New promo code</b> (2/4)\nExtra credit in percent (1–100), e.g. <code>10</code>.", $this->cancelKeyboard());
                return;
            case 'adm_promo_percent':
                $percent = (float) str_replace(['%', ','], ['', '.'], trim($input));
                if ($percent <= 0 || $percent > 100) {
                    throw new UserError('invalid_percent', 'Send a number from 1 to 100.');
                }
                $data['percent'] = rtrim(rtrim(number_format($percent, 2, '.', ''), '0'), '.');
                $this->setSession($chatId, 'adm_promo_uses', $data);
                $this->say($chatId, "🎟 <b>New promo code</b> (3/4)\nHow many top-ups can use it? Tap or type a number.", ['reply_markup' => ['inline_keyboard' => [
                    [['text' => '10', 'callback_data' => 'adm:promouses:10'], ['text' => '50', 'callback_data' => 'adm:promouses:50'], ['text' => '100', 'callback_data' => 'adm:promouses:100']],
                    [['text' => 'Unlimited', 'callback_data' => 'adm:promouses:0']],
                    [['text' => 'Cancel', 'callback_data' => 'cancel']],
                ]]]);
                return;
            case 'adm_promo_uses':
                if (!preg_match('/^\d{1,6}$/', trim($input))) {
                    throw new UserError('invalid_number', 'Send a whole number, or tap Unlimited.');
                }
                $data['uses'] = (int) $input;
                $this->setSession($chatId, 'adm_promo_days', $data);
                $this->say($chatId, "🎟 <b>New promo code</b> (4/4)\nHow many days is it valid?", ['reply_markup' => ['inline_keyboard' => [
                    [['text' => '7 days', 'callback_data' => 'adm:promodays:7'], ['text' => '30 days', 'callback_data' => 'adm:promodays:30'], ['text' => '90 days', 'callback_data' => 'adm:promodays:90']],
                    [['text' => 'No expiry', 'callback_data' => 'adm:promodays:0']],
                    [['text' => 'Cancel', 'callback_data' => 'cancel']],
                ]]]);
                return;
            case 'adm_promo_days':
                if (!preg_match('/^\d{1,4}$/', trim($input))) {
                    throw new UserError('invalid_number', 'Send a number of days, or tap No expiry.');
                }
                $data['days'] = (int) $input;
                $this->clearSession($chatId);
                $this->askConfirm($chatId, implode("\n", [
                    '🎟 <b>Create promo code?</b>',
                    'Code: <code>' . self::e((string) $data['code']) . '</code>',
                    'Extra credit: +' . self::e((string) $data['percent']) . '%',
                    'Uses: ' . ((int) $data['uses'] > 0 ? (int) $data['uses'] : 'unlimited'),
                    'Valid: ' . ((int) $data['days'] > 0 ? (int) $data['days'] . ' days' : 'no expiry'),
                ]), ['type' => 'promo_new'] + $data);
                return;
        }
    }
}
