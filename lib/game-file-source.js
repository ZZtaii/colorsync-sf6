// Collects the files the 3D preview needs for one costume from the user's own game PAK(s):
// the stock mesh and material file of every costume part, and the few textures the preview reads.
// Files the imported mod already provides are left alone, so a mod always wins over the game.
import { parseMdfMaterialNames } from './mdf-materials.js';
import { constantTextureFor } from './sf6-constant-textures.js';
import { findCostumeScn, readScnParts, scnPathFor } from './scn-costume-parts.js';

const MESH_VERSIONS = ['230110883', '240306278'];
const MDF_VERSIONS = ['31', '40'];
const TEX_VERSIONS = ['241101895', '143230113'];
const SCN_VERSIONS = ['20'];
// Texture slots the preview reads. Normal, roughness and detail maps are never fetched.
export const PREVIEW_TEXTURE_SLOTS = new Set(['BaseDielectricMap', 'BaseMetalMap', 'BaseAnisoShiftMap', 'BaseAlphaMap', 'BaseMap',
    'CustomizeColor_Mask', 'CustomizeColor_Mask2', 'AlphaTranslucentOcclusionSSSMap']);
const MAX_PART = 20;
// Head and hair may live in another costume folder (see gatherCostumeFiles).
const SHARED_PARTS = ['00', '02'];
const MAX_FALLBACK_COSTUME = 9;

const norm = p => String(p).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
const nativeKey = p => { const path = norm(p), cut = path.indexOf('natives/'); return cut < 0 ? path : path.slice(cut); };
const stripVersion = p => p.replace(/\.(mesh|mdf2|tex)\.\d+$/, '.$1');

