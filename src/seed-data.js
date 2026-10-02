// Default data used the first time the database is created (see db.js).
// After that, everything here is managed from the admin panel.

// Brands shown in "Browse by brand". aliases help the vehicle search match what customers type.
export const SEED_BRANDS = [
  { id: "audi", title: "Audi", aliases: [] },
  { id: "bmw", title: "BMW", aliases: [] },
  { id: "citroen", title: "Citroen", aliases: [] },
  { id: "fiat", title: "Fiat", aliases: [] },
  { id: "force", title: "Force Motors", aliases: [] },
  { id: "ford", title: "Ford", aliases: [] },
  { id: "honda", title: "Honda", aliases: [] },
  { id: "hyundai", title: "Hyundai", aliases: [] },
  { id: "isuzu", title: "Isuzu", aliases: [] },
  { id: "jeep", title: "Jeep", aliases: [] },
  { id: "kia", title: "Kia", aliases: [] },
  { id: "mahindra", title: "Mahindra", aliases: ["m&m", "mahindra and mahindra"] },
  { id: "maruti", title: "Maruti Suzuki", aliases: ["maruti", "suzuki", "msil"] },
  { id: "mercedes", title: "Mercedes-Benz", aliases: ["mercedes", "merc", "benz", "mb", "amg"] },
  { id: "mg", title: "MG", aliases: ["mg motor", "morris garages"] },
  { id: "mitsubishi", title: "Mitsubishi", aliases: [] },
  { id: "nissan", title: "Nissan", aliases: [] },
  { id: "renault", title: "Renault", aliases: [] },
  { id: "skoda", title: "Skoda", aliases: [] },
  { id: "tata", title: "Tata", aliases: ["tata motors"] },
  { id: "toyota", title: "Toyota", aliases: [] },
  { id: "volkswagen", title: "Volkswagen", aliases: ["vw"] }
];

// ECU support list, used by the "ECU check" step.
// status: "supported" | "on_request" | "not_supported". Edit this to match your tools and licences.
// More ECU families, on request until confirmed per vehicle.
// How Autotuner and KESS3 read each ECU family: OBD (through the diagnostic port), bench (ECU removed)
// or boot (ECU opened). Autotuner's methods are every method its compatibility list (October 2026) gives
// for at least one ECU of the family; KESS3's are typical. The exact hardware and software number
// decides, so the workshop confirms each car; the owner can change these in the admin panel.
const ALL_METHODS = ["obd", "bench", "boot"];
const ECU_TOOLS = {
  bosch_med17: { autotuner: ALL_METHODS, kess3: ALL_METHODS },
  bosch_mg1: { autotuner: ["obd", "bench"], kess3: ["obd", "bench"] },
  simos18: { autotuner: ["obd", "boot"], kess3: ALL_METHODS },
  bosch_edc17: { autotuner: ALL_METHODS, kess3: ALL_METHODS },
  bosch_md1: { autotuner: ["obd", "bench"], kess3: ["obd", "bench"] },
  continental_sid: { autotuner: ALL_METHODS, kess3: ALL_METHODS },
  denso: { autotuner: ["obd", "bench"], kess3: ALL_METHODS },
  delphi: { autotuner: ["obd", "boot"], kess3: ["bench", "boot"] },
  transtron: { autotuner: ["obd"], kess3: ["bench"] },
  continental_sim2k: { autotuner: ALL_METHODS, kess3: ["obd", "bench"] },
  keihin: { autotuner: ["obd"], kess3: ["bench"] },
  marelli: { autotuner: ALL_METHODS, kess3: ALL_METHODS },
  kefico: { autotuner: ALL_METHODS, kess3: ["bench"] },
  continental_ems3: { autotuner: ALL_METHODS, kess3: ["obd", "bench"] },
  bosch_me7: { autotuner: ALL_METHODS, kess3: ALL_METHODS },
  bosch_edc16: { autotuner: ["obd", "bench"], kess3: ALL_METHODS },
  hitachi: { autotuner: ["obd"], kess3: ["bench"] }
};
const withTools = (ecu) => ({ ...ecu, tools: structuredClone(ECU_TOOLS[ecu.id]) });

const NEW_ECUS = [
  { id: "kefico", title: "Kefico (Hyundai / Kia)", fuels: ["petrol"], status: "on_request", method: "Confirmed per vehicle" },
  { id: "continental_ems3", title: "Continental EMS3 (Renault / Nissan)", fuels: ["petrol"], status: "on_request", method: "Confirmed per vehicle" },
  { id: "bosch_me7", title: "Bosch ME7 / ME9", fuels: ["petrol"], status: "on_request", method: "OBD or bench, depending on version" },
  { id: "bosch_edc16", title: "Bosch EDC15 / EDC16", fuels: ["diesel"], status: "on_request", method: "OBD or bench, depending on version" },
  { id: "hitachi", title: "Hitachi (Nissan / Suzuki)", fuels: ["petrol"], status: "on_request", method: "Confirmed per vehicle" }
].map(withTools);

export const SEED_ECUS = [
  { id: "bosch_med17", title: "Bosch MED17 / ME17 / MEVD17", fuels: ["petrol"], status: "supported", method: "OBD flash with Autotuner or KESS3, no ECU removal" },
  { id: "bosch_mg1", title: "Bosch MG1", fuels: ["petrol"], status: "supported", method: "One-time bench unlock, then OBD flash" },
  { id: "simos18", title: "Continental Simos 18", fuels: ["petrol"], status: "supported", method: "OBD flash with Autotuner or KESS3, no ECU removal" },
  { id: "bosch_edc17", title: "Bosch EDC17", fuels: ["diesel"], status: "supported", method: "OBD flash with Autotuner or KESS3, no ECU removal" },
  { id: "bosch_md1", title: "Bosch MD1", fuels: ["diesel"], status: "supported", method: "One-time bench unlock, then OBD flash" },
  { id: "continental_sid", title: "Continental / Siemens SID", fuels: ["diesel"], status: "supported", method: "OBD or bench, depending on version" },
  { id: "denso", title: "Denso", fuels: ["petrol", "diesel"], status: "supported", method: "OBD or bench, depending on model" },
  { id: "delphi", title: "Delphi DCM", fuels: ["diesel"], status: "on_request", method: "Bench read, confirmed per vehicle" },
  { id: "transtron", title: "Transtron (Isuzu)", fuels: ["diesel"], status: "on_request", method: "Bench read, confirmed per vehicle" },
  { id: "continental_sim2k", title: "Continental SIM2K", fuels: ["petrol"], status: "on_request", method: "Bench read, confirmed per vehicle" },
  { id: "keihin", title: "Keihin (Honda)", fuels: ["petrol"], status: "on_request", method: "Confirmed per vehicle" },
  { id: "marelli", title: "Magneti Marelli", fuels: ["petrol", "diesel"], status: "on_request", method: "Confirmed per vehicle" }
].map(withTools).concat(NEW_ECUS);

// The ECU list a database was first created with, updated while still unedited.
const LAUNCH_ECUS = [
  { id: "bosch_med17", title: "Bosch MED17 / MEVD17", fuels: ["petrol"], status: "supported", method: "OBD flash — no ECU removal" },
  { id: "bosch_mg1", title: "Bosch MG1", fuels: ["petrol"], status: "supported", method: "One-time bench unlock, then OBD flash" },
  { id: "simos18", title: "Continental Simos 18", fuels: ["petrol"], status: "supported", method: "OBD flash — no ECU removal" },
  { id: "bosch_edc17", title: "Bosch EDC17", fuels: ["diesel"], status: "supported", method: "OBD flash — no ECU removal" },
  { id: "bosch_md1", title: "Bosch MD1", fuels: ["diesel"], status: "supported", method: "One-time bench unlock, then OBD flash" },
  { id: "continental_sid", title: "Continental / Siemens SID", fuels: ["diesel"], status: "supported", method: "OBD or bench, depending on version" },
  { id: "denso", title: "Denso", fuels: ["petrol", "diesel"], status: "supported", method: "OBD or bench, depending on model" },
  { id: "delphi", title: "Delphi DCM", fuels: ["diesel"], status: "on_request", method: "Bench read — confirmed per vehicle" },
  { id: "transtron", title: "Transtron (Isuzu)", fuels: ["diesel"], status: "on_request", method: "Bench read — confirmed per vehicle" },
  { id: "continental_sim2k", title: "Continental SIM2K", fuels: ["petrol"], status: "on_request", method: "Bench read — confirmed per vehicle" },
  { id: "keihin", title: "Keihin (Honda)", fuels: ["petrol"], status: "on_request", method: "Confirmed per vehicle" },
  { id: "marelli", title: "Magneti Marelli", fuels: ["petrol", "diesel"], status: "on_request", method: "Confirmed per vehicle" }
];

