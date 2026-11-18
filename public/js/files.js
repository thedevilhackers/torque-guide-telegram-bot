// The tuning file service: sign in or create an account, upload an original ECU read and order a
// tune with credits, buy credits, and download finished files. Screens follow the address's hash:
// #files (default), #new, #credits, #account, #signin, #register and #reset=<token>.
import { $, applySettings, h, observeReveals, setupNav, toast, whatsappUrl } from "./lux.js";

setupNav();
applySettings();

const app = $("[data-app]");
const accountSlot = $("[data-account]");
const state = { catalog: null, customer: null, overview: null, upload: null };

const STATUS = {
  submitted: ["Waiting", "wait"],
  in_progress: ["In progress", "work"],
  completed: ["Ready", "done"],
  rejected: ["Rejected · refunded", "stop"],
  cancelled: ["Cancelled · refunded", "stop"]
};
const PAYMENT_STATUS = { awaiting_payment: ["Awaiting payment", "wait"], submitted: ["Checking payment", "work"], paid: ["Paid", "done"], cancelled: ["Cancelled", "stop"] };
const LEDGER_REASONS = { purchase: "Credits bought", order: "File order", refund: "Refund", admin: "Adjustment" };

class SignedOut extends Error {}

// Shows a screen: changing the hash redraws through hashchange; the same hash redraws directly.
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// Every change carries the page's header; the server refuses requests without it.
async function api(path, { method = "GET", body, raw, fileName, onProgress } = {}) {
  if (raw) return upload(path, raw, fileName, onProgress);
  const response = await fetch(path, {
    method,
    headers: { "X-Requested-With": "unity-portal", ...(body !== undefined && { "Content-Type": "application/json" }) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !/\/(login|register|reset)$/.test(path)) throw new SignedOut(data.error);
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

// Files go up as the raw body; XHR reports progress, which fetch can't.
function upload(path, file, fileName, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.setRequestHeader("X-Requested-With", "unity-portal");
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(fileName));
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress?.(event.loaded / event.total);
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // Not JSON.
      }
      if (xhr.status === 401) reject(new SignedOut(data.error));
      else if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || "The upload didn't finish. Please try again."));
    };
    xhr.onerror = () => reject(new Error("The upload was interrupted. Check your connection and try again."));
    xhr.send(file);
  });
}

