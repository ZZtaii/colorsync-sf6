// ============================================================
// SF6 CMD COLOR SYNC (browser)
//
// Color Sync   → one active CMD, material → material slots
// Pattern Sync → same mapping applied to many CMDs
//
// Searchable section anchors (Ctrl+F these tags):
//   @anchor characters
//   @anchor state
//   @anchor dom
//   @anchor helpers
//   @anchor cmd-validation
//   @anchor parse-pipeline
//   @anchor buffer-mutation
//   @anchor sync-engine
//   @anchor changes-replace
//   @anchor export
//   @anchor color-picker
//   @anchor reference-viewer
//   @anchor ui-file-inspector
//   @anchor ui-sync-panels
//   @anchor events-boot
//
// See AGENTS.md for product rules and architecture notes.
// ============================================================

import { zipSync } from "./lib/fflate.js";
import { inspectUsr } from "./lib/usr-parser.js";
import { inspectRsz } from "./lib/rsz-parser.js";
import {
    loadSf6TypeRegistry,
    resolveInstanceTypes,
} from "./lib/type-registry.js";
import { parseRszInstances } from "./lib/rsz-instance-parser.js";
import {
    extractSf6ColorClusters,
    summarizeSf6ColorClusters,
} from "./lib/sf6-colors.js";
import {
    buildSf6ReferenceImages,
    validateReferenceImages,
} from "./lib/sf6-reference-images.js";
import {
    chooseExportFolder,
    clearExportFolder,
    exportFolderName,
    saveExportFile,
} from "./lib/export-destinations.js";


// ============================================================
// @anchor characters
// CHARACTERS
// ============================================================

const SF6_CHARACTERS = {
    esf001: "Ryu",
    esf002: "Luke",
    esf003: "Kimberly",
    esf004: "Chun-Li",
    esf005: "Manon",
    esf006: "Zangief",
    esf007: "JP",
    esf008: "Dhalsim",
    esf009: "Cammy",
    esf010: "Ken",
    esf011: "Dee Jay",
    esf012: "Lily",
    esf013: "A.K.I",
    esf014: "Rashid",
    esf015: "Blanka",
    esf016: "Juri",
    esf017: "Marisa",
    esf018: "Guile",
    esf019: "Ed",
    esf020: "E. Honda",
    esf021: "Jamie",
    esf022: "Akuma",
    esf025: "Sagat",
    esf026: "M. Bison",
    esf027: "Terry",
    esf028: "Mai",
    esf029: "Elena",
    esf030: "C.Viper",
    esf031: "Alex",
    esf032: "Ingrid",
    esf033: "Yasmine",
};


const CMD_NAME_RE =
    /^esf(?<esf>\d{3})_(?<costume>\d{3})_cmd_(?:(?<variant>ex)_)?(?<palette>\d{3})\.user\.(?<version>\d+)$/i;
const CMD_VARIANT_ORDER = { standard: 0, ex: 1 };


// ============================================================
// @anchor state
// STATE
// ============================================================

const state = {
    files: [],
    rejectedFiles: [],

    detectedEsfId: null,
    detectedCharacterName: null,
    detectedCostume: null,

    cmdEntries: [],
    activeCmdIndex: 0,

    colorClusters: [],

    inspectorDirty: false,

    referenceImages: [],
    referenceImageIndex: 0,
    referenceLoading: false,
    referenceMinimized: false,
    referenceWidth: null,

    screenshotFile: null,
    screenshotObjectUrl: null,
    screenshotZipName: null,

    syncMode: "color", // "color" | "pattern"

    // Color Sync: one active CMD
    colorSync: {
        sourceMaterial: "",
        sourceSlotIndex: 0,
        targetMaterial: "",
        targetSlotIndexes: [],
    },

    // Pattern Sync: multi-CMD, same mapping
    patternSync: {
        sourceMaterial: "",
        sourceSlotIndex: 0,
        targetMaterial: "",
        targetSlotIndexes: [],
        targetCmdIndexes: [],
    },
};

let typeRegistry = null;

const colorPickerState = {
    open: false,
    anchor: null,
    rgba: [255, 255, 255, 255],
    onChange: null,
    hsv: { h: 0, s: 0, v: 1 },
    draggingSv: false,
    draggingWindow: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
};


// ============================================================
// @anchor dom
// DOM
// ============================================================

const dropZone = document.querySelector("#drop-zone");
const fileInput = document.querySelector("#file-input");
const parserPanel = document.querySelector("#parser-panel");
const parserStatus = document.querySelector("#parser-status");
const fileSummary = document.querySelector("#file-summary");
const fileList = document.querySelector("#file-list");
const unloadAllCmdsBtn = document.querySelector("#unload-all-cmds");
const additionalFileOptions = document.querySelector("#additional-file-options");
const detectedCharacter = document.querySelector("#detected-character");
const colorPanel = document.querySelector("#color-panel");
const clusterInspector = document.querySelector("#cluster-inspector");
const outputPanel = document.querySelector("#output-panel");
const buildButton = document.querySelector("#build-button");
const exportCmdButton = document.querySelector("#export-cmd-button");
const buildStatus = document.querySelector("#build-status");
const exportCmdStatus = document.querySelector("#export-cmd-status");
const applyStatus = document.querySelector("#apply-status");
const cmdExportFolderName = document.querySelector("#cmd-export-folder-name");
const zipExportFolderName = document.querySelector("#zip-export-folder-name");
const chooseCmdExportFolderBtn = document.querySelector("#choose-cmd-export-folder");
const clearCmdExportFolderBtn = document.querySelector("#clear-cmd-export-folder");
const chooseZipExportFolderBtn = document.querySelector("#choose-zip-export-folder");
const clearZipExportFolderBtn = document.querySelector("#clear-zip-export-folder");
const replaceDuplicateExportsInput = document.querySelector("#replace-duplicate-exports");

const activeCmdSelect = document.querySelector("#active-cmd-select");
const cmdInspectorControls = document.querySelector("#cmd-inspector-controls");
const multiCmdInspectorNotice = document.querySelector("#multi-cmd-inspector-notice");
const inspectorToolbar = document.querySelector("#inspector-toolbar");
const expandAllClustersBtn = document.querySelector("#expand-all-clusters");
const collapseAllClustersBtn = document.querySelector("#collapse-all-clusters");
const saveCmdInspectorBtn = document.querySelector("#save-cmd-inspector");
const discardCmdInspectorBtn = document.querySelector("#discard-cmd-inspector");
const cmdInspectorDirtyIndicator = document.querySelector("#cmd-inspector-dirty-indicator");

const currentChangesPanel = document.querySelector("#current-changes-panel");
const currentChangesList = document.querySelector("#current-changes-list");
const currentChangesEmpty = document.querySelector("#current-changes-empty");
const revertAllChangesBtn = document.querySelector("#revert-all-changes");

const colorReplacePanel = document.querySelector("#color-replace-panel");
const replaceFindColorInput = document.querySelector("#replace-find-color");
const replaceNewColorInput = document.querySelector("#replace-new-color");
const replaceFindPicker = document.querySelector("#replace-find-picker");
const replaceNewPicker = document.querySelector("#replace-new-picker");
const replaceFindName = document.querySelector("#replace-find-name");
const replaceNewName = document.querySelector("#replace-new-name");
const replaceFindSwatch = document.querySelector("#replace-find-swatch");
const replaceNewSwatch = document.querySelector("#replace-new-swatch");
const replaceColorButton = document.querySelector("#replace-color-button");
const replaceColorStatus = document.querySelector("#replace-color-status");
const replaceColorResults = document.querySelector("#replace-color-results");

const modNameInput = document.querySelector("#mod-name");
const modDescriptionInput = document.querySelector("#mod-description");
const modAuthorInput = document.querySelector("#mod-author");

const screenshotDropZone = document.querySelector("#screenshot-drop-zone");
const screenshotFileInput = document.querySelector("#screenshot-file");
const screenshotPreviewWrap = document.querySelector("#screenshot-preview-wrap");
const screenshotPreview = document.querySelector("#screenshot-preview");
const screenshotStatus = document.querySelector("#screenshot-status");

const referenceViewer = document.querySelector("#reference-viewer");
const referenceViewerShell = document.querySelector("#reference-viewer-shell");
const referenceViewerImageWrap = document.querySelector("#reference-viewer-image-wrap");
const referenceViewerImage = document.querySelector("#reference-viewer-image");
const referenceViewerLabel = document.querySelector("#reference-viewer-label");
const referenceViewerCredit = document.querySelector("#reference-viewer-credit");
const referenceViewerCount = document.querySelector("#reference-viewer-count");
const referenceViewerPrev = document.querySelector("#reference-viewer-prev");
const referenceViewerNext = document.querySelector("#reference-viewer-next");
const referenceViewerMinimize = document.querySelector("#reference-viewer-minimize");
const referenceViewerRestore = document.querySelector("#reference-viewer-restore");
const referenceViewerAdd = document.querySelector("#reference-viewer-add");
const referenceViewerResize = document.querySelector("#reference-viewer-resize");
const referenceImageInput = document.querySelector("#reference-image-input");
const parsedDataDetails = document.querySelector("#parsed-data-details");
const replaceActiveLabel = document.querySelector("#replace-active-label");

const UI_STATE_KEY = "sf6-color-sync-ui-v1";

const customColorPicker = document.querySelector("#custom-color-picker");
const colorPickerSv = document.querySelector("#color-picker-sv");
const colorPickerSvCursor = document.querySelector("#color-picker-sv-cursor");
const colorPickerHue = document.querySelector("#color-picker-hue");
const colorPickerPreview = document.querySelector("#color-picker-preview");
const colorPickerHex = document.querySelector("#color-picker-hex");
const colorPickerR = document.querySelector("#color-picker-r");
const colorPickerG = document.querySelector("#color-picker-g");
const colorPickerB = document.querySelector("#color-picker-b");
const colorPickerA = document.querySelector("#color-picker-a");


// ============================================================
// @anchor helpers
// HELPERS
// ============================================================

