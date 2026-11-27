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

/**
 * The same sources from a folder chosen with <input type="file" webkitdirectory>. Chrome and Edge refuse
 * their folder picker for anything under Program Files ("contains system files"), which is where Steam
 * installs games by default; this older picker still reads such a folder, and works in Firefox too.
 * Each File carries its path below the chosen folder in `webkitRelativePath`. The visitor may also pick
 * a folder above the game, so the game folder is wherever the shallowest re_chunk_000.pak sits.
 */
export function sourcesFromFileList(fileList) {
    const files = [...fileList].map(file => ({ file, path: String(file.webkitRelativePath || file.name).replace(/\\/g, '/') }));
    const bases = files.filter(({ path }) => /(^|\/)re_chunk_000\.pak$/i.test(path)).sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    if (!bases.length) throw new Error('No re_chunk_000.pak was found in that folder. Choose the Street Fighter 6 install folder, the one that contains re_chunk_000.pak.');
    const prefix = bases[0].path.slice(0, bases[0].path.length - 're_chunk_000.pak'.length).toLowerCase();
    const main = [], extra = [], natives = new Map();
    for (const { file, path } of files) {
        if (!path.toLowerCase().startsWith(prefix)) continue;
        const inside = path.slice(prefix.length), lower = inside.toLowerCase();
        if (!inside.includes('/') && isPak(inside)) main.push(file);
        else if (PAK_FOLDERS.some(folder => lower.startsWith(`${folder}/`)) && lower.split('/').length === 2 && isPak(inside)) extra.push(file);
        else if (lower.startsWith('natives/')) natives.set(lower, file);
    }
    const byName = (a, b) => a.name.localeCompare(b.name);
    return { pakFiles: [...main.sort(byName), ...extra.sort(byName)], loose: natives.size ? looseFileListSource(natives) : null };
}

/**
 * PAK files the visitor picked one by one (re_chunk_000.pak, optionally its patch PAKs and the DLC PAKs)
 * with a plain file picker. This skips the browser listing every file in the game folder first, which in
 * Firefox's folder upload takes minutes for a modded install, and works for Program Files too.
 * Returns the PAKs in load order: base, patches, then DLC. Loose natives files are not read this way.
 */
export function sourcesFromPickedPaks(fileList) {
    const files = [...fileList].filter(file => isPak(file.name));
    if (!files.some(file => /^re_chunk_000\.pak$/i.test(file.name))) throw new Error('That is not the main game file. Choose re_chunk_000.pak from your Street Fighter 6 folder.');
    return { pakFiles: inLoadOrder(files), loose: null };
}

/** Files or file handles (anything with a name) sorted like the game loads them: base, patches, then DLC. */
export function inLoadOrder(items) {
    const rank = item => /^re_chunk_000\.pak$/i.test(item.name) ? 0 : /^re_chunk_000\.pak\.patch_/i.test(item.name) ? 1 : 2;
    return [...items].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Loose natives files from a folder-upload list: lower-cased path below the game folder -> File. */
function looseFileListSource(natives) {
    return {
        name: 'natives folder',
        async read(path) {
            const file = natives.get(String(path).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase());
            if (!file) return null;
            if (file.size > MAX_LOOSE_BYTES) throw new Error(`${file.name} in the natives folder is larger than the preview can load.`);
            return new Uint8Array(await file.arrayBuffer());
        },
    };
}

/**
 * Name, size and change time of each PAK. Mod managers rewrite re_chunk_000.pak and add or empty
 * re_chunk_000.pak.patch_NNN.pak files, and the browser refuses to read a File taken before such a
 * change (NotReadableError). A different fingerprint means the PAKs must be opened again.
 */
export function pakFingerprint(files) {
    return JSON.stringify(files.map(file => [file.name, file.size, file.lastModified ?? 0]));
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

// ---- remembering the picked PAK files between visits (Chromium browsers) ---------------------
// Chromium's file picker gives file handles that can be stored, so the next visit needs at most one
// "Allow" click. The file itself is never copied (re_chunk_000.pak is tens of GB). Every tool on the
// site shares the one stored pick. Firefox has no such picker and uses the plain file input instead.
const PAK_KEY = 'game-paks';
const READ = { mode: 'read' };
export const canRememberPaks = () => typeof globalThis.showOpenFilePicker === 'function';

/**
 * Chromium's file picker for the game's PAKs. Resolves the handles in load order, or null when the
 * visitor cancelled. Chromium also ends here without a pick when it refuses a file (games under
 * Program Files are on its blocklist), so callers offer the plain file input after a null.
 */
export async function pickPakHandles() {
    try {
        const handles = await globalThis.showOpenFilePicker({ id: 'sf6-game-pak', multiple: true, types: [{ description: 'Street Fighter 6 game files', accept: { 'application/octet-stream': ['.pak'] } }] });
        return inLoadOrder(handles);
    } catch (error) {
        if (error?.name === 'AbortError') return null;
        throw error;
    }
}
export async function rememberPakHandles(handles) { try { await settle((await store('readwrite')).put([...handles], PAK_KEY)); } catch { /* remembering is optional */ } }
export async function recallPakHandles() {
    try { const handles = await settle((await store('readonly')).get(PAK_KEY)); return Array.isArray(handles) && handles.length ? handles : null; } catch { return null; }
}
export async function forgetPakHandles() { try { await settle((await store('readwrite')).delete(PAK_KEY)); } catch { /* nothing stored */ } }
/** 'granted', 'prompt' or 'denied' for all handles. With ask, asks the visitor (needs a click). */
export async function pakPermission(handles, ask = false) {
    for (const handle of handles) {
        let permission = await handle.queryPermission(READ);
        if (permission === 'prompt' && ask) permission = await handle.requestPermission(READ);
        if (permission !== 'granted') return permission;
    }
    return 'granted';
}
/** Fresh File objects from the handles: they always show the file as it is on disk now. */
export const filesFromHandles = handles => Promise.all(handles.map(handle => handle.getFile()));
