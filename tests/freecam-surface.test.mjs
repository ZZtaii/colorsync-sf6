import assert from "node:assert/strict";
import test from "node:test";
import {
    FREECAM_COLOR_PREFIX,
    exportCmdColorTransfer,
    parseFreecamColorTransfer,
    planFreecamColorImport,
} from "../lib/freecam-colors.js";

// One material with two slots. Per slot (24 bytes): color Enable, RGBA,
// Roughness Enable + float, Metalness Enable + float.
function makeCmd({ roughness = [[false, 0], [false, 0]], metalness = [[false, 0], [false, 0]], colorEnabled = [true, true] } = {}) {
    const buffer = new ArrayBuffer(48);
    const view = new DataView(buffer);
    const field = (start, [enabled, value]) => {
        view.setUint8(start, enabled ? 1 : 0);
        view.setFloat32(start + 4, value, true);
        return { enabled, value: Math.fround(value), enable: { absoluteOffset: start, byteLength: 1 }, valueField: { absoluteOffset: start + 4, byteLength: 4 } };
    };
    const colors = [0, 1].map(index => {
        const base = index * 24;
        view.setUint8(base, colorEnabled[index] ? 1 : 0);
        new Uint8Array(buffer).set([128, 64, 32, 255], base + 1);
        return {
            index, runtimeName: `CustomizeColor_${index}`, enabled: colorEnabled[index],
            enable: { absoluteOffset: base, byteLength: 1 },
            color: { absoluteOffset: base + 1 },
            surface: {
                shared: false,
                roughness: field(base + 8, roughness[index]),
                metalness: field(base + 16, metalness[index]),
            },
        };
    });
    return { workingBuffer: buffer, colorClusters: [{ name: "esf_Body00", colors }] };
}

const transfer = (changes, version = 2) => FREECAM_COLOR_PREFIX + JSON.stringify({
    format: "sf6-freecam-colors", version, colorSpace: "linear", source: { object: "P1" }, changes,
});

test("version 2 exports parse scalar Roughness and Metalness entries", () => {
    const document = parseFreecamColorTransfer(transfer([
        { material: "esf_Body00", parameter: "CustomizeColor_0", rgba: [0.5, 0.5, 0.5, 1] },
        { material: "esf_Body00", parameter: "CustomizeRoughness_0", value: 0.2 },
        { material: "esf_Body00", parameter: "CustomizeMetal_1", value: -1 },
    ]));
    assert.equal(document.changes[1].value, 0.2);
    assert.equal(document.changes[1].rgba, undefined);
    assert.throws(() => parseFreecamColorTransfer(transfer([{ material: "esf_Body00", parameter: "CustomizeMetal_0", value: "1" }])), /finite number/);
    assert.throws(() => parseFreecamColorTransfer(transfer([{ material: "esf_Body00", parameter: "CustomizeMetal_0", value: 1, rgba: [0, 0, 0, 1] }])), /finite number/);
    assert.throws(() => parseFreecamColorTransfer(transfer([{ material: "esf_Body00", parameter: "CustomizeColor_0", rgba: [0, 0, 0, 1] }], 3)), /version 1 or 2/);
});

test("planning routes surface entries to the slot's own fields and skips unsafe ones", () => {
    const cmd = makeCmd({ roughness: [[true, 0.2], [false, 0]] });
    const document = parseFreecamColorTransfer(transfer([
        { material: "esf_Body00", parameter: "CustomizeRoughness_0", value: 0.2, mesh: "a" },
        { material: "esf_Body00", parameter: "CustomizeRoughness_0", value: 0.2, mesh: "b" },
        { material: "esf_Body00", parameter: "CustomizeMetal_1", value: 0.75 },
        { material: "esf_Body00", parameter: "CustomizeRoughness_1", value: 1.5 },
        { material: "esf_Body00", parameter: "CustomizeMetal_0", value: 0.1, mesh: "a" },
        { material: "esf_Body00", parameter: "CustomizeMetal_0", value: 0.2, mesh: "b" },
        { material: "esf_Body00", parameter: "CustomizeRoughness_9", value: 0 },
        { material: "esf_Missing", parameter: "CustomizeRoughness_0", value: 0 },
    ]));
    const plan = planFreecamColorImport(document, cmd);
    assert.equal(plan.duplicates, 1);
    const unchanged = plan.operations.find(operation => operation.parameter === "CustomizeRoughness_0");
    assert.equal(unchanged.kind, "surface");
    assert.equal(unchanged.changed, false, "an override that already matches needs no write");
    const metal = plan.operations.find(operation => operation.parameter === "CustomizeMetal_1");
    assert.equal(metal.surfaceKey, "metalness");
    assert.equal(metal.slot, cmd.colorClusters[0].colors[1]);
    assert.equal(metal.value, Math.fround(0.75));
    assert.equal(metal.changed, true);
    const reasons = Object.fromEntries(plan.issues.map(issue => [`${issue.material}/${issue.parameter}`, issue.reason]));
    assert.match(reasons["esf_Body00/CustomizeRoughness_1"], /outside the supported range/);
    assert.match(reasons["esf_Body00/CustomizeMetal_0"], /Conflicting exported Metalness/);
    assert.match(reasons["esf_Body00/CustomizeRoughness_9"], /no Roughness setting/);
    assert.match(reasons["esf_Missing/CustomizeRoughness_0"], /Material is missing/);
});

