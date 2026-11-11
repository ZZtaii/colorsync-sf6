// Small inline icon set for the 3D preview panel. 24px grid, stroked with the current text color
// (see .bp-icon in styles.css); shapes marked class="f" are filled. No external assets.
const NS = 'http://www.w3.org/2000/svg';
const BUST = '<path d="M4 21.5c.8-3.7 3.9-5.2 8-5.2s7.2 1.5 8 5.2"/>';
const ICONS = {
    // Camera presets: a small bust seen from each side.
    viewFront: `<circle cx="12" cy="8.5" r="5.2"/>${BUST}<path d="M10 8.4h.01M14 8.4h.01"/>`,
    viewBack: `<circle class="f" cx="12" cy="8.5" r="5.2"/>${BUST}`,
    viewFaceRight: `<circle cx="11.3" cy="8.5" r="5.2"/><path d="M16.3 7.2l2.6 1.7-2.6 1.1"/><path d="M13.6 7.6h.01"/><path d="M6.5 21.5c.5-3.7 2.3-5.2 5-5.2s4.5 1.5 5 5.2"/>`,
    viewFaceLeft: `<circle cx="12.7" cy="8.5" r="5.2"/><path d="M7.7 7.2L5.1 8.9l2.6 1.1"/><path d="M10.4 7.6h.01"/><path d="M7.5 21.5c.5-3.7 2.3-5.2 5-5.2s4.5 1.5 5 5.2"/>`,
    reset: '<path d="M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="2.6"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/>',
    pin: '<rect x="3" y="4.5" width="18" height="15" rx="2.2"/><rect class="f" x="11.5" y="11.5" width="7" height="5.5" rx="1"/>',
    expand: '<path d="M4 9.5V4h5.5M14.5 4H20v5.5M20 14.5V20h-5.5M9.5 20H4v-5.5"/>',
    shrink: '<path d="M9.5 4v5.5H4M20 9.5h-5.5V4M14.5 20v-5.5H20M4 14.5h5.5V20"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.2"/><path d="M8.6 8.6h.01M15.4 8.6h.01M12 12h.01M8.6 15.4h.01M15.4 15.4h.01"/>',
    undo: '<path d="M8.5 5L4 9.5 8.5 14"/><path d="M4 9.5h10a5.5 5.5 0 0 1 0 11h-3.5"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.3c-.8.5-1.2 1-1.2 1.9M12 16.8h.01"/>',
    folder: '<path d="M3 7.5a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    folderCheck: '<path d="M3 7.5a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 13.3l2.2 2.2 4-4.3"/>',
    unload: '<path d="M12 5l7 8.5H5z"/><path d="M5 18.5h14"/>',
    // Material status
    colors: '<path d="M12 3.5c3.2 3.6 5.5 6.5 5.5 9.5a5.5 5.5 0 0 1-11 0c0-3 2.3-5.9 5.5-9.5z"/>',
    base: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 16l4.5-4.5 4 4 3-3 5.5 5"/><path d="M15.5 9.2h.01"/>',
    hidden: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/><path d="M4 4l16 16"/>',
    unresolved: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10.5v4M12 17.2h.01"/>',
    eye: '<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
    // Selected-part actions
    isolate: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/>',
    edit: '<path d="M4 20l1-4.5L16.5 4l3.5 3.5L8.5 19z"/><path d="M14 6.5l3.5 3.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    sliders: '<path d="M4 7.5h9M18.5 7.5H20M4 16.5h1.5M11 16.5h9"/><circle cx="15.8" cy="7.5" r="2.6"/><circle cx="8.2" cy="16.5" r="2.6"/>',
    // Model parts
    head: '<circle cx="12" cy="12" r="8.5"/><path d="M9 10.2h.01M15 10.2h.01M8.8 14.2c1.8 2 4.6 2 6.4 0"/>',
    body: '<path d="M8.5 3.5L3 6.5l2 4 2.5-1.2V20.5h9V9.3L19 10.5l2-4-5.5-3a3.5 3.5 0 0 1-7 0z"/>',
    hair: '<path d="M7 4c-2.5 3.5 2.5 5 0 8.5s2 4.5 0 7.5M12 4c-2.5 3.5 2.5 5 0 8.5s2 4.5 0 7.5M17 4c-2.5 3.5 2.5 5 0 8.5s2 4.5 0 7.5"/>',
    part: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    model: '<circle cx="12" cy="5" r="2.5"/><path d="M5 10.5c4.5-1.3 9.5-1.3 14 0M12 9.6V15M12 15l-3.5 6.5M12 15l3.5 6.5"/>',
};

/** Returns a decorative `<svg>` for one of the names above. */
export function icon(name) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'bp-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.innerHTML = ICONS[name] ?? ICONS.part;
    return svg;
}
