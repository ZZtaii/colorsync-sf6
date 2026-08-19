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
//   @anchor custom-materials
//   @anchor buffer-mutation
//   @anchor sync-engine
//   @anchor palette-duplicate
//   @anchor changes-replace
//   @anchor color-state
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
    discoverEditableCmdTargets,
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
import { parseMdfMaterialNames } from "./lib/mdf-materials.js";
import {
    loadDefaultMdfColorMaterials,
    mergeMdfColorMaterials,
} from "./lib/default-mdf-materials.js";
import {
    addCustomMaterialCluster,
    extendMaterialClusterColorSlots,
} from "./lib/rsz-instance-writer.js";
import {
    buildSf6ReferenceImages,
    validateReferenceImages,
} from "./lib/sf6-reference-images.js";
import {
    chooseExportFolder,
    clearExportFolder,
    exportFolderName,
    isStaleFileSystemHandleError,
    saveExportFile,
} from "./lib/export-destinations.js";
import {
    cmdRgbaToRuntimeRgba,
    runtimeRgbaToCmdRgba,
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
const MAX_MOD_UNPACKED_BYTES = 750 * 1024 * 1024;
const SURPRISE_PRESETS = [
    { id: "random", label: "Random" },
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
    { id: "pastel", label: "Pastel" },
    { id: "neon", label: "Neon" },
    { id: "warm", label: "Warm" },
    { id: "cool", label: "Cool" },
];
const SURPRISE_DEFAULTS = {
    preset: "random",
    intensity: 1,
    targetMode: "material",
    targets: [],
};


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
    surpriseConfig: {
        ...SURPRISE_DEFAULTS,
        targets: [],
    },

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
    rememberedColorLibraryFile: null,
    customMdfMaterials: [],
    customMaterialMappings: [],

    syncMode: "color", // "color" | "pattern" | "duplicate"

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

    // Duplicate Palette: one complete palette into selected standard CMDs.
    // EX/DX CMDs may be selected as sources, but never as targets.
    paletteDuplicate: {
        sourceCmdIndex: null,
        targetCmdIndexes: [],
        undo: null,
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
    savedBounds: null,
    hsv: { h: 0, s: 0, v: 1 },
    draggingSv: false,
    draggingWindow: false,
    resizingWindow: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
};

const surpriseMenuState = {
    open: false,
    anchor: null,
    cluster: null,
    targetPickerOpen: false,
    targetListCollapsed: false,
    resetMenuOpen: false,
    expandedMaterials: new Set(),
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
const modTargetDialog = document.querySelector("#mod-target-dialog");
const modTargetList = document.querySelector("#mod-target-list");
const modTargetCancel = document.querySelector("#mod-target-cancel");

const activeCmdSelect = document.querySelector("#active-cmd-select");
const colorSyncActiveCmdSelect = document.querySelector("#color-sync-active-cmd");
const patternSyncActiveCmdSelect = document.querySelector("#pattern-sync-active-cmd");
const duplicateSourceCmdSelect = document.querySelector("#duplicate-source-cmd");
const duplicatePaletteUndoBtn = document.querySelector("#undo-duplicate-palette");
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
const saveColorStateBtn = document.querySelector("#save-color-state");
const loadColorStateBtn = document.querySelector("#load-color-state");
const colorStateFileInput = document.querySelector("#color-state-file");
const colorStateStatus = document.querySelector("#color-state-status");

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
const zipTargetReminder = document.querySelector("#zip-target-reminder");
const includeColorBackupsInput = document.querySelector("#include-color-backups");

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
const referenceViewerAddUrl = document.querySelector("#reference-viewer-add-url");
const referenceViewerUrlForm = document.querySelector("#reference-viewer-url-form");
const referenceViewerUrlInput = document.querySelector("#reference-viewer-url-input");
const referenceViewerUrlLoad = document.querySelector("#reference-viewer-url-load");
const referenceViewerUrlStatus = document.querySelector("#reference-viewer-url-status");
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
const colorPickerRuntimePaste = document.querySelector("#color-picker-runtime-paste");
const colorPickerRuntimeInfo = document.querySelector(".color-picker-runtime-info");
const colorPickerRuntimeTooltip = document.querySelector("#color-picker-runtime-tooltip");
const colorPickerResetLayout = document.querySelector("#color-picker-reset-layout");
const colorPickerResize = document.querySelector("#color-picker-resize");
const surpriseMenu = document.querySelector("#surprise-menu");
const surpriseMenuSummary = document.querySelector("#surprise-menu-summary");
const surpriseMenuClose = document.querySelector("#surprise-menu-close");
const surprisePresetGrid = document.querySelector("#surprise-preset-grid");
const surpriseIntensity = document.querySelector("#surprise-intensity");
const surpriseIntensityValue = document.querySelector("#surprise-intensity-value");
const surpriseTargetSummary = document.querySelector("#surprise-target-summary");
const surpriseEditTargets = document.querySelector("#surprise-edit-targets");
const surpriseTargetPicker = document.querySelector("#surprise-target-picker");
const surpriseTargetListToggle = document.querySelector("#surprise-target-list-toggle");
const surpriseTargetList = document.querySelector("#surprise-target-list");
const surpriseTargetSelectAll = document.querySelector("#surprise-target-select-all");
const surpriseTargetSelectNone = document.querySelector("#surprise-target-select-none");
const surpriseApply = document.querySelector("#surprise-apply");
const surpriseResetGroup = document.querySelector("#surprise-reset-group");
const surpriseResetColors = document.querySelector("#surprise-reset-colors");
const surpriseResetMore = document.querySelector("#surprise-reset-more");
const surpriseResetMenu = document.querySelector("#surprise-reset-menu");
const surpriseResetAll = document.querySelector("#surprise-reset-all");
const surpriseResetSettings = document.querySelector("#surprise-reset-settings");


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
    if (slot?.enabled === false && Array.isArray(slot?.mdfFallbackRgba)) {
        return slot.mdfFallbackRgba.slice();
    }
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

function normalizeSurpriseConfig(saved) {
    const source = saved && typeof saved === "object" ? saved : {};
    const preset = SURPRISE_PRESETS.some(option => option.id === source.preset)
        ? source.preset
        : SURPRISE_DEFAULTS.preset;
    const intensity = Number.isFinite(source.intensity)
        ? Math.max(0, Math.min(1, Number(source.intensity)))
        : SURPRISE_DEFAULTS.intensity;
    // Targeting belongs to the currently loaded CMD set. Never restore it
    // across a page refresh, where the material layout may be unrelated.
    return { preset, intensity, targetMode: SURPRISE_DEFAULTS.targetMode, targets: [] };
}

function saveSurpriseConfig() {
    saveUiState({
        surpriseConfig: {
            preset: state.surpriseConfig.preset,
            intensity: state.surpriseConfig.intensity,
        },
    });
}

function resetSurpriseTargeting() {
    state.surpriseConfig.targetMode = SURPRISE_DEFAULTS.targetMode;
    state.surpriseConfig.targets = [];
    surpriseMenuState.targetPickerOpen = false;
    surpriseMenuState.resetMenuOpen = false;
    surpriseMenuState.expandedMaterials.clear();
}

function applyPersistedUiState() {
    const saved = loadUiState();

    state.surpriseConfig = normalizeSurpriseConfig(saved.surpriseConfig);
    if (typeof saved.surpriseTargetListCollapsed === "boolean") {
        surpriseMenuState.targetListCollapsed = saved.surpriseTargetListCollapsed;
    }

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
    if (includeColorBackupsInput) {
        includeColorBackupsInput.checked = typeof saved.includeColorBackups === "boolean"
            ? saved.includeColorBackups
            : true;
    }
    const pickerBounds = saved.colorPickerBounds;
    if (
        pickerBounds
        && Number.isFinite(pickerBounds.left)
        && Number.isFinite(pickerBounds.top)
        && Number.isFinite(pickerBounds.width)
        && Number.isFinite(pickerBounds.height)
    ) {
        colorPickerState.savedBounds = { ...pickerBounds };
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
    const replaceFailed = saved.filter(item => item.replaceFailed);
    let message = `${parts.join(" and ")}.`;
    if (renamed.length) {
        message += replaceFailed.length
            ? ` The existing target could not be replaced, so the export was saved as ${listExportNames(renamed)} in the same folder.`
            : ` Renamed to ${listExportNames(renamed)} to avoid replacing an existing file.`;
    }
    if (replaced.length) message += ` Replaced existing ${listExportNames(replaced)}.`;
    if (downloaded.some(item => item.folderReset)) {
        message += " The saved export folder or target file changed on disk, so the folder was forgotten; choose it again to restore direct saving.";
    }
    return message.charAt(0).toUpperCase() + message.slice(1);
}

function describeZipExport(result) {
    const { destination } = result;
    const fileCount = result.exported.length;
    const fileLabel = `${fileCount} CMD file${fileCount === 1 ? "" : "s"}`;
    const zipLabel = result.colorsOnly ? "colors-only ZIP" : "mod ZIP";
    if (destination.mode === "download") {
        return `Built ${zipLabel} with ${fileLabel}; sent “${destination.filename}” to browser downloads.`
            + (destination.folderReset
                ? " The saved export folder or target file changed on disk, so the folder was forgotten; choose it again to restore direct saving."
                : "");
    }

    let message = `Built ${zipLabel} with ${fileLabel}. Saved to your selected Mod ZIP folder: “${destination.folderName}/${destination.filename}”.`;
    if (destination.renamed) {
        message += destination.replaceFailed
            ? " Edge could not replace the existing target, so the export was saved under this new name in the same folder. Close programs using the original ZIP before replacing it manually."
            : " Renamed to avoid replacing an existing file.";
    }
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

function isReferenceCmdMetadata(metadata) {
    return metadata?.variant === "ex" || metadata?.variant === "dx";
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

    // Windows exposes members viewed inside a ZIP as virtual files. Chromium
    // currently turns those members into zero-byte File objects when they are
    // dragged onto a web page, so there are no archive or CMD bytes available
    // for us to recover. Point users to the ZIP import path we can read instead
    // of reporting the more generic missing-header error.
    if (file.size === 0) {
        return {
            ok: false,
            file,
            reason: "This CMD arrived as an empty file. If you dragged it from inside a ZIP, drop the ZIP itself instead, or extract the CMD first.",
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

function inspectCmdBuffer(buffer) {
    const usrInspection = inspectUsr(buffer);
    const rszInspection = inspectRsz(buffer, usrInspection.header);

    rszInspection.instanceInfos = resolveInstanceTypes(
        rszInspection.instanceInfos,
        typeRegistry,
    );

    const instanceParse = parseRszInstances(
        buffer,
        rszInspection,
        typeRegistry,
    );

    if (instanceParse.status !== "complete") {
        throw new Error(
            `Failed to parse CMD data: ${instanceParse.reason}`
            + (instanceParse.error ? ` (${instanceParse.error})` : ""),
        );
    }

    const colorClusters = extractSf6ColorClusters(instanceParse);

    return {
        usrInspection,
        rszInspection,
        instanceParse,
        colorClusters,
        summary: summarizeSf6ColorClusters(colorClusters),
    };
}

async function parseCmdEntry(fileEntry) {
    const originalBuffer = await fileEntry.file.arrayBuffer();
    const workingBuffer = originalBuffer.slice(0);
    try {
        const cmd = {
            file: fileEntry.file,
            metadata: fileEntry.metadata,
            originalBuffer,
            workingBuffer,
            ...inspectCmdBuffer(originalBuffer),
        };
        return cmd;
    } catch (error) {
        throw new Error(`Failed to parse ${fileEntry.file.name}: ${error.message || String(error)}`);
    }
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
        reader.addEventListener("error", () => {
            const error = reader.error || new Error("Could not read mod ZIP.");
            if (isStaleFileSystemHandleError(error)) {
                reject(new Error(
                    `“${file.name}” changed on disk while the browser was reading it. `
                    + "Wait for Fluffy Mod Manager or another program to finish using the ZIP, then select it again. "
                    + "If it keeps changing, edit a copied ZIP instead.",
                    { cause: error },
                ));
                return;
            }
            reject(error);
        });
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

async function forgetRememberedColorLibrary() {
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
        const file = await getRememberedColorLibraryFile().catch(() => null);
        state.rememberedColorLibraryFile = file;
        colorLibraryOptions?.classList.remove("hidden");
        const remembered = Boolean(file);
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

function selectedTargetZipFilename(sourceName, target, entries) {
    if (!target) return sourceName;
    const base = String(sourceName || "SF6 Colors.zip").replace(/\.zip$/i, "");
    const label = modTargetName(target, entries).replace(/[<>:"/\\|?*]+/g, "_").trim();
    return `${base} - ${label}.zip`;
}

function modTargetName(target, entries) {
    const text = target.modinfoPath ? new TextDecoder().decode(entries[target.modinfoPath]) : "";
    const rootName = target.root.replace(/\/$/, "").split("/").pop();
    return parseModinfoValue(text, "name") || rootName || `${SF6_CHARACTERS[target.esfId] || target.esfId} C${Number(target.costumeFolder)}`;
}

function chooseEditableCmdTarget(targets, entries) {
    if (targets.length <= 1 || !modTargetDialog || !modTargetList) {
        return Promise.resolve(targets[0] || null);
    }
    modTargetList.innerHTML = "";
    const grouped = new Map();
    for (const target of targets) {
        const key = `${target.esfId}|${target.costumeFolder}`;
        const group = grouped.get(key) || [];
        group.push(target);
        grouped.set(key, group);
    }
    for (const group of grouped.values()) {
        const target = group[0];
        const section = document.createElement("section");
        section.className = "mod-target-group";
        const heading = document.createElement("h3");
        heading.className = "mod-target-group-title";
        heading.textContent = `${SF6_CHARACTERS[target.esfId] || target.esfId} · C${Number(target.costumeFolder)}`;
        section.appendChild(heading);
        for (const option of group) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "mod-target-option";
            const name = document.createElement("span");
            name.className = "mod-target-option-name";
            name.textContent = modTargetName(option, entries);
            const count = document.createElement("span");
            count.className = "mod-target-option-count";
            count.textContent = `${option.cmdPaths.length} CMD${option.cmdPaths.length === 1 ? "" : "s"}`;
            const root = document.createElement("span");
            root.className = "mod-target-option-root";
            root.textContent = option.root.replace(/\/$/, "") || "ZIP root";
            button.append(name, count, root);
            button.addEventListener("click", () => modTargetDialog.close(option.root));
            section.appendChild(button);
        }
        modTargetList.appendChild(section);
    }
    return new Promise(resolve => {
        const close = () => {
            modTargetDialog.removeEventListener("close", close);
            resolve(targets.find(target => target.root === modTargetDialog.returnValue) || null);
        };
        modTargetDialog.addEventListener("close", close);
        modTargetDialog.returnValue = "";
        modTargetDialog.showModal();
        modTargetList.querySelector(".mod-target-option")?.focus();
    });
}

// ============================================================
// @anchor custom-materials
// MDF MATERIAL DISCOVERY + TARGETED CMD CLUSTER REBUILD
// ============================================================

function discoverMdfColorMaterials(entries, { esfId, costumeFolder } = {}) {
    if (!entries || !esfId || !costumeFolder) return [];
    const materialMap = new Map();
    const sourceFolders = costumeFolder === "000"
        ? "000"
        : `(?:${costumeFolder}|000)`;
    const modelPathRe = new RegExp(
        `(?:^|/)natives/stm/(?:streaming/)?product/model/esf/${esfId}/${sourceFolders}/`,
        "i",
    );
    const selectedRoot = state.importedMod?.selectedRoot;

    for (const [path, bytes] of Object.entries(entries)) {
        if (selectedRoot != null && !path.startsWith(selectedRoot)) continue;
        if (!modelPathRe.test(path) || !/\.mdf2\.\d+$/i.test(path)) continue;
        try {
            const buffer = bytes.buffer.slice(
                bytes.byteOffset,
                bytes.byteOffset + bytes.byteLength,
            );
            for (const material of parseMdfMaterialNames(buffer, zipEntryBaseName(path))) {
                if (!material.name || !material.customizeColorIndexes.length) continue;
                const current = materialMap.get(material.name) ?? {
                    name: material.name,
                    customizeColorIndexes: new Set(),
                    paths: [],
                    defaultVariants: [],
                    source: "mod",
                };
                material.customizeColorIndexes.forEach(index => current.customizeColorIndexes.add(index));
                current.paths.push(path);
                const defaultVariant = {
                    path,
                    materialIndex: material.materialIndex,
                    customizeColors: material.customizeColors.map(color => ({
                        index: color.index,
                        linearRgba: color.linearRgba.slice(),
                        cmdRgba: color.cmdRgba.slice(),
                    })),
                };
                const signature = JSON.stringify(defaultVariant.customizeColors.map(color => [color.index, color.cmdRgba]));
                if (!current.defaultVariants.some(variant => variant.signature === signature)) {
                    current.defaultVariants.push({ ...defaultVariant, signature });
                }
                materialMap.set(material.name, current);
            }
        } catch (error) {
            console.warn(`Could not inspect MDF materials in ${path}:`, error);
        }
    }

    return [...materialMap.values()]
        .map(material => ({
            ...material,
            customizeColorIndexes: [...material.customizeColorIndexes].sort((a, b) => a - b),
            defaultVariants: material.defaultVariants.map(({ signature, ...variant }) => variant),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveExternalCustomMaterialSources(libraryEntries, target) {
    if (!libraryEntries || !target || !state.cmdEntries.length) return {};
    const materials = discoverMdfColorMaterials(state.importedMod?.entries, target)
        .filter(material => !state.cmdEntries.every(cmd => (
            cmd.colorClusters.some(cluster => cluster.name === material.name)
        )));
    if (!materials.length) return {};

    const wantedNames = new Set(materials.map(material => material.name));
    const palettes = new Set(state.cmdEntries
        .filter(cmd => cmd.metadata.variant === "standard")
        .map(cmd => cmd.metadata.paletteNumber));
    const byCostume = new Map();
    for (const [path, bytes] of Object.entries(libraryEntries)) {
        const metadata = parseStandardCmdFilename(zipEntryBaseName(path));
        if (
            !metadata
            || metadata.esfId !== target.esfId
            || metadata.costumeFolder === target.costumeFolder
            || !palettes.has(metadata.paletteNumber)
        ) continue;
        try {
            const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            const matches = inspectCmdBuffer(buffer).colorClusters
                .filter(cluster => wantedNames.has(cluster.name));
            if (!matches.length) continue;
            const costume = byCostume.get(metadata.costumeFolder) || new Map();
            costume.set(metadata.paletteNumber, matches);
            byCostume.set(metadata.costumeFolder, costume);
        } catch (error) {
            console.warn(`Could not inspect material sources in ${path}:`, error);
        }
    }

    const resolved = {};
    for (const material of materials) {
        const candidates = [...byCostume].flatMap(([costumeFolder, costumePalettes]) => {
            const paletteSlots = {};
            for (const palette of palettes) {
                const cluster = costumePalettes.get(palette)?.find(candidate => candidate.name === material.name);
                if (!cluster) continue;
                paletteSlots[palette] = cluster.colors.map(slot => ({
                    rgba: [slot.color.r, slot.color.g, slot.color.b, slot.color.a],
                    enabled: Boolean(slot.enabled),
                }));
            }
            return [{ costumeFolder, paletteSlots, coverage: Object.keys(paletteSlots).length }];
        }).filter(candidate => candidate.coverage > 0)
            .sort((left, right) => right.coverage - left.coverage || left.costumeFolder.localeCompare(right.costumeFolder));
        if (!candidates.length) continue;
        const best = candidates[0];
        const tied = candidates.filter(candidate => candidate.coverage === best.coverage);
        if (best.coverage !== palettes.size || tied.length !== 1) continue;
        resolved[material.name] = {
            sourceCostumeFolder: best.costumeFolder,
            paletteSlots: best.paletteSlots,
        };
    }
    return resolved;
}

async function refreshDiscoveredCustomMaterials() {
    const cmdEntriesSnapshot = state.cmdEntries.slice();
    const importedModSnapshot = state.importedMod;
    const refreshIsCurrent = () => (
        state.importedMod === importedModSnapshot
        && state.cmdEntries.length === cmdEntriesSnapshot.length
        && state.cmdEntries.every((cmd, index) => cmd === cmdEntriesSnapshot[index])
    );
    const target = state.cmdEntries[0]?.metadata;
    const importedMaterials = discoverMdfColorMaterials(
        state.importedMod?.entries,
        target,
    );
    let defaultMaterials = [];
    let fallbackWarning = "";
    try {
        defaultMaterials = await loadDefaultMdfColorMaterials(target);
    } catch (error) {
        if (!refreshIsCurrent()) return null;
        console.warn("Could not load bundled default MDF materials:", error);
        fallbackWarning = " Bundled MDF defaults could not be loaded; some inactive slots may be missing.";
    }
    if (!refreshIsCurrent()) return null;
    state.customMdfMaterials = mergeMdfColorMaterials(importedMaterials, defaultMaterials);
    for (const material of state.customMdfMaterials) {
        if (!refreshIsCurrent()) return null;
        const requiredCount = Math.max(...material.customizeColorIndexes, -1) + 1;
        const presentEverywhere = state.cmdEntries.every(cmd => (
            cmd.colorClusters.some(cluster => cluster.name === material.name)
        ));
        const completeEverywhere = state.cmdEntries.every(cmd => (
            cmd.colorClusters.some(cluster => (
                cluster.name === material.name
                && cluster.colors.length >= requiredCount
            ))
        ));
        if (completeEverywhere) continue;
        if (material.source === "default" && !presentEverywhere) continue;
        const templateName = presentEverywhere
            ? material.name
            : automaticCustomMaterialTemplateName(material);
        if (!templateName) {
            throw new Error(`Cannot add MDF material ${material.name}: no compatible CMD color-slot structure exists in every palette.`);
        }
        await addDiscoveredCustomMaterial(
            material.name,
            templateName,
            state.importedMod?.externalCustomMaterialSources?.[material.name],
        );
    }
    if (!refreshIsCurrent()) return null;
    attachMdfFallbackColorsToCmdEntries();
    state.colorClusters = state.cmdEntries[state.activeCmdIndex]?.colorClusters ?? [];
    renderColorClusters(state.colorClusters);
    renderSyncPanels();
    return { fallbackWarning };
}

function attachMdfFallbackColorsToCmdEntries() {
    const materials = new Map(state.customMdfMaterials.map(material => [material.name, material]));
    for (const cmd of state.cmdEntries) {
        const occurrences = new Map();
        for (const cluster of cmd.colorClusters) {
            const material = materials.get(cluster.name);
            if (!material?.defaultVariants?.length) continue;
            const occurrence = occurrences.get(cluster.name) || 0;
            occurrences.set(cluster.name, occurrence + 1);
            const variant = material.defaultVariants[occurrence] || material.defaultVariants[0];
            for (const slot of cluster.colors) {
                const fallback = variant.customizeColors.find(color => color.index === slot.index);
                if (!fallback) continue;
                slot.mdfFallbackRgba = fallback.cmdRgba.slice();
                slot.mdfFallbackLinearRgba = fallback.linearRgba.slice();
                slot.mdfFallbackPath = variant.path;
            }
        }
    }
}

function resetLoadedCmdState() {
    state.files = [];
    state.rejectedFiles = [];
    state.cmdEntries = [];
    state.activeCmdIndex = 0;
    state.colorClusters = [];
    state.openClusterNames.clear();
    state.surpriseSnapshots.clear();
    resetSurpriseTargeting();
    state.inspectorDirty = false;
    state.detectedEsfId = null;
    state.detectedCharacterName = null;
    state.detectedCostume = null;
    state.customMdfMaterials = [];
    state.customMaterialMappings = [];
    state.paletteDuplicate.undo = null;
    hideStatus(colorStateStatus);
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

function clearReferenceImages() {
    for (const image of state.referenceImages) {
        if (typeof image?.src === "string" && image.src.startsWith("blob:")) {
            URL.revokeObjectURL(image.src);
        }
    }
    state.referenceImages = [];
    state.referenceImageIndex = 0;
    state.referenceLoading = false;
    renderReferenceViewer();
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
            throw new Error("Mod ZIP expands beyond the 750 MiB safety limit.");
        }

        const paths = Object.keys(entries).filter(path => !path.endsWith("/"));
        // Backups contain valid CMD filenames too, but they are restore sources,
        // never live mod files to load into the editor automatically.
        const livePaths = paths.filter(path => !isColorBackupPath(path));
        // Palette 000 is an empty/internal palette in mod ZIPs and produces an
        // unhelpful non-editable entry. Preserve it in the archive, but do not
        // expose it to ZIP target discovery or the editor. Direct CMD uploads
        // intentionally retain their existing inspection behavior.
        const zipEditablePaths = livePaths.filter(path => {
            const metadata = parseStandardCmdFilename(zipEntryBaseName(path));
            return !metadata || metadata.paletteNumber !== 0;
        });
        const allStandardCmdPaths = zipEditablePaths.filter(path =>
            parseStandardCmdFilename(zipEntryBaseName(path)),
        );
        const modinfoPaths = paths.filter(path => zipEntryBaseName(path).toLowerCase() === "modinfo.ini");
        const editableTargets = discoverEditableCmdTargets(zipEditablePaths, modinfoPaths, parseCmdFilename);
        const selectedTarget = await chooseEditableCmdTarget(editableTargets, entries);
        if (editableTargets.length && !selectedTarget) {
            throw new DOMException("Mod target selection was cancelled.", "AbortError");
        }
        const standardCmdPaths = selectedTarget?.cmdPaths || allStandardCmdPaths;
        const selectedRoot = selectedTarget?.root ?? null;
        const standardScopes = standardCmdPaths
            .map(path => parseCmdFilename(zipEntryBaseName(path)))
            .filter(Boolean);
        const standardScopeKeys = new Set(standardScopes.map(metadata => (
            `${metadata.esfId}|${metadata.costumeFolder}|${metadata.version}`
        )));
        const referenceCmdPaths = livePaths.filter(path => {
            if (selectedRoot != null && !path.startsWith(selectedRoot)) return false;
            const metadata = parseCmdFilename(zipEntryBaseName(path));
            return Boolean(
                metadata
                && (metadata.variant === "ex" || metadata.variant === "dx")
                && metadata.paletteNumber >= 1
                && metadata.paletteNumber <= 10
                && standardScopeKeys.has(
                    `${metadata.esfId}|${metadata.costumeFolder}|${metadata.version}`,
                ),
            );
        });
        const loadedCmdPaths = standardCmdPaths.concat(referenceCmdPaths);
        const loadedReferencePathSet = new Set(referenceCmdPaths);
        const ignoredVariantCount = livePaths.filter(path => {
            if (selectedRoot != null && !path.startsWith(selectedRoot)) return false;
            const metadata = parseCmdFilename(zipEntryBaseName(path));
            return metadata && metadata.variant !== "standard" && !loadedReferencePathSet.has(path);
        }).length;
        const cmdEntries = loadedCmdPaths
            .map(path => new File([entries[path]], zipEntryBaseName(path), { type: "application/octet-stream" }));

        // Some mod managers ZIP the mod contents directly, while others include
        // one enclosing folder. Accept either layout and preserve it verbatim.
        // Bundles commonly contain sibling Hair and Outfit submods. CMD files
        // belong to the nearest enclosing modinfo.ini, not whichever metadata
        // file happened to appear first in ZIP order.
        const modinfoPath = selectedTarget?.modinfoPath
            || findOwningModinfoPath(standardCmdPaths, modinfoPaths)
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
            clearReferenceImages();
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
        clearReferenceImages();
        clearScreenshot();
        state.importedMod = {
            entries,
            selectedRoot,
            selectedTarget,
            requiredTargetSelection: editableTargets.length > 1,
            modinfoPath,
            modinfoText,
            sourceName: file.name,
            referenceImagePath: screenshotPath,
            cmdPaths: Object.fromEntries(loadedCmdPaths.map(path => [
                cmdIdentityKey(parseCmdFilename(zipEntryBaseName(path))),
                path,
            ])),
            hadLiveCmd: Object.fromEntries(loadedCmdPaths.map(path => [path, true])),
            lastZipExportBuffers: {},
            modinfoByRoot: Object.fromEntries(modinfoPaths.map(path => [zipEntryDirectory(path), path])),
            colorBackupManifest: readColorBackupManifest(entries, zipEntryDirectory(modinfoPath)),
        };
        state.customMaterialMappings = state.importedMod.colorBackupManifest.customMaterials
            .map(mapping => ({ ...mapping, customizeColorIndexes: mapping.customizeColorIndexes.slice() }));
        setImportedModMetadata(
            modinfoText,
            editableTargets.length > 1
                ? selectedTargetZipFilename(file.name, selectedTarget, entries)
                : file.name,
        );
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
        const mdfRefresh = await refreshDiscoveredCustomMaterials();
        if (!mdfRefresh) return;
        const loadedMeta = state.cmdEntries[0]?.metadata;
        const targetLivePaths = selectedRoot == null
            ? livePaths
            : livePaths.filter(path => path.startsWith(selectedRoot));
        const targetModinfoPaths = selectedTarget?.modinfoPath ? [selectedTarget.modinfoPath] : modinfoPaths;
        const detectedTarget = detectCmdPaletteTarget(
            targetLivePaths,
            targetModinfoPaths,
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
            mdfRefresh.fallbackWarning ? "warn" : "good",
            `Imported ${cmdEntries.length} CMD file${cmdEntries.length === 1 ? "" : "s"} from ${modTargetName(selectedTarget || { root: modRoot, modinfoPath }, entries)}.`
            + (referenceCmdPaths.length ? ` Loaded ${referenceCmdPaths.length} EX/DX reference file${referenceCmdPaths.length === 1 ? "" : "s"}.` : "")
            + (ignoredVariantCount ? ` Ignored ${ignoredVariantCount} non-selected variant file${ignoredVariantCount === 1 ? "" : "s"}.` : "")
            + " Other mod files will be preserved on ZIP export."
            + mdfRefresh.fallbackWarning,
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
        state.importedMod.externalCustomMaterialSources = resolveExternalCustomMaterialSources(
            libraryEntries,
            target,
        );
        const mdfRefresh = await refreshDiscoveredCustomMaterials();
        if (!mdfRefresh) return;
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
            mdfRefresh.fallbackWarning ? "warn" : "good",
            `Kept ${state.cmdEntries.length - matching.length} CMD file${state.cmdEntries.length - matching.length === 1 ? "" : "s"} from the mod and added ${matching.length} missing color${matching.length === 1 ? "" : "s"} from SF6 Colors.zip.`
            + (ignoredVariantCount ? ` Ignored ${ignoredVariantCount} EX/DX CMD file${ignoredVariantCount === 1 ? "" : "s"}.` : "")
            + mdfRefresh.fallbackWarning,
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
        newlyParsed.push(applyCustomMappingsToCmdEntry(await parseCmdEntry(entry)));
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
    const referenceAddedCount = newlyParsed.filter(cmd => isReferenceCmdMetadata(cmd.metadata)).length;
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
    if (referenceAddedCount > 0) {
        msg += ` ${referenceAddedCount} EX/DX file${referenceAddedCount === 1 ? " is" : "s are"} reference-only; edits may not apply in-game.`;
    }

    showStatus(
        parserStatus,
        (skipCount > 0 || referenceAddedCount > 0) ? "warn" : (addedCount > 0 ? "good" : "warn"),
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

function isDuplicatePaletteSource(cmd) {
    const meta = cmd?.metadata;
    return Boolean(
        meta
        && (meta.variant === "standard" || meta.variant === "ex" || meta.variant === "dx")
        && meta.paletteNumber >= 1
        && meta.paletteNumber <= 10,
    );
}

function duplicatePaletteScopeMatches(source, target) {
    const sourceMeta = source?.metadata;
    const targetMeta = target?.metadata;
    return Boolean(
        sourceMeta
        && targetMeta
        && sourceMeta.esfId === targetMeta.esfId
        && sourceMeta.costumeFolder === targetMeta.costumeFolder
        && sourceMeta.version === targetMeta.version,
    );
}

function listDuplicatePaletteSourceIndexes() {
    return state.cmdEntries
        .map((cmd, index) => ({ cmd, index }))
        .filter(({ cmd }) => isDuplicatePaletteSource(cmd));
}

function listDuplicatePaletteTargetIndexes(sourceIndex = state.paletteDuplicate.sourceCmdIndex) {
    const source = state.cmdEntries[sourceIndex];
    if (!isDuplicatePaletteSource(source)) return [];

    return state.cmdEntries
        .map((cmd, index) => ({ cmd, index }))
        .filter(({ cmd }) => (
            cmd.metadata.variant === "standard"
            && cmd.metadata.paletteNumber >= 1
            && cmd.metadata.paletteNumber <= 10
            && cmd.metadata.paletteNumber !== source.metadata.paletteNumber
            && duplicatePaletteScopeMatches(source, cmd)
        ))
        .map(({ index }) => index);
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

    const duplicateSources = listDuplicatePaletteSourceIndexes();
    const defaultDuplicateSource = duplicateSources.find(({ cmd }) => (
        cmd.metadata.variant === "standard"
        && cmd.metadata.paletteNumber === 1
    )) || duplicateSources[0];
    state.paletteDuplicate.sourceCmdIndex = defaultDuplicateSource?.index ?? null;
    state.paletteDuplicate.targetCmdIndexes = defaultDuplicateSource
        ? listDuplicatePaletteTargetIndexes(defaultDuplicateSource.index)
        : [];
    state.paletteDuplicate.undo = null;
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
// @anchor palette-duplicate
// DUPLICATE PALETTE
// ============================================================

function rawSlotEnabled(cmd, slot) {
    const offset = slot?.enable?.absoluteOffset;
    const value = enabledAtOffset(cmd?.workingBuffer, offset, slot?.enable?.byteLength);
    return value === null ? isSlotEnabled(slot) : value;
}

function buildPaletteDuplicatePlan(source, target) {
    const operations = [];
    let missingMaterials = 0;
    let missingSlots = 0;
    let skippedNonEditable = 0;

    for (const sourceCluster of source.colorClusters ?? []) {
        if (!sourceCluster.colors?.length) continue;

        const targetCluster = getMaterial(target, sourceCluster.name);
        if (!targetCluster) {
            missingMaterials += sourceCluster.colors.filter(isSlotEditable).length;
            continue;
        }

        for (const sourceSlot of sourceCluster.colors) {
            if (!isSlotEditable(sourceSlot)) {
                skippedNonEditable += 1;
                continue;
            }

            const targetSlot = targetCluster.colors.find(slot => slot.index === sourceSlot.index);
            if (!isSlotEditable(targetSlot)) {
                missingSlots += 1;
                continue;
            }

            operations.push({
                materialName: sourceCluster.name,
                sourceSlot,
                targetSlot,
                rgba: rgbaAtOffset(source.workingBuffer, sourceSlot.color.absoluteOffset),
                enabled: rawSlotEnabled(source, sourceSlot),
            });
        }
    }

    return {
        operations,
        missingMaterials,
        missingSlots,
        skippedNonEditable,
    };
}

function applyPaletteDuplicate() {
    const source = state.cmdEntries[state.paletteDuplicate.sourceCmdIndex];
    if (!isDuplicatePaletteSource(source)) {
        throw new Error("Select a standard, EX, or DX source palette.");
    }

    const selectedTargetIndexes = state.paletteDuplicate.targetCmdIndexes
        .filter(index => listDuplicatePaletteTargetIndexes(state.paletteDuplicate.sourceCmdIndex).includes(index));
    if (!selectedTargetIndexes.length) {
        throw new Error("Select at least one standard target palette.");
    }

    const targetPlans = selectedTargetIndexes
        .map(index => ({ index, cmd: state.cmdEntries[index] }))
        .filter(({ cmd }) => cmd)
        .map(({ index, cmd }) => ({
            index,
            cmd,
            plan: buildPaletteDuplicatePlan(source, cmd),
        }));
    const operationCount = targetPlans.reduce((total, entry) => total + entry.plan.operations.length, 0);
    if (!operationCount) {
        throw new Error("No matching editable color slots were found in the selected targets.");
    }

    const missingMaterials = targetPlans.reduce((total, entry) => total + entry.plan.missingMaterials, 0);
    const missingSlots = targetPlans.reduce((total, entry) => total + entry.plan.missingSlots, 0);
    const undoOperations = [];

    let copied = 0;
    let changed = 0;
    let enableSkipped = 0;

    for (const { index: cmdIndex, cmd, plan } of targetPlans) {
        for (const operation of plan.operations) {
            const targetOffset = operation.targetSlot.color.absoluteOffset;
            const beforeRgba = rgbaAtOffset(cmd.workingBuffer, targetOffset);
            const beforeEnabled = rawSlotEnabled(cmd, operation.targetSlot);
            const enableOffset = operation.targetSlot.enable?.absoluteOffset;
            const enableByteLength = operation.targetSlot.enable?.byteLength ?? 1;
            const canSnapshotEnable = Number.isInteger(enableOffset)
                && enableOffset >= 0
                && enableOffset + enableByteLength <= cmd.workingBuffer.byteLength;
            const beforeEnableBytes = canSnapshotEnable
                ? Array.from(new Uint8Array(cmd.workingBuffer, enableOffset, enableByteLength))
                : null;

            writeRgbaAtOffset(cmd.workingBuffer, targetOffset, operation.rgba);
            updateColorModelAtOffset(cmd, targetOffset, operation.rgba);

            let enableChanged = false;
            if (Number.isInteger(operation.targetSlot.enable?.absoluteOffset)) {
                enableChanged = beforeEnabled !== operation.enabled;
                writeEnableAtOffset(
                    cmd.workingBuffer,
                    operation.targetSlot.enable.absoluteOffset,
                    operation.targetSlot.enable.byteLength ?? 1,
                    operation.enabled,
                );
                operation.targetSlot.enabled = operation.enabled;
                operation.targetSlot.enable.value = operation.enabled;
            } else if (beforeEnabled !== operation.enabled) {
                enableSkipped += 1;
            }

            copied += 1;
            if (!rgbaEquals(beforeRgba, operation.rgba) || enableChanged) {
                changed += 1;
                undoOperations.push({
                    cmdIndex,
                    targetOffset,
                    beforeRgba: beforeRgba.slice(),
                    targetSlot: operation.targetSlot,
                    enableOffset: canSnapshotEnable ? enableOffset : null,
                    enableByteLength,
                    beforeEnabled,
                    beforeEnableBytes,
                });
            }
        }
    }

    state.paletteDuplicate.undo = changed > 0
        ? {
            operations: undoOperations,
            targets: targetPlans.length,
        }
        : null;
    renderDuplicateUndoButton();

    if (changed > 0) {
        state.inspectorDirty = true;
        updateInspectorDirtyUi();
        renderColorClusters(state.cmdEntries[state.activeCmdIndex]?.colorClusters ?? []);
        renderCurrentChanges();
        renderSyncPanels();
        updateExportButtons();
    }

    return {
        copied,
        changed,
        targets: targetPlans.length,
        missingMaterials,
        missingSlots,
        enableSkipped,
    };
}

function renderDuplicateUndoButton() {
    if (!duplicatePaletteUndoBtn) return;
    const available = Boolean(state.paletteDuplicate.undo?.operations?.length);
    duplicatePaletteUndoBtn.disabled = !available;
    duplicatePaletteUndoBtn.classList.toggle("hidden", !available);
}

function undoLastPaletteDuplicate() {
    const undo = state.paletteDuplicate.undo;
    if (!undo?.operations?.length) return { changed: 0, targets: 0 };

    let changed = 0;
    for (const operation of undo.operations) {
        const cmd = state.cmdEntries[operation.cmdIndex];
        if (!cmd) continue;

        const currentRgba = rgbaAtOffset(cmd.workingBuffer, operation.targetOffset);
        const currentEnableBytes = operation.enableOffset !== null
            ? Array.from(new Uint8Array(cmd.workingBuffer, operation.enableOffset, operation.enableByteLength))
            : null;
        const enableChanged = operation.beforeEnableBytes !== null
            && !currentEnableBytes.every((value, index) => value === operation.beforeEnableBytes[index]);

        writeRgbaAtOffset(cmd.workingBuffer, operation.targetOffset, operation.beforeRgba);
        updateColorModelAtOffset(cmd, operation.targetOffset, operation.beforeRgba);

        if (operation.enableOffset !== null && operation.beforeEnableBytes !== null) {
            new Uint8Array(cmd.workingBuffer).set(operation.beforeEnableBytes, operation.enableOffset);
            operation.targetSlot.enabled = operation.beforeEnabled;
            if (operation.targetSlot.enable) operation.targetSlot.enable.value = operation.beforeEnabled;
        }

        if (!rgbaEquals(currentRgba, operation.beforeRgba) || enableChanged) changed += 1;
    }

    state.paletteDuplicate.undo = null;
    state.inspectorDirty = state.cmdEntries.some(cmd => (
        diffBuffers(cmd.semanticBaselineBuffer ?? cmd.originalBuffer, cmd.workingBuffer).length > 0
    ));
    updateInspectorDirtyUi();
    renderColorClusters(state.cmdEntries[state.activeCmdIndex]?.colorClusters ?? []);
    renderCurrentChanges();
    renderSyncPanels();
    updateExportButtons();

    return { changed, targets: undo.targets };
}


// ============================================================
// @anchor changes-replace
// CHANGES / REVERT
// ============================================================

function getCurrentColorChanges() {
    const result = [];

    state.cmdEntries.forEach((cmd, cmdIndex) => {
        const changes = [];
        const baseline = cmd.semanticBaselineBuffer ?? cmd.originalBuffer;

        for (const cluster of cmd.colorClusters) {
            for (const color of cluster.colors) {
                const offset = color.color?.absoluteOffset;
                if (!Number.isInteger(offset)) continue;

                const beforeRgba = rgbaAtOffset(baseline, offset);
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

    const original = rgbaAtOffset(cmd.semanticBaselineBuffer ?? cmd.originalBuffer, offset);
    writeRgbaAtOffset(cmd.workingBuffer, offset, original);
    updateColorModelAtOffset(cmd, offset, original);
    removeSurpriseSnapshotSlot(cmd, offset);

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
        const baseline = cmd.semanticBaselineBuffer ?? cmd.originalBuffer;
        const working = new Uint8Array(cmd.workingBuffer);
        working.set(new Uint8Array(baseline));

        for (const cluster of cmd.colorClusters) {
            for (const color of cluster.colors) {
                const offset = color.color?.absoluteOffset;
                if (!Number.isInteger(offset)) continue;
                const rgba = rgbaAtOffset(baseline, offset);
                updateColorModelAtOffset(cmd, offset, rgba);
                const enabled = enabledAtOffset(
                    baseline,
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

    state.surpriseSnapshots.clear();
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
// @anchor color-state
// PORTABLE COLOR-STATE SAVE / RESUME
// ============================================================

const COLOR_STATE_FORMAT = "sf6-cmd-color-state";
const COLOR_STATE_VERSION = 1;
const MAX_COLOR_STATE_BYTES = 16 * 1024 * 1024;

function editableColorStateSlots(cmd) {
    return cmd.colorClusters.flatMap((cluster, clusterIndex) => cluster.colors
        .filter(isSlotEditable)
        .map(slot => ({ cluster, clusterIndex, slot })));
}

function buildColorStateDocument() {
    if (!state.cmdEntries.length) throw new Error("Load a mod ZIP or CMD files before saving a color state.");

    return {
        format: COLOR_STATE_FORMAT,
        version: COLOR_STATE_VERSION,
        createdAt: new Date().toISOString(),
        source: {
            characterId: state.detectedEsfId,
            characterName: state.detectedCharacterName,
            costume: state.detectedCostume,
            archiveName: state.importedMod?.sourceName ?? null,
        },
        commands: state.cmdEntries.map(cmd => ({
            identity: cmdIdentityKey(cmd.metadata),
            filename: cmd.file.name,
            metadata: {
                esfId: cmd.metadata.esfId,
                costumeFolder: cmd.metadata.costumeFolder,
                variant: cmd.metadata.variant,
                paletteFolder: cmd.metadata.paletteFolder,
                version: cmd.metadata.version,
            },
            slots: editableColorStateSlots(cmd).map(({ cluster, clusterIndex, slot }) => ({
                clusterIndex,
                material: cluster.name,
                slotIndex: slot.index,
                runtimeName: slot.runtimeName,
                rgba: rgbaAtOffset(cmd.workingBuffer, slot.color.absoluteOffset),
                enabled: enabledAtOffset(
                    cmd.workingBuffer,
                    slot.enable?.absoluteOffset,
                    slot.enable?.byteLength,
                ),
            })),
        })),
    };
}

function colorStateFilename() {
    const sourceName = state.importedMod?.sourceName || state.cmdEntries[0]?.file.name || "sf6-colors";
    const stem = sourceName
        .replace(/\.zip$/i, "")
        .replace(/\.user\.\d+$/i, "")
        .replace(/[<>:"/\\|?*]+/g, "_")
        .trim() || "sf6-colors";
    return `${stem}.sf6colors.json`;
}

async function saveCurrentColorState() {
    const document = buildColorStateDocument();
    const bytes = new TextEncoder().encode(`${JSON.stringify(document, null, 2)}\n`);
    const filename = colorStateFilename();
    const destination = await saveExportFile("state", bytes, filename, { type: "application/json" });
    const slotCount = document.commands.reduce((total, cmd) => total + cmd.slots.length, 0);
    return { destination, filename, commandCount: document.commands.length, slotCount };
}

function validateColorStateDocument(document) {
    if (!document || typeof document !== "object" || Array.isArray(document)) {
        throw new Error("This is not a valid SF6 Color Sync state file.");
    }
    if (document.format !== COLOR_STATE_FORMAT || document.version !== COLOR_STATE_VERSION) {
        throw new Error("This color state uses an unsupported format or version.");
    }
    if (!Array.isArray(document.commands) || !document.commands.length) {
        throw new Error("This color state contains no CMD color data.");
    }
    if (!state.cmdEntries.length) {
        throw new Error("Load the original mod ZIP or CMD files before loading a color state.");
    }

    const loadedByIdentity = new Map(state.cmdEntries.map(cmd => [cmdIdentityKey(cmd.metadata), cmd]));
    const savedByIdentity = new Map();
    for (const savedCmd of document.commands) {
        if (!savedCmd || typeof savedCmd.identity !== "string" || savedByIdentity.has(savedCmd.identity)) {
            throw new Error("The color state contains an invalid or duplicate CMD identity.");
        }
        savedByIdentity.set(savedCmd.identity, savedCmd);
    }

    const missingFromLoaded = [...savedByIdentity.keys()].filter(key => !loadedByIdentity.has(key));
    const missingFromState = [...loadedByIdentity.keys()].filter(key => !savedByIdentity.has(key));
    if (missingFromLoaded.length || missingFromState.length) {
        throw new Error(
            "The loaded ZIP/CMD set does not match this color state. Load the same character, outfit, variants, and palettes used when it was saved.",
        );
    }

    const operations = [];
    for (const [identity, savedCmd] of savedByIdentity) {
        const cmd = loadedByIdentity.get(identity);
        if (!Array.isArray(savedCmd.slots)) {
            throw new Error(`Color data is missing for ${savedCmd.filename || identity}.`);
        }

        const expectedSlots = editableColorStateSlots(cmd);
        if (savedCmd.slots.length !== expectedSlots.length) {
            throw new Error(
                `${savedCmd.filename || identity} has a different editable material/slot structure than the loaded CMD.`,
            );
        }

        const seenTargets = new Set();
        for (const savedSlot of savedCmd.slots) {
            const { clusterIndex, material, slotIndex, rgba, enabled } = savedSlot || {};
            if (!Number.isInteger(clusterIndex) || clusterIndex < 0 || !Number.isInteger(slotIndex)) {
                throw new Error(`The color state has an invalid slot address in ${savedCmd.filename || identity}.`);
            }
            const cluster = cmd.colorClusters[clusterIndex];
            const slot = cluster?.colors.find(candidate => candidate.index === slotIndex);
            const targetKey = `${clusterIndex}|${slotIndex}`;
            if (!cluster || cluster.name !== material || !isSlotEditable(slot) || seenTargets.has(targetKey)) {
                throw new Error(
                    `${savedCmd.filename || identity} has a different editable material/slot structure than the loaded CMD.`,
                );
            }
            if (!Array.isArray(rgba) || rgba.length !== 4
                || rgba.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
                throw new Error(`The color state contains invalid RGBA data in ${savedCmd.filename || identity}.`);
            }
            if (enabled !== null && typeof enabled !== "boolean") {
                throw new Error(`The color state contains an invalid active state in ${savedCmd.filename || identity}.`);
            }
            if (enabled !== null && (!slot.enable || !Number.isInteger(slot.enable.absoluteOffset))) {
                throw new Error(`The loaded CMD cannot restore an active state recorded in ${savedCmd.filename || identity}.`);
            }
            seenTargets.add(targetKey);
            operations.push({ cmd, slot, rgba: rgba.slice(), enabled });
        }
    }
    return operations;
}

function applyColorStateDocument(document) {
    const operations = validateColorStateDocument(document);
    let changedSlots = 0;

    for (const { cmd, slot, rgba, enabled } of operations) {
        const currentRgba = rgbaAtOffset(cmd.workingBuffer, slot.color.absoluteOffset);
        const currentEnabled = enabledAtOffset(
            cmd.workingBuffer,
            slot.enable?.absoluteOffset,
            slot.enable?.byteLength,
        );
        if (!rgbaEquals(currentRgba, rgba) || currentEnabled !== enabled) changedSlots += 1;

        writeRgbaAtOffset(cmd.workingBuffer, slot.color.absoluteOffset, rgba);
        updateColorModelAtOffset(cmd, slot.color.absoluteOffset, rgba);
        if (enabled !== null) {
            writeEnableAtOffset(
                cmd.workingBuffer,
                slot.enable.absoluteOffset,
                slot.enable.byteLength ?? 1,
                enabled,
            );
            slot.enabled = enabled;
            slot.enable.value = enabled;
        }
    }

    state.surpriseSnapshots.clear();
    state.inspectorDirty = state.cmdEntries.some(cmd => (
        diffBuffers(cmd.semanticBaselineBuffer ?? cmd.originalBuffer, cmd.workingBuffer).length > 0
    ));
    updateInspectorDirtyUi();
    renderColorClusters(state.cmdEntries[state.activeCmdIndex]?.colorClusters ?? []);
    renderCurrentChanges();
    renderSyncPanels();
    updateExportButtons();
    return { commandCount: document.commands.length, slotCount: operations.length, changedSlots };
}

async function loadColorStateFile(file) {
    if (!file) throw new Error("Choose a color-state file.");
    if (file.size > MAX_COLOR_STATE_BYTES) throw new Error("Color-state files are limited to 16 MiB.");
    let document;
    try {
        document = JSON.parse(await file.text());
    } catch {
        throw new Error("The selected file is not valid JSON.");
    }
    return applyColorStateDocument(document);
}


// ============================================================
// @anchor export
// EXPORT
// ============================================================

function diffBuffers(original, working) {
    const a = new Uint8Array(original);
    const b = new Uint8Array(working);
    const diff = [];
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
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
    const colorBaseline = baseline.byteLength === cmd.workingBuffer.byteLength
        ? baseline
        : (cmd.semanticBaselineBuffer ?? baseline);
    for (const cluster of cmd.colorClusters) for (const slot of cluster.colors) {
        const offset = slot.color?.absoluteOffset;
        if (!Number.isInteger(offset)) continue;
        const beforeRgba = rgbaAtOffset(colorBaseline, offset);
        const afterRgba = rgbaAtOffset(cmd.workingBuffer, offset);
        const beforeEnabled = enabledAtOffset(colorBaseline, slot.enable?.absoluteOffset, slot.enable?.byteLength);
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
    const hasCmds = state.cmdEntries.length > 0;
    if (buildButton) buildButton.disabled = !hasChanges;
    if (exportCmdButton) exportCmdButton.disabled = !hasChanges;
    if (exportColorsZipButton) exportColorsZipButton.disabled = !state.importedMod || state.cmdEntries.length === 0;
    if (saveColorStateBtn) saveColorStateBtn.disabled = !hasCmds;
    if (loadColorStateBtn) loadColorStateBtn.disabled = !hasCmds;
}

function updateZipFileNameField() {
    zipFileNameField?.classList.toggle("hidden", !state.importedMod);
    zipTargetReminder?.classList.toggle("hidden", !state.importedMod?.requiredTargetSelection);
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
    const includeColorBackups = includeColorBackupsInput?.checked !== false;
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

    if (!includeColorBackups) {
        for (const path of Object.keys(files)) {
            if (
                path.toLowerCase().startsWith(modRoot.toLowerCase())
                && isColorBackupPath(path)
            ) {
                delete files[path];
            }
        }
    }

    const exported = [];
    const includedCmds = [];
    const changedCmds = [];

    for (const cmd of state.cmdEntries) {
        if (colorsOnly && isReferenceCmdMetadata(cmd.metadata)) continue;
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

    if (includeColorBackups) {
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
            customMaterials: state.customMaterialMappings,
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

function clampColorPickerBounds(bounds) {
    const pad = 8;
    const maxWidth = Math.max(1, window.innerWidth - (pad * 2));
    const maxHeight = Math.max(1, window.innerHeight - (pad * 2));
    const minWidth = Math.min(240, maxWidth);
    const minHeight = Math.min(420, maxHeight);
    const width = Math.min(maxWidth, Math.max(minWidth, Number(bounds.width) || minWidth));
    const height = Math.min(maxHeight, Math.max(minHeight, Number(bounds.height) || minHeight));
    const left = Math.min(
        window.innerWidth - width - pad,
        Math.max(pad, Number(bounds.left) || pad),
    );
    const top = Math.min(
        window.innerHeight - height - pad,
        Math.max(pad, Number(bounds.top) || pad),
    );
    return { left, top, width, height };
}

function applySavedColorPickerBounds() {
    if (!customColorPicker || !colorPickerState.savedBounds) return false;
    const bounds = clampColorPickerBounds(colorPickerState.savedBounds);
    colorPickerState.savedBounds = bounds;
    customColorPicker.style.left = `${bounds.left}px`;
    customColorPicker.style.top = `${bounds.top}px`;
    customColorPicker.style.width = `${bounds.width}px`;
    customColorPicker.style.height = `${bounds.height}px`;
    return true;
}

function saveCurrentColorPickerBounds() {
    if (!customColorPicker || customColorPicker.classList.contains("hidden")) return;
    const rect = customColorPicker.getBoundingClientRect();
    const bounds = clampColorPickerBounds({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
    });
    colorPickerState.savedBounds = bounds;
    saveUiState({ colorPickerBounds: bounds });
}

function resetColorPickerLayout() {
    colorPickerState.savedBounds = null;
    saveUiState({ colorPickerBounds: null });
    if (!customColorPicker) return;
    customColorPicker.style.width = "";
    customColorPicker.style.height = "";
    positionColorPicker(colorPickerState.anchor, { ignoreSaved: true });
}

function positionRuntimeColorTooltip() {
    if (!colorPickerRuntimeInfo || !colorPickerRuntimeTooltip) return;
    const anchorRect = colorPickerRuntimeInfo.getBoundingClientRect();
    const tooltipRect = colorPickerRuntimeTooltip.getBoundingClientRect();
    const pad = 8;
    const gap = 8;
    const left = Math.min(
        window.innerWidth - tooltipRect.width - pad,
        Math.max(pad, anchorRect.left + (anchorRect.width - tooltipRect.width) / 2),
    );
    let top = anchorRect.top - tooltipRect.height - gap;
    if (top < pad) top = anchorRect.bottom + gap;
    top = Math.min(window.innerHeight - tooltipRect.height - pad, Math.max(pad, top));
    colorPickerRuntimeTooltip.style.left = `${left}px`;
    colorPickerRuntimeTooltip.style.top = `${top}px`;
}

function showRuntimeColorTooltip() {
    if (!colorPickerRuntimeTooltip) return;
    positionRuntimeColorTooltip();
    colorPickerRuntimeTooltip.classList.add("visible");
    colorPickerRuntimeTooltip.setAttribute("aria-hidden", "false");
}

function hideRuntimeColorTooltip() {
    colorPickerRuntimeTooltip?.classList.remove("visible");
    colorPickerRuntimeTooltip?.setAttribute("aria-hidden", "true");
}

function positionColorPicker(anchor, { ignoreSaved = false } = {}) {
    if (!customColorPicker || !anchor) return;
    if (!ignoreSaved && applySavedColorPickerBounds()) return;
    const rect = anchor.getBoundingClientRect();
    const pad = 8;
    const contentGap = 12;
    const pw = customColorPicker.offsetWidth || 220;
    const ph = customColorPicker.offsetHeight || 280;

    let left = rect.left;
    let top = rect.bottom + pad;

    // Material rows have a wide descriptive-name lane between the swatch and
    // hex input. Prefer that lane so the picker leaves the useful color boxes
    // and exact hex values visible; friendly names may sit behind the picker.
    const slotRow = anchor.closest?.(".cluster-slot-row");
    const rowHexInput = slotRow?.querySelector(".cluster-slot-hex");
    if (rowHexInput) {
        const hexRect = rowHexInput.getBoundingClientRect();
        const controlsShareLine = Math.abs(hexRect.top - rect.top) < Math.max(rect.height, hexRect.height);
        const laneLeft = rect.right + contentGap;
        const laneRight = hexRect.left - contentGap;

        if (controlsShareLine && laneRight - laneLeft >= pw) {
            // Sit as far right as possible inside the name lane.
            left = laneRight - pw;
        } else if (hexRect.right + contentGap + pw <= window.innerWidth - pad) {
            left = hexRect.right + contentGap;
        } else if (rect.left - contentGap - pw >= pad) {
            left = rect.left - contentGap - pw;
        }
    }

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
    // The picker was hidden during the first sync, so refresh geometry now
    // that its restored or default size is measurable.
    syncPickerFromRgba(colorPickerState.rgba, { skipHex: true });
}

function closeCustomColorPicker() {
    const onClose = colorPickerState.onClose;
    hideRuntimeColorTooltip();
    colorPickerState.open = false;
    colorPickerState.anchor = null;
    colorPickerState.onChange = null;
    colorPickerState.onClose = null;
    colorPickerState.originalRgba = [255, 255, 255, 255];
    colorPickerState.draggingWindow = false;
    colorPickerState.resizingWindow = false;
    customColorPicker?.classList.remove("is-dragging");
    customColorPicker?.classList.remove("is-resizing");
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
        const wasDragging = colorPickerState.draggingWindow;
        colorPickerState.draggingWindow = false;
        customColorPicker.classList.remove("is-dragging");
        if (wasDragging) saveCurrentColorPickerBounds();
    };
    customColorPicker.addEventListener("pointerup", stopDraggingPickerWindow);
    customColorPicker.addEventListener("pointercancel", stopDraggingPickerWindow);

    colorPickerResize?.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        const rect = customColorPicker.getBoundingClientRect();
        colorPickerState.resizingWindow = true;
        colorPickerState.resizeStartX = event.clientX;
        colorPickerState.resizeStartY = event.clientY;
        colorPickerState.resizeStartWidth = rect.width;
        colorPickerState.resizeStartHeight = rect.height;
        colorPickerResize.setPointerCapture(event.pointerId);
        customColorPicker.classList.add("is-resizing");
        event.preventDefault();
        event.stopPropagation();
    });

    colorPickerResize?.addEventListener("pointermove", event => {
        if (!colorPickerState.resizingWindow) return;
        const rect = customColorPicker.getBoundingClientRect();
        const pad = 8;
        const maxWidth = Math.max(1, window.innerWidth - rect.left - pad);
        const maxHeight = Math.max(1, window.innerHeight - rect.top - pad);
        const minWidth = Math.min(240, maxWidth);
        const minHeight = Math.min(420, maxHeight);
        const width = Math.min(
            maxWidth,
            Math.max(minWidth, colorPickerState.resizeStartWidth + event.clientX - colorPickerState.resizeStartX),
        );
        const height = Math.min(
            maxHeight,
            Math.max(minHeight, colorPickerState.resizeStartHeight + event.clientY - colorPickerState.resizeStartY),
        );
        customColorPicker.style.width = `${width}px`;
        customColorPicker.style.height = `${height}px`;
        syncPickerFromRgba(colorPickerState.rgba, { skipHex: true });
    });

    const stopResizingPickerWindow = () => {
        const wasResizing = colorPickerState.resizingWindow;
        colorPickerState.resizingWindow = false;
        customColorPicker.classList.remove("is-resizing");
        if (wasResizing) saveCurrentColorPickerBounds();
    };
    colorPickerResize?.addEventListener("pointerup", stopResizingPickerWindow);
    colorPickerResize?.addEventListener("pointercancel", stopResizingPickerWindow);
    colorPickerResetLayout?.addEventListener("click", resetColorPickerLayout);
    colorPickerRuntimeInfo?.addEventListener("mouseenter", showRuntimeColorTooltip);
    colorPickerRuntimeInfo?.addEventListener("mouseleave", hideRuntimeColorTooltip);
    colorPickerRuntimeInfo?.addEventListener("focus", showRuntimeColorTooltip);
    colorPickerRuntimeInfo?.addEventListener("blur", hideRuntimeColorTooltip);
    customColorPicker.addEventListener("scroll", () => {
        if (colorPickerRuntimeTooltip?.classList.contains("visible")) {
            positionRuntimeColorTooltip();
        }
    });

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

    colorPickerRuntimePaste?.addEventListener("click", async () => {
        let succeeded = false;
        try {
            const runtimeRgba = parseRgbaHex(await navigator.clipboard.readText());
            if (runtimeRgba) {
                syncPickerFromRgba(runtimeRgbaToCmdRgba(runtimeRgba));
                emitPickerChange();
                succeeded = true;
            }
        } catch {
            // Clipboard permission failures use the same brief visual feedback
            // as invalid clipboard contents.
        }

        colorPickerRuntimePaste.classList.add(succeeded ? "paste-succeeded" : "paste-failed");
        setTimeout(() => {
            colorPickerRuntimePaste.classList.remove("paste-succeeded", "paste-failed");
        }, 800);
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
        if (colorPickerRuntimeTooltip?.classList.contains("visible")) {
            positionRuntimeColorTooltip();
        }
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

function closeReferenceUrlForm() {
    referenceViewerUrlForm?.classList.add("hidden");
    referenceViewerAddUrl?.setAttribute("aria-expanded", "false");
    if (referenceViewerUrlStatus) {
        referenceViewerUrlStatus.textContent = "";
        referenceViewerUrlStatus.classList.remove("bad");
    }
}

function remoteReferenceLabel(url) {
    const filename = decodeURIComponent(url.pathname.split("/").pop() || "image");
    return `Linked image: ${filename}`;
}

function loadRemoteReferenceImage(value) {
    let url;
    try {
        url = new URL(String(value ?? "").trim());
        if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    } catch {
        return Promise.reject(new Error("Enter a direct HTTPS image URL."));
    }

    return new Promise((resolve, reject) => {
        const probe = new Image();
        probe.referrerPolicy = "no-referrer";
        probe.onload = () => resolve(url);
        probe.onerror = () => reject(new Error("That URL did not load as an image."));
        probe.src = url.href;
    });
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
        if (isReferenceCmdMetadata(cmd.metadata)) row.classList.add("dx-reference");
        row.innerHTML =
            `<strong>${cmdDisplayName(cmd)}</strong>`
            + `<span>${cmd.file.name} · ${formatBytes(cmd.file.size)}</span>`
            + `<span>${cmd.colorClusters.length} materials</span>`
            + (isReferenceCmdMetadata(cmd.metadata)
                ? `<span class="dx-reference-note">${cmd.metadata.variant.toUpperCase()} reference only · edits may not apply in-game</span>`
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

function customMaterialTemplateNames(material) {
    const requiredIndex = Math.max(...material.customizeColorIndexes, -1);
    const firstCmd = state.cmdEntries[0];
    if (!firstCmd) return [];
    const names = [];
    const seen = new Set();
    const discoveredNames = new Set([
        ...state.customMaterialMappings.map(mapping => mapping.name),
        ...state.customMdfMaterials
            .filter(candidate => !state.cmdEntries.every(cmd => (
                cmd.colorClusters.some(cluster => cluster.name === candidate.name)
            )))
            .map(candidate => candidate.name),
    ]);
    for (const cluster of firstCmd.colorClusters) {
        if (
            !cluster.name
            || cluster.name === material.name
            || discoveredNames.has(cluster.name)
            || seen.has(cluster.name)
            || cluster.colors.length <= requiredIndex
        ) continue;
        const availableEverywhere = state.cmdEntries.every(cmd => (
            cmd.colorClusters.some(candidate => (
                candidate.name === cluster.name
                && candidate.colors.length > requiredIndex
            ))
        ));
        if (!availableEverywhere) continue;
        seen.add(cluster.name);
        names.push(cluster.name);
    }
    return names;
}

function orderAutoInsertedMaterials(clusters, mappings = state.customMaterialMappings) {
    if (!Array.isArray(clusters) || !mappings.length) return clusters;
    const order = new Map(mappings.flatMap((mapping, index) => (
        mapping.templateName !== mapping.name
            ? [[mapping.name.toLowerCase(), index]]
            : []
    )));
    if (!order.size) return clusters;
    const inserted = [];
    const regular = [];
    for (const cluster of clusters) {
        if (order.has(String(cluster.name || "").toLowerCase())) inserted.push(cluster);
        else regular.push(cluster);
    }
    if (!inserted.length) return clusters;
    inserted.sort((left, right) => (
        order.get(left.name.toLowerCase()) - order.get(right.name.toLowerCase())
    ));
    return inserted.concat(regular);
}

function automaticCustomMaterialTemplateName(material) {
    const candidates = customMaterialTemplateNames(material);
    if (!candidates.length) return "";
    const requiredCount = Math.max(...material.customizeColorIndexes, -1) + 1;
    const targetParts = material.name.toLowerCase().split("_");
    const targetFamily = targetParts.slice(0, 2).join("_");
    const targetAlpha = targetParts.includes("alpha");
    const commonPrefixLength = name => {
        const left = material.name.toLowerCase();
        const right = name.toLowerCase();
        let length = 0;
        while (length < left.length && length < right.length && left[length] === right[length]) length += 1;
        return length;
    };
    const score = name => {
        const parts = name.toLowerCase().split("_");
        const familyMatch = parts.slice(0, 2).join("_") === targetFamily ? 1 : 0;
        const alphaMatch = parts.includes("alpha") === targetAlpha ? 1 : 0;
        const extraSlots = state.cmdEntries.reduce((total, cmd) => {
            const cluster = cmd.colorClusters.find(candidate => candidate.name === name);
            return total + Math.max(0, (cluster?.colors.length ?? requiredCount) - requiredCount);
        }, 0);
        return { familyMatch, alphaMatch, extraSlots, prefix: commonPrefixLength(name) };
    };
    return candidates.slice().sort((left, right) => {
        const a = score(left);
        const b = score(right);
        return b.familyMatch - a.familyMatch
            || b.alphaMatch - a.alphaMatch
            || a.extraSlots - b.extraSlots
            || b.prefix - a.prefix
            || left.localeCompare(right);
    })[0];
}

function customMaterialPaletteSlots(mapping, cmd) {
    return mapping?.paletteSlots?.[String(cmd?.metadata?.paletteNumber)] || null;
}

function customMaterialMdfDefaultSlots(mapping) {
    const material = state.customMdfMaterials.find(candidate => candidate.name === mapping?.name);
    const variant = material?.defaultVariants?.[0];
    if (!variant?.customizeColors?.length) return null;
    const byIndex = new Map(variant.customizeColors.map(color => [color.index, color]));
    const colorCount = Math.max(...mapping.customizeColorIndexes, -1) + 1;
    return Array.from({ length: colorCount }, (_, index) => {
        const fallback = byIndex.get(index);
        return fallback ? { rgba: fallback.cmdRgba.slice(), enabled: false } : null;
    });
}

function customMaterialInitialSlots(mapping, cmd) {
    return customMaterialPaletteSlots(mapping, cmd) || customMaterialMdfDefaultSlots(mapping);
}

function initializeCustomMaterialSlots(buffer, mapping, cmd) {
    return initializeCustomMaterialSlotsFrom(buffer, mapping, cmd, 0);
}

function initializeCustomMaterialSlotsFrom(buffer, mapping, cmd, startIndex) {
    const sourceSlots = customMaterialInitialSlots(mapping, cmd);
    if (!sourceSlots?.length) return buffer;
    const current = inspectCmdBuffer(buffer);
    const cluster = current.colorClusters.find(candidate => candidate.name === mapping.name);
    if (!cluster || cluster.colors.length < sourceSlots.length) {
        throw new Error(`${cmdDisplayName(cmd)} could not initialize ${mapping.name} from its source colors.`);
    }
    sourceSlots.forEach((source, index) => {
        if (!source || index < startIndex) return;
        const target = cluster.colors[index];
        writeRgbaAtOffset(buffer, target.color.absoluteOffset, source.rgba);
        if (Number.isInteger(target.enable?.absoluteOffset)) {
            writeEnableAtOffset(buffer, target.enable.absoluteOffset, target.enable.byteLength, source.enabled);
        }
    });
    return buffer;
}

function hasPendingColorEdits(cmd) {
    const baseline = cmd.semanticBaselineBuffer ?? cmd.originalBuffer;
    return diffBuffers(baseline, cmd.workingBuffer).length > 0;
}

function applyCustomMappingsToCmdEntry(cmd, mappings = state.customMaterialMappings) {
    if (!mappings.length) return cmd;
    const startingBuffer = cmd.workingBuffer;
    let buffer = startingBuffer;
    let changed = false;
    for (const mapping of mappings) {
        const current = inspectCmdBuffer(buffer);
        const sourceSlots = customMaterialInitialSlots(mapping, cmd);
        const colorCount = sourceSlots?.length || Math.max(...mapping.customizeColorIndexes, -1) + 1;
        const existing = current.colorClusters.find(cluster => cluster.name === mapping.name);
        if (existing?.colors.length >= colorCount) continue;
        if (existing) {
            const previousCount = existing.colors.length;
            buffer = extendMaterialClusterColorSlots({
                buffer,
                ...current,
                typeRegistry,
                clusterInstanceId: existing.instanceId,
                colorCount,
            });
            buffer = initializeCustomMaterialSlotsFrom(buffer, mapping, cmd, previousCount);
            changed = true;
            continue;
        }
        const template = current.colorClusters.find(cluster => (
            cluster.name === mapping.templateName
            && cluster.colors.length >= colorCount
        ));
        if (!template) {
            throw new Error(`${cmdDisplayName(cmd)} does not contain a compatible ${mapping.templateName} template.`);
        }
        buffer = addCustomMaterialCluster({
            buffer,
            ...current,
            typeRegistry,
            templateClusterInstanceId: template.instanceId,
            materialName: mapping.name,
            colorCount,
        });
        buffer = initializeCustomMaterialSlots(buffer, mapping, cmd);
        changed = true;
    }
    if (!changed) {
        cmd.colorClusters = orderAutoInsertedMaterials(cmd.colorClusters, mappings);
        return cmd;
    }
    const parsed = inspectCmdBuffer(buffer);
    cmd.preCustomMaterialBuffer = startingBuffer.slice(0);
    cmd.workingBuffer = buffer;
    cmd.semanticBaselineBuffer = buffer.slice(0);
    cmd.usrInspection = parsed.usrInspection;
    cmd.rszInspection = parsed.rszInspection;
    cmd.instanceParse = parsed.instanceParse;
    cmd.colorClusters = orderAutoInsertedMaterials(parsed.colorClusters, mappings);
    cmd.summary = parsed.summary;
    return cmd;
}

async function addDiscoveredCustomMaterial(materialName, templateName, sourceMapping = {}) {
    const material = state.customMdfMaterials.find(candidate => candidate.name === materialName);
    if (!material) throw new Error("Custom MDF material is no longer available.");
    if (!templateName) throw new Error("No compatible CMD color-slot structure was found.");
    if (state.cmdEntries.some(hasPendingColorEdits)) {
        throw new Error("Add custom materials before editing colors. Reload the mod ZIP to change the material structure after color edits.");
    }

    const nextMapping = {
        name: material.name,
        templateName,
        customizeColorIndexes: material.customizeColorIndexes.slice(),
        ...sourceMapping,
    };
    const rebuiltEntries = [];
    for (const cmd of state.cmdEntries) {
        const current = inspectCmdBuffer(cmd.workingBuffer);
        const sourceSlots = customMaterialInitialSlots(nextMapping, cmd);
        const colorCount = sourceSlots?.length || Math.max(...material.customizeColorIndexes, -1) + 1;
        const existing = current.colorClusters.find(cluster => cluster.name === material.name);
        if (existing?.colors.length >= colorCount) {
            rebuiltEntries.push({ cmd, buffer: cmd.workingBuffer, parsed: current });
            continue;
        }
        if (existing) {
            const buffer = extendMaterialClusterColorSlots({
                buffer: cmd.workingBuffer,
                ...current,
                typeRegistry,
                clusterInstanceId: existing.instanceId,
                colorCount,
            });
            initializeCustomMaterialSlotsFrom(buffer, nextMapping, cmd, existing.colors.length);
            const parsed = inspectCmdBuffer(buffer);
            rebuiltEntries.push({ cmd, buffer, parsed });
            continue;
        }
        const template = current.colorClusters.find(cluster => (
            cluster.name === templateName
            && cluster.colors.length >= colorCount
        ));
        if (!template) {
            throw new Error(`${cmdDisplayName(cmd)} does not contain a compatible ${templateName} template.`);
        }
        const buffer = addCustomMaterialCluster({
            buffer: cmd.workingBuffer,
            ...current,
            typeRegistry,
            templateClusterInstanceId: template.instanceId,
            materialName: material.name,
            colorCount,
        });
        initializeCustomMaterialSlots(buffer, nextMapping, cmd);
        const parsed = inspectCmdBuffer(buffer);
        rebuiltEntries.push({ cmd, buffer, parsed });
    }

    const nextMappings = state.customMaterialMappings.concat(nextMapping);
    for (const { cmd, buffer, parsed } of rebuiltEntries) {
        if (!cmd.preCustomMaterialBuffer) {
            cmd.preCustomMaterialBuffer = cmd.workingBuffer.slice(0);
        }
        cmd.workingBuffer = buffer;
        cmd.semanticBaselineBuffer = buffer.slice(0);
        cmd.usrInspection = parsed.usrInspection;
        cmd.rszInspection = parsed.rszInspection;
        cmd.instanceParse = parsed.instanceParse;
        cmd.colorClusters = orderAutoInsertedMaterials(parsed.colorClusters, nextMappings);
        cmd.summary = parsed.summary;
    }
    state.customMaterialMappings = nextMappings;
    state.colorClusters = state.cmdEntries[state.activeCmdIndex]?.colorClusters ?? [];
    state.surpriseSnapshots.clear();
    resetSyncSelections();
    renderColorClusters(state.colorClusters);
    renderSyncPanels();
    renderCurrentChanges();
    updateExportButtons();
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
    const restoreMappings = state.customMaterialMappings.length
        ? state.customMaterialMappings
        : (state.importedMod?.colorBackupManifest?.customMaterials || []);

    const parsedTargets = await Promise.all(targets.map(async target => {
        const backupPath = safeArchiveRelativePath(target.backupPath);
        const bytes = state.importedMod.entries[backupPath];
        if (!bytes) throw new Error(`Backup file is missing: ${target.backupPath}`);
        const restored = applyCustomMappingsToCmdEntry(await parseCmdEntry({
            file: new File([bytes], target.cmd.file.name, { type: "application/octet-stream" }),
            metadata: target.cmd.metadata,
        }), restoreMappings);
        return { target, restored };
    }));

    for (const { target, restored } of parsedTargets) {
        target.cmd.workingBuffer = restored.workingBuffer;
        target.cmd.usrInspection = restored.usrInspection;
        target.cmd.rszInspection = restored.rszInspection;
        target.cmd.instanceParse = restored.instanceParse;
        target.cmd.colorClusters = restored.colorClusters;
        target.cmd.summary = restored.summary;
        if (restoreMappings.length) {
            const originalStructure = applyCustomMappingsToCmdEntry({
                file: target.cmd.file,
                metadata: target.cmd.metadata,
                originalBuffer: target.cmd.originalBuffer,
                workingBuffer: target.cmd.originalBuffer.slice(0),
                ...inspectCmdBuffer(target.cmd.originalBuffer),
            }, restoreMappings);
            target.cmd.semanticBaselineBuffer = originalStructure.workingBuffer.slice(0);
        } else {
            delete target.cmd.semanticBaselineBuffer;
        }
        if (restored.preCustomMaterialBuffer) {
            target.cmd.preCustomMaterialBuffer = restored.preCustomMaterialBuffer;
        } else {
            delete target.cmd.preCustomMaterialBuffer;
        }
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

    closeSurpriseMenu();
    resetSurpriseTargeting();
    state.surpriseSnapshots.delete(cmd);
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
        state.importedMod = null;
        state.customMdfMaterials = [];
        state.customMaterialMappings = [];
        clearReferenceImages();
        clearScreenshot();
        if (zipFileNameInput) zipFileNameInput.value = "";
        updateZipFileNameField();
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

    const referenceCmds = state.cmdEntries.filter(cmd => isReferenceCmdMetadata(cmd.metadata));
    if (!referenceCmds.length) {
        dxReferenceWarning.classList.add("hidden");
        dxReferenceWarning.textContent = "";
        return;
    }

    const activeReference = state.cmdEntries[state.activeCmdIndex];
    const activeIsReference = isReferenceCmdMetadata(activeReference?.metadata);
    const referenceVariants = [...new Set(referenceCmds.map(cmd => cmd.metadata.variant.toUpperCase()))].join("/");
    dxReferenceWarning.classList.remove("hidden");
    dxReferenceWarning.innerHTML = activeIsReference
        ? `<strong>${activeReference.metadata.variant.toUpperCase()} reference file:</strong> Edits may not apply in-game. Use this file as reference only.`
        : `<strong>${referenceVariants} files loaded:</strong> Their edits may not apply in-game. Use them as reference only.`;
}

function stepActiveCmd(delta) {
    const total = state.cmdEntries.length;
    if (total < 2) return;
    loadActiveCmd((state.activeCmdIndex + delta + total) % total);
}

function createActiveCmdStepButton(direction, {
    label = "active color",
    onStep = stepActiveCmd,
} = {}) {
    const isPrevious = direction < 0;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `active-cmd-step active-cmd-step-${isPrevious ? "previous" : "next"}`;
    button.setAttribute("aria-label", `${isPrevious ? "Previous" : "Next"} ${label}`);
    button.innerHTML = isPrevious
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6.5 9 12l5.5 5.5"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6.5 5.5 5.5-5.5 5.5"/></svg>';

    button.addEventListener("pointerdown", event => {
        if (!event.isPrimary || event.button !== 0 || button.disabled) return;
        event.preventDefault();
        event.stopPropagation();
        onStep(direction);
    });
    button.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (event.detail === 0 && !button.disabled) onStep(direction);
    });
    return button;
}

function ensureActiveCmdStepper(select, options = {}) {
    if (!select) return null;
    const existing = select.closest(".active-cmd-stepper");
    if (existing) return existing;

    const stepper = document.createElement("div");
    stepper.className = "active-cmd-stepper";
    const previous = createActiveCmdStepButton(-1, options);
    const next = createActiveCmdStepButton(1, options);
    select.before(stepper);
    stepper.append(previous, select, next);
    return stepper;
}

function renderActiveCmdDropdown(select) {
    if (!select) return;
    const stepper = ensureActiveCmdStepper(select);
    const trigger = select.querySelector(".custom-select-trigger");
    const dropdown = select.querySelector(".custom-select-dropdown");
    const text = trigger?.querySelector(".cs-text");
    if (!trigger || !dropdown) return;

    const activeCmd = state.cmdEntries[state.activeCmdIndex];
    if (text) text.textContent = activeCmd ? cmdDisplayName(activeCmd) : "No CMD files";
    trigger.disabled = !activeCmd;
    trigger.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");

    const total = state.cmdEntries.length;
    const previous = stepper?.querySelector(".active-cmd-step-previous");
    const next = stepper?.querySelector(".active-cmd-step-next");
    const canStep = total > 1;
    if (previous) {
        previous.disabled = !canStep;
        const previousIndex = (state.activeCmdIndex - 1 + total) % Math.max(total, 1);
        previous.title = canStep
            ? `Previous: ${cmdDisplayName(state.cmdEntries[previousIndex])}`
            : "Previous active color";
    }
    if (next) {
        next.disabled = !canStep;
        const nextIndex = (state.activeCmdIndex + 1) % Math.max(total, 1);
        next.title = canStep
            ? `Next: ${cmdDisplayName(state.cmdEntries[nextIndex])}`
            : "Next active color";
    }

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

function surpriseRandomUnit() {
    if (globalThis.crypto?.getRandomValues) {
        const value = new Uint32Array(1);
        crypto.getRandomValues(value);
        return value[0] / 0x100000000;
    }
    return Math.random();
}

function surpriseRandomBetween(min, max) {
    return min + (max - min) * surpriseRandomUnit();
}

function randomThemeRgbKeepingAlpha(color, preset) {
    const current = slotRgba(color) ?? [0, 0, 0, 255];
    if (preset === "random") {
        return [
            Math.floor(surpriseRandomUnit() * 256),
            Math.floor(surpriseRandomUnit() * 256),
            Math.floor(surpriseRandomUnit() * 256),
            current[3],
        ];
    }

    let h = surpriseRandomBetween(0, 360);
    let s = surpriseRandomBetween(0.25, 0.85);
    let v = surpriseRandomBetween(0.4, 0.9);

    if (preset === "light") {
        s = surpriseRandomBetween(0.12, 0.55);
        v = surpriseRandomBetween(0.78, 1);
    } else if (preset === "dark") {
        s = surpriseRandomBetween(0.22, 0.9);
        v = surpriseRandomBetween(0.08, 0.34);
    } else if (preset === "pastel") {
        s = surpriseRandomBetween(0.18, 0.48);
        v = surpriseRandomBetween(0.82, 1);
    } else if (preset === "neon") {
        s = surpriseRandomBetween(0.82, 1);
        v = surpriseRandomBetween(0.78, 1);
    } else if (preset === "warm") {
        // Wrap across red so warm colors span reds, oranges, and yellows.
        h = (345 + surpriseRandomBetween(0, 80)) % 360;
        s = surpriseRandomBetween(0.48, 0.95);
        v = surpriseRandomBetween(0.48, 1);
    } else if (preset === "cool") {
        h = surpriseRandomBetween(150, 285);
        s = surpriseRandomBetween(0.42, 0.92);
        v = surpriseRandomBetween(0.42, 1);
    }

    return [...hsvToRgb(h, s, v), current[3]];
}

function mixSurpriseRgb(current, target, intensity) {
    const rgba = [
        Math.round(current[0] + (target[0] - current[0]) * intensity),
        Math.round(current[1] + (target[1] - current[1]) * intensity),
        Math.round(current[2] + (target[2] - current[2]) * intensity),
        current[3],
    ];
    if (
        intensity > 0
        && rgba[0] === current[0]
        && rgba[1] === current[1]
        && rgba[2] === current[2]
    ) {
        rgba[0] = rgba[0] < 250 ? rgba[0] + 1 : rgba[0] - 1;
    }
    return rgba;
}

function surpriseColorForSlot(color) {
    const current = slotRgba(color) ?? [0, 0, 0, 255];
    const { preset, intensity } = state.surpriseConfig;
    if (intensity <= 0) return current;
    return mixSurpriseRgb(current, randomThemeRgbKeepingAlpha(color, preset), intensity);
}

function surpriseTargetKey(materialName, slotIndex) {
    return `${materialName}\u0000${slotIndex}`;
}

function findSurpriseCluster(cmd, materialName) {
    return cmd?.colorClusters?.find(cluster => cluster.name === materialName) ?? null;
}

function activeEditableSurpriseSlots(cluster) {
    return (cluster?.colors ?? []).filter(color => isSlotEnabled(color) && isSlotEditable(color));
}

function getSurpriseTargets(cluster, cmd = state.cmdEntries[state.activeCmdIndex]) {
    if (!cmd) return [];
    if (state.surpriseConfig.targetMode === "selected") {
        const seen = new Set();
        return state.surpriseConfig.targets.flatMap(target => {
            const targetCluster = findSurpriseCluster(cmd, target.materialName);
            const color = targetCluster?.colors?.find(slot => slot.index === target.slotIndex);
            const key = surpriseTargetKey(target.materialName, target.slotIndex);
            if (!color || !isSlotEnabled(color) || !isSlotEditable(color) || seen.has(key)) return [];
            seen.add(key);
            return [{ cluster: targetCluster, color }];
        });
    }
    const targetCluster = findSurpriseCluster(cmd, cluster?.name);
    return activeEditableSurpriseSlots(targetCluster).map(color => ({
        cluster: targetCluster,
        color,
    }));
}

function currentSurpriseTargetCount() {
    return getSurpriseTargets(surpriseMenuState.cluster).length;
}

function recomputeInspectorDirty() {
    state.inspectorDirty = state.cmdEntries.some(cmd => (
        diffBuffers(cmd.semanticBaselineBuffer ?? cmd.originalBuffer, cmd.workingBuffer).length > 0
    ));
}

function removeSurpriseSnapshotSlot(cmd, offset) {
    const cmdSnapshots = state.surpriseSnapshots.get(cmd);
    if (!cmdSnapshots) return;
    for (const [materialName, snapshot] of cmdSnapshots) {
        snapshot.slots = snapshot.slots.filter(slot => slot.offset !== offset);
        if (!snapshot.slots.length) cmdSnapshots.delete(materialName);
    }
    if (!cmdSnapshots.size) state.surpriseSnapshots.delete(cmd);
}

function isSurpriseSnapshotSlotRestorable(cmd, slot) {
    return Boolean(
        cmd
        && slot?.lastSurpriseRgba
        && rgbaEquals(rgbaAtOffset(cmd.workingBuffer, slot.offset), slot.lastSurpriseRgba)
    );
}

function hasRestorableSurpriseSlots(cmd, snapshot) {
    return Boolean(snapshot?.slots?.some(slot => isSurpriseSnapshotSlotRestorable(cmd, slot)));
}

function updateSurpriseButtonStates() {
    const cmd = state.cmdEntries[state.activeCmdIndex];
    document.querySelectorAll(".cluster-surprise-button").forEach(button => {
        const cluster = findSurpriseCluster(cmd, button.dataset.clusterName);
        const hasTargets = state.surpriseConfig.targetMode === "selected"
            ? getSurpriseTargets(null, cmd).length > 0
            : activeEditableSurpriseSlots(cluster).length > 0;
        const enabled = state.surpriseConfig.intensity > 0 && hasTargets;
        button.disabled = !enabled;
        button.title = state.surpriseConfig.targetMode === "selected"
            ? "Randomize the selected active material slots"
            : "Randomize active colors in this material";
        button.setAttribute("aria-label", state.surpriseConfig.targetMode === "selected"
            ? "Surprise Me: randomize the selected active material slots"
            : `Surprise Me: randomize active colors in ${button.dataset.clusterName}`);
    });
}

function renderSurpriseTargetList() {
    if (!surpriseTargetList) return;
    const cmd = state.cmdEntries[state.activeCmdIndex];
    const previousScrollTop = surpriseTargetList.scrollTop;
    surpriseTargetList.innerHTML = "";
    if (!cmd?.colorClusters?.length) {
        const empty = document.createElement("span");
        empty.className = "muted-inline";
        empty.textContent = "Load a CMD palette to choose target slots.";
        surpriseTargetList.appendChild(empty);
        return;
    }

    const selected = new Set(state.surpriseConfig.targets.map(target => (
        surpriseTargetKey(target.materialName, target.slotIndex)
    )));

    for (const cluster of cmd.colorClusters) {
        const material = document.createElement("div");
        material.className = "surprise-target-material";
        const editableSlots = activeEditableSurpriseSlots(cluster);
        const selectedCount = editableSlots.filter(color => (
            selected.has(surpriseTargetKey(cluster.name, color.index))
        )).length;
        const expanded = surpriseMenuState.expandedMaterials.has(cluster.name);

        const heading = document.createElement("div");
        heading.className = "surprise-target-material-header";

        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "surprise-target-material-toggle";
        toggle.setAttribute("aria-expanded", String(expanded));
        toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} ${cluster.name} slots`);
        toggle.textContent = expanded ? "▾" : "▸";
        toggle.addEventListener("click", event => {
            event.stopPropagation();
            if (expanded) surpriseMenuState.expandedMaterials.delete(cluster.name);
            else surpriseMenuState.expandedMaterials.add(cluster.name);
            renderSurpriseTargetList();
            if (surpriseMenuState.open) positionSurpriseMenu(surpriseMenuState.anchor);
        });

        const materialLabel = document.createElement("label");
        materialLabel.className = "surprise-target-material-select";
        const materialCheck = document.createElement("input");
        materialCheck.type = "checkbox";
        materialCheck.checked = editableSlots.length > 0 && selectedCount === editableSlots.length;
        materialCheck.indeterminate = selectedCount > 0 && selectedCount < editableSlots.length;
        materialCheck.disabled = editableSlots.length === 0;
        materialCheck.setAttribute("aria-label", `Select all active slots in ${cluster.name}`);
        materialCheck.addEventListener("change", () => {
            const next = new Map(state.surpriseConfig.targets.map(target => [
                surpriseTargetKey(target.materialName, target.slotIndex),
                target,
            ]));
            for (const color of editableSlots) {
                const key = surpriseTargetKey(cluster.name, color.index);
                if (materialCheck.checked) next.set(key, { materialName: cluster.name, slotIndex: color.index });
                else next.delete(key);
            }
            state.surpriseConfig.targets = [...next.values()];
            renderSurpriseMenu();
        });

        const materialName = document.createElement("strong");
        materialName.className = "surprise-target-material-name";
        materialName.textContent = cluster.name;
        const materialCount = document.createElement("small");
        materialCount.textContent = editableSlots.length
            ? `${selectedCount}/${editableSlots.length} active slots`
            : "No active slots";
        materialLabel.append(materialCheck, materialName, materialCount);
        heading.append(toggle, materialLabel);
        material.appendChild(heading);

        if (!expanded) {
            surpriseTargetList.appendChild(material);
            continue;
        }

        const slots = document.createElement("div");
        slots.className = "surprise-target-material-slots";

        for (const color of cluster.colors) {
            const editable = isSlotEnabled(color) && isSlotEditable(color);
            const label = document.createElement("label");
            label.className = "surprise-target-item";
            if (!editable) label.classList.add("inactive-slot");
            label.addEventListener("click", event => event.stopPropagation());

            const check = document.createElement("input");
            check.type = "checkbox";
            check.checked = editable && selected.has(surpriseTargetKey(cluster.name, color.index));
            check.disabled = !editable;
            check.addEventListener("click", event => event.stopPropagation());
            check.addEventListener("change", () => {
                const key = surpriseTargetKey(cluster.name, color.index);
                const next = new Map(state.surpriseConfig.targets.map(target => [
                    surpriseTargetKey(target.materialName, target.slotIndex),
                    target,
                ]));
                if (check.checked) next.set(key, { materialName: cluster.name, slotIndex: color.index });
                else next.delete(key);
                state.surpriseConfig.targets = [...next.values()];
                renderSurpriseMenu();
            });

            const swatch = document.createElement("span");
            swatch.className = "target-slot-swatch";
            swatch.style.background = slotHex(color) ?? "#00000000";

            const text = document.createElement("span");
            text.className = "surprise-target-item-text";
            const name = document.createElement("strong");
            name.textContent = color.runtimeName;
            const value = document.createElement("small");
            value.textContent = editable
                ? `${describeColorName(slotRgba(color))} · ${slotHex(color) ?? "#00000000"}`
                : "Inactive";
            text.append(name, value);
            label.append(check, swatch, text);
            slots.appendChild(label);
        }
        material.appendChild(slots);
        surpriseTargetList.appendChild(material);
    }
    surpriseTargetList.scrollTop = previousScrollTop;
}

function renderSurpriseMenu() {
    if (!surpriseMenu) return;
    const selectedPreset = state.surpriseConfig.preset;
    if (surprisePresetGrid) {
        surprisePresetGrid.innerHTML = "";
        for (const option of SURPRISE_PRESETS) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "surprise-preset-button";
            button.textContent = option.label;
            button.dataset.preset = option.id;
            button.classList.toggle("is-selected", option.id === selectedPreset);
            button.setAttribute("aria-pressed", String(option.id === selectedPreset));
            button.addEventListener("click", event => {
                event.preventDefault();
                event.stopPropagation();
                state.surpriseConfig.preset = option.id;
                saveSurpriseConfig();
                renderSurpriseMenu();
            });
            surprisePresetGrid.appendChild(button);
        }
    }

    const intensityPercent = Math.round(state.surpriseConfig.intensity * 100);
    if (surpriseIntensity) surpriseIntensity.value = String(intensityPercent);
    if (surpriseIntensityValue) surpriseIntensityValue.textContent = `${intensityPercent}%`;
    document.querySelectorAll("input[name='surprise-target-mode']").forEach(input => {
        input.checked = input.value === state.surpriseConfig.targetMode;
    });

    const count = currentSurpriseTargetCount();
    const countLabel = `${count} active slot${count === 1 ? "" : "s"}`;
    if (surpriseMenuSummary) {
        const presetLabel = SURPRISE_PRESETS.find(option => option.id === selectedPreset)?.label || "Random";
        surpriseMenuSummary.textContent = `${presetLabel} · ${countLabel}`;
    }
    if (surpriseTargetSummary) {
        surpriseTargetSummary.textContent = state.surpriseConfig.targetMode === "selected"
            ? `${countLabel} selected across the active CMD`
            : `${countLabel} in ${surpriseMenuState.cluster?.name || "this material"}`;
    }
    if (surpriseApply) surpriseApply.disabled = count === 0 || state.surpriseConfig.intensity <= 0;
    if (surpriseEditTargets) {
        surpriseEditTargets.textContent = surpriseMenuState.targetPickerOpen
            ? "Hide slot selector"
            : "Select slots";
    }
    surpriseTargetPicker?.classList.toggle("hidden", !surpriseMenuState.targetPickerOpen);
    if (surpriseTargetListToggle) {
        const expanded = !surpriseMenuState.targetListCollapsed;
        surpriseTargetListToggle.setAttribute("aria-expanded", String(expanded));
        const icon = surpriseTargetListToggle.querySelector("span");
        if (icon) icon.textContent = expanded ? "▾" : "▸";
    }
    surpriseTargetList?.classList.toggle("hidden", surpriseMenuState.targetListCollapsed);
    if (surpriseMenuState.targetPickerOpen && !surpriseMenuState.targetListCollapsed) {
        renderSurpriseTargetList();
    }

    const activeCmd = state.cmdEntries[state.activeCmdIndex];
    const cmdSnapshots = state.surpriseSnapshots.get(activeCmd);
    const restorableMaterials = cmdSnapshots
        ? [...cmdSnapshots.entries()].filter(([, snapshot]) => hasRestorableSurpriseSlots(activeCmd, snapshot))
        : [];
    const currentMaterialSnapshot = cmdSnapshots?.get(surpriseMenuState.cluster?.name);
    const canResetCurrentMaterial = hasRestorableSurpriseSlots(activeCmd, currentMaterialSnapshot);
    const showResetMore = restorableMaterials.some(
        ([materialName]) => materialName !== surpriseMenuState.cluster?.name,
    );
    if (surpriseResetColors) {
        surpriseResetColors.disabled = !canResetCurrentMaterial;
        surpriseResetColors.title = canResetCurrentMaterial
            ? `Reset randomized colors in ${surpriseMenuState.cluster?.name || "this material"}`
            : "This material has no randomized colors to reset";
    }
    surpriseResetGroup?.classList.toggle("has-more", showResetMore);
    surpriseResetMore?.classList.toggle("hidden", !showResetMore);
    if (!showResetMore) surpriseMenuState.resetMenuOpen = false;
    if (surpriseResetMore) surpriseResetMore.setAttribute("aria-expanded", String(surpriseMenuState.resetMenuOpen));
    surpriseResetMenu?.classList.toggle("hidden", !surpriseMenuState.resetMenuOpen);
    if (surpriseResetAll) surpriseResetAll.disabled = restorableMaterials.length === 0;
    updateSurpriseButtonStates();
}

function positionSurpriseMenu(anchor) {
    if (!surpriseMenu || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    const pad = 10;
    const gap = 8;
    const width = surpriseMenu.offsetWidth || 390;
    const height = surpriseMenu.offsetHeight || 420;
    let left = rect.right - width;
    let top = rect.bottom + gap;
    if (top + height > window.innerHeight - pad) top = rect.top - height - gap;
    left = Math.min(window.innerWidth - width - pad, Math.max(pad, left));
    top = Math.min(window.innerHeight - height - pad, Math.max(pad, top));
    surpriseMenu.style.left = `${left}px`;
    surpriseMenu.style.top = `${top}px`;
}

function closeSurpriseMenu() {
    surpriseMenuState.anchor?.setAttribute("aria-expanded", "false");
    surpriseMenuState.open = false;
    surpriseMenuState.anchor = null;
    surpriseMenuState.cluster = null;
    surpriseMenuState.targetPickerOpen = false;
    surpriseMenuState.resetMenuOpen = false;
    surpriseMenu?.classList.add("hidden");
}

function openSurpriseMenu(anchor, cluster) {
    if (surpriseMenuState.open && surpriseMenuState.anchor === anchor) {
        closeSurpriseMenu();
        return;
    }
    closeCustomColorPicker();
    surpriseMenuState.open = true;
    surpriseMenuState.anchor = anchor;
    surpriseMenuState.cluster = cluster;
    surpriseMenuState.targetPickerOpen = state.surpriseConfig.targetMode === "selected";
    surpriseMenuState.resetMenuOpen = false;
    anchor.setAttribute("aria-expanded", "true");
    surpriseMenu?.classList.remove("hidden");
    renderSurpriseMenu();
    positionSurpriseMenu(anchor);
}

function captureSurpriseMenuView() {
    return {
        targetPickerOpen: surpriseMenuState.targetPickerOpen,
        targetListCollapsed: surpriseMenuState.targetListCollapsed,
        menuScrollTop: surpriseMenu?.scrollTop ?? 0,
        targetListScrollTop: surpriseTargetList?.scrollTop ?? 0,
    };
}

function reopenSurpriseMenuAfterRender(cmd, clusterName, view) {
    if (!clusterName) return;
    const updatedCluster = findSurpriseCluster(cmd, clusterName);
    const updatedAnchor = [...document.querySelectorAll(".cluster-surprise-settings")]
        .find(button => button.dataset.clusterName === clusterName);
    if (!updatedCluster || !updatedAnchor) return;
    openSurpriseMenu(updatedAnchor, updatedCluster);
    surpriseMenuState.targetPickerOpen = view?.targetPickerOpen ?? false;
    surpriseMenuState.targetListCollapsed = view?.targetListCollapsed ?? false;
    renderSurpriseMenu();
    positionSurpriseMenu(updatedAnchor);
    if (surpriseTargetList && !surpriseMenuState.targetListCollapsed) {
        surpriseTargetList.scrollTop = view?.targetListScrollTop ?? 0;
    }
    if (surpriseMenu) surpriseMenu.scrollTop = view?.menuScrollTop ?? 0;
}

function resetSurpriseColors({ keepMenuOpen = false } = {}) {
    const cmd = state.cmdEntries[state.activeCmdIndex];
    const cmdSnapshots = state.surpriseSnapshots.get(cmd);
    if (!cmd || !cmdSnapshots?.size) return 0;
    const reopenClusterName = keepMenuOpen ? surpriseMenuState.cluster?.name : null;
    const reopenView = keepMenuOpen ? captureSurpriseMenuView() : null;

    let restored = 0;
    for (const snapshot of cmdSnapshots.values()) {
        for (const slot of snapshot.slots) {
            // A later manual/sync edit supersedes Surprise Me. Reset must not
            // overwrite it; only restore colors still equal to our last result.
            if (!isSurpriseSnapshotSlotRestorable(cmd, slot)) continue;
            writeRgbaAtOffset(cmd.workingBuffer, slot.offset, slot.rgba);
            updateColorModelAtOffset(cmd, slot.offset, slot.rgba);
            restored += 1;
        }
    }
    state.surpriseSnapshots.delete(cmd);
    recomputeInspectorDirty();
    updateInspectorDirtyUi();
    closeSurpriseMenu();
    renderColorClusters(cmd.colorClusters);
    renderCurrentChanges();
    renderSyncPanels();
    updateExportButtons();
    reopenSurpriseMenuAfterRender(cmd, reopenClusterName, reopenView);
    return restored;
}

function surpriseMaterialColors(cluster, { keepMenuOpen = false } = {}) {
    const cmd = state.cmdEntries[state.activeCmdIndex];
    if (!cmd || !cluster) return 0;
    const targets = getSurpriseTargets(cluster, cmd);
    if (!targets.length) return 0;
    const reopenClusterName = keepMenuOpen ? cluster.name : null;
    const reopenView = keepMenuOpen ? captureSurpriseMenuView() : null;

    let cmdSnapshots = state.surpriseSnapshots.get(cmd);
    let changed = 0;

    for (const { cluster: targetCluster, color } of targets) {
        const current = slotRgba(color);
        const rgba = surpriseColorForSlot(color);
        if (!current || rgbaEquals(current, rgba)) continue;
        if (!cmdSnapshots) {
            cmdSnapshots = new Map();
            state.surpriseSnapshots.set(cmd, cmdSnapshots);
        }
        let snapshot = cmdSnapshots.get(targetCluster.name);
        if (!snapshot) {
            snapshot = { slots: [] };
            cmdSnapshots.set(targetCluster.name, snapshot);
        }
        let slotSnapshot = snapshot.slots.find(slot => slot.offset === color.color.absoluteOffset);
        if (!slotSnapshot) {
            slotSnapshot = {
                offset: color.color.absoluteOffset,
                rgba: current,
                lastSurpriseRgba: rgba,
            };
            snapshot.slots.push(slotSnapshot);
        } else {
            slotSnapshot.lastSurpriseRgba = rgba;
        }
        writeRgbaAtOffset(cmd.workingBuffer, color.color.absoluteOffset, rgba);
        updateColorModelAtOffset(cmd, color.color.absoluteOffset, rgba);
        changed += 1;
    }

    if (!changed) return 0;

    state.inspectorDirty = true;
    updateInspectorDirtyUi();
    closeSurpriseMenu();
    renderColorClusters(cmd.colorClusters);
    renderCurrentChanges();
    renderSyncPanels();
    updateExportButtons();
    reopenSurpriseMenuAfterRender(cmd, reopenClusterName, reopenView);
    return changed;
}

function discardSurpriseMaterialColors(cluster, { keepMenuOpen = false } = {}) {
    const cmd = state.cmdEntries[state.activeCmdIndex];
    const cmdSnapshots = state.surpriseSnapshots.get(cmd);
    const snapshot = cmdSnapshots?.get(cluster?.name);
    if (!cmd || !snapshot) return 0;
    const reopenClusterName = keepMenuOpen ? cluster.name : null;
    const reopenView = keepMenuOpen ? captureSurpriseMenuView() : null;

    let restored = 0;
    for (const slot of snapshot.slots) {
        if (!isSurpriseSnapshotSlotRestorable(cmd, slot)) continue;
        writeRgbaAtOffset(cmd.workingBuffer, slot.offset, slot.rgba);
        updateColorModelAtOffset(cmd, slot.offset, slot.rgba);
        restored += 1;
    }
    cmdSnapshots.delete(cluster.name);
    if (!cmdSnapshots.size) state.surpriseSnapshots.delete(cmd);

    recomputeInspectorDirty();
    updateInspectorDirtyUi();
    renderColorClusters(cmd.colorClusters);
    renderCurrentChanges();
    renderSyncPanels();
    updateExportButtons();
    reopenSurpriseMenuAfterRender(cmd, reopenClusterName, reopenView);
    return restored;
}

function resetSurpriseSettings() {
    state.surpriseConfig = {
        ...SURPRISE_DEFAULTS,
        targets: [],
    };
    surpriseMenuState.expandedMaterials.clear();
    surpriseMenuState.targetListCollapsed = false;
    surpriseMenuState.resetMenuOpen = false;
    saveSurpriseConfig();
    saveUiState({ surpriseTargetListCollapsed: false });
    surpriseMenuState.targetPickerOpen = false;
    renderSurpriseMenu();
}

function bindSurpriseMenuEvents() {
    surpriseMenuClose?.addEventListener("click", closeSurpriseMenu);
    surpriseApply?.addEventListener("click", () => {
        surpriseMaterialColors(surpriseMenuState.cluster, { keepMenuOpen: true });
    });
    surpriseEditTargets?.addEventListener("click", () => {
        surpriseMenuState.targetPickerOpen = !surpriseMenuState.targetPickerOpen;
        renderSurpriseMenu();
        if (surpriseMenuState.open) positionSurpriseMenu(surpriseMenuState.anchor);
    });
    surpriseTargetListToggle?.addEventListener("click", () => {
        surpriseMenuState.targetListCollapsed = !surpriseMenuState.targetListCollapsed;
        saveUiState({ surpriseTargetListCollapsed: surpriseMenuState.targetListCollapsed });
        renderSurpriseMenu();
        if (surpriseMenuState.open) positionSurpriseMenu(surpriseMenuState.anchor);
    });
    surpriseIntensity?.addEventListener("input", () => {
        state.surpriseConfig.intensity = Math.max(0, Math.min(1, Number(surpriseIntensity.value) / 100));
        saveSurpriseConfig();
        renderSurpriseMenu();
    });
    document.querySelectorAll("input[name='surprise-target-mode']").forEach(input => {
        input.addEventListener("change", () => {
            state.surpriseConfig.targetMode = input.value === "selected" ? "selected" : "material";
            saveSurpriseConfig();
            surpriseMenuState.targetPickerOpen = state.surpriseConfig.targetMode === "selected";
            renderSurpriseMenu();
            if (surpriseMenuState.open) positionSurpriseMenu(surpriseMenuState.anchor);
        });
    });
    surpriseTargetSelectAll?.addEventListener("click", () => {
        const cmd = state.cmdEntries[state.activeCmdIndex];
        state.surpriseConfig.targets = (cmd?.colorClusters ?? []).flatMap(cluster => (
            activeEditableSurpriseSlots(cluster).map(color => ({
                materialName: cluster.name,
                slotIndex: color.index,
            }))
        ));
        saveSurpriseConfig();
        renderSurpriseMenu();
        if (surpriseMenuState.open) positionSurpriseMenu(surpriseMenuState.anchor);
    });
    surpriseTargetSelectNone?.addEventListener("click", () => {
        state.surpriseConfig.targets = [];
        saveSurpriseConfig();
        renderSurpriseMenu();
        if (surpriseMenuState.open) positionSurpriseMenu(surpriseMenuState.anchor);
    });
    surpriseResetColors?.addEventListener("click", () => {
        const materialName = surpriseMenuState.cluster?.name;
        const restored = discardSurpriseMaterialColors(surpriseMenuState.cluster, { keepMenuOpen: true });
        if (restored) showStatus(parserStatus, "good", `Reset ${restored} randomized slot${restored === 1 ? "" : "s"} in ${materialName}.`);
    });
    surpriseResetMore?.addEventListener("click", event => {
        event.stopPropagation();
        surpriseMenuState.resetMenuOpen = !surpriseMenuState.resetMenuOpen;
        renderSurpriseMenu();
        if (surpriseMenuState.open) positionSurpriseMenu(surpriseMenuState.anchor);
    });
    surpriseResetAll?.addEventListener("click", () => {
        surpriseMenuState.resetMenuOpen = false;
        const restored = resetSurpriseColors({ keepMenuOpen: true });
        if (restored) showStatus(parserStatus, "good", `Reset all ${restored} randomized slot${restored === 1 ? "" : "s"} in the active CMD.`);
    });
    surpriseResetSettings?.addEventListener("click", resetSurpriseSettings);
    document.addEventListener("click", event => {
        if (surpriseMenuState.resetMenuOpen && !surpriseResetGroup?.contains(event.target)) {
            surpriseMenuState.resetMenuOpen = false;
            surpriseResetMore?.setAttribute("aria-expanded", "false");
            surpriseResetMenu?.classList.add("hidden");
        }
        if (!surpriseMenuState.open) return;
        if (surpriseMenu?.contains(event.target)) return;
        if (event.target.closest?.(".cluster-surprise-settings")) return;
        closeSurpriseMenu();
    });
    window.addEventListener("resize", () => {
        if (surpriseMenuState.open) positionSurpriseMenu(surpriseMenuState.anchor);
    });
    window.addEventListener("keydown", event => {
        if (event.key === "Escape" && surpriseMenuState.open) {
            event.preventDefault();
            if (surpriseMenuState.resetMenuOpen) {
                surpriseMenuState.resetMenuOpen = false;
                renderSurpriseMenu();
                return;
            }
            closeSurpriseMenu();
        }
    });
}

function renderColorClusters(clusters) {
    if (!clusterInspector) return;
    if (surpriseMenuState.open) closeSurpriseMenu();
    clusterInspector.innerHTML = "";

    const customNames = new Set(
        state.customMaterialMappings.flatMap(mapping => (
            mapping.templateName !== mapping.name
                ? [mapping.name.toLowerCase()]
                : []
        )),
    );
    const renderedClusters = orderAutoInsertedMaterials(clusters ?? []);
    const hasCustom = renderedClusters.some(cluster => (
        customNames.has(String(cluster.name || "").toLowerCase())
    ));
    let currentGroup = null;

    for (const cluster of renderedClusters) {
        const group = customNames.has(String(cluster.name || "").toLowerCase())
            ? "custom"
            : "standard";
        if (hasCustom && group !== currentGroup) {
            const heading = document.createElement("h4");
            heading.className = `cluster-group-heading is-${group}`;
            heading.textContent = group === "custom" ? "Custom MDF materials" : "CMD materials";
            clusterInspector.appendChild(heading);
            currentGroup = group;
        }
        const card = document.createElement("details");
        card.className = "cluster-card";
        card.dataset.materialSource = group;
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
        surpriseButton.dataset.clusterName = cluster.name;
        surpriseButton.textContent = "Surprise Me";
        surpriseButton.title = "Randomize active colors in this material";
        surpriseButton.setAttribute("aria-label", `Surprise Me: randomize active colors in ${cluster.name}`);
        surpriseButton.disabled = state.surpriseConfig.targetMode === "selected"
            ? getSurpriseTargets(null).length === 0
            : activeEditableSurpriseSlots(cluster).length === 0;
        surpriseButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            surpriseMaterialColors(cluster);
        });
        const surpriseSettingsButton = document.createElement("button");
        surpriseSettingsButton.type = "button";
        surpriseSettingsButton.className = "cluster-surprise-settings";
        surpriseSettingsButton.dataset.clusterName = cluster.name;
        surpriseSettingsButton.textContent = "▾";
        surpriseSettingsButton.title = "Open Surprise Me settings";
        surpriseSettingsButton.setAttribute("aria-label", `Open Surprise Me settings for ${cluster.name}`);
        surpriseSettingsButton.setAttribute("aria-haspopup", "dialog");
        surpriseSettingsButton.setAttribute("aria-expanded", "false");
        surpriseSettingsButton.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            openSurpriseMenu(surpriseSettingsButton, cluster);
        });
        const surpriseGroup = document.createElement("span");
        surpriseGroup.className = "cluster-surprise-group";
        surpriseGroup.append(surpriseButton, surpriseSettingsButton);
        const actions = document.createElement("span");
        actions.className = "cluster-card-actions";
        actions.appendChild(surpriseGroup);
        const activeCmd = state.cmdEntries[state.activeCmdIndex];
        const surpriseSnapshot = state.surpriseSnapshots.get(activeCmd)?.get(cluster.name);
        if (hasRestorableSurpriseSlots(activeCmd, surpriseSnapshot)) {
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
                if (Array.isArray(color.mdfFallbackRgba)) {
                    flags.classList.add("is-mdf-default");
                    flags.textContent = "MDF default";
                    flags.title = "CMD slot is inactive; the game uses this color from the MDF material.";
                } else {
                    flags.textContent = "inactive";
                }
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
                // Custom MDF materials are appended during a targeted RSZ
                // rebuild, so their offsets do not exist in originalBuffer.
                // semanticBaselineBuffer is the immutable post-rebuild
                // baseline used for color diffs and restores.
                const baseline = activeCmd?.semanticBaselineBuffer ?? activeCmd?.originalBuffer;
                const originalRgba = activeCmd && Number.isInteger(offset)
                    ? rgbaAtOffset(baseline, offset)
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
    filter = () => true,
}) {
    if (!container) return;
    container.innerHTML = "";

    const candidates = state.cmdEntries
        .map((cmd, index) => ({ cmd, index }))
        .filter(({ cmd, index }) => filter(cmd, index));

    if (!candidates.length) {
        const empty = document.createElement("p");
        empty.className = "muted-inline sync-empty-note";
        empty.textContent = "No matching CMD palettes loaded.";
        container.appendChild(empty);
        return;
    }

    candidates.forEach(({ cmd, index }) => {
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

function renderDuplicateSourceDropdown() {
    const select = duplicateSourceCmdSelect;
    if (!select) return;

    const candidates = listDuplicatePaletteSourceIndexes();
    const stepper = ensureActiveCmdStepper(select, {
        label: "source palette",
        onStep: stepDuplicateSource,
    });

    const trigger = select.querySelector(".custom-select-trigger");
    const dropdown = select.querySelector(".custom-select-dropdown");
    const text = trigger?.querySelector(".cs-text");
    if (!trigger || !dropdown) return;

    const selected = candidates.find(({ index }) => index === state.paletteDuplicate.sourceCmdIndex)
        || candidates.find(({ cmd }) => (
            cmd.metadata.variant === "standard"
            && cmd.metadata.paletteNumber === 1
        ))
        || candidates[0]
        || null;

    if (selected && selected.index !== state.paletteDuplicate.sourceCmdIndex) {
        state.paletteDuplicate.sourceCmdIndex = selected.index;
    }

    trigger.disabled = !selected;
    trigger.setAttribute("aria-expanded", "false");
    trigger.classList.remove("open");
    if (text) text.textContent = selected ? cmdDisplayName(selected.cmd) : "No source palettes loaded";

    const previous = stepper?.querySelector(".active-cmd-step-previous");
    const next = stepper?.querySelector(".active-cmd-step-next");
    const selectedPosition = selected
        ? candidates.findIndex(({ index }) => index === selected.index)
        : -1;
    const canStep = candidates.length > 1 && selectedPosition >= 0;
    if (previous) {
        previous.disabled = !canStep;
        const previousCandidate = canStep
            ? candidates[(selectedPosition - 1 + candidates.length) % candidates.length]
            : null;
        previous.title = previousCandidate
            ? `Previous: ${cmdDisplayName(previousCandidate.cmd)}`
            : "Previous source palette";
    }
    if (next) {
        next.disabled = !canStep;
        const nextCandidate = canStep
            ? candidates[(selectedPosition + 1) % candidates.length]
            : null;
        next.title = nextCandidate
            ? `Next: ${cmdDisplayName(nextCandidate.cmd)}`
            : "Next source palette";
    }

    dropdown.innerHTML = "";
    for (const candidate of candidates) {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "custom-select-option";
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(candidate.index === state.paletteDuplicate.sourceCmdIndex));
        const referenceVariant = candidate.cmd.metadata.variant === "standard"
            ? ""
            : ` - ${candidate.cmd.metadata.variant.toUpperCase()} reference`;
        option.textContent = cmdDisplayName(candidate.cmd) + referenceVariant;
        if (candidate.index === state.paletteDuplicate.sourceCmdIndex) option.classList.add("selected");
        option.addEventListener("click", () => {
            state.paletteDuplicate.sourceCmdIndex = candidate.index;
            state.paletteDuplicate.targetCmdIndexes = listDuplicatePaletteTargetIndexes(candidate.index);
            dropdown.classList.add("hidden");
            trigger.classList.remove("open");
            trigger.setAttribute("aria-expanded", "false");
            renderSyncPanels();
        });
        dropdown.appendChild(option);
    }

    trigger.onclick = event => {
        event.stopPropagation();
        const open = dropdown.classList.toggle("hidden") === false;
        trigger.classList.toggle("open", open);
        trigger.setAttribute("aria-expanded", String(open));
    };
}

function stepDuplicateSource(delta) {
    const candidates = listDuplicatePaletteSourceIndexes();
    if (candidates.length < 2) return;

    const currentPosition = candidates.findIndex(({ index }) => (
        index === state.paletteDuplicate.sourceCmdIndex
    ));
    const nextPosition = currentPosition < 0
        ? 0
        : (currentPosition + delta + candidates.length) % candidates.length;
    const next = candidates[nextPosition];
    state.paletteDuplicate.sourceCmdIndex = next.index;
    state.paletteDuplicate.targetCmdIndexes = listDuplicatePaletteTargetIndexes(next.index);
    renderSyncPanels();
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
    document.querySelector("#duplicate-palette-pane")
        ?.classList.toggle("hidden", state.syncMode !== "duplicate");

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

    // ---- Duplicate Palette
    renderDuplicateSourceDropdown();
    const duplicate = state.paletteDuplicate;
    const duplicateSource = state.cmdEntries[duplicate.sourceCmdIndex];
    const duplicateTargetIndexes = listDuplicatePaletteTargetIndexes(duplicate.sourceCmdIndex);
    duplicate.targetCmdIndexes = duplicate.targetCmdIndexes.filter(index => duplicateTargetIndexes.includes(index));

    const duplicateNote = document.querySelector("#duplicate-palette-note");
    if (duplicateNote) {
        if (!duplicateSource) {
            duplicateNote.textContent = "Load a standard, EX, or DX palette as the source, then choose standard target palettes.";
        } else if (duplicateSource.metadata.variant !== "standard") {
            duplicateNote.textContent = `${duplicateSource.metadata.variant.toUpperCase()} source selected. Its raw colors and Enable states will be copied as reference data; EX/DX files cannot be targets.`;
        } else {
            duplicateNote.textContent = "Copies every matching editable material color and Enable state into the selected standard palettes.";
        }
    }

    buildCmdCheckList(document.querySelector("#duplicate-target-cmds"), {
        selectedIndexes: duplicate.targetCmdIndexes,
        filter: (cmd, index) => duplicateTargetIndexes.includes(index),
        onChange: indexes => {
            duplicate.targetCmdIndexes = indexes;
        },
    });

    const duplicateButton = document.querySelector("#apply-duplicate-palette");
    if (duplicateButton) {
        duplicateButton.disabled = !duplicateSource || duplicate.targetCmdIndexes.length === 0;
    }
    renderDuplicateUndoButton();
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
        hideStatus(colorStateStatus);
        updateZipFileNameField();
    }
    await handleFiles(incoming);
    const mdfRefresh = await refreshDiscoveredCustomMaterials();
    if (mdfRefresh?.fallbackWarning) {
        showStatus(parserStatus, "warn", `CMDs loaded.${mdfRefresh.fallbackWarning}`);
        revealStatus(parserStatus);
    }
}

function bindUi() {
    initializeHexActionButtons();
    modTargetCancel?.addEventListener("click", () => modTargetDialog?.close(""));
    if ("indexedDB" in window) {
        colorLibraryOptions?.classList.remove("hidden");
    }
    forgetColorLibraryButton?.addEventListener("click", async () => {
        try {
            await forgetRememberedColorLibrary();
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
            colorLibraryInput?.click();
        } catch (error) {
            if (error?.name === "AbortError") return;
            console.error(error);
            showColorLibraryError(error);
        }
    };
    colorLibraryDropZone?.addEventListener("click", event => {
        if (event.target === colorLibraryInput || event.target.closest("a")) return;
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
            if (error?.name === "AbortError") return;
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
            if (error?.name === "AbortError") return;
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

        const baseline = cmd.semanticBaselineBuffer ?? cmd.originalBuffer;
        new Uint8Array(cmd.workingBuffer).set(new Uint8Array(baseline));
        for (const cluster of cmd.colorClusters) {
            for (const color of cluster.colors) {
                const offset = color.color?.absoluteOffset;
                if (!Number.isInteger(offset)) continue;
                updateColorModelAtOffset(
                    cmd,
                    offset,
                    rgbaAtOffset(baseline, offset),
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

    document.querySelector("#duplicate-target-select-all")
        ?.addEventListener("click", () => {
            state.paletteDuplicate.targetCmdIndexes = listDuplicatePaletteTargetIndexes(
                state.paletteDuplicate.sourceCmdIndex,
            );
            renderSyncPanels();
        });

    document.querySelector("#duplicate-target-select-none")
        ?.addEventListener("click", () => {
            state.paletteDuplicate.targetCmdIndexes = [];
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
                originalRgba: rgbaAtOffset(
                    cmd.semanticBaselineBuffer ?? cmd.originalBuffer,
                    slot.color.absoluteOffset,
                ),
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

    document.querySelector("#apply-duplicate-palette")
        ?.addEventListener("click", () => {
            try {
                const result = applyPaletteDuplicate();
                let message =
                    `Duplicate Palette copied ${result.copied} slot${result.copied === 1 ? "" : "s"}`
                    + ` across ${result.targets} target palette${result.targets === 1 ? "" : "s"}.`;
                if (result.missingMaterials || result.missingSlots) {
                    message += ` Skipped ${result.missingMaterials + result.missingSlots} unmatched slot${result.missingMaterials + result.missingSlots === 1 ? "" : "s"}.`;
                }
                if (result.enableSkipped) {
                    message += ` ${result.enableSkipped} Enable state${result.enableSkipped === 1 ? "" : "s"} could not be represented by the target structure.`;
                }
                showStatus(applyStatus, "good", message);
            } catch (error) {
                console.error(error);
                showStatus(applyStatus, "bad", error.message || String(error));
            }
        });

    duplicatePaletteUndoBtn?.addEventListener("click", () => {
        try {
            const result = undoLastPaletteDuplicate();
            if (!result.changed) {
                showStatus(applyStatus, "warn", "There is no Duplicate Palette operation to undo.");
                return;
            }
            showStatus(
                applyStatus,
                "good",
                `Undid Duplicate Palette and restored ${result.changed} slot${result.changed === 1 ? "" : "s"}`
                + ` across ${result.targets} target palette${result.targets === 1 ? "" : "s"}.`,
            );
        } catch (error) {
            console.error(error);
            showStatus(applyStatus, "bad", error.message || String(error));
        }
    });

    exportCmdButton?.addEventListener("click", async () => {
        try {
            showStatus(exportCmdStatus, "", "Exporting modified CMD files…");
            const exported = await exportModifiedCmdFiles();
            await refreshExportDestinationUi();
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
            await refreshExportDestinationUi();
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

    saveColorStateBtn?.addEventListener("click", async () => {
        try {
            saveColorStateBtn.disabled = true;
            showStatus(colorStateStatus, "", "Saving current color state…");
            const result = await saveCurrentColorState();
            showTemporaryStatus(
                colorStateStatus,
                "good",
                `Saved ${result.commandCount} CMD file${result.commandCount === 1 ? "" : "s"}`
                + ` and ${result.slotCount} color slot${result.slotCount === 1 ? "" : "s"}`
                + ` to “${result.filename}” in browser downloads.`,
            );
            revealExportStatus(colorStateStatus);
        } catch (error) {
            console.error(error);
            showStatus(colorStateStatus, "bad", error.message || String(error));
        } finally {
            updateExportButtons();
        }
    });

    loadColorStateBtn?.addEventListener("click", () => colorStateFileInput?.click());
    colorStateFileInput?.addEventListener("change", async () => {
        const file = colorStateFileInput.files?.[0];
        if (!file) return;
        try {
            loadColorStateBtn.disabled = true;
            showStatus(colorStateStatus, "", `Loading “${file.name}”…`);
            const result = await loadColorStateFile(file);
            const status = result.changedSlots ? "good" : "warn";
            const detail = result.changedSlots
                ? `Restored ${result.changedSlots} changed slot${result.changedSlots === 1 ? "" : "s"}.`
                : "The loaded colors already match this state.";
            showTemporaryStatus(
                colorStateStatus,
                status,
                `Loaded color state for ${result.commandCount} CMD file${result.commandCount === 1 ? "" : "s"}. ${detail}`,
            );
            revealExportStatus(colorStateStatus);
        } catch (error) {
            console.error(error);
            showStatus(colorStateStatus, "bad", error.message || String(error));
        } finally {
            colorStateFileInput.value = "";
            updateExportButtons();
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

    const bindReferenceArrow = (button, delta) => {
        button?.addEventListener("pointerdown", (event) => {
            if (!event.isPrimary || event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            stepReference(delta);
        });
        button?.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();

            // Pointer activation already navigated on press; detail 0 preserves
            // keyboard and assistive-technology button activation.
            if (event.detail === 0) stepReference(delta);
        });
    };

    bindReferenceArrow(referenceViewerPrev, -1);
    bindReferenceArrow(referenceViewerNext, 1);
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
    referenceViewerAddUrl?.setAttribute("aria-expanded", "false");
    referenceViewerAddUrl?.addEventListener("click", () => {
        const opening = referenceViewerUrlForm?.classList.contains("hidden");
        if (!opening) {
            closeReferenceUrlForm();
            return;
        }
        referenceViewerUrlForm?.classList.remove("hidden");
        referenceViewerAddUrl.setAttribute("aria-expanded", "true");
        referenceViewerUrlInput?.focus();
    });
    referenceViewerUrlForm?.addEventListener("submit", async event => {
        event.preventDefault();
        if (!referenceViewerUrlInput || !referenceViewerUrlLoad) return;
        referenceViewerUrlLoad.disabled = true;
        if (referenceViewerUrlStatus) {
            referenceViewerUrlStatus.textContent = "Loading image...";
            referenceViewerUrlStatus.classList.remove("bad");
        }
        try {
            const url = await loadRemoteReferenceImage(referenceViewerUrlInput.value);
            const existingIndex = state.referenceImages.findIndex(image => image.src === url.href);
            if (existingIndex >= 0) {
                state.referenceImageIndex = existingIndex;
            } else {
                state.referenceImages.push({
                    src: url.href,
                    label: remoteReferenceLabel(url),
                    type: "remote",
                });
                state.referenceImageIndex = state.referenceImages.length - 1;
            }
            state.referenceMinimized = false;
            saveUiState({ referenceMinimized: false });
            referenceViewerUrlInput.value = "";
            closeReferenceUrlForm();
            renderReferenceViewer();
        } catch (error) {
            if (referenceViewerUrlStatus) {
                referenceViewerUrlStatus.textContent = error.message || String(error);
                referenceViewerUrlStatus.classList.add("bad");
            }
        } finally {
            referenceViewerUrlLoad.disabled = false;
        }
    });
    referenceViewerUrlInput?.addEventListener("keydown", event => {
        if (event.key === "Escape") {
            event.preventDefault();
            closeReferenceUrlForm();
            referenceViewerAddUrl?.focus();
        }
    });
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

    includeColorBackupsInput?.addEventListener("change", () => {
        saveUiState({ includeColorBackups: includeColorBackupsInput.checked });
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

    bindSurpriseMenuEvents();
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
