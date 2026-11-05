<?php

declare(strict_types=1);

/**
 * In-memory fakes for MagnusBilling, OxaPay and Telegram, plugged in through Gateway\Http::setTransport().
 * The MagnusBilling fake verifies signatures exactly like MagnusBilling's ApiAccess component.
 */
final class FakeServices
{
    public const MAGNUS_URL = 'http://magnus.test/mbilling';
    public const MAGNUS_KEY = 'test-api-key-123456';
    public const MAGNUS_SECRET = 'test-api-secret-abcdef';
    public const OXAPAY_KEY = 'OXA-MERCHANT-KEY-TEST';

    /** @var array<int,array<string,mixed>> */
    public $users = [
        7 => ['id' => 7, 'username' => 'alice', 'credit' => 1.5],
        8 => ['id' => 8, 'username' => '100234', 'credit' => 0],
    ];
    /** @var array<int,array<string,mixed>> */
    public $refills = [];
    /** @var array<int,array<string,mixed>> */
    public $sips = [
        21 => ['id' => 21, 'id_user' => 7, 'name' => 'alice', 'callerid' => '15550001', 'cid_number' => '15550001', 'idUserusername' => 'alice'],
        22 => ['id' => 22, 'id_user' => 7, 'name' => 'alice2', 'callerid' => '15550002', 'cid_number' => '15550002', 'idUserusername' => 'alice'],
        23 => ['id' => 23, 'id_user' => 8, 'name' => '100234', 'callerid' => '100234', 'cid_number' => '100234', 'idUserusername' => '100234'],
    ];
    /** Permissions of the API key, like pkg_api.action. */
    public $apiActions = 'cru';
    /** @var array<string,array<string,mixed>> */
    public $invoices = [];
    /** @var array<int,array<string,mixed>> */
    public $telegram = [];
    /** @var array<int,array<string,mixed>> */
    public $magnusCalls = [];

    /** Requests MagnusBilling's SqlInject filter would have flagged (3 = server IP banned). */
    public $sqlInjectStrikes = 0;

    public $magnusDown = false;
    public $oxapayDown = false;
    /** Simulates a refill that is saved by MagnusBilling but whose reply is lost. */
    public $loseNextRefillReply = false;
    /** Simulates a refill request that times out before MagnusBilling saved anything. */
    public $timeoutBeforeRefill = false;
    /** Simulates a SIP update that is saved but whose reply is lost. */
    public $loseNextSipReply = false;

    private $nextTrack = 100000;

    public function __invoke(string $method, string $url, array $headers, ?string $body): array
    {
        if (strpos($url, self::MAGNUS_URL) === 0) {
            return $this->magnus($url, $headers, (string) $body);
        }
        if (strpos($url, 'https://api.oxapay.test/v1/') === 0) {
            return $this->oxapay($method, substr($url, strlen('https://api.oxapay.test/v1/')), $headers, $body);
        }
        if (strpos($url, 'https://api.telegram.org/bot') === 0) {
            $methodName = substr($url, strrpos($url, '/') + 1);
            $this->telegram[] = ['method' => $methodName, 'params' => json_decode((string) $body, true)];
            return ['status' => 200, 'body' => json_encode(['ok' => true, 'result' => $methodName === 'getMe' ? ['username' => 'test_bot'] : true])];
        }
        throw new RuntimeException('Unexpected request to ' . $url);
    }

    public function oxapayStatus(string $trackId, string $status): void
    {
        $this->invoices[$trackId]['status'] = $status;
    }

    /** Builds a signed OxaPay webhook body for an invoice. */
    public function webhook(string $trackId, string $status, string $key = self::OXAPAY_KEY): array
    {
        $invoice = $this->invoices[$trackId];
        $body = json_encode([
            'track_id' => $trackId,
            'status' => $status,
            'type' => 'invoice',
            'amount' => $invoice['amount'],
            'currency' => $invoice['currency'],
            'order_id' => $invoice['order_id'],
            'date' => time(),
        ]);

        return [$body, hash_hmac('sha512', $body, $key)];
    }

    private static function header(array $headers, string $name): ?string
    {
        foreach ($headers as $line) {
            [$key, $value] = array_map('trim', explode(':', $line, 2));
            if (strcasecmp($key, $name) === 0) {
                return $value;
            }
        }

        return null;
    }

