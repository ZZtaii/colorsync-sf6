const DB_NAME = "sf6-color-sync-export-folders-v1";
const STORE_NAME = "folders";
const handles = { cmd: null, zip: null };

function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function storedHandle(kind) {
    if (handles[kind]) return handles[kind];
    if (!("indexedDB" in window)) return null;
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(kind);
        request.onsuccess = () => {
            handles[kind] = request.result ?? null;
            resolve(handles[kind]);
        };
        request.onerror = () => reject(request.error);
    });
}

async function saveHandle(kind, handle) {
    handles[kind] = handle;
    const db = await openDb();
    await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(handle, kind);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

function download(bytes, filename, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function uniqueName(directory, filename) {
    const dot = filename.lastIndexOf(".");
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : "";
    for (let index = 0; ; index += 1) {
        const candidate = index === 0 ? filename : `${stem} (${index})${ext}`;
        try {
            await directory.getFileHandle(candidate);
        } catch (error) {
            if (error.name === "NotFoundError") return candidate;
            throw error;
        }
    }
}

export function isStaleFileSystemHandleError(error) {
    if (!error) return false;
    if (["InvalidStateError", "NotReadableError", "TypeMismatchError"].includes(error.name)) return true;
    return /state cached in an interface object|state (?:has )?changed since it was read from disk/i
        .test(error.message || String(error));
}

async function writeExportBytes(directory, filename, bytes) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        let writable = null;
        try {
            // Reacquire the target on every attempt. Edge can invalidate a file
            // handle when folder permission or the file's disk state changes.
            const file = await directory.getFileHandle(filename, { create: true });
            writable = await file.createWritable();
            await writable.write(bytes);
            await writable.close();
            return;
        } catch (error) {
            if (writable) {
                try {
                    await writable.abort();
                } catch {
                    // A failed/closed stream has nothing left to abort.
                }
            }
            if (attempt === 0 && isStaleFileSystemHandleError(error)) continue;
            throw error;
        }
    }
}

export async function chooseExportFolder(kind) {
    if (!window.showDirectoryPicker) {
        throw new Error("This browser cannot save directly to a folder. Use a current Chromium browser.");
    }
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await saveHandle(kind, handle);
    return handle;
}

export async function clearExportFolder(kind) {
    handles[kind] = null;
    if (!("indexedDB" in window)) return;
    const db = await openDb();
    await new Promise((resolve, reject) => {
        const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(kind);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

export async function exportFolderName(kind) {
    return (await storedHandle(kind))?.name ?? "";
}

export async function saveExportFile(
    kind,
    bytes,
    filename,
    { replaceExisting = false, type = "application/octet-stream" } = {},
) {
    const directory = await storedHandle(kind);
    if (!directory) {
        download(bytes, filename, type);
        return { mode: "download", filename, originalFilename: filename };
    }

    try {
        const permission = await directory.queryPermission({ mode: "readwrite" });
        const granted = permission === "granted"
            || await directory.requestPermission({ mode: "readwrite" }) === "granted";
        if (!granted) {
            download(bytes, filename, type);
            return { mode: "download", filename, originalFilename: filename };
        }

        let targetName = filename;
        let replaced = false;
        try {
            await directory.getFileHandle(filename);
            if (replaceExisting) {
                if (!window.confirm(`Replace "${filename}" in ${directory.name}?`)) {
                    return { mode: "cancelled", filename, originalFilename: filename };
                }
                replaced = true;
            } else {
                targetName = await uniqueName(directory, filename);
            }
        } catch (error) {
            if (error.name !== "NotFoundError") throw error;
        }

        let replaceFailed = false;
        try {
            await writeExportBytes(directory, targetName, bytes);
        } catch (error) {
            if (!replaced || !isStaleFileSystemHandleError(error)) throw error;

            // The directory is usable, but Edge/Windows rejected this existing
            // target even after reacquiring it. This commonly happens when a
            // mod manager still has the ZIP open. Preserve direct-folder save
            // by writing a new sibling instead of discarding folder access.
            targetName = await uniqueName(directory, filename);
            await writeExportBytes(directory, targetName, bytes);
            replaced = false;
            replaceFailed = true;
        }
        return {
            mode: "folder",
            filename: targetName,
            originalFilename: filename,
            folderName: directory.name,
            renamed: targetName !== filename,
            replaced,
            replaceFailed,
        };
    } catch (error) {
        if (!isStaleFileSystemHandleError(error)) throw error;

        // Chromium persists directory handles across sessions, but Windows may
        // invalidate one when Explorer or a mod manager replaces/moves the
        // directory or target archive. Do not lose a completed export because
        // the optional direct-save destination became stale.
        try {
            await clearExportFolder(kind);
        } catch (clearError) {
            console.warn("Could not forget stale export folder handle.", clearError);
        }
        download(bytes, filename, type);
        return {
            mode: "download",
            filename,
            originalFilename: filename,
            folderReset: true,
        };
    }
}
