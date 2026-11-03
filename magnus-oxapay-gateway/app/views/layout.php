<?php

/**
 * Page shell. Expects: $app (Gateway\App), $title (string), $body (callable that echoes the page content),
 * $script (bool, include app.js).
 */

declare(strict_types=1);

use Gateway\Web;

$site = $app->config['site'];
$accent = preg_match('/^#[0-9a-fA-F]{3,8}$/', (string) $site['accent']) ? (string) $site['accent'] : '#4f46e5';
$public = $app->publicConfig();
$bot = $public['telegram_bot'];

Web::securityHeaders();
header('Content-Type: text/html; charset=utf-8');
?><!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title><?= Web::e($title) ?></title>
    <link rel="stylesheet" href="assets/style.css?v=1">
    <style>:root { --accent: <?= Web::e($accent) ?>; }</style>
</head>
<body>
<main class="shell">
    <section class="card">
        <header class="brand">
            <?php if ((string) $site['logo_url'] !== ''): ?>
                <img class="logo" src="<?= Web::e($site['logo_url']) ?>" alt="">
            <?php else: ?>
                <span class="logo monogram" aria-hidden="true"><?= Web::e(strtoupper(substr((string) $site['name'], 0, 1))) ?></span>
            <?php endif; ?>
            <div>
                <p class="brand-name"><?= Web::e($site['name']) ?></p>
                <p class="brand-tagline"><?= Web::e($site['tagline']) ?></p>
            </div>
        </header>
        <?php $body(); ?>
    </section>
    <footer class="foot">
        <?php if ($bot !== ''): ?>
            <a href="https://t.me/<?= Web::e($bot) ?>" rel="noopener">Top up from Telegram: @<?= Web::e($bot) ?></a>
        <?php endif; ?>
        <?php if ((string) $site['support_url'] !== ''): ?>
            <a href="<?= Web::e($site['support_url']) ?>" rel="noopener">Support</a>
        <?php endif; ?>
        <span>Crypto payments by OxaPay</span>
    </footer>
</main>
<script type="application/json" id="gateway-config"><?= json_encode($public, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) ?></script>
<script src="assets/app.js?v=1" defer></script>
</body>
</html>
