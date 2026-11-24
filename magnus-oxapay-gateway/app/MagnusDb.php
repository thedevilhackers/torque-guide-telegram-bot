<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Direct, read-mostly access to the MagnusBilling database, used by the customer-panel add-on.
 *
 * Only two things are ever written: the two-step login fields of the customer's own pkg_user row.
 * Everything else (credit, payments) still goes through the MagnusBilling API.
 */
final class MagnusDb
{
    public const DEFAULT_CONFIG = '/etc/asterisk/res_config_mysql.conf';

    /** @var App */
    private $app;

    /** @var \PDO|null */
    private $pdo;

    public function __construct(App $app, ?\PDO $pdo = null)
    {
        $this->app = $app;
        $this->pdo = $pdo;
    }

    /**
     * Connects with the settings MagnusBilling itself uses (res_config_mysql.conf).
     * The file is read the way Asterisk does (key = raw value, ";" starts a comment unless escaped),
     * so passwords containing characters such as ! $ " are not mangled the way parse_ini_file() would.
     */
    public static function connect(string $path = self::DEFAULT_CONFIG): \PDO
    {
        if (!is_readable($path)) {
            throw new \RuntimeException("Cannot read {$path} (MagnusBilling database settings).");
        }
        $ini = [];
        foreach ((array) file($path, FILE_IGNORE_NEW_LINES) as $line) {
            if (preg_match('/^\s*(dbhost|dbname|dbuser|dbpass|dbport|dbsock)\s*=>?\s*(.*)$/', (string) $line, $m)) {
                $value = trim((string) preg_replace('/(?<!\\\\);.*$/', '', $m[2]));
                $ini[$m[1]] = str_replace('\\;', ';', $value);
            }
        }
        foreach (['dbname', 'dbuser', 'dbpass'] as $required) {
            if (!array_key_exists($required, $ini)) {
                throw new \RuntimeException("{$path} has no {$required} setting.");
            }
        }
        if (!empty($ini['dbsock']) && empty($ini['dbhost'])) {
            $dsn = 'mysql:unix_socket=' . $ini['dbsock'];
        } else {
            $dsn = 'mysql:host=' . ($ini['dbhost'] ?? '127.0.0.1');
            if (!empty($ini['dbport'])) {
                $dsn .= ';port=' . (int) $ini['dbport'];
            }
        }
        $dsn .= ';dbname=' . $ini['dbname'] . ';charset=utf8';

        return new \PDO($dsn, (string) $ini['dbuser'], (string) $ini['dbpass'], [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
        ]);
    }

    public function pdo(): \PDO
    {
        if ($this->pdo === null) {
            $panel = $this->app->config['panel'] ?? [];
            if (!empty($panel['magnus_db_dsn'])) {
                // Testing only: a PDO DSN with MagnusBilling-like tables.
                $this->pdo = new \PDO((string) $panel['magnus_db_dsn'], null, null, [
                    \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
                    \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
                ]);
            } else {
                $this->pdo = self::connect((string) (($panel['magnus_db_config'] ?? '') ?: self::DEFAULT_CONFIG));
            }
        }

        return $this->pdo;
    }

    /**
     * @return array<string,mixed>|null
     */
    public function user(int $id): ?array
    {
        $stmt = $this->pdo()->prepare(
            'SELECT id, username, credit, active, firstname, lastname, email, googleAuthenticator_enable, google_authenticator_key
             FROM pkg_user WHERE id = ?'
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch();

        return is_array($row) ? $row : null;
    }

    /**
     * @return array<string,mixed>|null
     */
    public function userByUsername(string $username): ?array
    {
        $stmt = $this->pdo()->prepare('SELECT id, username, googleAuthenticator_enable FROM pkg_user WHERE username = ?');
        $stmt->execute([$username]);
        $row = $stmt->fetch();

        return is_array($row) ? $row : null;
    }

    /**
     * Turns two-step login on (with $key) or off (empty $key) for one customer.
     * MagnusBilling asks for the code at login while googleAuthenticator_enable is 1 and a key is set.
     */
    public function setTwoStep(int $id, string $key): void
    {
        $stmt = $this->pdo()->prepare('UPDATE pkg_user SET google_authenticator_key = ?, googleAuthenticator_enable = ? WHERE id = ?');
        $stmt->execute([$key, $key !== '' ? 1 : 0, $id]);
    }
}
