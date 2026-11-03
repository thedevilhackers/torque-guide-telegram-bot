<?php

/**
 * OxaPay callback URL. OxaPay signs the raw body with your merchant API key (HMAC-SHA512, "HMAC" header)
 * and retries until this endpoint answers HTTP 200 "ok".
 */

declare(strict_types=1);

use Gateway\Web;

require __DIR__ . '/../app/bootstrap.php';

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    exit('method not allowed');
}

$app = Web::boot();
$raw = (string) file_get_contents('php://input');

try {
    [$status, $body] = $app->payments()->handleWebhook($raw, Web::header('HMAC'));
} catch (\Throwable $e) {
    $app->log('error', 'Webhook crashed', ['error' => $e->getMessage()]);
    [$status, $body] = [500, 'retry'];
}

http_response_code($status);
header('Content-Type: text/plain; charset=utf-8');
echo $body;
