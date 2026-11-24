import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { DATA_DIR, db, settings, transact } from "./db.js";
import { events } from "./events.js";
import { InputError } from "./records.js";
import { VEHICLE_MODELS } from "./data/vehicle-models.js";
import { brandsWithVehicles, getVehicle, vehiclesForBrand } from "./vehicles.js";

// The tuning file service: tuners and workshops open an account, buy credits, upload an original ECU
// read, choose a tune, and download the modified file when the workshop has made it. Credits are whole
// amounts with up to two decimals (e.g. 1.20); every change to a balance is written to creditLedger in
// the same step as the change.

const scrypt = promisify(scryptCallback);

export const ECU_FILE_DIR = join(DATA_DIR, "ecu-files");
export const FILE_ORDER_STATUSES = ["submitted", "in_progress", "completed", "rejected", "cancelled"];
export const PURCHASE_STATUSES = ["awaiting_payment", "submitted", "paid", "cancelled"];
// Closed orders have had their credits returned and can't be reopened.
const CLOSED = new Set(["rejected", "cancelled"]);
// Choices on the order form. Keys are stored on orders, so existing keys must keep their meaning.
export const TOOLS = {
  kess3: "Alientech KESS3",
  ktag: "Alientech KTAG",
  autotuner: "Autotuner",
  flex: "Magicmotorsport Flex",
  cmdflash: "CMDFlash",
  pcmflash: "PCMFlash",
  bflash: "bFlash",
  trasdata: "Trasdata",
  newgenius: "New Genius",
  other: "Other"
};
export const TOOL_MODES = { master: "Master", slave: "Slave" };
export const READ_METHODS = { obd: "OBD", bench: "Bench", boot: "Boot" };
export const VEHICLE_TYPES = { car: "Car", bike: "Motorbike", lcv: "Pickup / van", truck: "Truck / bus", agri: "Tractor / agriculture" };
export const FUELS = { petrol: "Petrol", diesel: "Diesel", cng: "Petrol + CNG", hybrid: "Hybrid" };
export const OCTANES = { ron91: "91 RON (regular)", ron95: "95 RON (premium)", ron100: "100 RON", e20: "E20", e85: "E85" };
export const GEARBOXES = { manual: "Manual", automatic: "Automatic" };
export const MODIFIED_PARTS = { no: "No, standard", yes: "Yes (list them in the info)" };
export const TIME_FRAMES = { asap: "As soon as possible", today: "Today", day: "Within 24 hours", relaxed: "No rush (2–3 days)" };
// Makes and their models for the order form's lists: data/vehicle-models.js plus every car in the
// vehicle database (whose entries also carry engines and figures).
export function modelsByMake() {
  const byMake = new Map(Object.entries(VEHICLE_MODELS).map(([make, models]) => [make, new Set(models)]));
  for (const brand of brandsWithVehicles()) {
    const models = byMake.get(brand.title) ?? byMake.set(brand.title, new Set()).get(brand.title);
    for (const vehicle of vehiclesForBrand(brand.id)) models.add(vehicle.model);
  }
  const sorted = (values) => [...values].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return Object.fromEntries(sorted(byMake.keys()).map((make) => [make, sorted(byMake.get(make))]));
}
export const makes = () => Object.keys(modelsByMake());
const MAX_EXTRA_FILES = 5;

const UPLOAD_ID = /^u[a-f0-9]{32}$/;
const MAX_OPEN_PURCHASES = 5;
const MAX_PENDING_UPLOADS = 10;
const UPLOAD_TTL_MS = 24 * 60 * 60_000;
const RESET_TTL_MS = 48 * 60 * 60_000;

const now = () => new Date().toISOString();
const newId = (prefix, bytes = 8) => `${prefix}${randomBytes(bytes).toString("hex")}`;
const clean = (value, max) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
const round2 = (value) => Math.round(value * 100) / 100;
const isCreditAmount = (value) => Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
// "1 credit", "3 credits", "1.20 credits".
export const creditText = (amount) => `${Number.isInteger(amount) ? amount : amount.toFixed(2)} credit${amount === 1 ? "" : "s"}`;

