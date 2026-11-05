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
        'linked', 'calls', 'cust', 'banks', 'promos', 'settings'];

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
            . '</b> credit left. Top up now to keep calling.',
            strlen($username) <= 56 ? ['reply_markup' => ['inline_keyboard' => [[['text' => '💳 Top up now', 'callback_data' => 'usr:' . $username]]]]] : []
        );
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
        }

        return false;
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
