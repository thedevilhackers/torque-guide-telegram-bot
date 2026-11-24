<?php

/**
 * Customer-panel add-on, shown inside MagnusBilling through its "Extra" menu slots (see panel-addon.sh).
 *
 *   ?tab=topup      balance, crypto top-up and recent payments
 *   ?tab=security   Connect Telegram and two-step login
 *   ?ping=1         health check used by the installer
 *
 * It must be opened on the same domain as the panel, so the browser sends the panel's login cookie.
 */

declare(strict_types=1);

use Gateway\MagnusSession;
use Gateway\Panel;
use Gateway\UserError;
use Gateway\Web;

require __DIR__ . '/../../app/bootstrap.php';

$isPost = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';

if (isset($_GET['ping'])) {
    $app = Web::boot(true);
    Web::json(['addon' => 'unity-panel', 'ok' => true, 'enabled' => !empty($app->config['panel']['enabled'])]);
}

$app = Web::boot($isPost);
if (empty($app->config['panel']['enabled'])) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    exit("The panel add-on is turned off.\n");
}

$session = MagnusSession::read($app);

// ------------------------------------------------------------------ actions (JSON)

if ($isPost) {
    try {
        if ($session === null) {
            throw new UserError('not_logged_in', 'Please log in to the customer panel again.', 401);
        }
        $origin = Web::header('Origin');
        if ($origin !== null && $origin !== 'null' && strcasecmp((string) parse_url($origin, PHP_URL_HOST), (string) strtok((string) ($_SERVER['HTTP_HOST'] ?? ''), ':')) !== 0) {
            throw new UserError('bad_request', 'Request refused.', 403);
        }
        $panel = new Panel($app, $session);
        $panel->checkCsrf(Web::header('X-CSRF-Token'));
        $input = Web::input();
        $action = (string) ($input['action'] ?? '');
        switch ($action) {
            case 'overview':
                $result = $panel->overview();
                break;
            case 'topup':
                $result = $panel->topup((string) ($input['amount'] ?? ''), (string) ($input['promo'] ?? ''), Web::clientIp($app));
                break;
            case 'bundle':
                $result = $panel->buyBundle((int) ($input['id'] ?? 0), Web::clientIp($app));
                break;
            case 'telegram':
                $result = $panel->telegramLink();
                break;
            case 'twostep_start':
                $result = $panel->twoStepStart();
                break;
            case 'twostep_confirm':
                $panel->twoStepConfirm((string) ($input['code'] ?? ''));
                $result = ['two_step' => true];
                break;
            case 'twostep_disable':
                $panel->twoStepDisable((string) ($input['code'] ?? ''));
                $result = ['two_step' => false];
                break;
            default:
                throw new UserError('bad_request', 'Unknown action.');
        }
        Web::json(['ok' => true, 'data' => $result]);
    } catch (UserError $e) {
        Web::json(['ok' => false, 'error' => ['code' => $e->errorCode, 'message' => $e->getMessage()]], $e->httpStatus);
    } catch (\Throwable $e) {
        $app->log('error', 'Panel add-on action failed', ['error' => $e->getMessage()]);
        Web::json(['ok' => false, 'error' => ['code' => 'server_error', 'message' => 'Something went wrong. Please try again.']], 500);
    }
}

// ------------------------------------------------------------------ page

Web::securityHeaders();
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');

$tab = (string) ($_GET['tab'] ?? 'topup');
$tab = in_array($tab, ['topup', 'security'], true) ? $tab : 'topup';
$site = $app->config['site'];
$pay = $app->config['payments'];
$payments = $app->payments();
$e = [Web::class, 'e'];

$panel = null;
$view = null;
$error = null;
if ($session !== null) {
    try {
        $panel = new Panel($app, $session);
        $view = $panel->overview();
    } catch (UserError $ex) {
        $error = $ex->getMessage();
    } catch (\Throwable $ex) {
        $app->log('error', 'Panel add-on page failed', ['error' => $ex->getMessage()]);
        $error = 'This page is unavailable right now. Please try again in a few minutes.';
    }
}

$client = [
    'csrf' => $panel !== null ? $panel->csrfToken() : '',
    'tab' => $tab,
    'symbol' => (string) $pay['currency_symbol'],
    'currency' => (string) $pay['currency'],
    'min' => (float) $pay['min_amount'],
    'max' => (float) $pay['max_amount'],
];
$presets = array_values(array_filter(array_map('floatval', (array) $pay['presets']), static function (float $v) use ($pay): bool {
    return $v >= (float) $pay['min_amount'] && $v <= (float) $pay['max_amount'];
}));
$coins = array_slice(array_map('strval', (array) ($pay['coins'] ?? [])), 0, 6);
$loginUrl = (string) (($app->config['panel']['login_url'] ?? '') ?: $app->db()->kvGet('panel:login_url'));
?><!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title><?= $e($tab === 'topup' ? 'Top up' : 'Telegram & security') ?> · <?= $e($site['name']) ?></title>
    <link rel="stylesheet" href="panel.css?v=3">
