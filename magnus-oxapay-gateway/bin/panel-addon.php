<?php

/**
 * MagnusBilling side of the customer-panel add-on. Run by panel-addon.sh as root; it rarely needs running by hand.
 *
 *   php bin/panel-addon.php plan   --addon-path=/pay/panel/               what would change (JSON)
 *   php bin/panel-addon.php apply  --addon-path=/pay/panel/ --undo=FILE   add the menu items (saves the undo record first)
 *   php bin/panel-addon.php remove --undo=FILE                            put everything back from the undo record
 *   php bin/panel-addon.php mycnf  FILE                                   MySQL client settings for mysqldump (mode 0600)
 *   php bin/panel-addon.php dbsize                                        size of the MagnusBilling database in bytes
 *   php bin/panel-addon.php set-login-url URL                             panel address for the add-on's "log in" link
 *
 * What "apply" changes, all recorded in the undo file:
 *   pkg_configuration  module_extra2 / module_extra3 (or module_extra) = the add-on page address
 *   pkg_module         those menu items get a name, an icon, and a place under Billing / Clients
 *   pkg_group_module   customer groups (and admin groups, to preview) may open them; customers get desktop icons
 */

declare(strict_types=1);

use Gateway\App;
use Gateway\MagnusDb;

require __DIR__ . '/../app/bootstrap.php';

const SLOTS = [
    'extra2' => ['config' => 'module_extra2', 'default' => 'index.php/extra2/read'],
    'extra3' => ['config' => 'module_extra3', 'default' => 'index.php/extra3/read'],
    'extra' => ['config' => 'module_extra', 'default' => 'index.php/extra/read'],
];
const ITEMS = [
    ['tab' => 'topup', 'label' => 'Top up', 'icon' => 'x-fa fa-credit-card', 'parent' => 'Billing'],
    ['tab' => 'security', 'label' => 'Telegram & security', 'icon' => 'x-fa fa-shield', 'parent' => 'Clients'],
];

function fail(string $message): void
{
    fwrite(STDERR, $message . "\n");
    exit(1);
}

function option(array $argv, string $name): string
{
    foreach ($argv as $arg) {
        if (strpos($arg, "--{$name}=") === 0) {
            return substr($arg, strlen($name) + 3);
        }
    }

    return '';
}

function pdo(): \PDO
{
    $dsn = getenv('UC_MAGNUS_DSN');
    if (is_string($dsn) && $dsn !== '') { // testing only
        return new \PDO($dsn, null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION, \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC]);
    }
    $path = getenv('UC_MAGNUS_DB_CONFIG');

    return MagnusDb::connect(is_string($path) && $path !== '' ? $path : MagnusDb::DEFAULT_CONFIG);
}

function rows(\PDO $db, string $sql, array $args = []): array
{
    $stmt = $db->prepare($sql);
    $stmt->execute($args);

    return $stmt->fetchAll();
}

/**
 * Works out what "apply" would do.
 *
 * @return array<string,mixed>
 */
function plan(\PDO $db, string $addonPath): array
{
    $config = [];
    foreach (rows($db, "SELECT config_key, config_value FROM pkg_configuration WHERE config_key IN ('module_extra', 'module_extra2', 'module_extra3')") as $row) {
        $config[(string) $row['config_key']] = (string) $row['config_value'];
    }
    $modules = [];
    foreach (rows($db, "SELECT id, text, module, icon_cls, id_module, priority FROM pkg_module WHERE module IN ('extra', 'extra2', 'extra3')") as $row) {
        $modules[(string) $row['module']] = $row;
    }

    $free = [];
    $busy = [];
    foreach (SLOTS as $module => $slot) {
        if (!isset($modules[$module]) || !array_key_exists($slot['config'], $config)) {
            continue;
        }
        $value = trim($config[$slot['config']]);
        if ($value === '' || $value === $slot['default'] || strpos($value, $addonPath) === 0) {
            $free[] = $module;
        } else {
            $busy[$module] = $value;
        }
    }
    if ($free === []) {
        return ['ok' => false, 'error' => 'All three MagnusBilling "Extra" menu slots are already used for other pages: '
            . json_encode($busy, JSON_UNESCAPED_SLASHES), 'busy' => $busy];
    }

    $parents = [];
    foreach (rows($db, 'SELECT id, text FROM pkg_module WHERE module IS NULL') as $row) {
        $name = (string) preg_replace("/^t\\('(.*)'\\)$/", '$1', (string) $row['text']);
        $parents[$name] = (int) $row['id'];
    }

    $items = [];
    if (count($free) === 1) {
        $items[] = ['tab' => 'topup', 'label' => 'Top up & Telegram', 'icon' => 'x-fa fa-credit-card', 'parent' => 'Billing', 'module' => $free[0]];
    } else {
        foreach (ITEMS as $i => $item) {
            $items[] = $item + ['module' => $free[$i]];
        }
    }
    foreach ($items as &$item) {
        $current = $modules[$item['module']];
        $item['id'] = (int) $current['id'];
        $item['config'] = SLOTS[$item['module']]['config'];
        $item['url'] = $addonPath . '?tab=' . $item['tab'];
        $item['parent_id'] = $parents[$item['parent']] ?? (int) $current['id_module'];
        $item['parent_found'] = isset($parents[$item['parent']]);
    }
    unset($item);

    $groups = rows($db, 'SELECT id, name, id_user_type FROM pkg_group_user WHERE id_user_type IN (1, 3) ORDER BY id');

    return ['ok' => true, 'items' => $items, 'groups' => $groups, 'busy' => $busy];
}

