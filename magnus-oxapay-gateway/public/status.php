<?php

/**
 * Payment status page. OxaPay sends the customer here after paying; it refreshes itself until the order settles.
 */

declare(strict_types=1);

use Gateway\Payments;
use Gateway\Web;

require __DIR__ . '/../app/bootstrap.php';

$app = Web::boot();
$payments = $app->payments();
$order = $payments->getOrder(strtolower((string) ($_GET['order'] ?? '')));
$view = $order !== null ? $payments->publicView($order) : null;
$title = $app->config['site']['name'] . ' · Payment status';

if ($order === null) {
    http_response_code(404);
}

$body = static function () use ($view): void {
    if ($view === null) {
        ?>
        <div class="status-view" data-status="missing">
            <div class="status-icon" aria-hidden="true">?</div>
            <h1>Order not found</h1>
            <p class="muted">Check the link, or start a new top-up.</p>
            <a class="btn" href="./">Top up</a>
        </div>
        <?php
        return;
    }
    ?>
    <div class="status-view" id="status-view" data-order="<?= Web::e($view['order_id']) ?>" data-status="<?= Web::e($view['status']) ?>">
        <div class="status-icon" id="st-icon" aria-hidden="true"></div>
        <h1 id="st-title"><?= Web::e(Payments::statusLabel($view['status'])) ?></h1>
        <p class="muted" id="st-note"></p>

        <dl class="details">
            <div><dt>Account</dt><dd><?= Web::e($view['username']) ?></dd></div>
            <div><dt>Amount</dt><dd><?= Web::e($view['amount_display']) ?></dd></div>
            <div><dt>Credit</dt><dd><?= Web::e($view['credit']) ?><?= $view['bonus_percent'] > 0 ? ' <span class="chip">+' . Web::e((string) $view['bonus_percent']) . '%</span>' : '' ?></dd></div>
            <div><dt>Order</dt><dd class="mono"><?= Web::e($view['order_id']) ?></dd></div>
        </dl>

        <a class="btn" id="st-pay" href="<?= Web::e((string) $view['payment_url']) ?>" <?= $view['payment_url'] ? '' : 'hidden' ?>>Open payment page</a>
        <a class="btn ghost" href="./">Make another top-up</a>
    </div>
    <script type="application/json" id="order-data"><?= json_encode($view, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>
    <?php
};

require __DIR__ . '/../app/views/layout.php';
