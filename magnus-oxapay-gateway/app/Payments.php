<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Order lifecycle: create OxaPay invoice -> receive webhook -> credit MagnusBilling exactly once.
 *
 * Order statuses:
 *   new           invoice not created yet
 *   pending       waiting for the customer to pay
 *   paying        payment seen on-chain, waiting for confirmations
 *   crediting     paid; credit is being added (lock)
 *   credited      done
 *   credit_failed paid, but MagnusBilling refused or was unreachable (retried automatically)
 *   review        paid, but something did not match; needs an admin (/retry)
 *   expired | underpaid | refunded | failed
 */
final class Payments
{
    /** Statuses from which a confirmed payment may be credited automatically. */
    private const CREDITABLE = ['new', 'pending', 'paying', 'expired', 'underpaid', 'credit_failed'];

    /** Statuses that are still worth re-checking with OxaPay. */
    private const OPEN = ['new', 'pending', 'paying', 'credit_failed'];

    private const LABELS = [
        'new' => 'Waiting for payment',
        'pending' => 'Waiting for payment',
        'paying' => 'Payment detected, waiting for network confirmations',
        'crediting' => 'Payment confirmed, adding credit',
        'credited' => 'Paid, credit added',
        'credit_failed' => 'Payment received, credit is being processed',
        'review' => 'Payment received, under manual review',
        'expired' => 'Invoice expired',
        'underpaid' => 'Underpaid, please contact support',
        'refunded' => 'Refunded',
        'failed' => 'Payment could not be started',
    ];

    /** @var App */
    private $app;

    public function __construct(App $app)
    {
        $this->app = $app;
    }

    // ------------------------------------------------------------------ input

    public function normalizeUsername($raw): string
    {
        $username = trim((string) $raw);
        if ($username === '') {
            throw new UserError('invalid_username', 'Enter your account username.');
        }
        if (!preg_match('/^[A-Za-z0-9_.@+\-]{1,64}$/', $username)) {
            throw new UserError('invalid_username', 'That username contains characters that are not allowed.');
        }

        return $username;
    }

    /**
     * @return string amount with two decimals, e.g. "25.00"
     */
    public function parseAmount($raw): string
    {
        $text = str_replace([',', ' '], ['.', ''], trim((string) $raw));
        if (!preg_match('/^\d{1,9}(\.\d{1,2})?$/', $text)) {
            throw new UserError('invalid_amount', 'Enter an amount such as 25 or 25.50.');
        }
        $amount = round((float) $text, 2);
        $pay = $this->app->config['payments'];
        if ($amount < (float) $pay['min_amount']) {
            throw new UserError('amount_too_low', 'The minimum top-up is ' . $this->money($pay['min_amount']) . '.');
        }
        if ($amount > (float) $pay['max_amount']) {
            throw new UserError('amount_too_high', 'The maximum top-up is ' . $this->money($pay['max_amount']) . '.');
        }

        return number_format($amount, 2, '.', '');
    }

    /**
     * @return array{amount:string, currency:string, bonus_percent:float, credit:string}
     */
    public function quote(string $amount): array
    {
        $pay = $this->app->config['payments'];
        $value = (float) $amount;
        $bonus = 0.0;
        foreach ((array) $pay['bonus'] as $tier) {
            if (is_array($tier) && isset($tier['min'], $tier['percent']) && $value >= (float) $tier['min']) {
                $bonus = max($bonus, (float) $tier['percent']);
            }
        }
        $credit = round($value * (float) $pay['credit_rate'] * (1 + $bonus / 100), 4);

        return [
            'amount' => number_format($value, 2, '.', ''),
            'currency' => (string) $pay['currency'],
            'bonus_percent' => $bonus,
            'credit' => number_format($credit, 4, '.', ''),
        ];
    }

    public function money($amount): string
    {
        $pay = $this->app->config['payments'];
        $symbol = (string) $pay['currency_symbol'];
        $formatted = number_format((float) $amount, 2, '.', ',');

        return $symbol !== '' ? $symbol . $formatted : $formatted . ' ' . $pay['currency'];
    }

    public static function formatCredit($credit): string
    {
        $text = number_format((float) $credit, 4, '.', '');
        $text = rtrim(rtrim($text, '0'), '.');
        if (strpos($text, '.') === false) {
            return $text . '.00';
        }

        return strlen(substr($text, strpos($text, '.') + 1)) < 2 ? $text . '0' : $text;
    }