function apply(\PDO $db, string $addonPath, string $undoFile): array
{
    $plan = plan($db, $addonPath);
    if (!$plan['ok']) {
        fail($plan['error']);
    }
    // Record what is there now, before changing anything. On a re-run the first record is kept, so undo
    // always goes back to how things were before the add-on was ever installed.
    $undo = json_decode((string) @file_get_contents($undoFile), true);
    if (!is_array($undo) || ($undo['version'] ?? 0) !== 1) {
        $undo = ['version' => 1, 'applied_at' => date('c'), 'addon_path' => $addonPath, 'modules' => [], 'config' => [], 'group_module' => []];
    }
    $undo['updated_at'] = date('c');
    foreach ($plan['items'] as $item) {
        if (!array_key_exists((string) $item['id'], $undo['modules'])) {
            $undo['modules'][(string) $item['id']] = rows($db, 'SELECT text, icon_cls, id_module, priority FROM pkg_module WHERE id = ?', [$item['id']])[0];
        }
        if (!array_key_exists($item['config'], $undo['config'])) {
            $undo['config'][$item['config']] = (string) rows($db, 'SELECT config_value FROM pkg_configuration WHERE config_key = ?', [$item['config']])[0]['config_value'];
        }
    }
    $grants = [];
    foreach ($plan['groups'] as $group) {
        $client = (int) $group['id_user_type'] === 3;
        foreach ($plan['items'] as $item) {
            $grants[] = [(int) $group['id'], $item['id'], $client];
            if ($client && !$item['parent_found'] && $item['parent_id'] > 0) {
                $grants[] = [(int) $group['id'], $item['parent_id'], $client]; // the folder must be visible too
            }
        }
    }
    foreach ($grants as [$groupId, $moduleId]) {
        if (!array_key_exists($groupId . ':' . $moduleId, $undo['group_module'])) {
            $existing = rows($db, 'SELECT action, show_menu, createShortCut, createQuickStart FROM pkg_group_module WHERE id_group = ? AND id_module = ?', [$groupId, $moduleId]);
            $undo['group_module'][$groupId . ':' . $moduleId] = $existing[0] ?? null;
        }
    }
    if (file_put_contents($undoFile, json_encode($undo, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)) === false) {
        fail("Could not write the undo record to {$undoFile}; nothing was changed.");
    }
    chmod($undoFile, 0600);

    $db->beginTransaction();
    try {
        foreach ($plan['items'] as $item) {
            rows($db, 'UPDATE pkg_module SET text = ?, icon_cls = ?, id_module = ?, priority = 0 WHERE id = ?',
                [$item['label'], $item['icon'], $item['parent_id'], $item['id']]);
            rows($db, 'UPDATE pkg_configuration SET config_value = ? WHERE config_key = ?', [$item['url'], $item['config']]);
        }
        foreach ($grants as [$groupId, $moduleId, $client]) {
            $exists = rows($db, 'SELECT 1 FROM pkg_group_module WHERE id_group = ? AND id_module = ?', [$groupId, $moduleId]) !== [];
            if (!$exists) {
                rows($db, 'INSERT INTO pkg_group_module (id_group, id_module, action, show_menu, createShortCut, createQuickStart) VALUES (?, ?, ?, 1, ?, ?)',
                    [$groupId, $moduleId, 'r', $client ? 1 : 0, $client ? 1 : 0]);
            } elseif ($client) {
                rows($db, 'UPDATE pkg_group_module SET show_menu = 1, createShortCut = 1, createQuickStart = 1 WHERE id_group = ? AND id_module = ?', [$groupId, $moduleId]);
            } else {
                rows($db, 'UPDATE pkg_group_module SET show_menu = 1 WHERE id_group = ? AND id_module = ?', [$groupId, $moduleId]);
            }
        }
        $db->commit();
    } catch (\Throwable $e) {
        $db->rollBack();
        fail('Nothing was changed: ' . $e->getMessage());
    }

    return $plan;
}

