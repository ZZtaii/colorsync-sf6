// ============================================================
// SF6 CUSTOMIZE SURFACE (BLEND RATE / ROUGHNESS / METALNESS)
//
// Every CMD CustomizeColorData has an Option instance:
//
//   Option.BlendRate  (FloatData)       -> runtime CustomizeColor_N_BlendRate
//   Option.Roughness  (RoughnessData)   -> runtime CustomizeRoughness_N
//   Option.Metalness  (MetalnessData)   -> runtime CustomizeMetal_N
//
// Each holds Enable + _Value. Inactive fields leave the material default in
// place. Stock MDFs default BlendRate to 1 (stock CMD values 0..1) and the
// Roughness/Metalness offsets to 0 (stock CMD values -1..1).
//
// Edits patch the existing Enable byte and float32 value in place; nothing is
// added to the RSZ graph.
// ============================================================

export const SURFACE_KEYS = Object.freeze(["blendRate", "roughness", "metalness"]);

// Widest slider range across settings (Roughness/Metalness offsets).
export const SURFACE_MIN = -1;
export const SURFACE_MAX = 1;

const SURFACE_FIELDS = Object.freeze({
    blendRate: {
        option: "BlendRate",
        typeName: "app.CostumeMaterialData.FloatData",
        label: "Blend Rate",
        min: 0,
        max: 1,
        signed: false,
        runtimeName: index => `CustomizeColor_${index}_BlendRate`,
        pattern: /^CustomizeColor_(\d+)_BlendRate$/,
    },
    roughness: {
        option: "Roughness",
        typeName: "app.CostumeMaterialData.RoughnessData",
        label: "Roughness",
        min: -1,
        max: 1,
        signed: true,
        runtimeName: index => `CustomizeRoughness_${index}`,
        pattern: /^CustomizeRoughness_(\d+)$/,
    },
    metalness: {
        option: "Metalness",
        typeName: "app.CostumeMaterialData.MetalnessData",
        label: "Metalness",
        min: -1,
        max: 1,
        signed: true,
        runtimeName: index => `CustomizeMetal_${index}`,
        pattern: /^CustomizeMetal_(\d+)$/,
    },
});

const OPTION_TYPE = "app.CostumeMaterialData.CustomizeColorData.ColorOption";

export function surfaceLabel(key) {
    return SURFACE_FIELDS[key]?.label ?? key;
}

export function surfaceRange(key) {
    const spec = SURFACE_FIELDS[key];
    return spec ? { min: spec.min, max: spec.max } : { min: SURFACE_MIN, max: SURFACE_MAX };
}

export function surfaceRuntimeName(key, slotIndex) {
    return SURFACE_FIELDS[key].runtimeName(slotIndex);
}

// Runtime names exported by EMV / Freecam: CustomizeColor_N_BlendRate,
// CustomizeRoughness_N and CustomizeMetal_N.
export function normalizeSurfaceParameter(parameter) {
    if (typeof parameter !== "string") return null;
    for (const key of SURFACE_KEYS) {
        const match = SURFACE_FIELDS[key].pattern.exec(parameter);
        if (!match) continue;
        const index = Number(match[1]);
        if (!Number.isSafeInteger(index)) return null;
        return { key, index, parameter: surfaceRuntimeName(key, index) };
    }
    return null;
}

export function isSurfaceValueInRange(value, key) {
    const { min, max } = surfaceRange(key);
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

export function clampSurfaceValue(value, key) {
    const { min, max } = surfaceRange(key);
    const number = Number(value);
    if (!Number.isFinite(number)) return Math.fround(Math.max(min, Math.min(max, 0)));
    return Math.fround(Math.max(min, Math.min(max, number)));
}

// Two decimals; offsets are signed ("+0.20", "-1.00", "0.00"), Blend Rate is not.
export function formatSurfaceValue(value, key) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    const rounded = Math.round(value * 100) / 100;
    if (rounded === 0) return "0.00";
    const signed = SURFACE_FIELDS[key]?.signed ?? true;
    return `${signed && rounded > 0 ? "+" : ""}${rounded.toFixed(2)}`;
}

