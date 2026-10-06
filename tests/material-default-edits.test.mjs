import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseMdfMaterialNames } from "../lib/mdf-materials.js";
import { cmdRgbaToLinearFloatRgba } from "../lib/sf6-color-space.js";
import { discoverMaterialDefaultTargets, writeMaterialDefaultColor } from "../lib/material-default-edits.js";

const filename = "synthetic.mdf2.40";
const encode = text => new TextEncoder().encode(text);
const hash = buffer => createHash("sha256").update(new Uint8Array(buffer)).digest("hex");

// Independent MDF fixture builder. Includes nonzero property flags, padding,
// hashes, a scalar, and out-of-order CustomizeColor indices, all kept on write.
function makeMdf(materials = [{ name: "esf_Swimwear", colors: [
    { index: 2, values: [0.25, 0.5, 0.75, 0.4] },
    { index: 0, values: [0.1, 0.2, 0.3, 0.6] },
] }], version = 40) {
    const headerSize = version >= 51 ? 108 : version >= 31 ? 100 : version >= 19 ? 80 : 64;
    const buffer = new ArrayBuffer(8192);
    const view = new DataView(buffer);
    new Uint8Array(buffer).fill(0xAD);
    view.setUint32(0, 0x0046444D, true);
    view.setUint16(4, 1, true);
    view.setUint16(6, materials.length, true);
    let cursor = 16 + headerSize * materials.length;
    const string = value => {
        const offset = cursor;
        for (const char of value) {
            view.setUint16(cursor, char.charCodeAt(0), true);
            cursor += 2;
        }
        view.setUint16(cursor, 0, true);
        cursor += 2;
        return offset;
    };
    for (const [materialIndex, material] of materials.entries()) {
        let position = 16 + materialIndex * headerSize;
        const put32 = value => { view.setUint32(position, value, true); position += 4; };
        const put64 = value => { view.setBigUint64(position, BigInt(value), true); position += 8; };
        const nameOffset = string(material.name);
        const params = material.colors.map(color => ({ name: `CustomizeColor_${color.index}`, values: color.values }));
        params.push({ name: "SyntheticScalar", values: [0.8125] });
        const parameterNames = params.map(parameter => string(parameter.name));
        cursor = Math.ceil(cursor / 16) * 16;
        const tableOffset = cursor;
        cursor += params.length * 24;
        const dataOffset = cursor;
        const dataSize = params.reduce((size, parameter) => size + parameter.values.length * 4 + 12, 8);
        cursor += dataSize;
        put64(nameOffset);
        put32(0xABCD1234);
        put32(dataSize);
        put32(params.length);
        put32(0);
        if (version >= 19) { put32(0); put32(0); }
        if (version >= 31) put32(0);
        put32(7);
        put32(0x1D0E0F00);
        if (version >= 31) { put32(0x55667788); put32(0); }
        if (version >= 51) put64(0);
        put64(tableOffset);
        put64(0);
        if (version >= 19) put64(0);
        put64(dataOffset);
        put64(0);
        if (version >= 31) put64(0);
        assert.equal(position, 16 + (materialIndex + 1) * headerSize);
        let relativeDataOffset = 8;
        for (const [index, parameter] of params.entries()) {
            const entryOffset = tableOffset + index * 24;
            view.setBigUint64(entryOffset, BigInt(parameterNames[index]), true);
            view.setUint32(entryOffset + 8, 0x12345678, true);
            view.setUint32(entryOffset + 12, 0x87654321, true);
            if (version >= 13) {
                view.setInt32(entryOffset + 16, relativeDataOffset, true);
                view.setUint16(entryOffset + 20, parameter.values.length, true);
                view.setUint16(entryOffset + 22, 0xA17, true);
            } else {
                view.setUint32(entryOffset + 16, parameter.values.length, true);
                view.setInt32(entryOffset + 20, relativeDataOffset, true);
            }
            for (const [component, value] of parameter.values.entries()) {
                view.setFloat32(dataOffset + relativeDataOffset + component * 4, value, true);
            }
            relativeDataOffset += parameter.values.length * 4 + 12;
        }
    }
    return buffer.slice(0, cursor + 16);
}

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
