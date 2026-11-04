<?php

/**
 * Test suite (no dependencies):  php tests/run.php
 */

declare(strict_types=1);

use Gateway\App;
use Gateway\Http;
use Gateway\UserError;

require __DIR__ . '/../app/bootstrap.php';
require __DIR__ . '/FakeServices.php';

$tests = [];
$failures = 0;

function test(string $name, callable $fn): void
{
    global $tests;
    $tests[$name] = $fn;
}

function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function same($expected, $actual, string $message = ''): void
{
    if ($expected !== $actual) {
        throw new RuntimeException(($message !== '' ? $message . ': ' : '') . 'expected ' . var_export($expected, true) . ', got ' . var_export($actual, true));
    }
}

function throwsUserError(callable $fn, string $code): void
{
    try {
        $fn();
    } catch (UserError $e) {
        same($code, $e->errorCode, 'error code');
        return;
    }
    throw new RuntimeException("Expected UserError {$code}");
}

/**
 * @return array{0:App, 1:FakeServices}
 */
function makeApp(array $overrides = []): array
{
    $fake = new FakeServices();
    Http::setTransport($fake);
    $config = [
        'site' => ['name' => 'Test Carrier', 'base_url' => 'https://pay.example.test'],
        'magnus' => ['url' => FakeServices::MAGNUS_URL, 'api_key' => FakeServices::MAGNUS_KEY, 'api_secret' => FakeServices::MAGNUS_SECRET],
        'oxapay' => ['merchant_api_key' => FakeServices::OXAPAY_KEY, 'base_url' => 'https://api.oxapay.test/v1'],
        'telegram' => ['enabled' => true, 'bot_token' => '123:abc', 'admin_chat_ids' => [999], 'webhook_secret' => 'secret-secret-secret'],
        'database' => ['dsn' => 'sqlite::memory:'],
        'app' => ['log_file' => ''],
    ];
    foreach ($overrides as $section => $values) {
        $config[$section] = array_replace($config[$section] ?? [], $values);
    }

    return [new App($config), $fake];
}

function messagesTo(FakeServices $fake, string $chatId): array
{
    $out = [];
    foreach ($fake->telegram as $call) {
        if ($call['method'] === 'sendMessage' && (string) $call['params']['chat_id'] === $chatId) {
            $out[] = $call['params'];
        }
    }

    return $out;
}

// ---------------------------------------------------------------- input

test('amount parsing and limits', function () {
    [$app] = makeApp();
    $p = $app->payments();
    same('25.00', $p->parseAmount('25'));
    same('25.50', $p->parseAmount('25,5'));
    same('10.00', $p->parseAmount(10));
    throwsUserError(function () use ($p) { $p->parseAmount('abc'); }, 'invalid_amount');
    throwsUserError(function () use ($p) { $p->parseAmount('1.234'); }, 'invalid_amount');
    throwsUserError(function () use ($p) { $p->parseAmount('-5'); }, 'invalid_amount');
    throwsUserError(function () use ($p) { $p->parseAmount('4.99'); }, 'amount_too_low');
    throwsUserError(function () use ($p) { $p->parseAmount('1000.01'); }, 'amount_too_high');
});

test('username validation', function () {
    [$app] = makeApp();
    $p = $app->payments();
    same('alice', $p->normalizeUsername('  alice '));
    throwsUserError(function () use ($p) { $p->normalizeUsername(''); }, 'invalid_username');
    throwsUserError(function () use ($p) { $p->normalizeUsername("ali'ce"); }, 'invalid_username');
    throwsUserError(function () use ($p) { $p->normalizeUsername(str_repeat('a', 65)); }, 'invalid_username');
});

test('quote applies credit rate and the best bonus tier', function () {
    [$app] = makeApp(['payments' => ['credit_rate' => 2, 'bonus' => [['min' => 50, 'percent' => 5], ['min' => 100, 'percent' => 10]]]]);
    $p = $app->payments();
    same('40.0000', $p->quote('20.00')['credit']);
    same('105.0000', $p->quote('50.00')['credit']);
    same(10.0, $p->quote('150.00')['bonus_percent']);
    same('330.0000', $p->quote('150.00')['credit']);
});

