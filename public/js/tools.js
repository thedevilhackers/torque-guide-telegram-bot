// Tool support page: search a car to see its usual ECU and how Autotuner and KESS3 read it, plus
// the full support list by ECU family. All text is inserted with textContent (see h()).
import { $, $$, api, bootPage, h, observeReveals, whatsappUrl } from "./common.js";

const TOOLS = { autotuner: "Autotuner", kess3: "KESS3" };
const METHODS = { obd: "OBD", bench: "Bench", boot: "Boot" };
const STATUS = { supported: "We tune it", on_request: "On request", not_supported: "Not supported" };
const STATUS_ORDER = { supported: 0, on_request: 1, not_supported: 2 };
const FUELS = { petrol: "Petrol", diesel: "Diesel" };
// Alientech's own KESS3 vehicle list: complete and always current.
const KESS3_LIST = "https://www.alientech-tools.com/en/vehicles";

const { site } = await bootPage();
const { settings } = site;
const ecuById = new Map(site.ecus.map((ecu) => [ecu.id, ecu]));
const whatsapp = (text) => (settings.whatsappNumber ? whatsappUrl(settings.whatsappNumber, text) : "");

const finder = { input: $("[data-tool-search]"), results: $("[data-tool-results]"), panel: $("[data-tool-panel]") };
const ecuFinder = { input: $("[data-ecu-search]"), results: $("[data-ecu-results]"), source: $("[data-ecu-source]") };
// The name Autotuner's list uses for one of our brands, when it differs.
const LIST_BRANDS = { maruti: "Suzuki" };

// other: Autotuner's list shows a method icon this page can't name, so it points to autotuner.com.
function methodChips(methods = [], { beta = [], unlock = false, other = false, none = "Not listed" } = {}) {
  if (!methods.length && !other) return h("span", { class: "methods-none", text: none });
  return h(
    "span",
    { class: "methods" },
    ...methods.map((method) => h("span", { class: `method method-${method}`, text: `${METHODS[method] ?? method}${beta.includes(method) ? " · beta" : ""}` })),
    unlock ? h("span", { class: "method method-unlock", text: "Unlock" }) : null,
    other ? h("span", { class: "method method-unlock", title: "Another method; see autotuner.com", text: "Other" }) : null
  );
}

function toolRows(ecu) {
  return h("dl", { class: "tool-rows" }, ...Object.entries(TOOLS).flatMap(([id, name]) => [h("dt", { text: name }), h("dd", {}, methodChips(ecu.tools?.[id]))]));
}

const vehicleTitle = (vehicle) => `${vehicle.brand} ${vehicle.model}${vehicle.generation ? ` ${vehicle.generation}` : ""}`;

// ---------- One car ----------

function showVehicle(vehicle) {
  const fitted = (vehicle.ecus ?? []).map((id) => ecuById.get(id)).filter(Boolean);
  const meta = [vehicle.engine, FUELS[vehicle.fuel], vehicle.years].filter(Boolean).join(" · ");
  const head = h("header", { class: "vehicle-head" }, h("p", { class: "eyebrow", text: "Tool support" }), h("h3", { text: vehicleTitle(vehicle) }), h("p", { class: "meta", text: meta }));
  const actions = h("div", { class: "vehicle-actions" }, h("a", { class: "btn btn-primary", href: `/finder#car=${encodeURIComponent(vehicle.id)}`, text: "See the Stage 1 gains" }));
  const question = whatsapp(`Hello ${settings.businessName}, can you read my ${vehicleTitle(vehicle)} (${vehicle.engine})?`);
  if (question) actions.append(h("a", { class: "btn btn-whatsapp", href: question, target: "_blank", rel: "noopener", text: "Ask us on WhatsApp" }));
  actions.append(h("a", { class: "link-arrow", href: KESS3_LIST, target: "_blank", rel: "noopener", text: "Full KESS3 list" }));

  const body = fitted.length
    ? [
        h("p", { class: "tool-intro", text: fitted.length > 1 ? "One of these ECUs is usually fitted:" : "Usually fitted ECU:" }),
        h(
          "div",
          { class: "ecu-support-grid" },
          ...fitted.map((ecu) =>
            h(
              "section",
              { class: "ecu-support" },
              h("div", { class: "ecu-support-head" }, h("strong", { text: ecu.title }), h("span", { class: `status status-${ecu.status}`, text: STATUS[ecu.status] ?? ecu.status })),
              toolRows(ecu),
              ecu.method ? h("p", { class: "ecu-support-method", text: ecu.method }) : null
            )
          )
        ),
        h("p", { class: "fineprint", text: "Support depends on the exact ECU hardware and software number. We confirm it with the tool before we start, and your original file is always backed up." })
      ]
    : [h("p", { class: "tool-intro", text: "The ECU on this model varies. Send us a photo of the ECU label, or come in for a quick scan, and we'll check it against the Autotuner and KESS3 lists." })];

  finder.panel.replaceChildren(head, ...body, actions);
  finder.panel.hidden = false;
  listLink(vehicle, actions).catch((error) => console.error(error));
  for (const card of $$(".result-card", finder.results)) card.setAttribute("aria-pressed", String(card.dataset.id === vehicle.id));
  history.replaceState(null, "", `#car=${encodeURIComponent(vehicle.id)}`);
}

