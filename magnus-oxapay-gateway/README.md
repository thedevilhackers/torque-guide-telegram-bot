# MagnusBilling × OxaPay top-up gateway

A small PHP website, JSON API and Telegram bot. Customers use it to add balance to their MagnusBilling account with crypto through OxaPay.

```
Customer enters username + amount  (website, Telegram or your own app via the API)
        │
        ▼
Gateway checks the username in MagnusBilling ──► creates an OxaPay invoice ──► redirects to OxaPay
        │
        ▼
OxaPay calls webhook.php (HMAC-signed) ──► gateway re-checks the payment with OxaPay's API
        │
        ▼
Gateway adds the credit in MagnusBilling (a "refill"), exactly once ──► Telegram notifications
```

Features:

- **Website**: a mobile-friendly top-up page with a live username check, preset amounts, bonus preview, dark mode, and a status page that updates itself. You can prefill it with a link: `https://www.unitycarrier.com/pay/?username=100234&amount=25`
- **JSON API**: create payments and check order status from WHMCS, your CRM, another bot or your main website.
- **Telegram bot**: customers type `/topup` and get a payment button. They receive a message when the credit is added. Admins get alerts and use `/recent`, `/order`, `/retry`, `/balance` and `/stats`.
- **Settings in one file**: name, colours, currency, min/max, preset amounts, credit rate, bonus tiers, invoice lifetime, who pays the fee, and more.
- **Safe crediting**: webhooks are checked with HMAC and re-checked with OxaPay's API. Each order is credited once, even if OxaPay sends the webhook several times or MagnusBilling times out mid-request.
- No Composer and no framework: plain PHP 7.4+ with the `curl` extension and either SQLite or MySQL.

## 1. Install on the MagnusBilling server

