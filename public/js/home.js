import { dynoChart } from "./chart.js";
import { $, $$, api, bootPage, h, loadProducts, observeReveals, productCard, reducedMotion, whatsappUrl } from "./common.js";
import { icon } from "./icons.js";

const STORY_VEHICLE = "vw_golf7_gti";
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const FUEL_LABEL = { petrol: "Petrol", diesel: "Diesel", hybrid: "Hybrid", electric: "Electric" };
const ASPIRATION_LABEL = { turbo: "turbo", supercharged: "supercharged", naturally_aspirated: "naturally aspirated" };

const { site } = await bootPage();
const { settings } = site;

// ---------- Scroll-linked hero and story ----------

const hero = $("[data-hero]");
const story = $("[data-story]");
const scrollHandlers = [];
let ticking = false;
addEventListener(
  "scroll",
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      for (const handler of scrollHandlers) handler();
    });
  },
  { passive: true }
);

if (settings.heroImage) {
  const media = $("[data-hero-media]");
  media.style.backgroundImage = `url("${settings.heroImage}")`;
  media.classList.add("has-image");
}
if (!reducedMotion()) {
  scrollHandlers.push(() => hero.style.setProperty("--hero-progress", clamp(scrollY / hero.offsetHeight).toFixed(3)));
}

function curvePath(rpm, values, scaleMax, minRpm, maxRpm) {
  return `M${rpm.map((r, i) => `${(((r - minRpm) / (maxRpm - minRpm)) * 600).toFixed(1)},${(250 - (values[i] / scaleMax) * 230).toFixed(1)}`).join("L")}`;
}

async function setupStory() {
  let data;
  try {
    data = await api(`/api/vehicles/${STORY_VEHICLE}`);
  } catch {
    const { vehicles } = await api("/api/vehicles");
    if (!vehicles.length) return;
    data = await api(`/api/vehicles/${vehicles[0].id}`);
  }
  const { vehicle, curves } = data;
  const minRpm = curves.stock.rpm[0];
  const maxRpm = Math.max(curves.stock.rpm.at(-1), curves.stage1.rpm.at(-1));
  const scaleMax = vehicle.stage1.hp * 1.05;
  const stockPath = $("[data-story-stock]", story);
  const stagePath = $("[data-story-stage1]", story);
  stockPath.setAttribute("d", curvePath(curves.stock.rpm, curves.stock.power, scaleMax, minRpm, maxRpm));
  stagePath.setAttribute("d", curvePath(curves.stage1.rpm, curves.stage1.power, scaleMax, minRpm, maxRpm));
  $("[data-story-vehicle]", story).textContent = `${vehicle.brand} ${vehicle.model} ${vehicle.generation}`;
  const length = stagePath.getTotalLength();
  stagePath.style.strokeDasharray = `${length}`;
  const steps = $$("[data-step]", story);
  const hp = $("[data-story-hp]", story);
  const delta = $("[data-story-delta]", story);

  const update = () => {
    const total = story.offsetHeight - innerHeight;
    const progress = reducedMotion() ? 1 : clamp(-story.getBoundingClientRect().top / total);
    story.style.setProperty("--story-progress", progress.toFixed(3));
    const active = progress < 0.34 ? 0 : progress < 0.67 ? 1 : 2;
    steps.forEach((step, i) => step.classList.toggle("is-active", i === active));
    const gain = ease(clamp((progress - 0.3) / 0.5));
    const current = Math.round(vehicle.stock.hp + (vehicle.stage1.hp - vehicle.stock.hp) * gain);
    hp.textContent = String(current);
    delta.textContent = gain === 0 ? "Stock" : `+${current - vehicle.stock.hp} hp with Stage 1`;
    delta.classList.toggle("is-gain", gain > 0);
    stagePath.style.strokeDashoffset = `${length * (1 - gain)}`;
  };
  scrollHandlers.push(update);
  update();
}

// ---------- Finder ----------

const finder = {
  input: $("[data-search-input]"),
  results: $("[data-search-results]"),
  panel: $("[data-vehicle-panel]"),
  chips: $("[data-brand-chips]"),
  current: null
};

