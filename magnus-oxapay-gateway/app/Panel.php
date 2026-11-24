<?php

declare(strict_types=1);

namespace Gateway;

/**
 * The customer-panel add-on: a page shown inside the MagnusBilling panel (through its "Extra" menu slots)
 * with the customer's balance, a crypto top-up, a Connect Telegram button and two-step login.
 *
 * Every action works only on the account of the person logged in to the panel (see MagnusSession).
 */
final class Panel
{
    /** How long a new two-step key waits for its first code. */
    private const SETUP_TTL = 900;

    /** @var App */
    private $app;

    /** @var array{id_user:int, username:string, is_client:bool, is_admin:bool, session_id:string} */
    private $session;

    /** @var MagnusDb */
    private $magnus;

    /** @var array<string,mixed>|null */
    private $user;

    /**
     * @param array{id_user:int, username:string, is_client:bool, is_admin:bool, session_id:string} $session
     */
    public function __construct(App $app, array $session, ?MagnusDb $magnus = null)
    {
        $this->app = $app;
        $this->session = $session;
        $this->magnus = $magnus ?? new MagnusDb($app);
    }

    /**
     * The logged-in account, re-read from MagnusBilling (the session alone is not trusted for the username).
     *
     * @return array<string,mixed>
     */
    public function account(): array
    {
        if ($this->user === null) {
            $user = $this->magnus->user($this->session['id_user']);
            if ($user === null || strcasecmp((string) $user['username'], $this->session['username']) !== 0) {
                throw new UserError('not_logged_in', 'Please log in to the customer panel again.', 401);
            }
            if ((int) ($user['active'] ?? 1) !== 1) {
                throw new UserError('account_disabled', 'This account is disabled. Please contact support.', 403);
            }
            $this->user = $user;
        }

        return $this->user;
    }

    public function username(): string
    {
        return (string) $this->account()['username'];
    }

    public function isAdmin(): bool
    {
        return $this->session['is_admin'];
    }

    /**
     * Token for the page's own requests: tied to this panel login, so other sites cannot use it.
     */
    public function csrfToken(): string
    {
        return hash_hmac('sha256', $this->session['session_id'] . '|' . $this->session['id_user'], $this->secret());
    }

    public function checkCsrf(?string $token): void
    {
        if ($token === null || !hash_equals($this->csrfToken(), $token)) {
            throw new UserError('bad_request', 'This page has expired. Reload it and try again.', 403);
        }
    }

    // ------------------------------------------------------------------ data

    /**
     * @return array<string,mixed> everything the page shows
     */
    public function overview(): array
    {
        $user = $this->account();
        $payments = $this->app->payments();
        $orders = array_map(static function (array $order) use ($payments): array {
            return [
                'id' => (string) $order['id'],
                'amount' => $payments->orderMoney($order),
                'status' => (string) $order['status'],
                'label' => Payments::statusLabel((string) $order['status']),
                'date' => date('j M Y, H:i', (int) $order['created_at']),
            ];
        }, $payments->ordersForUsername((string) $user['username'], 6));

        return [
            'username' => (string) $user['username'],
            'name' => trim((string) ($user['firstname'] ?? '') . ' ' . (string) ($user['lastname'] ?? '')),
            'credit' => number_format((float) ($user['credit'] ?? 0), 2),
            'orders' => $orders,
            'telegram' => [
                'enabled' => $this->telegramEnabled(),
                'bot' => ltrim((string) ($this->app->config['telegram']['bot_username'] ?? ''), '@'),
                'linked' => count($this->app->customers()->chatsForUsername((string) $user['username'])),
            ],
            'two_step' => $this->twoStepOn(),
            'referral' => $this->referral((string) $user['username']),
            'bundles' => $this->bundles((int) $user['id']),
        ];
    }

    /**
     * @return array{for_sale: array<int,array<string,mixed>>, active: array<string,mixed>|null}
     */
    private function bundles(int $userId): array
    {
        try {
            $bundles = new Bundles($this->app, $this->magnus);
            $forSale = $bundles->forSale();

            return ['for_sale' => $forSale, 'active' => $forSale !== [] ? $bundles->active($userId) : null];
        } catch (\Throwable $e) {
            return ['for_sale' => [], 'active' => null]; // no Offers table or none on sale: the section is hidden
        }
    }

    /**
     * Starts paying for a minute bundle for the logged-in account.
     *
     * @return array{order:string, payment_url:string, status_url:string}
     */
    public function buyBundle(int $offerId, string $ip): array
    {
        $this->limit('panel_topup', 10, 600, 'Too many payments started. Please wait a few minutes.');
        $order = (new Bundles($this->app, $this->magnus))->order($this->username(), $offerId, 'panel', ['ip' => $ip]);

        return [
            'order' => (string) $order['id'],
            'payment_url' => (string) ($order['payment_url'] ?? ''),
            'status_url' => $this->app->baseUrl() . '/status.php?order=' . rawurlencode((string) $order['id']),
        ];
    }

