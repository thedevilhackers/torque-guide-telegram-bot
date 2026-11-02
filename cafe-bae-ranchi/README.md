# Cafe BAE Ranchi website

A dynamic website for Cafe BAE, Hazaribagh Road, Lalpur, Ranchi. Guests can browse a live menu, order from their table or for pickup and follow the order live, book a table with real-time availability, plan parties and leave reviews. Staff get a dashboard at `/admin` to run it all.

It is a plain Node.js app with **no dependencies**: no `npm install`, no build step, no database server.

## What's included

**For guests**

- Live open/closed badge in Indian Standard Time ("Open now · until 10:00 PM").
- Menu with search, a veg-only switch, FSSAI-style veg/non-veg marks, bestseller and spicy tags, and sold-out states that update while the page is open.
- **Scan and order at the table:** a QR code linking to `https://your-site/?table=12` opens the site in table mode, so orders go to the kitchen marked for table 12.
- Pickup ordering with a cart that survives page reloads. Prices and 5% GST are always calculated on the server.
- **Live order tracking** (Received → Preparing → Ready → Enjoy) pushed instantly from the kitchen using Server-Sent Events.
- "Send this order on WhatsApp" as an alternative.
- Table booking with a 14-day date strip, a guest counter and live slot availability. Full slots are blocked and a booking code is issued.
- Party and event enquiry form, guest reviews (shown only after staff approval) and newsletter sign-up.
- Opening hours with today highlighted, a map, directions, and the three spaces: Cafe BAE Lalpur, Yaarana Rooftop and YELLOW by Cafe BAE.
- SEO: server-rendered title and description, Open Graph share image, `CafeOrCoffeeShop` structured data including the full menu, `robots.txt` and `sitemap.xml`.
- Responsive from 320px phones to wide desktops, keyboard accessible, and honours "reduce motion".

**For staff (`/admin`)**

- Overview: orders and revenue today, kitchen queue, today's bookings.
- Live order board (New / Preparing / Ready) that chimes when an order arrives.
- Bookings: confirm, seat, cancel or mark no-show, with a one-tap WhatsApp confirmation message.
- Menu: change prices, mark items sold out, set bestsellers, and add or delete items. Changes go live immediately.
- Review moderation, party enquiries, newsletter subscribers with CSV export.
- Settings: announcement bar, opening hours, a "Pause online orders" switch for busy times, and table QR links.

## Run it locally

You need Node.js 20 or newer.

```bash
cd cafe-bae-ranchi
cp .env.example .env
```

Put a long random value in `ADMIN_TOKEN` in `.env`. One way to generate it:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

Then start the site:

```bash
npm start
```

Open http://localhost:3000 for the website and http://localhost:3000/admin for the dashboard. If `ADMIN_TOKEN` is not set, a temporary token is printed in the terminal.

Run the tests:

```bash
npm test
```

## Before you go live

Some details came from public listings and some are placeholders. Check each one:

1. **Opening hours.** Listings disagree: one says 8 AM to 10 PM, another says 10 AM to 10 PM. The site uses 10 AM to 10 PM. Change them in **Admin → Settings**.
2. **Menu and prices.** `data/menu.json` is a sample menu written for the launch. Replace it with the real menu, either by editing the file before the first run or from **Admin → Menu**.
3. **Photos.** Each item and category has an illustrated tile. To use real photos, put them in `public/images/` and set an item's photo link to `/images/oreo-shake.jpg` (or any `https://` image link) in **Admin → Menu**.
4. **Contact details.** Phone, WhatsApp, address and outlets are in `data/site.json`. Add `email` and `instagram` if you want them shown.
5. **Table QR codes.** Print one per table pointing to `https://your-domain/?table=<number>`. The links are listed in **Admin → Settings**.
6. **Privacy.** The site stores guest names and phone numbers for orders and bookings. Add a privacy notice that matches how you use them.

Files in `data/` are only the starting point. On first run they are copied to the storage folder (`DATA_DIR`), and from then on the admin dashboard edits that copy.

## Deploy (Render example)

1. Create a **Web Service** from this repository.
2. Set **Root Directory** to `cafe-bae-ranchi`, **Build Command** to `npm install` and **Start Command** to `npm start`.
3. Add environment variables: `ADMIN_TOKEN` (your secret) and `TRUST_PROXY=1`.
4. Orders, bookings and menu edits are saved as JSON files. Attach a **persistent disk** (for example mounted at `/var/data`) and set `DATA_DIR=/var/data`. Without a disk, that data is wiped on every redeploy. Persistent disks need a paid Render plan, so review the price before you add one.
5. Point your domain (for example `www.cafebae.in`) at the service and make sure `website` in `data/site.json` matches it, because it is used for share previews and the sitemap.

Any host that runs Node.js 20 works the same way (Railway, Fly.io, a VPS with Nginx). Run a **single instance**: the file-based storage is not designed for several servers at once. Move to a database before scaling out.

## Project layout

```
cafe-bae-ranchi/
├── server.js            Entry point: reads .env, starts the server
├── src/
│   ├── app.js           Routes, API, admin, live order stream, page rendering
│   ├── store.js         JSON file storage with atomic writes
│   ├── time.js          IST opening hours and booking slots
│   ├── validate.js      Form validation
│   └── http.js          Security headers, JSON body parsing, rate limiting
├── data/                Starting content: site details and menu
├── public/              Website, admin dashboard, styles, scripts, icons
└── test/api.test.js     End-to-end API tests
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/site` | Cafe details, open status, hours, ordering status |
| GET | `/api/menu` | Categories and items |
| POST | `/api/orders` | Place an order (prices are recalculated on the server) |
| GET | `/api/orders/:id` | Order status |
| GET | `/api/orders/:id/events` | Live order status (Server-Sent Events) |
| GET | `/api/availability?date=YYYY-MM-DD` | Booking slots and seats left |
| POST | `/api/reservations` | Request a table |
| GET / POST | `/api/reviews` | Approved reviews / submit a review |
| POST | `/api/enquiries` | Party or event enquiry |
| POST | `/api/subscribe` | Newsletter sign-up |
| * | `/api/admin/*` | Staff endpoints, require `Authorization: Bearer <ADMIN_TOKEN>` |

## Security notes

- Strict Content Security Policy (no inline scripts), `nosniff`, referrer policy and HSTS behind HTTPS.
- All guest text is inserted with `textContent`, never as HTML.
- Per-visitor rate limits on every public form, a hidden honeypot field against bots, and a 15-minute lockout after 10 wrong admin tokens.
- Admin token comparison is constant-time. The admin page is excluded from search engines.