// ---------- Search ----------

let searchToken = 0;
let searchTimer;

function resultCard(vehicle, index) {
  const fitted = (vehicle.ecus ?? []).map((id) => ecuById.get(id)?.title).filter(Boolean);
  return h(
    "button",
    { class: "result-card", type: "button", style: { "--delay": `${index * 0.04}s` }, dataset: { id: vehicle.id }, "aria-pressed": "false", onclick: () => showVehicle(vehicle) },
    h("strong", { text: `${vehicle.brand} ${vehicle.model}` }),
    h("span", { text: [vehicle.generation, vehicle.engine, vehicle.years].filter(Boolean).join(" · ") }),
    h("span", { class: "result-gain", text: fitted.length ? fitted.join(" or ") : "ECU checked on the car" })
  );
}

async function search(query) {
  const token = ++searchToken;
  const trimmed = query.trim();
  if (!trimmed) {
    finder.results.replaceChildren();
    return;
  }
  const { vehicles } = await api(`/api/vehicles?q=${encodeURIComponent(trimmed)}`);
  if (token !== searchToken) return;
  if (vehicles.length) {
    finder.results.replaceChildren(...vehicles.map(resultCard));
    return;
  }
  const empty = h("div", { class: "empty-state" }, h("p", { text: `We don't have “${trimmed}” in our list yet. Send us a photo of the ECU label and we'll check it for you.` }));
  const ask = whatsapp(`Hello ${settings.businessName}, can you read my ${trimmed} with Autotuner or KESS3? I'll send a photo of the ECU label.`);
  if (ask) empty.append(h("a", { class: "btn btn-whatsapp", href: ask, target: "_blank", rel: "noopener", text: "Send us the ECU label" }));
  empty.append(h("p", {}, h("a", { class: "link-arrow", href: KESS3_LIST, target: "_blank", rel: "noopener", text: "Search the full KESS3 list on Alientech's website" })));
  finder.results.replaceChildren(empty);
}

finder.input.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => search(finder.input.value).catch((error) => console.error(error)), 180);
});
finder.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    $(".result-card", finder.results)?.click();
  }
});

// ---------- Autotuner ECU list ----------

let ecuToken = 0;
let ecuTimer;

function showSource(source) {
  const date = new Date(`${source.exported}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  ecuFinder.source.replaceChildren(
    `From Autotuner's compatibility list (${source.size.toLocaleString("en-IN")} ECUs, exported ${date}). Autotuner updates often, so always confirm on `,
    h("a", { href: source.url, target: "_blank", rel: "noopener", text: "autotuner.com" }),
    "."
  );
}

function ecuTable(results) {
  return h(
    "table",
    { class: "support-table" },
    h("thead", {}, h("tr", {}, ...["ECU", "Brand", "Chip", "Autotuner"].map((label) => h("th", { scope: "col", text: label })))),
    h(
      "tbody",
      {},
      ...results.map((entry) =>
        h(
          "tr",
          {},
          h("th", { scope: "row", text: `${entry.ecuBrand} ${entry.ecu}` }),
          h("td", { dataset: { label: "Brand" }, text: entry.brand || "—" }),
          h("td", { dataset: { label: "Chip" }, text: entry.mcu || "—" }),
          h("td", { dataset: { label: "Autotuner" } }, methodChips(entry.methods, { beta: entry.beta, unlock: entry.unlock, other: entry.other, none: "Listed, no method yet" }))
        )
      )
    )
  );
}

