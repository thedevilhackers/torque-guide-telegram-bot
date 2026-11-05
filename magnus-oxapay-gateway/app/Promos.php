<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Promo codes: extra bonus credit (percent) on top-ups, with optional use limit and expiry.
 */
final class Promos
{
    /** @var App */
    private $app;

    public function __construct(App $app)
    {
        $this->app = $app;
    }

    private function table(): string
    {
        return $this->app->db()->table('promos');
    }

    public static function normalizeCode(string $raw): string
    {
        $code = strtoupper(trim($raw));
        if (!preg_match('/^[A-Z0-9]{3,20}$/', $code)) {
            throw new UserError('invalid_promo', 'Promo codes are 3 to 20 letters and digits.');
        }

        return $code;
    }

    /**
     * @return array<string,mixed> the promo row, if the code can be used now
     */
    public function validate(string $raw): array
    {
        $code = self::normalizeCode($raw);
        $promo = $this->app->db()->one('SELECT * FROM ' . $this->table() . ' WHERE code = ?', [$code]);
        if ($promo === null || !(int) $promo['active']) {
            throw new UserError('invalid_promo', 'That promo code does not exist.');
        }
        if ($promo['expires_at'] !== null && (int) $promo['expires_at'] < time()) {
            throw new UserError('invalid_promo', 'That promo code has expired.');
        }
        if ((int) $promo['max_uses'] > 0 && (int) $promo['uses'] >= (int) $promo['max_uses']) {
            throw new UserError('invalid_promo', 'That promo code has been used up.');
        }

        return $promo;
    }

    public function create(string $code, string $percent, int $maxUses, int $days, string $actor): void
    {
        $code = self::normalizeCode($code);
        $value = (float) str_replace(',', '.', $percent);
        if ($value <= 0 || $value > 100) {
            throw new UserError('invalid_percent', 'The bonus must be between 1 and 100 percent.');
        }
        if ($this->app->db()->one('SELECT code FROM ' . $this->table() . ' WHERE code = ?', [$code]) !== null) {
            throw new UserError('promo_exists', 'That code already exists.');
        }
        $this->app->db()->insert('promos', [
            'code' => $code,
            'percent' => number_format($value, 2, '.', ''),
            'max_uses' => max(0, $maxUses),
            'uses' => 0,
            'expires_at' => $days > 0 ? time() + $days * 86400 : null,
            'active' => 1,
            'created_by' => substr($actor, 0, 100),
            'created_at' => time(),
        ]);
        $this->app->log('info', 'Promo code created', ['code' => $code, 'percent' => $value, 'max_uses' => $maxUses, 'days' => $days, 'admin' => $actor]);
    }

    public function disable(string $code, string $actor): void
    {
        $this->app->db()->run('UPDATE ' . $this->table() . ' SET active = 0 WHERE code = ?', [strtoupper($code)]);
        $this->app->log('info', 'Promo code disabled', ['code' => $code, 'admin' => $actor]);
    }

    public function countUse(string $code): void
    {
        $this->app->db()->run('UPDATE ' . $this->table() . ' SET uses = uses + 1 WHERE code = ?', [$code]);
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function all(): array
    {
        return $this->app->db()->all('SELECT * FROM ' . $this->table() . ' ORDER BY active DESC, created_at DESC LIMIT 30');
    }
}
