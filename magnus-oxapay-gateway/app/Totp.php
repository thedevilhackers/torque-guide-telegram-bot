<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Time-based one-time codes (RFC 6238: SHA-1, 6 digits, 30 seconds), the same kind MagnusBilling checks
 * at login, so codes from Google Authenticator, Microsoft Authenticator, Authy, etc. work with it.
 */
final class Totp
{
    private const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

    /** New random secret: 32 base32 characters (160 bits). */
    public static function secret(): string
    {
        $bytes = random_bytes(20);

        return self::base32Encode($bytes);
    }

    public static function code(string $secret, ?int $slice = null): string
    {
        $slice = $slice ?? intdiv(time(), 30);
        $key = self::base32Decode($secret);
        $hash = hash_hmac('sha1', pack('N*', 0) . pack('N*', $slice), $key, true);
        $offset = ord($hash[19]) & 0x0f;
        $value = ((ord($hash[$offset]) & 0x7f) << 24)
            | ((ord($hash[$offset + 1]) & 0xff) << 16)
            | ((ord($hash[$offset + 2]) & 0xff) << 8)
            | (ord($hash[$offset + 3]) & 0xff);

        return str_pad((string) ($value % 1000000), 6, '0', STR_PAD_LEFT);
    }

    /**
     * Checks a code, allowing $window steps (30 s each) of clock difference either way.
     */
    public static function verify(string $secret, string $code, int $window = 1, ?int $now = null): bool
    {
        $code = preg_replace('/\s+/', '', $code) ?? '';
        if (!preg_match('/^\d{6}$/', $code) || strlen(self::base32Decode($secret)) < 10) {
            return false;
        }
        $slice = intdiv($now ?? time(), 30);
        for ($i = -$window; $i <= $window; $i++) {
            if (hash_equals(self::code($secret, $slice + $i), $code)) {
                return true;
            }
        }

        return false;
    }

    /** otpauth:// link for authenticator apps (shown as a QR code). */
    public static function uri(string $secret, string $account, string $issuer): string
    {
        $label = rawurlencode($issuer) . ':' . rawurlencode($account);

        return 'otpauth://totp/' . $label . '?secret=' . $secret . '&issuer=' . rawurlencode($issuer) . '&algorithm=SHA1&digits=6&period=30';
    }

    private static function base32Encode(string $bytes): string
    {
        $bits = '';
        foreach (str_split($bytes) as $char) {
            $bits .= str_pad(decbin(ord($char)), 8, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 5) as $chunk) {
            $out .= self::ALPHABET[bindec(str_pad($chunk, 5, '0'))];
        }

        return $out;
    }

    private static function base32Decode(string $secret): string
    {
        $secret = strtoupper(rtrim(preg_replace('/\s+/', '', $secret) ?? '', '='));
        if ($secret === '' || strspn($secret, self::ALPHABET) !== strlen($secret)) {
            return '';
        }
        $bits = '';
        foreach (str_split($secret) as $char) {
            $bits .= str_pad(decbin(strpos(self::ALPHABET, $char)), 5, '0', STR_PAD_LEFT);
        }
        $out = '';
        foreach (str_split($bits, 8) as $byte) {
            if (strlen($byte) === 8) {
                $out .= chr(bindec($byte));
            }
        }

        return $out;
    }
}