function remove(\PDO $db, string $undoFile): void
{
    $undo = json_decode((string) @file_get_contents($undoFile), true);
    if (!is_array($undo) || ($undo['version'] ?? 0) !== 1) {
        fail("No undo record at {$undoFile}.");
    }
    $db->beginTransaction();
    try {
        foreach ($undo['modules'] as $id => $row) {
            rows($db, 'UPDATE pkg_module SET text = ?, icon_cls = ?, id_module = ?, priority = ? WHERE id = ?',
                [$row['text'], $row['icon_cls'], $row['id_module'], $row['priority'], (int) $id]);
        }
        foreach ($undo['config'] as $key => $value) {
            rows($db, 'UPDATE pkg_configuration SET config_value = ? WHERE config_key = ?', [$value, $key]);
        }
        foreach ($undo['group_module'] as $key => $row) {
            [$groupId, $moduleId] = array_map('intval', explode(':', (string) $key));
            if ($row === null) {
                rows($db, 'DELETE FROM pkg_group_module WHERE id_group = ? AND id_module = ?', [$groupId, $moduleId]);
            } else {
                rows($db, 'UPDATE pkg_group_module SET action = ?, show_menu = ?, createShortCut = ?, createQuickStart = ? WHERE id_group = ? AND id_module = ?',
                    [$row['action'], $row['show_menu'], $row['createShortCut'], $row['createQuickStart'], $groupId, $moduleId]);
            }
        }
        $db->commit();
    } catch (\Throwable $e) {
        $db->rollBack();
        fail('Nothing was changed: ' . $e->getMessage());
    }
}

// ------------------------------------------------------------------ main

$command = $argv[1] ?? '';
$addonPath = option($argv, 'addon-path');
if (in_array($command, ['plan', 'apply'], true) && !preg_match('#^/[A-Za-z0-9._~/-]*/$#', $addonPath)) {
    fail('--addon-path must look like /pay/panel/');
}

try {
    switch ($command) {
        case 'plan':
            echo json_encode(plan(pdo(), $addonPath), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
            break;
        case 'apply':
            $undo = option($argv, 'undo');
            if ($undo === '') {
                fail('--undo=FILE is required');
            }
            $plan = apply(pdo(), $addonPath, $undo);
            foreach ($plan['items'] as $item) {
                echo "{$item['label']}|{$item['parent']}|{$item['url']}\n";
            }
            break;
        case 'remove':
            remove(pdo(), option($argv, 'undo'));
            break;
        case 'mycnf':
            $file = (string) ($argv[2] ?? '');
            $path = getenv('UC_MAGNUS_DB_CONFIG') ?: MagnusDb::DEFAULT_CONFIG;
            $settings = [];
            foreach ((array) file($path, FILE_IGNORE_NEW_LINES) as $line) {
                if (preg_match('/^\s*(dbhost|dbname|dbuser|dbpass|dbport|dbsock)\s*=>?\s*(.*)$/', (string) $line, $m)) {
                    $settings[$m[1]] = str_replace('\\;', ';', trim((string) preg_replace('/(?<!\\\\);.*$/', '', $m[2])));
                }
            }
            $quote = static function (string $v): string {
                return '"' . str_replace(['\\', '"'], ['\\\\', '\\"'], $v) . '"';
            };
            $cnf = "[client]\nuser=" . $quote($settings['dbuser'] ?? '') . "\npassword=" . $quote($settings['dbpass'] ?? '') . "\n"
                . (!empty($settings['dbsock']) ? 'socket=' . $quote($settings['dbsock']) . "\n" : 'host=' . $quote($settings['dbhost'] ?? '127.0.0.1') . "\n")
                . (!empty($settings['dbport']) ? 'port=' . (int) $settings['dbport'] . "\n" : '');
            touch($file);
            chmod($file, 0600);
            file_put_contents($file, $cnf);
            echo ($settings['dbname'] ?? 'mbilling'), "\n";
            break;
        case 'dbsize':
            $row = rows(pdo(), 'SELECT COALESCE(SUM(data_length + index_length), 0) AS bytes FROM information_schema.TABLES WHERE table_schema = DATABASE()');
            echo (int) ($row[0]['bytes'] ?? 0), "\n";
            break;
        case 'set-login-url':
            $url = (string) ($argv[2] ?? '');
            if (!filter_var($url, FILTER_VALIDATE_URL)) {
                fail('Not a URL: ' . $url);
            }
            App::load()->db()->kvSet('panel:login_url', $url);
            break;
        default:
            fail('Usage: php bin/panel-addon.php plan|apply|remove|mycnf|dbsize|set-login-url ...');
    }
} catch (\Throwable $e) {
    fail('Error: ' . $e->getMessage());
}