function resultCard(vehicle, index) {
  return h(
    "button",
    { class: "result-card", type: "button", style: { "--delay": `${index * 0.04}s` }, "aria-pressed": String(finder.current?.id === vehicle.id), onclick: () => openVehicle(vehicle.id) },
    h("strong", { text: `${vehicle.brand} ${vehicle.model}` }),
    h("span", { text: [vehicle.generation, vehicle.engine, vehicle.years].filter(Boolean).join(" · ") }),
    h("span", { class: "result-gain", text: `${vehicle.stock.hp} → ${vehicle.stage1.hp} hp  ·  +${vehicle.gain.hpPercent}%` })
  );
}

function showResults(vehicles, query) {
  if (vehicles.length) {
    finder.results.replaceChildren(...vehicles.map(resultCard));
    return;
  }
  const empty = h("div", { class: "empty-state" }, h("p", { text: query ? `We don't have “${query}” in our database yet.` : "No vehicles found." }));
  if (query && site.aiEnabled) {
    empty.append(h("button", { class: "btn btn-primary", type: "button", text: "Ask AI to identify it", onclick: () => identifyWithAi(query, empty) }));
  } else if (settings.whatsappNumber) {
    empty.append(h("a", { class: "btn", href: whatsappUrl(settings.whatsappNumber, `Hello ${settings.businessName}, do you tune a ${query}?`), target: "_blank", rel: "noopener", text: "Ask us on WhatsApp" }));
  }
  finder.results.replaceChildren(empty);
}

async function identifyWithAi(query, container) {
  const button = $("button", container);
  button.disabled = true;
  button.textContent = "Identifying…";
  try {
    const data = await api(`/api/vehicles/identify?q=${encodeURIComponent(query)}`);
    renderPanel(data, { query });
  } catch (error) {
    button.disabled = false;
    button.textContent = "Ask AI to identify it";
    container.append(h("p", { class: "form-error", role: "alert", text: error.message }));
  }
}

let searchTimer;
let searchToken = 0;
async function search(query) {
  const token = ++searchToken;
  for (const chip of $$(".chip", finder.chips)) chip.setAttribute("aria-pressed", "false");
  const trimmed = query.trim();
  const { vehicles } = await api(trimmed ? `/api/vehicles?q=${encodeURIComponent(trimmed)}` : "/api/vehicles");
  if (token !== searchToken) return;
  showResults(trimmed ? vehicles : vehicles.slice(0, 6), trimmed);
}

finder.input.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => search(finder.input.value).catch(() => {}), 180);
});
finder.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $(".result-card", finder.results)?.click();
  }
});

function setupBrandChips() {
  finder.chips.replaceChildren(
    ...site.brands.map((brand) => {
      const chip = h("button", { class: "chip", type: "button", "aria-pressed": "false", text: brand.title });
      chip.addEventListener("click", async () => {
        finder.input.value = "";
        const token = ++searchToken;
        const { vehicles } = await api(`/api/vehicles?brand=${encodeURIComponent(brand.id)}`);
        if (token !== searchToken) return;
        for (const other of $$(".chip", finder.chips)) other.setAttribute("aria-pressed", String(other === chip));
        showResults(vehicles);
      });
      return chip;
    })
  );
}

async function openVehicle(id, { scroll = true } = {}) {
  const data = await api(`/api/vehicles/${encodeURIComponent(id)}`);
  renderPanel(data, { scroll });
  history.replaceState(null, "", `#car=${encodeURIComponent(id)}`);
  for (const card of $$(".result-card", finder.results)) card.setAttribute("aria-pressed", "false");
}

function statTile(label, stockValue, stageValue, unit, percent) {
  return h(
    "div",
    { class: "stat-tile" },
    h("p", { class: "label", text: `${label}, Stage 1` }),
    h("p", { class: "value" }, String(stageValue), h("small", { text: unit })),
    h("p", { class: "delta" }, h("strong", { text: `+${stageValue - stockValue} ${unit}` }), ` (+${percent}%) vs ${stockValue} ${unit} stock`)
  );
}

