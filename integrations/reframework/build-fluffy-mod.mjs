import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, unzipSync, zipSync } from "../../lib/fflate.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const [script, modinfo, readme] = await Promise.all([
    readFile(path.join(directory, "SF6 Color Sync.lua")),
    readFile(path.join(directory, "modinfo.ini")),
    readFile(path.join(directory, "README.md")),
]);
const version = modinfo.toString("utf8").match(/^version=([\d.]+)\s*$/m)?.[1];
assert.ok(version, "modinfo.ini must declare a numeric version");

const installGuide = [
    "SF6 Color Sync - Freecam Exporter",
    "",
    "FLUFFY MOD MANAGER INSTALLATION",
    "Download: https://www.nexusmods.com/streetfighter6/mods/3837?tab=files",
    "EMV Engine + Lua Freecam setup: https://www.youtube.com/watch?v=fKdNqtsoxu0&t=2s",
    "Once EMV Engine and Lua Freecam are ready:",
    "1. Put this ZIP in your Fluffy Mod Manager Games/SF6/Mods folder.",
    "2. Refresh the mod list and enable SF6 Color Sync - Freecam Exporter.",
    "3. Start SF6 with REFramework and EMV Engine SILVER installed.",
    "4. Under REFramework's Script Generated UI, open SF6 Color Sync.",
    "",
    "Open the character's Materials editor in EMV before making live edits.",
    "After editing, refresh characters, select the character, and Copy for Color Sync.",
    "Paste into Color Sync's Import Freecam Colors panel, preview, apply, then export.",
    "",
    "The full guide is included below. This package contains the companion exporter.",
    "REFramework and EMV Engine SILVER must already be installed.",
    "",
    readme.toString("utf8"),
].join("\r\n");

const entries = {
    "modinfo.ini": modinfo,
    "reframework/autorun/SF6 Color Sync.lua": script,
    "reframework/data/SF6ColorSync/README.txt": strToU8(installGuide),
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
