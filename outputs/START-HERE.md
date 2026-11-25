# Installation guide: Unity Performance website

This guide puts the new version of the website on your server: the home page with Find your car, Stage 1 graphs, services, Our work, ECUs and Visit, plus the new tuning file service at `/files` (accounts, credits, ECU file upload, buying tunes) and the new admin screens. Your orders, enquiries, products, settings and photos are kept; an update never touches them.

You need:

- Your Mac, with the **Terminal** app (press Cmd+Space, type `Terminal`, press Enter).
- Your server's address, `81.19.137.7`, and its `root` password (or SSH key).

It takes about 10 minutes. The site keeps running while the new version is checked.

## Part 1: Update the server

### 1. Download a backup first

Open https://unityperformance.co/admin, go to **Backup** and press **Download backup**. Keep the file somewhere safe and private: it holds your settings and customer accounts.

### 2. Run the update

Your server was set up from a zip, so it updates from one. This single command, pasted into Terminal on your Mac, makes the server download the newest version from GitHub, pack it, check it and switch to it. It asks for the server password once:

```bash
ssh root@81.19.137.7 'set -e; command -v zip >/dev/null || { apt-get update -qq && apt-get install -y -qq zip unzip; }; W=$(mktemp -d); cd "$W"; curl -fsSL -o src.zip https://codeload.github.com/thedevilhackers/torque-guide-telegram-bot/zip/refs/heads/claude/unity-performance-ai-vehicle-search-fw2o30; unzip -q src.zip; mv torque-guide-telegram-bot-* unity-performance; rm -f ~/unity-performance-vps.zip; zip -qr ~/unity-performance-vps.zip unity-performance; cd ~; rm -rf "$W"; sudo bash /opt/unity-performance/deploy/vps/update.sh ~/unity-performance-vps.zip'
```

The first time, type `yes` when asked whether to trust the server. Nothing appears on screen while you type the password; that's normal.

| The last message says | What it means | Next |
| --- | --- | --- |
| `Updated.` | Done. | Go to step 4. |
| `The new version failed its checks. Nothing was changed` | Your site is safe and still running the old version. | Send me the lines it printed. |
| `The new version didn't start … Went back to the previous version` | Your site is running the old version again. | Send me the lines it printed. |

### 3. Or: update from a zip on your Mac

If the server can't reach GitHub, save `unity-performance-vps.zip` in your **Downloads** folder (don't unzip it) and run this on your Mac instead. It asks for the password twice:

```bash
scp ~/Downloads/unity-performance-vps.zip root@81.19.137.7:~/ && ssh root@81.19.137.7 'sudo bash /opt/unity-performance/deploy/vps/update.sh ~/unity-performance-vps.zip'
```

### 4. Check the site

Open these in your browser. If something looks unchanged, press Cmd+Shift+R to reload without the cache.

- https://unityperformance.co: the home page, now with a **Tuning file service** section and a **File service** link in the menu.
- https://unityperformance.co/files: the tuning file service, with sign in and create account.
- https://unityperformance.co/admin: the admin panel now lists **File orders**, **Payments**, **Customers**, **Tune options** and **Credit packs**.

## Part 2: Set up the file service

In the admin panel:

1. **Settings → Shop**: set **Currency** to `INR`. UPI and online payments only work in rupees.
2. **Settings → File service**:
   - Tick **Take new file orders**.
   - Fill in **UPI ID for credit payments** (for example `yourname@okaxis`) and **UPI payee name**.
   - Tick **Alert me about new file orders and UPI payments**.
   - Press **Save settings**.
3. **Credit packs**: Single, Starter, Tuner and Workshop are ready, at 1, 2, 5 and 10 credits for ₹9,599 a credit. Change a price or untick **Sell on the file service** there.
4. **Tune options**: the tuning types and prices follow fast-chiptuningfiles.com's list (Stage 1 at 1 credit, Stage 2 at 1.20, Stage 3 at 3, back to stock at 0.20, and so on). Change a price, or untick **Offer on the file service** for anything you don't do.
5. **Settings → Telegram alerts**: if no chat is linked yet, press **Connect a Telegram chat** and open the link on your phone.

### Try it once yourself

1. In a private browser window (Cmd+Shift+N in Chrome), open https://unityperformance.co/files and create a test account.
2. In the admin panel, open **Customers**, choose the test account, and add `2` credits with the reason `Test`.
3. In the private window, open **New file**, upload any small file and place an order.
4. In the admin panel, open **File orders**, choose the order and press **Upload tuned file**.
5. In the private window, check that **Download tuned file** works.
6. Back in **File orders**, set the test order to **Rejected** (the credits go back). Then, in **Customers**, untick **Account switched on** for the test account.

### When a real order comes in

1. Telegram alerts you.
2. In **File orders**, download the original and upload it on fast-chiptuningfiles.com.
3. Type their order number into **Their order number** and save. The order shows **In progress** to the customer.
4. When their file comes back, press **Upload tuned file**. The customer can download it straight away. **Tell the customer on WhatsApp** writes the message for you.

