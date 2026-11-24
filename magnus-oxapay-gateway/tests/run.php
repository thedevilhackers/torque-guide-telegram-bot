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
        'telegram' => ['enabled' => true, 'bot_token' => '123:abc', 'bot_username' => 'testpay_bot', 'admin_chat_ids' => [999], 'webhook_secret' => 'secret-secret-secret'],
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
    same([200, 'ok'], $app->payments()->handleWebhook($body, $hmac), 'late reply is recognised as saved');
    same(1, count($fake->refills), 'refill was actually saved');
    same(0, count(array_filter(messagesTo($fake, '999'), function ($m) { return strpos($m['text'], 'credit failed') !== false; })), 'no false alarm');

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
    check((bool) preg_match('/^Manual credit via Telegram admin #adm-[a-f0-9]{8}, Old credit 20$/', $fake->refills[2]['description']), 'safe fallback description');
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

function findButton(array $reply, string $label): string
{
    foreach ($reply['reply_markup']['inline_keyboard'] ?? [] as $row) {
        foreach ($row as $button) {
            if (strpos($button['text'], $label) !== false && isset($button['callback_data'])) {
                return $button['callback_data'];
            }
        }
    }
    throw new RuntimeException("No button '{$label}'");
}

test('admin panel: menu button only for admins', function () {
    [$app, $fake] = makeApp();
    $welcome = tgSay($app, $fake, 999, '/start');
    same('🛠 Admin panel', $welcome['reply_markup']['keyboard'][2][1]['text'], 'admin menu button');
    $customer = tgSay($app, $fake, 4242, '/start', 'customer');
    same('🆘 Support', $customer['reply_markup']['keyboard'][1][0]['text'], 'support button');
    same(1, count($customer['reply_markup']['keyboard'][2]), 'customers do not get the admin button');

    $panel = tgSay($app, $fake, 999, '🛠 Admin panel');
    check(strpos($panel['text'], 'Admin panel') !== false, 'panel opens');
    findButton($panel, 'Add credit');

    $reply = tgSay($app, $fake, 4242, '🛠 Admin panel', 'customer');
    check(strpos($reply['text'], 'Admin panel') === false, 'typing the label does nothing for customers');
    $reply = tgTap($app, $fake, 4242, 'adm:add');
    check(strpos($reply['text'] ?? '', 'send the account') === false, 'forged admin button ignored');
});

test('admin panel: add credit with buttons only', function () {
    [$app, $fake] = makeApp();
    $panel = tgSay($app, $fake, 999, '/admin');
    $ask = tgTap($app, $fake, 999, findButton($panel, 'Add credit'));
    check(strpos($ask['text'], 'send the account <b>username</b>') !== false, 'asks for username');
    $amounts = tgSay($app, $fake, 999, 'ghost');
    check(strpos($amounts['text'], 'No account found') !== false, 'unknown user, asks again');
    $amounts = tgSay($app, $fake, 999, 'alice');
    check(strpos($amounts['text'], 'balance 1.50') !== false, 'shows balance');
    $confirm = tgTap($app, $fake, 999, findButton($amounts, '+25'));
    check(strpos($confirm['text'], 'Add <b>25.00</b> credit to') !== false, 'confirm step');
    $done = tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    check(strpos($done['text'], 'New balance: <b>26.50</b>') !== false, 'credited');
});

test('admin panel: remove credit with a typed amount and note', function () {
    [$app, $fake] = makeApp();
    tgTap($app, $fake, 999, 'adm:remove');
    tgSay($app, $fake, 999, 'alice');
    $confirm = tgSay($app, $fake, 999, '1.25 refund for test call');
    check(strpos($confirm['text'], 'Remove <b>1.25</b> credit from') !== false && strpos($confirm['text'], 'refund for test call') !== false, 'confirm with note');
    tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    same(0.25, $fake->users[7]['credit']);
    check((bool) preg_match('/^Telegram admin @boss: refund for test call #adm-[a-f0-9]{8}, Old credit 1\.5$/', $fake->refills[0]['description']), 'description with note and reference');
});

test('admin panel: account card -> change caller ID with buttons', function () {
    [$app, $fake] = makeApp();
    $card = tgTap($app, $fake, 999, 'adm:account:100234');
    check(strpos($card['text'], 'Balance: <b>0.00</b>') !== false && strpos($card['text'], 'caller ID') !== false, 'account card');
    $ask = tgTap($app, $fake, 999, findButton($card, 'Caller ID of 100234'));
    check(strpos($ask['text'], 'new caller ID') !== false, 'asks for number');
    $confirm = tgSay($app, $fake, 999, '+44 20 7946 0000');
    $done = tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    check(strpos($done['text'], 'Caller ID updated') !== false, 'updated');
    same('+442079460000', $fake->sips[23]['callerid']);

    // Via the panel's "Change caller ID" when the user has several SIP accounts
    $fake->sips[21]['name'] = 'alice-desk';
    tgTap($app, $fake, 999, 'adm:cid');
    $list = tgSay($app, $fake, 999, 'alice');
    $ask = tgTap($app, $fake, 999, findButton($list, 'alice2'));
    check(strpos($ask['text'], 'SIP <code>alice2</code>') !== false, 'picked from list');
});

test('admin panel: mark paid from the unpaid list, and alert buttons', function () {
    [$app, $fake] = makeApp();
    $order = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'web');
    $list = tgTap($app, $fake, 999, 'adm:markpaid');
    $confirm = tgTap($app, $fake, 999, findButton($list, 'alice · $10.00'));
    check(strpos($confirm['text'], 'Mark this order as paid') !== false, 'confirm');
    tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    same('credited', $app->payments()->getOrder($order['id'])['status']);

    // A failed credit alert carries Re-check / Mark paid buttons.
    $other = $app->payments()->createOrder(['username' => 'alice', 'amount' => '20'], 'web');
    $fake->oxapayStatus($other['track_id'], 'Paid');
    $fake->magnusDown = true;
    [$body, $hmac] = $fake->webhook($other['track_id'], 'Paid');
    $app->payments()->handleWebhook($body, $hmac);
    $alerts = messagesTo($fake, '999');
    $alert = end($alerts);
    check(strpos($alert['text'], 'credit failed') !== false, 'alert');
    same('adm:retry:' . $other['id'], findButton($alert, 'Re-check'));
    $fake->magnusDown = false;
    $after = tgTap($app, $fake, 999, 'adm:retry:' . $other['id']);
    check(strpos($after['text'], 'Paid, credit added') !== false, 'Re-check button credits it');
});

test('settings: admin changes the minimum top-up with buttons', function () {
    [$app, $fake] = makeApp();
    $panel = tgSay($app, $fake, 999, '/admin');
    $settings = tgTap($app, $fake, 999, findButton($panel, 'Settings'));
    check(strpos($settings['text'], 'Minimum top-up: <b>$5.00</b>') !== false, 'shows current minimum');
    $ask = tgTap($app, $fake, 999, findButton($settings, 'Minimum'));
    $confirm = tgTap($app, $fake, 999, findButton($ask, '$2'));
    check(strpos($confirm['text'], 'from <b>$5.00</b> to <b>$2.00</b>') !== false, 'confirm text');
    same(5.0, (float) $app->config['payments']['min_amount'], 'unchanged before confirming');
    tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    same(2.0, (float) $app->config['payments']['min_amount']);
    same('2.00', $app->payments()->parseAmount('2'), 'customers can now pay 2');
    same(2.0, $app->publicConfig()['payments']['min_amount'], 'website config updated');

    $reply = tgSay($app, $fake, 4242, '/topup alice', 'customer');
    check(strpos($reply['text'], 'between $2.00 and') !== false, 'bot uses new minimum');
});

test('settings: stored in the database, so every request and restart sees them', function () {
    $file = sys_get_temp_dir() . '/gw-settings-' . bin2hex(random_bytes(4)) . '.sqlite';
    try {
        [$first] = makeApp(['database' => ['dsn' => 'sqlite:' . $file]]);
        $first->db();
        $first->settings()->set('currency', 'eur', 'test');
        $first->settings()->set('min_amount', '3', 'test');
        [$second] = makeApp(['database' => ['dsn' => 'sqlite:' . $file]]);
        $second->db();
        same('EUR', $second->config['payments']['currency']);
        same('€', $second->config['payments']['currency_symbol']);
        same(3.0, (float) $second->config['payments']['min_amount']);
        same(5, $second->baseSetting('min_amount'), 'config.php value kept underneath');
    } finally {
        foreach (glob($file . '*') ?: [] as $leftover) {
            @unlink($leftover);
        }
    }
});

