import test from "node:test";
import assert from "node:assert/strict";
import { getVehicle } from "../src/vehicles.js";
import { enquiryText, locationText, whatsappLink } from "../src/whatsapp.js";

const session = {
  vehicle: getVehicle("toyota_hilux_28b"),
  location: { text: "Kandy" },
  ecu: "denso",
  customer: { name: "Sam Perera", username: "samp" }
};

test("enquiry text includes every detail the customer collected", () => {
  const text = enquiryText(session, "Unity Performance");
  assert.match(text, /^Hello Unity Performance/);
  for (const expected of ["Name: Sam Perera", "Telegram: @samp", "Toyota Hilux 2.8 Revo facelift (2020+)", "Stock: 204 hp / 500 Nm", "Stage 1 estimate: 235 hp / 580 Nm (+31 hp / +80 Nm)", "ECU: Denso (Supported)", "Location: Kandy"]) {
    assert.ok(text.includes(expected), `missing "${expected}"`);
  }
});

test("wa.me link targets the business number with the message pre-filled", () => {
  const url = whatsappLink(enquiryText(session), "+94 77 123-4567");
  assert.ok(url.startsWith("https://wa.me/94771234567?text="));
  assert.equal(decodeURIComponent(url.split("?text=")[1]), enquiryText(session));
  assert.ok(whatsappLink("hi", "").startsWith("https://wa.me/?text="));
});

test("links stay short enough for a Telegram button even with long inputs", () => {
  const long = { ...session, location: { text: "x".repeat(500) }, customer: { name: "y".repeat(500), username: "z" } };
  assert.ok(whatsappLink(enquiryText(long), "94771234567").length < 2000);
});

test("GPS locations become map links", () => {
  assert.equal(locationText({ latitude: 6.927079, longitude: 79.861244 }), "https://maps.google.com/?q=6.92708,79.86124");
  assert.equal(locationText({ skipped: true }), "Not shared");
});
