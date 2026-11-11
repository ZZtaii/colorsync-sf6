// Read-only bridge. Renderer values are linear; editable CMD bytes remain owned
// by the existing app mutation/export pipeline. No geometry or game assets here.
import { cmdRgbaToLinearFloatRgba } from './sf6-color-space.js';

const rgba = value => Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
    ? value.slice() : null;
const raw = slot => {
    const bytes = slot?.color ? rgba(['r', 'g', 'b', 'a'].map(key => slot.color[key])) : null;
    return bytes?.every(v => Number.isInteger(v) && v >= 0 && v <= 255) ? bytes : null;
};
const linear = value => value ? cmdRgbaToLinearFloatRgba(value) : null;
const id = parts => JSON.stringify(parts);

export function previewPaletteId(cmd) {
    const m = cmd?.metadata ?? {};
    return id([m.esfId ?? null, m.costumeFolder ?? null, m.variant ?? null,
        m.paletteFolder ?? m.paletteNumber ?? null, m.version ?? null, cmd?.file?.name ?? null]);
}

export function previewMaterialId(cmd, cluster) {
    return id([previewPaletteId(cmd), cluster.instanceId, cluster.name]);
}

function partTypes(cmd, cluster) {
    if (Array.isArray(cluster.materialPartTypes)) return [...new Set(cluster.materialPartTypes)];
    return [...new Set((cmd.instanceParse?.parsedInstances ?? []).filter(instance =>
        instance.typeName === 'app.CostumeMaterialData.MaterialData'
        && instance.fields?.Clusters?.values?.some(ref => ref.instanceId === cluster.instanceId))
        .map(instance => instance.fields?.Type?.value).filter(Number.isInteger))];
}

function originalBytes(cmd, slot) {
    const buffer = cmd.semanticBaselineBuffer ?? cmd.originalBuffer;
    const offset = slot.color?.absoluteOffset;
    if (!(buffer instanceof ArrayBuffer) || !Number.isInteger(offset) || offset < 0 || offset + 4 > buffer.byteLength) return null;
    return Array.from(new Uint8Array(buffer, offset, 4));
}

function baselineEnabled(cmd, slot) {
    const buffer = cmd.semanticBaselineBuffer ?? cmd.originalBuffer;
    const offset = slot.enable?.absoluteOffset;
    const length = slot.enable?.byteLength ?? 1;
    if (!(buffer instanceof ArrayBuffer) || !Number.isInteger(offset) || offset < 0 || offset + length > buffer.byteLength) return null;
    return Array.from(new Uint8Array(buffer, offset, length)).some(Boolean);
}

// Which color an inactive slot shows. General rule, from a survey of all 137 stock Color 1 files
// against the stock material files (15,857 inactive slots):
// - In 98 of those costumes the material file leaves CustomizeColor at neutral gray (0.5, "no
//   tint") over grayscale base textures, and the costume's real default colors exist only as the
//   colors stored on the inactive CMD slots (1,742 slots). Checked against official art for
//   Ingrid C1: neutral material, lavender/pink stored, lavender/pink in the art.
// - Some stock material files even hold pure red or pure blue test values where the CMD stores
//   the real color (194 slots where a non-neutral stock default differs from the stored color).
// So the stored color is used unless it is a placeholder: #808080 is "never set" and #BBBBBB is
// neutral 0.5 as an sRGB byte. A material file supplied by a mod is trusted over the stored
// color when it holds a real (non-neutral) default, because that is where this editor writes
// default edits; a neutral mod default still gives way like a stock one.
const NEUTRAL_LINEAR = 128 / 255;
const isNeutralDefault = values => values.slice(0, 3).every(v => Math.abs(v - NEUTRAL_LINEAR) < 0.012);
const isFlat = (bytes, level) => bytes.slice(0, 3).every(v => Math.abs(v - level) <= 1);
const isPlaceholderBytes = bytes => isFlat(bytes, 128) || isFlat(bytes, 187) || isFlat(bytes, 188);

/**
 * Stored CMD bytes that an inactive slot shows instead of its material default, or null when the
 * material default applies. `modMaterial`: the default comes from a material file in the mod.
 */
export function storedDefaultBytes(slot, { modMaterial = false } = {}) {
    const values = rgba(slot?.mdfFallbackLinearRgba), bytes = raw(slot);
    if (slot?.enabled !== false || !values || !bytes || isPlaceholderBytes(bytes)) return null;
    if (modMaterial && !isNeutralDefault(values)) return null;
    // Same color either way: keep the material file's exact floats.
    const stored = linear(bytes);
    if (stored.slice(0, 3).every((v, i) => Math.abs(v - values[i]) < 0.02)) return null;
    return bytes;
}

function fallback(slot, state) {
    const values = rgba(slot.mdfFallbackLinearRgba);
    if (!values) return { values: null, source: 'unresolved', baseline: null };
    const stored = storedDefaultBytes(slot, { modMaterial: !!state.materialDefaultBuffers?.get(slot.mdfFallbackPath) });
    if (stored) { const color = linear(stored); return { values: color, source: 'cmd-default', baseline: color.slice() }; }
    const path = slot.mdfFallbackPath;
    const record = state.materialDefaultBuffers?.get(path);
    if (!record) return { values, source: 'stock-mdf', baseline: values.slice() };
    const candidates = (record.originalMaterials ?? []).filter(m => m.name === slot.materialName);
    const original = candidates.length === 1 ? candidates[0].customizeColors?.find(c => c.index === slot.index) : null;
    return { values, source: 'mod-mdf', baseline: rgba(original?.linearRgba) };
}

