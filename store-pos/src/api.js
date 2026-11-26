import { all, one, run, tx, value } from "./db.js";
import {
  assertNotThrottled,
  can,
  clearFailures,
  createApiKey,
  createSession,
  destroySession,
  hashSecret,
  permissionsFor,
  recordFailure,
  requirePermission,
  verifySecret
} from "./auth.js";
import {
  UNITS,
  bulkUpsertProducts,
  createProduct,
  deleteCategory,
  generateBarcode,
  getProduct,
  listCategories,
  listProducts,
  listSuppliers,
  lookupCode,
  saveCategory,
  saveSupplier,
  setBranchProduct,
  updateProduct
} from "./catalog.js";
import { getCustomer, saveCustomer, searchCustomers } from "./customers.js";
import { DEMO_LOGINS, seedDemo } from "./demo.js";
import {
  ADJUST_REASONS,
  adjustStock,
  applyStockCount,
  cancelTransfer,
  createTransfer,
  getReceipt,
  getTransfer,
  listBatches,
  listCounts,
  listMovements,
  listReceipts,
  listTransfers,
  receiveStock,
  receiveTransfer,
  stockAlerts,
  writeOffExpired
} from "./inventory.js";
import {
  audit,
  changeOwnSecret,
  createBranch,
  createUser,
  getBranch,
  listAudit,
  listBranches,
  listUsers,
  updateBranch,
  updateUser,
  userRecordForLogin
} from "./org.js";
import { PROMO_TYPES, activePromotions, deletePromotion, listPromotions, savePromotion } from "./promotions.js";
import { dailySummary, hqOverview, reorderSuggestions, salesCsv, salesTrend, stockCsv, stockValuation } from "./reports.js";
import { checkout, getSale, holdCart, listHeldCarts, listSales, quote, refundSale, takeHeldCart } from "./sales.js";
import { getSettings, updateSettings } from "./settings.js";
import { addCashMovement, closeShift, currentShift, listShifts, openShift, shiftReport } from "./shifts.js";
import { EVENTS, createWebhook, deleteWebhook, emit, listDeliveries, listWebhooks, retryDelivery, sendTestEvent, updateWebhook } from "./webhooks.js";
import { HttpError, addDays, badRequest, bool, businessDate, forbidden, int, isIsoDate, notFound, nowIso, optionalId, str } from "./util.js";

const needBranch = (ctx) => {
  if (!ctx.branchId) throw badRequest("Choose a branch first (send X-Branch-Id or branch_id)", "BRANCH_REQUIRED");
  return ctx.branchId;
};
const id = (ctx, key = "id") => int(ctx.params[key], key, { min: 1 });
const dateParam = (ctx, key, fallback) => {
  const v = ctx.query[key];
  if (!v) return fallback;
  if (!isIsoDate(v)) throw badRequest(`${key} must be YYYY-MM-DD`, "VALIDATION");
  return v;
};
const branchFilter = (ctx) => (ctx.query.branch_id === "all" && !ctx.principal.branchId ? null : ctx.branchId);
const csv = (body, filename) => ({ __raw: true, type: "text/csv; charset=utf-8", body, filename });


