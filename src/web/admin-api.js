import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, db, replaceData, settings, transact } from "../db.js";
import { ENQUIRY_STATUSES, InputError, ORDER_STATUSES } from "../records.js";
import { slugify, validateBrand, validateEcu, validateProduct, validateService, validateSettings, validateVehicle, vehicleFormValues } from "../validation.js";
import { adminEnabled, checkCredentials, currentAdmin, endSession, startSession } from "./auth.js";
import { HttpError, rateLimiter, readJson, sameOrigin, sendJson } from "./http.js";

export const UPLOAD_DIR = join(DATA_DIR, "uploads");
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const IMAGE_SIGNATURES = [
  { ext: "png", test: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", test: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { ext: "webp", test: (bytes) => bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" }
];

// Editable collections. id() builds a readable id for new entries; ids never change afterwards.
const COLLECTIONS = {
  products: { validate: (input) => validateProduct(input), id: (entry) => slugify(entry.name) },
  vehicles: {
    validate: (input, data) => validateVehicle(input, { brandIds: data.brands.map((brand) => brand.id), ecuIds: data.ecus.map((ecu) => ecu.id) }),
    id: (entry) => slugify(`${entry.brand} ${entry.model} ${entry.generation}`, "_"),
    toForm: vehicleFormValues
  },
  ecus: { validate: (input) => validateEcu(input), id: (entry) => slugify(entry.title, "_") },
  brands: { validate: (input) => validateBrand(input), id: (entry) => slugify(entry.title, "_") },
  services: { validate: (input) => validateService(input), id: (entry) => slugify(entry.title) }
};

function uniqueId(base, taken) {
  const root = base || "item";
  let id = root;
  for (let n = 2; taken.has(id) || id === "unknown"; n++) id = `${root}-${n}`;
  return id;
}

function findIndex(list, id, label) {
  const index = list.findIndex((item) => item.id === id);
  if (index < 0) throw new HttpError(404, `${label} not found.`);
  return index;
}

// Moves stock back into (direction 1) or out of (direction -1) the shop for an order's items.
function adjustStock(data, order, direction) {
  for (const item of order.items) {
    const product = data.products.find((candidate) => candidate.id === item.productId);
    if (!product || product.stock === null) continue;
    if (direction < 0 && product.stock < item.qty) throw new InputError(`Not enough ${product.name} in stock to reopen this order.`);
    product.stock += direction * item.qty;
  }
}

const isOpen = (status) => status !== "cancelled";

function dashboard(data) {
  const now = Date.now();
  const day = 86_400_000;
  const liveOrders = data.orders.filter((order) => isOpen(order.status));
  const inWindow = (order, from, to) => {
    const time = Date.parse(order.createdAt);
    return time >= now - from && time < now - to;
  };
  const sum = (orders) => Math.round(orders.reduce((total, order) => total + order.total, 0) * 100) / 100;
  const daily = Array.from({ length: 14 }, (_, i) => {
    const date = new Date(now - (13 - i) * day).toISOString().slice(0, 10);
    const orders = liveOrders.filter((order) => order.createdAt.slice(0, 10) === date);
    return { date, orders: orders.length, revenue: sum(orders) };
  });
  return {
    currency: data.settings.currency,
    revenue30: sum(liveOrders.filter((order) => inWindow(order, 30 * day, 0))),
    revenuePrevious30: sum(liveOrders.filter((order) => inWindow(order, 60 * day, 30 * day))),
    orders30: liveOrders.filter((order) => inWindow(order, 30 * day, 0)).length,
    openOrders: data.orders.filter((order) => ["new", "confirmed", "ready"].includes(order.status)).length,
    newOrders: data.orders.filter((order) => order.status === "new").length,
    newEnquiries: data.enquiries.filter((enquiry) => enquiry.status === "new").length,
    enquiries30: data.enquiries.filter((enquiry) => Date.parse(enquiry.createdAt) >= now - 30 * day).length,
    lowStock: data.products.filter((product) => product.active && product.stock !== null && product.stock <= 3).map(({ id, name, stock }) => ({ id, name, stock })),
    daily,
    recentOrders: data.orders.slice(0, 6),
    recentEnquiries: data.enquiries.slice(0, 6),
    counts: Object.fromEntries(Object.keys(COLLECTIONS).map((name) => [name, data[name].length]))
  };
}

