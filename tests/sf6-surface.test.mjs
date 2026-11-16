import assert from "node:assert/strict";
import test from "node:test";
import {
    copySurfaceFieldBytes,
    extractSlotSurface,
    formatSurfaceState,
    formatSurfaceValue,
    markSharedSurfaces,
    normalizeSurfaceParameter,
    readSlotSurface,
    readSurfaceField,
    surfaceFieldBytesDiffer,
    surfaceRuntimeName,
    syncSurfaceModels,
    writeSurfaceBytes,
    writeSurfaceField,
} from "../lib/sf6-surface.js";

const OPTION = "app.CostumeMaterialData.CustomizeColorData.ColorOption";

// Synthetic RSZ instances shaped like rsz-instance-parser output. Each data
// instance is 8 bytes: Enable at +0 (padded to 4), float32 _Value at +4.
function makeSlotInstances({ base = 1, offset = 0, roughness = [false, 0], metalness = [false, 0] } = {}) {
    const buffer = new ArrayBuffer(offset + 24);
    const view = new DataView(buffer);
    const data = (index, typeName, start, [enabled, value]) => {
        view.setUint8(start, enabled ? 1 : 0);
        view.setFloat32(start + 4, value, true);
        return {
            index, typeName,
            fields: {
                Enable: { kind: "bool", value: enabled, absoluteOffset: start, byteLength: 1 },
                _Value: { kind: "float", value: Math.fround(value), absoluteOffset: start + 4, byteLength: 4 },
            },
        };
    };
    const instances = [
        data(base, "app.CostumeMaterialData.FloatData", offset, [true, 1]),
        data(base + 1, "app.CostumeMaterialData.RoughnessData", offset + 8, roughness),
        data(base + 2, "app.CostumeMaterialData.MetalnessData", offset + 16, metalness),
        { index: base + 3, typeName: OPTION, fields: {
            BlendRate: { kind: "object", instanceId: base },
            Roughness: { kind: "object", instanceId: base + 1 },
            Metalness: { kind: "object", instanceId: base + 2 },
        } },
    ];
    return { buffer, instances, optionId: base + 3 };
}

const mapOf = instances => new Map(instances.map(instance => [instance.index, instance]));

test("extracts roughness and metalness with in-place offsets, ignoring BlendRate", () => {
    const { buffer, instances, optionId } = makeSlotInstances({ roughness: [true, 0.13], metalness: [false, 0] });
    const surface = extractSlotSurface(optionId, mapOf(instances));
    assert.equal(surface.shared, false);
    assert.deepEqual(surface.roughness.enable, { absoluteOffset: 8, byteLength: 1 });
    assert.deepEqual(surface.roughness.valueField, { absoluteOffset: 12, byteLength: 4 });
    assert.equal(surface.roughness.enabled, true);
    assert.equal(surface.roughness.value, Math.fround(0.13));
    assert.equal(surface.metalness.enabled, false);
    assert.equal(readSlotSurface(buffer, { surface }).roughness.value, Math.fround(0.13));
    assert.equal(extractSlotSurface(null, mapOf(instances)), null);
    assert.equal(extractSlotSurface(1, mapOf(instances)), null, "a non-Option instance is not a surface");
});

test("writes change only the targeted bytes and keep untouched values byte-identical", () => {
    const { buffer, instances, optionId } = makeSlotInstances({ roughness: [false, 0.37] });
    const surface = extractSlotSurface(optionId, mapOf(instances));
    const before = buffer.slice(0);

    writeSurfaceField(buffer, surface.roughness, { enabled: true });
    const diff = [...new Uint8Array(buffer)].flatMap((byte, index) => byte === new Uint8Array(before)[index] ? [] : [index]);
    assert.deepEqual(diff, [8], "turning a field on only flips its Enable byte");
    assert.equal(surface.roughness.enabled, true);
    assert.equal(surface.roughness.value, Math.fround(0.37));

    writeSurfaceField(buffer, surface.roughness, { enabled: true, value: -0.25 });
    assert.deepEqual(readSurfaceField(buffer, surface.roughness), { enabled: true, value: -0.25 });
    assert.ok(surfaceFieldBytesDiffer(before, buffer, surface.roughness));
    assert.ok(!surfaceFieldBytesDiffer(before, buffer, surface.metalness));
    assert.throws(() => writeSurfaceField(buffer, surface.roughness, { enabled: true, value: Number.NaN }), /finite/);
    assert.throws(() => writeSurfaceField(buffer, surface.roughness, { enabled: "yes" }), /boolean/);

    assert.ok(copySurfaceFieldBytes(buffer, before, surface.roughness));
    assert.deepEqual(new Uint8Array(buffer), new Uint8Array(before));
    assert.equal(surface.roughness.enabled, false, "reverting refreshes the live model");
});

