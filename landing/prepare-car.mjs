// Makes public/models/unity-car.glb from the Khronos "Car Concept" sample model
// (https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CarConcept, CC BY 4.0):
// removes the Khronos and 3D Commerce logos (the licence excludes them) and the wipers, keeps only
// the red paint, simplifies the meshes and compresses the textures. The site never runs this.
//
//   npm install --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer sharp
//   node landing/prepare-car.mjs CarConcept.glb public/models/unity-car.glb 0.25 0.004
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, prune, quantize, simplify, textureCompress, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";

// Arguments: input, output, the share of triangles to aim for, and how far (as a share of each
// part's size) simplifying may move the surface.
const [input, output, ratioArg, errorArg] = process.argv.slice(2);
const ratio = Number(ratioArg ?? 0.5);
const error = Number(errorArg ?? 0.0006);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

const triangles = () => root.listMeshes().reduce((sum, mesh) => sum + mesh.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
console.log("triangles before", triangles());

// Keep only the default paint (Carmine red).
for (const extension of root.listExtensionsUsed()) {
  if (extension.extensionName === "KHR_materials_variants") extension.dispose();
}

// Logos: the steering-wheel emblem, the Khronos logo texture (license plate, and as an emissive
// texture on several trim parts), and the tyre sidewall lettering.
// The wipers are a tenth of the model and barely visible at this size.
for (const node of root.listNodes()) {
  if (["InteriorSteeringEmblem", "BodyWindshieldWipers", "BodyWindshieldWipersBase"].includes(node.getName())) {
    node.getMesh()?.dispose();
    node.dispose();
  }
}
const plate = root.listMaterials().find((material) => material.getName() === "License");
const logo = plate.getBaseColorTexture();
plate.setBaseColorTexture(null).setBaseColorFactor([1, 1, 1, 1]);
for (const material of root.listMaterials()) {
  if (material.getEmissiveTexture() === logo) material.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
  if (material.getName() === "Tireside") material.setBaseColorTexture(null).setNormalTexture(null).setBaseColorFactor([0.012, 0.012, 0.012, 1]);
}
for (const material of root.listMaterials()) {
  for (const slot of ["getBaseColorTexture", "getEmissiveTexture", "getNormalTexture", "getOcclusionTexture", "getMetallicRoughnessTexture"]) {
    if (material[slot]() === logo) throw new Error(`Logo texture still used by ${material.getName()}`);
  }
}
logo.dispose();

await doc.transform(
  prune(),
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio, error }),
  // The baked shadow map that every part shares keeps more detail than the small tiling maps.
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: 82, resize: [1024, 1024], slots: /^occlusionTexture$/ }),
  textureCompress({ encoder: sharp, targetFormat: "webp", quality: 85, resize: [512, 512] }),
  quantize(),
  prune()
);
console.log("triangles after", triangles());
await io.write(output, doc);
