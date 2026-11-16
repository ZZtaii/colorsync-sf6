import test from "node:test";
import assert from "node:assert/strict";
import { parseMdfMaterialNames } from "../lib/mdf-materials.js";
import { writeMaterialDefaultScalar } from "../lib/material-default-edits.js";
import { makeMdf } from "./fixtures/mdf.mjs";

const filename = "synthetic.mdf2.40";
const mdf = scalars => makeMdf([{ name: "esf_Body", colors: [{ index: 0, values: [0.5, 0.5, 0.5, 1] }], scalars }]);

test("MDF parsing lists Blend Rate, Roughness and Metalness floats per slot", () => {
    const [material] = parseMdfMaterialNames(mdf([
        { name: "CustomizeColor_0_BlendRate", value: 1 },
        { name: "CustomizeRoughness_0", value: -0.25 },
        { name: "CustomizeMetal_0", value: 0 },
        { name: "DamageRoughness_0", value: 0.5 },
    ]), filename);
    assert.deepEqual(material.customizeScalars.map(scalar => [scalar.key, scalar.index, scalar.parameter, scalar.value]), [
        ["blendRate", 0, "CustomizeColor_0_BlendRate", 1],
        ["metalness", 0, "CustomizeMetal_0", 0],
        ["roughness", 0, "CustomizeRoughness_0", -0.25],
    ]);
    assert.deepEqual(material.customizeColorIndexes, [0], "Blend Rate is not mistaken for a color");
});

test("writing an MDF scalar patches only its four bytes", () => {
    const buffer = mdf([{ name: "CustomizeRoughness_0", value: 0 }, { name: "CustomizeMetal_0", value: 0 }]);
    const patch = writeMaterialDefaultScalar(buffer, filename, "esf_Body", "roughness", 0, 0.3);
    assert.equal(patch.changed, true);
    assert.equal(patch.value, Math.fround(0.3));
    const before = new Uint8Array(buffer);
    const after = new Uint8Array(patch.buffer);
    const changed = [...after].flatMap((byte, index) => byte === before[index] ? [] : [index]);
    assert.ok(changed.length > 0 && changed.every(index => index >= patch.dataOffset && index < patch.dataOffset + 4));
    const [material] = parseMdfMaterialNames(patch.buffer, filename);
    assert.equal(material.customizeScalars.find(scalar => scalar.key === "roughness").value, Math.fround(0.3));
    assert.equal(writeMaterialDefaultScalar(patch.buffer, filename, "esf_Body", "roughness", 0, 0.3).changed, false);
});

test("MDF scalar writes reject missing, duplicate and invalid targets", () => {
    const buffer = mdf([{ name: "CustomizeRoughness_0", value: 0 }, { name: "CustomizeRoughness_0", value: 0 }]);
    assert.throws(() => writeMaterialDefaultScalar(buffer, filename, "esf_Body", "roughness", 0, 0.1), /duplicate CustomizeRoughness_0/);
    assert.throws(() => writeMaterialDefaultScalar(buffer, filename, "esf_Body", "metalness", 0, 0.1), /does not declare/);
    assert.throws(() => writeMaterialDefaultScalar(buffer, filename, "esf_Missing", "roughness", 0, 0.1), /was not found/);
    assert.throws(() => writeMaterialDefaultScalar(buffer, filename, "esf_Body", "roughness", 0, Number.NaN), /finite/);
});
