// Pricing engine shared by the browser (live cart totals) and the server (authoritative checkout).
// All money values are integers in the currency's minor unit (cents, paise, ...).

const round = (n) => Math.round(n);

/** True when a promotion applies to a cart line. */
export function promoMatches(promo, line) {
  if (promo.product_id) return promo.product_id === line.product_id;
  if (promo.category_id) return promo.category_id === line.category_id;
  return promo.type === "percent"; // store-wide % off
}

/** Discount (minor units) a single promotion gives a line. */
export function promoDiscount(promo, line) {
  const gross = round(line.unit_price * line.qty);
  switch (promo.type) {
    case "percent":
      return round((gross * Math.min(Math.max(promo.value, 0), 100)) / 100);
    case "amount":
      return Math.min(gross, round(promo.value * line.qty));
    case "multibuy": {
      const group = promo.buy_qty + promo.free_qty;
      if (promo.buy_qty <= 0 || promo.free_qty <= 0) return 0;
      const free = Math.floor(line.qty / group + 1e-9) * promo.free_qty;
      return Math.min(gross, round(free * line.unit_price));
    }
    case "bundle": {
      if (promo.buy_qty <= 0) return 0;
      const bundles = Math.floor(line.qty / promo.buy_qty + 1e-9);
      const saving = promo.buy_qty * line.unit_price - promo.value;
      return saving > 0 ? Math.min(gross, round(bundles * saving)) : 0;
    }
    default:
      return 0;
  }
}

/** Describes a promotion in a few words for receipts and the cart. */
export function promoLabel(promo, formatMoney = (v) => (v / 100).toFixed(2)) {
  switch (promo.type) {
    case "percent":
      return `${promo.value}% off`;
    case "amount":
      return `${formatMoney(promo.value)} off each`;
    case "multibuy":
      return `Buy ${promo.buy_qty} get ${promo.free_qty} free`;
    case "bundle":
      return `${promo.buy_qty} for ${formatMoney(promo.value)}`;
    default:
      return promo.name;
  }
}

/**
 * Prices a cart.
 * lines: [{ product_id, category_id, name, qty, unit_price, tax_rate, manual_discount?, sold_by_weight? }]
 * promotions: active promotions for this branch/day.
 * options.taxInclusive: shelf prices already include tax (typical outside the US).
 * options.billDiscount: { type: "percent" | "amount", value } applied across the whole bill.
 */
export function priceCart(lines, promotions = [], { taxInclusive = true, billDiscount = null } = {}) {
  const priced = lines.map((line) => {
    const gross = round(line.unit_price * line.qty);
    let best = null;
    for (const promo of promotions) {
      if (!promoMatches(promo, line)) continue;
      const amount = promoDiscount(promo, line);
      if (amount > 0 && (!best || amount > best.amount)) best = { promo, amount };
    }
    const promoAmount = best ? best.amount : 0;
    const manual = Math.max(0, Math.min(round(line.manual_discount || 0), gross - promoAmount));
    return {
      ...line,
      gross,
      promo_id: best ? best.promo.id : null,
      promo_name: best ? best.promo.name : "",
      promo_discount: promoAmount,
      manual_discount: manual,
      bill_discount: 0,
      net: gross - promoAmount - manual
    };
  });

  // Spread a bill-level discount over lines so tax stays correct per rate.
  const base = priced.reduce((s, l) => s + l.net, 0);
  let billTotal = 0;
  if (billDiscount && billDiscount.value > 0 && base > 0) {
    billTotal = billDiscount.type === "percent" ? round((base * Math.min(billDiscount.value, 100)) / 100) : Math.min(round(billDiscount.value), base);
    let allocated = 0;
    const shares = priced.map((l, i) => {
      const exact = (billTotal * l.net) / base;
      const floor = Math.floor(exact);
      allocated += floor;
      return { i, floor, rem: exact - floor };
    });
    let left = billTotal - allocated;
    shares.sort((a, b) => b.rem - a.rem);
    for (const share of shares) {
      priced[share.i].bill_discount = share.floor + (left > 0 ? 1 : 0);
      if (left > 0) left -= 1;
    }
    for (const l of priced) l.net -= l.bill_discount;
  }

  const taxes = new Map();
  for (const l of priced) {
    const rate = Number(l.tax_rate) || 0;
    if (taxInclusive) {
      l.tax = l.net - round(l.net / (1 + rate / 100));
      l.total = l.net;
    } else {
      l.tax = round((l.net * rate) / 100);
      l.total = l.net + l.tax;
    }
    l.discount = l.promo_discount + l.manual_discount + l.bill_discount;
    const t = taxes.get(rate) ?? { rate, taxable: 0, tax: 0 };
    t.taxable += l.total - l.tax;
    t.tax += l.tax;
    taxes.set(rate, t);
  }

  return {
    lines: priced,
    subtotal: priced.reduce((s, l) => s + l.gross, 0),
    discount_total: priced.reduce((s, l) => s + l.discount, 0),
    bill_discount: billTotal,
    tax_total: priced.reduce((s, l) => s + l.tax, 0),
    total: priced.reduce((s, l) => s + l.total, 0),
    items_count: priced.reduce((s, l) => s + (l.sold_by_weight ? 1 : l.qty), 0),
    tax_breakdown: [...taxes.values()].filter((t) => t.rate > 0).sort((a, b) => a.rate - b.rate)
  };
}

/**
 * Works out change and what is still owed.
 * Only cash can exceed the amount due (to give change); card/UPI/points cannot.
 */
export function settle(total, payments) {
  let cash = 0;
  let other = 0;
  for (const p of payments) {
    if (p.method === "cash") cash += p.amount;
    else other += p.amount;
  }
  const paid = cash + other;
  const overpaidNonCash = other > total;
  const change = overpaidNonCash ? 0 : Math.max(0, Math.min(cash, paid - total));
  return { paid, cash, other, change, due: Math.max(0, total - paid), overpaidNonCash, cashApplied: cash - change };
}

/** Loyalty points earned on the part of the bill not paid with points. */
export function pointsEarned(total, pointsPaid, loyalty) {
  if (!loyalty?.enabled || !loyalty.earn_per_amount) return 0;
  return Math.max(0, Math.floor((total - pointsPaid) / loyalty.earn_per_amount));
}
