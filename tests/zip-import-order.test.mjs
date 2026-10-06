import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, unzipSync, zipSync } from "../lib/fflate.js";
import { createCompressedZip } from "../lib/zip-archive.js";
import { readCompressedZip } from "../lib/zip-import.js";

// Read names independently from ZIP central and local headers, rather than
// taking the decompressor's returned object order as the expected order.
function zipNames(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let end = bytes.length - 22;
    while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
    assert.ok(end >= 0, "ZIP end record missing");
    const count = view.getUint16(end + 10, true);
    let offset = view.getUint32(end + 16, true);
    const central = [];
    const local = [];
    for (let index = 0; index < count; index++) {
        assert.equal(view.getUint32(offset, true), 0x02014b50);
        const length = view.getUint16(offset + 28, true);
        const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + length));
        const localOffset = view.getUint32(offset + 42, true);
        assert.equal(view.getUint32(localOffset, true), 0x04034b50);
        const localLength = view.getUint16(localOffset + 26, true);
        const localName = new TextDecoder().decode(bytes.subarray(localOffset + 30, localOffset + 30 + localLength));
        assert.equal(localName, name, "local and central names must agree");
        central.push(name);
        local.push({ name: localName, offset: localOffset });
        offset += 46 + length + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    }
    return { central, local: local.sort((a, b) => a.offset - b.offset).map(entry => entry.name) };
}

test("imports and exports retain source order, directory entries and payloads without mutating input", async () => {
    const files = {
        "Bundle/": new Uint8Array(),
        "Bundle/first.mesh": new Uint8Array(200_000).fill(11),
        "Bundle/modinfo.ini": strToU8("name=Entry order regression\n"),
        "Bundle/second.tex": new Uint8Array(250_000).fill(22),
        "Bundle/colors.user.2": strToU8("small color payload"),
    };
    const archive = zipSync(files);
    const original = archive.slice();
    const expected = zipNames(archive);
    assert.deepEqual(expected.central, Object.keys(files));
    assert.deepEqual(expected.local, expected.central);
    const ordered = await readCompressedZip(archive);
    assert.deepEqual(Object.keys(ordered), expected.central);
    assert.deepEqual(archive, original);
    for (const path of expected.central) assert.deepEqual(ordered[path], files[path]);

    ordered["Bundle/colors.user.2"] = strToU8("edited color payload");
    ordered["Bundle/new-backup.txt"] = strToU8("new files append after existing entries");
    const exported = await createCompressedZip(ordered);
    const outputOrder = zipNames(exported);
    assert.deepEqual(outputOrder.central, [...expected.central, "Bundle/new-backup.txt"]);
    assert.deepEqual(outputOrder.local, outputOrder.central);
    assert.deepEqual(unzipSync(exported), ordered);
});

test("duplicate exact paths are rejected instead of selecting an ambiguous payload", async () => {
    // Equal-length names let this valid two-entry archive represent a duplicate
    // without changing any header offsets or compressed payloads.
    const archive = zipSync({ "same-a.bin": strToU8("first"), "same-b.bin": strToU8("second") });
    const second = strToU8("same-b.bin");
    const first = strToU8("same-a.bin");
    for (let index = 0; index <= archive.length - second.length; index++) {
        if (second.every((byte, position) => archive[index + position] === byte)) {
            archive.set(first, index);
        }
    }
    assert.deepEqual(zipNames(archive).central, ["same-a.bin", "same-a.bin"]);
    await assert.rejects(readCompressedZip(archive), /duplicate path: same-a\.bin/);
});

test("empty archives resolve and malformed archives reject", async () => {
    assert.deepEqual(await readCompressedZip(zipSync({})), {});
    await assert.rejects(readCompressedZip(strToU8("not a ZIP")));
});
