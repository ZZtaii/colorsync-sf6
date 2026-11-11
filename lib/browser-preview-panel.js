// Browser 3D preview panel: loads RE Engine meshes locally, shows them with the live ColorSync
// colours, and lets the user orbit, pick and isolate materials. Nothing leaves the browser.
import { createBrowserSceneAssetResolver, combinePreviewMeshes, readPreviewAssetsZip } from './browser-asset-resolver.js';
import { resolveBrowserPreviewMaterials } from './browser-preview-bindings.js';
import { costumeFromPath } from './game-file-source.js';
import { icon } from './preview-icons.js';
import { findCostumeScn } from './scn-costume-parts.js';
import { RESIZE_DIRECTIONS, fitFloatRect, moveFloatRect, parseFloatPlacement, reanchorFloatRect, resizeFloatRect, serializeFloatPlacement } from './preview-float.js';

const MESH_RE = /\.mesh\.\d+$/i;
const MAX_MESH_BYTES = 200 * 1024 * 1024;
const DEFAULT_VIEW = Object.freeze({ yaw: -25, pitch: 0, distance: 1.55, panX: 0, panY: 0 });
const VIEW_PRESETS = [['Front view', 0, 'viewFront'], ['Right side', 90, 'viewFaceLeft'], ['Back view', 180, 'viewBack'], ['Left side', -90, 'viewFaceRight']];
const BACKGROUNDS = [['Dark', [.055, .055, .065]], ['Gray', [.5, .5, .5]], ['Light', [.92, .92, .93]]];
const PART_LABEL = { '00': ['head', 'Head'], '01': ['body', 'Body'], '02': ['hair', 'Hair'] };
const HINT = [['Drag', 'orbit'], ['Shift + drag', 'pan'], ['Scroll', 'zoom'], ['Click', 'select a part']];
// While the preview floats, a plain drag moves the window, so the model moves on Shift or the middle button.
const FLOAT_HINT = [['Drag', 'move window'], ['Shift + drag', 'orbit'], ['Middle drag', 'pan'], ['Scroll', 'zoom']];
const FLOAT_STORAGE_KEY = 'sf6-color-sync-preview-float-v1';
const PIN_TIP = 'Float the preview while you edit. Drag it anywhere, resize it from its edges';
const FULL_TIP = 'Full screen, with the materials and colors beside the model';
const CONNECT_LABEL = 'Connect game folder';
const CONNECT_TIP = 'Choose your Street Fighter 6 install folder once. The preview then reads whatever your mod does not include (stock model parts and textures) straight from the game. Files stay on this device; nothing is uploaded.';
// Nothing to report before a model is loaded: the empty stage and the line under it say what to do.
const IDLE_MESSAGE = '';
const STATUS_LABEL = { colors: 'Follows your color edits', base: 'Texture only, no color slots', hidden: 'Hidden effect layer', unresolved: 'No material data found' };

function el(tag, { text, cls, attrs } = {}, children = []) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    for (const [key, value] of Object.entries(attrs ?? {})) node.setAttribute(key, value);
    node.append(...children);
    return node;
}
const button = (text, cls = 'secondary-button', attrs = {}) => el('button', { text, cls, attrs: { type: 'button', ...attrs } });
/** Icon-only button. `tip` is both the accessible name and the hover label (CSS tooltip, see [data-tip]). */
function iconButton(name, tip, { cls = 'bp-icon-btn', align = null, attrs = {} } = {}) {
    const node = el('button', { cls, attrs: { type: 'button', 'aria-label': tip, 'data-tip': tip, ...(align ? { 'data-tip-align': align } : {}), ...attrs } }, [icon(name)]);
    return node;
}
function setTip(node, tip) { node.setAttribute('aria-label', tip); node.setAttribute('data-tip', tip); }
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const srgbByte = linear => Math.round(255 * clamp(linear <= .0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - .055, 0, 1));
const cssColor = rgba => `rgb(${srgbByte(rgba[0])} ${srgbByte(rgba[1])} ${srgbByte(rgba[2])})`;
const shortMeshName = path => String(path).replace(/\\/g, '/').split('/').pop().replace(MESH_RE, '');
// CMD MaterialData part type for each SF6 costume part folder (.../esfNNN/CCC/<folder>/mesh).
const PART_TYPE_BY_FOLDER = { '00': 1, '01': 0, '02': 2 };
const partFolder = path => String(path ?? '').replace(/\\/g, '/').match(/\/(\d{2})\/[^/]+$/)?.[1] ?? '';

const nativeMeshBase = path => { const clean = String(path).replace(/\\/g, '/').toLowerCase().replace(MESH_RE, ''), cut = clean.indexOf('natives/stm/'); return cut < 0 ? clean : clean.slice(cut + 12); };
/** The scene part ({ mesh, mdf, folder }) a mesh file is, or null when the scene does not name it. */
export function sceneMeshOf(path, sceneParts) {
    const base = nativeMeshBase(path).replace(/\.mesh$/, '');
    return (sceneParts ?? []).find(part => part.mesh.replace(/\.mesh$/, '') === base) ?? null;
}
/** Name of the mod folder a file sits in (the folder that holds its "natives"), or ''. */
const modFolderOf = path => { const clean = String(path).replace(/\\/g, '/'), cut = clean.toLowerCase().indexOf('natives/'); return cut > 0 ? clean.slice(0, cut).replace(/\/+$/, '').split('/').pop() : ''; };
/**
 * Short labels for the mod folders of a multi-part mod, keyed by folder name: the part of the name
 * the folders do not share, without ordering numbers ("03 Original legs - Some Mod" -> "Original
 * legs", "Leon-Luke-C1-Muscles" -> "Muscles").
 */
export function modFolderLabels(folders) {
    const names = [...new Set(folders.filter(Boolean))];
    const words = names.map(name => name.replace(/^\d+[\s._-]*/, '').replace(/\s+-\s+.*$/, '').split(/(?<=[\s._-])/));
    let shared = 0;
    while (names.length > 1 && words.every(list => list.length > shared + 1 && list[shared].toLowerCase() === words[0][shared].toLowerCase())) shared++;
    return new Map(names.map((name, i) => [name, words[i].slice(shared).join('').replace(/[\s._-]+$/, '').trim() || name]));
}

/** Character, costume, part folder and variant label of a mesh path. Empty strings when unknown. */
export function describeMeshPath(path) {
    const clean = String(path).replace(/\\/g, '/').toLowerCase();
    const match = clean.match(/(?:^|\/)(esf\d+)\/([^/]+)\/(\d{2})\/([^/]+)\.mesh\.\d+$/);
    if (!match) return { character: '', costume: '', part: '', variant: '', canonical: false };
    const [, character, costume, part, stem] = match;
    const canonicalStem = `${character}_${costume}_${part}`;
    // Modders often leave alternatives beside the real file ("No Cape esf009_001_01.mesh").
    // Only the exact game name is loaded by the game; the rest are offered as variants.
    const original = String(path).replace(/\\/g, '/').split('/').pop().replace(MESH_RE, '');
    const variant = stem === canonicalStem ? '' : (original.replace(new RegExp(canonicalStem, 'i'), '').replace(/[\s_-]+/g, ' ').trim() || original);
    return { character, costume, part, variant, canonical: stem === canonicalStem };
}

// Notes that describe a known limit of the preview rather than a problem with this model.
const ROUTINE_NOTE = /not reproduced|not checked against this shader|omitted|unsupported master|those slots are not previewed|cards remain opaque/i;
const REASY_URL = 'https://github.com/seifhassine/REasy';

/**
 * Boils the per-material notes down to the few that change what the user sees, in plain words and
 * grouped by kind: [{ label, materials: [names] }]. Known limits of the preview are only counted.
 */
export function summarizeMaterialNotes(report) {
    const groups = new Map();
    let routine = 0;
    const add = (label, who) => { const list = groups.get(label) ?? groups.set(label, []).get(label); if (!list.includes(who)) list.push(who); };
    for (const entry of report ?? []) {
        for (const note of entry.notes ?? []) {
            if (ROUTINE_NOTE.test(note)) { routine++; continue; }
            const slot = note.match(/CustomizeColor_(\d+)_BlendRate.*slot not previewed/);
            if (slot) add('Color slot not shown', `${entry.name} (slot ${slot[1]})`);
            else if (/could not decode/.test(note)) add('Texture could not be read', entry.name);
            else if (/^missing /.test(note)) add('Texture not found', entry.name);
            else if (/no matching MDF/.test(note)) add('No material data', entry.name);
            else if (/no resolved color masks/.test(note)) add('Color masks not found', entry.name);
            else add(note.charAt(0).toUpperCase() + note.slice(1).replace(/\.$/, ''), entry.name);
        }
    }
    return { issues: [...groups].map(([label, materials]) => ({ label, materials })), routine };
}

