import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseMdfMaterialNames } from "../lib/mdf-materials.js";
import { cmdRgbaToLinearFloatRgba, linearFloatRgbaToCmdRgba } from "../lib/sf6-color-space.js";
import { discoverMaterialDefaultTargets, writeMaterialDefaultColor, writeMaterialDefaultLinearColor } from "../lib/material-default-edits.js";
import { parseFreecamColorTransfer, planFreecamColorImport } from "../lib/freecam-colors.js";

import { makeMdf } from "./fixtures/mdf.mjs";

const filename = "synthetic.mdf2.40";
const encode = text => new TextEncoder().encode(text);
const hash = buffer => createHash("sha256").update(new Uint8Array(buffer)).digest("hex");

test("parser exposes exact CustomizeColor offsets and length without counting property flags", () => {
    for (const version of [10, 13, 19, 31, 40, 51]) {
        const buffer = makeMdf(undefined, version);
        const [material] = parseMdfMaterialNames(buffer, `test.mdf2.${version}`);
        assert.deepEqual(material.customizeColorIndexes, [0, 2]);
        assert.equal(material.materialIndex, 0);
        for (const color of material.customizeColors) {
            assert.equal(color.componentCount, 4);
            assert.equal(new DataView(buffer).getFloat32(color.dataOffset, true), color.linearRgba[0]);
        }
    }
});

test("writes precise linear RGB and plain alpha, changing only the requested float vector", () => {
    const buffer = makeMdf();
    const originalHash = hash(buffer);
    const rgba = [15, 102, 237, 109];
    const result = writeMaterialDefaultColor(buffer, filename, "esf_Swimwear", 0, rgba);
    assert.notEqual(result.buffer, buffer);
    assert.equal(result.changed, true);
    assert.equal(hash(buffer), originalHash);
    assert.equal(result.buffer.byteLength, buffer.byteLength);
    const before = new Uint8Array(buffer);
    const after = new Uint8Array(result.buffer);
    for (let offset = 0; offset < before.length; offset += 1) {
        if (offset >= result.dataOffset && offset < result.dataOffset + 16) continue;
        assert.equal(after[offset], before[offset], `untargeted MDF byte ${offset}`);
    }
    const expected = cmdRgbaToLinearFloatRgba(rgba).map(Math.fround);
    const actual = Array.from({ length: 4 }, (_, component) => new DataView(result.buffer).getFloat32(result.dataOffset + component * 4, true));
    assert.deepEqual(actual, expected);
    assert.deepEqual(parseMdfMaterialNames(result.buffer, filename)[0].customizeColors[0].cmdRgba, rgba);
    const repeated = writeMaterialDefaultColor(result.buffer, filename, "esf_Swimwear", 0, rgba);
    assert.equal(repeated.changed, false);
    assert.notEqual(repeated.buffer, result.buffer);
    assert.equal(hash(repeated.buffer), hash(result.buffer));
});

test("three-component vectors leave padding and the following float untouched", () => {
    const buffer = makeMdf([{ name: "esf_Trim", colors: [{ index: 0, values: [0.2, 0.4, 0.6] }] }]);
    const result = writeMaterialDefaultColor(buffer, filename, "esf_Trim", 0, [38, 114, 190, 17]);
    assert.equal(result.componentCount, 3);
    assert.deepEqual(new Uint8Array(result.buffer).slice(result.dataOffset + 12), new Uint8Array(buffer).slice(result.dataOffset + 12));
    assert.deepEqual(parseMdfMaterialNames(result.buffer, filename)[0].customizeColors[0].cmdRgba, [38, 114, 190, 255]);
});

test("runtime default writes retain float32 precision without a CMD byte round-trip", () => {
    const buffer = makeMdf();
    const originalHash = hash(buffer);
    const runtimeRgba = [0.00021789, 0.25123456, 0.78912345, 0.54321987];
    const originalRgba = runtimeRgba.slice();
    const result = writeMaterialDefaultLinearColor(buffer, filename, "esf_Swimwear", 0, runtimeRgba);
    const stored = runtimeRgba.map(Math.fround);
    assert.equal(result.changed, true);
    assert.notEqual(result.buffer, buffer);
    assert.equal(hash(buffer), originalHash);
    assert.deepEqual(runtimeRgba, originalRgba);
    assert.equal(result.buffer.byteLength, buffer.byteLength);
    assert.deepEqual(result.linearRgba, stored);
    assert.deepEqual(result.rgba, linearFloatRgbaToCmdRgba(stored));
    assert.deepEqual(parseMdfMaterialNames(result.buffer, filename)[0].customizeColors[0].linearRgba, stored);
    const quantized = cmdRgbaToLinearFloatRgba(linearFloatRgbaToCmdRgba(runtimeRgba)).map(Math.fround);
    assert.ok(stored.every((channel, index) => channel !== quantized[index]));
    const before = new Uint8Array(buffer);
    const after = new Uint8Array(result.buffer);
    for (let offset = 0; offset < before.length; offset += 1) {
        if (offset >= result.dataOffset && offset < result.dataOffset + 16) continue;
        assert.equal(after[offset], before[offset], `untargeted MDF byte ${offset}`);
    }
    const repeated = writeMaterialDefaultLinearColor(result.buffer, filename, "esf_Swimwear", 0, runtimeRgba);
    assert.equal(repeated.changed, false);
    assert.equal(hash(repeated.buffer), hash(result.buffer));
});