When a customer pays by UPI, open **Payments**, check the money arrived in your bank or UPI app with the reference they gave, then press **Payment received**. That adds their credits.

## Part 3 (optional): online card and UPI payments with Razorpay

With Razorpay, customers pay on Razorpay's page and their credits are added automatically, with no checking by hand.

1. In your Razorpay Dashboard, open **API Keys** and generate a key. You get a **Key ID** (starting `rzp_live_`) and a **Key Secret**. Never send the secret in a chat, WhatsApp or email.
2. Connect to the server (`ssh root@81.19.137.7`) and open the settings file:

   ```bash
   sudo nano /etc/unity-performance/env
   ```

3. Use the arrow keys to go to the end of the file and add two lines with your values:

   ```
   RAZORPAY_KEY_ID=rzp_live_xxxxxxxx
   RAZORPAY_KEY_SECRET=your-key-secret
   ```

4. Save and close: press Ctrl+O, Enter, then Ctrl+X. Restart the site:

   ```bash
   sudo systemctl restart unity-performance
   ```

5. On https://unityperformance.co/files → **Credits**, each pack now has a **Card / UPI online** button. Test it once with your smallest pack.

## Part 4: Connecting fast-chiptuningfiles.com automatically

Files go to fast-chiptuningfiles.com by hand for now (see "When a real order comes in" above). Sending them automatically needs two things from fast-chiptuningfiles.com, and they go in two different places:

1. **The API documentation** (the page or PDF that lists their API addresses and how to send a file). Log in to your fast-chiptuningfiles.com account and look for **API**, or ask their support for reseller API access. Send the documentation to Claude, who writes the sending code into `src/providers/fast-chiptuningfiles.js`.
2. **Your API address and key.** These go only in the server's settings file, never in a chat, email or GitHub. Connect with `ssh root@81.19.137.7`, run `sudo nano /etc/unity-performance/env`, and add two lines at the end:

   ```
   FCF_API_URL=https://the-address-from-their-documentation
   FCF_API_KEY=your-key
   ```

   Save (Ctrl+O, Enter, Ctrl+X) and run `sudo systemctl restart unity-performance`.

Until both are done, each file order in the admin panel shows the steps for sending by hand.

## Part 5: Getting found on Google

The website now targets searches like "car tuning Ranchi", "ECU remapping Ranchi", "car tuning Kolkata" and "car tuning Shillong". To get the most from it:

1. **Add the owner's name.** In https://unityperformance.co/admin → **Settings → Business**, fill in **Owner / founder name** and **Owner's title** (for example "Founder & lead tuner") and save. It appears in the About section on the home page and is given to Google as the founder.
2. **Google Business Profile** (the most important step for "near me" and Maps searches). Go to https://business.google.com, add "Unity Motorsports Performance" as a car tuning / auto repair business at L-12, Argora Housing Colony, Ranchi 834002, with the website https://unityperformance.co, your phone number and opening hours. Google verifies it by phone, video or post.
3. **Google Search Console.** Go to https://search.google.com/search-console, add `unityperformance.co` (verify it with the DNS record it gives you), then under **Sitemaps** submit `https://unityperformance.co/sitemap.xml`. Google then reads the new pages within days instead of weeks.
4. **Reviews.** Ask each happy customer to leave a Google review on your Business Profile. Real reviews do more for local ranking than any keyword.
5. **Same details everywhere.** Use exactly the same name, address and phone number on Instagram, Facebook, JustDial and IndiaMART as on the website.
6. **Map pin.** In admin **Settings → Contact & location**, enter the workshop's latitude and longitude (from Google Maps: press and hold on the workshop, then copy the numbers).

## Part 6: The franchise page

https://unityperformance.co/franchise shows the two packages (Standard ₹9.99 lakh and Premium ₹15.99 lakh), what each includes, and an application form. Applications appear in admin under **Franchise**, with a Telegram alert.

