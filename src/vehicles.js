import { BRANDS } from "./catalog.js";

// Vehicle database used by search, browse and the Stage 1 graph.
// power/torque are [hp (metric PS), Nm]. Factory figures are manufacturer-published; the Stage 1
// figures are typical starting values. Replace them with your own dyno-verified results.
// ecus lists ECU ids (see ECUS in catalog.js) commonly fitted; the customer still confirms theirs.
// Optional: redline and torqueFrom (rpm) shape the graph for engines that differ from the defaults.
export const VEHICLES = [
  { id: "vw_golf7_gti", brand: "volkswagen", model: "Golf GTI", generation: "Mk7", years: [2013, 2020], engine: "2.0 TSI (EA888 Gen3)", fuel: "petrol", aspiration: "turbo", stock: [220, 350], stage1: [290, 420], ecus: ["simos18", "bosch_med17"], keywords: "golf7 golf 7 mk7" },
  { id: "vw_golf8_gti", brand: "volkswagen", model: "Golf GTI", generation: "Mk8", years: [2020], engine: "2.0 TSI (EA888 Gen4)", fuel: "petrol", aspiration: "turbo", stock: [245, 370], stage1: [300, 430], ecus: ["simos18"], keywords: "golf8 golf 8 mk8" },
  { id: "vw_golf7_r", brand: "volkswagen", model: "Golf R", generation: "Mk7", years: [2014, 2020], engine: "2.0 TSI (EA888 Gen3)", fuel: "petrol", aspiration: "turbo", stock: [300, 380], stage1: [360, 470], ecus: ["simos18", "bosch_med17"], keywords: "golf7 golf 7 mk7", redline: 6800 },
  { id: "vw_golf8_r", brand: "volkswagen", model: "Golf R", generation: "Mk8", years: [2021], engine: "2.0 TSI (EA888 Gen4)", fuel: "petrol", aspiration: "turbo", stock: [320, 420], stage1: [380, 500], ecus: ["simos18"], keywords: "golf8 golf 8 mk8", redline: 6800 },
  { id: "vw_polo_gti", brand: "volkswagen", model: "Polo GTI", generation: "AW", years: [2018], engine: "2.0 TSI (EA888)", fuel: "petrol", aspiration: "turbo", stock: [200, 320], stage1: [250, 390], ecus: ["simos18"], keywords: "polo" },
  { id: "vw_jetta_14", brand: "volkswagen", model: "Jetta", generation: "Mk7", years: [2019], engine: "1.4 TSI (EA211)", fuel: "petrol", aspiration: "turbo", stock: [150, 250], stage1: [175, 300], ecus: [], keywords: "" },
  { id: "vw_tiguan_20", brand: "volkswagen", model: "Tiguan", generation: "AD1", years: [2016, 2023], engine: "2.0 TSI (EA888 Gen3)", fuel: "petrol", aspiration: "turbo", stock: [180, 320], stage1: [235, 400], ecus: ["simos18"], keywords: "" },
  { id: "vw_amarok_v6", brand: "volkswagen", model: "Amarok", generation: "2H", years: [2016, 2022], engine: "3.0 V6 TDI", fuel: "diesel", aspiration: "turbo", stock: [224, 550], stage1: [265, 640], ecus: ["bosch_edc17"], keywords: "v6 tdi" },

  { id: "audi_a3_8v_14", brand: "audi", model: "A3", generation: "8V", years: [2013, 2020], engine: "1.4 TFSI (EA211)", fuel: "petrol", aspiration: "turbo", stock: [150, 250], stage1: [175, 300], ecus: [], keywords: "" },
  { id: "audi_s3_8v", brand: "audi", model: "S3", generation: "8V", years: [2013, 2020], engine: "2.0 TFSI (EA888 Gen3)", fuel: "petrol", aspiration: "turbo", stock: [300, 380], stage1: [360, 470], ecus: ["simos18", "bosch_med17"], keywords: "" },
  { id: "audi_rs3_8v", brand: "audi", model: "RS3", generation: "8V", years: [2017, 2020], engine: "2.5 TFSI 5-cyl", fuel: "petrol", aspiration: "turbo", stock: [400, 480], stage1: [480, 600], ecus: ["bosch_med17"], keywords: "rs 3", redline: 7000, torqueFrom: 1700 },
  { id: "audi_a4_b9_20t", brand: "audi", model: "A4", generation: "B9", years: [2016, 2023], engine: "2.0 TFSI 252", fuel: "petrol", aspiration: "turbo", stock: [252, 370], stage1: [300, 450], ecus: [], keywords: "" },
  { id: "audi_a4_b9_20d", brand: "audi", model: "A4", generation: "B9", years: [2015, 2023], engine: "2.0 TDI 190", fuel: "diesel", aspiration: "turbo", stock: [190, 400], stage1: [225, 460], ecus: ["bosch_edc17", "bosch_md1"], keywords: "" },
  { id: "audi_q5_fy_20t", brand: "audi", model: "Q5", generation: "FY", years: [2017, 2024], engine: "2.0 TFSI 252", fuel: "petrol", aspiration: "turbo", stock: [252, 370], stage1: [300, 450], ecus: [], keywords: "" },

  { id: "bmw_118i_f40", brand: "bmw", model: "118i", generation: "F40", years: [2019], engine: "1.5 3-cyl (B38)", fuel: "petrol", aspiration: "turbo", stock: [140, 220], stage1: [165, 270], ecus: ["bosch_mg1"], keywords: "1 series 1series" },
  { id: "bmw_330i_g20", brand: "bmw", model: "330i", generation: "G20", years: [2019], engine: "2.0 (B48)", fuel: "petrol", aspiration: "turbo", stock: [258, 400], stage1: [310, 480], ecus: ["bosch_mg1"], keywords: "3 series 3series" },
  { id: "bmw_320d_g20", brand: "bmw", model: "320d", generation: "G20", years: [2019], engine: "2.0d (B47)", fuel: "diesel", aspiration: "turbo", stock: [190, 400], stage1: [225, 460], ecus: ["bosch_md1"], keywords: "3 series 3series" },
  { id: "bmw_340i_f30", brand: "bmw", model: "340i", generation: "F30", years: [2015, 2019], engine: "3.0 (B58)", fuel: "petrol", aspiration: "turbo", stock: [326, 450], stage1: [390, 560], ecus: ["bosch_med17"], keywords: "3 series 3series" },
  { id: "bmw_m340i_g20", brand: "bmw", model: "M340i", generation: "G20", years: [2019], engine: "3.0 (B58)", fuel: "petrol", aspiration: "turbo", stock: [374, 500], stage1: [440, 620], ecus: ["bosch_mg1"], keywords: "3 series 3series" },
  { id: "bmw_530i_g30", brand: "bmw", model: "530i", generation: "G30", years: [2017, 2023], engine: "2.0 (B48)", fuel: "petrol", aspiration: "turbo", stock: [252, 350], stage1: [305, 450], ecus: ["bosch_med17", "bosch_mg1"], keywords: "5 series 5series" },
  { id: "bmw_m2c_f87", brand: "bmw", model: "M2 Competition", generation: "F87", years: [2018, 2021], engine: "3.0 (S55)", fuel: "petrol", aspiration: "turbo", stock: [410, 550], stage1: [480, 650], ecus: ["bosch_med17"], keywords: "m2", redline: 7600 },
  { id: "bmw_m3_g80", brand: "bmw", model: "M3/M4 Competition", generation: "G80/G82", years: [2021], engine: "3.0 (S58)", fuel: "petrol", aspiration: "turbo", stock: [510, 650], stage1: [580, 760], ecus: ["bosch_mg1"], keywords: "m3 m4", redline: 7200 },
  { id: "bmw_x3_20d_g01", brand: "bmw", model: "X3 xDrive20d", generation: "G01", years: [2017], engine: "2.0d (B47)", fuel: "diesel", aspiration: "turbo", stock: [190, 400], stage1: [225, 460], ecus: ["bosch_md1", "bosch_edc17"], keywords: "x3 20d" },
  { id: "bmw_x5_30d_g05", brand: "bmw", model: "X5 xDrive30d", generation: "G05", years: [2018], engine: "3.0d (B57)", fuel: "diesel", aspiration: "turbo", stock: [265, 620], stage1: [310, 700], ecus: ["bosch_md1"], keywords: "x5 30d" },

  { id: "mb_a45_w176", brand: "mercedes", model: "AMG A45", generation: "W176", years: [2016, 2018], engine: "2.0 (M133)", fuel: "petrol", aspiration: "turbo", stock: [381, 475], stage1: [430, 560], ecus: ["bosch_med17"], keywords: "a class a45", redline: 6700 },
  { id: "mb_a45s_w177", brand: "mercedes", model: "AMG A45 S", generation: "W177", years: [2019], engine: "2.0 (M139)", fuel: "petrol", aspiration: "turbo", stock: [421, 500], stage1: [470, 590], ecus: ["bosch_mg1"], keywords: "a class a45", redline: 7200 },
  { id: "mb_c200_w205", brand: "mercedes", model: "C200", generation: "W205", years: [2014, 2018], engine: "2.0 (M274)", fuel: "petrol", aspiration: "turbo", stock: [184, 300], stage1: [230, 370], ecus: ["bosch_med17"], keywords: "c class" },
  { id: "mb_c300_w205", brand: "mercedes", model: "C300", generation: "W205", years: [2018, 2021], engine: "2.0 (M264)", fuel: "petrol", aspiration: "turbo", stock: [258, 370], stage1: [300, 450], ecus: [], keywords: "c class" },
  { id: "mb_c63s_w205", brand: "mercedes", model: "AMG C63 S", generation: "W205", years: [2015, 2021], engine: "4.0 V8 biturbo (M177)", fuel: "petrol", aspiration: "turbo", stock: [510, 700], stage1: [590, 850], ecus: ["bosch_med17"], keywords: "c class c63", redline: 7000 },
  { id: "mb_e220d_w213", brand: "mercedes", model: "E220d", generation: "W213", years: [2016, 2023], engine: "2.0d (OM654)", fuel: "diesel", aspiration: "turbo", stock: [194, 400], stage1: [230, 470], ecus: ["bosch_md1"], keywords: "e class" },
  { id: "mb_glc300_x253", brand: "mercedes", model: "GLC 300", generation: "X253", years: [2019, 2022], engine: "2.0 (M264)", fuel: "petrol", aspiration: "turbo", stock: [258, 370], stage1: [300, 450], ecus: [], keywords: "glc" },

  { id: "ford_ranger_32", brand: "ford", model: "Ranger", generation: "PX", years: [2011, 2022], engine: "3.2 TDCi 5-cyl", fuel: "diesel", aspiration: "turbo", stock: [200, 470], stage1: [235, 540], ecus: [], keywords: "wildtrak" },
  { id: "ford_ranger_20bt", brand: "ford", model: "Ranger / Raptor", generation: "PX3", years: [2018, 2022], engine: "2.0 Bi-Turbo", fuel: "diesel", aspiration: "turbo", stock: [213, 500], stage1: [245, 570], ecus: [], keywords: "raptor wildtrak biturbo" },
  { id: "ford_focus_st4", brand: "ford", model: "Focus ST", generation: "Mk4", years: [2019], engine: "2.3 EcoBoost", fuel: "petrol", aspiration: "turbo", stock: [280, 420], stage1: [320, 500], ecus: [], keywords: "focus" },
  { id: "ford_fiesta_st8", brand: "ford", model: "Fiesta ST", generation: "Mk8", years: [2018, 2023], engine: "1.5 EcoBoost", fuel: "petrol", aspiration: "turbo", stock: [200, 290], stage1: [235, 360], ecus: [], keywords: "fiesta" },
  { id: "ford_mustang_23", brand: "ford", model: "Mustang", generation: "S550", years: [2015, 2023], engine: "2.3 EcoBoost", fuel: "petrol", aspiration: "turbo", stock: [317, 432], stage1: [360, 520], ecus: [], keywords: "ecoboost" },
  { id: "ford_mustang_50", brand: "ford", model: "Mustang GT", generation: "S550", years: [2018, 2023], engine: "5.0 V8", fuel: "petrol", aspiration: "naturally_aspirated", stock: [450, 529], stage1: [470, 550], ecus: [], keywords: "coyote v8", redline: 7500, torqueFrom: 4600 },

  { id: "honda_civic_15t", brand: "honda", model: "Civic 1.5 Turbo", generation: "10th gen", years: [2016, 2021], engine: "1.5 VTEC Turbo", fuel: "petrol", aspiration: "turbo", stock: [182, 240], stage1: [215, 300], ecus: [], keywords: "civic fc fk" },
  { id: "honda_civic_fk8", brand: "honda", model: "Civic Type R", generation: "FK8", years: [2017, 2021], engine: "2.0 VTEC Turbo", fuel: "petrol", aspiration: "turbo", stock: [320, 400], stage1: [365, 480], ecus: [], keywords: "civic typer type r", redline: 7000 },
  { id: "honda_accord_15t", brand: "honda", model: "Accord 1.5 Turbo", generation: "10th gen", years: [2018, 2022], engine: "1.5 VTEC Turbo", fuel: "petrol", aspiration: "turbo", stock: [192, 260], stage1: [225, 320], ecus: [], keywords: "accord" },
  { id: "honda_city_15", brand: "honda", model: "City", generation: "GN", years: [2020], engine: "1.5 i-VTEC", fuel: "petrol", aspiration: "naturally_aspirated", stock: [121, 145], stage1: [127, 152], ecus: [], keywords: "" },

  { id: "toyota_hilux_28a", brand: "toyota", model: "Hilux 2.8", generation: "Revo", years: [2015, 2020], engine: "2.8 D-4D (1GD-FTV)", fuel: "diesel", aspiration: "turbo", stock: [177, 450], stage1: [210, 530], ecus: ["denso"], keywords: "hilux revo 1gd" },
  { id: "toyota_hilux_28b", brand: "toyota", model: "Hilux 2.8", generation: "Revo facelift", years: [2020], engine: "2.8 D-4D (1GD-FTV)", fuel: "diesel", aspiration: "turbo", stock: [204, 500], stage1: [235, 580], ecus: ["denso"], keywords: "hilux revo rocco gr sport 1gd" },
  { id: "toyota_fortuner_28", brand: "toyota", model: "Fortuner 2.8", generation: "AN160 facelift", years: [2020], engine: "2.8 D-4D (1GD-FTV)", fuel: "diesel", aspiration: "turbo", stock: [204, 500], stage1: [235, 580], ecus: ["denso"], keywords: "fortuner 1gd" },
  { id: "toyota_hilux_24", brand: "toyota", model: "Hilux / Fortuner 2.4", generation: "AN120/AN160", years: [2015], engine: "2.4 D-4D (2GD-FTV)", fuel: "diesel", aspiration: "turbo", stock: [150, 400], stage1: [180, 470], ecus: ["denso"], keywords: "hilux fortuner 2gd" },
  { id: "toyota_lc200", brand: "toyota", model: "Land Cruiser 200", generation: "J200", years: [2015, 2021], engine: "4.5 V8 D-4D (1VD-FTV)", fuel: "diesel", aspiration: "turbo", stock: [272, 650], stage1: [315, 760], ecus: ["denso"], keywords: "landcruiser lc200 v8", redline: 4200 },
  { id: "toyota_gr_yaris", brand: "toyota", model: "GR Yaris", generation: "GXPA16", years: [2020], engine: "1.6 3-cyl (G16E-GTS)", fuel: "petrol", aspiration: "turbo", stock: [261, 360], stage1: [300, 430], ecus: ["denso"], keywords: "yaris gr", redline: 7000 },
  { id: "toyota_supra_a90", brand: "toyota", model: "GR Supra 3.0", generation: "A90", years: [2019], engine: "3.0 (B58)", fuel: "petrol", aspiration: "turbo", stock: [340, 500], stage1: [410, 600], ecus: ["bosch_mg1"], keywords: "supra gr" },

  { id: "nissan_navara_d23", brand: "nissan", model: "Navara", generation: "D23 / NP300", years: [2015], engine: "2.3 dCi twin-turbo", fuel: "diesel", aspiration: "turbo", stock: [190, 450], stage1: [220, 520], ecus: [], keywords: "np300" },
  { id: "mitsu_triton_24", brand: "mitsubishi", model: "Triton / L200", generation: "5th gen", years: [2015, 2023], engine: "2.4 MIVEC diesel (4N15)", fuel: "diesel", aspiration: "turbo", stock: [181, 430], stage1: [210, 500], ecus: [], keywords: "l200 strada 4n15" },
  { id: "isuzu_dmax_30", brand: "isuzu", model: "D-Max 3.0", generation: "RG", years: [2020], engine: "3.0 (4JJ3-TCX)", fuel: "diesel", aspiration: "turbo", stock: [190, 450], stage1: [215, 510], ecus: ["transtron"], keywords: "dmax d max 4jj3" }
];

