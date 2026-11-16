import { cmdRgbaToLinearFloatRgba, linearFloatRgbaToCmdRgba } from "./sf6-color-space.js";
import { cmdColorSlots, normalizeCmdColorParameter } from "./sf6-shader-colors.js";
import {
    SURFACE_KEYS,
    isSurfaceFieldWritable,
    isSurfaceValueInRange,
    normalizeSurfaceParameter,
    readSurfaceField,
    surfaceFieldBytesDiffer,
    surfaceLabel,
    surfaceRange,
    surfaceRuntimeName,
} from "./sf6-surface.js";

export const FREECAM_COLOR_FORMAT = "sf6-freecam-colors";
export const FREECAM_COLOR_PREFIX = "SF6COLORS:1:";
export const MAX_FREECAM_COLOR_BYTES = 1024 * 1024;
const MAX_CHANGES = 4096;
const isRecord = value => value !== null && typeof value === "object" && !Array.isArray(value);

// Clipboard input is data only. Validate the entire document before planning
// any writes, including entries for unsupported shader parameters.
export function parseFreecamColorTransfer(text) {
    if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_FREECAM_COLOR_BYTES) {
        throw new Error("Freecam color imports are limited to 1 MiB.");
    }
    let jsonText = text.trim();
    if (jsonText.startsWith(FREECAM_COLOR_PREFIX)) jsonText = jsonText.slice(FREECAM_COLOR_PREFIX.length);
    let document;
    try { document = JSON.parse(jsonText); } catch {
        throw new Error("Paste the complete color export string from Color Sync or EMV's Copy for Color Sync button.");
    }
    // Version 2 adds scalar CustomizeRoughness_N / CustomizeMetal_N entries.
    if (!isRecord(document) || document.format !== FREECAM_COLOR_FORMAT || ![1, 2].includes(document.version)
        || document.colorSpace !== "linear") {
        throw new Error("This is not a supported color export (version 1 or 2, linear RGBA).");
    }
    if (!Array.isArray(document.changes) || !document.changes.length || document.changes.length > MAX_CHANGES) {
        throw new Error("A Freecam color export must contain between 1 and 4096 changes.");
    }
    const source = document.source ?? {};
    if (!isRecord(source)) throw new Error("The Freecam export has invalid source information.");
    if (source.object !== undefined && (typeof source.object !== "string" || source.object.length > 512)) {
        throw new Error("The Freecam export has invalid source information.");
    }
    if (document.skippedFields !== undefined && (!Number.isSafeInteger(document.skippedFields) || document.skippedFields < 0)) {
        throw new Error("The Freecam export has an invalid skipped-field count.");
    }
    const changes = document.changes.map((entry, index) => {
        if (!isRecord(entry) || typeof entry.material !== "string" || !entry.material.trim() || entry.material.length > 256
            || typeof entry.parameter !== "string" || !entry.parameter.length || entry.parameter.length > 128
            || (entry.mesh !== undefined && (typeof entry.mesh !== "string" || entry.mesh.length > 512))) {
            throw new Error(`Freecam change ${index + 1} has an invalid material or parameter name.`);
        }
        if (entry.value !== undefined) {
            if (entry.rgba !== undefined || typeof entry.value !== "number" || !Number.isFinite(entry.value)) {
                throw new Error(`Freecam change ${index + 1} must contain one finite number.`);
            }
            return { material: entry.material, parameter: entry.parameter, value: entry.value, mesh: entry.mesh ?? "" };
        }
        if (!Array.isArray(entry.rgba) || entry.rgba.length !== 4
            || entry.rgba.some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) {
            throw new Error(`Freecam change ${index + 1} must contain four RGBA floats between 0 and 1.`);
        }
        return { material: entry.material, parameter: entry.parameter, rgba: entry.rgba.slice(), mesh: entry.mesh ?? "" };
    });
    // Legacy exports may include palette metadata. The user selects the target
    // CMD; only the optional source object label is used by the import UI.
    return { ...document, source: source.object === undefined ? {} : { object: source.object }, changes };
}

