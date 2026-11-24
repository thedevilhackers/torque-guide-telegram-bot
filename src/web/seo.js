import { settings } from "../db.js";

// What search engines read beyond the page text: the business as structured data (where it is, the
// areas it serves, who runs it), the questions each page answers, and the city pages.
//
// The wording stays factual: the workshop is in Ranchi, so the Kolkata and Shillong pages say so and
// point to a visit by appointment or the online file service. No "best in India" claims, no dyno
// claims, nothing about removing emissions equipment.

export const CITY_PAGES = {
  "car-tuning-ranchi.html": { path: "/car-tuning-ranchi", city: "Ranchi", region: "Jharkhand" },
  "car-tuning-kolkata.html": { path: "/car-tuning-kolkata", city: "Kolkata", region: "West Bengal" },
  "car-tuning-shillong.html": { path: "/car-tuning-shillong", city: "Shillong", region: "Meghalaya" }
};

const AREAS_SERVED = [
  { "@type": "City", name: "Ranchi" },
  { "@type": "City", name: "Kolkata" },
  { "@type": "City", name: "Shillong" },
  { "@type": "State", name: "Jharkhand" },
  { "@type": "State", name: "West Bengal" },
  { "@type": "State", name: "Meghalaya" },
  { "@type": "Country", name: "India" }
];

const KNOWS_ABOUT = [
  "ECU remapping", "Stage 1 tuning", "Stage 2 tuning", "Stage 3 tuning", "Diesel tuning", "Petrol tuning",
  "Gearbox (TCU) tuning", "Tuning files", "Car diagnostics", "Ceramic coating", "Car detailing"
];

const FILE_SERVICE = ["Is there an online tuning file service?", "Yes. Tuners and workshops anywhere in India can open an account, buy credits, upload the original read from their tool (Autotuner, KESS3, Flex and others) and download the tuned file once it's ready."];

// Questions and answers shown on each page (as a list you can open) and sent as FAQ structured data,
// so the two always match.
export const FAQS = {
  "index.html": [
    ["Where can I get car tuning in Ranchi?", "At the Unity Performance workshop in Argora, Ranchi, Jharkhand. Message us on WhatsApp with your car and we'll book a time."],
    ["What is a Stage 1 ECU remap?", "A software update for the engine control unit (ECU). We read the original file, adjust boost, fuelling and ignition within the limits of the standard engine, and write it back. No parts are changed, and the original file is kept so the car can go back to stock."],
    ["How much does car tuning cost?", "It depends on the car and its ECU, so we check yours first and tell you the price before any work starts. Send the make, model and engine on WhatsApp for a quote."],
    ["Is ECU remapping safe for my engine?", "A Stage 1 map stays within what the standard engine, turbo and gearbox are built for. We scan the car for faults and check its condition before tuning. Power figures on this site are estimates for healthy, standard cars; real results depend on condition and fuel."],
    ["Do you tune diesel cars and SUVs?", "Yes: petrol and diesel cars, SUVs and pickups, as long as our tools can read the ECU. Search your car on this page to see its ECU and the expected gains."],
    ["Do you remove DPF, EGR or AdBlue systems?", "No. We keep all emissions equipment in place and working, and we don't remove immobilisers."],
    ["Do you serve Kolkata, Shillong and the rest of India?", "Yes. Drivers from Kolkata, Shillong and across East and North-East India can bring their car to our Ranchi workshop by appointment, and tuners anywhere in India can order tuning files online through our file service."],
    ["Can my car go back to standard?", "Yes. We save the original file from your ECU before writing a tune, so we can put it back whenever you need, for example before you sell the car."],
    ["Do you do ceramic coating and detailing in Ranchi?", "Yes. Alongside tuning we do ceramic coating, detailing, diagnostics and servicing at the same workshop."]
  ],
  "car-tuning-ranchi.html": [
    ["Where is your tuning workshop in Ranchi?", "In Argora, Ranchi: L-12, Argora Housing Colony, Ranchi, Jharkhand 834002. Message us on WhatsApp before you come and we'll book a time."],
    ["How much is an ECU remap in Ranchi?", "It depends on the car and its ECU, so we check yours first and tell you the price before any work starts. Send the make, model and engine on WhatsApp for a quote."],
    ["Do I need an appointment?", "Yes, please book on WhatsApp. We check which ECU your car has before the visit, so we can keep the time free and have the right tool ready."],
    ["Do you tune cars from Jamshedpur, Dhanbad and Bokaro?", "Yes. Drivers from anywhere in Jharkhand can bring their car to our Ranchi workshop by appointment."],
    ["Do you remove DPF, EGR or AdBlue systems?", "No. We keep all emissions equipment in place and working, and we don't remove immobilisers."]
  ],
  "car-tuning-kolkata.html": [
    ["Do you have a workshop in Kolkata?", "No. Our workshop is in Ranchi, Jharkhand. Drivers from Kolkata book a time on WhatsApp and bring the car to Ranchi; tuners and workshops in Kolkata can order tuning files online."],
    ["Will a remap help in city traffic?", "Stage 1 adds most of its torque in the mid range, the part of the rev range you use pulling away in traffic and overtaking on the highway."],
    ["How much does car tuning cost?", "It depends on the car and its ECU, so we check yours first and tell you the price before any work starts. Send the make, model and engine on WhatsApp for a quote."],
    FILE_SERVICE,
    ["Do you remove DPF, EGR or AdBlue systems?", "No. We keep all emissions equipment in place and working, and we don't remove immobilisers."]
  ],
  "car-tuning-shillong.html": [
    ["Do you have a workshop in Shillong?", "No. Our workshop is in Ranchi, Jharkhand. Drivers from Shillong and Meghalaya book a time on WhatsApp and bring the car to Ranchi; tuners in the North-East can order tuning files online."],
    ["Is tuning useful on hill roads?", "Climbs and overtaking on hill roads rely on low and mid-range torque, which is where a Stage 1 map adds most of its gain. Search your car to see its figures."],
    ["How much does car tuning cost?", "It depends on the car and its ECU, so we check yours first and tell you the price before any work starts. Send the make, model and engine on WhatsApp for a quote."],
    FILE_SERVICE,
    ["Do you remove DPF, EGR or AdBlue systems?", "No. We keep all emissions equipment in place and working, and we don't remove immobilisers."]
  ]
};

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

