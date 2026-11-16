import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "../../lib/fflate.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
// Release layout (matches the Nexus package): mod metadata and the autorun script only.
// No reframework/data folder is shipped; json.dump_file creates it when the export is saved.
const [script, modinfo] = await Promise.all([
    readFile(path.join(directory, "SF6 Color Sync.lua")),
    readFile(path.join(directory, "modinfo.ini")),
]);
const version = modinfo.toString("utf8").match(/^version=([\d.]+)\s*$/m)?.[1];
assert.ok(version, "modinfo.ini must declare a numeric version");

const entries = {
    "modinfo.ini": modinfo,
    "reframework/autorun/SF6 Color Sync.lua": script,
};
const archive = zipSync(entries, { level: 9 });
const unpacked = unzipSync(archive);
assert.deepEqual(Object.keys(unpacked).sort(), Object.keys(entries).sort());
for (const [name, bytes] of Object.entries(entries)) {
    assert.ok(Buffer.from(unpacked[name]).equals(Buffer.from(bytes)), `ZIP changed ${name}`);
}

const output = path.join(directory, `SF6-Color-Sync-REFramework-v${version}.zip`);
await writeFile(output, archive);
console.log(`Built and verified ${output} (${archive.byteLength} bytes)`);
console.log(Object.keys(unpacked).join("\n"));