function formatBytes(size) {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function clampByte(n) {
    return Math.max(0, Math.min(255, Math.round(Number(n) || 0)));
}

function rgbaToHexString(rgba) {
    return (
        "#"
        + rgba
            .map(v => clampByte(v).toString(16).padStart(2, "0").toUpperCase())
            .join("")
    );
}

function parseRgbaHex(value) {
    let hex = String(value ?? "").trim().replace(/^#/, "");
    if (hex.length === 6) hex += "FF";
    if (!/^[0-9a-fA-F]{8}$/.test(hex)) return null;
    return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
        Number.parseInt(hex.slice(6, 8), 16),
    ];
}

function rgbaHexAtOffset(buffer, offset) {
    const bytes = new Uint8Array(buffer, offset, 4);
    return (
        "#"
        + Array.from(bytes)
            .map(x => x.toString(16).padStart(2, "0").toUpperCase())
            .join("")
    );
}

function rgbaAtOffset(buffer, offset) {
    const bytes = new Uint8Array(buffer, offset, 4);
    return [bytes[0], bytes[1], bytes[2], bytes[3]];
}

function slotRgba(slot) {
    if (!slot?.color) return null;
    return [slot.color.r, slot.color.g, slot.color.b, slot.color.a];
}

function slotHex(slot) {
    const rgba = slotRgba(slot);
    return rgba ? rgbaToHexString(rgba) : null;
}

function isSlotEnabled(slot) {
    return slot?.enabled !== false;
}

function isSlotEditable(slot) {
    return (
        slot
        && !slot.error
        && slot.color
        && Number.isInteger(slot.color.absoluteOffset)
    );
}

function describeColorName(rgba) {
    if (!rgba) return "unknown";

    const [r, g, b, a = 255] = rgba;
    if (a <= 8) return "transparent";

    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    const l = (max + min) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

    if (s < 0.08) {
        if (l < 0.08) return "black";
        if (l < 0.22) return "near black";
        if (l < 0.38) return "dark gray";
        if (l < 0.62) return "gray";
        if (l < 0.82) return "light gray";
        if (l < 0.94) return "off white";
        return "white";
    }

    let h = 0;
    if (d !== 0) {
        if (max === rn) h = ((gn - bn) / d) % 6;
        else if (max === gn) h = (bn - rn) / d + 2;
        else h = (rn - gn) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }

    let hueName = "color";
    if (h < 15 || h >= 345) hueName = "red";
    else if (h < 40) hueName = "orange";
    else if (h < 65) hueName = "yellow";
    else if (h < 150) hueName = "green";
    else if (h < 190) hueName = "teal";
    else if (h < 230) hueName = "blue";
    else if (h < 270) hueName = "indigo";
    else if (h < 310) hueName = "purple";
    else hueName = "pink";

    if (s > 0.55 && l > 0.28 && l < 0.72) {
        if (hueName === "orange" && h < 30) return "vermilion";
        if (hueName === "yellow" && h > 50) return "gold";
        if (hueName === "blue" && h > 200) return "azure";
        if (hueName === "teal") return "teal";
        if (hueName === "green" && h < 100) return "lime";
    }

    let tone = "";
    if (l < 0.22) tone = "very dark ";
    else if (l < 0.38) tone = "dark ";
    else if (l > 0.82) tone = "pale ";
    else if (l > 0.68) tone = "light ";

    if (s < 0.25) tone = `muted ${tone}`.trim() + " ";
    else if (s > 0.75 && l > 0.25 && l < 0.7) tone = `vivid ${tone}`.trim() + " ";

    return `${tone}${hueName}`.replace(/\s+/g, " ").trim();
}

function formatSlotLabel(slot, { includeName = true } = {}) {
    const hex = slotHex(slot) ?? "--------";
    const name = describeColorName(slotRgba(slot));
    const base = slot?.runtimeName ?? "Unknown";
    if (!includeName) return `${base} — ${hex}`;
    return `${base} · ${name} · ${hex}`;
}

function cmdDisplayName(cmd) {
    const meta = cmd.metadata;
    const variant = meta.variant === "standard" ? "" : ` ${meta.variant.toUpperCase()}`;
    return (
        `${meta.characterName} C${meta.costumeNumber}`
        + ` - Color ${meta.paletteNumber}${variant}`
    );
}

function cmdShortName(cmd) {
    const meta = cmd.metadata;
    const variant = meta.variant === "standard" ? "" : `${meta.variant} `;
    return `Color ${variant}${meta.paletteNumber}`;
}

function loadUiState() {
    try {
        const raw = localStorage.getItem(UI_STATE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function saveUiState(patch) {
    try {
        const next = {
            ...loadUiState(),
            ...patch,
        };
        localStorage.setItem(UI_STATE_KEY, JSON.stringify(next));
    } catch {
        // ignore quota / private mode
    }
}

function applyPersistedUiState() {
    const saved = loadUiState();

    if (typeof saved.referenceMinimized === "boolean") {
        state.referenceMinimized = saved.referenceMinimized;
    }
    if (Number.isFinite(saved.referenceWidth)) {
        state.referenceWidth = Math.max(180, Math.min(640, saved.referenceWidth));
    }
    if (parsedDataDetails && typeof saved.parsedDataOpen === "boolean") {
        parsedDataDetails.open = saved.parsedDataOpen;
    }
    if (additionalFileOptions && typeof saved.additionalFileOptionsOpen === "boolean") {
        additionalFileOptions.open = saved.additionalFileOptionsOpen;
    }
    if (replaceDuplicateExportsInput && typeof saved.replaceDuplicateExports === "boolean") {
        replaceDuplicateExportsInput.checked = saved.replaceDuplicateExports;
    }
}

function jumpToSelector(selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.classList.remove("hidden");
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.classList.add("section-flash");
    setTimeout(() => el.classList.remove("section-flash"), 1200);
}

function screenshotZipEntryName(file) {
    const original = (file?.name || "screenshot.png").replace(/\\/g, "/").split("/").pop();
    const cleaned = original.replace(/[<>:"/\\|?*\x00-\x1f]+/g, "_");
    if (/^screenshot-/i.test(cleaned)) return cleaned;
    return `screenshot-${cleaned}`;
}

const statusHideTimers = new WeakMap();

function showStatus(el, kind, text) {
    if (!el) return;
    const existingTimer = statusHideTimers.get(el);
    if (existingTimer) clearTimeout(existingTimer);
    statusHideTimers.delete(el);
    el.classList.remove("hidden", "good", "warn", "bad");
    el.classList.add("status-box");
    if (kind) el.classList.add(kind);
    el.textContent = text;
}

function hideStatus(el) {
    if (!el) return;
    const existingTimer = statusHideTimers.get(el);
    if (existingTimer) clearTimeout(existingTimer);
    statusHideTimers.delete(el);
    el.classList.add("hidden");
    el.textContent = "";
}

function showTemporaryStatus(el, kind, text, duration = 12000) {
    showStatus(el, kind, text);
    const timer = setTimeout(() => {
        if (statusHideTimers.get(el) !== timer) return;
        hideStatus(el);
    }, duration);
    statusHideTimers.set(el, timer);
}

function revealExportStatus(el) {
    revealStatus(el);
}

function revealStatus(el) {
    if (!el) return;
    requestAnimationFrame(() => {
        el.scrollIntoView({
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            block: "center",
        });
    });
}

function listExportNames(items) {
    const names = items.map(item => `“${item.filename}”`);
    if (names.length <= 2) return names.join(" and ");
    return `${names.slice(0, 2).join(", ")}, and ${names.length - 2} more`;
}

function describeCmdExport(exported) {
    const saved = exported.filter(item => item.mode === "folder");
    const downloaded = exported.filter(item => item.mode === "download");
    const parts = [];

    if (saved.length) {
        const folders = [...new Set(saved.map(item => item.folderName))]
            .map(name => `“${name}”`)
            .join(" and ");
        parts.push(`saved ${saved.length} modified CMD file${saved.length === 1 ? "" : "s"} to ${folders}`);
    }
    if (downloaded.length) {
        parts.push(`sent ${downloaded.length} modified CMD file${downloaded.length === 1 ? "" : "s"} to browser downloads`);
    }

    const renamed = saved.filter(item => item.renamed);
    const replaced = saved.filter(item => item.replaced);
    let message = `${parts.join(" and ")}.`;
    if (renamed.length) message += ` Renamed to ${listExportNames(renamed)} to avoid replacing an existing file.`;
    if (replaced.length) message += ` Replaced existing ${listExportNames(replaced)}.`;
    return message.charAt(0).toUpperCase() + message.slice(1);
}

function describeZipExport(result) {
    const { destination } = result;
    const fileCount = result.exported.length;
    const fileLabel = `${fileCount} CMD file${fileCount === 1 ? "" : "s"}`;
    if (destination.mode === "download") {
        return `Built mod ZIP with ${fileLabel}; sent “${destination.filename}” to browser downloads.`;
    }

    let message = `Built mod ZIP with ${fileLabel}. Saved to your selected Mod ZIP folder: “${destination.folderName}/${destination.filename}”.`;
    if (destination.renamed) message += " Renamed to avoid replacing an existing file.";
    if (destination.replaced) message += ` Replaced existing “${destination.originalFilename}”.`;
    return message;
}


// ============================================================
// @anchor cmd-validation
// CMD FILENAME / VALIDATION
// ============================================================

function parseCmdFilename(filename) {
    const match = CMD_NAME_RE.exec(filename);
    if (!match) return null;

    const esfId = `esf${match.groups.esf}`;
    return {
        filename,
        esfId,
        characterName: SF6_CHARACTERS[esfId] ?? esfId,
        costumeNumber: Number(match.groups.costume),
        costumeFolder: match.groups.costume,
        paletteNumber: Number(match.groups.palette),
        paletteFolder: match.groups.palette,
        variant: match.groups.variant?.toLowerCase() ?? "standard",
        isExtra: Boolean(match.groups.variant),
        version: Number(match.groups.version),
    };
}

async function hasUsrMagic(file) {
    if (file.size < 4) return false;
    const buffer = await file.slice(0, 4).arrayBuffer();
    const bytes = new Uint8Array(buffer);
    return (
        bytes[0] === 0x55
        && bytes[1] === 0x53
        && bytes[2] === 0x52
        && bytes[3] === 0x00
    );
}

async function validateFile(file) {
    const metadata = parseCmdFilename(file.name);
    if (!metadata) {
        return {
            ok: false,
            file,
            reason: "Filename is not a valid SF6 CMD file.",
        };
    }

    if (metadata.paletteNumber === 0) {
        return {
            ok: false,
            file,
            reason: "Color 000 is empty and cannot be edited.",
        };
    }

    if (!(await hasUsrMagic(file))) {
        return {
            ok: false,
            file,
            reason: "Missing USR header.",
        };
    }

    return { ok: true, file, metadata };
}

function compareValidatedFiles(a, b) {
    const am = a.metadata;
    const bm = b.metadata;
    if (am.variant !== bm.variant) {
        return (CMD_VARIANT_ORDER[am.variant] ?? 99)
            - (CMD_VARIANT_ORDER[bm.variant] ?? 99);
    }
    return am.paletteNumber - bm.paletteNumber;
}

function checkSameCostume(entries) {
    if (entries.length === 0) {
        return { ok: false, reason: "No CMD files selected." };
    }

    const first = entries[0].metadata;
    for (const entry of entries) {
        const meta = entry.metadata;
        if (
            meta.esfId !== first.esfId
            || meta.costumeFolder !== first.costumeFolder
        ) {
            return {
                ok: false,
                reason: "CMD files must use the same character and outfit.",
            };
        }
    }

    return {
        ok: true,
        esfId: first.esfId,
        characterName: first.characterName,
        costume: first.costumeNumber,
    };
}


// ============================================================
// @anchor parse-pipeline
// PARSE PIPELINE
// ============================================================

async function parseCmdEntry(fileEntry) {
    const originalBuffer = await fileEntry.file.arrayBuffer();
    const workingBuffer = originalBuffer.slice(0);

    const usrInspection = inspectUsr(originalBuffer);
    const rszInspection = inspectRsz(originalBuffer, usrInspection.header);

    rszInspection.instanceInfos = resolveInstanceTypes(
        rszInspection.instanceInfos,
        typeRegistry,
    );

    const instanceParse = parseRszInstances(
        originalBuffer,
        rszInspection,
        typeRegistry,
    );

    if (instanceParse.status !== "complete") {
        throw new Error(
            `Failed to parse ${fileEntry.file.name}: ${instanceParse.reason}`
            + (instanceParse.error ? ` (${instanceParse.error})` : ""),
        );
    }

    const colorClusters = extractSf6ColorClusters(instanceParse);

    return {
        file: fileEntry.file,
        metadata: fileEntry.metadata,
        originalBuffer,
        workingBuffer,
        usrInspection,
        rszInspection,
        instanceParse,
        colorClusters,
        summary: summarizeSf6ColorClusters(colorClusters),
    };
}

function cmdIdentityKey(metadata) {
    if (!metadata) return "";
    return [
        metadata.esfId,
        metadata.costumeFolder,
        metadata.variant,
        metadata.paletteFolder,
        metadata.version,
    ].join("|");
}

function sortCmdEntriesInPlace() {
    const decorated = state.cmdEntries.map((cmd, index) => ({
        cmd,
        index,
        file: state.files[index] ?? null,
    }));

    decorated.sort((a, b) => {
        const am = a.cmd.metadata;
        const bm = b.cmd.metadata;
        if (am.variant !== bm.variant) {
            return (CMD_VARIANT_ORDER[am.variant] ?? 99)
                - (CMD_VARIANT_ORDER[bm.variant] ?? 99);
        }
        if (am.paletteNumber !== bm.paletteNumber) {
            return am.paletteNumber - bm.paletteNumber;
        }
        return String(a.cmd.file?.name ?? "").localeCompare(
            String(b.cmd.file?.name ?? ""),
        );
    });

    state.cmdEntries = decorated.map(entry => entry.cmd);
    state.files = decorated.map(entry => entry.file);
}

async function handleFiles(fileCollection) {
    const incoming = Array.from(fileCollection ?? []);
    if (incoming.length === 0) return;

    hideStatus(applyStatus);
    hideStatus(buildStatus);
    hideStatus(exportCmdStatus);

    const validated = [];
    for (const file of incoming) {
        validated.push(await validateFile(file));
    }

    const acceptedIncoming = validated.filter(e => e.ok);
    const rejectedIncoming = validated
        .filter(e => !e.ok)
        .map(entry => ({
            file: entry.file,
            reason: entry.reason,
        }));

    if (acceptedIncoming.length === 0) {
        state.rejectedFiles = rejectedIncoming;
        renderFileSummary();
        showStatus(
            parserStatus,
            "bad",
            rejectedIncoming[0]?.reason || "No valid CMD files selected.",
        );
        parserPanel?.classList.remove("hidden");
        revealStatus(parserStatus);
        return;
    }

    // Append when CMDs are already loaded; otherwise start a new set.
    const existingEntries = state.cmdEntries.slice();
    const existingFiles = state.files.slice();
    const hasExisting = existingEntries.length > 0;

    const baselineMeta = hasExisting
        ? existingEntries[0].metadata
        : acceptedIncoming[0].metadata;

    const mismatched = [];
    const matched = [];

    for (const entry of acceptedIncoming) {
        if (
            entry.metadata.esfId !== baselineMeta.esfId
            || entry.metadata.costumeFolder !== baselineMeta.costumeFolder
        ) {
            mismatched.push({
                file: entry.file,
                reason:
                    hasExisting
                        ? `Must match loaded set (${baselineMeta.characterName} C${baselineMeta.costumeNumber}).`
                        : "CMD files must use the same character and outfit.",
            });
        } else {
            matched.push(entry);
        }
    }

    if (matched.length === 0) {
        state.rejectedFiles = rejectedIncoming.concat(mismatched);
        renderFileSummary();
        showStatus(
            parserStatus,
            "bad",
            mismatched[0]?.reason
            || "No CMD files matched the current character/outfit.",
        );
        parserPanel?.classList.remove("hidden");
        revealStatus(parserStatus);
        return;
    }

    if (typeRegistry === null) {
        typeRegistry = await loadSf6TypeRegistry();
    }

    const existingKeys = new Set(
        existingEntries.map(cmd => cmdIdentityKey(cmd.metadata)),
    );

    const duplicates = [];
    const toAdd = [];

    for (const entry of matched) {
        const key = cmdIdentityKey(entry.metadata);
        if (existingKeys.has(key)) {
            duplicates.push({
                file: entry.file,
                reason: "Already loaded (same character/outfit/palette).",
            });
            continue;
        }
        existingKeys.add(key);
        toAdd.push(entry);
    }

    const previousActiveKey = hasExisting
        ? cmdIdentityKey(existingEntries[state.activeCmdIndex]?.metadata)
        : null;

    const newlyParsed = [];
    for (const entry of toAdd) {
        newlyParsed.push(await parseCmdEntry(entry));
    }

    // Keep existing working buffers / edits; only append new CMDs.
    state.cmdEntries = existingEntries.concat(newlyParsed);
    state.files = existingFiles.concat(toAdd);
    state.rejectedFiles = rejectedIncoming.concat(mismatched, duplicates);
    state.detectedEsfId = baselineMeta.esfId;
    state.detectedCharacterName = baselineMeta.characterName;
    state.detectedCostume = baselineMeta.costumeNumber;

    sortCmdEntriesInPlace();

    if (state.cmdEntries.length === 0) {
        throw new Error("No CMD files parsed.");
    }

    let nextActive = 0;
    if (previousActiveKey) {
        const kept = state.cmdEntries.findIndex(
            cmd => cmdIdentityKey(cmd.metadata) === previousActiveKey,
        );
        if (kept >= 0) nextActive = kept;
    } else if (newlyParsed.length) {
        const firstNewKey = cmdIdentityKey(newlyParsed[0].metadata);
        const idx = state.cmdEntries.findIndex(
            cmd => cmdIdentityKey(cmd.metadata) === firstNewKey,
        );
        if (idx >= 0) nextActive = idx;
    }

    state.activeCmdIndex = nextActive;
    state.colorClusters = state.cmdEntries[nextActive].colorClusters;
    // Don't wipe dirty state for already-edited CMDs when appending.
    if (!hasExisting) state.inspectorDirty = false;

    resetSyncSelections();
    await loadReferenceImages();

    renderFileSummary();
    renderActiveCmdControls();
    renderColorClusters(state.colorClusters);
    renderSyncPanels();
    renderCurrentChanges();
    updateExportButtons();

    colorPanel?.classList.remove("hidden");
    colorReplacePanel?.classList.remove("hidden");
    currentChangesPanel?.classList.remove("hidden");
    outputPanel?.classList.remove("hidden");
    parserPanel?.classList.remove("hidden");

    if (modNameInput && !modNameInput.value.trim()) {
        modNameInput.value =
            `${state.detectedCharacterName} C${state.detectedCostume} Colors`;
    }

    const addedCount = newlyParsed.length;
    const skipCount = duplicates.length + mismatched.length + rejectedIncoming.length;
    let msg =
        addedCount > 0
            ? (
                hasExisting
                    ? `Added ${addedCount} CMD file${addedCount === 1 ? "" : "s"} (${state.cmdEntries.length} total).`
                    : `${state.cmdEntries.length} CMD file${state.cmdEntries.length === 1 ? "" : "s"} loaded.`
            )
            : `No new CMD files added (${state.cmdEntries.length} already loaded).`;

    if (skipCount > 0) {
        msg += ` Skipped ${skipCount}.`;
    }

    showStatus(
        parserStatus,
        skipCount > 0 ? "warn" : (addedCount > 0 ? "good" : "warn"),
        msg,
    );
    revealStatus(parserStatus);
}



// ============================================================
// @anchor buffer-mutation
// BUFFER MUTATION
// ============================================================

function writeRgbaAtOffset(buffer, offset, rgba) {
    const bytes = new Uint8Array(buffer);
    bytes[offset] = clampByte(rgba[0]);
    bytes[offset + 1] = clampByte(rgba[1]);
    bytes[offset + 2] = clampByte(rgba[2]);
    bytes[offset + 3] = clampByte(rgba[3]);
}

function writeEnableAtOffset(buffer, offset, byteLength, enabled) {
    if (!Number.isInteger(offset) || offset < 0) return false;
    const bytes = new Uint8Array(buffer);
    const value = enabled ? 1 : 0;
    const len = byteLength > 0 ? byteLength : 1;

    if (offset + len > bytes.length) return false;

    if (len >= 4) {
        bytes[offset] = value;
        bytes[offset + 1] = 0;
        bytes[offset + 2] = 0;
        bytes[offset + 3] = 0;
    } else {
        bytes[offset] = value;
    }
    return true;
}

// REasy refreshes every RSZ instance-table CRC during build(). CMD source
// files can contain older CRCs, but game-ready edits must use the canonical
// values from the active type registry. Keep the in-place model while making
// the exported instance table match REasy's output.
function synchronizeCmdInstanceCrcs(cmd) {
    const instanceOffset = cmd?.rszInspection?.header?.absoluteInstanceOffset;
    const instances = cmd?.rszInspection?.instanceInfos;
    if (!Number.isInteger(instanceOffset) || !Array.isArray(instances)) return 0;

    const view = new DataView(cmd.workingBuffer);
    let changed = 0;

    for (const instance of instances) {
        if (!instance?.typeId) continue;

        const crcText = typeRegistry?.getTypeInfo(instance.typeId)?.crc;
        const crc = Number.parseInt(String(crcText ?? ""), 16);
        if (!Number.isInteger(crc) || crc < 0 || crc > 0xFFFFFFFF) continue;

        const crcOffset = instanceOffset + (instance.index * 8) + 4;
        if (crcOffset < 0 || crcOffset + 4 > cmd.workingBuffer.byteLength) continue;
        if (view.getUint32(crcOffset, true) === crc) continue;

        view.setUint32(crcOffset, crc, true);
        changed += 1;
    }

    return changed;
}

function findSlotByOffset(cmdEntry, offset) {
    for (const cluster of cmdEntry.colorClusters) {
        for (const color of cluster.colors) {
            if (color.color?.absoluteOffset === offset) return { cluster, color };
        }
    }
    return null;
}

function updateColorModelAtOffset(cmdEntry, offset, rgba) {
    const found = findSlotByOffset(cmdEntry, offset);
    if (!found?.color?.color) return;

    const c = found.color.color;
    c.r = clampByte(rgba[0]);
    c.g = clampByte(rgba[1]);
    c.b = clampByte(rgba[2]);
    c.a = clampByte(rgba[3]);
    c.hex = rgbaToHexString(rgba);
    c.rawHex = rgba
        .map(x => clampByte(x).toString(16).padStart(2, "0").toUpperCase())
        .join(" ");
}

function forceEnableSlot(cmdEntry, slot) {
    if (!slot?.enable || !Number.isInteger(slot.enable.absoluteOffset)) {
        return false;
    }

    const ok = writeEnableAtOffset(
        cmdEntry.workingBuffer,
        slot.enable.absoluteOffset,
        slot.enable.byteLength ?? 1,
        true,
    );

    if (ok) {
        slot.enabled = true;
        slot.enable.value = true;
    }
    return ok;
}

function getMaterial(cmdEntry, materialName) {
    if (!cmdEntry) return null;
    return (
        cmdEntry.colorClusters.find(c => c.name === materialName)
        ?? null
    );
}

function getColorSlot(cmdEntry, materialName, slotIndex) {
    const material = getMaterial(cmdEntry, materialName);
    if (!material) return null;
    return material.colors.find(c => c.index === slotIndex) ?? null;
}

function setCmdColorSlot(cmdEntry, materialName, slotIndex, rgba, { forceEnable = true } = {}) {
    const slot = getColorSlot(cmdEntry, materialName, slotIndex);
    if (!isSlotEditable(slot)) return false;

    writeRgbaAtOffset(
        cmdEntry.workingBuffer,
        slot.color.absoluteOffset,
        rgba,
    );
    updateColorModelAtOffset(cmdEntry, slot.color.absoluteOffset, rgba);

    if (forceEnable) forceEnableSlot(cmdEntry, slot);
    return true;
}

function applyColorEdit(color, rgba) {
    const cmd = state.cmdEntries[state.activeCmdIndex];
    if (!cmd || !isSlotEditable(color)) return;

    writeRgbaAtOffset(cmd.workingBuffer, color.color.absoluteOffset, rgba);
    updateColorModelAtOffset(cmd, color.color.absoluteOffset, rgba);
    forceEnableSlot(cmd, color);

    state.inspectorDirty = true;
    updateInspectorDirtyUi();
    renderCurrentChanges();
    renderSyncPanels();
    updateExportButtons();
}


// ============================================================
// @anchor sync-engine
// SYNC ENGINE
// ============================================================

function listMaterialNames(cmdEntry = state.cmdEntries[0]) {
    if (!cmdEntry) return [];
    return cmdEntry.colorClusters
        .filter(c => (c.colors?.length ?? 0) > 0)
        .map(c => c.name);
}

function listSlots(cmdEntry, materialName) {
    const material = getMaterial(cmdEntry, materialName);
    return material ? material.colors.slice() : [];
}

function firstEnabledSlotIndex(slots) {
    const enabled = slots.find(s => isSlotEnabled(s) && isSlotEditable(s));
    if (enabled) return enabled.index;
    return slots[0]?.index ?? 0;
}

function resetSyncSelections() {
    const materials = listMaterialNames().filter(name => {
        const slots = listSlots(state.cmdEntries[0], name);
        return slots.length > 0;
    });
    const first = materials[0] ?? "";
    const firstSlots = listSlots(state.cmdEntries[0], first);
    const sourceIndex = firstEnabledSlotIndex(firstSlots);

    state.colorSync.sourceMaterial = first;
    state.colorSync.targetMaterial = first;
    state.colorSync.sourceSlotIndex = sourceIndex;
    state.colorSync.targetSlotIndexes = [];

    state.patternSync.sourceMaterial = first;
    state.patternSync.targetMaterial = first;
    state.patternSync.sourceSlotIndex = sourceIndex;
    state.patternSync.targetSlotIndexes = [];
    state.patternSync.targetCmdIndexes = state.cmdEntries.map((_, i) => i);
}

function applyColorSync() {
    const cmd = state.cmdEntries[state.activeCmdIndex];
    if (!cmd) throw new Error("No active CMD selected.");

    const {
        sourceMaterial,
        sourceSlotIndex,
        targetMaterial,
        targetSlotIndexes,
    } = state.colorSync;

    if (!sourceMaterial || !targetMaterial) {
        throw new Error("Select source and target materials.");
    }
    if (!targetSlotIndexes.length) {
        throw new Error("Select at least one target slot.");
    }

    const source = getColorSlot(cmd, sourceMaterial, sourceSlotIndex);
    if (!isSlotEditable(source)) {
        throw new Error("Source color slot is not editable.");
    }
    if (!isSlotEnabled(source)) {
            throw new Error(
            "Source slot is inactive (Enable=false). Inactive sources are skipped.",
        );
    }

    const rgba = slotRgba(source);
    const results = [];

    for (const slotIndex of targetSlotIndexes) {
        const changed = setCmdColorSlot(
            cmd,
            targetMaterial,
            slotIndex,
            rgba,
            { forceEnable: true },
        );
        results.push({
            file: cmd.file.name,
            slotIndex,
            changed,
        });
    }

    state.inspectorDirty = true;
    updateInspectorDirtyUi();
    renderColorClusters(cmd.colorClusters);
    renderCurrentChanges();
    renderSyncPanels();
    updateExportButtons();
    return results;
}

function applyPatternSync() {
    const {
        sourceMaterial,
        sourceSlotIndex,
        targetMaterial,
        targetSlotIndexes,
        targetCmdIndexes,
    } = state.patternSync;

    if (!sourceMaterial || !targetMaterial) {
        throw new Error("Select source and target materials.");
    }
    if (!targetSlotIndexes.length) {
        throw new Error("Select at least one target slot.");
    }
    if (!targetCmdIndexes.length) {
        throw new Error("Select at least one target CMD.");
    }

    const results = [];
    let applied = 0;
    let skippedDisabled = 0;

    for (const cmdIndex of targetCmdIndexes) {
        const cmd = state.cmdEntries[cmdIndex];
        if (!cmd) continue;

        const source = getColorSlot(cmd, sourceMaterial, sourceSlotIndex);
        if (!isSlotEditable(source)) {
            results.push({
                file: cmd.file.name,
                status: "missing-source",
            });
            continue;
        }

        if (!isSlotEnabled(source)) {
            skippedDisabled += 1;
            results.push({
                file: cmd.file.name,
                status: "skipped-inactive-source",
            });
            continue;
        }

        const rgba = slotRgba(source);
        const slotResults = [];

        for (const slotIndex of targetSlotIndexes) {
            const changed = setCmdColorSlot(
                cmd,
                targetMaterial,
                slotIndex,
                rgba,
                { forceEnable: true },
            );
            slotResults.push({ slotIndex, changed });
            if (changed) applied += 1;
        }

        results.push({
            file: cmd.file.name,
            status: "applied",
            slots: slotResults,
        });
    }

    if (state.cmdEntries[state.activeCmdIndex]) {
        renderColorClusters(state.cmdEntries[state.activeCmdIndex].colorClusters);
    }

    state.inspectorDirty = true;
    updateInspectorDirtyUi();
    renderCurrentChanges();
    renderSyncPanels();
    updateExportButtons();

    return { results, applied, skippedDisabled };
}


// ============================================================
// @anchor changes-replace
// CHANGES / REVERT
// ============================================================

function getCurrentColorChanges() {
    const result = [];

    state.cmdEntries.forEach((cmd, cmdIndex) => {
        const changes = [];

        for (const cluster of cmd.colorClusters) {
            for (const color of cluster.colors) {
                const offset = color.color?.absoluteOffset;
                if (!Number.isInteger(offset)) continue;

                const before = rgbaHexAtOffset(cmd.originalBuffer, offset);
                const after = rgbaHexAtOffset(cmd.workingBuffer, offset);
                if (before === after) continue;

                changes.push({
                    cmdIndex,
                    cluster: cluster.name,
                    slot: color.runtimeName,
                    slotIndex: color.index,
                    offset,
                    before,
                    after,
                    beforeRgba: rgbaAtOffset(cmd.originalBuffer, offset),
                    afterRgba: rgbaAtOffset(cmd.workingBuffer, offset),
                    colorRef: color,
                });
            }
        }

        if (changes.length) {
            result.push({
                cmdIndex,
                file: cmd.file.name,
                label: cmdDisplayName(cmd),
                changes,
            });
        }
    });

    return result;
}

function revertChange(cmdIndex, offset) {
    const cmd = state.cmdEntries[cmdIndex];
    if (!cmd) return;

    const original = rgbaAtOffset(cmd.originalBuffer, offset);
    writeRgbaAtOffset(cmd.workingBuffer, offset, original);
    updateColorModelAtOffset(cmd, offset, original);

    renderColorClusters(state.cmdEntries[state.activeCmdIndex]?.colorClusters ?? []);
    renderCurrentChanges();
    renderSyncPanels();
    updateExportButtons();
}

function rgbaEquals(a, b) {
    if (!a || !b || a.length !== 4 || b.length !== 4) return false;
    return (
        clampByte(a[0]) === clampByte(b[0])
        && clampByte(a[1]) === clampByte(b[1])
        && clampByte(a[2]) === clampByte(b[2])
        && clampByte(a[3]) === clampByte(b[3])
    );
}

function syncReplaceColorField(which) {
    const isFind = which === "find";
    const input = isFind ? replaceFindColorInput : replaceNewColorInput;
    const picker = isFind ? replaceFindPicker : replaceNewPicker;
    const nameEl = isFind ? replaceFindName : replaceNewName;
    const swatchEl = isFind ? replaceFindSwatch : replaceNewSwatch;

    if (!input) return null;

    const rgba = parseRgbaHex(input.value);
    if (!rgba) {
        input.classList.add("invalid");
        if (nameEl) nameEl.textContent = "invalid";
        return null;
    }

    input.classList.remove("invalid");
    const hex = rgbaToHexString(rgba);
    input.value = hex;
    if (picker) picker.style.background = hex;
    if (swatchEl) swatchEl.style.background = hex;
    if (nameEl) nameEl.textContent = describeColorName(rgba);
    return rgba;
}

function renderReplaceColorFields() {
    syncReplaceColorField("find");
    syncReplaceColorField("new");
}

function findExactColorMatches(findRgba, { cmdIndex = null } = {}) {
    const matches = [];
    const indexes =
        cmdIndex === null
            ? state.cmdEntries.map((_, i) => i)
            : [cmdIndex];

    for (const index of indexes) {
        const cmd = state.cmdEntries[index];
        if (!cmd) continue;

        for (const cluster of cmd.colorClusters) {
            for (const color of cluster.colors) {
                if (!isSlotEditable(color)) continue;
                const current = slotRgba(color);
                if (!rgbaEquals(current, findRgba)) continue;

                matches.push({
                    cmdIndex: index,
                    file: cmd.file.name,
                    label: cmdDisplayName(cmd),
                    cluster: cluster.name,
                    slot: color.runtimeName,
                    slotIndex: color.index,
                    offset: color.color.absoluteOffset,
                    enabled: isSlotEnabled(color),
                    colorRef: color,
                    rgba: current,
                });
            }
        }
    }

    return matches;
}

function applyReplaceEverywhere() {
    const findRgba = syncReplaceColorField("find");
    const newRgba = syncReplaceColorField("new");

    if (!findRgba || !newRgba) {
        throw new Error("Enter valid #RRGGBBAA values for Find and Replace.");
    }

    if (rgbaEquals(findRgba, newRgba)) {
        throw new Error("Find and Replace colors are identical.");
    }

    const activeIndex = state.activeCmdIndex;
    const activeCmd = state.cmdEntries[activeIndex];
    if (!activeCmd) {
        throw new Error("No active CMD selected.");
    }

    const matches = findExactColorMatches(findRgba, { cmdIndex: activeIndex });
    if (matches.length === 0) {
        return {
            matches: [],
            changed: 0,
            findRgba,
            newRgba,
            scopeLabel: cmdDisplayName(activeCmd),
        };
    }

    let changed = 0;
    for (const match of matches) {
        const cmd = state.cmdEntries[match.cmdIndex];
        if (!cmd) continue;

        writeRgbaAtOffset(cmd.workingBuffer, match.offset, newRgba);
        updateColorModelAtOffset(cmd, match.offset, newRgba);
        forceEnableSlot(cmd, match.colorRef);
        changed += 1;
    }

    state.inspectorDirty = true;
    updateInspectorDirtyUi();
    renderColorClusters(state.cmdEntries[state.activeCmdIndex]?.colorClusters ?? []);
    renderCurrentChanges();
    renderSyncPanels();
    updateExportButtons();

    return {
        matches,
        changed,
        findRgba,
        newRgba,
        scopeLabel: cmdDisplayName(activeCmd),
    };
}

function renderReplaceResults(payload) {
    if (!replaceColorResults) return;
    replaceColorResults.innerHTML = "";

    if (!payload) {
        replaceColorResults.innerHTML =
            `<div class="replace-empty">Pick find/replace colors, then run Replace on the active CMD.</div>`;
        return;
    }

    const { matches, changed, findRgba, newRgba, scopeLabel } = payload;
    if (!matches.length) {
        replaceColorResults.innerHTML =
            `<div class="replace-empty">No exact matches on <strong>${scopeLabel ?? "active CMD"}</strong> for `
            + `<span class="color-inline"><span class="swatch-inline" style="background:${rgbaToHexString(findRgba)}"></span>`
            + `${rgbaToHexString(findRgba)} (${describeColorName(findRgba)})</span>.</div>`;
        return;
    }

    const header = document.createElement("div");
    header.className = "replace-results-header";
    header.innerHTML =
        `Replaced <strong>${changed}</strong> slot${changed === 1 ? "" : "s"} on <strong>${scopeLabel ?? "active CMD"}</strong> · `
        + `<span class="color-inline"><span class="swatch-inline" style="background:${rgbaToHexString(findRgba)}"></span>${rgbaToHexString(findRgba)}</span>`
        + ` → `
        + `<span class="color-inline"><span class="swatch-inline" style="background:${rgbaToHexString(newRgba)}"></span>${rgbaToHexString(newRgba)} (${describeColorName(newRgba)})</span>`;
    replaceColorResults.appendChild(header);

    const byFile = new Map();
    for (const match of matches) {
        if (!byFile.has(match.cmdIndex)) {
            byFile.set(match.cmdIndex, {
                label: match.label,
                file: match.file,
                items: [],
            });
        }
        byFile.get(match.cmdIndex).items.push(match);
    }

    for (const group of byFile.values()) {
        const groupEl = document.createElement("div");
        groupEl.className = "replace-result-group";

        const title = document.createElement("h4");
        title.textContent = `${group.label} (${group.items.length})`;
        groupEl.appendChild(title);

        for (const item of group.items) {
            const row = document.createElement("div");
            row.className = "replace-result-row";
            row.innerHTML =
                `<span class="color-inline"><span class="swatch-inline" style="background:${rgbaToHexString(newRgba)}"></span></span>`
                + `<span><strong>${item.cluster}</strong> · ${item.slot}`
                + `${item.enabled ? "" : " · was inactive"}</span>`;
            groupEl.appendChild(row);
        }

        replaceColorResults.appendChild(groupEl);
    }
}

function bindReplaceColorUi() {
    renderReplaceColorFields();
    renderReplaceResults(null);

    const bindField = (which) => {
        const input = which === "find" ? replaceFindColorInput : replaceNewColorInput;
        const picker = which === "find" ? replaceFindPicker : replaceNewPicker;

        input?.addEventListener("input", () => {
            const rgba = parseRgbaHex(input.value);
            if (!rgba) {
                input.classList.add("invalid");
                return;
            }
            input.classList.remove("invalid");
            const hex = rgbaToHexString(rgba);
            if (picker) picker.style.background = hex;
            const nameEl = which === "find" ? replaceFindName : replaceNewName;
            const swatchEl = which === "find" ? replaceFindSwatch : replaceNewSwatch;
            if (swatchEl) swatchEl.style.background = hex;
            if (nameEl) nameEl.textContent = describeColorName(rgba);
        });

        input?.addEventListener("change", () => {
            syncReplaceColorField(which);
        });

        picker?.addEventListener("click", () => {
            const current = syncReplaceColorField(which) ?? [255, 255, 255, 255];
            openCustomColorPicker(picker, current, rgba => {
                if (input) input.value = rgbaToHexString(rgba);
                syncReplaceColorField(which);
            });
        });
    };

    bindField("find");
    bindField("new");

    replaceColorButton?.addEventListener("click", () => {
        try {
            const result = applyReplaceEverywhere();
            renderReplaceResults(result);
            if (result.changed === 0) {
                showStatus(
                    replaceColorStatus,
                    "warn",
                    `No matches for ${rgbaToHexString(result.findRgba ?? [255, 255, 255, 255])}.`,
                );
            } else {
                showStatus(
                    replaceColorStatus,
                    "good",
                    `Replaced ${result.changed} slot${result.changed === 1 ? "" : "s"} on ${result.scopeLabel}.`,
                );
            }
        } catch (error) {
            console.error(error);
            showStatus(replaceColorStatus, "bad", error.message || String(error));
        }
    });
}

function revertAllChanges() {
    for (const cmd of state.cmdEntries) {
        const working = new Uint8Array(cmd.workingBuffer);
        working.set(new Uint8Array(cmd.originalBuffer));

        for (const cluster of cmd.colorClusters) {
            for (const color of cluster.colors) {
                const offset = color.color?.absoluteOffset;
                if (!Number.isInteger(offset)) continue;
                const rgba = rgbaAtOffset(cmd.originalBuffer, offset);
                updateColorModelAtOffset(cmd, offset, rgba);
            }
        }
    }

    state.inspectorDirty = false;
    updateInspectorDirtyUi();
    renderColorClusters(state.cmdEntries[state.activeCmdIndex]?.colorClusters ?? []);
    renderCurrentChanges();
    renderSyncPanels();
    updateExportButtons();
}

function renderCurrentChanges() {
    const grouped = getCurrentColorChanges();
    const total = grouped.reduce((n, g) => n + g.changes.length, 0);

    if (revertAllChangesBtn) revertAllChangesBtn.disabled = total === 0;

    if (currentChangesEmpty) {
        currentChangesEmpty.classList.toggle("hidden", total > 0);
        currentChangesEmpty.textContent = total > 0 ? "" : "No changes yet.";
    }

    if (!currentChangesList) return;
    currentChangesList.innerHTML = "";

    for (const group of grouped) {
        const groupEl = document.createElement("div");
        groupEl.className = "current-changes-group";

        const title = document.createElement("h3");
        title.textContent = `${group.label} (${group.changes.length})`;
        groupEl.appendChild(title);

        for (const change of group.changes) {
            const row = document.createElement("div");
            row.className = "current-change-row";

            const meta = document.createElement("div");
            meta.className = "current-change-meta";
            meta.innerHTML =
                `<strong>${change.cluster}</strong> · ${change.slot}`
                + `<div class="current-change-hexes">`
                + `<span class="color-inline"><span class="swatch-inline" style="background:${change.before}"></span>${change.before} <em>(${describeColorName(change.beforeRgba)})</em></span>`
                + ` → `
                + `<span class="color-inline"><span class="swatch-inline" style="background:${change.after}"></span>${change.after} <em>(${describeColorName(change.afterRgba)})</em></span>`
                + `</div>`;

            const afterBtn = document.createElement("button");
            afterBtn.type = "button";
            afterBtn.className = "current-change-picker";
            afterBtn.style.background = change.after;
            afterBtn.title = "Edit color";
            afterBtn.addEventListener("click", () => {
                openCustomColorPicker(afterBtn, change.afterRgba, rgba => {
                    const cmd = state.cmdEntries[change.cmdIndex];
                    if (!cmd) return;
                    writeRgbaAtOffset(cmd.workingBuffer, change.offset, rgba);
                    updateColorModelAtOffset(cmd, change.offset, rgba);
                    forceEnableSlot(cmd, change.colorRef);
                    renderColorClusters(
                        state.cmdEntries[state.activeCmdIndex]?.colorClusters ?? [],
                    );
                    renderCurrentChanges();
                    renderSyncPanels();
                    updateExportButtons();
                });
            });

            const revertBtn = document.createElement("button");
            revertBtn.type = "button";
            revertBtn.className = "secondary-button small-button";
            revertBtn.textContent = "Revert";
            revertBtn.addEventListener("click", () => {
                revertChange(change.cmdIndex, change.offset);
            });

            row.append(meta, afterBtn, revertBtn);
            groupEl.appendChild(row);
        }

        currentChangesList.appendChild(groupEl);
    }
}


// ============================================================
// @anchor export
// EXPORT
// ============================================================

function diffBuffers(original, working) {
    const a = new Uint8Array(original);
    const b = new Uint8Array(working);
    const diff = [];
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) {
            diff.push({ offset: i, before: a[i], after: b[i] });
        }
    }
    return diff;
}

function updateExportButtons() {
    const hasChanges = getCurrentColorChanges().length > 0;
    if (buildButton) buildButton.disabled = !hasChanges;
    if (exportCmdButton) exportCmdButton.disabled = !hasChanges;
}

async function exportModifiedCmdFiles() {
    const exported = [];

    for (const cmd of state.cmdEntries) {
        const colorChanges = diffBuffers(cmd.originalBuffer, cmd.workingBuffer);
        if (colorChanges.length === 0) continue;
        synchronizeCmdInstanceCrcs(cmd);
        const changes = diffBuffers(cmd.originalBuffer, cmd.workingBuffer);
        const destination = await saveExportFile(
            "cmd",
            new Uint8Array(cmd.workingBuffer),
            cmd.file.name,
            { replaceExisting: Boolean(replaceDuplicateExportsInput?.checked) },
        );
        if (destination.mode === "cancelled") continue;
        exported.push({
            file: cmd.file.name,
            changedBytes: changes.length,
            ...destination,
        });
    }

    if (exported.length === 0) {
        throw new Error("No changes to export.");
    }
    return exported;
}

async function buildModZip() {
    const files = {};
    const exported = [];

    for (const cmd of state.cmdEntries) {
        const colorChanges = diffBuffers(cmd.originalBuffer, cmd.workingBuffer);
        if (colorChanges.length === 0) continue;
        synchronizeCmdInstanceCrcs(cmd);
        const changes = diffBuffers(cmd.originalBuffer, cmd.workingBuffer);

        const path =
            `natives/STM/Product/Model/esf/`
            + `${cmd.metadata.esfId}/`
            + `${cmd.metadata.costumeFolder}/`
            + cmd.file.name;

        files[path] = new Uint8Array(cmd.workingBuffer);
        exported.push({
            file: cmd.file.name,
            changedBytes: changes.length,
        });
    }

    if (exported.length === 0) {
        throw new Error("Nothing changed.");
    }

    const name = modNameInput?.value?.trim() || "SF6 Colors";
    const description =
        modDescriptionInput?.value?.trim() || "Created with SF6 Color Sync";
    const author = modAuthorInput?.value?.trim() || "ZZtai";

    let screenshotEntry = null;
    if (state.screenshotFile) {
        const shotBuf = new Uint8Array(await state.screenshotFile.arrayBuffer());
        screenshotEntry =
            state.screenshotZipName
            || screenshotZipEntryName(state.screenshotFile);
        files[screenshotEntry] = shotBuf;
    }

    const modinfoLines = [
        `name=${name}`,
        `description=${description}`,
        `author=${author}`,
    ];
    if (screenshotEntry) {
        modinfoLines.push(`screenshot=${screenshotEntry}`);
    }
    files["modinfo.ini"] = new TextEncoder().encode(`${modinfoLines.join("\n")}\n`);

    const zip = zipSync(files, { level: 0 });
    const destination = await saveExportFile(
        "zip",
        zip,
        `${name.replace(/[<>:"/\\|?*]+/g, "_")}.zip`,
        {
            type: "application/zip",
            replaceExisting: Boolean(replaceDuplicateExportsInput?.checked),
        },
    );
    if (destination.mode === "cancelled") throw new Error("ZIP export cancelled.");
    return { exported, destination };
}


// ============================================================
// @anchor color-picker
// COLOR PICKER
// ============================================================

function rgbToHsv(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const d = max - min;
    let h = 0;
    const s = max === 0 ? 0 : d / max;
    const v = max;

    if (d !== 0) {
        switch (max) {
            case rn: h = ((gn - bn) / d + (gn < bn ? 6 : 0)); break;
            case gn: h = (bn - rn) / d + 2; break;
            default: h = (rn - gn) / d + 4; break;
        }
        h *= 60;
    }
    return { h, s, v };
}

function hsvToRgb(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = v - c;
    let rp = 0;
    let gp = 0;
    let bp = 0;

    if (h < 60) [rp, gp, bp] = [c, x, 0];
    else if (h < 120) [rp, gp, bp] = [x, c, 0];
    else if (h < 180) [rp, gp, bp] = [0, c, x];
    else if (h < 240) [rp, gp, bp] = [0, x, c];
    else if (h < 300) [rp, gp, bp] = [x, 0, c];
    else [rp, gp, bp] = [c, 0, x];

    return [
        Math.round((rp + m) * 255),
        Math.round((gp + m) * 255),
        Math.round((bp + m) * 255),
    ];
}

function syncPickerFromRgba(rgba, { skipHex = false } = {}) {
    colorPickerState.rgba = rgba.map(clampByte);
    colorPickerState.hsv = rgbToHsv(rgba[0], rgba[1], rgba[2]);

    const hex = rgbaToHexString(colorPickerState.rgba);
    if (colorPickerPreview) colorPickerPreview.style.background = hex;
    if (colorPickerHex && !skipHex) colorPickerHex.value = hex;
    if (colorPickerR) colorPickerR.value = colorPickerState.rgba[0];
    if (colorPickerG) colorPickerG.value = colorPickerState.rgba[1];
    if (colorPickerB) colorPickerB.value = colorPickerState.rgba[2];
    if (colorPickerA) colorPickerA.value = colorPickerState.rgba[3];
    if (colorPickerHue) colorPickerHue.value = String(Math.round(colorPickerState.hsv.h));

    if (colorPickerSv) {
        const hueRgb = hsvToRgb(colorPickerState.hsv.h, 1, 1);
        colorPickerSv.style.background =
            `linear-gradient(to top, #000, transparent),`
            + `linear-gradient(to right, #fff, rgb(${hueRgb.join(",")}))`;
    }

    if (colorPickerSvCursor && colorPickerSv) {
        const rect = colorPickerSv.getBoundingClientRect();
        const w = rect.width || 180;
        const h = rect.height || 140;
        colorPickerSvCursor.style.left = `${colorPickerState.hsv.s * w}px`;
        colorPickerSvCursor.style.top = `${(1 - colorPickerState.hsv.v) * h}px`;
    }
}

function emitPickerChange() {
    if (typeof colorPickerState.onChange === "function") {
        colorPickerState.onChange(colorPickerState.rgba.slice());
    }
}

function positionColorPicker(anchor) {
    if (!customColorPicker || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const pad = 8;
    const pw = customColorPicker.offsetWidth || 220;
    const ph = customColorPicker.offsetHeight || 280;

    let left = rect.left;
    let top = rect.bottom + pad;

    if (left + pw > window.innerWidth - pad) {
        left = Math.max(pad, window.innerWidth - pw - pad);
    }
    if (top + ph > window.innerHeight - pad) {
        top = Math.max(pad, rect.top - ph - pad);
    }

    customColorPicker.style.left = `${left}px`;
    customColorPicker.style.top = `${top}px`;
}

function openCustomColorPicker(anchor, rgba, onChange) {
    colorPickerState.open = true;
    colorPickerState.anchor = anchor;
    colorPickerState.onChange = onChange;
    syncPickerFromRgba(rgba ?? [255, 255, 255, 255]);
    customColorPicker?.classList.remove("hidden");
    positionColorPicker(anchor);
}

function closeCustomColorPicker() {
    colorPickerState.open = false;
    colorPickerState.anchor = null;
    colorPickerState.onChange = null;
    colorPickerState.draggingWindow = false;
    customColorPicker?.classList.remove("is-dragging");
    customColorPicker?.classList.add("hidden");
}

function bindColorPickerEvents() {
    if (!customColorPicker) return;

    const movePickerWindow = (left, top) => {
        const pad = 8;
        const width = customColorPicker.offsetWidth;
        const height = customColorPicker.offsetHeight;
        const maxLeft = Math.max(pad, window.innerWidth - width - pad);
        const maxTop = Math.max(pad, window.innerHeight - height - pad);
        customColorPicker.style.left = `${Math.min(maxLeft, Math.max(pad, left))}px`;
        customColorPicker.style.top = `${Math.min(maxTop, Math.max(pad, top))}px`;
    };

    customColorPicker.addEventListener("pointerdown", e => {
        if (e.button !== 0) return;
        if (e.target.closest("input, button, .color-picker-sv")) return;

        const rect = customColorPicker.getBoundingClientRect();
        colorPickerState.draggingWindow = true;
        colorPickerState.dragOffsetX = e.clientX - rect.left;
        colorPickerState.dragOffsetY = e.clientY - rect.top;
        customColorPicker.classList.add("is-dragging");
        customColorPicker.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    customColorPicker.addEventListener("pointermove", e => {
        if (!colorPickerState.draggingWindow) return;
        movePickerWindow(
            e.clientX - colorPickerState.dragOffsetX,
            e.clientY - colorPickerState.dragOffsetY,
        );
    });

    const stopDraggingPickerWindow = () => {
        colorPickerState.draggingWindow = false;
        customColorPicker.classList.remove("is-dragging");
    };
    customColorPicker.addEventListener("pointerup", stopDraggingPickerWindow);
    customColorPicker.addEventListener("pointercancel", stopDraggingPickerWindow);

    colorPickerHue?.addEventListener("input", () => {
        colorPickerState.hsv.h = Number(colorPickerHue.value) || 0;
        const [r, g, b] = hsvToRgb(
            colorPickerState.hsv.h,
            colorPickerState.hsv.s,
            colorPickerState.hsv.v,
        );
        syncPickerFromRgba([r, g, b, colorPickerState.rgba[3]]);
        emitPickerChange();
    });

    const onSv = (clientX, clientY) => {
        if (!colorPickerSv) return;
        const rect = colorPickerSv.getBoundingClientRect();
        const s = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        const v = Math.min(1, Math.max(0, 1 - (clientY - rect.top) / rect.height));
        colorPickerState.hsv.s = s;
        colorPickerState.hsv.v = v;
        const [r, g, b] = hsvToRgb(
            colorPickerState.hsv.h,
            colorPickerState.hsv.s,
            colorPickerState.hsv.v,
        );
        syncPickerFromRgba([r, g, b, colorPickerState.rgba[3]]);
        emitPickerChange();
    };

    colorPickerSv?.addEventListener("pointerdown", e => {
        colorPickerState.draggingSv = true;
        colorPickerSv.setPointerCapture(e.pointerId);
        onSv(e.clientX, e.clientY);
    });
    colorPickerSv?.addEventListener("pointermove", e => {
        if (!colorPickerState.draggingSv) return;
        onSv(e.clientX, e.clientY);
    });
    colorPickerSv?.addEventListener("pointerup", () => {
        colorPickerState.draggingSv = false;
    });

    const onChannel = () => {
        const rgba = [
            Number(colorPickerR?.value),
            Number(colorPickerG?.value),
            Number(colorPickerB?.value),
            Number(colorPickerA?.value),
        ].map(clampByte);
        syncPickerFromRgba(rgba);
        emitPickerChange();
    };

    colorPickerR?.addEventListener("change", onChannel);
    colorPickerG?.addEventListener("change", onChannel);
    colorPickerB?.addEventListener("change", onChannel);
    colorPickerA?.addEventListener("change", onChannel);

    colorPickerHex?.addEventListener("change", () => {
        const rgba = parseRgbaHex(colorPickerHex.value);
        if (!rgba) return;
        syncPickerFromRgba(rgba);
        emitPickerChange();
    });

    document.addEventListener("pointerdown", e => {
        if (!colorPickerState.open) return;
        if (customColorPicker.contains(e.target)) return;
        if (colorPickerState.anchor?.contains?.(e.target)) return;
        closeCustomColorPicker();
    });

    window.addEventListener("resize", () => {
        if (colorPickerState.open) positionColorPicker(colorPickerState.anchor);
    });
}


// ============================================================
// @anchor reference-viewer
// REFERENCE VIEWER
// ============================================================

async function loadReferenceImages() {
    state.referenceLoading = true;
    const generated = buildSf6ReferenceImages(state.cmdEntries);
    state.referenceImages = await validateReferenceImages(generated);
    state.referenceImageIndex = 0;
    state.referenceLoading = false;
    renderReferenceViewer();
}

function applyReferenceViewerSize() {
    const width = state.referenceWidth;
    const target = referenceViewerShell || referenceViewerImageWrap || referenceViewer;
    if (!target) return;

    if (Number.isFinite(width) && width > 0) {
        target.style.width = `${width}px`;
    } else {
        target.style.width = "";
    }
}

function renderReferenceViewer() {
    const images = state.referenceImages;
    if (!referenceViewer) return;

    if (!images.length) {
        referenceViewer.classList.add("hidden");
        referenceViewerRestore?.classList.add("hidden");
        return;
    }

    if (state.referenceMinimized) {
        referenceViewer.classList.add("hidden");
        referenceViewerRestore?.classList.remove("hidden");
        return;
    }

    referenceViewer.classList.remove("hidden");
    referenceViewerRestore?.classList.add("hidden");
    applyReferenceViewerSize();

    const image = images[state.referenceImageIndex] ?? images[0];
    if (referenceViewerImage) {
        referenceViewerImage.src = image.src;
        referenceViewerImage.alt = image.label;
    }
    if (referenceViewerLabel) referenceViewerLabel.textContent = image.label;
    if (referenceViewerCredit) referenceViewerCredit.hidden = image.type !== "official";
    if (referenceViewerCount) {
        referenceViewerCount.textContent =
            `${state.referenceImageIndex + 1}/${images.length}`;
    }

    // Always keep arrows present + clickable (wrap-around). Hover CSS controls visibility.
    referenceViewerPrev?.classList.remove("hidden");
    referenceViewerNext?.classList.remove("hidden");
    if (referenceViewerPrev) referenceViewerPrev.disabled = false;
    if (referenceViewerNext) referenceViewerNext.disabled = false;
}

function bindReferenceViewerResize() {
    if (!referenceViewerResize) return;

    let dragging = false;
    let startX = 0;
    let startWidth = 0;

    const onMove = (event) => {
        if (!dragging) return;
        const delta = event.clientX - startX;
        // Handle is on the bottom-left; drag left grows, drag right shrinks.
        const next = Math.max(180, Math.min(640, startWidth - delta));
        state.referenceWidth = next;
        applyReferenceViewerSize();
    };

    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove("is-resizing-reference");
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        saveUiState({ referenceWidth: state.referenceWidth });
    };

    referenceViewerResize.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const shell = referenceViewerShell || referenceViewerImageWrap;
        if (!shell) return;
        dragging = true;
        startX = event.clientX;
        startWidth = shell.getBoundingClientRect().width;
        document.body.classList.add("is-resizing-reference");
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    });
}


// ============================================================
// @anchor ui-file-inspector
// UI: FILE SUMMARY / INSPECTOR
// ============================================================

function renderFileSummary() {
    if (!fileSummary) return;

    const hasAccepted = state.cmdEntries.length > 0;
    const hasRejected = state.rejectedFiles.length > 0;

    if (!hasAccepted && !hasRejected) {
        fileSummary.classList.add("hidden");
        return;
    }

    fileSummary.classList.remove("hidden");

    if (detectedCharacter) {
        if (hasAccepted) {
            detectedCharacter.textContent =
                `${state.detectedCharacterName} · Outfit ${state.detectedCostume}`
                + ` (${state.detectedEsfId})`;
        } else {
            detectedCharacter.textContent = "No valid CMD set loaded.";
        }
    }

    if (!fileList) return;
    fileList.innerHTML = "";
    if (unloadAllCmdsBtn) unloadAllCmdsBtn.disabled = state.cmdEntries.length === 0;

    state.cmdEntries.forEach((cmd, index) => {
        const row = document.createElement("div");
        row.className = "file-list-item";
        row.innerHTML =
            `<strong>${cmdDisplayName(cmd)}</strong>`
            + `<span>${cmd.file.name} · ${formatBytes(cmd.file.size)}</span>`
            + `<span>${cmd.colorClusters.length} materials</span>`;
        const unload = document.createElement("button");
        unload.type = "button";
        unload.className = "secondary-button file-unload-button";
        unload.dataset.unloadCmd = String(index);
        unload.textContent = "Unload";
        row.appendChild(unload);
        fileList.appendChild(row);
    });

    for (const rejected of state.rejectedFiles) {
        const row = document.createElement("div");
        row.className = "file-list-item rejected";
        row.innerHTML =
            `<strong>${rejected.file.name}</strong>`
            + `<span>${rejected.reason}</span>`;
        fileList.appendChild(row);
    }
}

async function unloadCmd(index) {
    const cmd = state.cmdEntries[index];
    if (!cmd) return;

    state.cmdEntries.splice(index, 1);
    state.files.splice(index, 1);
    state.rejectedFiles = [];

    if (state.cmdEntries.length === 0) {
        state.activeCmdIndex = 0;
        state.colorClusters = [];
        state.detectedEsfId = null;
        state.detectedCharacterName = null;
        state.detectedCostume = null;
        state.referenceImages = [];
        renderReferenceViewer();
        colorPanel?.classList.add("hidden");
        colorReplacePanel?.classList.add("hidden");
        currentChangesPanel?.classList.add("hidden");
        outputPanel?.classList.add("hidden");
    } else {
        state.activeCmdIndex = Math.min(index, state.cmdEntries.length - 1);
        state.colorClusters = state.cmdEntries[state.activeCmdIndex].colorClusters;
        state.inspectorDirty = false;
        resetSyncSelections();
        await loadReferenceImages();
        renderColorClusters(state.colorClusters);
        renderSyncPanels();
    }

    renderFileSummary();
    renderActiveCmdControls();
    renderCurrentChanges();
    updateExportButtons();
    showStatus(parserStatus, "good", `Unloaded ${cmdDisplayName(cmd)}.`);
}

async function unloadAllCmds() {
    if (state.cmdEntries.length === 0) return;
    while (state.cmdEntries.length) {
        await unloadCmd(0);
    }
}

async function refreshExportDestinationUi() {
    const [cmdFolder, zipFolder] = await Promise.all([
        exportFolderName("cmd"),
        exportFolderName("zip"),
    ]);
    if (cmdExportFolderName) cmdExportFolderName.textContent = cmdFolder || "Browser downloads";
    if (zipExportFolderName) zipExportFolderName.textContent = zipFolder || "Browser downloads";
    if (clearCmdExportFolderBtn) clearCmdExportFolderBtn.disabled = !cmdFolder;
    if (clearZipExportFolderBtn) clearZipExportFolderBtn.disabled = !zipFolder;
}

function updateInspectorDirtyUi() {
    const dirty = state.inspectorDirty;
    if (saveCmdInspectorBtn) saveCmdInspectorBtn.disabled = !dirty;
    if (discardCmdInspectorBtn) discardCmdInspectorBtn.disabled = !dirty;
    cmdInspectorDirtyIndicator?.classList.toggle("hidden", !dirty);
}

function loadActiveCmd(index) {
    const i = Number(index);
    if (!state.cmdEntries[i]) return;

    state.activeCmdIndex = i;
    const cmd = state.cmdEntries[i];
    state.colorClusters = cmd.colorClusters;
    state.inspectorDirty = false;
    updateInspectorDirtyUi();
    renderColorClusters(cmd.colorClusters);
    renderSyncPanels();
}

function renderActiveCmdControls() {
    const multi = state.cmdEntries.length > 1;

    cmdInspectorControls?.classList.toggle("hidden", state.cmdEntries.length === 0);
    multiCmdInspectorNotice?.classList.toggle("hidden", !multi);
    inspectorToolbar?.classList.toggle("hidden", state.cmdEntries.length === 0);

    if (!activeCmdSelect) return;
    const trigger = activeCmdSelect.querySelector(".custom-select-trigger");
    const dropdown = activeCmdSelect.querySelector(".custom-select-dropdown");
    const text = trigger?.querySelector(".cs-text");
    if (!trigger || !dropdown) return;

    const activeCmd = state.cmdEntries[state.activeCmdIndex];
    if (text) text.textContent = activeCmd ? cmdDisplayName(activeCmd) : "No CMD files";
    trigger.disabled = !activeCmd;
    trigger.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");

    dropdown.innerHTML = "";
    state.cmdEntries.forEach((cmd, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "custom-select-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === state.activeCmdIndex));
        option.textContent = cmdDisplayName(cmd);
        if (index === state.activeCmdIndex) option.classList.add("selected");
        option.addEventListener("click", () => {
            dropdown.classList.add("hidden");
            trigger.classList.remove("open");
            trigger.setAttribute("aria-expanded", "false");
            if (index === state.activeCmdIndex) return;
            loadActiveCmd(index);
            renderActiveCmdControls();
        });
        dropdown.appendChild(option);
    });

    trigger.onclick = event => {
        event.stopPropagation();
        const open = dropdown.classList.toggle("hidden") === false;
        trigger.classList.toggle("open", open);
        trigger.setAttribute("aria-expanded", String(open));
    };
    updateInspectorDirtyUi();
}

function renderColorClusters(clusters) {
    if (!clusterInspector) return;
    clusterInspector.innerHTML = "";

    for (const cluster of clusters ?? []) {
        const card = document.createElement("details");
        card.className = "cluster-card";
        card.open = false;

        const title = document.createElement("summary");
        title.textContent = `${cluster.name} (${cluster.colors.length})`;
        card.appendChild(title);

        const list = document.createElement("div");
        list.className = "cluster-slot-list";

        for (const color of cluster.colors) {
            const row = document.createElement("div");
            row.className = "cluster-slot-row";
            if (!isSlotEnabled(color)) row.classList.add("inactive-slot");
            if (!isSlotEditable(color)) row.classList.add("readonly-slot");

            const name = document.createElement("span");
            name.className = "cluster-slot-name";
            name.textContent = color.runtimeName;

            const friendly = document.createElement("span");
            friendly.className = "cluster-slot-friendly";
            friendly.textContent = describeColorName(slotRgba(color));

            const swatch = document.createElement("button");
            swatch.type = "button";
            swatch.className = "color-picker cluster-slot-swatch";
            const hex = slotHex(color) ?? "#000000FF";
            swatch.style.backgroundColor = hex;
            swatch.disabled = !isSlotEditable(color);
            swatch.title = formatSlotLabel(color);

            const hexInput = document.createElement("input");
            hexInput.type = "text";
            hexInput.className = "source-color-hex cluster-slot-hex";
            hexInput.value = hex;
            hexInput.disabled = !isSlotEditable(color);

            const flags = document.createElement("span");
            flags.className = "cluster-slot-flags";
            if (!isSlotEnabled(color)) {
                flags.classList.add("is-inactive");
                flags.textContent = "inactive";
            } else {
                flags.classList.add("is-active");
                flags.textContent = "active";
            }

            const applyHex = () => {
                const rgba = parseRgbaHex(hexInput.value);
                if (!rgba) {
                    hexInput.classList.add("invalid");
                    return;
                }
                hexInput.classList.remove("invalid");
                applyColorEdit(color, rgba);
                swatch.style.backgroundColor = rgbaToHexString(rgba);
                friendly.textContent = describeColorName(rgba);
            };

            hexInput.addEventListener("change", applyHex);

            swatch.addEventListener("click", () => {
                const rgba = slotRgba(color) ?? [0, 0, 0, 255];
                openCustomColorPicker(swatch, rgba, newRgba => {
                    hexInput.value = rgbaToHexString(newRgba);
                    swatch.style.backgroundColor = hexInput.value;
                    friendly.textContent = describeColorName(newRgba);
                    applyColorEdit(color, newRgba);
                });
            });

            const hexControl = document.createElement("div");
            hexControl.className = "hex-input-control";
            hexControl.append(hexInput);
            if (isSlotEditable(color)) hexControl.append(createHexActionButtons());

            row.append(swatch, name, friendly, hexControl, flags);
            list.appendChild(row);
        }

        card.appendChild(list);
        clusterInspector.appendChild(card);
    }
}


// ============================================================
// @anchor ui-sync-panels
// UI: SYNC PANELS
// ============================================================

function makeSwatchEl(hex, { muted = false } = {}) {
    const el = document.createElement("span");
    el.className = "cs-swatch";
    el.style.background = hex || "transparent";
    if (muted) el.classList.add("muted");
    return el;
}

function createHexActionButton(action) {
    const isCopy = action === "copy";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `hex-action-button hex-${action}-button`;
    button.dataset.hexAction = action;
    button.setAttribute("aria-label", `${isCopy ? "Copy" : "Paste"} hex color`);
    button.title = isCopy ? "Copy" : "Paste";
    button.innerHTML = isCopy
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h8a2 2 0 0 1 2 2v10h-2V5H9V3Zm-4 4h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm0 2v11h8V9H5Z"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2h6v2h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3V2Zm-3 4v14h12V6h-3v1H9V6H6Zm5 4h2v5.17l1.59-1.58L16 15l-4 4-4-4 1.41-1.41L11 15.17V10Z"/></svg>';
    return button;
}

function createHexActionButtons() {
    const controls = document.createElement("span");
    controls.className = "hex-action-buttons";
    controls.append(createHexActionButton("copy"), createHexActionButton("paste"));
    return controls;
}

function initializeHexActionButtons() {
    document.querySelectorAll(".hex-input-control").forEach(control => {
        const legacyPaste = control.querySelector(":scope > .hex-paste-button");
        if (!legacyPaste) return;

        legacyPaste.classList.add("hex-action-button");
        legacyPaste.dataset.hexAction = "paste";
        legacyPaste.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 2h6v2h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3V2Zm-3 4v14h12V6h-3v1H9V6H6Zm5 4h2v5.17l1.59-1.58L16 15l-4 4-4-4 1.41-1.41L11 15.17V10Z"/></svg>';
        const actions = document.createElement("span");
        actions.className = "hex-action-buttons";
        actions.append(createHexActionButton("copy"), legacyPaste);
        control.append(actions);
    });
}

async function pasteIntoHexInput(input) {
    if (!input || input.readOnly || input.disabled) return;
    input.focus({ preventScroll: true });
    input.select();
    try {
        const pasted = await navigator.clipboard.readText();
        input.value = pasted;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch {
        input.classList.add("paste-failed");
        setTimeout(() => input.classList.remove("paste-failed"), 800);
    }
}

async function copyHexInput(input) {
    if (!input || input.readOnly || input.disabled) return;
    input.select();
    try {
        await navigator.clipboard.writeText(input.value);
        input.classList.add("copy-succeeded");
    } catch {
        input.classList.add("copy-failed");
    }
    setTimeout(() => input.classList.remove("copy-succeeded", "copy-failed"), 800);
}

function buildMaterialDropdown(rootEl, { selectedName, onSelect }) {
    if (!rootEl) return;

    const trigger = rootEl.querySelector(".custom-select-trigger");
    const dropdown = rootEl.querySelector(".custom-select-dropdown");
    if (!trigger || !dropdown) return;

    const names = listMaterialNames();
    const selected = names.includes(selectedName) ? selectedName : names[0] ?? null;
    const text = trigger.querySelector(".cs-text");
    if (text) text.textContent = selected ?? "No materials";
    trigger.disabled = !selected;
    trigger.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");

    dropdown.innerHTML = "";
    for (const name of names) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "custom-select-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(name === selected));
        if (name === selected) option.classList.add("selected");

        const label = document.createElement("span");
        label.className = "cs-text";
        label.textContent = name;
        option.appendChild(label);
        option.addEventListener("click", () => {
            dropdown.classList.add("hidden");
            trigger.classList.remove("open");
            trigger.setAttribute("aria-expanded", "false");
            onSelect(name);
        });
        dropdown.appendChild(option);
    }

    trigger.onclick = e => {
        e.stopPropagation();
        const open = dropdown.classList.toggle("hidden") === false;
        trigger.classList.toggle("open", open);
        trigger.setAttribute("aria-expanded", String(open));
    };

    return selected;
}

function buildSlotDropdown(rootEl, {
    slots,
    selectedIndex,
    onSelect,
    includeDisabled = true,
}) {
    if (!rootEl) return;

    const trigger = rootEl.querySelector(".custom-select-trigger");
    const dropdown = rootEl.querySelector(".custom-select-dropdown");
    if (!trigger || !dropdown) return;

    const usable = includeDisabled
        ? slots
        : slots.filter(s => isSlotEnabled(s));

    const selected =
        usable.find(s => s.index === selectedIndex)
        ?? usable[0]
        ?? null;

    const swatch = trigger.querySelector(".cs-swatch");
    const text = trigger.querySelector(".cs-text");

    if (selected) {
        const hex = slotHex(selected) ?? "#00000000";
        if (swatch) swatch.style.background = hex;
        if (text) {
            text.textContent = formatSlotLabel(selected);
        }
        trigger.classList.toggle("inactive-slot", !isSlotEnabled(selected));
    } else {
        if (swatch) swatch.style.background = "transparent";
        if (text) text.textContent = "No slots";
    }

    dropdown.innerHTML = "";

    for (const slot of usable) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "custom-select-option";
        if (selected && slot.index === selected.index) btn.classList.add("selected");
        if (!isSlotEnabled(slot)) btn.classList.add("inactive-slot");

        const hex = slotHex(slot) ?? "#00000000";
        btn.appendChild(makeSwatchEl(hex, { muted: !isSlotEnabled(slot) }));

        const label = document.createElement("span");
        label.className = "cs-text";
        label.textContent =
            `${slot.runtimeName} · ${describeColorName(slotRgba(slot))}`;

        const value = document.createElement("span");
        value.className = "cs-value";
        value.textContent = hex;

        btn.append(label, value);
        btn.addEventListener("click", () => {
            dropdown.classList.add("hidden");
            trigger.classList.remove("open");
            onSelect(slot.index);
        });
        dropdown.appendChild(btn);
    }

    trigger.onclick = e => {
        e.stopPropagation();
        const open = dropdown.classList.toggle("hidden") === false;
        trigger.classList.toggle("open", open);
    };
}

function buildTargetSlotList(container, {
    slots,
    selectedIndexes,
    onChange,
}) {
    if (!container) return;
    container.innerHTML = "";

    for (const slot of slots) {
        const label = document.createElement("label");
        label.className = "target-slot-item";
        if (!isSlotEnabled(slot)) label.classList.add("inactive-slot");

        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = selectedIndexes.includes(slot.index);
        check.addEventListener("change", () => {
            const next = new Set(selectedIndexes);
            if (check.checked) next.add(slot.index);
            else next.delete(slot.index);
            onChange([...next].sort((a, b) => a - b));
        });

        const hex = slotHex(slot) ?? "#00000000";
        const swatch = document.createElement("span");
        swatch.className = "target-slot-swatch";
        swatch.style.background = hex;

        const text = document.createElement("span");
        text.className = "target-slot-text";
        text.innerHTML =
            `<strong>${slot.runtimeName}</strong>`
            + `<small>${describeColorName(slotRgba(slot))} · ${hex}</small>`;

        label.append(check, swatch, text);
        container.appendChild(label);
    }
}

function buildCmdCheckList(container, {
    selectedIndexes,
    onChange,
}) {
    if (!container) return;
    container.innerHTML = "";

    state.cmdEntries.forEach((cmd, index) => {
        const label = document.createElement("label");
        label.className = "target-cmd-item";

        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = selectedIndexes.includes(index);
        check.addEventListener("change", () => {
            const next = new Set(selectedIndexes);
            if (check.checked) next.add(index);
            else next.delete(index);
            onChange([...next].sort((a, b) => a - b));
        });

        const text = document.createElement("span");
        text.textContent = `${cmdShortName(cmd)} — ${cmd.file.name}`;

        label.append(check, text);
        container.appendChild(label);
    });
}

function getCommonColorsForCmd(cmdEntry, limit = 4) {
    if (!cmdEntry?.colorClusters) return [];

    // SF6 placeholder / "nothing selected" gray — not a real palette color.
    const IGNORED_COMMON_HEX = new Set([
        "#BABABAFF",
        "#BBBBBBFF",
    ]);

    const counts = new Map();

    for (const cluster of cmdEntry.colorClusters) {
        for (const slot of cluster.colors ?? []) {
            if (!isSlotEditable(slot)) continue;
            if (!isSlotEnabled(slot)) continue;
            const hex = slotHex(slot);
            if (!hex) continue;
            if (IGNORED_COMMON_HEX.has(hex.toUpperCase())) continue;
            const entry = counts.get(hex) ?? {
                hex,
                rgba: slotRgba(slot),
                count: 0,
                name: describeColorName(slotRgba(slot)),
            };
            entry.count += 1;
            counts.set(hex, entry);
        }
    }

    return [...counts.values()]
        .sort((a, b) => {
            if (b.count !== a.count) return b.count - a.count;
            return a.hex.localeCompare(b.hex);
        })
        .slice(0, limit);
}

async function copyHexToClipboard(hex) {
    const text = String(hex || "").toUpperCase();
    if (!text) return false;

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // fall through
    }

    try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
    } catch {
        return false;
    }
}

function renderCommonPaletteInto(container, colors) {
    if (!container) return;
    container.innerHTML = "";

    if (!colors.length) {
        const empty = document.createElement("span");
        empty.className = "common-palette-empty";
        empty.textContent = "No colors yet";
        container.appendChild(empty);
        return;
    }

    for (const color of colors) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "common-palette-swatch";
        btn.style.background = color.hex;
        btn.title = `${color.hex} · ${color.name} · ${color.count}× — click to copy`;
        btn.setAttribute(
            "aria-label",
            `Copy ${color.hex}, ${color.name}, used ${color.count} times`,
        );

        const tip = document.createElement("span");
        tip.className = "common-palette-tooltip";
        tip.textContent = color.hex;

        btn.appendChild(tip);

        btn.addEventListener("click", async () => {
            const ok = await copyHexToClipboard(color.hex);
            btn.classList.add(ok ? "copied" : "copy-failed");
            tip.textContent = ok ? "Copied" : "Copy failed";
            setTimeout(() => {
                btn.classList.remove("copied", "copy-failed");
                tip.textContent = color.hex;
            }, 900);
        });

        container.appendChild(btn);
    }
}

