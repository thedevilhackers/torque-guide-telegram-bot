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

- **Website**: a black-and-gold "luxury" top-up page (or a light "classic" theme) with:
  - a live username check, quick amounts and a bonus preview
  - an optional promo banner
  - accepted-coin badges and an FAQ
  - a "Check a payment" box
  - a remembered username
- **Status page**: updates itself and has an invoice countdown, copy order ID, print receipt and **Notify me on Telegram**.
- **Prefilled links**: `https://pay.unitycarrier.com/pay/?username=100234&amount=25`
- **JSON API**: create payments and check order status from WHMCS, your CRM, another bot or your main website.
- **Telegram bot**:
  - Customers get a menu (Top up · My payments · Help), one-tap repeat top-ups, and a message when the credit is added.
  - Admins get payment alerts. They can also look up orders, add or remove balance, credit an order by hand, and change SIP caller IDs, each with a Confirm button.
- **Automatic jobs** run every 5 minutes:
  - unpaid orders are re-checked, so a payment whose OxaPay notice was missed still gets credited
  - **low-balance alerts** go to linked customers
  - a **daily report** goes to admins
  - **health alerts** fire when MagnusBilling or OxaPay stop answering
- **Customer extras**:
  - 🆘 support chat
  - 🏦 bank transfer with receipt approval
  - 🎟 promo codes on the website and in the bot
  - 📞 call history
- **Admin extras**:
  - block or unblock accounts
  - new SIP password
  - change plan
  - live calls
  - promo code management
  - view-only admins
- **Settings in one file**: name, colours, currency, min/max, preset amounts, credit rate, bonus tiers, invoice lifetime, who pays the fee, and more.
- **Safe crediting**: webhooks are checked with HMAC and re-checked with OxaPay's API. Each order is credited once, even if OxaPay sends the webhook several times or MagnusBilling times out mid-request.
- No Composer and no framework: plain PHP 7.4+ with the `curl` extension and either SQLite or MySQL.

## Upgrading an existing install

This adds the new admin commands and redesign. It keeps your settings, payment records and HTTPS:

```bash
cd /root/unitycarrier-src && git pull
```

```bash
bash /root/unitycarrier-src/magnus-oxapay-gateway/install.sh --yes
```

The installer also gives the gateway's MagnusBilling API key the **update** permission that `/callerid` needs, and adds the new options (`theme`, `announcement`, `coins`) to `config.php`.

## 1. Install on your MagnusBilling server (one command)

`install.sh` installs the gateway on a server that already runs MagnusBilling 7 or 8 on Debian 11, 12 or 13, for example Unity Carrier's server `212.113.119.248`. It doesn't modify MagnusBilling's files, Asterisk or the firewall, and you can safely run it again.

Before you start, have these ready:

