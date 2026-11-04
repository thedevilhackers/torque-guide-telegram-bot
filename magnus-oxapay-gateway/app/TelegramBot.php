<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Telegram bot: customers top up from chat, admins get payment alerts and a few commands.
 *
 * Customer:  /start  /topup [username] [amount]  /status <order>  /myorders  /cancel  /id  /help
 *            menu buttons, deep links t.me/<bot>?start=u_<username> (top up) and ?start=o_<order> (follow an order)
 * Admin:     /recent  /find <username>  /order <id>  /retry <id>  /balance <username>  /stats
 *            /sip <sip|username>  /callerid <sip> <number>  /addcredit <username> <amount> [note]
 *            /removecredit <username> <amount> [note]  /markpaid <order>
 * Admins also get a "🛠 Admin panel" button that does all of the above with buttons and guided questions.
 * Every admin change asks for confirmation, is logged, and is announced to the other admins.
 */
final class TelegramBot
{
    /** How long a Confirm button stays valid. */
    private const CONFIRM_TTL = 300;

    private const MENU_TOPUP = '💳 Top up';
    private const MENU_ORDERS = '🧾 My payments';
    private const MENU_HELP = '❓ Help';
    private const MENU_ADMIN = '🛠 Admin panel';

    /** Quick amounts on the admin add/remove credit buttons. */
    private const ADMIN_AMOUNTS = [5, 10, 25, 50, 100];

    private const STATUS_ICONS = [
        'new' => '⏳', 'pending' => '⏳', 'paying' => '🔄', 'crediting' => '🔄', 'credited' => '✅',
        'credit_failed' => '⚠️', 'review' => '🔎', 'expired' => '⌛', 'underpaid' => '⚠️', 'refunded' => '↩️', 'failed' => '❌',
    ];

    /** @var App */
    private $app;

    /** @var string who sent the update being handled, for the audit log */
    private $actor = 'unknown';

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
        $from = $update['message']['from'] ?? ($update['callback_query']['from'] ?? []);
        $this->actor = self::actorName(is_array($from) ? $from : []);

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
                $payload = (string) ($args[0] ?? '');
                if (strpos($payload, 'o_') === 0) {
                    $this->followOrder($chatId, substr($payload, 2));
                    return;
                }
                if (strpos($payload, 'u_') === 0) {
                    $this->startTopup($chatId, substr($payload, 2), null);
                    return;
                }
                $this->clearSession($chatId);
                $this->sendWelcome($chatId, $admin);
                return;

            case '/help':
            case '/menu':
                $this->clearSession($chatId);
                $this->sendWelcome($chatId, $admin);
                return;