// Stage 1 gain limits (as a fraction of stock) used to sanity-check AI estimates.
export const STAGE1_GAINS = {
  "petrol:turbo": { hp: [0.1, 0.4], nm: [0.1, 0.4], typical: [0.22, 0.2] },
  "diesel:turbo": { hp: [0.1, 0.35], nm: [0.1, 0.35], typical: [0.18, 0.18] },
  "petrol:supercharged": { hp: [0.05, 0.2], nm: [0.05, 0.2], typical: [0.1, 0.1] },
  "petrol:naturally_aspirated": { hp: [0.03, 0.1], nm: [0.03, 0.1], typical: [0.05, 0.05] }
};

export function gainPolicy(fuel, aspiration) {
  if (fuel === "diesel") return STAGE1_GAINS["diesel:turbo"];
  return STAGE1_GAINS[`petrol:${aspiration}`] ?? STAGE1_GAINS["petrol:naturally_aspirated"];
}

export function yearsLabel([from, to] = []) {
  if (!from) return "";
  return to ? `${from}–${to}` : `${from}+`;
}

function toVehicle(entry) {
  const { stock, stage1, years, keywords, brand, ...rest } = entry;
  return {
    ...rest,
    source: "catalog",
    brandId: brand,
    brand: BRANDS[brand]?.title ?? brand,
    years: yearsLabel(years),
    yearRange: years,
    stock: { hp: stock[0], nm: stock[1] },
    stage1: { hp: stage1[0], nm: stage1[1] },
    tunable: true
  };
}

