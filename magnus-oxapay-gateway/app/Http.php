<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Minimal cURL wrapper. Tests swap the transport for a fake.
 */
final class Http
{
    /** @var callable|null */
    private static $transport = null;

    public static function setTransport(?callable $transport): void
    {
        self::$transport = $transport;
    }

    /**
     * @param string[] $headers "Name: value" lines
     * @return array{status:int, body:string}
     */
    public static function request(
        string $method,
        string $url,
        array $headers = [],
        ?string $body = null,
        int $timeout = 20,
        bool $verifySsl = true
    ): array {
        if (self::$transport !== null) {
            return (self::$transport)($method, $url, $headers, $body);
        }

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_SSL_VERIFYPEER => $verifySsl,
            CURLOPT_SSL_VERIFYHOST => $verifySsl ? 2 : 0,
            CURLOPT_USERAGENT => 'MagnusOxaPayGateway/1.0',
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }

        $response = curl_exec($ch);
        if ($response === false) {
            $error = curl_error($ch);
            curl_close($ch);
            // Only the host is reported: Telegram URLs contain the bot token.
            $host = (string) parse_url($url, PHP_URL_HOST);
            throw new \RuntimeException("Request to {$host} failed: {$error}");
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        return ['status' => $status, 'body' => (string) $response];
    }
}
