<?php

declare(strict_types=1);

namespace Gateway;

/**
 * MagnusBilling admin operations used by the Telegram admin commands:
 * look up SIP accounts, change their caller ID, add or remove credit, and credit an order by hand.
 * Every change is written to the gateway log with the admin who made it.
 */
final class AdminTools
{
    /** @var App */
    private $app;

    public function __construct(App $app)
    {
        $this->app = $app;
    }

    /**
     * Finds SIP accounts by SIP username, or all SIP accounts of a MagnusBilling username.
     *
     * @return array<int,array<string,mixed>>
     */
    public function findSipAccounts(string $query): array
    {
        $query = $this->app->payments()->normalizeUsername($query);
        $magnus = $this->app->magnus();

        try {
            $sip = $magnus->findSip($query);
            if ($sip !== null) {
                return [$sip];
            }
            $user = $magnus->findUser($query);

            return $user !== null && isset($user['id']) ? $magnus->sipAccountsForUser((int) $user['id']) : [];
        } catch (\Throwable $e) {
            throw $this->billingError($e);
        }
    }

    /**
     * Caller ID as MagnusBilling stores it: digits, optionally starting with +.
     */
    public function normalizeCallerId(string $raw): string
    {
        $callerId = (string) preg_replace('/[\s().\-]/', '', $raw);
        if (!preg_match('/^\+?\d{3,20}$/', $callerId)) {
            throw new UserError('invalid_callerid', 'Caller ID must be 3 to 20 digits, optionally starting with +.');
        }

        return $callerId;
    }

    /**
     * @param array<string,mixed> $sip
     * @return array<string,mixed> the SIP account after the change
     */
    public function setCallerId(array $sip, string $callerId, string $actor): array
    {
        $callerId = $this->normalizeCallerId($callerId);
        $magnus = $this->app->magnus();

        try {
            $magnus->updateRecord('sip', (int) $sip['id'], ['callerid' => $callerId]);
            $updated = $magnus->findSip((string) $sip['name']) ?? array_merge($sip, ['callerid' => $callerId]);
        } catch (\Throwable $e) {
            throw $this->billingError($e);
        }

        $this->app->log('info', 'Admin changed caller ID', [
            'sip' => $sip['name'], 'old' => $sip['callerid'] ?? null, 'new' => $callerId, 'admin' => $actor,
        ]);

        return $updated;
    }

    /**
     * @return string signed amount with up to 4 decimals, e.g. "25" or "-3.5"
     */
    public function parseCreditAmount(string $raw): string
    {
        $text = str_replace(',', '.', trim($raw));
        if (!preg_match('/^[+-]?\d{1,7}(\.\d{1,4})?$/', $text) || (float) $text == 0.0) {
            throw new UserError('invalid_amount', 'Enter a non-zero amount such as 25, 2.50 or -10.');
        }

        return Payments::formatCredit((float) $text);
    }

    /**
     * Adds (positive) or removes (negative) credit through a MagnusBilling refill.
     *
     * @param array<string,mixed> $user MagnusBilling user row
     * @return array<string,mixed> the user row after the change (with the new credit)
     */
    public function adjustCredit(array $user, string $amount, string $note, string $actor): array
    {
        $amount = $this->parseCreditAmount($amount);
        $note = trim((string) preg_replace('/[^\p{L}\p{N} .,:#_\-\/]/u', '', $note));
        $description = substr('Telegram admin ' . $actor . ': ' . ($note !== '' ? $note : 'manual credit'), 0, 200);
        if (!MagnusBilling::isSafeValue($description)) {
            $description = 'Manual credit via Telegram admin';
        }
        $magnus = $this->app->magnus();

        try {
            $refill = $magnus->addCredit((int) $user['id'], $amount, $description);
            $after = $magnus->findUser((string) $user['username']) ?? $user;
        } catch (\Throwable $e) {
            throw $this->billingError($e);
        }

        $this->app->log('info', 'Admin adjusted credit', [
            'user' => $user['username'], 'amount' => $amount, 'note' => $note, 'admin' => $actor,
            'refill' => $refill['id'] ?? null, 'balance' => $after['credit'] ?? null,
        ]);

        return $after;
    }

    private function billingError(\Throwable $e): \Throwable
    {
        if ($e instanceof UserError) {
            return $e;
        }
        $this->app->log('error', 'Admin action failed', ['error' => $e->getMessage()]);
        if (stripos($e->getMessage(), 'invalid API action') !== false) {
            return new UserError('missing_permission', 'The MagnusBilling API key has no update permission yet. Run install.sh again to grant it.', 503);
        }

        return new UserError('billing_error', 'MagnusBilling: ' . $e->getMessage(), 502);
    }
}