function validateBackup(backup) {
  if (!backup || typeof backup !== "object" || typeof backup.settings !== "object") throw new InputError("That file isn't a backup from this admin panel.");
  for (const name of [...Object.keys(COLLECTIONS), "orders", "enquiries"]) {
    const list = backup[name];
    if (!Array.isArray(list) || list.some((item) => !item || typeof item.id !== "string")) throw new InputError(`The backup's ${name} list is damaged.`);
    if (new Set(list.map((item) => item.id)).size !== list.length) throw new InputError(`The backup has duplicate ${name}.`);
  }
  for (const vehicle of backup.vehicles) {
    const pair = (value) => Array.isArray(value) && value.length === 2 && value.every((n) => Number.isFinite(n) && n > 0);
    if (!pair(vehicle.stock) || !pair(vehicle.stage1) || !Array.isArray(vehicle.years)) throw new InputError(`Vehicle ${vehicle.id} in the backup is damaged.`);
  }
  if (!Number.isInteger(backup.nextOrderNumber)) throw new InputError("The backup is missing its order counter.");
}

export function registerAdminRoutes(route) {
  const loginFailures = rateLimiter({ windowMs: 15 * 60_000, max: 5 });

  // Every admin request needs a session; changes also need the admin panel's header and origin,
  // which a page on another site can't send.
  const admin = (method, path, handler, { bodyLimit } = {}) =>
    route(method, path, async (context) => {
      if (!currentAdmin(context.req)) throw new HttpError(401, "Please sign in.");
      if (method !== "GET" && (context.req.headers["x-requested-with"] !== "unity-admin" || !sameOrigin(context.req))) throw new HttpError(403, "Request blocked.");
      if (method === "POST" || method === "PUT" || method === "PATCH") context.body = await readJson(context.req, bodyLimit);
      return handler(context);
    });

  route("GET", "/api/admin/me", ({ req }) => {
    const user = currentAdmin(req);
    if (!user) throw new HttpError(401, adminEnabled() ? "Please sign in." : "The admin panel is locked. Set ADMIN_PASSWORD (at least 10 characters) on the server.");
    return { user, businessName: settings().businessName };
  });

  route("POST", "/api/admin/login", async ({ req, res, ip }) => {
    if (!adminEnabled()) throw new HttpError(403, "The admin panel is locked. Set ADMIN_PASSWORD (at least 10 characters) on the server.");
    if (req.headers["x-requested-with"] !== "unity-admin" || !sameOrigin(req)) throw new HttpError(403, "Request blocked.");
    const { username, password } = await readJson(req, 10_000);
    // Checked before the password, so a blocked address can't keep guessing.
    if (loginFailures.blocked(ip)) throw new HttpError(429, "Too many failed sign-ins. Please wait 15 minutes.");
    if (!checkCredentials(username, password)) {
      loginFailures.hit(ip);
      throw new HttpError(401, "Wrong username or password.");
    }
    startSession(req, res);
    return { ok: true };
  });

  route("POST", "/api/admin/logout", ({ req, res }) => {
    endSession(req, res);
    return { ok: true };
  });

  admin("GET", "/api/admin/dashboard", () => dashboard(db()));

  for (const [name, collection] of Object.entries(COLLECTIONS)) {
    const label = name.replace(/s$/, "");
    const toForm = collection.toForm ?? ((entry) => entry);

    admin("GET", `/api/admin/${name}`, () => ({ items: db()[name].map(toForm) }));

    admin("POST", `/api/admin/${name}`, ({ body }) =>
      transact((data) => {
        const values = collection.validate(body, data);
        const now = new Date().toISOString();
        const item = { id: uniqueId(collection.id(values), new Set(data[name].map((entry) => entry.id))), ...values, createdAt: now, updatedAt: now };
        data[name].push(item);
        return { item: toForm(item) };
      })
    );

    admin("PUT", `/api/admin/${name}/:id`, ({ body, params }) =>
      transact((data) => {
        const index = findIndex(data[name], params.id, label);
        const values = collection.validate(body, data);
        const current = data[name][index];
        const item = { id: current.id, ...values, createdAt: current.createdAt, updatedAt: new Date().toISOString() };
        data[name][index] = item;
        return { item: toForm(item) };
      })
    );

    admin("DELETE", `/api/admin/${name}/:id`, ({ params }) =>
      transact((data) => {
        const index = findIndex(data[name], params.id, label);
        if (name === "brands") {
          const used = data.vehicles.filter((vehicle) => vehicle.brand === params.id).length;
          if (used) throw new InputError(`This brand is used by ${used} vehicle${used === 1 ? "" : "s"}. Delete or move those first.`);
        }
        if (name === "ecus") for (const vehicle of data.vehicles) vehicle.ecus = vehicle.ecus.filter((ecu) => ecu !== params.id);
        data[name].splice(index, 1);
        return { ok: true };
      })
    );
  }

  admin("GET", "/api/admin/orders", () => ({ items: db().orders, statuses: ORDER_STATUSES }));

  admin("PATCH", "/api/admin/orders/:id", ({ body, params }) =>
    transact((data) => {
      const order = data.orders[findIndex(data.orders, params.id, "Order")];
      if (body.status !== undefined) {
        if (!ORDER_STATUSES.includes(body.status)) throw new InputError("Unknown order status.");
        // Cancelling returns items to stock; reopening takes them out again.
        if (isOpen(order.status) && !isOpen(body.status)) adjustStock(data, order, 1);
        if (!isOpen(order.status) && isOpen(body.status)) adjustStock(data, order, -1);
        order.status = body.status;
      }
      if (body.adminNotes !== undefined) order.adminNotes = String(body.adminNotes).slice(0, 1000);
      order.updatedAt = new Date().toISOString();
      return { item: order };
    })
  );

  admin("DELETE", "/api/admin/orders/:id", ({ params }) =>
    transact((data) => {
      data.orders.splice(findIndex(data.orders, params.id, "Order"), 1);
      return { ok: true };
    })
  );

  admin("GET", "/api/admin/enquiries", () => ({ items: db().enquiries, statuses: ENQUIRY_STATUSES }));

  admin("PATCH", "/api/admin/enquiries/:id", ({ body, params }) =>
    transact((data) => {
      const enquiry = data.enquiries[findIndex(data.enquiries, params.id, "Enquiry")];
      if (body.status !== undefined) {
        if (!ENQUIRY_STATUSES.includes(body.status)) throw new InputError("Unknown enquiry status.");
        enquiry.status = body.status;
      }
      if (body.notes !== undefined) enquiry.notes = String(body.notes).slice(0, 1000);
      enquiry.updatedAt = new Date().toISOString();
      return { item: enquiry };
    })
  );

  admin("DELETE", "/api/admin/enquiries/:id", ({ params }) =>
    transact((data) => {
      data.enquiries.splice(findIndex(data.enquiries, params.id, "Enquiry"), 1);
      return { ok: true };
    })
  );

  admin("GET", "/api/admin/settings", () => ({ settings: db().settings, effective: settings() }));

  admin("PUT", "/api/admin/settings", ({ body }) =>
    transact((data) => {
      data.settings = { ...data.settings, ...validateSettings(body) };
      return { settings: data.settings };
    })
  );

  // Images arrive as data URLs; only real PNG, JPEG and WebP files are kept, under random names.
  admin(
    "POST",
    "/api/admin/uploads",
    ({ body }) => {
      const match = /^data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.data ?? ""));
      if (!match) throw new InputError("Choose a PNG, JPEG or WebP image.");
      const bytes = Buffer.from(match[1], "base64");
      if (bytes.length > MAX_UPLOAD_BYTES) throw new InputError("Images must be 5 MB or smaller.");
      const type = IMAGE_SIGNATURES.find((signature) => signature.test(bytes));
      if (!type) throw new InputError("Choose a PNG, JPEG or WebP image.");
      const name = `${randomBytes(16).toString("hex")}.${type.ext}`;
      mkdirSync(UPLOAD_DIR, { recursive: true });
      writeFileSync(join(UPLOAD_DIR, name), bytes);
      return { url: `/uploads/${name}` };
    },
    { bodyLimit: 8_000_000 }
  );

  admin("GET", "/api/admin/export", ({ res }) => {
    const date = new Date().toISOString().slice(0, 10);
    sendJson(res, 200, db(), { "Content-Disposition": `attachment; filename="unity-performance-backup-${date}.json"` });
  });

  admin(
    "POST",
    "/api/admin/import",
    ({ body }) => {
      validateBackup(body);
      replaceData(body);
      return { ok: true };
    },
    { bodyLimit: 25_000_000 }
  );
}
