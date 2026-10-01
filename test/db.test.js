import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, db, replaceData, transact } from "../src/db.js";
import { CATALOG_UPDATES, CATALOG_VERSION, DEFAULT_SETTINGS, SEED_SERVICES, SEED_VEHICLES, seedData } from "../src/seed-data.js";

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
