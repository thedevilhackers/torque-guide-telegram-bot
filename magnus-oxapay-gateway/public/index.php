<?php

/**
 * Top-up page. Prefill with ?username=1001&amount=25 (handy for links in emails or the Magnus panel).
 */

declare(strict_types=1);

use Gateway\Web;

require __DIR__ . '/../app/bootstrap.php';

$app = Web::boot();
$pay = $app->config['payments'];
$payments = $app->payments();

$prefillUser = substr(preg_replace('/[^A-Za-z0-9_.@+\-]/', '', (string) ($_GET['username'] ?? '')) ?? '', 0, 64);
$prefillAmount = preg_match('/^\d{1,9}(\.\d{1,2})?$/', (string) ($_GET['amount'] ?? '')) ? (string) $_GET['amount'] : '';
$title = $app->config['site']['name'] . ' · Top up';

$body = static function () use ($app, $pay, $payments, $prefillUser, $prefillAmount): void {
    ?>
    <form id="topup-form" class="form" novalidate>
        <div class="group">
            <label for="username">Account username</label>
            <div class="input-wrap">
                <input id="username" name="username" type="text" required maxlength="64"
                       autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"
                       placeholder="e.g. 100234" value="<?= Web::e($prefillUser) ?>">
                <span id="user-badge" class="badge" aria-live="polite" hidden></span>
            </div>
            <p class="hint" id="username-hint">The username you log in with (usually your SIP account).</p>
        </div>

        <div class="group">
            <div class="label-row">
                <label for="amount">Amount</label>
                <span class="muted"><?= Web::e($pay['currency']) ?></span>
            </div>
            <div class="presets" role="group" aria-label="Quick amounts">
                <?php foreach ((array) $pay['presets'] as $preset): ?>
                    <button type="button" class="preset" data-amount="<?= Web::e((string) $preset) ?>"><?= Web::e($payments->money($preset)) ?></button>
                <?php endforeach; ?>
            </div>
            <div class="input-wrap money">
                <?php if ((string) $pay['currency_symbol'] !== ''): ?>
                    <span class="prefix" aria-hidden="true"><?= Web::e($pay['currency_symbol']) ?></span>
                <?php endif; ?>
                <input id="amount" name="amount" type="text" inputmode="decimal" required
                       placeholder="0.00" value="<?= Web::e($prefillAmount) ?>" aria-describedby="amount-hint">
            </div>
            <p class="hint" id="amount-hint">
                Minimum <?= Web::e($payments->money($pay['min_amount'])) ?> · Maximum <?= Web::e($payments->money($pay['max_amount'])) ?>
            </p>
            <?php if (!empty($pay['bonus'])): ?>
                <div class="bonus-chips">
                    <?php foreach ((array) $pay['bonus'] as $tier): ?>
                        <?php if (is_array($tier) && isset($tier['min'], $tier['percent'])): ?>
                            <span class="chip">+<?= Web::e((string) $tier['percent']) ?>% bonus from <?= Web::e($payments->money($tier['min'])) ?></span>
                        <?php endif; ?>
                    <?php endforeach; ?>
                </div>
            <?php endif; ?>
        </div>

        <?php if (!empty($pay['ask_email'])): ?>
            <div class="group">
                <label for="email">Email for the receipt <span class="muted">(optional)</span></label>
                <div class="input-wrap">
                    <input id="email" name="email" type="email" autocomplete="email" maxlength="190" placeholder="you@example.com">
                </div>
            </div>
        <?php endif; ?>

        <div class="summary" id="summary" hidden>
            <div class="row"><span>You pay</span><strong id="sum-pay"></strong></div>
            <div class="row" id="sum-bonus-row" hidden><span>Bonus</span><strong id="sum-bonus"></strong></div>
            <div class="row total"><span>Credit added</span><strong id="sum-credit"></strong></div>
        </div>

        <p class="alert" id="form-error" role="alert" hidden></p>

        <button class="btn" type="submit" id="submit">
            <span class="btn-label">Continue to payment</span>
            <span class="spinner" aria-hidden="true"></span>
        </button>

        <ul class="trust">
            <li>Pay with USDT, BTC, ETH, TRX, LTC and other coins</li>
            <li>Your balance is updated automatically once the payment confirms</li>
        </ul>
    </form>
    <?php
};

require __DIR__ . '/../app/views/layout.php';
