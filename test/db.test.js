import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, db, replaceData, transact } from "../src/db.js";
import { CATALOG_UPDATES, CATALOG_VERSION, DEFAULT_SETTINGS, SEED_ECUS, SEED_SERVICES, SEED_VEHICLES, WORKSHOP_ADDRESS, seedData } from "../src/seed-data.js";

const brandRefresh = CATALOG_UPDATES.find((update) => update.version === 3);

// A database saved at launch: launch cars, brands, services and wording, and no catalogVersion.
function launchDatabase() {
  const data = seedData();
  delete data.catalogVersion;
  data.services = structuredClone(brandRefresh.services.from);
  for (const [key, [previous]] of Object.entries(brandRefresh.settings)) data.settings[key] = previous;
  const indianBrands = new Set(["citroen", "fiat", "hyundai", "jeep", "kia", "mahindra", "maruti", "mg", "renault", "skoda", "tata"]);
  data.brands = data.brands.filter((brand) => !indianBrands.has(brand.id));
  data.vehicles = data.vehicles.slice(0, data.vehicles.findIndex((vehicle) => vehicle.id === "maruti_swift_k12"));
  return data;
}

test("an older database receives new catalogue cars once and keeps the owner's changes", () => {
  const old = launchDatabase();
  old.vehicles.find((vehicle) => vehicle.id === "vw_golf7_gti").stage1 = [300, 420];
  old.ecus = old.ecus.filter((ecu) => ecu.id !== "bosch_edc17");
  replaceData(old);

  assert.equal(db().catalogVersion, CATALOG_VERSION);
  assert.equal(db().vehicles.length, SEED_VEHICLES.length);
  assert.deepEqual(db().vehicles.find((vehicle) => vehicle.id === "vw_golf7_gti").stage1, [300, 420], "owner edits are kept");
  assert.ok(db().brands.some((brand) => brand.id === "maruti"), "brands the new cars need are added");
  assert.deepEqual(db().vehicles.find((vehicle) => vehicle.id === "tata_harrier_20").ecus, [], "ECUs the owner removed are not referenced");

  // Deleting a new car afterwards sticks: the update is not applied again.
  const current = structuredClone(db());
  current.vehicles = current.vehicles.filter((vehicle) => vehicle.id !== "hyundai_creta_crdi");
  replaceData(current);
  assert.ok(!db().vehicles.some((vehicle) => vehicle.id === "hyundai_creta_crdi"));
});

test("a fresh database already has every catalogue car", () => {
  const fresh = seedData();
  assert.equal(fresh.catalogVersion, CATALOG_VERSION);
  replaceData(fresh);
  assert.equal(db().vehicles.length, SEED_VEHICLES.length);
});

test("untouched launch wording and services move to the new branding; edited ones are kept", () => {
  replaceData(launchDatabase());
  assert.deepEqual(db().services, SEED_SERVICES);
  assert.equal(db().settings.heroTitle, DEFAULT_SETTINGS.heroTitle);
  assert.equal(db().settings.tagline, DEFAULT_SETTINGS.tagline);

  const edited = launchDatabase();
  edited.settings.heroTitle = "Our own headline";
  edited.services[0].summary = "Our own words.";
  replaceData(edited);
  assert.equal(db().settings.heroTitle, "Our own headline");
  assert.equal(db().settings.tagline, DEFAULT_SETTINGS.tagline, "other untouched settings still update");
  assert.equal(db().services[0].summary, "Our own words.");
  assert.equal(db().services.length, brandRefresh.services.from.length);
});

test("a change that can't be saved isn't applied", () => {
  const before = db().nextOrderNumber;
  // A folder where the temporary file should go makes the save fail, like a full disk would.
  const blocker = join(DATA_DIR, "db.json.tmp");
  mkdirSync(blocker, { recursive: true });
  try {
    assert.throws(() => transact((data) => {
      data.nextOrderNumber += 100;
    }));
  } finally {
    rmdirSync(blocker);
  }
  assert.equal(db().nextOrderNumber, before);
});

