// A few retail CMD palettes use temporary/internal material aliases instead of
// the names in their corresponding MDF files. Keep these corrections scoped to
// the exact CMD identity so unrelated mods that intentionally use the same
// short names are left alone.
const MATERIAL_NAME_OVERRIDES = new Map([
    ["esf021|004|standard|001", new Map([
        ["ClothA", "esf_ClothA_jaket01"],
        ["ClothA1", "esf_ClothA_jaket02"],
        ["ClothA_fur1", "esf_ClothA_fur"],
        ["ClothB1", "esf_ClothB_Pants00"],
        ["esf_Botan", "esf_ClothA_Botan"],
        ["esf_Sandal", "esf_ClothB_Sandal01"],
        ["esf_neckless", "esf_ClothA_Necklace"],
        ["esf_rope", "esf_ClothB_Rope"],
        ["esf_Sandal2", "esf_ClothA_Sandal02"],
        ["hair2", "esf_HairA_Head02"],
        ["hair3", "esf_HairA_Mesh"],
        ["hair4", "esf_HairA_Ponytail"],
        ["esf_hairband1", "esf_ClothA_hairband"],
        ["hair5", "esf_HairA_Head"],
        ["hair11", "esf_HairA_Front"],
    ])],
]);


function materialOverrideKey(metadata) {
    if (!metadata) return "";
    return [
        metadata.esfId,
        metadata.costumeFolder,
        metadata.variant,
        metadata.paletteFolder,
    ].join("|");
}


export function normalizeCmdMaterialNames(colorClusters, metadata) {
    const overrides = MATERIAL_NAME_OVERRIDES.get(materialOverrideKey(metadata));
    if (!overrides) return colorClusters;

    for (const cluster of colorClusters ?? []) {
        const canonicalName = overrides.get(cluster.name);
        if (!canonicalName) continue;
        cluster.cmdMaterialName = cluster.name;
        cluster.name = canonicalName;
    }
    return colorClusters;
}