function required(value, label, { min = 1, max = 120 } = {}) {
  const text = clean(value, max);
  if (text.length < min) throw new InputError(`${label} is required.`);
  return text;
}

function oneOf(value, choices, label) {
  const key = String(value ?? "");
  if (!Object.hasOwn(choices, key)) throw new InputError(`Choose ${label}.`);
  return key;
}

const optionalChoice = (value, choices, label) => (value ? oneOf(value, choices, label) : "");

export function emailAddress(value) {
  const email = clean(value, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError("Please enter a valid email address.");
  return email;
}

function phoneNumber(value) {
  const phone = clean(value, 30);
  if (!/^\+?[\d\s().-]+$/.test(phone) || phone.replace(/\D/g, "").length < 6) throw new InputError("Please enter a valid phone number.");
  return phone;
}

// ---------- Accounts ----------

function checkPassword(value) {
  const password = String(value ?? "");
  if (password.length < 8) throw new InputError("Use a password of at least 8 characters.");
  if (password.length > 200) throw new InputError("That password is too long.");
  return password;
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  return { salt: salt.toString("hex"), hash: (await scrypt(password, salt, 32)).toString("hex") };
}

const DUMMY = { salt: "00".repeat(16), hash: "00".repeat(32) };

// A missing account takes as long to check as a wrong password, so timing doesn't reveal which emails exist.
export async function passwordMatches(customer, password) {
  const stored = customer?.password ?? DUMMY;
  const hash = await scrypt(String(password ?? ""), Buffer.from(stored.salt, "hex"), 32);
  return timingSafeEqual(hash, Buffer.from(stored.hash, "hex")) && Boolean(customer?.password);
}

export const customerByEmail = (email) => db().customers.find((customer) => customer.email === String(email ?? "").trim().toLowerCase());
export const customerById = (id) => db().customers.find((customer) => customer.id === id);

// What a signed-in customer sees about their own account.
export const accountView = ({ id, name, email, phone, company, credits }) => ({ id, name, email, phone, company, credits });

export async function createCustomer(input) {
  const values = {
    name: required(input?.name, "Your name", { min: 2, max: 80 }),
    email: emailAddress(input?.email),
    phone: phoneNumber(input?.phone),
    company: clean(input?.company, 80)
  };
  const password = await hashPassword(checkPassword(input?.password));
  return transact((data) => {
    if (data.customers.some((customer) => customer.email === values.email)) throw new InputError("There's already an account with this email. Sign in instead.");
    const time = now();
    const customer = { id: newId("c"), ...values, password, credits: 0, active: true, createdAt: time, updatedAt: time };
    data.customers.push(customer);
    return customer;
  });
}

export function updateCustomer(id, input, { admin = false } = {}) {
  return transact((data) => {
    const customer = findCustomer(data, id);
    if (input.name !== undefined) customer.name = required(input.name, "Name", { min: 2, max: 80 });
    if (input.phone !== undefined) customer.phone = phoneNumber(input.phone);
    if (input.company !== undefined) customer.company = clean(input.company, 80);
    if (admin && input.active !== undefined) customer.active = input.active === true;
    customer.updatedAt = now();
    return customer;
  });
}

export async function setPassword(id, password) {
  const hashed = await hashPassword(checkPassword(password));
  return transact((data) => {
    const customer = findCustomer(data, id);
    customer.password = hashed;
    delete customer.reset;
    customer.updatedAt = now();
    return customer;
  });
}

// Reset tokens are long and random, so a fast hash is enough; only the hash is stored.
const tokenHash = (token) => (/^[A-Za-z0-9_-]{43}$/.test(String(token ?? "")) ? createHash("sha256").update(String(token)).digest("hex") : "");

// The admin sends this link to a customer who forgot their password (there's no email sending).
export function createResetToken(id) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();
  transact((data) => {
    const customer = findCustomer(data, id);
    customer.reset = { hash: tokenHash(token), expiresAt };
  });
  return { token, expiresAt };
}

