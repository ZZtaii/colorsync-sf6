// Turns parsed SF6 MDF materials into preview materials: base texture, CustomizeColor mask
// layers driven by the live ColorSync state, and alpha cutouts.
//
// Community reconstruction from the material data layout. It is not the game's shader, and
// lighting, detail maps and special effects are not reproduced.
//
// Colour masks are applied to every master material that carries the standard layout
// (CustomizeColor_Mask[/2] textures, CustomizeColor_BlendSwitch, per-slot colour and blend rate).
// A survey of all 480 fighter MDFs (tools/survey-mdf-families.mjs) found that layout identical
// across ~100 masked families. Families whose maths was checked against the original shaders are
// marked "verified"; the rest are "inferred" from the shared layout.
const MASKS = [['CustomizeColor_Mask', 0], ['CustomizeColor_Mask2', 4]];
const VERIFIED_FAMILIES = new Set([
    'character_cloth_detail_nomusclesa_weight8.mmtrs',
    'character_cloth2_detail_customize4_weight8.mmtrs',
    'esf032_clothaniso2_detail_customize4_weight8.mmtrs',
    'character_cloth_nomusclesa_customize4_weight8.mmtrs',
    'character_body_detail_customize4_weight8.mmtrs',
]);
// Base colour slots in priority order. Hair keeps its colour in BaseAnisoShiftMap.
const ALBEDO_SLOTS = ['BaseDielectricMap', 'BaseMetalMap', 'BaseAnisoShiftMap', 'BaseAlphaMap', 'BaseMap'];
const OPACITY_SLOT = 'AlphaTranslucentOcclusionSSSMap';
const FLAG_ALPHA_TEST = 2;
const HIDDEN_FAMILY = /eyetear|electricxray|fakeaodecal/;

const rgba = v => Array.isArray(v) && v.length === 4 && v.every(Number.isFinite) ? v.slice() : null;
const scalar = v => Array.isArray(v) && v.length === 1 && Number.isFinite(v[0]) ? v[0] : null;
const basename = p => String(p ?? '').replace(/\\/g, '/').split('/').pop().toLowerCase();
const params = material => Array.isArray(material?.parameters) ? material.parameters : [];
// Highest value of each channel of a decoded RGBA mask, remembered on the texture. A channel that
// is zero everywhere paints nothing, so the color slot it belongs to is unused by this material:
// ports often give every material one slot (a red-only mask) and leave the others at zero.
const UNUSED_MASK_LEVEL = 4;
function maskChannelPeaks(texture) {
    if (texture.channelPeaks) return texture.channelPeaks;
    const peaks = [0, 0, 0, 0], data = texture.data;
    if (!data?.length) return (texture.channelPeaks = [255, 255, 255, 255]);
    for (let i = 0; i < data.length; i += 4) for (let c = 0; c < 4; c++) if (data[i + c] > peaks[c]) peaks[c] = data[i + c];
    return (texture.channelPeaks = peaks);
}
function unique(items, name) { const found = items.filter(p => p.name === name); return found.length === 1 ? found[0] : null; }

// Shared, testable tint maths with linear colour inputs throughout.
// `weights` are the already sampled, unencoded mask channels in layer order.
export function evaluateSf6Tint(base, layers, weights, mode = 'sf6-tint-mix') {
    if (!rgba(base) || !Array.isArray(layers) || layers.length !== weights.length) throw new Error('Invalid tint evaluation input.');
    if (!['sf6-tint-mix', 'sf6-tint-multiply'].includes(mode)) throw new Error('Unsupported SF6 tint mode.');
    const tint = [1, 1, 1];
    layers.forEach((layer, i) => {
        if (!rgba(layer.color) || !Number.isFinite(layer.blendRate) || !Number.isFinite(weights[i])) throw new Error('Invalid SF6 tint layer.');
        const w = Math.max(0, Math.min(1, weights[i] * layer.blendRate));
        for (let c = 0; c < 3; c++) {
            const target = 2 * layer.color[c];
            tint[c] = mode === 'sf6-tint-multiply' ? tint[c] * (1 - w + w * target) : tint[c] * (1 - w) + target * w;
        }
    });
    return [base[0] * tint[0], base[1] * tint[1], base[2] * tint[2], base[3]];
}

/** Picks the live ColorSync value for one slot, falling back to the loaded MDF default. */
function resolveSlot({ name, index, properties, mdf, bound, warn }) {
    const parameterName = `CustomizeColor_${index}`;
    const original = rgba(unique(properties, parameterName)?.values)
        ?? rgba((mdf.customizeColors ?? []).find(p => p.index === index)?.linearRgba);
    if (!original) return null;
    const overrides = params(bound).filter(p => p.name === parameterName);
    const override = overrides.length === 1 ? overrides[0] : null;
    let color = original, source = 'loaded-mdf';
    if (overrides.length > 1) warn(name, `ambiguous ${parameterName}; retaining MDF default.`);
    else if (override && rgba(override.values)) { color = rgba(override.values); source = override.source ?? 'snapshot'; }
    else if (override?.enabled === true) warn(name, `${parameterName} is enabled but unresolved; retaining MDF default.`);

    const rateName = `${parameterName}_BlendRate`;
    let rate = scalar(unique(properties, rateName)?.values);
    const activeRates = (bound?.scalarParameters ?? []).filter(p => p.name === rateName && p.enabled === true);
    if (activeRates.length === 1 && scalar(activeRates[0].values) !== null) rate = scalar(activeRates[0].values);
    else if (activeRates.length) warn(name, `ambiguous/invalid ${rateName}; using MDF value.`);
    return { parameterName, rateName, color, source, rate };
}

