import { test } from "node:test";
import assert from "node:assert/strict";
import { gs1Date, gtinVariants, parseGs1, retailBarcode, stripSymbology, validGtin } from "../src/gs1.js";

const GS = "\x1d";
const GTIN = "09506000134352"; // GS1's example GTIN (EAN-13 9506000134352)
const now = new Date("2026-11-24T00:00:00Z");
const parse = (code) => parseGs1(code, { now });

test("GS1 DataMatrix with separators: product, expiry, batch, serial", () => {
  const r = parse(`]d201${GTIN}17271231` + `10ABC123${GS}21SER9`);
  assert.equal(r.gtin, GTIN);
  assert.equal(r.expiry_date, "2027-12-31");
  assert.equal(r.batch, "ABC123");
  assert.equal(r.serial, "SER9");
});

test("camera output: leading separator, batch before expiry", () => {
  const r = parse(`${GS}01${GTIN}10ABC123${GS}17271231`);
  assert.equal(r.batch, "ABC123");
  assert.equal(r.expiry_date, "2027-12-31");
});

test("keyboard scanner that drops separators: trailing expiry is recovered from the batch", () => {
  const r = parse(`01${GTIN}10ABC12317271231`);
  assert.equal(r.batch, "ABC123");
  assert.equal(r.expiry_date, "2027-12-31");
});

test("label text typed with brackets; day 00 means end of month", () => {
  const r = parse(`(01)${GTIN}(17)270600(10)L1`);
  assert.equal(r.expiry_date, "2027-06-30");
  assert.equal(r.batch, "L1");
});

test("best-before (15) is reported separately from expiry (17)", () => {
  const r = parse(`01${GTIN}15270115`);
  assert.equal(r.expiry_date, null);
  assert.equal(r.best_before, "2027-01-15");
});

test("GS1 Digital Link QR code", () => {
  const r = parse(`https://id.gs1.org/01/${GTIN}/10/ABC%2F1?17=271231`);
  assert.equal(r.gtin, GTIN);
  assert.equal(r.batch, "ABC/1");
  assert.equal(r.expiry_date, "2027-12-31");
  assert.equal(parse("https://example.com/offers/summer"), null);
});

test("supplier carton label: (02) contents + (37) count", () => {
  const r = parse(`]C102${GTIN}3724${GS}17271231` + "10B7");
  assert.equal(r.contents, true);
  assert.equal(r.count, 24);
  assert.equal(r.expiry_date, "2027-12-31");
  assert.equal(r.batch, "B7");
});

test("net weight in kg (310n)", () => {
  assert.equal(parse(`01${GTIN}3103001250`).net_weight_kg, 1.25);
});

test("ordinary barcodes are not GS1", () => {
  for (const code of ["5000000000110", "MGR-000123", "2000000000015", "0123456789012", "4011", "01234567890128", "]E05000000000110"]) {
    assert.equal(parse(code), null, code);
  }
  assert.equal(parse(`01${GTIN.slice(0, 13)}3`), null, "wrong check digit");
});

test("dates: GS1 century rule and invalid dates", () => {
  assert.equal(gs1Date("991231", now), "1999-12-31");
  assert.equal(gs1Date("751231", now), "2075-12-31");
  assert.equal(gs1Date("771231", now), "1977-12-31");
  assert.equal(gs1Date("270229", now), null);
  assert.equal(gs1Date("281300", now), null);
  assert.equal(parse(`01${GTIN}17271331`).expiry_date, null);
});

test("GTIN helpers", () => {
  assert.ok(validGtin(GTIN));
  assert.deepEqual(gtinVariants("00012345678905"), ["00012345678905", "0012345678905", "012345678905"]);
  assert.equal(retailBarcode(GTIN), "9506000134352");
  assert.equal(retailBarcode("10614141000415"), "10614141000415");
  assert.equal(retailBarcode("00000040170725"), "40170725");
  assert.equal(stripSymbology("]E05000000000110"), "5000000000110");
});
