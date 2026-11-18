# Store POS API — connecting your admin panel

Everything the web app does goes through this JSON API, so your multi‑restaurant admin panel can do the same: sync products and prices, lock or unlock a branch, read live sales and end‑of‑day summaries, and receive events by webhook.

- **Base URL:** wherever you host Store POS, e.g. `https://pos.example.com`
- **Format:** JSON in, JSON out (`Content-Type: application/json`)
- **Money:** integers in the currency's smallest unit (paise, cents). `₹49.50` is `4950`.
- **Quantities:** numbers, up to 3 decimals for weighed items (`1.25` kg).
- **Dates:** `YYYY-MM-DD`, in **the branch's own time zone** (a "day" at a branch is its local day). Timestamps are UTC ISO‑8601.

## 1. Authentication

Create a key in **Admin → Admin panel / API → New API key**. It is shown once; store it as a secret in your panel.

```http
Authorization: Bearer sk_xxxxxxxxxxxxxxxxx
```
(`X-API-Key: sk_...` also works.)

| Key scope | Can do |
|---|---|
| **All branches (HQ)** | Everything an owner can: every branch, catalogue, settings, keys, webhooks |
| **One branch** | Manager‑level actions for that branch only. Requests for another branch get `403 BRANCH_SCOPE` |

Revoking a key in the UI stops it immediately.

## 2. Choosing the branch

Most endpoints act on one branch. Say which with a header (preferred) or query parameter:

```http
X-Branch-Id: 2          # or ?branch_id=2
```

Reports and sales lists accept `branch_id=all` for a consolidated, chain‑wide view (HQ keys only).

Tip: set each branch's **External ID** (Admin → Branches) to your panel's restaurant/outlet id, and each product's `external_id` to your panel's item id. Both come back in responses and webhooks so you can match records without keeping a mapping table.

## 3. Errors

```json
{ "error": { "message": "Payment is short by 500", "code": "INSUFFICIENT_PAYMENT", "details": { "due": 500 } } }
```

| Status | Meaning |
|---|---|
| 400 | Validation problem (`VALIDATION`, `BRANCH_REQUIRED`, `EMPTY_CART`, `NO_SHIFT`, `AGE_CHECK_REQUIRED`, …) |
| 401 | Missing/invalid/revoked key (`UNAUTHENTICATED`) |
| 403 | Not allowed (`FORBIDDEN`, `BRANCH_SCOPE`, `BRANCH_LOCKED`, `APPROVAL_REQUIRED`) |
| 404 | Not found (`NOT_FOUND`, `UNKNOWN_BARCODE`) |
| 409 | Conflict (`BARCODE_TAKEN`, `SKU_TAKEN`, `PLU_TAKEN`) |

## 4. Head office: control branches

| Method & path | What it does |
|---|---|
| `GET /api/hq/overview` | Live status of every branch: today's sales, transactions, gross profit, last sale time, open shifts, lock state, stock alert counts |
| `GET /api/branches` | List branches |
| `POST /api/branches` | Create `{ code, name, timezone, address?, phone?, tax_id?, receipt_footer?, external_id? }` |
| `PATCH /api/branches/:id` | Update any of the above, plus `active` |
| `POST /api/branches/:id/lock` | Stop all selling at a branch `{ reason }` — tills show the reason |
| `POST /api/branches/:id/unlock` | Resume selling |
| `GET/PUT /api/settings` | Store name, currency, tax mode, payment methods, loyalty, discount limits, expiry/negative‑stock rules |
| `GET/POST /api/users`, `PATCH /api/users/:id` | Staff accounts `{ name, username, role: owner|manager|cashier, branch_id, pin?, password?, active? }` |

```bash
curl -X POST https://pos.example.com/api/branches/2/lock \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"reason":"Monthly stock audit"}'
```

## 5. Catalogue sync

