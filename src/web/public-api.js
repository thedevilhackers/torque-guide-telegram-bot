import { ecus } from "../catalog.js";
import { db, settings } from "../db.js";
import { buildDynoCurves, renderStageChart } from "../dyno-chart.js";
import { createEnquiry, createOrder, orderText } from "../records.js";
import { aiEnabled, identifyVehicle } from "../tuning-service.js";
import { availableStages, brandsWithVehicles, getVehicle, searchVehicles, stageFigures, stageGain, vehicleEntries, vehiclesForBrand } from "../vehicles.js";
import { enquiryText, whatsappLink } from "../whatsapp.js";
import { HttpError, rateLimiter, readJson, sameOrigin, sendBuffer } from "./http.js";

const PUBLIC_SETTINGS = [
  "businessName", "tagline", "heroTitle", "heroSubtitle", "heroImage", "announcement", "currency", "shopNote", "deliveryFee", "whatsappNumber",
  "phone", "email", "address", "latitude", "longitude", "hours", "instagram", "facebook", "tiktok", "youtube", "stage2Note", "stage3Note"
];

export function vehicleSummary(vehicle) {
  const { id, source, brand, brandId, model, generation, years, engine, fuel, aspiration, ecus: ecuIds = [], stock, stage1, tunable, confidence, notes } = vehicle;
  return {
    id, source, brand, brandId, model, generation, years, engine, fuel, aspiration, ecus: ecuIds, stock, stage1, tunable, confidence, notes,
    gain: tunable ? stageGain(vehicle, 1) : null,
    stages: availableStages(vehicle).map((stage) => ({ stage, ...stageFigures(vehicle, stage), gain: stageGain(vehicle, stage) }))
  };
}

const round = (value) => Math.round(value * 10) / 10;

// Stock and every available stage, sampled every 100 rpm (plenty for a smooth SVG line).
export function vehicleCurves(vehicle) {
  const sample = (curve) => {
    const keep = curve.rpm.map((rpm, i) => (rpm % 100 === 0 ? i : -1)).filter((i) => i >= 0);
    return { rpm: keep.map((i) => curve.rpm[i]), power: keep.map((i) => round(curve.power[i])), torque: keep.map((i) => round(curve.torque[i])) };
  };
  const stages = Object.fromEntries(availableStages(vehicle).map((stage) => [stage, buildDynoCurves(vehicle, stage)]));
  return { stock: sample(stages[1].stock), stages: Object.fromEntries(Object.entries(stages).map(([stage, curves]) => [stage, sample(curves.tuned)])) };
}

// Public POSTs must come from this site as JSON; each IP gets a modest allowance of accepted orders
// and enquiries (a rejected one holds no stock and sends no alert, so it isn't counted). An order
// holds its items' stock straight away, so orders get the tightest limit.
const tooMany = () => new HttpError(429, "Too many requests. Please wait a while and try again, or message us on WhatsApp.");

async function publicPost(req, ip, limiter) {
  if (!sameOrigin(req)) throw new HttpError(403, "Requests must come from this website.");
  if (limiter.blocked(ip)) throw tooMany();
  return readJson(req, 50_000);
}

// Checks the allowance again in the same step as saving: requests sent at the same moment all pass
// the check above while their bodies arrive, so only this one can be relied on.
function accept(limiter, ip, create) {
  if (limiter.blocked(ip)) throw tooMany();
  const result = create();
  limiter.hit(ip);
  return result;
}

