<?php

declare(strict_types=1);

namespace Gateway;

/**
 * The bot's Telegram profile:
 *   - description:       shown in an empty chat under "What can this bot do?" (up to 512 characters)
 *   - short description: the "About" text on the bot's profile and in shared links (up to 120 characters)
 *   - command menus:     the "/" menu, with extra commands for admins and view-only admins in their own chats
 *   - name (optional):   the bot's display name, only changed when telegram.name is set
 *
 * Texts come from telegram.description / telegram.short_description (config.php, or Admin panel > Settings > Bot profile).
 * Empty = the standard texts below, built from the company name and coins.
 *
 * Applied by bin/cli.php telegram:webhook, telegram:poll and telegram:profile (install.sh runs telegram:webhook),
 * and right after an admin changes a text in the bot.
 */
final class BotProfile
{
    public const DESCRIPTION_MAX = 512;
    public const SHORT_DESCRIPTION_MAX = 120;
    public const NAME_MAX = 64;

    private const CUSTOMER_COMMANDS = [
        'topup' => 'Top up an account',
        'myorders' => 'My payments',
        'myaccount' => 'My account: balance, SIP lines, caller ID',
        'status' => 'Check a payment by order ID',
        'support' => 'Message our support team',
        'invite' => 'Invite friends, get bonus credit',
        'help' => 'Menu and help',
        'cancel' => 'Stop the current step',
    ];

    /** Admin commands, in menu order. Those marked true are also open to view-only admins. */
    private const ADMIN_COMMANDS = [
        'admin' => ['Admin panel', true],
        'recent' => ['Latest payments', true],
        'stats' => ['Takings and totals', true],
        'find' => ['Find a customer: /find username', true],
        'balance' => ['Account balance: /balance username', true],
        'order' => ['Order details: /order id', true],
        'sip' => ['SIP accounts: /sip name or username', true],
        'live' => ['Calls in progress', true],
        'addcredit' => ['Add credit: /addcredit username amount', false],
        'removecredit' => ['Remove credit: /removecredit username amount', false],
        'callerid' => ['Change caller ID: /callerid sip number', false],
        'retry' => ['Re-check and credit an order: /retry id', false],
        'markpaid' => ['Credit an order by hand: /markpaid id', false],
        'report' => ['Send the daily report now', false],
        'fraud' => ['Fraud guard settings', true],
        'limit' => ['Daily spending limit: /limit username amount', false],
    ];

    /** Legal suffixes left out of the company name in the bot texts. */
    private const LEGAL_SUFFIX = '/[\s,]+(llc|l\.l\.c\.|ltd\.?|limited|inc\.?|incorporated|corp\.?|gmbh|s\.?r\.?l\.?|s\.?a\.?|b\.?v\.?|plc|pvt\.?|ou|oü|fze|fzco|fz-llc)$/iu';

    /** @var App */
    private $app;

    public function __construct(App $app)
    {
        $this->app = $app;
        try {
            $app->db(); // loads texts changed in the bot (Settings) on top of config.php
        } catch (\Throwable $e) {
        }
    }

    // ------------------------------------------------------------------ texts

    public function description(): string
    {
        $custom = trim((string) ($this->app->config['telegram']['description'] ?? ''));

        return $custom !== '' ? self::cut($custom, self::DESCRIPTION_MAX) : $this->defaultDescription();
    }

    public function shortDescription(): string
    {
        $custom = trim((string) ($this->app->config['telegram']['short_description'] ?? ''));

        return $custom !== '' ? self::cut($custom, self::SHORT_DESCRIPTION_MAX) : $this->defaultShortDescription();
    }

    public function isCustom(string $which): bool
    {
        $key = $which === 'short' ? 'short_description' : 'description';

        return trim((string) ($this->app->config['telegram'][$key] ?? '')) !== '';
    }

    public function defaultDescription(): string
    {
        $brand = $this->brand();
        $lines = [
            '⚡ Instant top-ups for your ' . ($brand !== '' ? $brand . ' ' : '') . 'VoIP account.',
            '',
            '💳 Pay with ' . $this->coinList() . '. Your balance updates automatically once the payment confirms.',
            '🧾 Track every payment and get a message the moment your credit lands.',
            '👤 Link your account to check your balance, SIP lines and caller ID.',
            '🆘 Chat with our support team right here.',
        ];
        $site = $this->siteAddress();
        if ($site !== '') {
            $lines[] = '🌐 ' . $site;
        }
        $lines[] = '';
        $lines[] = 'Tap START to top up.';
        $text = implode("\n", $lines);
        if (self::length($text) > self::DESCRIPTION_MAX) {
            // Very long company name: drop it rather than cut the text mid-sentence.
            $lines[0] = '⚡ Instant top-ups for your VoIP account.';
            $text = implode("\n", $lines);
        }

        return self::cut($text, self::DESCRIPTION_MAX);
    }

    public function defaultShortDescription(): string
    {
        $brand = $this->brand();
        $tail = ' Balance, payments and support in one chat.';
        foreach ([$brand !== '' ? $brand . ' ' : '', ''] as $name) {
            $text = 'Instant crypto top-ups for your ' . $name . 'VoIP account.' . $tail;
            if (self::length($text) <= self::SHORT_DESCRIPTION_MAX) {
                return $text;
            }
        }

        return self::cut('Instant crypto top-ups for your VoIP account.', self::SHORT_DESCRIPTION_MAX);
    }