test('config lists replace defaults instead of merging by index', function () {
    [$app] = makeApp(['payments' => ['presets' => [5, 20]]]);
    same([5, 20], $app->config['payments']['presets']);
});

// --------------------------------------------------------------- orders

test('create order: unknown user is rejected before any invoice', function () {
    [$app, $fake] = makeApp();
    throwsUserError(function () use ($app) {
        $app->payments()->createOrder(['username' => 'nobody', 'amount' => '10'], 'web');
    }, 'unknown_user');
    same(0, count($fake->invoices));
});

test('create order: signed Magnus lookup + OxaPay invoice', function () {
    [$app, $fake] = makeApp();
    $order = $app->payments()->createOrder(['username' => 'ALICE', 'amount' => '25'], 'web', ['ip' => '1.2.3.4']);
    same('pending', $order['status']);
    same('alice', $order['username'], 'stores the canonical Magnus username');
    same(7, (int) $order['magnus_user_id']);
    check((bool) preg_match('/^[a-f0-9]{24}$/', $order['id']), 'random order id');
    $invoice = $fake->invoices[$order['track_id']];
    same(25.0, (float) $invoice['amount']);
    same('USD', $invoice['currency']);
    same($order['id'], $invoice['order_id']);
    same('https://pay.example.test/webhook.php', $invoice['callback_url']);
    same('https://pay.example.test/status.php?order=' . $order['id'], $invoice['return_url']);
    same('https://pay.oxapay.com/123/' . $order['track_id'], $order['payment_url']);
});

test('create order: OxaPay outage marks the order failed with a friendly error', function () {
    [$app, $fake] = makeApp();
    $fake->oxapayDown = true;
    throwsUserError(function () use ($app) {
        $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'web');
    }, 'gateway_unavailable');
    $orders = $app->payments()->recent();
    same('failed', $orders[0]['status']);
    check(strpos((string) $orders[0]['last_error'], 'maintenance') !== false, 'stores the provider error');
});

test('create order: return_url and reference only for trusted API clients', function () {
    [$app, $fake] = makeApp();
    $input = ['username' => 'alice', 'amount' => '10', 'reference' => 'INV-77', 'return_url' => 'https://crm.example/done'];
    $public = $app->payments()->createOrder($input, 'web');
    same(null, $public['reference']);
    check(strpos($fake->invoices[$public['track_id']]['return_url'], 'pay.example.test/status.php') !== false, 'public caller cannot change return_url');

    $trusted = $app->payments()->createOrder($input, 'api', ['trusted' => true]);
    same('INV-77', $trusted['reference']);
    same('https://crm.example/done', $fake->invoices[$trusted['track_id']]['return_url']);

    throwsUserError(function () use ($app) {
        $app->payments()->createOrder(['username' => 'alice', 'amount' => '10', 'return_url' => 'javascript:alert(1)'], 'api', ['trusted' => true]);
    }, 'invalid_return_url');
});

test('values MagnusBilling treats as attacks are never sent (would ban 127.0.0.1)', function () {
    [$app, $fake] = makeApp(['payments' => ['refill_description' => 'Print receipt {order}']]);
    foreach (['evaltest', 'copy1', 'xprintx', 'Alert'] as $name) {
        throwsUserError(function () use ($app, $name) {
            $app->payments()->createOrder(['username' => $name, 'amount' => '10'], 'web');
        }, 'unknown_user');
    }
    same(0, count($fake->magnusCalls), 'no Magnus request for unsafe usernames');

    // An unsafe refill description template falls back to a safe one.
    $order = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'web');
    $fake->oxapayStatus($order['track_id'], 'Paid');
    [$body, $hmac] = $fake->webhook($order['track_id'], 'Paid');
    same([200, 'ok'], $app->payments()->handleWebhook($body, $hmac));
    same('credited', $app->payments()->getOrder($order['id'])['status']);
    check(strpos($fake->refills[0]['description'], 'OxaPay top-up #' . $order['id']) === 0, 'fallback description');
    same(0, $fake->sqlInjectStrikes, 'no SqlInject strikes');

    check(\Gateway\MagnusBilling::isSafeValue('100234'), 'normal username is safe');
    check(!\Gateway\MagnusBilling::isSafeValue(str_repeat('a', 251)), 'too long');
});