test('settings: typed values are validated and customers cannot change them', function () {
    [$app, $fake] = makeApp();
    tgTap($app, $fake, 999, 'adm:set:min');
    $reply = tgSay($app, $fake, 999, 'abc');
    check(strpos($reply['text'], 'greater than 0') !== false, 'bad number');
    $reply = tgSay($app, $fake, 999, '5000');
    check(strpos($reply['text'], 'lower than the maximum') !== false, 'min must be below max');
    $confirm = tgSay($app, $fake, 999, '€1,50');
    check(strpos($confirm['text'], 'to <b>$1.50</b>') !== false, 'accepts symbol and comma');

    tgTap($app, $fake, 4242, 'adm:set:min');
    $reply = tgSay($app, $fake, 4242, '1', 'customer');
    tgTap($app, $fake, 4242, confirmButton($confirm));
    same(5.0, (float) $app->config['payments']['min_amount'], 'customer cannot change settings');
});

test('settings: switch billing to euros; old orders keep dollars; reset', function () {
    [$app, $fake] = makeApp();
    $usd = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'web');
    $fake->oxapayStatus($usd['track_id'], 'Paid');
    [$body, $hmac] = $fake->webhook($usd['track_id'], 'Paid');
    $app->payments()->handleWebhook($body, $hmac);

    $choose = tgTap($app, $fake, 999, 'adm:cur');
    $confirm = tgTap($app, $fake, 999, findButton($choose, 'EUR'));
    check(strpos($confirm['text'], 'from <b>USD</b> to <b>EUR</b>') !== false, 'confirm currency');
    $saved = tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    check(strpos($saved['text'], 'Currency: <b>EUR</b> (€)') !== false, 'settings show EUR');

    same('€5.00', $app->payments()->money(5));
    $eur = $app->payments()->createOrder(['username' => 'alice', 'amount' => '20'], 'web');
    same('EUR', $eur['currency']);
    same('EUR', $fake->invoices[$eur['track_id']]['currency'], 'OxaPay invoice in EUR');
    same('€20.00', $app->payments()->publicView($eur)['amount_display']);
    same('$10.00', $app->payments()->publicView($usd)['amount_display'], 'old order keeps $');

    $recent = tgSay($app, $fake, 999, '/recent');
    check(strpos($recent['text'], '€20.00') !== false && strpos($recent['text'], '$10.00') !== false, 'recent shows both currencies');
    same(0, $app->payments()->totalsSince(0)['count'], 'stats count only EUR (none credited yet)');

    $reply = tgTap($app, $fake, 999, 'adm:reset');
    tgTap($app, $fake, 999, findButton($reply, 'Confirm'));
    same('USD', $app->config['payments']['currency'], 'reset to config.php');
    same(1, $app->payments()->totalsSince(0)['count']);
});

test('admin: slow MagnusBilling reply (email step) is confirmed, not reported as an error', function () {
    [$app, $fake] = makeApp();
    $fake->users[8]['credit'] = 117.32;
    $fake->loseNextRefillReply = true;
    $reply = tgSay($app, $fake, 999, '/removecredit 100234 10');
    $done = tgTap($app, $fake, 999, confirmButton($reply));
    check(strpos($done['text'], 'New balance: <b>107.32</b>') !== false, 'reports the saved change');
    check(strpos($done['text'], 'Settings → SMTP') !== false, 'explains the slow reply');
    same(1, count($fake->refills), 'applied once');
    $progress = messagesTo($fake, '999');
    check(strpos($progress[count($progress) - 2]['text'], 'Saving in MagnusBilling') !== false, 'progress message first');

    $fake->loseNextSipReply = true;
    $reply = tgSay($app, $fake, 999, '/callerid 100234 15550009');
    $done = tgTap($app, $fake, 999, confirmButton($reply));
    check(strpos($done['text'], 'Caller ID updated') !== false, 'caller ID confirmed after lost reply');
});

test('admin: an unconfirmed change is reported as such, and nothing is applied', function () {
    [$app, $fake] = makeApp();
    $reply = tgSay($app, $fake, 999, '/addcredit alice 5');
    $fake->timeoutBeforeRefill = true;
    $done = tgTap($app, $fake, 999, confirmButton($reply));
    check(strpos($done['text'], 'did not confirm the change') !== false, 'clear message');
    check(strpos($done['text'], 'before trying again') !== false, 'warns against repeating');
    same(0, count($fake->refills));
    same(1.5, $fake->users[7]['credit']);

    // MagnusBilling completely unreachable: stops at the account lookup, nothing attempted.
    $reply = tgSay($app, $fake, 999, '/addcredit alice 5');
    $fake->magnusDown = true;
    $done = tgTap($app, $fake, 999, confirmButton($reply));
    $fake->magnusDown = false;
    check(strpos($done['text'], 'unavailable') !== false, 'lookup failure message');
    same(0, count($fake->refills));
});

function inviteToken(array $reply): string
{
    if (!preg_match('/start=l_([a-f0-9]{16})/', $reply['text'], $m)) {
        throw new RuntimeException('No invite link in: ' . $reply['text']);
    }

    return $m[1];
}

test('customers: create a customer step by step, then the customer links Telegram', function () {
    [$app, $fake] = makeApp();
    $menu = tgTap($app, $fake, 999, 'adm:cust');
    $step = tgTap($app, $fake, 999, findButton($menu, 'New customer'));
    check(strpos($step['text'], '(1/4)') !== false, 'asks username');
    $step = tgSay($app, $fake, 999, 'alice');
    check(strpos($step['text'], 'already exists') !== false, 'existing username refused');
    $step = tgSay($app, $fake, 999, 'x y');
    check(strpos($step['text'], 'Use 4 to 20') !== false, 'invalid username refused');
    $step = tgSay($app, $fake, 999, 'newcust1');
    check(strpos($step['text'], '(2/4)') !== false, 'asks password');
    $step = tgSay($app, $fake, 999, 'Secret99');
    check(strpos($step['text'], '(3/4)') !== false, 'asks email');
    $step = tgSay($app, $fake, 999, 'new@customer.test');
    check(strpos($step['text'], '(4/4)') !== false, 'asks plan');
    $confirm = tgTap($app, $fake, 999, findButton($step, 'Premium'));
    check(strpos($confirm['text'], 'Plan: Premium') !== false && strpos($confirm['text'], 'newcust1') !== false, 'summary');
    $done = tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    check(strpos($done['text'], 'Customer created') !== false && strpos($done['text'], 'Secret99') !== false, 'credentials shown');
    check(strpos($done['reply_markup']['inline_keyboard'][0][0]['url'], 'https://t.me/share/url?url=') === 0, 'share button');
    $new = end($fake->users);
    same('newcust1', $new['username']);
    same(2, $new['id_plan']);
    same('new@customer.test', $new['email']);
    $sip = end($fake->sips);
    same('newcust1', $sip['name'], 'SIP account created');

    // The customer opens the invite link.
    $token = inviteToken($done);
    tgSay($app, $fake, 777, '/start l_' . $token, 'newcustomer');
    $messages = messagesTo($fake, '777');
    check(strpos($messages[0]['text'], 'linked to account <code>newcust1</code>') !== false, 'linked');
    same('👤 My account', $messages[1]['reply_markup']['keyboard'][1][0]['text'], 'My account button');
    $account = tgSay($app, $fake, 777, '👤 My account', 'newcustomer');
    check(strpos($account['text'], 'Balance: <b>0.00</b>') !== false && strpos($account['text'], 'SIP <code>newcust1</code>') !== false, 'account card');
    same('usr:newcust1', $account['reply_markup']['inline_keyboard'][0][0]['callback_data'], 'top up own account');

    $reply = tgSay($app, $fake, 778, '/start l_' . $token, 'someoneelse');
    check(strpos($reply['text'], 'not valid any more') !== false, 'invite works once');
});

