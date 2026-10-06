import test from "node:test";
import assert from "node:assert/strict";
import {
    COLOR_BACKUP_VERSION,
    colorBackupManifestPath,
    emptyColorBackupManifest,
    isColorBackupPath,
    readColorBackupManifest,
    writeColorBackupSnapshots,
} from "../lib/color-backups.js";

const root = "01 Main files - Synthetic Mod/";
const nativeRoot = `${root}natives/STM/Product/Model/esf/esf999/001/`;
const cmdPath = `${nativeRoot}esf999_001_cmd_001.user.2`;
const mdfPath = `${nativeRoot}esf999_001.mdf2.40`;
const createdAt = "2026-01-01T12:00:00.000Z";
const bytes = (...values) => new Uint8Array(values);

function snapshotBytes(entries, snapshot, livePath) {
    const file = snapshot.files.find(candidate => candidate.livePath === livePath);
    assert.ok(file, `Snapshot should include ${livePath}`);
    return entries[file.backupPath];
}

test("CMD and MDF original snapshots preserve complete bytes in the v1 manifest", () => {
    const files = {};
    const originalCmd = bytes(85, 83, 82, 0, 0, 20, 30, 40);
    const originalMdf = bytes(77, 68, 70, 0, 0, 0, 128, 63, 72, 91);
    writeColorBackupSnapshots({
        files, modRoot: root, createdAt,
        originalSources: [
            { path: cmdPath, buffer: originalCmd.buffer },
            { path: mdfPath, buffer: originalMdf.buffer },
        ],
    });

    const manifest = readColorBackupManifest(files, root);
    assert.equal(manifest.version, COLOR_BACKUP_VERSION);
    assert.equal(manifest.version, 1);
    assert.equal(manifest.snapshots.length, 1);
    const original = manifest.snapshots[0];
    assert.deepEqual(snapshotBytes(files, original, cmdPath), originalCmd);
    assert.deepEqual(snapshotBytes(files, original, mdfPath), originalMdf);

    // A restore copies whole buffers, including the inactive CMD Enable byte.
    const restoredCmd = snapshotBytes(files, original, cmdPath).slice();
    const restoredMdf = snapshotBytes(files, original, mdfPath).slice();
    assert.equal(restoredCmd[4], 0);
    assert.deepEqual(restoredMdf, originalMdf);
    originalCmd.fill(255);
    originalMdf.fill(255);
    assert.deepEqual(snapshotBytes(files, original, cmdPath), restoredCmd);
    assert.deepEqual(snapshotBytes(files, original, mdfPath), restoredMdf);
});

test("an existing CMD-only original snapshot gains MDF without replacing its CMD baseline", () => {
    const files = {};
    const firstCmd = bytes(1, 2, 0, 4);
    const firstManifest = writeColorBackupSnapshots({
        files, modRoot: root, createdAt,
        originalSources: [{ path: cmdPath, buffer: firstCmd }],
    });
    const originalCmdBackup = firstManifest.snapshots[0].files[0].backupPath;
    const originalCmdBytes = files[originalCmdBackup];
    const sourceManifest = JSON.stringify(firstManifest);
    const originalMdf = bytes(10, 11, 12, 13, 14);

    const next = writeColorBackupSnapshots({
        files, modRoot: root, manifest: firstManifest,
        createdAt: "2026-01-02T12:00:00.000Z",
        originalSources: [
            { path: cmdPath.toUpperCase().replaceAll("/", "\\"), buffer: bytes(91, 92, 93, 94) },
            { path: mdfPath, buffer: originalMdf },
        ],
    });

    assert.equal(JSON.stringify(firstManifest), sourceManifest, "The imported manifest is immutable");
    assert.equal(next.snapshots.length, 1);
    assert.equal(next.snapshots[0].createdAt, createdAt);
    assert.equal(next.snapshots[0].files.length, 2);
    assert.equal(files[originalCmdBackup], originalCmdBytes);
    assert.deepEqual(files[originalCmdBackup], firstCmd);
    assert.deepEqual(snapshotBytes(files, next.snapshots[0], mdfPath), originalMdf);
    assert.deepEqual(readColorBackupManifest(files, root), next);
});

test("pre-export history carries both CMD and MDF baseline bytes", () => {
    const files = { [cmdPath]: bytes(11, 12, 0, 14), [mdfPath]: bytes(31, 32, 33, 34) };
    const beforeCmd = bytes(1, 2, 0, 4);
    const beforeMdf = bytes(21, 22, 23, 24);
    const changelogBytes = new TextEncoder().encode("Updated synthetic material default\n");
    const written = writeColorBackupSnapshots({
        files, modRoot: root, createdAt,
        originalSources: [{ path: cmdPath, buffer: beforeCmd }, { path: mdfPath, buffer: beforeMdf }],
        historySources: [{ path: cmdPath, buffer: beforeCmd }, { path: mdfPath, buffer: beforeMdf }],
        changelogBytes,
    });

    const reimported = readColorBackupManifest(files, root);
    assert.deepEqual(reimported, written);
    const history = reimported.snapshots.find(snapshot => snapshot.kind === "history");
    assert.ok(history);
    assert.deepEqual(snapshotBytes(files, history, cmdPath), beforeCmd);
    assert.deepEqual(snapshotBytes(files, history, mdfPath), beforeMdf);
    assert.deepEqual(files[history.changelogPath], changelogBytes);
    assert.deepEqual(files[cmdPath], bytes(11, 12, 0, 14));
    assert.deepEqual(files[mdfPath], bytes(31, 32, 33, 34));
});