export async function buildSf6BrowserMaterials({ mesh, mdfMaterials = [], snapshot = null, bindings = {}, resolveTexture, resolveMdfMaterial = null }) {
    if (!mesh || !Array.isArray(mesh.materialNames) || !Array.isArray(mesh.parts)) throw new Error('Mesh material identities are required.');
    if (typeof resolveTexture !== 'function') throw new Error('An exact-path texture resolver is required.');
    const count = Math.max(mesh.materialNames.length, ...mesh.parts.map(p => p.materialIndex + 1));
    const materials = [], slotEffects = [], diagnostics = [], report = [];
    let entry = null;
    const warn = (name, message) => { diagnostics.push(`${name}: ${message}`); entry?.notes.push(message); };
    const load = async (name, descriptor, label) => {
        try {
            const texture = await resolveTexture(descriptor);
            if (!texture) warn(name, `missing ${label} ${descriptor.path}`);
            return texture ?? null;
        } catch (error) { warn(name, `${label} could not decode: ${error.message}`); return null; }
    };

    for (let index = 0; index < count; index++) {
        const name = mesh.materialNames[index] ?? `Material ${index}`;
        const result = { color: [.55, .55, .55, 1], roughness: .65, metalness: 0, maskLayers: [], albedoAlpha: false };
        entry = { materialIndex: index, name, status: 'unresolved', family: null, confidence: null, slots: [], notes: [] };
        materials.push(result); report.push(entry);

        // The mesh's own MDF wins; name-only lookup is the fallback and must be unique.
        let mdf = resolveMdfMaterial?.(index, name) ?? null;
        if (!mdf) {
            const matches = mdfMaterials.filter(m => m.name === name);
            if (matches.length !== 1) { warn(name, matches.length ? 'ambiguous MDF material name; not applied.' : 'no matching MDF; neutral gray.'); continue; }
            mdf = matches[0];
        }
        const properties = params(mdf), textures = mdf.textures ?? [];
        const family = basename(mdf.mmtrPath);
        entry.family = family;
        const slotOf = slot => textures.filter(t => t.slot === slot);
        const albedoSlot = ALBEDO_SLOTS.find(slot => slotOf(slot).length === 1) ?? null;

        if (HIDDEN_FAMILY.test(family) || (!albedoSlot && !ALBEDO_SLOTS.some(slot => slotOf(slot).length))) {
            result.skip = true; entry.status = 'hidden';
            warn(name, family.includes('eyetear')
                ? 'eye-tear/refraction layer omitted: no false opaque gray lens. Refraction is unsupported.'
                : 'effect layer without a base texture; omitted from the preview.');
            continue;
        }

        const base = rgba(unique(properties, 'BaseColor')?.values);
        if (base) result.color = base;
        if (albedoSlot) {
            result.albedoTexture = await load(name, slotOf(albedoSlot)[0], 'albedo') ?? undefined;
            if (result.albedoTexture) result.albedoSrgb = result.albedoTexture.srgb !== false;
            else warn(name, 'displayed base is incomplete.');
        } else warn(name, 'ambiguous albedo binding; not guessed.');
        entry.status = result.albedoTexture ? 'base' : 'unresolved';

        const boundId = bindings[index];
        const boundMatches = (snapshot?.materials ?? []).filter(m => m.id === boundId);
        const bound = boundMatches.length === 1 ? boundMatches[0] : null;
        if (boundId && !bound) warn(name, 'unknown or ambiguous ColorSync identity; keeping MDF defaults.');
        entry.bound = !!bound;

        if (albedoSlot === 'BaseAlphaMap') {
            result.albedoAlpha = true; result.alphaCutoff = .05;
            warn(name, 'BaseAlphaMap shown with alpha cutout only; smooth eye-overlay compositing is not reproduced.');
            continue;
        }

        const hair = albedoSlot === 'BaseAnisoShiftMap';
        const alphaTested = hair || ((mdf.flags?.[0] ?? 0) & FLAG_ALPHA_TEST) !== 0;
        if (alphaTested) {
            const opacity = slotOf(OPACITY_SLOT);
            const secondary = scalar(unique(properties, 'Alpha_UseSecondaryUV')?.values) ?? 0;
            if (opacity.length === 1 && secondary === 0) {
                result.opacityTexture = await load(name, opacity[0], 'opacity') ?? undefined;
                if (result.opacityTexture) {
                    const ref = scalar(unique(properties, 'AlphaTestRef')?.values);
                    result.opacityChannel = 0;
                    result.alphaCutoff = !hair && ref !== null && ref > 0 && ref < 1 ? ref : .05;
                } else if (hair) warn(name, 'cards remain opaque.');
            } else if (hair) warn(name, 'hair opacity needs an unambiguous UV0 ATOS binding; not guessed.');
        }

        const maskSlots =MASKS.filter(([slot]) => slotOf(slot).length);
        if (!maskSlots.length) {
            // Plain hair: one uniform CustomizeColor_0 tint over the whole material.
            const slot = hair ? resolveSlot({ name, index: 0, properties, mdf, bound, warn }) : null;
            if (slot) {
                const rate = slot.rate ?? 1;
                if (rate >= 0 && rate <= 1) {
                    result.color = result.color.map((v, c) => c < 3 ? v * (1 - rate + rate * 2 * slot.color[c]) : v);
                    result.uniformTintSlot = 0;
                    entry.status = 'colors'; entry.confidence = 'verified';
                    entry.slots.push({ slotIndex: 0, color: slot.color, source: slot.source });
                    slotEffects.push({ materialIndex: index, materialName: name, slotIndex: 0, parameterName: 'CustomizeColor_0', textureSlot: null, path: null, channel: null, uniform: true, source: slot.source === 'loaded-mdf' ? 'loaded-mdf' : 'snapshot', available: true, blendRate: rate });
                } else warn(name, 'hair uniform color/rate unresolved; keeping base texture.');
            }
            if (hair) warn(name, 'hair base color/uniform tint and UV0 cutouts only; anisotropy, strand lighting and smooth transparency are not reproduced.');
            continue;
        }

        const switchValue = scalar(unique(properties, 'CustomizeColor_BlendSwitch')?.values);
        if (switchValue === null) {
            warn(name, `unsupported master ${family || '(unknown)'}: no CustomizeColor_BlendSwitch, so no tint mode is guessed.`);
            continue;
        }
        result.maskMode = switchValue === 0 ? 'sf6-tint-mix' : 'sf6-tint-multiply';
        let unusedSlots = 0;
        entry.confidence = VERIFIED_FAMILIES.has(family) ? 'verified' : 'inferred';
        for (const [maskName, start] of maskSlots) {
            const descriptors = slotOf(maskName);
            if (descriptors.length !== 1) { warn(name, `ambiguous ${maskName}; not applied.`); continue; }
            const texture = await load(name, descriptors[0], maskName);
            if (!texture) warn(name, 'those slots are not previewed.');
            for (let channel = 0; channel < 4; channel++) {
                const slotIndex = start + channel;
                const slot = resolveSlot({ name, index: slotIndex, properties, mdf, bound, warn });
                if (!slot) continue;
                const effect = { materialIndex: index, materialName: name, slotIndex, parameterName: slot.parameterName, textureSlot: maskName, path: descriptors[0].path, channel, source: slot.source, available: !!texture && slot.rate !== null, blendRate: slot.rate };
                slotEffects.push(effect);
                if (slot.rate === null) { warn(name, `${slot.rateName} is unknown; slot not previewed.`); continue; }
                if (slot.rate < 0 || slot.rate > 1) { warn(name, `${slot.rateName} outside supported 0..1 range; slot not previewed.`); effect.available = false; continue; }
                if (!texture) continue;
                // Nothing on the model is painted by this slot: leave it out instead of showing a
                // swatch that changes nothing.
                if (maskChannelPeaks(texture)[channel] < UNUSED_MASK_LEVEL) { effect.available = false; effect.unused = true; unusedSlots++; continue; }
                result.maskLayers.push({ texture, channel, color: slot.color, blendRate: slot.rate, slotIndex });
                entry.slots.push({ slotIndex, color: slot.color, source: slot.source });
            }
        }
        if (result.maskLayers.length) entry.status = 'colors';
        else if (unusedSlots) entry.notes.push('its color masks are empty, so its color slots are omitted; the textures alone color it.');
        else warn(name, 'no resolved color masks; no whole-material color substitute was applied.');
        if (entry.confidence === 'inferred' && result.maskLayers.length) entry.notes.push(`mask mapping inferred from the shared CustomizeColor layout (${family}); not checked against this shader.`);
        const unsupported = ['FakeCloth_Color', 'ClothAniso_PrimalySpecularColor', 'Cloth_DetailA_AOColor', 'Cloth_DetailB_AOColor'].filter(k => unique(properties, k));
        if (unsupported.length) warn(name, `specialized finish/detail terms are not reproduced (${unsupported.join(', ')}).`);
    }
    entry = null;
    diagnostics.unshift('Mask-aware community reconstruction under controlled lighting, not verified in-game shader parity. Mask samples remain linear data; CMD colors are already linear.');
    return { materials, slotEffects, diagnostics, report };
}