- **OxaPay merchant API key**: OxaPay dashboard → Merchant Service → Generate API key. You can also add it later.
- **Optional:** a domain for HTTPS, for example `pay.unitycarrier.com`, with a DNS **A record** pointing to `212.113.119.248`.
- **Optional:** a Telegram bot token from [@BotFather](https://t.me/BotFather).

Log in to the server as root over SSH and download the code. GitHub asks for your username and a personal access token if the repository is private.

```bash
cd /root
git clone -b claude/inspiring-euler-lb921s https://github.com/thedevilhackers/torque-guide-telegram-bot.git unitycarrier-src
```

Alternatively, download the branch as a ZIP from GitHub, upload it to `/root` with WinSCP, and unzip it.

Run the installer and answer its questions. Pressing Enter accepts the value in brackets.

```bash
bash /root/unitycarrier-src/magnus-oxapay-gateway/install.sh
```

```
==> Checking the server
  ✓ Debian GNU/Linux 13 (trixie)
  ✓ MagnusBilling, Apache and PHP 8.4 found
==> Settings
  Company name [Unity Carrier]:
  Public IP of this server [212.113.119.248]:
  Domain for the payment page (leave empty to use the IP): pay.unitycarrier.com
  OxaPay merchant API key (can be added later): ********
  Start in OxaPay test mode (sandbox, no real money)? [y/N]: y
  Telegram bot token: ********
==> Configuring (MagnusBilling API key, OxaPay, Telegram)
  ✓ Created a MagnusBilling API key for admin 'root' (create + read, 127.0.0.1 only)
  ✓ MagnusBilling API works at http://127.0.0.1/mbilling
...
Unity Carrier top-up gateway is installed.
  Payment page:     https://pay.unitycarrier.com/pay/
```

What the installer does:

| Step | Details |
| --- | --- |
| Files | Copies the app to `/var/www/unitycarrier-pay`. Only its `public/` folder is published, at `/pay`, through the link `/var/www/html/pay`. `config.php` (mode 640) and `data/` (www-data, mode 750) stay out of reach of the web. |
| MagnusBilling | Adds one API key to **Settings → API** with **create + read** permission, usable from `127.0.0.1` only. The installer reads the database login from `/etc/asterisk/res_config_mysql.conf`. |
| Domain | If the domain resolves to this server, it adds an Apache site for it and offers a free Let's Encrypt certificate. No redirect is added, and the existing IP access and `/mbilling` keep working. Without a domain, the page runs at `http://212.113.119.248/pay/`. |
| Telegram | With HTTPS the bot uses a webhook. Without HTTPS, the installer creates a `unitycarrier-pay-bot` systemd service that uses long polling. |
| Check | Ends with `bin/cli.php check`, which tests the database, MagnusBilling API, OxaPay key and Telegram. |

Common follow-ups. The installed copy includes the installer, so you can run these from anywhere as `bash /var/www/unitycarrier-pay/install.sh ...`:

- **Change settings** (amounts, bonus, colours, test/live): edit `/var/www/unitycarrier-pay/config.php`, then run the installer again. Your edits are kept.
- **Go live after testing**:

  ```bash
  bash install.sh --live
  ```

- **Add HTTPS later**:

  ```bash
  bash install.sh --domain pay.unitycarrier.com
  ```

- **Update to a newer version**: run `git pull` in `/root/unitycarrier-src`, then run `/root/unitycarrier-src/magnus-oxapay-gateway/install.sh` again.
- **Remove it**: this removes the page, the bot service and the Magnus API key, and keeps the payment records.

  ```bash
  bash install.sh --uninstall
  ```

  Add `--purge` to delete the records too.

- **Unattended install**:

  ```bash
  bash install.sh --yes --company "Unity Carrier" --ip 212.113.119.248 --oxapay-key KEY --sandbox
  ```

### Manual install

If you'd rather not use the installer:

1. Copy the folder to `/var/www/unitycarrier-pay` and run `cp config.example.php config.php`.
2. Fix ownership and permissions:

   ```bash
   chown -R www-data:www-data data
   chmod 750 data
   chown root:www-data config.php
   chmod 640 config.php
   ```

3. Link only `public/`:

   ```bash
   ln -s /var/www/unitycarrier-pay/public /var/www/html/pay
   ```

4. Create the API key yourself: **Settings → API → Add**, with these settings:
   - user `root`
   - a random key and a different random secret, 15+ characters, no spaces
   - action `cr`
   - allowed IPs `127.0.0.1`
   - status active

   Then put the key and secret in `config.php` under `magnus`.

> Never put the whole folder inside `/var/www/html`. Only `public/` may be reachable from the web.

## 3. Create the OxaPay merchant key

In the OxaPay dashboard, open **Merchant Service** and generate a **Merchant API key**. Put it in `oxapay.merchant_api_key`. You don't need to set a callback URL in the dashboard: the gateway sends `https://www.unitycarrier.com/pay/webhook.php` with every invoice.

Set `'sandbox' => true` while you test. In sandbox mode, invoices use OxaPay's test environment and no real coins move.

## 4. Check the setup

The installer runs this check at the end. Run it again any time with:

```bash
php /var/www/unitycarrier-pay/bin/cli.php check
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
2. Run `bash install.sh` and paste the token when asked. The installer connects the bot: through a webhook with HTTPS, or through the `unitycarrier-pay-bot` service without it.
3. Send `/id` to your bot. Run `bash install.sh` again and enter that number as the admin chat ID. That chat then gets payment alerts and the admin commands.

| Who | Command | What it does |
| --- | --- | --- |
| Everyone | `/topup` | Asks for the username, then the amount (buttons or typed), and returns a **Pay** button |
| Everyone | `/topup 100234 25` | Same, in one line |
| Everyone | Menu buttons **💳 Top up**, **🧾 My payments**, **❓ Help** | Always shown under the chat box |
| Everyone | `/myorders` | This chat's last 5 payments, with **Pay** buttons for unpaid ones |
| Everyone | `/status <order>` | Payment status |
| Everyone | `/cancel`, `/help`, `/id` | |
| Admin | `/recent`, `/find <username>` | Latest orders, or all orders of one account |
| Admin | `/order <id>` | Order details, including OxaPay status and the last error |
| Admin | `/retry <id>` | Re-checks with OxaPay, or retries the credit for a paid order |
| Admin | `/markpaid <id>` | Credits an order by hand, for example after the customer paid you another way |
| Admin | `/balance <username>` | Current MagnusBilling balance |
| Admin | `/addcredit <username> <amount> [note]` | Adds balance (a MagnusBilling refill noted "Telegram admin @you: note") |
| Admin | `/removecredit <username> <amount> [note]` | Removes balance the same way |
| Admin | `/sip <sip or username>` | Lists SIP accounts with their caller ID |
| Admin | `/callerid <sip> <number>` | Changes a SIP account's caller ID (digits, optional +). MagnusBilling regenerates its SIP config right away. |
| Admin | `/stats` | Credited totals for today, 7 days and 30 days |

**Admin panel (buttons, no typing):** admins see a **🛠 Admin panel** button in the bot menu (or send `/admin`). It opens these buttons:

| Button | What it does |
| --- | --- |
| 📋 Recent orders | Latest orders. Tap one to open it with **Re-check**, **Mark paid** and **Account** buttons. |
| 📊 Stats | Credited totals |
| 👤 Account | Asks for a username, then shows balance, SIP accounts, caller IDs and latest top-ups, with **Add credit**, **Remove credit**, **Caller ID** and **All orders** buttons |
| 🔍 Find orders | All orders of an account |
| ➕ Add credit / ➖ Remove credit | Asks for the username, then offers amount buttons (5, 10, 25, 50, 100). You can also type an amount with a note, e.g. `25 bank transfer`. |
| ☎️ SIP accounts / 📞 Caller ID | Asks for a SIP or account username, then for the new caller ID |
| ✅ Mark an order paid | Lists unpaid orders to tap, or accepts an order ID |
| ⚙️ Settings | Change the **minimum** and **maximum** top-up and the **currency** (EUR, USD or GBP), or reset to `config.php`. Changes apply to the website and bot immediately. |

Settings changed in Telegram are stored in the gateway's database and take priority over `config.php`. Tap **↩️ Reset to config.php** to go back to the file's values. `php bin/cli.php check` shows the values in use.

**👥 Customers:**

- **➕ New customer** creates the MagnusBilling account and its SIP account in four steps. It asks for the username (or automatic), password (or generated), email and plan, then shows a Confirm step.
- After creating the account, the bot shows the login details and a **Telegram invite link** with a **📤 Share invite** button.
- **🔗 Telegram invite** makes the same kind of link for an existing account. You'll also find it on every 👤 Account card.
- When the customer opens the link, their Telegram is linked to that account. Links work once and expire after 7 days, so nobody can attach themselves to someone else's account.
- Linked customers get **👤 My account** (balance, caller IDs, latest top-ups, one-tap **Top up this account**, **Unlink**). They also get a message for every credit added to their account, including payments made on the website.
- **📇 Linked customers** lists who is linked, with a quick **✉️ Message** button.

**📣 Send message:**

- Choose **👤 One customer** (by username, if linked), **🔗 All linked customers**, or **👥 Everyone who used the bot**.
- Type the message, check the preview, then tap **Confirm**.
- The bot reports how many people received it. People who blocked the bot are skipped next time.

By default, MagnusBilling only creates accounts through the API when the email is unique, and an empty email counts as one. If you create customers without an email, set **Settings → Configuration → "API allow multiple user/email" = 1** in MagnusBilling.

Payment alerts carry buttons too:

- **New top-up**: **Account**
- **Credit failed** and **Held for review**: **Re-check** and **Mark paid**

**More admin panel buttons:**

| Button | What it does |
| --- | --- |
| 📞 Live calls | Calls in progress: SIP account, number dialled, duration, status. Has a **Refresh** button. |
| 🎟 Promo codes | Lists codes with how often each was used. **➕ New promo code** asks for code, percent, number of uses and days valid. Share a code as `https://…/pay/?promo=CODE`. |
| 🏦 Bank transfers | Transfers waiting for approval, with **Approve** and **Reject**. Turn bank transfer on in ⚙️ Settings → 🏦 Bank details. |
| 📊 Report now | Sends the daily report immediately |
| ⚙️ Settings | Minimum, maximum, currency, 🪫 low-balance alert threshold (0 = off), 📊 daily report hour (or off), 🏦 bank details (or off) |

**Account card buttons:** ⛔ Block / ✅ Unblock, 🔑 SIP password (type one or generate), 📦 Change plan, 📞 Calls, 🔗 Telegram invite, ✉️ Message.

**For customers:**

- 🆘 **Support**: customers write a message or send a photo or file. Admins get it with a **↩️ Reply** button, and the customer can reply back.
- 🏦 **Bank transfer** (when bank details are set):
  1. The customer chooses the amount.
  2. They get your bank details and a reference code, and send a photo or PDF of the receipt.
  3. Admins get the receipt with **Approve** and **Reject** buttons.
  4. Approving credits the account and tells the customer.
- 🎟 **Promo code**: entered while topping up in the bot, or on the website ("Have a promo code?"). It adds extra credit on top of the bonus tiers.
- 📞 **My calls**: under 👤 My account, the latest calls with duration and cost.
- 🪫 **Low-balance alert**: linked customers get a message with a **Top up now** button when their balance drops below the threshold. It is sent once per drop.

**View-only admins:** to let someone see orders, accounts, stats and live calls without changing anything, run:

```bash
bash install.sh --telegram-viewers 123456789 --yes
```

**Scheduled jobs:** the installer adds `/etc/cron.d/unitycarrier-pay`, which runs `bin/cli.php cron` every 5 minutes as www-data. To run it by hand:

```bash
php /var/www/unitycarrier-pay/bin/cli.php cron
```

To send today's report now:

```bash
php /var/www/unitycarrier-pay/bin/cli.php report
```

Admin safety:

- Every change (`/addcredit`, `/removecredit`, `/markpaid`, `/callerid`) first shows a summary with **Confirm** and **Cancel** buttons. The button works once and expires after 5 minutes.
- After the change, the bot shows the result, writes it to `data/gateway.log` with the admin's Telegram name, and tells the other admins.
- Put only **private** chat IDs in `admin_chat_ids`. A group ID would let everyone in that group use these commands.
- Changing caller IDs needs the **update** permission on the gateway's MagnusBilling API key. The installer grants it when you run it again.

Website links that open the bot:

- `t.me/<bot>?start=u_<username>` starts a top-up for that account.
- `t.me/<bot>?start=o_<order>` sends that order's updates to the chat. The status page's **Notify me on Telegram** button uses this.

Bot service logs: `journalctl -u unitycarrier-pay-bot -f`.

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
cd /var/www/unitycarrier-pay
php bin/cli.php orders 20
php bin/cli.php order <id>
php bin/cli.php retry <id>
php bin/cli.php check
```

When you run these as root, they switch to the `www-data` user by themselves, so the database files keep the right owner.

Everything is logged as JSON lines to `data/gateway.log`.

## How double credit is prevented

1. `webhook.php` rejects any request whose `HMAC` header is not the HMAC-SHA512 of the raw body with your merchant API key.
2. With `verify_with_api` (on by default), the gateway ignores the status in the webhook body. It asks OxaPay's payment-information API for the real status of that `track_id`.
3. Each order is locked with an atomic database update (`pending → crediting`) before MagnusBilling is called. Repeated or parallel webhooks cannot both get the lock.
4. Each refill's description contains the order ID. Before adding credit, the gateway searches MagnusBilling for that ID. If an earlier attempt succeeded but its reply was lost, nothing is added a second time.
5. If MagnusBilling is down, the order becomes `credit_failed` and the webhook answers HTTP 500. OxaPay then retries, and the status page retries too. Admins get one Telegram alert.

## Configuration notes

- **Billing in euros**: set it in Telegram under **Admin panel → ⚙️ Settings → 💱 Currency → € EUR**, or on the server with:

  ```bash
  bash install.sh --currency EUR --yes
  ```

  New invoices, the website and the bot then use €. Orders already created keep their own currency.
- **Credit amount**: MagnusBilling receives `amount × payments.credit_rate` credit. Keep `credit_rate` at `1` when MagnusBilling's own currency is the same as the one customers pay in.
- `site.theme`: `voip` (default), `luxury` (black and gold) or `classic` (light, follows dark mode, uses `site.accent`).
  - `voip` is navy and electric blue, with a top bar and a live status pill ("All systems online" changes to "Delays possible" when the health check finds a problem).
  - On desktop it shows a VoIP intro beside the top-up panel, which has a 1-2-3 step indicator.
  - Change the theme in Telegram (⚙️ Settings → 🎨 Website theme) or with `bash install.sh --theme voip --yes`.
- `site.announcement`: a banner above the form, for example `'Get 5% bonus credit on top-ups from $100'`. Leave it empty to hide it.
- `site.logo_url`: your logo (square works best). It's also used as the browser tab icon.
- `payments.coins`: the coin badges shown on the page. The checkout itself lists every coin OxaPay supports.
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
- Use SQLite in `data/` (the default) or a separate MySQL user. Never use the MariaDB root password or the `mbillingUser` account for the gateway's own data. The installer only reads that account once, to add the API key.
- MagnusBilling logs any request containing words such as `copy`, `print`, `eval` or `alert` as an SQL-injection attempt. After three of them it bans the caller's IP, which for this gateway is the server itself. The gateway never sends such values to MagnusBilling. As a result, accounts whose username contains one of those words can't be topped up here.
- Serve the site over HTTPS (`certbot --apache`).
- Pointing your public domain at this server makes `/mbilling` easier to find. Change the default `root` password, use a strong admin password, and keep fail2ban running.
- Back up `data/gateway.sqlite` together with your Magnus backups.

The gateway itself has a small attack surface. It has no file uploads, no shell commands and no web admin login (admin is done through the CLI or Telegram). Every SQL query is parameterised, and all input is validated and all output escaped.

## Hosting it elsewhere

The gateway can run on any PHP 7.4+ host. It does not have to run on the Magnus server.

- Set `magnus.url` to `https://<magnus-server>/mbilling`, and put the host's outgoing IP in the API key's **Allowed IPs**.
- Point the web root of a domain or subdomain (for example `pay.unitycarrier.com`) at the `public/` folder, and set `site.base_url` to match.
- For nginx, use `root /var/www/unitycarrier-pay/public;` with the usual `location ~ \.php$` block for PHP-FPM.

## Troubleshooting

| Message | Meaning |
| --- | --- |
| `MagnusBilling API error: invalid API access` | Wrong key or secret, or the API key is inactive |
| `MagnusBilling API error: invalid IP` | The gateway's IP is not in the API key's **Allowed IPs** |
| `MagnusBilling API error: invalid API action` | The API key lacks the create or read permission |
| `OxaPay error (HTTP 401)` | Wrong merchant API key |
| Payment made but status stays "Waiting" | Make sure `https://.../pay/webhook.php` is reachable from the internet. Check `data/gateway.log`. Opening the status page also re-checks OxaPay. |
| Bot says "MagnusBilling: Request to 127.0.0.1 failed: Operation timed out" or "took a while to answer" | MagnusBilling saves the change, then emails the customer before it replies. If its mail server is slow or blocked, the reply is late. The gateway now checks whether the change was saved and never applies it twice. Fix the cause in MagnusBilling under **Settings → SMTP**: correct the host, port and password, or clear them if you don't send emails. Many VPS providers block outgoing ports 25, 465 and 587. |
| `credit_failed` | Paid, but MagnusBilling refused or was unreachable. See `last_error` with `php bin/cli.php order <id>`, fix the cause, then `retry <id>`. |

## Tests

```bash
php tests/run.php
```

The suite runs the whole flow against in-memory fakes of MagnusBilling, OxaPay and Telegram: order creation, signatures, duplicate and forged webhooks, outages, lost replies, Telegram conversations and admin commands. The fake MagnusBilling checks request signatures the same way MagnusBilling's own `ApiAccess` component does.

The MagnusBilling integration was written against the MagnusBilling 7 source (`ApiAccess`, `RefillController`, `UserCreditManager`). It uses the same `user` and `refill` API modules as the official `magnusbilling-api-php` client. Run `php bin/cli.php check` on your version 8 server to confirm the API answers the same way before you go live.
