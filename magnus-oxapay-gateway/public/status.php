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
$bot = $app->publicConfig()['telegram_bot'];

if ($order === null) {
    http_response_code(404);
}

$body = static function () use ($view, $bot): void {
    if ($view === null) {
        ?>
        <div class="status-view" data-status="missing">
            <div class="status-icon" aria-hidden="true"><span>?</span></div>
            <h1>Order not found</h1>
            <p class="muted">Check the link, or start a new top-up.</p>
            <a class="btn" href="./">Top up</a>
        </div>
        <?php
        return;
    }
    ?>
    <div class="status-view" id="status-view" data-order="<?= Web::e($view['order_id']) ?>" data-status="<?= Web::e($view['status']) ?>">
        <div class="status-icon" id="st-icon" aria-hidden="true">
            <svg class="tick" viewBox="0 0 52 52"><path d="M14 27l8 8 16-17" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span class="glyph"></span>
        </div>
        <h1 id="st-title"><?= Web::e(Payments::statusLabel($view['status'])) ?></h1>
        <p class="muted" id="st-note"></p>
        <p class="countdown" id="st-countdown" hidden></p>

        <dl class="details receipt">
            <div><dt>Account</dt><dd><?= Web::e($view['username']) ?></dd></div>
            <div><dt>Amount</dt><dd><?= Web::e($view['amount_display']) ?></dd></div>
            <div><dt>Credit</dt><dd><?= Web::e($view['credit']) ?><?= $view['bonus_percent'] > 0 ? ' <span class="chip">+' . Web::e((string) $view['bonus_percent']) . '%</span>' : '' ?></dd></div>
            <div><dt>Date</dt><dd id="st-date" data-ts="<?= (int) ($view['credited_at'] ?? $view['created_at']) ?>"><?= Web::e(date('d M Y, H:i', (int) ($view['credited_at'] ?? $view['created_at']))) ?></dd></div>
            <div>
                <dt>Order</dt>
                <dd class="order-id">
                    <span class="mono" id="st-order"><?= Web::e($view['order_id']) ?></span>
                    <button type="button" class="icon-btn" id="copy-order" title="Copy order ID" aria-label="Copy order ID">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 15V6a2 2 0 0 1 2-2h9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                    </button>
                </dd>
            </div>
        </dl>

        <div class="actions">
            <a class="btn" id="st-pay" href="<?= Web::e((string) $view['payment_url']) ?>" <?= $view['payment_url'] ? '' : 'hidden' ?>>Open payment page</a>
            <?php if ($bot !== ''): ?>
                <a class="btn ghost" id="st-telegram" href="https://t.me/<?= Web::e($bot) ?>?start=o_<?= Web::e($view['order_id']) ?>" rel="noopener" <?= $view['is_final'] ? 'hidden' : '' ?>>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 4 3 11l6 2 2 6 3-4 5 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
                    Notify me on Telegram
                </a>
            <?php endif; ?>
            <button type="button" class="btn ghost" id="st-print" <?= $view['status'] === 'credited' ? '' : 'hidden' ?>>Print receipt</button>
            <a class="btn ghost" href="./">Make another top-up</a>
        </div>
    </div>
    <script type="application/json" id="order-data"><?= json_encode($view, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>
    <?php
};

require __DIR__ . '/../app/views/layout.php';
