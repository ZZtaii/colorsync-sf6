// Turns the user's Street Fighter 6 install folder (picked once with the browser's folder picker)
// into file sources for the preview: every PAK in the folder and its dlc folders, plus the loose
// `natives` folder that Fluffy Mod Manager fills with installed mods. Read-only, nothing is uploaded.
const PAK_FOLDERS = ['dlc', 'pdlc'];
const MAX_LOOSE_BYTES = 256 * 1024 * 1024;
const isPak = name => /\.pak$/i.test(name);

async function childDirectory(directory, name) {
    try { return await directory.getDirectoryHandle(name); } catch { return null; }
}

/**
 * Loose files under the game's `natives` folder. The game loads these before its PAKs, so they are
 * given the highest priority here too. `read` resolves to null when the file does not exist.
 */
export function looseFolderSource(nativesDirectory) {
    return {
        name: 'natives folder',
        async read(path) {
            const parts = String(path).replace(/\\/g, '/').replace(/^\/+/, '').split('/');
            if (parts.shift()?.toLowerCase() !== 'natives' || !parts.length || parts.some(part => !part || part === '.' || part === '..')) return null;
            let directory = nativesDirectory;
            try {
                for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
                const file = await (await directory.getFileHandle(parts[parts.length - 1])).getFile();
                if (file.size > MAX_LOOSE_BYTES) throw new Error(`${file.name} in the natives folder is larger than the preview can load.`);
                return new Uint8Array(await file.arrayBuffer());
            } catch (error) {
                if (error?.name === 'NotFoundError' || error?.name === 'TypeMismatchError') return null;
                throw error;
            }
        },
    };
}

/**
 * Finds the PAK files and the loose natives folder inside a picked game folder.
 * Returns { pakFiles: File[], loose } with PAKs in load order: base, patches, then DLC.
 */
export async function sourcesFromDirectory(directory) {
    const main = [], extra = [];
    for await (const entry of directory.values()) if (entry.kind === 'file' && isPak(entry.name)) main.push(await entry.getFile());
    for (const name of PAK_FOLDERS) {
        const folder = await childDirectory(directory, name);
        if (!folder) continue;
        for await (const entry of folder.values()) if (entry.kind === 'file' && isPak(entry.name)) extra.push(await entry.getFile());
    }
    const byName = (a, b) => a.name.localeCompare(b.name);
    const pakFiles = [...main.sort(byName), ...extra.sort(byName)];
    if (!pakFiles.length) throw new Error('No .pak files were found in that folder. Choose the Street Fighter 6 install folder, the one that contains re_chunk_000.pak.');
    const natives = await childDirectory(directory, 'natives');
    return { pakFiles, loose: natives ? looseFolderSource(natives) : null };
}

// ---- remembering the folder between visits (browser only) ------------------------------------
const DB_NAME = 'colorsync-preview', STORE = 'handles', KEY = 'game-folder';
function store(mode) {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') { reject(new Error('No browser storage.')); return; }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result.transaction(STORE, mode).objectStore(STORE));
    });
}
const settle = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
export async function rememberGameFolder(directory) { try { await settle((await store('readwrite')).put(directory, KEY)); } catch { /* remembering is optional */ } }
export async function recallGameFolder() { try { return await settle((await store('readonly')).get(KEY)) ?? null; } catch { return null; } }
export async function forgetGameFolder() { try { await settle((await store('readwrite')).delete(KEY)); } catch { /* nothing stored */ } }