export async function resetPassword(token, password) {
  const hash = tokenHash(token);
  const customer = hash && db().customers.find((entry) => entry.reset?.hash === hash);
  if (!customer || Date.parse(customer.reset.expiresAt) < Date.now()) throw new InputError("This reset link has expired or was already used. Ask us for a new one.");
  return setPassword(customer.id, password);
}

function findCustomer(data, id) {
  const customer = data.customers.find((entry) => entry.id === id);
  if (!customer) throw Object.assign(new InputError("Customer not found."), { status: 404 });
  return customer;
}

// ---------- Credits ----------

// Changes a balance and records why. Runs inside transact, so the two always happen together.
function changeCredits(data, customer, change, reason, { note = "", ref = "" } = {}) {
  if (!isCreditAmount(change) || change === 0) throw new InputError("Enter an amount of credits other than 0, with at most two decimals.");
  if (round2(customer.credits + change) < 0) throw new InputError(`That would take the balance below zero (it's ${creditText(customer.credits)}).`);
  customer.credits = round2(customer.credits + change);
  customer.updatedAt = now();
  const entry = { id: newId("l", 6), customerId: customer.id, change, balance: customer.credits, reason, note: clean(note, 200), ref, createdAt: now() };
  data.creditLedger.unshift(entry);
  return entry;
}

export function adjustCredits(customerId, change, note) {
  const reason = clean(note, 200);
  if (!reason) throw new InputError("Add a note saying why, e.g. “Paid cash at the workshop”.");
  return transact((data) => {
    const customer = findCustomer(data, customerId);
    changeCredits(data, customer, Number(change), "admin", { note: reason });
    return customer;
  });
}

export const ledgerFor = (customerId, limit = 100) => db().creditLedger.filter((entry) => entry.customerId === customerId).slice(0, limit);

// ---------- Options and prices ----------

export const activeOptions = () => db().tuneOptions.filter((option) => option.active);
export const activePacks = () => db().creditPacks.filter((pack) => pack.active).sort((a, b) => a.credits - b.credits);

// An option's price with a tuning type, or null where it isn't offered with it. Options without
// per-type prices go with every tuning type at their own credits.
export function optionPrice(option, tuneId) {
  const prices = option.prices ?? {};
  if (!Object.keys(prices).length) return option.credits;
  return Object.hasOwn(prices, tuneId) ? prices[tuneId] : null;
}

// "Only options (car)" and the like: no tune of their own, so at least one option is needed.
export const optionsOnly = (tune) => /^options-/.test(tune.id) || /^only options/i.test(tune.name);

// Prices always come from the database, never from the customer's browser.
function priceOrder(data, tuneId, addonIds) {
  const options = data.tuneOptions.filter((option) => option.active);
  const tune = options.find((option) => option.id === tuneId && option.kind === "tune");
  if (!tune) throw new InputError("Choose a tuning type.");
  const ids = [...new Set(Array.isArray(addonIds) ? addonIds.map(String) : [])];
  const addons = ids.map((id) => {
    const addon = options.find((option) => option.id === id && option.kind === "addon");
    if (!addon) throw new InputError("One of the options you chose isn't offered any more. Refresh the page and choose again.");
    const price = optionPrice(addon, tune.id);
    if (price === null) throw new InputError(`${addon.name} isn't offered with ${tune.name}.`);
    return { ...addon, credits: price };
  });
  if (optionsOnly(tune) && !addons.length) throw new InputError(`Choose at least one option for ${tune.name}.`);
  const lines = [tune, ...addons].map(({ id, name, kind, credits }) => ({ id, name, kind, credits }));
  return { lines, credits: round2(lines.reduce((sum, line) => sum + line.credits, 0)) };
}

// ---------- Uploaded ECU files ----------

// An uploaded original waits here, for its customer only, until it's attached to an order. Files
// nobody ordered with are deleted after a day (see cleanEcuFiles).
const pendingUploads = new Map();

export const newUploadId = () => newId("u", 16);
export const ecuFilePath = (file) => join(ECU_FILE_DIR, file);

