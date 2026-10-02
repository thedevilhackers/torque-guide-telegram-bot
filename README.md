# Unity Performance: website, shop, admin panel and Telegram bot

One Node.js app runs four things that share one database:

- **Website** (`/`): an Apple-style, scroll-animated site. It has a live "Find your car" search with interactive Stage 1 power and torque charts, Stage 1 booking, services, an "Our work" photo gallery, supported ECUs and a visit section.
- **Tool support** (`/tools`): customers search their car to see its usual ECU and how Autotuner and KESS3 read it (OBD, bench or boot), with the full support list by ECU family.
- **Shop** (`/shop`): products with categories, search and sorting, a bag and checkout. Orders are saved, and the customer sends the order to you on WhatsApp in one tap.
- **Admin panel** (`/admin`): full access to orders, enquiries, products (with photo upload), the Stage 1 vehicle database, ECUs, brands, services, gallery photos, site settings and backups.
- **Telegram bot**: vehicle search, Stage 1, 2 and 3 graphs, location, ECU check and a WhatsApp summary. Every customer who reaches the summary appears under Admin → Enquiries.
- **Instant alerts**: the bot messages you on Telegram the moment an order or enquiry arrives.

It has no npm dependencies. The Stage 1 graphs are drawn in plain JavaScript, so there's nothing native to install.

## What customers see

**Website.** The hero and the "Read. Calibrate. Verify." story animate as you scroll, with a live power counter and a curve that draws itself. **Find your car** searches the database as you type, or browses by brand. It shows Stage 1 figures and an interactive chart, where you hover or use the arrow keys to read values; power and torque are separate panels on a shared rpm axis, and there's also a table view. A **Stage 1 / 2 / 3** switch shows each stage's figures, chart, the hardware it needs and a downloadable power graph. **Book Stage 1** saves an enquiry and hands it to WhatsApp. If a car isn't listed and AI is on, "Ask AI to identify it" estimates it; the estimate is clearly labelled and kept within your gain limits.

**Tool support.** A separate page, linked from the menu on every page and from each car in Find your car. Search a car to see its usual ECU, whether you tune it, and how Autotuner and KESS3 read it: OBD (through the diagnostic port), bench or boot. Below it, the whole support list by ECU family, filtered by petrol or diesel. Cars without a known ECU ask for a photo of the ECU label on WhatsApp. The bot has the same check under **Can you read my car?** (or `/read`).