const money = (amount) => {
  const currency = state.catalog?.currency || "INR";
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : undefined, { style: "currency", currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
};
// Credits can have two decimals: "1 credit", "3 credits", "1.20 credits".
const creditNumber = (amount) => (Number.isInteger(amount) ? String(amount) : amount.toFixed(2));
const credits = (amount) => `${creditNumber(amount)} credit${amount === 1 ? "" : "s"}`;
const date = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const dateTime = (iso) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const size = (bytes) => (bytes >= 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const pill = ([label, kind]) => h("span", { class: `pill pill--${kind}`, text: label });
const whatsapp = (text) => whatsappUrl(state.catalog?.whatsappNumber || "918709647229", text);

function report(error) {
  if (error instanceof SignedOut) {
    state.customer = null;
    go("#signin");
    toast("Please sign in again.");
    return;
  }
  toast(error.message, "error");
}

// Runs a button's action with the button disabled; errors show in the form's message line, or as a toast.
async function busy(button, action, message = null) {
  button.disabled = true;
  if (message) {
    message.hidden = true;
    message.textContent = "";
  }
  try {
    await action();
  } catch (error) {
    if (message && !(error instanceof SignedOut)) {
      message.textContent = error.message;
      message.hidden = false;
    } else report(error);
  } finally {
    button.disabled = false;
  }
}

function head(eyebrow, title, lead) {
  return h("header", { class: "portal__head" }, h("p", { class: "eyebrow", text: eyebrow }), h("h1", { class: "title" }, ...title), lead ? h("p", { class: "lead", text: lead }) : null);
}

function field(label, control, { full = false, hint = "" } = {}) {
  return h("label", { class: `field${full ? " full" : ""}` }, h("span", {}, label, hint ? h("small", { text: ` ${hint}` }) : null), control);
}

const input = (name, props = {}) => h("input", { name, autocomplete: "off", ...props });

function select(name, choices, { placeholder = "Choose", value = "" } = {}) {
  const element = h("select", { name, required: true }, h("option", { value: "", text: placeholder }), ...Object.entries(choices).map(([key, label]) => h("option", { value: key, text: label })));
  element.value = value;
  return element;
}

const formError = () => h("p", { class: "form__status full is-error", role: "alert", hidden: true });

// ---------- Signed out: about the service, sign in, create an account, reset ----------

function aboutPanel() {
  const { options = [], packs = [] } = state.catalog ?? {};
  const tunes = options.filter((option) => option.kind === "tune");
  const addons = options.filter((option) => option.kind === "addon");
  return h("section", { class: "portal__about" },
    head("Tuning file service", ["Files for tuners, ", h("em", { text: "made to measure." })], "Upload an original read from your tool, choose the tune, and download a calibration written for that car. Every file shows its cost in credits before you order."),
    h("div", { class: "price-list" },
      h("h2", { class: "price-list__title", text: "Tunes" }),
      h("ul", {}, ...tunes.map((option) => h("li", {}, h("span", {}, option.name, option.description ? h("small", { text: option.description }) : null), h("b", { text: credits(option.credits) })))),
      addons.length ? h("h2", { class: "price-list__title", text: "Add-ons" }) : null,
      addons.length ? h("ul", {}, ...addons.map((option) => h("li", {}, h("span", {}, option.name, option.description ? h("small", { text: option.description }) : null), h("b", { text: `+${credits(option.credits)}` })))) : null,
      packs.length
        ? [h("h2", { class: "price-list__title", text: "Credit packs" }), h("ul", {}, ...packs.map((pack) => h("li", {}, h("span", {}, pack.name, h("small", { text: credits(pack.credits) })), h("b", { text: money(pack.price) }))))]
        : null
    ),
    h("p", { class: "fineprint", text: "We don't remove emissions equipment (DPF, EGR, AdBlue, catalysts) or immobilisers." })
  );
}

function authPanel(mode) {
  const tabs = h("div", { class: "tabs", role: "tablist" },
    h("a", { class: "tab", href: "#signin", role: "tab", "aria-selected": String(mode === "signin"), text: "Sign in" }),
    h("a", { class: "tab", href: "#register", role: "tab", "aria-selected": String(mode === "register"), text: "Create account" })
  );
  const error = formError();
  const submit = h("button", { class: "btn btn--primary", type: "submit", text: mode === "signin" ? "Sign in" : "Create account" });
  const form = h("form", { class: "form", novalidate: true },
    mode === "register" ? field("Your name", input("name", { autocomplete: "name", maxlength: 80, required: true })) : null,
    mode === "register" ? field("Workshop", input("company", { autocomplete: "organization", maxlength: 80 }), { hint: "(optional)" }) : null,
    field("Email", input("email", { type: "email", autocomplete: "email", maxlength: 120, required: true }), { full: true }),
    mode === "register" ? field("WhatsApp number", input("phone", { type: "tel", autocomplete: "tel", maxlength: 30, required: true, placeholder: "+91 …" }), { full: true }) : null,
    field("Password", input("password", { type: "password", autocomplete: mode === "signin" ? "current-password" : "new-password", minlength: 8, required: true }), { full: true, hint: mode === "register" ? "(at least 8 characters)" : "" }),
    h("div", { class: "full" }, submit),
    error,
    mode === "signin"
      ? h("p", { class: "full fineprint" }, "Forgot your password? ", h("a", { href: whatsapp("Hi, I need a password reset link for the tuning file service."), target: "_blank", rel: "noopener", text: "Message us on WhatsApp" }), " for a reset link.")
      : null
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    busy(submit, async () => {
      const { customer } = await api(`/api/portal/${mode === "signin" ? "login" : "register"}`, { method: "POST", body: values });
      state.customer = customer;
      toast(mode === "signin" ? `Welcome back, ${customer.name.split(" ")[0]}.` : "Your account is ready.");
      go(mode === "register" ? "#credits" : "#files");
    }, error);
  });
  return h("section", { class: "card auth" }, tabs, form);
}

function resetPanel(token) {
  const error = formError();
  const submit = h("button", { class: "btn btn--primary", type: "submit", text: "Set password" });
  const form = h("form", { class: "form", novalidate: true },
    field("New password", input("password", { type: "password", autocomplete: "new-password", minlength: 8, required: true }), { full: true, hint: "(at least 8 characters)" }),
    h("div", { class: "full" }, submit),
    error
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    busy(submit, async () => {
      const { customer } = await api("/api/portal/reset", { method: "POST", body: { token, password: form.elements.password.value } });
      state.customer = customer;
      toast("Your new password is set.");
      go("#files");
    }, error);
  });
  return h("section", { class: "card auth" }, h("h2", { class: "card__title", text: "Choose a new password" }), form);
}

function signedOut(mode, token) {
  accountSlot.hidden = false;
  accountSlot.replaceChildren(h("a", { class: "btn btn--small", href: mode === "signin" ? "#register" : "#signin", text: mode === "signin" ? "Create account" : "Sign in" }));
  app.replaceChildren(h("div", { class: "portal__split" }, aboutPanel(), mode === "reset" ? resetPanel(token) : authPanel(mode)));
}

// ---------- Signed in ----------

function shell(active, ...content) {
  const { customer } = state;
  accountSlot.hidden = false;
  accountSlot.replaceChildren(h("a", { class: "nav__credits", href: "#credits", title: "Your credits" }, h("b", { text: creditNumber(customer.credits) }), ` credit${customer.credits === 1 ? "" : "s"}`));
  const sections = [["files", "My files"], ["new", "New file"], ["credits", "Credits"], ["account", "Account"]];
  app.replaceChildren(
    h("div", { class: "portal__bar" },
      h("div", {}, h("p", { class: "eyebrow", text: customer.company || "Tuning file service" }), h("h1", { class: "title portal__hello" }, "Welcome, ", h("em", { text: customer.name.split(" ")[0] }))),
      h("div", { class: "balance" }, h("span", { class: "balance__value", text: creditNumber(customer.credits) }), h("span", { class: "balance__label", text: customer.credits === 1 ? "credit" : "credits" }))
    ),
    h("nav", { class: "tabs tabs--wide", "aria-label": "File service" }, ...sections.map(([id, label]) => h("a", { class: "tab", href: `#${id}`, "aria-current": id === active ? "page" : undefined, text: label }))),
    ...content
  );
}

async function refresh() {
  state.overview = await api("/api/portal/overview");
  state.customer = state.overview.customer;
}

