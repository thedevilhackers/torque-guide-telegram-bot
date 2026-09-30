// Default data used the first time the database is created (see db.js).
// After that, everything here is managed from the admin panel.

// Brands shown in "Browse by brand". aliases help the vehicle search match what customers type.
export const SEED_BRANDS = [
  { id: "audi", title: "Audi", aliases: [] },
  { id: "bmw", title: "BMW", aliases: [] },
  { id: "ford", title: "Ford", aliases: [] },
  { id: "honda", title: "Honda", aliases: [] },
  { id: "isuzu", title: "Isuzu", aliases: [] },
  { id: "mercedes", title: "Mercedes-Benz", aliases: ["mercedes", "merc", "benz", "mb", "amg"] },
  { id: "mitsubishi", title: "Mitsubishi", aliases: [] },
  { id: "nissan", title: "Nissan", aliases: [] },
  { id: "toyota", title: "Toyota", aliases: [] },
  { id: "volkswagen", title: "Volkswagen", aliases: ["vw"] }
];

// ECU support list, used by the "ECU check" step.
// status: "supported" | "on_request" | "not_supported". Edit this to match your tools and licences.
export const SEED_ECUS = [
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
// figures are typical starting values. Replace them with your own dyno-verified results.
// ecus lists ECU ids commonly fitted; the customer still confirms theirs.
// stage2 / stage3 are optional sample figures for builds with supporting hardware (Stage 2) and an
// upgraded turbo (Stage 3); naturally aspirated engines are Stage 1 only.
// Optional: redline and torqueFrom (rpm) shape the graph for engines that differ from the defaults.
export const SEED_VEHICLES = [
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
  { id: "isuzu_dmax_30", brand: "isuzu", model: "D-Max 3.0", generation: "RG", years: [2020], engine: "3.0 (4JJ3-TCX)", fuel: "diesel", aspiration: "turbo", stock: [190, 450], stage1: [215, 510], stage2: [230, 545], stage3: [260, 595], ecus: ["transtron"], keywords: "dmax d max 4jj3" }
];

// Services shown on the website. icon: bolt | gauge | wave | scan | chip | wrench
export const SEED_SERVICES = [
  { id: "stage1", title: "Stage 1 remap", summary: "Software-only calibration for standard hardware. More power and torque, sharper response, smoother delivery.", priceLabel: "", icon: "bolt", active: true },
  { id: "stage2", title: "Stage 2 tuning", summary: "Calibration matched to supporting hardware such as intake, intercooler and exhaust upgrades.", priceLabel: "", icon: "gauge", active: true },
  { id: "dyno", title: "Dyno runs", summary: "Before-and-after power runs with a printed graph of your car's power and torque.", priceLabel: "", icon: "wave", active: true },
  { id: "health", title: "Health check", summary: "Diagnostic scan, boost-leak test and data logging before any tune goes on.", priceLabel: "", icon: "scan", active: true },
  { id: "backup", title: "ECU backup & restore", summary: "Your original software is read and stored safely, and can be restored at any time.", priceLabel: "", icon: "chip", active: true },
  { id: "custom", title: "Custom calibration", summary: "Bespoke calibration for modified builds, verified with live data on our dyno.", priceLabel: "", icon: "wrench", active: true }
];

// Sample shop products. Prices are in the currency set under Settings; replace them with your own.
// stock: a number, or null for items that never run out (services, vouchers).
export const SEED_PRODUCTS = [
  { id: "stage1-voucher", name: "Stage 1 Remap Voucher", category: "Tuning", price: 350, compareAtPrice: null, stock: null, featured: true, active: true, image: "", description: "A prepaid Stage 1 remap for one vehicle, including a health check and before-and-after dyno runs. Book your slot on WhatsApp once your order is confirmed.", features: ["Health check and diagnostic scan", "Before-and-after dyno runs", "Original software backed up"] },
  { id: "dyno-run", name: "Dyno Power Run", category: "Tuning", price: 60, compareAtPrice: null, stock: null, featured: false, active: true, image: "", description: "Three back-to-back power runs on our dyno with a printed graph of your car's power and torque.", features: ["Three power runs", "Printed power and torque graph", "Ideal before any upgrade"] },
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
  tagline: "ECU tuning & performance",
  heroTitle: "Stage 1. Unleashed.",
  heroSubtitle: "Software-only performance for your car. More power, more torque, verified on our dyno.",
  heroImage: "",
  announcement: "",
  currency: "USD",
  shopNote: "Pay on collection or delivery. We confirm every order with you on WhatsApp.",
  deliveryFee: 0,
  whatsappNumber: "",
  telegramBot: "",
  phone: "",
  email: "",
  address: "",
  latitude: null,
  longitude: null,
  hours: "Mon–Sat 9:00–18:00",
  instagram: "",
  facebook: "",
  tiktok: "",
  youtube: "",
  stage2Note: "Stage 2 adds supporting hardware to the software: a high-flow intake, an uprated intercooler and a freer-flowing exhaust, with the catalytic converter and all emissions equipment kept in place.",
  stage3Note: "Stage 3 is a bigger build: an upgraded turbocharger with matching fuelling and a clutch or gearbox rated for the extra torque, finished with a custom calibration on our dyno.",
  alertOrders: true,
  alertEnquiries: true,
  siteUrl: ""
};

const clone = (value) => structuredClone(value);

export function seedData(envSettings = {}) {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, ...envSettings },
    brands: clone(SEED_BRANDS),
    ecus: clone(SEED_ECUS),
    vehicles: clone(SEED_VEHICLES),
    services: clone(SEED_SERVICES),
    products: clone(SEED_PRODUCTS).map((product) => ({ ...product, createdAt: "2026-01-01T00:00:00.000Z" })),
    orders: [],
    enquiries: [],
    alertChats: [],
    nextOrderNumber: 1001
  };
}