/**
 * The costume an import is about. `active` (from the loaded CMD) wins when the import contains it
 * or has no costume paths at all. Otherwise CMD files, then meshes, then anything else decide,
 * and the shared "000" folder is only chosen when nothing else is present.
 */
export function pickCostume(paths, active = null) {
    const ranked = [[], [], []];
    for (const path of paths) {
        const found = costumeFromPath(path);
        if (!found) continue;
        const rank = /_cmd_[^/]*\.user\.\d+$/i.test(path) ? 0 : MESH_RE.test(path) ? 1 : 2;
        ranked[rank].push({ character: found.character.toLowerCase(), costume: found.costume.toLowerCase() });
    }
    const all = ranked.flat();
    if (active && (!all.length || all.some(c => c.character === active.character && c.costume === active.costume))) return active;
    return all.find(c => c.costume !== '000') ?? all[0] ?? active ?? null;
}

/**
 * Meshes shown when an import opens: one mesh for each of head, body and hair. For every part the
 * target costume's own file is preferred, then the shared "000" folder; the exact game file name
 * is preferred over a variant. Files outside the costume folder layout (loose meshes, flat ZIPs)
 * are all shown.
 */
export function defaultMeshPaths(paths, target = null, sceneParts = null) {
    // The costume's scene file names its meshes exactly; one file per named mesh is shown, and
    // further copies of the same mesh (variants in other mod folders) stay optional.
    if (sceneParts?.length) {
        const named = new Set();
        for (const part of sceneParts) { const match = paths.filter(path => sceneMeshOf(path, [part])).sort()[0]; if (match) named.add(match); }
        if (named.size) return named;
    }
    const chosen = new Set(), described = paths.map(path => ({ path, ...describeMeshPath(path) }));
    const located = described.filter(d => d.character);
    for (const d of described) if (!d.character) chosen.add(d.path);
    const character = target?.character?.toLowerCase() ?? located.find(d => d.part === '01')?.character ?? located[0]?.character ?? '';
    const mine = located.filter(d => d.character === character && d.costume !== '000');
    const costume = target?.costume?.toLowerCase() ?? (mine.find(d => d.part === '01') ?? mine[0])?.costume ?? '';
    const rank = d => (d.costume === costume ? 0 : d.costume === '000' ? 1 : 2);
    for (const part of Object.keys(PART_TYPE_BY_FOLDER)) {
        const options = located.filter(d => d.character === character && d.part === part)
            .sort((a, b) => rank(a) - rank(b) || a.costume.localeCompare(b.costume) || Number(b.canonical) - Number(a.canonical) || a.path.localeCompare(b.path));
        // With a known costume, the body must be its own and head or hair may only come from "000".
        // Parts of other costumes stay available as chips but are not switched on by a guess.
        if (options.length && !(costume && rank(options[0]) > (part === '01' ? 0 : 1))) chosen.add(options[0].path);
    }
    return chosen;
}


/**
 * Optional editor hooks, all keyed by the material ids of the ColorSync snapshot:
 * `surprise` = { state(materialId) -> { canSurprise, canUndo }, run(materialId), undo(materialId) } and
 * `palettes` = { list() -> [{ label, title, active }], select(index) } for the full screen palette tabs.
 */
