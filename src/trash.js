import { randomUUID } from "node:crypto";
import { InputError } from "./records.js";

// The recycle bin. Deleting anything in the admin panel moves it here, with the records that belong
// to it (a customer's credit history, payments and file orders go with the customer), for 30 days.
// Restoring puts everything back where it was; after 30 days, or when emptied, it's gone for good.

export const TRASH_DAYS = 30;
const MAX_TRASH = 2000;

const vehicleText = (vehicle) => [vehicle.brand, vehicle.model, vehicle.generation, vehicle.engine].filter(Boolean).join(" ");

// Admin section → the list it edits, what one item is called, and its name in the bin.
export const REMOVABLE = {
  orders: { list: "orders", noun: "order", label: (item) => item.number },
  enquiries: { list: "enquiries", noun: "enquiry", label: (item) => item.customer?.name || item.customer?.username || "Telegram customer" },
  franchise: { list: "franchiseLeads", noun: "franchise application", label: (item) => `${item.name}, ${item.city}` },
  referrals: { list: "referrals", noun: "referral", label: (item) => `${item.customer?.name} (${item.code})` },
  referrers: { list: "referrers", noun: "Refer & earn sign-up", label: (item) => `${item.name} (${item.code})` },
  mechanics: { list: "mechanics", noun: "mechanic", label: (item) => `${item.name}, ${item.area}` },
  files: { list: "fileOrders", noun: "file order", label: (item) => item.number },
  payments: { list: "creditPurchases", noun: "payment", label: (item) => item.number },
  customers: {
    list: "customers",
    noun: "customer",
    label: (item) => `${item.name} (${item.email})`,
    related: (data, item) => ({
      creditLedger: data.creditLedger.filter((entry) => entry.customerId === item.id),
      creditPurchases: data.creditPurchases.filter((entry) => entry.customerId === item.id),
      fileOrders: data.fileOrders.filter((entry) => entry.customerId === item.id)
    })
  },
  products: { list: "products", noun: "product", label: (item) => item.name },
  vehicles: { list: "vehicles", noun: "vehicle", label: vehicleText },
  ecus: { list: "ecus", noun: "ECU", label: (item) => item.title },
  brands: { list: "brands", noun: "brand", label: (item) => item.title },
  services: { list: "services", noun: "service", label: (item) => item.title },
  photos: { list: "photos", noun: "photo", label: (item) => item.caption || "Photo" },
  tuneOptions: { list: "tuneOptions", noun: "tune option", label: (item) => item.name },
  creditPacks: { list: "creditPacks", noun: "credit pack", label: (item) => item.name },
  franchisePackages: { list: "franchisePackages", noun: "franchise package", label: (item) => item.name },
  offers: { list: "offers", noun: "offer", label: (item) => item.title }
};

// Moves one item (and what belongs to it) to the bin. Returns the bin entry.
export function trashItem(data, section, id, by) {
  const kind = REMOVABLE[section];
  if (!kind) throw new InputError("That can't be deleted here.");
  const item = data[kind.list].find((entry) => entry.id === id);
  if (!item) throw Object.assign(new InputError(`That ${kind.noun} no longer exists.`), { status: 404 });
  if (section === "brands") {
    const used = data.vehicles.filter((vehicle) => vehicle.brand === id).length;
    if (used) throw new InputError(`The brand ${item.title} is used by ${used} vehicle${used === 1 ? "" : "s"}. Delete or move those first.`);
  }
  const records = { [kind.list]: [item], ...(kind.related?.(data, item) ?? {}) };
  const links = {};
  // An ECU is taken off the vehicles that list it, and put back on them if it's restored.
  if (section === "ecus") {
    links.vehicles = data.vehicles.filter((vehicle) => vehicle.ecus?.includes(id)).map((vehicle) => vehicle.id);
    for (const vehicle of data.vehicles) if (vehicle.ecus) vehicle.ecus = vehicle.ecus.filter((ecu) => ecu !== id);
  }
  // Where each record was, so a restore puts it back in the same place in its list.
  const positions = {};
  for (const [list, items] of Object.entries(records)) {
    const ids = new Set(items.map((entry) => entry.id));
    positions[list] = items.map((entry) => data[list].findIndex((candidate) => candidate.id === entry.id));
    data[list] = data[list].filter((entry) => !ids.has(entry.id));
  }
  const entry = { id: randomUUID(), section, noun: kind.noun, label: String(kind.label(item) ?? "").slice(0, 160), records, positions, links, deletedAt: new Date().toISOString(), deletedBy: by?.name ?? "" };
  data.trash.unshift(entry);
  data.trash.length = Math.min(data.trash.length, MAX_TRASH);
  return entry;
}

export function restoreTrash(data, trashId) {
  const index = data.trash.findIndex((entry) => entry.id === trashId);
  if (index < 0) throw new InputError("That's no longer in the recycle bin.");
  const entry = data.trash[index];
  for (const [list, items] of Object.entries(entry.records)) {
    if (!Array.isArray(data[list])) throw new InputError("That can't be restored.");
    const clash = items.find((item) => data[list].some((current) => current.id === item.id));
    if (clash) throw new InputError(`Can't restore: there's already a record with the same id (${clash.id}).`);
  }
  for (const customer of entry.records.customers ?? []) {
    if (data.customers.some((current) => current.email === customer.email)) throw new InputError(`Can't restore: another account now uses ${customer.email}.`);
  }
  for (const item of entry.records.referrers ?? []) {
    if (data.referrers.some((current) => current.code === item.code)) throw new InputError(`Can't restore: the code ${item.code} is in use again.`);
  }
  for (const [list, items] of Object.entries(entry.records)) {
    const placed = items.map((item, i) => [entry.positions?.[list]?.[i] ?? Infinity, item]).sort((a, b) => a[0] - b[0]);
    for (const [position, item] of placed) data[list].splice(Math.min(position, data[list].length), 0, item);
  }
  for (const vehicleId of entry.links?.vehicles ?? []) {
    const vehicle = data.vehicles.find((candidate) => candidate.id === vehicleId);
    const ecuId = entry.records.ecus?.[0]?.id;
    if (vehicle && ecuId && !vehicle.ecus.includes(ecuId)) vehicle.ecus.push(ecuId);
  }
  data.trash.splice(index, 1);
  return entry;
}

export function purgeTrash(data, trashId) {
  const index = data.trash.findIndex((entry) => entry.id === trashId);
  if (index < 0) throw new InputError("That's no longer in the recycle bin.");
  return data.trash.splice(index, 1)[0];
}

// Drops entries older than 30 days. Returns how many went.
export function expireTrash(data, now = Date.now()) {
  const keep = data.trash.filter((entry) => now - Date.parse(entry.deletedAt) < TRASH_DAYS * 24 * 60 * 60_000);
  const removed = data.trash.length - keep.length;
  if (removed) data.trash = keep;
  return removed;
}

// ECU files of file orders in the bin are kept, so a restored order still has them.
export const trashedFiles = (data) =>
  data.trash.flatMap((entry) => entry.records.fileOrders ?? []).flatMap((order) => [order.original?.file, order.tuned?.file, ...(order.extras ?? []).map((extra) => extra.file)]).filter(Boolean);