    /**
     * Company name without legal suffixes, e.g. "UNITY CARRIER LLC" -> "UNITY CARRIER".
     */
    public function brand(): string
    {
        $name = trim((string) ($this->app->config['site']['name'] ?? ''));
        $short = trim((string) preg_replace(self::LEGAL_SUFFIX, '', $name));

        return $short !== '' ? $short : $name;
    }

    /**
     * @return array<int, array{command:string, description:string}>
     */
    public function commands(string $who = 'customer'): array
    {
        $out = [];
        foreach (self::CUSTOMER_COMMANDS as $command => $description) {
            $out[] = ['command' => $command, 'description' => $description];
        }
        if ($who === 'admin' || $who === 'viewer') {
            foreach (self::ADMIN_COMMANDS as $command => [$description, $viewer]) {
                if ($who === 'admin' || $viewer) {
                    $out[] = ['command' => $command, 'description' => $description];
                }
            }
        }

        return $out;
    }

    // ------------------------------------------------------------------ apply

    /**
     * Sends the profile to Telegram.
     *
     * @return array{done: string[], warnings: string[]}
     */
    public function apply(): array
    {
        $tg = $this->app->telegram();
        $done = [];
        $warnings = [];

        $name = trim((string) ($this->app->config['telegram']['name'] ?? ''));
        if ($name !== '') {
            try {
                $current = $tg->call('getMyName');
                if (!is_array($current) || (string) ($current['name'] ?? '') !== self::cut($name, self::NAME_MAX)) {
                    $tg->call('setMyName', ['name' => self::cut($name, self::NAME_MAX)]);
                    $done[] = 'name set to ' . self::cut($name, self::NAME_MAX);
                }
            } catch (\Throwable $e) {
                // Telegram limits how often a bot can be renamed.
                $warnings[] = 'name not changed: ' . $e->getMessage();
            }
        }

        foreach ([
            ['setMyDescription', ['description' => $this->description()], 'description'],
            ['setMyShortDescription', ['short_description' => $this->shortDescription()], 'about text'],
            ['setMyCommands', ['commands' => $this->commands('customer')], 'command menu'],
        ] as [$method, $params, $label]) {
            try {
                $tg->call($method, $params);
                $done[] = $label;
            } catch (\Throwable $e) {
                $warnings[] = $label . ' not set: ' . $e->getMessage();
            }
        }

        // Admins and view-only admins get their commands in their own chats.
        $admins = array_map('strval', (array) ($this->app->config['telegram']['admin_chat_ids'] ?? []));
        $viewers = array_diff(array_map('strval', (array) ($this->app->config['telegram']['viewer_chat_ids'] ?? [])), $admins);
        $set = 0;
        $chats = [];
        foreach ([['admin', $admins], ['viewer', $viewers]] as [$who, $ids]) {
            foreach (array_unique($ids) as $chat) {
                if (!preg_match('/^-?\d{1,20}$/', $chat)) {
                    continue;
                }
                $chats[] = $chat;
                try {
                    $tg->call('setMyCommands', ['commands' => $this->commands($who), 'scope' => ['type' => 'chat', 'chat_id' => (int) $chat]]);
                    $set++;
                } catch (\Throwable $e) {
                    $warnings[] = 'admin menu for chat ' . $chat . ' not set (the admin needs to open the bot and press Start first): ' . $e->getMessage();
                }
            }
        }
        if ($set > 0) {
            $done[] = 'admin command menu in ' . $set . ' chat' . ($set === 1 ? '' : 's');
        }

        // Chats removed from the admin lists go back to the customer menu.
        try {
            $db = $this->app->db();
            $previous = json_decode((string) $db->kvGet('bot:command_chats'), true);
            foreach (array_diff(is_array($previous) ? array_map('strval', $previous) : [], $chats) as $old) {
                try {
                    $tg->call('deleteMyCommands', ['scope' => ['type' => 'chat', 'chat_id' => (int) $old]]);
                } catch (\Throwable $e) {
                }
            }
            $db->kvSet('bot:command_chats', (string) json_encode(array_values($chats)));
        } catch (\Throwable $e) {
            $warnings[] = 'could not update the list of admin menus: ' . $e->getMessage();
        }

        return ['done' => $done, 'warnings' => $warnings];
    }

    // ---------------------------------------------------------------- helpers

    private function coinList(): string
    {
        $coins = array_values(array_filter(array_map(static function ($coin): string {
            return strtoupper(trim((string) $coin));
        }, (array) ($this->app->config['payments']['coins'] ?? []))));
        if ($coins === []) {
            return 'crypto';
        }

        return implode(', ', array_slice($coins, 0, 3)) . (count($coins) > 1 ? ' and more' : '');
    }

    /** Website address without https://, e.g. "pay.unitycarrier.com". Empty if the site is not on https. */
    private function siteAddress(): string
    {
        $base = $this->app->baseUrl();
        if (strpos($base, 'https://') !== 0) {
            return '';
        }

        return rtrim(substr($base, 8), '/');
    }

    public static function length(string $text): int
    {
        return function_exists('mb_strlen') ? mb_strlen($text, 'UTF-8') : strlen($text);
    }

    private static function cut(string $text, int $max): string
    {
        if (self::length($text) <= $max) {
            return $text;
        }

        return rtrim(function_exists('mb_substr') ? mb_substr($text, 0, $max - 1, 'UTF-8') : substr($text, 0, $max - 1)) . '…';
    }
}