// -------------------------------------------------------------- webhook

test('webhook: bad HMAC is rejected and nothing is credited', function () {
    [$app, $fake] = makeApp();
    $order = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'web');
    $fake->oxapayStatus($order['track_id'], 'Paid');
    [$body] = $fake->webhook($order['track_id'], 'Paid');
    same([400, 'invalid hmac'], $app->payments()->handleWebhook($body, str_repeat('0', 128)));
    same([400, 'invalid hmac'], $app->payments()->handleWebhook($body, null));
    [$body, $hmac] = $fake->webhook($order['track_id'], 'Paid', 'some-other-key');
    same([400, 'invalid hmac'], $app->payments()->handleWebhook($body, $hmac));
    same(0, count($fake->refills));
    same(1.5, $fake->users[7]['credit']);
});

test('webhook: paid invoice credits Magnus exactly once', function () {
    [$app, $fake] = makeApp();
    $order = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'web');
    $fake->oxapayStatus($order['track_id'], 'Paid');
    [$body, $hmac] = $fake->webhook($order['track_id'], 'Paid');

    same([200, 'ok'], $app->payments()->handleWebhook($body, strtoupper($hmac)));
    same([200, 'ok'], $app->payments()->handleWebhook($body, $hmac), 'duplicate webhook');
    same([200, 'ok'], $app->payments()->handleWebhook($body, $hmac), 'third delivery');

    same(1, count($fake->refills), 'one refill');
    same(11.5, $fake->users[7]['credit']);
    check(strpos($fake->refills[0]['description'], $order['id']) !== false, 'refill description has the order id');
    same(1, $fake->refills[0]['payment']);
    same(0, $fake->sqlInjectStrikes, 'default requests pass MagnusBilling\'s SqlInject filter');
    $stored = $app->payments()->getOrder($order['id']);
    same('credited', $stored['status']);
    same('1', $stored['refill_id']);

    $admin = messagesTo($fake, '999');
    same(1, count($admin), 'one admin alert');
    check(strpos($admin[0]['text'], 'New top-up') !== false, 'admin alert text');
});

test('webhook: body says Paid but OxaPay API says otherwise -> no credit', function () {
    [$app, $fake] = makeApp();
    $order = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'web');
    $fake->oxapayStatus($order['track_id'], 'Paying');
    [$body, $hmac] = $fake->webhook($order['track_id'], 'Paid');
    same([200, 'ok'], $app->payments()->handleWebhook($body, $hmac));
    same(0, count($fake->refills));
    same('paying', $app->payments()->getOrder($order['id'])['status']);
});

test('webhook: track_id that does not belong to the order is ignored', function () {
    [$app, $fake] = makeApp();
    $a = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'web');
    $b = $app->payments()->createOrder(['username' => 'alice', 'amount' => '500'], 'web');
    $fake->oxapayStatus($a['track_id'], 'Paid');
    $body = json_encode(['track_id' => $a['track_id'], 'status' => 'Paid', 'type' => 'invoice', 'order_id' => $b['id'], 'amount' => 500]);
    same([200, 'ok'], $app->payments()->handleWebhook($body, hash_hmac('sha512', $body, FakeServices::OXAPAY_KEY)));
    same(0, count($fake->refills));
    same('pending', $app->payments()->getOrder($b['id'])['status']);
});

test('webhook: Magnus outage -> credit_failed, 500 for OxaPay retry, then credited once', function () {
    [$app, $fake] = makeApp();
    $order = $app->payments()->createOrder(['username' => 'alice', 'amount' => '20'], 'web');
    $fake->oxapayStatus($order['track_id'], 'Paid');
    [$body, $hmac] = $fake->webhook($order['track_id'], 'Paid');

    $fake->magnusDown = true;
    same([500, 'retry'], $app->payments()->handleWebhook($body, $hmac));
    same('credit_failed', $app->payments()->getOrder($order['id'])['status']);
    same([500, 'retry'], $app->payments()->handleWebhook($body, $hmac));
    same(1, count(array_filter(messagesTo($fake, '999'), function ($m) { return strpos($m['text'], 'credit failed') !== false; })), 'alert sent once');

    $fake->magnusDown = false;
    same([200, 'ok'], $app->payments()->handleWebhook($body, $hmac));
    same('credited', $app->payments()->getOrder($order['id'])['status']);
    same(1, count($fake->refills));
    same(21.5, $fake->users[7]['credit']);
});