// Vehicle database used by search, browse and the Stage 1 graph.
// power/torque are [hp (metric PS), Nm]. Factory figures are manufacturer-published; the Stage 1
// figures are typical starting values. Replace them with your own verified results.
// ecus lists ECU ids commonly fitted; the customer still confirms theirs.
// stage2 / stage3 are optional sample figures for builds with supporting hardware (Stage 2) and an
// upgraded turbo (Stage 3); naturally aspirated engines are Stage 1 only.
// Optional: redline and torqueFrom (rpm) shape the graph for engines that differ from the defaults.
const LAUNCH_VEHICLES = [
  { id: "vw_golf7_gti", brand: "volkswagen", model: "Golf GTI", generation: "Mk7", years: [2013, 2020], engine: "2.0 TSI (EA888 Gen3)", fuel: "petrol", aspiration: "turbo", stock: [220, 350], stage1: [290, 420], stage2: [320, 450], stage3: [375, 485], ecus: ["simos18", "bosch_med17"], keywords: "golf7 golf 7 mk7" },
  { id: "vw_golf8_gti", brand: "volkswagen", model: "Golf GTI", generation: "Mk8", years: [2020], engine: "2.0 TSI (EA888 Gen4)", fuel: "petrol", aspiration: "turbo", stock: [245, 370], stage1: [300, 430], stage2: [330, 460], stage3: [390, 495], ecus: ["simos18"], keywords: "golf8 golf 8 mk8" },
  { id: "vw_golf7_r", brand: "volkswagen", model: "Golf R", generation: "Mk7", years: [2014, 2020], engine: "2.0 TSI (EA888 Gen3)", fuel: "petrol", aspiration: "turbo", stock: [300, 380], stage1: [360, 470], stage2: [395, 505], stage3: [470, 540], ecus: ["simos18", "bosch_med17"], keywords: "golf7 golf 7 mk7", redline: 6800 },
  { id: "vw_golf8_r", brand: "volkswagen", model: "Golf R", generation: "Mk8", years: [2021], engine: "2.0 TSI (EA888 Gen4)", fuel: "petrol", aspiration: "turbo", stock: [320, 420], stage1: [380, 500], stage2: [420, 535], stage3: [495, 575], ecus: ["simos18"], keywords: "golf8 golf 8 mk8", redline: 6800 },
  { id: "vw_polo_gti", brand: "volkswagen", model: "Polo GTI", generation: "AW", years: [2018], engine: "2.0 TSI (EA888)", fuel: "petrol", aspiration: "turbo", stock: [200, 320], stage1: [250, 390], stage2: [275, 415], stage3: [325, 450], ecus: ["simos18"], keywords: "polo" },
  { id: "vw_jetta_14", brand: "volkswagen", model: "Jetta", generation: "Mk7", years: [2019], engine: "1.4 TSI (EA211)", fuel: "petrol", aspiration: "turbo", stock: [150, 250], stage1: [175, 300], stage2: [195, 320], stage3: [230, 345], ecus: [], keywords: "" },
  { id: "vw_tiguan_20", brand: "volkswagen", model: "Tiguan", generation: "AD1", years: [2016, 2023], engine: "2.0 TSI (EA888 Gen3)", fuel: "petrol", aspiration: "turbo", stock: [180, 320], stage1: [235, 400], stage2: [260, 430], stage3: [305, 460], ecus: ["simos18"], keywords: "" },
  { id: "vw_amarok_v6", brand: "volkswagen", model: "Amarok", generation: "2H", years: [2016, 2022], engine: "3.0 V6 TDI", fuel: "diesel", aspiration: "turbo", stock: [224, 550], stage1: [265, 640], stage2: [285, 685], stage3: [325, 750], ecus: ["bosch_edc17"], keywords: "v6 tdi" },

  { id: "audi_a3_8v_14", brand: "audi", model: "A3", generation: "8V", years: [2013, 2020], engine: "1.4 TFSI (EA211)", fuel: "petrol", aspiration: "turbo", stock: [150, 250], stage1: [175, 300], stage2: [195, 320], stage3: [230, 345], ecus: [], keywords: "" },
  { id: "audi_s3_8v", brand: "audi", model: "S3", generation: "8V", years: [2013, 2020], engine: "2.0 TFSI (EA888 Gen3)", fuel: "petrol", aspiration: "turbo", stock: [300, 380], stage1: [360, 470], stage2: [395, 505], stage3: [470, 540], ecus: ["simos18", "bosch_med17"], keywords: "" },
  { id: "audi_rs3_8v", brand: "audi", model: "RS3", generation: "8V", years: [2017, 2020], engine: "2.5 TFSI 5-cyl", fuel: "petrol", aspiration: "turbo", stock: [400, 480], stage1: [480, 600], stage2: [530, 640], stage3: [625, 690], ecus: ["bosch_med17"], keywords: "rs 3", redline: 7000, torqueFrom: 1700 },
  { id: "audi_a4_b9_20t", brand: "audi", model: "A4", generation: "B9", years: [2016, 2023], engine: "2.0 TFSI 252", fuel: "petrol", aspiration: "turbo", stock: [252, 370], stage1: [300, 450], stage2: [330, 480], stage3: [390, 520], ecus: [], keywords: "" },
  { id: "audi_a4_b9_20d", brand: "audi", model: "A4", generation: "B9", years: [2015, 2023], engine: "2.0 TDI 190", fuel: "diesel", aspiration: "turbo", stock: [190, 400], stage1: [225, 460], stage2: [245, 490], stage3: [275, 540], ecus: ["bosch_edc17", "bosch_md1"], keywords: "" },
  { id: "audi_q5_fy_20t", brand: "audi", model: "Q5", generation: "FY", years: [2017, 2024], engine: "2.0 TFSI 252", fuel: "petrol", aspiration: "turbo", stock: [252, 370], stage1: [300, 450], stage2: [330, 480], stage3: [390, 520], ecus: [], keywords: "" },

  { id: "bmw_118i_f40", brand: "bmw", model: "118i", generation: "F40", years: [2019], engine: "1.5 3-cyl (B38)", fuel: "petrol", aspiration: "turbo", stock: [140, 220], stage1: [165, 270], stage2: [180, 290], stage3: [215, 310], ecus: ["bosch_mg1"], keywords: "1 series 1series" },
  { id: "bmw_330i_g20", brand: "bmw", model: "330i", generation: "G20", years: [2019], engine: "2.0 (B48)", fuel: "petrol", aspiration: "turbo", stock: [258, 400], stage1: [310, 480], stage2: [340, 515], stage3: [405, 550], ecus: ["bosch_mg1"], keywords: "3 series 3series" },
  { id: "bmw_320d_g20", brand: "bmw", model: "320d", generation: "G20", years: [2019], engine: "2.0d (B47)", fuel: "diesel", aspiration: "turbo", stock: [190, 400], stage1: [225, 460], stage2: [245, 490], stage3: [275, 540], ecus: ["bosch_md1"], keywords: "3 series 3series" },
  { id: "bmw_340i_f30", brand: "bmw", model: "340i", generation: "F30", years: [2015, 2019], engine: "3.0 (B58)", fuel: "petrol", aspiration: "turbo", stock: [326, 450], stage1: [390, 560], stage2: [430, 600], stage3: [505, 645], ecus: ["bosch_med17"], keywords: "3 series 3series" },
  { id: "bmw_m340i_g20", brand: "bmw", model: "M340i", generation: "G20", years: [2019], engine: "3.0 (B58)", fuel: "petrol", aspiration: "turbo", stock: [374, 500], stage1: [440, 620], stage2: [485, 665], stage3: [570, 715], ecus: ["bosch_mg1"], keywords: "3 series 3series" },
  { id: "bmw_530i_g30", brand: "bmw", model: "530i", generation: "G30", years: [2017, 2023], engine: "2.0 (B48)", fuel: "petrol", aspiration: "turbo", stock: [252, 350], stage1: [305, 450], stage2: [335, 480], stage3: [395, 520], ecus: ["bosch_med17", "bosch_mg1"], keywords: "5 series 5series" },
  { id: "bmw_m2c_f87", brand: "bmw", model: "M2 Competition", generation: "F87", years: [2018, 2021], engine: "3.0 (S55)", fuel: "petrol", aspiration: "turbo", stock: [410, 550], stage1: [480, 650], stage2: [530, 695], stage3: [625, 745], ecus: ["bosch_med17"], keywords: "m2", redline: 7600 },
  { id: "bmw_m3_g80", brand: "bmw", model: "M3/M4 Competition", generation: "G80/G82", years: [2021], engine: "3.0 (S58)", fuel: "petrol", aspiration: "turbo", stock: [510, 650], stage1: [580, 760], stage2: [640, 815], stage3: [755, 875], ecus: ["bosch_mg1"], keywords: "m3 m4", redline: 7200 },
  { id: "bmw_x3_20d_g01", brand: "bmw", model: "X3 xDrive20d", generation: "G01", years: [2017], engine: "2.0d (B47)", fuel: "diesel", aspiration: "turbo", stock: [190, 400], stage1: [225, 460], stage2: [245, 490], stage3: [275, 540], ecus: ["bosch_md1", "bosch_edc17"], keywords: "x3 20d" },
  { id: "bmw_x5_30d_g05", brand: "bmw", model: "X5 xDrive30d", generation: "G05", years: [2018], engine: "3.0d (B57)", fuel: "diesel", aspiration: "turbo", stock: [265, 620], stage1: [310, 700], stage2: [335, 750], stage3: [380, 820], ecus: ["bosch_md1"], keywords: "x5 30d" },

  { id: "mb_a45_w176", brand: "mercedes", model: "AMG A45", generation: "W176", years: [2016, 2018], engine: "2.0 (M133)", fuel: "petrol", aspiration: "turbo", stock: [381, 475], stage1: [430, 560], stage2: [475, 600], stage3: [560, 645], ecus: ["bosch_med17"], keywords: "a class a45", redline: 6700 },
  { id: "mb_a45s_w177", brand: "mercedes", model: "AMG A45 S", generation: "W177", years: [2019], engine: "2.0 (M139)", fuel: "petrol", aspiration: "turbo", stock: [421, 500], stage1: [470, 590], stage2: [515, 630], stage3: [610, 680], ecus: ["bosch_mg1"], keywords: "a class a45", redline: 7200 },
  { id: "mb_c200_w205", brand: "mercedes", model: "C200", generation: "W205", years: [2014, 2018], engine: "2.0 (M274)", fuel: "petrol", aspiration: "turbo", stock: [184, 300], stage1: [230, 370], stage2: [255, 395], stage3: [300, 425], ecus: ["bosch_med17"], keywords: "c class" },
  { id: "mb_c300_w205", brand: "mercedes", model: "C300", generation: "W205", years: [2018, 2021], engine: "2.0 (M264)", fuel: "petrol", aspiration: "turbo", stock: [258, 370], stage1: [300, 450], stage2: [330, 480], stage3: [390, 520], ecus: [], keywords: "c class" },
  { id: "mb_c63s_w205", brand: "mercedes", model: "AMG C63 S", generation: "W205", years: [2015, 2021], engine: "4.0 V8 biturbo (M177)", fuel: "petrol", aspiration: "turbo", stock: [510, 700], stage1: [590, 850], stage2: [650, 910], stage3: [765, 975], ecus: ["bosch_med17"], keywords: "c class c63", redline: 7000 },
  { id: "mb_e220d_w213", brand: "mercedes", model: "E220d", generation: "W213", years: [2016, 2023], engine: "2.0d (OM654)", fuel: "diesel", aspiration: "turbo", stock: [194, 400], stage1: [230, 470], stage2: [250, 505], stage3: [280, 550], ecus: ["bosch_md1"], keywords: "e class" },
  { id: "mb_glc300_x253", brand: "mercedes", model: "GLC 300", generation: "X253", years: [2019, 2022], engine: "2.0 (M264)", fuel: "petrol", aspiration: "turbo", stock: [258, 370], stage1: [300, 450], stage2: [330, 480], stage3: [390, 520], ecus: [], keywords: "glc" },

  { id: "ford_ranger_32", brand: "ford", model: "Ranger", generation: "PX", years: [2011, 2022], engine: "3.2 TDCi 5-cyl", fuel: "diesel", aspiration: "turbo", stock: [200, 470], stage1: [235, 540], stage2: [255, 580], stage3: [285, 630], ecus: [], keywords: "wildtrak" },
  { id: "ford_ranger_20bt", brand: "ford", model: "Ranger / Raptor", generation: "PX3", years: [2018, 2022], engine: "2.0 Bi-Turbo", fuel: "diesel", aspiration: "turbo", stock: [213, 500], stage1: [245, 570], stage2: [265, 610], stage3: [300, 665], ecus: [], keywords: "raptor wildtrak biturbo" },
  { id: "ford_focus_st4", brand: "ford", model: "Focus ST", generation: "Mk4", years: [2019], engine: "2.3 EcoBoost", fuel: "petrol", aspiration: "turbo", stock: [280, 420], stage1: [320, 500], stage2: [350, 535], stage3: [415, 575], ecus: [], keywords: "focus" },
  { id: "ford_fiesta_st8", brand: "ford", model: "Fiesta ST", generation: "Mk8", years: [2018, 2023], engine: "1.5 EcoBoost", fuel: "petrol", aspiration: "turbo", stock: [200, 290], stage1: [235, 360], stage2: [260, 385], stage3: [305, 415], ecus: [], keywords: "fiesta" },
  { id: "ford_mustang_23", brand: "ford", model: "Mustang", generation: "S550", years: [2015, 2023], engine: "2.3 EcoBoost", fuel: "petrol", aspiration: "turbo", stock: [317, 432], stage1: [360, 520], stage2: [395, 555], stage3: [470, 600], ecus: [], keywords: "ecoboost" },
  { id: "ford_mustang_50", brand: "ford", model: "Mustang GT", generation: "S550", years: [2018, 2023], engine: "5.0 V8", fuel: "petrol", aspiration: "naturally_aspirated", stock: [450, 529], stage1: [470, 550], ecus: [], keywords: "coyote v8", redline: 7500, torqueFrom: 4600 },

  { id: "honda_civic_15t", brand: "honda", model: "Civic 1.5 Turbo", generation: "10th gen", years: [2016, 2021], engine: "1.5 VTEC Turbo", fuel: "petrol", aspiration: "turbo", stock: [182, 240], stage1: [215, 300], stage2: [235, 320], stage3: [280, 345], ecus: [], keywords: "civic fc fk" },
  { id: "honda_civic_fk8", brand: "honda", model: "Civic Type R", generation: "FK8", years: [2017, 2021], engine: "2.0 VTEC Turbo", fuel: "petrol", aspiration: "turbo", stock: [320, 400], stage1: [365, 480], stage2: [400, 515], stage3: [475, 550], ecus: [], keywords: "civic typer type r", redline: 7000 },
  { id: "honda_accord_15t", brand: "honda", model: "Accord 1.5 Turbo", generation: "10th gen", years: [2018, 2022], engine: "1.5 VTEC Turbo", fuel: "petrol", aspiration: "turbo", stock: [192, 260], stage1: [225, 320], stage2: [250, 340], stage3: [290, 370], ecus: [], keywords: "accord" },
  { id: "honda_city_15", brand: "honda", model: "City", generation: "GN", years: [2020], engine: "1.5 i-VTEC", fuel: "petrol", aspiration: "naturally_aspirated", stock: [121, 145], stage1: [127, 152], ecus: [], keywords: "" },

  { id: "toyota_hilux_28a", brand: "toyota", model: "Hilux 2.8", generation: "Revo", years: [2015, 2020], engine: "2.8 D-4D (1GD-FTV)", fuel: "diesel", aspiration: "turbo", stock: [177, 450], stage1: [210, 530], stage2: [225, 565], stage3: [255, 620], ecus: ["denso"], keywords: "hilux revo 1gd" },
  { id: "toyota_hilux_28b", brand: "toyota", model: "Hilux 2.8", generation: "Revo facelift", years: [2020], engine: "2.8 D-4D (1GD-FTV)", fuel: "diesel", aspiration: "turbo", stock: [204, 500], stage1: [235, 580], stage2: [255, 620], stage3: [285, 680], ecus: ["denso"], keywords: "hilux revo rocco gr sport 1gd" },
  { id: "toyota_fortuner_28", brand: "toyota", model: "Fortuner 2.8", generation: "AN160 facelift", years: [2020], engine: "2.8 D-4D (1GD-FTV)", fuel: "diesel", aspiration: "turbo", stock: [204, 500], stage1: [235, 580], stage2: [255, 620], stage3: [285, 680], ecus: ["denso"], keywords: "fortuner 1gd" },
  { id: "toyota_hilux_24", brand: "toyota", model: "Hilux / Fortuner 2.4", generation: "AN120/AN160", years: [2015], engine: "2.4 D-4D (2GD-FTV)", fuel: "diesel", aspiration: "turbo", stock: [150, 400], stage1: [180, 470], stage2: [195, 505], stage3: [220, 550], ecus: ["denso"], keywords: "hilux fortuner 2gd" },
  { id: "toyota_lc200", brand: "toyota", model: "Land Cruiser 200", generation: "J200", years: [2015, 2021], engine: "4.5 V8 D-4D (1VD-FTV)", fuel: "diesel", aspiration: "turbo", stock: [272, 650], stage1: [315, 760], stage2: [340, 815], stage3: [385, 890], ecus: ["denso"], keywords: "landcruiser lc200 v8", redline: 4200 },
  { id: "toyota_gr_yaris", brand: "toyota", model: "GR Yaris", generation: "GXPA16", years: [2020], engine: "1.6 3-cyl (G16E-GTS)", fuel: "petrol", aspiration: "turbo", stock: [261, 360], stage1: [300, 430], stage2: [330, 460], stage3: [390, 495], ecus: ["denso"], keywords: "yaris gr", redline: 7000 },
  { id: "toyota_supra_a90", brand: "toyota", model: "GR Supra 3.0", generation: "A90", years: [2019], engine: "3.0 (B58)", fuel: "petrol", aspiration: "turbo", stock: [340, 500], stage1: [410, 600], stage2: [450, 640], stage3: [535, 690], ecus: ["bosch_mg1"], keywords: "supra gr" },

  { id: "nissan_navara_d23", brand: "nissan", model: "Navara", generation: "D23 / NP300", years: [2015], engine: "2.3 dCi twin-turbo", fuel: "diesel", aspiration: "turbo", stock: [190, 450], stage1: [220, 520], stage2: [240, 555], stage3: [270, 610], ecus: [], keywords: "np300" },
  { id: "mitsu_triton_24", brand: "mitsubishi", model: "Triton / L200", generation: "5th gen", years: [2015, 2023], engine: "2.4 MIVEC diesel (4N15)", fuel: "diesel", aspiration: "turbo", stock: [181, 430], stage1: [210, 500], stage2: [225, 535], stage3: [255, 585], ecus: [], keywords: "l200 strada 4n15" },
  { id: "isuzu_dmax_30", brand: "isuzu", model: "D-Max 3.0", generation: "RG", years: [2020], engine: "3.0 (4JJ3-TCX)", fuel: "diesel", aspiration: "turbo", stock: [190, 450], stage1: [215, 510], stage2: [230, 545], stage3: [260, 595], ecus: ["transtron"], keywords: "dmax d max 4jj3" },
];