test("preview writes leave the live model alone, and syncSurfaceModels refreshes it", () => {
    const { buffer, instances, optionId } = makeSlotInstances();
    const surface = extractSlotSurface(optionId, mapOf(instances));
    const preview = buffer.slice(0);
    writeSurfaceBytes(preview, surface.metalness, { enabled: true, value: 1 });
    assert.equal(surface.metalness.enabled, false);
    syncSurfaceModels(preview, [{ colors: [{ surface }] }]);
    assert.equal(surface.metalness.enabled, true);
    assert.equal(surface.metalness.value, 1);
});

test("slots that share one Option or data instance are marked shared", () => {
    const first = makeSlotInstances({ base: 1 });
    const second = makeSlotInstances({ base: 11, offset: 24 });
    const map = mapOf([...first.instances, ...second.instances]);
    const a = { surface: extractSlotSurface(first.optionId, map) };
    const b = { surface: extractSlotSurface(second.optionId, map) };
    // A custom-material clone of `a` points at the same Option instance.
    const clone = { surface: extractSlotSurface(first.optionId, map) };
    const clusters = [{ colors: [a, b] }, { colors: [clone] }];
    assert.equal(markSharedSurfaces(clusters), 2);
    assert.equal(a.surface.shared, true);
    assert.equal(clone.surface.shared, true);
    assert.equal(b.surface.shared, false);
});

test("runtime parameter names map to CMD slot indexes", () => {
    assert.deepEqual(normalizeSurfaceParameter("CustomizeRoughness_7"), { key: "roughness", index: 7, parameter: "CustomizeRoughness_7" });
    assert.deepEqual(normalizeSurfaceParameter("CustomizeMetal_0"), { key: "metalness", index: 0, parameter: "CustomizeMetal_0" });
    for (const name of ["CustomizeMetalness_0", "CustomizeRoughness_", "CustomizeRoughness_1x", "Roughness", "DamageRoughness_0", 3]) {
        assert.equal(normalizeSurfaceParameter(name), null, String(name));
    }
    assert.equal(surfaceRuntimeName("metalness", 4), "CustomizeMetal_4");
    assert.equal(formatSurfaceValue(0.2), "+0.20");
    assert.equal(formatSurfaceValue(-1), "-1.00");
    assert.equal(formatSurfaceValue(-0.001), "0.00");
    assert.equal(formatSurfaceState({ enabled: false, value: 0.5 }), "off");
});

test("Blend Rate is parsed from Option.BlendRate with its own 0..1 range and runtime name", async () => {
    const { clampSurfaceValue, isSurfaceValueInRange, surfaceRange } = await import("../lib/sf6-surface.js");
    const { buffer, instances, optionId } = makeSlotInstances();
    const surface = extractSlotSurface(optionId, mapOf(instances));
    assert.deepEqual(surface.blendRate.enable, { absoluteOffset: 0, byteLength: 1 });
    assert.equal(surface.blendRate.enabled, true);
    assert.equal(surface.blendRate.value, 1);
    writeSurfaceField(buffer, surface.blendRate, { enabled: true, value: 0.4 });
    assert.equal(readSurfaceField(buffer, surface.blendRate).value, Math.fround(0.4));
    assert.deepEqual(surfaceRange("blendRate"), { min: 0, max: 1 });
    assert.deepEqual(surfaceRange("roughness"), { min: -1, max: 1 });
    assert.equal(isSurfaceValueInRange(-0.2, "blendRate"), false);
    assert.equal(isSurfaceValueInRange(-0.2, "roughness"), true);
    assert.equal(clampSurfaceValue(-3, "blendRate"), 0);
    assert.equal(clampSurfaceValue(-3, "metalness"), -1);
    assert.deepEqual(normalizeSurfaceParameter("CustomizeColor_3_BlendRate"), { key: "blendRate", index: 3, parameter: "CustomizeColor_3_BlendRate" });
    assert.equal(normalizeSurfaceParameter("CustomizeColor_3"), null);
    assert.equal(normalizeSurfaceParameter("CustomizeColor_BlendSwitch"), null);
    assert.equal(surfaceRuntimeName("blendRate", 2), "CustomizeColor_2_BlendRate");
    assert.equal(formatSurfaceValue(0.8, "blendRate"), "0.80", "Blend Rate is not shown as a signed offset");
    assert.equal(formatSurfaceValue(0.8, "roughness"), "+0.80");
});