export function buildMaterialPreviewState(state, { revision = 0 } = {}) {
    const cmd = state.cmdEntries?.[state.activeCmdIndex ?? 0];
    const snapshot = { schema: 'colorsync.material-preview', version: 1, game: 'sf6',
        resourceVersion: null, revision, palette: null, materials: [], diagnostics: [
            'Material values only. Geometry, texture masks and native REasy rendering are not loaded.',
        ] };
    if (!cmd) return snapshot;
    const m = cmd.metadata ?? {};
    snapshot.palette = { id: previewPaletteId(cmd), character: m.esfId ?? null,
        costume: m.costumeFolder ?? null, variant: m.variant ?? null, paletteNumber: m.paletteNumber ?? null };
    const duplicateIds = new Set();
    for (const cluster of cmd.colorClusters ?? []) {
        const materialId = previewMaterialId(cmd, cluster);
        if (duplicateIds.has(materialId)) throw new Error('Ambiguous preview material identity.');
        duplicateIds.add(materialId);
        const material = { id: materialId, name: cluster.name, clusterInstanceId: cluster.instanceId,
            partTypes: partTypes(cmd, cluster), parameters: [], scalarParameters: [] };
        const seenSlots = new Set();
        for (const slot of cluster.colors ?? []) {
            if (!Number.isInteger(slot.index) || slot.index < 0 || seenSlots.has(slot.index)) {
                snapshot.diagnostics.push(`Skipped ambiguous slot in ${cluster.name}.`);
                continue;
            }
            seenSlots.add(slot.index);
            const instances=cmd.instanceParse?.parsedInstances??[];
            const option=Number.isInteger(slot.optionInstanceId)?instances.find(i=>i.index===slot.optionInstanceId):null;
            const rateRef=option?.fields?.BlendRate;
            const rate=rateRef?.kind==='object'?instances.find(i=>i.index===rateRef.instanceId):null;
            if(rate?.fields?.Enable?.kind==='bool'&&rate.fields.Enable.value===true){
                const value=rate.fields._Value?.value;
                if(typeof value==='number'&&Number.isFinite(value))material.scalarParameters.push({name:`CustomizeColor_${slot.index}_BlendRate`,values:[value],enabled:true,source:'cmd'});
                else snapshot.diagnostics.push(`${cluster.name} / CustomizeColor_${slot.index}_BlendRate: active CMD rate is invalid.`);
            }

            const defaults = fallback(slot, state);
            const enabled = slot.enabled === true;
            const bytes = raw(slot);
            let values = enabled ? linear(bytes) : slot.enabled === false ? defaults.values : null;
            let source = enabled && values ? 'cmd' : slot.enabled === false ? defaults.source : 'unresolved';
            const wasEnabled = baselineEnabled(cmd, slot);
            const baselineValues = wasEnabled === true ? linear(originalBytes(cmd, slot))
                : wasEnabled === false ? defaults.baseline : null;
            const editable = !slot.error && !!slot.color && Number.isInteger(slot.color.absoluteOffset)
                && !slot.materialEditBlockedReason;
            const targets = (slot.materialDefaultTargets ?? []).map(t => ({ sourcePath: t.sourcePath, materialIndex: t.materialIndex,
                values: rgba(t.customizeColors?.find(c => c.index === slot.index)?.linearRgba) }));
            if (!enabled && targets.length > 1 && targets.some(t => JSON.stringify(t.values) !== JSON.stringify(targets[0].values))) {
                values = null; source = 'unresolved';
                snapshot.diagnostics.push(`${cluster.name} / CustomizeColor_${slot.index}: component defaults differ; resolve a component before rendering.`);
            }
            if (!enabled && slot.materialEditBlockedReason) { values = null; source = 'unresolved'; }
            material.parameters.push({ id: id([materialId, slot.index]), name: `CustomizeColor_${slot.index}`,
                slotIndex: slot.index, values, baselineValues, source, enabled, editable,
                blockedReason: editable ? null : slot.materialEditBlockedReason || slot.error || 'No writable CMD slot.',
                cmdRgba: bytes, targets, defaultSourcePath: slot.mdfFallbackPath ?? null });
            if (!values) snapshot.diagnostics.push(`${cluster.name} / CustomizeColor_${slot.index}: effective color is unknown.`);
        }
        snapshot.materials.push(material);
    }
    return snapshot;
}

// Explicit commands must carry a fresh revision. Never match by name alone.
export function resolvePreviewCommand(snapshot, command) {
    if (command?.revision !== snapshot.revision) throw new Error('Preview state changed; refresh before editing.');
    const material = snapshot.materials.find(m => m.id === command.materialId);
    const parameter = material?.parameters.find(p => p.id === command.parameterId);
    if (!parameter) throw new Error('Unknown preview material or slot.');
    if (command.type === 'select') return { material, parameter };
    if (command.type !== 'edit') throw new Error('Unsupported preview command.');
    if (!parameter.editable) throw new Error(parameter.blockedReason);
    const bytes = rgba(command.cmdRgba);
    if (!bytes || bytes.some(c => !Number.isInteger(c) || c < 0 || c > 255)) throw new Error('Edits require four CMD RGBA bytes.');
    return { material, parameter, cmdRgba: bytes };
}
