import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logActivity } from "../activity.js";
import { alertChats, broadcast, createLinkCode, unlinkChat } from "../alerts.js";
import { listBackups, readBackup, writeBackup } from "../backups.js";
import { DATA_DIR, db, replaceData, settings, transact } from "../db.js";
import { FRANCHISE_STATUSES } from "../franchise.js";
import { MIN_STAFF_PASSWORD, STAFF_ROLES, changeOwnPassword, createStaff, isRole, noteSignIn, removeStaff, staffView, updateStaff } from "../staff.js";
import { REMOVABLE, expireTrash, purgeTrash, restoreTrash, trashItem } from "../trash.js";
import { MECHANIC_STATUSES } from "../mechanics.js";
import { REFERRAL_STATUSES, REFERRER_STATUSES, referrerSummary } from "../referrals.js";
import { DEFAULT_SETTINGS } from "../seed-data.js";
import { ENQUIRY_STATUSES, InputError, ORDER_STATUSES } from "../records.js";
import { slugify, validateBrand, validateCreditPack, validateEcu, validateFranchisePackage, validateOffer, validatePhoto, validateProduct, validateService, validateSettings, validateTuneOption, validateVehicle, vehicleFormValues } from "../validation.js";
import { adminEnabled, checkCredentials, currentAdmin, endSession, endSessionsFor, startSession } from "./auth.js";
import { registerFileAdminRoutes } from "./file-admin-api.js";
import { HttpError, rateLimiter, readJson, sameOrigin, sendJson } from "./http.js";

export const UPLOAD_DIR = join(DATA_DIR, "uploads");
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const IMAGE_SIGNATURES = [
  { ext: "png", test: (bytes) => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", test: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { ext: "webp", test: (bytes) => bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" }
];

// Editable collections. id() builds a readable id for new entries; ids never change afterwards.
// prepend puts new entries first (the photo gallery shows the newest first).
const COLLECTIONS = {
  products: { validate: (input) => validateProduct(input), id: (entry) => slugify(entry.name) },
  vehicles: {
    validate: (input, data) => validateVehicle(input, { brandIds: data.brands.map((brand) => brand.id), ecuIds: data.ecus.map((ecu) => ecu.id) }),
    id: (entry) => slugify(`${entry.brand} ${entry.model} ${entry.generation}`, "_"),
    toForm: vehicleFormValues
  },
  ecus: { validate: (input) => validateEcu(input), id: (entry) => slugify(entry.title, "_") },
  brands: { validate: (input) => validateBrand(input), id: (entry) => slugify(entry.title, "_") },
  services: { validate: (input) => validateService(input), id: (entry) => slugify(entry.title) },
  photos: { validate: (input) => validatePhoto(input), id: (entry) => slugify(entry.caption) || "photo", prepend: true },
  tuneOptions: {
    validate: (input, data) => validateTuneOption(input, data.tuneOptions.filter((entry) => entry.kind === "tune").map((entry) => entry.id)),
    id: (entry) => slugify(entry.name)
  },
  creditPacks: { validate: (input) => validateCreditPack(input), id: (entry) => slugify(entry.name) || "pack" },
  franchisePackages: { validate: (input) => validateFranchisePackage(input), id: (entry) => slugify(entry.name) || "package" },
  offers: { validate: (input) => validateOffer(input), id: (entry) => slugify(entry.title) || "offer" }
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
// Cancelling returns items to stock; reopening takes them out again.
function setOrderStatus(data, order, status) {
  if (!ORDER_STATUSES.includes(status)) throw new InputError("Unknown order status.");
  if (isOpen(order.status) && !isOpen(status)) adjustStock(data, order, 1);
  if (!isOpen(order.status) && isOpen(status)) adjustStock(data, order, -1);
  order.status = status;
}

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
    newFileOrders: data.fileOrders.filter((order) => order.status === "submitted").length,
    paymentsToCheck: data.creditPurchases.filter((purchase) => purchase.status === "submitted").length,
    newFranchiseLeads: data.franchiseLeads.filter((lead) => lead.status === "new").length,
    newReferrals: data.referrals.filter((entry) => entry.status === "pending").length,
    todo: todoList(data),
    newMechanics: data.mechanics.filter((entry) => entry.status === "pending").length,
    enquiries30: data.enquiries.filter((enquiry) => Date.parse(enquiry.createdAt) >= now - 30 * day).length,
    lowStock: data.products.filter((product) => product.active && product.stock !== null && product.stock <= 3).map(({ id, name, stock }) => ({ id, name, stock })),
    daily,
    recentOrders: data.orders.slice(0, 6),
    recentEnquiries: data.enquiries.slice(0, 6),
    counts: Object.fromEntries(Object.keys(COLLECTIONS).map((name) => [name, data[name].length]))
  };
}