    private function magnus(string $url, array $headers, string $body): array
    {
        if ($this->magnusDown) {
            throw new RuntimeException('Request to magnus.test failed: Connection refused');
        }

        // --- Same check as MagnusBilling's ApiAccess::checkAuthentication()
        parse_str($body, $post);
        if (self::header($headers, 'Key') !== self::MAGNUS_KEY) {
            return ['status' => 200, 'body' => 'invalid API access'];
        }
        $sign = hash_hmac('sha512', http_build_query($post, '', '&'), self::MAGNUS_SECRET);
        if (self::header($headers, 'Sign') !== $sign) {
            return ['status' => 200, 'body' => 'invalid API access'];
        }
        if (empty($post['nonce'])) {
            return ['status' => 200, 'body' => 'missing nonce'];
        }
        $path = substr($url, strlen(self::MAGNUS_URL));
        if ($path !== '/index.php/' . $post['module'] . '/' . $post['action']) {
            return ['status' => 404, 'body' => 'route mismatch'];
        }
        $this->magnusCalls[] = $post;

        // --- Same idea as MagnusBilling's SqlInject::sanitize(): flag and, after 3 hits, ban the caller.
        if ($this->sqlInjectStrikes > 2) {
            return ['status' => 200, 'body' => 'banned'];
        }
        $blocked = ['update ', 'select ', ' set ', ' table ', 'schema', 'concat', 'create ', 'print', 'echo ', 'while',
            'eval', 'assert', 'unlink', 'mkdir', 'copy', 'rename', 'prepare', 'alert', 'src=', '<img', 'console'];
        $scan = [];
        array_walk_recursive($post, function ($value) use (&$scan) { $scan[] = (string) $value; });
        if (isset($post['filter'])) {
            $decoded = json_decode((string) $post['filter'], true);
            array_walk_recursive($decoded, function ($value) use (&$scan) { $scan[] = (string) $value; });
        }
        foreach ($scan as $value) {
            foreach ($blocked as $word) {
                if (strpos(strtolower($value), $word) !== false || strlen($value) > 1000) {
                    $this->sqlInjectStrikes++;
                    return self::json(['rows' => [], 'count' => 0, 'success' => false, 'errors' => 'Invalid request parameters.']);
                }
            }
        }

        $filters = isset($post['filter']) ? json_decode((string) $post['filter'], true) : [];

        $needed = $post['action'] === 'read' ? 'r' : ((string) ($post['id'] ?? '0') === '0' ? 'c' : 'u');
        if (strpos($this->apiActions, $needed) === false) {
            return ['status' => 200, 'body' => 'invalid API action'];
        }

        if ($post['module'] === 'sip' && $post['action'] === 'read') {
            $rows = array_values(array_filter($this->sips, static function ($sip) use ($filters) {
                foreach ((array) $filters as $f) {
                    if ($f['field'] === 'name' && strcasecmp((string) $sip['name'], (string) $f['value']) !== 0) {
                        return false;
                    }
                    if ($f['field'] === 'id_user' && $f['type'] === 'numeric' && (int) $sip['id_user'] !== (int) $f['value']) {
                        return false;
                    }
                }
                return true;
            }));
            return self::json(['rows' => $rows, 'count' => count($rows)]);
        }

        if ($post['module'] === 'sip' && $post['action'] === 'save' && (int) $post['id'] > 0) {
            if (!isset($this->sips[(int) $post['id']])) {
                return self::json(['success' => false, 'msg' => 'Record not found.']);
            }
            // SipController::beforeSave copies callerid to cid_number.
            $this->sips[(int) $post['id']]['callerid'] = $post['callerid'];
            $this->sips[(int) $post['id']]['cid_number'] = $post['callerid'];
            if ($this->loseNextSipReply) {
                $this->loseNextSipReply = false;
                throw new RuntimeException('Request to magnus.test failed: Operation timed out after 120000 milliseconds with 0 bytes received');
            }
            return self::json(['success' => true, 'rows' => [$this->sips[(int) $post['id']]], 'msg' => 'Operation was successful.']);
        }

        if ($post['module'] === 'user' && $post['action'] === 'read') {
            $rows = array_values(array_filter($this->users, static function ($user) use ($filters) {
                foreach ((array) $filters as $f) {
                    if ($f['field'] === 'username' && $f['comparison'] === 'eq' && strcasecmp((string) $user['username'], (string) $f['value']) !== 0) {
                        return false;
                    }
                }
                return true;
            }));
            return self::json(['rows' => array_slice($rows, 0, (int) $post['limit']), 'count' => count($rows)]);
        }

        if ($post['module'] === 'refill' && $post['action'] === 'read') {
            $rows = array_values(array_filter($this->refills, static function ($refill) use ($filters) {
                foreach ((array) $filters as $f) {
                    if ($f['field'] === 'description' && $f['comparison'] === 'ct' && stripos($refill['description'], (string) $f['value']) === false) {
                        return false;
                    }
                }
                return true;
            }));
            return self::json(['rows' => $rows, 'count' => count($rows)]);
        }

        if ($post['module'] === 'refill' && $post['action'] === 'save' && (string) $post['id'] === '0') {
            if ($this->timeoutBeforeRefill) {
                $this->timeoutBeforeRefill = false;
                throw new RuntimeException('Request to magnus.test failed: Operation timed out after 120000 milliseconds with 0 bytes received');
            }
            $userId = (int) $post['id_user'];
            if (!isset($this->users[$userId])) {
                return self::json(['success' => false, 'rows' => [], 'errors' => 'id_user invalid']);
            }
            $old = $this->users[$userId]['credit'];
            $this->users[$userId]['credit'] = round($old + (float) $post['credit'], 4);
            $refill = [
                'id' => count($this->refills) + 1,
                'id_user' => $userId,
                'credit' => (float) $post['credit'],
                'description' => $post['description'] . ', Old credit ' . round($old, 2),
                'payment' => (int) $post['payment'],
            ];
            $this->refills[] = $refill;
            if ($this->loseNextRefillReply) {
                $this->loseNextRefillReply = false;
                throw new RuntimeException('Request to magnus.test failed: Operation timed out');
            }
            return self::json(['success' => true, 'rows' => [$refill], 'msg' => 'Operation was successful.']);
        }

        return self::json(['success' => false, 'errors' => 'unsupported in fake']);
    }

