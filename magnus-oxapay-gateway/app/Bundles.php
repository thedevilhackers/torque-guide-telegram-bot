<?php

declare(strict_types=1);

namespace Gateway;

/**
 * Minute bundles: MagnusBilling Offers (Rates > Offers) sold for crypto in the panel add-on and the bot.
 *
 * Buying a bundle:
 *   - not active yet:  the gateway gives the customer that Offer (MagnusBilling counts the first period as paid);
 *   - already active:  the price is added as credit, so MagnusBilling's next renewal is covered.
 * MagnusBilling renews Offers from the customer's balance every period and ends them when the balance is too low.
 * Free minutes only count on tariffs marked "Package offer" in MagnusBilling.
 *
 * Admins choose which Offers are for sale in the bot (Admin panel > Settings > Bundles).
 */
final class Bundles
{
    /** @var App */
    private $app;

    /** @var MagnusDb */
    private $magnus;

    public function __construct(App $app, ?MagnusDb $magnus = null)
    {
        $this->app = $app;
        $this->magnus = $magnus ?? new MagnusDb($app);
    }

    // -------------------------------------------------------------- catalogue

    /**
     * @return array<int,array<string,mixed>> every MagnusBilling Offer
     */
    public function all(): array
    {
        $rows = $this->magnus->pdo()->query('SELECT id, label, packagetype, billingtype, freetimetocall, price FROM pkg_offer ORDER BY price, id')->fetchAll();

        return array_map([$this, 'describe'], is_array($rows) ? $rows : []);
    }

    /**
     * @return array<int,array<string,mixed>> Offers the admins put on sale
     */
    public function forSale(): array
    {
        $ids = $this->saleIds();
        if ($ids === []) {
            return [];
        }

        return array_values(array_filter($this->all(), static function (array $b) use ($ids): bool {
            return in_array($b['id'], $ids, true);
        }));
    }

    public function find(int $id): ?array
    {
        foreach ($this->forSale() as $bundle) {
            if ($bundle['id'] === $id) {
                return $bundle;
            }
        }

        return null;
    }

    /** @return int[] */
    public function saleIds(): array
    {
        $ids = json_decode((string) $this->app->db()->kvGet('bundles:for_sale'), true);

        return is_array($ids) ? array_values(array_map('intval', $ids)) : [];
    }

    public function toggle(int $id, string $actor): bool
    {
        $ids = $this->saleIds();
        $on = !in_array($id, $ids, true);
        $ids = $on ? array_merge($ids, [$id]) : array_values(array_diff($ids, [$id]));
        $this->app->db()->kvSet('bundles:for_sale', (string) json_encode(array_values(array_unique($ids))));
        $this->app->log('info', 'Bundle sale changed', ['offer' => $id, 'on' => $on, 'admin' => $actor]);

        return $on;
    }

    /**
     * Adds what customers see: what is included, how often it renews, and the price in the payment currency.
     */
    public function describe(array $offer): array
    {
        $type = (int) $offer['packagetype'];
        $amount = (int) $offer['freetimetocall'];
        if ($type === 0) {
            $includes = 'Unlimited calls';
        } elseif ($type === 1) {
            $includes = $amount . ' free call' . ($amount === 1 ? '' : 's');
        } else {
            $minutes = intdiv($amount, 60);
            $includes = number_format($minutes) . ' free minute' . ($minutes === 1 ? '' : 's');
        }
        $credit = (float) $offer['price'];
        $rate = (float) ($this->app->config['payments']['credit_rate'] ?? 1) ?: 1.0;
        $amountDue = number_format(ceil(round($credit / $rate * 100, 4)) / 100, 2, '.', '');

        return [
            'id' => (int) $offer['id'],
            'label' => (string) $offer['label'],
            'includes' => $includes,
            'period' => (int) $offer['billingtype'] === 1 ? 'week' : 'month',
            'credit' => $credit,
            'amount' => $amountDue,
            'price' => $this->app->payments()->money($amountDue),
        ];
    }