async function searchEcus(query) {
  const token = ++ecuToken;
  const trimmed = query.trim();
  if (!trimmed) {
    ecuFinder.results.replaceChildren();
    return;
  }
  const data = await api(`/api/tool-list?q=${encodeURIComponent(trimmed)}`);
  if (token !== ecuToken) return;
  showSource(data.source);
  if (!data.total) {
    ecuFinder.results.replaceChildren(h("div", { class: "empty-state" }, h("p", { text: `Nothing in Autotuner's list matches “${trimmed}”. Check the spelling, or send us a photo of the ECU label.` })));
    return;
  }
  const more = data.total > data.results.length ? h("p", { class: "fineprint", text: `Showing ${data.results.length} of ${data.total}. Add more of the ECU name to narrow it down.` }) : null;
  ecuFinder.results.replaceChildren(h("p", { class: "tool-intro", text: `${data.total} ${data.total === 1 ? "match" : "matches"}` }), ecuTable(data.results), more);
}

function findEcus(query) {
  ecuFinder.input.value = query;
  searchEcus(query).catch((error) => console.error(error));
  $("#ecu-list").scrollIntoView({ behavior: "smooth", block: "start" });
}

// "Autotuner lists 47 Hyundai ECUs" under a car, when its brand is in the list.
async function listLink(vehicle, actions) {
  const brand = LIST_BRANDS[vehicle.brandId] ?? vehicle.brand;
  const { total } = await api(`/api/tool-list?q=${encodeURIComponent(brand)}`);
  if (!total || finder.panel.hidden || !actions.isConnected) return;
  actions.append(h("button", { class: "link-arrow link-button", type: "button", text: `Autotuner lists ${total} ${brand} ECUs`, onclick: () => findEcus(brand) }));
}

ecuFinder.input.addEventListener("input", () => {
  clearTimeout(ecuTimer);
  ecuTimer = setTimeout(() => searchEcus(ecuFinder.input.value).catch((error) => console.error(error)), 200);
});

// ---------- AI label check ----------

const MAX_PHOTO_SIDE = 1600;

// Phone photos are large; a 1600 px JPEG keeps every printed number readable and uploads quickly.
async function shrinkPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("That file isn't a photo we can read. Try a JPEG or PNG."));
      img.src = url;
    });
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function labelRows(label) {
  const rows = [["ECU", [label.maker, label.type].filter(Boolean).join(" ")], ["Hardware no.", label.hardware], ["Software no.", label.software], ["Part no.", label.partNumber]].filter(([, value]) => value);
  return h("dl", { class: "tool-rows" }, ...rows.flatMap(([name, value]) => [h("dt", { text: name }), h("dd", { text: value })]));
}

function showLabelResult(container, data) {
  const { label } = data;
  if (!label.readable) {
    container.replaceChildren(h("p", { class: "form-error", role: "alert", text: `We couldn't read an ECU label in that photo. ${label.question || "Please try a sharper, closer photo in good light."}` }));
    return;
  }
  const atMethods = [...new Set((data.autotuner?.results ?? []).flatMap((entry) => entry.methods))];
  const support = h(
    "dl",
    { class: "tool-rows" },
    h("dt", { text: "Autotuner" }),
    h("dd", {}, data.autotuner?.total ? methodChips(atMethods, { none: "Listed, to be confirmed" }) : h("span", { class: "methods-none", text: "Not in its list under this name" })),
    ...(data.family ? [h("dt", { text: "KESS3" }), h("dd", {}, methodChips(data.family.tools?.kess3)), h("dt", { text: "Tuning" }), h("dd", {}, h("span", { class: `status status-${data.family.status}`, text: STATUS[data.family.status] }))] : [])
  );
  const car = [label.vehicle.brand, label.vehicle.model, label.vehicle.engine, label.vehicle.years].filter(Boolean).join(" ");
  const parts = [h("h3", { text: "Your ECU label" }), labelRows(label), support];
  const actions = h("div", { class: "vehicle-actions" });
  if (car) parts.push(h("p", { class: "tool-intro" }, "Usually fitted to: ", h("strong", { text: car })));
  for (const vehicle of data.vehicles ?? []) {
    actions.append(h("a", { class: "btn btn-primary", href: `/finder#car=${encodeURIComponent(vehicle.id)}`, text: `Stage 1 gains: ${vehicle.brand} ${vehicle.model}` }));
  }
  // The label didn't say which car (or no listed car matched): ask, and search for the answer.
  if (!data.vehicles?.length) {
    const input = h("input", { class: "label-car", type: "text", maxlength: "120", placeholder: "Make, model, engine and year", value: car, "aria-label": "Your car" });
    const ask = h(
      "form",
      { class: "label-form", onsubmit: (event) => (event.preventDefault(), findCar(input.value)) },
      input,
      h("button", { class: "btn", type: "submit", text: "Find my car" })
    );
    parts.push(h("p", { class: "tool-intro", text: label.question || "Which car is this ECU from?" }), ask);
  }
  const details = [[label.maker, label.type].filter(Boolean).join(" "), label.hardware && `HW ${label.hardware}`, label.software && `SW ${label.software}`, label.partNumber && `Part ${label.partNumber}`].filter(Boolean).join(", ");
  const send = whatsapp(`Hello ${settings.businessName}, here is my ECU label: ${details}${car ? `. Car: ${car}` : ""}.`);
  if (send) actions.append(h("a", { class: "btn btn-whatsapp", href: send, target: "_blank", rel: "noopener", text: "Send it to us on WhatsApp" }));
  parts.push(actions, h("p", { class: "fineprint", text: "We confirm the exact ECU with the tool before we start." }));
  container.replaceChildren(h("div", { class: "label-result" }, ...parts));
}