// "<" is escaped so no setting can close the script element.
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;

// "L-12, Argora Housing Colony, Ranchi, Jharkhand 834002" → a postal address search engines can
// place; any other format is sent as it was typed.
export function postalAddress(address) {
  const match = /^(.+),\s*([^,]+?),\s*([^,\d]+?)\s+(\d{6})$/.exec(String(address ?? "").trim());
  if (!match) return address || undefined;
  return { "@type": "PostalAddress", streetAddress: match[1], addressLocality: match[2], addressRegion: match[3], postalCode: match[4], addressCountry: "IN" };
}

function business(origin) {
  const current = settings();
  return {
    "@context": "https://schema.org",
    "@type": "AutoRepair",
    "@id": `${origin}/#business`,
    name: current.businessName,
    alternateName: "Unity Motorsports Performance",
    description: "Car tuning and ECU remapping workshop in Ranchi, Jharkhand: Stage 1, 2 and 3 for petrol and diesel cars, gearbox tuning, diagnostics, ceramic coating and detailing, plus an online tuning file service for tuners across India.",
    ...(current.tagline && { slogan: current.tagline }),
    url: `${origin}/`,
    image: `${origin}/brand/share.jpg`,
    logo: `${origin}/brand/logo.png`,
    ...(current.phone && { telephone: current.phone }),
    ...(current.email && { email: current.email }),
    ...(current.address && { address: postalAddress(current.address) }),
    ...(Number.isFinite(current.latitude) && Number.isFinite(current.longitude) && { geo: { "@type": "GeoCoordinates", latitude: current.latitude, longitude: current.longitude } }),
    ...(current.ownerName && { founder: { "@type": "Person", name: current.ownerName, ...(current.ownerTitle && { jobTitle: current.ownerTitle }) } }),
    priceRange: "₹₹",
    currenciesAccepted: "INR",
    areaServed: AREAS_SERVED,
    knowsAbout: KNOWS_ABOUT,
    sameAs: [current.instagram, current.facebook, current.tiktok, current.youtube].filter(Boolean)
  };
}

function faqData(items) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } }))
  };
}

function cityData(origin, { path, city, region }) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Service",
      name: `Car tuning and ECU remapping for ${city}`,
      serviceType: "ECU remapping",
      provider: { "@id": `${origin}/#business` },
      areaServed: [{ "@type": "City", name: city }, { "@type": "State", name: region }],
      url: `${origin}${path}`
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${origin}/` },
        { "@type": "ListItem", position: 2, name: `Car tuning in ${city}`, item: `${origin}${path}` }
      ]
    }
  ];
}

// Structured data for a page: the business everywhere it's asked for, plus the page's own questions
// and, on a city page, the service in that city.
export function structuredData(origin, page) {
  const blocks = [business(origin)];
  if (CITY_PAGES[page]) blocks.push(...cityData(origin, CITY_PAGES[page]));
  if (FAQS[page]) blocks.push(faqData(FAQS[page]));
  return blocks.map(jsonLd).join("\n  ");
}

export function faqHtml(page) {
  const items = FAQS[page] ?? [];
  return items.map(([question, answer]) => `<details class="faq-item reveal"><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`).join("\n          ");
}

// "Founded by …" under the About section, once the owner's name is set in the admin panel.
export function founderHtml() {
  const { ownerName, ownerTitle } = settings();
  if (!ownerName) return "";
  return `<p class="founder reveal"><span class="founder-name">${escapeHtml(ownerName)}</span>${ownerTitle ? ` <span class="founder-title">${escapeHtml(ownerTitle)}</span>` : ""}</p>`;
}