function orderCard(order) {
  const { vehicle } = order;
  const actions = [];
  if (order.tuned) actions.push(h("a", { class: "btn btn--primary btn--small", href: `/api/portal/orders/${order.id}/download`, download: "", text: "Download tuned file" }));
  actions.push(h("a", { class: "link", href: `/api/portal/orders/${order.id}/download?file=original`, download: "", text: "Original" }));
  if (order.status === "submitted") {
    const cancel = h("button", { class: "link", type: "button", text: "Cancel & refund" });
    cancel.addEventListener("click", () => {
      if (!confirm(`Cancel ${order.number}? Its ${credits(order.credits)} go back to your balance.`)) return;
      busy(cancel, async () => {
        await api(`/api/portal/orders/${order.id}/cancel`, { method: "POST" });
        toast(`${order.number} cancelled. ${credits(order.credits)} refunded.`);
        route();
      });
    });
    actions.push(cancel);
  }
  return h("article", { class: "order" },
    h("div", { class: "order__main" },
      h("p", { class: "order__meta" }, h("span", { text: order.number }), h("span", { text: date(order.createdAt) }), pill(STATUS[order.status])),
      h("h3", { class: "order__car", text: [vehicle.make, vehicle.model, vehicle.generation, vehicle.engine].filter(Boolean).join(" ") }),
      h("p", { class: "order__detail", text: [vehicle.year, order.ecu, `${state.catalog.tools[order.tool] ?? order.tool} ${state.catalog.toolModes[order.toolMode] ?? ""}`.trim(), order.timeFrame ? state.catalog.timeFrames[order.timeFrame] : ""].filter(Boolean).join(" · ") }),
      h("p", { class: "order__detail", text: `${order.options.map((option) => option.name).join(" + ")} · ${credits(order.credits)}` }),
      order.message ? h("p", { class: "order__message" }, h("b", { text: "From the workshop: " }), order.message) : null
    ),
    h("div", { class: "order__actions" }, ...actions)
  );
}

async function viewFiles() {
  await refresh();
  const { orders } = state.overview;
  const open = orders.filter((order) => ["submitted", "in_progress"].includes(order.status)).length;
  shell("files",
    h("section", { class: "portal__section" },
      h("div", { class: "section-row" }, h("h2", { class: "card__title", text: orders.length ? `${orders.length} file${orders.length === 1 ? "" : "s"}${open ? ` · ${open} in the workshop` : ""}` : "No files yet" }), h("a", { class: "btn btn--primary btn--small", href: "#new", text: "New file" })),
      state.catalog.note ? h("p", { class: "fineprint", text: state.catalog.note }) : null,
      orders.length
        ? h("div", { class: "orders" }, ...orders.map(orderCard))
        : h("div", { class: "empty" }, h("p", { text: "Upload your first original read to get started." }), h("a", { class: "link", href: state.customer.credits ? "#new" : "#credits", text: state.customer.credits ? "Upload a file →" : "Buy credits first →" }))
    )
  );
}

// ---------- New file: tuning file, vehicle, tuning and service, with a bar showing what's left ----------

const MAX_EXTRA_FILES = 5;

function panel(icon, title, ...content) {
  return h("section", { class: "panel" }, h("h2", { class: "panel__title" }, h("span", { class: "panel__icon", "aria-hidden": "true", text: icon }), title), ...content);
}

const group = (title) => h("p", { class: "group-title", text: title });
const optional = (label) => [label, h("small", { text: " (optional)" })];

function labelled(label, control, { hint = "", full = false } = {}) {
  return h("label", { class: `field${full ? " full" : ""}` }, h("span", {}, ...(Array.isArray(label) ? label : [label])), control, hint ? h("small", { class: "field__hint", text: hint }) : null);
}

function choiceSelect(name, choices, placeholder = "Choose") {
  return h("select", { name }, h("option", { value: "", text: placeholder }), ...Object.entries(choices).map(([key, label]) => h("option", { value: key, text: label })));
}

// A drop zone: click or drop. onFiles gets the chosen files.
function dropZone({ title, text, multiple = false, tall = false, onFiles }) {
  const picker = h("input", { type: "file", class: "visually-hidden", multiple });
  const zone = h("label", { class: `drop${tall ? " drop--tall" : ""}` }, picker, h("span", { class: "drop__icon", "aria-hidden": "true", text: "+" }), h("span", { class: "drop__text" }, h("b", { text: title }), h("small", { text })), h("span", { class: "drop__progress" }, h("span", { class: "drop__bar" })));
  picker.addEventListener("change", () => {
    onFiles([...(picker.files ?? [])]);
    picker.value = "";
  });
  for (const type of ["dragenter", "dragover"]) zone.addEventListener(type, (event) => (event.preventDefault(), zone.classList.add("is-over")));
  for (const type of ["dragleave", "drop"]) zone.addEventListener(type, () => zone.classList.remove("is-over"));
  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    onFiles([...(event.dataTransfer?.files ?? [])]);
  });
  return { zone, picker, bar: zone.querySelector(".drop__bar") };
}

