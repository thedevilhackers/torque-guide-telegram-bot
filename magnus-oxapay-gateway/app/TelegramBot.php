<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Telegram bot: customers top up from chat, admins get payment alerts and a few commands.
 *
 * Customer:  /start  /topup [username] [amount]  /status <order>  /cancel  /id  /help
 * Admin:     /recent  /order <id>  /retry <id>  /balance <username>  /stats
 */
final class TelegramBot
{
    /** @var App */
    private $app;

    public function __construct(App $app)
    {
        $this->app = $app;
    }

    private function tg(): Telegram
    {
        return $this->app->telegram();
    }

    private function payments(): Payments
    {
        return $this->app->payments();
    }

    // ---------------------------------------------------------------- updates

    public function handleUpdate(array $update): void
    {
        $chatId = (string) ($update['message']['chat']['id'] ?? ($update['callback_query']['message']['chat']['id'] ?? ''));

        try {
            $this->dispatch($update);
        } catch (UserError $e) {
            if ($chatId !== '') {
                $this->say($chatId, '❌ ' . self::e($e->getMessage()));
            }
        } catch (\Throwable $e) {
            $this->app->log('error', 'Telegram update failed', ['error' => $e->getMessage()]);
            if ($chatId !== '') {
                try {
                    $this->say($chatId, 'Sorry, something went wrong. Please try again in a few minutes.');
                } catch (\Throwable $ignored) {
                }
            }
        }
    }

    private function dispatch(array $update): void
    {
        if (isset($update['callback_query']) && is_array($update['callback_query'])) {
            $this->onCallback($update['callback_query']);
            return;
        }

        $message = $update['message'] ?? null;
        if (!is_array($message) || !isset($message['chat']['id'])) {
            return;
        }
        $chatId = (string) $message['chat']['id'];
        $text = trim((string) ($message['text'] ?? ''));
        if ($text === '') {
            return;
        }

        if ($text[0] === '/') {
            $this->onCommand($chatId, $text);
        } elseif (($message['chat']['type'] ?? 'private') === 'private') {
            $this->onText($chatId, $text);
        }
    }

    private function onCommand(string $chatId, string $text): void
    {
        $parts = preg_split('/\s+/', $text) ?: [];
        $command = strtolower((string) preg_replace('/@.*$/', '', (string) array_shift($parts)));
        $args = array_values(array_filter($parts, 'strlen'));
        $admin = $this->app->isAdminChat($chatId);

        switch ($command) {
            case '/start':
            case '/help':
                $this->clearSession($chatId);
                $this->sendWelcome($chatId, $admin);
                return;

            case '/topup':
            case '/pay':
                $this->startTopup($chatId, $args[0] ?? null, $args[1] ?? null);
                return;

            case '/status':
                $this->sendOrderStatus($chatId, (string) ($args[0] ?? ''), false);
                return;

            case '/cancel':
                $this->clearSession($chatId);
                $this->say($chatId, 'Cancelled. Send /topup to start again.');
                return;

            case '/id':
                $this->say($chatId, 'Your chat ID is <code>' . self::e($chatId) . '</code>');
                return;
        }

        if ($admin) {
            switch ($command) {
                case '/recent':
                    $this->sendRecent($chatId);
                    return;
                case '/order':
                    $this->sendOrderStatus($chatId, (string) ($args[0] ?? ''), true);
                    return;
                case '/retry':
                    $order = $this->payments()->retry((string) ($args[0] ?? ''));
                    $this->say($chatId, $this->orderText($order, true));
                    return;
                case '/balance':
                    $this->sendBalance($chatId, (string) ($args[0] ?? ''));
                    return;
                case '/stats':
                    $this->sendStats($chatId);
                    return;
            }
        }

        $this->say($chatId, 'Unknown command. Send /help to see what I can do.');
    }

    private function onText(string $chatId, string $text): void
    {
        $session = $this->getSession($chatId);
        switch ($session['state']) {
            case 'await_username':
                $this->acceptUsername($chatId, $text);
                return;
            case 'await_amount':
                $this->createPayment($chatId, (string) ($session['data']['username'] ?? ''), $text);
                return;
        }
        $this->sendWelcome($chatId, $this->app->isAdminChat($chatId));
    }

