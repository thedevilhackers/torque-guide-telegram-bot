import { $, api, bootPage, h, observeReveals, whatsappUrl } from "./common.js";

// /mechanics: approved mechanics by area and skill, booked through the workshop on WhatsApp, and
// the sign-up form for mechanics.
const { site } = await bootPage();
const { settings } = site;
const rupees = (amount) => `₹${Number(amount).toLocaleString("en-IN")}`;
const grid = $("[data-mechanics]");
const search = $("[data-mechanic-search]");
const skillSelect = $("[data-mechanic-skill]");
const form = $("[data-mechanic-form]");

let data = { open: true, mechanics: [], skills: {}, availability: {} };
try {
  data = await api("/api/mechanics");
} catch (failure) {
  grid.replaceChildren(h("p", { class: "form-error", text: failure.message }));
}

skillSelect.append(...Object.entries(data.skills).map(([value, label]) => h("option", { value, text: label })));
$("[data-mechanic-skills]").append(
  ...Object.entries(data.skills).map(([value, label]) => h("label", { class: "check" }, h("input", { type: "checkbox", name: "skills", value }), h("span", { text: label })))
);
$("[data-mechanic-availability]").append(...Object.entries(data.availability).map(([value, label]) => h("option", { value, text: label })));
if (!data.open) {
  form.hidden = true;
  $("[data-mechanic-closed]").hidden = false;
}

function card(mechanic, index) {
  const book = settings.whatsappNumber
    ? whatsappUrl(settings.whatsappNumber, `Hello ${settings.businessName}, I'd like to book ${mechanic.name} (${mechanic.area}, ${mechanic.city}) for: `)
    : "";
  return h("article", { class: "mechanic-card reveal", style: { "--delay": `${Math.min(index, 6) * 0.05}s` } },
    h("h3", { text: mechanic.name }),
    h("p", { class: "mechanic-area", text: `${mechanic.area}, ${mechanic.city}` }),
    h("ul", { class: "skill-chips" }, ...mechanic.skills.map((skill) => h("li", { text: data.skills[skill] ?? skill }))),
    h("p", { class: "mechanic-rate" }, h("strong", { text: rupees(mechanic.rate) }), " per session"),
    h("p", { class: "mechanic-meta", text: [data.availability[mechanic.availability], mechanic.experience ? `${mechanic.experience} years' experience` : ""].filter(Boolean).join(" · ") }),
    book ? h("a", { class: "btn btn-whatsapp btn-small", href: book, target: "_blank", rel: "noopener", text: "Book on WhatsApp" }) : null
  );
}

function draw() {
  const query = search.value.trim().toLowerCase();
  const skill = skillSelect.value;
  const shown = data.mechanics.filter((mechanic) => (!skill || mechanic.skills.includes(skill)) && (!query || `${mechanic.area} ${mechanic.city}`.toLowerCase().includes(query)));
  grid.replaceChildren(...shown.map(card));
  $("[data-mechanics-empty]").hidden = shown.length > 0;
  observeReveals(grid);
}
search.addEventListener("input", draw);
skillSelect.addEventListener("change", draw);
draw();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("[data-mechanic-error]");
  error.hidden = true;
  const values = Object.fromEntries(new FormData(form));
  values.skills = new FormData(form).getAll("skills");
  const missing = [["name", "your name"], ["phone", "a phone number"], ["city", "your city"], ["area", "your area"], ["rate", "your price per session"]].find(([key]) => !String(values[key] ?? "").trim());
  const problem = missing ? `Please enter ${missing[1]}.` : values.skills.length ? "" : "Choose at least one kind of work.";
  if (problem) {
    error.textContent = problem;
    error.hidden = false;
    return;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await api("/api/mechanics", { method: "POST", body: values });
    form.hidden = true;
    $("[data-mechanic-done]").hidden = false;
  } catch (failure) {
    error.textContent = failure.message;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});
