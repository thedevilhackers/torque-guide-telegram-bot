<?php

declare(strict_types=1);

namespace Gateway;

/**
 * OxaPay merchant API v1 client (https://api.oxapay.com/v1).
 *
 * - Invoices:  POST payment/invoice     (header merchant_api_key)
 * - Lookup:    GET  payment/{track_id}
 * - Webhooks:  header "HMAC" = hex HMAC-SHA512 of the raw body, keyed with the merchant API key
 */
final class OxaPay
{
    /** @var string */
    private $apiKey;
    /** @var string */
    private $baseUrl;

    public function __construct(array $config)
    {
        $this->apiKey = (string) ($config['merchant_api_key'] ?? '');
        $this->baseUrl = rtrim((string) ($config['base_url'] ?? 'https://api.oxapay.com/v1'), '/');
    }

    /**
     * @param array<string,mixed> $invoice
     * @return array{track_id:string, payment_url:string, expired_at:?int}
     */
    public function createInvoice(array $invoice): array
    {
        $data = $this->request('POST', 'payment/invoice', $invoice);
        if (empty($data['track_id']) || empty($data['payment_url'])) {
            throw new \RuntimeException('OxaPay did not return a payment link.');
        }

        return [
            'track_id' => (string) $data['track_id'],
            'payment_url' => (string) $data['payment_url'],
            'expired_at' => isset($data['expired_at']) ? (int) $data['expired_at'] : null,
        ];
    }

    /**
     * @return array<string,mixed> payment details (status, amount, currency, order_id, ...)
     */
    public function paymentInfo(string $trackId): array
    {
        return $this->request('GET', 'payment/' . rawurlencode($trackId));
    }

    /**
     * @return array<string,mixed>
     */
    public function acceptedCurrencies(): array
    {
        return $this->request('GET', 'payment/accepted-currencies');
    }

    public function verifyWebhook(string $rawBody, ?string $hmacHeader): bool
    {
        if ($this->apiKey === '' || $hmacHeader === null || trim($hmacHeader) === '') {
            return false;
        }

        $expected = hash_hmac('sha512', $rawBody, $this->apiKey);

        return hash_equals($expected, strtolower(trim($hmacHeader)));
    }

    /**
     * @return array<string,mixed> the "data" object of the response
     */
    private function request(string $method, string $path, ?array $body = null): array
    {
        if ($this->apiKey === '') {
            throw new \RuntimeException('OxaPay is not configured (oxapay.merchant_api_key).');
        }

        $response = Http::request(
            $method,
            $this->baseUrl . '/' . $path,
            [
                'merchant_api_key: ' . $this->apiKey,
                'Content-Type: application/json',
                'Accept: application/json',
            ],
            $body === null ? null : (string) json_encode($body),
            30
        );

        $json = json_decode($response['body'], true);
        if (!is_array($json)) {
            throw new \RuntimeException('OxaPay returned an unexpected response (HTTP ' . $response['status'] . ').');
        }
        if ($response['status'] >= 400 || (isset($json['status']) && (int) $json['status'] >= 400)) {
            $message = (string) ($json['message'] ?? 'request failed');
            if (!empty($json['error']['message'])) {
                $message .= ': ' . $json['error']['message'];
            }
            throw new \RuntimeException('OxaPay error (HTTP ' . $response['status'] . '): ' . $message);
        }

        return isset($json['data']) && is_array($json['data']) ? $json['data'] : [];
    }

    /**
     * Normalises OxaPay statuses ("Paid", "Manual_accept", "paying", ...) to lower_snake_case.
     */
    public static function normalizeStatus($status): string
    {
        return strtolower(str_replace([' ', '-'], '_', trim((string) $status)));
    }
}