export function registerPublicRoutes(route, { botUsername }) {
  const orderLimiter = rateLimiter({ windowMs: 60 * 60_000, max: 5 });
  const enquiryLimiter = rateLimiter({ windowMs: 60 * 60_000, max: 10 });
  const aiLimiter = rateLimiter({ windowMs: 60 * 60_000, max: 8 });
  const graphLimiter = rateLimiter({ windowMs: 60_000, max: 60 });

  route("GET", "/healthz", ({ res }) => sendBuffer(res, 200, Buffer.from("ok"), "text/plain; charset=utf-8", { "Cache-Control": "no-store" }));

  route("GET", "/api/site", () => {
    const current = settings();
    return {
      settings: { ...Object.fromEntries(PUBLIC_SETTINGS.map((key) => [key, current[key]])), telegramBot: current.telegramBot || botUsername() },
      brands: brandsWithVehicles().map(({ id, title }) => ({ id, title })),
      ecus: ecus().map(({ id, title, fuels, status, method }) => ({ id, title, fuels, status, method })),
      services: db().services.filter((service) => service.active),
      vehicleCount: vehicleEntries().length,
      aiEnabled: aiEnabled()
    };
  });

  route("GET", "/api/vehicles", ({ url }) => {
    const query = (url.searchParams.get("q") ?? "").slice(0, 80);
    const brand = url.searchParams.get("brand");
    const vehicles = query ? searchVehicles(query, 12) : brand ? vehiclesForBrand(brand) : vehicleEntries().map((entry) => getVehicle(entry.id));
    return { vehicles: vehicles.map(vehicleSummary) };
  });

  // Registered before /api/vehicles/:id so "identify" isn't read as a vehicle id.
  route("GET", "/api/vehicles/identify", async ({ url, ip }) => {
    if (!aiEnabled()) throw new HttpError(404, "AI search isn't available.");
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    if (query.length < 3) throw new HttpError(400, "Describe your vehicle: make, model, engine and year.");
    if (!aiLimiter.hit(ip)) throw new HttpError(429, "You've reached the AI search limit. Please try again later or message us.");
    const vehicle = await identifyVehicle(`web:${ip}`, query);
    if (!vehicle) throw new HttpError(404, "We couldn't identify that vehicle. Try the make, model, engine size and year.");
    return { vehicle: vehicleSummary(vehicle), curves: vehicle.tunable ? vehicleCurves(vehicle) : null };
  });

  route("GET", "/api/vehicles/:id", ({ params }) => {
    const vehicle = getVehicle(params.id);
    if (!vehicle) throw new HttpError(404, "Vehicle not found.");
    return { vehicle: vehicleSummary(vehicle), curves: vehicleCurves(vehicle) };
  });

  route("GET", "/api/vehicles/:id/graph.png", ({ res, params, url, ip }) => {
    if (!graphLimiter.hit(ip)) throw new HttpError(429, "Too many graph requests. Please wait a minute.");
    const vehicle = getVehicle(params.id);
    const stage = Number(url.searchParams.get("stage") ?? 1);
    if (!vehicle) throw new HttpError(404, "Vehicle not found.");
    if (!availableStages(vehicle).includes(stage)) throw new HttpError(404, `No Stage ${stage} figures for this vehicle.`);
    sendBuffer(res, 200, renderStageChart(vehicle, { businessName: settings().businessName, stage }), "image/png", { "Cache-Control": "no-cache" });
  });

  route("GET", "/api/products", () => ({
    products: db()
      .products.filter((product) => product.active)
      .map(({ id, name, category, price, compareAtPrice, stock, description, features, image, featured }) => ({ id, name, category, price, compareAtPrice, stock, description, features, image, featured }))
  }));

  route("POST", "/api/orders", async ({ req, ip }) => {
    const input = await publicPost(req, ip, orderLimiter);
    const order = accept(orderLimiter, ip, () => createOrder(input));
    return {
      order: { number: order.number, items: order.items, subtotal: order.subtotal, deliveryFee: order.deliveryFee, total: order.total, currency: order.currency, fulfilment: order.fulfilment },
      whatsappUrl: whatsappLink(orderText(order, settings().businessName))
    };
  });

  route("POST", "/api/enquiries", async ({ req, ip }) => {
    const input = await publicPost(req, ip, enquiryLimiter);
    const { enquiry, vehicle, stage } = accept(enquiryLimiter, ip, () => createEnquiry(input));
    const text = enquiryText({
      vehicle,
      stage,
      ecu: enquiry.ecu,
      customer: { name: enquiry.customer.name },
      location: enquiry.location ? { text: enquiry.location } : undefined,
      message: [enquiry.vehicle?.source === "ai" ? `Vehicle: ${enquiry.vehicle.name} (AI estimate)` : "", enquiry.message].filter(Boolean).join(". ")
    });
    return { id: enquiry.id, whatsappUrl: whatsappLink(text) };
  });
}