test('lost Magnus reply does not lead to a double credit', function () {
    [$app, $fake] = makeApp();
    $order = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'web');
    $fake->oxapayStatus($order['track_id'], 'Paid');
    [$body, $hmac] = $fake->webhook($order['track_id'], 'Paid');

    $fake->loseNextRefillReply = true;
    same([500, 'retry'], $app->payments()->handleWebhook($body, $hmac));
    same(1, count($fake->refills), 'refill was actually saved');

    same([200, 'ok'], $app->payments()->handleWebhook($body, $hmac));
    same(1, count($fake->refills), 'retry found the existing refill');
    same(11.5, $fake->users[7]['credit']);
    same('credited', $app->payments()->getOrder($order['id'])['status']);
});

test('order stuck in crediting is recovered by admin retry without double credit', function () {
    [$app, $fake] = makeApp();
    $order = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'web');
    $fake->oxapayStatus($order['track_id'], 'Paid');
    [$body, $hmac] = $fake->webhook($order['track_id'], 'Paid');
    $app->payments()->handleWebhook($body, $hmac);
    // Simulate a crash right after Magnus saved the refill.
    $app->db()->run("UPDATE oxg_orders SET status = 'crediting' WHERE id = ?", [$order['id']]);

    same([200, 'ok'], $app->payments()->handleWebhook($body, $hmac), 'webhooks leave a locked order alone');
    same('crediting', $app->payments()->getOrder($order['id'])['status']);
    same('credited', $app->payments()->retry($order['id'])['status']);
    same(1, count($fake->refills));
});

test('expired and underpaid invoices', function () {
    [$app, $fake] = makeApp();
    $a = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'telegram', ['tg_chat_id' => '555']);
    $fake->oxapayStatus($a['track_id'], 'Expired');
    [$body, $hmac] = $fake->webhook($a['track_id'], 'Expired');
    same([200, 'ok'], $app->payments()->handleWebhook($body, $hmac));
    same('expired', $app->payments()->getOrder($a['id'])['status']);
    check(strpos(messagesTo($fake, '555')[0]['text'], 'expired') !== false, 'customer told about expiry');

    // A late payment on an expired invoice is still credited.
    $fake->oxapayStatus($a['track_id'], 'Paid');
    [$body, $hmac] = $fake->webhook($a['track_id'], 'Paid');
    $app->payments()->handleWebhook($body, $hmac);
    same('credited', $app->payments()->getOrder($a['id'])['status']);

    $b = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'web');
    $fake->oxapayStatus($b['track_id'], 'Underpaid');
    [$body, $hmac] = $fake->webhook($b['track_id'], 'Underpaid');
    $app->payments()->handleWebhook($body, $hmac);
    same('underpaid', $app->payments()->getOrder($b['id'])['status']);
});

test('status page refresh credits a paid order even if the webhook never arrived', function () {
    [$app, $fake] = makeApp();
    $order = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'web');
    $fake->oxapayStatus($order['track_id'], 'Paid');
    $refreshed = $app->payments()->refreshIfStale($order);
    same('credited', $refreshed['status']);
    $view = $app->payments()->publicView($refreshed);
    same(true, $view['is_final']);
    same(null, $view['payment_url']);
    same('10.00', $view['credit']);

    // Throttled: a second refresh within 15 s does not call OxaPay again.
    $other = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'web');
    $app->payments()->refreshIfStale($other);
    $fake->oxapayStatus($other['track_id'], 'Paid');
    same('pending', $app->payments()->refreshIfStale($app->payments()->getOrder($other['id']))['status']);
});