function renderCommonPalettes() {
    const cmd = state.cmdEntries[state.activeCmdIndex];
    const colors = cmd ? getCommonColorsForCmd(cmd, 4) : [];

    document.querySelectorAll("[data-common-palette]").forEach(root => {
        const host = root.querySelector("[data-common-palette-swatches]") || root;
        renderCommonPaletteInto(host, colors);
        root.classList.toggle("is-empty", colors.length === 0);
    });
}

function renderSyncPanels() {
    if (!state.cmdEntries.length) return;

    const activeCmd = state.cmdEntries[state.activeCmdIndex] ?? state.cmdEntries[0];

    // mode tabs
    document.querySelectorAll("[data-sync-mode]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.syncMode === state.syncMode);
    });
    document.querySelector("#color-sync-pane")
        ?.classList.toggle("hidden", state.syncMode !== "color");
    document.querySelector("#pattern-sync-pane")
        ?.classList.toggle("hidden", state.syncMode !== "pattern");

    // ---- Color Sync (active CMD only)
    const cs = state.colorSync;
    const activeLabel = cmdDisplayName(activeCmd);
    const colorActiveLabel = document.querySelector("#color-sync-active-label");
    if (colorActiveLabel) {
        colorActiveLabel.textContent = activeLabel;
    }
    if (replaceActiveLabel) {
        replaceActiveLabel.textContent = activeLabel;
    }

    renderCommonPalettes();

    cs.sourceMaterial = buildMaterialDropdown(
        document.querySelector("#color-source-material"),
        {
            selectedName: cs.sourceMaterial,
            onSelect: name => {
                cs.sourceMaterial = name;
                cs.sourceSlotIndex = firstEnabledSlotIndex(listSlots(activeCmd, name));
                renderSyncPanels();
            },
        },
    ) ?? cs.sourceMaterial;

    cs.targetMaterial = buildMaterialDropdown(
        document.querySelector("#color-target-material"),
        {
            selectedName: cs.targetMaterial,
            onSelect: name => {
                cs.targetMaterial = name;
                cs.targetSlotIndexes = [];
                renderSyncPanels();
            },
        },
    ) ?? cs.targetMaterial;

    const colorSourceSlots = listSlots(activeCmd, cs.sourceMaterial);
    if (!colorSourceSlots.some(s => s.index === cs.sourceSlotIndex)) {
        cs.sourceSlotIndex = firstEnabledSlotIndex(colorSourceSlots);
    }

    buildSlotDropdown(document.querySelector("#color-source-slot"), {
        slots: colorSourceSlots,
        selectedIndex: cs.sourceSlotIndex,
        onSelect: index => {
            cs.sourceSlotIndex = index;
            renderSyncPanels();
        },
    });

    // live source swatch + hex
    const srcSlot = getColorSlot(activeCmd, cs.sourceMaterial, cs.sourceSlotIndex);
    const srcHex = slotHex(srcSlot) ?? "#000000FF";
    const srcPicker = document.querySelector("#color-source-color-picker");
    const srcHexInput = document.querySelector("#color-source-color-hex");
    if (srcPicker) {
        srcPicker.style.background = srcHex;
        srcPicker.disabled = !isSlotEditable(srcSlot) || !isSlotEnabled(srcSlot);
    }
    if (srcHexInput) {
        srcHexInput.value = srcHex;
        srcHexInput.disabled = !isSlotEditable(srcSlot) || !isSlotEnabled(srcSlot);
    }

    const colorTargetSlots = listSlots(activeCmd, cs.targetMaterial);
    cs.targetSlotIndexes = cs.targetSlotIndexes.filter(i =>
        colorTargetSlots.some(s => s.index === i),
    );

    buildTargetSlotList(document.querySelector("#color-target-slots"), {
        slots: colorTargetSlots,
        selectedIndexes: cs.targetSlotIndexes,
        onChange: indexes => {
            cs.targetSlotIndexes = indexes;
        },
    });

    // ---- Pattern Sync
    const ps = state.patternSync;
    const patternReferenceLabel = document.querySelector("#pattern-reference-label");
    if (patternReferenceLabel) {
        patternReferenceLabel.textContent = activeLabel;
    }

    ps.sourceMaterial = buildMaterialDropdown(
        document.querySelector("#pattern-source-material"),
        {
            selectedName: ps.sourceMaterial,
            onSelect: name => {
                ps.sourceMaterial = name;
                ps.sourceSlotIndex = firstEnabledSlotIndex(listSlots(activeCmd, name));
                renderSyncPanels();
            },
        },
    ) ?? ps.sourceMaterial;

    ps.targetMaterial = buildMaterialDropdown(
        document.querySelector("#pattern-target-material"),
        {
            selectedName: ps.targetMaterial,
            onSelect: name => {
                ps.targetMaterial = name;
                ps.targetSlotIndexes = [];
                renderSyncPanels();
            },
        },
    ) ?? ps.targetMaterial;

    // Pattern Sync's mapping is shared, but its controls should describe the
    // active CMD currently shown to the user. Using the first loaded CMD here
    // made the selector swatch disagree with the active-CMD color preview.
    const patternSourceSlots = listSlots(activeCmd, ps.sourceMaterial);
    if (!patternSourceSlots.some(s => s.index === ps.sourceSlotIndex)) {
        ps.sourceSlotIndex = firstEnabledSlotIndex(patternSourceSlots);
    }

    buildSlotDropdown(document.querySelector("#pattern-source-slot"), {
        slots: patternSourceSlots,
        selectedIndex: ps.sourceSlotIndex,
        onSelect: index => {
            ps.sourceSlotIndex = index;
            renderSyncPanels();
        },
    });

    // pattern source preview uses active CMD values when possible
    const patternPreviewCmd = activeCmd;
    const pSrc = getColorSlot(
        patternPreviewCmd,
        ps.sourceMaterial,
        ps.sourceSlotIndex,
    );
    const pHex = slotHex(pSrc) ?? "#000000FF";
    const pPicker = document.querySelector("#pattern-source-color-picker");
    const pHexInput = document.querySelector("#pattern-source-color-hex");
    if (pPicker) pPicker.style.background = pHex;
    if (pHexInput) pHexInput.value = pHex;

    const patternNote = document.querySelector("#pattern-source-note");
    if (patternNote) {
        patternNote.textContent =
            "This CMD provides the controls and preview. Each selected CMD uses its own color from this material/slot.";
    }

    const patternTargetSlots = listSlots(activeCmd, ps.targetMaterial);
    ps.targetSlotIndexes = ps.targetSlotIndexes.filter(i =>
        patternTargetSlots.some(s => s.index === i),
    );

    buildTargetSlotList(document.querySelector("#pattern-target-slots"), {
        slots: patternTargetSlots,
        selectedIndexes: ps.targetSlotIndexes,
        onChange: indexes => {
            ps.targetSlotIndexes = indexes;
        },
    });

    ps.targetCmdIndexes = ps.targetCmdIndexes.filter(i =>
        i >= 0 && i < state.cmdEntries.length,
    );
    if (ps.targetCmdIndexes.length === 0) {
        ps.targetCmdIndexes = state.cmdEntries.map((_, i) => i);
    }

    buildCmdCheckList(document.querySelector("#pattern-target-cmds"), {
        selectedIndexes: ps.targetCmdIndexes,
        onChange: indexes => {
            ps.targetCmdIndexes = indexes;
        },
    });
}