// Keeps the name a customer gave a file (for downloads), without paths or odd characters.
export function cleanFileName(value, fallback = "ecu-read.bin") {
  let name = String(value ?? "");
  try {
    name = decodeURIComponent(name);
  } catch {
    // Use it as sent.
  }
  name = name.split(/[\\/]/).pop().replace(/[^\p{L}\p{N} ._()+-]/gu, "_").replace(/\s+/g, " ").trim().slice(-100);
  return name && !/^\.+$/.test(name) ? name : fallback;
}

export function addPendingUpload(customerId, upload) {
  const mine = [...pendingUploads.values()].filter((entry) => entry.customerId === customerId);
  if (mine.length >= MAX_PENDING_UPLOADS) {
    const oldest = mine.sort((a, b) => a.createdAt - b.createdAt)[0];
    pendingUploads.delete(oldest.id);
    rmSync(ecuFilePath(oldest.file), { force: true });
  }
  pendingUploads.set(upload.id, { ...upload, customerId, createdAt: Date.now() });
}

// Removes files that no order uses: uploads never ordered with, after a day.
export function cleanEcuFiles() {
  const used = new Set(db().fileOrders.flatMap((order) => [order.original?.file, order.tuned?.file, ...(order.extras ?? []).map((extra) => extra.file)]).filter(Boolean));
  for (const entry of pendingUploads.values()) {
    if (Date.now() - entry.createdAt > UPLOAD_TTL_MS) pendingUploads.delete(entry.id);
    else used.add(entry.file);
  }
  let names = [];
  try {
    names = readdirSync(ECU_FILE_DIR);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of names) {
    if (used.has(name)) continue;
    const path = ecuFilePath(name);
    try {
      if (Date.now() - statSync(path).mtimeMs > UPLOAD_TTL_MS) {
        rmSync(path, { force: true });
        removed++;
      }
    } catch {
      // Already gone.
    }
  }
  return removed;
}

export function startFileCleanup() {
  cleanEcuFiles();
  setInterval(cleanEcuFiles, 6 * 60 * 60_000).unref();
}

// ---------- File orders ----------

// Make, model and engine are required; the rest helps the tuner and is optional. A car chosen from the
// vehicle database keeps its id (catalogId).
function vehicleDetails(input) {
  const year = input?.year === undefined || input?.year === null || input?.year === "" ? null : Number(input.year);
  if (year !== null && (!Number.isInteger(year) || year < 1980 || year > new Date().getFullYear() + 1)) throw new InputError("Enter the model year, e.g. 2019, or leave it empty.");
  const powerHp = input?.powerHp === undefined || input?.powerHp === null || input?.powerHp === "" ? null : Number(input.powerHp);
  if (powerHp !== null && (!Number.isFinite(powerHp) || powerHp < 5 || powerHp > 3000)) throw new InputError("Enter the power in hp, e.g. 110, or leave it empty.");
  const vin = clean(input?.vin, 20).toUpperCase().replace(/\s/g, "");
  if (vin && !/^[A-HJ-NPR-Z0-9]{11,17}$/.test(vin)) throw new InputError("A VIN has 17 letters and numbers (no I, O or Q). Check it, or leave it empty.");
  const catalog = input?.catalogId ? getVehicle(String(input.catalogId)) : null;
  return {
    type: oneOf(input?.vehicleType || "car", VEHICLE_TYPES, "the vehicle type"),
    make: required(input?.make, "Make", { max: 40 }),
    model: required(input?.model, "Model", { max: 60 }),
    generation: clean(input?.generation, 40),
    engine: required(input?.engine, "Engine", { max: 60 }),
    fuel: optionalChoice(input?.fuel, FUELS, "the fuel"),
    octane: optionalChoice(input?.octane, OCTANES, "the octane rating"),
    year,
    gearbox: optionalChoice(input?.gearbox, GEARBOXES, "manual or automatic"),
    plate: clean(input?.plate, 20).toUpperCase(),
    vin,
    powerHp: powerHp === null ? null : Math.round(powerHp),
    ...(catalog && catalog.source !== "ai" && { catalogId: catalog.id })
  };
}

