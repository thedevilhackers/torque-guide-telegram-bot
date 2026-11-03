<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Small helpers for the public entry points.
 */
final class Web
{
    /**
     * Loads the app or shows a plain error page (config missing, DB unwritable, ...).
     */
    public static function boot(bool $json = false): App
    {
        try {
            $app = App::load();
            $app->db();

            return $app;
        } catch (\Throwable $e) {
            error_log('[magnus-oxapay-gateway] ' . $e->getMessage());
            http_response_code(500);
            if ($json) {
                self::json(['ok' => false, 'error' => ['code' => 'server_error', 'message' => 'The payment service is not configured correctly.']], 500);
            }
            header('Content-Type: text/plain; charset=utf-8');
            echo "The payment service is not configured correctly.\n";
            exit;
        }
    }

    public static function e($text): string
    {
        return htmlspecialchars((string) $text, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    /**
     * @param mixed $data
     */
    public static function json($data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    /**
     * Reads JSON or form input merged with the query string.
     *
     * @return array<string,mixed>
     */
    public static function input(): array
    {
        $input = $_GET;
        $raw = (string) file_get_contents('php://input');
        if ($raw !== '') {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                return array_merge($input, $decoded);
            }
        }

        return array_merge($input, $_POST);
    }

    public static function clientIp(App $app): string
    {
        if (!empty($app->config['app']['trust_proxy_headers'])) {
            foreach (['HTTP_CF_CONNECTING_IP', 'HTTP_X_REAL_IP', 'HTTP_X_FORWARDED_FOR'] as $header) {
                if (!empty($_SERVER[$header])) {
                    $ip = trim(explode(',', (string) $_SERVER[$header])[0]);
                    if (filter_var($ip, FILTER_VALIDATE_IP)) {
                        return $ip;
                    }
                }
            }
        }

        return (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
    }

    public static function header(string $name): ?string
    {
        $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
        if (isset($_SERVER[$key])) {
            return (string) $_SERVER[$key];
        }
        if (function_exists('getallheaders')) {
            foreach ((array) getallheaders() as $header => $value) {
                if (strcasecmp((string) $header, $name) === 0) {
                    return (string) $value;
                }
            }
        }

        return null;
    }

    public static function securityHeaders(): void
    {
        header('X-Content-Type-Options: nosniff');
        header('Referrer-Policy: strict-origin-when-cross-origin');
        header('X-Frame-Options: SAMEORIGIN');
    }
}
