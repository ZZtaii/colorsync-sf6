const DEFAULT_MDF_REGISTRY_VERSION = 1;
const registryPromises = new Map();


function normalizeEsfId(esfId) {
    const value = String(esfId || "").toLowerCase();
    return /^esf\d{3}$/.test(value) ? value : "";
}


function normalizeCostumeFolder(costumeFolder) {
    const value = String(costumeFolder || "");
    return /^\d{3}$/.test(value) ? value : "";
}


function inflateCustomizeColors(rawColors) {
    if (!Array.isArray(rawColors)) return [];
    return rawColors.flatMap(raw => {
        if (
            !Array.isArray(raw)
            || !Number.isInteger(raw[0])
            || !Array.isArray(raw[1])
            || !Array.isArray(raw[2])
        ) return [];
        return [{
            index: raw[0],
            linearRgba: raw[1].slice(),
            cmdRgba: raw[2].slice(),
        }];
    });
}


export function defaultMdfMaterialsFromRegistry(registry, costumeFolder) {
    if (
        !registry
        || registry.version !== DEFAULT_MDF_REGISTRY_VERSION
        || !registry.costumes
    ) return [];

    const costume = normalizeCostumeFolder(costumeFolder);
    if (!costume) return [];
    const sourceFolders = costume === "000" ? ["000"] : [costume, "000"];
    const materialMap = new Map();

    for (const sourceFolder of sourceFolders) {
        for (const file of registry.costumes[sourceFolder] || []) {
            if (!file?.p || !Array.isArray(file.m)) continue;
            for (const rawMaterial of file.m) {
                if (!rawMaterial?.n) continue;
                const customizeColors = inflateCustomizeColors(rawMaterial.c);
                if (!customizeColors.length) continue;
                const current = materialMap.get(rawMaterial.n) || {
                    name: rawMaterial.n,
                    customizeColorIndexes: new Set(),
                    paths: [],
                    defaultVariants: [],
                    source: "default",
                };
                customizeColors.forEach(color => current.customizeColorIndexes.add(color.index));
                current.paths.push(file.p);
                const defaultVariant = {
                    path: file.p,
                    materialIndex: Number.isInteger(rawMaterial.i) ? rawMaterial.i : 0,
                    customizeColors,
                };
                const signature = JSON.stringify(customizeColors.map(color => [color.index, color.cmdRgba]));
                if (!current.defaultVariants.some(variant => variant.signature === signature)) {
                    current.defaultVariants.push({ ...defaultVariant, signature });
                }
                materialMap.set(rawMaterial.n, current);
            }
        }
    }

    return [...materialMap.values()]
        .map(material => ({
            ...material,
            customizeColorIndexes: [...material.customizeColorIndexes].sort((a, b) => a - b),
            defaultVariants: material.defaultVariants.map(({ signature, ...variant }) => variant),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
}


export function mergeMdfColorMaterials(primaryMaterials, defaultMaterials) {
    const merged = new Map((defaultMaterials || []).map(material => [material.name, material]));
    for (const material of primaryMaterials || []) {
        merged.set(material.name, material);
    }
    return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
}


async function fetchDefaultMdfRegistry(esfId) {
    const normalized = normalizeEsfId(esfId);
    if (!normalized) return null;
    if (!registryPromises.has(normalized)) {
        const url = new URL(`../data/mdf-defaults/${normalized}.min.json`, import.meta.url);
        registryPromises.set(normalized, fetch(url).then(async response => {
            if (response.status === 404) return null;
            if (!response.ok) {
                throw new Error(`Default MDF registry request failed (${response.status}).`);
            }
            const registry = await response.json();
            if (registry?.version !== DEFAULT_MDF_REGISTRY_VERSION) {
                throw new Error(`Unsupported default MDF registry version for ${normalized}.`);
            }
            return registry;
        }).catch(error => {
            registryPromises.delete(normalized);
            throw error;
        }));
    }
    return registryPromises.get(normalized);
}


export async function loadDefaultMdfColorMaterials({ esfId, costumeFolder } = {}) {
    const registry = await fetchDefaultMdfRegistry(esfId);
    return defaultMdfMaterialsFromRegistry(registry, costumeFolder);
}
