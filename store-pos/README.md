# Store POS — multi-branch billing, barcode stock & expiry tracking

A web-based point of sale and inventory system for convenience stores and mini-marts, built to run many branches from one head office and to be controlled by your existing admin panel through an API.

It runs in any modern browser (PC, tablet or phone). There is nothing to install on the tills.

## What it does

**Selling (till)**
- Scan with any USB/Bluetooth barcode scanner (works anywhere on the screen) or the device camera
- Search by name, PLU or SKU; quick-key buttons for coffee, hot food and other items without barcodes
- Weighed items: type the weight, or scan the scale's price/weight label (EAN-13 prefix 21/22)
- Case barcodes: scanning a carton adds the whole pack (e.g. 24 cans)
- Automatic promotions: % off, amount off, buy N get M free, N for a fixed price — by product, category or the whole store, per branch, with start/end dates
- Line and bill discounts, price overrides, refunds, selling expired stock and age-restricted items (alcohol/tobacco) are controlled: cashiers need a **manager PIN** on screen
- Split payments (cash, card, UPI/QR, e-wallet, loyalty points), quick cash buttons and change calculation
- Hold and recall sales, price check, customer loyalty points that work at every branch
- 80 mm / 58 mm receipts with a scannable receipt barcode (scan it later to find the sale for a refund)
- Repeat-safe checkout: a network retry never charges a customer twice

**Stock**
- Goods-in by scanning: quantity, **expiry date**, batch/lot, cost and new selling price per line; unknown barcodes can be created on the spot
- **Expiry read from the barcode** when the item has a GS1 2D code (DataMatrix or QR) or the carton has a GS1-128 label: expiry date, batch and carton count fill in by themselves, repeat scans of the same serial number are ignored, and expired packs are refused. Ordinary EAN-13/UPC barcodes don't contain a date, so for those you type or pick the date
- At the till, a pack whose own barcode says it has expired is flagged; a cashier needs a manager PIN to sell it
- **Expiry-date labels** for everything else: after posting a delivery (or from *Recent receipts*, or *Date labels* on any batch in Inventory) print small labels with the expiry date and a GS1-128 barcode holding the product number and that date. Stick each label over the item's own barcode; the till then reads the date from it like a 2D code. Any scanner can read these labels, including cheap 1D laser scanners and phone cameras
- Every delivery becomes a batch. Sales use the batch that **expires first (FEFO)**, so expiry alerts and cost of goods are accurate
- Expiry alerts (per-product warning window), expired-stock blocking at the till, one-click write-off of expired stock
- Low-stock alerts and a **reorder list** worked out from 14 days of sales and supplier lead time
- Adjustments with reasons (damaged, theft, found…), stock counts with variance, transfers between branches (expiry dates travel with the stock)
- Barcode/shelf label printing (A4 sheets or label rolls), in-store barcodes for products without one

**Cash & reporting**
- Shifts: opening float, cash in/out, counted cash at close with over/short
- Daily summary (Z report) per branch or **all branches together**: net sales, tax, discounts, refunds, cost, gross profit and margin, average basket, payments by method, categories, top products, sales by hour, cashiers, stock received / written off / adjusted, shift variances
- 14-day trend, stock valuation, CSV exports for sales and stock

**Head office & admin panel control**
- Branches with their own time zone, prices and staff; owners see everything, managers and cashiers only their branch
- Lock a branch remotely (selling stops immediately with your message on screen)
- Chain price plus optional per-branch price, per-branch on/off for each product
- REST API with API keys (head-office or single-branch scope) and signed webhooks: sales, refunds, low stock, expiring stock, shift close and the nightly daily summary pushed to your panel. See **[docs/API.md](docs/API.md)**
- Activity log of sign-ins, approvals, refunds and changes

## Run it

You need **Node.js 22.13 or newer**. There are no npm packages to install — the database (SQLite) is built into Node.

```bash
cd store-pos
npm start
```

Open <http://localhost:3000>. The first screen sets up your store, first branch and owner account. Tick **Load demo data** to get sample products, a second branch, demo staff and two weeks of sales to try everything; don't tick it for your real store.

Keep the terminal window open while you use it; closing it (or pressing Ctrl+C) stops the server.

### If it doesn't start