test('customers: automatic username, generated password, and the email rule', function () {
    [$app, $fake] = makeApp();
    tgTap($app, $fake, 999, 'adm:new');
    tgTap($app, $fake, 999, 'adm:newauto');
    tgTap($app, $fake, 999, 'adm:newgen');
    $plans = tgTap($app, $fake, 999, 'adm:newskip');
    $confirm = tgTap($app, $fake, 999, findButton($plans, 'Default plan'));
    check(strpos($confirm['text'], '<i>automatic</i>') !== false && strpos($confirm['text'], '<i>generated</i>') !== false, 'summary');
    $done = tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    check(strpos($done['text'], 'API allow multiple user/email') !== false, 'explains the unique email rule');
    same(2, count($fake->users), 'nothing created');

    $fake->apiAllowSameEmail = true;
    tgTap($app, $fake, 999, 'adm:new');
    tgTap($app, $fake, 999, 'adm:newauto');
    tgTap($app, $fake, 999, 'adm:newgen');
    $plans = tgTap($app, $fake, 999, 'adm:newskip');
    $confirm = tgTap($app, $fake, 999, findButton($plans, 'Default plan'));
    $done = tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    check(strpos($done['text'], 'Customer created') !== false, 'created');
    $new = end($fake->users);
    check(strpos($done['text'], '<code>' . $new['password'] . '</code>') !== false, 'generated password shown');
});

test('customers: invite for an existing account; website payments reach the linked chat', function () {
    [$app, $fake] = makeApp();
    $card = tgTap($app, $fake, 999, 'adm:account:alice');
    check(strpos($card['text'], 'Telegram: not linked') !== false, 'not linked yet');
    $invite = tgTap($app, $fake, 999, findButton($card, 'Telegram invite'));
    tgSay($app, $fake, 555, '/start l_' . inviteToken($invite), 'alice_tg');

    $order = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'web');
    $fake->oxapayStatus($order['track_id'], 'Paid');
    [$body, $hmac] = $fake->webhook($order['track_id'], 'Paid');
    $app->payments()->handleWebhook($body, $hmac);
    $last = messagesTo($fake, '555');
    check(strpos(end($last)['text'], 'Payment confirmed') !== false, 'linked chat notified of a website payment');

    $card = tgTap($app, $fake, 999, 'adm:account:alice');
    check(strpos($card['text'], 'Telegram: linked (1 chat)') !== false, 'card shows link');

    $unlinked = tgTap($app, $fake, 555, 'unlink');
    check(strpos($unlinked['text'], 'no longer linked') !== false, 'unlink');
    same(null, $app->customers()->linkedUsername('555'));
});

test('notifications: message one customer, and broadcast to everyone', function () {
    [$app, $fake] = makeApp();
    $reply = tgTap($app, $fake, 999, 'adm:msgu:alice');
    check(strpos($reply['text'], 'not linked to Telegram') !== false, 'needs a link first');

    $invite = tgTap($app, $fake, 999, 'adm:inv:alice');
    tgSay($app, $fake, 555, '/start l_' . inviteToken($invite), 'alice_tg');
    tgTap($app, $fake, 999, 'adm:msgu:alice');
    $confirm = tgSay($app, $fake, 999, "Maintenance tonight 02:00-03:00 <b>UTC</b>");
    check(strpos($confirm['text'], 'Send this to 1 chat?') !== false, 'preview');
    tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    $got = messagesTo($fake, '555');
    same("📣 <b>Test Carrier</b>\n\nMaintenance tonight 02:00-03:00 &lt;b&gt;UTC&lt;/b&gt;", end($got)['text'], 'delivered, escaped');
    $admin = messagesTo($fake, '999');
    check(strpos(end($admin)['text'], 'Sent to 1 chat') !== false, 'report');

    // Broadcast: three more people used the bot, one of them blocked it.
    foreach ([601, 602, 603] as $chat) {
        tgSay($app, $fake, $chat, '/start', 'user' . $chat);
    }
    $fake->blockedChats = ['602'];
    $menu = tgTap($app, $fake, 999, 'adm:notify');
    $button = findButton($menu, 'Everyone who used the bot');
    same('adm:bc:all', $button);
    check(strpos(json_encode($menu['reply_markup'], JSON_UNESCAPED_UNICODE), 'Everyone who used the bot (5)') !== false, 'counts admin + 4 customers');
    tgTap($app, $fake, 999, $button);
    $confirm = tgSay($app, $fake, 999, 'New low rates to Europe!');
    tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    $admin = messagesTo($fake, '999');
    check(strpos(end($admin)['text'], 'Sent to 4 chats · 1 failed') !== false, 'blocked chat counted as failed: ' . end($admin)['text']);
    $got603 = messagesTo($fake, '603');
    check(strpos(end($got603)['text'], 'New low rates to Europe!') !== false, 'customer received broadcast');
    same(4, $app->customers()->counts()['users'], 'blocked chat skipped next time');

    $reply = tgTap($app, $fake, 601, 'adm:bc:all');
    check(empty($reply) || strpos($reply['text'] ?? '', 'Type the message') === false, 'customers cannot broadcast');
});

function linkChat(\Gateway\App $app, FakeServices $fake, $chat, string $username): void
{
    $invite = tgTap($app, $fake, 999, 'adm:inv:' . $username);
    tgSay($app, $fake, $chat, '/start l_' . inviteToken($invite), 'cust' . $chat);
}

function copiesTo(FakeServices $fake, string $chatId): array
{
    return array_values(array_filter($fake->telegram, function ($call) use ($chatId) {
        return $call['method'] === 'copyMessage' && (string) $call['params']['chat_id'] === $chatId;
    }));
}

test('cron: low-balance alert once per drop, again after recovery', function () {
    [$app, $fake] = makeApp();
    linkChat($app, $fake, 555, 'alice');
    $app->cron()->lowBalance();
    $alert = messagesTo($fake, '555');
    $alert = end($alert);
    check(strpos($alert['text'], 'Low balance') !== false && strpos($alert['text'], '1.50') !== false, 'alert sent');
    $keys = $alert['reply_markup']['inline_keyboard'];
    same(['qt:10:alice', 'qt:25:alice', 'qt:50:alice'], array_column($keys[0], 'callback_data'), 'one-tap amounts');
    same('usr:alice', end($keys)[0]['callback_data'], 'other amount');
    $before = count(messagesTo($fake, '555'));
    $app->cron()->lowBalance();
    same($before, count(messagesTo($fake, '555')), 'not repeated');
    $fake->users[7]['credit'] = 50;
    $app->cron()->lowBalance();
    $fake->users[7]['credit'] = 0.5;
    $app->cron()->lowBalance();
    same($before + 1, count(messagesTo($fake, '555')), 'alerts again after recovery');

    tgTap($app, $fake, 999, 'adm:setlow');
    $confirm = tgSay($app, $fake, 999, '0');
    tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    same('off', $app->cron()->lowBalance(), 'can be turned off');
});

test('cron: daily report, health alerts and missed-webhook orders', function () {
    [$app, $fake] = makeApp(['telegram' => ['report_hour' => 0]]);
    same('sent', $app->cron()->dailyReport());
    $report = messagesTo($fake, '999');
    check(strpos(end($report)['text'], 'Daily report') !== false, 'report sent');
    same('not due', $app->cron()->dailyReport(), 'once a day');

    $fake->magnusDown = true;
    $app->cron()->health();
    $count = count(messagesTo($fake, '999'));
    $app->cron()->health();
    $alerts = messagesTo($fake, '999');
    same($count + 1, count($alerts), 'alert after the second failure');
    check(strpos(end($alerts)['text'], 'MagnusBilling is not answering') !== false, 'down alert');
    $app->cron()->health();
    same($count + 1, count(messagesTo($fake, '999')), 'no repeat while down');
    $fake->magnusDown = false;
    $app->cron()->health();
    $alerts = messagesTo($fake, '999');
    check(strpos(end($alerts)['text'], 'MagnusBilling is answering again') !== false, 'recovery alert');

    $order = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10'], 'web');
    $app->db()->run('UPDATE oxg_orders SET created_at = ? WHERE id = ?', [time() - 600, $order['id']]);
    $fake->oxapayStatus($order['track_id'], 'Paid');
    $app->cron()->run();
    same('credited', $app->payments()->getOrder($order['id'])['status'], 'credited without a webhook');
});