function renderPanel({ vehicle, curves }, { scroll = true, query } = {}) {
  finder.current = vehicle;
  const panel = finder.panel;
  panel.hidden = false;
  const name = `${vehicle.brand} ${vehicle.model} ${vehicle.generation}`.trim();
  const meta = [vehicle.engine, [FUEL_LABEL[vehicle.fuel], ASPIRATION_LABEL[vehicle.aspiration]].filter(Boolean).join(" "), vehicle.years].filter(Boolean).join(" · ");
  const head = h("header", { class: "vehicle-head" }, h("p", { class: "eyebrow", text: "Stage 1 estimate" }), h("h3", { text: name }), h("p", { class: "meta", text: meta }));
  if (vehicle.source === "ai") head.append(h("p", { class: "badge", text: `AI estimate · ${vehicle.confidence} confidence${vehicle.notes ? ` · ${vehicle.notes}` : ""}` }));

  if (!vehicle.tunable) {
    panel.replaceChildren(head, h("p", { class: "lead", text: "We don't offer Stage 1 software for hybrid or electric drivetrains, but we're happy to advise on other options." }));
  } else {
    const book = h("button", { class: "btn btn-primary", type: "button", text: "Book Stage 1", onclick: () => openEnquiry(vehicle, query) });
    const actions = h("div", { class: "vehicle-actions" }, book);
    if (vehicle.source === "catalog") actions.append(h("a", { class: "link-arrow", href: `/api/vehicles/${encodeURIComponent(vehicle.id)}/graph.png`, download: `${vehicle.id}-stage1.png`, text: "Download dyno sheet" }));
    panel.replaceChildren(
      head,
      h("div", { class: "stat-tiles" }, statTile("Power", vehicle.stock.hp, vehicle.stage1.hp, "hp", vehicle.gain.hpPercent), statTile("Torque", vehicle.stock.nm, vehicle.stage1.nm, "Nm", vehicle.gain.nmPercent)),
      dynoChart(curves),
      actions,
      h("p", { class: "fineprint", text: "Estimates for a healthy, standard vehicle on good fuel. Final figures are confirmed on our dyno." })
    );
  }
  panel.style.animation = "none";
  void panel.offsetWidth;
  panel.style.animation = "";
  if (scroll) panel.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
}

// ---------- Enquiry sheet ----------

const dialog = $("[data-enquiry-dialog]");

function closeButton() {
  const button = h("button", { class: "icon-button sheet-close", type: "button", "aria-label": "Close", onclick: () => dialog.close() });
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  return button;
}

function ecuSelect(vehicle) {
  const common = site.ecus.filter((ecu) => vehicle.ecus.includes(ecu.id));
  const others = site.ecus.filter((ecu) => !vehicle.ecus.includes(ecu.id) && ecu.fuels.includes(vehicle.fuel));
  const option = (ecu) => h("option", { value: ecu.id, text: ecu.title });
  return h(
    "select",
    { name: "ecu" },
    h("option", { value: "unknown", text: "Not sure: please check for me" }),
    common.length ? h("optgroup", { label: "Commonly fitted to this car" }, ...common.map(option)) : null,
    h("optgroup", { label: "Other ECUs" }, ...others.map(option))
  );
}