            case '/myorders':
            case '/payments':
                $this->sendMyOrders($chatId);
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
                case '/find':
                    $this->sendOrdersForUsername($chatId, (string) ($args[0] ?? ''));
                    return;
                case '/order':
                    $this->sendOrderStatus($chatId, (string) ($args[0] ?? ''), true);
                    return;
                case '/retry':
                    $order = $this->payments()->retry((string) ($args[0] ?? ''));
                    $this->say($chatId, $this->orderText($order, true), $this->orderButtons($order));
                    return;
                case '/admin':
                    $this->clearSession($chatId);
                    $this->sendAdminPanel($chatId);
                    return;
                case '/balance':
                case '/account':
                    $this->sendAccount($chatId, (string) ($args[0] ?? ''));
                    return;
                case '/stats':
                    $this->sendStats($chatId);
                    return;
                case '/sip':
                    $this->sendSipAccounts($chatId, (string) ($args[0] ?? ''));
                    return;
                case '/callerid':
                    $this->askCallerIdChange($chatId, (string) ($args[0] ?? ''), implode('', array_slice($args, 1)));
                    return;
                case '/addcredit':
                case '/removecredit':
                    $amount = (string) ($args[1] ?? '');
                    if ($command === '/removecredit' && $amount !== '') {
                        $amount = '-' . ltrim($amount, '+-');
                    }
                    $this->askCreditChange($chatId, (string) ($args[0] ?? ''), $amount, implode(' ', array_slice($args, 2)));
                    return;
                case '/markpaid':
                    $this->askMarkPaid($chatId, (string) ($args[0] ?? ''));
                    return;
            }
        }

        $this->say($chatId, 'Unknown command. Send /help to see what I can do.');
    }

    private function onText(string $chatId, string $text): void
    {
        switch ($text) {
            case self::MENU_TOPUP:
                $this->startTopup($chatId, null, null);
                return;
            case self::MENU_ORDERS:
                $this->sendMyOrders($chatId);
                return;
            case self::MENU_HELP:
                $this->clearSession($chatId);
                $this->sendWelcome($chatId, $this->app->isAdminChat($chatId));
                return;
            case self::MENU_ADMIN:
                if ($this->app->isAdminChat($chatId)) {
                    $this->clearSession($chatId);
                    $this->sendAdminPanel($chatId);
                    return;
                }
                break;
        }

        $session = $this->getSession($chatId);
        if (strpos($session['state'], 'adm_') === 0) {
            if ($this->app->isAdminChat($chatId)) {
                $this->onAdminText($chatId, $session, $text);
            }
            return;
        }
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

        if (strpos($data, 'cf:') === 0) {
            $this->tg()->answerCallback($callbackId);
            $this->runConfirmed($chatId, substr($data, 3));
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

        if (strpos($data, 'adm:') === 0) {
            if ($this->app->isAdminChat($chatId)) {
                $this->onAdminButton($chatId, substr($data, 4));
            }
            return;
        }

        if ($data === 'topup') {
            $this->startTopup($chatId, null, null);
        } elseif (strpos($data, 'usr:') === 0) {
            $this->startTopup($chatId, substr($data, 4), null);
        } elseif ($data === 'cancel') {
            $state = $this->getSession($chatId)['state'];
            $wasConfirm = $state === 'confirm' || strpos($state, 'adm_') === 0;
            $this->clearSession($chatId);
            $this->say($chatId, $wasConfirm ? 'Cancelled. Nothing was changed.' : 'Cancelled. Send /topup to start again.');
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
            $keyboard = [];
            foreach ($this->payments()->recentUsernamesForChat($chatId) as $previous) {
                if (strlen($previous) <= 56) {
                    $keyboard[] = [['text' => '↻ ' . $previous, 'callback_data' => 'usr:' . $previous]];
                }
            }
            $keyboard[] = [['text' => 'Cancel', 'callback_data' => 'cancel']];
            $this->say(
                $chatId,
                'Send the <b>username</b> of the account you want to top up'
                . (count($keyboard) > 1 ? ', or tap one you used before.' : '.'),
                ['reply_markup' => ['inline_keyboard' => $keyboard]]
            );
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
            $buttons[] = ['text' => $payments->money($preset, true), 'callback_data' => 'amt:' . $preset];
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
        $lines = [
            '✨ <b>' . self::e((string) $site['name']) . '</b>',
            self::e((string) $site['tagline']) . '. Pay with USDT, BTC, ETH and more; your balance is updated automatically.',
            '',
            '💳 <b>Top up</b>: add balance to an account',
            '🧾 <b>My payments</b>: payments started from this chat',
            '🔎 /status &lt;order&gt;: check any payment',
        ];
        $base = $this->app->baseUrl();
        if (strpos($base, 'https://') === 0) {
            $lines[] = '🌐 <a href="' . self::e($base . '/') . '">Open the payment website</a>';
        }
        if ((string) $site['support_url'] !== '') {
            $lines[] = '🆘 <a href="' . self::e((string) $site['support_url']) . '">Support</a>';
        }
        if ($admin) {
            $lines[] = '';
            $lines[] = '<b>Admin</b>: tap <b>' . self::e(self::MENU_ADMIN) . '</b>, or use commands:';
            $lines[] = '/recent · /stats · /find &lt;username&gt; · /order &lt;id&gt;';
            $lines[] = '/retry &lt;id&gt; · /markpaid &lt;id&gt;: re-check or credit an order by hand';
            $lines[] = '/balance &lt;username&gt;';
            $lines[] = '/addcredit &lt;username&gt; &lt;amount&gt; [note] · /removecredit …';
            $lines[] = '/sip &lt;sip or username&gt; · /callerid &lt;sip&gt; &lt;number&gt;';
        }

        $keyboard = [
            [['text' => self::MENU_TOPUP], ['text' => self::MENU_ORDERS]],
            [['text' => self::MENU_HELP]],
        ];
        if ($admin) {
            $keyboard[1][] = ['text' => self::MENU_ADMIN];
        }
        $this->say($chatId, implode("\n", $lines), ['reply_markup' => [
            'keyboard' => $keyboard,
            'resize_keyboard' => true,
            'is_persistent' => true,
        ]]);
    }

    private function sendMyOrders(string $chatId): void
    {
        $orders = $this->payments()->ordersForChat($chatId, 5);
        if ($orders === []) {
            $this->say($chatId, 'No payments from this chat yet. Tap <b>' . self::e(self::MENU_TOPUP) . '</b> to start one.');
            return;
        }
        $lines = ['🧾 <b>Your recent payments</b>'];
        $buttons = [];
        foreach ($orders as $order) {
            $order = $this->payments()->refreshIfStale($order);
            $lines[] = $this->orderLine($order);
            if (in_array($order['status'], ['new', 'pending'], true) && !empty($order['payment_url']) && count($buttons) < 3) {
                $buttons[] = [['text' => 'Pay ' . $this->payments()->money($order['amount']) . ' for ' . $order['username'], 'url' => (string) $order['payment_url']]];
            }
        }
        $this->say($chatId, implode("\n", $lines), $buttons === [] ? [] : ['reply_markup' => ['inline_keyboard' => $buttons]]);
    }

    private function followOrder(string $chatId, string $orderId): void
    {
        $order = $this->payments()->getOrder(strtolower($orderId));
        if ($order === null) {
            $this->say($chatId, 'Order not found. Check the link, or send /topup to start a new payment.');
            return;
        }
        $linked = $this->payments()->linkTelegram((string) $order['id'], $chatId);
        $order = $this->payments()->refreshIfStale($this->payments()->getOrder((string) $order['id']) ?? $order);
        $intro = $linked
            ? '🔔 Notifications are on. I will message you here when this payment is confirmed.'
            : 'This payment already sends its updates to another Telegram chat.';
        $extra = [];
        if (in_array($order['status'], ['new', 'pending'], true) && !empty($order['payment_url'])) {
            $extra = ['reply_markup' => ['inline_keyboard' => [[['text' => 'Pay ' . $this->payments()->money($order['amount']), 'url' => (string) $order['payment_url']]]]]];
        }
        $this->say($chatId, $intro . "\n\n" . $this->orderText($order, false), $extra);
    }

    private function sendOrdersForUsername(string $chatId, string $username): void
    {
        if ($username === '') {
            $this->say($chatId, 'Usage: <code>/find 100234</code>');
            return;
        }
        $orders = $this->payments()->ordersForUsername($username, 10);
        if ($orders === []) {
            $this->say($chatId, 'No orders for <code>' . self::e($username) . '</code>.');
            return;
        }
        $lines = ['<b>Orders for</b> <code>' . self::e($username) . '</code>'];
        foreach ($orders as $order) {
            $lines[] = $this->orderLine($order) . ' · ' . self::e((string) $order['source']) . "\n   <code>" . self::e((string) $order['id']) . '</code>';
        }
        $this->say($chatId, implode("\n", $lines));
    }

    private function orderLine(array $order): string
    {
        $status = (string) $order['status'];

        return (self::STATUS_ICONS[$status] ?? '•') . ' ' . date('d M H:i', (int) $order['created_at'])
            . ' · <code>' . self::e((string) $order['username']) . '</code> · <b>' . self::e($this->payments()->money($order['amount']))
            . '</b> · ' . self::e(Payments::statusLabel($status));
    }

    private function sendOrderStatus(string $chatId, string $orderId, bool $admin): void
    {
        $order = $orderId === '' ? null : $this->payments()->getOrder(strtolower($orderId));
        if ($order === null) {
            $this->say($chatId, 'Send the order ID, for example <code>/status 3f2a…</code>.');
            return;
        }
        $order = $this->payments()->refreshIfStale($order);
        $this->say($chatId, $this->orderText($order, $admin), $admin ? $this->orderButtons($order) : []);
    }

    private function sendRecent(string $chatId): void
    {
        $orders = $this->payments()->recent(10);
        if ($orders === []) {
            $this->say($chatId, 'No orders yet.');
            return;
        }
        $lines = ['<b>Latest orders</b>'];
        $buttons = [];
        foreach ($orders as $order) {
            $lines[] = $this->orderLine($order) . ' · ' . self::e((string) $order['source']) . "\n   <code>" . self::e((string) $order['id']) . '</code>';
            if (count($buttons) < 6) {
                $buttons[] = [['text' => (self::STATUS_ICONS[$order['status']] ?? '•') . ' ' . $order['username'] . ' · '
                    . $this->payments()->money($order['amount']) . ' · ' . date('d M H:i', (int) $order['created_at']),
                    'callback_data' => 'adm:order:' . $order['id']]];
            }
        }
        $buttons[] = [['text' => '« Admin panel', 'callback_data' => 'adm:panel']];
        $this->say($chatId, implode("\n", $lines), ['reply_markup' => ['inline_keyboard' => $buttons]]);
    }

    /**
     * Account card: balance, SIP accounts, latest orders, and action buttons.
     */
    private function sendAccount(string $chatId, string $username): void
    {
        if ($username === '') {
            $this->say($chatId, 'Usage: <code>/account 100234</code>');
            return;
        }
        $payments = $this->payments();
        $user = $payments->lookupUser($payments->normalizeUsername($username));
        if ($user === null) {
            $this->say($chatId, 'No account found with username <code>' . self::e($username) . '</code>.');
            return;
        }
        $name = (string) $user['username'];
        $lines = [
            '👤 <b>Account</b> <code>' . self::e($name) . '</code>',
            'Balance: <b>' . self::e(number_format((float) ($user['credit'] ?? 0), 2)) . '</b>',
        ];
        try {
            $sips = $this->app->magnus()->sipAccountsForUser((int) $user['id']);
        } catch (\Throwable $e) {
            $sips = [];
        }
        foreach (array_slice($sips, 0, 5) as $sip) {
            $lines[] = self::sipLine($sip);
        }
        $orders = $payments->ordersForUsername($name, 3);
        if ($orders !== []) {
            $lines[] = '';
            $lines[] = '<b>Latest top-ups</b>';
            foreach ($orders as $order) {
                $lines[] = $this->orderLine($order);
            }
        }

        $keyboard = [];
        if (strlen($name) <= 50) {
            $keyboard[] = [
                ['text' => '➕ Add credit', 'callback_data' => 'adm:add:' . $name],
                ['text' => '➖ Remove credit', 'callback_data' => 'adm:remove:' . $name],
            ];
        }
        foreach (array_slice($sips, 0, 3) as $sip) {
            if (strlen((string) $sip['name']) <= 50) {
                $keyboard[] = [['text' => '📞 Caller ID of ' . $sip['name'], 'callback_data' => 'adm:cid:' . $sip['name']]];
            }
        }
        if (strlen($name) <= 50) {
            $keyboard[] = [['text' => '🔍 All orders', 'callback_data' => 'adm:findu:' . $name], ['text' => '« Admin panel', 'callback_data' => 'adm:panel']];
        }
        $this->say($chatId, implode("\n", $lines), ['reply_markup' => ['inline_keyboard' => $keyboard]]);
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

    // ---------------------------------------------------------- admin tools

    private function sendSipAccounts(string $chatId, string $query): void
    {
        if ($query === '') {
            $this->say($chatId, 'Usage: <code>/sip 100234</code> (SIP username or account username)');
            return;
        }
        $accounts = $this->app->adminTools()->findSipAccounts($query);
        if ($accounts === []) {
            $this->say($chatId, 'No SIP account found for <code>' . self::e($query) . '</code>.');
            return;
        }
        $lines = ['<b>SIP accounts</b>'];
        $buttons = [];
        foreach ($accounts as $sip) {
            $lines[] = self::sipLine($sip);
            if (count($buttons) < 8 && strlen((string) $sip['name']) <= 50) {
                $buttons[] = [['text' => '📞 Change caller ID of ' . $sip['name'], 'callback_data' => 'adm:cid:' . $sip['name']]];
            }
        }
        $this->say($chatId, implode("\n", $lines), $buttons === [] ? [] : ['reply_markup' => ['inline_keyboard' => $buttons]]);
    }

    private function askCallerIdChange(string $chatId, string $query, string $number): void
    {
        if ($query === '' || $number === '') {
            $this->say($chatId, 'Usage: <code>/callerid 100234 +15551234567</code>');
            return;
        }
        $tools = $this->app->adminTools();
        $callerId = $tools->normalizeCallerId($number);
        $accounts = $tools->findSipAccounts($query);
        if ($accounts === []) {
            $this->say($chatId, 'No SIP account found for <code>' . self::e($query) . '</code>.');
            return;
        }
        if (count($accounts) > 1) {
            $lines = ['<code>' . self::e($query) . '</code> has ' . count($accounts) . ' SIP accounts. Use the SIP username:'];
            foreach ($accounts as $sip) {
                $lines[] = self::sipLine($sip);
            }
            $this->say($chatId, implode("\n", $lines));
            return;
        }
        $sip = $accounts[0];
        $this->askConfirm(
            $chatId,
            '📞 Change caller ID of SIP <code>' . self::e((string) $sip['name']) . "</code>?\n"
            . 'From <code>' . self::e((string) ($sip['callerid'] ?? '')) . '</code> to <code>' . self::e($callerId) . '</code>',
            ['type' => 'callerid', 'sip' => (string) $sip['name'], 'callerid' => $callerId]
        );
    }

    private function askCreditChange(string $chatId, string $username, string $amount, string $note): void
    {
        if ($username === '' || $amount === '') {
            $this->say($chatId, "Usage: <code>/addcredit 100234 25 bank transfer</code>\nor <code>/removecredit 100234 5 correction</code>");
            return;
        }
        $payments = $this->payments();
        $amount = $this->app->adminTools()->parseCreditAmount($amount);
        $user = $payments->lookupUser($payments->normalizeUsername($username));
        if ($user === null) {
            $this->say($chatId, 'No account found with username <code>' . self::e($username) . '</code>.');
            return;
        }
        $adding = (float) $amount > 0;
        $this->askConfirm(
            $chatId,
            ($adding ? '➕ Add <b>' : '➖ Remove <b>') . self::e(ltrim($amount, '-')) . '</b> credit '
            . ($adding ? 'to' : 'from') . ' <code>' . self::e((string) $user['username']) . "</code>?\n"
            . 'Current balance: ' . self::e(number_format((float) ($user['credit'] ?? 0), 2))
            . ($note !== '' ? "\nNote: " . self::e($note) : ''),
            ['type' => 'credit', 'username' => (string) $user['username'], 'amount' => $amount, 'note' => $note]
        );
    }

    private function askMarkPaid(string $chatId, string $orderId): void
    {
        $order = $orderId === '' ? null : $this->payments()->getOrder(strtolower($orderId));
        if ($order === null) {
            $this->say($chatId, 'Usage: <code>/markpaid &lt;order id&gt;</code> (see /recent)');
            return;
        }
        if ($order['status'] === 'credited') {
            $this->say($chatId, 'That order is already credited.');
            return;
        }
        $this->askConfirm(
            $chatId,
            "✅ Mark this order as paid and add the credit?\n\n" . $this->orderText($order, true),
            ['type' => 'markpaid', 'order' => (string) $order['id']]
        );
    }

    /**
     * @param array<string,mixed> $action
     */
    private function askConfirm(string $chatId, string $html, array $action): void
    {
        $token = bin2hex(random_bytes(8));
        $this->setSession($chatId, 'confirm', ['token' => $token, 'action' => $action, 'expires' => time() + self::CONFIRM_TTL]);
        $this->say($chatId, $html, ['reply_markup' => ['inline_keyboard' => [[
            ['text' => '✅ Confirm', 'callback_data' => 'cf:' . $token],
            ['text' => 'Cancel', 'callback_data' => 'cancel'],
        ]]]]);
    }

    private function runConfirmed(string $chatId, string $token): void
    {
        if (!$this->app->isAdminChat($chatId) || !preg_match('/^[a-f0-9]{16}$/', $token)) {
            return;
        }
        $session = $this->getSession($chatId);
        $data = $session['data'];
        $valid = $session['state'] === 'confirm'
            && isset($data['token'], $data['action'], $data['expires'])
            && hash_equals((string) $data['token'], $token)
            && (int) $data['expires'] >= time();
        // Delete first so a double tap cannot run the action twice.
        $claimed = $valid && $this->app->db()->run(
            'DELETE FROM ' . $this->app->db()->table('tg_sessions') . " WHERE chat_id = ? AND state = 'confirm' AND data LIKE ?",
            [$chatId, '%"token":"' . $token . '"%']
        ) > 0;
        if (!$claimed) {
            $this->say($chatId, 'That confirmation has expired or was already used. Send the command again.');
            return;
        }

        $action = (array) $data['action'];
        $tools = $this->app->adminTools();
        switch ($action['type'] ?? '') {
            case 'callerid':
                $sip = $this->app->magnus()->findSip((string) $action['sip']);
                if ($sip === null) {
                    throw new UserError('not_found', 'SIP account not found any more.');
                }
                $old = (string) ($sip['callerid'] ?? '');
                $updated = $tools->setCallerId($sip, (string) $action['callerid'], $this->actor);
                $this->say($chatId, "✅ Caller ID updated\n" . self::sipLine($updated));
                $this->notifyOtherAdmins($chatId, '📞 ' . self::e($this->actor) . ' changed caller ID of SIP <code>'
                    . self::e((string) $sip['name']) . '</code>: <code>' . self::e($old) . '</code> → <code>'
                    . self::e((string) ($updated['callerid'] ?? $action['callerid'])) . '</code>');
                return;

            case 'credit':
                $user = $this->payments()->lookupUser((string) $action['username']);
                if ($user === null) {
                    throw new UserError('unknown_user', 'Account not found any more.');
                }
                $after = $tools->adjustCredit($user, (string) $action['amount'], (string) $action['note'], $this->actor);
                $change = ((float) $action['amount'] > 0 ? '+' : '') . $action['amount'];
                $balance = number_format((float) ($after['credit'] ?? 0), 2);
                $this->say($chatId, '✅ ' . self::e($change) . ' credit for <code>' . self::e((string) $user['username'])
                    . '</code>. New balance: <b>' . self::e($balance) . '</b>');
                $this->notifyOtherAdmins($chatId, '💳 ' . self::e($this->actor) . ' changed credit of <code>'
                    . self::e((string) $user['username']) . '</code> by ' . self::e($change) . ' (balance ' . self::e($balance) . ')'
                    . ((string) $action['note'] !== '' ? "\nNote: " . self::e((string) $action['note']) : ''));
                return;

            case 'markpaid':
                $order = $this->payments()->markPaid((string) $action['order'], $this->actor);
                $this->say($chatId, $this->orderText($order, true));
                $this->notifyOtherAdmins($chatId, '✅ ' . self::e($this->actor) . ' marked order <code>' . self::e((string) $order['id'])
                    . '</code> as paid (' . self::e($this->payments()->money($order['amount'])) . ' for <code>'
                    . self::e((string) $order['username']) . '</code>)');
                return;
        }
    }

    // ------------------------------------------------------------ admin panel

    private function sendAdminPanel(string $chatId): void
    {
        $payments = $this->payments();
        $today = $payments->totalsSince((int) strtotime('today'));
        $this->say(
            $chatId,
            "🛠 <b>Admin panel</b>\nToday: " . $today['count'] . ' payment' . ($today['count'] === 1 ? '' : 's')
            . ' · ' . self::e($payments->money($today['amount'])) . "\nChoose an action:",
            ['reply_markup' => ['inline_keyboard' => [
                [['text' => '📋 Recent orders', 'callback_data' => 'adm:recent'], ['text' => '📊 Stats', 'callback_data' => 'adm:stats']],
                [['text' => '👤 Account', 'callback_data' => 'adm:account'], ['text' => '🔍 Find orders', 'callback_data' => 'adm:find']],
                [['text' => '➕ Add credit', 'callback_data' => 'adm:add'], ['text' => '➖ Remove credit', 'callback_data' => 'adm:remove']],
                [['text' => '☎️ SIP accounts', 'callback_data' => 'adm:sip'], ['text' => '📞 Caller ID', 'callback_data' => 'adm:cid']],
                [['text' => '✅ Mark an order paid', 'callback_data' => 'adm:markpaid']],
            ]]]
        );
    }

    /**
     * Handles a tap on an "adm:" button. The caller has already checked that this is an admin chat.
     */
    private function onAdminButton(string $chatId, string $action): void
    {
        [$command, $arg] = array_pad(explode(':', $action, 2), 2, '');
        $ask = function (string $state, array $data, string $question) use ($chatId): void {
            $this->setSession($chatId, $state, $data);
            $this->say($chatId, $question, $this->cancelKeyboard());
        };

        switch ($command) {
            case 'panel':
                $this->clearSession($chatId);
                $this->sendAdminPanel($chatId);
                return;
            case 'recent':
                $this->sendRecent($chatId);
                return;
            case 'stats':
                $this->sendStats($chatId);
                return;
            case 'order':
                $this->sendOrderStatus($chatId, $arg, true);
                return;
            case 'account':
                if ($arg !== '') {
                    $this->sendAccount($chatId, $arg);
                    return;
                }
                $ask('adm_account', [], '👤 Send the account <b>username</b>.');
                return;
            case 'find':
                $ask('adm_find', [], '🔍 Send the account <b>username</b> to list its orders.');
                return;
            case 'findu':
                $this->sendOrdersForUsername($chatId, $arg);
                return;
            case 'add':
            case 'remove':
                $sign = $command === 'add' ? '+' : '-';
                if ($arg !== '') {
                    $this->askAdminAmount($chatId, $arg, $sign);
                    return;
                }
                $ask('adm_credit_user', ['sign' => $sign], ($sign === '+' ? '➕ Add' : '➖ Remove') . ' credit: send the account <b>username</b>.');
                return;
            case 'amt':
                $session = $this->getSession($chatId);
                if ($session['state'] !== 'adm_credit_amount') {
                    $this->say($chatId, 'That button has expired. Open the admin panel again.');
                    return;
                }
                $this->clearSession($chatId);
                $this->askCreditChange($chatId, (string) $session['data']['username'], ($session['data']['sign'] === '-' ? '-' : '') . $arg, '');
                return;
            case 'sip':
                $ask('adm_sip', [], '☎️ Send a <b>SIP username</b> or account username.');
                return;
            case 'cid':
                if ($arg !== '') {
                    $ask('adm_cid_number', ['sip' => $arg], '📞 Send the new caller ID for SIP <code>' . self::e($arg) . '</code> (digits, optional +).');
                    return;
                }
                $ask('adm_cid_target', [], '📞 Send the <b>SIP username</b> (or account username) whose caller ID you want to change.');
                return;
            case 'markpaid':
                $this->setSession($chatId, 'adm_markpaid', []);
                $buttons = [];
                foreach ($this->payments()->recent(30) as $order) {
                    if (!in_array($order['status'], ['credited', 'failed', 'refunded'], true) && count($buttons) < 6) {
                        $buttons[] = [['text' => (self::STATUS_ICONS[$order['status']] ?? '•') . ' ' . $order['username'] . ' · '
                            . $this->payments()->money($order['amount']) . ' · ' . date('d M H:i', (int) $order['created_at']),
                            'callback_data' => 'adm:mp:' . $order['id']]];
                    }
                }
                $buttons[] = [['text' => 'Cancel', 'callback_data' => 'cancel']];
                $this->say($chatId, '✅ Tap an unpaid order, or send its <b>order ID</b>.', ['reply_markup' => ['inline_keyboard' => $buttons]]);
                return;
            case 'mp':
                $this->clearSession($chatId);
                $this->askMarkPaid($chatId, $arg);
                return;
            case 'retry':
                $order = $this->payments()->retry($arg);
                $this->say($chatId, $this->orderText($order, true), $this->orderButtons($order));
                return;
        }
    }

    /**
     * Text sent while an admin flow waits for input.
     *
     * @param array{state:string, data:array<string,mixed>} $session
     */
    private function onAdminText(string $chatId, array $session, string $text): void
    {
        $data = $session['data'];
        switch ($session['state']) {
            case 'adm_account':
                $this->clearSession($chatId);
                $this->sendAccount($chatId, $text);
                return;
            case 'adm_find':
                $this->clearSession($chatId);
                $this->sendOrdersForUsername($chatId, $text);
                return;
            case 'adm_credit_user':
                $this->askAdminAmount($chatId, $text, (string) ($data['sign'] ?? '+'));
                return;
            case 'adm_credit_amount':
                $parts = preg_split('/\s+/', trim($text), 2) ?: [''];
                $amount = ltrim((string) $parts[0], '+-');
                $this->clearSession($chatId);
                $this->askCreditChange($chatId, (string) $data['username'], ($data['sign'] === '-' ? '-' : '') . $amount, (string) ($parts[1] ?? ''));
                return;
            case 'adm_sip':
                $this->clearSession($chatId);
                $this->sendSipAccounts($chatId, $text);
                return;
            case 'adm_cid_target':
                $accounts = $this->app->adminTools()->findSipAccounts($text);
                if ($accounts === []) {
                    $this->say($chatId, 'No SIP account found for <code>' . self::e($text) . '</code>. Send another name, or Cancel.', $this->cancelKeyboard());
                    return;
                }
                if (count($accounts) === 1) {
                    $this->onAdminButton($chatId, 'cid:' . $accounts[0]['name']);
                    return;
                }
                $this->clearSession($chatId);
                $this->sendSipAccounts($chatId, $text);
                return;
            case 'adm_cid_number':
                $this->clearSession($chatId);
                $this->askCallerIdChange($chatId, (string) $data['sip'], $text);
                return;
            case 'adm_markpaid':
                $this->clearSession($chatId);
                $this->askMarkPaid($chatId, trim($text));
                return;
        }
    }

    private function askAdminAmount(string $chatId, string $username, string $sign): void
    {
        $payments = $this->payments();
        $user = $payments->lookupUser($payments->normalizeUsername($username));
        if ($user === null) {
            $this->setSession($chatId, 'adm_credit_user', ['sign' => $sign]);
            $this->say($chatId, 'No account found with username <code>' . self::e($username) . '</code>. Send another username, or Cancel.', $this->cancelKeyboard());
            return;
        }
        $name = (string) $user['username'];
        $this->setSession($chatId, 'adm_credit_amount', ['username' => $name, 'sign' => $sign]);
        $buttons = [];
        foreach (self::ADMIN_AMOUNTS as $amount) {
            $buttons[] = ['text' => ($sign === '-' ? '−' : '+') . $amount, 'callback_data' => 'adm:amt:' . $amount];
        }
        $this->say(
            $chatId,
            ($sign === '-' ? '➖ Remove credit from' : '➕ Add credit to') . ' <code>' . self::e($name) . '</code>'
            . ' (balance ' . self::e(number_format((float) ($user['credit'] ?? 0), 2)) . ")\n"
            . 'Tap an amount, or send one with an optional note, e.g. <code>25 bank transfer</code>',
            ['reply_markup' => ['inline_keyboard' => [$buttons, [['text' => 'Cancel', 'callback_data' => 'cancel']]]]]
        );
    }

    /**
     * Retry / Mark paid / Account buttons under an order (admins only).
     */
    private function orderButtons(array $order): array
    {
        $id = (string) $order['id'];
        $row = [];
        if (in_array($order['status'], ['crediting', 'credit_failed', 'review', 'pending', 'new', 'paying'], true)) {
            $row[] = ['text' => '🔁 Re-check', 'callback_data' => 'adm:retry:' . $id];
        }
        if (!in_array($order['status'], ['credited', 'failed', 'refunded'], true)) {
            $row[] = ['text' => '✅ Mark paid', 'callback_data' => 'adm:mp:' . $id];
        }
        $keyboard = $row === [] ? [] : [$row];
        if (strlen((string) $order['username']) <= 50) {
            $keyboard[] = [['text' => '👤 Account ' . $order['username'], 'callback_data' => 'adm:account:' . $order['username']]];
        }

        return $keyboard === [] ? [] : ['reply_markup' => ['inline_keyboard' => $keyboard]];
    }

    private function notifyOtherAdmins(string $exceptChat, string $html): void
    {
        foreach ((array) $this->app->config['telegram']['admin_chat_ids'] as $adminChat) {
            if ((string) $adminChat === $exceptChat) {
                continue;
            }
            try {
                $this->say((string) $adminChat, $html);
            } catch (\Throwable $e) {
                $this->app->log('warning', 'Admin notification failed', ['chat' => $adminChat, 'error' => $e->getMessage()]);
            }
        }
    }

    private static function sipLine(array $sip): string
    {
        $owner = (string) ($sip['idUserusername'] ?? ($sip['accountcode'] ?? ''));

        return 'SIP <code>' . self::e((string) ($sip['name'] ?? '')) . '</code>'
            . ($owner !== '' ? ' · account <code>' . self::e($owner) . '</code>' : '')
            . ' · caller ID <code>' . self::e((string) ($sip['callerid'] ?? '-')) . '</code>';
    }

    /**
     * @param array<string,mixed> $from Telegram "from" object
     */
    private static function actorName(array $from): string
    {
        if (!empty($from['username'])) {
            return '@' . preg_replace('/[^A-Za-z0-9_]/', '', (string) $from['username']);
        }
        $name = trim((string) preg_replace('/[^\p{L}\p{N} ]/u', '', (string) ($from['first_name'] ?? '')));

        return ($name !== '' ? $name : 'admin') . (isset($from['id']) ? ' (' . (int) $from['id'] . ')' : '');
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
        $adminButtons = $this->orderButtons($order);
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
                    . self::e((string) $order['last_error']) . "\nIt is retried automatically, or tap Re-check.";
                break;
            case 'review':
                $admin = "🔎 <b>Held for review</b> {$amount} for <code>{$user}</code>\nOrder <code>{$id}</code>\n"
                    . self::e((string) $order['last_error']) . "\nTap Mark paid to credit it anyway.";
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
                    $this->say((string) $adminChat, $admin, $adminButtons);
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
