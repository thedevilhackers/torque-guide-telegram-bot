// Tool support page: search a car to see its usual ECU and how Autotuner and KESS3 read it, plus
// the full support list by ECU family. All text is inserted with textContent (see h()).
import { $, $$, api, bootPage, h, observeReveals, whatsappUrl } from "./common.js";

const TOOLS = { autotuner: "Autotuner", kess3: "KESS3" };
const METHODS = { obd: "OBD", bench: "Bench", boot: "Boot" };
const STATUS = { supported: "We tune it", on_request: "On request", not_supported: "Not supported" };
const STATUS_ORDER = { supported: 0, on_request: 1, not_supported: 2 };
const FUELS = { petrol: "Petrol", diesel: "Diesel" };

const { site } = await bootPage();
const { settings } = site;
const ecuById = new Map(site.ecus.map((ecu) => [ecu.id, ecu]));
const whatsapp = (text) => (settings.whatsappNumber ? whatsappUrl(settings.whatsappNumber, text) : "");

const finder = { input: $("[data-tool-search]"), results: $("[data-tool-results]"), panel: $("[data-tool-panel]") };

function methodChips(methods = []) {
  if (!methods.length) return h("span", { class: "methods-none", text: "Not listed" });
  return h("span", { class: "methods" }, ...methods.map((method) => h("span", { class: `method method-${method}`, text: METHODS[method] ?? method })));
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
  const actions = h("div", { class: "vehicle-actions" }, h("a", { class: "btn btn-primary", href: `/#car=${encodeURIComponent(vehicle.id)}`, text: "See the Stage 1 gains" }));
  const question = whatsapp(`Hello ${settings.businessName}, can you read my ${vehicleTitle(vehicle)} (${vehicle.engine})?`);
  if (question) actions.append(h("a", { class: "btn btn-whatsapp", href: question, target: "_blank", rel: "noopener", text: "Ask us on WhatsApp" }));

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
observeReveals();

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
