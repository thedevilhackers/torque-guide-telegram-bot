<?php

/**
 * Helper for install.sh (you normally don't run this yourself).
 *
 *   php bin/setup.php configure    create/verify the MagnusBilling API key, write config.php, print a JSON summary
 *   php bin/setup.php remove-key   delete the API key this installer created in MagnusBilling (uninstall)
 *
 * "configure" reads UC_* environment variables. Empty values keep what config.php already contains,
 * so re-running the installer never loses your edits.
 */

declare(strict_types=1);

use Gateway\MagnusBilling;
use Gateway\Telegram;

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/../app/bootstrap.php';

const KEY_PREFIX = 'ucpay_';

function env(string $name): string
{
    $value = getenv($name);

    return $value === false ? '' : trim($value);
}

function magnusDb(): \PDO
{
    $path = env('UC_MAGNUS_DB_CONFIG') ?: '/etc/asterisk/res_config_mysql.conf';
    if (!is_readable($path)) {
        throw new \RuntimeException("Cannot read {$path} (MagnusBilling database settings).");
    }
    // Read it the way Asterisk does (key = raw value, ";" starts a comment unless escaped), so passwords
    // containing characters such as ! $ " are not mangled the way parse_ini_file() would.
    $ini = [];
    foreach ((array) file($path, FILE_IGNORE_NEW_LINES) as $line) {
        if (preg_match('/^\s*(dbhost|dbname|dbuser|dbpass|dbport)\s*=>?\s*(.*)$/', (string) $line, $m)) {
            $value = trim((string) preg_replace('/(?<!\\\\);.*$/', '', $m[2]));
            $ini[$m[1]] = str_replace('\\;', ';', $value);
        }
    }
    foreach (['dbhost', 'dbname', 'dbuser', 'dbpass'] as $required) {
        if (!is_array($ini) || !array_key_exists($required, $ini)) {
            throw new \RuntimeException("{$path} has no {$required} setting.");
        }
    }
    $dsn = 'mysql:host=' . $ini['dbhost'] . ';dbname=' . $ini['dbname'] . ';charset=utf8';
    if (!empty($ini['dbport'])) {
        $dsn .= ';port=' . (int) $ini['dbport'];
    }

    return new \PDO($dsn, (string) $ini['dbuser'], (string) $ini['dbpass'], [
        \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
        \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
    ]);
}

/**
 * Makes sure config.php holds a working MagnusBilling API key (create + read + update, localhost only).
 * Update is used only by the Telegram admin caller-ID command.
 *
 * @return array{created:bool, admin:string, note:string, upgraded:bool}
 */
function ensureMagnusKey(array &$config): array
{
    $pdo = magnusDb();
    $key = (string) ($config['magnus']['api_key'] ?? '');
    $secret = (string) ($config['magnus']['api_secret'] ?? '');

    if ($key !== '' && $secret !== '') {
        $statement = $pdo->prepare('SELECT id, status, action, api_secret FROM pkg_api WHERE api_key = ?');
        $statement->execute([$key]);
        $row = $statement->fetch();
        if ($row && hash_equals((string) $row['api_secret'], $secret)) {
            $note = '';
            $upgraded = strpos($key, KEY_PREFIX) === 0 && (string) $row['action'] !== 'cru';
            if (strpos($key, KEY_PREFIX) === 0) {
                $pdo->prepare("UPDATE pkg_api SET status = 1, action = 'cru', api_restriction_ips = '127.0.0.1' WHERE id = ?")->execute([$row['id']]);
            } elseif ((int) $row['status'] !== 1 || preg_match('/^(?=.*c)(?=.*r)(?=.*u)/', (string) $row['action']) !== 1) {
                $note = 'Your MagnusBilling API key must be active with create + read + update permission.';
            }
            return ['created' => false, 'admin' => '', 'note' => $note, 'upgraded' => $upgraded];
        }
    }

    $admin = $pdo->query(
        "SELECT u.id, u.username FROM pkg_user u JOIN pkg_group_user g ON g.id = u.id_group
         WHERE g.id_user_type = 1 ORDER BY (u.username = 'root') DESC, u.id ASC LIMIT 1"
    )->fetch();
    if (!$admin) {
        throw new \RuntimeException('No MagnusBilling admin user found.');
    }

    $key = KEY_PREFIX . bin2hex(random_bytes(16));
    $secret = bin2hex(random_bytes(24));
    $pdo->prepare(
        "INSERT INTO pkg_api (id_user, status, api_key, api_secret, api_restriction_ips, action)
         VALUES (?, 1, ?, ?, '127.0.0.1', 'cru')"
    )->execute([(int) $admin['id'], $key, $secret]);

    $config['magnus']['api_key'] = $key;
    $config['magnus']['api_secret'] = $secret;

    return ['created' => true, 'admin' => (string) $admin['username'], 'note' => '', 'upgraded' => false];
}