// The customer's own pending uploads for the given ids, or an error naming what's wrong.
function takeUploads(customerId, ids, label) {
  return ids.map((id) => {
    const upload = UPLOAD_ID.test(id) && pendingUploads.get(id);
    if (!upload || upload.customerId !== customerId) throw new InputError(`${label} didn't finish uploading. Remove it and add it again.`);
    return upload;
  });
}

export function createFileOrder(customerId, input) {
  const uploadId = String(input?.uploadId ?? "");
  const upload = UPLOAD_ID.test(uploadId) && pendingUploads.get(uploadId);
  if (!upload || upload.customerId !== customerId) throw new InputError("Upload your original ECU file first.");
  const extraIds = [...new Set(Array.isArray(input?.extraUploadIds) ? input.extraUploadIds.map(String) : [])].filter((id) => id !== uploadId);
  if (extraIds.length > MAX_EXTRA_FILES) throw new InputError(`Add up to ${MAX_EXTRA_FILES} extra files.`);
  const extras = takeUploads(customerId, extraIds, "An extra file");
  const details = {
    tool: oneOf(input?.tool, TOOLS, "the tool you read the ECU with"),
    toolMode: oneOf(input?.toolMode, TOOL_MODES, "whether your tool is a master or a slave"),
    readMethod: oneOf(input?.readMethod, READ_METHODS, "how the ECU was read"),
    vehicle: vehicleDetails(input),
    ecu: clean(input?.ecu, 80),
    hardwareNumber: clean(input?.hardwareNumber, 40),
    softwareNumber: clean(input?.softwareNumber, 40),
    modifiedParts: oneOf(input?.modifiedParts, MODIFIED_PARTS, "whether the vehicle has modified parts"),
    timeFrame: oneOf(input?.timeFrame, TIME_FRAMES, "when you need the file"),
    notes: String(input?.notes ?? "").trim().slice(0, 1000)
  };
  if (input?.confirmed !== true) throw new InputError("Tick the box to confirm this is the complete original read from this vehicle.");
  const order = transact((data) => {
    if (!data.settings.fileServiceOpen) throw new InputError("We aren't taking new file orders right now. Please message us on WhatsApp.");
    const customer = findCustomer(data, customerId);
    const { lines, credits } = priceOrder(data, input?.tuneId, input?.addonIds);
    if (customer.credits < credits) throw new InputError(`This order needs ${creditText(credits)} and you have ${creditText(customer.credits)}. Buy credits first.`);
    const time = now();
    const entry = {
      id: newId("f"),
      number: `TF-${data.nextFileOrderNumber++}`,
      customerId,
      status: "submitted",
      ...details,
      options: lines,
      credits,
      message: "",
      adminNotes: "",
      original: { file: upload.file, name: upload.name, size: upload.size, sha256: upload.sha256 },
      extras: extras.map(({ file, name, size, sha256 }) => ({ file, name, size, sha256 })),
      tuned: null,
      provider: null,
      refunded: false,
      createdAt: time,
      updatedAt: time
    };
    if (credits > 0) changeCredits(data, customer, -credits, "order", { ref: entry.number });
    data.fileOrders.unshift(entry);
    return entry;
  });
  for (const id of [uploadId, ...extraIds]) pendingUploads.delete(id);
  events.emit("fileOrder", order);
  return order;
}

// What the customer sees: no private notes or stored file names, and the tuned file only once it's ready.
export function customerOrderView(order) {
  const { id, number, status, vehicle, ecu, ecuNumbers, hardwareNumber, softwareNumber, tool, toolMode, readMethod, modifiedParts, timeFrame, options, credits, notes, message, createdAt, updatedAt, completedAt } = order;
  return {
    id, number, status, vehicle, ecu, ecuNumbers, hardwareNumber, softwareNumber, tool, toolMode, readMethod, modifiedParts, timeFrame, options, credits, notes, message, createdAt, updatedAt, completedAt,
    original: { name: order.original.name, size: order.original.size },
    extras: (order.extras ?? []).map(({ name, size }) => ({ name, size })),
    tuned: order.status === "completed" && order.tuned ? { name: order.tuned.name, size: order.tuned.size } : null
  };
}

