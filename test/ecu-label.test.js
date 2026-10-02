import assert from "node:assert/strict";
import test from "node:test";
import { imageDataUrl, labelFromAi, labelLines } from "../src/ecu-label.js";

test("the AI's label reading is cleaned before it's shown", () => {
  const label = labelFromAi(
    { readable: true, ecu_maker: "Bosch", ecu_type: "MD1CS004", hardware_number: "0 281 034 123", software_number: "", oem_part_number: "", family: "made_up", vehicle_brand: "Audi", vehicle_model: "A4", engine: "2.0 TDI", years: "2018", fuel: "diesel", confidence: "low", question: "Which car?", notes: "x".repeat(500) },
    ["bosch_md1"]
  );
  assert.equal(label.family, "", "only the workshop's own ECU families are accepted");
  assert.equal(label.vehicle.brand, "", "a low-confidence car guess isn't shown as an answer");
  assert.equal(label.question, "Which car?");
  assert.ok(label.notes.length <= 200);
  assert.deepEqual(labelLines(label), ["ECU: Bosch MD1CS004", "Hardware no.: 0 281 034 123"]);
  assert.deepEqual(labelFromAi({ readable: false, question: "Closer, please." }, []), { readable: false, question: "Closer, please." });
});

test("photos are recognised by their bytes", () => {
  assert.match(imageDataUrl(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 1])), /^data:image\/jpeg;base64,/);
  assert.match(imageDataUrl(Buffer.from("89504e470d0a1a0a0000", "hex")), /^data:image\/png;base64,/);
  assert.equal(imageDataUrl(Buffer.from("<svg onload=alert(1)>")), null);
});