    /**
     * @return array<string,mixed>|null MagnusBilling user row
     */
    public function lookupUser(string $username): ?array
    {
        try {
            return $this->app->magnus()->findUser($username);
        } catch (\Throwable $e) {
            $this->app->log('error', 'MagnusBilling user lookup failed', ['error' => $e->getMessage()]);
            throw new UserError('billing_unavailable', 'Account lookup is unavailable right now. Please try again shortly.', 503);
        }
    }

    // ----------------------------------------------------------------- create

    /**
     * @param array<string,mixed> $input   username, amount, [email], [reference], [return_url]
     * @param string              $source  web | api | telegram
     * @param array<string,mixed> $options tg_chat_id, ip, trusted (allows reference/return_url)
     * @return array<string,mixed> the stored order
     */
    public function createOrder(array $input, string $source, array $options = []): array
    {
        $username = $this->normalizeUsername($input['username'] ?? '');
        $amount = $this->parseAmount($input['amount'] ?? '');

        $email = trim((string) ($input['email'] ?? ''));
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new UserError('invalid_email', 'Enter a valid email address or leave it empty.');
        }

        $trusted = !empty($options['trusted']);
        $reference = $trusted ? substr(trim((string) ($input['reference'] ?? '')), 0, 100) : '';
        $returnUrl = null;
        if ($trusted && !empty($input['return_url'])) {
            $returnUrl = (string) $input['return_url'];
            $scheme = strtolower((string) parse_url($returnUrl, PHP_URL_SCHEME));
            if (!filter_var($returnUrl, FILTER_VALIDATE_URL) || !in_array($scheme, ['http', 'https'], true) || strlen($returnUrl) > 500) {
                throw new UserError('invalid_return_url', 'return_url must be an absolute http(s) URL.');
            }
        }

        $base = $this->app->baseUrl();
        if ($base === '') {
            throw new \RuntimeException('site.base_url must be set in config.php.');
        }

        $user = $this->lookupUser($username);
        if ($user === null || !isset($user['id'])) {
            throw new UserError('unknown_user', 'No account found with that username.', 404);
        }

        $quote = $this->quote($amount);
        $id = bin2hex(random_bytes(12));
        $now = time();