- **Change a package** (price, what's included, name): Admin → **Franchise packages** → click the package. Prices are in rupees, so ₹9.99 lakh is `999000`.
- **Change the "Good to know" list** (training fee, agreement term): Admin → **Settings → Franchise**, one line per point.
- **Stop taking applications**: untick **Take franchise applications** in the same place.

The exit fee and blacklisting terms are not on the website; put them in the signed franchise agreement.

## Part 7: Offers, Refer & earn, mechanics and shop parts

**Offers** (unityperformance.co/offers and on the home page): change them in Admin → **Offers**. Leave the price empty to show no price, or 0 to show "Free".

**Refer & earn** (unityperformance.co/refer):
1. People sign up and get a code. Their link fills the code into the Stage 1 booking form for anyone who opens it.
2. A booking with a code appears in Admin → **Referrals** as "Waiting for tune".
3. When that car's tune is done and paid, set it to **Earned, to pay**.
4. Pay the person by UPI (their UPI ID is in Admin → **Refer & earn sign-ups**), then press **Mark … as paid**.
5. Change the reward (₹500) and the customer's discount (₹500) in Admin → **Settings → Refer & earn**.

**Mechanic network** (unityperformance.co/mechanics): mechanics sign up and you get a Telegram alert. Call them, then set them to **Listed** in Admin → **Mechanics** to show them on the website. Their phone numbers are never shown; customers book through your WhatsApp.

**Shop parts**: engine oils, filters, brake pads, a scanner, a battery charger and accessories are in Admin → **Products** at typical prices. Check each price and add your brands. The old sample products with dollar prices (₹350 voucher, ₹25 cap) are hidden; to sell one, set a rupee price and tick **Show in shop**.

## Part 8: The admin panel's power features

- **Give each partner their own login**: Admin → **Staff** → **Add staff member**. Choose **Manager** (can do almost everything, including deleting) or **Staff** (handles orders, enquiries, franchise applications and file orders). Only you, the owner, can see Staff, Settings and Backup. **Activity log** shows who did what.
- **Find anything fast**: press **Ctrl+K** (⌘K on a Mac) and type a name, phone number, order number or car.
- **Delete safely**: deleted things go to the **Recycle bin** for 30 days. Press **Undo** on the message straight after, or **Restore** in the Recycle bin.
- **Change many at once**: tick the boxes on the left of a list, then set a status, show or hide, or delete.
- **Export to Excel**: **Export CSV** on any list.
- **Backups happen by themselves** every day on the server. Admin → **Backup** lists them, with Download and Restore.
- **Working on the site?** Settings → **Maintenance mode** shows visitors a short notice while you're signed in and can still see everything.

## Everyday commands (on the server)

| What | Command |
| --- | --- |
| Update to the newest version | the one command in Part 1, step 2 (run on your Mac) |
| Is the site running? | `systemctl status unity-performance` (press `q` to leave) |
| Recent messages and errors | `sudo journalctl -u unity-performance -n 50` |
| Restart the site | `sudo systemctl restart unity-performance` |
| Change keys or the admin password | `sudo nano /etc/unity-performance/env`, then restart |
| Daily backups | in `/var/backups/unity-performance` (the last 14 days) |

Uploaded ECU files are stored on the server in `/var/lib/unity-performance/ecu-files` and are part of the daily backup. Copy a backup to your computer now and then:

```bash
scp 'root@81.19.137.7:/var/backups/unity-performance/*.tar.gz' ~/Downloads/
```

Run that on your Mac, not on the server. Keep the quotes: without them the Mac's Terminal tries to read the `*` itself.

## Installing on a brand-new server

Only needed if you move to another VPS (Ubuntu 22.04 or 24.04, or Debian 12):

1. At your domain provider, point the **A** records for `unityperformance.co` and `www` to the new server's IP address.
2. On your Mac, send the zip: `scp ~/Downloads/unity-performance-vps.zip root@NEW_SERVER_IP:~/`
3. On the new server:

   ```bash
   sudo apt-get update && sudo apt-get install -y unzip
   sudo unzip -q ~/unity-performance-vps.zip -d /opt
   sudo bash /opt/unity-performance/deploy/vps/install.sh unityperformance.co
   ```

   Answer its questions: WhatsApp number, Telegram bot token, OpenAI key and admin password. Press Enter to have a password created, and save the one it prints.
4. Bring all your data over (settings, orders, customers, credits, photos and ECU files). On the **old** server:

   ```bash
   sudo systemctl stop unity-performance
   sudo tar -czf ~/unity-data.tar.gz -C /var/lib/unity-performance .
   ```

   On your Mac, copy it from the old server to the new one:

   ```bash
   scp root@OLD_SERVER_IP:unity-data.tar.gz ~/Downloads/
   scp ~/Downloads/unity-data.tar.gz root@NEW_SERVER_IP:~/
   ```

   On the **new** server:

   ```bash
   sudo systemctl stop unity-performance
   sudo tar -xzf ~/unity-data.tar.gz -C /var/lib/unity-performance
   sudo chown -R unity:unity /var/lib/unity-performance
   sudo systemctl start unity-performance
   ```

5. Leave the old server's copy stopped (step 4 stopped it), so only one Telegram bot runs.

## Trying it on your Mac first (optional)

1. Install Node.js 22 (LTS) from https://nodejs.org.
2. Unzip `unity-performance-vps.zip`, then in Terminal:

   ```bash
   cd ~/Downloads/unity-performance
   cp .env.example .env
   ```

3. Open `.env` in TextEdit and set `ADMIN_PASSWORD=` to a password of at least 10 characters. Leave `TELEGRAM_BOT_TOKEN` empty, so it doesn't compete with the bot on your server.
4. Run `npm test`, then `npm start`. Open http://localhost:3000 and http://localhost:3000/admin (username `admin`). Press Ctrl+C in Terminal to stop it.

More detail on every part is in `README.md`.