    private function onCallback(array $query): void
    {
        $chatId = (string) ($query['message']['chat']['id'] ?? ($query['from']['id'] ?? ''));
        $data = (string) ($query['data'] ?? '');
        $callbackId = (string) ($query['id'] ?? '');
        if ($chatId === '' || $callbackId === '') {
            return;
        }

        if (strpos($data, 'chk:') === 0) {
            $order = $this->payments()->getOrder(substr($data, 4));
            if ($order === null) {
                $this->tg()->answerCallback($callbackId, 'Order not found.', true);
                return;
            }
            $order = $this->payments()->refreshIfStale($order);
            $this->tg()->answerCallback($callbackId, Payments::statusLabel((string) $order['status']), true);
            return;
        }

        $this->tg()->answerCallback($callbackId);

        if ($data === 'topup') {
            $this->startTopup($chatId, null, null);
        } elseif ($data === 'cancel') {
            $this->clearSession($chatId);
            $this->say($chatId, 'Cancelled. Send /topup to start again.');
        } elseif (strpos($data, 'amt:') === 0) {
            $session = $this->getSession($chatId);
            if ($session['state'] !== 'await_amount') {
                $this->say($chatId, 'That button has expired. Send /topup to start again.');
                return;
            }
            $this->createPayment($chatId, (string) ($session['data']['username'] ?? ''), substr($data, 4));
        }
    }

    // ------------------------------------------------------------ top-up flow

    private function startTopup(string $chatId, ?string $username, ?string $amount): void
    {
        if ($username === null) {
            $this->setSession($chatId, 'await_username', []);
            $this->say($chatId, 'Send the <b>username</b> of the account you want to top up.', $this->cancelKeyboard());
            return;
        }
        $user = $this->verifyUser($username);
        if ($user === null) {
            return;
        }
        if ($amount !== null) {
            $this->createPayment($chatId, (string) $user['username'], $amount);
            return;
        }
        $this->askAmount($chatId, (string) $user['username']);
    }

    private function acceptUsername(string $chatId, string $text): void
    {
        $user = $this->verifyUser($text);
        if ($user !== null) {
            $this->askAmount($chatId, (string) $user['username']);
        }
    }

    /**
     * @return array<string,mixed>|null
     */
    private function verifyUser(string $raw): ?array
    {
        $payments = $this->payments();
        $username = $payments->normalizeUsername($raw);
        $user = $payments->lookupUser($username);
        if ($user === null) {
            throw new UserError('unknown_user', 'No account found with username "' . $username . '". Check it and send it again, or /cancel.');
        }

        return $user;
    }

    private function askAmount(string $chatId, string $username): void
    {
        $this->setSession($chatId, 'await_amount', ['username' => $username]);
        $pay = $this->app->config['payments'];
        $payments = $this->payments();

        $buttons = [];
        foreach ((array) $pay['presets'] as $preset) {
            $buttons[] = ['text' => $payments->money($preset), 'callback_data' => 'amt:' . $preset];
        }
        $keyboard = array_chunk($buttons, 3);
        $keyboard[] = [['text' => 'Cancel', 'callback_data' => 'cancel']];

        $this->say(
            $chatId,
            'Account: <code>' . self::e($username) . "</code>\n"
            . 'Choose an amount, or type one between ' . self::e($payments->money($pay['min_amount']))
            . ' and ' . self::e($payments->money($pay['max_amount'])) . '.'
            . $this->bonusLine(),
            ['reply_markup' => ['inline_keyboard' => $keyboard]]
        );
    }

    private function createPayment(string $chatId, string $username, string $amount): void
    {
        if ($username === '') {
            $this->startTopup($chatId, null, null);
            return;
        }
        $order = $this->payments()->createOrder(
            ['username' => $username, 'amount' => $amount],
            'telegram',
            ['tg_chat_id' => $chatId]
        );
        $this->clearSession($chatId);

        $payments = $this->payments();
        $view = $payments->publicView($order);
        $lines = [
            '🧾 <b>Payment created</b>',
            'Account: <code>' . self::e($view['username']) . '</code>',
            'Amount: <b>' . self::e($view['amount_display']) . '</b>',
            'Credit: <b>' . self::e($view['credit']) . '</b>' . ($view['bonus_percent'] > 0 ? ' (includes ' . self::e((string) $view['bonus_percent']) . '% bonus)' : ''),
            '',
            'Tap <b>Pay</b> to choose a cryptocurrency. The link is valid for ' . (int) $this->app->config['oxapay']['lifetime'] . ' minutes.',
            'I will message you here as soon as the payment is confirmed.',
        ];
        $this->say($chatId, implode("\n", $lines), [
            'reply_markup' => ['inline_keyboard' => [
                [['text' => 'Pay ' . $view['amount_display'], 'url' => (string) $order['payment_url']]],
                [['text' => 'Check status', 'callback_data' => 'chk:' . $order['id']]],
            ]],
        ]);
    }

    // ------------------------------------------------------------------ views

