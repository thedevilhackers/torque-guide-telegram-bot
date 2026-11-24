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

    /**
     * multipart/form-data POST with files. A field given as ['file' => '/path'] is uploaded as a file.
     *
     * @param array<string, string|array{file:string}> $fields
     */
    public static function upload(string $url, array $fields, int $timeout = 600): array
    {
        if (self::$transport !== null) {
            return (self::$transport)('POST', $url, ['Content-Type: multipart/form-data'], (string) json_encode($fields));
        }
        $post = [];
        foreach ($fields as $name => $value) {
            $post[$name] = is_array($value) ? new \CURLFile((string) $value['file'], 'application/octet-stream', basename((string) $value['file'])) : (string) $value;
        }
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $post,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_USERAGENT => 'MagnusOxaPayGateway/1.0',
        ]);
        $response = curl_exec($ch);
        if ($response === false) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new \RuntimeException('Upload to ' . parse_url($url, PHP_URL_HOST) . " failed: {$error}");
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        return ['status' => $status, 'body' => (string) $response];
    }
}
