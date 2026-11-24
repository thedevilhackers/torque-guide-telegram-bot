import { $, bootPage, observeReveals, offerCard } from "./common.js";

// /offers: every current offer from Admin → Offers, each with a WhatsApp button.
const { site } = await bootPage();
const offers = site.offers ?? [];
$("[data-offers]").replaceChildren(...offers.map((offer, index) => offerCard(offer, site.settings, index * 0.06)));
$("[data-offers-empty]").hidden = offers.length > 0;
observeReveals();