| What you see | What to do |
|---|---|
| `Store POS needs Node.js 22.13 or newer` | Install the current LTS version from [nodejs.org](https://nodejs.org), close and reopen the terminal, run `npm start` again |
| `npm: command not found` or `'npm' is not recognized` | Node.js isn't installed, or the terminal was opened before installing it. Install it, then open a new terminal |
| `Missing script: "start"` or `Could not read package.json` | You're not in the `store-pos` folder. Run `cd store-pos` first |
| `Port 3000 is already in use` | It's probably already running in another window: just open <http://localhost:3000>. Or use another port by putting `PORT=3001` in a file named `.env` in the `store-pos` folder |
| The browser says the site can't be reached | Check the terminal still says *Store POS … is running*. `localhost` only works on the computer running it; other devices on your Wi‑Fi use `http://<that computer's IP>:3000` (allow Node.js through the firewall if asked) |

```bash
npm test
```

runs the automated checks (pricing, stock, refunds, permissions, API keys, webhooks).

### Settings (environment variables)

Copy `.env.example` to `.env`, or set these on your host:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Web port |
| `DATABASE_PATH` | `data/store.db` | Where the database file lives. Put it on a persistent disk |
| `CORS_ORIGINS` | *(none)* | Comma-separated origins allowed to call the API from a browser, e.g. your admin panel |
| `FRAME_ANCESTORS` | `'self'` | Allow your admin panel to show these screens in an iframe, e.g. `'self' https://admin.example.com` |
| `LOG_REQUESTS` | — | `1` to log every API request |

## Hardware

- **Barcode scanners:** any USB or Bluetooth scanner in keyboard mode with an *Enter* suffix (the factory default on most). No driver or setting in this app. To read expiry dates from **2D codes (DataMatrix/QR)** you need a **2D (imager) scanner**; a 1D laser scanner reads only the lines. Phone and tablet cameras read 2D codes too.
- **Camera scanning:** phones, tablets and webcams. Browsers only allow the camera over **HTTPS** (or on `localhost`), so host it with HTTPS.
- **Label printers:** any thermal label printer installed in the operating system, with 50 × 30 mm labels (or print A4 sheets of 3 across on a normal printer). Set the printer's paper size to 50 × 30 mm and margins to none.
- **Receipt printers:** any 80 mm or 58 mm thermal printer installed in the operating system. Receipts print through the browser's print dialog; for silent one-click printing use the browser's kiosk printing mode (Chrome: `--kiosk-printing`). Turn on "Print receipts automatically" on the sale-complete screen.
- **Weighing scales:** set the scale to print EAN-13 labels with prefix `21` (weight in grams) or `22` (price) followed by the product's 5-digit PLU. Change the rules in Admin → Settings.

## Daily routine

1. **Open shift** with the cash in the drawer.
2. **Sell.** Scan, take payment, hand over the receipt.
3. **Receive deliveries** by scanning each item and entering its expiry date.
4. Check **Dashboard → Stock alerts**: pull expired items and write them off; reorder low stock.
5. **Close shift**: count the drawer. Print the Z report from Reports.

## Hosting for many branches

All branches use **one central server**: every till is just a browser pointed at it. Host it on a small cloud server with HTTPS and a persistent disk.

- **Render:** `store-pos/render.yaml` defines a web service with a 1 GB disk. In Render, create a **Blueprint**, pick this repository and set the blueprint path to `store-pos/render.yaml`. Persistent disks need a paid instance; review the plan and price Render shows before creating it.
- **Any Linux server/VPS:** install Node 22, copy the `store-pos` folder, run `npm start` under a process manager (systemd or pm2) behind a reverse proxy with HTTPS (Caddy or Nginx).

**Back up the database** (`DATABASE_PATH`) every day. While the server runs, make a consistent copy with `sqlite3 store.db ".backup backup.db"`.

Before going live: delete or change the demo staff accounts, give every manager their own PIN, and keep API keys in your admin panel's secret settings only.

## Connecting your restaurant admin panel

1. Admin → **Admin panel / API** → *New API key* (scope: all branches).
2. In your panel, call the API with `Authorization: Bearer <key>`: create branches, push the product list with `PUT /api/products/bulk`, read `GET /api/hq/overview` and `GET /api/reports/daily?branch_id=all`, lock/unlock branches.
3. Add a webhook pointing to your panel to receive `sale.completed`, `stock.low`, `stock.expiring`, `daily.summary` and other events as they happen.
4. Put your panel's restaurant/outlet id in each branch's **External ID** and your item ids in each product's `external_id`, so records match without a mapping table.

Full reference with examples and signature verification: **[docs/API.md](docs/API.md)**.

## Project layout

```
store-pos/
  src/          server: HTTP API, database, stock (FEFO), sales, reports, webhooks, scheduler
  shared/       pricing engine used by both the browser and the server
  public/       the web app (no build step), vendored camera-scanner library
  checks/       automated tests (npm test)
  docs/API.md   integration guide for your admin panel
```

## Known limits

- **Internet needed at the till.** Tills talk to the central server; if a branch loses its connection it cannot sell until it is back. An offline queue for tills is a sensible next step.
- **Card/UPI terminals are not integrated.** The cashier takes payment on the terminal and records it here (with an optional reference).
- **Tax** is a single rate per product (GST/VAT style). E-invoicing and country-specific tax reports are not included.
- **One server.** The SQLite database suits a chain of stores on one server. For very high volume, move to a managed database.