| Method & path | What it does |
|---|---|
| `PUT /api/products/bulk` | **Create‑or‑update up to 5,000 products** in one call. Matches by `external_id`, then `sku`, then any barcode |
| `GET /api/products?updated_since=2026-11-01T00:00:00Z` | Pull changes (also `search`, `category_id`, `filter=low|out|expiring|expired|quick`, `status=active|inactive|all`, `limit`, `offset`) |
| `GET /api/products/:id` | One product with batches (expiry), stock in every branch, active promotions |
| `POST /api/products`, `PATCH /api/products/:id` | Single create / update |
| `PUT /api/products/:id/branch` | Branch‑specific price / reorder level / on‑off: `{ branch_id, price: 4500 \| null, reorder_level, active }` |
| `GET /api/lookup?code=8901234567890` | Resolve a scanned code (barcode, case barcode, scale label, PLU or SKU) |
| `GET/POST /api/categories`, `GET/POST /api/suppliers` | Lookup lists |

Product fields:

```json
{
  "external_id": "MENU-ITEM-118",
  "sku": "COLA-330",
  "name": "Cola 330ml Can",
  "category": "Beverages",
  "price": 4000,
  "cost": 2600,
  "tax_rate": 12,
  "unit": "pcs",
  "barcodes": [{ "code": "8901234567890", "pack_qty": 1 }, { "code": "18901234567897", "pack_qty": 24 }],
  "plu": null,
  "sold_by_weight": false,
  "reorder_level": 24,
  "reorder_qty": 96,
  "track_stock": true,
  "track_expiry": true,
  "expiry_warn_days": 7,
  "min_age": 0,
  "quick_key": false,
  "active": true
}
```

Response: `{ "created": 1, "updated": 0, "errors": [{ "index": 3, "sku": "X", "error": "price is required" }], "ids": [12, null, ...] }` — one bad row does not stop the others.

## 6. Stock

| Method & path | What it does |
|---|---|
| `GET /api/stock/alerts` | Expired batches, batches expiring within each product's warning window, products at/below reorder level (`branch_id=all` for every branch) |
| `POST /api/stock/receive` | Goods received `{ supplier_id?, invoice_no?, items: [{ product_id, qty, cost?, expiry_date?, batch_no?, sell_price? }] }` |
| `POST /api/stock/adjust` | `{ product_id, qty: -2, reason: damaged|expired|theft|lost|found|correction|sample|internal_use|returned_to_supplier|other, note?, batch_id?, expiry_date? }` |
| `POST /api/stock/write-off-expired` | Remove all expired batches (optionally `{ product_id }`) |
| `POST /api/stock/count` | Stock‑take `{ items: [{ product_id, counted }] }` → variance report |
| `GET /api/stock/batches?product_id=` | Batches with expiry and remaining quantity |
| `GET /api/stock/movements` | Ledger (`product_id`, `type`, `from`, `to`, `limit`) |
| `POST /api/transfers` | Send stock to another branch `{ to_branch_id, items: [{ product_id, qty }] }` (expiry & cost travel with it) |
| `POST /api/transfers/:id/receive` · `/cancel` | Book a transfer in at the destination / return it |

**How stock works:** every delivery creates a *batch* with its expiry date and cost. Sales take from the batch that expires first (FEFO), skipping expired ones; refunds go back into the batch they came from. That gives accurate expiry alerts and true cost of goods sold.

## 7. Sales

| Method & path | What it does |
|---|---|
| `GET /api/sales?from=&to=&branch_id=all&type=sale|refund&search=` | Sales list |
| `GET /api/sales/:id` or `/api/sales/MGR-000123` | Full receipt: items, discounts, tax, payments, cashier, customer, refunds |
| `POST /api/pos/quote` | Price a basket (promotions + tax) without selling: `{ lines: [{ product_id, qty }] }` |
| `POST /api/pos/checkout` | Sell (e.g. from a kiosk or online order) — see below |
| `POST /api/sales/:id/refund` | `{ reason, items?: [{ sale_item_id, qty }], restock: true, method: "cash" }` |
| `GET /api/shifts`, `GET /api/shifts/:id` | Cash‑drawer shifts with expected vs counted cash |