// Popular Indian-market cars, petrol and diesel.
const INDIA_VEHICLES = [
  { id: "maruti_swift_k12", brand: "maruti", model: "Swift / Dzire", generation: "3rd gen", years: [2021, 2024], engine: "1.2 K12N DualJet", fuel: "petrol", aspiration: "naturally_aspirated", stock: [90, 113], stage1: [95, 120], ecus: [], keywords: "swift dzire k12n" },
  { id: "maruti_swift_z12", brand: "maruti", model: "Swift / Dzire", generation: "4th gen", years: [2024], engine: "1.2 Z12E", fuel: "petrol", aspiration: "naturally_aspirated", stock: [82, 112], stage1: [85, 120], ecus: [], keywords: "swift dzire z12e" },
  { id: "maruti_baleno_rs", brand: "maruti", model: "Baleno RS", generation: "1st gen", years: [2017, 2020], engine: "1.0 BoosterJet turbo", fuel: "petrol", aspiration: "turbo", stock: [102, 150], stage1: [120, 185], stage2: [130, 195], stage3: [150, 205], ecus: [], keywords: "baleno rs boosterjet" },
  { id: "maruti_baleno_k12", brand: "maruti", model: "Baleno", generation: "2nd gen", years: [2022], engine: "1.2 K12N DualJet", fuel: "petrol", aspiration: "naturally_aspirated", stock: [90, 113], stage1: [95, 120], ecus: [], keywords: "baleno glanza k12n" },
  { id: "maruti_fronx_10t", brand: "maruti", model: "Fronx Turbo", generation: "", years: [2023], engine: "1.0 BoosterJet turbo", fuel: "petrol", aspiration: "turbo", stock: [100, 148], stage1: [120, 180], stage2: [130, 190], stage3: [150, 200], ecus: [], keywords: "fronx taisor boosterjet" },
  { id: "maruti_brezza_k15", brand: "maruti", model: "Brezza", generation: "2nd gen", years: [2022], engine: "1.5 K15C", fuel: "petrol", aspiration: "naturally_aspirated", stock: [103, 137], stage1: [110, 145], ecus: [], keywords: "vitara brezza k15c" },
  { id: "maruti_ertiga_k15", brand: "maruti", model: "Ertiga / XL6", generation: "", years: [2022], engine: "1.5 K15C", fuel: "petrol", aspiration: "naturally_aspirated", stock: [103, 137], stage1: [110, 145], ecus: [], keywords: "ertiga xl6 k15c" },
  { id: "maruti_ciaz_k15", brand: "maruti", model: "Ciaz", generation: "", years: [2018], engine: "1.5 K15B", fuel: "petrol", aspiration: "naturally_aspirated", stock: [105, 138], stage1: [110, 145], ecus: [], keywords: "ciaz k15b" },
  { id: "maruti_jimny_k15", brand: "maruti", model: "Jimny", generation: "5-door", years: [2023], engine: "1.5 K15B", fuel: "petrol", aspiration: "naturally_aspirated", stock: [105, 134], stage1: [110, 140], ecus: [], keywords: "jimny k15b" },
  { id: "maruti_vitara_k15", brand: "maruti", model: "Grand Vitara", generation: "", years: [2022], engine: "1.5 K15C mild hybrid", fuel: "petrol", aspiration: "naturally_aspirated", stock: [103, 137], stage1: [110, 145], ecus: [], keywords: "grand vitara hyryder k15c" },
  { id: "maruti_ddis_190", brand: "maruti", model: "Swift / Dzire Diesel", generation: "", years: [2011, 2020], engine: "1.3 DDiS 190", fuel: "diesel", aspiration: "turbo", stock: [75, 190], stage1: [90, 230], stage2: [95, 245], stage3: [105, 260], ecus: ["marelli"], keywords: "swift dzire ddis multijet" },
  { id: "maruti_ddis_200", brand: "maruti", model: "Brezza / Ertiga / Ciaz Diesel", generation: "", years: [2016, 2020], engine: "1.3 DDiS 200", fuel: "diesel", aspiration: "turbo", stock: [90, 200], stage1: [105, 240], stage2: [110, 255], stage3: [125, 270], ecus: ["marelli"], keywords: "vitara brezza ertiga ciaz s-cross scross ddis multijet" },
  { id: "hyundai_creta_14t", brand: "hyundai", model: "Creta Turbo", generation: "2nd gen", years: [2020, 2023], engine: "1.4 T-GDi", fuel: "petrol", aspiration: "turbo", stock: [140, 242], stage1: [165, 290], stage2: [180, 305], stage3: [205, 325], ecus: [], keywords: "creta tgdi" },
  { id: "hyundai_creta_15t", brand: "hyundai", model: "Creta Turbo", generation: "facelift", years: [2024], engine: "1.5 T-GDi", fuel: "petrol", aspiration: "turbo", stock: [160, 253], stage1: [190, 305], stage2: [205, 325], stage3: [240, 340], ecus: [], keywords: "creta n line nline tgdi" },
  { id: "hyundai_creta_crdi", brand: "hyundai", model: "Creta Diesel", generation: "", years: [2020], engine: "1.5 CRDi", fuel: "diesel", aspiration: "turbo", stock: [116, 250], stage1: [135, 300], stage2: [145, 320], stage3: [160, 335], ecus: [], keywords: "creta crdi" },
  { id: "hyundai_creta_mpi", brand: "hyundai", model: "Creta Petrol", generation: "", years: [2020], engine: "1.5 MPi", fuel: "petrol", aspiration: "naturally_aspirated", stock: [115, 144], stage1: [120, 150], ecus: [], keywords: "creta mpi" },
  { id: "hyundai_verna_15t", brand: "hyundai", model: "Verna Turbo", generation: "6th gen", years: [2023], engine: "1.5 T-GDi", fuel: "petrol", aspiration: "turbo", stock: [160, 253], stage1: [190, 305], stage2: [205, 325], stage3: [240, 340], ecus: [], keywords: "verna tgdi" },
  { id: "hyundai_verna_crdi", brand: "hyundai", model: "Verna Diesel", generation: "5th gen", years: [2020, 2023], engine: "1.5 CRDi", fuel: "diesel", aspiration: "turbo", stock: [116, 250], stage1: [135, 300], stage2: [145, 320], stage3: [160, 335], ecus: [], keywords: "verna crdi" },
  { id: "hyundai_venue_10t", brand: "hyundai", model: "Venue Turbo", generation: "", years: [2019], engine: "1.0 T-GDi", fuel: "petrol", aspiration: "turbo", stock: [120, 172], stage1: [145, 210], stage2: [155, 225], stage3: [180, 235], ecus: [], keywords: "venue n line nline tgdi" },
  { id: "hyundai_venue_crdi", brand: "hyundai", model: "Venue Diesel", generation: "", years: [2021], engine: "1.5 CRDi", fuel: "diesel", aspiration: "turbo", stock: [116, 250], stage1: [135, 300], stage2: [145, 320], stage3: [160, 335], ecus: [], keywords: "venue crdi" },
  { id: "hyundai_i20_10t", brand: "hyundai", model: "i20 / i20 N Line", generation: "3rd gen", years: [2020], engine: "1.0 T-GDi", fuel: "petrol", aspiration: "turbo", stock: [120, 172], stage1: [145, 210], stage2: [155, 225], stage3: [180, 235], ecus: [], keywords: "i20 n line nline tgdi" },
  { id: "hyundai_nios_10t", brand: "hyundai", model: "Grand i10 Nios / Aura Turbo", generation: "", years: [2020, 2023], engine: "1.0 T-GDi", fuel: "petrol", aspiration: "turbo", stock: [100, 172], stage1: [120, 210], stage2: [130, 225], stage3: [150, 235], ecus: [], keywords: "grand i10 nios aura tgdi" },
  { id: "hyundai_alcazar_crdi", brand: "hyundai", model: "Alcazar Diesel", generation: "", years: [2021], engine: "1.5 CRDi", fuel: "diesel", aspiration: "turbo", stock: [116, 250], stage1: [135, 300], stage2: [145, 320], stage3: [160, 335], ecus: [], keywords: "alcazar crdi" },
  { id: "hyundai_tucson_20d", brand: "hyundai", model: "Tucson Diesel", generation: "4th gen", years: [2022], engine: "2.0 CRDi", fuel: "diesel", aspiration: "turbo", stock: [186, 416], stage1: [220, 500], stage2: [235, 530], stage3: [260, 560], ecus: [], keywords: "tucson crdi" },
  { id: "kia_seltos_14t", brand: "kia", model: "Seltos Turbo", generation: "1st gen", years: [2019, 2022], engine: "1.4 T-GDi", fuel: "petrol", aspiration: "turbo", stock: [140, 242], stage1: [165, 290], stage2: [180, 305], stage3: [205, 325], ecus: [], keywords: "seltos gtx tgdi" },
  { id: "kia_seltos_15t", brand: "kia", model: "Seltos Turbo", generation: "facelift", years: [2023], engine: "1.5 T-GDi", fuel: "petrol", aspiration: "turbo", stock: [160, 253], stage1: [190, 305], stage2: [205, 325], stage3: [240, 340], ecus: [], keywords: "seltos gtx tgdi" },
  { id: "kia_seltos_crdi", brand: "kia", model: "Seltos Diesel", generation: "", years: [2019], engine: "1.5 CRDi", fuel: "diesel", aspiration: "turbo", stock: [116, 250], stage1: [135, 300], stage2: [145, 320], stage3: [160, 335], ecus: [], keywords: "seltos crdi" },
  { id: "kia_sonet_10t", brand: "kia", model: "Sonet Turbo", generation: "", years: [2020], engine: "1.0 T-GDi", fuel: "petrol", aspiration: "turbo", stock: [120, 172], stage1: [145, 210], stage2: [155, 225], stage3: [180, 235], ecus: [], keywords: "sonet gtx tgdi" },
  { id: "kia_sonet_crdi", brand: "kia", model: "Sonet Diesel", generation: "", years: [2020], engine: "1.5 CRDi", fuel: "diesel", aspiration: "turbo", stock: [116, 250], stage1: [135, 300], stage2: [145, 320], stage3: [160, 335], ecus: [], keywords: "sonet crdi" },
  { id: "kia_carens_15t", brand: "kia", model: "Carens Turbo", generation: "", years: [2023], engine: "1.5 T-GDi", fuel: "petrol", aspiration: "turbo", stock: [160, 253], stage1: [190, 305], stage2: [205, 325], stage3: [240, 340], ecus: [], keywords: "carens tgdi" },
  { id: "kia_carens_crdi", brand: "kia", model: "Carens Diesel", generation: "", years: [2022], engine: "1.5 CRDi", fuel: "diesel", aspiration: "turbo", stock: [116, 250], stage1: [135, 300], stage2: [145, 320], stage3: [160, 335], ecus: [], keywords: "carens crdi" },
  { id: "kia_carnival_22", brand: "kia", model: "Carnival", generation: "", years: [2020, 2023], engine: "2.2 CRDi", fuel: "diesel", aspiration: "turbo", stock: [200, 440], stage1: [235, 530], stage2: [250, 560], stage3: [275, 595], ecus: [], keywords: "carnival crdi" },
  { id: "tata_nexon_12t", brand: "tata", model: "Nexon Petrol", generation: "", years: [2017], engine: "1.2 Revotron turbo", fuel: "petrol", aspiration: "turbo", stock: [120, 170], stage1: [145, 205], stage2: [155, 215], stage3: [180, 230], ecus: [], keywords: "nexon revotron" },
  { id: "tata_nexon_15d", brand: "tata", model: "Nexon Diesel", generation: "", years: [2017], engine: "1.5 Revotorq", fuel: "diesel", aspiration: "turbo", stock: [110, 260], stage1: [130, 310], stage2: [140, 330], stage3: [155, 345], ecus: [], keywords: "nexon revotorq" },
  { id: "tata_altroz_it", brand: "tata", model: "Altroz iTurbo", generation: "", years: [2021], engine: "1.2 iTurbo", fuel: "petrol", aspiration: "turbo", stock: [110, 140], stage1: [130, 170], stage2: [140, 180], stage3: [160, 190], ecus: [], keywords: "altroz racer revotron" },
  { id: "tata_altroz_15d", brand: "tata", model: "Altroz Diesel", generation: "", years: [2020], engine: "1.5 Revotorq", fuel: "diesel", aspiration: "turbo", stock: [90, 200], stage1: [105, 240], stage2: [110, 255], stage3: [125, 270], ecus: [], keywords: "altroz revotorq" },
  { id: "tata_harrier_20", brand: "tata", model: "Harrier / Safari", generation: "", years: [2020], engine: "2.0 Kryotec", fuel: "diesel", aspiration: "turbo", stock: [170, 350], stage1: [200, 420], stage2: [215, 445], stage3: [235, 470], ecus: ["bosch_edc17"], keywords: "harrier safari kryotec multijet" },
  { id: "tata_tiago_jtp", brand: "tata", model: "Tiago / Tigor JTP", generation: "", years: [2018, 2020], engine: "1.2 Revotron turbo", fuel: "petrol", aspiration: "turbo", stock: [114, 150], stage1: [135, 185], stage2: [145, 195], stage3: [170, 205], ecus: [], keywords: "tiago tigor jtp" },
  { id: "tata_curvv_12t", brand: "tata", model: "Curvv Turbo", generation: "", years: [2024], engine: "1.2 Hyperion GDi turbo", fuel: "petrol", aspiration: "turbo", stock: [125, 225], stage1: [150, 275], stage2: [160, 290], stage3: [190, 310], ecus: [], keywords: "curvv hyperion" },
  { id: "tata_hexa_22", brand: "tata", model: "Hexa", generation: "", years: [2017, 2020], engine: "2.2 Varicor 400", fuel: "diesel", aspiration: "turbo", stock: [156, 400], stage1: [185, 480], stage2: [200, 510], stage3: [220, 540], ecus: [], keywords: "hexa varicor" },
  { id: "tata_punch_12", brand: "tata", model: "Punch / Tiago", generation: "", years: [2021], engine: "1.2 Revotron", fuel: "petrol", aspiration: "naturally_aspirated", stock: [86, 113], stage1: [90, 120], ecus: [], keywords: "punch tiago tigor revotron" },
  { id: "mahindra_thar_20t", brand: "mahindra", model: "Thar Petrol", generation: "2nd gen", years: [2020], engine: "2.0 mStallion turbo", fuel: "petrol", aspiration: "turbo", stock: [150, 320], stage1: [175, 385], stage2: [190, 410], stage3: [220, 430], ecus: [], keywords: "thar roxx mstallion" },
  { id: "mahindra_thar_22d", brand: "mahindra", model: "Thar Diesel", generation: "2nd gen", years: [2020], engine: "2.2 mHawk", fuel: "diesel", aspiration: "turbo", stock: [130, 300], stage1: [155, 360], stage2: [165, 380], stage3: [185, 405], ecus: ["bosch_edc17"], keywords: "thar roxx mhawk" },
  { id: "mahindra_scorpn_20t", brand: "mahindra", model: "Scorpio-N Petrol", generation: "", years: [2022], engine: "2.0 mStallion turbo", fuel: "petrol", aspiration: "turbo", stock: [203, 370], stage1: [240, 445], stage2: [260, 470], stage3: [300, 500], ecus: [], keywords: "scorpio n scorpion mstallion" },
  { id: "mahindra_scorpn_22d", brand: "mahindra", model: "Scorpio-N Diesel", generation: "", years: [2022], engine: "2.2 mHawk", fuel: "diesel", aspiration: "turbo", stock: [175, 400], stage1: [205, 480], stage2: [220, 510], stage3: [240, 540], ecus: ["bosch_edc17"], keywords: "scorpio n scorpion mhawk" },
  { id: "mahindra_scorpio_cl", brand: "mahindra", model: "Scorpio Classic", generation: "", years: [2022], engine: "2.2 mHawk", fuel: "diesel", aspiration: "turbo", stock: [132, 300], stage1: [155, 360], stage2: [165, 380], stage3: [185, 405], ecus: ["bosch_edc17"], keywords: "scorpio classic mhawk" },
  { id: "mahindra_xuv700_20t", brand: "mahindra", model: "XUV700 Petrol", generation: "", years: [2021], engine: "2.0 mStallion turbo", fuel: "petrol", aspiration: "turbo", stock: [200, 380], stage1: [235, 455], stage2: [255, 480], stage3: [295, 510], ecus: [], keywords: "xuv700 xuv 700 mstallion" },
  { id: "mahindra_xuv700_22d", brand: "mahindra", model: "XUV700 Diesel", generation: "", years: [2021], engine: "2.2 mHawk", fuel: "diesel", aspiration: "turbo", stock: [185, 420], stage1: [220, 505], stage2: [235, 535], stage3: [260, 565], ecus: ["bosch_edc17"], keywords: "xuv700 xuv 700 mhawk" },
  { id: "mahindra_xuv500_22d", brand: "mahindra", model: "XUV500", generation: "", years: [2015, 2021], engine: "2.2 mHawk", fuel: "diesel", aspiration: "turbo", stock: [155, 360], stage1: [185, 430], stage2: [200, 455], stage3: [220, 480], ecus: ["bosch_edc17"], keywords: "xuv500 xuv 500 mhawk" },
  { id: "mahindra_xuv300_12t", brand: "mahindra", model: "XUV300 / XUV 3XO Turbo", generation: "", years: [2022], engine: "1.2 TGDi", fuel: "petrol", aspiration: "turbo", stock: [130, 230], stage1: [155, 280], stage2: [165, 295], stage3: [195, 315], ecus: [], keywords: "xuv300 xuv 300 xuv3xo 3xo tgdi" },
  { id: "mahindra_xuv300_15d", brand: "mahindra", model: "XUV300 / XUV 3XO Diesel", generation: "", years: [2019], engine: "1.5 turbo diesel", fuel: "diesel", aspiration: "turbo", stock: [117, 300], stage1: [140, 360], stage2: [150, 380], stage3: [165, 405], ecus: [], keywords: "xuv300 xuv 300 xuv3xo 3xo" },
  { id: "mahindra_bolero_15d", brand: "mahindra", model: "Bolero", generation: "", years: [2020], engine: "1.5 mHawk75", fuel: "diesel", aspiration: "turbo", stock: [76, 210], stage1: [90, 250], stage2: [95, 265], stage3: [105, 280], ecus: [], keywords: "bolero mhawk" },
  { id: "toyota_crysta_24", brand: "toyota", model: "Innova Crysta 2.4", generation: "", years: [2016], engine: "2.4 D-4D (2GD-FTV)", fuel: "diesel", aspiration: "turbo", stock: [150, 343], stage1: [175, 410], stage2: [185, 435], stage3: [205, 460], ecus: ["denso"], keywords: "innova crysta 2gd" },
  { id: "toyota_crysta_28", brand: "toyota", model: "Innova Crysta 2.8", generation: "", years: [2016, 2020], engine: "2.8 D-4D (1GD-FTV)", fuel: "diesel", aspiration: "turbo", stock: [174, 360], stage1: [205, 430], stage2: [220, 455], stage3: [240, 480], ecus: ["denso"], keywords: "innova crysta 1gd" },
  { id: "toyota_fortuner_27", brand: "toyota", model: "Fortuner 2.7 Petrol", generation: "", years: [2016], engine: "2.7 (2TR-FE)", fuel: "petrol", aspiration: "naturally_aspirated", stock: [166, 245], stage1: [175, 255], ecus: ["denso"], keywords: "fortuner 2tr" },
  { id: "honda_city_15d", brand: "honda", model: "City Diesel", generation: "5th gen", years: [2020, 2023], engine: "1.5 i-DTEC", fuel: "diesel", aspiration: "turbo", stock: [100, 200], stage1: [120, 240], stage2: [130, 255], stage3: [140, 270], ecus: [], keywords: "city idtec" },
  { id: "honda_elevate_15", brand: "honda", model: "Elevate", generation: "", years: [2023], engine: "1.5 i-VTEC", fuel: "petrol", aspiration: "naturally_aspirated", stock: [121, 145], stage1: [125, 150], ecus: [], keywords: "elevate ivtec" },
  { id: "honda_amaze_15d", brand: "honda", model: "Amaze Diesel", generation: "", years: [2018, 2023], engine: "1.5 i-DTEC", fuel: "diesel", aspiration: "turbo", stock: [100, 200], stage1: [120, 240], stage2: [130, 255], stage3: [140, 270], ecus: [], keywords: "amaze idtec" },
  { id: "vw_virtus_10", brand: "volkswagen", model: "Virtus / Taigun 1.0 TSI", generation: "", years: [2021], engine: "1.0 TSI", fuel: "petrol", aspiration: "turbo", stock: [115, 178], stage1: [140, 215], stage2: [150, 230], stage3: [175, 240], ecus: [], keywords: "virtus taigun tsi" },
  { id: "vw_virtus_15", brand: "volkswagen", model: "Virtus / Taigun GT", generation: "", years: [2021], engine: "1.5 TSI EVO", fuel: "petrol", aspiration: "turbo", stock: [150, 250], stage1: [175, 300], stage2: [190, 320], stage3: [220, 335], ecus: [], keywords: "virtus taigun gt tsi" },
  { id: "vw_polo_10tsi", brand: "volkswagen", model: "Polo 1.0 TSI", generation: "India", years: [2020, 2022], engine: "1.0 TSI", fuel: "petrol", aspiration: "turbo", stock: [110, 175], stage1: [130, 215], stage2: [140, 230], stage3: [160, 240], ecus: [], keywords: "polo tsi" },
  { id: "skoda_slavia_10", brand: "skoda", model: "Slavia / Kushaq / Kylaq 1.0 TSI", generation: "", years: [2021], engine: "1.0 TSI", fuel: "petrol", aspiration: "turbo", stock: [115, 178], stage1: [140, 215], stage2: [150, 230], stage3: [175, 240], ecus: [], keywords: "slavia kushaq kylaq tsi" },
  { id: "skoda_slavia_15", brand: "skoda", model: "Slavia / Kushaq 1.5 TSI", generation: "", years: [2021], engine: "1.5 TSI EVO", fuel: "petrol", aspiration: "turbo", stock: [150, 250], stage1: [175, 300], stage2: [190, 320], stage3: [220, 335], ecus: [], keywords: "slavia kushaq tsi" },
  { id: "skoda_octavia_20", brand: "skoda", model: "Octavia / Superb / Kodiaq", generation: "", years: [2021], engine: "2.0 TSI", fuel: "petrol", aspiration: "turbo", stock: [190, 320], stage1: [225, 385], stage2: [245, 410], stage3: [280, 430], ecus: [], keywords: "octavia superb kodiaq tsi" },
  { id: "skoda_octavia_rs", brand: "skoda", model: "Octavia RS 245", generation: "3rd gen", years: [2020], engine: "2.0 TSI", fuel: "petrol", aspiration: "turbo", stock: [245, 370], stage1: [290, 445], stage2: [315, 470], stage3: [360, 500], ecus: [], keywords: "octavia rs vrs tsi" },
  { id: "mg_hector_15t", brand: "mg", model: "Hector Turbo", generation: "", years: [2019], engine: "1.5 turbo petrol", fuel: "petrol", aspiration: "turbo", stock: [143, 250], stage1: [170, 300], stage2: [185, 320], stage3: [210, 335], ecus: [], keywords: "hector plus" },
  { id: "mg_hector_20d", brand: "mg", model: "Hector Diesel", generation: "", years: [2019], engine: "2.0 Multijet", fuel: "diesel", aspiration: "turbo", stock: [170, 350], stage1: [200, 420], stage2: [215, 445], stage3: [235, 470], ecus: ["bosch_edc17"], keywords: "hector plus multijet" },
  { id: "mg_gloster_20", brand: "mg", model: "Gloster", generation: "", years: [2020], engine: "2.0 twin-turbo diesel", fuel: "diesel", aspiration: "turbo", stock: [218, 480], stage1: [255, 575], stage2: [275, 610], stage3: [300, 645], ecus: [], keywords: "gloster" },
  { id: "mg_astor_13t", brand: "mg", model: "Astor Turbo", generation: "", years: [2021], engine: "1.3 turbo petrol", fuel: "petrol", aspiration: "turbo", stock: [140, 220], stage1: [165, 265], stage2: [180, 280], stage3: [205, 295], ecus: [], keywords: "astor" },
  { id: "renault_kiger_10t", brand: "renault", model: "Kiger Turbo", generation: "", years: [2021], engine: "1.0 TCe turbo", fuel: "petrol", aspiration: "turbo", stock: [100, 160], stage1: [120, 195], stage2: [130, 205], stage3: [150, 220], ecus: [], keywords: "kiger tce" },
  { id: "nissan_magnite_10t", brand: "nissan", model: "Magnite Turbo", generation: "", years: [2020], engine: "1.0 HRA0 turbo", fuel: "petrol", aspiration: "turbo", stock: [100, 160], stage1: [120, 195], stage2: [130, 205], stage3: [150, 220], ecus: [], keywords: "magnite" },
  { id: "renault_duster_13t", brand: "renault", model: "Duster Turbo", generation: "", years: [2020, 2022], engine: "1.3 TCe turbo", fuel: "petrol", aspiration: "turbo", stock: [156, 254], stage1: [185, 305], stage2: [200, 325], stage3: [230, 340], ecus: [], keywords: "duster tce" },
  { id: "renault_duster_15d", brand: "renault", model: "Duster Diesel", generation: "", years: [2012, 2020], engine: "1.5 dCi", fuel: "diesel", aspiration: "turbo", stock: [110, 245], stage1: [130, 295], stage2: [140, 315], stage3: [155, 330], ecus: [], keywords: "duster dci" },
  { id: "jeep_compass_20d", brand: "jeep", model: "Compass / Meridian Diesel", generation: "", years: [2017], engine: "2.0 Multijet II", fuel: "diesel", aspiration: "turbo", stock: [170, 350], stage1: [200, 420], stage2: [215, 445], stage3: [235, 470], ecus: ["bosch_edc17"], keywords: "compass meridian multijet" },
  { id: "jeep_compass_14t", brand: "jeep", model: "Compass Petrol", generation: "", years: [2017, 2022], engine: "1.4 MultiAir turbo", fuel: "petrol", aspiration: "turbo", stock: [163, 250], stage1: [190, 300], stage2: [205, 320], stage3: [240, 335], ecus: [], keywords: "compass multiair" },
  { id: "citroen_c3_12t", brand: "citroen", model: "C3 / Basalt Turbo", generation: "", years: [2022], engine: "1.2 PureTech turbo", fuel: "petrol", aspiration: "turbo", stock: [110, 190], stage1: [130, 230], stage2: [140, 245], stage3: [160, 260], ecus: [], keywords: "c3 basalt aircross puretech" },
  { id: "citroen_c5_20d", brand: "citroen", model: "C5 Aircross", generation: "", years: [2021], engine: "2.0 BlueHDi", fuel: "diesel", aspiration: "turbo", stock: [177, 400], stage1: [210, 480], stage2: [225, 510], stage3: [250, 540], ecus: [], keywords: "c5 aircross bluehdi" },
  { id: "fiat_abarth_punto", brand: "fiat", model: "Abarth Punto", generation: "", years: [2015, 2019], engine: "1.4 T-Jet", fuel: "petrol", aspiration: "turbo", stock: [145, 212], stage1: [170, 255], stage2: [185, 270], stage3: [210, 285], ecus: [], keywords: "abarth punto tjet" },
  { id: "fiat_linea_tjet", brand: "fiat", model: "Linea T-Jet", generation: "", years: [2010, 2019], engine: "1.4 T-Jet", fuel: "petrol", aspiration: "turbo", stock: [114, 207], stage1: [135, 250], stage2: [145, 265], stage3: [170, 280], ecus: [], keywords: "linea tjet" },
  { id: "fiat_13_mjd", brand: "fiat", model: "Punto / Linea Multijet", generation: "", years: [2009, 2019], engine: "1.3 Multijet", fuel: "diesel", aspiration: "turbo", stock: [90, 209], stage1: [105, 250], stage2: [110, 265], stage3: [125, 280], ecus: ["marelli"], keywords: "punto linea multijet mjd" },
  { id: "ford_ecosport_15d", brand: "ford", model: "EcoSport / Figo / Aspire Diesel", generation: "", years: [2013, 2021], engine: "1.5 TDCi", fuel: "diesel", aspiration: "turbo", stock: [100, 215], stage1: [120, 260], stage2: [130, 275], stage3: [140, 290], ecus: [], keywords: "ecosport figo aspire freestyle tdci" },
  { id: "ford_ecosport_10e", brand: "ford", model: "EcoSport EcoBoost", generation: "", years: [2013, 2021], engine: "1.0 EcoBoost", fuel: "petrol", aspiration: "turbo", stock: [125, 170], stage1: [150, 205], stage2: [160, 215], stage3: [190, 230], ecus: [], keywords: "ecosport ecoboost" },
  { id: "ford_endeavour_20", brand: "ford", model: "Endeavour 2.0", generation: "3rd gen", years: [2019, 2021], engine: "2.0 EcoBlue", fuel: "diesel", aspiration: "turbo", stock: [170, 420], stage1: [200, 505], stage2: [215, 535], stage3: [235, 565], ecus: [], keywords: "endeavour everest ecoblue" },
  { id: "ford_endeavour_32", brand: "ford", model: "Endeavour 3.2", generation: "3rd gen", years: [2016, 2019], engine: "3.2 TDCi 5-cyl", fuel: "diesel", aspiration: "turbo", stock: [200, 470], stage1: [235, 565], stage2: [250, 600], stage3: [275, 635], ecus: [], keywords: "endeavour everest tdci" }
];

