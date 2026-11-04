<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Service container: holds the configuration and lazily builds the clients.
 */
final class App
{
    /** @var array<string,mixed> effective settings (config.php + admin overrides from the database) */
    public $config;

    /** @var array<string,mixed> config.php merged with defaults, before admin overrides */
    private $baseConfig;

    /** @var Database|null */
    private $db;
    /** @var MagnusBilling|null */
    private $magnus;
    /** @var OxaPay|null */
    private $oxapay;
    /** @var Telegram|null */
    private $telegram;
    /** @var TelegramBot|null */
    private $bot;
    /** @var Payments|null */
    private $payments;

    public function __construct(array $config)
    {
        $this->config = $this->baseConfig = self::withDefaults($config);
        date_default_timezone_set((string) $this->config['site']['timezone']);
    }

    public static function load(?string $path = null): self
    {
        $path = $path ?? ((string) getenv('GATEWAY_CONFIG') ?: GATEWAY_ROOT . '/config.php');
        if (!is_file($path)) {
            throw new \RuntimeException('Missing config.php. Copy config.example.php to config.php and fill it in.');
        }
        $config = require $path;
        if (!is_array($config)) {
            throw new \RuntimeException('config.php must return an array.');
        }

        return new self($config);
    }

    /**
     * @return array<string,array<string,mixed>>
     */
    public static function defaults(): array
    {
        return [
            'site' => [
                'name' => 'Top up',
                'tagline' => 'Add balance to your account with crypto',
                'base_url' => '',
                'support_url' => '',
                'logo_url' => '',
                'accent' => '#4f46e5',
                'theme' => 'luxury',
                'announcement' => '',
                'timezone' => 'UTC',
            ],
            'payments' => [
                'currency' => 'USD',
                'currency_symbol' => '$',
                'min_amount' => 5,
                'max_amount' => 1000,
                'presets' => [10, 25, 50, 100],
                'credit_rate' => 1,
                'bonus' => [],
                'ask_email' => false,
                'coins' => ['USDT', 'BTC', 'ETH', 'TRX', 'LTC', 'BNB', 'TON', 'DOGE'],
                'refill_description' => 'OxaPay top-up #{order} (track {track})',
            ],
            'magnus' => [
                'url' => '',
                'api_key' => '',
                'api_secret' => '',
                'verify_ssl' => true,
            ],
            'oxapay' => [
                'merchant_api_key' => '',
                'base_url' => 'https://api.oxapay.com/v1',
                'lifetime' => 60,
                'fee_paid_by_payer' => 1,
                'under_paid_coverage' => 0,
                'to_currency' => '',
                'mixed_payment' => true,
                'sandbox' => false,
                'verify_with_api' => true,
            ],
            'telegram' => [
                'enabled' => false,
                'bot_token' => '',
                'bot_username' => '',
                'webhook_secret' => '',
                'admin_chat_ids' => [],
                'notify_admins' => true,
            ],
            'api' => [
                'keys' => [],
                'cors_origins' => [],
                'rate_limits' => [
                    'check_user' => [60, 600],
                    'create_payment' => [10, 600],
                    'order' => [300, 600],
                ],
            ],
            'database' => [
                'dsn' => 'sqlite:' . GATEWAY_ROOT . '/data/gateway.sqlite',
                'username' => null,
                'password' => null,
                'prefix' => 'oxg_',
            ],
            'app' => [
                'log_file' => GATEWAY_ROOT . '/data/gateway.log',
                'trust_proxy_headers' => false,
                'debug' => false,
            ],
        ];
    }

    private static function withDefaults(array $config): array
    {
        $merged = self::defaults();
        foreach ($config as $section => $values) {
            if (isset($merged[$section]) && is_array($values)) {
                // One level deep on purpose: lists such as "presets" are replaced, not merged by index.
                $merged[$section] = array_replace($merged[$section], $values);
            } else {
                $merged[$section] = $values;
            }
        }

        return $merged;
    }