/** Costume identity (esfNNN, costume folder) from any SF6 costume file path, or null. */
export function costumeFromPath(path) {
    const match = norm(path).match(/natives\/stm\/product\/model\/esf\/(esf\d+)\/([^/]+)\//);
    return match ? { character: match[1], costume: match[2] } : null;
}

/**
 * @param paks       file sources with `read(path) -> bytes | null`: opened PAKs (re-pak-reader.js) and
 *                   optionally the loose natives folder (game-folder.js). Later ones take priority.
 * @param have       files already loaded, e.g. the imported mod: { path: Uint8Array }.
 * @param onProgress optional (done, label) callback.
 * @returns { entries, parts, textures, missing, errors, scene } where `scene` is null or
 *          { source: 'mod' | 'game', path, parts } when the costume's scene file named its parts.
 */
export async function gatherCostumeFiles({ paks, character, costume, have = {}, onProgress = null }) {
    if (!Array.isArray(paks) || !paks.length) throw new Error('Choose at least one game PAK file.');
    if (!/^esf\d+$/i.test(character ?? '') || !/^[a-z0-9_]+$/i.test(costume ?? '')) throw new Error('A character and costume are required, for example esf001 and 001.');
    const order = [...paks].reverse();
    const entries = {}, parts = [], missing = [], errors = [];
    let textures = 0, done = 0;
    const haveKeys = new Map(Object.keys(have).map(key => [stripVersion(nativeKey(key)), key]));
    const known = base => haveKeys.has(base) || Object.keys(entries).some(key => stripVersion(key) === base);

    /** Reads the first existing `<base>.<version>` from the highest-priority PAK. */
    async function fetchFile(base, versions) {
        for (const version of versions) {
            const path = `${base}.${version}`;
            for (const source of order) {
                try {
                    const bytes = await source.read(path);
                    if (bytes == null) continue;
                    onProgress?.(++done, path.split('/').pop());
                    return { path, bytes };
                } catch (error) { errors.push({ path, message: error.message, code: error.code ?? null }); return null; }
            }
        }
        return null;
    }

    const own = costume.toLowerCase(), fighter = character.toLowerCase();
    const materialFiles = [];
    /** Adds one costume part (mesh plus material file) from the mod or the game. False when neither has it. */
    async function gatherPart(fromCostume, folder) {
        const root = `natives/stm/product/model/esf/${fighter}/${fromCostume}`, stem = `${fighter}_${fromCostume}`;
        const meshBase = `${root}/${folder}/${stem}_${folder}.mesh`;
        const borrowedFrom = fromCostume === own ? null : fromCostume;
        const modMesh = haveKeys.get(meshBase);
        if (modMesh) {
            // The mod ships this part. Its own material file drives the textures (if it has one).
            const modMdf = haveKeys.get(`${root}/${folder}/${stem}_${folder}_v00.mdf2`) ?? haveKeys.get(`${root}/${folder}/${stem}_${folder}.mdf2`);
            if (modMdf) materialFiles.push({ path: modMdf, bytes: have[modMdf] });
            parts.push({ folder, source: 'mod', mesh: modMesh, mdf: modMdf ?? null, borrowedFrom });
            if (modMdf) return true;
        }
        const mesh = modMesh ? null : await fetchFile(meshBase, MESH_VERSIONS);
        if (!modMesh && !mesh) return false;
        const mdf = await fetchFile(`${root}/${folder}/${stem}_${folder}_v00.mdf2`, MDF_VERSIONS) ?? await fetchFile(`${root}/${folder}/${stem}_${folder}.mdf2`, MDF_VERSIONS);
        if (mesh) { entries[mesh.path] = mesh.bytes; parts.push({ folder, source: 'game', mesh: mesh.path, mdf: mdf?.path ?? null, borrowedFrom }); }
        if (mdf) { entries[mdf.path] = mdf.bytes; materialFiles.push(mdf); }
        return true;
    }
    // The costume's scene file says exactly which meshes and material files it loads: the mod's
    // own scene when it ships one (model swaps under other file names), otherwise the game's.
    // Folder probing below is only the fallback for costumes without a readable scene.
    let scene = null;
    const modScene = findCostumeScn(have, { character: fighter, costume: own });
    if (modScene) scene = { source: 'mod', path: modScene.path, parts: modScene.parts };
    else {
        const scenePath = scnPathFor(fighter, own), file = scenePath ? await fetchFile(scenePath, SCN_VERSIONS) : null;
        const sceneParts = file ? readScnParts(file.bytes) : [];
        if (sceneParts.length) scene = { source: 'game', path: file.path, parts: sceneParts };
    }
    const haveAll = base => Object.keys(have).filter(key => stripVersion(nativeKey(key)) === base).sort();
    if (scene) {
        for (const part of scene.parts) {
            const meshBase = `natives/stm/${part.mesh}`, mdfBase = part.mdf ? `natives/stm/${part.mdf}` : null;
            const from = part.mesh.match(/\/esf\d+\/([^/]+)\/\d{2}\/[^/]+$/)?.[1] ?? own;
            const borrowedFrom = from === own ? null : from;
            // Several mod folders may offer the same part (leg or hair variants): all stay available.
            const modMeshes = haveAll(meshBase), modMdfs = mdfBase ? haveAll(mdfBase) : [];
            for (const path of modMdfs) materialFiles.push({ path, bytes: have[path] });
            let mdfPath = modMdfs[0] ?? null;
            const mesh = modMeshes.length ? null : await fetchFile(meshBase, MESH_VERSIONS);
            if (!modMeshes.length && !mesh) continue;
            if (!mdfPath && mdfBase) {
                const mdf = await fetchFile(mdfBase, MDF_VERSIONS);
                if (mdf) { entries[mdf.path] = mdf.bytes; materialFiles.push(mdf); mdfPath = mdf.path; }
            }
            if (mesh) entries[mesh.path] = mesh.bytes;
            parts.push({ folder: part.folder, source: modMeshes.length ? 'mod' : 'game', mesh: modMeshes[0] ?? mesh.path, mdf: mdfPath, borrowedFrom });
        }
        // A scene none of whose parts could be read tells nothing: fall back to the folders.
        if (!parts.length) scene = null;
    }
    const found = new Set();
    for (let part = 0; !scene && part <= MAX_PART; part++) {
        const folder = String(part).padStart(2, '0');
        if (await gatherPart(own, folder)) found.add(folder);
    }
    // Many costumes have no head or hair of their own: the game then uses the shared "000" folder.
    // When that has none either, the lowest-numbered costume that has one stands in (a guess, and
    // reported as such). The body is never borrowed; another costume's body is a different outfit.
    for (const folder of scene ? [] : SHARED_PARTS) {
        if (found.has(folder)) continue;
        for (const other of ['000', ...Array.from({ length: MAX_FALLBACK_COSTUME }, (_, i) => String(i + 1).padStart(3, '0'))]) {
            if (other === own) continue;
            if (await gatherPart(other, folder)) break;
        }
    }

    const wanted = new Set();
    for (const { path, bytes } of materialFiles) {
        try {
            const materials = parseMdfMaterialNames(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), path, { lenient: true });
            for (const material of materials) for (const texture of material.textures ?? []) {
                if (!texture.path || !PREVIEW_TEXTURE_SLOTS.has(texture.slot) || constantTextureFor(texture.path)) continue;
                const ref = norm(texture.path).replace(/\.tex(?:\.\d+)?$/, '');
                wanted.add((ref.startsWith('natives/') ? ref : `natives/stm/${ref}`) + '.tex');
            }
        } catch (error) { errors.push({ path, message: error.message, code: null }); }
    }
    for (const base of [...wanted].sort()) {
        if (known(base)) continue;
        const texture = await fetchFile(base, TEX_VERSIONS);
        if (texture) { entries[texture.path] = texture.bytes; textures++; }
        else if (!errors.some(e => stripVersion(e.path) === base)) missing.push(base);
    }
    return { entries, parts, textures, missing, errors, scene };
}
