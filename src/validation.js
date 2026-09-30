import { InputError } from "./records.js";

// Validates admin-panel input and converts it to the stored shape. Throws InputError with a
// message the admin can act on.

const SERVICE_ICONS = ["bolt", "gauge", "wave", "scan", "chip", "wrench"];
const ECU_STATUSES = ["supported", "on_request", "not_supported"];
const FUELS = ["petrol", "diesel"];
const ASPIRATIONS = ["turbo", "supercharged", "naturally_aspirated"];
const UPLOAD_PATH = /^\/uploads\/[a-f0-9]{32}\.(png|jpg|webp)$/;

export function slugify(value, separator = "-") {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, "g"), "")
    .slice(0, 48);
}

function text(value, label, { max = 120, required = false } = {}) {
  const result = String(value ?? "").trim();
  if (required && !result) throw new InputError(`${label} is required.`);
  if (result.length > max) throw new InputError(`${label} must be ${max} characters or fewer.`);
  return result;
}

function number(value, label, { min = -Infinity, max = Infinity, integer = false, optional = false } = {}) {
  if (optional && (value === "" || value === null || value === undefined)) return null;
  const result = Number(value);
  if (value === "" || value === null || value === undefined || !Number.isFinite(result)) throw new InputError(`${label} must be a number.`);
  if (integer && !Number.isInteger(result)) throw new InputError(`${label} must be a whole number.`);
  if (result < min || result > max) throw new InputError(`${label} must be between ${min} and ${max}.`);
  return result;
}

const bool = (value) => value === true || value === "true" || value === "on" || value === 1;

// Accepts an array or newline/comma-separated text.
function list(value, label, { max = 10, itemMax = 120, split = /\r?\n/ } = {}) {
  const items = (Array.isArray(value) ? value : String(value ?? "").split(split)).map((item) => String(item).trim()).filter(Boolean);
  if (items.length > max) throw new InputError(`${label} can have at most ${max} entries.`);
  for (const item of items) if (item.length > itemMax) throw new InputError(`Each entry in ${label} must be ${itemMax} characters or fewer.`);
  return items;
}

function oneOf(value, label, options) {
  if (!options.includes(value)) throw new InputError(`${label} must be one of: ${options.join(", ")}.`);
  return value;
}

function uploadedImage(value, label) {
  const image = text(value, label, { max: 80 });
  if (image && !UPLOAD_PATH.test(image)) throw new InputError(`${label}: upload the image with the Upload button.`);
  return image;
}

function httpsUrl(value, label) {
  const url = text(value, label, { max: 200 });
  if (url && !/^https:\/\/[^\s]+$/i.test(url)) throw new InputError(`${label} must be a link starting with https://`);
  return url;
}

export function validateProduct(input) {
  const price = Math.round(number(input.price, "Price", { min: 0, max: 10_000_000 }) * 100) / 100;
  const compareAtPrice = number(input.compareAtPrice, "Compare-at price", { min: 0, max: 10_000_000, optional: true });
  if (compareAtPrice !== null && compareAtPrice <= price) throw new InputError("Compare-at price must be higher than the price (or left empty).");
  const image = uploadedImage(input.image, "Image");
  return {
    name: text(input.name, "Name", { required: true, max: 100 }),
    category: text(input.category, "Category", { required: true, max: 40 }),
    price,
    compareAtPrice,
    stock: number(input.stock, "Stock", { min: 0, max: 1_000_000, integer: true, optional: true }),
    description: text(input.description, "Description", { max: 2000 }),
    features: list(input.features, "Features"),
    image,
    featured: bool(input.featured),
    active: bool(input.active)
  };
}

// The Stage 1 graph can only match both peaks inside these limits (see dyno-chart.js tests).
function checkPowerTorque(hp, nm, label) {
  const ratio = nm / hp;
  if (ratio < 0.8 || ratio > 3.5) throw new InputError(`${label}: torque (Nm) must be between 0.8× and 3.5× the power (hp). Check the figures.`);
}

