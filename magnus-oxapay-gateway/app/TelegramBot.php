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
    use BotExtras;

    /** How long a Confirm button stays valid. */
    private const CONFIRM_TTL = 300;

    private const MENU_TOPUP = '💳 Top up';
    private const MENU_ORDERS = '🧾 My payments';
    private const MENU_HELP = '❓ Help';
    private const MENU_ADMIN = '🛠 Admin panel';
    private const MENU_ACCOUNT = '👤 My account';
    private const MENU_SUPPORT = '🆘 Support';

    /** Longest manual notification (Telegram allows 4096 characters per message). */
    private const MESSAGE_MAX = 3500;

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
        $chat = $update['message']['chat'] ?? ($update['callback_query']['message']['chat'] ?? null);
        if (is_array($chat) && ($chat['type'] ?? '') === 'private' && isset($chat['id'])) {
            try {
                $this->app->customers()->touch((string) $chat['id'], is_array($from) ? $from : []);
            } catch (\Throwable $e) {
                $this->app->log('warning', 'Could not record Telegram user', ['error' => $e->getMessage()]);
            }
        }

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
            // Photos and files: support messages and bank transfer receipts.
            if (($message['chat']['type'] ?? 'private') === 'private') {
                $session = $this->getSession($chatId);
                if ($session['state'] === 'support') {
                    $this->forwardSupport($chatId, $message);
                } elseif ($session['state'] === 'bank_receipt') {
                    $this->bankReceipt($chatId, $session['data'], $message);
                }
            }
            return;
        }

        if ($text[0] === '/') {
            $this->onCommand($chatId, $text);
        } elseif (($message['chat']['type'] ?? 'private') === 'private') {
            $session = $this->getSession($chatId);
            if ($session['state'] === 'support' && !in_array($text, [self::MENU_TOPUP, self::MENU_ORDERS, self::MENU_ACCOUNT, self::MENU_HELP, self::MENU_ADMIN, self::MENU_SUPPORT], true)) {
                $this->forwardSupport($chatId, $message);
                return;
            }
            if ($session['state'] === 'bank_receipt') {
                $this->bankReceipt($chatId, $session['data'], $message);
                return;
            }
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
                if (strpos($payload, 'l_') === 0) {
                    $this->acceptInvite($chatId, substr($payload, 2), $admin);
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

            case '/myaccount':
            case '/me':
                $this->sendMyAccount($chatId);
                return;

            case '/support':
                $this->startSupport($chatId);
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

        if (!$admin && $this->app->isViewerChat($chatId)) {
            $arg = (string) ($args[0] ?? '');
            $viewerCommands = ['/admin' => 'panel', '/recent' => 'recent', '/stats' => 'stats', '/live' => 'live',
                '/account' => 'account:' . $arg, '/balance' => 'account:' . $arg, '/order' => 'order:' . $arg, '/find' => 'findu:' . $arg];
            if (isset($viewerCommands[$command])) {
                $this->onAdminButton($chatId, $viewerCommands[$command]);
                return;
            }
            if ($command === '/sip') {
                $this->sendSipAccounts($chatId, $arg);
                return;
            }
        }

        if ($admin) {
            switch ($command) {
                case '/live':
                    $this->sendLiveCalls($chatId);
                    return;
                case '/report':
                    $this->dailyReport();
                    return;
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
            case self::MENU_ACCOUNT:
                $this->sendMyAccount($chatId);
                return;
            case self::MENU_SUPPORT:
                $this->startSupport($chatId);
                return;
            case self::MENU_HELP:
                $this->clearSession($chatId);
                $this->sendWelcome($chatId, $this->app->isAdminChat($chatId));
                return;
            case self::MENU_ADMIN:
                if ($this->app->isViewerChat($chatId)) {
                    $this->clearSession($chatId);
                    $this->sendAdminPanel($chatId);
                    return;
                }
                break;
        }

        $session = $this->getSession($chatId);
        if (strpos($session['state'], 'adm_') === 0) {
            if ($this->app->isViewerChat($chatId)) {
                $this->onAdminText($chatId, $session, $text);
            }
            return;
        }
        switch ($session['state']) {
            case 'bank_amount':
                $this->bankAmount($chatId, $session['data'], $text);
                return;
            case 'await_promo':
                $this->acceptPromo($chatId, $session['data'], $text);
                return;
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
            } elseif ($this->app->isViewerChat($chatId)) {
                $command = explode(':', substr($data, 4), 2)[0];
                if (in_array($command, self::$viewerCommands, true)) {
                    $this->onAdminButton($chatId, substr($data, 4));
                } else {
                    $this->say($chatId, '👀 You have view-only access. Ask a full admin to make changes.');
                }
            }
            return;
        }

        if ($data === 'sup') {
            $this->startSupport($chatId);
            return;
        }
        if ($data === 'bank') {
            $this->startBank($chatId);
            return;
        }
        if ($data === 'promo') {
            $this->startPromo($chatId);
            return;
        }
        if ($data === 'calls') {
            $linked = $this->app->customers()->linkedUsername($chatId);
            if ($linked !== null) {
                $this->sendCalls($chatId, $linked, false);
            }
            return;
        }

        if ($data === 'topup') {
            $this->startTopup($chatId, null, null);
        } elseif (strpos($data, 'usr:') === 0) {
            $this->startTopup($chatId, substr($data, 4), null);
        } elseif ($data === 'unlink') {
            $this->app->customers()->unlink($chatId);
            $this->say($chatId, 'Your Telegram is no longer linked to an account. Ask us for a new invite link to link it again.');
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
            $linked = $this->app->customers()->linkedUsername($chatId);
            $previousNames = $this->payments()->recentUsernamesForChat($chatId);
            if ($linked !== null) {
                $previousNames = array_values(array_unique(array_merge([$linked], $previousNames)));
            }
            foreach (array_slice($previousNames, 0, 3) as $previous) {
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

    private function askAmount(string $chatId, string $username, string $promoCode = '', float $promoPercent = 0.0): void
    {
        $this->setSession($chatId, 'await_amount', ['username' => $username, 'promo' => $promoCode, 'promo_percent' => $promoPercent]);
        $pay = $this->app->config['payments'];
        $payments = $this->payments();

        $buttons = [];
        foreach ((array) $pay['presets'] as $preset) {
            $buttons[] = ['text' => $payments->money($preset, true), 'callback_data' => 'amt:' . $preset];
        }
        $keyboard = array_chunk($buttons, 3);
        $extras = [];
        if ($promoCode === '') {
            $extras[] = ['text' => '🎟 Promo code', 'callback_data' => 'promo'];
        }
        if ($this->bankEnabled()) {
            $extras[] = ['text' => '🏦 Bank transfer', 'callback_data' => 'bank'];
        }
        if ($extras !== []) {
            $keyboard[] = $extras;
        }
        $keyboard[] = [['text' => 'Cancel', 'callback_data' => 'cancel']];

        $this->say(
            $chatId,
            'Account: <code>' . self::e($username) . "</code>\n"
            . 'Choose an amount, or type one between ' . self::e($payments->money($pay['min_amount']))
            . ' and ' . self::e($payments->money($pay['max_amount'])) . '.'
            . $this->bonusLine()
            . ($promoCode !== '' ? "\n🎟 Promo <code>" . self::e($promoCode) . '</code>: +' . self::e((string) $promoPercent) . '% extra credit' : ''),
            ['reply_markup' => ['inline_keyboard' => $keyboard]]
        );
    }

    private function createPayment(string $chatId, string $username, string $amount): void
    {
        if ($username === '') {
            $this->startTopup($chatId, null, null);
            return;
        }
        $session = $this->getSession($chatId);
        $promo = $session['state'] === 'await_amount' ? (string) ($session['data']['promo'] ?? '') : '';
        $order = $this->payments()->createOrder(
            ['username' => $username, 'amount' => $amount, 'promo' => $promo],
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

        $linked = $this->app->customers()->linkedUsername($chatId);
        $keyboard = [
            [['text' => self::MENU_TOPUP], ['text' => self::MENU_ORDERS]],
            [],
        ];
        if ($linked !== null) {
            $keyboard[1][] = ['text' => self::MENU_ACCOUNT];
        }
        $keyboard[1][] = ['text' => self::MENU_SUPPORT];
        $keyboard[2] = [['text' => self::MENU_HELP]];
        if ($admin || $this->app->isViewerChat($chatId)) {
            $keyboard[2][] = ['text' => self::MENU_ADMIN];
        }
        if ($linked !== null) {
            array_splice($lines, 2, 0, ['🔗 Linked to account <code>' . self::e($linked) . '</code>']);
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
                $buttons[] = [['text' => 'Pay ' . $this->payments()->orderMoney($order) . ' for ' . $order['username'], 'url' => (string) $order['payment_url']]];
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
            $extra = ['reply_markup' => ['inline_keyboard' => [[['text' => 'Pay ' . $this->payments()->orderMoney($order), 'url' => (string) $order['payment_url']]]]]];
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
            . ' · <code>' . self::e((string) $order['username']) . '</code> · <b>' . self::e($this->payments()->orderMoney($order))
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
                    . $this->payments()->orderMoney($order) . ' · ' . date('d M H:i', (int) $order['created_at']),
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
        $linkedChats = $this->app->customers()->chatsForUsername($name);
        $lines = [
            '👤 <b>Account</b> <code>' . self::e($name) . '</code>',
            'Balance: <b>' . self::e(number_format((float) ($user['credit'] ?? 0), 2)) . '</b>',
            'Telegram: ' . ($linkedChats === [] ? 'not linked' : 'linked (' . count($linkedChats) . ' chat' . (count($linkedChats) === 1 ? '' : 's') . ')'),
        ];
        $active = (int) ($user['active'] ?? 1);
        $lines[] = 'Status: ' . ($active === 1 ? 'active' : ($active === 0 ? '⛔ blocked' : 'pending'));
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
            $row = [['text' => '🔗 Telegram invite', 'callback_data' => 'adm:inv:' . $name]];
            if ($linkedChats !== []) {
                $row[] = ['text' => '✉️ Message', 'callback_data' => 'adm:msgu:' . $name];
            }
            $keyboard[] = $row;
            $keyboard[] = [
                $active === 0 ? ['text' => '✅ Unblock', 'callback_data' => 'adm:unblock:' . $name] : ['text' => '⛔ Block', 'callback_data' => 'adm:block:' . $name],
                ['text' => '🔑 SIP password', 'callback_data' => 'adm:sippw:' . $name],
            ];
            $keyboard[] = [['text' => '📦 Change plan', 'callback_data' => 'adm:plan:' . $name], ['text' => '📞 Calls', 'callback_data' => 'adm:calls:' . $name]];
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
            'Amount: ' . self::e($payments->orderMoney($order)) . ' → credit ' . self::e(Payments::formatCredit($order['credit'])),
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
        if (in_array($action['type'] ?? '', ['callerid', 'credit', 'markpaid', 'create_user', 'user_active', 'sip_password', 'user_plan', 'bank_approve'], true)) {
            $this->say($chatId, '⏳ Saving in MagnusBilling…');
        }
        $slowNote = "\n<i>MagnusBilling took a while to answer. That is usually its customer email step: check Settings → SMTP in MagnusBilling.</i>";
        switch ($action['type'] ?? '') {
            case 'callerid':
                $sip = $this->app->magnus()->findSip((string) $action['sip']);
                if ($sip === null) {
                    throw new UserError('not_found', 'SIP account not found any more.');
                }
                $old = (string) ($sip['callerid'] ?? '');
                $result = $tools->setCallerId($sip, (string) $action['callerid'], $this->actor);
                $updated = $result['sip'];
                $this->say($chatId, "✅ Caller ID updated\n" . self::sipLine($updated) . ($result['slow'] ? $slowNote : ''));
                $this->notifyOtherAdmins($chatId, '📞 ' . self::e($this->actor) . ' changed caller ID of SIP <code>'
                    . self::e((string) $sip['name']) . '</code>: <code>' . self::e($old) . '</code> → <code>'
                    . self::e((string) ($updated['callerid'] ?? $action['callerid'])) . '</code>');
                return;

            case 'credit':
                $user = $this->payments()->lookupUser((string) $action['username']);
                if ($user === null) {
                    throw new UserError('unknown_user', 'Account not found any more.');
                }
                $result = $tools->adjustCredit($user, (string) $action['amount'], (string) $action['note'], $this->actor);
                $after = $result['user'];
                $change = ((float) $action['amount'] > 0 ? '+' : '') . $action['amount'];
                $balance = number_format((float) ($after['credit'] ?? 0), 2);
                $this->say($chatId, '✅ ' . self::e($change) . ' credit for <code>' . self::e((string) $user['username'])
                    . '</code>. New balance: <b>' . self::e($balance) . '</b>' . ($result['slow'] ? $slowNote : ''));
                $this->notifyOtherAdmins($chatId, '💳 ' . self::e($this->actor) . ' changed credit of <code>'
                    . self::e((string) $user['username']) . '</code> by ' . self::e($change) . ' (balance ' . self::e($balance) . ')'
                    . ((string) $action['note'] !== '' ? "\nNote: " . self::e((string) $action['note']) : ''));
                return;

            case 'setting':
                $this->app->settings()->set((string) $action['name'], (string) $action['value'], $this->actor);
                $this->say($chatId, '✅ Saved.');
                $this->sendSettings($chatId);
                $labels = ['min_amount' => 'the minimum top-up', 'max_amount' => 'the maximum top-up', 'currency' => 'the currency',
                    'low_balance' => 'the low-balance alert', 'report_hour' => 'the daily report time', 'bank_instructions' => 'the bank transfer details',
                    'theme' => 'the website theme'];
                $this->notifyOtherAdmins($chatId, '⚙️ ' . self::e($this->actor) . ' changed ' . self::e($labels[(string) $action['name']] ?? 'a setting') . '.');
                return;

            case 'create_user':
                $created = $tools->createCustomer(
                    $action['username'] !== '' ? (string) $action['username'] : null,
                    $action['password'] !== '' ? (string) $action['password'] : null,
                    (string) $action['email'],
                    !empty($action['plan']) ? (int) $action['plan'] : null,
                    $this->actor
                );
                $token = $this->app->customers()->createInvite($created['username'], $this->actor);
                $link = $this->app->customers()->inviteLink($token);
                $this->say($chatId, implode("\n", [
                    '✅ <b>Customer created</b>',
                    'Username: <code>' . self::e($created['username']) . '</code>',
                    'Password: <code>' . self::e($created['password']) . '</code>',
                    'SIP account: <code>' . self::e($created['username']) . '</code> (same password)',
                    '',
                    'Send this link so the customer can connect their Telegram (single use, valid 7 days):',
                    self::e($link),
                ]), ['reply_markup' => ['inline_keyboard' => [
                    [['text' => '📤 Share invite', 'url' => $this->shareUrl($link)]],
                    [['text' => '➕ Add credit', 'callback_data' => 'adm:add:' . $created['username']], ['text' => '👤 Account', 'callback_data' => 'adm:account:' . $created['username']]],
                ]]]);
                $this->notifyOtherAdmins($chatId, '👤 ' . self::e($this->actor) . ' created customer <code>' . self::e($created['username']) . '</code>');
                return;

            case 'notify':
                $this->sendNotification($chatId, $action);
                return;

            default:
                $this->runConfirmedExtra($chatId, $action);
                return;

            case 'settings_reset':
                $this->app->settings()->reset($this->actor);
                $this->say($chatId, '✅ Settings reset to config.php.');
                $this->sendSettings($chatId);
                $this->notifyOtherAdmins($chatId, '⚙️ ' . self::e($this->actor) . ' reset the settings to config.php.');
                return;

            case 'markpaid':
                $order = $this->payments()->markPaid((string) $action['order'], $this->actor);
                $this->say($chatId, $this->orderText($order, true));
                $this->notifyOtherAdmins($chatId, '✅ ' . self::e($this->actor) . ' marked order <code>' . self::e((string) $order['id'])
                    . '</code> as paid (' . self::e($this->payments()->orderMoney($order)) . ' for <code>'
                    . self::e((string) $order['username']) . '</code>)');
                return;
        }
    }

    // ------------------------------------------------------------ admin panel

    private function sendAdminPanel(string $chatId): void
    {
        $payments = $this->payments();
        $today = $payments->totalsSince((int) strtotime('today'));
        $title = "🛠 <b>Admin panel</b>\nToday: " . $today['count'] . ' payment' . ($today['count'] === 1 ? '' : 's')
            . ' · ' . self::e($payments->money($today['amount']));
        if (!$this->app->isAdminChat($chatId)) {
            $this->say($chatId, $title . "\n👀 View-only access", ['reply_markup' => ['inline_keyboard' => [
                [['text' => '📋 Recent orders', 'callback_data' => 'adm:recent'], ['text' => '📊 Stats', 'callback_data' => 'adm:stats']],
                [['text' => '👤 Account', 'callback_data' => 'adm:account'], ['text' => '🔍 Find orders', 'callback_data' => 'adm:find']],
                [['text' => '📞 Live calls', 'callback_data' => 'adm:live'], ['text' => '👥 Customers', 'callback_data' => 'adm:cust']],
            ]]]);
            return;
        }
        $this->say(
            $chatId,
            $title . "\nChoose an action:",
            ['reply_markup' => ['inline_keyboard' => [
                [['text' => '📋 Recent orders', 'callback_data' => 'adm:recent'], ['text' => '📊 Stats', 'callback_data' => 'adm:stats']],
                [['text' => '👤 Account', 'callback_data' => 'adm:account'], ['text' => '🔍 Find orders', 'callback_data' => 'adm:find']],
                [['text' => '➕ Add credit', 'callback_data' => 'adm:add'], ['text' => '➖ Remove credit', 'callback_data' => 'adm:remove']],
                [['text' => '☎️ SIP accounts', 'callback_data' => 'adm:sip'], ['text' => '📞 Caller ID', 'callback_data' => 'adm:cid']],
                [['text' => '✅ Mark an order paid', 'callback_data' => 'adm:markpaid']],
                [['text' => '👥 Customers', 'callback_data' => 'adm:cust'], ['text' => '📣 Send message', 'callback_data' => 'adm:notify']],
                [['text' => '📞 Live calls', 'callback_data' => 'adm:live'], ['text' => '🎟 Promo codes', 'callback_data' => 'adm:promos']],
                [['text' => '🏦 Bank transfers', 'callback_data' => 'adm:banks'], ['text' => '📊 Report now', 'callback_data' => 'adm:reportnow']],
                [['text' => '⚙️ Settings', 'callback_data' => 'adm:settings']],
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
                            . $this->payments()->orderMoney($order) . ' · ' . date('d M H:i', (int) $order['created_at']),
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
            case 'cust':
                $this->clearSession($chatId);
                $this->sendCustomersMenu($chatId);
                return;
            case 'new':
                $this->setSession($chatId, 'adm_new_user', []);
                $this->say($chatId, "👤 <b>New customer</b> (1/4)\nSend a <b>username</b> (4–20 letters or digits), or let MagnusBilling choose one.", ['reply_markup' => ['inline_keyboard' => [
                    [['text' => '🎲 Automatic username', 'callback_data' => 'adm:newauto']],
                    [['text' => 'Cancel', 'callback_data' => 'cancel']],
                ]]]);
                return;
            case 'newauto':
            case 'newgen':
            case 'newskip':
                $session = $this->getSession($chatId);
                $expected = ['newauto' => 'adm_new_user', 'newgen' => 'adm_new_pass', 'newskip' => 'adm_new_email'][$command];
                if ($session['state'] !== $expected) {
                    $this->say($chatId, 'That button has expired. Start again with 👥 Customers.');
                    return;
                }
                $this->newCustomerStep($chatId, $session, null);
                return;
            case 'newplan':
                $session = $this->getSession($chatId);
                if ($session['state'] !== 'adm_new_plan') {
                    $this->say($chatId, 'That button has expired. Start again with 👥 Customers.');
                    return;
                }
                $data = $session['data'];
                $data['plan'] = (int) $arg;
                foreach ((array) ($data['plans'] ?? []) as $plan) {
                    if ((int) $plan['id'] === (int) $arg) {
                        $data['plan_name'] = (string) $plan['name'];
                    }
                }
                unset($data['plans']);
                $this->clearSession($chatId);
                $this->confirmNewCustomer($chatId, $data);
                return;
            case 'inv':
                if ($arg === '') {
                    $this->setSession($chatId, 'adm_invite', []);
                    $this->say($chatId, '🔗 Send the <b>username</b> of the account the customer should connect to.', $this->cancelKeyboard());
                    return;
                }
                $this->sendInvite($chatId, $arg);
                return;
            case 'linked':
                $this->sendLinkedCustomers($chatId);
                return;
            case 'notify':
                $this->clearSession($chatId);
                $counts = $this->app->customers()->counts();
                $this->say($chatId, "📣 <b>Send a message</b>\nWho should receive it?", ['reply_markup' => ['inline_keyboard' => [
                    [['text' => '👤 One customer', 'callback_data' => 'adm:msgu']],
                    [['text' => '🔗 All linked customers (' . $counts['linked'] . ')', 'callback_data' => 'adm:bc:linked']],
                    [['text' => '👥 Everyone who used the bot (' . $counts['users'] . ')', 'callback_data' => 'adm:bc:all']],
                    [['text' => '« Admin panel', 'callback_data' => 'adm:panel']],
                ]]]);
                return;
            case 'msgu':
                if ($arg === '') {
                    $this->setSession($chatId, 'adm_msg_user', []);
                    $this->say($chatId, '✉️ Send the <b>username</b> of the customer to message.', $this->cancelKeyboard());
                    return;
                }
                $this->askMessageText($chatId, ['audience' => 'user', 'username' => $arg]);
                return;
            case 'bc':
                $this->askMessageText($chatId, ['audience' => $arg === 'linked' ? 'linked' : 'all']);
                return;
            case 'settings':
                $this->clearSession($chatId);
                $this->sendSettings($chatId);
                return;
            default:
                $this->onAdminButtonExtra($chatId, $command, $arg);
                return;
            case 'set':
                $name = $arg === 'max' ? 'max_amount' : 'min_amount';
                $quick = $name === 'min_amount' ? [1, 2, 5, 10, 20] : [100, 250, 500, 1000, 5000];
                $this->setSession($chatId, 'adm_setting', ['name' => $name]);
                $buttons = [];
                foreach ($quick as $value) {
                    $buttons[] = ['text' => $this->payments()->money($value, true), 'callback_data' => 'adm:setv:' . $value];
                }
                $current = $this->payments()->money($this->app->config['payments'][$name]);
                $this->say(
                    $chatId,
                    '✏️ New ' . ($name === 'min_amount' ? '<b>minimum</b>' : '<b>maximum</b>') . ' top-up amount? (now ' . self::e($current) . ")\nTap one, or send an amount such as <code>2.50</code>.",
                    ['reply_markup' => ['inline_keyboard' => [$buttons, [['text' => 'Cancel', 'callback_data' => 'cancel']]]]]
                );
                return;
            case 'setv':
                $session = $this->getSession($chatId);
                if ($session['state'] !== 'adm_setting') {
                    $this->say($chatId, 'That button has expired. Open ⚙️ Settings again.');
                    return;
                }
                $this->clearSession($chatId);
                $this->askSettingChange($chatId, (string) $session['data']['name'], $arg);
                return;
            case 'cur':
                $buttons = [];
                foreach (Settings::CURRENCIES as $code => $symbol) {
                    $buttons[] = ['text' => $symbol . ' ' . $code, 'callback_data' => 'adm:setc:' . $code];
                }
                $this->say($chatId, '💱 Which currency should customers pay in?', ['reply_markup' => ['inline_keyboard' => [$buttons, [['text' => 'Cancel', 'callback_data' => 'cancel']]]]]);
                return;
            case 'setc':
                $this->askSettingChange($chatId, 'currency', $arg);
                return;
            case 'reset':
                $this->askConfirm($chatId, '↩️ Reset minimum, maximum and currency to the values in config.php?', ['type' => 'settings_reset']);
                return;
        }
    }

    private function sendSettings(string $chatId): void
    {
        $pay = $this->app->config['payments'];
        $payments = $this->payments();
        $overrides = $this->app->settings()->overrides();
        $changed = array_map(static function (string $name): string {
            return ['min_amount' => 'minimum', 'max_amount' => 'maximum', 'currency' => 'currency', 'low_balance' => 'low-balance alert',
                'report_hour' => 'report time', 'bank_instructions' => 'bank details', 'theme' => 'theme'][$name] ?? $name;
        }, array_keys($overrides));
        $low = (float) ($pay['low_balance'] ?? 0);
        $hour = (int) ($this->app->config['telegram']['report_hour'] ?? -1);
        $lines = [
            '⚙️ <b>Settings</b>',
            'Currency: <b>' . self::e((string) $pay['currency']) . '</b> (' . self::e((string) $pay['currency_symbol']) . ')',
            'Minimum top-up: <b>' . self::e($payments->money($pay['min_amount'])) . '</b>',
            'Maximum top-up: <b>' . self::e($payments->money($pay['max_amount'])) . '</b>',
            'MagnusBilling credit per 1 ' . self::e((string) $pay['currency']) . ': ' . self::e((string) $pay['credit_rate']) . ' <i>(config.php)</i>',
            'Low-balance alert: <b>' . ($low > 0 ? 'below ' . self::e(number_format($low, 2)) : 'off') . '</b>',
            'Daily report: <b>' . ($hour >= 0 ? sprintf('%02d:00', $hour) : 'off') . '</b>',
            'Bank transfer: <b>' . ($this->bankEnabled() ? 'on' : 'off') . '</b>',
            'Website theme: <b>' . self::e(Settings::THEMES[(string) ($this->app->config['site']['theme'] ?? 'voip')] ?? (string) $this->app->config['site']['theme']) . '</b>',
            '',
            $changed === [] ? 'All values come from config.php.' : 'Changed here: ' . self::e(implode(', ', $changed)) . '. Applies to the website and bot right away.',
        ];
        $keyboard = [
            [['text' => '✏️ Minimum', 'callback_data' => 'adm:set:min'], ['text' => '✏️ Maximum', 'callback_data' => 'adm:set:max']],
            [['text' => '💱 Currency', 'callback_data' => 'adm:cur'], ['text' => '🪫 Low-balance alert', 'callback_data' => 'adm:setlow']],
            [['text' => '📊 Report time', 'callback_data' => 'adm:sethour'], ['text' => '🏦 Bank details', 'callback_data' => 'adm:setbank']],
            [['text' => '🎨 Website theme', 'callback_data' => 'adm:theme']],
        ];
        if (array_intersect(array_keys($overrides), ['min_amount', 'max_amount', 'currency']) !== []) {
            $keyboard[] = [['text' => '↩️ Reset to config.php', 'callback_data' => 'adm:reset']];
        }
        $keyboard[] = [['text' => '« Admin panel', 'callback_data' => 'adm:panel']];
        $this->say($chatId, implode("\n", $lines), ['reply_markup' => ['inline_keyboard' => $keyboard]]);
    }

    private function askSettingChange(string $chatId, string $name, string $value): void
    {
        $settings = $this->app->settings();
        $value = $settings->validate($name, $value);
        $pay = $this->app->config['payments'];
        $payments = $this->payments();
        if ($name === 'currency') {
            if ($value === strtoupper((string) $pay['currency'])) {
                $this->say($chatId, 'Payments are already in ' . self::e($value) . '.');
                return;
            }
            $text = '💱 Switch payments from <b>' . self::e((string) $pay['currency']) . '</b> to <b>' . self::e($value) . "</b>?\n"
                . 'New invoices, the website and the bot will use ' . self::e(Settings::symbolFor($value)) . '. '
                . 'Each ' . self::e($value) . ' paid adds ' . self::e((string) $pay['credit_rate']) . ' MagnusBilling credit, so check that your '
                . 'MagnusBilling currency is ' . self::e($value) . ' (otherwise adjust credit_rate in config.php). Existing orders keep their currency.';
        } elseif ($name === 'low_balance') {
            $text = (float) $value > 0
                ? '🪫 Alert linked customers when their balance drops below <b>' . self::e(number_format((float) $value, 2)) . '</b>?'
                : '🪫 Turn low-balance alerts off?';
        } elseif ($name === 'report_hour') {
            $text = (int) $value >= 0 ? '📊 Send the daily report at <b>' . sprintf('%02d:00', (int) $value) . '</b> (server time)?' : '📊 Turn the daily report off?';
        } elseif ($name === 'theme') {
            $text = '🎨 Switch the payment website to <b>' . self::e(Settings::THEMES[$value]) . '</b>?';
        } elseif ($name === 'bank_instructions') {
            $text = $value !== '' ? "🏦 Offer bank transfer with these details?\n\n" . self::e($value) : '🏦 Turn bank transfer off?';
        } else {
            $label = $name === 'min_amount' ? 'minimum' : 'maximum';
            $text = '✏️ Change the ' . $label . ' top-up from <b>' . self::e($payments->money($pay[$name])) . '</b> to <b>'
                . self::e($payments->money($value)) . '</b>?';
        }
        $this->askConfirm($chatId, $text, ['type' => 'setting', 'name' => $name, 'value' => $value]);
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
            case 'adm_setting':
                $this->askSettingChange($chatId, (string) $data['name'], $text);
                return;
            case 'adm_new_user':
            case 'adm_new_pass':
            case 'adm_new_email':
                $this->newCustomerStep($chatId, $session, $text);
                return;
            case 'adm_invite':
                $this->clearSession($chatId);
                $this->sendInvite($chatId, $text);
                return;
            case 'adm_msg_user':
                $this->askMessageText($chatId, ['audience' => 'user', 'username' => trim($text)]);
                return;
            case 'adm_msg_text':
                $this->askMessageConfirm($chatId, $data, $text);
                return;
            default:
                $this->onAdminTextExtra($chatId, $session, $text);
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

    // ------------------------------------------------- customers & messages

    private function acceptInvite(string $chatId, string $token, bool $admin): void
    {
        $username = $this->app->customers()->redeemInvite($token, $chatId);
        if ($username === null) {
            $this->say($chatId, 'This invite link is not valid any more (it can be used once, within 7 days). Ask us for a new one.');
            return;
        }
        $this->say($chatId, '✅ Your Telegram is now linked to account <code>' . self::e($username) . "</code>.\nYou will get a message here whenever credit is added.");
        $this->sendWelcome($chatId, $admin);
        $this->sendMyAccount($chatId);
        $this->notifyOtherAdmins('', '🔗 Account <code>' . self::e($username) . '</code> was linked to Telegram ' . self::e($this->actor));
    }

    private function sendMyAccount(string $chatId): void
    {
        $username = $this->app->customers()->linkedUsername($chatId);
        if ($username === null) {
            $this->say($chatId, 'Your Telegram is not linked to an account yet. Ask us for an invite link, or tap <b>' . self::e(self::MENU_TOPUP) . '</b> to top up any account.');
            return;
        }
        $user = $this->payments()->lookupUser($username);
        if ($user === null) {
            $this->say($chatId, 'The linked account <code>' . self::e($username) . '</code> was not found. Please contact support.');
            return;
        }
        $lines = [
            '👤 <b>Your account</b> <code>' . self::e((string) $user['username']) . '</code>',
            'Balance: <b>' . self::e(number_format((float) ($user['credit'] ?? 0), 2)) . '</b>',
        ];
        try {
            foreach (array_slice($this->app->magnus()->sipAccountsForUser((int) $user['id']), 0, 5) as $sip) {
                $lines[] = 'SIP <code>' . self::e((string) $sip['name']) . '</code> · caller ID <code>' . self::e((string) ($sip['callerid'] ?? '-')) . '</code>';
            }
        } catch (\Throwable $e) {
        }
        $orders = $this->payments()->ordersForUsername((string) $user['username'], 3);
        if ($orders !== []) {
            $lines[] = '';
            $lines[] = '<b>Latest top-ups</b>';
            foreach ($orders as $order) {
                $lines[] = $this->orderLine($order);
            }
        }
        $keyboard = [];
        if (strlen((string) $user['username']) <= 56) {
            $keyboard[] = [['text' => '💳 Top up this account', 'callback_data' => 'usr:' . $user['username']]];
        }
        $keyboard[] = [['text' => '📞 My calls', 'callback_data' => 'calls'], ['text' => '🆘 Support', 'callback_data' => 'sup']];
        $keyboard[] = [['text' => '🔌 Unlink this Telegram', 'callback_data' => 'unlink']];
        $this->say($chatId, implode("\n", $lines), ['reply_markup' => ['inline_keyboard' => $keyboard]]);
    }

    private function sendCustomersMenu(string $chatId): void
    {
        $counts = $this->app->customers()->counts();
        $this->say(
            $chatId,
            "👥 <b>Customers</b>\nLinked to Telegram: " . $counts['linked'] . "\nPeople who used the bot: " . $counts['users'],
            ['reply_markup' => ['inline_keyboard' => [
                [['text' => '➕ New customer', 'callback_data' => 'adm:new'], ['text' => '🔗 Telegram invite', 'callback_data' => 'adm:inv']],
                [['text' => '📇 Linked customers', 'callback_data' => 'adm:linked'], ['text' => '👤 Account', 'callback_data' => 'adm:account']],
                [['text' => '« Admin panel', 'callback_data' => 'adm:panel']],
            ]]]
        );
    }

    /**
     * New customer wizard: username -> password -> email -> plan -> confirm.
     *
     * @param array{state:string, data:array<string,mixed>} $session
     * @param string|null $input typed text, or null for the "automatic" / "generate" / "skip" buttons
     */
    private function newCustomerStep(string $chatId, array $session, ?string $input): void
    {
        $tools = $this->app->adminTools();
        $data = $session['data'];
        switch ($session['state']) {
            case 'adm_new_user':
                if ($input !== null) {
                    $username = $tools->normalizeNewUsername($input);
                    if ($this->payments()->lookupUser($username) !== null) {
                        throw new UserError('username_in_use', 'Username ' . $username . ' already exists. Send another one, or tap Automatic.');
                    }
                    $data['username'] = $username;
                } else {
                    $data['username'] = '';
                }
                $this->setSession($chatId, 'adm_new_pass', $data);
                $this->say($chatId, "🔑 <b>New customer</b> (2/4)\nSend a <b>password</b> (6–30 characters, no spaces), or let MagnusBilling generate one. It is also the SIP password.", ['reply_markup' => ['inline_keyboard' => [
                    [['text' => '🎲 Generate password', 'callback_data' => 'adm:newgen']],
                    [['text' => 'Cancel', 'callback_data' => 'cancel']],
                ]]]);
                return;

            case 'adm_new_pass':
                $data['password'] = $input !== null ? $tools->normalizeNewPassword($input) : '';
                $this->setSession($chatId, 'adm_new_email', $data);
                $this->say($chatId, "✉️ <b>New customer</b> (3/4)\nSend the customer's <b>email</b>. MagnusBilling uses it for receipts and, by default, needs it to be unique.", ['reply_markup' => ['inline_keyboard' => [
                    [['text' => 'Skip', 'callback_data' => 'adm:newskip']],
                    [['text' => 'Cancel', 'callback_data' => 'cancel']],
                ]]]);
                return;

            case 'adm_new_email':
                $data['email'] = $input !== null ? $tools->normalizeEmail($input) : '';
                try {
                    $plans = $this->app->magnus()->plans();
                } catch (\Throwable $e) {
                    $plans = [];
                }
                $plans = array_values(array_filter($plans, static function ($plan): bool {
                    return isset($plan['id'], $plan['name']);
                }));
                if (count($plans) < 2) {
                    $this->clearSession($chatId);
                    $this->confirmNewCustomer($chatId, $data + ['plan' => 0, 'plan_name' => '']);
                    return;
                }
                $data['plans'] = array_map(static function (array $plan): array {
                    return ['id' => (int) $plan['id'], 'name' => (string) $plan['name']];
                }, array_slice($plans, 0, 10));
                $this->setSession($chatId, 'adm_new_plan', $data);
                $buttons = [];
                foreach ($data['plans'] as $plan) {
                    $buttons[] = [['text' => '📦 ' . $plan['name'], 'callback_data' => 'adm:newplan:' . $plan['id']]];
                }
                $buttons[] = [['text' => 'Default plan', 'callback_data' => 'adm:newplan:0']];
                $buttons[] = [['text' => 'Cancel', 'callback_data' => 'cancel']];
                $this->say($chatId, "📦 <b>New customer</b> (4/4)\nWhich <b>plan</b>?", ['reply_markup' => ['inline_keyboard' => $buttons]]);
                return;
        }
    }

    private function confirmNewCustomer(string $chatId, array $data): void
    {
        $this->askConfirm($chatId, implode("\n", [
            '👤 <b>Create this customer in MagnusBilling?</b>',
            'Username: ' . ($data['username'] !== '' ? '<code>' . self::e((string) $data['username']) . '</code>' : '<i>automatic</i>'),
            'Password: ' . ($data['password'] !== '' ? '<code>' . self::e((string) $data['password']) . '</code>' : '<i>generated</i>'),
            'Email: ' . ($data['email'] !== '' ? self::e((string) $data['email']) : '<i>none</i>'),
            'Plan: ' . (!empty($data['plan']) ? self::e((string) $data['plan_name']) : '<i>default</i>'),
            'A SIP account with the same username and password is created too.',
        ]), [
            'type' => 'create_user',
            'username' => (string) $data['username'],
            'password' => (string) $data['password'],
            'email' => (string) $data['email'],
            'plan' => (int) ($data['plan'] ?? 0),
            'plan_name' => (string) ($data['plan_name'] ?? ''),
        ]);
    }

    private function sendInvite(string $chatId, string $username): void
    {
        $payments = $this->payments();
        $user = $payments->lookupUser($payments->normalizeUsername($username));
        if ($user === null) {
            $this->say($chatId, 'No account found with username <code>' . self::e($username) . '</code>.');
            return;
        }
        $name = (string) $user['username'];
        $link = $this->app->customers()->inviteLink($this->app->customers()->createInvite($name, $this->actor));
        $this->say(
            $chatId,
            '🔗 <b>Telegram invite for</b> <code>' . self::e($name) . "</code>\nSend this link to the customer. It works once, within 7 days:\n" . self::e($link),
            ['reply_markup' => ['inline_keyboard' => [[['text' => '📤 Share invite', 'url' => $this->shareUrl($link)]]]]]
        );
    }

    private function sendLinkedCustomers(string $chatId): void
    {
        $rows = $this->app->customers()->linked(20);
        if ($rows === []) {
            $this->say($chatId, 'No customer has linked Telegram yet. Use 🔗 Telegram invite to send them a link.');
            return;
        }
        $lines = ['📇 <b>Linked customers</b>'];
        $buttons = [];
        foreach ($rows as $row) {
            $who = !empty($row['tg_username']) ? '@' . $row['tg_username'] : (string) ($row['first_name'] ?? 'Telegram user');
            $lines[] = '<code>' . self::e((string) $row['magnus_username']) . '</code> · ' . self::e($who)
                . ($row['blocked'] ? ' · blocked the bot' : '') . ' · ' . date('d M', (int) $row['linked_at']);
            if (count($buttons) < 8 && strlen((string) $row['magnus_username']) <= 50) {
                $buttons[] = [['text' => '✉️ ' . $row['magnus_username'], 'callback_data' => 'adm:msgu:' . $row['magnus_username']]];
            }
        }
        $buttons[] = [['text' => '« Customers', 'callback_data' => 'adm:cust']];
        $this->say($chatId, implode("\n", $lines), ['reply_markup' => ['inline_keyboard' => $buttons]]);
    }

    /**
     * @param array<string,mixed> $target audience ('user' with username, 'linked' or 'all')
     */
    private function askMessageText(string $chatId, array $target): void
    {
        $customers = $this->app->customers();
        if ($target['audience'] === 'user') {
            $username = (string) $target['username'];
            $count = count($customers->chatsForUsername($username));
            if ($count === 0) {
                $this->clearSession($chatId);
                $this->say($chatId, 'Account <code>' . self::e($username) . '</code> is not linked to Telegram. Send them an invite first.', strlen($username) <= 50
                    ? ['reply_markup' => ['inline_keyboard' => [[['text' => '🔗 Telegram invite', 'callback_data' => 'adm:inv:' . $username]]]]]
                    : []);
                return;
            }
            $who = 'account <code>' . self::e($username) . '</code>';
        } else {
            $count = count($customers->audience((string) $target['audience']));
            $who = $target['audience'] === 'linked' ? 'all linked customers' : 'everyone who used the bot';
            if ($count === 0) {
                $this->clearSession($chatId);
                $this->say($chatId, 'Nobody to send to yet.');
                return;
            }
        }
        $this->setSession($chatId, 'adm_msg_text', $target);
        $this->say($chatId, '✍️ Type the message for ' . $who . ' (' . $count . ' chat' . ($count === 1 ? '' : 's') . ').', $this->cancelKeyboard());
    }

    private function askMessageConfirm(string $chatId, array $target, string $text): void
    {
        $text = trim($text);
        $length = function_exists('mb_strlen') ? mb_strlen($text) : strlen($text);
        if ($text === '' || $length > self::MESSAGE_MAX) {
            throw new UserError('invalid_message', 'The message must be 1 to ' . self::MESSAGE_MAX . ' characters.');
        }
        $customers = $this->app->customers();
        $count = $target['audience'] === 'user'
            ? count($customers->chatsForUsername((string) $target['username']))
            : count($customers->audience((string) $target['audience']));
        $this->askConfirm(
            $chatId,
            '📣 <b>Send this to ' . $count . ' chat' . ($count === 1 ? '' : 's') . "?</b>\n\n" . $this->formatNotification($text),
            ['type' => 'notify', 'audience' => (string) $target['audience'], 'username' => (string) ($target['username'] ?? ''), 'text' => $text]
        );
    }

    private function formatNotification(string $text): string
    {
        return '📣 <b>' . self::e((string) $this->app->config['site']['name']) . "</b>\n\n" . self::e($text);
    }

    /**
     * @param array<string,mixed> $action confirmed "notify" action
     */
    private function sendNotification(string $chatId, array $action): void
    {
        $customers = $this->app->customers();
        $recipients = $action['audience'] === 'user'
            ? $customers->chatsForUsername((string) $action['username'])
            : $customers->audience((string) $action['audience']);
        @set_time_limit(0);
        if (count($recipients) > 1) {
            $this->say($chatId, '⏳ Sending to ' . count($recipients) . ' chats…');
        }
        $html = $this->formatNotification((string) $action['text']);
        $sent = 0;
        $failed = 0;
        foreach ($recipients as $index => $recipient) {
            if ($index > 0) {
                usleep(40000); // stay under Telegram's ~30 messages per second
            }
            try {
                $this->say($recipient, $html);
                $sent++;
            } catch (\Throwable $e) {
                $failed++;
                if (preg_match('/blocked|deactivated|chat not found|Forbidden/i', $e->getMessage())) {
                    $customers->markBlocked($recipient);
                }
            }
        }
        $this->app->log('info', 'Admin sent a notification', [
            'audience' => $action['audience'], 'username' => $action['username'], 'sent' => $sent, 'failed' => $failed, 'admin' => $this->actor,
        ]);
        $this->say($chatId, '✅ Sent to ' . $sent . ' chat' . ($sent === 1 ? '' : 's')
            . ($failed > 0 ? ' · ' . $failed . ' failed (they blocked the bot or deleted the chat)' : '') . '.');
        $target = $action['audience'] === 'user' ? 'account ' . $action['username'] : ($action['audience'] === 'linked' ? 'linked customers' : 'everyone');
        $this->notifyOtherAdmins($chatId, '📣 ' . self::e($this->actor) . ' sent a message to ' . self::e($target) . ' (' . $sent . ' delivered)');
    }

    private function shareUrl(string $link): string
    {
        return 'https://t.me/share/url?url=' . rawurlencode($link)
            . '&text=' . rawurlencode('Connect your Telegram to your ' . $this->app->config['site']['name'] . ' account');
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
        $amount = $payments->orderMoney($order);
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
        if ($event === 'credited' && $customer !== null) {
            foreach ($this->app->customers()->chatsForUsername((string) $order['username']) as $linkedChat) {
                if ($linkedChat === (string) ($order['tg_chat_id'] ?? '')) {
                    continue;
                }
                try {
                    $this->say($linkedChat, $customer);
                } catch (\Throwable $e) {
                    $this->app->log('warning', 'Linked customer notification failed', ['chat' => $linkedChat, 'error' => $e->getMessage()]);
                }
            }
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
