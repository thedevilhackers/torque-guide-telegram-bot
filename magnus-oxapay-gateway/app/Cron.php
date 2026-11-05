<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Scheduled jobs, run every 5 minutes by cron:  php bin/cli.php cron
 *
 * - re-checks unpaid OxaPay orders (a missed webhook still gets credited)
 * - low-balance alerts to customers who linked Telegram
 * - daily report to admins at telegram.report_hour
 * - health alerts when MagnusBilling or OxaPay stop answering (and when they are back)
 */
final class Cron
{
    /** @var App */
    private $app;

    public function __construct(App $app)
    {
        $this->app = $app;
    }

    /**
     * @return string[] what was done, for the command line
     */
    public function run(): array
    {
        $out = [];
        $jobs = [
            'orders' => function (): string {
                return $this->app->payments()->syncOpenOrders() . ' open orders re-checked';
            },
            'health' => function (): string {
                return $this->health();
            },
            'low_balance' => function (): string {
                return $this->lowBalance();
            },
            'report' => function (): string {
                return $this->dailyReport();
            },
        ];
        foreach ($jobs as $name => $job) {
            try {
                $out[] = $name . ': ' . $job();
            } catch (\Throwable $e) {
                $this->app->log('error', 'Scheduled job failed', ['job' => $name, 'error' => $e->getMessage()]);
                $out[] = $name . ': failed - ' . $e->getMessage();
            }
        }

        return $out;
    }

    private function telegram(): bool
    {
        return $this->app->telegramEnabled();
    }

    public function lowBalance(): string
    {
        $threshold = (float) ($this->app->config['payments']['low_balance'] ?? 0);
        if ($threshold <= 0 || !$this->telegram()) {
            return 'off';
        }
        $db = $this->app->db();
        $customers = $this->app->customers();
        $usernames = [];
        foreach ($customers->linked(100) as $row) {
            if (!$row['blocked']) {
                $usernames[strtolower((string) $row['magnus_username'])] = (string) $row['magnus_username'];
            }
        }
        $alerted = 0;
        foreach ($usernames as $key => $username) {
            $user = $this->app->magnus()->findUser($username);
            if ($user === null) {
                continue;
            }
            $credit = (float) ($user['credit'] ?? 0);
            $flag = 'lowbal:' . $key;
            if ($credit >= $threshold) {
                $db->kvSet($flag, null);
                continue;
            }
            if ($db->kvGet($flag) !== null) {
                continue;
            }
            $db->kvSet($flag, number_format($credit, 2, '.', ''));
            foreach ($customers->chatsForUsername($username) as $chat) {
                try {
                    $this->app->bot()->lowBalanceAlert($chat, (string) $user['username'], $credit);
                    $alerted++;
                } catch (\Throwable $e) {
                    if (preg_match('/blocked|deactivated|chat not found|Forbidden/i', $e->getMessage())) {
                        $customers->markBlocked($chat);
                    }
                }
            }
        }

        return count($usernames) . ' linked accounts checked, ' . $alerted . ' alerts sent';
    }

    public function dailyReport(bool $force = false): string
    {
        $hour = (int) ($this->app->config['telegram']['report_hour'] ?? 9);
        if (!$this->telegram() || ($hour < 0 && !$force)) {
            return 'off';
        }
        $db = $this->app->db();
        $today = date('Y-m-d');
        if (!$force && ((int) date('G') < $hour || $db->kvGet('report:last') === $today)) {
            return 'not due';
        }
        $db->kvSet('report:last', $today);
        $this->app->bot()->dailyReport();

        return 'sent';
    }

    public function health(): string
    {
        $checks = [
            'MagnusBilling' => function (): void {
                $this->app->magnus()->read('user', [], 1);
            },
            'OxaPay' => function (): void {
                $this->app->oxapay()->acceptedCurrencies();
            },
        ];
        $db = $this->app->db();
        $states = [];
        foreach ($checks as $service => $check) {
            $key = 'health:' . strtolower($service);
            $failures = (int) ($db->kvGet($key . ':fails') ?? 0);
            $alerted = $db->kvGet($key . ':alerted') === '1';
            try {
                $check();
                $db->kvSet($key . ':fails', null);
                if ($alerted) {
                    $db->kvSet($key . ':alerted', null);
                    $this->alert('✅ <b>' . $service . ' is answering again.</b>');
                }
                $states[] = $service . ' ok';
            } catch (\Throwable $e) {
                $failures++;
                $db->kvSet($key . ':fails', (string) $failures);
                $db->kvSet($key . ':error', substr($e->getMessage(), 0, 500));
                if ($failures >= 2 && !$alerted) {
                    $db->kvSet($key . ':alerted', '1');
                    $this->alert('🚨 <b>' . $service . " is not answering</b>\n" . htmlspecialchars($e->getMessage(), ENT_QUOTES, 'UTF-8')
                        . "\nPayments are kept and retried automatically. I will tell you when it is back.");
                }
                $states[] = $service . ' failing (' . $failures . ')';
            }
        }

        return implode(', ', $states);
    }

    private function alert(string $html): void
    {
        if ($this->telegram()) {
            $this->app->bot()->broadcastAdmins($html);
        }
    }
}