export function getVehicle(id) {
  const entry = VEHICLES.find((vehicle) => vehicle.id === id);
  return entry ? toVehicle(entry) : undefined;
}

export function vehiclesForBrand(brandId) {
  return VEHICLES.filter((vehicle) => vehicle.brand === brandId).map(toVehicle);
}

export function brandsWithVehicles() {
  return Object.entries(BRANDS).filter(([id]) => VEHICLES.some((vehicle) => vehicle.brand === id));
}

export function vehicleName(vehicle) {
  return [vehicle.brand, vehicle.model, vehicle.generation].filter(Boolean).join(" ");
}

export function vehicleButtonLabel(vehicle) {
  const years = vehicle.years ? ` (${vehicle.years})` : "";
  return `${vehicle.model} ${vehicle.generation} · ${vehicle.engine.replace(/\s*\(.*\)$/, "")}${years}`;
}

export function stage1Gain(vehicle) {
  const hp = vehicle.stage1.hp - vehicle.stock.hp;
  const nm = vehicle.stage1.nm - vehicle.stock.nm;
  return { hp, nm, hpPercent: Math.round((hp / vehicle.stock.hp) * 100), nmPercent: Math.round((nm / vehicle.stock.nm) * 100) };
}

export function normalizeSearch(value) {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
}

