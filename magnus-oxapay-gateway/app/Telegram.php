<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Telegram Bot API client.
 */
final class Telegram
{
    /** @var string */
    private $token;

    public function __construct(string $token)
    {
        $this->token = $token;
    }

    /**
     * @return mixed the "result" field
     */
    public function call(string $method, array $params = [], int $timeout = 20)
    {
        $response = Http::request(
            'POST',
            'https://api.telegram.org/bot' . $this->token . '/' . $method,
            ['Content-Type: application/json'],
            (string) json_encode($params, JSON_UNESCAPED_UNICODE),
            $timeout
        );
        $json = json_decode($response['body'], true);
        if (!is_array($json) || empty($json['ok'])) {
            $description = is_array($json) ? (string) ($json['description'] ?? 'unknown error') : 'invalid response';
            throw new \RuntimeException("Telegram {$method} failed: {$description}");
        }

        return $json['result'] ?? null;
    }

    /**
     * Sends a file (up to 50 MB, Telegram's limit for bots).
     */
    public function sendDocument($chatId, string $path, string $caption = ''): void
    {
        $response = Http::upload(
            'https://api.telegram.org/bot' . $this->token . '/sendDocument',
            ['chat_id' => (string) $chatId, 'document' => ['file' => $path], 'caption' => $caption, 'parse_mode' => 'HTML']
        );
        $json = json_decode($response['body'], true);
        if (!is_array($json) || empty($json['ok'])) {
            throw new \RuntimeException('Telegram sendDocument failed: ' . (is_array($json) ? (string) ($json['description'] ?? 'unknown error') : 'invalid response'));
        }
    }

    /**
     * What to do about a Telegram error for one chat, e.g. " (that admin must open the bot and press Start ...)".
     */
    public static function chatProblemHint(string $error): string
    {
        $error = strtolower($error);
        $hints = [
            "chat not found" => 'that person must open the bot and press Start, or the chat ID is wrong',
            "can't initiate conversation" => 'that person must open the bot and press Start first',
            'blocked by the user' => 'that person blocked the bot: they must unblock it and press Start',
            'user is deactivated' => 'that Telegram account was deleted: remove the ID from telegram.admin_chat_ids',
            'not a member' => 'the bot is not in that group or channel any more: add it back or remove the ID',
            'kicked' => 'the bot was removed from that group: add it back or remove the ID',
            'too big' => 'the file is too big for Telegram',
            'entity too large' => 'the file is too big for Telegram',
        ];
        foreach ($hints as $needle => $hint) {
            if (strpos($error, $needle) !== false) {
                return ' (' . $hint . ')';
            }
        }

        return '';
    }

    /**
     * @param array<string,mixed> $extra e.g. ['reply_markup' => [...]]
     */
    public function sendMessage($chatId, string $html, array $extra = []): void
    {
        $this->call('sendMessage', array_merge([
            'chat_id' => $chatId,
            'text' => $html,
            'parse_mode' => 'HTML',
            'disable_web_page_preview' => true,
        ], $extra));
    }

    public function answerCallback(string $callbackId, string $text = '', bool $alert = false): void
    {
        $params = ['callback_query_id' => $callbackId];
        if ($text !== '') {
            $params['text'] = function_exists('mb_substr') ? mb_substr($text, 0, 200) : substr($text, 0, 200);
            $params['show_alert'] = $alert;
        }
        $this->call('answerCallbackQuery', $params);
    }
}