Checkout body:

```json
{
  "lines": [{ "product_id": 12, "qty": 2 }, { "product_id": 40, "qty": 1.25 }],
  "payments": [{ "method": "card", "amount": 15000, "reference": "auth 8812" }],
  "customer_id": 7,
  "client_ref": "order-55821",
  "age_verified": false
}
```

`client_ref` makes checkout **idempotent**: sending the same value again returns the original sale instead of charging twice — use your order id. Sales made with an API key don't need a shift.

## 8. Reports

| Method & path | What it does |
|---|---|
| `GET /api/reports/daily?date=2026-11-18&branch_id=all` | End‑of‑day (Z) summary: net sales, tax, discounts, refunds, cost, gross profit & margin, average basket, payments by method, categories, top products, sales by hour, cashiers, stock received/written off/adjusted, shift cash variance, current alert counts. With `branch_id=all`, also a per‑branch table |
| `GET /api/reports/trend?days=30` | Daily net sales / transactions / profit |
| `GET /api/reports/reorder` | What to order: 14‑day sales rate × supplier lead time vs. stock and reorder level |
| `GET /api/reports/valuation` | Stock value at cost and at selling price, by category |
| `GET /api/reports/export/sales.csv?from=&to=` | Line‑level sales export |
| `GET /api/reports/export/stock.csv` | Stock on hand export |

## 9. Webhooks (push to your panel)

Add in **Admin → Admin panel / API → Add webhook**, or via `POST /api/webhooks { url, events: ["*"] | [...], branch_id? }`. The response includes a `secret` (shown once).

Events:

| Event | When |
|---|---|
| `sale.completed` | Every sale (full receipt in `data`) |
| `sale.refunded` | Every refund |
| `stock.received` | A delivery is posted |
| `stock.adjusted` | Manual adjustment or expired write‑off |
| `stock.low` | A product drops to its reorder level at a branch |
| `stock.expiring` | Daily, after local midnight, if anything is expired or about to expire |
| `stock.transfer` | Transfer sent / received |
| `shift.opened`, `shift.closed` | Cash drawer opened / closed (closed includes expected vs counted cash) |
| `daily.summary` | Daily, after local midnight: the previous day's full summary for that branch |
| `product.updated`, `branch.updated` | Catalogue or branch changes (incl. lock/unlock) |

Each delivery is a `POST`:

```http
Content-Type: application/json
X-Store-Event: sale.completed
X-Store-Delivery: 481
X-Store-Timestamp: 1763456400
X-Store-Signature: sha256=5f1c...

{ "id": "evt_9f...", "event": "sale.completed", "created_at": "...", "branch_id": 2, "data": { ... } }
```

Verify it (Node.js):

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, headers, secret) {
  const expected = "sha256=" + createHmac("sha256", secret).update(`${headers["x-store-timestamp"]}.${rawBody}`).digest("hex");
  const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(headers["x-store-signature"] ?? ""));
  const fresh = Math.abs(Date.now() / 1000 - Number(headers["x-store-timestamp"])) < 300;
  return ok && fresh;
}
```

PHP:

```php
$expected = 'sha256=' . hash_hmac('sha256', $_SERVER['HTTP_X_STORE_TIMESTAMP'] . '.' . $rawBody, $secret);
$valid = hash_equals($expected, $_SERVER['HTTP_X_STORE_SIGNATURE'] ?? '');
```

Reply with any `2xx` within 10 seconds. Failed deliveries retry after 1, 5, 15, 60, 240 and 720 minutes; you can see and retry them in the UI. Use the event `id` to ignore duplicates.

## 10. Embedding the screens in your panel

To show the store screens inside your admin panel in an `<iframe>`, start the server with your panel's origin allowed:

```bash
FRAME_ANCESTORS="'self' https://admin.example.com"
```

To call the API from browser JavaScript in your panel (rather than from its server), allow its origin:

```bash
CORS_ORIGINS=https://admin.example.com
```

Calling from your panel's **server** is safer: the API key never reaches a browser.
