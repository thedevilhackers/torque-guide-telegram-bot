<?php

/**
 * Admin command line.
 *
 *   php bin/cli.php check                 test MagnusBilling, OxaPay, Telegram and the database
 *   php bin/cli.php secret                print a random key (API key / Telegram webhook secret)
 *   php bin/cli.php orders [n]            list the latest orders
 *   php bin/cli.php order <id>            show one order
 *   php bin/cli.php retry <id>            re-check with OxaPay, or force a credit retry for paid orders
 *   php bin/cli.php telegram:webhook      register {base_url}/telegram.php with Telegram
 *   php bin/cli.php telegram:poll         run the bot with long polling (no public URL needed, for testing)
 */

declare(strict_types=1);

use Gateway\App;
use Gateway\Payments;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../app/bootstrap.php';

$command = $argv[1] ?? 'help';
$arg = $argv[2] ?? null;

function line(string $text = ''): void
{
    echo $text, PHP_EOL;
}

function usage(): void
{
    line('Usage: php bin/cli.php <command>');
    line('  check              test MagnusBilling, OxaPay, Telegram and the database');
    line('  secret             print a random key (API key / Telegram webhook secret)');
    line('  orders [n]         list the latest orders');
    line('  order <id>         show one order');
    line('  retry <id>         re-check with OxaPay, or force a credit retry for paid orders');
    line('  telegram:webhook   register {base_url}/telegram.php with Telegram');
    line('  telegram:unhook    remove the Telegram webhook');
    line('  telegram:poll      run the bot with long polling (no HTTPS needed)');
}

if (in_array($command, ['help', '--help', '-h'], true)) {
    usage();
    exit(0);
}

if ($command === 'secret') {
    echo bin2hex(random_bytes(24)), PHP_EOL;
    exit(0);
}

// Run as the owner of data/ (www-data) so SQLite files never end up owned by root.
if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
    $owner = @fileowner(GATEWAY_ROOT . '/data');
    $group = @filegroup(GATEWAY_ROOT . '/data');
    if ($owner !== false && $owner !== 0 && $group !== false) {
        posix_setgid($group);
        posix_setuid($owner);
    }
}

try {
    $app = App::load();
} catch (\Throwable $e) {
    fwrite(STDERR, $e->getMessage() . PHP_EOL);
    exit(1);
}


function registerBotCommands(App $app): void
{
    try {
        $app->telegram()->call('setMyCommands', ['commands' => [
            ['command' => 'topup', 'description' => 'Add balance to an account'],
            ['command' => 'status', 'description' => 'Check a payment'],
            ['command' => 'cancel', 'description' => 'Stop the current step'],
            ['command' => 'help', 'description' => 'Show help'],
        ]]);
    } catch (\Throwable $e) {
        line('Note: could not set the bot command menu: ' . $e->getMessage());
    }
}

function printOrder(array $order): void
{
    foreach ($order as $key => $value) {
        line(str_pad((string) $key, 16) . ' ' . ($value === null ? '-' : (string) $value));
    }
}

try {
    switch ($command) {
        case 'check':
            $failed = false;
            $step = static function (string $name, callable $test) use (&$failed): void {
                try {
                    $detail = $test();
                    line("[ OK ] {$name}" . ($detail ? " - {$detail}" : ''));
                } catch (\Throwable $e) {
                    $failed = true;
                    line("[FAIL] {$name} - " . $e->getMessage());
                }
            };
            $step('Database', static function () use ($app) {
                $app->db();
                return explode(':', (string) $app->config['database']['dsn'])[0];
            });
            $step('Public URL', static function () use ($app) {
                $url = $app->baseUrl();
                if ($url === '') {
                    throw new \RuntimeException('site.base_url is empty');
                }
                if (strpos($url, 'https://') !== 0) {
                    return $url . ' (warning: use https in production)';
                }
                return $url;
            });
            $step('MagnusBilling API', static function () use ($app) {
                $rows = $app->magnus()->read('user', [], 1);
                $app->magnus()->read('refill', [], 1);
                return 'user + refill read OK' . (isset($rows[0]['username']) ? ', sample user ' . $rows[0]['username'] : '');
            });
            $step('OxaPay API key', static function () use ($app) {
                $app->oxapay()->acceptedCurrencies();
                return 'accepted';
            });
            if ($app->telegramEnabled()) {
                $step('Telegram bot', static function () use ($app) {
                    $me = $app->telegram()->call('getMe');
                    return '@' . ($me['username'] ?? '?');
                });
            } else {
                line('[SKIP] Telegram (telegram.enabled is false)');
            }
            exit($failed ? 1 : 0);

        case 'orders':
            foreach ($app->payments()->recent((int) ($arg ?? 20)) as $order) {
                line(sprintf(
                    '%s  %s  %-14s %10s  %-13s %-8s %s',
                    date('Y-m-d H:i', (int) $order['created_at']),
                    $order['id'],
                    $order['username'],
                    $app->payments()->money($order['amount']),
                    $order['status'],
                    $order['source'],
                    $order['last_error'] ? '(' . $order['last_error'] . ')' : ''
                ));
            }
            break;

        case 'order':
            $order = $app->payments()->getOrder((string) $arg);
            if ($order === null) {
                throw new \RuntimeException('Order not found.');
            }
            printOrder($order);
            break;

        case 'retry':
            $order = $app->payments()->retry((string) $arg);
            line('Status: ' . $order['status'] . ' (' . Payments::statusLabel((string) $order['status']) . ')');
            if (!empty($order['last_error'])) {
                line('Last error: ' . $order['last_error']);
            }
            break;

        case 'telegram:webhook':
            $secret = (string) $app->config['telegram']['webhook_secret'];
            if ($secret === '' || !preg_match('/^[A-Za-z0-9_-]{16,256}$/', $secret)) {
                throw new \RuntimeException('Set telegram.webhook_secret to 16+ letters/digits (php bin/cli.php secret).');
            }
            $url = $app->baseUrl() . '/telegram.php';
            if (strpos($url, 'https://') !== 0) {
                throw new \RuntimeException('Telegram webhooks need https. Set site.base_url to your https URL, or use telegram:poll.');
            }
            $app->telegram()->call('setWebhook', [
                'url' => $url,
                'secret_token' => $secret,
                'allowed_updates' => ['message', 'callback_query'],
                'drop_pending_updates' => true,
            ]);
            registerBotCommands($app);
            line("Telegram webhook set to {$url}");
            break;

        case 'telegram:unhook':
            $app->telegram()->call('deleteWebhook');
            line('Telegram webhook removed');
            break;

        case 'telegram:poll':
            $tg = $app->telegram();
            $tg->call('deleteWebhook');
            registerBotCommands($app);
            line('Polling Telegram. Press Ctrl+C to stop.');
            $offset = 0;
            while (true) {
                $updates = $tg->call('getUpdates', [
                    'offset' => $offset,
                    'timeout' => 30,
                    'allowed_updates' => ['message', 'callback_query'],
                ], 40);
                foreach ((array) $updates as $update) {
                    $offset = (int) $update['update_id'] + 1;
                    $app->bot()->handleUpdate($update);
                }
            }

        default:
            usage();
            exit(1);
    }
} catch (\Throwable $e) {
    fwrite(STDERR, 'Error: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
