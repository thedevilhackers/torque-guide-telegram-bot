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
    /**
     * MagnusBilling's SqlInject filter rejects any request value containing these strings (case-insensitive),
     * logs it as an attack and, after three hits, bans the caller's IP. For this gateway that IP is the
     * server itself, so such values are never sent; see isSafeValue().
     */
    private const MAGNUS_BLOCKED = [
        'update ', 'select ', ' set ', ' table ', 'delete from', ' database ', 'drop table', 'drop database',
        'schema', 'concat', 'foreign_key', 'truncate ', 'create ', 'print', 'echo ', 'while', 'shell_exec',
        'popen', 'proc_open', 'passthru', 'eval', 'assert', 'fopen', 'file_get_contents', 'file_put_contents',
        'unlink', 'mkdir', 'rmdir', 'copy', 'rename', 'curl_exec', 'curl_init', 'fsockopen', 'socket_connect',
        'mysql_query', 'mysqli_query', 'pg_query', 'sqlite_query', 'prepare', 'alert', 'src=', '<img',
        'console', 'extractvalue',
    ];

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
        foreach ($request as $key => $value) {
            $values = $key === 'filter' ? self::filterValues((string) $value) : [(string) $value];
            foreach ($values as $item) {
                if (!self::isSafeValue($item)) {
                    throw new \RuntimeException('Refusing to send a value MagnusBilling would treat as an attack (field "' . $key . '").');
                }
            }
        }
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
        if (!self::isSafeValue($username)) {
            return null;
        }
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

    /**
     * SIP account by its SIP username (pkg_sip.name).
     *
     * @return array<string,mixed>|null
     */
    public function findSip(string $name): ?array
    {
        if (!self::isSafeValue($name)) {
            return null;
        }
        $rows = $this->read('sip', [[
            'type' => 'string',
            'field' => 'name',
            'value' => $name,
            'comparison' => 'eq',
        ]], 5);
        foreach ($rows as $row) {
            if (strcasecmp((string) ($row['name'] ?? ''), $name) === 0) {
                return $row;
            }
        }

        return null;
    }

    /**
     * All SIP accounts that belong to a MagnusBilling user.
     *
     * @return array<int,array<string,mixed>>
     */
    public function sipAccountsForUser(int $userId): array
    {
        return array_values(array_filter($this->read('sip', [[
            'type' => 'numeric',
            'field' => 'id_user',
            'value' => $userId,
            'comparison' => 'eq',
        ]], 50), static function ($row) use ($userId): bool {
            return (int) ($row['id_user'] ?? 0) === $userId;
        }));
    }

    /**
     * Updates fields of one record (needs the "u" permission on the API key).
     *
     * @param array<string,scalar> $fields
     * @return array<string,mixed> the saved record
     */
    public function updateRecord(string $module, int $id, array $fields): array
    {
        if ($id <= 0) {
            throw new \RuntimeException('Invalid record id.');
        }
        $result = $this->call($module, 'save', ['id' => $id] + $fields);
        if (empty($result['success'])) {
            throw new \RuntimeException('MagnusBilling refused the update: ' . self::message($result, 'unknown error'));
        }
        $rows = $result['rows'] ?? [];
        if (is_array($rows) && isset($rows[0]) && is_array($rows[0])) {
            return $rows[0];
        }

        return is_array($rows) ? $rows : [];
    }

    /**
     * True if MagnusBilling's SqlInject filter would accept $value (see MAGNUS_BLOCKED).
     */
    public static function isSafeValue(string $value): bool
    {
        if (strlen($value) > 250) {
            return false;
        }
        $lower = strtolower($value);
        foreach (self::MAGNUS_BLOCKED as $blocked) {
            if (strpos($lower, $blocked) !== false) {
                return false;
            }
        }

        return true;
    }

    /**
     * @return string[] the scalar values inside a JSON filter, as MagnusBilling inspects them
     */
    private static function filterValues(string $json): array
    {
        $decoded = json_decode($json, true);
        if (!is_array($decoded)) {
            return [$json];
        }
        $values = [];
        array_walk_recursive($decoded, static function ($value) use (&$values): void {
            if (is_string($value)) {
                $values[] = $value;
            }
        });

        return $values;
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
