<?php

/**
 * Page shell. Expects: $app (Gateway\App), $title (string), $body (callable echoing the card content),
 * optional $after (callable echoing content below the card) and $hero (callable, VoIP theme intro column).
 */

declare(strict_types=1);

use Gateway\Settings;
use Gateway\Web;

$site = $app->config['site'];
$theme = Settings::normalizeTheme((string) ($site['theme'] ?? 'voip'));
// ?preview=<theme> shows another theme for this page view only (used by the bot's 👀 Preview buttons).
if (isset($_GET['preview']) && is_string($_GET['preview']) && isset(Settings::THEMES[strtolower($_GET['preview'])])) {
    $theme = strtolower($_GET['preview']);
}
$public = $app->publicConfig();
$bot = $public['telegram_bot'];
$announcement = trim((string) ($site['announcement'] ?? ''));
$after = $after ?? null;
$hero = $hero ?? null;
$assetBase = $assetBase ?? '';       // e.g. '../' for pages in a sub-folder (terms/)
$homeUrl = $homeUrl ?? './';
$wide = !empty($wide);
$termsUrl = $app->termsUrl();
if ($wide) {
    $announcement = ''; // no promo banner on legal pages
}
$themeColor = ['voip' => '#050a14', 'emerald' => '#03100b', 'violet' => '#0b0614', 'luxury' => '#07070a', 'light' => '#f5f7fb'][$theme];

// Live status pill: based on the gateway's own health checks (cron), not a guess.
$degraded = false;
try {
    $degraded = $app->db()->kvGet('health:magnusbilling:alerted') === '1' || $app->db()->kvGet('health:oxapay:alerted') === '1';
} catch (\Throwable $e) {
}

Web::securityHeaders();
header('Content-Type: text/html; charset=utf-8');

$logo = static function () use ($site, $theme): void {
    if ((string) $site['logo_url'] !== '') {
        echo '<img class="logo" src="' . Web::e($site['logo_url']) . '" alt="">';
    } else {
        echo '<span class="logo monogram" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" fill="currentColor"/><path d="M15 3.5a6 6 0 0 1 5.5 5.5M15 7a2.5 2.5 0 0 1 2 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>';
    }
};
?><!doctype html>
<html lang="en" data-theme="<?= Web::e($theme) ?>">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex">
    <meta name="theme-color" content="<?= Web::e($themeColor) ?>">
    <title><?= Web::e($title) ?></title>
    <?php if ((string) $site['logo_url'] !== ''): ?>
        <link rel="icon" href="<?= Web::e($site['logo_url']) ?>">
    <?php endif; ?>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=<?= Settings::THEME_FONTS[$theme] ?>&display=swap">
    <link rel="stylesheet" href="<?= Web::e($assetBase) ?>assets/style.css?v=5">
</head>
<body>
<div class="backdrop" aria-hidden="true"></div>

    <header class="topbar">
        <div class="topbar-inner">
            <a class="topbar-brand" href="<?= Web::e($homeUrl) ?>">
                <?php $logo(); ?>
                <span class="topbar-name"><?= Web::e($site['name']) ?></span>
            </a>
            <nav class="topbar-nav" aria-label="Links">
                <span class="status-pill <?= $degraded ? 'warn' : '' ?>" title="Status of billing and payments">
                    <i aria-hidden="true"></i><span class="long"><?= $degraded ? 'Delays possible' : 'All systems online' ?></span><span class="short"><?= $degraded ? 'Delays' : 'Online' ?></span>
                </span>
                <?php if ($bot !== ''): ?>
                    <a class="nav-link" href="https://t.me/<?= Web::e($bot) ?>" rel="noopener" title="Telegram">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 4 3 11l6 2 2 6 3-4 5 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
                        <span>Telegram</span>
                    </a>
                <?php endif; ?>
                <?php if ((string) $site['support_url'] !== ''): ?>
                    <a class="nav-link" href="<?= Web::e($site['support_url']) ?>" rel="noopener">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13v-1a8 8 0 0 1 16 0v1M4 13a2 2 0 0 1 2-2h1v6H6a2 2 0 0 1-2-2zm16 0a2 2 0 0 0-2-2h-1v6h1a2 2 0 0 0 2-2zM17 17c0 2-2 3-5 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
                        <span>Support</span>
                    </a>
                <?php endif; ?>
            </nav>
        </div>
    </header>
    <main class="page<?= $hero !== null ? ' with-hero' : '' ?><?= $wide ? ' wide' : '' ?>">
        <?php if ($announcement !== ''): ?>
            <p class="announcement"><span aria-hidden="true">⚡</span> <?= Web::e($announcement) ?></p>
        <?php endif; ?>
        <div class="layout">
            <?php if ($hero !== null): ?>
                <section class="hero"><?php $hero(); ?></section>
            <?php endif; ?>
            <section class="card"><?php $body(); ?></section>
        </div>
        <?php if ($after !== null) { $after(); } ?>
        <footer class="foot">
            <span>© <?= date('Y') ?> <?= Web::e($site['name']) ?></span>
            <span>Crypto checkout by OxaPay</span>
            <a href="<?= Web::e($termsUrl) ?>">Terms</a>
            <?php if ((string) $site['support_url'] !== ''): ?>
                <a href="<?= Web::e($site['support_url']) ?>" rel="noopener">Support</a>
            <?php endif; ?>
        </footer>
    </main>
<script type="application/json" id="gateway-config"><?= json_encode($public, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>
<script src="<?= Web::e($assetBase) ?>assets/app.js?v=5" defer></script>
</body>
</html>