test("runtime default writes accept typed floats and keep RGB-only alpha unchanged", () => {
    const buffer = makeMdf([{ name: "esf_Trim", colors: [{ index: 0, values: [0.2, 0.4, 0.6] }] }]);
    const rgba = new Float64Array([0.01234567, 0.23456789, 0.87654321, 1]);
    const originalRgba = rgba.slice();
    const result = writeMaterialDefaultLinearColor(buffer, filename, "esf_Trim", 0, rgba);
    assert.equal(result.componentCount, 3);
    assert.deepEqual(rgba, originalRgba);
    assert.deepEqual(new Uint8Array(result.buffer).slice(result.dataOffset + 12), new Uint8Array(buffer).slice(result.dataOffset + 12));
    assert.deepEqual(parseMdfMaterialNames(result.buffer, filename)[0].customizeColors[0].linearRgba,
        Array.from(rgba, Math.fround));
    const before = hash(buffer);
    assert.throws(() => writeMaterialDefaultLinearColor(buffer, filename, "esf_Trim", 0, [0.1, 0.2, 0.3, 0.99999999]), /alpha must remain 1/);
    assert.equal(hash(buffer), before);
});

test("invalid runtime RGBA and unsafe material addresses fail without input mutations", () => {
    const buffer = makeMdf();
    const before = hash(buffer);
    for (const malformed of [null, {}, [0, 0, 1], [0, 0, 0, 1, 1], new DataView(new ArrayBuffer(16))]) {
        assert.throws(() => writeMaterialDefaultLinearColor(buffer, filename, "esf_Swimwear", 0, malformed), /finite linear RGBA floats/);
    }
    for (const bad of [-0.001, 1.001, NaN, Infinity, -Infinity, "0.1", null, undefined]) {
        assert.throws(() => writeMaterialDefaultLinearColor(buffer, filename, "esf_Swimwear", 0, [bad, 0.2, 0.3, 1]), /finite linear RGBA floats/);
    }
    assert.throws(() => writeMaterialDefaultLinearColor(buffer, filename, "esf_Other", 0, [0.1, 0.2, 0.3, 1]), /not found/);
    assert.throws(() => writeMaterialDefaultLinearColor(buffer, filename, "esf_Swimwear", 1, [0.1, 0.2, 0.3, 1]), /does not declare/);
    assert.throws(() => writeMaterialDefaultLinearColor(buffer.slice(0, 90), filename, "esf_Swimwear", 0, [0.1, 0.2, 0.3, 1]), /outside/);
    assert.equal(hash(buffer), before);
    const duplicateNames = makeMdf([0, 1].map(() => ({ name: "esf_Trim", colors: [{ index: 0, values: [0, 0, 0, 1] }] })));
    assert.throws(() => writeMaterialDefaultLinearColor(duplicateNames, filename, "esf_Trim", 0, [0.1, 0.2, 0.3, 1]), /ambiguous/);
    assert.equal(writeMaterialDefaultLinearColor(duplicateNames, filename, "esf_Trim", 0, [0.1, 0.2, 0.3, 1], { materialIndex: 1 }).materialIndex, 1);
});