async function viewNew() {
  await refresh();
  const { catalog, customer } = state;
  if (!catalog.open) {
    shell("new", h("section", { class: "portal__section empty" }, h("p", { text: "We aren't taking new files right now." }), h("a", { class: "link", href: whatsapp("Hi, when will the tuning file service reopen?"), target: "_blank", rel: "noopener", text: "Ask us on WhatsApp →" })));
    return;
  }
  state.extras ??= [];
  const tunes = catalog.options.filter((option) => option.kind === "tune");
  const addons = catalog.options.filter((option) => option.kind === "addon");
  const tooBig = (file) => file.size > catalog.maxFileMb * 1_048_576;
  const form = h("form", { class: "order-form", novalidate: true });
  const draw = () => form.dispatchEvent(new Event("change"));

  // ---- Tuning file: the original read and how it was read ----
  const original = dropZone({ title: "Drop your file here or click to browse", text: "The complete original read from your tool, e.g. flash and EEPROM.", tall: true, onFiles: ([file]) => sendOriginal(file) });
  const originalStatus = h("p", { class: "file-status" });
  const drawOriginal = (text = "") => {
    original.zone.classList.toggle("is-done", Boolean(state.upload));
    originalStatus.replaceChildren(
      state.upload ? h("span", { class: "file-status__name", text: `✓ ${state.upload.name}` }) : h("span", { text: text || "No file selected yet." }),
      h("span", { class: "file-status__size", text: state.upload ? size(state.upload.size) : `${catalog.maxFileMb} MB max` })
    );
  };
  async function sendOriginal(file) {
    if (!file) return;
    if (tooBig(file)) return toast(`That file is over ${catalog.maxFileMb} MB.`, "error");
    original.zone.classList.add("is-busy");
    drawOriginal(`Uploading ${file.name}…`);
    try {
      ({ upload: state.upload } = await api("/api/portal/uploads", { raw: file, fileName: file.name, onProgress: (share) => (original.bar.style.width = `${Math.round(share * 100)}%`) }));
      drawOriginal();
    } catch (error) {
      state.upload = null;
      drawOriginal("The upload didn't finish. Try again.");
      report(error);
    } finally {
      original.zone.classList.remove("is-busy");
      original.bar.style.width = "0";
      draw();
    }
  }
  drawOriginal();
  const toolModes = h("div", { class: "segmented", role: "radiogroup", "aria-label": "Master or slave" },
    ...Object.entries(catalog.toolModes).map(([key, label]) => h("label", { class: "segmented__option" }, h("input", { type: "radio", name: "toolMode", value: key }), h("span", { text: label })))
  );
  const filePanel = panel("▤", "Tuning file",
    original.zone,
    originalStatus,
    group("How was the file read?"),
    h("div", { class: "fields fields--1" },
      labelled("Tool", choiceSelect("tool", catalog.tools)),
      h("div", { class: "field", dataset: { need: "toolMode" } }, h("span", { text: "Master or slave tool" }), toolModes, h("small", { class: "field__hint", text: "So the file comes back in the right format for your tool." })),
      labelled("Read method", choiceSelect("readMethod", catalog.readMethods))
    )
  );

  // ---- Vehicle: search our list, or choose the make and type the rest ----
  const search = h("input", { type: "search", placeholder: "Search our list, e.g. Polo 1.0 TSI or Creta diesel", autocomplete: "off", "aria-label": "Search our vehicle list" });
  const results = h("div", { class: "vehicle-results", hidden: true });
  const chosen = h("p", { class: "vehicle-chosen", hidden: true });
  const catalogId = h("input", { type: "hidden", name: "catalogId" });
  const makeSelect = h("select", { name: "make" }, h("option", { value: "", text: "Choose" }), ...catalog.makes.map((make) => h("option", { value: make, text: make })), h("option", { value: "__other", text: "Other (type it)" }));
  const makeOther = h("input", { name: "makeOther", maxlength: 40, placeholder: "Type the make", hidden: true, "aria-label": "Make" });
  const modelList = h("datalist", { id: "model-options" });
  const engineList = h("datalist", { id: "engine-options" });
  const ecuList = h("datalist", { id: "ecu-options" }, ...Object.values(catalog.ecus).map((title) => h("option", { value: title })));
  const model = h("input", { name: "model", maxlength: 60, placeholder: "Choose or type it yourself", list: "model-options", autocomplete: "off" });
  const engine = h("input", { name: "engine", maxlength: 60, placeholder: "e.g. 1.5 CRDi 115 hp", list: "engine-options", autocomplete: "off" });
  const ecu = h("input", { name: "ecu", maxlength: 80, placeholder: "e.g. Bosch EDC17C64", list: "ecu-options", autocomplete: "off" });
  const year = new Date().getFullYear();
  let brandVehicles = [];

  const makeValue = () => (makeSelect.value === "__other" ? makeOther.value.trim() : makeSelect.value);
  const setMake = (make) => {
    if (!catalog.makes.includes(make)) makeSelect.insertBefore(h("option", { value: make, text: make }), makeSelect.lastChild);
    makeSelect.value = make;
    makeOther.hidden = true;
  };
  // The make's cars from our list fill the model and engine suggestions.
  async function loadModels() {
    const brand = catalog.brands.find((entry) => entry.title.toLowerCase() === makeValue().toLowerCase());
    brandVehicles = brand ? (await api(`/api/vehicles?brand=${encodeURIComponent(brand.id)}`).catch(() => ({ vehicles: [] }))).vehicles : [];
    modelList.replaceChildren(...[...new Set(brandVehicles.map((vehicle) => vehicle.model))].map((value) => h("option", { value })));
    loadEngines();
  }
  function loadEngines() {
    const matches = brandVehicles.filter((vehicle) => vehicle.model.toLowerCase() === model.value.trim().toLowerCase());
    engineList.replaceChildren(...[...new Set((matches.length ? matches : brandVehicles).map((vehicle) => `${vehicle.engine} ${vehicle.stock?.hp ? `${vehicle.stock.hp} hp` : ""}`.trim()))].map((value) => h("option", { value })));
  }
  makeSelect.addEventListener("change", () => {
    makeOther.hidden = makeSelect.value !== "__other";
    if (!makeOther.hidden) makeOther.focus();
    catalogId.value = "";
    chosen.hidden = true;
    loadModels();
  });
  model.addEventListener("input", () => {
    catalogId.value = "";
    chosen.hidden = true;
    loadEngines();
  });

  function pickVehicle(vehicle) {
    const set = (name, value) => (form.elements[name].value = value ?? "");
    set("vehicleType", "car");
    setMake(vehicle.brand);
    set("model", vehicle.model);
    set("generation", [vehicle.generation, vehicle.years ? `(${vehicle.years})` : ""].filter(Boolean).join(" "));
    set("engine", vehicle.engine);
    set("fuel", catalog.fuels[vehicle.fuel] ? vehicle.fuel : "");
    set("powerHp", vehicle.stock?.hp ?? "");
    const ecuTitles = (vehicle.ecus ?? []).map((id) => catalog.ecus[id]).filter(Boolean);
    set("ecu", ecuTitles.length === 1 ? ecuTitles[0] : "");
    ecu.placeholder = ecuTitles.length > 1 ? `Usually ${ecuTitles.join(" or ")}` : "e.g. Bosch EDC17C64";
    catalogId.value = vehicle.id;
    chosen.replaceChildren(h("b", { text: `${vehicle.brand} ${vehicle.model}` }), ` ${vehicle.generation ?? ""} · filled in below. Check the details and add the year.`);
    chosen.hidden = false;
    results.hidden = true;
    search.value = "";
    loadModels();
    draw();
  }
  let searchTimer;
  search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const query = search.value.trim();
    if (query.length < 2) {
      results.hidden = true;
      return;
    }
    searchTimer = setTimeout(async () => {
      const { vehicles } = await api(`/api/vehicles?q=${encodeURIComponent(query)}`).catch(() => ({ vehicles: [] }));
      results.replaceChildren(
        ...vehicles.slice(0, 6).map((vehicle) =>
          h("button", { class: "vehicle-result", type: "button", onclick: () => pickVehicle(vehicle) },
            h("b", { text: `${vehicle.brand} ${vehicle.model}` }),
            h("small", { text: [vehicle.generation, vehicle.years, vehicle.engine, vehicle.stock?.hp ? `${vehicle.stock.hp} hp` : ""].filter(Boolean).join(" · ") })
          )
        ),
        ...(vehicles.length ? [] : [h("p", { class: "vehicle-results__none", text: "Not in our list. Choose the make below and type the rest." })])
      );
      results.hidden = false;
    }, 200);
  });

  const vehiclePanel = panel("◆", "Vehicle",
    h("div", { class: "vehicle-search" }, search, results, chosen),
    catalogId,
    group("Vehicle and engine"),
    h("div", { class: "fields" },
      labelled("Vehicle type", h("select", { name: "vehicleType" }, ...Object.entries(catalog.vehicleTypes).map(([key, label]) => h("option", { value: key, text: label })))),
      h("label", { class: "field" }, h("span", { text: "Make" }), makeSelect, makeOther),
      labelled("Model", model),
      labelled(optional("Generation"), input("generation", { maxlength: 40, placeholder: "e.g. Mk7 (2013–2020)" })),
      labelled("Engine", engine, { full: true }),
      labelled(optional("Fuel"), choiceSelect("fuel", catalog.fuels)),
      labelled(optional("Octane rating"), choiceSelect("octane", catalog.octanes))
    ),
    group("Details"),
    h("div", { class: "fields" },
      labelled(optional("Year"), input("year", { type: "number", inputmode: "numeric", min: 1980, max: year + 1, placeholder: String(year - 3) })),
      labelled(optional("Gearbox"), choiceSelect("gearbox", catalog.gearboxes)),
      labelled(optional("Number plate"), input("plate", { maxlength: 20 })),
      labelled(optional("VIN"), input("vin", { maxlength: 17 }))
    ),
    group("Power and ECU"),
    h("div", { class: "fields" },
      labelled(optional("Power"), h("span", { class: "with-unit" }, input("powerHp", { type: "number", inputmode: "numeric", min: 5, max: 3000 }), h("span", { text: "hp" }))),
      labelled(optional("ECU"), ecu),
      labelled(optional("Hardware number"), input("hardwareNumber", { maxlength: 40 })),
      labelled(optional("Software number"), input("softwareNumber", { maxlength: 40 }))
    ),
    modelList,
    engineList,
    ecuList
  );

  // ---- Tuning: one tuning type, then its options ----
  const optionCard = (type, name, option) =>
    h("label", { class: "choice" }, h("input", { type, name, value: option.id }), h("span", { class: "choice__body" }, h("span", { class: "choice__name", text: option.name }), option.description ? h("small", { text: option.description }) : null), h("b", { class: "choice__cost", text: credits(option.credits) }));
  const addonsBox = h("div", { class: "choices" }, ...addons.map((option) => optionCard("checkbox", "addonIds", option)));
  const addonsHint = h("p", { class: "fineprint", text: "Choose a tuning type to see its options." });
  const tuningPanel = panel("ϟ", "Tuning",
    h("div", { class: "choices", dataset: { need: "tuneId" } }, ...tunes.map((option) => optionCard("radio", "tuneId", option))),
    addons.length ? [group("Tuning options"), addonsHint, addonsBox] : null
  );

  // ---- Service: modified parts, time frame, info and extra files ----
  const extrasList = h("ul", { class: "extras" });
  const extras = dropZone({ title: "Drop your files here or click to browse", text: "Supporting files: a photo of the ECU label, a log file, or anything else that helps.", multiple: true, onFiles: (chosenFiles) => sendExtras(chosenFiles) });
  const drawExtras = () =>
    extrasList.replaceChildren(
      ...state.extras.map((extra, index) =>
        h("li", {}, h("span", { text: extra.name }), h("small", { text: size(extra.size) }), h("button", { class: "link", type: "button", text: "Remove", onclick: () => ((state.extras = state.extras.filter((_, i) => i !== index)), drawExtras()) }))
      )
    );
  async function sendExtras(chosenFiles) {
    for (const file of chosenFiles) {
      if (state.extras.length >= MAX_EXTRA_FILES) return toast(`Add up to ${MAX_EXTRA_FILES} extra files.`, "error");
      if (tooBig(file)) {
        toast(`${file.name} is over ${catalog.maxFileMb} MB.`, "error");
        continue;
      }
      extras.zone.classList.add("is-busy");
      try {
        const { upload: added } = await api("/api/portal/uploads", { raw: file, fileName: file.name, onProgress: (share) => (extras.bar.style.width = `${Math.round(share * 100)}%`) });
        state.extras.push(added);
        drawExtras();
      } catch (error) {
        report(error);
      } finally {
        extras.zone.classList.remove("is-busy");
        extras.bar.style.width = "0";
      }
    }
  }
  drawExtras();
  const confirmBox = h("input", { type: "checkbox", name: "confirmed" });
  const servicePanel = panel("✓", "Service",
    h("div", { class: "fields fields--3" },
      labelled("Does the vehicle have modified parts?", choiceSelect("modifiedParts", catalog.modifiedParts)),
      labelled("Time frame", choiceSelect("timeFrame", catalog.timeFrames), { hint: "When do you need the file? We plan the work around it." }),
      labelled(optional("Info"), h("textarea", { name: "notes", maxlength: 1000, rows: 4 }), { hint: "Hardware changes, the fuel you use, wishes: everything we should know." })
    ),
    group("Extra files (optional)"),
    extras.zone,
    extrasList,
    h("label", { class: "confirm", dataset: { need: "confirmed" } }, confirmBox, h("span", { text: "I confirm this is the complete, unmodified original read from this vehicle." }))
  );

  // ---- The bar: total, balance and what's still missing ----
  const total = h("b", { class: "summary__total" });
  const balance = h("span", { class: "summary__after" });
  const left = h("div", { class: "left" });
  const send = h("button", { class: "btn btn--primary", type: "submit" });
  const error = formError();
  const bar = h("div", { class: "summary" }, h("div", {}, h("span", { class: "summary__label", text: "Total" }), total, balance), left, send);

  const value = (name) => String(form.elements[name]?.value ?? "").trim();
  const focusTarget = (name) => form.querySelector(`[data-need="${name}"]`) ?? form.elements[name];
  const REQUIRED = [
    ["Original file", () => Boolean(state.upload), () => original.zone],
    ["Tool", () => value("tool"), () => form.elements.tool],
    ["Master or slave", () => value("toolMode"), () => focusTarget("toolMode")],
    ["Read method", () => value("readMethod"), () => form.elements.readMethod],
    ["Make", () => makeValue(), () => (makeSelect.value === "__other" ? makeOther : makeSelect)],
    ["Model", () => value("model"), () => model],
    ["Engine", () => value("engine"), () => engine],
    ["Tuning type", () => value("tuneId"), () => focusTarget("tuneId")],
    ["Modified parts", () => value("modifiedParts"), () => form.elements.modifiedParts],
    ["Time frame", () => value("timeFrame"), () => form.elements.timeFrame],
    ["Confirmation", () => confirmBox.checked, () => focusTarget("confirmed")]
  ];
  const cost = () => {
    const tune = tunes.find((option) => option.id === value("tuneId"));
    const chosenAddons = new Set(new FormData(form).getAll("addonIds"));
    return Math.round(((tune?.credits ?? 0) + addons.filter((option) => chosenAddons.has(option.id)).reduce((sum, option) => sum + option.credits, 0)) * 100) / 100;
  };
  const missing = () => REQUIRED.filter(([, done]) => !done());
  const drawBar = () => {
    const needed = cost();
    const short = Math.round((needed - customer.credits) * 100) / 100;
    total.textContent = credits(needed);
    balance.textContent = `Your balance ${creditNumber(customer.credits)} → ${creditNumber(Math.round((customer.credits - needed) * 100) / 100)}`;
    const todo = missing();
    left.className = `left${todo.length ? "" : " is-done"}`;
    const jump = (target) => () => {
      const element = target();
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
      element?.focus?.({ preventScroll: true });
    };
    left.replaceChildren(
      ...(todo.length
        ? [h("span", { class: "left__title", text: `${todo.length} thing${todo.length === 1 ? "" : "s"} left:` }), ...todo.map(([label, , target]) => h("button", { class: "left__chip", type: "button", text: label, onclick: jump(target) }))]
        : [h("span", { class: "left__title", text: short > 0 ? `You need ${credits(short)} more.` : "Everything's filled in." })])
    );
    send.textContent = short > 0 && !todo.length ? "Buy credits" : "Send file";
    send.disabled = todo.length > 0;
    addonsHint.hidden = Boolean(value("tuneId"));
    addonsBox.hidden = !value("tuneId");
  };
  form.addEventListener("change", drawBar);
  form.addEventListener("input", drawBar);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (missing().length) return;
    if (cost() > state.customer.credits) return go("#credits");
    const data = new FormData(form);
    const body = { ...Object.fromEntries(data), make: makeValue(), addonIds: data.getAll("addonIds"), uploadId: state.upload?.id, extraUploadIds: state.extras.map((extra) => extra.id), confirmed: confirmBox.checked };
    delete body.makeOther;
    busy(send, async () => {
      const { order } = await api("/api/portal/orders", { method: "POST", body });
      state.upload = null;
      state.extras = [];
      toast(`${order.number} is with the workshop. We'll prepare it and it will appear here.`);
      go("#files");
    }, error);
  });

  form.append(h("div", { class: "new-grid" }, filePanel, vehiclePanel), tuningPanel, servicePanel, error, bar);
  shell("new", h("section", { class: "portal__section" }, form));
  drawBar();
}

