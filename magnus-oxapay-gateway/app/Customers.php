<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Telegram users of the bot and their links to MagnusBilling accounts.
 *
 * Accounts are linked only through single-use invite links that an admin creates
 * (t.me/<bot>?start=l_<token>), so nobody can attach themselves to someone else's account.
 */
final class Customers
{
    public const INVITE_TTL = 7 * 86400;

    /** @var App */
    private $app;

    public function __construct(App $app)
    {
        $this->app = $app;
    }

    private function t(string $name): string
    {
        return $this->app->db()->table($name);
    }

    /**
     * Records a private chat that talked to the bot (for "everyone who used the bot" messages).
     *
     * @param array<string,mixed> $from Telegram "from" object
     */
    public function touch(string $chatId, array $from): void
    {
        $db = $this->app->db();
        $now = time();
        $username = isset($from['username']) ? substr((string) $from['username'], 0, 64) : null;
        $name = isset($from['first_name']) ? substr((string) $from['first_name'], 0, 100) : null;
        $updated = $db->run(
            'UPDATE ' . $this->t('tg_users') . ' SET tg_username = COALESCE(?, tg_username), first_name = COALESCE(?, first_name), last_seen = ?, blocked = 0 WHERE chat_id = ?',
            [$username, $name, $now, $chatId]
        );
        if ($updated === 0 && $db->one('SELECT chat_id FROM ' . $this->t('tg_users') . ' WHERE chat_id = ?', [$chatId]) === null) {
            $db->insert('tg_users', [
                'chat_id' => $chatId,
                'tg_username' => $username,
                'first_name' => $name,
                'first_seen' => $now,
                'last_seen' => $now,
                'blocked' => 0,
            ]);
        }
    }

    public function createInvite(string $magnusUsername, string $actor): string
    {
        $token = bin2hex(random_bytes(8));
        $this->app->db()->insert('invites', [
            'token' => $token,
            'magnus_username' => $magnusUsername,
            'created_by' => substr($actor, 0, 100),
            'created_at' => time(),
            'expires_at' => time() + self::INVITE_TTL,
        ]);
        $this->app->log('info', 'Telegram invite created', ['user' => $magnusUsername, 'admin' => $actor]);

        return $token;
    }

    public function inviteLink(string $token): string
    {
        $bot = ltrim((string) $this->app->config['telegram']['bot_username'], '@');

        return 'https://t.me/' . $bot . '?start=l_' . $token;
    }

    /**
     * Links $chatId to the invite's account. Returns the MagnusBilling username, or null if the
     * invite is unknown, used or expired.
     */
    public function redeemInvite(string $token, string $chatId): ?string
    {
        if (!preg_match('/^[a-f0-9]{16}$/', $token)) {
            return null;
        }
        $db = $this->app->db();
        $claimed = $db->run(
            'UPDATE ' . $this->t('invites') . ' SET used_by = ?, used_at = ? WHERE token = ? AND used_by IS NULL AND expires_at >= ?',
            [$chatId, time(), $token, time()]
        );
        if ($claimed === 0) {
            return null;
        }
        $invite = $db->one('SELECT magnus_username FROM ' . $this->t('invites') . ' WHERE token = ?', [$token]);
        $username = (string) ($invite['magnus_username'] ?? '');
        $this->touch($chatId, []);
        $db->run(
            'UPDATE ' . $this->t('tg_users') . ' SET magnus_username = ?, linked_at = ? WHERE chat_id = ?',
            [$username, time(), $chatId]
        );
        $this->app->log('info', 'Telegram linked to account', ['user' => $username, 'chat' => $chatId]);

        return $username;
    }

    public function linkedUsername(string $chatId): ?string
    {
        $row = $this->app->db()->one('SELECT magnus_username FROM ' . $this->t('tg_users') . ' WHERE chat_id = ?', [$chatId]);
        $name = (string) ($row['magnus_username'] ?? '');

        return $name !== '' ? $name : null;
    }

    public function unlink(string $chatId): void
    {
        $this->app->db()->run('UPDATE ' . $this->t('tg_users') . ' SET magnus_username = NULL, linked_at = NULL WHERE chat_id = ?', [$chatId]);
    }

    /**
     * @return string[] chat IDs linked to a MagnusBilling account
     */
    public function chatsForUsername(string $magnusUsername): array
    {
        $rows = $this->app->db()->all(
            'SELECT chat_id FROM ' . $this->t('tg_users') . ' WHERE LOWER(magnus_username) = LOWER(?) AND blocked = 0',
            [$magnusUsername]
        );

        return array_map(static function (array $row): string {
            return (string) $row['chat_id'];
        }, $rows);
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function linked(int $limit = 20): array
    {
        $limit = max(1, min(100, $limit));

        return $this->app->db()->all(
            'SELECT * FROM ' . $this->t('tg_users') . ' WHERE magnus_username IS NOT NULL ORDER BY linked_at DESC LIMIT ' . $limit
        );
    }

    /**
     * Chat IDs for a broadcast: "linked" customers, or "all" private chats that used the bot
     * (including customers who paid through it before this list existed).
     *
     * @return string[]
     */
    public function audience(string $type): array
    {
        $db = $this->app->db();
        $where = $type === 'linked' ? 'magnus_username IS NOT NULL AND blocked = 0' : 'blocked = 0';
        $ids = array_map(static function (array $row): string {
            return (string) $row['chat_id'];
        }, $db->all('SELECT chat_id FROM ' . $this->t('tg_users') . ' WHERE ' . $where));

        if ($type !== 'linked') {
            $blocked = array_map(static function (array $row): string {
                return (string) $row['chat_id'];
            }, $db->all('SELECT chat_id FROM ' . $this->t('tg_users') . ' WHERE blocked = 1'));
            foreach ($db->all('SELECT DISTINCT tg_chat_id FROM ' . $this->t('orders') . " WHERE tg_chat_id IS NOT NULL AND tg_chat_id <> ''") as $row) {
                $id = (string) $row['tg_chat_id'];
                if (strpos($id, '-') !== 0 && !in_array($id, $blocked, true)) {
                    $ids[] = $id;
                }
            }
        }

        return array_values(array_unique($ids));
    }

    public function markBlocked(string $chatId): void
    {
        $this->app->db()->run('UPDATE ' . $this->t('tg_users') . ' SET blocked = 1 WHERE chat_id = ?', [$chatId]);
    }

    /**
     * @return array{users:int, linked:int}
     */
    public function counts(): array
    {
        return [
            'users' => count($this->audience('all')),
            'linked' => count($this->audience('linked')),
        ];
    }
}