    /**
     * The customer's active bundle, if any.
     */
    public function active(int $userId): ?array
    {
        $id = $this->activeOfferId($userId);
        if ($id === 0) {
            return null;
        }
        $row = $this->magnus->pdo()->prepare('SELECT id, label, packagetype, billingtype, freetimetocall, price FROM pkg_offer WHERE id = ?');
        $row->execute([$id]);
        $offer = $row->fetch();

        return is_array($offer) ? $this->describe($offer) : null;
    }

    public function activeOfferId(int $userId): int
    {
        $stmt = $this->magnus->pdo()->prepare(
            "SELECT u.id_offer FROM pkg_user u
             JOIN pkg_offer_use ou ON ou.id_user = u.id AND ou.id_offer = u.id_offer AND ou.status = 1
                  AND (ou.releasedate IS NULL OR ou.releasedate < '1984-01-01')
             WHERE u.id = ? LIMIT 1"
        );
        $stmt->execute([$userId]);

        return (int) ($stmt->fetchColumn() ?: 0);
    }

    // ---------------------------------------------------------------- buying

    /**
     * Starts paying for a bundle for $username.
     *
     * @param array<string,mixed> $options tg_chat_id, ip
     */
    public function order(string $username, int $offerId, string $source, array $options = []): array
    {
        $bundle = $this->find($offerId);
        if ($bundle === null) {
            throw new UserError('unknown_bundle', 'That bundle is not available any more.', 404);
        }

        return $this->app->payments()->createOrder(['username' => $username, 'amount' => $bundle['amount']], $source, $options + ['bundle' => $bundle]);
    }

    /**
     * Gives the paid bundle to the customer. Called by Payments::credit() for bundle orders; safe to call again.
     *
     * @return array<string,mixed>|null the MagnusBilling refill, for a renewal
     */
    public function deliver(array $order): ?array
    {
        $userId = (int) $order['magnus_user_id'];
        $offerId = (int) $order['offer_id'];
        $action = $this->decideAction($order);
        $magnus = $this->app->magnus();

        if ($action === 'assign') {
            if ($this->activeOfferId($userId) !== $offerId) {
                $magnus->updateRecord('user', $userId, ['id_offer' => $offerId]);
                if ($this->activeOfferId($userId) !== $offerId) {
                    throw new \RuntimeException('MagnusBilling did not activate the bundle.');
                }
            }
            return null;
        }

        // Already active: add the price as credit, which MagnusBilling takes at the next renewal.
        return $magnus->findRefillContaining((string) $order['id'])
            ?? $magnus->addCredit($userId, Payments::formatCredit($order['credit']), 'Bundle renewal (offer ' . $offerId . ') #' . $order['id']);
    }

    /**
     * Whether an earlier attempt already delivered it (its reply may have been lost).
     */
    public function delivered(array $order): bool
    {
        $order = $this->app->payments()->getOrder((string) $order['id']) ?? $order;
        if (($order['bundle_action'] ?? '') === 'assign') {
            return $this->activeOfferId((int) $order['magnus_user_id']) === (int) $order['offer_id'];
        }
        if (($order['bundle_action'] ?? '') === 'renew') {
            return $this->app->magnus()->findRefillContaining((string) $order['id']) !== null;
        }

        return false;
    }

    /**
     * New bundle or renewal: decided once per order and stored, so a retry never does the other thing.
     */
    private function decideAction(array $order): string
    {
        $db = $this->app->db();
        $stored = $db->one('SELECT bundle_action FROM ' . $db->table('orders') . ' WHERE id = ?', [(string) $order['id']]);
        $action = (string) ($stored['bundle_action'] ?? '');
        if ($action === '') {
            $action = $this->activeOfferId((int) $order['magnus_user_id']) === (int) $order['offer_id'] ? 'renew' : 'assign';
            $db->run('UPDATE ' . $db->table('orders') . ' SET bundle_action = ? WHERE id = ? AND bundle_action IS NULL', [$action, (string) $order['id']]);
            $action = (string) ($db->one('SELECT bundle_action FROM ' . $db->table('orders') . ' WHERE id = ?', [(string) $order['id']])['bundle_action'] ?? $action);
        }

        return $action;
    }
}