function paymentPanel(purchase) {
  if (purchase.status !== "awaiting_payment") return null;
  if (purchase.payUrl) {
    const check = h("button", { class: "link", type: "button", text: "I've paid · check now" });
    check.addEventListener("click", () =>
      busy(check, async () => {
        const result = await api(`/api/portal/purchases/${purchase.id}/check`, { method: "POST" });
        toast(result.purchase.status === "paid" ? "Payment received. Your credits are added." : "We don't see the payment yet. Give it a minute and check again.");
        route();
      })
    );
    return h("div", { class: "pay" }, h("a", { class: "btn btn--primary btn--small", href: purchase.payUrl, text: `Pay ${money(purchase.amount)} online` }), check);
  }
  if (!purchase.upi) return null;
  const reference = input("reference", { inputmode: "numeric", maxlength: 40, placeholder: "12-digit UPI reference (UTR)", required: true });
  const send = h("button", { class: "btn btn--primary btn--small", type: "submit", text: "I've paid" });
  const error = formError();
  const copy = h("button", { class: "link", type: "button", text: "Copy UPI ID" });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(purchase.upi.id);
      toast("UPI ID copied.");
    } catch {
      toast(purchase.upi.id);
    }
  });
  const form = h("form", { class: "pay__form", novalidate: true }, field("Transaction reference", reference), send, error);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    busy(send, async () => {
      await api(`/api/portal/purchases/${purchase.id}/reference`, { method: "POST", body: { reference: reference.value } });
      toast("Thanks. We'll check the payment and add your credits.");
      route();
    }, error);
  });
  return h("div", { class: "pay" },
    h("ol", { class: "pay__steps" },
      h("li", {}, "Pay ", h("b", { text: money(purchase.amount) }), " to ", h("b", { text: purchase.upi.id }), ` (${purchase.upi.name}). `, h("a", { class: "link", href: purchase.upi.url, text: "Open UPI app" }), " ", copy),
      h("li", {}, "Add ", h("b", { text: purchase.number }), " to the payment note."),
      h("li", { text: "Enter the transaction reference from your payment app below." })
    ),
    form
  );
}

