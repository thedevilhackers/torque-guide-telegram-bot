import { $, api, bootPage, h, whatsappUrl } from "./common.js";

// /refer: sign up for a code, share it, and check what it has earned.
const { site } = await bootPage();
const rupees = (amount) => `₹${Number(amount).toLocaleString("en-IN")}`;
const form = $("[data-refer-form]");

let program = { open: true, reward: 0, discount: 0, terms: [] };
try {
  program = await api("/api/refer");
  if (program.reward || program.discount) {
    $("[data-refer-lead]").textContent = `Friends get ${rupees(program.discount)} off their car tune with your code, and you earn ${rupees(program.reward)} when it's done. A simple way to earn alongside your job or studies.`;
    $("[data-refer-discount]").textContent = `${rupees(program.discount)} off`;
    $("[data-refer-reward]").textContent = rupees(program.reward);
  }
  if (program.terms.length) {
    $("[data-refer-terms]").replaceChildren(...program.terms.map((term) => h("li", { text: term })));
    $("[data-refer-terms-box]").hidden = false;
  }
  if (!program.open) {
    form.hidden = true;
    $("[data-refer-closed]").hidden = false;
  }
} catch {
  // The form still works; the server checks everything again.
}

const showError = (element, message) => {
  element.textContent = message;
  element.hidden = false;
};

function showCode(code, existing) {
  form.hidden = true;
  const link = `${location.origin}/?ref=${encodeURIComponent(code)}`;
  const offer = program.discount ? `Get ${rupees(program.discount)} off your car tune at ${site.settings.businessName}, Ranchi.` : `Get your car tuned at ${site.settings.businessName}, Ranchi.`;
  const message = `${offer} Use my code ${code} when you book: ${link}`;
  $("[data-refer-code]").textContent = code;
  if (existing) $("[data-refer-done-label]").textContent = "This number already has a code";
  const copy = h("button", { class: "btn btn-outline", type: "button", text: "Copy link" });
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(message);
      copy.textContent = "Copied ✓";
    } catch {
      copy.textContent = link;
    }
  });
  $("[data-refer-share]").replaceChildren(h("a", { class: "btn btn-whatsapp", href: whatsappUrl("", message), target: "_blank", rel: "noopener", text: "Share on WhatsApp" }), copy);
  $("[data-refer-done]").hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("[data-refer-error]");
  error.hidden = true;
  const values = Object.fromEntries(new FormData(form));
  const missing = [["name", "your name"], ["phone", "your WhatsApp number"], ["city", "your city"]].find(([key]) => !String(values[key] ?? "").trim());
  if (missing) return showError(error, `Please enter ${missing[1]}.`);
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const { code, existing } = await api("/api/refer", { method: "POST", body: values });
    showCode(code, existing);
  } catch (failure) {
    showError(error, failure.message);
  } finally {
    button.disabled = false;
  }
});

const earningsForm = $("[data-earnings-form]");
earningsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("[data-earnings-error]");
  error.hidden = true;
  const values = Object.fromEntries(new FormData(earningsForm));
  if (!values.code.trim() || !values.phone.trim()) return showError(error, "Enter your code and the WhatsApp number you signed up with.");
  try {
    const status = await api("/api/refer/status", { method: "POST", body: values });
    const row = (label, value) => [h("dt", { text: label }), h("dd", { text: value })];
    $("[data-earnings]").replaceChildren(
      ...row("Code", `${status.code}${status.active ? "" : " (paused)"}`),
      ...row("Bookings with your code", String(status.referred)),
      ...row("Waiting for the tune", String(status.pending)),
      ...row("Earned, to be paid", rupees(status.owed)),
      ...row("Paid to you", rupees(status.paid))
    );
    $("[data-earnings]").hidden = false;
  } catch (failure) {
    showError(error, failure.message);
  }
});