function findCar(query) {
  finder.input.value = query;
  search(query).catch((error) => console.error(error));
  finder.input.scrollIntoView({ behavior: "smooth", block: "center" });
}

function setupLabelCheck() {
  if (!site.aiEnabled) return;
  const section = $("[data-label-section]");
  const form = $("[data-label-form]", section);
  const file = $("[data-label-file]", section);
  const fileText = $("[data-label-file-text]", section);
  const submit = $("[data-label-submit]", section);
  const result = $("[data-label-result]", section);
  file.addEventListener("change", () => {
    fileText.textContent = file.files[0] ? `Photo: ${file.files[0].name.slice(0, 30)}` : "Choose or take a photo";
    submit.disabled = !file.files[0];
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!file.files[0]) return;
    submit.disabled = true;
    submit.textContent = "Reading the label…";
    result.replaceChildren();
    try {
      const image = await shrinkPhoto(file.files[0]);
      const data = await api("/api/ecu-label", { method: "POST", body: { image, car: $("[data-label-car]", section).value } });
      showLabelResult(result, data);
    } catch (error) {
      result.replaceChildren(h("p", { class: "form-error", role: "alert", text: error.message }));
    } finally {
      submit.disabled = false;
      submit.textContent = "Check my label";
    }
  });
  section.hidden = false;
}

// ---------- Support list ----------

function supportList(fuel) {
  const rows = [...site.ecus]
    .filter((ecu) => !fuel || ecu.fuels.includes(fuel))
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.title.localeCompare(b.title));
  return h(
    "table",
    { class: "support-table" },
    h("thead", {}, h("tr", {}, ...["ECU", "Fuel", ...Object.values(TOOLS), "Tuning"].map((label) => h("th", { scope: "col", text: label })))),
    h(
      "tbody",
      {},
      ...rows.map((ecu) =>
        h(
          "tr",
          {},
          h("th", { scope: "row", text: ecu.title }),
          h("td", { dataset: { label: "Fuel" }, text: ecu.fuels.map((item) => FUELS[item]).join(" & ") }),
          ...Object.entries(TOOLS).map(([id, name]) => h("td", { dataset: { label: name } }, methodChips(ecu.tools?.[id]))),
          h("td", { dataset: { label: "Tuning" } }, h("span", { class: `status status-${ecu.status}`, text: STATUS[ecu.status] ?? ecu.status }))
        )
      )
    )
  );
}

function setupSupportList() {
  const list = $("[data-support-list]");
  const chips = $("[data-fuel-chips]");
  const options = [["", "All"], ...Object.entries(FUELS)];
  const choose = (fuel) => {
    for (const chip of $$(".chip", chips)) chip.setAttribute("aria-pressed", String(chip.dataset.fuel === fuel));
    list.replaceChildren(supportList(fuel));
  };
  chips.replaceChildren(...options.map(([fuel, label]) => h("button", { class: "chip", type: "button", dataset: { fuel }, text: label, onclick: () => choose(fuel) })));
  choose("");
}

// ---------- Start ----------

const help = whatsapp(`Hello ${settings.businessName}, can you check my ECU? I'll send a photo of the label.`);
if (help) $("[data-help-actions]").prepend(h("a", { class: "btn btn-whatsapp", href: help, target: "_blank", rel: "noopener", text: "Send us the ECU label" }));
setupSupportList();
setupLabelCheck();
observeReveals();
api("/api/tool-list").then((data) => showSource(data.source)).catch(() => {});

// A link such as /tools#car=hyundai_creta_crdi opens that car straight away.
const linked = new URLSearchParams(location.hash.slice(1)).get("car");
if (linked) {
  try {
    const { vehicle } = await api(`/api/vehicles/${encodeURIComponent(linked)}`);
    finder.input.value = vehicleTitle(vehicle);
    showVehicle(vehicle);
  } catch (error) {
    console.error("Couldn't open the linked car:", error);
  }
}
