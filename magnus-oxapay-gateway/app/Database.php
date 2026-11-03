<?php

declare(strict_types=1);

namespace Gateway;

/**
 * PDO wrapper. Works with SQLite (default) and MySQL/MariaDB.
 * Tables are created automatically on first use.
 */
final class Database
{
    /** @var \PDO */
    private $pdo;
    /** @var string */
    private $prefix;
    /** @var string */
    private $driver;

    public function __construct(array $config)
    {
        $dsn = (string) ($config['dsn'] ?? '');
        if ($dsn === '') {
            throw new \RuntimeException('database.dsn is not configured.');
        }
        if (strpos($dsn, 'sqlite:') === 0) {
            $path = substr($dsn, 7);
            if ($path !== '' && $path !== ':memory:' && !is_dir(dirname($path))) {
                @mkdir(dirname($path), 0770, true);
            }
        }

        $this->pdo = new \PDO($dsn, $config['username'] ?? null, $config['password'] ?? null, [
            \PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION,
            \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC,
        ]);
        $this->driver = (string) $this->pdo->getAttribute(\PDO::ATTR_DRIVER_NAME);
        $this->prefix = (string) preg_replace('/[^A-Za-z0-9_]/', '', (string) ($config['prefix'] ?? 'oxg_'));

        if ($this->driver === 'sqlite') {
            $this->pdo->exec('PRAGMA busy_timeout = 5000');
            $this->pdo->exec('PRAGMA journal_mode = WAL');
        }

        $this->migrate();
    }

    public function table(string $name): string
    {
        return $this->prefix . $name;
    }

    /**
     * @return array<string,mixed>|null
     */
    public function one(string $sql, array $params = []): ?array
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);
        $row = $statement->fetch();

        return $row === false ? null : $row;
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function all(string $sql, array $params = []): array
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);

        return $statement->fetchAll();
    }

    /**
     * @return int affected rows
     */
    public function run(string $sql, array $params = []): int
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);

        return $statement->rowCount();
    }

    public function insert(string $table, array $row): void
    {
        $columns = array_keys($row);
        $sql = sprintf(
            'INSERT INTO %s (%s) VALUES (%s)',
            $this->table($table),
            implode(', ', $columns),
            implode(', ', array_fill(0, count($columns), '?'))
        );
        $this->run($sql, array_values($row));
    }

    /**
     * Fixed-window rate limiter. Returns false when $key exceeded $limit hits within $window seconds.
     */
    public function rateLimit(string $key, int $limit, int $window): bool
    {
        $table = $this->table('rate_limits');
        $now = time();
        $row = $this->one("SELECT window_start, hits FROM {$table} WHERE rkey = ?", [$key]);

        if ($row === null || (int) $row['window_start'] <= $now - $window) {
            $this->run("REPLACE INTO {$table} (rkey, window_start, hits) VALUES (?, ?, 1)", [$key, $now]);
            if (random_int(1, 50) === 1) {
                $this->run("DELETE FROM {$table} WHERE window_start < ?", [$now - 86400]);
            }
            return true;
        }
        if ((int) $row['hits'] >= $limit) {
            return false;
        }
        $this->run("UPDATE {$table} SET hits = hits + 1 WHERE rkey = ?", [$key]);

        return true;
    }

    private function migrate(): void
    {
        $suffix = $this->driver === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';

        $this->pdo->exec('CREATE TABLE IF NOT EXISTS ' . $this->table('orders') . ' (
            id VARCHAR(32) NOT NULL PRIMARY KEY,
            username VARCHAR(100) NOT NULL,
            magnus_user_id BIGINT NOT NULL,
            amount DECIMAL(14,2) NOT NULL,
            currency VARCHAR(10) NOT NULL,
            credit DECIMAL(16,4) NOT NULL,
            bonus_percent DECIMAL(6,2) NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL,
            source VARCHAR(20) NOT NULL,
            tg_chat_id VARCHAR(32) NULL,
            email VARCHAR(190) NULL,
            reference VARCHAR(100) NULL,
            return_url VARCHAR(500) NULL,
            track_id VARCHAR(64) NULL UNIQUE,
            payment_url VARCHAR(500) NULL,
            provider_status VARCHAR(30) NULL,
            refill_id VARCHAR(32) NULL,
            last_error VARCHAR(1000) NULL,
            ip VARCHAR(45) NULL,
            created_at BIGINT NOT NULL,
            updated_at BIGINT NOT NULL,
            expires_at BIGINT NULL,
            checked_at BIGINT NULL,
            credited_at BIGINT NULL
        )' . $suffix);

        $this->pdo->exec('CREATE TABLE IF NOT EXISTS ' . $this->table('tg_sessions') . ' (
            chat_id VARCHAR(32) NOT NULL PRIMARY KEY,
            state VARCHAR(30) NOT NULL,
            data TEXT NULL,
            updated_at BIGINT NOT NULL
        )' . $suffix);

        $this->pdo->exec('CREATE TABLE IF NOT EXISTS ' . $this->table('rate_limits') . ' (
            rkey VARCHAR(150) NOT NULL PRIMARY KEY,
            window_start BIGINT NOT NULL,
            hits INTEGER NOT NULL
        )' . $suffix);
    }
}