function openEnquiry(vehicle, query) {
  const error = h("p", { class: "form-error", role: "alert", hidden: true });
  const location = h("input", { name: "location", autocomplete: "address-level2", placeholder: "City or area" });
  const useLocation = h("button", { class: "inline-button", type: "button", text: "Use my current location" });
  useLocation.addEventListener("click", () => {
    if (!navigator.geolocation) return;
    useLocation.textContent = "Finding you…";
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        location.value = `https://maps.google.com/?q=${coords.latitude.toFixed(5)},${coords.longitude.toFixed(5)}`;
        useLocation.textContent = "Location added ✓";
      },
      () => (useLocation.textContent = "Couldn't get your location. Type your city instead."),
      { timeout: 10000 }
    );
  });
  const submit = h("button", { class: "btn btn-primary btn-block", type: "submit", text: "Send enquiry" });
  const form = h(
    "form",
    { class: "form", novalidate: true },
    h("div", { class: "field-row" },
      h("label", { class: "field" }, h("span", { text: "Name" }), h("input", { name: "name", required: true, autocomplete: "name" })),
      h("label", { class: "field" }, h("span", { text: "Phone (WhatsApp)" }), h("input", { name: "phone", type: "tel", required: true, autocomplete: "tel" }))
    ),
    h("label", { class: "field" }, h("span", { text: "ECU" }), ecuSelect(vehicle)),
    h("label", { class: "field" }, h("span", { text: "Where is the car?" }), location),
    useLocation,
    h("label", { class: "field" }, h("span", { text: "Message (optional)" }), h("textarea", { name: "message", rows: 3, placeholder: "Preferred day, modifications, questions…" })),
    error,
    submit
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    submit.textContent = "Sending…";
    const fields = form.elements;
    try {
      const result = await api("/api/enquiries", {
        method: "POST",
        body: {
          name: fields.name.value,
          phone: fields.phone.value,
          ecu: fields.ecu.value,
          location: fields.location.value,
          message: fields.message.value,
          ...(vehicle.source === "catalog" ? { vehicleId: vehicle.id } : { vehicleText: `${vehicle.brand} ${vehicle.model} ${vehicle.generation} ${vehicle.engine}`.trim() || query })
        }
      });
      inner.replaceChildren(
        h("div", { class: "success" },
          h("div", { class: "success-icon", text: "✓", "aria-hidden": "true" }),
          h("h3", { text: "Enquiry received" }),
          h("p", { text: "Send it to us on WhatsApp and we'll confirm a time with you." }),
          h("a", { class: "btn btn-whatsapp btn-block", href: result.whatsappUrl, target: "_blank", rel: "noopener", text: "Send on WhatsApp" })
        )
      );
    } catch (failure) {
      error.textContent = failure.message;
      error.hidden = false;
      submit.disabled = false;
      submit.textContent = "Send enquiry";
    }
  });
  const inner = h(
    "div",
    { class: "sheet-inner" },
    h("h2", { id: "enquiry-title", text: "Book Stage 1" }),
    h("p", { class: "sheet-sub", text: `${vehicle.brand} ${vehicle.model} ${vehicle.generation} · ${vehicle.stock.hp} → ${vehicle.stage1.hp} hp` }),
    form
  );
  dialog.replaceChildren(closeButton(), inner);
  dialog.showModal();
  $("input", form).focus();
}

dialog.addEventListener("click", (event) => {
  if (event.target === dialog) dialog.close();
});

// ---------- Numbers, services, ECUs, shop, visit ----------

