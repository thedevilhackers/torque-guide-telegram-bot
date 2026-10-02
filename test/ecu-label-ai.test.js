import assert from "node:assert/strict";
import test from "node:test";

// A stand-in for the OpenAI API that records the request and answers like the model would.
process.env.OPENAI_API_KEY = "test-key";
let request;
globalThis.fetch = async (url, options) => {
  request = JSON.parse(options.body);
  const text = JSON.stringify({
    readable: true, ecu_maker: "Bosch", ecu_type: "EDC17C57", hardware_number: "0 281 031 234", software_number: "1037541234", oem_part_number: "39101-2A930",
    family: "bosch_edc17", vehicle_brand: "Hyundai", vehicle_model: "Creta", engine: "1.5 CRDi", years: "2021", fuel: "diesel", confidence: "high", question: "", notes: "Common rail diesel."
  });
  return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text }] }] }), { headers: { "content-type": "application/json" } });
};

const { readEcuLabel } = await import("../src/tuning-service.js");

test("the label photo is sent to the AI with the customer's note, and the answer comes back cleaned", async () => {
  const photo = "data:image/jpeg;base64,/9j/4AAQ";
  const label = await readEcuLabel("chat-photo", photo, "It's my Creta");
  const content = request.input.find((item) => item.role === "user").content;
  assert.deepEqual(content.find((part) => part.type === "input_image"), { type: "input_image", image_url: photo, detail: "high" });
  assert.match(content.find((part) => part.type === "input_text").text, /It's my Creta/);
  assert.equal(request.text.format.name, "ecu_label");
  assert.ok(request.text.format.schema.properties.family.enum.includes("bosch_edc17"), "the AI chooses from the workshop's ECU families");
  assert.match(request.input[0].content[0].text, /never invent or complete a number/);
  assert.equal(label.type, "EDC17C57");
  assert.equal(label.family, "bosch_edc17");
  assert.equal(label.vehicle.model, "Creta");
});
