import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

// Online payments for credit packs through Razorpay payment links (https://razorpay.com/docs/api/payments/payment-links/).
// Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the server to turn it on. The customer pays on
// Razorpay's page and is sent back with a signed result, which is checked before credits are added.

const API = "https://api.razorpay.com/v1";

export const razorpayEnabled = () => Boolean(config.razorpayKeyId && config.razorpayKeySecret);

async function call(method, path, body, fetchImpl = fetch) {
  const response = await fetchImpl(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.razorpayKeyId}:${config.razorpayKeySecret}`).toString("base64")}`,
      ...(body && { "Content-Type": "application/json" })
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.description || `Razorpay answered ${response.status}`);
  return data;
}

// amount is in rupees; Razorpay counts paise.
export async function createPaymentLink({ amount, reference, description, customer, callbackUrl }, fetchImpl) {
  const link = await call(
    "POST",
    "/payment_links",
    {
      amount: Math.round(amount * 100),
      currency: "INR",
      accept_partial: false,
      reference_id: reference,
      description: description.slice(0, 2048),
      customer: { name: customer.name, email: customer.email, contact: customer.phone.replace(/[^\d+]/g, "") },
      notify: { sms: false, email: false },
      reminder_enable: false,
      callback_url: callbackUrl,
      callback_method: "get"
    },
    fetchImpl
  );
  return { linkId: link.id, url: link.short_url };
}

export const fetchPaymentLink = (linkId, fetchImpl) => call("GET", `/payment_links/${encodeURIComponent(linkId)}`, undefined, fetchImpl);

// Razorpay signs link id | reference | status | payment id with the key secret.
export function validCallback(query) {
  const fields = ["razorpay_payment_link_id", "razorpay_payment_link_reference_id", "razorpay_payment_link_status", "razorpay_payment_id"].map((name) => String(query.get(name) ?? ""));
  const signature = String(query.get("razorpay_signature") ?? "");
  if (!razorpayEnabled() || fields.some((field) => !field) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", config.razorpayKeySecret).update(fields.join("|")).digest();
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}