test('amount mismatch holds the order for review', function () {
    [$app, $fake] = makeApp(['oxapay' => ['verify_with_api' => false]]);
    $order = $app->payments()->createOrder(['username' => 'alice', 'amount' => '50'], 'web');
    $body = json_encode(['track_id' => $order['track_id'], 'status' => 'Paid', 'type' => 'invoice', 'order_id' => $order['id'], 'amount' => 5, 'currency' => 'USD']);
    $app->payments()->handleWebhook($body, hash_hmac('sha512', $body, FakeServices::OXAPAY_KEY));
    same('review', $app->payments()->getOrder($order['id'])['status']);
    same(0, count($fake->refills));
    same('credited', $app->payments()->retry($order['id'])['status'], 'admin can force it');
});

test('rate limiter', function () {
    [$app] = makeApp();
    $db = $app->db();
    same(true, $db->rateLimit('k', 2, 60));
    same(true, $db->rateLimit('k', 2, 60));
    same(false, $db->rateLimit('k', 2, 60));
    same(true, $db->rateLimit('other', 2, 60));
});

// ------------------------------------------------------------- telegram

test('telegram: guided top-up flow and payment confirmation', function () {
    [$app, $fake] = makeApp();
    $bot = $app->bot();
    $msg = function (string $text) use ($bot) {
        $bot->handleUpdate(['update_id' => 1, 'message' => ['chat' => ['id' => 4242, 'type' => 'private'], 'text' => $text]]);
    };

    $msg('/start');
    check(strpos(messagesTo($fake, '4242')[0]['text'], 'Test Carrier') !== false, 'welcome');

    $msg('/topup');
    $msg('ghost');
    $last = messagesTo($fake, '4242');
    check(strpos(end($last)['text'], 'No account found') !== false, 'unknown username message');

    $msg('alice');
    $last = messagesTo($fake, '4242');
    $keyboard = end($last)['reply_markup']['inline_keyboard'];
    same('amt:10', $keyboard[0][0]['callback_data'], 'preset buttons');

    $bot->handleUpdate(['update_id' => 2, 'callback_query' => [
        'id' => 'cb1', 'data' => 'amt:25', 'from' => ['id' => 4242], 'message' => ['chat' => ['id' => 4242]],
    ]]);
    $last = messagesTo($fake, '4242');
    $payMessage = end($last);
    check(strpos($payMessage['text'], 'Payment created') !== false, 'payment created message');
    check(strpos($payMessage['reply_markup']['inline_keyboard'][0][0]['url'], 'https://pay.oxapay.com/') === 0, 'pay button');

    $order = $app->payments()->recent(1)[0];
    same('telegram', $order['source']);
    same('4242', $order['tg_chat_id']);
    same('25.00', number_format((float) $order['amount'], 2, '.', ''));

    $fake->oxapayStatus($order['track_id'], 'Paid');
    [$body, $hmac] = $fake->webhook($order['track_id'], 'Paid');
    $app->payments()->handleWebhook($body, $hmac);
    $last = messagesTo($fake, '4242');
    check(strpos(end($last)['text'], 'Payment confirmed') !== false, 'customer notified');
});

test('telegram: one-line /topup and admin commands', function () {
    [$app, $fake] = makeApp();
    $bot = $app->bot();
    $bot->handleUpdate(['message' => ['chat' => ['id' => 77, 'type' => 'private'], 'text' => '/topup 100234 15']]);
    same(1, count($app->payments()->recent()));

    $bot->handleUpdate(['message' => ['chat' => ['id' => 77, 'type' => 'private'], 'text' => '/recent']]);
    $last = messagesTo($fake, '77');
    check(strpos(end($last)['text'], 'Unknown command') !== false, 'non-admin cannot use /recent');

    $bot->handleUpdate(['message' => ['chat' => ['id' => 999, 'type' => 'private'], 'text' => '/recent']]);
    $last = messagesTo($fake, '999');
    check(strpos(end($last)['text'], '100234') !== false, 'admin sees recent orders');

    $bot->handleUpdate(['message' => ['chat' => ['id' => 999, 'type' => 'private'], 'text' => '/balance alice']]);
    $last = messagesTo($fake, '999');
    check(strpos(end($last)['text'], '1.50') !== false, 'admin balance lookup');

    $bot->handleUpdate(['message' => ['chat' => ['id' => 77, 'type' => 'private'], 'text' => '/topup alice 2']]);
    $last = messagesTo($fake, '77');
    check(strpos(end($last)['text'], 'minimum') !== false, 'amount validation message');
});

