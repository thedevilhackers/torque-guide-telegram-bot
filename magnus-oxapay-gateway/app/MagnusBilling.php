<?php

declare(strict_types=1);

namespace Gateway;

/**
 * MagnusBilling REST API client.
 *
 * Signing matches MagnusBilling's ApiAccess component: the POST body is built with
 * http_build_query() and signed with HMAC-SHA512 using the API secret, sent in the
 * "Key" and "Sign" headers. Endpoint: {url}/index.php/{module}/{action}.
 */
final class MagnusBilling
{
    /** @var string */
    private $url;
    /** @var string */
    private $key;
    /** @var string */
    private $secret;
    /** @var bool */
    private $verifySsl;

    public function __construct(array $config)
    {
        $this->url = rtrim((string) ($config['url'] ?? ''), '/');
        $this->key = (string) ($config['api_key'] ?? '');
        $this->secret = (string) ($config['api_secret'] ?? '');
        $this->verifySsl = (bool) ($config['verify_ssl'] ?? true);
    }

    /**
     * @return array<string,mixed>
     */
    public function call(string $module, string $action, array $params = []): array
    {
        if ($this->url === '' || $this->key === '' || $this->secret === '') {
            throw new \RuntimeException('MagnusBilling API is not configured (magnus.url, magnus.api_key, magnus.api_secret).');
        }

        $request = array_merge(['module' => $module, 'action' => $action], $params);
        $mt = explode(' ', microtime());
        $request['nonce'] = $mt[1] . substr($mt[0], 2, 6);

        $body = http_build_query($request, '', '&');
        $sign = hash_hmac('sha512', $body, $this->secret);

        $response = Http::request(
            'POST',
            $this->url . '/index.php/' . rawurlencode($module) . '/' . rawurlencode($action),
            [
                'Key: ' . $this->key,
                'Sign: ' . $sign,
                'Content-Type: application/x-www-form-urlencoded',
                'Accept: application/json',
            ],
            $body,
            25,
            $this->verifySsl
        );

        $data = json_decode($response['body'], true);
        if (!is_array($data)) {
            // MagnusBilling answers auth problems with plain text such as "invalid API access" or "invalid IP".
            $text = trim((string) preg_replace('/\s+/', ' ', strip_tags($response['body'])));
            throw new \RuntimeException(
                'MagnusBilling API error (HTTP ' . $response['status'] . '): ' . ($text === '' ? 'empty response' : substr($text, 0, 200))
            );
        }

        return $data;
    }

    /**
     * @param array<int,array<string,mixed>> $filters
     * @return array<int,array<string,mixed>>
     */
    public function read(string $module, array $filters = [], int $limit = 25): array
    {
        $result = $this->call($module, 'read', [
            'page' => 1,
            'start' => 0,
            'limit' => $limit,
            'filter' => json_encode($filters),
        ]);

        if (!isset($result['rows']) || !is_array($result['rows'])) {
            throw new \RuntimeException('MagnusBilling API error: ' . self::message($result, 'unexpected read response'));
        }

        return $result['rows'];
    }

    /**
     * Exact username lookup. Returns the user row (id, username, credit, ...) or null.
     *
     * @return array<string,mixed>|null
     */
    public function findUser(string $username): ?array
    {
        $rows = $this->read('user', [[
            'type' => 'string',
            'field' => 'username',
            'value' => $username,
            'comparison' => 'eq',
        ]], 5);

        foreach ($rows as $row) {
            if ((string) ($row['username'] ?? '') === $username) {
                return $row;
            }
        }
        foreach ($rows as $row) {
            if (strcasecmp((string) ($row['username'] ?? ''), $username) === 0) {
                return $row;
            }
        }

        return null;
    }

    /**
     * Looks for a refill whose description mentions $marker (our order id).
     * Used to stay idempotent if a previous credit attempt succeeded but its reply was lost.
     *
     * @return array<string,mixed>|null
     */
    public function findRefillContaining(string $marker): ?array
    {
        $rows = $this->read('refill', [[
            'type' => 'string',
            'field' => 'description',
            'value' => $marker,
            'comparison' => 'ct',
        ]], 5);

        foreach ($rows as $row) {
            if (stripos((string) ($row['description'] ?? ''), $marker) !== false) {
                return $row;
            }
        }

        return null;
    }

    /**
     * Creates a refill. MagnusBilling's RefillController adds the credit to the user's balance.
     *
     * @return array<string,mixed> the created refill row
     */
    public function addCredit(int $userId, string $credit, string $description): array
    {
        $result = $this->call('refill', 'save', [
            'id' => 0,
            'id_user' => $userId,
            'credit' => $credit,
            'description' => $description,
            'payment' => 1,
        ]);

        if (empty($result['success'])) {
            throw new \RuntimeException('MagnusBilling refused the refill: ' . self::message($result, 'unknown error'));
        }

        $rows = $result['rows'] ?? [];
        if (is_array($rows) && isset($rows[0]) && is_array($rows[0])) {
            return $rows[0];
        }

        return is_array($rows) ? $rows : [];
    }

    private static function message(array $result, string $fallback): string
    {
        foreach (['errors', 'msg', 'message'] as $key) {
            if (!empty($result[$key])) {
                $value = $result[$key];
                return is_string($value) ? $value : (string) json_encode($value);
            }
        }

        return $fallback;
    }
}
