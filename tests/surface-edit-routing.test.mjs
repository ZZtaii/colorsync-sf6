import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { cmdColorSlots } from "../lib/sf6-shader-colors.js";
import { parseMdfMaterialNames } from "../lib/mdf-materials.js";
import { discoverMaterialDefaultTargets, writeMaterialDefaultScalar } from "../lib/material-default-edits.js";
import * as surfaceLib from "../lib/sf6-surface.js";
import { makeMdf } from "./fixtures/mdf.mjs";

// Run the app's real Roughness/Metalness routing without its DOM. Top-level
// function closing braces start in column zero.
const app = await readFile(new URL("../app.js", import.meta.url), "utf8");
const names = [
    "enabledAtOffset", "isStandardDefaultPalette", "attachMaterialDefaultEditMetadata",
    "originalMaterialDefaultColor", "materialDefaultEntries", "refreshMaterialDefaultTargets",
    "cmdSemanticBaseline", "surfaceEditBlockedReason", "canEditSlotSurface", "setSlotSurface",
    "slotSurfaceChanges", "revertSlotSurface", "readSlotSurfaceStates", "copySlotSurface",
    "validateSavedSlotSurface", "snapshotSurfaceBytes", "restoreSurfaceBytes",
    "surfaceEditRoute", "materialDefaultScalar", "originalMaterialDefaultScalar", "writeSurfaceDefault", "revertSurfaceDefault",
];
const functions = names.map(name => {
    const start = app.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Missing production function ${name}`);
    return app.slice(start, app.indexOf("\n}", start) + 2);
}).join("\n");
// Message constants the functions read.
const constants = [...app.matchAll(/^const SURFACE_\w+_REASON = [^\n]*;/gm)].map(match => match[0]).join("\n");
const mdfPath = "natives/STM/Product/Model/esf/esf900/001/esf900_001_00.mdf2.40";

// Per cluster (24 bytes): color Enable, RGBA at +4, Roughness Enable/+value at
// +8/+12, Metalness Enable/+value at +16/+20. Body is part 1 (MDF _00), Head part 0.
function fixture({ entries = null, palette = 1, roughness = [false, 0], shared = false } = {}) {
    const originalBuffer = new ArrayBuffer(48);
    const view = new DataView(originalBuffer);
    const clusters = [
        { instanceId: 1, name: "esf_Body", part: 1, offset: 0 },
        { instanceId: 2, name: "esf_Head", part: 0, offset: 24 },
    ];
    const colorClusters = clusters.map(({ instanceId, name, offset }) => {
        new Uint8Array(originalBuffer).set([188, 188, 188, 255], offset + 4);
        view.setUint8(offset + 8, roughness[0] ? 1 : 0);
        view.setFloat32(offset + 12, roughness[1], true);
        const field = (key, start) => ({ key, enabled: false, value: 0, enable: { absoluteOffset: start, byteLength: 1 }, valueField: { absoluteOffset: start + 4, byteLength: 4 } });
        return { instanceId, name, colors: [{
            index: 0, runtimeName: "CustomizeColor_0", enabled: false,
            enable: { absoluteOffset: offset, byteLength: 1, value: false },
            color: { absoluteOffset: offset + 4, r: 188, g: 188, b: 188, a: 255 },
            surface: { shared, roughness: field("roughness", offset + 8), metalness: field("metalness", offset + 16) },
        }] };
    });
    const cmd = {
        originalBuffer, workingBuffer: originalBuffer.slice(0), colorClusters,
        metadata: { esfId: "esf900", costumeFolder: "001", variant: "standard", paletteNumber: palette },
        instanceParse: { parsedInstances: clusters.map(cluster => ({
            typeName: "app.CostumeMaterialData.MaterialData",
            fields: { Type: { value: cluster.part }, Clusters: { values: [{ instanceId: cluster.instanceId }] } },
        })) },
    };
    surfaceLib.syncSurfaceModels(cmd.workingBuffer, colorClusters);
    const state = {
        cmdEntries: [cmd], materialDefaultTargets: [], materialDefaultBuffers: new Map(),
        importedMod: entries ? { entries, selectedRoot: "" } : null,
    };
    const api = runInNewContext(`${constants}\n${functions}\n({${names.join(",")}})`, {
        ...surfaceLib, state, cmdColorSlots, parseMdfMaterialNames, discoverMaterialDefaultTargets, writeMaterialDefaultScalar,
        zipEntryBaseName: path => path.split("/").at(-1),
    });
    api.refreshMaterialDefaultTargets();
    api.attachMaterialDefaultEditMetadata();
    return { api, state, cmd, body: colorClusters[0].colors[0], head: colorClusters[1].colors[0] };
}
const bodyMdf = (scalars = []) => ({ [mdfPath]: new Uint8Array(makeMdf([{ name: "esf_Body", colors: [{ index: 0, values: [0.5, 0.5, 0.5, 1] }], scalars }])) });
const SCALARS = [{ name: "CustomizeColor_0_BlendRate", value: 1 }, { name: "CustomizeRoughness_0", value: 0 }, { name: "CustomizeMetal_0", value: 0 }];

test("loose CMDs turn a surface override on with an in-place patch of its own bytes", () => {
    const { api, cmd, body } = fixture();
    assert.equal(api.canEditSlotSurface(cmd, body, "roughness"), true);
    assert.equal(api.setSlotSurface(cmd, body, "roughness", { enabled: true, value: 0.25 }), true);
    assert.equal(api.setSlotSurface(cmd, body, "roughness", { enabled: true, value: 0.25 }), false, "a repeated write is a no-op");
    const changed = [...new Uint8Array(cmd.workingBuffer)].flatMap((byte, index) => byte === new Uint8Array(cmd.originalBuffer)[index] ? [] : [index]);
    assert.deepEqual(changed, [8, 12, 13, 14, 15].filter(index => new Uint8Array(cmd.workingBuffer)[index] !== new Uint8Array(cmd.originalBuffer)[index]));
    assert.ok(changed.every(index => index >= 8 && index < 16), "only the Roughness Enable and float change");
    assert.equal(body.enabled, false, "the color slot itself stays inactive");
    const [change] = api.slotSurfaceChanges(cmd.originalBuffer, cmd.workingBuffer, body);
    assert.deepEqual([change.key, change.before.enabled, change.after.enabled, change.after.value], ["roughness", false, true, 0.25]);
    api.revertSlotSurface(cmd, body);
    assert.deepEqual(cmd.workingBuffer, cmd.originalBuffer);
    assert.equal(body.surface.roughness.enabled, false);
});

test("Color 1 with the mod's body MDF keeps inactive surface overrides inactive", () => {
    const { api, cmd, body, head } = fixture({ entries: bodyMdf() });
    assert.equal(body.surfaceDefaultLocked, true);
    assert.match(api.surfaceEditBlockedReason(cmd, body, "roughness", { activate: true }), /Color 1 of this mod keeps this setting/);
    // This body MDF declares no CustomizeRoughness_0, so there is nowhere to write it.
    assert.equal(api.surfaceEditRoute(cmd, body, "roughness").kind, "blocked");
    assert.throws(() => api.setSlotSurface(cmd, body, "roughness", { enabled: true, value: 0.5 }), /doesn't include this setting/);
    assert.deepEqual(cmd.workingBuffer, cmd.originalBuffer);
    // The stock head is not covered by the body MDF and stays an ordinary edit.
    assert.equal(head.surfaceDefaultLocked, undefined);
    assert.equal(api.setSlotSurface(cmd, head, "metalness", { enabled: true, value: 1 }), true);
});

test("an override Color 1 already has stays editable and can be turned off", () => {
    const { api, cmd, body } = fixture({ entries: bodyMdf(), roughness: [true, 0.13] });
    assert.equal(api.canEditSlotSurface(cmd, body, "roughness"), true);
    assert.equal(api.setSlotSurface(cmd, body, "roughness", { value: -0.4 }), true);
    assert.equal(api.setSlotSurface(cmd, body, "roughness", { enabled: false }), true);
    // The accepted CMD already had this override, so turning it back on is safe.
    assert.equal(api.setSlotSurface(cmd, body, "roughness", { enabled: true }), true);
    assert.equal(api.canEditSlotSurface(cmd, body, "metalness"), false, "an inactive setting the MDF lacks stays read only");
    assert.throws(() => api.setSlotSurface(cmd, body, "metalness", { enabled: true }), /doesn't include this setting/);
});

test("other palettes are not locked by the mod's MDF", () => {
    const { api, cmd, body } = fixture({ entries: bodyMdf(), palette: 2 });
    assert.equal(body.surfaceDefaultLocked, undefined);
    assert.equal(api.setSlotSurface(cmd, body, "metalness", { enabled: true, value: -1 }), true);
});

test("shared surfaces from custom-material clones cannot be edited on their own", () => {
    const { api, cmd, body } = fixture({ shared: true });
    assert.match(api.surfaceEditBlockedReason(cmd, body, "roughness", { activate: true }), /shares its Blend Rate, Roughness and Metalness/);
    assert.equal(api.canEditSlotSurface(cmd, body, "metalness"), false);
});

test("copies carry exact source states and count fields a locked target cannot take", () => {
    const source = fixture({ palette: 2 });
    source.api.setSlotSurface(source.cmd, source.body, "roughness", { enabled: true, value: 0.3 });
    source.api.setSlotSurface(source.cmd, source.body, "metalness", { enabled: true, value: 1 });
    const states = source.api.readSlotSurfaceStates(source.cmd, source.body);

    const locked = fixture({ entries: bodyMdf() });
    assert.deepEqual({ ...locked.api.copySlotSurface(locked.cmd, locked.body, states) }, { changed: 0, skipped: 2 });
    assert.deepEqual(locked.cmd.workingBuffer, locked.cmd.originalBuffer);
    assert.deepEqual({ ...locked.api.copySlotSurface(locked.cmd, locked.head, states) }, { changed: 2, skipped: 0 });

    const snapshot = locked.api.snapshotSurfaceBytes(locked.cmd.originalBuffer, locked.head);
    assert.equal(locked.api.restoreSurfaceBytes(locked.cmd.workingBuffer, snapshot), true);
    assert.deepEqual(locked.cmd.workingBuffer, locked.cmd.originalBuffer);
});

test("saved states restore surfaces, and older states without them restore the original bytes", () => {
    const { api, cmd, body } = fixture();
    const restored = api.validateSavedSlotSurface(cmd, body, { roughness: { enabled: true, value: 0.5 }, metalness: null }, "Color 1");
    assert.equal(JSON.stringify(restored.map(entry => [entry.key, entry.state.enabled, entry.original])),
        JSON.stringify([["roughness", true, false], ["metalness", false, true]]));
    const legacy = api.validateSavedSlotSurface(cmd, body, undefined, "Color 1");
    assert.ok(legacy.every(entry => entry.original));
    assert.throws(() => api.validateSavedSlotSurface(cmd, body, { roughness: { enabled: "yes", value: 0 } }, "Color 1"), /invalid Roughness/);
    const locked = fixture({ entries: bodyMdf() });
    assert.throws(() => locked.api.validateSavedSlotSurface(locked.cmd, locked.body, { roughness: { enabled: true, value: 0.1 } }, "Color 1"), /keeps this setting in its material file/);
});

test("Color 1 settings the mod MDF declares edit that MDF float and leave the CMD untouched", () => {
    const entries = bodyMdf(SCALARS);
    const { api, state, cmd, body, head } = fixture({ entries });
    assert.equal(api.surfaceEditRoute(cmd, body, "roughness").kind, "default");
    assert.equal(api.canEditSlotSurface(cmd, body, "roughness"), true);
    assert.equal(api.setSlotSurface(cmd, body, "roughness", { enabled: true, value: 0.4 }), true);
    assert.equal(api.setSlotSurface(cmd, body, "roughness", { value: 0.4 }), false, "a repeated value is a no-op");
    assert.deepEqual(cmd.workingBuffer, cmd.originalBuffer, "the CMD keeps its inactive setting");
    const record = state.materialDefaultBuffers.get(mdfPath);
    const [material] = parseMdfMaterialNames(record.workingBuffer, mdfPath);
    const roughness = material.customizeScalars.find(scalar => scalar.key === "roughness" && scalar.index === 0);
    assert.equal(roughness.value, Math.fround(0.4));
    const original = new Uint8Array(entries[mdfPath]);
    const working = new Uint8Array(record.workingBuffer);
    for (let index = 0; index < original.length; index++) {
        if (index < roughness.dataOffset || index >= roughness.dataOffset + 4) assert.equal(working[index], original[index], `Unrelated MDF byte ${index}`);
    }
    // The slot's targets now point at the refreshed material.
    assert.equal(api.materialDefaultScalar(body.surfaceDefaultTargets.roughness[0], "roughness", 0).value, Math.fround(0.4));
    assert.equal(api.revertSurfaceDefault(body, "roughness", body.surfaceDefaultTargets.roughness), true);
    assert.deepEqual(new Uint8Array(state.materialDefaultBuffers.get(mdfPath).workingBuffer), original);
    // The stock head is not in the body MDF: still an ordinary CMD edit.
    assert.equal(api.surfaceEditRoute(cmd, head, "roughness").kind, "cmd");
});

test("sync copies write Color 1 MDF settings only when allowed, and never from a source that is off", () => {
    const source = fixture({ palette: 2 });
    source.api.setSlotSurface(source.cmd, source.body, "metalness", { enabled: true, value: 0.75 });
    const states = source.api.readSlotSurfaceStates(source.cmd, source.body);

    const duplicate = fixture({ entries: bodyMdf(SCALARS) });
    assert.deepEqual({ ...duplicate.api.copySlotSurface(duplicate.cmd, duplicate.body, states) }, { changed: 0, skipped: 1 });
    const sync = fixture({ entries: bodyMdf(SCALARS) });
    assert.deepEqual({ ...sync.api.copySlotSurface(sync.cmd, sync.body, states, { allowDefault: true }) }, { changed: 1, skipped: 0 });
    const [material] = parseMdfMaterialNames(sync.state.materialDefaultBuffers.get(mdfPath).workingBuffer, mdfPath);
    assert.equal(material.customizeScalars.find(scalar => scalar.key === "metalness").value, Math.fround(0.75));
    assert.equal(material.customizeScalars.find(scalar => scalar.key === "roughness").value, 0, "the source's Roughness is off, so it is not copied");
    assert.deepEqual(sync.cmd.workingBuffer, sync.cmd.originalBuffer);
});