/**
 * Sends a Telegram message as $chatId and returns the bot's last reply to that chat.
 */
function tgSay(\Gateway\App $app, FakeServices $fake, $chatId, string $text, string $username = 'boss'): array
{
    $app->bot()->handleUpdate(['message' => [
        'chat' => ['id' => $chatId, 'type' => 'private'], 'from' => ['id' => $chatId, 'username' => $username], 'text' => $text,
    ]]);
    $replies = messagesTo($fake, (string) $chatId);

    return end($replies) ?: [];
}

function tgTap(\Gateway\App $app, FakeServices $fake, $chatId, string $data): array
{
    $app->bot()->handleUpdate(['callback_query' => [
        'id' => 'cb' . mt_rand(), 'data' => $data, 'from' => ['id' => $chatId, 'username' => 'boss'], 'message' => ['chat' => ['id' => $chatId]],
    ]]);
    $replies = messagesTo($fake, (string) $chatId);

    return end($replies) ?: [];
}

function confirmButton(array $reply): string
{
    return (string) ($reply['reply_markup']['inline_keyboard'][0][0]['callback_data'] ?? '');
}

test('admin: /sip lists SIP accounts by SIP name or account username', function () {
    [$app, $fake] = makeApp();
    $reply = tgSay($app, $fake, 999, '/sip alice');
    check(strpos($reply['text'], 'alice') !== false && strpos($reply['text'], '15550001') !== false, 'sip by name');
    check(strpos($reply['text'], 'alice2') === false, 'exact SIP name match wins');

    [$app, $fake] = makeApp();
    $fake->sips[21]['name'] = 'alice-desk';
    $reply = tgSay($app, $fake, 999, '/sip alice');
    check(strpos($reply['text'], 'alice-desk') !== false && strpos($reply['text'], 'alice2') !== false, 'all SIP accounts of the user');

    $reply = tgSay($app, $fake, 999, '/sip nobody');
    check(strpos($reply['text'], 'No SIP account') !== false, 'not found');
});

test('admin: /callerid asks for confirmation, then updates MagnusBilling once', function () {
    [$app, $fake] = makeApp(['telegram' => ['admin_chat_ids' => [999, 1000]]]);
    $reply = tgSay($app, $fake, 999, '/callerid 100234 +1 (555) 777-8888');
    check(strpos($reply['text'], 'Change caller ID') !== false, 'asks to confirm');
    same('100234', $fake->sips[23]['callerid'], 'nothing changed before confirming');

    $button = confirmButton($reply);
    check(strpos($button, 'cf:') === 0, 'confirm button');
    $done = tgTap($app, $fake, 999, $button);
    check(strpos($done['text'], 'Caller ID updated') !== false, 'success reply');
    same('+15557778888', $fake->sips[23]['callerid']);
    same('+15557778888', $fake->sips[23]['cid_number']);

    $other = messagesTo($fake, '1000');
    check(strpos(end($other)['text'], '@boss changed caller ID') !== false, 'other admins informed');

    $again = tgTap($app, $fake, 999, $button);
    check(strpos($again['text'], 'expired or was already used') !== false, 'button works only once');
    same(1, count(array_filter($fake->magnusCalls, function ($c) { return $c['module'] === 'sip' && $c['action'] === 'save'; })));
});

test('admin: caller ID validation, ambiguity and cancel', function () {
    [$app, $fake] = makeApp();
    $reply = tgSay($app, $fake, 999, '/callerid 100234 12ab');
    check(strpos($reply['text'], 'Caller ID must be') !== false, 'invalid number');

    $fake->sips[21]['name'] = 'alice-desk';
    $reply = tgSay($app, $fake, 999, '/callerid alice 15551234');
    check(strpos($reply['text'], 'has 2 SIP accounts') !== false, 'asks which SIP account');

    $reply = tgSay($app, $fake, 999, '/callerid alice2 15551234');
    $cancel = tgTap($app, $fake, 999, 'cancel');
    check(strpos($cancel['text'], 'Nothing was changed') !== false, 'cancel');
    $late = tgTap($app, $fake, 999, confirmButton($reply));
    check(strpos($late['text'], 'expired') !== false, 'confirm after cancel is refused');
    same('15550002', $fake->sips[22]['callerid']);
});