test('support: customer writes, admin replies', function () {
    [$app, $fake] = makeApp();
    $prompt = tgSay($app, $fake, 4242, '🆘 Support', 'mike');
    check(strpos($prompt['text'], 'Write your message') !== false, 'asks');
    $done = tgSay($app, $fake, 4242, 'My calls drop after 1 minute', 'mike');
    check(strpos($done['text'], 'Sent to our team') !== false, 'confirmed');
    $admin = messagesTo($fake, '999');
    $msg = end($admin);
    check(strpos($msg['text'], 'My calls drop after 1 minute') !== false && strpos($msg['text'], '@mike') !== false, 'forwarded');
    $ask = tgTap($app, $fake, 999, findButton($msg, 'Reply'));
    tgSay($app, $fake, 999, 'Please update your app, we fixed it.');
    $got = messagesTo($fake, '4242');
    check(strpos(end($got)['text'], 'Please update your app') !== false, 'customer got the reply');

    // A photo is copied to the admins.
    tgTap($app, $fake, 4242, 'sup');
    $app->bot()->handleUpdate(['message' => ['message_id' => 77, 'chat' => ['id' => 4242, 'type' => 'private'], 'from' => ['id' => 4242, 'username' => 'mike'], 'photo' => [['file_id' => 'abc']]]]);
    same(1, count(copiesTo($fake, '999')), 'photo copied');
});

test('bank transfer: receipt, admin approval credits the account', function () {
    [$app, $fake] = makeApp();
    tgTap($app, $fake, 999, 'adm:setbank');
    $confirm = tgSay($app, $fake, 999, "Bank: Example Bank\nIBAN: DE00 1234");
    tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));

    $amounts = tgSay($app, $fake, 4242, '/topup alice', 'mike');
    $ask = tgTap($app, $fake, 4242, findButton($amounts, 'Bank transfer'));
    check(strpos($ask['text'], 'How much') !== false, 'asks amount');
    $info = tgSay($app, $fake, 4242, '20', 'mike');
    check(strpos($info['text'], 'IBAN: DE00 1234') !== false && preg_match('/UC-[A-F0-9]{6}/', $info['text']), 'instructions and reference');
    $nudge = tgSay($app, $fake, 4242, 'I paid', 'mike');
    check(strpos($nudge['text'], 'photo or PDF') !== false, 'asks for the receipt');
    $app->bot()->handleUpdate(['message' => ['message_id' => 90, 'chat' => ['id' => 4242, 'type' => 'private'], 'from' => ['id' => 4242, 'username' => 'mike'], 'document' => ['file_id' => 'pdf1', 'mime_type' => 'application/pdf']]]);
    $copy = copiesTo($fake, '999');
    same(1, count($copy), 'receipt copied to admin');
    $approve = $copy[0]['params']['reply_markup']['inline_keyboard'][0][0]['callback_data'];
    check(strpos($approve, 'adm:bankok:') === 0, 'approve button');

    $confirm = tgTap($app, $fake, 999, $approve);
    tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    same(21.5, $fake->users[7]['credit'], 'credited');
    check((bool) preg_match('/^Bank transfer #[a-f0-9]{24} ref UC-[A-F0-9]{6}/', $fake->refills[0]['description']), 'refill note');
    $got = messagesTo($fake, '4242');
    check(strpos(end($got)['text'], 'Payment confirmed') !== false, 'customer told');
    $again = tgTap($app, $fake, 999, $approve);
    check(strpos($again['text'], 'already handled') !== false, 'only once');
});

test('promo codes: created in the bot, used on the website and in the bot', function () {
    [$app, $fake] = makeApp();
    tgTap($app, $fake, 999, 'adm:promonew');
    tgSay($app, $fake, 999, 'welcome10');
    $uses = tgSay($app, $fake, 999, '10');
    $days = tgTap($app, $fake, 999, findButton($uses, '50'));
    $confirm = tgTap($app, $fake, 999, findButton($days, '30 days'));
    check(strpos($confirm['text'], 'WELCOME10') !== false && strpos($confirm['text'], '+10%') !== false, 'summary');
    tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));

    $order = $app->payments()->createOrder(['username' => 'alice', 'amount' => '10', 'promo' => 'welcome10'], 'web');
    same('WELCOME10', $order['promo_code']);
    same('11.0000', number_format((float) $order['credit'], 4, '.', ''), '10% extra credit');
    $fake->oxapayStatus($order['track_id'], 'Paid');
    [$body, $hmac] = $fake->webhook($order['track_id'], 'Paid');
    $app->payments()->handleWebhook($body, $hmac);
    same(1, (int) $app->db()->one('SELECT uses FROM oxg_promos WHERE code = ?', ['WELCOME10'])['uses'], 'use counted');

    throwsUserError(function () use ($app) {
        $app->payments()->createOrder(['username' => 'alice', 'amount' => '10', 'promo' => 'NOPE1'], 'web');
    }, 'invalid_promo');

    $amounts = tgSay($app, $fake, 4242, '/topup alice', 'mike');
    tgTap($app, $fake, 4242, findButton($amounts, 'Promo code'));
    $withPromo = tgSay($app, $fake, 4242, 'WELCOME10', 'mike');
    check(strpos($withPromo['text'], 'Promo <code>WELCOME10</code>: +10% extra credit') !== false, 'promo shown');
    $created = tgTap($app, $fake, 4242, 'amt:25');
    check(strpos($created['text'], 'Credit: <b>27.50</b>') !== false, 'bot order has the bonus: ' . $created['text']);

    $app->promos()->disable('WELCOME10', 'test');
    throwsUserError(function () use ($app) { $app->promos()->validate('WELCOME10'); }, 'invalid_promo');
});

test('account actions: block, new SIP password, plan, calls, live calls', function () {
    [$app, $fake] = makeApp();
    $confirm = tgTap($app, $fake, 999, 'adm:block:alice');
    tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    same(0, $fake->users[7]['active']);
    $card = tgTap($app, $fake, 999, 'adm:account:alice');
    check(strpos($card['text'], 'blocked') !== false, 'card shows blocked');
    findButton($card, 'Unblock');

    $ask = tgTap($app, $fake, 999, 'adm:sippw:100234');
    $confirm = tgTap($app, $fake, 999, findButton($ask, 'Generate'));
    preg_match('/to <code>([^<]+)<\/code>/', $confirm['text'], $m);
    tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    same($m[1], $fake->sips[23]['secret'], 'new SIP password saved');

    $plans = tgTap($app, $fake, 999, 'adm:plan:alice');
    $confirm = tgTap($app, $fake, 999, findButton($plans, 'Premium'));
    tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    same(2, $fake->users[7]['id_plan']);

    $fake->calls = [
        ['id_user' => 7, 'starttime' => '2026-11-05 10:00:00', 'calledstation' => '447911123456', 'sessiontime' => 125, 'sessionbill' => 0.25],
        ['id_user' => 8, 'starttime' => '2026-11-05 10:05:00', 'calledstation' => '15550001', 'sessiontime' => 10, 'sessionbill' => 0.01],
    ];
    $calls = tgTap($app, $fake, 999, 'adm:calls:alice');
    check(strpos($calls['text'], '447911123456') !== false && strpos($calls['text'], '2:05') !== false && strpos($calls['text'], '15550001') === false, 'calls of that account only');
    linkChat($app, $fake, 555, 'alice');
    $mine = tgTap($app, $fake, 555, 'calls');
    check(strpos($mine['text'], '447911123456') !== false, 'customer sees own calls');

    $fake->liveCalls = [['sip_account' => '100234', 'ndiscado' => '4420711', 'duration' => 61, 'status' => 'Up']];
    $live = tgTap($app, $fake, 999, 'adm:live');
    check(strpos($live['text'], 'Live calls</b> (1)') !== false && strpos($live['text'], '1:01') !== false, 'live calls');
});

