<?php

declare(strict_types=1);

if (PHP_VERSION_ID < 70400) {
    http_response_code(500);
    exit('PHP 7.4 or newer is required.');
}

if (!defined('GATEWAY_ROOT')) {
    define('GATEWAY_ROOT', dirname(__DIR__));
}

spl_autoload_register(static function (string $class): void {
    $prefix = 'Gateway\\';
    if (strncmp($class, $prefix, strlen($prefix)) !== 0) {
        return;
    }
    $file = __DIR__ . '/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    if (is_file($file)) {
        require $file;
    }
});