test('admin: commands are refused for non-admins, even with a forged button', function () {
    [$app, $fake] = makeApp();
    $reply = tgSay($app, $fake, 4242, '/callerid 100234 15559999');
    check(strpos($reply['text'], 'Unknown command') !== false, 'not offered to customers');
    $admin = tgSay($app, $fake, 999, '/addcredit alice 50');
    tgTap($app, $fake, 4242, confirmButton($admin));
    same(1.5, $fake->users[7]['credit'], 'button from another chat does nothing');
    same('100234', $fake->sips[23]['callerid']);
});

test('admin: /addcredit and /removecredit change the balance through a refill', function () {
    [$app, $fake] = makeApp();
    $reply = tgSay($app, $fake, 999, '/addcredit alice 25 bank transfer 123');
    check(strpos($reply['text'], 'Add <b>25.00</b> credit to') !== false, 'confirm text');
    same(1.5, $fake->users[7]['credit'], 'unchanged before confirming');
    $done = tgTap($app, $fake, 999, confirmButton($reply));
    check(strpos($done['text'], 'New balance: <b>26.50</b>') !== false, 'new balance shown');
    same(26.5, $fake->users[7]['credit']);
    check(strpos($fake->refills[0]['description'], 'Telegram admin @boss: bank transfer 123') === 0, 'audit description');

    $reply = tgSay($app, $fake, 999, '/removecredit alice 6.5 correction');
    check(strpos($reply['text'], 'Remove <b>6.50</b> credit from') !== false, 'remove confirm text');
    tgTap($app, $fake, 999, confirmButton($reply));
    same(20.0, $fake->users[7]['credit']);
    same(-6.5, $fake->refills[1]['credit']);

    $reply = tgSay($app, $fake, 999, '/addcredit alice 0');
    check(strpos($reply['text'], 'non-zero amount') !== false, 'zero rejected');
    $reply = tgSay($app, $fake, 999, '/addcredit ghost 5');
    check(strpos($reply['text'], 'No account found') !== false, 'unknown user');

    // A note MagnusBilling would flag as an attack is replaced, never sent.
    $reply = tgSay($app, $fake, 999, '/addcredit alice 1 copy of invoice');
    tgTap($app, $fake, 999, confirmButton($reply));
    same('Manual credit via Telegram admin, Old credit 20', $fake->refills[2]['description']);
    same(0, $fake->sqlInjectStrikes);
});

test('admin: /markpaid credits an open order once and tells the customer', function () {
    [$app, $fake] = makeApp();
    $order = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'telegram', ['tg_chat_id' => '555']);
    $reply = tgSay($app, $fake, 999, '/markpaid ' . $order['id']);
    check(strpos($reply['text'], 'Mark this order as paid') !== false, 'confirm text');
    tgTap($app, $fake, 999, confirmButton($reply));
    $stored = $app->payments()->getOrder($order['id']);
    same('credited', $stored['status']);
    same('admin_paid', $stored['provider_status']);
    same(11.5, $fake->users[7]['credit']);
    $customer = messagesTo($fake, '555');
    check(strpos(end($customer)['text'], 'Payment confirmed') !== false, 'customer notified');

    $reply = tgSay($app, $fake, 999, '/markpaid ' . $order['id']);
    check(strpos($reply['text'], 'already credited') !== false, 'second time refused');
    same(1, count($fake->refills));
});

test('admin: missing update permission gives a clear fix', function () {
    [$app, $fake] = makeApp();
    $fake->apiActions = 'cr';
    $reply = tgSay($app, $fake, 999, '/callerid 100234 15559999');
    $done = tgTap($app, $fake, 999, confirmButton($reply));
    check(strpos($done['text'], 'Run install.sh again') !== false, 'tells the admin how to fix it');
    same('100234', $fake->sips[23]['callerid']);
});

