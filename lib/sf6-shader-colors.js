// Runtime names and the corresponding typed CMD Hair fields. Capcom's CMD
// schema preserves spelling differences; never match by physical field order.
export const CMD_HAIR_COLORS = Object.freeze([
    { parameter: "OcclusionColor", field: "OcclutionColor", aliases: ["OcclutionColor"] },
    { parameter: "PrimalySpecularColor", field: "PrimalySpecularColor", aliases: ["PrimarySpecularColor"] },
    { parameter: "SecondarySpecularColor", field: "SecondarySpecularColor", aliases: [] },
    { parameter: "RimLight_Color", field: "RimLight_Color", aliases: ["Rimlight_Color"] },
]);

export function normalizeCmdColorParameter(parameter) {
    if (typeof parameter !== "string") return null;
    const custom = /^CustomizeColor_(\d+)$/.exec(parameter);
    if (custom && Number.isSafeInteger(Number(custom[1]))) {
        const index = Number(custom[1]);
        return { parameter: `CustomizeColor_${index}`, index, kind: "customize" };
    }
    const hair = CMD_HAIR_COLORS.find(color => color.parameter === parameter || color.aliases.includes(parameter));
    return hair ? { parameter: hair.parameter, index: null, kind: "hair" } : null;
}

export function cmdColorSlots(cluster) {
    return [...(cluster?.colors ?? []), ...(cluster?.shaderColors ?? [])];
}