// What needs doing, for the dashboard: only the lines with something waiting.
function todoList(data) {
  const owed = data.referrals.filter((entry) => entry.status === "confirmed");
  const lowStock = data.products.filter((product) => product.active && product.stock !== null && product.stock <= 3).length;
  return [
    { section: "orders", label: "New shop orders to confirm", count: data.orders.filter((order) => order.status === "new").length },
    { section: "enquiries", label: "New enquiries to answer", count: data.enquiries.filter((enquiry) => enquiry.status === "new").length },
    { section: "files", label: "File orders waiting", count: data.fileOrders.filter((order) => order.status === "submitted").length },
    { section: "payments", label: "UPI payments to check", count: data.creditPurchases.filter((purchase) => purchase.status === "submitted").length },
    { section: "franchise", label: "New franchise applications", count: data.franchiseLeads.filter((lead) => lead.status === "new").length },
    { section: "mechanics", label: "Mechanics to call and check", count: data.mechanics.filter((entry) => entry.status === "pending").length },
    { section: "referrals", label: "Referral rewards to pay", count: owed.length, note: owed.length ? `₹${owed.reduce((sum, entry) => sum + entry.reward, 0).toLocaleString("en-IN")} owed` : "" },
    { section: "products", label: "Products low on stock", count: lowStock }
  ].filter((entry) => entry.count > 0);
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,59}$/;
// Lists that older backups may not have.
const LATER_LISTS = new Set(["photos", "tuneOptions", "creditPacks", "franchisePackages", "franchiseLeads", "offers", "referrers", "referrals", "mechanics", "staff", "customers", "creditLedger", "creditPurchases", "fileOrders"]);
const FILE_SERVICE_LISTS = ["customers", "creditLedger", "creditPurchases", "fileOrders"];
const isDate = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));
const isText = (value) => typeof value === "string";
const dates = ({ createdAt, updatedAt }) => ({ ...(isDate(createdAt) && { createdAt }), ...(isDate(updatedAt) && { updatedAt }) });

function validOrder(order) {
  const customer = order.customer ?? {};
  return (
    isDate(order.createdAt) && isText(order.number) && ORDER_STATUSES.includes(order.status) && ["pickup", "delivery"].includes(order.fulfilment) &&
    [order.subtotal, order.deliveryFee, order.total].every(Number.isFinite) && isText(order.currency) && isText(customer.name) && isText(customer.phone) &&
    Array.isArray(order.items) && order.items.every((item) => isText(item?.productId) && isText(item.name) && Number.isInteger(item.qty) && Number.isFinite(item.lineTotal))
  );
}

function validFranchiseLead(lead) {
  return isDate(lead.createdAt) && FRANCHISE_STATUSES.includes(lead.status) && isText(lead.name) && isText(lead.phone) && isText(lead.city) && (lead.package === null || isText(lead.package?.name));
}

// Sign-ups and referrals: checked enough that the admin lists and totals can't break.
const PEOPLE_CHECKS = {
  referrers: ["Refer & earn sign-up", (entry) => isText(entry.code) && /^[A-Z0-9]{2,12}$/.test(entry.code) && isText(entry.name) && isText(entry.phone) && REFERRER_STATUSES.includes(entry.status)],
  referrals: ["Referral", (entry) => isDate(entry.createdAt) && isText(entry.code) && REFERRAL_STATUSES.includes(entry.status) && Number.isFinite(entry.reward) && isText(entry.customer?.name)],
  mechanics: ["Mechanic", (entry) => isDate(entry.createdAt) && isText(entry.name) && isText(entry.phone) && MECHANIC_STATUSES.includes(entry.status) && Array.isArray(entry.skills) && Number.isFinite(entry.rate)],
  staff: ["Staff member", (entry) => isText(entry.username) && isText(entry.name) && STAFF_ROLES.includes(entry.role) && /^[a-f0-9]{32}$/.test(entry.password?.salt) && /^[a-f0-9]{64}$/.test(entry.password?.hash)]
};

function validEnquiry(enquiry) {
  return (
    isDate(enquiry.createdAt) && ENQUIRY_STATUSES.includes(enquiry.status) && ["website", "telegram"].includes(enquiry.source) &&
    enquiry.customer && typeof enquiry.customer === "object" && (enquiry.vehicle === null || isText(enquiry.vehicle?.name))
  );
}

