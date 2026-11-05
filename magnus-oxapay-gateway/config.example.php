<?php

/**
 * Copy this file to config.php and fill in your values.
 * Never commit config.php or share it: it contains your API keys.
 */

return [

    // ---------------------------------------------------------------- website
    'site' => [
        'name' => 'Unity Carrier',
        'tagline' => 'Top up your VoIP balance with crypto',
        // Public URL of the public/ folder, no trailing slash. OxaPay sends payment callbacks to {base_url}/webhook.php.
        'base_url' => 'https://www.unitycarrier.com/pay',
        'support_url' => 'https://www.unitycarrier.com',
        'logo_url' => '',            // optional, e.g. https://www.unitycarrier.com/logo.png
        // Website look: 'voip' (midnight blue), 'emerald', 'violet', 'luxury' (gold) or 'light'.
        // Telegram admins can switch it under Admin panel > Settings > Website theme.
        'theme' => 'voip',
        'accent' => '#4f46e5',       // button colour for the classic theme
        'announcement' => '',        // optional banner, e.g. '5% bonus on top-ups over $100 this week'
        'timezone' => 'UTC',
    ],

    // --------------------------------------------------------------- payments
    'payments' => [
        'currency' => 'USD',          // invoice currency sent to OxaPay
        'currency_symbol' => '$',
        'min_amount' => 5,
        'max_amount' => 1000,
        'presets' => [10, 25, 50, 100],   // quick-pick buttons on the website and in Telegram
        // MagnusBilling credit added per 1 unit of currency. Keep 1 if Magnus also bills in USD.
        'credit_rate' => 1,
        // Optional bonus tiers. The highest matching tier applies.
        'bonus' => [
            // ['min' => 100, 'percent' => 5],
            // ['min' => 250, 'percent' => 10],
        ],
        'ask_email' => false,         // show an optional email field (OxaPay emails the receipt)
        // Coin badges shown on the payment page (the checkout itself lists everything OxaPay supports)
        'coins' => ['USDT', 'BTC', 'ETH', 'TRX', 'LTC', 'BNB', 'TON', 'DOGE'],
        // Text stored on the MagnusBilling refill. Must contain {order} (used to prevent double credit).
        'refill_description' => 'OxaPay top-up #{order} (track {track})',
    ],

    // ------------------------------------------------------------ MagnusBilling
    // Create the key in MagnusBilling: Settings > API. Use an admin user, set "Action" to "cr"
    // (create + read) and restrict it to this server's IP address.
    'magnus' => [
        'url' => 'http://127.0.0.1/mbilling',   // same server; otherwise https://your-magnus-host/mbilling
        'api_key' => '',
        'api_secret' => '',
        'verify_ssl' => true,                    // set false only for a self-signed certificate
        // Seconds to wait when saving. MagnusBilling emails the customer before it answers a refill,
        // so a slow mail server makes saves slow. Late answers are still detected and not repeated.
        'write_timeout' => 120,
    ],

    // ----------------------------------------------------------------- OxaPay
    // OxaPay dashboard > Merchant Service > create an API key.
    'oxapay' => [
        'merchant_api_key' => '',
        'lifetime' => 60,               // invoice lifetime in minutes (15 - 2880)
        'fee_paid_by_payer' => 1,       // 1 = customer pays the OxaPay fee, 0 = you pay it
        'under_paid_coverage' => 0,     // accept payments up to this % short (0 - 60)
        'to_currency' => '',            // e.g. 'USDT' to auto-convert received coins
        'mixed_payment' => true,        // allow paying the remainder with another coin
        'sandbox' => false,             // true = OxaPay test mode, no real money
        'verify_with_api' => true,      // re-check every webhook with OxaPay's payment-information API
    ],

    // --------------------------------------------------------------- Telegram
    // 1. Create a bot with @BotFather and paste the token.
    // 2. Send /id to your bot to get your chat ID and put it in admin_chat_ids.
    // 3. Run: php bin/cli.php telegram:webhook
    'telegram' => [
        'enabled' => false,
        'bot_token' => '',
        'bot_username' => '',           // without @, shown as a link on the website
        'webhook_secret' => '',         // any long random string (php bin/cli.php secret)
        'admin_chat_ids' => [],         // e.g. [123456789] - get payment alerts and admin commands
        'notify_admins' => true,
    ],

    // ---------------------------------------------------------------- JSON API
    'api' => [
        // API keys for your own systems (CRM, WHMCS, another bot...). Generate with: php bin/cli.php secret
        'keys' => [
            // 'paste-a-long-random-key-here' => 'crm',
        ],
        // Websites allowed to call the API from the browser, e.g. ['https://www.unitycarrier.com']
        'cors_origins' => [],
        // Per-IP limits for calls without an API key: [requests, seconds]
        'rate_limits' => [
            'check_user' => [60, 600],
            'create_payment' => [10, 600],
            'order' => [300, 600],
        ],
    ],

    // --------------------------------------------------------------- database
    // SQLite needs php-sqlite3. To use MySQL/MariaDB instead:
    //   'dsn' => 'mysql:host=127.0.0.1;dbname=oxapay_gateway;charset=utf8mb4', 'username' => '...', 'password' => '...'
    'database' => [
        'dsn' => 'sqlite:' . __DIR__ . '/data/gateway.sqlite',
        'username' => null,
        'password' => null,
        'prefix' => 'oxg_',
    ],

    'app' => [
        'log_file' => __DIR__ . '/data/gateway.log',
        // true only behind Cloudflare or a reverse proxy, so rate limits use the visitor's real IP
        'trust_proxy_headers' => false,
    ],
];
