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
$public = $app->publicConfig();

$prefillUser = substr(preg_replace('/[^A-Za-z0-9_.@+\-]/', '', (string) ($_GET['username'] ?? '')) ?? '', 0, 64);
$prefillAmount = preg_match('/^\d{1,9}(\.\d{1,2})?$/', (string) ($_GET['amount'] ?? '')) ? (string) $_GET['amount'] : '';
$prefillPromo = preg_match('/^[A-Za-z0-9]{3,20}$/', (string) ($_GET['promo'] ?? '')) ? strtoupper((string) $_GET['promo']) : '';
$title = $app->config['site']['name'] . ' · Top up';

$coinColors = [
    'USDT' => '#26a17b', 'USDC' => '#2775ca', 'BTC' => '#f7931a', 'ETH' => '#627eea', 'TRX' => '#ef0027',
    'LTC' => '#345d9d', 'BNB' => '#f3ba2f', 'TON' => '#0098ea', 'DOGE' => '#c2a633', 'SOL' => '#9945ff',
    'XMR' => '#ff6600', 'BCH' => '#8dc351', 'DAI' => '#f5ac37', 'SHIB' => '#e42d04', 'POL' => '#8247e5',
];

$body = static function () use ($pay, $payments, $prefillUser, $prefillAmount, $prefillPromo): void {
    ?>
    <div class="intro">
        <h1>Add balance</h1>
        <p>Instant VoIP credit, paid in crypto.</p>
    </div>

    <form id="topup-form" class="form" novalidate>
        <div class="group">
            <label for="username">Account username</label>
            <div class="input-wrap">
                <svg class="field-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                <input id="username" name="username" type="text" required maxlength="64"
                       autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"
                       placeholder="e.g. 100234" value="<?= Web::e($prefillUser) ?>">
                <span id="user-badge" class="badge" aria-live="polite" hidden></span>
            </div>
            <p class="hint" id="username-hint">The username you log in with, usually your SIP account.</p>
        </div>

        <div class="group">
            <div class="label-row">
                <label for="amount">Amount</label>
                <span class="muted"><?= Web::e($pay['currency']) ?></span>
            </div>
            <div class="presets" role="group" aria-label="Quick amounts">
                <?php foreach ((array) $pay['presets'] as $preset): ?>
                    <button type="button" class="preset" data-amount="<?= Web::e((string) $preset) ?>"><?= Web::e($payments->money($preset, true)) ?></button>
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

        <details class="promo" id="promo-box" <?= $prefillPromo !== '' ? 'open' : '' ?>>
            <summary>Have a promo code?</summary>
            <div class="promo-row">
                <div class="input-wrap">
                    <input id="promo" type="text" maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false"
                           placeholder="PROMO CODE" aria-label="Promo code" value="<?= Web::e($prefillPromo) ?>">
                </div>
                <button class="btn ghost small" type="button" id="promo-apply">Apply</button>
            </div>
            <p class="hint" id="promo-hint" hidden></p>
        </details>

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
            <div class="row" id="sum-bonus-row" hidden><span>Bonus</span><strong id="sum-bonus" class="gold"></strong></div>
            <div class="row total"><span>Credit added</span><strong id="sum-credit"></strong></div>
        </div>

        <p class="alert" id="form-error" role="alert" hidden></p>

        <button class="btn" type="submit" id="submit">
            <span class="btn-label">Continue to secure payment</span>
            <span class="spinner" aria-hidden="true"></span>
        </button>
        <p class="fine-print">You'll choose a coin on OxaPay's checkout. Your balance is updated automatically once the payment confirms.</p>
    </form>

    <details class="track">
        <summary>Already paid? Check a payment</summary>
        <form id="track-form" class="track-form" novalidate>
            <div class="input-wrap">
                <input id="track-id" type="text" maxlength="40" autocomplete="off" spellcheck="false" placeholder="Order ID" aria-label="Order ID">
            </div>
            <button class="btn ghost small" type="submit">Check</button>
        </form>
        <p class="hint" id="track-error" hidden></p>
    </details>
    <?php
};

$after = static function () use ($app, $pay, $public, $coinColors): void {
    $coins = array_values(array_filter(array_map('strtoupper', array_map('strval', (array) ($pay['coins'] ?? [])))));
    $bot = $public['telegram_bot'];
    $support = (string) $app->config['site']['support_url'];
    ?>
    <ul class="perks" aria-label="Why pay here">
        <li>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
            <strong>Instant credit</strong><span>Added automatically</span>
        </li>
        <li>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.4 8.2 8 9 4.6-.8 8-4.5 8-9V6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="m8.5 12 2.5 2.5 4.5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <strong>Secure checkout</strong><span>We never see your wallet</span>
        </li>
        <li>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            <strong>24/7</strong><span>Top up any time</span>
        </li>
    </ul>

    <?php if ($coins !== []): ?>
        <div class="coins" aria-label="Accepted coins">
            <?php foreach ($coins as $coin): ?>
                <span class="coin"><i style="--coin: <?= Web::e($coinColors[$coin] ?? 'var(--accent)') ?>"></i><?= Web::e($coin) ?></span>
            <?php endforeach; ?>
        </div>
    <?php endif; ?>

    <section class="faq" aria-label="Questions">
        <h2>Questions</h2>
        <details>
            <summary>How fast is my balance updated?</summary>
            <p>Automatically, as soon as the blockchain confirms your payment. That usually takes a few minutes. The status page updates by itself, so you don't need to refresh.</p>
        </details>
        <details>
            <summary>Which coins can I pay with?</summary>
            <p><?= $coins !== [] ? Web::e(implode(', ', $coins)) . ' and more.' : 'All the coins offered on the checkout page.' ?> You pick the coin and network on the OxaPay checkout page.</p>
        </details>
        <details>
            <summary>What if I pay too little, or the link expires?</summary>
            <p>Each payment link is valid for <?= (int) $app->config['oxapay']['lifetime'] ?> minutes. If you sent funds after it expired, or sent less than the invoice, contact support with your order ID and we will sort it out.</p>
        </details>
        <details>
            <summary>Is it safe?</summary>
            <p>Payments are processed by OxaPay over an encrypted connection. We never see your wallet or keys. We only need your account username to know where to add the credit.</p>
        </details>
        <?php if ($bot !== ''): ?>
            <details>
                <summary>Can I top up from Telegram?</summary>
                <p>Yes. Open <a href="https://t.me/<?= Web::e($bot) ?>" rel="noopener">@<?= Web::e($bot) ?></a>, tap <b>Top up</b>, and you get a message as soon as the credit is added.</p>
            </details>
        <?php endif; ?>
        <?php if ($support !== ''): ?>
            <p class="faq-help">Still stuck? <a href="<?= Web::e($support) ?>" rel="noopener">Contact support</a></p>
        <?php endif; ?>
    </section>
    <?php
};

require __DIR__ . '/../app/views/layout.php';