export function formatSurfaceState(state, key) {
    if (!state) return "—";
    return state.enabled ? formatSurfaceValue(state.value, key) : "off";
}

function fieldFromInstance(instance, key) {
    const spec = SURFACE_FIELDS[key];
    if (!instance || instance.typeName !== spec.typeName) return null;
    const enable = instance.fields?.Enable;
    const value = instance.fields?._Value;
    if (enable?.kind !== "bool" || value?.kind !== "float"
        || !Number.isInteger(enable.absoluteOffset) || !Number.isInteger(value.absoluteOffset)) {
        return null;
    }
    return {
        key,
        instanceId: instance.index,
        enabled: Boolean(enable.value),
        value: value.value,
        enable: {
            absoluteOffset: enable.absoluteOffset,
            byteLength: enable.byteLength ?? 1,
        },
        valueField: {
            absoluteOffset: value.absoluteOffset,
            byteLength: 4,
        },
    };
}

/** Resolve one slot's Option instance into live surface fields with offsets. */
export function extractSlotSurface(optionInstanceId, instanceMap) {
    if (!Number.isInteger(optionInstanceId) || optionInstanceId <= 0) return null;
    const option = instanceMap.get(optionInstanceId);
    if (!option || option.typeName !== OPTION_TYPE) return null;
    const surface = { optionInstanceId, shared: false };
    for (const key of SURFACE_KEYS) {
        const reference = option.fields?.[SURFACE_FIELDS[key].option];
        const instanceId = reference?.kind === "object" ? reference.instanceId : null;
        surface[key] = Number.isInteger(instanceId) && instanceId > 0
            ? fieldFromInstance(instanceMap.get(instanceId), key)
            : null;
    }
    return SURFACE_KEYS.some(key => surface[key]) ? surface : null;
}

/**
 * Stock CMDs give every slot its own Option. Custom-material rebuilds clone
 * CustomizeColorData only, so clones point at their template's Option. A shared
 * field cannot be edited for one slot without changing another, so mark it.
 */
export function markSharedSurfaces(clusters) {
    const owners = new Map();
    const remember = (id, slot) => {
        if (!Number.isInteger(id)) return;
        if (!owners.has(id)) owners.set(id, new Set());
        owners.get(id).add(slot);
    };
    for (const cluster of clusters ?? []) {
        for (const slot of cluster.colors ?? []) {
            const surface = slot.surface;
            if (!surface) continue;
            remember(`o${surface.optionInstanceId}`, slot);
            for (const key of SURFACE_KEYS) remember(surface[key]?.instanceId, slot);
        }
    }
    const shared = new Set();
    for (const slots of owners.values()) if (slots.size > 1) for (const slot of slots) shared.add(slot);
    for (const cluster of clusters ?? []) {
        for (const slot of cluster.colors ?? []) {
            if (slot.surface) slot.surface.shared = shared.has(slot);
        }
    }
    return shared.size;
}

function inBounds(buffer, offset, byteLength) {
    return buffer instanceof ArrayBuffer
        && Number.isInteger(offset) && offset >= 0
        && Number.isInteger(byteLength) && byteLength > 0
        && offset + byteLength <= buffer.byteLength;
}

export function isSurfaceFieldWritable(buffer, field) {
    return Boolean(field)
        && inBounds(buffer, field.enable.absoluteOffset, Math.max(1, field.enable.byteLength))
        && inBounds(buffer, field.valueField.absoluteOffset, 4);
}

/** Read { enabled, value } from a buffer, or null when the field is unusable. */
export function readSurfaceField(buffer, field) {
    if (!isSurfaceFieldWritable(buffer, field)) return null;
    const enableLength = Math.max(1, field.enable.byteLength);
    const enabled = new Uint8Array(buffer, field.enable.absoluteOffset, Math.min(enableLength, 4))
        .some(byte => byte !== 0);
    const value = new DataView(buffer).getFloat32(field.valueField.absoluteOffset, true);
    return { enabled, value };
}

