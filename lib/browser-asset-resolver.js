import { parseMdfMaterialNames } from './mdf-materials.js';
import { parseReTex, decodeReTex } from './re-tex-parser.js';
import { constantTextureFor } from './sf6-constant-textures.js';

const normalized = p => String(p).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
const isMdf = p => /\.mdf2\.\d+$/i.test(p);
const isTex = p => /\.tex\.\d+$/i.test(p);

/**
 * Finds the one MDF that belongs to a mesh: same folder and stem first, then a unique native-path match.
 * `hint` is the material file the costume's scene names for this mesh ("product/model/...mdf2");
 * it wins when present, preferring the copy in the mesh's own mod folder.
 */
export function findMeshMdf(entries, meshPath, hint = null) {
    const stem = normalized(meshPath).replace(/\.mesh\.\d+$/, '');
    const keys = Object.keys(entries ?? {}).filter(isMdf);
    if (hint) {
        const wanted = 'natives/stm/' + normalized(hint).replace(/^natives\/stm\//, '').replace(/\.mdf2(?:\.\d+)?$/, '');
        const named = keys.filter(p => { const path = normalized(p).replace(/\.mdf2\.\d+$/, ''); return path === wanted || path.endsWith('/' + wanted); }).sort();
        const cut = stem.indexOf('natives/'), local = cut < 0 ? [] : named.filter(p => normalized(p).startsWith(stem.slice(0, cut) + 'natives/'));
        if (local.length === 1) return local[0];
        if (named.length) return named[0];
    }
    const matches = keys.filter(p => [stem, stem + '_v00'].includes(normalized(p).replace(/\.mdf2\.\d+$/, '')));
    if (matches.length) return matches.length === 1 ? matches[0] : null;
    const elsewhere = wanted => {
        const native = wanted.indexOf('natives/');
        if (native < 0) return [];
        const suffix = wanted.slice(native);
        return keys.filter(p => {
            const path = normalized(p).replace(/\.mdf2\.\d+$/, '');
            return [suffix, suffix + '_v00'].some(s => path === s || path.endsWith('/' + s));
        });
    };
    const fallback = elsewhere(stem);
    if (fallback.length) return fallback.length === 1 ? fallback[0] : null;
    // A variant left beside the real file ("No Cape esf009_001_01.mesh") has no material file of its
    // own name. It uses the one of its costume part folder: next to it first, then from another root.
    const part = stem.match(/^(.*\/(esf\d+)\/([^/]+)\/(\d{2}))\/[^/]+$/);
    if (!part) return null;
    const canonical = `${part[1]}/${part[2]}_${part[3]}_${part[4]}`;
    if (canonical === stem) return null;
    const beside = keys.filter(p => [canonical, canonical + '_v00'].includes(normalized(p).replace(/\.mdf2\.\d+$/, '')));
    if (beside.length) return beside.length === 1 ? beside[0] : null;
    const shared = elsewhere(canonical);
    return shared.length === 1 ? shared[0] : null;
}

/** Finds a texture by its MDF reference. A copy inside the mesh's own mod root wins over other roots. */
export function findTextureEntry(entries, reference, meshPath = '') {
    let target = normalized(reference).replace(/\.tex(?:\.\d+)?$/, '');
    if (!target.startsWith('natives/')) target = 'natives/stm/' + target;
    const all = Object.keys(entries ?? {}).filter(isTex).filter(p => {
        const path = normalized(p).replace(/\.tex\.\d+$/, '');
        return path === target || path.endsWith('/' + target);
    });
    const mesh = normalized(meshPath), cut = mesh.indexOf('natives/');
    if (cut >= 0) {
        const prefix = mesh.slice(0, cut);
        const local = all.filter(p => normalized(p).startsWith(prefix + 'natives/'));
        if (local.length === 1) return local[0];
        if (local.length > 1) return null;
    }
    return all.length === 1 ? all[0] : null;
}

/** Largest mip that fits the preview budget. Falls back to the smallest mip the file has. */
export function pickPreviewMip(mips, limit = 512) {
    const index = mips.findIndex(m => m.width <= limit && m.height <= limit);
    return index < 0 ? mips.length - 1 : index;
}

export function createBrowserAssetResolver(entries, meshPath, { textureLimit = 512, mdfFor = null } = {}) {
    const mdfPath = findMeshMdf(entries, meshPath, mdfFor?.(meshPath) ?? null), cache = new Map();
    const bytes = mdfPath ? entries[mdfPath] : null;
    const mdfMaterials = bytes
        ? parseMdfMaterialNames(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), mdfPath, { lenient: true })
        : [];
    return {
        meshPath, mdfPath, mdfMaterials,
        sourceMdfBytes: () => bytes,
        async resolveTexture(descriptor) {
            const path = findTextureEntry(entries, descriptor.path, meshPath);
            if (!path) return constantTextureFor(descriptor.path);
            if (cache.has(path)) return cache.get(path);
            const parsed = parseReTex(entries[path]);
            const mipLevel = pickPreviewMip(parsed.mips, textureLimit);
            const texture = decodeReTex(parsed, { mipLevel });
            texture.previewMipLevel = mipLevel;
            texture.srgb = parsed.srgb;
            texture.sourceFormat = parsed.format;
            cache.set(path, texture);
            return texture;
        },
    };
}

