import { parseMdfMaterialNames, isMdfFilename } from "./mdf-materials.js";
import { cmdRgbaToLinearFloatRgba } from "./sf6-color-space.js";
import { archiveEntryDirectory, nearestArchiveRoot } from "./mod-archive.js";
import { isColorBackupPath, safeArchiveRelativePath } from "./color-backups.js";

function normalizedPath(path) {
    return String(path || "").replace(/\\/g, "/");
}

function copiedBuffer(bytes) {
    if (bytes instanceof ArrayBuffer) return bytes.slice(0);
    if (ArrayBuffer.isView(bytes)) {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    throw new TypeError("MDF entries must contain an ArrayBuffer or a typed byte view.");
}

/** Patch an existing CustomizeColor vector, preserving the rest of the MDF byte
 * for byte. This deliberately cannot add materials, slots, or parameter tables. */
export function writeMaterialDefaultColor(buffer, filename, materialName, slotIndex, rgba, { materialIndex } = {}) {
    if (!(buffer instanceof ArrayBuffer)) {
        throw new TypeError("writeMaterialDefaultColor expects an ArrayBuffer.");
    }
    if (typeof materialName !== "string" || !materialName || materialName.includes("\0")) {
        throw new TypeError("An exact MDF material name is required.");
    }
    if (!Number.isInteger(slotIndex) || slotIndex < 0) {
        throw new RangeError("CustomizeColor index must be a non-negative integer.");
    }
    if (materialIndex !== undefined && (!Number.isInteger(materialIndex) || materialIndex < 0)) {
        throw new RangeError("MDF material index must be a non-negative integer.");
    }
    if (
        (!Array.isArray(rgba) && !ArrayBuffer.isView(rgba))
        || rgba.length !== 4
        || Array.from(rgba).some(channel => !Number.isInteger(channel) || channel < 0 || channel > 255)
    ) {
        throw new RangeError("MDF default colors require four sRGB/CMD RGBA bytes (0–255).");
    }

    // Reparse the real buffer instead of trusting offsets saved in UI metadata.
    const materials = parseMdfMaterialNames(buffer, filename).filter(material => (
        material.name === materialName
        && (materialIndex === undefined || material.materialIndex === materialIndex)
    ));
    if (materials.length !== 1) {
        throw new Error(materials.length
            ? `MDF material ${materialName} is ambiguous; select its material index.`
            : `MDF material ${materialName} was not found.`);
    }
    const material = materials[0];
    const colors = material.customizeColors.filter(color => color.index === slotIndex);
    if (colors.length !== 1) {
        throw new Error(colors.length
            ? `${materialName} has duplicate CustomizeColor_${slotIndex} parameters.`
            : `${materialName} does not declare CustomizeColor_${slotIndex}.`);
    }
    const color = colors[0];
    if (color.componentCount !== 3 && color.componentCount !== 4) {
        throw new Error(`${materialName} CustomizeColor_${slotIndex} is not a supported RGB/RGBA float vector.`);
    }
    const output = buffer.slice(0);
    const view = new DataView(output);
    const linearRgba = cmdRgbaToLinearFloatRgba(Array.from(rgba));
    for (let component = 0; component < color.componentCount; component += 1) {
        view.setFloat32(color.dataOffset + component * 4, linearRgba[component], true);
    }
    const before = new Uint8Array(buffer, color.dataOffset, color.componentCount * 4);
    const after = new Uint8Array(output, color.dataOffset, color.componentCount * 4);
    return {
        buffer: output,
        changed: before.some((byte, index) => byte !== after[index]),
        materialName,
        materialIndex: material.materialIndex,
        slotIndex,
        dataOffset: color.dataOffset,
        componentCount: color.componentCount,
        rgba: Array.from(rgba),
        linearRgba,
    };
}

function modinfoValues(bytes) {
    const text = new TextDecoder().decode(copiedBuffer(bytes)).replace(/^\uFEFF/, "");
    const values = { name: "", requirement: [], addonfor: [] };
    for (const line of text.split(/\r?\n/)) {
        const match = /^\s*(name|requirement|addonfor)\s*=\s*(.*?)\s*$/i.exec(line);
        if (!match) continue;
        const key = match[1].toLowerCase();
        if (key === "name") values.name = match[2];
        else if (match[2]) values[key].push(match[2].toLowerCase());
    }
    return values;
}

function usableLivePath(path) {
    return safeArchiveRelativePath(path)
        && !isColorBackupPath(path)
        && !normalizedPath(path).split("/").some(segment => /\.zip$/i.test(segment));
}

/** Discover writable MDF materials in the selected component and components
 * directly linked to it. Sharing an AddonFor menu alone never joins siblings.
 * Source paths remain the original ZIP keys, so exporting preserves locations. */
export function discoverMaterialDefaultTargets(entries, { selectedRoot, esfId, costumeFolder } = {}) {
    if (!entries || !/^esf\d{3}$/i.test(String(esfId || "")) || !/^\d{3}$/.test(String(costumeFolder || ""))) {
        return [];
    }
    const entryPairs = Object.entries(entries);
    const roots = entryPairs.flatMap(([sourcePath, bytes]) => {
        if (!usableLivePath(sourcePath) || !/(?:^|\/)modinfo\.ini$/i.test(normalizedPath(sourcePath))) return [];
        try {
            return [{ root: archiveEntryDirectory(sourcePath), ...modinfoValues(bytes) }];
        } catch {
            return [];
        }
    });
    const rootNames = roots.map(info => info.root);
    const selected = selectedRoot == null ? null : normalizedPath(selectedRoot);
    const allowedRoots = new Set(selected == null ? rootNames : [selected]);
    if (selected != null) {
        const selectedInfo = roots.find(info => info.root.toLowerCase() === selected.toLowerCase());
        const name = selectedInfo?.name.toLowerCase();
        // Duplicate display names cannot establish an unambiguous dependency.
        if (name && roots.filter(info => info.name.toLowerCase() === name).length === 1) {
            for (const info of roots) {
                const infoName = info.name.toLowerCase();
                const selectedRequiresInfo = selectedInfo.requirement.includes(infoName)
                    && roots.filter(candidate => candidate.name.toLowerCase() === infoName).length === 1;
                if (info.requirement.includes(name) || info.addonfor.includes(name) || selectedRequiresInfo) {
                    allowedRoots.add(info.root);
                }
            }
        }
    }
    const allowedRootNames = new Set([...allowedRoots].map(root => root.toLowerCase()));
    const costumes = costumeFolder === "000" ? "000" : `(?:${costumeFolder}|000)`;
    const modelPath = new RegExp(`(?:^|/)natives/stm/(?:streaming/)?product/model/esf/${esfId}/${costumes}/`, "i");
    const targets = [];
    for (const [sourcePath, bytes] of entryPairs) {
        const path = normalizedPath(sourcePath);
        if (!usableLivePath(path) || !isMdfFilename(path) || !modelPath.test(path)) continue;
        const root = nearestArchiveRoot(path, rootNames);
        if (selected != null && !allowedRootNames.has((root ?? selected).toLowerCase())) continue;
        // With no owning modinfo, a selected folder still must contain the file.
        if (selected != null && root === null && !path.toLowerCase().startsWith(selected.toLowerCase())) continue;
        try {
            for (const material of parseMdfMaterialNames(copiedBuffer(bytes), path)) {
                if (!material.name || !material.customizeColors.length) continue;
                targets.push({ ...material, sourcePath, root: root ?? "", source: "mod" });
            }
        } catch (error) {
            console.warn(`Could not inspect MDF material defaults in ${sourcePath}:`, error);
        }
    }
    return targets.sort((left, right) => (
        left.sourcePath.localeCompare(right.sourcePath) || left.materialIndex - right.materialIndex
    ));
}
