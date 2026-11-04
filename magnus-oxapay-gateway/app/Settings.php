<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Settings that admins can change from Telegram without editing config.php.
 * They are stored in the gateway database and override config.php until reset.
 */
final class Settings
{
    /** Invoice currencies offered in the admin panel and their symbols. */
    public const CURRENCIES = ['EUR' => '€', 'USD' => '$', 'GBP' => '£'];

    /** setting name => [config section, config key] */
    private const KEYS = [
        'min_amount' => ['payments', 'min_amount'],
        'max_amount' => ['payments', 'max_amount'],
        'currency' => ['payments', 'currency'],
    ];

    /** @var App */
    private $app;

    public function __construct(App $app)
    {
        $this->app = $app;
    }

    /**
     * Applies stored overrides on top of a config array.
     *
     * @param array<string,string> $overrides
     */
    public static function apply(array $config, array $overrides): array
    {
        foreach ($overrides as $name => $value) {
            if (!isset(self::KEYS[$name])) {
                continue;
            }
            [$section, $key] = self::KEYS[$name];
            if ($name === 'currency') {
                $config[$section]['currency'] = $value;
                $config[$section]['currency_symbol'] = self::CURRENCIES[$value] ?? '';
            } else {
                $config[$section][$key] = (float) $value;
            }
        }

        return $config;
    }

    public static function symbolFor(string $currency): string
    {
        return self::CURRENCIES[strtoupper($currency)] ?? '';
    }

    /**
     * @return array<string,string> setting name => stored value
     */
    public function overrides(): array
    {
        $rows = $this->app->db()->all('SELECT skey, svalue FROM ' . $this->app->db()->table('settings'));
        $out = [];
        foreach ($rows as $row) {
            if (isset(self::KEYS[$row['skey']])) {
                $out[(string) $row['skey']] = (string) $row['svalue'];
            }
        }

        return $out;
    }

    /**
     * Validates and normalises a new value against the current effective settings.
     */
    public function validate(string $name, string $value): string
    {
        $pay = $this->app->config['payments'];
        if ($name === 'currency') {
            $value = strtoupper(trim($value));
            if (!isset(self::CURRENCIES[$value])) {
                throw new UserError('invalid_currency', 'Choose one of: ' . implode(', ', array_keys(self::CURRENCIES)) . '.');
            }
            return $value;
        }
        if (!isset(self::KEYS[$name])) {
            throw new UserError('invalid_setting', 'Unknown setting.');
        }
        $text = str_replace(',', '.', trim(ltrim(trim($value), '€$£')));
        if (!preg_match('/^\d{1,7}(\.\d{1,2})?$/', $text) || (float) $text <= 0) {
            throw new UserError('invalid_amount', 'Enter an amount greater than 0, such as 5 or 2.50.');
        }
        $amount = (float) $text;
        if ($name === 'min_amount' && $amount >= (float) $pay['max_amount']) {
            throw new UserError('invalid_amount', 'The minimum must be lower than the maximum (' . number_format((float) $pay['max_amount'], 2) . ').');
        }
        if ($name === 'max_amount' && $amount <= (float) $pay['min_amount']) {
            throw new UserError('invalid_amount', 'The maximum must be higher than the minimum (' . number_format((float) $pay['min_amount'], 2) . ').');
        }

        return number_format($amount, 2, '.', '');
    }

    public function set(string $name, string $value, string $actor): void
    {
        $value = $this->validate($name, $value);
        $this->app->db()->run(
            'REPLACE INTO ' . $this->app->db()->table('settings') . ' (skey, svalue, updated_at, updated_by) VALUES (?, ?, ?, ?)',
            [$name, $value, time(), substr($actor, 0, 100)]
        );
        $this->app->refreshSettings();
        $this->app->log('info', 'Admin changed a setting', ['setting' => $name, 'value' => $value, 'admin' => $actor]);
    }

    public function reset(string $actor): void
    {
        $this->app->db()->run('DELETE FROM ' . $this->app->db()->table('settings'));
        $this->app->refreshSettings();
        $this->app->log('info', 'Admin reset settings to config.php', ['admin' => $actor]);
    }
}
