import assert from "node:assert/strict";
import test from "node:test";
import { db, replaceData } from "../src/db.js";
import { CATALOG_VERSION, SEED_VEHICLES, seedData } from "../src/seed-data.js";

// A database saved before the Indian cars were added: launch cars and brands only, no catalogVersion.
function launchDatabase() {
  const data = seedData();
  delete data.catalogVersion;
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
