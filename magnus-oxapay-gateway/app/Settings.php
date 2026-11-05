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

    /** Website themes. */
    public const THEMES = ['voip' => 'VoIP (navy & blue)', 'luxury' => 'Luxury (black & gold)', 'classic' => 'Classic (light)'];

    /** setting name => [config section, config key] */
    private const KEYS = [
        'min_amount' => ['payments', 'min_amount'],
        'max_amount' => ['payments', 'max_amount'],
        'currency' => ['payments', 'currency'],
        'low_balance' => ['payments', 'low_balance'],
        'bank_instructions' => ['payments', 'bank_instructions'],
        'report_hour' => ['telegram', 'report_hour'],
        'theme' => ['site', 'theme'],
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
            } elseif ($name === 'bank_instructions' || $name === 'theme') {
                $config[$section][$key] = $value;
            } elseif ($name === 'report_hour') {
                $config[$section][$key] = (int) $value;
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
        if ($name === 'bank_instructions') {
            $value = trim($value);
            if (in_array(strtolower($value), ['-', 'off', 'none', 'disable'], true)) {
                return '';
            }
            $length = function_exists('mb_strlen') ? mb_strlen($value) : strlen($value);
            if ($length > 1000) {
                throw new UserError('invalid_text', 'Keep the bank details under 1000 characters.');
            }
            return $value;
        }
        if ($name === 'theme') {
            $value = strtolower(trim($value));
            if (!isset(self::THEMES[$value])) {
                throw new UserError('invalid_theme', 'Choose one of: ' . implode(', ', array_keys(self::THEMES)) . '.');
            }
            return $value;
        }
        if ($name === 'report_hour') {
            $value = strtolower(trim($value));
            if (in_array($value, ['off', '-1', 'none'], true)) {
                return '-1';
            }
            if (!preg_match('/^\d{1,2}$/', $value) || (int) $value > 23) {
                throw new UserError('invalid_hour', 'Send an hour from 0 to 23, or off.');
            }
            return (string) (int) $value;
        }
        $text = str_replace(',', '.', trim(ltrim(trim($value), '€$£')));
        if (!preg_match('/^\d{1,7}(\.\d{1,2})?$/', $text) || ((float) $text <= 0 && $name !== 'low_balance')) {
            throw new UserError('invalid_amount', 'Enter an amount greater than 0, such as 5 or 2.50.');
        }
        $amount = (float) $text;
        if ($name === 'low_balance') {
            return number_format($amount, 2, '.', '');
        }
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
        $this->app->db()->run('DELETE FROM ' . $this->app->db()->table('settings') . " WHERE skey IN ('min_amount', 'max_amount', 'currency')");
        $this->app->refreshSettings();
        $this->app->log('info', 'Admin reset settings to config.php', ['admin' => $actor]);
    }
}