// Volkswagen and Skoda TDI diesels sold in India (the market's diesels stopped in 2020 with BS6).
const VAG_DIESELS = [
  { id: "vw_polo_12tdi", brand: "volkswagen", model: "Polo 1.2 TDI", generation: "", years: [2010, 2014], engine: "1.2 TDI 3-cyl", fuel: "diesel", aspiration: "turbo", stock: [75, 180], stage1: [95, 225], stage2: [102, 240], stage3: [112, 255], ecus: [], keywords: "polo tdi cr" },
  { id: "vw_polo_15tdi", brand: "volkswagen", model: "Polo 1.5 TDI", generation: "", years: [2014, 2020], engine: "1.5 TDI", fuel: "diesel", aspiration: "turbo", stock: [90, 230], stage1: [115, 285], stage2: [122, 300], stage3: [135, 320], ecus: [], keywords: "polo tdi" },
  { id: "vw_vento_16tdi", brand: "volkswagen", model: "Vento / Polo GT 1.6 TDI", generation: "", years: [2010, 2015], engine: "1.6 TDI", fuel: "diesel", aspiration: "turbo", stock: [105, 250], stage1: [130, 305], stage2: [140, 325], stage3: [155, 345], ecus: [], keywords: "vento polo gt tdi" },
  { id: "vw_vento_15tdi", brand: "volkswagen", model: "Vento / Polo GT / Ameo 1.5 TDI", generation: "", years: [2015, 2020], engine: "1.5 TDI 110 PS", fuel: "diesel", aspiration: "turbo", stock: [110, 250], stage1: [135, 310], stage2: [145, 330], stage3: [160, 350], ecus: [], keywords: "vento polo gt ameo tdi" },
  { id: "vw_jetta_20tdi", brand: "volkswagen", model: "Jetta 2.0 TDI", generation: "Mk6", years: [2011, 2018], engine: "2.0 TDI", fuel: "diesel", aspiration: "turbo", stock: [140, 320], stage1: [175, 400], stage2: [190, 430], stage3: [210, 460], ecus: [], keywords: "jetta tdi" },
  { id: "vw_passat_20tdi", brand: "volkswagen", model: "Passat 2.0 TDI", generation: "B8", years: [2017, 2020], engine: "2.0 TDI (EA288)", fuel: "diesel", aspiration: "turbo", stock: [177, 350], stage1: [210, 430], stage2: [225, 460], stage3: [245, 490], ecus: ["bosch_edc17"], keywords: "passat tdi" },
  { id: "vw_tiguan_20tdi", brand: "volkswagen", model: "Tiguan 2.0 TDI", generation: "AD1", years: [2017, 2020], engine: "2.0 TDI (EA288)", fuel: "diesel", aspiration: "turbo", stock: [143, 340], stage1: [180, 410], stage2: [195, 440], stage3: [215, 470], ecus: ["bosch_edc17"], keywords: "tiguan tdi" },
  { id: "skoda_fabia_12tdi", brand: "skoda", model: "Fabia 1.2 TDI", generation: "", years: [2010, 2013], engine: "1.2 TDI 3-cyl", fuel: "diesel", aspiration: "turbo", stock: [75, 180], stage1: [95, 225], stage2: [102, 240], stage3: [112, 255], ecus: [], keywords: "fabia tdi cr" },
  { id: "skoda_rapid_16tdi", brand: "skoda", model: "Rapid 1.6 TDI", generation: "", years: [2011, 2016], engine: "1.6 TDI", fuel: "diesel", aspiration: "turbo", stock: [105, 250], stage1: [130, 305], stage2: [140, 325], stage3: [155, 345], ecus: [], keywords: "rapid tdi" },
  { id: "skoda_rapid_15tdi", brand: "skoda", model: "Rapid 1.5 TDI", generation: "", years: [2016, 2020], engine: "1.5 TDI", fuel: "diesel", aspiration: "turbo", stock: [110, 250], stage1: [135, 310], stage2: [145, 330], stage3: [160, 350], ecus: [], keywords: "rapid tdi" },
  { id: "skoda_octavia_20tdi", brand: "skoda", model: "Octavia 2.0 TDI", generation: "3rd gen", years: [2013, 2020], engine: "2.0 TDI (EA288)", fuel: "diesel", aspiration: "turbo", stock: [143, 320], stage1: [180, 400], stage2: [195, 430], stage3: [215, 460], ecus: ["bosch_edc17"], keywords: "octavia tdi" },
  { id: "skoda_superb_20tdi", brand: "skoda", model: "Superb 2.0 TDI", generation: "3rd gen", years: [2016, 2020], engine: "2.0 TDI (EA288)", fuel: "diesel", aspiration: "turbo", stock: [177, 350], stage1: [210, 430], stage2: [225, 460], stage3: [245, 490], ecus: ["bosch_edc17"], keywords: "superb tdi" },
  { id: "skoda_kodiaq_20tdi", brand: "skoda", model: "Kodiaq 2.0 TDI", generation: "", years: [2017, 2020], engine: "2.0 TDI (EA288)", fuel: "diesel", aspiration: "turbo", stock: [150, 340], stage1: [185, 410], stage2: [200, 440], stage3: [220, 470], ecus: ["bosch_edc17"], keywords: "kodiaq tdi" }
];

