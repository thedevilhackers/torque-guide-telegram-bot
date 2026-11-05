<?php

/**
 * Terms & Conditions page: {base_url}/terms/  (or https://terms.<your-domain>/terms with install.sh --terms-domain).
 *
 * The text is filled in from config.php (company name, terms.email, terms.address, terms.jurisdiction,
 * payment settings). To use your own text instead, set terms.file to the path of an HTML file.
 * This is a starting template, not legal advice: have it reviewed for your country.
 */

declare(strict_types=1);

use Gateway\Web;

require __DIR__ . '/../../app/bootstrap.php';

$app = Web::boot();
$site = $app->config['site'];
$terms = $app->config['terms'] ?? [];
$pay = $app->config['payments'];
$payments = $app->payments();

$company = (string) $site['name'];
$email = trim((string) ($terms['email'] ?? ''));
$address = trim((string) ($terms['address'] ?? ''));
$jurisdiction = trim((string) ($terms['jurisdiction'] ?? ''));
$refundDays = max(1, (int) ($terms['refund_days'] ?? 14));
$updated = trim((string) ($terms['updated'] ?? '')) !== '' ? (string) $terms['updated'] : date('Y-m-d');
$updatedText = date('j F Y', (int) (strtotime($updated) ?: time()));
$lifetime = (int) $app->config['oxapay']['lifetime'];
$support = (string) $site['support_url'];
$bot = $app->publicConfig()['telegram_bot'];
$bank = trim((string) ($pay['bank_instructions'] ?? '')) !== '';
$contact = $email !== '' ? '<a href="mailto:' . Web::e($email) . '">' . Web::e($email) . '</a>'
    : ($support !== '' ? '<a href="' . Web::e($support) . '">' . Web::e($support) . '</a>' : 'our support team');

$title = $company . ' · Terms & Conditions';
$assetBase = '../';
$homeUrl = $app->baseUrl() !== '' ? $app->baseUrl() . '/' : '../';
$wide = true;

$custom = trim((string) ($terms['file'] ?? ''));