function countUp(element, target, { prefix = "", suffix = "" } = {}) {
  const show = (value) => (element.textContent = `${prefix}${Math.round(value)}${suffix}`);
  if (reducedMotion()) return show(target);
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    const start = performance.now();
    const frame = (now) => {
      const t = clamp((now - start) / 1400);
      show(target * ease(t));
      if (t < 1) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  observer.observe(element);
}

async function setupNumbers() {
  const { vehicles } = await api("/api/vehicles");
  const average = vehicles.length ? vehicles.reduce((sum, vehicle) => sum + vehicle.gain.hpPercent, 0) / vehicles.length : 0;
  countUp($('[data-stat="vehicles"]'), site.vehicleCount);
  countUp($('[data-stat="ecus"]'), site.ecus.filter((ecu) => ecu.status === "supported").length);
  countUp($('[data-stat="gain"]'), average, { prefix: "+", suffix: "%" });
}

function setupServices() {
  const gallery = $("[data-services]");
  gallery.replaceChildren(
    ...site.services.map((service) =>
      h(
        "article",
        { class: "service-card" },
        h("div", { class: "service-icon" }, icon(service.icon)),
        h("h3", { text: service.title }),
        h("p", { text: service.summary }),
        h("p", { class: "price", text: service.priceLabel || "Ask for a quote" })
      )
    )
  );
  const previous = $("[data-gallery-prev]");
  const next = $("[data-gallery-next]");
  const step = () => ($(".service-card", gallery)?.offsetWidth ?? 320) + 20;
  const sync = () => {
    previous.disabled = gallery.scrollLeft <= 4;
    next.disabled = gallery.scrollLeft + gallery.clientWidth >= gallery.scrollWidth - 4;
  };
  previous.addEventListener("click", () => gallery.scrollBy({ left: -step(), behavior: "smooth" }));
  next.addEventListener("click", () => gallery.scrollBy({ left: step(), behavior: "smooth" }));
  gallery.addEventListener("scroll", sync, { passive: true });
  sync();
}

function setupEcus() {
  const order = { supported: 0, on_request: 1, not_supported: 2 };
  const labels = { supported: "Supported", on_request: "On request", not_supported: "Not supported" };
  $("[data-ecus]").replaceChildren(
    ...[...site.ecus]
      .sort((a, b) => order[a.status] - order[b.status])
      .map((ecu, i) =>
        h(
          "li",
          { class: "ecu-item reveal", style: { "--delay": `${(i % 4) * 0.06}s` } },
          h("strong", { text: ecu.title }),
          h("p", { text: [ecu.fuels.map((fuel) => FUEL_LABEL[fuel]).join(" & "), ecu.method].filter(Boolean).join(" · ") }),
          h("span", { class: `status status-${ecu.status}`, text: labels[ecu.status] })
        )
      )
  );
}

async function setupFeaturedProducts() {
  const products = await loadProducts();
  const featured = (products.some((product) => product.featured) ? products.filter((product) => product.featured) : products).slice(0, 4);
  $("[data-featured-products]").replaceChildren(
    ...featured.map((product, i) => productCard(product, settings.currency, () => (location.href = `/shop#${encodeURIComponent(product.id)}`), i * 0.08))
  );
}

function setupVisit() {
  const details = $("[data-visit-details]");
  const actions = $("[data-visit-actions]");
  const rows = [
    ["Address", settings.address],
    ["Opening hours", settings.hours],
    ["Phone", settings.phone && h("a", { href: `tel:${settings.phone.replace(/[^\d+]/g, "")}`, text: settings.phone })],
    ["Email", settings.email && h("a", { href: `mailto:${settings.email}`, text: settings.email })]
  ].filter(([, value]) => value);
  details.replaceChildren(...rows.flatMap(([label, value]) => [h("dt", { text: label }), h("dd", {}, value)]));
  const hasCoordinates = Number.isFinite(settings.latitude) && Number.isFinite(settings.longitude);
  if (hasCoordinates || settings.address) {
    const destination = hasCoordinates ? `${settings.latitude},${settings.longitude}` : settings.address;
    actions.append(h("a", { class: "btn btn-primary", href: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`, target: "_blank", rel: "noopener", text: "Get directions" }));
  }
  if (settings.whatsappNumber) actions.append(h("a", { class: "btn btn-whatsapp", href: whatsappUrl(settings.whatsappNumber, `Hello ${settings.businessName}, I have a question about tuning.`), target: "_blank", rel: "noopener", text: "WhatsApp us" }));
  if (settings.telegramBot) actions.append(h("a", { class: "link-arrow", href: `https://t.me/${settings.telegramBot}`, target: "_blank", rel: "noopener", text: "Chat with our Telegram bot" }));
  if (!rows.length && !actions.children.length) details.replaceChildren(h("dd", { class: "lead", text: "Message us to arrange a visit." }));
}

setupServices();
setupEcus();
setupVisit();
setupBrandChips();
observeReveals();
await Promise.allSettled([
  setupStory(),
  setupNumbers(),
  setupFeaturedProducts(),
  search("").then(() => {
    const car = new URLSearchParams(location.hash.slice(1)).get("car");
    if (car) return openVehicle(car, { scroll: true });
  })
]);