// More popular diesels and turbo petrols, older Indian favourites and premium models.
const MORE_VEHICLES = [
  { id: "hyundai_i20_15crdi", brand: "hyundai", model: "i20 1.5 CRDi", generation: "3rd gen", years: [2020, 2023], engine: "1.5 CRDi", fuel: "diesel", aspiration: "turbo", stock: [100, 240], stage1: [120, 295], stage2: [130, 315], stage3: [145, 340], ecus: ["bosch_edc17"], keywords: "i20 crdi" },
  { id: "hyundai_i20_14crdi", brand: "hyundai", model: "i20 1.4 CRDi", generation: "Elite", years: [2014, 2020], engine: "1.4 CRDi", fuel: "diesel", aspiration: "turbo", stock: [90, 220], stage1: [110, 270], stage2: [120, 290], stage3: [130, 315], ecus: ["bosch_edc17"], keywords: "elite i20 crdi" },
  { id: "hyundai_gi10_12crdi", brand: "hyundai", model: "Grand i10 / Xcent 1.2 CRDi", generation: "", years: [2017, 2019], engine: "1.2 CRDi 3-cyl", fuel: "diesel", aspiration: "turbo", stock: [75, 190], stage1: [90, 230], stage2: [95, 245], stage3: [105, 265], ecus: ["bosch_edc17"], keywords: "grand i10 xcent crdi" },
  { id: "hyundai_verna_16crdi", brand: "hyundai", model: "Verna / Elantra 1.6 CRDi", generation: "", years: [2011, 2019], engine: "1.6 CRDi", fuel: "diesel", aspiration: "turbo", stock: [128, 260], stage1: [155, 315], stage2: [165, 335], stage3: [180, 360], ecus: ["bosch_edc17"], keywords: "verna fluidic elantra crdi" },
  { id: "toyota_etios_14d", brand: "toyota", model: "Etios / Liva 1.4 D-4D", generation: "", years: [2011, 2020], engine: "1.4 D-4D", fuel: "diesel", aspiration: "turbo", stock: [68, 170], stage1: [85, 205], stage2: [90, 220], stage3: [100, 240], ecus: ["denso"], keywords: "etios liva cross d4d" },
  { id: "toyota_innova_25", brand: "toyota", model: "Innova 2.5 D-4D", generation: "1st gen", years: [2005, 2016], engine: "2.5 D-4D (2KD)", fuel: "diesel", aspiration: "turbo", stock: [102, 200], stage1: [125, 245], stage2: [135, 260], stage3: [150, 280], ecus: ["denso"], keywords: "innova d4d 2kd" },
  { id: "toyota_fortuner_30", brand: "toyota", model: "Fortuner 3.0 D-4D", generation: "1st gen", years: [2009, 2016], engine: "3.0 D-4D (1KD)", fuel: "diesel", aspiration: "turbo", stock: [171, 343], stage1: [210, 420], stage2: [225, 450], stage3: [250, 485], ecus: ["denso"], keywords: "fortuner d4d 1kd" },
  { id: "toyota_altis_14d", brand: "toyota", model: "Corolla Altis 1.4 D-4D", generation: "", years: [2010, 2019], engine: "1.4 D-4D", fuel: "diesel", aspiration: "turbo", stock: [88, 205], stage1: [105, 250], stage2: [110, 270], stage3: [120, 290], ecus: ["denso"], keywords: "corolla altis d4d" },
  { id: "honda_jazz_15d", brand: "honda", model: "Jazz / WR-V 1.5 i-DTEC", generation: "", years: [2015, 2020], engine: "1.5 i-DTEC", fuel: "diesel", aspiration: "turbo", stock: [100, 200], stage1: [120, 245], stage2: [130, 260], stage3: [145, 280], ecus: ["bosch_edc17"], keywords: "jazz wrv idtec" },
  { id: "honda_civic_16d", brand: "honda", model: "Civic / CR-V 1.6 i-DTEC", generation: "", years: [2018, 2020], engine: "1.6 i-DTEC", fuel: "diesel", aspiration: "turbo", stock: [120, 300], stage1: [145, 365], stage2: [155, 390], stage3: [170, 420], ecus: ["bosch_edc17"], keywords: "civic crv idtec" },
  { id: "mahindra_tuv300_15d", brand: "mahindra", model: "TUV300 / Bolero Neo 1.5", generation: "", years: [2016, 2024], engine: "1.5 mHawk100", fuel: "diesel", aspiration: "turbo", stock: [100, 240], stage1: [120, 295], stage2: [130, 315], stage3: [145, 340], ecus: ["bosch_edc17"], keywords: "tuv300 tuv bolero neo mhawk" },
  { id: "mahindra_marazzo_15d", brand: "mahindra", model: "Marazzo 1.5", generation: "", years: [2018, 2023], engine: "1.5 D15", fuel: "diesel", aspiration: "turbo", stock: [123, 300], stage1: [150, 365], stage2: [160, 390], stage3: [175, 420], ecus: [], keywords: "marazzo" },
  { id: "mahindra_kuv100_12d", brand: "mahindra", model: "KUV100 1.2 Diesel", generation: "", years: [2016, 2020], engine: "1.2 mFalcon D75", fuel: "diesel", aspiration: "turbo", stock: [78, 190], stage1: [95, 230], stage2: [100, 245], stage3: [110, 265], ecus: [], keywords: "kuv100 kuv mfalcon" },
  { id: "mahindra_alturas_22d", brand: "mahindra", model: "Alturas G4 2.2", generation: "", years: [2018, 2022], engine: "2.2 e-XDi", fuel: "diesel", aspiration: "turbo", stock: [181, 420], stage1: [220, 510], stage2: [235, 545], stage3: [260, 590], ecus: [], keywords: "alturas g4" },
  { id: "mahindra_thar_crde", brand: "mahindra", model: "Thar CRDe 2.5", generation: "1st gen", years: [2010, 2019], engine: "2.5 CRDe", fuel: "diesel", aspiration: "turbo", stock: [105, 247], stage1: [130, 300], stage2: [140, 320], stage3: [155, 345], ecus: [], keywords: "thar crde old" },
  { id: "tata_zest_13d", brand: "tata", model: "Zest / Bolt 1.3 Quadrajet", generation: "", years: [2014, 2019], engine: "1.3 Quadrajet", fuel: "diesel", aspiration: "turbo", stock: [90, 200], stage1: [110, 245], stage2: [120, 260], stage3: [130, 280], ecus: ["marelli"], keywords: "zest bolt quadrajet" },
  { id: "tata_storme_22d", brand: "tata", model: "Safari Storme 2.2", generation: "", years: [2015, 2019], engine: "2.2 VariCOR 400", fuel: "diesel", aspiration: "turbo", stock: [156, 400], stage1: [190, 490], stage2: [205, 525], stage3: [225, 565], ecus: [], keywords: "safari storme varicor" },
  { id: "nissan_terrano_15d", brand: "nissan", model: "Terrano / Kicks 1.5 dCi", generation: "", years: [2013, 2020], engine: "1.5 dCi (K9K)", fuel: "diesel", aspiration: "turbo", stock: [110, 245], stage1: [135, 300], stage2: [145, 320], stage3: [160, 345], ecus: ["continental_sid"], keywords: "terrano kicks dci k9k" },
  { id: "nissan_kicks_13t", brand: "nissan", model: "Kicks 1.3 Turbo", generation: "", years: [2020, 2022], engine: "1.3 turbo (HR13DDT)", fuel: "petrol", aspiration: "turbo", stock: [156, 254], stage1: [185, 310], stage2: [200, 330], stage3: [230, 365], ecus: [], keywords: "kicks turbo" },
  { id: "renault_captur_15d", brand: "renault", model: "Captur / Lodgy 1.5 dCi", generation: "", years: [2015, 2020], engine: "1.5 dCi (K9K)", fuel: "diesel", aspiration: "turbo", stock: [110, 245], stage1: [135, 300], stage2: [145, 320], stage3: [160, 345], ecus: ["continental_sid"], keywords: "captur lodgy dci k9k" },
  { id: "isuzu_vcross_19", brand: "isuzu", model: "D-Max V-Cross / MU-X 1.9", generation: "", years: [2020], engine: "1.9 (RZ4E)", fuel: "diesel", aspiration: "turbo", stock: [163, 360], stage1: [200, 440], stage2: [215, 470], stage3: [235, 510], ecus: ["transtron"], keywords: "vcross v cross mux rz4e" },
  { id: "isuzu_vcross_25", brand: "isuzu", model: "D-Max V-Cross 2.5", generation: "", years: [2016, 2020], engine: "2.5 (4JK1)", fuel: "diesel", aspiration: "turbo", stock: [136, 320], stage1: [165, 390], stage2: [175, 415], stage3: [195, 450], ecus: ["transtron"], keywords: "vcross v cross 4jk1" },
  { id: "force_gurkha_26", brand: "force", model: "Gurkha 2.6", generation: "", years: [2021, 2023], engine: "2.6 diesel", fuel: "diesel", aspiration: "turbo", stock: [91, 250], stage1: [110, 305], stage2: [120, 325], stage3: [130, 350], ecus: [], keywords: "gurkha" },
  { id: "jeep_meridian_20d", brand: "jeep", model: "Meridian 2.0", generation: "", years: [2022], engine: "2.0 Multijet II", fuel: "diesel", aspiration: "turbo", stock: [170, 350], stage1: [205, 425], stage2: [220, 455], stage3: [240, 490], ecus: [], keywords: "meridian multijet" },
  { id: "vw_polo_12tsi", brand: "volkswagen", model: "Polo GT / Vento 1.2 TSI", generation: "", years: [2013, 2020], engine: "1.2 TSI", fuel: "petrol", aspiration: "turbo", stock: [105, 175], stage1: [125, 215], stage2: [135, 230], stage3: [155, 255], ecus: ["bosch_med17"], keywords: "polo gt vento tsi" },
  { id: "skoda_rapid_10tsi", brand: "skoda", model: "Rapid 1.0 TSI", generation: "", years: [2020, 2021], engine: "1.0 TSI", fuel: "petrol", aspiration: "turbo", stock: [110, 175], stage1: [130, 215], stage2: [140, 230], stage3: [160, 255], ecus: [], keywords: "rapid tsi" },
  { id: "skoda_octavia_18tsi", brand: "skoda", model: "Octavia 1.8 TSI", generation: "3rd gen", years: [2013, 2020], engine: "1.8 TSI (EA888)", fuel: "petrol", aspiration: "turbo", stock: [180, 250], stage1: [215, 305], stage2: [230, 325], stage3: [265, 360], ecus: ["simos18"], keywords: "octavia tsi" },
  { id: "skoda_octavia_14tsi", brand: "skoda", model: "Octavia 1.4 TSI", generation: "3rd gen", years: [2017, 2020], engine: "1.4 TSI (EA211)", fuel: "petrol", aspiration: "turbo", stock: [150, 250], stage1: [180, 305], stage2: [195, 325], stage3: [225, 360], ecus: ["bosch_med17"], keywords: "octavia tsi" },
  { id: "bmw_520d_g30", brand: "bmw", model: "520d", generation: "G30", years: [2017, 2023], engine: "2.0d (B47)", fuel: "diesel", aspiration: "turbo", stock: [190, 400], stage1: [230, 490], stage2: [245, 525], stage3: [270, 565], ecus: ["bosch_edc17"], keywords: "5 series b47" },
  { id: "mb_c220d_w205", brand: "mercedes", model: "C220d", generation: "W205", years: [2018, 2021], engine: "2.0d (OM654)", fuel: "diesel", aspiration: "turbo", stock: [194, 400], stage1: [235, 490], stage2: [250, 525], stage3: [275, 565], ecus: ["bosch_md1"], keywords: "c class om654" },
  { id: "audi_q3_20tdi", brand: "audi", model: "Q3 2.0 TDI", generation: "8U", years: [2012, 2018], engine: "2.0 TDI", fuel: "diesel", aspiration: "turbo", stock: [177, 380], stage1: [215, 465], stage2: [230, 500], stage3: [255, 540], ecus: ["bosch_edc17"], keywords: "q3 tdi" },
  { id: "audi_q5_40tdi", brand: "audi", model: "Q5 40 TDI", generation: "FY", years: [2018, 2020], engine: "2.0 TDI (EA288)", fuel: "diesel", aspiration: "turbo", stock: [190, 400], stage1: [230, 490], stage2: [245, 525], stage3: [270, 565], ecus: ["bosch_edc17"], keywords: "q5 tdi" },
  { id: "audi_q7_45tdi", brand: "audi", model: "Q7 45 TDI", generation: "4M", years: [2015, 2019], engine: "3.0 V6 TDI", fuel: "diesel", aspiration: "turbo", stock: [249, 600], stage1: [305, 730], stage2: [325, 780], stage3: [360, 840], ecus: ["bosch_edc17"], keywords: "q7 tdi v6" }
];

