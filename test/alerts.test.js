import test from "node:test";
import assert from "node:assert/strict";
import { alertChats, broadcast, createLinkCode, enquiryAlert, linkChat, orderAlert, startAlerts, unlinkChat } from "../src/alerts.js";
import { transact } from "../src/db.js";
import { createEnquiry, createOrder } from "../src/records.js";

const order = {
  id: "o1",
  number: "UP-1001",
  total: 360,
  currency: "USD",
  items: [{ name: "Boost <Hose> Kit", qty: 2 }],
  customer: { name: "Nimal Perera", phone: "+94 77 123 4567" },
  fulfilment: "delivery",
  address: "12 Lake Drive",
  note: ""
};

test("link codes work once and link the chat", () => {
  const { code } = createLinkCode();
  assert.match(code, /^[A-Z2-9]{8}$/);
  assert.equal(linkChat("111", { first_name: "Owner", username: "boss" }, code.toLowerCase()), true);
  assert.deepEqual(alertChats().map(({ chatId, name, username }) => ({ chatId, name, username })), [{ chatId: "111", name: "Owner", username: "boss" }]);
  assert.equal(linkChat("222", {}, code), false, "a used code can't link another chat");
  assert.equal(linkChat("222", {}, "ABCDEFGH"), false);
  assert.equal(unlinkChat("111"), true);
  assert.equal(unlinkChat("111"), false);
});

test("order alerts escape customer text and link to WhatsApp", () => {
  const { text, buttons } = orderAlert(order);
  assert.match(text, /New order UP-1001<\/b> · USD 360\.00/);
  assert.match(text, /2 × Boost &lt;Hose&gt; Kit/);
  assert.match(text, /Delivery to 12 Lake Drive/);
  assert.deepEqual(buttons[0][0], { text: "💬 WhatsApp Nimal", url: "https://wa.me/94771234567" });
  assert.equal(buttons[0].length, 1, "no admin button without an https website address");
});

test("the admin button appears once the website address is known", () => {
  process.env.RENDER_EXTERNAL_URL = "https://unity.example.com";
  try {
    assert.deepEqual(orderAlert(order).buttons[0].at(-1), { text: "🗂 Open in admin", url: "https://unity.example.com/admin#orders/o1" });
  } finally {
    delete process.env.RENDER_EXTERNAL_URL;
  }
});

test("enquiry alerts show the chosen stage and a Telegram contact", () => {
  const { text, buttons } = enquiryAlert({
    id: "e1",
    source: "telegram",
    customer: { name: "", username: "kasun_t" },
    vehicle: { name: "Volkswagen Golf GTI Mk7", years: "2013–2020", stage: 2, stock: { hp: 220, nm: 350 }, target: { hp: 320, nm: 450 } },
    ecu: "simos18",
    location: "Galle",
    message: ""
  });
  assert.match(text, /New Stage 2 enquiry<\/b> · Telegram bot/);
  assert.match(text, /220 → 320 hp · 350 → 450 Nm/);
  assert.match(text, /ECU: Continental Simos 18/);
  assert.match(text, /@kasun_t/);
  assert.deepEqual(buttons[0][0], { text: "✉️ @kasun_t", url: "https://t.me/kasun_t" });
});

test("new orders and enquiries are sent to every linked chat, respecting the settings", async () => {
  const sent = [];
  const send = async (chatId, text) => {
    if (chatId === "bad") throw new Error("Forbidden: bot was blocked by the user");
    sent.push({ chatId, text });
  };
  for (const chatId of ["111", "bad"]) linkChat(chatId, {}, createLinkCode().code);
  const stop = startAlerts({ send });
  try {
    createOrder({ customer: { name: "Sam", phone: "0771234567" }, items: [{ id: "cap", qty: 1 }] });
    createEnquiry({ name: "Kasun", phone: "0771234567", vehicleId: "vw_golf7_gti", stage: 3 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 2, "the blocked chat fails without stopping the others");
    assert.match(sent[0].text, /New order UP-\d+/);
    assert.match(sent[1].text, /New Stage 3 enquiry/);

    transact((data) => {
      data.settings.alertOrders = false;
    });
    createOrder({ customer: { name: "Sam", phone: "0771234567" }, items: [{ id: "cap", qty: 1 }] });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 2, "order alerts can be switched off");
  } finally {
    stop();
  }
  assert.equal(await broadcast({ text: "hi" }, send), 1);
});