/**
 * Finds the MagnusBilling URL that answers API calls from this server.
 *
 * @return array{ok:bool, url:string, error:string}
 */
function probeMagnus(array &$config): array
{
    $candidates = array_values(array_unique(array_filter([
        (string) ($config['magnus']['url'] ?? ''),
        'http://127.0.0.1/mbilling',
        'https://127.0.0.1/mbilling',
    ])));
    $errors = [];
    foreach ($candidates as $url) {
        $local = strpos($url, 'https://127.0.0.1') === 0;
        $settings = [
            'url' => $url,
            'api_key' => $config['magnus']['api_key'],
            'api_secret' => $config['magnus']['api_secret'],
            'verify_ssl' => $local ? false : (bool) ($config['magnus']['verify_ssl'] ?? true),
        ];
        try {
            (new MagnusBilling($settings))->read('user', [], 1);
            (new MagnusBilling($settings))->read('refill', [], 1);
            $config['magnus']['url'] = $url;
            $config['magnus']['verify_ssl'] = $settings['verify_ssl'];
            return ['ok' => true, 'url' => $url, 'error' => ''];
        } catch (\Throwable $e) {
            $errors[] = $url . ' -> ' . $e->getMessage();
        }
    }

    return ['ok' => false, 'url' => (string) ($config['magnus']['url'] ?? ''), 'error' => implode(' | ', $errors)];
}

function exportValue($value, int $level = 0): string
{
    if (!is_array($value)) {
        return var_export($value, true);
    }
    if ($value === []) {
        return '[]';
    }
    $isList = array_keys($value) === range(0, count($value) - 1);
    $nested = array_filter($value, 'is_array') !== [];
    if ($isList && !$nested) {
        return '[' . implode(', ', array_map('exportValue', $value)) . ']';
    }
    $pad = str_repeat('    ', $level + 1);
    $out = "[\n";
    foreach ($value as $key => $item) {
        $out .= $pad . ($isList ? '' : var_export($key, true) . ' => ') . exportValue($item, $level + 1) . ",\n";
    }

    return $out . str_repeat('    ', $level) . ']';
}

function writeConfig(string $path, array $config): void
{
    $php = "<?php\n\n/**\n * Unity Carrier top-up gateway settings, written by install.sh on " . date('Y-m-d H:i') . ".\n"
        . " * You can edit this file; re-running install.sh keeps your changes.\n"
        . " * See config.example.php for what each option means.\n */\n\nreturn " . exportValue($config) . ";\n";
    $tmp = $path . '.tmp';
    if (file_put_contents($tmp, $php) === false || !rename($tmp, $path)) {
        throw new \RuntimeException("Cannot write {$path}");
    }
}

$command = $argv[1] ?? '';
$configPath = GATEWAY_ROOT . '/config.php';

