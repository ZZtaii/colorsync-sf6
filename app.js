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

import { unzip } from "./lib/fflate.js";
import { createCompressedZip } from "./lib/zip-archive.js";
import {
    colorsOnlyZipFilename,
    findOwningModinfoPath,
    nearestArchiveRoot,
    withOnlyColorsSuffix,
} from "./lib/mod-archive.js";
import {
    colorBackupDateLabel,
    emptyColorBackupManifest,
    isColorBackupPath,
    readColorBackupManifest,
    safeArchiveRelativePath,
    writeColorBackupSnapshots,
} from "./lib/color-backups.js";
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
import {
    cmdRgbaToRuntimeRgba,
} from "./lib/sf6-color-space.js";


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
    /^esf(?<esf>\d{3})_(?<costume>\d{3})_cmd_(?:(?<variant>ex|dx)_)?(?<palette>\d{3})\.user\.(?<version>\d+)$/i;
const CMD_VARIANT_ORDER = { standard: 0, ex: 1, dx: 2 };
const MAX_MOD_ZIP_BYTES = 200 * 1024 * 1024;
const MAX_MOD_UNPACKED_BYTES = 300 * 1024 * 1024;


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
    // Material expansion is a workspace view preference, shared as the user
    // moves between loaded CMD palettes.
    openClusterNames: new Set(),
    surpriseSnapshots: new Map(),

    inspectorDirty: false,

    referenceImages: [],
    referenceImageIndex: 0,
    referenceLoading: false,
    referenceMinimized: false,
    referenceWidth: null,

    screenshotFile: null,
    screenshotObjectUrl: null,
    screenshotZipName: null,
    // When CMDs came from a mod archive, retain every original entry so ZIP
    // export only changes the edited CMDs and modinfo.ini.
    importedMod: null,
    rememberedColorLibraryHandle: null,
    rememberedColorLibraryFile: null,

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
    originalRgba: [255, 255, 255, 255],
    onChange: null,
    onClose: null,
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
const zipImportProgress = document.querySelector("#zip-import-progress");
const zipImportProgressLabel = document.querySelector("#zip-import-progress-label");
const zipImportProgressBar = document.querySelector("#zip-import-progress-bar");
const colorLibraryPanel = document.querySelector("#color-library-panel");
const colorLibraryHeading = document.querySelector("#color-library-heading");
const colorLibraryDetection = document.querySelector("#color-library-detection");
const colorLibraryTargetField = document.querySelector("#color-library-target-field");
const colorLibraryTargetSelect = document.querySelector("#color-library-target");
const colorLibraryInput = document.querySelector("#color-library-input");
const colorLibraryDropZone = document.querySelector("#color-library-drop-zone");
const rememberColorLibraryInput = document.querySelector("#remember-color-library");
const rememberColorLibraryField = document.querySelector("#remember-color-library-field");
const forgetColorLibraryButton = document.querySelector("#forget-color-library");
const colorLibraryOptions = document.querySelector("#color-library-options");
const parserPanel = document.querySelector("#parser-panel");
const parserStatus = document.querySelector("#parser-status");
const dxReferenceWarning = document.querySelector("#dx-reference-warning");
const fileSummary = document.querySelector("#file-summary");
const fileList = document.querySelector("#file-list");
const unloadAllCmdsBtn = document.querySelector("#unload-all-cmds");
const colorBackupPanel = document.querySelector("#color-backup-panel");
const colorBackupCount = document.querySelector("#color-backup-count");
const colorBackupList = document.querySelector("#color-backup-list");
const colorBackupStatus = document.querySelector("#color-backup-status");
const additionalFileOptions = document.querySelector("#additional-file-options");
const detectedCharacter = document.querySelector("#detected-character");
const colorPanel = document.querySelector("#color-panel");
const clusterInspector = document.querySelector("#cluster-inspector");
const outputPanel = document.querySelector("#output-panel");
const buildButton = document.querySelector("#build-button");
const exportCmdButton = document.querySelector("#export-cmd-button");
const exportColorsZipButton = document.querySelector("#export-colors-zip-button");
const buildStatus = document.querySelector("#build-status");
const exportCmdStatus = document.querySelector("#export-cmd-status");
const zipExportProgress = document.querySelector("#zip-export-progress");
const zipExportProgressLabel = document.querySelector("#zip-export-progress-label");
const zipExportProgressTrack = document.querySelector("#zip-export-progress-track");
const zipExportProgressBar = document.querySelector("#zip-export-progress-bar");
const applyStatus = document.querySelector("#apply-status");
const cmdExportFolderName = document.querySelector("#cmd-export-folder-name");
const zipExportFolderName = document.querySelector("#zip-export-folder-name");
const chooseCmdExportFolderBtn = document.querySelector("#choose-cmd-export-folder");
const clearCmdExportFolderBtn = document.querySelector("#clear-cmd-export-folder");
const chooseZipExportFolderBtn = document.querySelector("#choose-zip-export-folder");
const clearZipExportFolderBtn = document.querySelector("#clear-zip-export-folder");
const replaceDuplicateExportsInput = document.querySelector("#replace-duplicate-exports");

const activeCmdSelect = document.querySelector("#active-cmd-select");
const colorSyncActiveCmdSelect = document.querySelector("#color-sync-active-cmd");
const patternSyncActiveCmdSelect = document.querySelector("#pattern-sync-active-cmd");
const replaceActiveCmdSelect = document.querySelector("#replace-active-cmd");
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
const zipFileNameInput = document.querySelector("#zip-file-name");
const zipFileNameField = zipFileNameInput?.closest("label");

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
const sectionRail = document.querySelector(".section-rail");
const sectionRailLinks = [...document.querySelectorAll("[data-section-target]")];

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
const colorPickerOriginalSwatch = document.querySelector("#color-picker-original-swatch");
const colorPickerOriginalHex = document.querySelector("#color-picker-original-hex");
const colorPickerOriginalName = document.querySelector("#color-picker-original-name");
const colorPickerOriginalRestore = document.querySelector("#color-picker-original-restore");
const colorPickerRuntimeSwatch = document.querySelector("#color-picker-runtime-swatch");
const colorPickerRuntimeHex = document.querySelector("#color-picker-runtime-hex");
const colorPickerRuntimeName = document.querySelector("#color-picker-runtime-name");


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
    if (!includeName) return `${base} · ${hex}`;
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

function sectionRailTarget(link) {
    return document.querySelector(link?.dataset?.sectionTarget || "");
}

function updateSectionRailAvailability() {
    sectionRailLinks.forEach(link => {
        const target = sectionRailTarget(link);
        const unavailable = !target || target.classList.contains("hidden");
        link.classList.toggle("is-disabled", unavailable);
        link.setAttribute("aria-disabled", String(unavailable));
        if (unavailable) link.setAttribute("tabindex", "-1");
        else link.removeAttribute("tabindex");
    });
}

function updateActiveSectionRailLink() {
    const available = sectionRailLinks
        .map(link => ({ link, target: sectionRailTarget(link) }))
        .filter(item => item.target && !item.target.classList.contains("hidden"))
        .sort((a, b) => a.target.offsetTop - b.target.offsetTop);
    if (!available.length) return;

    const marker = window.innerHeight * 0.32;
    let active = available[0];
    for (const item of available) {
        if (item.target.getBoundingClientRect().top <= marker) active = item;
        else break;
    }
    sectionRailLinks.forEach(link => {
        const selected = link === active.link;
        link.classList.toggle("is-active", selected);
        if (selected) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
    });
}

function jumpToAvailableSection(link) {
    const target = sectionRailTarget(link);
    if (!target || target.classList.contains("hidden")) return false;
    target.scrollIntoView({ behavior: "auto", block: "start" });
    updateActiveSectionRailLink();
    target.classList.remove("section-flash");
    requestAnimationFrame(() => target.classList.add("section-flash"));
    setTimeout(() => target.classList.remove("section-flash"), 1200);
    return true;
}

function isSectionShortcutBlocked(event) {
    if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return true;
    if (!/^[1-5]$/.test(event.key)) return true;
    if (!customColorPicker?.classList.contains("hidden")) return true;
    return Boolean(event.target?.closest?.(
        "input, textarea, select, button, [contenteditable='true'], [role='textbox'], [role='listbox']",
    ));
}

function bindSectionRail() {
    if (!sectionRail) return;
    sectionRailLinks.forEach(link => {
        link.addEventListener("click", event => {
            event.preventDefault();
            jumpToAvailableSection(link);
        });
    });
    document.addEventListener("keydown", event => {
        if (isSectionShortcutBlocked(event)) return;
        const link = sectionRailLinks.find(item => item.getAttribute("aria-keyshortcuts") === event.key);
        if (!link || !jumpToAvailableSection(link)) return;
        event.preventDefault();
    });

    let scrollFrame = 0;
    const scheduleActiveUpdate = () => {
        if (scrollFrame) return;
        scrollFrame = requestAnimationFrame(() => {
            scrollFrame = 0;
            updateSectionRailAvailability();
            updateActiveSectionRailLink();
        });
    };
    window.addEventListener("scroll", scheduleActiveUpdate, { passive: true });
    window.addEventListener("resize", scheduleActiveUpdate);
    new MutationObserver(scheduleActiveUpdate).observe(document.querySelector("main"), {
        attributes: true,
        attributeFilter: ["class"],
        subtree: true,
    });
    updateSectionRailAvailability();
    updateActiveSectionRailLink();
}