/** First-run setup: settings, first branch, owner account, optional demo data. Returns a session. */
export async function completeSetup(db, body) {
  if (value(db, "SELECT COUNT(*) FROM users") > 0) throw forbidden("Setup has already been completed", "SETUP_DONE");
  const owner = body.owner ?? {};
  const password = str(owner.password, "owner.password", { required: true, max: 200 });
  if (password.length < 8) throw badRequest("Password must be at least 8 characters", "VALIDATION");
  const pin = owner.pin ? String(owner.pin) : null;
  if (pin && !/^\d{4,8}$/.test(pin)) throw badRequest("PIN must be 4 to 8 digits", "VALIDATION");
  const [passwordHash, pinHash] = await Promise.all([hashSecret(password), pin ? hashSecret(pin) : null]);
  const result = tx(db, () => {
    if (value(db, "SELECT COUNT(*) FROM users") > 0) throw forbidden("Setup has already been completed", "SETUP_DONE");
    updateSettings(db, {
      store_name: body.store_name ?? "My Store",
      currency: body.currency ?? "USD",
      locale: body.locale ?? "en-US",
      prices_include_tax: body.prices_include_tax ?? true
    });
    const branch = createBranch(db, body.branch ?? {});
    const username = str(owner.username, "owner.username", { required: true, max: 40 }).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(username)) throw badRequest("username may only use letters, digits, dots, dashes and underscores", "VALIDATION");
    const userId = run(
      db,
      "INSERT INTO users(name, username, password_hash, pin_hash, role, created_at) VALUES (?, ?, ?, ?, 'owner', ?)",
      str(owner.name, "owner.name", { required: true, max: 80 }),
      username,
      passwordHash,
      pinHash,
      nowIso()
    ).id;
    return { branch, userId };
  });
  let demo = null;
  if (bool(body.demo)) {
    const principal = { kind: "user", userId: result.userId, role: "owner", branchId: null, name: owner.name };
    demo = await seedDemo(db, { branchId: result.branch.id, principal });
  }
  const session = createSession(db, result.userId);
  return { ...session, branch: result.branch, demo };
}