// ============================================================
// @anchor events-boot
// EVENTS
// ============================================================

function bindDropZone(zone, onFiles) {
    if (!zone) return;

    zone.addEventListener("click", () => {
        const input = zone.querySelector('input[type="file"]') || fileInput;
        input?.click();
    });

    zone.addEventListener("dragover", e => {
        e.preventDefault();
        zone.classList.add("dragover");
    });

    zone.addEventListener("dragleave", () => {
        zone.classList.remove("dragover");
    });

    zone.addEventListener("drop", async e => {
        e.preventDefault();
        zone.classList.remove("dragover");
        const files = e.dataTransfer?.files;
        if (files?.length) await onFiles(files);
    });
}

function bindUi() {
    initializeHexActionButtons();
    bindDropZone(dropZone, async files => {
        try {
            await handleFiles(files);
        } catch (error) {
            console.error(error);
            showStatus(parserStatus, "bad", error.message || String(error));
            parserPanel?.classList.remove("hidden");
            revealStatus(parserStatus);
        }
    });

    fileInput?.addEventListener("change", async () => {
        try {
            await handleFiles(fileInput.files);
        } catch (error) {
            console.error(error);
            showStatus(parserStatus, "bad", error.message || String(error));
            parserPanel?.classList.remove("hidden");
            revealStatus(parserStatus);
        } finally {
            fileInput.value = "";
        }
    });

    fileList?.addEventListener("click", async e => {
        const button = e.target.closest("[data-unload-cmd]");
        if (button) await unloadCmd(Number(button.dataset.unloadCmd));
    });

    unloadAllCmdsBtn?.addEventListener("click", () => {
        unloadAllCmds();
    });

    const bindExportFolder = (kind, chooseButton, clearButton) => {
        chooseButton?.addEventListener("click", async () => {
            try {
                await chooseExportFolder(kind);
                await refreshExportDestinationUi();
            } catch (error) {
                if (error.name !== "AbortError") {
                    showStatus(buildStatus, "bad", error.message || String(error));
                }
            }
        });
        clearButton?.addEventListener("click", async () => {
            await clearExportFolder(kind);
            await refreshExportDestinationUi();
        });
    };
    bindExportFolder("cmd", chooseCmdExportFolderBtn, clearCmdExportFolderBtn);
    bindExportFolder("zip", chooseZipExportFolderBtn, clearZipExportFolderBtn);

    expandAllClustersBtn?.addEventListener("click", () => {
        clusterInspector
            ?.querySelectorAll("details.cluster-card")
            .forEach(el => { el.open = true; });
    });

    collapseAllClustersBtn?.addEventListener("click", () => {
        clusterInspector
            ?.querySelectorAll("details.cluster-card")
            .forEach(el => { el.open = false; });
    });

    saveCmdInspectorBtn?.addEventListener("click", () => {
        state.inspectorDirty = false;
        updateInspectorDirtyUi();
        showStatus(parserStatus, "good", "Color edits kept in working buffers.");
    });

    discardCmdInspectorBtn?.addEventListener("click", () => {
        const cmd = state.cmdEntries[state.activeCmdIndex];
        if (!cmd) return;

        new Uint8Array(cmd.workingBuffer).set(new Uint8Array(cmd.originalBuffer));
        for (const cluster of cmd.colorClusters) {
            for (const color of cluster.colors) {
                const offset = color.color?.absoluteOffset;
                if (!Number.isInteger(offset)) continue;
                updateColorModelAtOffset(
                    cmd,
                    offset,
                    rgbaAtOffset(cmd.originalBuffer, offset),
                );
            }
        }

        state.inspectorDirty = false;
        updateInspectorDirtyUi();
        renderColorClusters(cmd.colorClusters);
        renderCurrentChanges();
        renderSyncPanels();
        updateExportButtons();
    });

    document.querySelectorAll("[data-sync-mode]").forEach(btn => {
        btn.addEventListener("click", () => {
            state.syncMode = btn.dataset.syncMode;
            renderSyncPanels();
        });
    });

    document.querySelector("#color-target-select-all")
        ?.addEventListener("click", () => {
            const cmd = state.cmdEntries[state.activeCmdIndex];
            const slots = listSlots(cmd, state.colorSync.targetMaterial);
            state.colorSync.targetSlotIndexes = slots.map(s => s.index);
            renderSyncPanels();
        });

    document.querySelector("#color-target-select-none")
        ?.addEventListener("click", () => {
            state.colorSync.targetSlotIndexes = [];
            renderSyncPanels();
        });

    document.querySelector("#pattern-target-select-all")
        ?.addEventListener("click", () => {
            const slots = listSlots(
                state.cmdEntries[state.activeCmdIndex] ?? state.cmdEntries[0],
                state.patternSync.targetMaterial,
            );
            state.patternSync.targetSlotIndexes = slots.map(s => s.index);
            renderSyncPanels();
        });

    document.querySelector("#pattern-target-select-none")
        ?.addEventListener("click", () => {
            state.patternSync.targetSlotIndexes = [];
            renderSyncPanels();
        });

    document.querySelector("#pattern-cmd-select-all")
        ?.addEventListener("click", () => {
            state.patternSync.targetCmdIndexes = state.cmdEntries.map((_, i) => i);
            renderSyncPanels();
        });

    document.querySelector("#pattern-cmd-select-none")
        ?.addEventListener("click", () => {
            state.patternSync.targetCmdIndexes = [];
            renderSyncPanels();
        });

    // source color edit (color sync only — writes active CMD source slot)
    document.querySelector("#color-source-color-hex")
        ?.addEventListener("change", e => {
            const rgba = parseRgbaHex(e.target.value);
            if (!rgba) {
                e.target.classList.add("invalid");
                return;
            }
            e.target.classList.remove("invalid");
            const cmd = state.cmdEntries[state.activeCmdIndex];
            const ok = setCmdColorSlot(
                cmd,
                state.colorSync.sourceMaterial,
                state.colorSync.sourceSlotIndex,
                rgba,
                { forceEnable: true },
            );
            if (!ok) return;
            state.inspectorDirty = true;
            updateInspectorDirtyUi();
            renderColorClusters(cmd.colorClusters);
            renderCurrentChanges();
            renderSyncPanels();
            updateExportButtons();
        });

    document.querySelector("#color-source-color-picker")
        ?.addEventListener("click", e => {
            const cmd = state.cmdEntries[state.activeCmdIndex];
            const slot = getColorSlot(
                cmd,
                state.colorSync.sourceMaterial,
                state.colorSync.sourceSlotIndex,
            );
            if (!isSlotEditable(slot) || !isSlotEnabled(slot)) return;

            openCustomColorPicker(e.currentTarget, slotRgba(slot), rgba => {
                setCmdColorSlot(
                    cmd,
                    state.colorSync.sourceMaterial,
                    state.colorSync.sourceSlotIndex,
                    rgba,
                    { forceEnable: true },
                );
                state.inspectorDirty = true;
                updateInspectorDirtyUi();
                renderColorClusters(cmd.colorClusters);
                renderCurrentChanges();
                renderSyncPanels();
                updateExportButtons();
            });
        });

    document.querySelector("#apply-color-sync")
        ?.addEventListener("click", () => {
            try {
                const result = applyColorSync();
                const n = result.filter(r => r.changed).length;
                showStatus(
                    applyStatus,
                    "good",
                    `Color Sync applied ${n} slot write${n === 1 ? "" : "s"} on active CMD.`,
                );
            } catch (error) {
                console.error(error);
                showStatus(applyStatus, "bad", error.message || String(error));
            }
        });

    document.querySelector("#apply-pattern-sync")
        ?.addEventListener("click", () => {
            try {
                const { applied, skippedDisabled, results } = applyPatternSync();
                const files = results.filter(r => r.status === "applied").length;
                let msg =
                    `Pattern Sync updated ${applied} slot write${applied === 1 ? "" : "s"}`
                    + ` across ${files} CMD${files === 1 ? "" : "s"}.`;
                if (skippedDisabled) {
                    msg += ` Skipped ${skippedDisabled} inactive source${skippedDisabled === 1 ? "" : "s"}.`;
                }
                showStatus(applyStatus, "good", msg);
            } catch (error) {
                console.error(error);
                showStatus(applyStatus, "bad", error.message || String(error));
            }
        });

    exportCmdButton?.addEventListener("click", async () => {
        try {
            showStatus(exportCmdStatus, "", "Exporting modified CMD files…");
            const exported = await exportModifiedCmdFiles();
            showTemporaryStatus(
                exportCmdStatus,
                "good",
                describeCmdExport(exported),
            );
            revealExportStatus(exportCmdStatus);
        } catch (error) {
            console.error(error);
            showStatus(exportCmdStatus, "bad", error.message || String(error));
        }
    });

    buildButton?.addEventListener("click", async () => {
        try {
            showStatus(buildStatus, "", "Building mod ZIP…");
            const result = await buildModZip();
            showTemporaryStatus(
                buildStatus,
                "good",
                describeZipExport(result),
            );
            revealExportStatus(buildStatus);
        } catch (error) {
            console.error(error);
            showStatus(buildStatus, "bad", error.message || String(error));
        }
    });

    revertAllChangesBtn?.addEventListener("click", () => {
        revertAllChanges();
    });

    // screenshot
    screenshotDropZone?.addEventListener("click", () => screenshotFileInput?.click());
    screenshotFileInput?.addEventListener("change", () => {
        const file = screenshotFileInput.files?.[0];
        if (file) setScreenshot(file);
        screenshotFileInput.value = "";
    });
    screenshotDropZone?.addEventListener("dragover", e => {
        e.preventDefault();
        screenshotDropZone.classList.add("dragover");
    });
    screenshotDropZone?.addEventListener("dragleave", () => {
        screenshotDropZone.classList.remove("dragover");
    });
    screenshotDropZone?.addEventListener("drop", e => {
        e.preventDefault();
        screenshotDropZone.classList.remove("dragover");
        const file = e.dataTransfer?.files?.[0];
        if (file) setScreenshot(file);
    });

    // reference viewer
    const stepReference = (delta) => {
        const total = state.referenceImages.length;
        if (total <= 0) return;
        state.referenceImageIndex =
            (state.referenceImageIndex + delta + total) % total;
        renderReferenceViewer();
    };

    referenceViewerPrev?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        stepReference(-1);
    });
    referenceViewerNext?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        stepReference(1);
    });
    window.addEventListener("keydown", (event) => {
        if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
        if (state.referenceMinimized || state.referenceImages.length < 2) return;

        const target = event.target;
        if (target instanceof HTMLElement && target.matches("input, textarea, select, [contenteditable='true']")) return;

        if (event.key === "ArrowLeft" || event.code === "ArrowLeft") {
            event.preventDefault();
            stepReference(-1);
        } else if (event.key === "ArrowRight" || event.code === "ArrowRight") {
            event.preventDefault();
            stepReference(1);
        }
    }, { capture: true });
    referenceViewerMinimize?.addEventListener("click", () => {
        state.referenceMinimized = true;
        saveUiState({ referenceMinimized: true });
        renderReferenceViewer();
    });
    referenceViewerRestore?.addEventListener("click", () => {
        state.referenceMinimized = false;
        saveUiState({ referenceMinimized: false });
        renderReferenceViewer();
    });
    referenceViewerAdd?.addEventListener("click", () => referenceImageInput?.click());
    referenceImageInput?.addEventListener("change", async () => {
        const files = Array.from(referenceImageInput.files ?? []);
        for (const file of files) {
            const url = URL.createObjectURL(file);
            state.referenceImages.push({
                src: url,
                label: file.name,
                type: "custom",
            });
        }
        if (files.length) {
            state.referenceImageIndex = state.referenceImages.length - 1;
            state.referenceMinimized = false;
            saveUiState({ referenceMinimized: false });
            renderReferenceViewer();
        }
        referenceImageInput.value = "";
    });

    parsedDataDetails?.addEventListener("toggle", () => {
        saveUiState({ parsedDataOpen: parsedDataDetails.open });
        const hint = parsedDataDetails.querySelector(".collapsible-section-hint");
        if (hint) {
            hint.textContent = parsedDataDetails.open
                ? "click to collapse"
                : "click to expand";
        }
    });

    additionalFileOptions?.addEventListener("toggle", () => {
        saveUiState({ additionalFileOptionsOpen: additionalFileOptions.open });
        const hint = additionalFileOptions.querySelector(".collapsible-section-hint");
        if (hint) {
            hint.textContent = additionalFileOptions.open
                ? "click to collapse"
                : "click to expand";
        }
    });

    replaceDuplicateExportsInput?.addEventListener("change", () => {
        saveUiState({ replaceDuplicateExports: replaceDuplicateExportsInput.checked });
    });

    document.querySelectorAll("[data-jump]").forEach(link => {
        link.addEventListener("click", event => {
            event.preventDefault();
            jumpToSelector(link.getAttribute("data-jump"));
        });
    });

    document.addEventListener("click", async event => {
        const button = event.target.closest(".hex-action-button");
        if (!button) return;
        event.stopPropagation();
        const input = button.closest(".hex-input-control")?.querySelector("input[type='text']");
        if (button.dataset.hexAction === "copy") await copyHexInput(input);
        else await pasteIntoHexInput(input);
    });

    document.addEventListener("click", () => {
        document.querySelectorAll(".custom-select-dropdown").forEach(el => {
            el.classList.add("hidden");
        });
        document.querySelectorAll(".custom-select-trigger.open").forEach(el => {
            el.classList.remove("open");
        });
    });

    bindColorPickerEvents();
    bindReplaceColorUi();
    bindReferenceViewerResize();
}

function setScreenshot(file) {
    if (state.screenshotObjectUrl) {
        URL.revokeObjectURL(state.screenshotObjectUrl);
    }
    state.screenshotFile = file;
    state.screenshotZipName = screenshotZipEntryName(file);
    state.screenshotObjectUrl = URL.createObjectURL(file);
    if (screenshotPreview) screenshotPreview.src = state.screenshotObjectUrl;
    screenshotPreviewWrap?.classList.remove("hidden");
    if (screenshotStatus) {
        screenshotStatus.textContent =
            `${file.name} → ${state.screenshotZipName}`;
    }
}


// ============================================================
// @anchor events-boot
// BOOT
// ============================================================

applyPersistedUiState();
bindUi();
refreshExportDestinationUi().catch(error => {
    console.warn("Could not load saved export folders", error);
});
console.log("SF6 CMD Color Sync initialized.");