test("Freecam plans retain a separate unquantized runtime RGBA copy for MDF writes", () => {
    const workingBuffer = new ArrayBuffer(16);
    new Uint8Array(workingBuffer).set([1, 0, 0, 0, 0, 0, 0, 255]);
    const cmd = { workingBuffer, colorClusters: [{ name: "esf_Swimwear", colors: [{
        index: 0, enabled: true, enable: { absoluteOffset: 0, byteLength: 1 }, color: { absoluteOffset: 4 },
    }] }] };
    const rawRgba = [0.00021789, 0.25123456, 0.78912345, 0.54321987];
    const document = parseFreecamColorTransfer(JSON.stringify({
        format: "sf6-freecam-colors", version: 1, colorSpace: "linear",
        changes: [{ material: "esf_Swimwear", parameter: "CustomizeColor_0", rgba: rawRgba }],
    }));
    const before = workingBuffer.slice(0);
    const [operation] = planFreecamColorImport(document, cmd).operations;
    assert.deepEqual(operation.rgba, linearFloatRgbaToCmdRgba(rawRgba));
    assert.deepEqual(operation.linearRgba, rawRgba);
    assert.notEqual(operation.linearRgba, document.changes[0].rgba);
    operation.linearRgba[0] = 0;
    assert.deepEqual(document.changes[0].rgba, rawRgba);
    assert.deepEqual(workingBuffer, before);
});

test("missing, ambiguous, unsupported and invalid requests never mutate their input", () => {
    const buffer = makeMdf();
    const before = hash(buffer);
    assert.throws(() => writeMaterialDefaultColor(buffer, filename, "esf_Other", 0, [1, 2, 3, 4]), /not found/);
    assert.throws(() => writeMaterialDefaultColor(buffer, filename, "esf_Swimwear", 1, [1, 2, 3, 4]), /does not declare/);
    assert.throws(() => writeMaterialDefaultColor(buffer, filename, "esf_Swimwear", 0, [1, 2, 3]), /four/);
    for (const bad of [-1, 256, NaN, Infinity, 3.5, "10"]) {
        assert.throws(() => writeMaterialDefaultColor(buffer, filename, "esf_Swimwear", 0, [bad, 2, 3, 4]), /RGBA bytes/);
    }
    assert.equal(hash(buffer), before);
    const duplicateNames = makeMdf([0, 1].map(() => ({ name: "esf_Trim", colors: [{ index: 0, values: [0, 0, 0, 1] }] })));
    assert.throws(() => writeMaterialDefaultColor(duplicateNames, filename, "esf_Trim", 0, [1, 2, 3, 4]), /ambiguous/);
    assert.equal(writeMaterialDefaultColor(duplicateNames, filename, "esf_Trim", 0, [1, 2, 3, 4], { materialIndex: 1 }).materialIndex, 1);
    const duplicateSlots = makeMdf([{ name: "esf_Trim", colors: [0, 1].map(() => ({ index: 0, values: [0, 0, 0, 1] })) }]);
    assert.throws(() => writeMaterialDefaultColor(duplicateSlots, filename, "esf_Trim", 0, [1, 2, 3, 4]), /duplicate/);
    const unsupported = makeMdf([{ name: "esf_Trim", colors: [{ index: 0, values: [0, 0, 0, 1, 0] }] }]);
    assert.throws(() => writeMaterialDefaultColor(unsupported, filename, "esf_Trim", 0, [1, 2, 3, 4]), /supported RGB/);
});

test("invalid parameter offsets and truncated buffers fail before producing writes", () => {
    const buffer = makeMdf();
    const view = new DataView(buffer);
    const tableOffset = Number(view.getBigUint64(16 + 52, true));
    view.setInt32(tableOffset + 16, -16, true);
    const before = hash(buffer);
    assert.throws(() => writeMaterialDefaultColor(buffer, filename, "esf_Swimwear", 2, [1, 2, 3, 4]), /outside|exceeds/);
    assert.equal(hash(buffer), before);
    assert.throws(() => writeMaterialDefaultColor(makeMdf().slice(0, 90), filename, "esf_Swimwear", 0, [1, 2, 3, 4]), /outside/);
    const overlapping = makeMdf();
    new DataView(overlapping).setBigUint64(16 + 76, 0n, true);
    assert.throws(() => writeMaterialDefaultColor(overlapping, filename, "esf_Swimwear", 0, [1, 2, 3, 4]), /overlaps MDF headers/);
});

const nativePath = (root, costume = "001", esfId = "esf900") => `${root}natives/STM/Product/Model/esf/${esfId}/${costume}/synthetic.mdf2.40`;