// The ECU families commonly fitted to cars that were added without one, where the engine makes it
// clear (most share an engine with a car above). Listed cars get them in update 7 unless edited.
const VAG_TDI = ["bosch_edc17", "continental_sid"];
const HYUNDAI_TGDI = ["kefico", "bosch_med17"];
const ECU_ASSIGNMENTS = {
  vw_jetta_14: ["bosch_med17"],
  audi_a3_8v_14: ["bosch_med17"],
  audi_a4_b9_20t: ["simos18"],
  audi_q5_fy_20t: ["simos18"],
  skoda_octavia_rs: ["simos18"],
  skoda_octavia_20: ["simos18", "bosch_mg1"],
  mb_c300_w205: ["bosch_mg1"],
  mb_glc300_x253: ["bosch_mg1"],
  nissan_navara_d23: ["bosch_edc17"],
  mitsu_triton_24: ["denso"],
  honda_city_15: ["keihin"],
  honda_elevate_15: ["keihin"],
  honda_city_15d: ["bosch_edc17"],
  honda_amaze_15d: ["bosch_edc17"],
  hyundai_creta_crdi: ["bosch_edc17"],
  hyundai_verna_crdi: ["bosch_edc17"],
  hyundai_venue_crdi: ["bosch_edc17"],
  hyundai_alcazar_crdi: ["bosch_edc17"],
  hyundai_tucson_20d: ["bosch_edc17"],
  kia_seltos_crdi: ["bosch_edc17"],
  kia_sonet_crdi: ["bosch_edc17"],
  kia_carens_crdi: ["bosch_edc17"],
  kia_carnival_22: ["bosch_edc17"],
  hyundai_creta_14t: HYUNDAI_TGDI,
  hyundai_creta_15t: HYUNDAI_TGDI,
  hyundai_verna_15t: HYUNDAI_TGDI,
  hyundai_venue_10t: HYUNDAI_TGDI,
  hyundai_i20_10t: HYUNDAI_TGDI,
  hyundai_nios_10t: HYUNDAI_TGDI,
  kia_seltos_14t: HYUNDAI_TGDI,
  kia_seltos_15t: HYUNDAI_TGDI,
  kia_sonet_10t: HYUNDAI_TGDI,
  kia_carens_15t: HYUNDAI_TGDI,
  renault_duster_15d: ["continental_sid"],
  jeep_meridian_20d: ["bosch_edc17"],
  jeep_compass_14t: ["marelli"],
  fiat_abarth_punto: ["marelli", "bosch_me7"],
  fiat_linea_tjet: ["marelli", "bosch_me7"],
  mahindra_bolero_15d: ["bosch_edc17"],
  vw_jetta_20tdi: ["bosch_edc17"],
  vw_polo_12tdi: VAG_TDI,
  vw_polo_15tdi: VAG_TDI,
  vw_vento_16tdi: VAG_TDI,
  vw_vento_15tdi: VAG_TDI,
  skoda_fabia_12tdi: VAG_TDI,
  skoda_rapid_16tdi: VAG_TDI,
  skoda_rapid_15tdi: VAG_TDI
};
const withEcus = (vehicle) => (ECU_ASSIGNMENTS[vehicle.id] && !vehicle.ecus.length ? { ...vehicle, ecus: [...ECU_ASSIGNMENTS[vehicle.id]] } : vehicle);