    private function sendWelcome(string $chatId, bool $admin): void
    {
        $site = $this->app->config['site'];
        $text = '👋 <b>' . self::e((string) $site['name']) . "</b>\n"
            . self::e((string) $site['tagline']) . "\n\n"
            . "/topup — add balance to an account\n"
            . "/status &lt;order&gt; — check a payment\n"
            . '/cancel — stop the current step';
        if ($admin) {
            $text .= "\n\n<b>Admin</b>\n/recent — latest payments\n/order &lt;id&gt; — order details\n"
                . "/retry &lt;id&gt; — re-check or re-credit an order\n/balance &lt;username&gt; — account balance\n/stats — totals";
        }

        $keyboard = [[['text' => '💳 Top up balance', 'callback_data' => 'topup']]];
        $base = $this->app->baseUrl();
        if (strpos($base, 'https://') === 0) {
            $keyboard[] = [['text' => '🌐 Open website', 'url' => $base . '/']];
        }
        $this->say($chatId, $text, ['reply_markup' => ['inline_keyboard' => $keyboard]]);
    }

    private function sendOrderStatus(string $chatId, string $orderId, bool $admin): void
    {
        $order = $orderId === '' ? null : $this->payments()->getOrder(strtolower($orderId));
        if ($order === null) {
            $this->say($chatId, 'Send the order ID, for example <code>/status 3f2a…</code>.');
            return;
        }
        $order = $this->payments()->refreshIfStale($order);
        $this->say($chatId, $this->orderText($order, $admin));
    }

    private function sendRecent(string $chatId): void
    {
        $orders = $this->payments()->recent(10);
        if ($orders === []) {
            $this->say($chatId, 'No orders yet.');
            return;
        }
        $lines = ['<b>Latest orders</b>'];
        foreach ($orders as $order) {
            $lines[] = date('m-d H:i', (int) $order['created_at']) . ' · <code>' . self::e((string) $order['username']) . '</code> · '
                . self::e($this->payments()->money($order['amount'])) . ' · ' . self::e((string) $order['status'])
                . ' · ' . self::e((string) $order['source']) . "\n   <code>" . self::e((string) $order['id']) . '</code>';
        }
        $this->say($chatId, implode("\n", $lines));
    }

    private function sendBalance(string $chatId, string $username): void
    {
        $payments = $this->payments();
        $user = $payments->lookupUser($payments->normalizeUsername($username));
        if ($user === null) {
            $this->say($chatId, 'No account found with that username.');
            return;
        }
        $this->say($chatId, 'Account <code>' . self::e((string) $user['username']) . '</code> balance: <b>'
            . self::e(number_format((float) ($user['credit'] ?? 0), 2)) . '</b>');
    }

    private function sendStats(string $chatId): void
    {
        $payments = $this->payments();
        $today = $payments->totalsSince((int) strtotime('today'));
        $week = $payments->totalsSince(time() - 7 * 86400);
        $month = $payments->totalsSince(time() - 30 * 86400);
        $this->say($chatId, implode("\n", [
            '<b>Credited payments</b>',
            'Today: ' . $today['count'] . ' · ' . self::e($payments->money($today['amount'])),
            '7 days: ' . $week['count'] . ' · ' . self::e($payments->money($week['amount'])),
            '30 days: ' . $month['count'] . ' · ' . self::e($payments->money($month['amount'])),
        ]));
    }

    private function orderText(array $order, bool $admin): string
    {
        $payments = $this->payments();
        $lines = [
            '<b>Order</b> <code>' . self::e((string) $order['id']) . '</code>',
            'Account: <code>' . self::e((string) $order['username']) . '</code>',
            'Amount: ' . self::e($payments->money($order['amount'])) . ' → credit ' . self::e(Payments::formatCredit($order['credit'])),
            'Status: <b>' . self::e(Payments::statusLabel((string) $order['status'])) . '</b>',
        ];
        if ($admin) {
            $lines[] = 'Source: ' . self::e((string) $order['source']) . ' · OxaPay: ' . self::e((string) ($order['provider_status'] ?? '-'))
                . ' · track ' . self::e((string) ($order['track_id'] ?? '-'));
            $lines[] = 'Created: ' . date('Y-m-d H:i', (int) $order['created_at']);
            if (!empty($order['refill_id'])) {
                $lines[] = 'Magnus refill ID: ' . self::e((string) $order['refill_id']);
            }
            if (!empty($order['last_error'])) {
                $lines[] = 'Last error: ' . self::e((string) $order['last_error']);
            }
        }

        return implode("\n", $lines);
    }

