import { $, api, bootPage, h, observeReveals, whatsappUrl } from "./common.js";

// The franchise page: packages and "good to know" from the admin panel, and the application form.
const { site } = await bootPage();
const { settings } = site;

// ₹9,99,000 → "₹9.99 lakh".
const lakh = (amount) => (amount >= 100000 ? `₹${Number((amount / 100000).toFixed(2))} lakh` : `₹${Number(amount).toLocaleString("en-IN")}`);

const form = $("[data-franchise-form]");
const packageSelect = $("[data-franchise-package]");
const error = $("[data-franchise-error]");

const ask = settings.whatsappNumber ? whatsappUrl(settings.whatsappNumber, `Hello ${settings.businessName}, I'd like to know more about a Unity Performance franchise.`) : "";
if (ask) $("[data-franchise-actions] .btn").after(h("a", { class: "btn btn-whatsapp", href: ask, target: "_blank", rel: "noopener", text: "Ask on WhatsApp" }));

function choose(packageId) {
  packageSelect.value = packageId;
  $("#apply").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  form.elements.name.focus({ preventScroll: true });
}

function packageCard(entry, index) {
  return h("article", { class: `package-card reveal${entry.featured ? " is-featured" : ""}`, style: { "--delay": `${index * 0.08}s` } },
    h("h3", { text: entry.name }),
    h("p", { class: "package-price", text: lakh(entry.price) }),
    h("p", { class: "package-full", text: `₹${entry.price.toLocaleString("en-IN")}` }),
    entry.note ? h("p", { class: "package-note", text: entry.note }) : null,
    h("ul", { class: "package-items" }, ...entry.items.map((item) => h("li", { text: item }))),
    h("button", { class: "btn btn-primary", type: "button", text: `Apply for ${entry.name}`, onclick: () => choose(entry.id) })
  );
}

try {
  const data = await api("/api/franchise");
  const grid = $("[data-franchise-packages]");
  grid.replaceChildren(...data.packages.map(packageCard));
  if (!data.packages.length) grid.replaceChildren(h("p", { class: "lead", text: "Ask us on WhatsApp for the current packages." }));
  packageSelect.append(...data.packages.map((entry) => h("option", { value: entry.id, text: `${entry.name} · ${lakh(entry.price)}` })));
  $("[data-franchise-background]").append(...Object.entries(data.backgrounds).map(([value, label]) => h("option", { value, text: label })));
  if (data.terms.length) {
    $("[data-franchise-terms]").replaceChildren(...data.terms.map((term) => h("li", { text: term })));
    $("[data-franchise-terms-box]").hidden = false;
  }
  if (!data.open) {
    form.hidden = true;
    $("[data-franchise-closed]").hidden = false;
  }
  observeReveals();
} catch (failure) {
  $("[data-franchise-packages]").replaceChildren(h("p", { class: "form-error", text: failure.message }));
}

// A link such as /franchise#apply=premium opens the form with that package chosen.
const linked = /^#apply=([\w-]+)$/.exec(location.hash)?.[1];
if (linked && [...packageSelect.options].some((option) => option.value === linked)) choose(linked);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.hidden = true;
  const values = Object.fromEntries(new FormData(form));
  const missing = [["name", "your name"], ["phone", "a phone number"], ["city", "your city"]].find(([key]) => !String(values[key] ?? "").trim());
  if (missing) {
    error.textContent = `Please enter ${missing[1]}.`;
    error.hidden = false;
    form.elements[missing[0]].focus();
    return;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const { whatsappUrl: link } = await api("/api/franchise", { method: "POST", body: values });
    form.hidden = true;
    const done = $("[data-franchise-done]");
    if (link) $("[data-franchise-done-actions]").replaceChildren(h("a", { class: "btn btn-whatsapp", href: link, target: "_blank", rel: "noopener", text: "Send on WhatsApp" }));
    done.hidden = false;
    done.querySelector("h3").focus?.();
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});
