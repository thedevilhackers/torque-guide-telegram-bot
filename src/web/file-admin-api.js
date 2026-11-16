import { rmSync } from "node:fs";
import { config } from "../config.js";
import { db } from "../db.js";
import * as files from "../file-service.js";
import { fcfStatus } from "../providers/fast-chiptuningfiles.js";
import { razorpayEnabled } from "../razorpay.js";
import { HttpError, saveBody, sendDownload } from "./http.js";
import { checkOnlinePayment } from "./portal-api.js";
import { siteOrigin } from "./pages.js";

// Admin side of the tuning file service: file orders, customers and their credits, and payments.
// admin() is the signed-in, same-origin wrapper from admin-api.js.

const withCustomer = (record) => {
  const customer = files.customerById(record.customerId);
  return { ...record, customer: customer ? { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, company: customer.company } : null };
};

const customerSummary = ({ password, reset, ...customer }) => ({
  ...customer,
  orders: db().fileOrders.filter((order) => order.customerId === customer.id).length,
  hasResetLink: Boolean(reset && Date.parse(reset.expiresAt) > Date.now())
});

export function registerFileAdminRoutes(admin, { fetchImpl } = {}) {
  admin("GET", "/api/admin/file-service", () => ({
    statuses: files.FILE_ORDER_STATUSES,
    tools: files.TOOLS,
    toolModes: files.TOOL_MODES,
    readMethods: files.READ_METHODS,
    fuels: files.FUELS,
    gearboxes: files.GEARBOXES,
    razorpay: razorpayEnabled(),
    upi: files.upiAvailable(),
    provider: fcfStatus(),
    maxFileMb: config.maxEcuFileMb
  }));

  admin("GET", "/api/admin/file-orders", () => ({ items: db().fileOrders.map(withCustomer) }));

  admin("PATCH", "/api/admin/file-orders/:id", ({ body, params }) => ({ item: withCustomer(files.updateFileOrder(params.id, body)) }));

  admin("GET", "/api/admin/file-orders/:id/download", ({ req, res, url, params }) => {
    const order = db().fileOrders.find((entry) => entry.id === params.id);
    if (!order) throw new HttpError(404, "File order not found.");
    const which = url.searchParams.get("file") === "tuned" ? order.tuned : order.original;
    if (!which) throw new HttpError(404, "There's no tuned file on this order yet.");
    sendDownload(req, res, files.ecuFilePath(which.file), which.name);
  });

  // The tuned file arrives as the raw request body, its name in X-File-Name.
  admin(
    "POST",
    "/api/admin/file-orders/:id/tuned",
    async ({ req, params }) => {
      if (!db().fileOrders.some((entry) => entry.id === params.id)) throw new HttpError(404, "File order not found.");
      const id = files.newUploadId();
      const name = files.cleanFileName(req.headers["x-file-name"], "tuned.bin");
      const { size, sha256 } = await saveBody(req, files.ECU_FILE_DIR, id, config.maxEcuFileMb * 1_048_576);
      let result;
      try {
        result = files.attachTunedFile(params.id, { file: id, name, size, sha256 });
      } catch (error) {
        rmSync(files.ecuFilePath(id), { force: true });
        throw error;
      }
      if (result.replaced) rmSync(files.ecuFilePath(result.replaced), { force: true });
      return { item: withCustomer(result.order) };
    },
    { raw: true }
  );

  admin("GET", "/api/admin/customers", () => ({ items: db().customers.map(customerSummary) }));

  admin("GET", "/api/admin/customers/:id", ({ params }) => {
    const customer = files.customerById(params.id);
    if (!customer) throw new HttpError(404, "Customer not found.");
    return {
      item: customerSummary(customer),
      ledger: files.ledgerFor(customer.id, 200),
      orders: files.ordersFor(customer.id),
      purchases: files.purchasesFor(customer.id)
    };
  });

  admin("PATCH", "/api/admin/customers/:id", ({ body, params }) => ({ item: customerSummary(files.updateCustomer(params.id, body, { admin: true })) }));

  admin("POST", "/api/admin/customers/:id/credits", ({ body, params }) => ({ item: customerSummary(files.adjustCredits(params.id, Number(body.change), body.note)) }));

  // A one-time link for a customer who forgot their password, to send them on WhatsApp.
  admin("POST", "/api/admin/customers/:id/reset-link", ({ req, params }) => {
    const { token, expiresAt } = files.createResetToken(params.id);
    return { url: `${siteOrigin(req)}/files#reset=${token}`, expiresAt };
  });

  admin("GET", "/api/admin/purchases", () => ({ items: db().creditPurchases.map(withCustomer), statuses: files.PURCHASE_STATUSES }));

  admin("POST", "/api/admin/purchases/:id/confirm", ({ params }) => {
    const purchase = files.purchaseById(params.id);
    if (!purchase) throw new HttpError(404, "Payment not found.");
    return { item: withCustomer(files.confirmPurchase(params.id, { by: "admin", reference: purchase.utr }).purchase) };
  });

  admin("POST", "/api/admin/purchases/:id/cancel", ({ params }) => ({ item: withCustomer(files.cancelPurchase(params.id)) }));

  admin("POST", "/api/admin/purchases/:id/check", async ({ params }) => {
    const purchase = files.purchaseById(params.id);
    if (!purchase) throw new HttpError(404, "Payment not found.");
    return { item: withCustomer(await checkOnlinePayment(purchase, fetchImpl)) };
  });
}
