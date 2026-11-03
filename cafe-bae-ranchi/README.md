# Cafe BAE Ranchi website

A dynamic website for Cafe BAE, Hazaribagh Road, Lalpur, Ranchi. Guests can browse a live menu, order from their table or for pickup and follow the order live, book a table with real-time availability, plan parties and leave reviews. Staff run everything from a dashboard at `/admin`, with individual logins, roles and a WhatsApp integration.

It is a plain Node.js app with **no dependencies**: no `npm install`, no build step, no database server.

## What's included

**For guests**

- Live open/closed badge in Indian Standard Time ("Open now · until 10:00 PM").
- Menu with search, a veg-only switch, FSSAI-style veg/non-veg marks, bestseller and spicy tags, and sold-out states that update while the page is open.
- **Scan and order at the table:** a QR code linking to `https://your-site/?table=12` opens the site in table mode, so orders go to the kitchen marked for table 12.
- Pickup ordering with a cart that survives page reloads. Prices and GST are always calculated on the server.
- **Live order tracking** (Received → Preparing → Ready → Enjoy), including the promised ready time, pushed instantly from the kitchen.
- **WhatsApp updates** if the guest ticks "Send me order updates on WhatsApp" (and the same for bookings), plus "Send this order on WhatsApp" as an alternative to ordering online.
- Table booking with a 14-day date strip, a guest counter and live slot availability.
- Party and event enquiry form, guest reviews (shown only after approval) and newsletter sign-up.
- Opening hours, map, directions and the cafe's spaces (Cafe BAE Lalpur, Yaarana Rooftop, YELLOW by Cafe BAE).
- SEO: server-rendered title and description, share image, `CafeOrCoffeeShop` structured data including the full menu, `robots.txt` and `sitemap.xml`.
- Responsive from 320px phones to wide desktops, keyboard accessible, and honours "reduce motion".

**For staff (`/admin`)**

- **Own login for every staff member**, with roles: Master (owner), Manager, Front desk and Kitchen. The owner can tick exactly which sections each person can use, block an account instantly, or reset a password.
- **Activity log** of every change: who accepted which order, who changed a price, who confirmed a booking, who replied on WhatsApp.
- **Live order board** (New / Preparing / Ready) that chimes on new orders. Accept with a ready time (5–45 min), mark ready, then complete with the payment method (cash, UPI, card). Print a kitchen order ticket (KOT) for 80 mm printers.
- Bookings: confirm, seat, cancel or mark no-show, with one-tap WhatsApp messages.
- **WhatsApp inbox**: customer chats, automatic replies, staff replies, and a log of every message with delivery status (sent, delivered, read, failed).
- Menu: prices, sold-out, bestsellers, add or delete items, and manage categories (add, rename, reorder, icon and colour).
- **Reports**: sales by day, best sellers, average order value, GST collected, payment methods, table vs pickup and booking no-shows.
- **Master settings**: business details, switch website features on or off (ordering, pickup, table orders, bookings, reviews, party enquiries, newsletter), GST and booking rules, opening hours, announcement bar, outlets, WhatsApp setup and printable table QR codes.
- "Pause online orders" switch for busy times, available to anyone who handles orders.

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

Open http://localhost:3000 for the website and http://localhost:3000/admin for the dashboard.

Run the tests:

```bash
npm test
```

## First sign-in and staff accounts

1. Open `/admin`. The first time, it asks you to **create the master account**. Enter the `ADMIN_TOKEN` value as the setup key, then choose your name, a username and a password. If `ADMIN_TOKEN` isn't set, a temporary key is printed in the terminal when the server starts.
2. In **Staff & activity**, add an account for each person. Pick a role as a starting point:

   | Role | Can use |
   | --- | --- |
   | Master (owner) | Everything, including staff accounts, settings and WhatsApp setup |
   | Manager | Orders, bookings, menu, WhatsApp inbox, reviews, parties, subscribers, reports |
   | Front desk | Orders, bookings, WhatsApp inbox, parties |
   | Kitchen | Orders only |

   Then tick or untick individual permissions for that person. Only master accounts can manage staff.
3. Each person signs in with their own username and password. Blocking an account or resetting its password signs that person out on every device straight away.

There must always be at least one active master account. `ADMIN_TOKEN` keeps working as an emergency master key (for example if the owner forgets the password), so keep it secret and change it if it leaks.

## WhatsApp setup

The site works with WhatsApp in two ways.

**1. Click-to-chat (no setup).** Every order, booking and party enquiry in the dashboard has a WhatsApp button that opens WhatsApp on the staff member's phone with a ready-written message. Guests can also send their cart as a WhatsApp message.