</head>
<body>
<main class="wrap">
    <?php if ($session === null): ?>
        <section class="card center">
            <h1>Please log in</h1>
            <p class="muted">Log in to the customer panel to top up, connect Telegram and manage two-step login.</p>
            <?php if ($loginUrl !== ''): ?>
                <p><a class="btn" href="<?= $e($loginUrl) ?>" target="_top">Open the customer panel</a></p>
            <?php else: ?>
                <p class="muted small">If you are logged in, reload the panel. This page must be opened from the same address as the panel.</p>
            <?php endif; ?>
        </section>
    <?php elseif ($error !== null): ?>
        <section class="card center">
            <h1>Unavailable</h1>
            <p class="muted"><?= $e($error) ?></p>
        </section>
    <?php else: ?>
        <header class="head">
            <div>
                <p class="eyebrow"><?= $e($site['name']) ?></p>
                <h1><?= $e($view['name'] !== '' ? $view['name'] : $view['username']) ?></h1>
                <p class="muted small">Account <code><?= $e($view['username']) ?></code></p>
            </div>
            <div class="balance">
                <span class="muted small">Balance</span>
                <strong id="balance"><?= $e($view['credit']) ?></strong>
            </div>
        </header>
        <?php if ($panel->isAdmin()): ?>
            <p class="note">You are logged in as an admin. Customers see this page with their own account.</p>
        <?php endif; ?>

        <nav class="tabs" aria-label="Sections">
            <a href="?tab=topup" class="<?= $tab === 'topup' ? 'on' : '' ?>">💳 Top up</a>
            <a href="?tab=security" class="<?= $tab === 'security' ? 'on' : '' ?>">🔐 Telegram &amp; security</a>
        </nav>

        <?php if ($tab === 'topup'): ?>
            <section class="card">
                <h2>Add credit</h2>
                <p class="muted">Pay with <?= $e($coins !== [] ? implode(', ', array_slice($coins, 0, 3)) . ' and more' : 'crypto') ?>. Your balance updates automatically once the payment confirms.</p>
                <form id="topup" class="topup" autocomplete="off">
                    <?php if ($presets !== []): ?>
                        <div class="chips" role="group" aria-label="Amount">
                            <?php foreach ($presets as $preset): ?>
                                <button type="button" class="chip" data-amount="<?= $e($preset) ?>"><?= $e($payments->money($preset, true)) ?></button>
                            <?php endforeach; ?>
                        </div>
                    <?php endif; ?>
                    <label class="field">
                        <span>Amount (<?= $e($pay['currency']) ?>)</span>
                        <span class="money"><i><?= $e($pay['currency_symbol']) ?></i><input id="amount" name="amount" inputmode="decimal" placeholder="<?= $e(number_format((float) $pay['min_amount'], 2)) ?>" required></span>
                        <small class="muted">From <?= $e($payments->money($pay['min_amount'])) ?> to <?= $e($payments->money($pay['max_amount'])) ?></small>
                    </label>
                    <details class="promo">
                        <summary>Have a promo code?</summary>
                        <input id="promo" name="promo" maxlength="32" placeholder="CODE">
                    </details>
                    <button class="btn wide" type="submit" id="pay">Pay with crypto</button>
                    <p class="msg" id="topup-msg" role="status" hidden></p>
                </form>
            </section>

            <?php if ($view['bundles']['for_sale'] !== []): $active = $view['bundles']['active']; ?>
                <section class="card">
                    <h2>📦 Minute bundles</h2>
                    <?php if ($active !== null): ?>
                        <p class="msg ok">Active: <b><?= $e($active['label']) ?></b> (<?= $e($active['includes']) ?>). It renews from your balance every <?= $e($active['period']) ?>.</p>
                    <?php else: ?>
                        <p class="muted">Pay once with crypto. The bundle then renews from your balance every period while there is enough credit.</p>
                    <?php endif; ?>
                    <div class="bundles">
                        <?php foreach ($view['bundles']['for_sale'] as $bundle): $isActive = $active !== null && $active['id'] === $bundle['id']; ?>
                            <div class="bundle<?= $isActive ? ' on' : '' ?>">
                                <strong><?= $e($bundle['label']) ?></strong>
                                <span><?= $e($bundle['includes']) ?></span>
                                <span class="muted small">per <?= $e($bundle['period']) ?></span>
                                <b class="price"><?= $e($bundle['price']) ?></b>
                                <button class="btn" type="button" data-bundle="<?= (int) $bundle['id'] ?>"><?= $isActive ? 'Pay next ' . $e($bundle['period']) : 'Buy' ?></button>
                            </div>
                        <?php endforeach; ?>
                    </div>
                    <?php if ($active !== null): ?>
                        <p class="small muted">Buying a different bundle replaces the active one.</p>
                    <?php endif; ?>
                    <p class="msg" id="bundle-msg" role="status" hidden></p>
                </section>
            <?php endif; ?>

            <?php if ($view['referral'] !== null): $ref = $view['referral']; ?>
                <section class="card">
                    <div class="row">
                        <h2>🎁 Invite friends</h2>
                        <span class="badge ok"><?= $e(number_format($ref['earned'], 2)) ?> earned</span>
                    </div>
                    <p class="muted">When a friend tops up <?= $e($ref['min']) ?> or more for the first time, you get <b><?= $e($ref['percent']) ?></b> of it as
                        credit and they get <b><?= $e($ref['friend_percent']) ?></b> extra.</p>
                    <div class="copy">
                        <input id="ref-link" value="<?= $e($ref['web']) ?>" readonly aria-label="Your invite link">
                        <button class="btn" type="button" id="ref-copy" data-copy="ref-link">Copy</button>
                    </div>
                    <?php if ($ref['telegram'] !== ''): ?>
                        <p class="small muted">Telegram link: <a href="<?= $e($ref['telegram']) ?>" target="_blank" rel="noopener"><?= $e($ref['telegram']) ?></a></p>
                    <?php endif; ?>
                    <p class="small muted">Friends invited: <b><?= (int) $ref['friends'] ?></b> · rewarded: <b><?= (int) $ref['rewarded'] ?></b></p>
                </section>
            <?php endif; ?>

            <section class="card">
                <h2>Recent top-ups</h2>
                <?php if ($view['orders'] === []): ?>
                    <p class="muted">No top-ups yet.</p>
                <?php else: ?>
                    <ul class="orders">
                        <?php foreach ($view['orders'] as $order): ?>
                            <li>
                                <span><strong><?= $e($order['amount']) ?></strong><small class="muted"><?= $e($order['date']) ?></small></span>
                                <a class="status s-<?= $e($order['status']) ?>" href="<?= $e($app->baseUrl() . '/status.php?order=' . rawurlencode($order['id'])) ?>" target="_blank" rel="noopener"><?= $e($order['label']) ?></a>
                            </li>
                        <?php endforeach; ?>
                    </ul>
                <?php endif; ?>
            </section>
        <?php else: ?>
            <?php if ($view['telegram']['enabled']): ?>
                <section class="card">
                    <div class="row">
                        <h2>Telegram</h2>
                        <span class="badge <?= $view['telegram']['linked'] > 0 ? 'ok' : '' ?>"><?= $view['telegram']['linked'] > 0 ? 'Connected' : 'Not connected' ?></span>
                    </div>
                    <p class="muted">Connect @<?= $e($view['telegram']['bot']) ?> to your account:</p>
                    <ul class="ticks">
                        <li>A message for every payment, and when your credit lands</li>
                        <li>An alert when your balance runs low</li>
                        <li>Top up, check your balance and calls, and chat with support in Telegram</li>
                    </ul>
                    <?php if ($view['telegram']['linked'] > 0): ?>
                        <p class="muted small">Connected to <?= (int) $view['telegram']['linked'] ?> Telegram chat<?= $view['telegram']['linked'] === 1 ? '' : 's' ?>. You can connect another one below.</p>
                    <?php endif; ?>
                    <button class="btn" type="button" id="tg">Connect Telegram</button>
                    <p class="msg" id="tg-msg" role="status" hidden></p>
                </section>
            <?php endif; ?>

            <section class="card" id="twostep">
                <div class="row">
                    <h2>Two-step login</h2>
                    <span class="badge <?= $view['two_step'] ? 'ok' : 'warn' ?>" id="ts-badge"><?= $view['two_step'] ? 'On' : 'Off' ?></span>
                </div>
                <p class="muted">Protects your account even if someone learns your password: logging in also needs a 6-digit code from an
                    app on your phone (Google Authenticator, Microsoft Authenticator, Authy…).</p>

                <div id="ts-off" <?= $view['two_step'] ? 'hidden' : '' ?>>
                    <button class="btn" type="button" id="ts-start">Turn on two-step login</button>
                    <div id="ts-setup" class="setup" hidden>
                        <ol>
                            <li>Open your authenticator app and scan this code.</li>
                            <li>Enter the 6-digit code the app shows.</li>
                        </ol>
                        <div class="qr" id="ts-qr" aria-label="QR code"></div>
                        <p class="small muted">Can't scan? Enter this key in the app: <code id="ts-secret"></code></p>
                        <form id="ts-confirm" class="inline">
                            <input id="ts-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" required>
                            <button class="btn" type="submit">Confirm</button>
                        </form>
                    </div>
                </div>

                <div id="ts-on" <?= $view['two_step'] ? '' : 'hidden' ?>>
                    <p class="small">You will be asked for the code at your first login each day and when you log in from a new IP address.
                        Keep the app on your phone. If you lose it, contact support.</p>
                    <details class="danger">
                        <summary>Turn off two-step login</summary>
                        <form id="ts-disable" class="inline">
                            <input id="ts-off-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="Current code" required>
                            <button class="btn ghost" type="submit">Turn off</button>
                        </form>
                    </details>
                </div>
                <p class="msg" id="ts-msg" role="status" hidden></p>
            </section>
        <?php endif; ?>
    <?php endif; ?>
</main>
<script type="application/json" id="panel-config"><?= json_encode($client, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>
<script src="qrcode.js?v=1.4.4"></script>
<script src="panel.js?v=3"></script>
</body>
</html>
