import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { cmdColorSlots } from "../lib/sf6-shader-colors.js";
import { parseMdfMaterialNames } from "../lib/mdf-materials.js";
import { discoverMaterialDefaultTargets, writeMaterialDefaultColor } from "../lib/material-default-edits.js";
import { makeMdf } from "./fixtures/mdf.mjs";

// Exercise the app's actual routing and mutation functions without its DOM or
// private game assets. Top-level function closing braces start in column zero.
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const names = [
    "isSlotEditable", "enabledAtOffset", "attachMaterialDefaultEditMetadata",
    "originalMaterialDefaultColor", "materialDefaultEntries", "refreshMaterialDefaultTargets",
    "planColorSlotEdit", "applyColorSlotEdit", "writeRgbaAtOffset", "writeEnableAtOffset",
    "updateColorModelAtOffset", "forceEnableSlot", "rgbaToHexString", "clampByte", "rgbaEquals",
    "getMaterial", "getColorSlot", "setCmdColorSlot", "isStandardDefaultPalette",
    "preservesDefaultCmdStructure", "rawSlotEnabled", "buildPaletteDuplicatePlan", "rgbaAtOffset",
];
const functions = names.map(name => {
    const start = app.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Missing production function ${name}`);
    return app.slice(start, app.indexOf("\n}", start) + 2);
}).join("\n");
const mdfPath = "natives/STM/Product/Model/esf/esf900/001/esf900_001_00.mdf2.40";
const rgba = [22, 28, 50, 255];

function fixture({ entries = null, palette = 1, variant = "standard", duplicateBody = false } = {}) {
    const originalBuffer = new ArrayBuffer(48);
    new Uint8Array(originalBuffer).fill(0xAD);
    const clusters = [
        { instanceId: 1, name: "esf_Body", part: 1, offset: 0 },
        { instanceId: 2, name: "esf_Head", part: 0, offset: 16 },
    ];
    if (duplicateBody) clusters.push({ instanceId: 3, name: "esf_Body", part: 1, offset: 32 });
    const colorClusters = clusters.map(({ instanceId, name, offset }) => {
        new Uint8Array(originalBuffer)[offset] = 0;
        new Uint8Array(originalBuffer).set([188, 188, 188, 255], offset + 4);
        return { instanceId, name, colors: [{
            index: 0, runtimeName: "CustomizeColor_0", enabled: false,
            enable: { absoluteOffset: offset, byteLength: 1, value: false },
            color: { absoluteOffset: offset + 4, r: 188, g: 188, b: 188, a: 255 },
            mdfFallbackRgba: [188, 188, 188, 255],
        }] };
    });
    const cmd = {
        originalBuffer, workingBuffer: originalBuffer.slice(0), colorClusters,
        metadata: { esfId: "esf900", costumeFolder: "001", variant, paletteNumber: palette },
        instanceParse: { parsedInstances: clusters.map(cluster => ({
            typeName: "app.CostumeMaterialData.MaterialData",
            fields: { Type: { value: cluster.part }, Clusters: { values: [{ instanceId: cluster.instanceId }] } },
        })) },
    };
    const state = {
        cmdEntries: [cmd], materialDefaultTargets: [], materialDefaultBuffers: new Map(),
        importedMod: entries ? { entries, selectedRoot: "" } : null,
    };
    const api = runInNewContext(`${functions}\n({${names.join(",")}})`, {
        state, cmdColorSlots, parseMdfMaterialNames, discoverMaterialDefaultTargets, writeMaterialDefaultColor,
        zipEntryBaseName: path => path.split("/").at(-1),
    });
    api.refreshMaterialDefaultTargets();
    api.attachMaterialDefaultEditMetadata();
    return { api, state, cmd, body: colorClusters[0].colors[0], head: colorClusters[1].colors[0] };
}

const materialEntries = (materials = [{ name: "esf_Body", colors: [{ index: 0, values: [0.5, 0.5, 0.5, 1] }] }]) => ({
    [mdfPath]: new Uint8Array(makeMdf(materials)),
});

test("loose Color 1 edits activate existing CMD targets without an MDF", () => {
    const { api, cmd, body } = fixture();
    const baseline = cmd.originalBuffer.slice(0);
    assert.equal(api.isSlotEditable(body), true);
    assert.equal(api.planColorSlotEdit(cmd, body, rgba).kind, "cmd");
    assert.equal(api.setCmdColorSlot(cmd, "esf_Body", 0, rgba), true);
    assert.equal(body.enabled, true);
    assert.deepEqual(Array.from(new Uint8Array(cmd.workingBuffer, 4, 4)), rgba);
    assert.equal(new Uint8Array(cmd.workingBuffer)[0], 1);
    const expected = baseline.slice(0);
    new Uint8Array(expected)[0] = 1;
    new Uint8Array(expected).set(rgba, 4);
    assert.deepEqual(cmd.workingBuffer, expected);
    assert.deepEqual(cmd.originalBuffer, baseline);
});

test("colors-only ZIPs and same-name CMD clusters remain editable without actual MDFs", () => {
    const { api, cmd } = fixture({ entries: { "modinfo.ini": new TextEncoder().encode("name=Colors only\n") }, duplicateBody: true });
    for (const cluster of cmd.colorClusters) {
        const slot = cluster.colors[0];
        assert.equal(api.isSlotEditable(slot), true);
        api.applyColorSlotEdit(api.planColorSlotEdit(cmd, slot, rgba));
        assert.equal(slot.enabled, true);
        assert.deepEqual(Array.from(new Uint8Array(cmd.workingBuffer, slot.color.absoluteOffset, 4)), rgba);
    }
});

test("a supplied body MDF preserves inactive Color 1 CMD bytes and patches only its float vector", () => {
    const entries = materialEntries();
    const { api, state, cmd, body } = fixture({ entries });
    assert.equal(api.planColorSlotEdit(cmd, body, rgba).kind, "default");
    assert.equal(api.setCmdColorSlot(cmd, "esf_Body", 0, rgba), true);
    assert.deepEqual(cmd.workingBuffer, cmd.originalBuffer);
    assert.equal(body.enabled, false);
    const patched = state.materialDefaultBuffers.get(mdfPath).workingBuffer;
    const original = entries[mdfPath];
    const [material] = parseMdfMaterialNames(patched, mdfPath);
    assert.deepEqual(material.customizeColors[0].cmdRgba, rgba);
    const { dataOffset, componentCount } = material.customizeColors[0];
    for (let index = 0; index < original.length; index++) {
        if (index < dataOffset || index >= dataOffset + componentCount * 4) {
            assert.equal(new Uint8Array(patched)[index], original[index], `Unrelated MDF byte ${index}`);
        }
    }
    assert.deepEqual(state.materialDefaultBuffers.get(mdfPath).originalBuffer, original.buffer);
});

test("a mod body MDF does not restrict ordinary stock head edits", () => {
    const { api, cmd, head } = fixture({ entries: materialEntries() });
    assert.equal(api.isSlotEditable(head), true);
    assert.equal(api.planColorSlotEdit(cmd, head, rgba).kind, "cmd");
    api.setCmdColorSlot(cmd, "esf_Head", 0, rgba);
    assert.equal(head.enabled, true);
    assert.deepEqual(Array.from(new Uint8Array(cmd.workingBuffer, 20, 4)), rgba);
});

test("missing, ambiguous and unsupported actual mod targets remain read only", () => {
    for (const options of [
        { entries: materialEntries([{ name: "Custom_Body", colors: [{ index: 0, values: [1, 1, 1, 1] }] }]) },
        { entries: materialEntries([{ name: "esf_Body", colors: [{ index: 2, values: [1, 1, 1, 1] }] }]) },
        { entries: materialEntries([{ name: "esf_Body", colors: [{ index: 0, values: [0.5, 0.5] }] }]) },
        { entries: materialEntries([{ name: "esf_Body", colors: [] }]) },
        { entries: materialEntries([{ name: "esf_Body", colors: [{ index: 0, values: [0.5, 0.5, 0.5, 1, 1] }] }]) },
        { entries: materialEntries(), duplicateBody: true },
    ]) {
        const { api, cmd, body } = fixture(options);
        assert.equal(api.isSlotEditable(body), false);
        assert.throws(() => api.planColorSlotEdit(cmd, body, rgba), /absent|multiple|supported/);
        assert.equal(api.setCmdColorSlot(cmd, "esf_Body", 0, rgba), false);
        assert.deepEqual(cmd.workingBuffer, cmd.originalBuffer);
    }
});

test("ordinary palettes keep CMD routes even with supplied mod MDFs", () => {
    for (const metadata of [{ palette: 2 }, { variant: "ex" }, { variant: "dx" }]) {
        const { api, cmd, body } = fixture({ ...metadata, entries: materialEntries() });
        assert.equal(api.planColorSlotEdit(cmd, body, rgba).kind, "cmd");
        api.setCmdColorSlot(cmd, "esf_Body", 0, rgba);
        assert.equal(body.enabled, true);
    }
});

test("Color 1 graph preservation follows supplied mod MDFs, not the palette number alone", () => {
    for (const options of [{}, { entries: { "modinfo.ini": new Uint8Array() } }, { palette: 2, entries: materialEntries() }]) {
        const { api, cmd } = fixture(options);
        assert.equal(api.preservesDefaultCmdStructure(cmd), false);
    }
    const { api, cmd } = fixture({ entries: materialEntries() });
    assert.equal(api.preservesDefaultCmdStructure(cmd), true);
});

test("palette duplication can plan loose Color 1 targets and retains ordinary CMD preflight", () => {
    const source = fixture({ palette: 2 });
    source.api.setCmdColorSlot(source.cmd, "esf_Body", 0, rgba);
    const target = fixture();
    const plan = target.api.buildPaletteDuplicatePlan(source.cmd, target.cmd);
    assert.equal(plan.operations.length, 2);
    const body = plan.operations.find(operation => operation.materialName === "esf_Body");
    assert.equal(body.enabled, true);
    assert.deepEqual(Array.from(body.rgba), rgba);
    assert.equal(target.api.planColorSlotEdit(target.cmd, body.targetSlot, body.rgba).kind, "cmd");
});
