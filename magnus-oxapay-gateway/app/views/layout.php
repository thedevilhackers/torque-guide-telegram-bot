<?php

/**
 * Page shell. Expects: $app (Gateway\App), $title (string), $body (callable echoing the card content),
 * optional $after (callable echoing content below the card).
 */

declare(strict_types=1);

use Gateway\Web;

$site = $app->config['site'];
$theme = (string) ($site['theme'] ?? 'luxury') === 'classic' ? 'classic' : 'luxury';
$accent = preg_match('/^#[0-9a-fA-F]{3,8}$/', (string) $site['accent']) ? (string) $site['accent'] : '#4f46e5';
$public = $app->publicConfig();
$bot = $public['telegram_bot'];
$announcement = trim((string) ($site['announcement'] ?? ''));
$after = $after ?? null;

Web::securityHeaders();
header('Content-Type: text/html; charset=utf-8');
?><!doctype html>
<html lang="en" data-theme="<?= Web::e($theme) ?>">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex">
    <meta name="theme-color" content="<?= $theme === 'luxury' ? '#07070a' : '#f4f5f9' ?>">
    <title><?= Web::e($title) ?></title>
    <?php if ((string) $site['logo_url'] !== ''): ?>
        <link rel="icon" href="<?= Web::e($site['logo_url']) ?>">
    <?php endif; ?>
    <?php if ($theme === 'luxury'): ?>
        <link rel="preconnect" href="https://fonts.googleapis.com">
        <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@600;700&display=swap">
    <?php endif; ?>
    <link rel="stylesheet" href="assets/style.css?v=2">
    <?php if ($theme === 'classic'): ?>
        <style>:root { --accent: <?= Web::e($accent) ?>; }</style>
    <?php endif; ?>
</head>
<body>
<div class="backdrop" aria-hidden="true"></div>
<main class="shell">
    <?php if ($announcement !== ''): ?>
        <p class="announcement"><span aria-hidden="true">✦</span> <?= Web::e($announcement) ?></p>
    <?php endif; ?>
    <section class="card">
        <header class="brand">
            <?php if ((string) $site['logo_url'] !== ''): ?>
                <img class="logo" src="<?= Web::e($site['logo_url']) ?>" alt="">
            <?php else: ?>
                <span class="logo monogram" aria-hidden="true"><?= Web::e(strtoupper(substr((string) $site['name'], 0, 1))) ?></span>
            <?php endif; ?>
            <div class="brand-text">
                <p class="brand-name"><?= Web::e($site['name']) ?></p>
                <p class="brand-tagline"><?= Web::e($site['tagline']) ?></p>
            </div>
            <span class="secure-pill" title="Encrypted connection and checkout">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><rect x="5" y="10" width="14" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
                Secure
            </span>
        </header>
        <?php $body(); ?>
    </section>
    <?php if ($after !== null) { $after(); } ?>
    <footer class="foot">
        <?php if ($bot !== ''): ?>
            <a href="https://t.me/<?= Web::e($bot) ?>" rel="noopener">Telegram @<?= Web::e($bot) ?></a>
        <?php endif; ?>
        <?php if ((string) $site['support_url'] !== ''): ?>
            <a href="<?= Web::e($site['support_url']) ?>" rel="noopener">Support</a>
        <?php endif; ?>
        <span>Crypto checkout by OxaPay</span>
        <span>© <?= date('Y') ?> <?= Web::e($site['name']) ?></span>
    </footer>
</main>
<script type="application/json" id="gateway-config"><?= json_encode($public, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>
<script src="assets/app.js?v=2" defer></script>
</body>
</html>
