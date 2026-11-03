<?php

/**
 * JSON API. Every response is {"ok": true, "data": {...}} or {"ok": false, "error": {"code", "message"}}.
 *
 *   GET  api.php?action=config
 *   GET  api.php?action=check_user&username=1001
 *   GET  api.php?action=quote&amount=25
 *   POST api.php?action=create_payment   {"username":"1001","amount":25,"email":"", "reference":"", "return_url":""}
 *   GET  api.php?action=order&order_id=...
 *   GET  api.php?action=user&username=1001          (API key required)
 *
 * Send an API key as "X-Api-Key: <key>" or "Authorization: Bearer <key>" to skip rate limits
 * and to use "reference" / "return_url" on create_payment.
 */

declare(strict_types=1);

use Gateway\UserError;
use Gateway\Web;

require __DIR__ . '/../app/bootstrap.php';

$app = Web::boot(true);
$payments = $app->payments();

// ---- CORS (only for origins listed in api.cors_origins)
$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
$allowedOrigins = (array) $app->config['api']['cors_origins'];
if ($origin !== '' && (in_array('*', $allowedOrigins, true) || in_array($origin, $allowedOrigins, true))) {
    header('Access-Control-Allow-Origin: ' . (in_array('*', $allowedOrigins, true) ? '*' : $origin));
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Content-Type, X-Api-Key, Authorization');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// ---- Authentication (optional)
$apiKey = Web::header('X-Api-Key');
if ($apiKey === null) {
    $auth = (string) Web::header('Authorization');
    if (stripos($auth, 'Bearer ') === 0) {
        $apiKey = trim(substr($auth, 7));
    }
}
$client = null;
if ($apiKey !== null && $apiKey !== '') {
    foreach ((array) $app->config['api']['keys'] as $key => $name) {
        if (strlen((string) $key) >= 16 && hash_equals((string) $key, $apiKey)) {
            $client = (string) $name;
            break;
        }
    }
    if ($client === null) {
        Web::json(['ok' => false, 'error' => ['code' => 'invalid_api_key', 'message' => 'Invalid API key.']], 401);
    }
}

$input = Web::input();
$action = (string) ($input['action'] ?? '');
$ip = Web::clientIp($app);
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

$limit = static function (string $bucket) use ($app, $client, $ip): void {
    if ($client !== null) {
        return;
    }
    $rule = $app->config['api']['rate_limits'][$bucket] ?? null;
    if (!is_array($rule) || count($rule) < 2) {
        return;
    }
    if (!$app->db()->rateLimit($bucket . ':' . $ip, (int) $rule[0], (int) $rule[1])) {
        throw new UserError('rate_limited', 'Too many requests. Please wait a few minutes and try again.', 429);
    }
};

try {
    switch ($action) {
        case 'config':
            Web::json(['ok' => true, 'data' => $app->publicConfig()]);
            break;

        case 'check_user':
            $limit('check_user');
            $username = $payments->normalizeUsername($input['username'] ?? '');
            $user = $payments->lookupUser($username);
            Web::json(['ok' => true, 'data' => [
                'exists' => $user !== null,
                'username' => $user !== null ? (string) $user['username'] : $username,
            ]]);
            break;

        case 'quote':
            Web::json(['ok' => true, 'data' => $payments->quote($payments->parseAmount($input['amount'] ?? ''))]);
            break;

        case 'create_payment':
            if ($method !== 'POST') {
                throw new UserError('method_not_allowed', 'Use POST for create_payment.', 405);
            }
            $limit('create_payment');
            $order = $payments->createOrder($input, $client !== null ? 'api' : 'web', [
                'ip' => $ip,
                'trusted' => $client !== null,
            ]);
            Web::json(['ok' => true, 'data' => $payments->publicView($order)], 201);
            break;

        case 'order':
        case 'order_status':
            $limit('order');
            $order = $payments->getOrder(strtolower((string) ($input['order_id'] ?? '')));
            if ($order === null) {
                throw new UserError('not_found', 'Order not found.', 404);
            }
            Web::json(['ok' => true, 'data' => $payments->publicView($payments->refreshIfStale($order))]);
            break;

        case 'user':
            if ($client === null) {
                throw new UserError('unauthorized', 'An API key is required for this action.', 401);
            }
            $user = $payments->lookupUser($payments->normalizeUsername($input['username'] ?? ''));
            if ($user === null) {
                throw new UserError('unknown_user', 'No account found with that username.', 404);
            }
            Web::json(['ok' => true, 'data' => [
                'username' => (string) $user['username'],
                'credit' => (float) ($user['credit'] ?? 0),
            ]]);
            break;

        default:
            throw new UserError('unknown_action', 'Unknown action. Use config, check_user, quote, create_payment, order or user.', 404);
    }
} catch (UserError $e) {
    Web::json(['ok' => false, 'error' => ['code' => $e->errorCode, 'message' => $e->getMessage()]], $e->httpStatus);
} catch (\Throwable $e) {
    $app->log('error', 'API error', ['action' => $action, 'error' => $e->getMessage()]);
    Web::json(['ok' => false, 'error' => ['code' => 'server_error', 'message' => 'Something went wrong. Please try again later.']], 500);
}
