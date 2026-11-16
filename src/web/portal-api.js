import { config } from "../config.js";
import { settings } from "../db.js";
import * as files from "../file-service.js";
import { createPaymentLink, fetchPaymentLink, razorpayEnabled, validCallback } from "../razorpay.js";
import { currentCustomer, endCustomerSession, endOtherSessions, startCustomerSession } from "./customer-auth.js";
import { HttpError, rateLimiter, readJson, sameOrigin, saveBody, sendDownload } from "./http.js";
import { siteOrigin } from "./pages.js";

// The tuning file service's API (/files page): accounts, credits, ECU uploads and file orders.
// Changes must come from the page itself: its header, this site's origin and, for anything but
// signing up or in, a signed-in customer.

const blocked = () => new HttpError(403, "Request blocked.");
const tooMany = () => new HttpError(429, "Too many requests. Please wait a while and try again.");

// fetchImpl replaces Razorpay's API in tests.
export function registerPortalRoutes(route, { fetchImpl } = {}) {
  const signUps = rateLimiter({ windowMs: 60 * 60_000, max: 5 });
  const signInFailures = rateLimiter({ windowMs: 15 * 60_000, max: 8 });
  const uploads = rateLimiter({ windowMs: 60 * 60_000, max: 30 });
  const orders = rateLimiter({ windowMs: 60 * 60_000, max: 20 });
  const purchases = rateLimiter({ windowMs: 60 * 60_000, max: 10 });
  const checks = rateLimiter({ windowMs: 60_000, max: 6 });
  const maxFileBytes = config.maxEcuFileMb * 1_048_576;

  const fromPage = (req) => req.headers["x-requested-with"] === "unity-portal" && sameOrigin(req);

  const portal = (method, path, handler, { raw = false } = {}) =>
    route(method, path, async (context) => {
      const customer = currentCustomer(context.req);
      if (!customer) throw new HttpError(401, "Please sign in.");
      if (method !== "GET" && !fromPage(context.req)) throw blocked();
      if (method === "POST" && !raw) context.body = await readJson(context.req, 20_000);
      return handler({ ...context, customer });
    });

  const open = (method, path, handler) =>
    route(method, path, async (context) => {
      if (!fromPage(context.req)) throw blocked();
      context.body = await readJson(context.req, 20_000);
      return handler(context);
    });

  const account = (customer) => ({ customer: files.accountView(files.customerById(customer.id) ?? customer) });

  // ---------- Signing up and in ----------

  open("POST", "/api/portal/register", async ({ req, res, ip, body }) => {
    if (signUps.blocked(ip)) throw tooMany();
    const customer = await files.createCustomer(body);
    signUps.hit(ip);
    startCustomerSession(req, res, customer.id);
    return account(customer);
  });

  open("POST", "/api/portal/login", async ({ req, res, ip, body }) => {
    const email = String(body.email ?? "").trim().toLowerCase();
    // Counted per address and per account, and checked before the password.
    if (signInFailures.blocked(ip) || signInFailures.blocked(`email:${email}`)) throw new HttpError(429, "Too many failed sign-ins. Please wait 15 minutes.");
    const customer = files.customerByEmail(email);
    if (!(await files.passwordMatches(customer, body.password))) {
      signInFailures.hit(ip);
      signInFailures.hit(`email:${email}`);
      throw new HttpError(401, "Wrong email or password.");
    }
    if (!customer.active) throw new HttpError(403, "This account is switched off. Please message us.");
    startCustomerSession(req, res, customer.id);
    return account(customer);
  });

  open("POST", "/api/portal/reset", async ({ req, res, ip, body }) => {
    if (signInFailures.blocked(ip)) throw new HttpError(429, "Too many attempts. Please wait 15 minutes.");
    let customer;
    try {
      customer = await files.resetPassword(body.token, body.password);
    } catch (error) {
      if (/expired/.test(error.message)) signInFailures.hit(ip);
      throw error;
    }
    endOtherSessions(customer.id);
    startCustomerSession(req, res, customer.id);
    return account(customer);
  });

  route("POST", "/api/portal/logout", ({ req, res }) => {
    if (!fromPage(req)) throw blocked();
    endCustomerSession(req, res);
    return { ok: true };
  });

  // ---------- Account ----------

  portal("GET", "/api/portal/me", ({ customer }) => account(customer));

  // Who's signed in, if anyone; the page asks on load, so a visitor who isn't gets no error.
  route("GET", "/api/portal/session", ({ req }) => {
    const customer = currentCustomer(req);
    return { customer: customer ? files.accountView(customer) : null };
  });

  portal("POST", "/api/portal/account", ({ customer, body }) => account(files.updateCustomer(customer.id, { name: body.name, phone: body.phone, company: body.company })));

  portal("POST", "/api/portal/password", async ({ req, customer, body }) => {
    if (!(await files.passwordMatches(customer, body.current))) throw new HttpError(400, "Your current password is wrong.");
    await files.setPassword(customer.id, body.password);
    endOtherSessions(customer.id, req);
    return { ok: true };
  });

  // Everything the page needs to draw a signed-in customer's screens.
  route("GET", "/api/portal/catalog", () => {
    const current = settings();
    return {
      open: current.fileServiceOpen,
      note: current.fileServiceNote,
      currency: current.currency,
      whatsappNumber: current.whatsappNumber,
      options: files.activeOptions().map(({ id, name, kind, credits, description }) => ({ id, name, kind, credits, description })),
      packs: files.activePacks().map(({ id, name, credits, price, note }) => ({ id, name, credits, price, note })),
      payments: { upi: files.upiAvailable(), online: razorpayEnabled() && current.currency === "INR" },
      tools: files.TOOLS,
      toolModes: files.TOOL_MODES,
      readMethods: files.READ_METHODS,
      fuels: files.FUELS,
      gearboxes: files.GEARBOXES,
      maxFileMb: config.maxEcuFileMb
    };
  });

  portal("GET", "/api/portal/overview", ({ customer }) => ({
    ...account(customer),
    orders: files.ordersFor(customer.id).map(files.customerOrderView),
    purchases: files.purchasesFor(customer.id).slice(0, 50).map(files.customerPurchaseView),
    ledger: files.ledgerFor(customer.id, 50).map(({ id, change, balance, reason, ref, createdAt }) => ({ id, change, balance, reason, ref, createdAt }))
  }));

  // ---------- ECU files and orders ----------

  // The original arrives as the raw request body, its name in X-File-Name.
  portal(
    "POST",
    "/api/portal/uploads",
    async ({ req, customer }) => {
      if (!uploads.hit(customer.id)) throw new HttpError(429, "That's a lot of uploads. Please wait a while and try again.");
      const id = files.newUploadId();
      const name = files.cleanFileName(req.headers["x-file-name"]);
      const { size, sha256 } = await saveBody(req, files.ECU_FILE_DIR, id, maxFileBytes);
      files.addPendingUpload(customer.id, { id, file: id, name, size, sha256 });
      return { upload: { id, name, size } };
    },
    { raw: true }
  );

  portal("POST", "/api/portal/orders", ({ customer, body }) => {
    if (orders.blocked(customer.id)) throw tooMany();
    const order = files.createFileOrder(customer.id, body);
    orders.hit(customer.id);
    return { order: files.customerOrderView(order), ...account(customer) };
  });

  portal("POST", "/api/portal/orders/:id/cancel", ({ customer, params }) => ({ order: files.customerOrderView(files.cancelFileOrder(customer.id, params.id)), ...account(customer) }));

  portal("GET", "/api/portal/orders/:id/download", ({ req, res, url, customer, params }) => {
    const order = files.ordersFor(customer.id).find((entry) => entry.id === params.id);
    if (!order) throw new HttpError(404, "File order not found.");
    const which = url.searchParams.get("file") === "original" ? order.original : order.status === "completed" ? order.tuned : null;
    if (!which) throw new HttpError(404, "Your tuned file isn't ready yet.");
    sendDownload(req, res, files.ecuFilePath(which.file), which.name);
  });

  // ---------- Buying credits ----------

  portal("POST", "/api/portal/purchases", async ({ req, customer, body }) => {
    if (purchases.blocked(customer.id)) throw tooMany();
    const method = body.method === "online" ? "razorpay" : "upi";
    const current = settings();
    if (method === "upi" && !files.upiAvailable()) throw new HttpError(400, "UPI payments aren't set up yet. Please message us on WhatsApp to buy credits.");
    if (method === "razorpay" && !(razorpayEnabled() && current.currency === "INR")) throw new HttpError(400, "Online payment isn't available. Choose UPI or message us.");
    let purchase = files.createPurchase(customer.id, String(body.packId ?? ""), method);
    purchases.hit(customer.id);
    if (method === "razorpay") {
      try {
        const link = await createPaymentLink(
          {
            amount: purchase.amount,
            // The random id, not the CR- number, so a reset counter can never repeat a reference Razorpay has seen.
            reference: purchase.id,
            description: `${current.businessName}: ${purchase.packName} (${purchase.credits} credits)`,
            customer,
            callbackUrl: `${siteOrigin(req)}/api/portal/razorpay/return`
          },
          fetchImpl
        );
        purchase = files.setPurchaseGateway(purchase.id, { provider: "razorpay", ...link });
      } catch (error) {
        console.error("Razorpay payment link failed:", error.message);
        files.cancelPurchase(purchase.id);
        throw new HttpError(502, "We couldn't start the online payment. Please try again, or pay by UPI.");
      }
    }
    return { purchase: files.customerPurchaseView(purchase) };
  });

  portal("POST", "/api/portal/purchases/:id/reference", ({ customer, params, body }) => ({ purchase: files.customerPurchaseView(files.submitUpiReference(customer.id, params.id, body.reference)) }));

  portal("POST", "/api/portal/purchases/:id/cancel", ({ customer, params }) => ({ purchase: files.customerPurchaseView(files.cancelPurchase(params.id, { customerId: customer.id })) }));

  // Asks Razorpay whether an online payment went through (if the customer closed the page before returning).
  portal("POST", "/api/portal/purchases/:id/check", async ({ customer, params }) => {
    const purchase = files.purchasesFor(customer.id).find((entry) => entry.id === params.id);
    if (!purchase) throw new HttpError(404, "Payment not found.");
    if (!checks.hit(customer.id)) throw tooMany();
    return { purchase: files.customerPurchaseView(await checkOnlinePayment(purchase, fetchImpl)), ...account(customer) };
  });

  // Razorpay sends the customer here after paying, with a signed result.
  route("GET", "/api/portal/razorpay/return", ({ res, url }) => {
    let outcome = "failed";
    if (validCallback(url.searchParams)) {
      const purchase = files.purchaseById(url.searchParams.get("razorpay_payment_link_reference_id"));
      if (purchase && purchase.gateway?.linkId === url.searchParams.get("razorpay_payment_link_id") && url.searchParams.get("razorpay_payment_link_status") === "paid") {
        files.confirmPurchase(purchase.id, { by: "razorpay", reference: url.searchParams.get("razorpay_payment_id") });
        outcome = "paid";
      }
    }
    res.writeHead(303, { Location: `/files?payment=${outcome}#credits`, "Cache-Control": "no-store" });
    res.end();
  });
}

// Adds the credits if Razorpay says the link was paid in full. Used by the customer's and admin's "Check" buttons.
export async function checkOnlinePayment(purchase, fetchImpl) {
  if (purchase.method !== "razorpay" || purchase.status === "paid" || !purchase.gateway?.linkId) return purchase;
  if (!razorpayEnabled()) throw new HttpError(400, "Razorpay isn't set up on the server.");
  let link;
  try {
    link = await fetchPaymentLink(purchase.gateway.linkId, fetchImpl);
  } catch (error) {
    console.error("Razorpay check failed:", error.message);
    throw new HttpError(502, "We couldn't reach Razorpay. Please try again in a minute.");
  }
  if (link.status === "paid" && link.amount_paid >= Math.round(purchase.amount * 100)) {
    const paymentId = link.payments?.find?.((payment) => payment.status === "captured")?.payment_id ?? "";
    return files.confirmPurchase(purchase.id, { by: "razorpay", reference: paymentId }).purchase;
  }
  return purchase;
}