try {
    if ($command === 'remove-key') {
        if (!is_file($configPath)) {
            echo "no config.php, nothing to remove\n";
            exit(0);
        }
        $config = require $configPath;
        $key = (string) ($config['magnus']['api_key'] ?? '');
        if (strpos($key, KEY_PREFIX) !== 0) {
            echo "API key was not created by the installer; left in MagnusBilling\n";
            exit(0);
        }
        $deleted = magnusDb()->prepare('DELETE FROM pkg_api WHERE api_key = ?');
        $deleted->execute([$key]);
        echo $deleted->rowCount() > 0 ? "MagnusBilling API key removed\n" : "MagnusBilling API key was already gone\n";
        exit(0);
    }

    if ($command !== 'configure') {
        fwrite(STDERR, "Usage: php bin/setup.php configure|remove-key\n");
        exit(2);
    }

    $example = require GATEWAY_ROOT . '/config.example.php';
    $existing = is_file($configPath) ? require $configPath : [];
    $config = $example;
    foreach ((array) $existing as $section => $values) {
        $config[$section] = is_array($values) && isset($config[$section]) && is_array($config[$section])
            ? array_replace($config[$section], $values)
            : $values;
    }

    $summary = [];

    if (($company = env('UC_COMPANY')) !== '') {
        $config['site']['name'] = $company;
    }
    if (($baseUrl = env('UC_BASE_URL')) !== '') {
        $config['site']['base_url'] = rtrim($baseUrl, '/');
    }
    if (($support = env('UC_SUPPORT_URL')) !== '') {
        $config['site']['support_url'] = $support;
    }
    if (($oxapay = env('UC_OXAPAY_KEY')) !== '') {
        $config['oxapay']['merchant_api_key'] = $oxapay;
    }
    if (($currency = strtoupper(env('UC_CURRENCY'))) !== '') {
        if (!isset(\Gateway\Settings::CURRENCIES[$currency])) {
            throw new \RuntimeException('Unsupported currency ' . $currency . ' (use ' . implode(', ', array_keys(\Gateway\Settings::CURRENCIES)) . ').');
        }
        $config['payments']['currency'] = $currency;
        $config['payments']['currency_symbol'] = \Gateway\Settings::CURRENCIES[$currency];
    }
    if (env('UC_SANDBOX') !== '') {
        $config['oxapay']['sandbox'] = env('UC_SANDBOX') === '1';
    }

    // Telegram
    if (($token = env('UC_TG_TOKEN')) !== '') {
        $config['telegram']['bot_token'] = $token;
    }
    if (($admins = env('UC_TG_ADMINS')) !== '') {
        $config['telegram']['admin_chat_ids'] = array_values(array_map('intval', array_filter(array_map('trim', explode(',', $admins)), 'is_numeric')));
    }
    if ((string) ($config['telegram']['webhook_secret'] ?? '') === '') {
        $config['telegram']['webhook_secret'] = bin2hex(random_bytes(24));
    }
    $summary['telegram_ok'] = false;
    $summary['telegram_error'] = '';
    if ((string) $config['telegram']['bot_token'] !== '' && env('UC_TG_DISABLE') !== '1') {
        try {
            $me = (new Telegram((string) $config['telegram']['bot_token']))->call('getMe');
            $config['telegram']['bot_username'] = (string) ($me['username'] ?? '');
            $config['telegram']['enabled'] = true;
            $summary['telegram_ok'] = true;
        } catch (\Throwable $e) {
            $config['telegram']['enabled'] = false;
            $summary['telegram_error'] = $e->getMessage();
        }
    } else {
        $config['telegram']['enabled'] = false;
    }
    $summary['telegram_bot'] = (string) $config['telegram']['bot_username'];

    // Integration API key
    $summary['new_api_key'] = '';
    if (empty($config['api']['keys'])) {
        $apiKey = bin2hex(random_bytes(24));
        $config['api']['keys'] = [$apiKey => 'integrations'];
        $summary['new_api_key'] = $apiKey;
    }

    // MagnusBilling API key + connectivity
    $summary['magnus_key_created'] = false;
    $summary['magnus_admin'] = '';
    $summary['magnus_note'] = '';
    if (env('UC_SKIP_MAGNUS_KEY') !== '1') {
        try {
            $result = ensureMagnusKey($config);
            $summary['magnus_key_created'] = $result['created'];
            $summary['magnus_admin'] = $result['admin'];
            $summary['magnus_note'] = $result['note'];
            $summary['magnus_key_upgraded'] = $result['upgraded'];
        } catch (\Throwable $e) {
            $summary['magnus_note'] = 'Could not create the API key automatically: ' . $e->getMessage();
        }
    }
    $probe = (string) $config['magnus']['api_key'] !== ''
        ? probeMagnus($config)
        : ['ok' => false, 'url' => (string) $config['magnus']['url'], 'error' => 'no MagnusBilling API key'];
    $summary['magnus_ok'] = $probe['ok'];
    $summary['magnus_url'] = $probe['url'];
    $summary['magnus_error'] = $probe['error'];

    writeConfig($configPath, $config);

    $summary['base_url'] = (string) $config['site']['base_url'];
    $summary['oxapay_key_set'] = (string) $config['oxapay']['merchant_api_key'] !== '';
    $summary['sandbox'] = (bool) $config['oxapay']['sandbox'];
    $summary['currency'] = (string) $config['payments']['currency'];
    echo json_encode($summary, JSON_UNESCAPED_SLASHES), "\n";
} catch (\Throwable $e) {
    fwrite(STDERR, 'ERROR: ' . $e->getMessage() . "\n");
    exit(1);
}