const sameRgba = (a, b) => a.every((channel, index) => channel === b[index]);
const sameEntryValue = (a, b) => (a.rgba && b.rgba
    ? sameRgba(a.rgba, b.rgba)
    : a.rgba === undefined && b.rgba === undefined && Object.is(Math.fround(a.value), Math.fround(b.value)));

// Export current working bytes, including applied edits. Inactive slots are
// omitted because the shared importer enables each matching target slot.
// Blend Rate/Roughness/Metalness are exported as scalar entries only when they
// were edited (they differ from the loaded file) and are on. Most stock slots
// already have Blend Rate on, so exporting every active field would bloat
// plain color strings and overwrite those settings on import.
export function exportCmdColorTransfer(cmd, sourceLabel = cmd?.file?.name ?? "Color Sync") {
    if (!cmd?.workingBuffer || !Array.isArray(cmd.colorClusters)) {
        throw new Error("Load and select a CMD before exporting a color string.");
    }
    const changes = [];
    const surfaceChanges = [];
    // Edits are measured against the file as loaded (after any custom-material rebuild).
    const baseline = cmd.semanticBaselineBuffer ?? cmd.originalBuffer ?? null;
    let inactiveSlots = 0;
    let skippedSlots = 0;
    const materialCounts = new Map();
    for (const cluster of cmd.colorClusters) {
        materialCounts.set(cluster.name, (materialCounts.get(cluster.name) ?? 0) + 1);
    }
    for (const cluster of cmd.colorClusters) {
        const slots = cmdColorSlots(cluster);
        const parameterCounts = new Map();
        for (const slot of slots) {
            const parameter = `CustomizeColor_${slot.index}`;
            parameterCounts.set(parameter, (parameterCounts.get(parameter) ?? 0) + 1);
        }
        for (const slot of slots) {
            const address = normalizeCmdColorParameter(`CustomizeColor_${slot.index}`);
            const enableOffset = slot.enable?.absoluteOffset;
            const enableLength = slot.enable?.byteLength ?? 1;
            if (enableOffset !== undefined && (!Number.isInteger(enableOffset) || enableOffset < 0
                || !Number.isInteger(enableLength) || enableLength < 1
                || enableOffset + Math.min(enableLength, 4) > cmd.workingBuffer.byteLength)) {
                skippedSlots++;
                continue;
            }
            const enabled = Number.isInteger(enableOffset)
                ? new Uint8Array(cmd.workingBuffer, enableOffset, Math.min(enableLength, 4)).some(byte => byte !== 0)
                : slot.enabled !== false;
            const uniqueSlot = !slot.error && typeof cluster.name === "string" && Boolean(cluster.name.trim())
                && cluster.name.length <= 256 && materialCounts.get(cluster.name) === 1
                && Boolean(address) && parameterCounts.get(address.parameter) === 1;
            if (uniqueSlot && !slot.surface?.shared && baseline) {
                for (const key of SURFACE_KEYS) {
                    const field = slot.surface?.[key];
                    if (!field || !surfaceFieldBytesDiffer(baseline, cmd.workingBuffer, field)) continue;
                    const surface = readSurfaceField(cmd.workingBuffer, field);
                    if (surface?.enabled && isSurfaceValueInRange(surface.value, key)) {
                        surfaceChanges.push({ material: cluster.name, parameter: surfaceRuntimeName(key, slot.index), value: surface.value });
                    }
                }
            }
            if (!enabled) {
                inactiveSlots++;
                continue;
            }
            const offset = slot.color?.absoluteOffset;
            if (!uniqueSlot || !Number.isInteger(offset) || offset < 0 || offset + 4 > cmd.workingBuffer.byteLength) {
                skippedSlots++;
                continue;
            }
            const rgba = Array.from(new Uint8Array(cmd.workingBuffer, offset, 4));
            changes.push({ material: cluster.name, parameter: address.parameter, rgba: cmdRgbaToLinearFloatRgba(rgba) });
        }
    }
    if (!changes.length && !surfaceChanges.length) throw new Error("This CMD has no active supported color slots to export.");
    if (changes.length + surfaceChanges.length > MAX_CHANGES) throw new Error("Color strings support a maximum of 4096 entries.");
    const document = {
        format: FREECAM_COLOR_FORMAT, version: surfaceChanges.length ? 2 : 1, colorSpace: "linear",
        source: { object: sourceLabel }, changes: changes.concat(surfaceChanges), skippedFields: skippedSlots,
    };
    const text = FREECAM_COLOR_PREFIX + JSON.stringify(document);
    // Enforce exactly the same payload and size rules as the receiving importer.
    parseFreecamColorTransfer(text);
    return { text, document, slotCount: changes.length, surfaceCount: surfaceChanges.length, inactiveSlots, skippedSlots };
}