export const ordersFor = (customerId) => db().fileOrders.filter((order) => order.customerId === customerId);

function findOrder(data, id) {
  const order = data.fileOrders.find((entry) => entry.id === id);
  if (!order) throw Object.assign(new InputError("File order not found."), { status: 404 });
  return order;
}

// Closing an order returns its credits, once.
function closeOrder(data, order, status) {
  order.status = status;
  if (!order.refunded && order.credits > 0) {
    const customer = data.customers.find((entry) => entry.id === order.customerId);
    if (customer) changeCredits(data, customer, order.credits, "refund", { ref: order.number });
  }
  order.refunded = true;
}

export function cancelFileOrder(customerId, orderId) {
  return transact((data) => {
    const order = findOrder(data, orderId);
    if (order.customerId !== customerId) throw Object.assign(new InputError("File order not found."), { status: 404 });
    if (order.status !== "submitted") throw new InputError("We've already started on this file, so it can't be cancelled here. Message us instead.");
    closeOrder(data, order, "cancelled");
    order.updatedAt = now();
    return order;
  });
}

export function updateFileOrder(orderId, input) {
  return transact((data) => {
    const order = findOrder(data, orderId);
    if (input.status !== undefined && input.status !== order.status) {
      if (!FILE_ORDER_STATUSES.includes(input.status)) throw new InputError("Unknown status.");
      if (CLOSED.has(order.status)) throw new InputError("This order is closed and its credits were returned. Ask the customer to place a new order.");
      if (input.status === "completed" && !order.tuned) throw new InputError("Upload the tuned file first.");
      if (CLOSED.has(input.status)) closeOrder(data, order, input.status);
      else order.status = input.status;
      if (input.status === "completed") order.completedAt = now();
    }
    if (input.message !== undefined) order.message = String(input.message).trim().slice(0, 500);
    if (input.adminNotes !== undefined) order.adminNotes = String(input.adminNotes).trim().slice(0, 1000);
    if (input.providerReference !== undefined) {
      const reference = clean(input.providerReference, 60);
      order.provider = reference ? { name: "fast-chiptuningfiles.com", reference, sentAt: order.provider?.sentAt ?? now() } : null;
      if (reference && order.status === "submitted") order.status = "in_progress";
    }
    order.updatedAt = now();
    return order;
  });
}

// Stores the tuned file on an order and marks it ready. Returns the order and the replaced file, if any.
export function attachTunedFile(orderId, file) {
  return transact((data) => {
    const order = findOrder(data, orderId);
    if (CLOSED.has(order.status)) throw new InputError("This order is closed, so it can't take a file.");
    const replaced = order.tuned?.file ?? null;
    order.tuned = { ...file, uploadedAt: now() };
    order.status = "completed";
    order.completedAt = now();
    order.updatedAt = now();
    return { order, replaced };
  });
}

// ---------- Buying credits ----------

export function createPurchase(customerId, packId, method) {
  return transact((data) => {
    const customer = findCustomer(data, customerId);
    const pack = data.creditPacks.find((entry) => entry.id === packId && entry.active);
    if (!pack) throw new InputError("That credit pack isn't available any more. Refresh the page.");
    const open = data.creditPurchases.filter((entry) => entry.customerId === customerId && ["awaiting_payment", "submitted"].includes(entry.status));
    if (open.length >= MAX_OPEN_PURCHASES) throw new InputError("You have several payments waiting. Finish or cancel one of those first.");
    const time = now();
    const purchase = {
      id: newId("p"),
      number: `CR-${data.nextPurchaseNumber++}`,
      customerId: customer.id,
      packId: pack.id,
      packName: pack.name,
      credits: pack.credits,
      amount: pack.price,
      currency: data.settings.currency,
      method,
      status: "awaiting_payment",
      utr: "",
      gateway: null,
      createdAt: time,
      updatedAt: time
    };
    data.creditPurchases.unshift(purchase);
    return purchase;
  });
}

