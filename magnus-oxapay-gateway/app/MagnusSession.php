<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Who is logged in to the MagnusBilling panel in this browser.
 *
 * The add-on page is served from the same domain as the panel, so the browser sends the panel's PHP session
 * cookie. The session is opened read-only (it is never changed or locked), and only a fully logged-in session
 * counts: MagnusBilling sets logged = true after the password and, if enabled, the two-step code.
 */
final class MagnusSession
{
    /**
     * @return array{id_user:int, username:string, is_client:bool, is_admin:bool, session_id:string}|null
     */
    public static function read(App $app): ?array
    {
        $name = (string) (($app->config['panel']['session_name'] ?? '') ?: (ini_get('session.name') ?: 'PHPSESSID'));
        $id = (string) ($_COOKIE[$name] ?? '');
        if (!preg_match('/^[A-Za-z0-9,-]{20,256}$/', $id)) {
            return null;
        }
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_write_close();
        }
        session_name($name);
        session_id($id);
        $started = @session_start(['read_and_close' => true, 'use_cookies' => 0, 'cache_limiter' => '']);
        $data = $started && isset($_SESSION) && is_array($_SESSION) ? $_SESSION : [];
        $_SESSION = [];

        return self::fromArray($data, $id);
    }

    /**
     * @param array<string,mixed> $session
     * @return array{id_user:int, username:string, is_client:bool, is_admin:bool, session_id:string}|null
     */
    public static function fromArray(array $session, string $sessionId): ?array
    {
        if (($session['logged'] ?? false) !== true) {
            return null;
        }
        $id = (int) ($session['id_user'] ?? 0);
        $username = (string) ($session['username'] ?? '');
        if ($id < 1 || $username === '' || strlen($username) > 100) {
            return null;
        }

        return [
            'id_user' => $id,
            'username' => $username,
            'is_client' => !empty($session['isClient']),
            'is_admin' => !empty($session['isAdmin']),
            'session_id' => $sessionId,
        ];
    }
}