test('bot: menu buttons, My payments and one-tap repeat top-up', function () {
    [$app, $fake] = makeApp();
    $welcome = tgSay($app, $fake, 4242, '/start', 'customer');
    same('💳 Top up', $welcome['reply_markup']['keyboard'][0][0]['text'], 'menu keyboard');

    $reply = tgSay($app, $fake, 4242, '🧾 My payments', 'customer');
    check(strpos($reply['text'], 'No payments from this chat yet') !== false, 'empty history');

    tgSay($app, $fake, 4242, '/topup alice 10', 'customer');
    $reply = tgSay($app, $fake, 4242, '🧾 My payments', 'customer');
    check(strpos($reply['text'], 'alice') !== false && strpos($reply['text'], '$10.00') !== false, 'history lists the order');
    check(strpos($reply['reply_markup']['inline_keyboard'][0][0]['url'], 'https://pay.oxapay.com/') === 0, 'pay button for open order');

    $reply = tgSay($app, $fake, 4242, '💳 Top up', 'customer');
    same('usr:alice', $reply['reply_markup']['inline_keyboard'][0][0]['callback_data'], 'previous username offered');
    $reply = tgTap($app, $fake, 4242, 'usr:alice');
    check(strpos($reply['text'], 'Choose an amount') !== false, 'tap goes straight to the amount');
});

test('bot: website deep links (top up for a username, follow an order)', function () {
    [$app, $fake] = makeApp();
    $reply = tgSay($app, $fake, 600, '/start u_alice', 'customer');
    check(strpos($reply['text'], 'Account: <code>alice</code>') !== false, 'u_ link starts top-up');

    $order = $app->payments()->createOrder(['username' => 'alice', 'amount' => '15'], 'web');
    $reply = tgSay($app, $fake, 600, '/start o_' . $order['id'], 'customer');
    check(strpos($reply['text'], 'Notifications are on') !== false, 'o_ link subscribes');
    same('600', $app->payments()->getOrder($order['id'])['tg_chat_id']);
    $reply = tgSay($app, $fake, 600, '/start o_' . $order['id'], 'customer');
    check(strpos($reply['text'], 'Notifications are on') !== false, 'second tap is fine');

    $reply = tgSay($app, $fake, 601, '/start o_' . $order['id'], 'someone');
    check(strpos($reply['text'], 'another Telegram chat') !== false, 'cannot take over another chat\'s order');
    same('600', $app->payments()->getOrder($order['id'])['tg_chat_id']);

    $fake->oxapayStatus($order['track_id'], 'Paid');
    [$body, $hmac] = $fake->webhook($order['track_id'], 'Paid');
    $app->payments()->handleWebhook($body, $hmac);
    $last = messagesTo($fake, '600');
    check(strpos(end($last)['text'], 'Payment confirmed') !== false, 'web order notified on Telegram');
});

test('admin: /find lists orders of an account', function () {
    [$app, $fake] = makeApp();
    $app->payments()->createOrder(['username' => 'alice', 'amount' => '12'], 'web');
    $reply = tgSay($app, $fake, 999, '/find ALICE');
    check(strpos($reply['text'], '$12.00') !== false, 'finds case-insensitively');
    $reply = tgSay($app, $fake, 4242, '/find alice', 'customer');
    check(strpos($reply['text'], 'Unknown command') !== false, 'admin only');
});

test('telegram: unexpected errors reply politely instead of crashing', function () {
    [$app, $fake] = makeApp();
    $fake->magnusDown = true;
    $app->bot()->handleUpdate(['message' => ['chat' => ['id' => 5, 'type' => 'private'], 'text' => '/topup alice 10']]);
    $last = messagesTo($fake, '5');
    check(strpos(end($last)['text'], 'unavailable') !== false, 'friendly message');
});

// ------------------------------------------------------------------ run

foreach ($tests as $name => $fn) {
    try {
        $fn();
        echo "  ok  {$name}\n";
    } catch (Throwable $e) {
        $failures++;
        echo "FAIL  {$name}\n      " . $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ")\n";
    }
}
Http::setTransport(null);

echo "\n" . (count($tests) - $failures) . '/' . count($tests) . " passed\n";
exit($failures > 0 ? 1 : 0);