test("update 5 swaps unedited sample products and ECU notes, adds ECU families and Instagram, and keeps edits", () => {
  const update = CATALOG_UPDATES.find((entry) => entry.version === 5);
  const before = (edit = () => {}) => {
    const data = seedData();
    data.catalogVersion = 4;
    data.products = data.products.map((product) => {
      const old = update.replace.products.find(({ to }) => to.id === product.id)?.from;
      return old ? { ...structuredClone(old), createdAt: product.createdAt } : product;
    });
    data.ecus = update.replace.ecus.map(({ from }) => structuredClone(from));
    data.settings.instagram = "";
    data.settings.stage3Note = update.settings.stage3Note[0];
    edit(data);
    return data;
  };

  replaceData(before());
  assert.ok(db().products.some((product) => product.id === "diagnostic-scan"));
  assert.ok(!db().products.some((product) => product.id === "dyno-run"));
  assert.doesNotMatch(JSON.stringify(db().products), /dyno/i);
  assert.equal(db().ecus.length, SEED_ECUS.length);
  assert.match(db().ecus.find((ecu) => ecu.id === "bosch_edc17").method, /Autotuner or KESS3/);
  assert.equal(db().settings.instagram, "https://www.instagram.com/unitytuners/");
  assert.doesNotMatch(db().settings.stage3Note, /dyno/i);

  replaceData(before((data) => {
    data.products.find((product) => product.id === "dyno-run").price = 75;
    data.settings.instagram = "https://www.instagram.com/someone_else/";
  }));
  assert.equal(db().products.find((product) => product.id === "dyno-run").price, 75, "an edited product is the owner's to change");
  assert.equal(db().settings.instagram, "https://www.instagram.com/someone_else/");
});

test("update 6 adds the gallery's first photos once, after the owner's own, and deletions stick", () => {
  const SEED_PHOTOS = CATALOG_UPDATES.find((entry) => entry.version === 6).add.photos;
  const before = seedData();
  before.catalogVersion = 5;
  delete before.photos;
  replaceData(before);
  assert.deepEqual(db().photos.map((photo) => photo.id), SEED_PHOTOS.map((photo) => photo.id), "a database from before the gallery gets its photos");

  const withOwnPhoto = seedData();
  withOwnPhoto.catalogVersion = 5;
  withOwnPhoto.photos = [{ id: "my-build", image: "/uploads/0123456789abcdef0123456789abcdef.jpg", caption: "My build", link: "", active: true }];
  replaceData(withOwnPhoto);
  assert.deepEqual(db().photos.map((photo) => photo.id), ["my-build", ...SEED_PHOTOS.map((photo) => photo.id)], "the owner's newer photos stay first");

  const current = structuredClone(db());
  current.photos = current.photos.filter((photo) => photo.id !== SEED_PHOTOS[0].id);
  replaceData(current);
  assert.ok(!db().photos.some((photo) => photo.id === SEED_PHOTOS[0].id), "a deleted photo isn't added again");
});

test("update 7 adds Autotuner and KESS3 support and the usual ECUs, keeping the owner's edits", () => {
  const before = seedData();
  before.catalogVersion = 6;
  for (const ecu of before.ecus) delete ecu.tools;
  before.ecus = before.ecus.filter((ecu) => ecu.id !== "bosch_me7");
  for (const vehicle of before.vehicles) {
    if (["hyundai_creta_crdi", "fiat_linea_tjet", "kia_seltos_crdi", "vw_polo_15tdi"].includes(vehicle.id)) vehicle.ecus = [];
  }
  before.vehicles.find((vehicle) => vehicle.id === "kia_seltos_crdi").stage1 = [140, 300];
  before.ecus.find((ecu) => ecu.id === "denso").tools = { autotuner: ["bench"], kess3: [] };
  replaceData(before);

  const ecu = (id) => db().ecus.find((item) => item.id === id);
  const vehicle = (id) => db().vehicles.find((item) => item.id === id);
  assert.deepEqual(ecu("bosch_edc17").tools, { autotuner: ["obd", "bench", "boot"], kess3: ["obd", "bench", "boot"] });
  assert.deepEqual(ecu("denso").tools, { autotuner: ["bench"], kess3: [] }, "tool support the owner set is kept");
  assert.deepEqual(vehicle("hyundai_creta_crdi").ecus, ["bosch_edc17"]);
  assert.deepEqual(vehicle("vw_polo_15tdi").ecus, ["bosch_edc17", "continental_sid"]);
  assert.deepEqual(vehicle("fiat_linea_tjet").ecus, ["marelli"], "an ECU family the owner deleted isn't added back to a car");
  assert.deepEqual(vehicle("kia_seltos_crdi").ecus, [], "a car the owner edited is left alone");
});

test("update 8 fills in the workshop address, keeping one the owner set", () => {
  const before = seedData();
  before.catalogVersion = 7;
  before.settings.address = "";
  replaceData(before);
  assert.equal(db().settings.address, WORKSHOP_ADDRESS);

  const own = seedData();
  own.catalogVersion = 7;
  own.settings.address = "Shop 4, Main Road, Ranchi";
  replaceData(own);
  assert.equal(db().settings.address, "Shop 4, Main Road, Ranchi");
});