    private function oxapay(string $method, string $path, array $headers, ?string $body): array
    {
        if ($this->oxapayDown) {
            return ['status' => 503, 'body' => json_encode(['status' => 503, 'message' => 'Service unavailable', 'error' => ['message' => 'maintenance']])];
        }
        if (self::header($headers, 'merchant_api_key') !== self::OXAPAY_KEY) {
            return ['status' => 401, 'body' => json_encode(['status' => 401, 'message' => 'Invalid merchant API key', 'error' => []])];
        }

        if ($method === 'POST' && $path === 'payment/invoice') {
            $data = json_decode((string) $body, true);
            foreach (['amount', 'currency', 'callback_url', 'return_url', 'order_id'] as $required) {
                if (!isset($data[$required])) {
                    return ['status' => 400, 'body' => json_encode(['status' => 400, 'message' => "missing {$required}"])];
                }
            }
            $track = (string) $this->nextTrack++;
            $this->invoices[$track] = $data + ['status' => 'Waiting', 'track_id' => $track];
            return self::json(['data' => [
                'track_id' => $track,
                'payment_url' => 'https://pay.oxapay.com/123/' . $track,
                'expired_at' => time() + 3600,
                'date' => time(),
            ], 'message' => 'Operation completed successfully!', 'error' => new stdClass(), 'status' => 200, 'version' => '1.0.0']);
        }

        if ($method === 'GET' && strpos($path, 'payment/') === 0) {
            $track = substr($path, 8);
            if (!isset($this->invoices[$track])) {
                return ['status' => 404, 'body' => json_encode(['status' => 404, 'message' => 'Not found'])];
            }
            $invoice = $this->invoices[$track];
            return self::json(['data' => [
                'track_id' => $track,
                'type' => 'invoice',
                'amount' => $invoice['amount'],
                'currency' => $invoice['currency'],
                'status' => strtolower($invoice['status']),
                'order_id' => $invoice['order_id'],
            ], 'message' => 'ok', 'status' => 200]);
        }

        return ['status' => 404, 'body' => json_encode(['status' => 404, 'message' => 'Not found'])];
    }

    private static function json(array $data): array
    {
        return ['status' => 200, 'body' => json_encode($data)];
    }
}