function zipEntryBaseName(path) {
    return String(path || "").replace(/\\/g, "/").split("/").pop();
}

function zipEntryDirectory(path) {
    const normalized = String(path || "").replace(/\\/g, "/");
    const slash = normalized.lastIndexOf("/");
    return slash >= 0 ? normalized.slice(0, slash + 1) : "";
}

function imageMimeType(path) {
    if (/\.png$/i.test(path)) return "image/png";
    if (/\.jpe?g$/i.test(path)) return "image/jpeg";
    if (/\.webp$/i.test(path)) return "image/webp";
    return "application/octet-stream";
}

function parseModinfoValue(text, key) {
    const match = String(text || "").match(new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, "im"));
    return match ? match[1].trim() : "";
}

function buildModinfo(text, { name, description, author, screenshot }) {
    const values = { name, description, author, screenshot };
    const seen = new Set();
    const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
    const output = lines.map(line => {
        const match = line.match(/^(\s*)(name|description|author|screenshot)\s*=/i);
        if (!match) return line;
        const key = match[2].toLowerCase();
        seen.add(key);
        return `${match[1]}${key}=${values[key] || ""}`;
    });
    for (const key of ["name", "description", "author", "screenshot"]) {
        if (!seen.has(key) && values[key]) output.push(`${key}=${values[key]}`);
    }
    return `${output.filter((line, index, all) => line || index < all.length - 1).join("\n").replace(/\n+$/, "")}\n`;
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
    const zipLabel = result.colorsOnly ? "colors-only ZIP" : "mod ZIP";
    if (destination.mode === "download") {
        return `Built ${zipLabel} with ${fileLabel}; sent “${destination.filename}” to browser downloads.`;
    }

    let message = `Built ${zipLabel} with ${fileLabel}. Saved to your selected Mod ZIP folder: “${destination.folderName}/${destination.filename}”.`;
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
        isExtra: match.groups.variant?.toLowerCase() === "ex",
        isDxReference: match.groups.variant?.toLowerCase() === "dx",
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

function unzipArchive(bytes) {
    return new Promise((resolve, reject) => {
        unzip(bytes, (error, files) => {
            if (error) reject(error);
            else resolve(files);
        });
    });
}

function setZipImportProgress(label, percent = 0, { indeterminate = false } = {}) {
    zipImportProgress?.classList.remove("hidden");
    if (zipImportProgressLabel) zipImportProgressLabel.textContent = label;
    if (zipImportProgressBar) {
        zipImportProgressBar.classList.toggle("is-indeterminate", indeterminate);
        if (!indeterminate) zipImportProgressBar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }
}

function hideZipImportProgress() {
    zipImportProgress?.classList.add("hidden");
    zipImportProgressBar?.classList.remove("is-indeterminate");
    if (zipImportProgressBar) zipImportProgressBar.style.width = "0";
}

function setZipExportProgress(percent = 0) {
    const boundedPercent = Math.max(0, Math.min(100, Math.round(percent)));
    zipExportProgress?.classList.remove("hidden");
    if (zipExportProgressLabel) zipExportProgressLabel.textContent = `Compressing mod ZIP… ${boundedPercent}%`;
    if (zipExportProgressBar) zipExportProgressBar.style.width = `${boundedPercent}%`;
    zipExportProgressTrack?.setAttribute("aria-valuenow", String(boundedPercent));
}

function hideZipExportProgress() {
    zipExportProgress?.classList.add("hidden");
    if (zipExportProgressBar) zipExportProgressBar.style.width = "0";
    zipExportProgressTrack?.setAttribute("aria-valuenow", "0");
}

function waitForBrowserPaint() {
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function readZipWithProgress(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("progress", event => {
            if (!event.lengthComputable) return;
            const percent = (event.loaded / event.total) * 100;
            setZipImportProgress(`Reading mod ZIP… ${Math.round(percent)}%`, percent);
        });
        reader.addEventListener("load", () => resolve(reader.result));
        reader.addEventListener("error", () => reject(reader.error || new Error("Could not read mod ZIP.")));
        reader.readAsArrayBuffer(file);
    });
}

function colorLibraryHandleStore() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open("sf6-color-sync-library", 2);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains("handles")) request.result.createObjectStore("handles");
            if (!request.result.objectStoreNames.contains("files")) request.result.createObjectStore("files");
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
    });
}

