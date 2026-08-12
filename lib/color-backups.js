export const COLOR_BACKUP_SCHEMA = "sf6-color-sync-backups";
export const COLOR_BACKUP_VERSION = 1;

export function isColorBackupPath(path) {
    return String(path || "").replace(/\\/g, "/").toLowerCase().split("/").includes("backup_colors");
}

export function safeArchiveRelativePath(path) {
    const normalized = String(path || "").replace(/\\/g, "/").replace(/^\.\//, "");
    if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) return null;
    return normalized;
}

export function colorBackupManifestPath(modRoot) {
    return `${modRoot}backup_colors/colorsync-backups.json`;
}

export function emptyColorBackupManifest() {
    return { schema: COLOR_BACKUP_SCHEMA, version: COLOR_BACKUP_VERSION, snapshots: [], customMaterials: [] };
}

function validCustomMaterials(value) {
    if (!Array.isArray(value)) return [];
    const names = new Set();
    return value.slice(0, 1_000).flatMap(material => {
        const name = typeof material?.name === "string" ? material.name.trim() : "";
        const templateName = typeof material?.templateName === "string" ? material.templateName.trim() : "";
        const indexes = Array.isArray(material?.customizeColorIndexes)
            ? [...new Set(material.customizeColorIndexes.filter(index => (
                Number.isInteger(index) && index >= 0 && index <= 1_024
            )))].sort((a, b) => a - b)
            : [];
        const paletteSlots = {};
        if (material?.paletteSlots && typeof material.paletteSlots === "object") {
            for (const [palette, slots] of Object.entries(material.paletteSlots)) {
                if (!/^\d{1,3}$/.test(palette) || !Array.isArray(slots) || slots.length < 1 || slots.length > 1_024) continue;
                const normalized = slots.map(slot => ({
                    rgba: Array.isArray(slot?.rgba) && slot.rgba.length === 4
                        ? slot.rgba.map(Number)
                        : null,
                    enabled: Boolean(slot?.enabled),
                }));
                if (normalized.some(slot => (
                    !slot.rgba || slot.rgba.some(channel => !Number.isInteger(channel) || channel < 0 || channel > 255)
                ))) continue;
                paletteSlots[palette] = normalized;
            }
        }
        if (!name || !templateName || !indexes.length || name.includes("\0") || templateName.includes("\0") || names.has(name)) {
            return [];
        }
        names.add(name);
        return [{
            name,
            templateName,
            customizeColorIndexes: indexes,
            ...(typeof material.sourceCostumeFolder === "string" && /^\d{3}$/.test(material.sourceCostumeFolder)
                ? { sourceCostumeFolder: material.sourceCostumeFolder }
                : {}),
            ...(Object.keys(paletteSlots).length ? { paletteSlots } : {}),
        }];
    });
}

export function readColorBackupManifest(entries, modRoot) {
    const path = colorBackupManifestPath(modRoot);
    const bytes = entries[path];
    if (!bytes) return emptyColorBackupManifest();
    try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes));
        if (parsed?.schema !== COLOR_BACKUP_SCHEMA || parsed?.version !== COLOR_BACKUP_VERSION || !Array.isArray(parsed.snapshots)) {
            return emptyColorBackupManifest();
        }
        const snapshotRoot = `${modRoot}backup_colors/snapshots/`.toLowerCase();
        const snapshots = parsed.snapshots.filter(snapshot => {
            if (!snapshot || typeof snapshot.id !== "string" || !snapshot.id || !["original", "history"].includes(snapshot.kind) || !Array.isArray(snapshot.files)) return false;
            snapshot.files = snapshot.files.filter(file =>
                safeArchiveRelativePath(file?.livePath)
                && !isColorBackupPath(file.livePath)
                && safeArchiveRelativePath(file?.backupPath)
                && String(file.backupPath).toLowerCase().startsWith(snapshotRoot)
                && entries[file.backupPath],
            );
            if (
                snapshot.changelogPath
                && (
                    !safeArchiveRelativePath(snapshot.changelogPath)
                    || !String(snapshot.changelogPath).toLowerCase().startsWith(snapshotRoot)
                )
            ) snapshot.changelogPath = null;
            return snapshot.files.length > 0;
        });
        return {
            schema: COLOR_BACKUP_SCHEMA,
            version: COLOR_BACKUP_VERSION,
            snapshots,
            customMaterials: validCustomMaterials(parsed.customMaterials),
        };
    } catch {
        return emptyColorBackupManifest();
    }
}

export function colorBackupDateLabel(snapshot, locales) {
    if (snapshot.kind === "original") return "Original colors";
    const date = new Date(snapshot.createdAt);
    if (Number.isNaN(date.getTime())) return "Earlier color snapshot";
    return `Before export: ${new Intl.DateTimeFormat(locales, { dateStyle: "medium", timeStyle: "short" }).format(date)}`;
}

export function uniqueBackupSnapshotId(manifest, date = new Date()) {
    const stamp = date.toISOString().replace("T", "_").replace(/:/g, "-").replace(/\.\d{3}Z$/, "");
    const ids = new Set(manifest.snapshots.map(snapshot => snapshot.id));
    let candidate = stamp;
    let index = 2;
    while (ids.has(candidate)) candidate = `${stamp}-${index++}`;
    return candidate;
}

export function writeColorBackupSnapshots({
    files,
    modRoot = "",
    manifest = emptyColorBackupManifest(),
    originalSources = [],
    historySources = [],
    customMaterials = manifest.customMaterials || [],
    changelogBytes = null,
    createdAt = new Date().toISOString(),
}) {
    const next = JSON.parse(JSON.stringify(manifest));
    next.customMaterials = validCustomMaterials(customMaterials);
    const snapshotRoot = `${modRoot}backup_colors/snapshots/`;

    if (!next.snapshots.some(snapshot => snapshot.kind === "original") && originalSources.length) {
        const original = { id: "original", kind: "original", createdAt, files: [] };
        for (const source of originalSources) {
            const relativePath = source.path.startsWith(modRoot) ? source.path.slice(modRoot.length) : source.path;
            const backupPath = `${snapshotRoot}original/${relativePath}`;
            files[backupPath] = new Uint8Array(source.buffer);
            original.files.push({ livePath: source.path, backupPath });
        }
        next.snapshots.push(original);
    }

    if (historySources.length) {
        const snapshotId = uniqueBackupSnapshotId(next, new Date(createdAt));
        const historyRoot = `${snapshotRoot}${snapshotId}/`;
        const history = { id: snapshotId, kind: "history", createdAt, files: [] };
        for (const source of historySources) {
            const relativePath = source.path.startsWith(modRoot) ? source.path.slice(modRoot.length) : source.path;
            const backupPath = `${historyRoot}${relativePath}`;
            files[backupPath] = new Uint8Array(source.buffer);
            history.files.push({ livePath: source.path, backupPath });
        }
        if (changelogBytes) {
            history.changelogPath = `${historyRoot}changes.txt`;
            files[history.changelogPath] = new Uint8Array(changelogBytes);
        }
        next.snapshots.push(history);
    }

    files[colorBackupManifestPath(modRoot)] = new TextEncoder().encode(`${JSON.stringify(next, null, 2)}\n`);
    return next;
}