// A backup goes through the same checks as the admin forms, so a damaged or hand-edited file can't
// leave the site or the admin panel unable to load. Returns the cleaned data to store.
function cleanBackup(backup) {
  if (!backup || typeof backup !== "object" || !backup.settings || typeof backup.settings !== "object") throw new InputError("That file isn't a backup from this admin panel.");
  // Lists added after launch (the photo gallery, the tuning file service) may be missing from an older
  // backup; restoring one gives those lists their starting contents, as for any older database.
  const present = (name) => backup[name] !== undefined || !LATER_LISTS.has(name);
  for (const name of [...Object.keys(COLLECTIONS), "orders", "enquiries", "franchiseLeads", ...Object.keys(PEOPLE_CHECKS), ...FILE_SERVICE_LISTS].filter(present)) {
    const list = backup[name];
    if (!Array.isArray(list) || list.some((item) => !item || typeof item !== "object" || !ID.test(String(item.id)))) throw new InputError(`The backup's ${name} list is damaged.`);
    if (new Set(list.map((item) => item.id)).size !== list.length) throw new InputError(`The backup has duplicate ${name}.`);
  }
  const each = (name, label, clean) =>
    present(name) &&
    backup[name].map((item) => {
      try {
        return { id: item.id, ...clean(item), ...dates(item) };
      } catch (error) {
        throw new InputError(`${label} "${item.id}" in the backup: ${error.message}`);
      }
    });
  const brands = each("brands", "Brand", validateBrand);
  const ecus = each("ecus", "ECU", validateEcu);
  const known = { brandIds: brands.map((brand) => brand.id), ecuIds: ecus.map((ecu) => ecu.id) };
  const vehicles = each("vehicles", "Vehicle", (item) => validateVehicle(vehicleFormValues(item), known));
  const orders = backup.orders.filter((order) => !validOrder(order));
  if (orders.length) throw new InputError(`Order "${orders[0].number ?? orders[0].id}" in the backup is damaged.`);
  const enquiries = backup.enquiries.filter((enquiry) => !validEnquiry(enquiry));
  if (enquiries.length) throw new InputError(`Enquiry "${enquiries[0].id}" in the backup is damaged.`);
  const leads = present("franchiseLeads") ? backup.franchiseLeads.filter((lead) => !validFranchiseLead(lead)) : [];
  if (leads.length) throw new InputError(`Franchise application "${leads[0].id}" in the backup is damaged.`);
  for (const [name, [label, valid]] of Object.entries(PEOPLE_CHECKS)) {
    const bad = present(name) ? backup[name].find((entry) => !valid(entry)) : null;
    if (bad) throw new InputError(`${label} "${bad.id}" in the backup is damaged.`);
  }
  let settingValues;
  try {
    settingValues = validateSettings({ ...DEFAULT_SETTINGS, ...backup.settings });
  } catch (error) {
    throw new InputError(`Settings in the backup: ${error.message}`);
  }
  const fileService = cleanFileService(backup);
  // The order counters must stay ahead of every number used, or new orders would reuse one.
  const highest = Math.max(1000, ...backup.orders.map((order) => Number(/^UP-(\d+)$/.exec(order.number)?.[1]) || 0));
  const counter = (key, list, prefix) => Math.max(Number.isInteger(backup[key]) ? backup[key] : 0, 1 + Math.max(1000, ...(fileService[list] ?? []).map((item) => Number(new RegExp(`^${prefix}-(\\d+)$`).exec(item.number)?.[1]) || 0)));
  const alertChats = (Array.isArray(backup.alertChats) ? backup.alertChats : []).filter((chat) => /^-?\d+$/.test(String(chat?.chatId)));
  return {
    ...(Number.isInteger(backup.version) && { version: backup.version }),
    ...(Number.isInteger(backup.catalogVersion) && { catalogVersion: backup.catalogVersion }),
    settings: { ...DEFAULT_SETTINGS, ...settingValues },
    brands,
    ecus,
    vehicles,
    services: each("services", "Service", validateService),
    products: each("products", "Product", validateProduct),
    ...(present("photos") && { photos: each("photos", "Photo", validatePhoto) }),
    ...(present("tuneOptions") && { tuneOptions: each("tuneOptions", "Tune option", validateTuneOption) }),
    ...(present("creditPacks") && { creditPacks: each("creditPacks", "Credit pack", validateCreditPack) }),
    ...(present("franchisePackages") && { franchisePackages: each("franchisePackages", "Franchise package", validateFranchisePackage) }),
    ...(present("franchiseLeads") && { franchiseLeads: backup.franchiseLeads }),
    ...(present("offers") && { offers: each("offers", "Offer", validateOffer) }),
    ...Object.fromEntries(Object.keys(PEOPLE_CHECKS).filter(present).map((name) => [name, backup[name]])),
    // The activity log comes back if it's readable; the recycle bin isn't restored from a backup.
    activity: Array.isArray(backup.activity) ? backup.activity.filter((entry) => entry && isDate(entry.at) && isText(entry.action)).slice(0, 3000) : [],
    trash: [],
    ...fileService,
    orders: backup.orders,
    enquiries: backup.enquiries,
    alertChats,
    nextOrderNumber: Math.max(Number.isInteger(backup.nextOrderNumber) ? backup.nextOrderNumber : 0, highest + 1),
    nextFileOrderNumber: counter("nextFileOrderNumber", "fileOrders", "TF"),
    nextPurchaseNumber: counter("nextPurchaseNumber", "creditPurchases", "CR")
  };
}

// Customer accounts, credit history, payments and file orders: checked enough that balances and
// links between them hold. The ECU files themselves live in DATA_DIR/ecu-files, outside the backup.
function cleanFileService(backup) {
  const lists = Object.fromEntries(FILE_SERVICE_LISTS.filter((name) => backup[name] !== undefined).map((name) => [name, backup[name]]));
  const customers = lists.customers ?? [];
  const isHex = (value, length) => typeof value === "string" && value.length === length && /^[a-f0-9]+$/.test(value);
  const badCustomer = customers.find(
    (customer) => !isText(customer.email) || !isText(customer.name) || !Number.isFinite(customer.credits) || customer.credits < 0 || !isHex(customer.password?.salt, 32) || !isHex(customer.password?.hash, 64)
  );
  if (badCustomer) throw new InputError(`Customer "${badCustomer.id}" in the backup is damaged.`);
  const ids = new Set(customers.map((customer) => customer.id));
  for (const [name, label] of [["creditLedger", "Credit entry"], ["creditPurchases", "Payment"], ["fileOrders", "File order"]]) {
    const bad = (lists[name] ?? []).find((item) => !ids.has(item.customerId) || !isDate(item.createdAt));
    if (bad) throw new InputError(`${label} "${bad.number ?? bad.id}" in the backup is damaged or belongs to a missing customer.`);
  }
  return lists;
}