test('view-only admins can look but not change', function () {
    [$app, $fake] = makeApp(['telegram' => ['viewer_chat_ids' => [888]]]);
    $welcome = tgSay($app, $fake, 888, '/start', 'viewer');
    same('🛠 Admin panel', $welcome['reply_markup']['keyboard'][2][1]['text'], 'viewer gets the panel button');
    $panel = tgSay($app, $fake, 888, '🛠 Admin panel', 'viewer');
    check(strpos($panel['text'], 'View-only') !== false, 'view-only panel');
    $recent = tgTap($app, $fake, 888, 'adm:recent');
    check(strpos($recent['text'], 'No orders yet') !== false || strpos($recent['text'], 'Latest orders') !== false, 'can view');
    $denied = tgTap($app, $fake, 888, 'adm:add:alice');
    check(strpos($denied['text'], 'view-only access') !== false, 'cannot change');
    tgSay($app, $fake, 888, '/addcredit alice 5', 'viewer');
    same(1.5, $fake->users[7]['credit']);
});

test('themes: five themes, switched from the bot with preview links', function () {
    [$app, $fake] = makeApp();
    $menu = tgTap($app, $fake, 999, 'adm:theme');
    $rows = $menu['reply_markup']['inline_keyboard'];
    same(6, count($rows), 'five themes and a back button');
    same('https://pay.example.test/?preview=emerald', $rows[1][1]['url'], 'preview link');
    check(strpos($rows[0][0]['text'], '✓') !== false, 'current theme marked');
    $confirm = tgTap($app, $fake, 999, findButton($menu, 'Emerald Signal'));
    tgTap($app, $fake, 999, findButton($confirm, 'Confirm'));
    same('emerald', $app->config['site']['theme']);
    same('light', \Gateway\Settings::normalizeTheme('classic'), 'old classic theme maps to light');
    same('luxury', \Gateway\Settings::normalizeTheme('LUXURY'));
    same('voip', \Gateway\Settings::normalizeTheme('unknown'));
    $denied = tgTap($app, $fake, 4242, 'adm:settheme:violet');
    same('emerald', $app->config['site']['theme'], 'customers cannot switch');
});

function telegramCalls(FakeServices $fake, string $method): array
{
    return array_values(array_map(static function (array $call): array {
        return $call['params'];
    }, array_filter($fake->telegram, static function (array $call) use ($method): bool {
        return $call['method'] === $method;
    })));
}

function lastCall(FakeServices $fake, string $method): array
{
    $calls = telegramCalls($fake, $method);

    return end($calls) ?: [];
}

function commandNames(array $params): array
{
    return array_column($params['commands'], 'command');
}

test('bot profile: standard description, About text and command menus', function () {
    [$app, $fake] = makeApp(['site' => ['name' => 'Test Carrier LLC'], 'telegram' => ['viewer_chat_ids' => [777]]]);
    $result = (new \Gateway\BotProfile($app))->apply();
    same([], $result['warnings'], 'no warnings');
    $description = telegramCalls($fake, 'setMyDescription')[0]['description'];
    check(strpos($description, 'Test Carrier VoIP account') !== false, 'company name without LLC');
    check(strpos($description, 'LLC') === false, 'no legal suffix');
    check(strpos($description, 'pay.example.test') !== false, 'website address');
    check(\Gateway\BotProfile::length($description) <= 512, 'description fits');
    $about = telegramCalls($fake, 'setMyShortDescription')[0]['short_description'];
    check(\Gateway\BotProfile::length($about) <= 120 && strpos($about, 'Test Carrier') !== false, 'about fits and names the company');
    $menus = telegramCalls($fake, 'setMyCommands');
    same(['topup', 'myorders', 'myaccount', 'status', 'support', 'help', 'cancel'], commandNames($menus[0]), 'customer menu');
    check(!isset($menus[0]['scope']), 'customer menu is the default');
    same(['type' => 'chat', 'chat_id' => 999], $menus[1]['scope'], 'admin menu in the admin chat');
    check(in_array('addcredit', commandNames($menus[1]), true) && in_array('topup', commandNames($menus[1]), true), 'admins get both menus');
    same(777, $menus[2]['scope']['chat_id'], 'viewer menu');
    check(in_array('recent', commandNames($menus[2]), true) && !in_array('addcredit', commandNames($menus[2]), true), 'viewers get view commands only');
    same([], telegramCalls($fake, 'setMyName'), 'name untouched unless configured');

    // A chat removed from the admin lists goes back to the customer menu; unknown chats are reported, not fatal.
    $app->config['telegram']['admin_chat_ids'] = [555];
    $app->config['telegram']['viewer_chat_ids'] = [];
    $fake->unknownChats = ['555'];
    $result = (new \Gateway\BotProfile($app))->apply();
    same([999, 777], array_column(array_column(telegramCalls($fake, 'deleteMyCommands'), 'scope'), 'chat_id'), 'old admin menus removed');
    check(count($result['warnings']) === 1 && strpos($result['warnings'][0], 'press Start') !== false, 'unknown chat explained');

    // Very long company names are left out rather than breaking the limits.
    [$app] = makeApp(['site' => ['name' => str_repeat('Extremely Long Telecom Name ', 6)]]);
    $profile = new \Gateway\BotProfile($app);
    check(\Gateway\BotProfile::length($profile->shortDescription()) <= 120, 'long name: about fits');
    check(\Gateway\BotProfile::length($profile->description()) <= 512, 'long name: description fits');
});

test('bot profile: texts from config.php and changed by admins in the bot', function () {
    [$app, $fake] = makeApp(['telegram' => ['name' => 'TEST PAY', 'short_description' => 'Pay with crypto.']]);
    (new \Gateway\BotProfile($app))->apply();
    same('TEST PAY', telegramCalls($fake, 'setMyName')[0]['name'], 'name from config');
    same('Pay with crypto.', telegramCalls($fake, 'setMyShortDescription')[0]['short_description'], 'about from config');

    $screen = tgTap($app, $fake, 999, 'adm:botprofile');
    check(strpos($screen['text'], 'Pay with crypto.') !== false, 'profile screen shows the About text');
    tgTap($app, $fake, 999, 'adm:botdesc');
    $text = "⚡ UNITY PAY\nTop up in seconds.";
    $confirm = tgSay($app, $fake, 999, $text);
    tgTap($app, $fake, 999, confirmButton($confirm));
    same($text, $app->config['telegram']['description'], 'saved');
    same($text, lastCall($fake, 'setMyDescription')['description'], 'sent to Telegram right away');

    tgTap($app, $fake, 999, 'adm:botabout');
    $tooLong = tgSay($app, $fake, 999, str_repeat('a', 121));
    check(strpos($tooLong['text'], '120') !== false, 'about limit explained');

    $confirm = tgTap($app, $fake, 999, 'adm:botdefault');
    tgTap($app, $fake, 999, confirmButton($confirm));
    same('', $app->config['telegram']['description'], 'description back to standard');
    check(strpos(lastCall($fake, 'setMyDescription')['description'], 'Tap START') !== false, 'standard text sent');
    same('Pay with crypto.', $app->config['telegram']['short_description'], 'config.php text kept');

    $before = count(telegramCalls($fake, 'setMyDescription'));
    tgTap($app, $fake, 4242, 'adm:botdesc');
    tgTap($app, $fake, 4242, 'adm:botsync');
    same($before, count(telegramCalls($fake, 'setMyDescription')), 'customers cannot change the profile');
});

// ------------------------------------------------------------ panel add-on

/**
 * A MagnusBilling-like pkg_user table and a Panel for the logged-in customer $id.
 *
 * @return array{0:\Gateway\Panel, 1:\PDO}
 */
function makePanel(\Gateway\App $app, int $id = 7, string $username = 'alice', array $session = []): array
{
    $pdo = new \PDO('sqlite::memory:', null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION, \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC]);
    $pdo->exec("CREATE TABLE pkg_user (id INTEGER PRIMARY KEY, username TEXT, credit REAL, active INTEGER, firstname TEXT, lastname TEXT,
        email TEXT, googleAuthenticator_enable INTEGER DEFAULT 0, google_authenticator_key TEXT DEFAULT '')");
    $pdo->exec("INSERT INTO pkg_user VALUES (7, 'alice', 12.5, 1, 'Alice', 'Doe', 'a@example.test', 0, '')");
    $pdo->exec("INSERT INTO pkg_user VALUES (9, 'bob', 3, 0, 'Bob', '', '', 0, '')");
    $login = \Gateway\MagnusSession::fromArray($session + ['logged' => true, 'id_user' => $id, 'username' => $username, 'isClient' => true], 'sess-' . $id . '-abcdefghijklmnopqrstuvwxyz');

    return [new \Gateway\Panel($app, $login, new \Gateway\MagnusDb($app, $pdo)), $pdo];
}