// Exact material names and semantic parameter names are the only matching keys.
// Ambiguous duplicates are skipped rather than choosing a physical MDF order.
export function planFreecamColorImport(document, cmd) {
    if (!cmd?.workingBuffer || !Array.isArray(cmd.colorClusters)) throw new Error("Load and select a CMD before importing Freecam colors.");
    const materials = new Map();
    for (const cluster of cmd.colorClusters) {
        const candidates = materials.get(cluster.name) ?? [];
        candidates.push(cluster);
        materials.set(cluster.name, candidates);
    }
    const issues = [];
    const groups = new Map();
    for (const entry of document.changes) {
        const surfaceAddress = normalizeSurfaceParameter(entry.parameter);
        if (surfaceAddress) {
            if (entry.value === undefined) {
                issues.push({ ...entry, reason: `${surfaceLabel(surfaceAddress.key)} needs a single number, not a color.` });
                continue;
            }
            const key = JSON.stringify([entry.material, surfaceAddress.parameter]);
            const group = groups.get(key) ?? [];
            group.push({ ...entry, parameter: surfaceAddress.parameter, slotIndex: surfaceAddress.index, kind: "surface", surfaceKey: surfaceAddress.key });
            groups.set(key, group);
            continue;
        }
        const address = normalizeCmdColorParameter(entry.parameter);
        if (address && entry.rgba === undefined) {
            issues.push({ ...entry, reason: "Color parameters need four RGBA values." });
            continue;
        }
        if (!address) {
            issues.push({ ...entry, reason: entry.parameter === "BaseColor"
                ? "BaseColor is stored in the MDF, not a CMD color slot."
                : "Unsupported shader parameter; only CustomizeColor_N slots are supported." });
            continue;
        }
        const key = JSON.stringify([entry.material, address.parameter]);
        const group = groups.get(key) ?? [];
        group.push({ ...entry, parameter: address.parameter, slotIndex: address.index, kind: address.kind });
        groups.set(key, group);
    }
    const operations = [];
    let duplicates = 0;
    for (const group of groups.values()) {
        const entry = group[0];
        if (group.some(other => !sameEntryValue(other, entry))) {
            issues.push({ ...entry, reason: entry.kind === "surface"
                ? `Conflicting exported ${surfaceLabel(entry.surfaceKey)} values for this material/slot across meshes.`
                : "Conflicting exported colors for this material/slot across meshes." });
            continue;
        }
        duplicates += group.length - 1;
        const candidates = materials.get(entry.material) ?? [];
        if (candidates.length !== 1) {
            issues.push({ ...entry, reason: candidates.length ? "Material name is ambiguous in this CMD." : "Material is missing from this CMD. Load the mod ZIP with its MDF for custom materials." });
            continue;
        }
        const slots = candidates[0].colors.filter(slot => slot.index === entry.slotIndex);
        const slot = slots[0];
        if (entry.kind === "surface") {
            const label = surfaceLabel(entry.surfaceKey);
            const field = slot?.surface?.[entry.surfaceKey];
            if (slots.length !== 1 || slot.error || !isSurfaceFieldWritable(cmd.workingBuffer, field)) {
                issues.push({ ...entry, reason: `This slot has no ${label} setting with a safe editable offset.` });
                continue;
            }
            if (!isSurfaceValueInRange(entry.value, entry.surfaceKey)) {
                const { min, max } = surfaceRange(entry.surfaceKey);
                issues.push({ ...entry, reason: `${label} ${entry.value} is outside the supported range of ${min} to ${max}.` });
                continue;
            }
            const value = Math.fround(entry.value);
            const beforeSurface = readSurfaceField(cmd.workingBuffer, field);
            operations.push({ ...entry, slot, field, value, beforeSurface,
                changed: !beforeSurface.enabled || !Object.is(Math.fround(beforeSurface.value), value) });
            continue;
        }
        const offset = slot?.color?.absoluteOffset;
        const enableOffset = slot?.enable?.absoluteOffset;
        const enableLength = slot?.enable?.byteLength ?? 1;
        if (slots.length !== 1 || slot.error || !Number.isInteger(offset) || offset < 0 || offset + 4 > cmd.workingBuffer.byteLength
            || (enableOffset !== undefined && (!Number.isInteger(enableOffset) || enableOffset < 0
                || !Number.isInteger(enableLength) || enableLength < 1 || enableOffset + Math.min(enableLength, 4) > cmd.workingBuffer.byteLength))) {
            issues.push({ ...entry, reason: "Color slot is missing or does not have safe editable offsets." });
            continue;
        }
        const rgba = linearFloatRgbaToCmdRgba(entry.rgba);
        const beforeRgba = Array.from(new Uint8Array(cmd.workingBuffer, offset, 4));
        const beforeEnabled = Number.isInteger(enableOffset)
            ? new Uint8Array(cmd.workingBuffer, enableOffset, Math.min(enableLength, 4)).some(value => value !== 0)
            : slot.enabled !== false;
        if (!beforeEnabled && !Number.isInteger(enableOffset)) {
            issues.push({ ...entry, reason: "Inactive color slot has no writable enable field." });
            continue;
        }
        operations.push({ ...entry, slot, rgba, linearRgba: entry.rgba.slice(), beforeRgba, beforeEnabled, changed: !sameRgba(rgba, beforeRgba) || !beforeEnabled });
    }
    // A malformed/aliased CMD must never make two different imports overwrite
    // the same color bytes. Identical aliases also need separate enable writes.
    const conflicts = new Set();
    for (let i = 0; i < operations.length; i++) {
        for (let j = i + 1; j < operations.length; j++) {
            const a = operations[i];
            const b = operations[j];
            if (a.kind === "surface" || b.kind === "surface") {
                if (a.kind === b.kind && a.field.valueField.absoluteOffset === b.field.valueField.absoluteOffset
                    && !Object.is(a.value, b.value)) {
                    conflicts.add(a);
                    conflicts.add(b);
                }
                continue;
            }
            if (Math.abs(a.slot.color.absoluteOffset - b.slot.color.absoluteOffset) < 4
                && (a.slot.color.absoluteOffset !== b.slot.color.absoluteOffset || !sameRgba(a.rgba, b.rgba))) {
                conflicts.add(a);
                conflicts.add(b);
            }
        }
    }
    for (const entry of conflicts) issues.push({ ...entry, reason: entry.kind === "surface"
        ? "Conflicting writes overlap the same CMD Blend Rate/Roughness/Metalness bytes."
        : "Conflicting writes overlap the same CMD color bytes." });
    return { operations: operations.filter(entry => !conflicts.has(entry)), issues, duplicates };
}