async function rememberColorLibraryHandle(handle) {
    const db = await colorLibraryHandleStore();
    await new Promise((resolve, reject) => {
        const tx = db.transaction("handles", "readwrite");
        tx.objectStore("handles").put(handle, "sf6-colors");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

async function getRememberedColorLibraryHandle() {
    const db = await colorLibraryHandleStore();
    const handle = await new Promise((resolve, reject) => {
        const request = db.transaction("handles", "readonly").objectStore("handles").get("sf6-colors");
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
    db.close();
    return handle;
}

async function rememberColorLibraryFile(file) {
    const db = await colorLibraryHandleStore();
    await new Promise((resolve, reject) => {
        const tx = db.transaction("files", "readwrite");
        tx.objectStore("files").put({
            name: file.name,
            type: file.type || "application/zip",
            lastModified: file.lastModified || Date.now(),
            blob: file.slice(0, file.size, file.type || "application/zip"),
        }, "sf6-colors");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

async function getRememberedColorLibraryFile() {
    const db = await colorLibraryHandleStore();
    const stored = await new Promise((resolve, reject) => {
        const request = db.transaction("files", "readonly").objectStore("files").get("sf6-colors");
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
    });
    db.close();
    if (!stored?.blob) return null;
    return new File([stored.blob], stored.name || "SF6 Colors.zip", {
        type: stored.type || "application/zip",
        lastModified: stored.lastModified || Date.now(),
    });
}

async function forgetRememberedColorLibraryHandle() {
    const db = await colorLibraryHandleStore();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(["handles", "files"], "readwrite");
        tx.objectStore("handles").delete("sf6-colors");
        tx.objectStore("files").delete("sf6-colors");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

async function fileFromColorLibraryHandle(handle, { requestPermission = false } = {}) {
    if (!handle) return null;
    let permission = await handle.queryPermission?.({ mode: "read" }) || "granted";
    if (permission !== "granted" && requestPermission) {
        permission = await handle.requestPermission?.({ mode: "read" }) || permission;
    }
    if (permission !== "granted") return null;
    return handle.getFile();
}

function detectCmdPaletteTarget(paths, modinfoPaths) {
    const targets = new Map();
    const modRoots = modinfoPaths.map(zipEntryDirectory);
    for (const path of paths) {
        const match = path.match(/natives\/(?:stm|STM)\/product\/model\/esf\/(esf\d{3})\/(\d{3})\//i);
        if (!match) continue;
        // Folder 000 is a hair slot, not a selectable costume palette.
        if (match[2] === "000") continue;
        const costume = Number(match[2]);
        if (costume < 1 || costume > 999) continue;
        const esfId = match[1].toLowerCase();
        const key = `${esfId}|${costume}`;
        const target = targets.get(key) || { esfId, costumeFolder: String(costume).padStart(3, "0"), modRoots: [] };
        const root = nearestArchiveRoot(path, modRoots);
        if (root && !target.modRoots.includes(root)) target.modRoots.push(root);
        targets.set(key, target);
    }
    return targets.size && modinfoPaths.length ? [...targets.values()] : [];
}

function setImportedModMetadata(modinfoText, fileName) {
    if (modNameInput) modNameInput.value = parseModinfoValue(modinfoText, "name") || fileName.replace(/\.zip$/i, "");
    if (modDescriptionInput) modDescriptionInput.value = parseModinfoValue(modinfoText, "description") || modDescriptionInput.defaultValue;
    if (modAuthorInput) modAuthorInput.value = parseModinfoValue(modinfoText, "author") || modAuthorInput.defaultValue;
    if (zipFileNameInput) zipFileNameInput.value = fileName;
}

function selectFallbackPaletteTarget(target) {
    const importedMod = state.importedMod;
    if (!importedMod) return;

    importedMod.paletteTarget = target;
    const root = target.modRoots?.[0] || "";
    const modinfoPath = importedMod.modinfoByRoot?.[root] || importedMod.modinfoPath;
    const modinfoText = modinfoPath
        ? new TextDecoder().decode(importedMod.entries[modinfoPath])
        : "";

    importedMod.modinfoPath = modinfoPath;
    importedMod.modinfoText = modinfoText;
    setImportedModMetadata(modinfoText, importedMod.sourceName);

    const namedScreenshot = parseModinfoValue(modinfoText, "screenshot").replace(/\\/g, "/");
    const screenshotPath = Object.keys(importedMod.entries).find(path =>
        path === namedScreenshot || path === `${root}${namedScreenshot}`,
    ) || null;
    importedMod.referenceImagePath = screenshotPath;
    if (screenshotPath) {
        setScreenshot(
            new File([importedMod.entries[screenshotPath]], zipEntryBaseName(screenshotPath), {
                type: imageMimeType(screenshotPath),
            }),
            screenshotPath,
        );
    } else {
        clearScreenshot();
    }
}

function renderColorLibraryTargetDropdown(targets) {
    if (!colorLibraryTargetSelect) return;
    const trigger = colorLibraryTargetSelect.querySelector(".custom-select-trigger");
    const text = trigger?.querySelector(".cs-text");
    const dropdown = colorLibraryTargetSelect.querySelector(".custom-select-dropdown");
    if (!trigger || !text || !dropdown) return;
    const selected = state.importedMod?.paletteTarget;
    const label = target => `${SF6_CHARACTERS[target.esfId] || target.esfId}, Outfit ${Number(target.costumeFolder)}`;
    text.textContent = selected ? label(selected) : "Select character and outfit";
    dropdown.innerHTML = "";
    targets.forEach(target => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "custom-select-option";
        option.textContent = label(target);
        if (target === selected) option.classList.add("selected");
        option.addEventListener("click", () => {
            selectFallbackPaletteTarget(target);
            dropdown.classList.add("hidden");
            trigger.classList.remove("open");
            trigger.setAttribute("aria-expanded", "false");
            renderColorLibraryTargetDropdown(targets);
        });
        dropdown.appendChild(option);
    });
    trigger.onclick = event => {
        event.stopPropagation();
        const open = dropdown.classList.toggle("hidden") === false;
        trigger.classList.toggle("open", open);
        trigger.setAttribute("aria-expanded", String(open));
    };
}

function missingPaletteNumbers(target = state.importedMod?.paletteTarget) {
    if (!target) return [];
    const present = new Set(state.cmdEntries
        .filter(cmd => (
            cmd.metadata.variant === "standard"
            && cmd.metadata.esfId === target.esfId
            && cmd.metadata.costumeFolder === target.costumeFolder
            && cmd.metadata.paletteNumber >= 1
            && cmd.metadata.paletteNumber <= 10
        ))
        .map(cmd => cmd.metadata.paletteNumber));
    return Array.from({ length: 10 }, (_, index) => index + 1)
        .filter(paletteNumber => !present.has(paletteNumber));
}

function hideColorLibraryPrompt() {
    colorLibraryPanel?.classList.add("hidden");
    colorLibraryPanel?.classList.remove("warn", "bad");
    if (colorLibraryHeading) colorLibraryHeading.textContent = "";
    if (colorLibraryDetection) colorLibraryDetection.textContent = "";
    colorLibraryTargetField?.classList.add("hidden");
}

function refreshColorLibraryPromptAfterUnload() {
    const target = state.importedMod?.paletteTarget;
    if (!target || state.cmdEntries.length === 0) {
        hideColorLibraryPrompt();
        return;
    }

    const missing = missingPaletteNumbers(target);
    if (!missing.length) {
        hideColorLibraryPrompt();
        return;
    }

    if (colorLibraryHeading) {
        colorLibraryHeading.textContent = `This mod includes ${10 - missing.length} of 10 CMD palette files.`;
    }
    if (colorLibraryDetection) {
        colorLibraryDetection.textContent = ` Add ${paletteNumberList(missing)} from SF6 Colors.zip. Existing mod colors will be kept.`;
    }
    colorLibraryTargetField?.classList.add("hidden");
    colorLibraryPanel?.classList.remove("hidden", "bad");
    colorLibraryPanel?.classList.add("warn");
}

function paletteNumberList(numbers) {
    const ranges = [];
    for (const number of numbers) {
        const previous = ranges.at(-1);
        if (previous && number === previous.end + 1) previous.end = number;
        else ranges.push({ start: number, end: number });
    }
    const labels = ranges.map(range => (
        range.start === range.end ? String(range.start) : `${range.start}–${range.end}`
    ));
    const joined = labels.length > 1
        ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`
        : labels[0] || "";
    return `Colors ${joined}`;
}

async function prepareColorLibraryPicker() {
    if ("indexedDB" in window) {
        const [file, handle] = await Promise.all([
            getRememberedColorLibraryFile().catch(() => null),
            "showOpenFilePicker" in window
                ? getRememberedColorLibraryHandle().catch(() => null)
                : Promise.resolve(null),
        ]);
        state.rememberedColorLibraryFile = file;
        state.rememberedColorLibraryHandle = handle;
        colorLibraryOptions?.classList.remove("hidden");
        const remembered = Boolean(file || handle);
        forgetColorLibraryButton?.classList.toggle("hidden", !remembered);
        if (rememberColorLibraryInput) rememberColorLibraryInput.checked = remembered;
    } else {
        colorLibraryOptions?.classList.add("hidden");
        forgetColorLibraryButton?.classList.add("hidden");
    }
}

function parseStandardCmdFilename(filename) {
    const metadata = parseCmdFilename(filename);
    return metadata?.variant === "standard" ? metadata : null;
}

function resetLoadedCmdState() {
    state.files = [];
    state.rejectedFiles = [];
    state.cmdEntries = [];
    state.activeCmdIndex = 0;
    state.colorClusters = [];
    state.openClusterNames.clear();
    state.surpriseSnapshots.clear();
    state.inspectorDirty = false;
    state.detectedEsfId = null;
    state.detectedCharacterName = null;
    state.detectedCostume = null;
}

function clearScreenshot() {
    if (state.screenshotObjectUrl) URL.revokeObjectURL(state.screenshotObjectUrl);
    state.screenshotFile = null;
    state.screenshotObjectUrl = null;
    state.screenshotZipName = null;
    if (screenshotPreview) screenshotPreview.removeAttribute("src");
    screenshotPreviewWrap?.classList.add("hidden");
    if (screenshotStatus) screenshotStatus.textContent = "Drop a PNG or JPG here, or click to browse.";
}

async function handleModZip(file) {
    if (file.size > MAX_MOD_ZIP_BYTES) {
        throw new Error("Mod ZIP is over the 200 MiB import limit.");
    }
    showStatus(parserStatus, "", "Reading mod ZIP locally…");
    parserPanel?.classList.remove("hidden");
    setZipImportProgress("Reading mod ZIP…", 0);
    try {
        const zipData = await readZipWithProgress(file);
        setZipImportProgress("Unpacking mod files…", 100, { indeterminate: true });
        const entries = await unzipArchive(new Uint8Array(zipData));
        const unpackedBytes = Object.values(entries).reduce((total, bytes) => total + bytes.byteLength, 0);
        if (unpackedBytes > MAX_MOD_UNPACKED_BYTES) {
            throw new Error("Mod ZIP expands beyond the 300 MiB safety limit.");
        }

        const paths = Object.keys(entries).filter(path => !path.endsWith("/"));
        // Backups contain valid CMD filenames too, but they are restore sources,
        // never live mod files to load into the editor automatically.
        const livePaths = paths.filter(path => !isColorBackupPath(path));
        const standardCmdPaths = livePaths.filter(path =>
            parseStandardCmdFilename(zipEntryBaseName(path)),
        );
        const ignoredVariantCount = livePaths.filter(path => {
            const metadata = parseCmdFilename(zipEntryBaseName(path));
            return metadata && metadata.variant !== "standard";
        }).length;
        const cmdEntries = standardCmdPaths
            .map(path => new File([entries[path]], zipEntryBaseName(path), { type: "application/octet-stream" }));

        // Some mod managers ZIP the mod contents directly, while others include
        // one enclosing folder. Accept either layout and preserve it verbatim.
        const modinfoPaths = paths.filter(path => zipEntryBaseName(path).toLowerCase() === "modinfo.ini");
        // Bundles commonly contain sibling Hair and Outfit submods. CMD files
        // belong to the nearest enclosing modinfo.ini, not whichever metadata
        // file happened to appear first in ZIP order.
        const modinfoPath = findOwningModinfoPath(standardCmdPaths, modinfoPaths)
            || modinfoPaths[0]
            || null;
        const modinfoText = modinfoPath ? new TextDecoder().decode(entries[modinfoPath]) : "";
        const namedScreenshot = parseModinfoValue(modinfoText, "screenshot").replace(/\\/g, "/");
        const modRoot = zipEntryDirectory(modinfoPath);
        const screenshotPath = paths.find(path => path === namedScreenshot || path === `${modRoot}${namedScreenshot}`)
            || paths.find(path => zipEntryDirectory(path) === modRoot && /\.(png|jpe?g|webp)$/i.test(path))
            || null;

        if (!cmdEntries.length) {
            const targets = detectCmdPaletteTarget(livePaths, modinfoPaths);
            if (!targets.length) {
                throw new Error("This ZIP has no CMD files and does not expose a detectable SF6 character/outfit path.");
            }
            resetLoadedCmdState();
            clearScreenshot();
            const modinfoByRoot = Object.fromEntries(modinfoPaths.map(path => [zipEntryDirectory(path), path]));
            state.importedMod = {
                entries, modinfoPath, modinfoText, sourceName: file.name, referenceImagePath: screenshotPath,
                cmdPaths: {}, hadLiveCmd: {}, lastZipExportBuffers: {}, modinfoByRoot,
                paletteTarget: targets[0], paletteTargets: targets,
                colorBackupManifest: readColorBackupManifest(entries, zipEntryDirectory(modinfoPath)),
            };
            renderColorBackupPanel();
            selectFallbackPaletteTarget(targets[0]);
            if (colorLibraryHeading) colorLibraryHeading.textContent = "This mod has no CMD palette files.";
            if (colorLibraryDetection) colorLibraryDetection.textContent = targets.length === 1
                ? ` Detected ${SF6_CHARACTERS[targets[0].esfId] || targets[0].esfId}, Outfit ${Number(targets[0].costumeFolder)}.`
                : " Select which detected character and outfit should receive CMD colors.";
            renderColorLibraryTargetDropdown(targets);
            colorLibraryTargetField?.classList.toggle("hidden", targets.length < 2);
            colorLibraryPanel?.classList.remove("hidden", "bad");
            colorLibraryPanel?.classList.add("warn");
            requestAnimationFrame(() => {
                colorLibraryPanel?.scrollIntoView({ behavior: "smooth", block: "center" });
            });
            await prepareColorLibraryPicker();
            return;
        }

        resetLoadedCmdState();
        clearScreenshot();
        state.importedMod = {
            entries,
            modinfoPath,
            modinfoText,
            sourceName: file.name,
            referenceImagePath: screenshotPath,
            cmdPaths: Object.fromEntries(standardCmdPaths.map(path => [
                cmdIdentityKey(parseStandardCmdFilename(zipEntryBaseName(path))),
                path,
            ])),
            hadLiveCmd: Object.fromEntries(standardCmdPaths.map(path => [path, true])),
            lastZipExportBuffers: {},
            modinfoByRoot: Object.fromEntries(modinfoPaths.map(path => [zipEntryDirectory(path), path])),
            colorBackupManifest: readColorBackupManifest(entries, zipEntryDirectory(modinfoPath)),
        };
        setImportedModMetadata(modinfoText, file.name);
        if (screenshotPath) {
            setScreenshot(
                new File([entries[screenshotPath]], zipEntryBaseName(screenshotPath), { type: imageMimeType(screenshotPath) }),
                screenshotPath,
            );
        }
        setZipImportProgress("Loading CMD files…", 100, { indeterminate: true });
        await handleFiles(cmdEntries);
        state.cmdEntries.forEach(cmd => {
            state.importedMod.lastZipExportBuffers[cmdIdentityKey(cmd.metadata)] = cmd.workingBuffer.slice(0);
        });
        const loadedMeta = state.cmdEntries[0]?.metadata;
        const detectedTarget = detectCmdPaletteTarget(
            livePaths,
            paths.filter(path => zipEntryBaseName(path).toLowerCase() === "modinfo.ini"),
        ).find(target => (
            target.esfId === loadedMeta?.esfId
            && target.costumeFolder === loadedMeta?.costumeFolder
        ));
        const paletteTarget = detectedTarget || {
            esfId: loadedMeta.esfId,
            costumeFolder: loadedMeta.costumeFolder,
            modRoots: [modRoot],
        };
        state.importedMod.paletteTarget = paletteTarget;
        const missing = missingPaletteNumbers(paletteTarget);
        if (missing.length) {
            if (colorLibraryHeading) {
                colorLibraryHeading.textContent = `This mod includes ${10 - missing.length} of 10 CMD palette files.`;
            }
            if (colorLibraryDetection) {
                colorLibraryDetection.textContent = ` Add ${paletteNumberList(missing)} from SF6 Colors.zip. Existing mod colors will be kept.`;
            }
            colorLibraryTargetField?.classList.add("hidden");
            colorLibraryPanel?.classList.remove("hidden", "bad");
            colorLibraryPanel?.classList.add("warn");
            await prepareColorLibraryPicker();
        } else {
            delete state.importedMod.paletteTarget;
            colorLibraryPanel?.classList.add("hidden");
        }
        renderColorBackupPanel();
        showStatus(
            parserStatus,
            "good",
            `Imported ${cmdEntries.length} CMD file${cmdEntries.length === 1 ? "" : "s"} from “${file.name}”.`
            + (ignoredVariantCount ? ` Ignored ${ignoredVariantCount} EX/DX CMD file${ignoredVariantCount === 1 ? "" : "s"}.` : "")
            + " Other mod files will be preserved on ZIP export.",
        );
    } finally {
        hideZipImportProgress();
    }
}

async function loadCmdsFromColorLibrary(file) {
    const target = state.importedMod?.paletteTarget;
    if (!target) throw new Error("Load an eligible mod ZIP before selecting SF6 Colors.zip.");
    if (file.size > MAX_MOD_ZIP_BYTES) throw new Error("SF6 Colors.zip is over the 200 MiB import limit.");
    setZipImportProgress("Reading SF6 Colors.zip…", 0);
    try {
        const zipData = await readZipWithProgress(file);
        setZipImportProgress("Finding matching CMD colors…", 100, { indeterminate: true });
        const libraryEntries = await unzipArchive(new Uint8Array(zipData));
        const neededPalettes = new Set(missingPaletteNumbers(target));
        if (!neededPalettes.size) throw new Error("All Colors 1–10 are already loaded from this mod.");
        let ignoredVariantCount = 0;
        const matchingByPalette = new Map();
        Object.entries(libraryEntries).forEach(([path, bytes]) => {
            const meta = parseCmdFilename(zipEntryBaseName(path));
            if (meta?.esfId !== target.esfId || meta.costumeFolder !== target.costumeFolder) return;
            if (meta.variant !== "standard") {
                ignoredVariantCount += 1;
                return;
            }
            if (!neededPalettes.has(meta.paletteNumber) || matchingByPalette.has(meta.paletteNumber)) return;
            matchingByPalette.set(meta.paletteNumber, [path, bytes]);
        });
        const matching = [...matchingByPalette.values()]
            .sort(([a], [b]) => (
                parseCmdFilename(zipEntryBaseName(a)).paletteNumber
                - parseCmdFilename(zipEntryBaseName(b)).paletteNumber
            ));
        if (!matching.length) {
            throw new Error(`SF6 Colors.zip has none of the missing standard CMD files for ${SF6_CHARACTERS[target.esfId] || target.esfId}, Outfit ${Number(target.costumeFolder)}.`);
        }
        const cmdFiles = matching.map(([path, bytes]) => new File([bytes], zipEntryBaseName(path), { type: "application/octet-stream" }));
        const modRoots = target.modRoots?.length ? target.modRoots : [zipEntryDirectory(state.importedMod.modinfoPath)];
        const cmdDirectoryForRoot = root => {
            const suffix = new RegExp(
                `^(.*natives/stm/product/model/esf/${target.esfId}/${target.costumeFolder}/)`,
                "i",
            );
            const existingPath = Object.keys(state.importedMod.entries).find(path =>
                path.startsWith(root) && suffix.test(path),
            );
            const match = existingPath?.match(suffix);
            // Preserve the archive's exact path casing. ZIP entries are case-sensitive,
            // and a parallel STM/Product/Model path can be ignored by the mod manager.
            return match?.[1]
                || `${root}natives/STM/Product/Model/esf/${target.esfId}/${target.costumeFolder}/`;
        };
        const libraryCmdPaths = Object.fromEntries(matching.map(([path]) => {
            const meta = parseCmdFilename(zipEntryBaseName(path));
            return [cmdIdentityKey(meta), modRoots.map(root =>
                `${cmdDirectoryForRoot(root)}${zipEntryBaseName(path)}`,
            )];
        }));
        state.importedMod.cmdPaths = {
            ...state.importedMod.cmdPaths,
            ...libraryCmdPaths,
        };
        await handleFiles(cmdFiles);
        state.cmdEntries.forEach(cmd => {
            state.importedMod.lastZipExportBuffers[cmdIdentityKey(cmd.metadata)] = cmd.workingBuffer.slice(0);
        });
        const stillMissing = missingPaletteNumbers(target);
        if (stillMissing.length) {
            if (colorLibraryHeading) colorLibraryHeading.textContent = `This mod includes ${10 - stillMissing.length} of 10 CMD palette files.`;
            if (colorLibraryDetection) colorLibraryDetection.textContent = ` SF6 Colors.zip is still missing ${paletteNumberList(stillMissing)}.`;
        } else {
            delete state.importedMod.paletteTarget;
            colorLibraryPanel?.classList.add("hidden");
        }
        renderColorBackupPanel();
        showStatus(
            parserStatus,
            "good",
            `Kept ${state.cmdEntries.length - matching.length} CMD file${state.cmdEntries.length - matching.length === 1 ? "" : "s"} from the mod and added ${matching.length} missing color${matching.length === 1 ? "" : "s"} from SF6 Colors.zip.`
            + (ignoredVariantCount ? ` Ignored ${ignoredVariantCount} EX/DX CMD file${ignoredVariantCount === 1 ? "" : "s"}.` : ""),
        );
    } finally {
        hideZipImportProgress();
    }
}

function showColorLibraryError(error) {
    const message = error?.message || String(error);
    if (colorLibraryDetection) colorLibraryDetection.textContent = ` ${message}`;
    colorLibraryPanel?.classList.remove("warn");
    colorLibraryPanel?.classList.add("bad");
    colorLibraryPanel?.scrollIntoView({ behavior: "smooth", block: "center" });
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
    updateZipFileNameField();
    parserPanel?.classList.remove("hidden");

    if (modNameInput && !modNameInput.value.trim()) {
        modNameInput.value =
            `${state.detectedCharacterName} C${state.detectedCostume} Colors`;
    }

    const addedCount = newlyParsed.length;
    const dxAddedCount = newlyParsed.filter(cmd => cmd.metadata.isDxReference).length;
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
    if (dxAddedCount > 0) {
        msg += ` ${dxAddedCount} DX file${dxAddedCount === 1 ? " is" : "s are"} reference-only; edits may not apply in-game.`;
    }

    showStatus(
        parserStatus,
        (skipCount > 0 || dxAddedCount > 0) ? "warn" : (addedCount > 0 ? "good" : "warn"),
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

function setCmdColorSlot(cmdEntry, materialName, slotIndex, cmdRgba, { forceEnable = true } = {}) {
    const slot = getColorSlot(cmdEntry, materialName, slotIndex);
    if (!isSlotEditable(slot)) return false;

    writeRgbaAtOffset(
        cmdEntry.workingBuffer,
        slot.color.absoluteOffset,
        cmdRgba,
    );
    updateColorModelAtOffset(cmdEntry, slot.color.absoluteOffset, cmdRgba);

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

                const beforeRgba = rgbaAtOffset(cmd.originalBuffer, offset);
                const afterRgba = rgbaAtOffset(cmd.workingBuffer, offset);
                if (rgbaEquals(beforeRgba, afterRgba)) continue;

                changes.push({
                    cmdIndex,
                    cluster: cluster.name,
                    slot: color.runtimeName,
                    slotIndex: color.index,
                    offset,
                    before: rgbaToHexString(beforeRgba),
                    after: rgbaToHexString(afterRgba),
                    beforeRgba,
                    afterRgba,
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

function applyReplaceEverywhere({ newRgbaOverride = null } = {}) {
    const findRgba = syncReplaceColorField("find");
    const newRgba = newRgbaOverride || syncReplaceColorField("new");

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
            const requestedRgba = syncReplaceColorField("new");
            if (!requestedRgba) throw new Error("Enter a valid #RRGGBBAA replacement color.");
            const result = applyReplaceEverywhere({ newRgbaOverride: requestedRgba });
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
                const enabled = enabledAtOffset(
                    cmd.originalBuffer,
                    color.enable?.absoluteOffset,
                    color.enable?.byteLength,
                );
                if (enabled !== null) {
                    color.enabled = enabled;
                    if (color.enable) color.enable.value = enabled;
                }
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
                    change.afterRgba = rgba;
                    change.after = rgbaToHexString(rgba);
                    afterBtn.style.background = change.after;
                    const hexes = meta.querySelector(".current-change-hexes");
                    if (hexes) {
                        hexes.innerHTML =
                            `<span class="color-inline"><span class="swatch-inline" style="background:${change.before}"></span>${change.before} <em>(${describeColorName(change.beforeRgba)})</em></span>`
                            + ` &rarr; `
                            + `<span class="color-inline"><span class="swatch-inline" style="background:${change.after}"></span>${change.after} <em>(${describeColorName(rgba)})</em></span>`;
                    }
                    updateExportButtons();
                }, () => {
                    const active = state.cmdEntries[state.activeCmdIndex];
                    renderColorClusters(active?.colorClusters ?? []);
                    renderCurrentChanges();
                    renderSyncPanels();
                }, { originalRgba: change.beforeRgba });
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

function importedCmdPaths(cmd) {
    const paths = state.importedMod?.cmdPaths?.[cmdIdentityKey(cmd.metadata)];
    return Array.isArray(paths) ? paths : (paths ? [paths] : []);
}

function exportBaseline(cmd) {
    return state.importedMod?.lastZipExportBuffers?.[cmdIdentityKey(cmd.metadata)] || cmd.originalBuffer;
}

function enabledAtOffset(buffer, offset, byteLength = 1) {
    if (!Number.isInteger(offset) || offset < 0) return null;
    return new Uint8Array(buffer, offset, Math.max(1, byteLength)).some(byte => byte !== 0);
}

function semanticChangesSince(cmd, baseline) {
    const changes = [];
    for (const cluster of cmd.colorClusters) for (const slot of cluster.colors) {
        const offset = slot.color?.absoluteOffset;
        if (!Number.isInteger(offset)) continue;
        const beforeRgba = rgbaAtOffset(baseline, offset);
        const afterRgba = rgbaAtOffset(cmd.workingBuffer, offset);
        const beforeEnabled = enabledAtOffset(baseline, slot.enable?.absoluteOffset, slot.enable?.byteLength);
        const afterEnabled = enabledAtOffset(cmd.workingBuffer, slot.enable?.absoluteOffset, slot.enable?.byteLength);
        if (!rgbaEquals(beforeRgba, afterRgba) || beforeEnabled !== afterEnabled) {
            changes.push({ cluster: cluster.name, slot: slot.runtimeName, beforeRgba, afterRgba, beforeEnabled, afterEnabled });
        }
    }
    return changes;
}

function buildExportChangelog(changedCmds) {
    const lines = ["SF6 Color Sync export", `Created: ${new Date().toLocaleString()}`, ""];
    for (const { cmd, changes } of changedCmds) {
        lines.push(`${cmdDisplayName(cmd)}: ${cmd.file.name}`);
        for (const change of changes) {
            lines.push(`- ${change.cluster} · ${change.slot}: ${describeColorName(change.beforeRgba)} ${rgbaToHexString(change.beforeRgba)} → ${describeColorName(change.afterRgba)} ${rgbaToHexString(change.afterRgba)}`);
            if (change.beforeEnabled !== change.afterEnabled) lines.push(`  Active: ${change.beforeEnabled ? "Yes" : "No"} → ${change.afterEnabled ? "Yes" : "No"}`);
        }
        lines.push("");
    }
    return new TextEncoder().encode(`${lines.join("\n")}\n`);
}

function updateExportButtons() {
    const hasChanges = state.cmdEntries.some(cmd => diffBuffers(exportBaseline(cmd), cmd.workingBuffer).length > 0);
    if (buildButton) buildButton.disabled = !hasChanges;
    if (exportCmdButton) exportCmdButton.disabled = !hasChanges;
    if (exportColorsZipButton) exportColorsZipButton.disabled = !state.importedMod || state.cmdEntries.length === 0;
}

function updateZipFileNameField() {
    zipFileNameField?.classList.toggle("hidden", !state.importedMod);
    exportColorsZipButton?.classList.toggle("hidden", !state.importedMod);
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

async function buildModZip({ colorsOnly = false } = {}) {
    if (colorsOnly && !state.importedMod) {
        throw new Error("Load a mod ZIP before exporting a colors-only ZIP.");
    }
    const modinfoPath = state.importedMod?.modinfoPath || "modinfo.ini";
    const modRoot = zipEntryDirectory(modinfoPath);
    const files = colorsOnly
        ? Object.fromEntries(Object.entries(state.importedMod.entries).filter(([path]) => (
            isColorBackupPath(path)
            && path.toLowerCase().startsWith(modRoot.toLowerCase())
        )))
        : state.importedMod
            ? { ...state.importedMod.entries }
            : {};
    const exported = [];
    const includedCmds = [];
    const changedCmds = [];

    for (const cmd of state.cmdEntries) {
        const baseline = exportBaseline(cmd);
        const semanticChanges = semanticChangesSince(cmd, baseline);
        const changed = diffBuffers(baseline, cmd.workingBuffer).length > 0;
        if (changed) synchronizeCmdInstanceCrcs(cmd);
        const changes = diffBuffers(baseline, cmd.workingBuffer);

        let paths = importedCmdPaths(cmd);
        if (colorsOnly) {
            const ownedPaths = paths.filter(path => path.toLowerCase().startsWith(modRoot.toLowerCase()));
            if (ownedPaths.length) paths = ownedPaths;
        }
        if (!paths.length) paths.push(`${colorsOnly ? modRoot : ""}natives/STM/Product/Model/esf/`
                + `${cmd.metadata.esfId}/`
                + `${cmd.metadata.costumeFolder}/`
                + cmd.file.name);

        if (colorsOnly || changed) {
            paths.forEach(path => { files[path] = new Uint8Array(cmd.workingBuffer); });
            includedCmds.push({ cmd, paths });
            exported.push({
                file: cmd.file.name,
                changedBytes: changes.length,
            });
        }
        if (changed) changedCmds.push({ cmd, paths, baseline, changes: semanticChanges });
    }

    if (exported.length === 0) {
        throw new Error(colorsOnly ? "No CMD colors are loaded." : "Nothing changed.");
    }

    const requestedName = modNameInput?.value?.trim() || "SF6 Colors";
    const name = colorsOnly ? withOnlyColorsSuffix(requestedName) : requestedName;
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

    {
        const createdAt = new Date().toISOString();
        const originalSources = state.importedMod
            ? (colorsOnly ? includedCmds : state.cmdEntries.map(cmd => ({ cmd, paths: importedCmdPaths(cmd) })))
                .flatMap(({ cmd, paths }) => paths.map(path => ({ path, buffer: cmd.originalBuffer })))
            : changedCmds.flatMap(({ cmd, paths }) => paths.map(path => ({ path, buffer: cmd.originalBuffer })));
        const historySources = changedCmds.flatMap(({ paths, baseline }) => paths
            .filter(path => state.importedMod?.hadLiveCmd?.[path])
            .map(path => ({ path, buffer: baseline })));
        writeColorBackupSnapshots({
            files,
            modRoot,
            manifest: state.importedMod?.colorBackupManifest || emptyColorBackupManifest(),
            originalSources,
            historySources,
            changelogBytes: historySources.length ? buildExportChangelog(changedCmds) : null,
            createdAt,
        });
    }

    const modinfoScreenshot = screenshotEntry?.startsWith(modRoot)
        ? screenshotEntry.slice(modRoot.length)
        : screenshotEntry;
    files[modinfoPath] = new TextEncoder().encode(buildModinfo(
        state.importedMod?.modinfoText,
        { name, description, author, screenshot: modinfoScreenshot },
    ));

    setZipExportProgress(0);
    await waitForBrowserPaint();
    const zip = await createCompressedZip(files, {
        level: 6,
        onProgress(completed, total) {
            const percent = (completed / total) * 100;
            setZipExportProgress(percent);
            showStatus(buildStatus, "", `Compressing mod ZIP… ${Math.round(percent)}%`);
        },
    });
    const requestedZipName = zipFileNameInput?.value?.trim();
    const cleanedZipName = requestedZipName
        ? zipEntryBaseName(requestedZipName).replace(/[<>:"/\\|?*]+/g, "_")
        : "";
    const exportZipName = cleanedZipName
        ? (cleanedZipName.toLowerCase().endsWith(".zip") ? cleanedZipName : `${cleanedZipName}.zip`)
        : state.importedMod?.sourceName
            || `${name.replace(/[<>:"/\\|?*]+/g, "_")}.zip`;
    const finalZipName = colorsOnly ? colorsOnlyZipFilename(exportZipName) : exportZipName;
    const destination = await saveExportFile(
        "zip",
        zip,
        finalZipName,
        {
            type: "application/zip",
            replaceExisting: Boolean(replaceDuplicateExportsInput?.checked),
        },
    );
    if (destination.mode === "cancelled") throw new Error("ZIP export cancelled.");
    if (state.importedMod && !colorsOnly) {
        state.importedMod.entries = files;
        state.importedMod.colorBackupManifest = readColorBackupManifest(files, modRoot);
        for (const { cmd, paths } of changedCmds) {
            state.importedMod.lastZipExportBuffers[cmdIdentityKey(cmd.metadata)] = cmd.workingBuffer.slice(0);
            paths.forEach(path => { state.importedMod.hadLiveCmd[path] = true; });
        }
        renderColorBackupPanel();
    }
    return { exported, destination, colorsOnly };
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

function renderRuntimeColorReadout(visualRgba) {
    const runtimeRgba = cmdRgbaToRuntimeRgba(visualRgba);
    const runtimeHex = rgbaToHexString(runtimeRgba);

    if (colorPickerRuntimeSwatch) {
        colorPickerRuntimeSwatch.style.background = runtimeHex;
        colorPickerRuntimeSwatch.title = runtimeHex;
    }
    if (colorPickerRuntimeHex) colorPickerRuntimeHex.textContent = runtimeHex;
    if (colorPickerRuntimeName) {
        colorPickerRuntimeName.textContent = describeColorName(runtimeRgba);
    }
}

function renderOriginalColorReadout() {
    const originalRgba = colorPickerState.originalRgba;
    const originalHex = rgbaToHexString(originalRgba);
    if (colorPickerOriginalSwatch) {
        colorPickerOriginalSwatch.style.background = originalHex;
        colorPickerOriginalSwatch.title = originalHex;
    }
    if (colorPickerOriginalHex) colorPickerOriginalHex.textContent = originalHex;
    if (colorPickerOriginalName) colorPickerOriginalName.textContent = describeColorName(originalRgba);
    if (colorPickerOriginalRestore) {
        colorPickerOriginalRestore.disabled = rgbaEquals(colorPickerState.rgba, originalRgba);
    }
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
    renderRuntimeColorReadout(colorPickerState.rgba);
    renderOriginalColorReadout();

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

function openCustomColorPicker(anchor, rgba, onChange, onClose = null, { originalRgba = rgba } = {}) {
    if (colorPickerState.open && colorPickerState.anchor === anchor) {
        closeCustomColorPicker();
        return;
    }
    colorPickerState.open = true;
    colorPickerState.anchor = anchor;
    colorPickerState.onChange = onChange;
    colorPickerState.onClose = onClose;
    colorPickerState.originalRgba = (originalRgba ?? rgba ?? [255, 255, 255, 255]).map(clampByte);
    syncPickerFromRgba(rgba ?? [255, 255, 255, 255]);
    customColorPicker?.classList.remove("hidden");
    positionColorPicker(anchor);
}

function closeCustomColorPicker() {
    const onClose = colorPickerState.onClose;
    colorPickerState.open = false;
    colorPickerState.anchor = null;
    colorPickerState.onChange = null;
    colorPickerState.onClose = null;
    colorPickerState.originalRgba = [255, 255, 255, 255];
    colorPickerState.draggingWindow = false;
    customColorPicker?.classList.remove("is-dragging");
    customColorPicker?.classList.add("hidden");
    onClose?.();
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

    colorPickerOriginalRestore?.addEventListener("click", () => {
        syncPickerFromRgba(colorPickerState.originalRgba);
        emitPickerChange();
    });

    document.addEventListener("pointerdown", e => {
        if (!colorPickerState.open) return;
        if (customColorPicker.contains(e.target)) return;
        // Let a left-click on the opening swatch reach its click handler so it
        // toggles the picker. Right-clicking that swatch dismisses immediately.
        if (e.button === 0 && colorPickerState.anchor?.contains?.(e.target)) return;
        closeCustomColorPicker();
    });

    document.addEventListener("contextmenu", e => {
        if (!colorPickerState.open || customColorPicker.contains(e.target)) return;
        closeCustomColorPicker();
    });

    document.addEventListener("keydown", e => {
        if (!colorPickerState.open || e.key !== "Escape") return;
        e.preventDefault();
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
    const modReferencePath = state.importedMod?.referenceImagePath;
    if (modReferencePath && state.screenshotObjectUrl) {
        state.referenceImages.unshift({
            src: state.screenshotObjectUrl,
            label: `Mod image: ${zipEntryBaseName(modReferencePath)}`,
            type: "custom",
        });
    }
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
        if (cmd.metadata.isDxReference) row.classList.add("dx-reference");
        row.innerHTML =
            `<strong>${cmdDisplayName(cmd)}</strong>`
            + `<span>${cmd.file.name} · ${formatBytes(cmd.file.size)}</span>`
            + `<span>${cmd.colorClusters.length} materials</span>`
            + (cmd.metadata.isDxReference
                ? `<span class="dx-reference-note">DX reference only · edits may not apply in-game</span>`
                : "");
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

function snapshotFilesForLoadedCmds(snapshot) {
    const byIdentity = new Map(state.cmdEntries.map(cmd => [cmdIdentityKey(cmd.metadata), cmd]));
    const matched = new Map();
    for (const file of snapshot.files) {
        const metadata = parseCmdFilename(zipEntryBaseName(file.livePath));
        const identity = cmdIdentityKey(metadata);
        const cmd = metadata ? byIdentity.get(identity) : null;
        if (cmd && !matched.has(identity)) matched.set(identity, { ...file, cmd });
    }
    return [...matched.values()];
}

function renderColorBackupPanel() {
    if (!colorBackupPanel || !colorBackupList) return;
    const snapshots = state.importedMod?.colorBackupManifest?.snapshots || [];
    const usable = snapshots
        .map(snapshot => ({ snapshot, targets: snapshotFilesForLoadedCmds(snapshot) }))
        .filter(item => item.targets.length > 0)
        .sort((a, b) => {
            if (a.snapshot.kind !== b.snapshot.kind) return a.snapshot.kind === "history" ? -1 : 1;
            return String(b.snapshot.createdAt).localeCompare(String(a.snapshot.createdAt));
        });

    colorBackupPanel.classList.toggle("hidden", usable.length === 0);
    colorBackupList.innerHTML = "";
    hideStatus(colorBackupStatus);
    if (colorBackupCount) colorBackupCount.textContent = `${usable.length} backup${usable.length === 1 ? "" : "s"}`;

    for (const { snapshot, targets } of usable) {
        const row = document.createElement("div");
        row.className = "color-backup-item";
        const copy = document.createElement("div");
        copy.className = "color-backup-copy";
        const title = document.createElement("strong");
        title.textContent = colorBackupDateLabel(snapshot);
        const description = document.createElement("span");
        description.textContent = snapshot.kind === "original"
            ? `First color set preserved by Color Sync · ${targets.length} loaded CMD file${targets.length === 1 ? "" : "s"}`
            : `Colors immediately before this export · ${targets.length} CMD${targets.length === 1 ? "" : "s"} backed up`;
        copy.append(title, description);

        const changelogPath = safeArchiveRelativePath(snapshot.changelogPath);
        const changelogBytes = changelogPath
            ? state.importedMod.entries[changelogPath]
            : null;
        if (changelogBytes) {
            const details = document.createElement("details");
            details.className = "color-backup-changes";
            const summary = document.createElement("summary");
            summary.textContent = "View changes made after this backup";
            const pre = document.createElement("pre");
            pre.textContent = new TextDecoder().decode(changelogBytes);
            details.append(summary, pre);
            copy.append(details);
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary-button color-backup-restore";
        button.dataset.restoreColorBackup = snapshot.id;
        button.textContent = "Restore";
        row.append(copy, button);
        colorBackupList.appendChild(row);
    }
}

async function restoreColorBackup(snapshotId) {
    const snapshot = state.importedMod?.colorBackupManifest?.snapshots?.find(item => item.id === snapshotId);
    if (!snapshot) throw new Error("That color backup is no longer available.");
    const targets = snapshotFilesForLoadedCmds(snapshot);
    if (!targets.length) throw new Error("This backup has no files matching the loaded colors.");

    const label = colorBackupDateLabel(snapshot);
    const accepted = window.confirm(
        `Restore “${label}” across ${targets.length} CMD file${targets.length === 1 ? "" : "s"}?\n\n`
        + "This replaces current color changes in those files.",
    );
    if (!accepted) return false;
    if (typeRegistry === null) typeRegistry = await loadSf6TypeRegistry();

    const parsedTargets = await Promise.all(targets.map(async target => {
        const backupPath = safeArchiveRelativePath(target.backupPath);
        const bytes = state.importedMod.entries[backupPath];
        if (!bytes) throw new Error(`Backup file is missing: ${target.backupPath}`);
        const restored = await parseCmdEntry({
            file: new File([bytes], target.cmd.file.name, { type: "application/octet-stream" }),
            metadata: target.cmd.metadata,
        });
        return { target, restored };
    }));

    for (const { target, restored } of parsedTargets) {
        target.cmd.workingBuffer = restored.workingBuffer;
        target.cmd.usrInspection = restored.usrInspection;
        target.cmd.rszInspection = restored.rszInspection;
        target.cmd.instanceParse = restored.instanceParse;
        target.cmd.colorClusters = restored.colorClusters;
        target.cmd.summary = restored.summary;
    }

    state.colorClusters = state.cmdEntries[state.activeCmdIndex]?.colorClusters || [];
    state.inspectorDirty = false;
    resetSyncSelections();
    await loadReferenceImages();
    renderColorClusters(state.colorClusters);
    renderActiveCmdControls();
    renderSyncPanels();
    renderCurrentChanges();
    updateExportButtons();
    showStatus(colorBackupStatus, "good", `Restored “${label}” for ${targets.length} CMD file${targets.length === 1 ? "" : "s"}. Review Current Changes, then build a new ZIP to keep it.`);
    return true;
}

async function unloadCmd(index) {
    const cmd = state.cmdEntries[index];
    if (!cmd) return;

    state.cmdEntries.splice(index, 1);
    state.files.splice(index, 1);
    state.rejectedFiles = [];
    refreshColorLibraryPromptAfterUnload();

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
    renderColorBackupPanel();
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
    renderActiveCmdControls();
}

function renderActiveCmdControls() {
    const multi = state.cmdEntries.length > 1;

    cmdInspectorControls?.classList.toggle("hidden", state.cmdEntries.length === 0);
    multiCmdInspectorNotice?.classList.toggle("hidden", !multi);
    inspectorToolbar?.classList.toggle("hidden", state.cmdEntries.length === 0);

    renderActiveCmdDropdown(activeCmdSelect);
    updateDxReferenceWarning();
}

function updateDxReferenceWarning() {
    if (!dxReferenceWarning) return;

    const dxCmds = state.cmdEntries.filter(cmd => cmd.metadata.isDxReference);
    if (!dxCmds.length) {
        dxReferenceWarning.classList.add("hidden");
        dxReferenceWarning.textContent = "";
        return;
    }

    const activeIsDx = state.cmdEntries[state.activeCmdIndex]?.metadata.isDxReference;
    dxReferenceWarning.classList.remove("hidden");
    dxReferenceWarning.innerHTML = activeIsDx
        ? `<strong>DX reference file:</strong> Edits may not apply in-game. Use this file as reference only.`
        : `<strong>DX files loaded:</strong> Their edits may not apply in-game. Use DX files as reference only.`;
}

function renderActiveCmdDropdown(select) {
    if (!select) return;
    const trigger = select.querySelector(".custom-select-trigger");
    const dropdown = select.querySelector(".custom-select-dropdown");
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

function randomRgbKeepingAlpha(color) {
    const current = slotRgba(color) ?? [0, 0, 0, 255];
    const rgb = new Uint8Array(3);
    if (globalThis.crypto?.getRandomValues) crypto.getRandomValues(rgb);
    else rgb.forEach((_, index) => { rgb[index] = Math.floor(Math.random() * 256); });
    if (rgb[0] === current[0] && rgb[1] === current[1] && rgb[2] === current[2]) {
        rgb[0] = (rgb[0] + 1) % 256;
    }
    return [rgb[0], rgb[1], rgb[2], current[3]];
}

function surpriseMaterialColors(cluster) {
    const cmd = state.cmdEntries[state.activeCmdIndex];
    if (!cmd || !cluster) return 0;
    const activeSlots = cluster.colors.filter(color => isSlotEnabled(color) && isSlotEditable(color));
    let cmdSnapshots = state.surpriseSnapshots.get(cmd);
    if (!cmdSnapshots) {
        cmdSnapshots = new Map();
        state.surpriseSnapshots.set(cmd, cmdSnapshots);
    }
    if (!cmdSnapshots.has(cluster.name)) {
        cmdSnapshots.set(cluster.name, {
            inspectorDirty: state.inspectorDirty,
            slots: activeSlots.map(color => ({
                offset: color.color.absoluteOffset,
                rgba: slotRgba(color),
            })),
        });
    }
    for (const color of activeSlots) {
        const rgba = randomRgbKeepingAlpha(color);
        writeRgbaAtOffset(cmd.workingBuffer, color.color.absoluteOffset, rgba);
        updateColorModelAtOffset(cmd, color.color.absoluteOffset, rgba);
    }
    if (!activeSlots.length) return 0;

    state.inspectorDirty = true;
    updateInspectorDirtyUi();
    renderColorClusters(cmd.colorClusters);
    renderCurrentChanges();
    renderSyncPanels();
    updateExportButtons();
    return activeSlots.length;
}

function discardSurpriseMaterialColors(cluster) {
    const cmd = state.cmdEntries[state.activeCmdIndex];
    const cmdSnapshots = state.surpriseSnapshots.get(cmd);
    const snapshot = cmdSnapshots?.get(cluster?.name);
    if (!cmd || !snapshot) return 0;

    for (const slot of snapshot.slots) {
        writeRgbaAtOffset(cmd.workingBuffer, slot.offset, slot.rgba);
        updateColorModelAtOffset(cmd, slot.offset, slot.rgba);
    }
    cmdSnapshots.delete(cluster.name);
    if (!cmdSnapshots.size) state.surpriseSnapshots.delete(cmd);

    state.inspectorDirty = snapshot.inspectorDirty;
    updateInspectorDirtyUi();
    renderColorClusters(cmd.colorClusters);
    renderCurrentChanges();
    renderSyncPanels();
    updateExportButtons();
    return snapshot.slots.length;
}

function renderColorClusters(clusters) {
    if (!clusterInspector) return;
    clusterInspector.innerHTML = "";

    for (const cluster of clusters ?? []) {
        const card = document.createElement("details");
        card.className = "cluster-card";
        card.open = state.openClusterNames.has(cluster.name);
        card.addEventListener("toggle", () => {
            if (card.open) state.openClusterNames.add(cluster.name);
            else state.openClusterNames.delete(cluster.name);
        });

        const title = document.createElement("summary");
        const titleText = document.createElement("span");
        titleText.className = "cluster-card-title";
        titleText.textContent = `${cluster.name} (${cluster.colors.length})`;
        const surpriseButton = document.createElement("button");
        surpriseButton.type = "button";
        surpriseButton.className = "secondary-button cluster-surprise-button";
        surpriseButton.textContent = "Surprise Me";
        surpriseButton.title = "Randomize active colors in this material";
        surpriseButton.setAttribute("aria-label", `Surprise Me: randomize active colors in ${cluster.name}`);
        surpriseButton.disabled = !cluster.colors.some(color => isSlotEnabled(color) && isSlotEditable(color));
        surpriseButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            surpriseMaterialColors(cluster);
        });
        const actions = document.createElement("span");
        actions.className = "cluster-card-actions";
        actions.appendChild(surpriseButton);
        if (state.surpriseSnapshots.get(state.cmdEntries[state.activeCmdIndex])?.has(cluster.name)) {
            const discardSurpriseButton = document.createElement("button");
            discardSurpriseButton.type = "button";
            discardSurpriseButton.className = "secondary-button cluster-surprise-discard";
            discardSurpriseButton.textContent = "Discard Surprise";
            discardSurpriseButton.title = "Restore this material to before Surprise Me";
            discardSurpriseButton.setAttribute("aria-label", `Discard Surprise changes in ${cluster.name}`);
            discardSurpriseButton.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                discardSurpriseMaterialColors(cluster);
            });
            actions.appendChild(discardSurpriseButton);
        }
        title.append(titleText, actions);
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
                const activeCmd = state.cmdEntries[state.activeCmdIndex];
                const offset = color.color?.absoluteOffset;
                const originalRgba = activeCmd && Number.isInteger(offset)
                    ? rgbaAtOffset(activeCmd.originalBuffer, offset)
                    : rgba;
                openCustomColorPicker(swatch, rgba, newRgba => {
                    hexInput.value = rgbaToHexString(newRgba);
                    swatch.style.backgroundColor = hexInput.value;
                    friendly.textContent = describeColorName(newRgba);
                    applyColorEdit(color, newRgba);
                }, null, { originalRgba });
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
        text.textContent = `${cmdShortName(cmd)}: ${cmd.file.name}`;

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
        btn.title = `${color.hex} · ${color.name} · ${color.count}× · click to copy`;
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
    renderActiveCmdDropdown(colorSyncActiveCmdSelect);
    renderActiveCmdDropdown(patternSyncActiveCmdSelect);
    renderActiveCmdDropdown(replaceActiveCmdSelect);

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

async function handleSelectedFiles(files) {
    const incoming = Array.from(files || []);
    const zipFiles = incoming.filter(file => /\.zip$/i.test(file.name));
    if (zipFiles.length) {
        if (zipFiles.length !== 1 || incoming.length !== 1) {
            throw new Error("Load one mod ZIP at a time; CMD files can still be selected together.");
        }
        await handleModZip(zipFiles[0]);
        return;
    }
    // A fresh CMD-only set should not accidentally carry an unrelated archive.
    if (!state.cmdEntries.length) {
        state.importedMod = null;
        if (zipFileNameInput) zipFileNameInput.value = "";
        updateZipFileNameField();
    }
    await handleFiles(incoming);
}

function bindUi() {
    initializeHexActionButtons();
    if ("showOpenFilePicker" in window) {
        colorLibraryOptions?.classList.remove("hidden");
    }
    forgetColorLibraryButton?.addEventListener("click", async () => {
        try {
            await forgetRememberedColorLibraryHandle();
            state.rememberedColorLibraryHandle = null;
            state.rememberedColorLibraryFile = null;
            if (rememberColorLibraryInput) rememberColorLibraryInput.checked = false;
            forgetColorLibraryButton.classList.add("hidden");
        } catch (error) {
            console.error(error);
            showColorLibraryError(error);
        }
    });
    const chooseColorLibrary = async () => {
        try {
            if (!rememberColorLibraryInput?.checked) {
                colorLibraryInput?.click();
                return;
            }
            const cachedFile = state.rememberedColorLibraryFile
                || await getRememberedColorLibraryFile().catch(() => null);
            if (cachedFile) {
                state.rememberedColorLibraryFile = cachedFile;
                await loadCmdsFromColorLibrary(cachedFile);
                return;
            }
            if (!("showOpenFilePicker" in window)) {
                colorLibraryInput?.click();
                return;
            }
            let handle = state.rememberedColorLibraryHandle;
            if (!handle) {
                [handle] = await window.showOpenFilePicker({
                    multiple: false,
                    types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
                });
                await rememberColorLibraryHandle(handle);
                state.rememberedColorLibraryHandle = handle;
                forgetColorLibraryButton?.classList.remove("hidden");
            }
            const rememberedFile = await fileFromColorLibraryHandle(handle, { requestPermission: true });
            if (!rememberedFile) {
                throw new Error("Chromium needs permission to read the remembered SF6 Colors.zip. Click the picker again and allow access.");
            }
            await loadCmdsFromColorLibrary(rememberedFile);
            await rememberColorLibraryFile(rememberedFile);
            state.rememberedColorLibraryFile = rememberedFile;
        } catch (error) {
            if (error?.name === "AbortError") return;
            console.error(error);
            showColorLibraryError(error);
        }
    };
    colorLibraryDropZone?.addEventListener("click", event => {
        if (event.target.closest("a")) return;
        chooseColorLibrary();
    });
    colorLibraryDropZone?.addEventListener("keydown", event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        chooseColorLibrary();
    });
    colorLibraryInput?.addEventListener("change", async () => {
        const file = colorLibraryInput.files?.[0];
        if (!file) return;
        try {
            await loadCmdsFromColorLibrary(file);
            if (rememberColorLibraryInput?.checked) {
                await rememberColorLibraryFile(file);
                state.rememberedColorLibraryFile = file;
                forgetColorLibraryButton?.classList.remove("hidden");
            }
        } catch (error) {
            console.error(error);
            showColorLibraryError(error);
        } finally {
            colorLibraryInput.value = "";
        }
    });
    colorLibraryDropZone?.addEventListener("dragover", event => {
        event.preventDefault();
        colorLibraryDropZone.classList.add("dragover");
    });
    colorLibraryDropZone?.addEventListener("dragleave", () => {
        colorLibraryDropZone.classList.remove("dragover");
    });
    colorLibraryDropZone?.addEventListener("drop", async event => {
        event.preventDefault();
        colorLibraryDropZone.classList.remove("dragover");
        const file = event.dataTransfer?.files?.[0];
        if (!file) return;
        try {
            await loadCmdsFromColorLibrary(file);
            if (rememberColorLibraryInput?.checked) {
                await rememberColorLibraryFile(file);
                state.rememberedColorLibraryFile = file;
                forgetColorLibraryButton?.classList.remove("hidden");
            }
        } catch (error) {
            console.error(error);
            showColorLibraryError(error);
        }
    });
    bindDropZone(dropZone, async files => {
        try {
            await handleSelectedFiles(files);
        } catch (error) {
            console.error(error);
            showStatus(parserStatus, "bad", error.message || String(error));
            parserPanel?.classList.remove("hidden");
            revealStatus(parserStatus);
        }
    });

    fileInput?.addEventListener("change", async () => {
        try {
            await handleSelectedFiles(fileInput.files);
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

    colorBackupList?.addEventListener("click", async event => {
        const button = event.target.closest("[data-restore-color-backup]");
        if (!button) return;
        button.disabled = true;
        hideStatus(colorBackupStatus);
        try {
            await restoreColorBackup(button.dataset.restoreColorBackup);
        } catch (error) {
            console.error(error);
            showStatus(colorBackupStatus, "bad", error.message || String(error));
        } finally {
            button.disabled = false;
        }
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
        state.colorClusters.forEach(cluster => state.openClusterNames.add(cluster.name));
        clusterInspector
            ?.querySelectorAll("details.cluster-card")
            .forEach(el => { el.open = true; });
    });

    collapseAllClustersBtn?.addEventListener("click", () => {
        state.openClusterNames.clear();
        clusterInspector
            ?.querySelectorAll("details.cluster-card")
            .forEach(el => { el.open = false; });
    });

    saveCmdInspectorBtn?.addEventListener("click", () => {
        state.surpriseSnapshots.clear();
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
        state.surpriseSnapshots.delete(cmd);
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
            const slot = getColorSlot(cmd, state.colorSync.sourceMaterial, state.colorSync.sourceSlotIndex);
            if (!isSlotEditable(slot)) return;
            const ok = setCmdColorSlot(cmd, state.colorSync.sourceMaterial, state.colorSync.sourceSlotIndex, rgba, { forceEnable: true });
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
                setCmdColorSlot(cmd, state.colorSync.sourceMaterial, state.colorSync.sourceSlotIndex, rgba, { forceEnable: true });
                state.inspectorDirty = true;
                updateInspectorDirtyUi();
                const hex = rgbaToHexString(rgba);
                const sourceHex = document.querySelector("#color-source-color-hex");
                const sourcePicker = document.querySelector("#color-source-color-picker");
                if (sourceHex) sourceHex.value = hex;
                if (sourcePicker) sourcePicker.style.background = hex;
                updateExportButtons();
            }, () => {
                renderColorClusters(cmd.colorClusters);
                renderCurrentChanges();
                renderSyncPanels();
            }, {
                originalRgba: rgbaAtOffset(cmd.originalBuffer, slot.color.absoluteOffset),
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
                    `Color Sync applied ${n} slot write${n === 1 ? "" : "s"} on ${cmdDisplayName(state.cmdEntries[state.activeCmdIndex])}.`,
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

    const runZipBuild = async (colorsOnly = false) => {
        if (buildButton) buildButton.disabled = true;
        if (exportColorsZipButton) exportColorsZipButton.disabled = true;
        try {
            showStatus(buildStatus, "", colorsOnly ? "Building colors-only ZIP…" : "Building mod ZIP…");
            const result = await buildModZip({ colorsOnly });
            showTemporaryStatus(
                buildStatus,
                "good",
                describeZipExport(result),
            );
            revealExportStatus(buildStatus);
        } catch (error) {
            console.error(error);
            showStatus(buildStatus, "bad", error.message || String(error));
        } finally {
            hideZipExportProgress();
            updateExportButtons();
        }
    };

    buildButton?.addEventListener("click", () => runZipBuild(false));
    exportColorsZipButton?.addEventListener("click", () => runZipBuild(true));

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

function setScreenshot(file, zipEntryName = null) {
    if (state.screenshotObjectUrl) {
        URL.revokeObjectURL(state.screenshotObjectUrl);
    }
    state.screenshotFile = file;
    state.screenshotZipName = zipEntryName
        || `${zipEntryDirectory(state.importedMod?.modinfoPath)}${screenshotZipEntryName(file)}`;
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
bindSectionRail();
refreshExportDestinationUi().catch(error => {
    console.warn("Could not load saved export folders", error);
});
console.log("SF6 CMD Color Sync initialized.");