export function readSlotSurface(buffer, slot) {
    const result = {};
    for (const key of SURFACE_KEYS) {
        const field = slot?.surface?.[key];
        result[key] = field ? readSurfaceField(buffer, field) : null;
    }
    return result;
}

export function surfaceStatesEqual(a, b) {
    if (!a || !b) return a === b;
    if (a.enabled !== b.enabled) return false;
    return Object.is(Math.fround(a.value), Math.fround(b.value));
}

/** True when the stored bytes of a field differ between two buffers. */
export function surfaceFieldBytesDiffer(left, right, field) {
    if (!isSurfaceFieldWritable(left, field) || !isSurfaceFieldWritable(right, field)) return false;
    for (const { absoluteOffset, byteLength } of [field.enable, field.valueField]) {
        const a = new Uint8Array(left, absoluteOffset, Math.max(1, byteLength));
        const b = new Uint8Array(right, absoluteOffset, Math.max(1, byteLength));
        if (a.some((byte, index) => byte !== b[index])) return true;
    }
    return false;
}

/**
 * Write { enabled, value } in place and refresh the field's live model.
 * A value is only written when it differs from the stored float, so untouched
 * bytes are never re-encoded.
 */
export function writeSurfaceField(buffer, field, next) {
    const state = writeSurfaceBytes(buffer, field, next);
    field.enabled = state.enabled;
    field.value = state.value;
    return state;
}

/** Same as writeSurfaceField, but leaves the live model alone (preview buffers). */
export function writeSurfaceBytes(buffer, field, { enabled, value }) {
    if (!isSurfaceFieldWritable(buffer, field)) {
        throw new Error("This surface field does not have safe editable offsets.");
    }
    if (typeof enabled !== "boolean") throw new TypeError("Surface Enable must be a boolean.");
    const bytes = new Uint8Array(buffer);
    const enableLength = Math.max(1, field.enable.byteLength);
    bytes[field.enable.absoluteOffset] = enabled ? 1 : 0;
    for (let index = 1; index < Math.min(enableLength, 4); index += 1) {
        bytes[field.enable.absoluteOffset + index] = 0;
    }
    if (value !== undefined) {
        // Sliders and imports stay within SURFACE_MIN..MAX; exact copies of an
        // existing CMD value only need to be finite float32 numbers.
        if (typeof value !== "number" || !Number.isFinite(Math.fround(value))) {
            throw new RangeError("Surface values must be finite numbers.");
        }
        const view = new DataView(buffer);
        const stored = Math.fround(value);
        if (!Object.is(view.getFloat32(field.valueField.absoluteOffset, true), stored)) {
            view.setFloat32(field.valueField.absoluteOffset, stored, true);
        }
    }
    return { enabled, value: new DataView(buffer).getFloat32(field.valueField.absoluteOffset, true) };
}

/** Copy a field's raw bytes from one buffer to another (revert / undo). */
export function copySurfaceFieldBytes(target, source, field) {
    if (!isSurfaceFieldWritable(target, field) || !isSurfaceFieldWritable(source, field)) return false;
    for (const { absoluteOffset, byteLength } of [field.enable, field.valueField]) {
        const length = Math.max(1, byteLength);
        new Uint8Array(target, absoluteOffset, length).set(new Uint8Array(source, absoluteOffset, length));
    }
    const state = readSurfaceField(target, field);
    field.enabled = state.enabled;
    field.value = state.value;
    return true;
}

/** Refresh every slot's live surface model from a buffer. */
export function syncSurfaceModels(buffer, clusters) {
    for (const cluster of clusters ?? []) {
        for (const slot of cluster.colors ?? []) {
            for (const key of SURFACE_KEYS) {
                const field = slot.surface?.[key];
                const state = field ? readSurfaceField(buffer, field) : null;
                if (!state) continue;
                field.enabled = state.enabled;
                field.value = state.value;
            }
        }
    }
}