export function validateVehicle(input, { brandIds, ecuIds }) {
  const fuel = oneOf(input.fuel, "Fuel", FUELS);
  const aspiration = fuel === "diesel" ? "turbo" : oneOf(input.aspiration, "Aspiration", ASPIRATIONS);
  const yearFrom = number(input.yearFrom, "Year from", { min: 1950, max: 2100, integer: true });
  const yearTo = number(input.yearTo, "Year to", { min: yearFrom, max: 2100, integer: true, optional: true });
  const stock = [number(input.stockHp, "Stock power", { min: 40, max: 1500, integer: true }), number(input.stockNm, "Stock torque", { min: 50, max: 2500, integer: true })];
  const stage1 = [number(input.stage1Hp, "Stage 1 power", { min: 40, max: 2400, integer: true }), number(input.stage1Nm, "Stage 1 torque", { min: 50, max: 4000, integer: true })];
  if (stage1[0] < stock[0] * 1.03 || stage1[1] < stock[1] * 1.03) throw new InputError("Stage 1 power and torque must be at least 3% above stock.");
  if (stage1[0] > stock[0] * 1.6 || stage1[1] > stock[1] * 1.6) throw new InputError("Stage 1 gains above 60% aren't realistic for software only. Check the figures.");
  checkPowerTorque(stock[0], stock[1], "Stock");
  checkPowerTorque(stage1[0], stage1[1], "Stage 1");
  const redline = number(input.redline, "Redline", { min: 3000, max: 10000, integer: true, optional: true });
  const torqueFrom = number(input.torqueFrom, "Peak torque from", { min: 1200, max: 7000, integer: true, optional: true });
  if (redline && torqueFrom && torqueFrom > redline - 1000) throw new InputError("Peak torque must start at least 1,000 rpm below the redline.");
  const brand = text(input.brand, "Brand", { required: true });
  if (!brandIds.includes(brand)) throw new InputError("Choose a brand from the list (add new brands under Brands).");
  const ecus = list(input.ecus, "ECUs", { split: /[\n,]/ });
  for (const ecu of ecus) if (!ecuIds.includes(ecu)) throw new InputError(`Unknown ECU "${ecu}".`);
  return {
    brand,
    model: text(input.model, "Model", { required: true, max: 40 }),
    generation: text(input.generation, "Generation", { max: 30 }),
    years: yearTo ? [yearFrom, yearTo] : [yearFrom],
    engine: text(input.engine, "Engine", { required: true, max: 50 }),
    fuel,
    aspiration,
    stock,
    stage1,
    ecus,
    keywords: text(input.keywords, "Search keywords", { max: 120 }),
    ...(redline && { redline }),
    ...(torqueFrom && { torqueFrom })
  };
}

export function validateEcu(input) {
  const fuels = list(input.fuels, "Fuels", { split: /[\n,]/ }).filter((fuel) => FUELS.includes(fuel));
  if (!fuels.length) throw new InputError("Choose at least one fuel.");
  return {
    title: text(input.title, "Name", { required: true, max: 60 }),
    fuels,
    status: oneOf(input.status, "Status", ECU_STATUSES),
    method: text(input.method, "Method", { max: 120 })
  };
}

export function validateBrand(input) {
  return {
    title: text(input.title, "Name", { required: true, max: 40 }),
    aliases: list(input.aliases, "Search aliases", { split: /[\n,]/, itemMax: 20 }).map((alias) => alias.toLowerCase())
  };
}

export function validateService(input) {
  return {
    title: text(input.title, "Title", { required: true, max: 60 }),
    summary: text(input.summary, "Summary", { required: true, max: 300 }),
    priceLabel: text(input.priceLabel, "Price label", { max: 40 }),
    icon: oneOf(input.icon, "Icon", SERVICE_ICONS),
    active: bool(input.active)
  };
}

export function validateSettings(input) {
  const telegramBot = text(input.telegramBot, "Telegram bot username", { max: 40 }).replace(/^@/, "");
  if (telegramBot && !/^[A-Za-z0-9_]{5,32}$/.test(telegramBot)) throw new InputError("Telegram bot username can only contain letters, numbers and underscores.");
  const currency = text(input.currency, "Currency", { required: true, max: 3 }).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new InputError("Currency must be a 3-letter code such as USD, EUR or LKR.");
  const latitude = number(input.latitude, "Latitude", { min: -90, max: 90, optional: true });
  const longitude = number(input.longitude, "Longitude", { min: -180, max: 180, optional: true });
  if ((latitude === null) !== (longitude === null)) throw new InputError("Enter both latitude and longitude, or neither.");
  return {
    businessName: text(input.businessName, "Business name", { required: true, max: 60 }),
    tagline: text(input.tagline, "Tagline", { max: 80 }),
    heroTitle: text(input.heroTitle, "Headline", { required: true, max: 60 }),
    heroSubtitle: text(input.heroSubtitle, "Sub-headline", { max: 200 }),
    heroImage: uploadedImage(input.heroImage, "Hero image"),
    announcement: text(input.announcement, "Announcement bar", { max: 140 }),
    currency,
    shopNote: text(input.shopNote, "Shop note", { max: 200 }),
    deliveryFee: number(input.deliveryFee, "Delivery fee", { min: 0, max: 100_000 }),
    whatsappNumber: text(input.whatsappNumber, "WhatsApp number", { max: 30 }).replace(/\D/g, ""),
    telegramBot,
    phone: text(input.phone, "Phone", { max: 30 }),
    email: text(input.email, "Email", { max: 120 }),
    address: text(input.address, "Address", { max: 200 }),
    latitude,
    longitude,
    hours: text(input.hours, "Opening hours", { max: 120 }),
    instagram: httpsUrl(input.instagram, "Instagram"),
    facebook: httpsUrl(input.facebook, "Facebook"),
    tiktok: httpsUrl(input.tiktok, "TikTok"),
    youtube: httpsUrl(input.youtube, "YouTube")
  };
}

// Stored vehicles → the flat shape the admin form edits.
export function vehicleFormValues(entry) {
  return {
    ...entry,
    yearFrom: entry.years[0],
    yearTo: entry.years[1] ?? "",
    stockHp: entry.stock[0],
    stockNm: entry.stock[1],
    stage1Hp: entry.stage1[0],
    stage1Nm: entry.stage1[1],
    redline: entry.redline ?? "",
    torqueFrom: entry.torqueFrom ?? ""
  };
}