    private function bonusLine(): string
    {
        $tiers = (array) $this->app->config['payments']['bonus'];
        $parts = [];
        foreach ($tiers as $tier) {
            if (is_array($tier) && isset($tier['min'], $tier['percent'])) {
                $parts[] = '+' . $tier['percent'] . '% from ' . $this->payments()->money($tier['min']);
            }
        }

        return $parts === [] ? '' : "\n🎁 Bonus: " . self::e(implode(', ', $parts));
    }

    // ---------------------------------------------------------- notifications

    /**
     * Called by Payments when an order changes state.
     */
    public function notify(string $event, array $order): void
    {
        $payments = $this->payments();
        $amount = $payments->money($order['amount']);
        $user = self::e((string) $order['username']);
        $id = self::e((string) $order['id']);

        $customer = null;
        $admin = null;
        switch ($event) {
            case 'credited':
                $customer = "✅ <b>Payment confirmed</b>\n" . self::e(Payments::formatCredit($order['credit']))
                    . " credit has been added to <code>{$user}</code>. Thank you!";
                $admin = "💰 <b>New top-up</b> {$amount}\nAccount: <code>{$user}</code> · credit "
                    . self::e(Payments::formatCredit($order['credit'])) . ' · via ' . self::e((string) $order['source'])
                    . "\nOrder <code>{$id}</code>";
                break;
            case 'expired':
                $customer = "⌛ The payment link for {$amount} to <code>{$user}</code> has expired. Send /topup to create a new one.";
                break;
            case 'underpaid':
                $customer = "⚠️ The payment for order <code>{$id}</code> was less than the invoice amount. Please contact support.";
                $admin = "⚠️ <b>Underpaid</b> {$amount} for <code>{$user}</code>\nOrder <code>{$id}</code>";
                break;
            case 'credit_failed':
                $admin = "🚨 <b>Paid but credit failed</b> {$amount} for <code>{$user}</code>\nOrder <code>{$id}</code>\n"
                    . self::e((string) $order['last_error']) . "\nIt is retried automatically; use /retry {$id} to force it.";
                break;
            case 'review':
                $admin = "🔎 <b>Held for review</b> {$amount} for <code>{$user}</code>\nOrder <code>{$id}</code>\n"
                    . self::e((string) $order['last_error']) . "\nUse /retry {$id} to credit it anyway.";
                break;
        }

        if ($customer !== null && !empty($order['tg_chat_id'])) {
            $this->say((string) $order['tg_chat_id'], $customer);
        }
        if ($admin !== null && !empty($this->app->config['telegram']['notify_admins'])) {
            foreach ((array) $this->app->config['telegram']['admin_chat_ids'] as $adminChat) {
                if ((string) $adminChat === (string) ($order['tg_chat_id'] ?? '')) {
                    continue;
                }
                try {
                    $this->say((string) $adminChat, $admin);
                } catch (\Throwable $e) {
                    $this->app->log('warning', 'Admin notification failed', ['chat' => $adminChat, 'error' => $e->getMessage()]);
                }
            }
        }
    }

    // ---------------------------------------------------------------- helpers

    private function say(string $chatId, string $html, array $extra = []): void
    {
        $this->tg()->sendMessage($chatId, $html, $extra);
    }

    private function cancelKeyboard(): array
    {
        return ['reply_markup' => ['inline_keyboard' => [[['text' => 'Cancel', 'callback_data' => 'cancel']]]]];
    }

    /**
     * @return array{state:string, data:array<string,mixed>}
     */
    private function getSession(string $chatId): array
    {
        $row = $this->app->db()->one(
            'SELECT state, data, updated_at FROM ' . $this->app->db()->table('tg_sessions') . ' WHERE chat_id = ?',
            [$chatId]
        );
        if ($row === null || (int) $row['updated_at'] < time() - 3600) {
            return ['state' => 'idle', 'data' => []];
        }
        $data = json_decode((string) $row['data'], true);

        return ['state' => (string) $row['state'], 'data' => is_array($data) ? $data : []];
    }

    private function setSession(string $chatId, string $state, array $data): void
    {
        $this->app->db()->run(
            'REPLACE INTO ' . $this->app->db()->table('tg_sessions') . ' (chat_id, state, data, updated_at) VALUES (?, ?, ?, ?)',
            [$chatId, $state, json_encode($data), time()]
        );
    }

    private function clearSession(string $chatId): void
    {
        $this->app->db()->run('DELETE FROM ' . $this->app->db()->table('tg_sessions') . ' WHERE chat_id = ?', [$chatId]);
    }

    private static function e(string $text): string
    {
        return htmlspecialchars($text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
