export const BRANDS = {
  audi: { title: "Audi", models: ["A3", "A4", "A5", "S3", "S4", "Q5", "RS3", "Other Audi"] },
  bmw: { title: "BMW", models: ["1 Series", "3 Series", "5 Series", "M2", "M3/M4", "X3", "X5", "Other BMW"] },
  ford: { title: "Ford", models: ["Fiesta", "Focus", "Mustang", "Ranger", "Puma", "Kuga", "Other Ford"] },
  honda: { title: "Honda", models: ["Civic", "Accord", "CR-V", "City", "Jazz", "Other Honda"] },
  mercedes: { title: "Mercedes-Benz", models: ["A-Class", "C-Class", "E-Class", "GLC", "AMG A45", "AMG C63", "Other Mercedes"] },
  toyota: { title: "Toyota", models: ["Corolla", "Camry", "Fortuner", "Hilux", "GR Yaris", "Supra", "Other Toyota"] },
  volkswagen: { title: "Volkswagen", models: ["Golf", "Polo", "Jetta", "Passat", "Tiguan", "GTI/R", "Other Volkswagen"] },
  other: { title: "Other brand", models: ["Other / not listed"] }
};

export const FUELS = [
  ["petrol", "Petrol / gasoline", "Spark-ignition engine"],
  ["diesel", "Diesel", "Compression-ignition engine"],
  ["hybrid", "Hybrid", "Petrol + electric system"],
  ["electric", "Electric", "Battery-electric vehicle"]
];

export const ECU_OPTIONS = [
  ["bosch_med17", "Bosch MED17", "Common petrol ECU family"],
  ["bosch_edc17", "Bosch EDC17", "Common diesel ECU family"],
  ["bosch_mg1_md1", "Bosch MG1 / MD1", "Newer ECU family"],
  ["continental_sim2k", "Continental SIM2K", "Common petrol ECU family"],
  ["denso", "Denso", "Common Japanese OEM ECU"],
  ["delphi", "Delphi", "Common OEM ECU family"],
  ["other_ecu", "Other / not sure", "Check the ECU label first"]
];

export const STAGES = [
  ["stock", "Stock health check", "No performance calibration"],
  ["stage_1", "Stage 1", "Software only, healthy standard hardware"],
  ["stage_2", "Stage 2", "Software plus supporting hardware"],
  ["stage_3", "Stage 3", "Major hardware; specialist build"],
  ["custom", "Custom / unsure", "A tuner reviews your goal"]
];

export function titleFor(items, id) {
  const match = items.find(([value]) => value === id);
  return match?.[1] ?? id;
}

export function modelFor(brandId, modelId) {
  const models = BRANDS[brandId]?.models ?? [];
  return models.find((model) => slug(model) === modelId) ?? modelId;
}

export function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