export function createBrowserPreviewPanel(root, { onSelectMaterial, onOpenColorPicker, surprise = null, palettes = null } = {}) {
    if (!root) return { update() {}, setAssets() {} };

    // ---- state -------------------------------------------------------------------------
    let renderer = null, mesh = null, snapshot = null, assetResolver = null;
    let archiveEntries = null, supportingEntries = {}, meshPaths = [], localMeshFiles = null;
    let bindings = {}, selected = null, hovered = null, isolate = false, maskSlot = null;
    let builtMaterials = [], slotEffects = [], report = [];
    let view = { ...DEFAULT_VIEW }, shading = 'lit', backgroundIndex = 0;
    let loadSerial = 0, buildSerial = 0, frameRequested = false, pendingAutoLoad = false, announcePending = false, summaryPending = false;
    // Game PAKs the user connected this session, the costume last fetched from them, and what was found.
    let gamePaks = [], gameCostumeKey = '', gamePendingKey = '', gameEntryPaths = [], gameSerial = 0, rememberedFolder = null;
    // Costume the part chips were last built for; a change resets which parts are switched on.
    let chipCostumeKey = '', gameBodyMissing = false, gameReadErrors = 0;
    // Parts named by the costume's scene file: read from the game once connected, else from the import.
    let gameScene = null, sceneParts = null;
    const costumeKey = target => target ? `${target.character}/${target.costume}`.toLowerCase() : '';

    // ---- DOM ---------------------------------------------------------------------------
    root.classList.add('bp');
    const meshInput = el('input', { attrs: { type: 'file', accept: '.mesh,.1808312334,.2109148288,.230110883,.240306278', multiple: '', hidden: '' } });
    const supportInput = el('input', { attrs: { type: 'file', accept: '.zip', hidden: '' } });
    const openMesh = button('Open mesh files…');
    const addAssets = button('Add textures ZIP…', 'secondary-button', { title: 'Meshes, MDF and TEX files used only for this preview. They are never added to your export.' });
    const unload = iconButton('unload', 'Unload the model (your color edits stay)', { align: 'end' });
    unload.disabled = true;
    const pakInput = el('input', { attrs: { type: 'file', accept: '.pak', multiple: '', hidden: '' } });
    const gameLabel = el('span', { cls: 'bp-game-label', text: CONNECT_LABEL });
    const useGame = el('button', { cls: 'bp-game', attrs: { type: 'button', 'aria-label': CONNECT_LABEL, title: CONNECT_TIP } }, [icon('folder'), gameLabel]);
    const meshChips = el('div', { cls: 'bp-chips', attrs: { role: 'group', 'aria-label': 'Model parts in the preview' } });
    const toolbar = el('div', { cls: 'bp-toolbar' }, [meshChips, el('div', { cls: 'bp-toolbar-actions' }, [useGame, unload, meshInput, supportInput, pakInput])]);

    const canvas = el('canvas', { attrs: { 'aria-label': 'Interactive 3D preview. Drag to orbit, Shift-drag to pan, scroll to zoom, click a part to select it.', tabindex: '0' } });
    canvas.width = canvas.height = 640;
    const status = el('p', { cls: 'bp-status', text: IDLE_MESSAGE, attrs: { role: 'status' } });
    const emptyTitle = el('strong', { text: 'No model yet' });
    const emptyText = el('span', { text: 'Load CMD files or a mod ZIP, then connect your game folder once. Missing parts and textures come from the game.' });
    const emptyConnect = el('button', { cls: 'bp-game', attrs: { type: 'button', title: CONNECT_TIP } }, [icon('folder'), el('span', { cls: 'bp-game-label', text: CONNECT_LABEL })]);
    const empty = el('div', { cls: 'bp-empty' }, [icon('model'), emptyTitle, emptyText, emptyConnect]);

    const viewButtons = VIEW_PRESETS.map(([label, yaw, glyph], index) => {
        const b = iconButton(glyph, label, { align: index < 2 ? 'start' : null });
        b.addEventListener('click', () => setView({ ...view, yaw, pitch: 0 }));
        return b;
    });
    const resetView = iconButton('reset', 'Reset the camera (or double-click)');
    const shadingToggle = iconButton('light', 'Studio lighting. Turn off for flat, exact colors', { align: 'end', attrs: { 'aria-pressed': 'true' } });
    const backdropDots = BACKGROUNDS.map(([label, rgb], index) => {
        const dot = el('button', { cls: 'bp-dot', attrs: { type: 'button', role: 'radio', 'aria-checked': String(index === 0), 'aria-label': `${label} backdrop`, 'data-tip': `${label} backdrop`, 'data-tip-align': 'end' } });
        dot.style.setProperty('--dot', `rgb(${rgb.map(v => Math.round(v * 255)).join(' ')})`);
        dot.addEventListener('click', () => {
            backgroundIndex = index;
            backdropDots.forEach((other, i) => other.setAttribute('aria-checked', String(i === index)));
            requestRender();
        });
        return dot;
    });
    const backdrop = el('div', { cls: 'bp-dots', attrs: { role: 'radiogroup', 'aria-label': 'Backdrop' } }, backdropDots);
    const pinToggle = iconButton('pin', PIN_TIP, { align: 'end', attrs: { 'aria-pressed': 'false' } });
    const fullToggle = iconButton('expand', FULL_TIP, { cls: 'bp-icon-btn bp-full-toggle', align: 'end', attrs: { 'aria-pressed': 'false' } });
    const tools = el('div', { cls: 'bp-tools' }, [
        el('div', { cls: 'bp-group', attrs: { role: 'group', 'aria-label': 'Camera' } }, [...viewButtons, el('span', { cls: 'bp-sep' }), resetView]),
        el('span', { cls: 'bp-spacer' }),
        el('div', { cls: 'bp-group bp-group-display', attrs: { role: 'group', 'aria-label': 'Display' } }, [shadingToggle, el('span', { cls: 'bp-sep' }), backdrop]),
        el('div', { cls: 'bp-group bp-group-window' }, [pinToggle, fullToggle]),
    ]);
    const helpToggle = el('button', { cls: 'bp-help', attrs: { type: 'button', 'aria-label': 'Show the mouse controls', 'aria-pressed': 'false' } }, [icon('help')]);
    const hint = el('p', { cls: 'bp-hint' });
    const fillHint = list => hint.replaceChildren(...list.map(([keys, action]) => el('span', {}, [el('kbd', { text: keys }), ` ${action}`])));
    fillHint(HINT);
    const busyText = el('span', { cls: 'bp-busy-text' });
    const busyPill = el('div', { cls: 'bp-busy', attrs: { 'aria-hidden': 'true' } }, [el('span', { cls: 'bp-spinner' }), busyText]);
    // Edges and corners that resize the floating window; only shown while it floats.
    const resizeHandles = RESIZE_DIRECTIONS.map(direction => el('div', { cls: 'bp-resize', attrs: { 'data-dir': direction, 'aria-hidden': 'true' } }));
    const stage = el('div', { cls: 'bp-stage browser-preview-viewport' }, [canvas, empty, tools, helpToggle, hint, busyPill, ...resizeHandles]);

    const materialCount = el('span', { cls: 'bp-count' });
    const materialList = el('ul', { cls: 'bp-materials', attrs: { 'aria-label': 'Model materials' } });
    const detail = el('div', { cls: 'bp-detail' });
    // Palette tabs: only shown in full screen, where the editor's own palette control is out of reach.
    const paletteTabs = el('div', { cls: 'bp-palettes', attrs: { role: 'tablist', 'aria-label': 'Color palette', hidden: '' } });
    const side = el('aside', { cls: 'bp-side' }, [paletteTabs, detail, el('div', { cls: 'bp-side-head' }, [el('h4', { text: 'Materials' }), materialCount]), materialList]);

    // Footer: one status line and the advanced options behind an icon button, then one line saying
    // what this preview is. The game folder sentence goes away once the folder is connected.
    const advancedToggle = iconButton('sliders', 'Advanced: manual files and color bindings', { align: 'end', attrs: { 'aria-expanded': 'false' } });
    const footer = el('div', { cls: 'bp-footer' }, [status, el('div', { cls: 'bp-footer-actions' }, [advancedToggle])]);
    const connectHint = el('span', { text: ' Connect your game folder for stock parts, shader materials and textures.' });
    const about = el('p', { cls: 'bp-fineprint bp-about' }, [
        'Approximate preview, not the game renderer. Format and material logic based on ',
        el('a', { text: 'REasy', attrs: { href: REASY_URL, target: '_blank', rel: 'noopener noreferrer' } }),
        '.', connectHint,
    ]);

    const bindingRows = el('div', { cls: 'preview-binding-list' });
    const advanced = el('div', { cls: 'bp-panel', attrs: { hidden: '' } }, [
        el('h5', { text: 'Manual files' }),
        el('p', { cls: 'bp-fineprint', text: 'For previewing without a game folder: open meshes, or add a ZIP of meshes, MDF and TEX files.' }),
        el('div', { cls: 'bp-panel-actions' }, [openMesh, addAssets]),
        el('h5', { text: 'Manual color bindings' }),
        el('p', { cls: 'bp-fineprint', text: 'Materials are matched to the active CMD by name. Override a match here if a mod renamed its materials.' }),
        bindingRows,
    ]);
    advancedToggle.addEventListener('click', () => {
        const open = advanced.hidden;
        advanced.hidden = !open;
        advancedToggle.setAttribute('aria-expanded', String(open));
        if (open) advanced.scrollIntoView({ block: 'nearest' });
    });

    root.append(toolbar, el('div', { cls: 'bp-layout' }, [stage, side]), footer, about, advanced);

    // ---- helpers -----------------------------------------------------------------------
    const pinned = () => stage.classList.contains('is-pinned');
    const allEntries = () => ({ ...supportingEntries, ...(archiveEntries ?? {}) });
    function setStatus(message, { error = false, working = false } = {}) {
        status.textContent = message;
        status.classList.toggle('is-error', error);
        stage.classList.toggle('is-busy', working);
        busyText.textContent = working ? message : '';
    }
    const say = message => setStatus(message);
    /** A step that is still running: same status line, plus the spinner over the preview. */
    const busy = message => setStatus(message, { working: true });
    const fail = error => setStatus(error?.message || String(error), { error: true });
    const materialTotal = () => mesh ? Math.max(mesh.materialNames?.length ?? 0, ...mesh.parts.map(p => p.materialIndex + 1)) : 0;
    const mdfFor = index => assetResolver?.materialFor(mesh.materialMeshIndex?.[index] ?? 0, mesh.materialNames[index])
        ?? (list => list.length === 1 ? list[0] : null)((assetResolver?.mdfMaterials ?? []).filter(m => m.name === mesh.materialNames[index]));

    function requestRender() {
        if (frameRequested || !renderer || !mesh) return;
        frameRequested = true;
        // Browsers pause requestAnimationFrame in background tabs; the timer keeps the picture current there.
        let ran = false;
        const frame = () => {
            if (ran) return;
            ran = true;
            frameRequested = false;
            if (!renderer || !mesh) return;
            try {
                renderer.setView(view);
                const canIsolate = isolate && selected != null && mesh.parts.some(p => p.materialIndex === selected);
                renderer.render({ selectedMaterialIndex: selected, isolate: canIsolate, shading, background: BACKGROUNDS[backgroundIndex][1], highlightMaterialIndex: hovered });
            } catch (error) { fail(error); }
        };
        requestAnimationFrame(frame);
        setTimeout(frame, 150);
    }
    function setView(next) {
        view = { yaw: next.yaw, pitch: clamp(next.pitch, -89, 89), distance: clamp(next.distance, .15, 8), panX: clamp(next.panX, -2, 2), panY: clamp(next.panY, -2, 2) };
        requestRender();
    }
    function resizeCanvas() {
        const box = stage.getBoundingClientRect();
        if (!box.width || !box.height) return;
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = clamp(Math.round(box.width * ratio), 64, 2048), height = clamp(Math.round(box.height * ratio), 64, 2048);
        if (canvas.width === width && canvas.height === height) return;
        canvas.width = width; canvas.height = height;
        requestRender();
    }
    new ResizeObserver(resizeCanvas).observe(stage);

    /** Pushes the built materials (plus the optional mask view) to the renderer. No texture work. */
    function applyMaterials() {
        if (!renderer || !mesh) return;
        try {
            renderer.setMaterials(builtMaterials.map((material, index) => index === selected && maskSlot != null ? { ...material, maskViewSlot: maskSlot } : material));
            requestRender();
        } catch (error) { fail(error); }
    }

    async function rebuildMaterials({ announce = false, summarize = false } = {}) {
        if (!renderer || !mesh) return;
        // A colour edit can land mid-load and supersede this build; the newer build then owns the announcement.
        if (announce) announcePending = true;
        announce = announcePending;
        // `summarize` refreshes the summary line without the loading progress (another CMD became active).
        if (summarize) summaryPending = true;
        const serial = ++buildSerial;
        try {
            let materials = resolveBrowserPreviewMaterials(mesh, snapshot, bindings);
            report = []; slotEffects = [];
            if (assetResolver?.mdfMaterials.length) {
                const { buildSf6BrowserMaterials } = await import('./sf6-browser-materials.js');
                let decoded = 0;
                const resolveTexture = async descriptor => {
                    // Yield between textures so the page stays responsive while BC7 blocks decode.
                    if (announce) { busy(`Preparing textures… ${++decoded}`); await new Promise(resolve => setTimeout(resolve)); }
                    return assetResolver.resolveTexture(descriptor);
                };
                const built = await buildSf6BrowserMaterials({
                    mesh, snapshot, resolveTexture, mdfMaterials: assetResolver.mdfMaterials,
                    resolveMdfMaterial: (index, name) => assetResolver.materialFor(mesh.materialMeshIndex?.[index] ?? 0, name),
                    bindings: Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, value.materialId])),
                });
                if (serial !== buildSerial) return;
                materials = built.materials; slotEffects = built.slotEffects; report = built.report;
            }
            builtMaterials = materials;
            if (maskSlot != null && !slotEffects.some(e => e.materialIndex === selected && e.slotIndex === maskSlot && e.available)) maskSlot = null;
            applyMaterials(); renderMaterialList(); renderDetail();
            // While something else is still loading, its own announcement follows; do not cut its progress short.
            if (announce || (summaryPending && !stage.classList.contains('is-busy'))) { announcePending = false; summaryPending = false; announceLoaded(); }
        } catch (error) { announcePending = false; summaryPending = false; fail(error); }
    }

    function announceLoaded() {
        const live = report.filter(r => r.status === 'colors').length;
        // A material only follows edits when it is also matched to a material of the active CMD.
        const matched = report.filter((r, index) => r.status === 'colors' && bindings[index]).length;
        const colors = !report.length ? 'No material file found, so parts are shown in gray.'
            : live && !matched ? 'No loaded CMD matches this model, so it shows its default colors.'
            : `${matched} of ${report.filter(r => r.status !== 'hidden').length} materials follow your color edits.`;
        // A mod usually ships only what it changes; the rest of its textures live in the base game.
        const untextured = report.filter(r => r.status === 'unresolved' && r.family).length;
        const missing = untextured ? ` ${untextured} material${untextured === 1 ? ' shows' : 's show'} gray: ${gamePaks.length ? 'textures not found in your game files.' : 'connect your game folder to fill in base-game textures.'}` : '';
        // A missing body is too important to leave in the notes: with it gone only a floating head is shown.
        const noBody = gameBodyMissing && !meshPaths.some(path => partFolder(path) === '01') ? ' Body not found in your game files.' : '';
        const unread = gameReadErrors ? ` ${gameReadErrors} game file${gameReadErrors === 1 ? '' : 's'} could not be read.` : '';
        say(`${colors}${noBody}${missing}${unread}${renderer.software ? ' Slower CPU renderer (no WebGL 2).' : ''}`);
    }

    // ---- material list -----------------------------------------------------------------
    /**
     * Color swatches of one material. Each opens the editor's own color picker for that slot, so
     * edits made here are ordinary editor edits (Save, Discard, Revert and export all apply).
     */
    function swatchButton(index, entry, slot) {
        const materialId = bindings[index]?.materialId ?? null;
        const swatch = button('', 'bp-swatch', { 'data-slot': String(slot.slotIndex), 'aria-label': `Edit color slot ${slot.slotIndex} of ${entry.name}`, title: materialId ? `Slot ${slot.slotIndex}: click to edit` : `Slot ${slot.slotIndex}: not matched to the active CMD` });
        swatch.style.background = cssColor(slot.color);
        swatch.disabled = !materialId || !onOpenColorPicker;
        swatch.addEventListener('click', event => {
            event.stopPropagation();
            try { if (onOpenColorPicker(swatch, materialId, slot.slotIndex) === false) say(`Slot ${slot.slotIndex} of ${entry.name} cannot be edited.`); }
            catch (error) { fail(error); }
        });
        return swatch;
    }
    const swatchButtons = (index, entry) => el('span', { cls: 'bp-swatches' }, entry.slots.slice(0, 8).map(slot => swatchButton(index, entry, slot)));
    /** Recolors existing swatches in place, so a color box opened from one keeps its anchor. */
    function repaintSwatches(container, entry) {
        for (const slot of entry.slots ?? []) {
            const swatch = container.querySelector(`.bp-swatch[data-slot="${slot.slotIndex}"]`);
            if (swatch) swatch.style.background = cssColor(slot.color);
        }
    }
    const entryFor = index => report[index] ?? { name: mesh.materialNames?.[index] || `Material ${index}`, status: 'unresolved', slots: [], notes: [] };
    const entryShape = (index, entry) => [entry.name, entry.status, bindings[index]?.materialId ?? null, (entry.slots ?? []).map(slot => slot.slotIndex)];

    let listShape = '';
    function renderMaterialList() {
        const total = materialTotal();
        materialCount.textContent = total ? String(total) : '';
        side.hidden = !mesh;
        const shape = JSON.stringify(Array.from({ length: total }, (_, index) => entryShape(index, entryFor(index))));
        const rows = [...materialList.querySelectorAll('.bp-material')];
        if (shape === listShape && rows.length === total) {
            // Same rows as before (a color edit or a selection change): update them without rebuilding.
            rows.forEach((row, index) => {
                row.classList.toggle('is-selected', selected === index);
                row.querySelector('.bp-material-pick').setAttribute('aria-pressed', String(selected === index));
                repaintSwatches(row, entryFor(index));
            });
            return;
        }
        listShape = shape;
        materialList.replaceChildren();
        for (let index = 0; index < total; index++) {
            const entry = entryFor(index);
            const label = STATUS_LABEL[entry.status] ?? entry.status;
            const name = el('button', { cls: 'bp-material-pick', attrs: { type: 'button', 'aria-pressed': String(selected === index), title: `${entry.name}: ${label}` } }, [
                el('span', { cls: 'bp-material-name', text: entry.name }),
            ]);
            const state = el('span', { cls: 'bp-state', attrs: { title: label, role: 'img', 'aria-label': label } }, [icon(entry.status in STATUS_LABEL ? entry.status : 'unresolved')]);
            const row = el('div', { cls: selected === index ? 'bp-material is-selected' : 'bp-material', attrs: { 'data-status': entry.status } }, [state, name, swatchButtons(index, entry)]);
            row.addEventListener('click', () => select(selected === index ? null : index));
            row.addEventListener('pointerenter', () => { hovered = index; requestRender(); });
            row.addEventListener('pointerleave', () => { if (hovered === index) { hovered = null; requestRender(); } });
            materialList.append(el('li', {}, [row]));
        }
    }

    let detailShape = '';
    function renderDetail() {
        if (!mesh || selected == null) { detail.replaceChildren(); detail.hidden = true; detailShape = ''; return; }
        detail.hidden = false;
        const entry = entryFor(selected);
        const masks = slotEffects.filter(e => e.materialIndex === selected && e.available).map(e => e.slotIndex);
        const canIsolate = mesh.parts.some(p => p.materialIndex === selected);
        const materialId = bindings[selected]?.materialId ?? null;
        let lucky = null;
        try { lucky = materialId && surprise ? surprise.state(materialId) : null; } catch { lucky = null; }
        const shape = JSON.stringify([selected, entryShape(selected, entry), masks, canIsolate, entry.family ?? '', entry.notes?.length ?? 0, lucky]);
        if (shape === detailShape) {
            repaintSwatches(detail, entry);
            detail.querySelector('.bp-isolate')?.setAttribute('aria-pressed', String(isolate));
            for (const toggle of detail.querySelectorAll('.bp-slot-mask')) toggle.setAttribute('aria-pressed', String(maskSlot === Number(toggle.dataset.slot)));
            return;
        }
        detailShape = shape;
        detail.replaceChildren();
        const label = STATUS_LABEL[entry.status] ?? entry.status;
        const isolateToggle = iconButton('isolate', 'Show only this part', { cls: 'bp-icon-btn bp-isolate', align: 'end', attrs: { 'aria-pressed': String(isolate) } });
        isolateToggle.disabled = !canIsolate;
        isolateToggle.addEventListener('click', () => { isolate = !isolate; isolateToggle.setAttribute('aria-pressed', String(isolate)); requestRender(); });
        const actions = el('div', { cls: 'bp-detail-actions' }, [isolateToggle]);
        if (lucky) {
            // The editor's Surprise Me for this material: same settings, same undo, same Current Changes.
            const act = (run, done) => () => {
                try { say(done(run(materialId))); } catch (error) { fail(error); }
            };
            const roll = iconButton('dice', 'Surprise Me', { cls: 'bp-icon-btn bp-surprise', align: 'end' });
            roll.disabled = !lucky.canSurprise;
            roll.addEventListener('click', act(surprise.run, changed => changed ? `Surprise Me changed ${changed} color${changed === 1 ? '' : 's'} of ${entry.name}.` : `Nothing to randomize in ${entry.name}.`));
            actions.append(roll);
            if (lucky.canUndo) {
                const undo = iconButton('undo', 'Undo Surprise', { cls: 'bp-icon-btn bp-surprise-undo', align: 'end' });
                undo.addEventListener('click', act(surprise.undo, () => `Restored ${entry.name} to before Surprise Me.`));
                actions.append(undo);
            }
        }
        if (bindings[selected]) {
            const locate = iconButton('edit', 'Show in the editor below', { align: 'end' });
            locate.addEventListener('click', () => onSelectMaterial?.(bindings[selected].materialId));
            actions.append(locate);
        }
        const close = iconButton('close', 'Deselect', { align: 'end' });
        close.addEventListener('click', () => select(null));
        actions.append(close);
        detail.append(el('div', { cls: 'bp-detail-head', attrs: { 'data-status': entry.status } }, [
            el('span', { cls: 'bp-state', attrs: { title: label, role: 'img', 'aria-label': label } }, [icon(entry.status in STATUS_LABEL ? entry.status : 'unresolved')]),
            el('strong', { cls: 'bp-detail-name', text: entry.name, attrs: { title: entry.family ? `${entry.name}\nShader: ${entry.family.replace(/\.mmtrs?$/, '')}` : entry.name } }),
            actions,
        ]));
        if (entry.slots?.length) {
            // One column per color slot: the swatch edits it, the eye below shows where it applies.
            detail.append(el('div', { cls: 'bp-slots' }, entry.slots.slice(0, 8).map(slot => {
                const column = el('div', { cls: 'bp-slot' }, [swatchButton(selected, entry, slot)]);
                if (masks.includes(slot.slotIndex)) {
                    const toggle = iconButton('eye', `Show where slot ${slot.slotIndex} applies (white = fully tinted)`, { cls: 'bp-slot-mask', align: 'start', attrs: { 'aria-pressed': String(maskSlot === slot.slotIndex), 'data-slot': String(slot.slotIndex) } });
                    toggle.addEventListener('click', () => { maskSlot = maskSlot === slot.slotIndex ? null : slot.slotIndex; applyMaterials(); renderDetail(); });
                    column.append(toggle);
                }
                return column;
            })));
        }
        if (entry.status === 'colors' && !bindings[selected]) detail.append(el('p', { cls: 'bp-fineprint', text: 'Not matched to a material in the active CMD, so it cannot be edited here.' }));
        else if (entry.status !== 'colors') detail.append(el('p', { cls: 'bp-fineprint', text: `${label}.` }));
        // The one thing worth saying about this part, if any; known preview limits are not listed.
        const partIssues = summarizeMaterialNotes([entry]).issues.map(issue => {
            const slots = issue.materials.map(name => name.match(/\(slot (\d+)\)$/)?.[1]).filter(Boolean);
            return slots.length ? `Slot ${slots.join(', ')} is not shown in the preview` : issue.label;
        });
        if (partIssues.length) detail.append(el('p', { cls: 'bp-fineprint', text: `${partIssues.join('. ')}.` }));
    }

    function renderBindings() {
        bindingRows.replaceChildren();
        if (!mesh) return;
        const choices = [];
        for (const material of snapshot?.materials ?? []) {
            for (const parameter of (assetResolver?.mdfMaterials.length ? [{ id: null, values: [1, 1, 1, 1], name: 'all mapped slots' }] : material.parameters)) {
                if (parameter.values) choices.push({ label: `${material.name} · cluster ${material.clusterInstanceId} · ${parameter.name}`, materialId: material.id, parameterId: parameter.id });
            }
        }
        for (let index = 0; index < materialTotal(); index++) {
            const select = el('select', { attrs: { 'aria-label': `Color binding for ${mesh.materialNames?.[index] ?? index}` } });
            const none = el('option', { text: 'No binding (model defaults)' }); none.value = ''; select.append(none);
            choices.forEach((choice, i) => { const option = el('option', { text: choice.label }); option.value = String(i); select.append(option); });
            const current = choices.findIndex(c => c.materialId === bindings[index]?.materialId && c.parameterId === bindings[index]?.parameterId);
            select.value = current < 0 ? '' : String(current);
            if (current < 0) delete bindings[index];
            select.addEventListener('change', () => {
                if (select.value === '') delete bindings[index];
                else bindings[index] = { materialId: choices[Number(select.value)].materialId, parameterId: choices[Number(select.value)].parameterId };
                rebuildMaterials();
            });
            bindingRows.append(el('label', { cls: 'preview-binding-row', text: `${mesh.materialNames?.[index] || `Material ${index}`} ` }, [select]));
        }
    }

    /** Matches mesh materials to the active CMD by exact, unique material name. */
    function bindMatchingMaterials() {
        bindings = {};
        if (!assetResolver?.mdfMaterials.length || !mesh) return;
        for (let i = 0; i < mesh.materialNames.length; i++) {
            let matches = (snapshot?.materials ?? []).filter(m => m.name === mesh.materialNames[i]);
            if (matches.length > 1) {
                // Head and hair meshes can both own e.g. esf_Hair00. The CMD keeps one cluster per
                // costume part, so the mesh's part folder (00 head, 01 body, 02 hair) picks the right one.
                const partType = PART_TYPE_BY_FOLDER[partFolder(meshPaths[mesh.materialMeshIndex?.[i] ?? 0])];
                const byPart = partType == null ? [] : matches.filter(m => (m.partTypes ?? []).includes(partType));
                if (byPart.length === 1) matches = byPart;
            }
            if (matches.length === 1) bindings[i] = { materialId: matches[0].id, parameterId: null };
        }
    }

    function select(index, { fromCanvas = false } = {}) {
        selected = index;
        maskSlot = null;
        if (index == null) isolate = false;
        applyMaterials(); renderMaterialList(); renderDetail();
        if (index != null) {
            if (fromCanvas && !pinned()) materialList.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
            // While pinned, a click on the model jumps the editor to that material's colors.
            // Unpinned, that jump would scroll the preview away, so it waits for "Show in editor".
            if (pinned() && bindings[index]) onSelectMaterial?.(bindings[index].materialId);
        }
    }

    // ---- loading -----------------------------------------------------------------------
    async function refreshResolver() {
        const entries = allEntries();
        assetResolver = createBrowserSceneAssetResolver(entries, meshPaths, { mdfFor: path => sceneMeshOf(path, sceneParts)?.mdf ?? null });
    }

    async function loadMeshes(files) {
        if (!files.length) return;
        const serial = ++loadSerial;
        if (files.reduce((sum, f) => sum + f.size, 0) > MAX_MESH_BYTES) { fail(new Error('These meshes exceed the 200 MiB preview limit.')); return; }
        busy('Reading mesh geometry…');
        try {
            const [{ parseReMesh }, { createMaterialWebGLPreview }, buffers] = await Promise.all([
                import('./re-mesh-parser.js'), import('./material-webgl-preview.js'), Promise.all(files.map(f => f.arrayBuffer())),
            ]);
            if (serial !== loadSerial) return;
            const parsed = combinePreviewMeshes(buffers.map(bytes => parseReMesh(bytes)));
            if (!renderer) {
                try { renderer = createMaterialWebGLPreview(canvas); }
                catch (error) {
                    if (!/WebGL 2 is unavailable/.test(error.message)) throw error;
                    const { createMaterialSoftwarePreview } = await import('./material-software-preview.js');
                    if (serial !== loadSerial) return;
                    renderer = createMaterialSoftwarePreview(canvas);
                }
            }
            renderer.setGeometry(parsed);
            mesh = parsed; meshPaths = files.map(f => f.name);
            selected = null; hovered = null; isolate = false; maskSlot = null; builtMaterials = []; report = []; slotEffects = [];
            await refreshResolver();
            if (serial !== loadSerial) return;
            bindMatchingMaterials();
            if (!stage.classList.contains('has-model')) showHint(true, { brief: true });
            stage.classList.add('has-model'); unload.disabled = false;
            resizeCanvas();
            // Show the grey geometry at once; textured materials follow as they decode.
            renderer.setMaterials(resolveBrowserPreviewMaterials(mesh, null, {}));
            requestRender(); renderMaterialList(); renderBindings();
            await rebuildMaterials({ announce: true });
        } catch (error) { fail(error); }
    }

    function clearScene({ quiet = false } = {}) {
        setPinned(false); setFull(false);
        loadSerial++; buildSerial++;
        renderer?.dispose(); renderer = null; mesh = null; assetResolver = null; meshPaths = []; localMeshFiles = null;
        bindings = {}; selected = null; hovered = null; isolate = false; maskSlot = null; builtMaterials = []; report = []; slotEffects = [];
        stage.classList.remove('has-model'); unload.disabled = true; showHint(false);
        renderMaterialList(); renderDetail(); renderBindings();
        for (const chip of meshChips.querySelectorAll('button')) chip.setAttribute('aria-pressed', 'false');
        if (!quiet) say('Model unloaded. Your color edits are unchanged.');
    }

    function selectedArchiveMeshes() {
        return [...meshChips.querySelectorAll('button[aria-pressed="true"]')].map(chip => chip.dataset.path);
    }
    function loadSelectedArchiveMeshes() {
        const paths = selectedArchiveMeshes();
        if (!paths.length) { if (mesh && !localMeshFiles) clearScene(); return; }
        localMeshFiles = null;
        const entries = allEntries();
        loadMeshes(paths.map(path => new File([entries[path]], path)));
    }
    /**
     * One chip per mesh in the imported mod and in the preview-only textures ZIP.
     * Starts with the head, body and hair of the first costume so several costumes or props
     * do not pile up; chips the user already toggled keep their state.
     */
    function rebuildChips() {
        const target = currentCostume();
        const targetKey = costumeKey(target);
        // Manual toggles are kept while the costume stays the same; a different costume starts fresh.
        const previous = targetKey === chipCostumeKey
            ? new Map([...meshChips.querySelectorAll('button')].map(chip => [chip.dataset.path, chip.getAttribute('aria-pressed') === 'true']))
            : new Map();
        chipCostumeKey = targetKey;
        meshChips.replaceChildren();
        const own = Object.keys(archiveEntries ?? {}).filter(name => MESH_RE.test(name)).sort();
        const extra = Object.keys(supportingEntries).filter(name => MESH_RE.test(name) && !own.includes(name)).sort();
        // Head, body, hair, then extra parts; within a part the real game file comes before its variants.
        const order = path => { const info = describeMeshPath(path); return `${info.part || 'zz'}${info.canonical ? 0 : 1}${info.costume}`; };
        const paths = [...own, ...extra].sort((a, b) => order(a).localeCompare(order(b)) || a.localeCompare(b));
        sceneParts = gameScene ?? findCostumeScn(archiveEntries, target)?.parts ?? null;
        const defaults = defaultMeshPaths(paths, target, sceneParts);
        // Several mod folders may offer the same part (leg, muscle or hair variants). Those chips
        // are named after their folder instead of all reading "Body" or "Hair".
        const folderLabels = modFolderLabels(paths.map(modFolderOf));
        const sameFile = new Map();
        for (const path of paths) { const key = nativeMeshBase(path); sameFile.set(key, (sameFile.get(key) ?? 0) + 1); }
        for (const path of paths) {
            const info = describeMeshPath(path);
            // A mesh the scene names is the real part whatever its file is called; when several mod
            // folders offer it, each is labelled by its folder ("Original legs", "Slender legs").
            const scenePart = sceneMeshOf(path, sceneParts);
            if (scenePart) { info.variant = ''; info.canonical = true; }
            if (!info.variant && sameFile.get(nativeMeshBase(path)) > 1) info.variant = folderLabels.get(modFolderOf(path)) ?? '';
            const pressed = previous.get(path) ?? defaults.has(path);
            const stock = extra.includes(path);
            const [glyph, word] = PART_LABEL[info.part] ?? ['part', info.part ? `Part ${info.part}` : shortMeshName(path)];
            // A variant shows its own label ("No Cape"); a bare number or letter gets the part name too ("Body 2").
            const text = !info.variant ? word : info.variant.length < 3 ? `${word} ${info.variant}` : info.variant;
            const chip = el('button', { cls: 'bp-chip', attrs: { type: 'button', 'aria-pressed': String(pressed), title: `${info.variant ? `${word} variant "${info.variant}"` : word}${stock ? ', stock part read for this preview only' : ', from your import'}\n${path}` } }, [icon(glyph), el('span', { text })]);
            // Parts borrowed from another costume folder (usually the shared "000" head) say so.
            if (info.costume && target && info.costume !== target.costume.toLowerCase()) chip.append(el('span', { cls: 'bp-chip-tag', text: info.costume }));
            chip.dataset.path = path;
            if (stock) chip.classList.add('is-stock');
            chip.dataset.part = info.part in PART_TYPE_BY_FOLDER ? info.part : '';
            chip.addEventListener('click', () => {
                const on = chip.getAttribute('aria-pressed') !== 'true';
                // Two heads, bodies or hairs never belong together: choosing a variant swaps it in.
                if (on && chip.dataset.part) for (const other of meshChips.querySelectorAll(`button[data-part="${chip.dataset.part}"]`)) other.setAttribute('aria-pressed', 'false');
                chip.setAttribute('aria-pressed', String(on));
                loadSelectedArchiveMeshes();
            });
            meshChips.append(chip);
        }
        meshChips.hidden = !paths.length;
        return paths;
    }
    function sectionOpen() { const section = root.closest('details'); return !section || section.open; }

    // ---- game files --------------------------------------------------------------------
    /**
     * Costume currently being edited. The active CMD decides when it belongs to this import (a mod
     * can cover several costumes, and its head often sits in the shared "000" folder). Otherwise
     * the import's own paths decide: CMD files first, then meshes, and "000" only as a last resort.
     */
    function currentCostume() {
        const palette = snapshot?.palette;
        const active = palette?.character && palette?.costume ? { character: String(palette.character).toLowerCase(), costume: String(palette.costume).toLowerCase() } : null;
        return pickCostume(Object.keys(archiveEntries ?? {}), active);
    }
    /** Fetches whatever the current costume still needs from the connected game PAKs, then shows it. */
    async function fetchFromGame({ force = false } = {}) {
        if (!gamePaks.length) return;
        const target = currentCostume();
        if (!target) { say('Game files are connected. Load your CMD files or a mod ZIP so the preview knows which costume to show.'); return; }
        const key = costumeKey(target);
        if (!force && (key === gameCostumeKey || key === gamePendingKey)) return;
        const serial = ++gameSerial;
        gamePendingKey = key;
        try {
            busy(`Reading ${key} from your game files…`);
            const { gatherCostumeFiles } = await import('./game-file-source.js');
            const result = await gatherCostumeFiles({ paks: gamePaks, ...target, have: archiveEntries ?? {}, onProgress: (done, label) => { if (serial === gameSerial) busy(`Reading game files… ${done} (${label})`); } });
            if (serial !== gameSerial) return;
            gameCostumeKey = key; gamePendingKey = ''; gameScene = result.scene?.parts ?? null;
            gameBodyMissing = result.parts.length > 0 && !result.parts.some(part => part.folder === '01');
            gameReadErrors = result.errors.length;
            // Stock files of a costume that is no longer shown are dropped, so its parts do not linger as chips.
            const kept = Object.fromEntries(Object.entries(supportingEntries).filter(([path]) => !gameEntryPaths.includes(path)));
            gameEntryPaths = Object.keys(result.entries);
            supportingEntries = { ...kept, ...result.entries };
            rebuildChips();
            if (selectedArchiveMeshes().length && !localMeshFiles) loadSelectedArchiveMeshes();
            else if (mesh) { await refreshResolver(); bindMatchingMaterials(); renderBindings(); await rebuildMaterials({ announce: true }); }
            else say(result.parts.length ? `Read ${key} from your game files.` : `No model for ${key} in your game files. It may be in a PAK that was not included (for example in the dlc folder).`);
        } catch (error) { if (serial === gameSerial) { gamePendingKey = ''; fail(error); } }
    }
    /** Opens the given PAK files (already in load order) plus the optional loose natives source. */
    async function connectGameFiles(files, loose = null) {
        const { openPak, fileSource } = await import('./re-pak-reader.js');
        const opened = [], problems = [];
        for (const file of files) {
            try { opened.push(await openPak(fileSource(file))); }
            catch (error) { problems.push(`${file.name}: ${error.message}`); }
        }
        if (!opened.length) { fail(new Error(problems[0] ?? 'No PAK file was selected.')); return false; }
        // Later sources win, like in the game: base PAK, patches, DLC, then loose files from installed mods.
        gamePaks = loose ? [...opened, loose] : opened; gameCostumeKey = '';
        // PAKs that would not open are named on the button; the others still work.
        setGameState('on', `Game connected: ${opened.length} PAK file${opened.length === 1 ? '' : 's'}${loose ? ' and the natives folder' : ''}.${problems.length ? ` Could not open: ${problems.join('; ')}.` : ''} Click to choose a different folder.`);
        await fetchFromGame({ force: true });
        return true;
    }
    /** The connect button: a labelled call to action until connected, then a quiet green icon. */
    function setGameState(state, tip = CONNECT_TIP) {
        const label = state === 'on' ? 'Game folder connected' : state === 'reconnect' ? 'Reconnect game folder' : CONNECT_LABEL;
        useGame.classList.toggle('is-on', state === 'on');
        useGame.replaceChild(icon(state === 'on' ? 'folderCheck' : 'folder'), useGame.firstChild);
        gameLabel.textContent = label;
        useGame.setAttribute('aria-label', label);
        useGame.title = tip;
        emptyConnect.hidden = state === 'on';
        connectHint.hidden = state === 'on';
        emptyConnect.lastChild.textContent = label;
        emptyText.textContent = state === 'on'
            ? 'Game connected. Load CMD files or a mod ZIP and the model appears here.'
            : 'Load CMD files or a mod ZIP, then connect your game folder once. Missing parts and textures come from the game.';
    }
    async function connectGameFolder(directory) {
        const { sourcesFromDirectory, rememberGameFolder } = await import('./game-folder.js');
        busy('Looking for game files in that folder…');
        const { pakFiles, loose } = await sourcesFromDirectory(directory);
        if (await connectGameFiles(pakFiles, loose)) await rememberGameFolder(directory);
    }
    /** One click: folder picker where the browser has one, otherwise a plain file picker for the PAKs. */
    async function chooseGame() {
        try {
            if (rememberedFolder) {
                // A folder from an earlier visit only needs its permission confirmed again.
                const folder = rememberedFolder; rememberedFolder = null;
                if (await folder.requestPermission({ mode: 'read' }) === 'granted') { await connectGameFolder(folder); return; }
            }
            if (typeof window.showDirectoryPicker !== 'function') { pakInput.click(); return; }
            await connectGameFolder(await window.showDirectoryPicker({ id: 'sf6-game-folder', mode: 'read' }));
        } catch (error) { if (error?.name !== 'AbortError') fail(error); }
    }
    /** On load: reconnect silently when the browser still allows it, otherwise offer a one-click reconnect. */
    async function restoreGameFolder() {
        try {
            const { recallGameFolder } = await import('./game-folder.js');
            const folder = await recallGameFolder();
            if (!folder || typeof folder.queryPermission !== 'function') return;
            if (await folder.queryPermission({ mode: 'read' }) === 'granted') await connectGameFolder(folder);
            else { rememberedFolder = folder; setGameState('reconnect', 'Your game folder is remembered. Click to let the browser read it again.'); }
        } catch { /* a stale or unreadable remembered folder just means connecting again */ }
    }

    function setAssets(entries) {
        if (archiveEntries === entries) return;
        if (mesh) clearScene({ quiet: true });
        supportingEntries = {}; archiveEntries = entries; gameCostumeKey = ''; gamePendingKey = ''; gameEntryPaths = []; gameBodyMissing = false; gameReadErrors = 0; gameScene = null;
        meshChips.replaceChildren();
        const paths = rebuildChips();
        // With the game connected, a new import pulls its missing stock files straight away.
        if (gamePaks.length && currentCostume() && sectionOpen()) { fetchFromGame(); return; }
        if (!paths.length) { say(entries ? 'This import has no model files.' : IDLE_MESSAGE); return; }
        if (sectionOpen()) loadSelectedArchiveMeshes();
        else { pendingAutoLoad = true; say(`${paths.length} mesh${paths.length === 1 ? '' : 'es'} found in the import. They load when this section opens.`); }
    }

    // ---- events ------------------------------------------------------------------------
    root.closest('details')?.addEventListener('toggle', event => {
        if (!event.target.open) return;
        if (gamePaks.length && currentCostume()) { pendingAutoLoad = false; fetchFromGame(); }
        else if (pendingAutoLoad) { pendingAutoLoad = false; loadSelectedArchiveMeshes(); }
        resizeCanvas();
    });
    useGame.addEventListener('click', chooseGame);
    emptyConnect.addEventListener('click', chooseGame);
    // The mouse hint shows briefly with the first model, then lives behind the "?" button.
    let hintTimer = 0;
    function showHint(visible, { brief = false } = {}) {
        clearTimeout(hintTimer);
        stage.classList.toggle('show-hint', visible);
        helpToggle.setAttribute('aria-pressed', String(visible));
        if (visible && brief) hintTimer = setTimeout(() => showHint(false), 7000);
    }
    helpToggle.addEventListener('click', () => showHint(!stage.classList.contains('show-hint')));
    pakInput.addEventListener('change', () => {
        const files = [...(pakInput.files ?? [])].sort((a, b) => a.name.localeCompare(b.name));
        pakInput.value = '';
        if (files.length) connectGameFiles(files);
    });
    openMesh.addEventListener('click', () => meshInput.click());
    addAssets.addEventListener('click', () => supportInput.click());
    meshInput.addEventListener('change', () => {
        const files = [...(meshInput.files ?? [])];
        meshInput.value = '';
        if (!files.length) return;
        for (const chip of meshChips.querySelectorAll('button')) chip.setAttribute('aria-pressed', 'false');
        localMeshFiles = files;
        loadMeshes(files);
    });
    supportInput.addEventListener('change', async () => {
        const file = supportInput.files?.[0];
        supportInput.value = '';
        if (!file) return;
        try {
            busy('Reading textures ZIP…');
            supportingEntries = await readPreviewAssetsZip(await file.arrayBuffer());
            const count = Object.keys(supportingEntries).length;
            const before = selectedArchiveMeshes().join('|');
            rebuildChips();
            const now = selectedArchiveMeshes();
            // New stock meshes (head, hair ...) join the scene; otherwise only the textures changed.
            if (now.length && now.join('|') !== before && !localMeshFiles) loadSelectedArchiveMeshes();
            else if (mesh) { await refreshResolver(); bindMatchingMaterials(); renderBindings(); await rebuildMaterials({ announce: true }); }
            else say(`Loaded ${count} preview-only files. Open a mesh to use them.`);
        } catch (error) { fail(error); }
    });
    unload.addEventListener('click', () => clearScene());
    resetView.addEventListener('click', () => setView({ ...DEFAULT_VIEW }));
    shadingToggle.addEventListener('click', () => { shading = shading === 'lit' ? 'flat' : 'lit'; shadingToggle.setAttribute('aria-pressed', String(shading === 'lit')); requestRender(); });
    // Floating window. It starts in the bottom right corner (CSS); once the user moves or resizes it,
    // its rectangle is kept here, remembered between visits and kept inside the browser window.
    const viewportSize = () => ({ width: document.documentElement.clientWidth, height: window.innerHeight });
    const stageRect = () => { const box = stage.getBoundingClientRect(); return { left: box.left, top: box.top, width: box.width, height: box.height }; };
    let floatRect = null, floatViewport = null;
    try {
        const saved = parseFloatPlacement(localStorage.getItem(FLOAT_STORAGE_KEY));
        if (saved) { floatRect = saved.rect; floatViewport = saved.viewport; }
    } catch { /* storage is blocked: the window just starts in its corner */ }
    function placeFloat(rect) {
        floatRect = rect; floatViewport = viewportSize();
        stage.classList.add('is-placed');
        for (const side of ['left', 'top', 'width', 'height']) stage.style.setProperty(`--bp-float-${side}`, `${rect[side]}px`);
        resizeCanvas(); // redraw at the new size now, not a frame later
    }
    function saveFloat() {
        if (!floatRect) return;
        try { localStorage.setItem(FLOAT_STORAGE_KEY, serializeFloatPlacement(floatRect, floatViewport)); } catch { /* not remembered */ }
    }
    const refitFloat = () => { if (pinned() && floatRect) placeFloat(reanchorFloatRect(floatRect, floatViewport, viewportSize())); };
    window.addEventListener('resize', refitFloat);
    function setPinned(value) {
        if (value) setFull(false);
        stage.classList.toggle('is-pinned', value);
        stage.classList.remove('is-placed', 'is-moving', 'is-resizing', 'is-camera-key');
        if (value) refitFloat();
        pinToggle.setAttribute('aria-pressed', String(value));
        setTip(pinToggle, value ? 'Put the preview back in the page' : PIN_TIP);
        fillHint(value ? FLOAT_HINT : HINT);
        requestAnimationFrame(resizeCanvas);
    }
    pinToggle.addEventListener('click', () => {
        const floating = !pinned();
        setPinned(floating);
        if (floating) showHint(true, { brief: true });
    });
    for (const handle of resizeHandles) {
        let grab = null;
        handle.addEventListener('pointerdown', event => {
            if (!pinned() || event.button !== 0) return;
            event.preventDefault();
            handle.setPointerCapture(event.pointerId);
            grab = { id: event.pointerId, x: event.clientX, y: event.clientY, rect: stageRect() };
            stage.classList.add('is-resizing');
        });
        handle.addEventListener('pointermove', event => {
            if (grab?.id !== event.pointerId) return;
            placeFloat(resizeFloatRect(grab.rect, handle.dataset.dir, event.clientX - grab.x, event.clientY - grab.y, viewportSize()));
        });
        const release = event => {
            if (grab?.id !== event.pointerId) return;
            grab = null;
            stage.classList.remove('is-resizing');
            saveFloat();
        };
        handle.addEventListener('pointerup', release);
        handle.addEventListener('pointercancel', release);
    }
    // Full screen: the whole panel (model, palette tabs, materials and their colors) covers the window.
    // It is a page overlay, and the browser's own full screen is requested for the whole document
    // on top of it, so the editor's color box and menus still open above it.
    const page = document.documentElement;
    const isFull = () => root.classList.contains('is-full');
    function renderPaletteTabs() {
        let list = [];
        try { list = isFull() ? palettes?.list() ?? [] : []; } catch { list = []; }
        paletteTabs.hidden = list.length < 2;
        paletteTabs.replaceChildren(...(paletteTabs.hidden ? [] : list.map((item, index) => {
            const tab = el('button', { cls: 'bp-palette', text: item.label, attrs: { type: 'button', role: 'tab', 'aria-selected': String(Boolean(item.active)), title: item.title ?? item.label } });
            tab.addEventListener('click', () => { try { palettes.select(index); } catch (error) { fail(error); } });
            return tab;
        })));
        paletteTabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function setFull(value) {
        if (value === isFull()) return;
        if (value) setPinned(false);
        root.classList.toggle('is-full', value);
        page.classList.toggle('bp-full-open', value);
        fullToggle.setAttribute('aria-pressed', String(value));
        fullToggle.replaceChildren(icon(value ? 'shrink' : 'expand'));
        setTip(fullToggle, value ? 'Leave full screen (Esc)' : FULL_TIP);
        if (value) { advanced.hidden = true; advancedToggle.setAttribute('aria-expanded', 'false'); }
        renderPaletteTabs();
        // Best effort: where the browser refuses (or has no) real full screen, the overlay still fills the window.
        if (value && !document.fullscreenElement) page.requestFullscreen?.().catch(() => {});
        else if (!value && document.fullscreenElement === page) document.exitFullscreen?.().catch(() => {});
        if (!value) root.scrollIntoView({ block: 'nearest' });
        requestAnimationFrame(resizeCanvas);
    }
    fullToggle.addEventListener('click', () => setFull(!isFull()));
    // Esc leaves the browser's full screen by itself; follow it. Without real full screen, Esc is ours,
    // unless a color box or menu is open and wants it first.
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) setFull(false); });
    document.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || !isFull() || document.fullscreenElement || event.defaultPrevented) return;
        if (document.querySelector('#custom-color-picker:not(.hidden), .surprise-menu:not(.hidden)')) return;
        setFull(false);
    });

    // Pointer, in the page: drag orbits, Shift/right/middle drag pans, two fingers pinch-zoom, a still
    // click picks. While the preview floats, a plain drag moves the window instead, so Shift + drag
    // orbits, right/middle drag pans and two fingers both zoom and orbit.
    const pointers = new Map();
    let dragMoved = false, pinchDistance = 0;
    const pixelsToWorld = () => view.distance * 2 * Math.tan(Math.PI / 8) / Math.max(1, canvas.getBoundingClientRect().height);
    // A middle-button press would otherwise start the browser's own drag-to-scroll.
    canvas.addEventListener('mousedown', event => { if (event.button === 1) event.preventDefault(); });
    canvas.addEventListener('pointerdown', event => {
        if (!mesh) return;
        canvas.focus({ preventScroll: true });
        canvas.setPointerCapture(event.pointerId);
        const windowRect = pinned() && event.button === 0 && !event.shiftKey && !pointers.size ? stageRect() : null;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, windowRect });
        if (pointers.size === 1) dragMoved = false;
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()];
            pinchDistance = Math.hypot(a.x - b.x, a.y - b.y); dragMoved = true;
            // A second finger turns a window move into a camera gesture.
            if (a.windowRect) { a.windowRect = null; stage.classList.remove('is-moving'); saveFloat(); }
        }
    });
    canvas.addEventListener('pointermove', event => {
        if (pinned() && !event.buttons) stage.classList.toggle('is-camera-key', event.shiftKey);
        const pointer = pointers.get(event.pointerId);
        if (!pointer || !mesh) return;
        const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
        pointer.x = event.clientX; pointer.y = event.clientY;
        if (pointers.size === 2) {
            const [a, b] = [...pointers.values()], distance = Math.hypot(a.x - b.x, a.y - b.y);
            const next = { ...view };
            if (pinchDistance > 0 && distance > 0) next.distance = view.distance * pinchDistance / distance;
            // Each finger reports half of a two-finger drag.
            if (pinned()) { next.yaw = view.yaw - dx * .225; next.pitch = view.pitch + dy * .225; }
            setView(next);
            pinchDistance = distance;
            return;
        }
        if (!dragMoved && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 4) return;
        dragMoved = true;
        if (pointer.windowRect) {
            stage.classList.add('is-moving');
            placeFloat(moveFloatRect(pointer.windowRect, event.clientX - pointer.startX, event.clientY - pointer.startY, viewportSize()));
            return;
        }
        stage.classList.add('is-dragging');
        if (event.buttons & 6 || (event.shiftKey && !pinned())) { const scale = pixelsToWorld(); setView({ ...view, panX: view.panX - dx * scale, panY: view.panY + dy * scale }); }
        else setView({ ...view, yaw: view.yaw - dx * .45, pitch: view.pitch + dy * .45 });
    });
    const endPointer = event => {
        const pointer = pointers.get(event.pointerId);
        pointers.delete(event.pointerId);
        stage.classList.remove('is-dragging', 'is-moving');
        if (pointer?.windowRect && dragMoved) saveFloat();
        if (!pointer || !mesh || dragMoved || event.type !== 'pointerup' || event.button !== 0) return;
        try {
            const box = canvas.getBoundingClientRect();
            select(renderer.pick((event.clientX - box.left) * canvas.width / box.width, (event.clientY - box.top) * canvas.height / box.height), { fromCanvas: true });
        } catch (error) { fail(error); }
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('dblclick', () => setView({ ...DEFAULT_VIEW }));
    // Zoom only once the preview has focus, so scrolling the page past it is never hijacked.
    canvas.addEventListener('wheel', event => {
        if (!mesh || document.activeElement !== canvas) return;
        event.preventDefault();
        setView({ ...view, distance: view.distance * Math.exp(event.deltaY * .0012) });
    }, { passive: false });
    canvas.addEventListener('keydown', event => {
        if (!mesh) return;
        const step = { ArrowLeft: [8, 0], ArrowRight: [-8, 0], ArrowUp: [0, 6], ArrowDown: [0, -6] }[event.key];
        if (step) setView({ ...view, yaw: view.yaw + step[0], pitch: view.pitch + step[1] });
        else if (event.key === '+' || event.key === '=') setView({ ...view, distance: view.distance * .9 });
        else if (event.key === '-') setView({ ...view, distance: view.distance / .9 });
        else if (event.key === '0') setView({ ...DEFAULT_VIEW });
        else if (event.key === 'Escape') select(null);
        else return;
        event.preventDefault();
    });
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fail(new Error('The browser graphics context was lost. Unload and reopen the model to recover.')); });

    renderMaterialList(); renderDetail();
    restoreGameFolder();

    return {
        update(next) {
            const paletteChanged = snapshot?.palette?.id !== next.palette?.id;
            snapshot = next;
            renderPaletteTabs();
            if (paletteChanged) {
                // The active CMD can belong to another costume of the same import: show that costume's parts.
                const before = selectedArchiveMeshes().join('|');
                if (costumeKey(currentCostume()) !== chipCostumeKey) rebuildChips();
                // Loose CMD files carry no paths, so the costume is only known once the snapshot arrives.
                if (gamePaks.length && sectionOpen()) fetchFromGame();
                else if (!localMeshFiles && selectedArchiveMeshes().join('|') !== before) {
                    if (!sectionOpen()) pendingAutoLoad = true;
                    else { loadSelectedArchiveMeshes(); return; }
                }
            }
            if (!mesh) return;
            if (paletteChanged) bindMatchingMaterials();
            renderBindings();
            // Another CMD changes which materials are matched, so the summary line is refreshed with it.
            rebuildMaterials({ summarize: paletteChanged });
        },
        setAssets,
    };
}
