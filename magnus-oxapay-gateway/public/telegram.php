<?php

/**
 * Telegram webhook endpoint. Register it with:  php bin/cli.php telegram:webhook
 * Telegram sends the configured secret in the X-Telegram-Bot-Api-Secret-Token header.
 */

declare(strict_types=1);

use Gateway\Web;

require __DIR__ . '/../app/bootstrap.php';

$app = Web::boot();

$secret = (string) $app->config['telegram']['webhook_secret'];
$given = (string) Web::header('X-Telegram-Bot-Api-Secret-Token');
if (!$app->telegramEnabled() || $secret === '' || !hash_equals($secret, $given)) {
    http_response_code(403);
    exit('forbidden');
}

$update = json_decode((string) file_get_contents('php://input'), true);
if (is_array($update)) {
    $app->bot()->handleUpdate($update);
}

// Always 200, otherwise Telegram keeps re-sending the same update.
http_response_code(200);
echo 'ok';