function searchText(entry) {
  const brand = BRANDS[entry.brand];
  return normalizeSearch([brand?.title, ...(brand?.aliases ?? []), entry.model, entry.generation, entry.engine, entry.keywords].join(" "));
}

// Every non-year word must match the start of a word (or appear inside the text for 3+ characters).
// A model year acts as a ranking hint rather than a filter.
export function searchVehicles(query, limit = 8) {
  const tokens = normalizeSearch(query).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const yearTokens = tokens.filter((token) => /^(19|20)\d\d$/.test(token)).map(Number);
  const wordTokens = tokens.filter((token) => !/^(19|20)\d\d$/.test(token));
  if (!wordTokens.length) return [];
  const results = [];
  VEHICLES.forEach((entry, index) => {
    const text = searchText(entry);
    const words = text.split(" ");
    const compact = text.replace(/ /g, "");
    let score = 0;
    for (const token of wordTokens) {
      if (words.includes(token)) score += 3;
      else if (words.some((word) => word.startsWith(token))) score += 2;
      else if (token.length >= 3 && compact.includes(token)) score += 1;
      else return;
    }
    for (const year of yearTokens) {
      const [from, to = 9999] = entry.years;
      score += year >= from && year <= to ? 2 : -2;
    }
    results.push({ entry, score, index });
  });
  return results
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ entry }) => toVehicle(entry));
}