$body = static function () use (
    $company, $email, $address, $jurisdiction, $refundDays, $updatedText, $lifetime, $support, $bot, $bank,
    $contact, $pay, $payments, $custom, $homeUrl
): void {
    ?>
    <article class="legal">
        <header class="legal-head">
            <span class="eyebrow"><i aria-hidden="true"></i>Legal</span>
            <h1>Terms &amp; Conditions</h1>
            <p class="muted">Last updated <?= Web::e($updatedText) ?></p>
        </header>

        <?php if ($custom !== '' && is_readable($custom)): ?>
            <?php readfile($custom); ?>
        <?php else: ?>
        <nav class="toc" aria-label="Contents">
            <ol>
                <li><a href="#about">About these terms</a></li>
                <li><a href="#service">The service</a></li>
                <li><a href="#account">Your account</a></li>
                <li><a href="#payments">Payments</a></li>
                <li><a href="#credit">Credit, bonuses and promo codes</a></li>
                <li><a href="#refunds">Refunds and payment problems</a></li>
                <li><a href="#use">Acceptable use</a></li>
                <li><a href="#availability">Service availability</a></li>
                <li><a href="#liability">Liability</a></li>
                <li><a href="#privacy">Privacy</a></li>
                <li><a href="#changes">Changes to these terms</a></li>
                <li><a href="#contact">Contact</a></li>
            </ol>
        </nav>

        <section id="about">
            <h2>1. About these terms</h2>
            <p>These terms apply when you add credit to an account with <?= Web::e($company) ?> ("we", "us") through our payment
                website<?= $bot !== '' ? ' or our Telegram bot @' . Web::e($bot) : '' ?>. By starting a payment you agree to them.
                If you do not agree, please do not use the service.</p>
        </section>

        <section id="service">
            <h2>2. The service</h2>
            <p>We sell prepaid credit for voice-over-IP (VoIP) accounts on our platform. Credit is used to pay for calls and other
                services at the rates of the plan on your account. Rates, plans and the services available to you are set out in your
                customer panel and may change over time.</p>
        </section>

        <section id="account">
            <h2>3. Your account</h2>
            <ul>
                <li>To top up, you enter the username of the account to credit. Credit is added to exactly the account you enter, so
                    please check it before paying. You may top up your own account or someone else's.</li>
                <li>Keep your login and SIP passwords private. You are responsible for calls made with your account.</li>
                <li>If you link your Telegram account to your customer account, we can send you payment confirmations, low-balance
                    alerts and service messages there. You can unlink it at any time from the bot.</li>
            </ul>
        </section>

        <section id="payments">
            <h2>4. Payments</h2>
            <ul>
                <li>Crypto payments are processed by OxaPay, an independent payment provider. You choose the coin and network on their
                    checkout page, and their terms also apply to the payment. We never see your wallet or private keys.</li>
                <li>Amounts are shown in <?= Web::e((string) $pay['currency']) ?>. Top-ups must be between
                    <?= Web::e($payments->money($pay['min_amount'])) ?> and <?= Web::e($payments->money($pay['max_amount'])) ?>.
                    The amount of crypto to send, and the exchange rate, are set by OxaPay at checkout.</li>
                <li>A payment link is valid for <?= $lifetime ?> minutes. Please send the exact amount shown, on the network shown,
                    before the link expires. Blockchain network fees are paid by the sender.</li>
                <li>A payment counts as received once it is confirmed on the blockchain and reported to us by OxaPay.</li>
                <?php if ($bank): ?>
                    <li>If you pay by bank transfer, include the reference you were given and send us the receipt. Credit is added
                        after we have checked that the transfer arrived, which can take up to a few business days.</li>
                <?php endif; ?>
            </ul>
        </section>

        <section id="credit">
            <h2>5. Credit, bonuses and promo codes</h2>
            <ul>
                <li>Credit is added to the account automatically once the payment is confirmed. You will see it on the status page,
                    in your customer panel and, if linked, in Telegram.</li>
                <li>Credit is prepaid and can only be used for our services. It has no cash value, does not earn interest and cannot
                    be exchanged for money, except as described under refunds.</li>
                <li>Bonus credit and promo codes are offered at our discretion. They apply only to the top-up they were used for,
                    may have a limited number of uses or an end date, and cannot be exchanged for money. We may cancel bonus credit
                    obtained by abuse.</li>
            </ul>
        </section>

        <section id="refunds">
            <h2>6. Refunds and payment problems</h2>
            <ul>
                <li>Credit that has been added to an account is generally not refundable.</li>
                <li>If you paid twice, paid too much, paid too little, paid after the link expired, or a confirmed payment was not
                    credited, contact us within <?= $refundDays ?> days with your order ID. We will investigate and either add the
                    missing credit or, where we agree a refund is due, return the payment in crypto to an address you give us, minus
                    network fees.</li>
                <li>Crypto transactions cannot be reversed. We cannot recover funds sent to a wrong address or on a wrong network.</li>
            </ul>
        </section>

        <section id="use">
            <h2>7. Acceptable use</h2>
            <p>You must not use the service, or credit bought through it, for anything unlawful, including fraud, unsolicited
                or automated calls that break the law, harassment, or calls to numbers you are not entitled to call. We may suspend
                or close accounts used in this way. Credit on an account closed for misuse is not refunded.</p>
        </section>

        <section id="availability">
            <h2>8. Service availability</h2>
            <p>We work to keep the payment website, the bot and our VoIP service available, but we cannot promise they will
                always be uninterrupted or error-free. Maintenance, problems at our providers (including OxaPay and blockchain
                networks) or events outside our control can cause delays. Payments received during a delay are still credited.</p>
        </section>

        <section id="liability">
            <h2>9. Liability</h2>
            <p>To the extent the law allows, our total liability for any claim about a top-up is limited to the amount you paid
                for that top-up, and we are not liable for indirect or consequential losses. Nothing in these terms limits rights
                you have under laws that cannot be excluded.</p>
            <?php if ($jurisdiction !== ''): ?>
                <p>These terms are governed by the laws of <?= Web::e($jurisdiction) ?>.</p>
            <?php endif; ?>
        </section>

        <section id="privacy">
            <h2>10. Privacy</h2>
            <p>To process top-ups we store the account username, amount, currency, order and payment references, the time of the
                payment and the IP address used. If you give an email address or use our Telegram bot, we also store that email
                and your Telegram chat ID and name. We use this information only to provide the service, prevent fraud, answer
                support requests and meet legal obligations, and we share it only with the providers needed to do this, such as
                OxaPay. Contact us to ask what we hold about you or to have it corrected or deleted where the law allows.</p>
        </section>

        <section id="changes">
            <h2>11. Changes to these terms</h2>
            <p>We may update these terms from time to time. The date at the top shows the latest version. Changes apply to
                payments started after they are published.</p>
        </section>

        <section id="contact">
            <h2>12. Contact</h2>
            <p><?= Web::e($company) ?><?= $address !== '' ? '<br>' . nl2br(Web::e($address)) : '' ?></p>
            <p>Questions about these terms or a payment: <?= $contact ?><?= $bot !== '' ? ', or message @' . Web::e($bot) . ' on Telegram' : '' ?>.</p>
        </section>
        <?php endif; ?>

        <p class="legal-back"><a class="btn ghost small" href="<?= Web::e($homeUrl) ?>">← Back to top-up</a></p>
    </article>
    <?php
};

require __DIR__ . '/../../app/views/layout.php';