// sendAlert delivers a Telegram message; it is null when the bot isn't configured.
// fetchImpl replaces Razorpay's API in tests.
export function registerAdminRoutes(route, { botUsername = () => "", sendAlert = null, fetchImpl } = {}) {
  const loginFailures = rateLimiter({ windowMs: 15 * 60_000, max: 5 });

  // Every admin request needs a session; changes also need the admin panel's header and origin,
  // which a page on another site can't send. role is the least role allowed: reading is open to every
  // signed-in user, changes to managers, unless a route says otherwise. Every change is written to the
  // activity log (a handler can name it with _log).
  // raw leaves the body unread, for file uploads.
  const admin = (method, path, handler, { bodyLimit, raw = false, role = method === "GET" ? "staff" : "manager" } = {}) =>
    route(method, path, async (context) => {
      const user = currentAdmin(context.req);
      if (!user) throw new HttpError(401, "Please sign in.");
      if (method !== "GET" && (context.req.headers["x-requested-with"] !== "unity-admin" || !sameOrigin(context.req))) throw new HttpError(403, "Request blocked.");
      if (!isRole(user, role)) throw new HttpError(403, role === "owner" ? "Only the owner can do this." : "Your role can't do this. Ask the owner or a manager.");
      context.user = user;
      if (!raw && (method === "POST" || method === "PUT" || method === "PATCH")) context.body = await readJson(context.req, bodyLimit);
      const result = await handler(context);
      if (method !== "GET" && result && typeof result === "object") {
        const action = result._log ?? describeChange(method, path, context.body, result);
        delete result._log;
        if (action) logActivity(user, action, { link: linkFor(path, context.params, result), ip: context.ip });
      }
      return result;
    });

  // Deleting moves the item (and what belongs to it) to the recycle bin; the reply carries the bin
  // entry's id, for Undo.
  const removeRoute = (section, path) =>
    admin("DELETE", path, ({ params, user }) =>
      transact((data) => {
        const entry = trashItem(data, section, params.id, user);
        return { ok: true, trashId: entry.id, _log: `Deleted ${entry.noun} ${entry.label}` };
      })
    );

  route("GET", "/api/admin/me", ({ req }) => {
    const user = currentAdmin(req);
    if (!user) throw new HttpError(401, adminEnabled() ? "Please sign in." : "The admin panel is locked. Set ADMIN_PASSWORD (at least 10 characters) on the server.");
    return { user, businessName: settings().businessName, maintenanceMode: settings().maintenanceMode };
  });

  route("POST", "/api/admin/login", async ({ req, res, ip }) => {
    if (!adminEnabled()) throw new HttpError(403, "The admin panel is locked. Set ADMIN_PASSWORD (at least 10 characters) on the server.");
    if (req.headers["x-requested-with"] !== "unity-admin" || !sameOrigin(req)) throw new HttpError(403, "Request blocked.");
    const { username, password } = await readJson(req, 10_000);
    // Checked before the password, so a blocked address can't keep guessing.
    if (loginFailures.blocked(ip)) throw new HttpError(429, "Too many failed sign-ins. Please wait 15 minutes.");
    const user = checkCredentials(username, password);
    if (!user) {
      loginFailures.hit(ip);
      logActivity(null, `Failed sign-in as “${String(username ?? "").slice(0, 40)}”`, { ip });
      throw new HttpError(401, "Wrong username or password.");
    }
    startSession(req, res, user);
    if (user.role !== "owner") noteSignIn(user.id);
    logActivity(user, "Signed in", { ip });
    return { ok: true };
  });

  route("POST", "/api/admin/logout", ({ req, res }) => {
    endSession(req, res);
    return { ok: true };
  });

  admin("GET", "/api/admin/dashboard", () => dashboard(db()));

  registerFileAdminRoutes(admin, { fetchImpl });
  removeRoute("files", "/api/admin/file-orders/:id");
  removeRoute("payments", "/api/admin/purchases/:id");
  removeRoute("customers", "/api/admin/customers/:id");

  for (const [name, collection] of Object.entries(COLLECTIONS)) {
    const label = name.replace(/s$/, "");
    const toForm = collection.toForm ?? ((entry) => entry);

    admin("GET", `/api/admin/${name}`, () => ({ items: db()[name].map(toForm) }));

    admin("POST", `/api/admin/${name}`, ({ body }) =>
      transact((data) => {
        const values = collection.validate(body, data);
        const now = new Date().toISOString();
        const item = { id: uniqueId(collection.id(values), new Set(data[name].map((entry) => entry.id))), ...values, createdAt: now, updatedAt: now };
        if (collection.prepend) data[name].unshift(item);
        else data[name].push(item);
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

    removeRoute(name, `/api/admin/${name}/:id`);
  }

  admin("GET", "/api/admin/orders", () => ({ items: db().orders, statuses: ORDER_STATUSES }));

  admin(
    "PATCH",
    "/api/admin/orders/:id",
    ({ body, params }) =>
      transact((data) => {
        const order = data.orders[findIndex(data.orders, params.id, "Order")];
        if (body.status !== undefined) setOrderStatus(data, order, body.status);
        if (body.adminNotes !== undefined) order.adminNotes = String(body.adminNotes).slice(0, 1000);
        order.updatedAt = new Date().toISOString();
        return { item: order };
      }),
    { role: "staff" }
  );

  removeRoute("orders", "/api/admin/orders/:id");

  admin("GET", "/api/admin/enquiries", () => ({ items: db().enquiries, statuses: ENQUIRY_STATUSES }));

  admin(
    "PATCH",
    "/api/admin/enquiries/:id",
    ({ body, params }) =>
      transact((data) => {
        const enquiry = data.enquiries[findIndex(data.enquiries, params.id, "Enquiry")];
        if (body.status !== undefined) {
          if (!ENQUIRY_STATUSES.includes(body.status)) throw new InputError("Unknown enquiry status.");
          enquiry.status = body.status;
        }
        if (body.notes !== undefined) enquiry.notes = String(body.notes).slice(0, 1000);
        enquiry.updatedAt = new Date().toISOString();
        return { item: enquiry };
      }),
    { role: "staff" }
  );

  removeRoute("enquiries", "/api/admin/enquiries/:id");

  admin("GET", "/api/admin/franchise", () => ({ items: db().franchiseLeads, statuses: FRANCHISE_STATUSES }));

  admin(
    "PATCH",
    "/api/admin/franchise/:id",
    ({ body, params }) =>
      transact((data) => {
        const lead = data.franchiseLeads[findIndex(data.franchiseLeads, params.id, "Application")];
        if (body.status !== undefined) {
          if (!FRANCHISE_STATUSES.includes(body.status)) throw new InputError("Unknown application status.");
          lead.status = body.status;
        }
        if (body.notes !== undefined) lead.notes = String(body.notes).slice(0, 2000);
        lead.updatedAt = new Date().toISOString();
        return { item: lead };
      }),
    { role: "staff" }
  );

  removeRoute("franchise", "/api/admin/franchise/:id");

  // Lists people send from the website (sign-ups, referrals): a status, private notes, delete.
  const statusList = (path, list, label, statuses, patch) => {
    admin("PATCH", `/api/admin/${path}/:id`, ({ body, params }) =>
      transact((data) => {
        const item = data[list][findIndex(data[list], params.id, label)];
        if (body.status !== undefined) {
          if (!statuses.includes(body.status)) throw new InputError(`Unknown ${label.toLowerCase()} status.`);
          item.status = body.status;
        }
        if (body.notes !== undefined) item.notes = String(body.notes).slice(0, 2000);
        patch?.(item, body);
        item.updatedAt = new Date().toISOString();
        return { item };
      })
    );
    removeRoute(path, `/api/admin/${path}/:id`);
  };

  admin("GET", "/api/admin/referrals", () => ({ items: db().referrals, statuses: REFERRAL_STATUSES }));
  statusList("referrals", "referrals", "Referral", REFERRAL_STATUSES, (item, body) => {
    if (body.reward !== undefined) {
      const reward = Number(body.reward);
      if (!Number.isFinite(reward) || reward < 0 || reward > 100_000) throw new InputError("Reward must be between 0 and 100000.");
      item.reward = Math.round(reward);
    }
  });

  admin("GET", "/api/admin/referrers", () => {
    const { referrers, referrals } = db();
    return { items: referrers.map((referrer) => ({ ...referrer, ...referrerSummary(referrer, referrals) })), statuses: REFERRER_STATUSES };
  });
  statusList("referrers", "referrers", "Sign-up", REFERRER_STATUSES, (item, body) => {
    if (body.upiId !== undefined) item.upiId = String(body.upiId).trim().slice(0, 60);
  });
  // After paying a code owner by UPI: everything confirmed for them becomes paid.
  admin("POST", "/api/admin/referrers/:id/paid", ({ params }) =>
    transact((data) => {
      const referrer = data.referrers[findIndex(data.referrers, params.id, "Sign-up")];
      const now = new Date().toISOString();
      let count = 0;
      for (const entry of data.referrals) {
        if (entry.referrerId !== referrer.id || entry.status !== "confirmed") continue;
        entry.status = "paid";
        entry.updatedAt = now;
        count++;
      }
      return { paid: count, item: { ...referrer, ...referrerSummary(referrer, data.referrals) } };
    })
  );

  admin("GET", "/api/admin/mechanics", () => ({ items: db().mechanics, statuses: MECHANIC_STATUSES }));
  statusList("mechanics", "mechanics", "Mechanic", MECHANIC_STATUSES, (item, body) => {
    if (body.rate !== undefined) {
      const rate = Number(body.rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100_000) throw new InputError("Price per session must be between 0 and 100000.");
      item.rate = Math.round(rate);
    }
  });

  admin("GET", "/api/admin/settings", () => ({ settings: db().settings, effective: settings() }));

  // Telegram alerts: linked chats, one-time link codes and a test message.
  admin("GET", "/api/admin/alerts", () => ({ chats: alertChats(), botUsername: botUsername(), botRunning: Boolean(sendAlert && botUsername()) }));

  admin(
    "POST",
    "/api/admin/alerts/link",
    () => {
      if (!sendAlert || !botUsername()) throw new InputError("The Telegram bot isn't running. Set TELEGRAM_BOT_TOKEN on the server and restart it.");
      const { code, expiresAt } = createLinkCode();
      return { code, expiresAt, url: `https://t.me/${botUsername()}?start=alerts_${code}`, _log: "Made a Telegram alert link code" };
    },
    { role: "owner" }
  );

  admin(
    "DELETE",
    "/api/admin/alerts/:chatId",
    ({ params }) => {
      if (!unlinkChat(params.chatId)) throw new HttpError(404, "That chat isn't linked.");
      return { ok: true, _log: "Removed a Telegram alert chat" };
    },
    { role: "owner" }
  );

  admin("POST", "/api/admin/alerts/test", async () => {
    if (!sendAlert) throw new InputError("The Telegram bot isn't running. Set TELEGRAM_BOT_TOKEN on the server and restart it.");
    if (!alertChats().length) throw new InputError("Link a Telegram chat first.");
    const sent = await broadcast({ text: `✅ Test alert from the ${settings().businessName} admin panel. New orders and enquiries will arrive here.` }, sendAlert);
    return { sent, _log: "Sent a test Telegram alert" };
  });

  // Settings hold the UPI ID payments go to, so only the owner changes them.
  admin(
    "PUT",
    "/api/admin/settings",
    ({ body }) =>
      transact((data) => {
        const before = data.settings;
        data.settings = { ...data.settings, ...validateSettings(body) };
        const changed = Object.keys(data.settings).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(data.settings[key]));
        return { settings: data.settings, _log: changed.length ? `Changed settings: ${changed.join(", ")}` : "" };
      }),
    { role: "owner" }
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
      return { url: `/uploads/${name}`, _log: "" };
    },
    { bodyLimit: 8_000_000 }
  );

  admin(
    "GET",
    "/api/admin/export",
    ({ res, user, ip }) => {
      const date = new Date().toISOString().slice(0, 10);
      logActivity(user, "Downloaded a backup", { ip });
      sendJson(res, 200, db(), { "Content-Disposition": `attachment; filename="unity-performance-backup-${date}.json"` });
    },
    { role: "owner" }
  );

  // A restore first saves the current data as a backup on the server, so it can be undone.
  admin(
    "POST",
    "/api/admin/import",
    ({ body }) => {
      const cleaned = cleanBackup(body);
      const saved = writeBackup("restore");
      replaceData(cleaned);
      return { ok: true, saved, _log: `Restored a backup file (the data before it was saved as ${saved})` };
    },
    { bodyLimit: 25_000_000, role: "owner" }
  );

  // ---------- Automatic backups on the server ----------

  admin("GET", "/api/admin/backups", () => ({ items: listBackups() }), { role: "owner" });

  admin("POST", "/api/admin/backups", () => {
    const name = writeBackup("manual");
    return { name, items: listBackups(), _log: `Made a backup on the server (${name})` };
  }, { role: "owner" });

  admin(
    "GET",
    "/api/admin/backups/:name",
    ({ res, params, user, ip }) => {
      let bytes;
      try {
        bytes = readBackup(params.name);
      } catch {
        throw new HttpError(404, "That backup doesn't exist.");
      }
      logActivity(user, `Downloaded the server backup ${params.name}`, { ip });
      res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${params.name}"`, "Cache-Control": "no-store" });
      res.end(bytes);
    },
    { role: "owner" }
  );

  admin(
    "POST",
    "/api/admin/backups/:name/restore",
    ({ params }) => {
      let backup;
      try {
        backup = JSON.parse(readBackup(params.name));
      } catch {
        throw new HttpError(404, "That backup doesn't exist or can't be read.");
      }
      const cleaned = cleanBackup(backup);
      const saved = writeBackup("restore");
      replaceData(cleaned);
      return { ok: true, saved, _log: `Restored the server backup ${params.name} (the data before it was saved as ${saved})` };
    },
    { role: "owner" }
  );

  // ---------- Staff accounts (owner only) ----------

  admin("GET", "/api/admin/staff", () => ({ items: db().staff.map(staffView), roles: STAFF_ROLES, minPassword: MIN_STAFF_PASSWORD }), { role: "owner" });

  admin("POST", "/api/admin/staff", ({ body }) => {
    const item = createStaff(body);
    return { item, _log: `Added staff member ${item.name} (${item.username}, ${item.role})` };
  }, { role: "owner" });

  admin("PATCH", "/api/admin/staff/:id", ({ body, params }) => {
    const item = updateStaff(params.id, body);
    if (body.password || item.active === false) endSessionsFor(item.id);
    const what = [body.role !== undefined && `role ${item.role}`, body.active !== undefined && (item.active ? "turned on" : "turned off"), body.password && "new password", body.name !== undefined && "name"].filter(Boolean);
    return { item, _log: `Changed staff member ${item.name}: ${what.join(", ") || "no changes"}` };
  }, { role: "owner" });

  admin("DELETE", "/api/admin/staff/:id", ({ params }) => {
    const item = removeStaff(params.id);
    endSessionsFor(item.id);
    return { ok: true, _log: `Removed staff member ${item.name} (${item.username})` };
  }, { role: "owner" });

  // Staff change their own password; the owner's is ADMIN_PASSWORD on the server.
  admin("POST", "/api/admin/me/password", ({ body, user }) => {
    if (user.role === "owner") throw new InputError("The owner's password is ADMIN_PASSWORD in the server's settings file. Change it there and restart the website.");
    changeOwnPassword(user.id, body.current, body.next);
    return { ok: true, _log: "Changed their password" };
  }, { role: "staff" });

  // ---------- Activity log ----------

  admin("GET", "/api/admin/activity", () => ({ items: db().activity }), { role: "manager" });

  // ---------- Recycle bin ----------

  admin("GET", "/api/admin/trash", () => {
    if (db().trash.some((entry) => Date.now() - Date.parse(entry.deletedAt) >= 30 * 24 * 60 * 60_000)) transact((data) => expireTrash(data));
    return { items: db().trash.map(({ records, ...entry }) => ({ ...entry, count: Object.values(records).reduce((sum, list) => sum + list.length, 0) })) };
  }, { role: "manager" });

  admin("POST", "/api/admin/trash/:id/restore", ({ params }) =>
    transact((data) => {
      const entry = restoreTrash(data, params.id);
      const first = Object.values(entry.records)[0]?.[0];
      return { ok: true, section: entry.section, id: first?.id ?? "", _log: `Restored ${entry.noun} ${entry.label} from the recycle bin` };
    })
  );

  admin("DELETE", "/api/admin/trash/:id", ({ params }) =>
    transact((data) => {
      const entry = purgeTrash(data, params.id);
      return { ok: true, _log: `Deleted ${entry.noun} ${entry.label} for good` };
    }), { role: "owner" });

  admin("DELETE", "/api/admin/trash", () =>
    transact((data) => {
      const count = data.trash.length;
      data.trash = [];
      return { ok: true, count, _log: `Emptied the recycle bin (${count} item${count === 1 ? "" : "s"})` };
    }), { role: "owner" });

  // ---------- Bulk actions ----------

  // Several rows at once: delete (to the recycle bin), set a status, or show / hide on the website.
  // All or nothing: if one row can't be changed, none are.
  admin(
    "POST",
    "/api/admin/bulk",
    ({ body, user }) => {
      const section = String(body?.section ?? "");
      const ids = [...new Set(Array.isArray(body?.ids) ? body.ids.map(String) : [])].slice(0, 2000);
      if (!ids.length) throw new InputError("Choose at least one row.");
      const kind = REMOVABLE[section];
      if (!kind) throw new InputError("Bulk changes aren't available here.");
      const action = String(body?.action ?? "");
      const staffCan = action === "status" && STAFF_BULK.has(section);
      if (!staffCan && !isRole(user, "manager")) throw new HttpError(403, "Your role can't do this. Ask the owner or a manager.");
      return transact((data) => {
        const items = ids.map((id) => {
          const item = data[kind.list].find((entry) => entry.id === id);
          if (!item) throw new InputError(`One of the chosen ${kind.noun}s no longer exists. Reload and try again.`);
          return item;
        });
        const many = `${ids.length} ${kind.noun}${ids.length === 1 ? "" : "s"}`;
        if (action === "delete") {
          for (const id of ids) trashItem(data, section, id, user);
          return { ok: true, count: ids.length, _log: `Deleted ${many}` };
        }
        if (action === "status") {
          const statuses = BULK_STATUSES[section];
          if (!statuses?.includes(body.status)) throw new InputError("Choose a status.");
          const now = new Date().toISOString();
          for (const item of items) {
            if (section === "orders") setOrderStatus(data, item, body.status);
            else item.status = body.status;
            item.updatedAt = now;
          }
          return { ok: true, count: ids.length, _log: `Set ${many} to “${body.status}”` };
        }
        if (action === "show" || action === "hide") {
          if (!items.every((item) => typeof item.active === "boolean")) throw new InputError(`${kind.noun[0].toUpperCase()}${kind.noun.slice(1)}s can't be shown or hidden.`);
          for (const item of items) item.active = action === "show";
          return { ok: true, count: ids.length, _log: `${action === "show" ? "Showed" : "Hid"} ${many} on the website` };
        }
        throw new InputError("Unknown bulk action.");
      });
    },
    { role: "staff" }
  );

  // ---------- Search everything ----------

  admin("GET", "/api/admin/search", ({ url }) => ({ results: searchAll(db(), url.searchParams.get("q") ?? "") }));
}

// Statuses a bulk change can set, per section. Staff may bulk-change only the first three.
const BULK_STATUSES = { orders: ORDER_STATUSES, enquiries: ENQUIRY_STATUSES, franchise: FRANCHISE_STATUSES, referrals: REFERRAL_STATUSES, referrers: REFERRER_STATUSES, mechanics: MECHANIC_STATUSES };
const STAFF_BULK = new Set(["orders", "enquiries", "franchise"]);

// The search box (Ctrl+K): orders, enquiries, customers, file orders, payments, leads and the
// catalogue, newest first, up to 8 per kind.
const SEARCHABLE = [
  ["orders", "orders", (item) => [item.number, item.customer?.name, item.customer?.phone], (item) => `Order ${item.number}`, (item) => `${item.customer?.name ?? ""} · ${item.status}`],
  ["enquiries", "enquiries", (item) => [item.customer?.name, item.customer?.phone, item.customer?.username, item.vehicle?.name, item.referralCode], (item) => `Enquiry from ${item.customer?.name || item.customer?.username || "Telegram customer"}`, (item) => item.vehicle?.name ?? ""],
  ["customers", "customers", (item) => [item.name, item.email, item.phone, item.workshop], (item) => item.name, (item) => item.email],
  ["files", "fileOrders", (item) => [item.number, item.vehicle?.make, item.vehicle?.model, item.vehicle?.engine, item.ecu], (item) => `File order ${item.number}`, (item) => [item.vehicle?.make, item.vehicle?.model, item.vehicle?.engine].filter(Boolean).join(" ")],
  ["payments", "creditPurchases", (item) => [item.number, item.utr], (item) => `Payment ${item.number}`, (item) => item.status],
  ["franchise", "franchiseLeads", (item) => [item.name, item.phone, item.city], (item) => `Franchise: ${item.name}`, (item) => item.city],
  ["referrers", "referrers", (item) => [item.name, item.phone, item.code], (item) => `${item.name} · ${item.code}`, (item) => "Refer & earn"],
  ["mechanics", "mechanics", (item) => [item.name, item.phone, item.area, item.city], (item) => `Mechanic: ${item.name}`, (item) => `${item.area}, ${item.city}`],
  ["products", "products", (item) => [item.name, item.category], (item) => item.name, (item) => `Product · ${item.category}`],
  ["vehicles", "vehicles", (item) => [item.brand, item.model, item.generation, item.engine], (item) => [item.brand, item.model, item.generation, item.engine].filter(Boolean).join(" "), () => "Vehicle"],
  ["ecus", "ecus", (item) => [item.title, item.id], (item) => item.title, () => "ECU"],
  ["offers", "offers", (item) => [item.title, item.badge], (item) => item.title, () => "Offer"]
];

function searchAll(data, query) {
  const words = String(query).toLowerCase().trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length || words.join("").length < 2) return [];
  const results = [];
  for (const [section, list, fields, title, sub] of SEARCHABLE) {
    let found = 0;
    for (const item of data[list]) {
      const text = fields(item).filter(Boolean).join(" ").toLowerCase();
      if (!words.every((word) => text.includes(word))) continue;
      results.push({ section, id: item.id, title: String(title(item) ?? ""), sub: String(sub(item) ?? "") });
      if (++found === 8) break;
    }
  }
  return results.slice(0, 60);
}