These steps assume Debian/Ubuntu with Apache, which is what the MagnusBilling installer sets up. They also assume `www.unitycarrier.com` points to that server. If your website is hosted somewhere else, see [Hosting it elsewhere](#hosting-it-elsewhere).

```bash
cd /var/www
git clone <this repository> unity-src
cp -r unity-src/magnus-oxapay-gateway /var/www/magnus-oxapay-gateway
cd /var/www/magnus-oxapay-gateway
cp config.example.php config.php
```

```bash
apt-get install -y php-sqlite3 php-curl php-mbstring
```

Give the web server write access to `data/` and keep `config.php` private:

```bash
chown -R www-data:www-data data
chmod 750 data
chown root:www-data config.php
chmod 640 config.php
```

The MagnusBilling installer already installs `php-sqlite3`, `php-curl` and `php-mbstring` and opens ports 80/443, so the `apt-get` line above is usually a no-op and no firewall change is needed.

Publish **only** the `public/` folder at `https://www.unitycarrier.com/pay`:

```bash
ln -s /var/www/magnus-oxapay-gateway/public /var/www/html/pay
```

```bash
systemctl reload apache2
```

OxaPay and Telegram need **HTTPS**. If the site does not have a certificate yet, get one with `certbot --apache -d www.unitycarrier.com`.

> Never put the whole `magnus-oxapay-gateway` folder inside `/var/www/html`. `config.php` and `data/` must stay outside the web root. The included `.htaccess` files are only a backup safeguard.

## 2. Create the MagnusBilling API key

1. In MagnusBilling, open **Settings → API** and click **Add**.
2. **Username**: your admin user (for example `root`).
3. **API key** and **API secret**: two different random strings of 15 or more characters, with no spaces. `php bin/cli.php secret` prints one.
4. **Action**: allow **create** and **read** (`cr`). The gateway reads users and refills and creates refills. It never updates or deletes anything.
5. **Allowed IPs**: the IP address the gateway calls from. Use `127.0.0.1` when it runs on the Magnus server itself.
6. **Status**: active.

Put them in `config.php`:

```php
'magnus' => [
    'url' => 'http://127.0.0.1/mbilling',
    'api_key' => '...',
    'api_secret' => '...',
],
```

## 3. Create the OxaPay merchant key

In the OxaPay dashboard, open **Merchant Service** and generate a **Merchant API key**. Put it in `oxapay.merchant_api_key`. You don't need to set a callback URL in the dashboard: the gateway sends `https://www.unitycarrier.com/pay/webhook.php` with every invoice.

Set `'sandbox' => true` while you test. In sandbox mode, invoices use OxaPay's test environment and no real coins move.

## 4. Check the setup

```bash
cd /var/www/magnus-oxapay-gateway
php bin/cli.php check
```

```
[ OK ] Database - sqlite
[ OK ] Public URL - https://www.unitycarrier.com/pay
[ OK ] MagnusBilling API - user + refill read OK, sample user 100234
[ OK ] OxaPay API key - accepted
[ OK ] Telegram bot - @UnityCarrierBot
```

Open `https://www.unitycarrier.com/pay/`, enter a username and an amount, and pay a sandbox invoice. The balance in MagnusBilling should go up, and the refill appears under **Billing → Refills** with the description `OxaPay top-up #<order> (track <id>)`.

## 5. Telegram bot (optional)

1. Message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token.
2. In `config.php`, set `telegram.enabled => true`, `bot_token`, `bot_username`, and `webhook_secret` (use `php bin/cli.php secret`).
3. Connect the bot:

```bash
php bin/cli.php telegram:webhook
```

4. Send `/id` to your bot. Put the number it replies with into `telegram.admin_chat_ids`. That chat then gets payment alerts and the admin commands.

| Who | Command | What it does |
| --- | --- | --- |
| Everyone | `/topup` | Asks for the username, then the amount (buttons or typed), and returns a **Pay** button |
| Everyone | `/topup 100234 25` | Same, in one line |
| Everyone | `/status <order>` | Payment status |
| Everyone | `/cancel`, `/help`, `/id` | |
| Admin | `/recent` | Last 10 orders |
| Admin | `/order <id>` | Order details, including OxaPay status and the last error |
| Admin | `/retry <id>` | Re-checks with OxaPay, or retries the credit for a paid order |
| Admin | `/balance <username>` | Current MagnusBilling balance |
| Admin | `/stats` | Credited totals for today, 7 days and 30 days |

To test without HTTPS, run `php bin/cli.php telegram:poll`. It switches the bot to long polling. Run `telegram:webhook` again afterwards.

## JSON API

Base URL: `https://www.unitycarrier.com/pay/api.php`. Every response looks like this:

```json
{ "ok": true,  "data": { ... } }
{ "ok": false, "error": { "code": "unknown_user", "message": "No account found with that username." } }
```

| Action | Method | Parameters | Notes |
| --- | --- | --- | --- |
| `config` | GET | – | Public settings: currency, min/max, presets, bonus tiers |
| `check_user` | GET | `username` | `{ "exists": true, "username": "100234" }` |
| `quote` | GET | `amount` | Credit and bonus for an amount |
| `create_payment` | POST | `username`, `amount`, `email`?, `reference`*, `return_url`* | Returns the order with `payment_url`. Send the customer there. |
| `order` | GET | `order_id` | Order status. Also re-checks OxaPay at most every 15 s. |
| `user` | GET | `username` | **API key only.** Returns the current balance. |

\* `reference` (your own invoice ID) and `return_url` (where OxaPay sends the customer afterwards) only work with an API key.

Public calls are rate-limited per IP (`api.rate_limits`). Calls with an API key are not. Generate a key with `php bin/cli.php secret` and add it to `api.keys`:

```php
'api' => ['keys' => ['6bb8bcde...'=> 'whmcs']],
```

Send it as `X-Api-Key: <key>` or `Authorization: Bearer <key>`.

**Create a payment (curl)**

```bash
curl -X POST 'https://www.unitycarrier.com/pay/api.php?action=create_payment' \
  -H 'Content-Type: application/json' -H 'X-Api-Key: YOUR_KEY' \
  -d '{"username":"100234","amount":25,"reference":"INV-1001","return_url":"https://www.unitycarrier.com/thanks"}'
```

```json
{
  "ok": true,
  "data": {
    "order_id": "1c8243d0f76d7786e4b9e72c",
    "username": "100234",
    "amount": "25.00",
    "credit": "25.00",
    "status": "pending",
    "payment_url": "https://pay.oxapay.com/.../500000",
    "status_url": "https://www.unitycarrier.com/pay/status.php?order=1c8243d0f76d7786e4b9e72c",
    "reference": "INV-1001"
  }
}
```

**PHP**

```php
$ch = curl_init('https://www.unitycarrier.com/pay/api.php?action=create_payment');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-Api-Key: YOUR_KEY'],
    CURLOPT_POSTFIELDS => json_encode(['username' => '100234', 'amount' => 25]),
]);
$result = json_decode(curl_exec($ch), true);
header('Location: ' . $result['data']['payment_url']);
```

**Button on your main website (no code)**

```html
<a href="https://www.unitycarrier.com/pay/?username=100234&amount=25">Top up with crypto</a>
```

To call the API from JavaScript on another domain, add that origin to `api.cors_origins`. Do not put API keys in browser code. Public calls do not need one.

Order statuses: `pending` → `paying` → `credited`. Other outcomes are `expired`, `underpaid`, `refunded`, `failed`, and `credit_failed`/`review`, which mean the payment arrived but needs a retry or an admin.

## Admin command line

```bash
php bin/cli.php orders 20
php bin/cli.php order <id>
php bin/cli.php retry <id>
php bin/cli.php check
```

Everything is logged as JSON lines to `data/gateway.log`.

## How double credit is prevented

1. `webhook.php` rejects any request whose `HMAC` header is not the HMAC-SHA512 of the raw body with your merchant API key.
2. With `verify_with_api` (on by default), the gateway ignores the status in the webhook body. It asks OxaPay's payment-information API for the real status of that `track_id`.
3. Each order is locked with an atomic database update (`pending → crediting`) before MagnusBilling is called. Repeated or parallel webhooks cannot both get the lock.
4. Each refill's description contains the order ID. Before adding credit, the gateway searches MagnusBilling for that ID. If an earlier attempt succeeded but its reply was lost, nothing is added a second time.
5. If MagnusBilling is down, the order becomes `credit_failed` and the webhook answers HTTP 500. OxaPay then retries, and the status page retries too. Admins get one Telegram alert.

## Configuration notes

- `payments.credit_rate`: MagnusBilling credit per 1 unit paid. Keep `1` if Magnus also bills in USD.
- `payments.bonus`: for example `[['min' => 100, 'percent' => 5]]` gives 5% extra credit on top-ups of 100 or more.
- `oxapay.fee_paid_by_payer`: `1` adds the OxaPay fee to the customer's amount. `0` means you pay it.
- `oxapay.under_paid_coverage`: accept payments up to this percentage short, for example `1` to absorb small wallet rounding.
- `oxapay.to_currency`: for example `USDT`, to auto-convert received coins.
- **MySQL instead of SQLite**: create a database and user, then set `database.dsn` to `mysql:host=127.0.0.1;dbname=oxapay_gateway;charset=utf8mb4` and fill in `username`/`password`. Tables are created automatically.
- `app.trust_proxy_headers`: set to `true` only behind Cloudflare or a reverse proxy, so rate limits see the real visitor IP.

## Security on the MagnusBilling server

Running the gateway on the Magnus server is supported and keeps the Magnus API on `127.0.0.1`, where it is never exposed to the internet. Keep in mind that it runs as the same Apache user as the Magnus panel, so a hole in either one exposes the same things. Checklist:

- Publish only `public/`. The rest of the folder, including `config.php` and `data/`, stays outside `/var/www/html`.
- Restrict the Magnus API key to **create + read** and **Allowed IPs `127.0.0.1`**. Then a leaked key is useless from outside the server. For least privilege, give the API key its own admin group that can only use *Users* and *Refills*.
- Use only an OxaPay **merchant** key here. A merchant key cannot send payouts. Never put a payout key on this server.
- Use SQLite in `data/` or a separate MySQL user. Never use the MariaDB root password or the `mbillingUser` account.
- Serve the site over HTTPS (`certbot --apache`).
- Pointing your public domain at this server makes `/mbilling` easier to find. Change the default `root` password, use a strong admin password, and keep fail2ban running.
- Back up `data/gateway.sqlite` together with your Magnus backups.

The gateway itself has a small attack surface. It has no file uploads, no shell commands and no web admin login (admin is done through the CLI or Telegram). Every SQL query is parameterised, and all input is validated and all output escaped.

## Hosting it elsewhere

The gateway can run on any PHP 7.4+ host. It does not have to run on the Magnus server.

- Set `magnus.url` to `https://<magnus-server>/mbilling`, and put the host's outgoing IP in the API key's **Allowed IPs**.
- Point the web root of a domain or subdomain (for example `pay.unitycarrier.com`) at the `public/` folder, and set `site.base_url` to match.
- For nginx, use `root /var/www/magnus-oxapay-gateway/public;` with the usual `location ~ \.php$` block for PHP-FPM.

## Troubleshooting

| Message | Meaning |
| --- | --- |
| `MagnusBilling API error: invalid API access` | Wrong key or secret, or the API key is inactive |
| `MagnusBilling API error: invalid IP` | The gateway's IP is not in the API key's **Allowed IPs** |
| `MagnusBilling API error: invalid API action` | The API key lacks the create or read permission |
| `OxaPay error (HTTP 401)` | Wrong merchant API key |
| Payment made but status stays "Waiting" | Make sure `https://.../pay/webhook.php` is reachable from the internet. Check `data/gateway.log`. Opening the status page also re-checks OxaPay. |
| `credit_failed` | Paid, but MagnusBilling refused or was unreachable. See `last_error` with `php bin/cli.php order <id>`, fix the cause, then `retry <id>`. |

## Tests

```bash
php tests/run.php
```

The suite runs the whole flow against in-memory fakes of MagnusBilling, OxaPay and Telegram: order creation, signatures, duplicate and forged webhooks, outages, lost replies, Telegram conversations and admin commands. The fake MagnusBilling checks request signatures the same way MagnusBilling's own `ApiAccess` component does.

The MagnusBilling integration was written against the MagnusBilling 7 source (`ApiAccess`, `RefillController`, `UserCreditManager`). It uses the same `user` and `refill` API modules as the official `magnusbilling-api-php` client. Run `php bin/cli.php check` on your version 8 server to confirm the API answers the same way before you go live.
