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

// Answer Telegram right away, then do the work. Saving in MagnusBilling can take a while (it emails the
// customer first), and Telegram re-sends updates it thinks went unanswered.
ignore_user_abort(true);
@set_time_limit(300);
if (function_exists('apache_setenv')) {
    @apache_setenv('no-gzip', '1');
}
http_response_code(200);
header('Content-Type: text/plain');
header('Content-Length: 2');
header('Connection: close');
echo 'ok';
if (function_exists('fastcgi_finish_request')) {
    fastcgi_finish_request();
} else {
    while (ob_get_level() > 0) {
        @ob_end_flush();
    }
    flush();
}

if (is_array($update)) {
    $app->bot()->handleUpdate($update);
}