    public function db(): Database
    {
        if ($this->db === null) {
            $this->db = new Database($this->baseConfig['database']);
            $this->refreshSettings();
        }

        return $this->db;
    }

    public function settings(): Settings
    {
        return new Settings($this);
    }

    /**
     * Re-applies the admin overrides stored in the database (called after a change).
     */
    public function refreshSettings(): void
    {
        $this->config = Settings::apply($this->baseConfig, $this->settings()->overrides());
    }

    /**
     * The value config.php gives a payments setting, ignoring admin overrides.
     *
     * @return mixed
     */
    public function baseSetting(string $key)
    {
        return $this->baseConfig['payments'][$key] ?? null;
    }

    public function magnus(): MagnusBilling
    {
        return $this->magnus ?? ($this->magnus = new MagnusBilling($this->config['magnus']));
    }

    public function oxapay(): OxaPay
    {
        return $this->oxapay ?? ($this->oxapay = new OxaPay($this->config['oxapay']));
    }

    public function payments(): Payments
    {
        return $this->payments ?? ($this->payments = new Payments($this));
    }

    public function telegramEnabled(): bool
    {
        return !empty($this->config['telegram']['enabled']) && (string) $this->config['telegram']['bot_token'] !== '';
    }

    public function telegram(): Telegram
    {
        if (!$this->telegramEnabled()) {
            throw new \RuntimeException('Telegram is not enabled (telegram.enabled, telegram.bot_token).');
        }

        return $this->telegram ?? ($this->telegram = new Telegram((string) $this->config['telegram']['bot_token']));
    }

    public function bot(): TelegramBot
    {
        return $this->bot ?? ($this->bot = new TelegramBot($this));
    }

    public function adminTools(): AdminTools
    {
        return new AdminTools($this);
    }

    /**
     * Public URL of the public/ folder without a trailing slash.
     */
    public function baseUrl(): string
    {
        $configured = rtrim((string) $this->config['site']['base_url'], '/');
        if ($configured !== '') {
            return $configured;
        }
        if (PHP_SAPI === 'cli' || empty($_SERVER['HTTP_HOST'])) {
            return '';
        }
        $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (!empty($this->config['app']['trust_proxy_headers']) && ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
        $dir = rtrim(str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/'))), '/');

        return ($https ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST'] . $dir;
    }

    /**
     * Settings that are safe to expose to browsers and API clients.
     *
     * @return array<string,mixed>
     */
    public function publicConfig(): array
    {
        $site = $this->config['site'];
        $pay = $this->config['payments'];
        $tg = $this->config['telegram'];

        return [
            'site' => [
                'name' => (string) $site['name'],
                'tagline' => (string) $site['tagline'],
                'support_url' => (string) $site['support_url'],
                'logo_url' => (string) $site['logo_url'],
            ],
            'payments' => [
                'currency' => (string) $pay['currency'],
                'currency_symbol' => (string) $pay['currency_symbol'],
                'min_amount' => (float) $pay['min_amount'],
                'max_amount' => (float) $pay['max_amount'],
                'presets' => array_values(array_map('floatval', (array) $pay['presets'])),
                'credit_rate' => (float) $pay['credit_rate'],
                'bonus' => array_values((array) $pay['bonus']),
                'ask_email' => (bool) $pay['ask_email'],
            ],
            'telegram_bot' => $this->telegramEnabled() ? ltrim((string) $tg['bot_username'], '@') : '',
        ];
    }

    public function isAdminChat($chatId): bool
    {
        foreach ((array) $this->config['telegram']['admin_chat_ids'] as $admin) {
            if ((string) $admin === (string) $chatId) {
                return true;
            }
        }

        return false;
    }

    public function log(string $level, string $message, array $context = []): void
    {
        $file = (string) $this->config['app']['log_file'];
        if ($file === '') {
            return;
        }
        $line = json_encode([
            'time' => date('c'),
            'level' => $level,
            'message' => $message,
            'context' => $context,
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        @file_put_contents($file, $line . "\n", FILE_APPEND | LOCK_EX);
    }
}
