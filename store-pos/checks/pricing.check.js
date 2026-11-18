import { test } from "node:test";
import assert from "node:assert/strict";
import { priceCart, promoDiscount, settle, pointsEarned } from "../shared/pricing.js";

const line = (over = {}) => ({ product_id: 1, category_id: 1, name: "Item", qty: 1, unit_price: 1000, tax_rate: 0, ...over });

test("tax-inclusive prices extract tax from the shelf price", () => {
  const cart = priceCart([line({ unit_price: 1050, tax_rate: 5 })], [], { taxInclusive: true });
  assert.equal(cart.total, 1050);
  assert.equal(cart.tax_total, 50);
  assert.deepEqual(cart.tax_breakdown, [{ rate: 5, taxable: 1000, tax: 50 }]);
});

test("tax-exclusive prices add tax on top", () => {
  const cart = priceCart([line({ unit_price: 1000, tax_rate: 8.25, qty: 2 })], [], { taxInclusive: false });
  assert.equal(cart.subtotal, 2000);
  assert.equal(cart.tax_total, 165);
  assert.equal(cart.total, 2165);
});

test("multibuy: buy 2 get 1 free", () => {
  const promo = { id: 9, name: "B2G1", type: "multibuy", product_id: 1, buy_qty: 2, free_qty: 1 };
  assert.equal(promoDiscount(promo, line({ qty: 2 })), 0);
  assert.equal(promoDiscount(promo, line({ qty: 3 })), 1000);
  assert.equal(promoDiscount(promo, line({ qty: 7 })), 2000);
});

test("bundle: 2 for a fixed price", () => {
  const promo = { id: 3, name: "2 for 15", type: "bundle", product_id: 1, buy_qty: 2, value: 1500 };
  assert.equal(promoDiscount(promo, line({ qty: 1 })), 0);
  assert.equal(promoDiscount(promo, line({ qty: 2 })), 500);
  assert.equal(promoDiscount(promo, line({ qty: 5 })), 1000);
});

test("the best single promotion wins per line", () => {
  const promos = [
    { id: 1, name: "10% dairy", type: "percent", category_id: 1, value: 10 },
    { id: 2, name: "B1G1", type: "multibuy", product_id: 1, buy_qty: 1, free_qty: 1 }
  ];
  const cart = priceCart([line({ qty: 2 })], promos);
  assert.equal(cart.lines[0].promo_id, 2);
  assert.equal(cart.total, 1000);
});

test("bill discount is spread across lines and never loses a cent", () => {
  const cart = priceCart(
    [line({ unit_price: 333, product_id: 1 }), line({ unit_price: 333, product_id: 2 }), line({ unit_price: 334, product_id: 3 })],
    [],
    { billDiscount: { type: "amount", value: 100 } }
  );
  assert.equal(cart.bill_discount, 100);
  assert.equal(cart.lines.reduce((s, l) => s + l.bill_discount, 0), 100);
  assert.equal(cart.total, 900);
});

test("manual discount cannot push a line below zero", () => {
  const cart = priceCart([line({ manual_discount: 5000 })]);
  assert.equal(cart.total, 0);
  assert.equal(cart.discount_total, 1000);
});

test("weighted items count as one item and price by weight", () => {
  const cart = priceCart([line({ unit_price: 199, qty: 1.25, sold_by_weight: true })]);
  assert.equal(cart.total, 249);
  assert.equal(cart.items_count, 1);
});

test("settle: change only from cash, card cannot overpay", () => {
  assert.deepEqual(settle(1500, [{ method: "cash", amount: 2000 }]), { paid: 2000, cash: 2000, other: 0, change: 500, due: 0, overpaidNonCash: false, cashApplied: 1500 });
  assert.equal(settle(1500, [{ method: "card", amount: 1000 }, { method: "cash", amount: 1000 }]).change, 500);
  assert.equal(settle(1500, [{ method: "card", amount: 1600 }]).overpaidNonCash, true);
  assert.equal(settle(1500, [{ method: "card", amount: 1000 }]).due, 500);
});

test("loyalty points are earned on the non-points part of the bill", () => {
  const loyalty = { enabled: true, earn_per_amount: 100 };
  assert.equal(pointsEarned(1999, 0, loyalty), 19);
  assert.equal(pointsEarned(1999, 500, loyalty), 14);
  assert.equal(pointsEarned(1999, 0, { enabled: false }), 0);
});