async function viewCredits() {
  await refresh();
  const { catalog } = state;
  const { purchases, ledger } = state.overview;
  const params = new URLSearchParams(location.search);
  if (params.get("payment")) {
    toast(params.get("payment") === "paid" ? "Payment received. Your credits are added." : "The payment didn't go through. You can try again.", params.get("payment") === "paid" ? "" : "error");
    history.replaceState(null, "", "/files#credits");
  }
  const canPay = catalog.payments.upi || catalog.payments.online;
  const buy = (pack, method, button) =>
    busy(button, async () => {
      const { purchase } = await api("/api/portal/purchases", { method: "POST", body: { packId: pack.id, method } });
      if (purchase.payUrl) location.href = purchase.payUrl;
      else {
        toast(`${purchase.number} created. Follow the steps to pay.`);
        route();
      }
    });
  const packCard = (pack) => {
    const buttons = [];
    if (catalog.payments.upi) {
      const upi = h("button", { class: "btn btn--primary btn--small", type: "button", text: "Pay by UPI" });
      upi.addEventListener("click", () => buy(pack, "upi", upi));
      buttons.push(upi);
    }
    if (catalog.payments.online) {
      const online = h("button", { class: `btn btn--small${catalog.payments.upi ? "" : " btn--primary"}`, type: "button", text: "Card / UPI online" });
      online.addEventListener("click", () => buy(pack, "online", online));
      buttons.push(online);
    }
    if (!canPay) buttons.push(h("a", { class: "btn btn--small", href: whatsapp(`Hi, I'd like to buy the ${pack.name} credit pack (${pack.credits} credits).`), target: "_blank", rel: "noopener", text: "Buy on WhatsApp" }));
    return h("article", { class: "pack" },
      h("p", { class: "pack__name", text: pack.name }),
      h("p", { class: "pack__credits" }, h("b", { text: String(pack.credits) }), credits(pack.credits).replace(/^\d+ /, "")),
      h("p", { class: "pack__price", text: money(pack.price) }),
      h("p", { class: "pack__each", text: pack.credits > 1 ? `${money(Math.round((pack.price / pack.credits) * 100) / 100)} per credit` : " " }),
      pack.note ? h("p", { class: "fineprint", text: pack.note }) : null,
      h("div", { class: "pack__buy" }, ...buttons)
    );
  };
  const purchaseRow = (purchase) => {
    const cancel = ["awaiting_payment"].includes(purchase.status) ? h("button", { class: "link", type: "button", text: "Cancel" }) : null;
    cancel?.addEventListener("click", () =>
      busy(cancel, async () => {
        await api(`/api/portal/purchases/${purchase.id}/cancel`, { method: "POST" });
        route();
      })
    );
    return h("article", { class: "purchase" },
      h("div", { class: "purchase__head" },
        h("p", { class: "order__meta" }, h("span", { text: purchase.number }), h("span", { text: dateTime(purchase.createdAt) }), pill(PAYMENT_STATUS[purchase.status])),
        h("p", { class: "purchase__what" }, h("b", { text: purchase.packName }), ` · ${credits(purchase.credits)} · ${money(purchase.amount)}`, purchase.utr ? ` · UTR ${purchase.utr}` : ""),
        cancel
      ),
      paymentPanel(purchase)
    );
  };
  shell("credits",
    h("section", { class: "portal__section" },
      h("h2", { class: "card__title", text: "Buy credits" }),
      catalog.packs.length
        ? h("div", { class: "packs" }, ...catalog.packs.map(packCard))
        : h("div", { class: "empty" }, h("p", { text: "Credit packs will be listed here soon. Until then, buy credits from us directly." }), h("a", { class: "link", href: whatsapp("Hi, I'd like to buy credits for the tuning file service."), target: "_blank", rel: "noopener", text: "Message us on WhatsApp →" })),
      catalog.packs.length && !canPay ? h("p", { class: "fineprint", text: "Online payment isn't set up yet, so packs are bought on WhatsApp for now." }) : null
    ),
    purchases.length ? h("section", { class: "portal__section" }, h("h2", { class: "card__title", text: "Payments" }), h("div", { class: "purchases" }, ...purchases.map(purchaseRow))) : null,
    h("section", { class: "portal__section" },
      h("h2", { class: "card__title", text: "Credit history" }),
      ledger.length
        ? h("div", { class: "table-wrap" },
            h("table", { class: "ledger" },
              h("thead", {}, h("tr", {}, h("th", { text: "Date" }), h("th", { text: "What" }), h("th", { class: "num", text: "Change" }), h("th", { class: "num", text: "Balance" }))),
              h("tbody", {}, ...ledger.map((entry) => h("tr", {}, h("td", { text: date(entry.createdAt) }), h("td", { text: `${LEDGER_REASONS[entry.reason] ?? entry.reason}${entry.ref ? ` · ${entry.ref}` : ""}` }), h("td", { class: `num ${entry.change > 0 ? "plus" : "minus"}`, text: entry.change > 0 ? `+${creditNumber(entry.change)}` : creditNumber(entry.change) }), h("td", { class: "num", text: creditNumber(entry.balance) }))))
            )
          )
        : h("p", { class: "fineprint", text: "No credit changes yet." })
    )
  );
}

