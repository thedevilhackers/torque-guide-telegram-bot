// The home page: menu, reveals, business details and the visit request form. A request is saved
// (it appears in the admin panel and alerts the workshop on Telegram), then WhatsApp opens with the
// details so the customer can follow up there.
import { $, applySettings, observeReveals, setupNav, whatsappUrl } from "./lux.js";

// Links to the old home page's sections (#car=…, #find, …) now live on /finder.
if (/^#(car=|find|stage1|work)/.test(location.hash)) location.replace(`/finder${location.hash}`);

setupNav();
observeReveals();
const settingsReady = applySettings();

const form = $("[data-booking]");
const status = $("[data-status]", form);

function showStatus(text, kind = "", link = null) {
  status.className = `form__status full${kind ? ` is-${kind}` : ""}`;
  status.replaceChildren(text);
  if (link) {
    const anchor = document.createElement("a");
    anchor.href = link.href;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    anchor.textContent = link.text;
    status.append(" ", anchor);
  }
}

const RULES = {
  name: (value) => (value.length >= 2 ? "" : "Please enter your name."),
  phone: (value) => (/^\+?[\d\s().-]+$/.test(value) && value.replace(/\D/g, "").length >= 10 ? "" : "Please enter a 10-digit mobile number."),
  car: (value) => (value.length >= 3 ? "" : "Tell us the make, model and year."),
  service: (value) => (value ? "" : "Choose a service.")
};

for (const name of Object.keys(RULES)) form.elements[name].addEventListener("input", () => form.elements[name].removeAttribute("aria-invalid"));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = (name) => form.elements[name].value.trim();
  const problems = Object.entries(RULES).filter(([name, rule]) => rule(value(name)));
  for (const name of Object.keys(RULES)) form.elements[name].toggleAttribute("aria-invalid", problems.some(([field]) => field === name));
  if (problems.length) {
    const [name, rule] = problems[0];
    form.elements[name].focus();
    showStatus(rule(value(name)), "error");
    return;
  }
  const details = { name: value("name"), phone: value("phone"), car: value("car"), service: value("service"), note: value("note") };
  const button = $("button[type=submit]", form);
  button.disabled = true;
  showStatus("Sending…");
  let saved = false;
  try {
    const response = await fetch("/api/enquiries", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        name: details.name,
        phone: details.phone,
        message: `Visit request from the home page. Car: ${details.car}. Service: ${details.service}.${details.note ? ` Note: ${details.note}` : ""}`
      })
    });
    if (response.status === 400) {
      const body = await response.json().catch(() => ({}));
      showStatus(body.error || "Please check your details and try again.", "error");
      return;
    }
    saved = response.ok;
  } catch {
    // WhatsApp below still works.
  } finally {
    button.disabled = false;
  }
  const settings = await settingsReady;
  const text = [
    `Hi ${settings?.businessName || "Unity Performance"}, I'd like to book a visit.`,
    `Name: ${details.name}`,
    `Phone: ${details.phone}`,
    `Car: ${details.car}`,
    `Service: ${details.service}`,
    details.note ? `Note: ${details.note}` : ""
  ].filter(Boolean).join("\n");
  const href = whatsappUrl(settings?.whatsappNumber || "918709647229", text);
  if (saved) form.reset();
  showStatus(saved ? `Thank you, ${details.name}. We'll confirm a time on WhatsApp.` : "Your message is ready to send.", saved ? "done" : "", { href, text: saved ? "Message us now" : "Open WhatsApp" });
});