export function registerRoutes(router, { version, demo: demoMode = false }) {
  // On the public demo, turn off what a visitor could misuse: making the server call other
  // addresses (webhooks) and changing the shared demo accounts.
  const notOnDemo = (what) => {
    if (demoMode) throw forbidden(`${what} is turned off on the public demo`, "DEMO_DISABLED");
  };
  const r = router;

  // ---- public ----------------------------------------------------------------------
  r.get("/api/health", ({ db }) => ({ ok: true, version, time: nowIso(), branches: value(db, "SELECT COUNT(*) FROM branches") }), { auth: false });

  r.get("/api/setup", ({ db }) => ({ needs_setup: value(db, "SELECT COUNT(*) FROM users") === 0, demo: demoMode ? { logins: DEMO_LOGINS } : undefined }), { auth: false });

  r.post(
    "/api/setup",
    async ({ db, body, ip }) => {
      if (value(db, "SELECT COUNT(*) FROM users") > 0) throw forbidden("Setup has already been completed", "SETUP_DONE");
      assertNotThrottled(`setup:${ip}`);
      return completeSetup(db, body);
    },
    { auth: false }
  );

  r.post(
    "/api/auth/login",
    async ({ db, body, ip }) => {
      const username = str(body.username, "username", { required: true, max: 60 }).toLowerCase();
      const key = `login:${ip}:${username}`;
      assertNotThrottled(key);
      const user = userRecordForLogin(db, username);
      const secret = body.pin ? String(body.pin) : String(body.password ?? "");
      const hash = body.pin ? user?.pin_hash : user?.password_hash;
      if (!user || !(await verifySecret(secret, hash))) {
        recordFailure(key);
        throw new HttpError(401, body.pin ? "Wrong username or PIN" : "Wrong username or password", "BAD_CREDENTIALS");
      }
      clearFailures(key);
      const session = createSession(db, user.id);
      audit(db, { userId: user.id }, body.pin ? "auth.pin_login" : "auth.login", { branchId: user.branch_id });
      return { ...session, user: { id: user.id, name: user.name, username: user.username, role: user.role, branch_id: user.branch_id } };
    },
    { auth: false }
  );

  // ---- session ----------------------------------------------------------------------
  r.post("/api/auth/logout", ({ db, req }) => {
    const token = (req.headers.authorization ?? "").slice(7).trim();
    if (token.startsWith("st_")) destroySession(db, token);
    return { ok: true };
  });

  r.get("/api/me", ({ db, principal, branchId, today }) => {
    const branches = listBranches(db, principal, { includeInactive: principal.role === "owner" });
    return {
      user: { id: principal.userId, name: principal.name, username: principal.username, role: principal.role, branch_id: principal.branchId, kind: principal.kind },
      permissions: permissionsFor(principal.role),
      branches,
      branch_id: branchId,
      today,
      settings: getSettings(db),
      shift: branchId ? currentShift(db, branchId, principal.userId) : null,
      units: UNITS,
      adjust_reasons: ADJUST_REASONS,
      promo_types: PROMO_TYPES,
      events: EVENTS
    };
  });

  r.put("/api/me/secret", async ({ db, principal, body }) => {
    if (!principal.userId) throw badRequest("API keys have no password", "VALIDATION");
    const user = one(db, "SELECT * FROM users WHERE id = ?", principal.userId);
    if (user.password_hash && !(await verifySecret(String(body.current_password ?? ""), user.password_hash))) throw forbidden("Current password is wrong", "BAD_CREDENTIALS");
    await changeOwnSecret(db, principal.userId, { password: body.password, pin: body.pin });
    return { ok: true };
  });

  // ---- settings, branches, users --------------------------------------------------------------
  r.get("/api/settings", ({ db }) => getSettings(db));
  r.put("/api/settings", ({ db, principal, body }) => {
    requirePermission(principal, "settings.manage");
    const settings = updateSettings(db, body);
    audit(db, principal, "settings.updated", { details: Object.keys(body) });
    return settings;
  });

  r.get("/api/branches", ({ db, principal }) => listBranches(db, principal));
  r.post("/api/branches", ({ db, principal, body }) => {
    requirePermission(principal, "branches.manage");
    const branch = createBranch(db, body);
    audit(db, principal, "branch.created", { entity: "branch", entityId: branch.id, branchId: branch.id });
    emit(db, "branch.updated", branch, branch.id);
    return branch;
  });
  r.get("/api/branches/:id", ({ db, principal, ...ctx }) => {
    const branchId = id(ctx);
    if (principal.branchId && principal.branchId !== branchId) throw forbidden();
    return getBranch(db, branchId);
  });
  r.patch("/api/branches/:id", ({ db, principal, body, ...ctx }) => {
    requirePermission(principal, "branches.manage");
    const branch = updateBranch(db, id(ctx), body);
    audit(db, principal, "branch.updated", { entity: "branch", entityId: branch.id, branchId: branch.id, details: body });
    emit(db, "branch.updated", branch, branch.id);
    return branch;
  });
  const lockRoute = (locked) => ({ db, principal, body, ...ctx }) => {
    requirePermission(principal, "branches.manage");
    const branch = updateBranch(db, id(ctx), { locked, lock_reason: body.reason ?? "" });
    audit(db, principal, locked ? "branch.locked" : "branch.unlocked", { entity: "branch", entityId: branch.id, branchId: branch.id, details: { reason: body.reason } });
    emit(db, "branch.updated", branch, branch.id);
    return branch;
  };
  r.post("/api/branches/:id/lock", lockRoute(true));
  r.post("/api/branches/:id/unlock", lockRoute(false));

  r.get("/api/users", ({ db, principal }) => {
    requirePermission(principal, "users.manage");
    return listUsers(db, principal);
  });
  r.post("/api/users", async ({ db, principal, body }) => {
    requirePermission(principal, "users.manage");
    const user = await createUser(db, principal, body);
    audit(db, principal, "user.created", { entity: "user", entityId: user.id, branchId: user.branch_id, details: { username: user.username, role: user.role } });
    return user;
  });
  r.patch("/api/users/:id", async ({ db, principal, body, ...ctx }) => {
    requirePermission(principal, "users.manage");
    notOnDemo("Changing staff accounts");
    const user = await updateUser(db, principal, id(ctx), body);
    audit(db, principal, "user.updated", { entity: "user", entityId: user.id, branchId: user.branch_id, details: { ...body, password: body.password ? "***" : undefined, pin: body.pin ? "***" : undefined } });
    return user;
  });

  // ---- catalogue -------------------------------------------------------------------------
  r.get("/api/categories", ({ db }) => listCategories(db));
  r.post("/api/categories", ({ db, principal, body }) => {
    requirePermission(principal, "catalog.edit");
    return saveCategory(db, null, body);
  });
  r.patch("/api/categories/:id", ({ db, principal, body, ...ctx }) => {
    requirePermission(principal, "catalog.edit");
    return saveCategory(db, id(ctx), body);
  });
  r.delete("/api/categories/:id", ({ db, principal, ...ctx }) => {
    requirePermission(principal, "catalog.edit");
    deleteCategory(db, id(ctx));
    return { ok: true };
  });

  r.get("/api/suppliers", ({ db }) => listSuppliers(db));
  r.post("/api/suppliers", ({ db, principal, body }) => {
    requirePermission(principal, "catalog.edit");
    return saveSupplier(db, null, body);
  });
  r.patch("/api/suppliers/:id", ({ db, principal, body, ...ctx }) => {
    requirePermission(principal, "catalog.edit");
    return saveSupplier(db, id(ctx), body);
  });

  r.get("/api/products", ({ db, query, branchId, today }) =>
    listProducts(db, {
      branchId,
      today,
      search: str(query.search, "search", { max: 100 }),
      categoryId: optionalId(query.category_id, "category_id"),
      filter: query.filter ?? "",
      status: query.status ?? "active",
      limit: query.limit,
      offset: query.offset,
      updatedSince: query.updated_since || null
    })
  );
  r.post("/api/products", ({ db, principal, body, branchId, today }) => {
    requirePermission(principal, "catalog.edit");
    const productId = createProduct(db, body);
    if (body.branch_price !== undefined && branchId) setBranchProduct(db, branchId, productId, { price: body.branch_price });
    const product = getProduct(db, productId, { branchId, today });
    audit(db, principal, "product.created", { entity: "product", entityId: productId, details: { sku: product.sku, name: product.name } });
    emit(db, "product.updated", product);
    return product;
  });
  r.put("/api/products/bulk", ({ db, principal, body }) => {
    requirePermission(principal, "catalog.edit");
    const result = tx(db, () => bulkUpsertProducts(db, Array.isArray(body) ? body : body.products));
    audit(db, principal, "product.bulk_upsert", { details: { created: result.created, updated: result.updated, errors: result.errors.length } });
    return result;
  });
  r.get("/api/products/:id", ({ db, branchId, today, ...ctx }) => {
    const product = getProduct(db, id(ctx), { branchId, today });
    product.batches = listBatches(db, { branchId, productId: product.id });
    product.branch_stock = all(
      db,
      `SELECT b.id AS branch_id, b.code, b.name, COALESCE(s.qty, 0) AS qty, bp.price AS branch_price, COALESCE(bp.active, 1) AS active
         FROM branches b LEFT JOIN stock s ON s.branch_id = b.id AND s.product_id = ? LEFT JOIN branch_products bp ON bp.branch_id = b.id AND bp.product_id = ?
        WHERE b.active = 1 ORDER BY b.name`,
      product.id,
      product.id
    );
    product.promotions = activePromotions(db, branchId, today).filter((p) => p.product_id === product.id || (p.category_id && p.category_id === product.category_id));
    return product;
  });
  r.patch("/api/products/:id", ({ db, principal, body, branchId, today, ...ctx }) => {
    requirePermission(principal, "catalog.edit");
    const productId = id(ctx);
    // Branch managers change their own branch's price; owners change the chain-wide price.
    if (principal.branchId && body.price !== undefined) {
      setBranchProduct(db, principal.branchId, productId, { price: body.price });
      delete body.price;
    }
    updateProduct(db, productId, body);
    const product = getProduct(db, productId, { branchId, today });
    audit(db, principal, "product.updated", { entity: "product", entityId: productId, branchId: principal.branchId, details: body });
    emit(db, "product.updated", product);
    return product;
  });
  r.put("/api/products/:id/branch", ({ db, principal, body, branchId, today, ...ctx }) => {
    requirePermission(principal, "catalog.edit");
    const target = principal.branchId ?? optionalId(body.branch_id, "branch_id") ?? needBranch({ branchId });
    setBranchProduct(db, target, id(ctx), body);
    audit(db, principal, "product.branch_updated", { entity: "product", entityId: id(ctx), branchId: target, details: body });
    const product = getProduct(db, id(ctx), { branchId: target, today });
    emit(db, "product.updated", product, target);
    return product;
  });
  r.post("/api/products/:id/barcode", ({ db, principal, ...ctx }) => {
    requirePermission(principal, "catalog.edit");
    return { code: generateBarcode(db, id(ctx)) };
  });
  r.get("/api/lookup", ({ db, query, branchId, today }) => lookupCode(db, query.code, { branchId: needBranch({ branchId }), today }));

  // ---- stock -----------------------------------------------------------------------------
  r.get("/api/stock/alerts", ({ db, principal, today, ...ctx }) => {
    requirePermission(principal, "stock.view");
    return stockAlerts(db, { branchId: branchFilter({ principal, ...ctx }), today });
  });
  r.post("/api/stock/receive", ({ db, principal, body, branchId, today }) => {
    requirePermission(principal, "stock.receive");
    return receiveStock(db, principal, { ...body, branchId: needBranch({ branchId }), today });
  });
  r.get("/api/stock/receipts", ({ db, principal, branchId, query }) => {
    requirePermission(principal, "stock.view");
    return listReceipts(db, { branchId, limit: Number(query.limit) || 50 });
  });
  r.get("/api/stock/receipts/:id", ({ db, principal, ...ctx }) => {
    requirePermission(principal, "stock.view");
    const receipt = getReceipt(db, id(ctx));
    if (principal.branchId && receipt.branch_id !== principal.branchId) throw forbidden();
    return receipt;
  });
  r.post("/api/stock/adjust", ({ db, principal, body, branchId, today }) => {
    requirePermission(principal, "stock.adjust");
    return adjustStock(db, principal, { ...body, branchId: needBranch({ branchId }), today });
  });
  r.post("/api/stock/write-off-expired", ({ db, principal, body, branchId, today }) => {
    requirePermission(principal, "stock.adjust");
    return writeOffExpired(db, principal, { ...body, branchId: needBranch({ branchId }), today });
  });
  r.post("/api/stock/count", ({ db, principal, body, branchId, today }) => {
    requirePermission(principal, "stock.count");
    return applyStockCount(db, principal, { ...body, branchId: needBranch({ branchId }), today });
  });
  r.get("/api/stock/counts", ({ db, principal, branchId }) => {
    requirePermission(principal, "stock.view");
    return listCounts(db, { branchId: needBranch({ branchId }) });
  });
  r.get("/api/stock/movements", ({ db, principal, query, branchId }) => {
    requirePermission(principal, "stock.view");
    return listMovements(db, {
      branchId,
      productId: optionalId(query.product_id, "product_id"),
      type: query.type || null,
      from: query.from || null,
      to: query.to || null,
      limit: Number(query.limit) || 200
    });
  });
  r.get("/api/stock/batches", ({ db, principal, query, branchId }) => {
    requirePermission(principal, "stock.view");
    return listBatches(db, { branchId, productId: int(query.product_id, "product_id", { required: true, min: 1 }), includeEmpty: bool(query.include_empty) });
  });

  r.get("/api/transfers", ({ db, principal, branchId }) => {
    requirePermission(principal, "stock.view");
    return listTransfers(db, { branchId });
  });
  r.get("/api/transfers/:id", ({ db, principal, ...ctx }) => {
    requirePermission(principal, "stock.view");
    const transfer = getTransfer(db, id(ctx));
    if (principal.branchId && ![transfer.from_branch_id, transfer.to_branch_id].includes(principal.branchId)) throw forbidden();
    return transfer;
  });
  r.post("/api/transfers", ({ db, principal, body, branchId, today }) => {
    requirePermission(principal, "stock.transfer");
    return createTransfer(db, principal, { ...body, branchId: needBranch({ branchId }), today });
  });
  r.post("/api/transfers/:id/receive", ({ db, principal, branchId, today, ...ctx }) => {
    requirePermission(principal, "stock.receive");
    return receiveTransfer(db, principal, { branchId: needBranch({ branchId }), today, id: id(ctx) });
  });
  r.post("/api/transfers/:id/cancel", ({ db, principal, branchId, today, ...ctx }) => {
    requirePermission(principal, "stock.transfer");
    return cancelTransfer(db, principal, { branchId: needBranch({ branchId }), today, id: id(ctx) });
  });

  // ---- promotions & customers ---------------------------------------------------------------
  r.get("/api/promotions", ({ db, branchId }) => listPromotions(db, { branchId }));
  r.post("/api/promotions", ({ db, principal, body }) => {
    requirePermission(principal, "promotions.edit");
    return savePromotion(db, principal, null, body);
  });
  r.patch("/api/promotions/:id", ({ db, principal, body, ...ctx }) => {
    requirePermission(principal, "promotions.edit");
    return savePromotion(db, principal, id(ctx), body);
  });
  r.delete("/api/promotions/:id", ({ db, principal, ...ctx }) => {
    requirePermission(principal, "promotions.edit");
    deletePromotion(db, principal, id(ctx));
    return { ok: true };
  });

  r.get("/api/customers", ({ db, query }) => searchCustomers(db, { search: query.search ?? "", limit: Math.min(Number(query.limit) || 50, 500) }));
  r.post("/api/customers", ({ db, principal, body, branchId }) => {
    requirePermission(principal, "customers.edit");
    return saveCustomer(db, null, body, branchId);
  });
  r.get("/api/customers/:id", ({ db, ...ctx }) => getCustomer(db, id(ctx)));
  r.patch("/api/customers/:id", ({ db, principal, body, ...ctx }) => {
    requirePermission(principal, "customers.edit");
    return saveCustomer(db, id(ctx), body);
  });

  // ---- point of sale --------------------------------------------------------------------
  r.get("/api/pos/context", ({ db, principal, branchId, today }) => {
    requirePermission(principal, "pos.sell");
    const bid = needBranch({ branchId });
    const branch = getBranch(db, bid);
    return {
      branch,
      today,
      promotions: activePromotions(db, bid, today),
      quick_keys: listProducts(db, { branchId: bid, today, filter: "quick", limit: 48 }).items,
      shift: currentShift(db, bid, principal.userId),
      held_count: value(db, "SELECT COUNT(*) FROM held_carts WHERE branch_id = ?", bid)
    };
  });
  r.post("/api/pos/quote", ({ db, principal, body, branchId, today }) => {
    requirePermission(principal, "pos.sell");
    return quote(db, { ...body, branchId: needBranch({ branchId }), today });
  });
  r.post("/api/pos/checkout", async (ctx) => {
    requirePermission(ctx.principal, "pos.sell");
    const sale = await checkout(ctx.db, ctx.principal, { ...ctx.body, branchId: needBranch(ctx), today: ctx.today });
    ctx.status = sale.duplicate ? 200 : 201;
    return sale;
  });
  r.get("/api/held-carts", ({ db, principal, branchId }) => {
    requirePermission(principal, "pos.sell");
    return listHeldCarts(db, needBranch({ branchId }));
  });
  r.post("/api/held-carts", ({ db, principal, body, branchId }) => {
    requirePermission(principal, "pos.sell");
    return holdCart(db, principal, { ...body, branchId: needBranch({ branchId }) });
  });
  r.post("/api/held-carts/:id/recall", ({ db, principal, branchId, ...ctx }) => {
    requirePermission(principal, "pos.sell");
    return takeHeldCart(db, needBranch({ branchId }), id(ctx));
  });

  r.get("/api/sales", ({ db, principal, query, ...ctx }) => {
    requirePermission(principal, "sales.view");
    const ownOnly = !can(principal, "reports.view");
    return listSales(db, {
      branchId: branchFilter({ principal, query, ...ctx }),
      from: query.from || null,
      to: query.to || null,
      search: query.search ?? "",
      type: query.type || null,
      userId: ownOnly ? principal.userId : optionalId(query.user_id, "user_id"),
      limit: Number(query.limit) || 100,
      offset: Number(query.offset) || 0
    });
  });
  r.get("/api/sales/:id", ({ db, principal, ...ctx }) => {
    requirePermission(principal, "sales.view");
    const sale = getSale(db, ctx.params.id);
    if (principal.branchId && sale.branch_id !== principal.branchId) throw notFound("Sale");
    return sale;
  });
  r.post("/api/sales/:id/refund", async ({ db, principal, body, branchId, today, ...ctx }) => {
    requirePermission(principal, "sales.view");
    const sale = getSale(db, ctx.params.id);
    return refundSale(db, principal, { ...body, branchId, today, saleId: sale.id });
  });

  // ---- shifts ----------------------------------------------------------------------------
  r.get("/api/shifts", ({ db, principal, query, branchId }) => {
    requirePermission(principal, "shifts.use");
    const rows = listShifts(db, { branchId, status: query.status || null, limit: Number(query.limit) || 50 });
    return can(principal, "shifts.manage") ? rows : rows.filter((s) => s.user_id === principal.userId);
  });
  r.get("/api/shifts/current", ({ db, principal, branchId }) => {
    const shift = currentShift(db, needBranch({ branchId }), principal.userId);
    return shift ? shiftReport(db, shift.id) : null;
  });
  r.post("/api/shifts/open", ({ db, principal, body, branchId }) => {
    requirePermission(principal, "shifts.use");
    return openShift(db, principal, { ...body, branchId: needBranch({ branchId }) });
  });
  r.get("/api/shifts/:id", ({ db, principal, ...ctx }) => {
    const report = shiftReport(db, id(ctx));
    if (report.shift.user_id !== principal.userId && !can(principal, "shifts.manage")) throw forbidden();
    if (principal.branchId && report.shift.branch_id !== principal.branchId) throw forbidden();
    return report;
  });
  r.post("/api/shifts/:id/cash", ({ db, principal, body, ...ctx }) => addCashMovement(db, principal, id(ctx), body));
  r.post("/api/shifts/:id/close", ({ db, principal, body, ...ctx }) => closeShift(db, principal, id(ctx), body));

  // ---- reports -----------------------------------------------------------------------------
  r.get("/api/reports/daily", ({ db, principal, query, today, ...ctx }) => {
    requirePermission(principal, "reports.view");
    return dailySummary(db, { branchId: branchFilter({ principal, query, ...ctx }), date: dateParam({ query }, "date", today) });
  });
  r.get("/api/reports/trend", ({ db, principal, query, today, ...ctx }) => {
    requirePermission(principal, "reports.view");
    return salesTrend(db, { branchId: branchFilter({ principal, query, ...ctx }), endDate: dateParam({ query }, "end", today), days: Math.min(Math.max(Number(query.days) || 14, 1), 120) });
  });
  r.get("/api/reports/reorder", ({ db, principal, branchId, today }) => {
    requirePermission(principal, "reports.view");
    return reorderSuggestions(db, { branchId: needBranch({ branchId }), today });
  });
  r.get("/api/reports/valuation", ({ db, principal, query, ...ctx }) => {
    requirePermission(principal, "reports.view");
    return stockValuation(db, { branchId: branchFilter({ principal, query, ...ctx }) });
  });
  r.get("/api/reports/export/sales.csv", ({ db, principal, query, today, ...ctx }) => {
    requirePermission(principal, "reports.view");
    const to = dateParam({ query }, "to", today);
    const from = dateParam({ query }, "from", addDays(to, -6));
    return csv(salesCsv(db, { branchId: branchFilter({ principal, query, ...ctx }), from, to }), `sales_${from}_${to}.csv`);
  });
  r.get("/api/reports/export/stock.csv", ({ db, principal, query, today, ...ctx }) => {
    requirePermission(principal, "reports.view");
    return csv(stockCsv(db, { branchId: branchFilter({ principal, query, ...ctx }), today }), `stock_${today}.csv`);
  });
  r.get("/api/hq/overview", ({ db, principal }) => {
    requirePermission(principal, "branches.manage");
    return { generated_at: nowIso(), utc_date: businessDate("UTC"), branches: hqOverview(db) };
  });

  // ---- integrations (API keys, webhooks, audit) ---------------------------------------------
  r.get("/api/api-keys", ({ db, principal }) => {
    requirePermission(principal, "integrations.manage");
    return all(db, "SELECT k.id, k.name, k.prefix, k.branch_id, b.name AS branch_name, k.active, k.created_at, k.last_used_at FROM api_keys k LEFT JOIN branches b ON b.id = k.branch_id ORDER BY k.id DESC");
  });
  r.post("/api/api-keys", ({ db, principal, body }) => {
    requirePermission(principal, "integrations.manage");
    const branchId = optionalId(body.branch_id, "branch_id");
    if (branchId) getBranch(db, branchId);
    const key = createApiKey(db, { name: str(body.name, "name", { required: true, max: 60 }), branchId });
    audit(db, principal, "api_key.created", { entity: "api_key", entityId: key.id, details: { name: body.name, branch_id: branchId } });
    return key;
  });
  r.delete("/api/api-keys/:id", ({ db, principal, ...ctx }) => {
    requirePermission(principal, "integrations.manage");
    if (!run(db, "UPDATE api_keys SET active = 0 WHERE id = ?", id(ctx)).changes) throw notFound("API key");
    audit(db, principal, "api_key.revoked", { entity: "api_key", entityId: id(ctx) });
    return { ok: true };
  });

  r.get("/api/webhooks", ({ db, principal }) => {
    requirePermission(principal, "integrations.manage");
    return { webhooks: listWebhooks(db), events: EVENTS };
  });
  r.post("/api/webhooks", ({ db, principal, body }) => {
    notOnDemo("Sending webhooks");
    requirePermission(principal, "integrations.manage");
    const hook = createWebhook(db, body);
    audit(db, principal, "webhook.created", { entity: "webhook", entityId: hook.id, details: { url: hook.url, events: hook.events } });
    return hook;
  });
  r.patch("/api/webhooks/:id", ({ db, principal, body, ...ctx }) => {
    notOnDemo("Sending webhooks");
    requirePermission(principal, "integrations.manage");
    return updateWebhook(db, id(ctx), body);
  });
  r.delete("/api/webhooks/:id", ({ db, principal, ...ctx }) => {
    requirePermission(principal, "integrations.manage");
    deleteWebhook(db, id(ctx));
    return { ok: true };
  });
  r.post("/api/webhooks/:id/test", ({ db, principal, ...ctx }) => {
    notOnDemo("Sending webhooks");
    requirePermission(principal, "integrations.manage");
    sendTestEvent(db, id(ctx));
    return { ok: true };
  });
  r.get("/api/webhooks/deliveries", ({ db, principal, query }) => {
    requirePermission(principal, "integrations.manage");
    return listDeliveries(db, { webhookId: optionalId(query.webhook_id, "webhook_id"), limit: Number(query.limit) || 100 });
  });
  r.post("/api/webhooks/deliveries/:id/retry", ({ db, principal, ...ctx }) => {
    notOnDemo("Sending webhooks");
    requirePermission(principal, "integrations.manage");
    retryDelivery(db, id(ctx));
    return { ok: true };
  });

  r.get("/api/audit", ({ db, principal, branchId, query }) => {
    requirePermission(principal, "users.manage");
    return listAudit(db, { branchId, limit: Number(query.limit) || 200 });
  });
}