**ECU label photo (AI).** Customers send a photo of the sticker on their ECU, to the bot (any photo, or **📷 ECU label photo** / `/label`) or on the Tool support page. The AI copies the ECU type and its hardware, software and part numbers (it leaves out anything it can't read rather than guess), works out the car where it can, and the reply shows how Autotuner and KESS3 read that ECU, whether you tune it, and buttons for the matching car's Stage 1 gains. If the car isn't clear it asks which car it is and searches for the answer. In the bot, the ECU from the label is kept for the enquiry, and the label details go into the WhatsApp message and Admin → Enquiries. It needs `OPENAI_API_KEY` and a model that accepts images (the default does); website photos are resized in the browser and limited per address.

The page also searches **Autotuner's compatibility list** by ECU, car brand or chip (e.g. `EDC17C57`, `MG1`, `Hyundai`), showing how Autotuner reads each ECU: OBD, bench, boot, beta and unlock. Typing an ECU name into the bot's read check searches it too. The list lives in `src/data/autotuner-compatibility.json` (2,254 ECUs, exported 2 October 2026 from autotuner.com). Autotuner updates often, so customers are pointed to autotuner.com to confirm, and to Alientech's own KESS3 vehicle list for KESS3.

**Our work.** A sideways-scrolling gallery of your builds, newest first. It starts with four pictures from the workshop's Instagram; each opens the post you link it to, or your Instagram page. A **Follow** button and an Instagram icon in the menu bar link to your Instagram on every page.

**Shop.** Customers add items to the bag and choose collection or delivery. They get an order number (UP-1001, UP-1002, …) and a **Send order on WhatsApp** button with the order already written. Prices and stock always come from the server, and stock goes down when an order is placed.

There are no card payments: customers pay on collection or delivery once you confirm on WhatsApp. An online payment gateway (for example Stripe or PayHere) can be added later.

**Telegram bot.** Customers find their vehicle and get the Stage 1 graph, with buttons for the Stage 2 and 3 graphs. Then they add their location and check their ECU. Finally they send the full details to you on WhatsApp. The enquiry is for the last stage they looked at. The main menu also links to WhatsApp and your Instagram.

**Sharing and search.** Links to the site shared on WhatsApp, Instagram or Facebook show a preview with your banner. Pages carry your business details for search engines, along with `robots.txt` and `sitemap.xml`; the admin panel stays out of search results.

## Instant alerts

1. In **Admin → Settings → Telegram alerts**, press **Connect a Telegram chat**.
2. Open the link on the phone that should get alerts and press **Start** (or send the bot the `/alerts CODE` message shown). The link works once and expires after 15 minutes.
3. Press **Send test alert** to check it. You can connect several people, and remove any of them from the same card.

Each new order, website enquiry and Telegram enquiry then arrives as a message showing the customer, vehicle, stage, figures, ECU and location. It has buttons to WhatsApp the customer (or message them on Telegram) and to open the record in the admin panel. The admin-panel button needs your public https address: Render provides it automatically; elsewhere, set **Website address** in Settings. Switch order or enquiry alerts off under **Alert settings**, and send `/stopalerts` to the bot to stop alerts on a phone. Alerts need `TELEGRAM_BOT_TOKEN`.

## Quick start

```bash
cp .env.example .env      # then set ADMIN_PASSWORD (10+ characters) at least
npm test
npm start
```

Open http://localhost:3000 for the site and http://localhost:3000/admin for the admin panel. Sign in with `ADMIN_USERNAME` (default `admin`) and `ADMIN_PASSWORD`.

| Setting | Required | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | For the admin panel | At least 10 characters. The panel stays locked without it. |
| `ADMIN_USERNAME` | No | Defaults to `admin`. |
| `TELEGRAM_BOT_TOKEN` | For the bot | From [@BotFather](https://t.me/BotFather). Without it the website runs and the bot is off. |
| `OPENAI_API_KEY` | No | Turns on AI vehicle search (website and bot), AI Stage 1 reports and the bot's Ask AI. |
| `OPENAI_MODEL` | No | Defaults to `gpt-5.6-terra`. |
| `AI_DAILY_LIMIT` | No | Most AI requests a day across all customers (default 400). Each customer also gets 20 an hour; past either limit the bot uses its built-in answers. |
| `BUSINESS_NAME`, `WHATSAPP_NUMBER`, `WORKSHOP_ADDRESS`, `WORKSHOP_LATITUDE`, `WORKSHOP_LONGITUDE` | No | Starting values for your business details. After the first run, manage them in **Admin → Settings**; empty settings fall back to these. |
| `DATA_DIR` | No | Where the database and uploads live (default `./data`). |
| `PORT` | No | Web port (default 3000). |

## Admin panel

- **Dashboard**: revenue and orders for the last 30 days, open orders, new enquiries, a 14-day revenue chart, low stock, and recent orders and enquiries.
- **Orders**: filter, search, change status (New → Confirmed → Ready → Completed) and keep private notes. You can call or WhatsApp the customer from the order. **Cancelling an order returns its items to stock**; reopening takes them out again.
- **Enquiries**: Stage 1 requests from the website and the Telegram bot, with vehicle, figures, ECU and location, plus status and notes.
- **Products**: name, category, price, compare-at (offer) price, stock (empty = unlimited), description, features, photo, featured, and shown/hidden.
- **Vehicles**: the Stage 1, 2 and 3 database used by the website, the bot and the graphs, with a graph preview for each stage. Stage 2 and 3 are optional per vehicle. Validation keeps the figures realistic (Stage 1 at least 3% above stock, each later stage at least 2% above the one before, torque between 0.8× and 3.5× the power), so every graph is exact. Stage 3 graphs build peak torque a little later, like a bigger turbo.
- **ECUs, Brands, Services**: the ECU support list (including how Autotuner and KESS3 read each ECU family), brands and search aliases, and the service cards. The tool support that ships with the site is typical for each ECU family; adjust it to what you see on your own tools.
- **Photos**: the Our work gallery. Upload a photo, add a caption and, optionally, the link to its Instagram post. New photos go first; untick **Show on the website** to hide one. The website shows the newest 24.
- **Settings**: business name, headline, hero photo, announcement bar, contact details, WhatsApp number, map location, opening hours, currency, delivery fee, social links, the Stage 2 and 3 descriptions, and Telegram alerts.
- **Backup**: download everything as one JSON file, or restore a backup. Uploaded photos are separate files in `DATA_DIR/uploads`.

**The included vehicles, Stage 1, 2 and 3 figures, ECU statuses and products are sample data.** Replace them with your own figures, ECU statuses, prices and photos before launch.

## Security

- The admin session is an HttpOnly, SameSite=Strict cookie. Every change must come from the admin panel itself (custom header plus same-origin check), and failed sign-ins are limited to 5 per 15 minutes per address.
- Public order and enquiry forms accept JSON from this site only. Each address can place 5 orders and 10 enquiries an hour, and an order can hold up to 20 of each item, because an order holds stock as soon as it is placed.
- Power graph images are drawn once and reused, and each address can request 60 a minute, so a burst of requests can't stall the site.
- AI requests are limited to 20 an hour per customer and `AI_DAILY_LIMIT` (default 400) a day in total; Stage 1 reports for a car are reused for a week. Past a limit, the bot uses its built-in answers.
- A Telegram chat raises at most 5 new enquiries (and alerts) a day; after that its latest enquiry is updated.
- Backups are checked with the same rules as the admin forms before they replace anything.
- Uploads are checked to be real PNG, JPEG or WebP files, saved under random names, and served with a strict content type.
- Every page is sent with a strict Content Security Policy, all customer-entered text is inserted as text, never as HTML, and links that would run script are dropped.

## Host it on your own VPS

Any VPS running Ubuntu 22.04 or 24.04, or Debian 12, works; 1 vCPU and 1 GB of memory is plenty. `deploy/vps/install.sh` sets up:

- Node.js 22, with the app as a systemd service that restarts on failure and starts on boot. It listens only on `127.0.0.1`, behind Caddy.
- [Caddy](https://caddyserver.com/docs/install#debian-ubuntu-raspbian) for HTTPS, with certificates issued and renewed automatically.
- A firewall that leaves only SSH, HTTP and HTTPS open.
- A daily backup of all data, keeping the last 14 days.

1. Add a DNS **A** record pointing your domain (e.g. `shop.example.com`) to the VPS's IP address. For a main domain, add one for `www` too: once both point at the server, the installer sets up `www.` as well and sends it to the main address.
2. Put the code in `/opt/unity-performance`, either from a zip or with git.

   **From a zip (simplest).** Upload `unity-performance-vps.zip` to the server. From a Mac or Linux terminal, or Windows PowerShell, use the command below; WinSCP or FileZilla over SFTP also work. Use the username your provider gave you, e.g. `root` or `ubuntu`.

   ```bash
   scp unity-performance-vps.zip root@YOUR_SERVER_IP:~/
   ```

   Then, on the server:

   ```bash
   sudo apt-get update && sudo apt-get install -y unzip
   sudo unzip -q ~/unity-performance-vps.zip -d /opt
   ```

   **With git (updates with one command).** Connect with SSH. For a private repository, give the server a read-only deploy key:

   ```bash
   sudo apt-get update && sudo apt-get install -y git
   sudo ssh-keygen -t ed25519 -N "" -C unity-vps -f /root/.ssh/unity_deploy
   sudo cat /root/.ssh/unity_deploy.pub
   ```

   In GitHub, open the repository → **Settings → Deploy keys → Add deploy key**, paste the key and leave write access off. Then:

   ```bash
   sudo git -c core.sshCommand="ssh -i /root/.ssh/unity_deploy" clone -b claude/unity-performance-ai-vehicle-search-fw2o30 git@github.com:thedevilhackers/torque-guide-telegram-bot.git /opt/unity-performance
   sudo git -C /opt/unity-performance config core.sshCommand "ssh -i /root/.ssh/unity_deploy"
   ```

   Type `yes` if asked to trust github.com. For a public repository, `sudo git clone -b claude/unity-performance-ai-vehicle-search-fw2o30 https://github.com/thedevilhackers/torque-guide-telegram-bot.git /opt/unity-performance` is enough. Once this branch is merged, use `main` instead.
3. Run the installer with your domain:

   ```bash
   sudo bash /opt/unity-performance/deploy/vps/install.sh shop.example.com
   ```

   It asks for the WhatsApp number, Telegram bot token, OpenAI key and admin password (press Enter to have one created), checks the app on the server, starts it, and prints the addresses. Without a domain it serves plain HTTP on the server's IP, which is fine for a first look but sends the admin password unencrypted.
4. Stop any other copy that uses the same Telegram token (Render, your computer): only one copy can run the bot.

Day to day:

- **Update**: with git, `sudo bash /opt/unity-performance/deploy/vps/update.sh`. With a zip, upload the new zip and run `sudo bash /opt/unity-performance/deploy/vps/update.sh ~/unity-performance-vps.zip`. Either way it checks the new version in a separate copy first, switches only if the checks pass, and goes back to the previous version if the new one doesn't start. Your settings and data live outside the code folder, so updates never touch them.
- **Switch back to the IP address** (for example after trying a domain that isn't ready): `sudo bash /opt/unity-performance/deploy/vps/install.sh --ip`. Run without a domain, the installer keeps the domain from last time only if it points at the server.
- **Change keys or the admin password**: `sudo nano /etc/unity-performance/env`, then `sudo systemctl restart unity-performance`.
- **Logs and status**: `sudo journalctl -u unity-performance -f` and `systemctl status unity-performance`.
- **Backups**: `/var/backups/unity-performance`. Copy them off the server now and then, or turn on your provider's snapshots, because a backup on the same server is lost with it. To restore one:

  ```bash
  sudo systemctl stop unity-performance
  sudo tar -xzf /var/backups/unity-performance/unity-performance-YYYY-MM-DD.tar.gz -C /var/lib/unity-performance
  sudo chown -R unity:unity /var/lib/unity-performance
  sudo systemctl start unity-performance
  ```

- **Moving from another copy**: on the old copy, **Admin → Backup → Download backup**; on the new one, **Admin → Backup → Restore** with that file. That moves everything except uploaded photos. To bring the photos too, restore the old copy's whole data folder the same way as a backup.

## Host it on Render (24/7)

`render.yaml` defines a single **web service** with a 1 GB **persistent disk** mounted at `/var/data` (`DATA_DIR`). The disk lets orders, products, settings and uploads survive redeploys.

1. Put this project in a private GitHub repository. Do not upload `.env`.
2. In [Render](https://dashboard.render.com/), create a **Blueprint** from the repository.
3. Enter `ADMIN_PASSWORD`, `TELEGRAM_BOT_TOKEN`, `OPENAI_API_KEY` and `WHATSAPP_NUMBER` in Render's secret fields.
4. Deploy. The log shows `Unity Performance website is running…` and, with a token, the bot line. Your site is at the `onrender.com` address Render shows, and you can add your own domain in Render's settings.
5. Telegram allows only one process to read a bot's messages. Stop any local `npm start` that uses the same token. If you created the earlier background-worker version of this bot on Render, delete that service.

Web services with disks need a paid instance type (the blueprint uses Starter). Check the price Render shows before creating it. Keep one instance, because the database is a file on the disk.

## Customise

- **Content and catalogue**: use the admin panel. The first-run defaults live in `src/seed-data.js`.
- **Look**: `public/css/site.css` (colour tokens at the top) and `public/admin/admin.css`.
- **Telegram PNG graph**: `THEME` in `src/dyno-chart.js`.
- **AI gain limits**: `STAGE1_GAINS` in `src/vehicles.js`.

## Brand

The logo and icons were cut from the Unity Motorsports Performance banner; the original banner and poster are in `brand/source/`. The logo is chrome and red artwork with a transparent background, made for dark backgrounds, which is why the header stays dark on every page.

- `public/brand/logo.webp`: the site header and the home page. `public/brand/logo.png`: the top of every power graph image. `public/brand/share.jpg`: the picture shown when someone shares a link to the site.
- `public/brand/icon-32.png` and `public/brand/apple-touch-icon.png`: the browser tab, phone home screen and admin panel.
- `brand/logo-transparent.png` and `brand/turbo-symbol-transparent.png`: for print and social posts.
- Telegram pictures, set in [@BotFather](https://t.me/BotFather) under `/mybots` → your bot → **Edit Bot**:
  - **Edit Botpic**: send `brand/telegram-profile-photo.png`.
  - **Edit Description Picture**: send `brand/telegram-description-picture.png` (640×360, shown before a customer presses Start).

To change the logo later, replace `public/brand/logo.webp` and `public/brand/logo.png` with new files of the same names.

## Project layout

```
src/server.js           starts the website + bot
src/web/                HTTP router, public API, admin API, auth
src/db.js               JSON database (DATA_DIR/db.json)
src/seed-data.js        first-run vehicles, ECUs, brands, services, products, settings
src/records.js          orders and enquiries
src/alerts.js           Telegram alerts: link codes, alert chats, messages
src/validation.js       admin input validation
src/conversation.js     Telegram conversation flow
src/dyno-chart.js       Stage 1 curves + PNG graph
public/                 website, shop and admin panel (no build step)
public/brand/           logo, icons and link-preview picture used by the site and the power graphs
deploy/vps/             VPS installer and updater (systemd, Caddy, firewall, backups)
brand/                  brand kit: originals, transparent logo, Telegram pictures
test/                   node --test suites
```

## Official references

- [Telegram: creating a bot with BotFather](https://core.telegram.org/bots/tutorial)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Render Blueprints](https://render.com/docs/blueprint-spec) and [persistent disks](https://render.com/docs/disks)
- [OpenAI API keys](https://platform.openai.com/api-keys)