test("selected main component discovers all directly requiring variants without sweeping other mods", () => {
    const main = "Bundle/01 Main files/";
    const entries = {
        [`${main}modinfo.ini`]: encode("name=Shared Main\nAddonFor=Bundle Menu\n"),
        "Bundle/00 Menu/modinfo.ini": encode("name=Bundle Menu\nDummyMod=True\n"),
        "Bundle/02 Variants/modinfo.ini": encode("name=Variants Menu\nAddonFor=Bundle Menu\nDummyMod=True\n"),
        "Bundle/Unrelated/modinfo.ini": encode("name=Other Mod\nAddonFor=Bundle Menu\n"),
        [nativePath("Bundle/Unrelated/")]: new Uint8Array(makeMdf()),
        [`${main}Nested/modinfo.ini`]: encode("name=Nested Unrelated\n"),
        [nativePath(`${main}Nested/`)]: new Uint8Array(makeMdf()),
        [nativePath(`${main}backup_colors/snapshots/old/`)]: new Uint8Array(makeMdf()),
        [nativePath(`${main}old.zip/`)]: new Uint8Array(makeMdf()),
    };
    for (const variant of ["Shoes", "Barefoot", "Sandals"]) {
        const root = `Bundle/${variant}/`;
        entries[`${root}modinfo.ini`] = encode(`name=${variant}\nAddonFor=Variants Menu\nRequirement=Shared Main\n`);
        // Real ZIP entry views can start inside a larger allocation.
        const buffer = makeMdf();
        const wrapped = new Uint8Array(buffer.byteLength + 10);
        wrapped.set(new Uint8Array(buffer), 5);
        entries[nativePath(root)] = wrapped.subarray(5, 5 + buffer.byteLength);
        entries[nativePath(root, "002")] = new Uint8Array(buffer);
        entries[nativePath(root, "001", "esf901")] = new Uint8Array(buffer);
    }
    const targets = discoverMaterialDefaultTargets(entries, { selectedRoot: main, esfId: "esf900", costumeFolder: "001" });
    assert.equal(targets.length, 3);
    assert.deepEqual(targets.map(target => target.root), ["Bundle/Barefoot/", "Bundle/Sandals/", "Bundle/Shoes/"]);
    for (const target of targets) {
        assert.equal(target.name, "esf_Swimwear");
        assert.equal(target.materialIndex, 0);
        assert.ok(target.customizeColors[0].dataOffset > 0);
        assert.equal(target.source, "mod");
        assert.ok(entries[target.sourcePath]);
    }
});

test("direct add-ons and required main component are relevant; common menu siblings stay separate", () => {
    const entries = {
        "main/modinfo.ini": encode("name=Main\n"),
        "chosen/modinfo.ini": encode("name=Chosen\nRequirement=Main\nAddonFor=Menu\n"),
        "addon/modinfo.ini": encode("name=Addon\nAddonFor=Chosen\n"),
        "sibling/modinfo.ini": encode("name=Sibling\nAddonFor=Menu\n"),
    };
    for (const root of ["main/", "chosen/", "addon/", "sibling/"]) entries[nativePath(root)] = new Uint8Array(makeMdf());
    const targets = discoverMaterialDefaultTargets(entries, { selectedRoot: "chosen/", esfId: "esf900", costumeFolder: "001" });
    assert.deepEqual(targets.map(target => target.root), ["addon/", "chosen/", "main/"]);
});

test("ambiguous display names do not attach unrelated variants", () => {
    const entries = {
        "main/modinfo.ini": encode("name=Main\n"),
        "other-main/modinfo.ini": encode("name=Main\n"),
        "variant/modinfo.ini": encode("name=Variant\nRequirement=Main\n"),
        [nativePath("main/")]: new Uint8Array(makeMdf()),
        [nativePath("variant/")]: new Uint8Array(makeMdf()),
    };
    assert.deepEqual(discoverMaterialDefaultTargets(entries, { selectedRoot: "main/", esfId: "esf900", costumeFolder: "001" }).map(target => target.root), ["main/"]);
});

test("flat imports work, shared costume 000 is supported and invalid scope is rejected", () => {
    const entries = {
        [nativePath("", "000")]: new Uint8Array(makeMdf()),
        [nativePath("", "001")]: new Uint8Array(makeMdf()),
        [nativePath("", "002")]: new Uint8Array(makeMdf()),
    };
    assert.equal(discoverMaterialDefaultTargets(entries, { selectedRoot: "", esfId: "esf900", costumeFolder: "001" }).length, 2);
    assert.equal(discoverMaterialDefaultTargets(entries, { esfId: "esf900", costumeFolder: "000" }).length, 1);
    assert.deepEqual(discoverMaterialDefaultTargets(entries, { esfId: "esf900/.*", costumeFolder: "001" }), []);
    assert.deepEqual(discoverMaterialDefaultTargets(entries, { esfId: "esf900", costumeFolder: "1|2" }), []);
});