// The activity log's wording for a change no handler named.
const NOUNS = { ...Object.fromEntries(Object.entries(REMOVABLE).map(([section, kind]) => [section, kind.noun])), "file-orders": "file order", purchases: "payment", staff: "staff member" };
const ACTION_WORDS = { tuned: "Uploaded the tuned file for", credits: "Changed credits for", "reset-link": "Made a password reset link for", confirm: "Confirmed", cancel: "Cancelled", check: "Checked", paid: "Marked as paid:" };

function describeChange(method, path, body, result) {
  const [segment, , action] = path.split("/").slice(3);
  const noun = NOUNS[segment] ?? segment;
  const item = result?.item;
  const label = item ? item.number ?? item.name ?? item.title ?? item.code ?? item.customer?.name ?? "" : "";
  const named = label ? ` ${label}` : "";
  if (action) return `${ACTION_WORDS[action] ?? action} ${noun}${named}`;
  if (method === "POST") return `Added ${noun}${named}`;
  if (method === "PUT") return `Edited ${noun}${named}`;
  if (method === "PATCH") {
    const parts = [body?.status !== undefined && `status “${body.status}”`, (body?.notes !== undefined || body?.adminNotes !== undefined) && "notes", body?.reward !== undefined && `reward ₹${body.reward}`, body?.rate !== undefined && `price ₹${body.rate}`].filter(Boolean);
    return `Updated ${noun}${named}${parts.length ? `: ${parts.join(", ")}` : ""}`;
  }
  return `${method} ${path}`;
}

// The admin panel address of what changed, for the activity log.
const LINK_SECTIONS = { "file-orders": "files", purchases: "payments" };
function linkFor(path, params, result) {
  const segment = path.split("/")[3];
  const section = LINK_SECTIONS[segment] ?? segment;
  const id = result?.item?.id ?? params?.id ?? "";
  if (!REMOVABLE[section] || path.endsWith("/:id") && !result?.item) return "";
  return id ? `#${section}/${id}` : "";
}