test('panel add-on: two-step codes match RFC 6238 and MagnusBilling', function () {
    same('287082', \Gateway\Totp::code('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1), 'RFC 6238 vector');
    same('081804', \Gateway\Totp::code('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', intdiv(1111111109, 30)), 'RFC 6238 vector 2');
    $secret = \Gateway\Totp::secret();
    same(32, strlen($secret));
    check((bool) preg_match('/^[A-Z2-7]{32}$/', $secret), 'base32 secret');
    check(\Gateway\Totp::verify($secret, \Gateway\Totp::code($secret)), 'current code accepted');
    check(\Gateway\Totp::verify($secret, \Gateway\Totp::code($secret, intdiv(time(), 30) - 1)), '30 s old code accepted');
    check(!\Gateway\Totp::verify($secret, \Gateway\Totp::code($secret, intdiv(time(), 30) - 4)), '2 min old code refused');
    check(!\Gateway\Totp::verify($secret, 'abcdef') && !\Gateway\Totp::verify('', '123456'), 'junk refused');
    check(strpos(\Gateway\Totp::uri($secret, 'alice', 'Test Carrier'), 'otpauth://totp/Test%20Carrier:alice?secret=' . $secret) === 0, 'otpauth link');
});

test('panel add-on: only a fully logged-in MagnusBilling session counts', function () {
    check(\Gateway\MagnusSession::fromArray(['logged' => true, 'id_user' => 7, 'username' => 'alice', 'isClient' => true], 'x') !== null, 'logged in');
    same(null, \Gateway\MagnusSession::fromArray(['logged' => false, 'pending_2fa_user_id' => 7], 'x'), 'waiting for the two-step code');
    same(null, \Gateway\MagnusSession::fromArray(['logged' => '1', 'id_user' => 7, 'username' => 'alice'], 'x'), 'logged must be exactly true');
    same(null, \Gateway\MagnusSession::fromArray(['logged' => true, 'username' => 'alice'], 'x'), 'no user id');
    same(null, \Gateway\MagnusSession::fromArray([], 'x'), 'empty session');
});

test('panel add-on: account checks, overview and page token', function () {
    [$app] = makeApp();
    [$panel] = makePanel($app);
    $view = $panel->overview();
    same('alice', $view['username']);
    same('Alice Doe', $view['name']);
    same('12.50', $view['credit']);
    same(false, $view['two_step']);
    same(true, $view['telegram']['enabled']);
    same(0, $view['telegram']['linked']);

    $panel->checkCsrf($panel->csrfToken());
    throwsUserError(function () use ($panel) { $panel->checkCsrf('nope'); }, 'bad_request');
    [$other] = makePanel($app, 7, 'alice', []);
    check($other->csrfToken() === $panel->csrfToken(), 'same login, same token');
    [$mismatch] = makePanel($app, 7, 'mallory');
    throwsUserError(function () use ($mismatch) { $mismatch->overview(); }, 'not_logged_in');
    [$disabled] = makePanel($app, 9, 'bob');
    throwsUserError(function () use ($disabled) { $disabled->overview(); }, 'account_disabled');
    [$gone] = makePanel($app, 404, 'ghost');
    throwsUserError(function () use ($gone) { $gone->overview(); }, 'not_logged_in');
});

test('panel add-on: top-up for the logged-in account only', function () {
    [$app, $fake] = makeApp();
    [$panel] = makePanel($app);
    $result = $panel->topup('25', '', '203.0.113.9');
    $order = $app->payments()->getOrder($result['order']);
    same('alice', $order['username']);
    same('panel', $order['source']);
    same('25.00', number_format((float) $order['amount'], 2, '.', ''));
    check(strpos($result['payment_url'], 'http') === 0, 'payment link');
    check(strpos($result['status_url'], '/status.php?order=' . $result['order']) !== false, 'status link');
    throwsUserError(function () use ($panel) { $panel->topup('0.5', '', '1.1.1.1'); }, 'amount_too_low');
    same(1, count($panel->overview()['orders']), 'shown in recent top-ups');
});

test('panel add-on: Connect Telegram links the chat to the account', function () {
    [$app, $fake] = makeApp();
    [$panel] = makePanel($app);
    $link = $panel->telegramLink()['link'];
    check((bool) preg_match('#^https://t\.me/testpay_bot\?start=l_([a-f0-9]{16})$#', $link, $m), 'invite link');
    tgSay($app, $fake, 5151, '/start l_' . $m[1]);
    same('alice', $app->customers()->linkedUsername('5151'));
    same(1, $panel->overview()['telegram']['linked']);

    [$noBot] = makePanel(makeApp(['telegram' => ['enabled' => false]])[0]);
    throwsUserError(function () use ($noBot) { $noBot->telegramLink(); }, 'telegram_off');
});

test('panel add-on: customers turn two-step login on and off themselves', function () {
    [$app] = makeApp();
    [$panel, $pdo] = makePanel($app);
    $setup = $panel->twoStepStart();
    check(strpos($setup['uri'], 'secret=' . $setup['secret']) !== false, 'QR link holds the key');
    same(0, (int) $pdo->query('SELECT googleAuthenticator_enable FROM pkg_user WHERE id = 7')->fetchColumn(), 'nothing saved before the first code');
    throwsUserError(function () use ($panel) { $panel->twoStepConfirm('000000'); }, 'invalid_code');
    $panel->twoStepConfirm(\Gateway\Totp::code($setup['secret']));
    $row = $pdo->query('SELECT googleAuthenticator_enable, google_authenticator_key FROM pkg_user WHERE id = 7')->fetch();
    same(1, (int) $row['googleAuthenticator_enable'], 'on in MagnusBilling');
    same($setup['secret'], $row['google_authenticator_key'], 'key saved');
    same(true, $panel->overview()['two_step']);
    same('', (string) $pdo->query("SELECT google_authenticator_key FROM pkg_user WHERE id = 9")->fetchColumn(), 'other accounts untouched');
    throwsUserError(function () use ($panel) { $panel->twoStepStart(); }, 'two_step_on');
    throwsUserError(function () use ($panel) { $panel->twoStepConfirm(\Gateway\Totp::code(\Gateway\Totp::secret())); }, 'setup_expired');

    throwsUserError(function () use ($panel) { $panel->twoStepDisable('123456'); }, 'invalid_code');
    $panel->twoStepDisable(\Gateway\Totp::code($setup['secret']));
    $row = $pdo->query('SELECT googleAuthenticator_enable, google_authenticator_key FROM pkg_user WHERE id = 7')->fetch();
    same(0, (int) $row['googleAuthenticator_enable'], 'off');
    same('', $row['google_authenticator_key'], 'key removed');

    // Guessing codes is limited.
    $panel->twoStepStart();
    for ($i = 0; $i < 7; $i++) {
        try { $panel->twoStepConfirm('000000'); } catch (\Gateway\UserError $e) { }
    }
    throwsUserError(function () use ($panel) { $panel->twoStepConfirm('000000'); }, 'rate_limited');
});

/**
 * Runs bin/panel-addon.php against a SQLite copy of MagnusBilling's menu tables.
 */
function addonCli(string $dbFile, string $args): array
{
    $cmd = 'UC_MAGNUS_DSN=' . escapeshellarg('sqlite:' . $dbFile) . ' ' . escapeshellarg(PHP_BINARY) . ' '
        . escapeshellarg(__DIR__ . '/../bin/panel-addon.php') . ' ' . $args . ' 2>&1';
    exec($cmd, $out, $code);

    return [$code, implode("\n", $out)];
}

function magnusMenuDb(): string
{
    $file = tempnam(sys_get_temp_dir(), 'mb');
    $pdo = new \PDO('sqlite:' . $file);
    $pdo->exec("CREATE TABLE pkg_module (id INTEGER PRIMARY KEY, text TEXT, module TEXT, icon_cls TEXT, id_module INTEGER, priority INTEGER)");
    $pdo->exec("CREATE TABLE pkg_configuration (id INTEGER PRIMARY KEY, config_key TEXT, config_value TEXT)");
    $pdo->exec("CREATE TABLE pkg_group_user (id INTEGER PRIMARY KEY, name TEXT, id_user_type INTEGER)");
    $pdo->exec("CREATE TABLE pkg_group_module (id_group INTEGER, id_module INTEGER, action TEXT, show_menu INTEGER DEFAULT 1,
        createShortCut INTEGER DEFAULT 0, createQuickStart INTEGER DEFAULT 0, PRIMARY KEY (id_group, id_module))");
    // Rows as in MagnusBilling 8's database.sql
    $pdo->exec("INSERT INTO pkg_module VALUES (1, 't(''Clients'')', NULL, 'x-fa fa-arrow-right', NULL, 1), (7, 't(''Billing'')', NULL, 'x-fa fa-arrow-right', NULL, 2),
        (12, 't(''Settings'')', NULL, 'x-fa fa-arrow-right', NULL, 7), (69, 't(''Extra'')', 'extra', 'x-fa fa-desktop', 12, 69),
        (100, 't(''Extra2'')', 'extra2', 'x-fa fa-desktop', 12, 10), (101, 't(''Extra3'')', 'extra3', 'x-fa fa-desktop', 12, 11)");
    $pdo->exec("INSERT INTO pkg_configuration VALUES (236, 'module_extra', 'index.php/extra/read'), (294, 'module_extra2', ''), (295, 'module_extra3', '')");
    $pdo->exec("INSERT INTO pkg_group_user VALUES (1, 'Administrator', 1), (2, 'Agent', 2), (3, 'Client', 3), (4, 'VIP clients', 3)");
    $pdo->exec("INSERT INTO pkg_group_module VALUES (3, 1, 'ru', 1, 0, 0), (3, 7, 'r', 1, 0, 0), (1, 100, 'crud', 0, 0, 0)");

    return $file;
}

function menuState(string $file): string
{
    $pdo = new \PDO('sqlite:' . $file);
    $out = [];
    foreach (['pkg_module ORDER BY id', 'pkg_configuration ORDER BY id', 'pkg_group_module ORDER BY id_group, id_module'] as $table) {
        $out[] = json_encode($pdo->query('SELECT * FROM ' . $table)->fetchAll(\PDO::FETCH_ASSOC));
    }

    return implode("\n", $out);
}

test('panel add-on installer: menu items, permissions and exact undo', function () {
    $db = magnusMenuDb();
    $undo = $db . '.undo.json';
    $before = menuState($db);

    [$code, $out] = addonCli($db, 'plan --addon-path=/pay/panel/');
    same(0, $code, $out);
    $plan = json_decode($out, true);
    same(['extra2', 'extra3'], array_column($plan['items'], 'module'));
    same([7, 1], array_column($plan['items'], 'parent_id'), 'Top up under Billing, Telegram & security under Clients');

    [$code, $out] = addonCli($db, 'apply --addon-path=/pay/panel/ --undo=' . escapeshellarg($undo));
    same(0, $code, $out);
    $pdo = new \PDO('sqlite:' . $db);
    $pdo->setAttribute(\PDO::ATTR_DEFAULT_FETCH_MODE, \PDO::FETCH_ASSOC);
    same('/pay/panel/?tab=topup', $pdo->query("SELECT config_value FROM pkg_configuration WHERE config_key = 'module_extra2'")->fetchColumn());
    same('/pay/panel/?tab=security', $pdo->query("SELECT config_value FROM pkg_configuration WHERE config_key = 'module_extra3'")->fetchColumn());
    same('index.php/extra/read', $pdo->query("SELECT config_value FROM pkg_configuration WHERE config_key = 'module_extra'")->fetchColumn(), 'Extra untouched');
    same(['text' => 'Top up', 'icon_cls' => 'x-fa fa-credit-card', 'id_module' => 7], $pdo->query('SELECT text, icon_cls, id_module FROM pkg_module WHERE id = 100')->fetch());
    foreach ([3, 4] as $group) {
        $row = $pdo->query("SELECT action, show_menu, createShortCut FROM pkg_group_module WHERE id_group = $group AND id_module = 101")->fetch();
        same(['action' => 'r', 'show_menu' => 1, 'createShortCut' => 1], array_map(static function ($v) { return is_numeric($v) ? (int) $v : $v; }, $row), "customer group $group");
    }
    same('crud', $pdo->query('SELECT action FROM pkg_group_module WHERE id_group = 1 AND id_module = 100')->fetchColumn(), 'admin rights not lowered');
    same(0, (int) $pdo->query('SELECT COUNT(*) FROM pkg_group_module WHERE id_group = 2')->fetchColumn(), 'agents untouched');

    // Running it again keeps the first undo record, so undo still goes all the way back.
    [$code, $out] = addonCli($db, 'apply --addon-path=/pay/panel/ --undo=' . escapeshellarg($undo));
    same(0, $code, $out);
    [$code, $out] = addonCli($db, 'remove --undo=' . escapeshellarg($undo));
    same(0, $code, $out);
    same($before, menuState($db), 'everything back exactly as before');

    // Slots used for something else are left alone.
    $pdo->exec("UPDATE pkg_configuration SET config_value = 'https://crm.example.test/' WHERE config_key = 'module_extra2'");
    $plan = json_decode(addonCli($db, 'plan --addon-path=/pay/panel/')[1], true);
    same(['extra3', 'extra'], array_column($plan['items'], 'module'), 'busy Extra2 skipped');
    $pdo->exec("UPDATE pkg_configuration SET config_value = 'https://x.example.test/' WHERE config_key IN ('module_extra', 'module_extra3')");
    [$code, $out] = addonCli($db, 'plan --addon-path=/pay/panel/');
    check(strpos($out, '"ok": false') !== false && strpos($out, 'already used') !== false, 'no free slot reported');
    [$code] = addonCli($db, 'apply --addon-path=/pay/panel/ --undo=' . escapeshellarg($db . '.u2'));
    same(1, $code, 'apply refuses');
    @unlink($db); @unlink($undo);
});

test('one-tap top-up: amount buttons create the payment at once', function () {
    [$app, $fake] = makeApp();
    linkChat($app, $fake, 555, 'alice');
    $reply = tgTap($app, $fake, 555, 'qt:25:alice');
    check(strpos($reply['text'], 'Payment created') !== false, 'payment created');
    $pay = $reply['reply_markup']['inline_keyboard'][0][0];
    check(strpos($pay['text'], 'Pay') === 0 && strpos($pay['url'], 'http') === 0, 'Pay button');
    $order = $app->payments()->ordersForUsername('alice', 1)[0];
    same('25.00', number_format((float) $order['amount'], 2, '.', ''));
    same('555', (string) $order['tg_chat_id'], 'updates go to this chat');

    // After the payment is credited, the message offers the same amount again.
    $app->bot()->notify('credited', $app->payments()->getOrder((string) $order['id']));
    $done = messagesTo($fake, '555');
    $done = end($done);
    same('qt:25:alice', $done['reply_markup']['inline_keyboard'][0][0]['callback_data'], 'same again');

    // Junk and too many taps are handled.
    $before = count($app->payments()->ordersForUsername('alice', 50));
    tgTap($app, $fake, 555, 'qt:abc:alice');
    same($before, count($app->payments()->ordersForUsername('alice', 50)), 'bad amount ignored');
    for ($i = 0; $i < 11; $i++) {
        tgTap($app, $fake, 556, 'qt:10:alice');
    }
    $last = messagesTo($fake, '556');
    check(strpos(end($last)['text'], 'wait a few minutes') !== false, 'rate limited');
});

// ------------------------------------------------------------ fraud guard

/**
 * A MagnusBilling-like database with call records, live calls and the database clock NOW().
 */
function fraudDb(): \PDO
{
    $pdo = new \PDO('sqlite::memory:', null, null, [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION, \PDO::ATTR_DEFAULT_FETCH_MODE => \PDO::FETCH_ASSOC]);
    $pdo->sqliteCreateFunction('NOW', static function (): string { return date('Y-m-d H:i:s'); }, 0);
    $pdo->exec('CREATE TABLE pkg_user (id INTEGER PRIMARY KEY, username TEXT)');
    $pdo->exec("INSERT INTO pkg_user VALUES (7, 'alice'), (8, '100234'), (11, 'carol'), (12, 'dave')");
    $pdo->exec('CREATE TABLE pkg_cdr (id INTEGER PRIMARY KEY AUTOINCREMENT, id_user INTEGER, starttime TEXT, sessiontime INTEGER, calledstation TEXT, sessionbill REAL)');
    $pdo->exec('CREATE TABLE pkg_call_online (id INTEGER PRIMARY KEY AUTOINCREMENT, id_user INTEGER)');

    return $pdo;
}

function addCall(\PDO $pdo, int $user, float $cost, int $seconds = 120, string $number = '447700900123', int $minutesAgo = 5): void
{
    $stmt = $pdo->prepare('INSERT INTO pkg_cdr (id_user, starttime, sessiontime, calledstation, sessionbill) VALUES (?, ?, ?, ?, ?)');
    $stmt->execute([$user, date('Y-m-d H:i:s', time() - $minutesAgo * 60), $seconds, $number, $cost]);
}

function adminAlerts(FakeServices $fake): array
{
    return array_values(array_filter(messagesTo($fake, '999'), static function (array $m): bool {
        return strpos($m['text'], 'Fraud guard') !== false;
    }));
}

test('fraud guard: daily and hourly limits alert once, per-customer limits and OK today', function () {
    [$app, $fake] = makeApp(['fraud' => ['hour_limit' => 20, 'daily_limit' => 50, 'max_rate' => 0, 'max_calls' => 0]]);
    $pdo = fraudDb();
    $guard = new \Gateway\FraudGuard($app, new \Gateway\MagnusDb($app, $pdo));
    $guard->run(); // first run only remembers where the call records end
    for ($i = 0; $i < 6; $i++) {
        addCall($pdo, 7, 10.0, 600, '447700900123', 120 + $i);  // alice: 60 today, two hours ago
    }
    addCall($pdo, 11, 60.0, 600, '447700900124', 180);           // carol: 60 today, but her own limit is 100
    $guard->setDailyLimit('carol', 100.0, 'test');
    addCall($pdo, 12, 25.0, 300, '447700900125', 10);            // dave: 25 in the last hour
    same('2 alerts', $guard->run());
    $alerts = adminAlerts($fake);
    same(2, count($alerts));
    check(strpos($alerts[0]['text'], 'alice') !== false && strpos($alerts[0]['text'], '60.00') !== false && strpos($alerts[0]['text'], 'today') !== false, 'daily alert');
    check(strpos($alerts[1]['text'], 'dave') !== false && strpos($alerts[1]['text'], 'last hour') !== false, 'hourly alert');
    same(['adm:block:alice', 'adm:fraudok:alice'], array_column($alerts[0]['reply_markup']['inline_keyboard'][0], 'callback_data'));
    same('0 alerts', $guard->run(), 'not repeated');
    same(true, $fake->users[7]['active'] ?? true, 'not blocked without auto-block');

    // An admin taps "OK today": no more alerts for alice today.
    tgTap($app, $fake, 999, 'adm:fraudok:alice');
    $app->db()->kvSet('fraud:day:alice:' . date('Y-m-d'), null);
    same('0 alerts', $guard->run(), 'OK today respected');
});

test('fraud guard: expensive and satellite calls, too many calls at once', function () {
    [$app, $fake] = makeApp(['fraud' => ['daily_limit' => 0, 'hour_limit' => 0, 'max_rate' => 1.0, 'max_calls' => 10]]);
    $pdo = fraudDb();
    $guard = new \Gateway\FraudGuard($app, new \Gateway\MagnusDb($app, $pdo));
    addCall($pdo, 7, 50.0, 60, '447700900999');  // before the first run: ignored
    same('0 alerts', $guard->run());
    addCall($pdo, 7, 0.02, 60);                    // normal
    addCall($pdo, 7, 6.0, 120, '+4790012345678');  // 3.00 per minute
    addCall($pdo, 8, 0.10, 30, '00882161234567');  // cheap, but a satellite range
    for ($i = 0; $i < 12; $i++) {
        $pdo->exec('INSERT INTO pkg_call_online (id_user) VALUES (12)');
    }
    same('3 alerts', $guard->run());
    $text = implode("\n", array_column(adminAlerts($fake), 'text'));
    check(strpos($text, '4790•••5678') !== false && strpos($text, '3.00/min') !== false, 'expensive call, number partly hidden');
    check(strpos($text, 'premium/satellite range 882') !== false, 'satellite range');
    check(strpos($text, '12</b> calls at the same time') !== false, 'calls at once');
    check(strpos($text, '447700900999') === false && strpos($text, '4477•••0999') === false, 'old calls not reported');
});

test('fraud guard: automatic block, customer told, admins can unblock', function () {
    [$app, $fake] = makeApp(['fraud' => ['daily_limit' => 50, 'hour_limit' => 0, 'max_rate' => 0, 'max_calls' => 0, 'auto_block' => true]]);
    linkChat($app, $fake, 555, 'alice');
    $pdo = fraudDb();
    $guard = new \Gateway\FraudGuard($app, new \Gateway\MagnusDb($app, $pdo));
    $guard->run();
    addCall($pdo, 7, 75.0, 3000);
    $guard->run();
    same(0, $fake->users[7]['active'], 'blocked in MagnusBilling');
    $alert = adminAlerts($fake)[0];
    check(strpos($alert['text'], 'Blocked automatically') !== false, 'admins told');
    same('adm:unblock:alice', $alert['reply_markup']['inline_keyboard'][0][0]['callback_data'], 'Unblock button');
    $customer = messagesTo($fake, '555');
    check(strpos(end($customer)['text'], 'Account paused') !== false, 'customer told');
});

test('fraud guard: settings and /limit from the bot', function () {
    [$app, $fake] = makeApp();
    $screen = tgTap($app, $fake, 999, 'adm:fraud');
    check(strpos($screen['text'], 'Daily limit per customer: <b>50.00</b>') !== false, 'screen shows the limit');
    tgTap($app, $fake, 999, 'adm:fraudset:daily');
    $confirm = tgSay($app, $fake, 999, '75');
    tgTap($app, $fake, 999, confirmButton($confirm));
    same(75.0, (float) $app->config['fraud']['daily_limit'], 'daily limit changed');
    $confirm = tgTap($app, $fake, 999, 'adm:fraudauto');
    tgTap($app, $fake, 999, confirmButton($confirm));
    same(true, $app->config['fraud']['auto_block'], 'auto-block on');

    $confirm = tgSay($app, $fake, 999, '/limit alice 200');
    tgTap($app, $fake, 999, confirmButton($confirm));
    same(200.0, $app->fraudGuard()->dailyLimit('alice'));
    $confirm = tgSay($app, $fake, 999, '/limit alice default');
    tgTap($app, $fake, 999, confirmButton($confirm));
    same(75.0, $app->fraudGuard()->dailyLimit('alice'), 'back to the normal limit');
    $reply = tgSay($app, $fake, 999, '/limit nobody 10');
    check(strpos($reply['text'], 'No account found') !== false, 'unknown account');
    tgTap($app, $fake, 4242, 'adm:fraudok:alice');
    same(false, $app->fraudGuard()->isOkToday('alice'), 'customers cannot press admin buttons');
});

test('backups: encrypted file goes to Telegram as a document', function () {
    [$app, $fake] = makeApp();
    $file = tempnam(sys_get_temp_dir(), 'bk');
    file_put_contents($file, 'encrypted bytes');
    $app->telegram()->sendDocument('999', $file, '💾 <b>Nightly backup</b>');
    $call = lastCall($fake, 'sendDocument');
    same('999', $call['chat_id']);
    same($file, $call['document']['file'], 'uploaded as a file');
    same('💾 <b>Nightly backup</b>', $call['caption']);
    unlink($file);
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