export const SEED_VEHICLES = [...LAUNCH_VEHICLES, ...INDIA_VEHICLES, ...VAG_DIESELS, ...MORE_VEHICLES].map(withEcus);

// Services shown on the website. icon: bolt | gauge | wave | scan | chip | wrench | shield | sparkle
export const SEED_SERVICES = [
  { id: "remap", title: "ECU remapping", summary: "Unlock hidden potential. More power, better efficiency. Stage 1, 2 and 3, each with its own power graph.", priceLabel: "", icon: "chip", active: true },
  { id: "ceramic", title: "Ceramic coating", summary: "Long-lasting protection. Mirror finish. Easy maintenance.", priceLabel: "", icon: "shield", active: true },
  { id: "detailing", title: "Detailing", summary: "Deep clean. Showroom shine. Inside and out perfection.", priceLabel: "", icon: "sparkle", active: true },
  { id: "diagnostics", title: "Scanning & diagnostics", summary: "Advanced diagnostics with VCDS and factory tools. Accurate fault detection and fast solutions.", priceLabel: "", icon: "scan", active: true },
  { id: "servicing", title: "Servicing", summary: "Expert care. Genuine quality. Keep your vehicle running at its best.", priceLabel: "", icon: "wrench", active: true }
];

// The services after the Unity Motorsports artwork, before the tools were named.
const BRAND_SERVICES = [
  { id: "remap", title: "ECU remapping", summary: "Unlock hidden potential. More power, better efficiency. Stage 1, 2 and 3, each with its own power graph.", priceLabel: "", icon: "chip", active: true },
  { id: "ceramic", title: "Ceramic coating", summary: "Long-lasting protection. Mirror finish. Easy maintenance.", priceLabel: "", icon: "shield", active: true },
  { id: "detailing", title: "Detailing", summary: "Deep clean. Showroom shine. Inside and out perfection.", priceLabel: "", icon: "sparkle", active: true },
  { id: "diagnostics", title: "Scanning & diagnostics", summary: "Advanced diagnostics. Accurate fault detection and fast solutions.", priceLabel: "", icon: "scan", active: true },
  { id: "servicing", title: "Servicing", summary: "Expert care. Genuine quality. Keep your vehicle running at its best.", priceLabel: "", icon: "wrench", active: true }
];