    /**
     * @return array<string,mixed>|null the customer's invite link and earnings, if the program is on
     */
    private function referral(string $username): ?array
    {
        $referrals = $this->app->referrals();
        if (!$referrals->enabled()) {
            return null;
        }
        $r = $this->app->config['referral'];
        $percent = static function ($value): string {
            return rtrim(rtrim(number_format((float) $value, 2), '0'), '.') . '%';
        };

        return $referrals->links($username) + $referrals->stats($username) + [
            'percent' => $percent($r['percent']),
            'friend_percent' => $percent($r['friend_percent']),
            'min' => $this->app->payments()->money($r['min_amount']),
        ];
    }

    // ----------------------------------------------------------------- top-up

    /**
     * Creates a crypto payment for the logged-in account.
     *
     * @return array{order:string, payment_url:string, status_url:string}
     */
    public function topup(string $amount, string $promo, string $ip): array
    {
        $this->limit('panel_topup', 10, 600, 'Too many payments started. Please wait a few minutes.');
        $order = $this->app->payments()->createOrder(
            ['username' => $this->username(), 'amount' => $amount, 'promo' => $promo],
            'panel',
            ['ip' => $ip]
        );

        return [
            'order' => (string) $order['id'],
            'payment_url' => (string) ($order['payment_url'] ?? ''),
            'status_url' => $this->app->baseUrl() . '/status.php?order=' . rawurlencode((string) $order['id']),
        ];
    }

    // --------------------------------------------------------------- telegram

    /**
     * One-time link that connects a Telegram chat to the logged-in account.
     *
     * @return array{link:string}
     */
    public function telegramLink(): array
    {
        if (!$this->telegramEnabled()) {
            throw new UserError('telegram_off', 'Telegram is not available right now.', 503);
        }
        $this->limit('panel_tg', 10, 600, 'Too many links created. Please wait a few minutes.');
        $customers = $this->app->customers();
        $token = $customers->createInvite($this->username(), 'panel:' . $this->username());

        return ['link' => $customers->inviteLink($token)];
    }

    private function telegramEnabled(): bool
    {
        $tg = $this->app->config['telegram'];

        return !empty($tg['enabled']) && (string) $tg['bot_token'] !== '' && (string) $tg['bot_username'] !== '';
    }

    // --------------------------------------------------------- two-step login

    public function twoStepOn(): bool
    {
        $user = $this->account();

        return (int) ($user['googleAuthenticator_enable'] ?? 0) > 0 && strlen((string) ($user['google_authenticator_key'] ?? '')) >= 16;
    }

    /**
     * Starts turning two-step login on: a new key, shown as a QR code until the first code confirms it.
     *
     * @return array{secret:string, uri:string}
     */
    public function twoStepStart(): array
    {
        if ($this->twoStepOn()) {
            throw new UserError('two_step_on', 'Two-step login is already on.');
        }
        $this->limit('panel_2fa_start', 10, 600, 'Please wait a few minutes and try again.');
        $secret = Totp::secret();
        $this->app->db()->kvSet($this->setupKey(), (string) json_encode(['secret' => $secret, 'expires' => time() + self::SETUP_TTL]));
        $issuer = (string) $this->app->config['site']['name'];

        return ['secret' => $secret, 'uri' => Totp::uri($secret, $this->username(), $issuer !== '' ? $issuer : 'VoIP')];
    }

    public function twoStepConfirm(string $code): void
    {
        $this->limit('panel_2fa_try', 10, 600, 'Too many attempts. Please wait a few minutes.');
        $pending = json_decode((string) $this->app->db()->kvGet($this->setupKey()), true);
        if (!is_array($pending) || (int) ($pending['expires'] ?? 0) < time() || empty($pending['secret'])) {
            throw new UserError('setup_expired', 'The setup expired. Start again.');
        }
        if (!Totp::verify((string) $pending['secret'], $code)) {
            throw new UserError('invalid_code', 'That code is not right. Check the time on your phone and try the newest code.');
        }
        $this->magnus->setTwoStep($this->session['id_user'], (string) $pending['secret']);
        $this->app->db()->kvSet($this->setupKey(), null);
        $this->user = null;
        $this->app->log('info', 'Customer turned on two-step login in the panel', ['user' => $this->session['username']]);
    }

    public function twoStepDisable(string $code): void
    {
        $this->limit('panel_2fa_try', 10, 600, 'Too many attempts. Please wait a few minutes.');
        if (!$this->twoStepOn()) {
            return;
        }
        if (!Totp::verify((string) $this->account()['google_authenticator_key'], $code)) {
            throw new UserError('invalid_code', 'That code is not right. Enter the current code from your authenticator app.');
        }
        $this->magnus->setTwoStep($this->session['id_user'], '');
        $this->user = null;
        $this->app->log('info', 'Customer turned off two-step login in the panel', ['user' => $this->session['username']]);
    }

    // ---------------------------------------------------------------- helpers

    private function setupKey(): string
    {
        return 'panel2fa:' . $this->session['id_user'];
    }

    private function limit(string $name, int $max, int $window, string $message): void
    {
        if (!$this->app->db()->rateLimit($name . ':' . $this->session['id_user'], $max, $window)) {
            throw new UserError('rate_limited', $message, 429);
        }
    }

    private function secret(): string
    {
        $db = $this->app->db();
        $secret = (string) $db->kvGet('panel:secret');
        if (strlen($secret) < 32) {
            $secret = bin2hex(random_bytes(32));
            $db->kvSet('panel:secret', $secret);
        }

        return $secret;
    }
}
