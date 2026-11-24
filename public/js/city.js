import { $, bootPage, h, whatsappUrl } from "./common.js";

// The city pages (/car-tuning-ranchi and the others): the shared menu, bag and settings, plus a
// WhatsApp button for booking that names the city the visitor came from.
const { site } = await bootPage();
const { settings } = site;
const city = document.body.dataset.city;

if (settings.whatsappNumber) {
  const text = `Hello ${settings.businessName}, I'd like to book car tuning (${city}). My car is: `;
  $("[data-city-actions]").prepend(h("a", { class: "btn btn-whatsapp", href: whatsappUrl(settings.whatsappNumber, text), target: "_blank", rel: "noopener", text: "Book on WhatsApp" }));
}