test("color-string exports include edited surface fields that are on, and round-trip", () => {
    const cmd = makeCmd({
        roughness: [[true, -0.3], [false, 0.9]],
        metalness: [[false, 0], [true, 1]],
        colorEnabled: [true, false],
    });
    // As loaded: Roughness_0 and Metal_1 were off, Roughness_1 was already off at 0.9.
    cmd.originalBuffer = cmd.workingBuffer.slice(0);
    const view = new DataView(cmd.originalBuffer);
    view.setUint8(8, 0);
    view.setUint8(24 + 16, 0);
    const result = exportCmdColorTransfer(cmd, "Mai C1 - Color 2");
    assert.equal(result.document.version, 2);
    assert.equal(result.slotCount, 1);
    assert.equal(result.surfaceCount, 2);
    assert.equal(result.inactiveSlots, 1);
    const surfaces = result.document.changes.filter(change => change.value !== undefined);
    assert.deepEqual(surfaces.map(change => [change.parameter, change.value]), [
        ["CustomizeRoughness_0", Math.fround(-0.3)],
        ["CustomizeMetal_1", 1],
    ], "edited fields export even when their color slot is inactive");

    const target = makeCmd();
    const plan = planFreecamColorImport(parseFreecamColorTransfer(result.text), target);
    assert.equal(plan.issues.length, 0);
    assert.deepEqual(plan.operations.filter(operation => operation.kind === "surface").map(operation => [operation.parameter, operation.value]), [
        ["CustomizeRoughness_0", Math.fround(-0.3)],
        ["CustomizeMetal_1", 1],
    ]);
});

test("color-only CMD exports stay version 1 for older importers", () => {
    const result = exportCmdColorTransfer(makeCmd(), "Color 2");
    assert.equal(result.document.version, 1);
    assert.equal(result.surfaceCount, 0);
    assert.ok(result.document.changes.every(change => Array.isArray(change.rgba)));
});

test("Blend Rate entries route to Option.BlendRate and must stay within 0..1", () => {
    const cmd = makeCmd();
    const buffer = new ArrayBuffer(cmd.workingBuffer.byteLength + 16);
    new Uint8Array(buffer).set(new Uint8Array(cmd.workingBuffer));
    cmd.workingBuffer = buffer;
    const view = new DataView(buffer);
    cmd.colorClusters[0].colors.forEach((slot, index) => {
        const start = 48 + index * 8;
        view.setUint8(start, 1);
        view.setFloat32(start + 4, 1, true);
        slot.surface.blendRate = { enabled: true, value: 1, enable: { absoluteOffset: start, byteLength: 1 }, valueField: { absoluteOffset: start + 4, byteLength: 4 } };
    });
    const document = parseFreecamColorTransfer(transfer([
        { material: "esf_Body00", parameter: "CustomizeColor_0_BlendRate", value: 0.35 },
        { material: "esf_Body00", parameter: "CustomizeColor_1_BlendRate", value: -0.1 },
    ]));
    const plan = planFreecamColorImport(document, cmd);
    assert.equal(plan.operations.length, 1);
    assert.equal(plan.operations[0].surfaceKey, "blendRate");
    assert.equal(plan.operations[0].field, cmd.colorClusters[0].colors[0].surface.blendRate);
    assert.equal(plan.operations[0].changed, true);
    assert.match(plan.issues[0].reason, /Blend Rate -0\.1 is outside the supported range of 0 to 1/);

    // Both Blend Rates are on at 1 as loaded: plain color strings leave them out.
    cmd.originalBuffer = cmd.workingBuffer.slice(0);
    const plain = exportCmdColorTransfer(cmd, "Color 2");
    assert.equal(plain.document.version, 1);
    assert.equal(plain.surfaceCount, 0, "unedited settings that are on are not exported");

    // Editing one Blend Rate exports just that one.
    new DataView(cmd.workingBuffer).setFloat32(52, 0.6, true);
    const edited = exportCmdColorTransfer(cmd, "Color 2");
    assert.equal(edited.document.version, 2);
    assert.deepEqual(edited.document.changes.filter(change => change.value !== undefined).map(change => [change.parameter, change.value]),
        [["CustomizeColor_0_BlendRate", Math.fround(0.6)]]);

    // An edit that turns a setting off cannot be expressed, so it is left out.
    new DataView(cmd.workingBuffer).setFloat32(52, 1, true);
    new DataView(cmd.workingBuffer).setUint8(56, 0);
    assert.equal(exportCmdColorTransfer(cmd, "Color 2").surfaceCount, 0);
});

test("a CMD without a loaded baseline exports colors only", () => {
    const cmd = makeCmd({ roughness: [[true, 0.5], [true, 0.5]] });
    const result = exportCmdColorTransfer(cmd, "Color 2");
    assert.equal(result.surfaceCount, 0);
    assert.equal(result.document.version, 1);
});