test("later MDF exports retain the first original and distinct pre-export histories", () => {
    const files = {};
    const firstMdf = bytes(1, 2, 3, 4);
    let manifest = writeColorBackupSnapshots({
        files, modRoot: root, createdAt,
        originalSources: [{ path: mdfPath, buffer: firstMdf }],
        historySources: [{ path: mdfPath, buffer: firstMdf }],
    });
    const secondMdf = bytes(5, 6, 7, 8);
    manifest = writeColorBackupSnapshots({
        files, modRoot: root, createdAt, manifest,
        originalSources: [{ path: mdfPath, buffer: secondMdf }],
        historySources: [{ path: mdfPath, buffer: secondMdf }],
    });

    assert.equal(manifest.snapshots.length, 3);
    assert.equal(new Set(manifest.snapshots.map(snapshot => snapshot.id)).size, 3);
    assert.deepEqual(snapshotBytes(files, manifest.snapshots[0], mdfPath), firstMdf);
    assert.deepEqual(snapshotBytes(files, manifest.snapshots[1], mdfPath), firstMdf);
    assert.deepEqual(snapshotBytes(files, manifest.snapshots[2], mdfPath), secondMdf);
    secondMdf.fill(255);
    assert.deepEqual(snapshotBytes(files, manifest.snapshots[2], mdfPath), bytes(5, 6, 7, 8));
});

test("snapshots include explicitly supplied dependent MDFs and exclude backup files", () => {
    const sibling = "02 Variants - Synthetic Mod/";
    const siblingMdf = `${sibling}natives/esf999_001.mdf2.40`;
    const backupMdf = `${root}backup_colors/snapshots/older/esf999_001.mdf2.40`;
    const files = { [siblingMdf]: bytes(8, 9), [backupMdf]: bytes(6, 7) };
    const originalSiblingBytes = files[siblingMdf];
    const unsafeSources = [
        { path: backupMdf, buffer: bytes(0, 0) },
        { path: `${root}../escape.mdf2.40`, buffer: bytes(0, 0) },
    ];
    const manifest = writeColorBackupSnapshots({
        files, modRoot: root, createdAt,
        originalSources: [
            { path: mdfPath, buffer: bytes(1, 2) },
            { path: siblingMdf, buffer: originalSiblingBytes },
            ...unsafeSources,
        ],
        historySources: unsafeSources,
    });

    assert.equal(manifest.snapshots.length, 1);
    assert.deepEqual(manifest.snapshots[0].files.map(file => file.livePath), [mdfPath, siblingMdf]);
    assert.equal(files[siblingMdf], originalSiblingBytes);
    assert.deepEqual(files[siblingMdf], bytes(8, 9));
    assert.deepEqual(snapshotBytes(files, manifest.snapshots[0], siblingMdf), bytes(8, 9));
    assert.ok(manifest.snapshots[0].files[1].backupPath.startsWith(`${root}backup_colors/snapshots/original/${sibling}`));
    assert.ok(manifest.snapshots[0].files.every(file => isColorBackupPath(file.backupPath)));
});

test("re-import accepts dependent MDF paths while filtering unsafe live paths", () => {
    const files = {};
    const manifest = writeColorBackupSnapshots({
        files, modRoot: root, createdAt,
        originalSources: [{ path: mdfPath, buffer: bytes(1, 2, 3) }],
    });
    const backupPath = manifest.snapshots[0].files[0].backupPath;
    manifest.snapshots[0].files.push(
        { livePath: "02 Variants - Synthetic Mod/natives/other.mdf2.40", backupPath },
        { livePath: `${root}backup_colors/live.mdf2.40`, backupPath },
        { livePath: `${root}../other.mdf2.40`, backupPath },
    );
    files[colorBackupManifestPath(root)] = new TextEncoder().encode(JSON.stringify(manifest));

    const restoredManifest = readColorBackupManifest(files, root);
    assert.deepEqual(restoredManifest.snapshots[0].files.map(file => file.livePath), [
        mdfPath,
        "02 Variants - Synthetic Mod/natives/other.mdf2.40",
    ]);
});

test("CMD-only backups keep the existing version and snapshot shape", () => {
    const files = {};
    const original = bytes(1, 0, 3, 4);
    const manifest = writeColorBackupSnapshots({
        files, createdAt,
        originalSources: [{ path: "natives/esf999_001_cmd_001.user.2", buffer: original }],
    });
    assert.deepEqual(manifest, {
        ...emptyColorBackupManifest(),
        snapshots: [{
            id: "original", kind: "original", createdAt,
            files: [{
                livePath: "natives/esf999_001_cmd_001.user.2",
                backupPath: "backup_colors/snapshots/original/natives/esf999_001_cmd_001.user.2",
            }],
        }],
    });
    assert.deepEqual(readColorBackupManifest(files, ""), manifest);
});
