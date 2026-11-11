// Explicit material/slot bindings only. Never infer a mask or whole-surface slot.
export function resolveBrowserPreviewMaterials(mesh, snapshot, bindings = {}) {
    const count = Math.max(mesh.materialNames?.length ?? 0, ...mesh.parts.map(p => p.materialIndex + 1));
    return Array.from({length:count}, (_,index) => {
        const binding = bindings[index];
        const material = snapshot?.materials?.find(m => m.id === binding?.materialId);
        const parameter = material?.parameters.find(p => p.id === binding?.parameterId);
        const color = parameter?.values;
        const valid = Array.isArray(color) && color.length === 4 && color.every(Number.isFinite);
        return {color:valid ? [...color] : [.45,.45,.45,1],roughness:.65,metalness:0,
            materialId:valid ? material.id : null, parameterId:valid ? parameter.id : null,
            diagnostic:valid ? 'Explicit whole-surface slot color; no game mask applied.' : 'Unbound geometry shown in neutral gray.'};
    });
}
