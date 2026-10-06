// Only indexed CustomizeColor slots are editable and transferable. Generic
// CMD schemas also contain shader fields that a material may never use.
export function normalizeCmdColorParameter(parameter) {
    if (typeof parameter !== "string") return null;
    const custom = /^CustomizeColor_(\d+)$/.exec(parameter);
    if (custom && Number.isSafeInteger(Number(custom[1]))) {
        const index = Number(custom[1]);
        return { parameter: `CustomizeColor_${index}`, index, kind: "customize" };
    }
    return null;
}

export function cmdColorSlots(cluster) {
    return cluster?.colors ?? [];
}
