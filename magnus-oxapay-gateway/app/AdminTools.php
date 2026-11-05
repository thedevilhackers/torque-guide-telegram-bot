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
     * @return array{sip:array<string,mixed>, slow:bool} the SIP account after the change
     */
    public function setCallerId(array $sip, string $callerId, string $actor): array
    {
        $callerId = $this->normalizeCallerId($callerId);
        $magnus = $this->app->magnus();
        $slow = false;

        try {
            $magnus->updateRecord('sip', (int) $sip['id'], ['callerid' => $callerId]);
        } catch (\Throwable $e) {
            // The reply may be lost or late although the change was saved: check before reporting an error.
            $check = null;
            try {
                $check = $magnus->findSip((string) $sip['name']);
            } catch (\Throwable $ignored) {
            }
            if ($check === null || (string) ($check['callerid'] ?? '') !== $callerId) {
                throw $this->billingError($e);
            }
            $slow = true;
        }

        try {
            $updated = $magnus->findSip((string) $sip['name']) ?? array_merge($sip, ['callerid' => $callerId]);
        } catch (\Throwable $e) {
            $updated = array_merge($sip, ['callerid' => $callerId]);
        }
        $this->app->log('info', 'Admin changed caller ID', [
            'sip' => $sip['name'], 'old' => $sip['callerid'] ?? null, 'new' => $callerId, 'admin' => $actor, 'slow_reply' => $slow,
        ]);

        return ['sip' => $updated, 'slow' => $slow];
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
     * @return array{user:array<string,mixed>, slow:bool} the user row after the change (with the new credit)
     */
    public function adjustCredit(array $user, string $amount, string $note, string $actor): array
    {
        $amount = $this->parseCreditAmount($amount);
        $note = trim((string) preg_replace('/[^\p{L}\p{N} .,:#_\-\/]/u', '', $note));
        // A unique reference lets us find this refill again if MagnusBilling answers late.
        $ref = 'adm-' . bin2hex(random_bytes(4));
        $description = substr('Telegram admin ' . $actor . ': ' . ($note !== '' ? $note : 'manual credit'), 0, 180) . ' #' . $ref;
        if (!MagnusBilling::isSafeValue($description)) {
            $description = 'Manual credit via Telegram admin #' . $ref;
        }
        $magnus = $this->app->magnus();
        $slow = false;

        try {
            $refill = $magnus->addCredit((int) $user['id'], $amount, $description);
        } catch (\Throwable $e) {
            // MagnusBilling saves the refill and balance, then emails the customer before replying.
            // A slow mail server makes the reply time out although the change is done: check first.
            $refill = null;
            try {
                $refill = $magnus->findRefillContaining($ref);
            } catch (\Throwable $ignored) {
            }
            if ($refill === null) {
                $this->app->log('error', 'Admin credit change not confirmed', ['user' => $user['username'], 'amount' => $amount, 'ref' => $ref, 'error' => $e->getMessage()]);
                throw new UserError(
                    'not_confirmed',
                    'MagnusBilling did not confirm the change (' . $e->getMessage() . '). Check the balance with 👤 Account before trying again, so it is not applied twice.',
                    504
                );
            }
            $slow = true;
        }

        try {
            $after = $magnus->findUser((string) $user['username']) ?? $user;
        } catch (\Throwable $e) {
            $after = $user;
        }
        $this->app->log('info', 'Admin adjusted credit', [
            'user' => $user['username'], 'amount' => $amount, 'note' => $note, 'admin' => $actor,
            'refill' => $refill['id'] ?? null, 'ref' => $ref, 'balance' => $after['credit'] ?? null, 'slow_reply' => $slow,
        ]);

        return ['user' => $after, 'slow' => $slow];
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