        $this->app->db()->insert('orders', [
            'id' => $id,
            'username' => (string) $user['username'],
            'magnus_user_id' => (int) $user['id'],
            'amount' => $quote['amount'],
            'currency' => $quote['currency'],
            'credit' => $quote['credit'],
            'bonus_percent' => $quote['bonus_percent'],
            'status' => 'new',
            'source' => $source,
            'tg_chat_id' => isset($options['tg_chat_id']) ? (string) $options['tg_chat_id'] : null,
            'email' => $email !== '' ? $email : null,
            'reference' => $reference !== '' ? $reference : null,
            'return_url' => $returnUrl,
            'ip' => isset($options['ip']) ? substr((string) $options['ip'], 0, 45) : null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $ox = $this->app->config['oxapay'];
        $invoice = [
            'amount' => (float) $quote['amount'],
            'currency' => $quote['currency'],
            'lifetime' => (int) $ox['lifetime'],
            'fee_paid_by_payer' => (int) $ox['fee_paid_by_payer'],
            'under_paid_coverage' => (float) $ox['under_paid_coverage'],
            'mixed_payment' => (bool) $ox['mixed_payment'],
            'callback_url' => $base . '/webhook.php',
            'return_url' => $returnUrl ?? $base . '/status.php?order=' . $id,
            'order_id' => $id,
            'description' => substr($this->app->config['site']['name'] . ' top-up for ' . $user['username'], 0, 250),
            'sandbox' => (bool) $ox['sandbox'],
        ];
        if ($email !== '') {
            $invoice['email'] = $email;
        }
        if ((string) $ox['to_currency'] !== '') {
            $invoice['to_currency'] = (string) $ox['to_currency'];
        }

        try {
            $created = $this->app->oxapay()->createInvoice($invoice);
        } catch (\Throwable $e) {
            $this->transition($id, ['new'], 'failed', ['last_error' => substr($e->getMessage(), 0, 1000)]);
            $this->app->log('error', 'OxaPay invoice creation failed', ['order' => $id, 'error' => $e->getMessage()]);
            throw new UserError('gateway_unavailable', 'The payment gateway is unavailable right now. Please try again in a few minutes.', 502);
        }

        $this->transition($id, ['new'], 'pending', [
            'track_id' => $created['track_id'],
            'payment_url' => $created['payment_url'],
            'expires_at' => $created['expired_at'],
        ]);
        $this->app->log('info', 'Order created', [
            'order' => $id, 'user' => $user['username'], 'amount' => $quote['amount'], 'source' => $source, 'track' => $created['track_id'],
        ]);

        return $this->getOrder($id) ?? [];
    }

    // ----------------------------------------------------------------- lookup

    /**
     * @return array<string,mixed>|null
     */
    public function getOrder(string $id): ?array
    {
        if (!preg_match('/^[a-f0-9]{24}$/', $id)) {
            return null;
        }

        return $this->app->db()->one('SELECT * FROM ' . $this->app->db()->table('orders') . ' WHERE id = ?', [$id]);
    }

    /**
     * @return array<string,mixed>|null
     */
    public function findByTrackId(string $trackId): ?array
    {
        return $this->app->db()->one('SELECT * FROM ' . $this->app->db()->table('orders') . ' WHERE track_id = ?', [$trackId]);
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function recent(int $limit = 10): array
    {
        $limit = max(1, min(100, $limit));

        return $this->app->db()->all('SELECT * FROM ' . $this->app->db()->table('orders') . ' ORDER BY created_at DESC LIMIT ' . $limit);
    }

    /**
     * @return array{count:int, amount:float}
     */
    public function totalsSince(int $since): array
    {
        $row = $this->app->db()->one(
            'SELECT COUNT(*) AS c, COALESCE(SUM(amount), 0) AS s FROM ' . $this->app->db()->table('orders') . " WHERE status = 'credited' AND credited_at >= ?",
            [$since]
        );

        return ['count' => (int) ($row['c'] ?? 0), 'amount' => (float) ($row['s'] ?? 0)];
    }

    /**
     * Customer-safe view of an order.
     *
     * @return array<string,mixed>
     */
    public function publicView(array $order): array
    {
        $status = (string) $order['status'];
        $open = in_array($status, ['new', 'pending', 'paying'], true);

        return [
            'order_id' => (string) $order['id'],
            'username' => (string) $order['username'],
            'amount' => number_format((float) $order['amount'], 2, '.', ''),
            'amount_display' => $this->money($order['amount']),
            'currency' => (string) $order['currency'],
            'credit' => self::formatCredit($order['credit']),
            'bonus_percent' => (float) $order['bonus_percent'],
            'status' => $status,
            'status_label' => self::LABELS[$status] ?? $status,
            'is_final' => in_array($status, ['credited', 'expired', 'refunded', 'failed'], true),
            'payment_url' => $open ? $order['payment_url'] : null,
            'status_url' => $this->app->baseUrl() . '/status.php?order=' . $order['id'],
            'reference' => $order['reference'],
            'created_at' => (int) $order['created_at'],
            'expires_at' => $order['expires_at'] !== null ? (int) $order['expires_at'] : null,
            'credited_at' => $order['credited_at'] !== null ? (int) $order['credited_at'] : null,
        ];
    }

    public static function statusLabel(string $status): string
    {
        return self::LABELS[$status] ?? $status;
    }

    // ------------------------------------------------------------- settlement

    /**
     * Handles an OxaPay webhook.
     *
     * @return array{0:int, 1:string} HTTP status and body. OxaPay retries until it gets 200 "ok".
     */
    public function handleWebhook(string $rawBody, ?string $hmac): array
    {
        if (!$this->app->oxapay()->verifyWebhook($rawBody, $hmac)) {
            $this->app->log('warning', 'Rejected OxaPay webhook with an invalid HMAC');
            return [400, 'invalid hmac'];
        }

        $data = json_decode($rawBody, true);
        if (!is_array($data)) {
            return [400, 'invalid payload'];
        }
        if (strtolower((string) ($data['type'] ?? '')) === 'payout') {
            return [200, 'ok'];
        }

        $order = null;
        if (!empty($data['order_id'])) {
            $order = $this->getOrder((string) $data['order_id']);
        }
        if ($order === null && !empty($data['track_id'])) {
            $order = $this->findByTrackId((string) $data['track_id']);
        }
        if ($order === null) {
            $this->app->log('warning', 'Webhook for an unknown order', ['order' => $data['order_id'] ?? null, 'track' => $data['track_id'] ?? null]);
            return [200, 'ok'];
        }
        if (!empty($data['track_id']) && (string) $order['track_id'] !== (string) $data['track_id']) {
            $this->app->log('warning', 'Webhook track_id does not match the order', ['order' => $order['id'], 'track' => $data['track_id']]);
            return [200, 'ok'];
        }

        try {
            $order = $this->sync($order, $data);
        } catch (\Throwable $e) {
            $this->app->log('error', 'Webhook processing failed', ['order' => $order['id'], 'error' => $e->getMessage()]);
            return [500, 'retry'];
        }

        return $order['status'] === 'credit_failed' ? [500, 'retry'] : [200, 'ok'];
    }

    /**
     * Brings an order up to date with OxaPay. With verify_with_api (default) the status always comes
     * from OxaPay's payment-information endpoint, never from the webhook body alone.
     *
     * @param array<string,mixed>      $order
     * @param array<string,mixed>|null $webhook
     * @return array<string,mixed>
     */
    public function sync(array $order, ?array $webhook = null): array
    {
        if (empty($order['track_id'])) {
            return $order;
        }

        $info = $webhook ?? [];
        if ($webhook === null || !empty($this->app->config['oxapay']['verify_with_api'])) {
            $info = $this->app->oxapay()->paymentInfo((string) $order['track_id']);
        }
        $this->app->db()->run(
            'UPDATE ' . $this->app->db()->table('orders') . ' SET checked_at = ? WHERE id = ?',
            [time(), $order['id']]
        );

        return $this->applyProviderStatus($order, $info);
    }

    /**
     * Re-checks an open order with OxaPay at most every 15 seconds (used by the status page).
     *
     * @return array<string,mixed>
     */
    public function refreshIfStale(array $order): array
    {
        if (!in_array($order['status'], self::OPEN, true) || empty($order['track_id'])) {
            return $order;
        }
        $now = time();
        $claimed = $this->app->db()->run(
            'UPDATE ' . $this->app->db()->table('orders') . ' SET checked_at = ? WHERE id = ? AND (checked_at IS NULL OR checked_at < ?)',
            [$now, $order['id'], $now - 15]
        );
        if ($claimed === 0) {
            return $order;
        }

        try {
            return $this->sync($order);
        } catch (\Throwable $e) {
            $this->app->log('warning', 'Status refresh failed', ['order' => $order['id'], 'error' => $e->getMessage()]);
            return $this->getOrder((string) $order['id']) ?? $order;
        }
    }

    /**
     * @param array<string,mixed> $order
     * @param array<string,mixed> $info OxaPay payment data
     * @return array<string,mixed>
     */
    private function applyProviderStatus(array $order, array $info): array
    {
        $id = (string) $order['id'];
        $status = OxaPay::normalizeStatus($info['status'] ?? '');

        if (!empty($info['order_id']) && (string) $info['order_id'] !== $id) {
            $this->app->log('warning', 'OxaPay order_id does not match', ['order' => $id, 'oxapay_order' => $info['order_id']]);
            return $order;
        }
        if ($status !== '') {
            $this->app->db()->run(
                'UPDATE ' . $this->app->db()->table('orders') . ' SET provider_status = ? WHERE id = ?',
                [substr($status, 0, 30), $id]
            );
        }

        switch ($status) {
            case 'paid':
            case 'manual_accept':
                if (!$this->amountMatches($order, $info)) {
                    if ($this->transition($id, self::CREDITABLE, 'review', ['last_error' => 'Paid amount does not match the order amount.'])) {
                        $this->app->log('error', 'Amount mismatch, order held for review', ['order' => $id, 'oxapay_amount' => $info['amount'] ?? null]);
                        $this->notify('review', $this->getOrder($id) ?? $order);
                    }
                    break;
                }
                return $this->credit($id);

            case 'paying':
            case 'confirming':
                $this->transition($id, ['new', 'pending'], 'paying');
                break;

            case 'expired':
                if ($this->transition($id, ['new', 'pending', 'paying'], 'expired')) {
                    $this->notify('expired', $this->getOrder($id) ?? $order);
                }
                break;

            case 'underpaid':
                if ($this->transition($id, ['new', 'pending', 'paying'], 'underpaid')) {
                    $this->notify('underpaid', $this->getOrder($id) ?? $order);
                }
                break;

            case 'refunding':
            case 'refunded':
                $this->transition($id, ['new', 'pending', 'paying', 'underpaid', 'expired'], 'refunded');
                break;
        }

        return $this->getOrder($id) ?? $order;
    }

    private function amountMatches(array $order, array $info): bool
    {
        if (!isset($info['amount']) || !is_numeric($info['amount'])) {
            return true;
        }
        $currency = strtoupper((string) ($info['currency'] ?? ''));
        if ($currency !== '' && $currency !== strtoupper((string) $order['currency'])) {
            // Different unit (e.g. a crypto amount); the invoice itself is bound to this order by track_id.
            return true;
        }

        return (float) $info['amount'] + 0.009 >= (float) $order['amount'];
    }

    /**
     * Adds the order's credit to MagnusBilling exactly once.
     *
     * @param bool $force also retry orders stuck in "crediting" or held for "review" (admin action)
     * @return array<string,mixed>
     */
    public function credit(string $id, bool $force = false): array
    {
        $before = $this->getOrder($id);
        if ($before === null) {
            throw new \RuntimeException('Order not found.');
        }

        $from = $force ? array_merge(self::CREDITABLE, ['crediting', 'review']) : self::CREDITABLE;
        if (!$this->transition($id, $from, 'crediting')) {
            return $this->getOrder($id) ?? $before;
        }

        $order = $this->getOrder($id) ?? $before;
        $magnus = $this->app->magnus();

        try {
            // If an earlier attempt reached MagnusBilling but its reply was lost, do not add credit twice.
            $refill = $magnus->findRefillContaining($id);
            if ($refill !== null) {
                $this->app->log('warning', 'Refill already present in MagnusBilling, not adding again', ['order' => $id]);
            } else {
                $refill = $magnus->addCredit(
                    (int) $order['magnus_user_id'],
                    self::formatCredit($order['credit']),
                    $this->refillDescription($order)
                );
            }

            $this->transition($id, ['crediting'], 'credited', [
                'refill_id' => isset($refill['id']) ? (string) $refill['id'] : null,
                'credited_at' => time(),
                'last_error' => null,
            ]);
            $order = $this->getOrder($id) ?? $order;
            $this->app->log('info', 'Credit added', ['order' => $id, 'user' => $order['username'], 'credit' => $order['credit']]);
            $this->notify('credited', $order);

            return $order;
        } catch (\Throwable $e) {
            $this->transition($id, ['crediting'], 'credit_failed', ['last_error' => substr($e->getMessage(), 0, 1000)]);
            $this->app->log('error', 'Adding credit failed', ['order' => $id, 'error' => $e->getMessage()]);
            $order = $this->getOrder($id) ?? $order;
            if ($before['status'] !== 'credit_failed') {
                $this->notify('credit_failed', $order);
            }

            return $order;
        }
    }

    /**
     * Admin retry: re-checks OxaPay for open orders, or forces a credit attempt for paid ones.
     *
     * @return array<string,mixed>
     */
    public function retry(string $id): array
    {
        $order = $this->getOrder($id);
        if ($order === null) {
            throw new UserError('not_found', 'Order not found.', 404);
        }
        if (in_array($order['status'], ['crediting', 'credit_failed', 'review'], true)) {
            return $this->credit($id, true);
        }

        return $this->sync($order);
    }

    private function refillDescription(array $order): string
    {
        $template = (string) $this->app->config['payments']['refill_description'];
        if (strpos($template, '{order}') === false) {
            $template .= ' #{order}';
        }

        return substr(strtr($template, [
            '{order}' => (string) $order['id'],
            '{track}' => (string) $order['track_id'],
            '{username}' => (string) $order['username'],
            '{amount}' => number_format((float) $order['amount'], 2, '.', ''),
            '{currency}' => (string) $order['currency'],
        ]), 0, 400);
    }

    /**
     * Moves an order to $to only if it is currently in one of $from. Returns true if it moved.
     */
    private function transition(string $id, array $from, string $to, array $extra = []): bool
    {
        $set = ['status = ?', 'updated_at = ?'];
        $params = [$to, time()];
        foreach ($extra as $column => $value) {
            $set[] = $column . ' = ?';
            $params[] = $value;
        }
        $params[] = $id;
        $params = array_merge($params, $from);

        $sql = 'UPDATE ' . $this->app->db()->table('orders') . ' SET ' . implode(', ', $set)
            . ' WHERE id = ? AND status IN (' . implode(', ', array_fill(0, count($from), '?')) . ')';

        return $this->app->db()->run($sql, $params) > 0;
    }

    private function notify(string $event, array $order): void
    {
        if (!$this->app->telegramEnabled()) {
            return;
        }
        try {
            $this->app->bot()->notify($event, $order);
        } catch (\Throwable $e) {
            $this->app->log('warning', 'Telegram notification failed', ['event' => $event, 'error' => $e->getMessage()]);
        }
    }
}