async function viewAccount() {
  await refresh();
  const { customer } = state;
  const detailsError = formError();
  const save = h("button", { class: "btn btn--small", type: "submit", text: "Save details" });
  const details = h("form", { class: "form", novalidate: true },
    field("Name", input("name", { value: customer.name, maxlength: 80, autocomplete: "name" })),
    field("Workshop", input("company", { value: customer.company, maxlength: 80, autocomplete: "organization" })),
    field("WhatsApp number", input("phone", { value: customer.phone, maxlength: 30, type: "tel", autocomplete: "tel" })),
    field("Email", input("email", { value: customer.email, disabled: true }), { hint: "(message us to change it)" }),
    h("div", { class: "full" }, save),
    detailsError
  );
  details.addEventListener("submit", (event) => {
    event.preventDefault();
    busy(save, async () => {
      await api("/api/portal/account", { method: "POST", body: Object.fromEntries(new FormData(details)) });
      toast("Details saved.");
      route();
    }, detailsError);
  });
  const passwordError = formError();
  const change = h("button", { class: "btn btn--small", type: "submit", text: "Change password" });
  const password = h("form", { class: "form", novalidate: true },
    field("Current password", input("current", { type: "password", autocomplete: "current-password" })),
    field("New password", input("password", { type: "password", autocomplete: "new-password", minlength: 8 }), { hint: "(at least 8 characters)" }),
    h("div", { class: "full" }, change),
    passwordError
  );
  password.addEventListener("submit", (event) => {
    event.preventDefault();
    busy(change, async () => {
      await api("/api/portal/password", { method: "POST", body: Object.fromEntries(new FormData(password)) });
      password.reset();
      toast("Password changed. Other devices are signed out.");
    }, passwordError);
  });
  const signOut = h("button", { class: "link", type: "button", text: "Sign out" });
  signOut.addEventListener("click", async () => {
    await api("/api/portal/logout", { method: "POST" }).catch(() => {});
    state.customer = null;
    go("#signin");
  });
  shell("account",
    h("section", { class: "portal__section" }, h("h2", { class: "card__title", text: "Your details" }), details),
    h("section", { class: "portal__section" }, h("h2", { class: "card__title", text: "Password" }), password),
    h("section", { class: "portal__section" }, signOut)
  );
}

// ---------- Routing ----------

async function route() {
  const hash = location.hash.slice(1);
  try {
    state.catalog ??= await api("/api/portal/catalog");
    if (hash.startsWith("reset=")) return signedOut("reset", hash.slice(6));
    state.customer ??= (await api("/api/portal/session")).customer;
    if (!state.customer) return signedOut(hash === "register" ? "register" : "signin");
    if (hash === "signin" || hash === "register") {
      history.replaceState(null, "", "#files");
      return viewFiles();
    }
    const views = { new: viewNew, credits: viewCredits, account: viewAccount };
    await (views[hash] ?? viewFiles)();
  } catch (error) {
    if (error instanceof SignedOut) {
      state.customer = null;
      return signedOut("signin");
    }
    app.replaceChildren(h("p", { class: "error", text: error.message }));
  } finally {
    observeReveals(app);
  }
}

addEventListener("hashchange", () => {
  route();
  scrollTo({ top: 0 });
});
route();
