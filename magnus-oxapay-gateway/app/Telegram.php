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
