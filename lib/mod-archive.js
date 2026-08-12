function normalizedArchivePath(path) {
    return String(path || "").replace(/\\/g, "/");
}

export function archiveEntryDirectory(path) {
    const normalized = normalizedArchivePath(path);
    const slash = normalized.lastIndexOf("/");
    return slash >= 0 ? normalized.slice(0, slash + 1) : "";
}

export function nearestArchiveRoot(path, roots) {
    const normalizedPath = normalizedArchivePath(path).toLowerCase();
    return [...roots]
        .filter(root => normalizedPath.startsWith(normalizedArchivePath(root).toLowerCase()))
        .sort((a, b) => normalizedArchivePath(b).length - normalizedArchivePath(a).length)[0]
        ?? null;
}

/** Selects the modinfo.ini that owns the most supplied files. Nested modinfo
 * roots beat enclosing bundle roots for each file. */
export function findOwningModinfoPath(filePaths, modinfoPaths) {
    const candidates = modinfoPaths.map((path, index) => ({
        path,
        index,
        root: archiveEntryDirectory(path),
        ownedFiles: 0,
    }));
    if (!filePaths.length || !candidates.length) return null;

    for (const filePath of filePaths) {
        const root = nearestArchiveRoot(filePath, candidates.map(candidate => candidate.root));
        const owner = candidates.find(candidate => candidate.root === root);
        if (owner) owner.ownedFiles += 1;
    }

    return candidates
        .filter(candidate => candidate.ownedFiles > 0)
        .sort((a, b) => (
            b.ownedFiles - a.ownedFiles
            || b.root.length - a.root.length
            || a.index - b.index
        ))[0]?.path ?? null;
}

/** Returns one editable target per nearest modinfo root and character/costume.
 * Roots without standard CMD files are intentionally omitted. */
export function discoverEditableCmdTargets(paths, modinfoPaths, parseFilename) {
    const roots = modinfoPaths.map(archiveEntryDirectory);
    const grouped = new Map();
    for (const path of paths) {
        const filename = normalizedArchivePath(path).split("/").pop();
        const metadata = parseFilename(filename);
        if (!metadata || metadata.variant !== "standard") continue;
        const root = nearestArchiveRoot(path, roots);
        if (modinfoPaths.length && root === null) continue;
        const key = `${root ?? ""}|${metadata.esfId}|${metadata.costumeFolder}`;
        const target = grouped.get(key) || {
            root: root ?? "",
            modinfoPath: modinfoPaths.find(candidate => archiveEntryDirectory(candidate) === root) ?? null,
            esfId: metadata.esfId,
            costumeFolder: metadata.costumeFolder,
            cmdPaths: [],
        };
        target.cmdPaths.push(path);
        grouped.set(key, target);
    }
    return [...grouped.values()].sort((left, right) => (
        left.esfId.localeCompare(right.esfId)
        || left.costumeFolder.localeCompare(right.costumeFolder)
        || left.root.localeCompare(right.root)
    ));
}

export function withOnlyColorsSuffix(value) {
    const trimmed = String(value || "").trim();
    return /\(only colors\)$/i.test(trimmed) ? trimmed : `${trimmed} (only colors)`;
}

export function colorsOnlyZipFilename(filename) {
    const withoutExtension = String(filename || "SF6 Colors").replace(/\.zip$/i, "");
    return `${withOnlyColorsSuffix(withoutExtension)}.zip`;
}