export async function readPreviewAssetsZip(buffer) {
    const { unzip } = await import('./fflate.js');
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length > 200 * 1024 * 1024) throw new Error('Supporting ZIP exceeds 200 MiB.');
    return new Promise((resolve, reject) => {
        let total = 0, invalid = null;
        const names = new Set();
        unzip(bytes, {
            filter(file) {
                const path = normalized(file.name);
                if (!/\.(?:tex|mdf2|mesh)\.\d+$/.test(path)) return false;
                if (path.split('/').includes('..') || names.has(path)) { invalid = 'Ambiguous or unsafe supporting asset path.'; return false; }
                names.add(path);
                total += file.originalSize;
                if (!Number.isFinite(total) || total > 256 * 1024 * 1024) { invalid = 'Supporting assets exceed 256 MiB unpacked.'; return false; }
                return true;
            },
        }, (error, files) => { if (error || invalid) reject(error ?? new Error(invalid)); else resolve(files); });
    });
}

export function previewMaterialSignature(material) {
    return JSON.stringify({
        name: material.name, mmtrPath: material.mmtrPath,
        textures: [...(material.textures ?? [])].map(t => [t.slot, t.path]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        parameters: [...(material.parameters ?? [])].map(p => [p.name, p.values]).sort((a, b) => a[0].localeCompare(b[0])),
        customizeColors: [...(material.customizeColors ?? [])].map(p => [p.index, p.linearRgba]).sort((a, b) => a[0] - b[0]),
    });
}

/**
 * Resolver for a scene made of several meshes (head, body, hair ...).
 *
 * Each mesh keeps its own MDF, so two meshes may both use a material name such as
 * esf_Hair00 with different contents. `materialFor(meshIndex, name)` answers from the
 * mesh's own MDF; `mdfMaterials` stays as the de-duplicated list for name-only callers.
 */
export function createBrowserSceneAssetResolver(entries, paths, options) {
    const resolvers = paths.map(path => createBrowserAssetResolver(entries, path, options));
    const textureOwners = new Map(), materialOwners = new Map(), materials = [];
    for (const resolver of resolvers) for (const material of resolver.mdfMaterials) {
        materialOwners.set(material, resolver);
        for (const texture of material.textures ?? []) textureOwners.set(texture, resolver);
        const signature = previewMaterialSignature(material);
        if (!materials.some(m => m.name === material.name && previewMaterialSignature(m) === signature)) materials.push(material);
    }
    return {
        resolvers,
        mdfMaterials: materials,
        missingMdfPaths: resolvers.filter(r => !r.mdfPath).map(r => r.meshPath),
        materialFor(meshIndex, name) {
            const found = (resolvers[meshIndex]?.mdfMaterials ?? []).filter(m => m.name === name);
            return found.length === 1 ? found[0] : null;
        },
        sourceMdfBytes: material => materialOwners.get(material)?.sourceMdfBytes() ?? null,
        async resolveTexture(descriptor) {
            const owner = textureOwners.get(descriptor);
            if (owner) return owner.resolveTexture(descriptor);
            for (const resolver of resolvers) {
                const texture = await resolver.resolveTexture(descriptor);
                if (texture) return texture;
            }
            return null;
        },
    };
}

/** Joins meshes into one scene. `materialMeshIndex[i]` records which mesh a scene material came from. */
export function combinePreviewMeshes(meshes) {
    const parts = [], materialNames = [], materialMeshIndex = [];
    meshes.forEach((mesh, meshIndex) => {
        const offset = materialNames.length;
        materialNames.push(...mesh.materialNames);
        materialMeshIndex.push(...mesh.materialNames.map(() => meshIndex));
        parts.push(...mesh.parts.map(part => ({ ...part, materialIndex: part.materialIndex + offset })));
    });
    return { parts, materialNames, materialMeshIndex, warnings: [...new Set(meshes.flatMap(m => m.warnings ?? []))] };
}