**2. WhatsApp Business Cloud API (automatic).** Once connected, the system:

- alerts staff numbers on WhatsApp for every new order, table booking and party enquiry;
- sends guests who opted in their order received / preparing (with ready time) / ready messages and booking confirmations or cancellations;
- answers customers 24/7: **MENU**, **STATUS** (finds their latest order and sends a live tracking link), **BOOK**, **HOURS** and **LOCATION**. Anything else gets a polite "our team will reply shortly" and lands in the dashboard inbox for staff to answer.

To connect it:

1. In [Meta for Developers](https://developers.facebook.com/), create an app, add the **WhatsApp** product, and add and verify the cafe's business phone number. Use a number that isn't already logged in to the normal WhatsApp or WhatsApp Business app.
2. Create a **System User** in Meta Business Settings with a permanent access token that has `whatsapp_business_messaging` permission.
3. Add these to the server's environment (Render: Environment tab) and restart:

   ```dotenv
   WHATSAPP_ACCESS_TOKEN=the-permanent-system-user-token
   WHATSAPP_PHONE_NUMBER_ID=the-phone-number-id-from-the-whatsapp-api-setup-page
   WHATSAPP_APP_SECRET=the-app-secret-from-app-settings-basic
   WHATSAPP_VERIFY_TOKEN=any-random-text-you-choose
   ```

4. In the Meta app, open **WhatsApp → Configuration → Webhook**. Enter `https://your-domain/api/whatsapp/webhook` as the callback URL and your `WHATSAPP_VERIFY_TOKEN` as the verify token, then subscribe to the **messages** field. Meta only accepts HTTPS addresses, so this needs the live site, not localhost.
5. In **WhatsApp Manager → Message templates**, create these templates in the **Utility** category, language **English (en)**. Use the exact names (or change the names in the dashboard to match yours):

   | Template name | Sent when | Text to submit |
   | --- | --- | --- |
   | `bae_new_order` | New order → staff | New order {{1}} ({{2}}): {{3}}. Total {{4}}. Customer: {{5}}, {{6}}. Please check the kitchen board. |
   | `bae_new_booking` | New table booking → staff | New table request from {{1}} for {{2}} at {{3}}, {{4}} guests. Phone {{5}}, code {{6}}. Please confirm it in the dashboard. |
   | `bae_new_enquiry` | New party enquiry → staff | Party enquiry from {{1}} ({{2}}) for {{3}}, about {{4}} guests: {{5}}. Please call them back. |
   | `bae_order_received` | Order received → customer | Hi {{1}}, we've received your Cafe BAE order {{2}} (total {{3}}). We'll message you when it's ready. |
   | `bae_order_preparing` | Order being prepared → customer | Hi {{1}}, your order {{2}} is being prepared and should be ready in about {{3}} minutes. |
   | `bae_order_ready` | Order ready → customer | Good news {{1}}! Your order {{2}} is ready {{3}}. Enjoy! |
   | `bae_booking_confirmed` | Booking confirmed → customer | Hi {{1}}, your table at Cafe BAE on {{2}} at {{3}} for {{4}} is confirmed. Booking code {{5}}. See you soon! |
   | `bae_booking_cancelled` | Booking cancelled → customer | Hi {{1}}, your Cafe BAE booking for {{2}} at {{3}} has been cancelled. Reply here if you'd like a new time. |

   Meta reviews templates, usually within minutes to a day.
6. In the dashboard, open **Settings → WhatsApp**: switch **Send WhatsApp messages** on, add the staff numbers that should get alerts, and use **Send a test message** to check the connection.

Business-initiated messages cost a small fee per conversation, set by Meta. Customer replies within 24 hours of a guest's message are free-form and are how the auto-replies and inbox work. After 24 hours WhatsApp only allows templates, so the dashboard switches to the click-to-chat button for that chat.

## Before you go live

Some details came from public listings and some are placeholders. Check each one:

1. **Opening hours.** Listings disagree: one says 8 AM to 10 PM, another says 10 AM to 10 PM. The site uses 10 AM to 10 PM. Change them in **Admin → Settings**.
2. **Menu and prices.** `data/menu.json` is a sample menu written for the launch. Replace it with the real menu, either by editing the file before the first run or from **Admin → Menu**.
3. **Photos.** Each item and category has an illustrated tile. To use real photos, put them in `public/images/` and set an item's photo link to `/images/oreo-shake.jpg` (or any `https://` image link) in **Admin → Menu**.
4. **Contact details.** Phone, WhatsApp, address and outlets are in `data/site.json`. Add `email` and `instagram` if you want them shown.
5. **Table QR codes.** **Admin → Settings → Table QR codes** lists a link per table and can print a sheet of QR codes. The QR images are generated by the free api.qrserver.com service.
6. **Privacy.** The site stores guest names and phone numbers for orders and bookings, and WhatsApp chats if you connect the Cloud API. Guests only get WhatsApp updates if they tick the box. Add a privacy notice that matches how you use the data.
7. **Backups.** Everything (orders, bookings, staff accounts, settings, messages) is in the `DATA_DIR` folder. Back it up regularly.

Files in `data/` are only the starting point. On first run they are copied to the storage folder (`DATA_DIR`), and from then on the dashboard edits that copy. Most details can be changed in **Admin → Settings** without touching any files.

## Deploy (Render example)

1. Create a **Web Service** from this repository.
2. Set **Root Directory** to `cafe-bae-ranchi`, **Build Command** to `npm install` and **Start Command** to `npm start`.
3. Add environment variables: `ADMIN_TOKEN` (your secret), `TRUST_PROXY=1`, and the `WHATSAPP_*` values if you're connecting WhatsApp.
4. Orders, bookings and menu edits are saved as JSON files. Attach a **persistent disk** (for example mounted at `/var/data`) and set `DATA_DIR=/var/data`. Without a disk, that data is wiped on every redeploy. Persistent disks need a paid Render plan, so review the price before you add one.
5. Point your domain (for example `www.cafebae.in`) at the service and make sure `website` in `data/site.json` matches it, because it is used for share previews and the sitemap.

Any host that runs Node.js 20 works the same way (Railway, Fly.io, a VPS with Nginx). Run a **single instance**: the file-based storage is not designed for several servers at once. Move to a database before scaling out.

## Project layout

```
cafe-bae-ranchi/
├── server.js              Entry point: reads .env, starts the server
├── src/
│   ├── app.js             Public API, live order stream, page rendering, routing
│   ├── admin-api.js       Staff endpoints: orders, bookings, menu, settings, reports, staff
│   ├── auth.js            Staff accounts, roles, permissions, sessions (scrypt passwords)
│   ├── whatsapp.js        WhatsApp Cloud API: alerts, guest updates, webhook, auto-replies, inbox
│   ├── store.js           JSON file storage with atomic writes
│   ├── time.js            IST opening hours and booking slots
│   ├── validate.js        Form validation
│   ├── constants.js       Shared status lists
│   └── http.js            Security headers, body parsing, rate limiting
├── data/                  Starting content: site details and menu
├── public/
│   ├── index.html, css/, js/app.js   Website
│   └── admin.html, js/admin/         Staff dashboard (one module per section)
└── test/                  API and dashboard tests (WhatsApp tested against a stand-in Meta API)
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/site` | Cafe details, open status, hours, features, ordering status |
| GET | `/api/menu` | Categories and items |
| POST | `/api/orders` | Place an order (prices are recalculated on the server) |
| GET | `/api/orders/:id` | Order status and ready time |
| GET | `/api/orders/:id/events` | Live order status (Server-Sent Events) |
| GET | `/api/availability?date=YYYY-MM-DD` | Booking slots and seats left |
| POST | `/api/reservations` | Request a table |
| GET / POST | `/api/reviews` | Approved reviews / submit a review |
| POST | `/api/enquiries` | Party or event enquiry |
| POST | `/api/subscribe` | Newsletter sign-up |
| GET / POST | `/api/whatsapp/webhook` | Meta webhook verification and incoming messages (signature checked) |
| POST | `/api/admin/setup`, `/api/admin/login` | Create the master account / sign in |
| * | `/api/admin/*` | Staff endpoints. Need `Authorization: Bearer <session token>` and the matching permission |

## Security notes

- Strict Content Security Policy (no inline scripts), `nosniff`, referrer policy and HSTS behind HTTPS.
- All guest text is inserted with `textContent`, never as HTML.
- Passwords are hashed with scrypt. Session tokens are random and stored only as hashes. Every staff endpoint checks the signed-in person's permissions on the server, not just in the dashboard.
- Per-visitor rate limits on every public form, a hidden honeypot field against bots, and a 15-minute lockout after 10 failed sign-ins.
- WhatsApp webhooks are rejected unless Meta's `X-Hub-Signature-256` signature matches your app secret. Secrets live only in environment variables, never in the dashboard or the data files.
- The admin page is excluded from search engines.