export const purchasesFor = (customerId) => db().creditPurchases.filter((purchase) => purchase.customerId === customerId);
export const purchaseById = (id) => db().creditPurchases.find((purchase) => purchase.id === id);

function findPurchase(data, id) {
  const purchase = data.creditPurchases.find((entry) => entry.id === id);
  if (!purchase) throw Object.assign(new InputError("Payment not found."), { status: 404 });
  return purchase;
}

export function setPurchaseGateway(id, gateway) {
  return transact((data) => {
    const purchase = findPurchase(data, id);
    purchase.gateway = gateway;
    purchase.updatedAt = now();
    return purchase;
  });
}

// The customer says they've paid by UPI and gives the transaction reference (UTR) for the admin to check.
export function submitUpiReference(customerId, id, reference) {
  const utr = clean(reference, 40).replace(/\s/g, "");
  if (!/^[A-Za-z0-9]{6,35}$/.test(utr)) throw new InputError("Enter the UPI transaction reference (UTR), usually 12 digits, from your payment app.");
  const purchase = transact((data) => {
    const entry = findPurchase(data, id);
    if (entry.customerId !== customerId) throw Object.assign(new InputError("Payment not found."), { status: 404 });
    if (entry.method !== "upi" || !["awaiting_payment", "submitted"].includes(entry.status)) throw new InputError("This payment can't be changed now.");
    entry.utr = utr;
    entry.status = "submitted";
    entry.updatedAt = now();
    return entry;
  });
  events.emit("creditPayment", purchase);
  return purchase;
}

// Adds the credits for a payment once. by is "admin" (checked by hand) or "razorpay" (verified).
export function confirmPurchase(id, { by, reference = "" }) {
  return transact((data) => {
    const purchase = findPurchase(data, id);
    if (purchase.status === "paid") return { purchase, added: false };
    if (purchase.status === "cancelled" && by !== "razorpay") throw new InputError("This payment was cancelled.");
    const customer = findCustomer(data, purchase.customerId);
    changeCredits(data, customer, purchase.credits, "purchase", { ref: purchase.number, note: reference ? `${by === "razorpay" ? "Razorpay" : "UPI"} ${reference}` : "" });
    purchase.status = "paid";
    purchase.paidAt = now();
    purchase.confirmedBy = by;
    if (reference && by === "razorpay") purchase.gateway = { ...purchase.gateway, paymentId: reference };
    purchase.updatedAt = now();
    return { purchase, added: true };
  });
}

export function cancelPurchase(id, { customerId } = {}) {
  return transact((data) => {
    const purchase = findPurchase(data, id);
    if (customerId && purchase.customerId !== customerId) throw Object.assign(new InputError("Payment not found."), { status: 404 });
    if (purchase.status === "paid") throw new InputError("This payment is complete, so it can't be cancelled. Adjust the customer's credits instead.");
    purchase.status = "cancelled";
    purchase.updatedAt = now();
    return purchase;
  });
}

// UPI payment details for a purchase. The upi:// link opens the customer's payment app on a phone.
export function upiDetails(purchase) {
  const { upiId, upiName, businessName } = settings();
  if (!upiId) return null;
  const params = new URLSearchParams({ pa: upiId, pn: upiName || businessName, am: purchase.amount.toFixed(2), cu: "INR", tn: `${businessName} ${purchase.number}`.slice(0, 50) });
  return { id: upiId, name: upiName || businessName, url: `upi://pay?${params.toString().replace(/\+/g, "%20")}` };
}

export const upiAvailable = () => Boolean(settings().upiId) && settings().currency === "INR";

export function customerPurchaseView(purchase) {
  const { id, number, packName, credits, amount, currency, method, status, utr, createdAt, paidAt } = purchase;
  return {
    id, number, packName, credits, amount, currency, method, status, utr, createdAt, paidAt,
    ...(method === "upi" && status === "awaiting_payment" && { upi: upiDetails(purchase) }),
    ...(method === "razorpay" && status === "awaiting_payment" && purchase.gateway?.url && { payUrl: purchase.gateway.url })
  };
}
