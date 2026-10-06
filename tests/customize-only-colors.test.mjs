import assert from "node:assert/strict";
import test from "node:test";
import { cmdColorSlots, normalizeCmdColorParameter } from "../lib/sf6-shader-colors.js";
import { exportCmdColorTransfer, parseFreecamColorTransfer, planFreecamColorImport } from "../lib/freecam-colors.js";

const removedParameters = [
    "OcclusionColor", "OcclutionColor", "PrimalySpecularColor",
    "PrimarySpecularColor", "SecondarySpecularColor", "RimLight_Color", "Rimlight_Color",
];
const change = parameter => ({ material: "esf_Hair_Front", parameter, rgba: [0.25, 0.1, 0.05, 0.5] });
const transfer = changes => parseFreecamColorTransfer(JSON.stringify({
    format: "sf6-freecam-colors", version: 1, colorSpace: "linear", changes,
}));

function fixture() {
    const workingBuffer = new ArrayBuffer(80);
    const view = new Uint8Array(workingBuffer);
    view[0] = 1;
    view.set([32, 64, 96, 128], 4);
    const customize = { index: 0, enabled: true, color: { absoluteOffset: 4 }, enable: { absoluteOffset: 0, byteLength: 1 } };
    const shaderColors = removedParameters.map((runtimeName, index) => {
        const enableOffset = 8 + index * 8;
        view[enableOffset] = 1;
        view.set([255, 0, 0, 255], enableOffset + 4);
        return { runtimeName, kind: "hair", index: null, enabled: true,
            color: { absoluteOffset: enableOffset + 4 }, enable: { absoluteOffset: enableOffset, byteLength: 1 } };
    });
    return { workingBuffer, colorClusters: [{ name: "esf_Hair_Front", colors: [customize], shaderColors }] };
}

test("color addressing and string export omit former hair fields", () => {
    assert.deepEqual(normalizeCmdColorParameter("CustomizeColor_12"), { parameter: "CustomizeColor_12", index: 12, kind: "customize" });
    for (const parameter of removedParameters) assert.equal(normalizeCmdColorParameter(parameter), null);
    const cmd = fixture();
    const before = cmd.workingBuffer.slice(0);
    assert.deepEqual(cmdColorSlots(cmd.colorClusters[0]), cmd.colorClusters[0].colors);
    const exported = exportCmdColorTransfer(cmd);
    assert.equal(exported.slotCount, 1);
    assert.deepEqual(exported.document.changes.map(entry => entry.parameter), ["CustomizeColor_0"]);
    assert.deepEqual(cmd.workingBuffer, before);
});

test("legacy hair transfers are clearly skipped while CustomizeColor imports still work", () => {
    const cmd = fixture();
    const before = cmd.workingBuffer.slice(0);
    const plan = planFreecamColorImport(transfer([
        change("CustomizeColor_0"), ...removedParameters.map(change), change("BaseColor"),
    ]), cmd);
    assert.equal(plan.operations.length, 1);
    assert.equal(plan.operations[0].parameter, "CustomizeColor_0");
    assert.deepEqual(plan.operations[0].rgba, [137, 89, 63, 128]);
    assert.equal(plan.issues.length, removedParameters.length + 1);
    for (const issue of plan.issues.filter(issue => issue.parameter !== "BaseColor")) {
        assert.match(issue.reason, /only CustomizeColor_N slots are supported/);
    }
    assert.match(plan.issues.find(issue => issue.parameter === "BaseColor").reason, /MDF/);
    assert.deepEqual(cmd.workingBuffer, before);
});
