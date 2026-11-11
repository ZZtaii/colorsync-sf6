// Which model files a costume really loads, read from its character scene file
// (natives/stm/product/charparam/esf/esfNNN/esfNNNvXX.scn.20, where vXX is costume XX + 1).
//
// The scene lists each costume part as a mesh path followed by its material file path. Mods that
// swap a model in under other file names ("sakope_001_01.mesh" as Ryu's costume 2 body) ship an
// edited scene, so the folder layout alone no longer says which meshes belong to the costume.
// Only the resource path strings are read here; the scene's object graph is not parsed.

const SCN_PATH = /(?:^|\/)natives\/stm\/product\/charparam\/esf\/(esf\d{3})\/\1v(\d{2})\.scn\.\d+$/;
const norm = path => String(path).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();

/** Character and costume folder a scene file belongs to, or null for any other path. */
export function scnCostume(path) {
    const match = norm(path).match(SCN_PATH);
    return match ? { character: match[1], costume: String(Number(match[2]) + 1).padStart(3, '0') } : null;
}

/** Game path of the scene file of a costume (without the version suffix), or null. */
export function scnPathFor(character, costume) {
    const number = Number(costume);
    if (!/^esf\d{3}$/i.test(character ?? '') || !/^\d{3}$/.test(costume ?? '') || number < 1) return null;
    const fighter = character.toLowerCase();
    return `natives/stm/product/charparam/esf/${fighter}/${fighter}v${String(number - 1).padStart(2, '0')}.scn`;
}

/** Every printable UTF-16LE string of at least `min` characters, in file order. */
function utf16Strings(bytes, min = 12) {
    const found = [];
    let text = '';
    for (let offset = 0; offset + 1 < bytes.length; offset += 2) {
        const code = bytes[offset] | (bytes[offset + 1] << 8);
        if (code >= 0x20 && code < 0x7f) { text += String.fromCharCode(code); continue; }
        if (text.length >= min) found.push(text);
        text = '';
    }
    if (text.length >= min) found.push(text);
    return found;
}

/**
 * Costume parts named by a scene file, in file order and without repeats:
 * [{ mesh, mdf, folder }] with lower-case game paths below natives/stm/ ("product/model/...mesh")
 * and the two-digit part folder ("00" head, "01" body, "02" hair, others extra). `mdf` is null
 * when no material file follows the mesh. Returns [] for anything that is not a scene file.
 */
export function readScnParts(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.length < 8 || bytes[0] !== 0x53 || bytes[1] !== 0x43 || bytes[2] !== 0x4e || bytes[3] !== 0) return [];
    const parts = [];
    let open = null;
    for (const raw of utf16Strings(bytes)) {
        const path = norm(raw.replace(/^@/, ''));
        if (!/^product\/model\/.+\.(mesh|mdf2)$/.test(path)) continue;
        if (path.endsWith('.mesh')) {
            open = parts.find(part => part.mesh === path) ? null : { mesh: path, mdf: null, folder: path.match(/\/(\d{2})\/[^/]+$/)?.[1] ?? '' };
            if (open) parts.push(open);
        } else if (open && !open.mdf) open.mdf = path;
    }
    return parts;
}

/**
 * The scene file for a costume among loaded files ({ path: bytes }), parsed: { path, parts } or
 * null. Several mod folders may ship one; the first in path order with any parts is used.
 */
export function findCostumeScn(entries, target) {
    if (!target) return null;
    for (const path of Object.keys(entries ?? {}).sort()) {
        const costume = scnCostume(path);
        if (!costume || costume.character !== String(target.character).toLowerCase() || costume.costume !== String(target.costume).toLowerCase()) continue;
        const parts = readScnParts(entries[path]);
        if (parts.length) return { path, parts };
    }
    return null;
}