// The services a database was first created with, before the Unity Motorsports artwork.
const LAUNCH_SERVICES = [
  { id: "stage1", title: "Stage 1 remap", summary: "Software-only calibration for standard hardware. More power and torque, sharper response, smoother delivery.", priceLabel: "", icon: "bolt", active: true },
  { id: "stage2", title: "Stage 2 tuning", summary: "Calibration matched to supporting hardware such as intake, intercooler and exhaust upgrades.", priceLabel: "", icon: "gauge", active: true },
  { id: "dyno", title: "Dyno runs", summary: "Before-and-after power runs with a printed graph of your car's power and torque.", priceLabel: "", icon: "wave", active: true },
  { id: "health", title: "Health check", summary: "Diagnostic scan, boost-leak test and data logging before any tune goes on.", priceLabel: "", icon: "scan", active: true },
  { id: "backup", title: "ECU backup & restore", summary: "Your original software is read and stored safely, and can be restored at any time.", priceLabel: "", icon: "chip", active: true },
  { id: "custom", title: "Custom calibration", summary: "Bespoke calibration for modified builds, verified with live data on our dyno.", priceLabel: "", icon: "wrench", active: true }
];

const VOUCHER = { id: "stage1-voucher", name: "Stage 1 Remap Voucher", category: "Tuning", price: 350, compareAtPrice: null, stock: null, featured: true, active: true, image: "", description: "A prepaid Stage 1 remap for one vehicle, including a full diagnostic scan and before-and-after data logs. Book your slot on WhatsApp once your order is confirmed.", features: ["Full diagnostic scan", "Before-and-after data logs", "Original software backed up"] };
const DIAGNOSTIC_SCAN = { id: "diagnostic-scan", name: "Full Diagnostic Scan", category: "Diagnostics", price: 40, compareAtPrice: null, stock: null, featured: false, active: true, image: "", description: "Every control module scanned for stored and pending fault codes, with live data checks and a written report. Ideal before a tune or before buying a used car.", features: ["All control modules scanned", "Live data checks and a written report", "VCDS and factory tools for VW group cars"] };
// The sample products a database was first created with, replaced while still unedited.
const LAUNCH_PRODUCTS = [
  { id: "stage1-voucher", name: "Stage 1 Remap Voucher", category: "Tuning", price: 350, compareAtPrice: null, stock: null, featured: true, active: true, image: "", description: "A prepaid Stage 1 remap for one vehicle, including a health check and before-and-after dyno runs. Book your slot on WhatsApp once your order is confirmed.", features: ["Health check and diagnostic scan", "Before-and-after dyno runs", "Original software backed up"] },
  { id: "dyno-run", name: "Dyno Power Run", category: "Tuning", price: 60, compareAtPrice: null, stock: null, featured: false, active: true, image: "", description: "Three back-to-back power runs on our dyno with a printed graph of your car's power and torque.", features: ["Three power runs", "Printed power and torque graph", "Ideal before any upgrade"] },
];

// Sample shop products. Prices are in the currency set under Settings; replace them with your own.
// stock: a number, or null for items that never run out (services, vouchers).
export const SEED_PRODUCTS = [
  VOUCHER,
  DIAGNOSTIC_SCAN,
  { id: "panel-air-filter", name: "High-Flow Panel Air Filter", category: "Performance parts", price: 65, compareAtPrice: 79, stock: 14, featured: true, active: true, image: "", description: "A washable, reusable cotton-gauze panel filter that drops straight into the factory airbox.", features: ["Washable and reusable", "Direct replacement for the factory filter", "Tell us your vehicle to confirm fitment"] },
  { id: "boost-hose-kit", name: "Silicone Boost Hose Kit", category: "Performance parts", price: 180, compareAtPrice: null, stock: 6, featured: true, active: true, image: "", description: "Reinforced silicone hoses that replace the factory rubber and plastic boost pipes.", features: ["Multi-ply reinforced silicone", "Stainless steel clamps included", "Vehicle-specific kits"] },
  { id: "uprated-intercooler", name: "Uprated Intercooler", category: "Performance parts", price: 890, compareAtPrice: null, stock: 2, featured: false, active: true, image: "", description: "A larger-core intercooler that keeps intake temperatures consistent on tuned cars.", features: ["Larger bar-and-plate core", "Bolt-on installation", "Recommended for Stage 2"] },
  { id: "spark-plugs", name: "Performance Spark Plugs (set of 4)", category: "Maintenance", price: 48, compareAtPrice: null, stock: 25, featured: false, active: true, image: "", description: "One-step-colder plugs, recommended for tuned turbo petrol engines.", features: ["One heat range colder", "Pre-gapped for tuned engines", "Set of four"] },
  { id: "synthetic-oil", name: "Fully Synthetic 5W-40 Oil (5 L)", category: "Maintenance", price: 62, compareAtPrice: null, stock: 18, featured: false, active: true, image: "", description: "Fully synthetic engine oil for high-performance petrol and diesel engines.", features: ["5 litres", "Check your handbook for the right specification"] },
  { id: "obd-logger", name: "Bluetooth OBD Data Logger", category: "Tools", price: 129, compareAtPrice: null, stock: 9, featured: true, active: true, image: "", description: "Plug-in data logger for live boost, temperatures and fault codes on your phone.", features: ["Live gauges on your phone", "Read and clear fault codes", "Log data for your tuner"] },
  { id: "hoodie", name: "Unity Performance Hoodie", category: "Merch", price: 55, compareAtPrice: null, stock: 30, featured: false, active: true, image: "", description: "Heavyweight cotton hoodie with the Unity Performance logo.", features: ["Heavyweight cotton blend", "Sizes S–XXL: add your size in the order note"] },
  { id: "cap", name: "Unity Performance Cap", category: "Merch", price: 25, compareAtPrice: null, stock: 40, featured: false, active: true, image: "", description: "Six-panel cap with an embroidered Unity Performance logo.", features: ["Adjustable strap", "Embroidered logo"] }
];

export const DEFAULT_SETTINGS = {
  businessName: "Unity Performance",
  tagline: "Performance · Protection · Perfection",
  heroTitle: "More power. More precision. More performance.",
  heroSubtitle: "ECU remapping, ceramic coating, detailing, diagnostics and servicing. All under one roof.",
  heroImage: "",
  announcement: "",
  currency: "USD",
  shopNote: "Pay on collection or delivery. We confirm every order with you on WhatsApp.",
  deliveryFee: 0,
  whatsappNumber: "918709647229",
  telegramBot: "",
  phone: "+91 87096 47229",
  email: "",
  address: "",
  latitude: null,
  longitude: null,
  hours: "Mon–Sat 9:00–18:00",
  instagram: "https://www.instagram.com/unitytuners/",
  facebook: "",
  tiktok: "",
  youtube: "",
  stage2Note: "Stage 2 adds supporting hardware to the software: a high-flow intake, an uprated intercooler and a freer-flowing exhaust, with the catalytic converter and all emissions equipment kept in place.",
  stage3Note: "Stage 3 is a bigger build: an upgraded turbocharger with matching fuelling and a clutch or gearbox rated for the extra torque, finished with a custom calibration checked by data-logged road tests.",
  alertOrders: true,
  alertEnquiries: true,
  siteUrl: ""
};

// The "Our work" gallery's first photos, from the workshop's Instagram (newest first). Each opens the
// Instagram page, since no post link is set.
export const SEED_PHOTOS = [
  { id: "polo-1-0-tsi-ethanol", image: "/gallery/polo-1-0-tsi-ethanol.webp", caption: "Polo 1.0 TSI · Stage 1+ ethanol tune · 140 hp", link: "", active: true },
  { id: "maruti-e30-tune", image: "/gallery/maruti-e30-tune.webp", caption: "Maruti Suzuki · Stage 1+ E30 ethanol tune", link: "", active: true },
  { id: "ciaz-e20-tune", image: "/gallery/ciaz-e20-tune.webp", caption: "Ciaz · Stage 1+ on E20 fuel", link: "", active: true },
  { id: "kodiaq-e27-stage1", image: "/gallery/kodiaq-e27-stage1.webp", caption: "Kodiaq · E27 ethanol tune and Stage 1", link: "", active: true }
];

// Changes made after launch. db.js applies each one once to an existing database, keeping the owner's
// own work: new cars are added (with any brand they need) unless already there, and settings or services
// are only replaced while they still match the old defaults. Add new changes here with the next version.
export const CATALOG_UPDATES = [
  { version: 2, vehicles: INDIA_VEHICLES },
  {
    version: 3,
    settings: {
      tagline: ["ECU tuning & performance", DEFAULT_SETTINGS.tagline],
      heroTitle: ["Stage 1. Unleashed.", DEFAULT_SETTINGS.heroTitle],
      heroSubtitle: ["Software-only performance for your car. More power, more torque, verified on our dyno.", DEFAULT_SETTINGS.heroSubtitle]
    },
    services: { from: LAUNCH_SERVICES, to: SEED_SERVICES }
  },
  { version: 4, vehicles: VAG_DIESELS },
  {
    version: 5,
    vehicles: MORE_VEHICLES,
    add: { ecus: NEW_ECUS },
    services: { from: BRAND_SERVICES, to: SEED_SERVICES },
    replace: {
      ecus: LAUNCH_ECUS.map((from) => ({ from, to: SEED_ECUS.find((ecu) => ecu.id === from.id) })),
      products: [
        { from: LAUNCH_PRODUCTS[0], to: VOUCHER },
        { from: LAUNCH_PRODUCTS[1], to: DIAGNOSTIC_SCAN }
      ]
    },
    settings: {
      instagram: ["", DEFAULT_SETTINGS.instagram],
      stage3Note: ["Stage 3 is a bigger build: an upgraded turbocharger with matching fuelling and a clutch or gearbox rated for the extra torque, finished with a custom calibration on our dyno.", DEFAULT_SETTINGS.stage3Note]
    }
  },
  { version: 6, add: { photos: SEED_PHOTOS } },
  {
    version: 7,
    // Autotuner and KESS3 support for ECUs that don't have it yet, and the usual ECU for cars added without one.
    fill: { ecus: SEED_ECUS.map(({ id, tools }) => ({ id, tools })) },
    replace: {
      vehicles: Object.keys(ECU_ASSIGNMENTS).map((id) => {
        const to = SEED_VEHICLES.find((vehicle) => vehicle.id === id);
        return { from: { ...to, ecus: [] }, to };
      })
    }
  }
];
export const CATALOG_VERSION = Math.max(1, ...CATALOG_UPDATES.map((update) => update.version));

const clone = (value) => structuredClone(value);

export function seedData(envSettings = {}) {
  return {
    version: 1,
    catalogVersion: CATALOG_VERSION,
    settings: { ...DEFAULT_SETTINGS, ...envSettings },
    brands: clone(SEED_BRANDS),
    ecus: clone(SEED_ECUS),
    vehicles: clone(SEED_VEHICLES),
    services: clone(SEED_SERVICES),
    products: clone(SEED_PRODUCTS).map((product) => ({ ...product, createdAt: "2026-01-01T00:00:00.000Z" })),
    // The home page's "Our work" gallery; the owner adds more photos in the admin panel.
    photos: clone(SEED_PHOTOS),
    orders: [],
    enquiries: [],
    alertChats: [],
    nextOrderNumber: 1001
  };
}
