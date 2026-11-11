// Diagnostic inspector, deliberately not a simulated 3D/game screenshot.
import { linearFloatRgbaToCmdRgba } from './sf6-color-space.js';

const hex = values => values ? '#' + linearFloatRgbaToCmdRgba(values)
    .map(v => v.toString(16).padStart(2, '0')).join('') : null;
const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
};

export function createMaterialPreviewPanel(root, { onSelect } = {}) {
    if (!root) return { update() {} };
    let current = null;
    let selected = null;
    const header = element('div', null, 'preview-toolbar');
    const filter = element('input');
    filter.type = 'search'; filter.placeholder = 'Filter material names'; filter.setAttribute('aria-label', 'Filter preview materials');
    const exportButton = element('button', 'Export preview state', 'secondary-button');
    exportButton.type = 'button';
    const clear = element('button', 'Clear selection', 'secondary-button'); clear.type = 'button';
    header.append(filter, clear, exportButton);
    const status = element('p', 'Load CMD files to inspect effective material values.');
    status.setAttribute('role', 'status');
    const list = element('div', null, 'preview-material-list');
    root.append(header, status, list);
    function render() {
        list.replaceChildren();
        const materials = (current?.materials ?? []).filter(m => m.name.toLowerCase().includes(filter.value.toLowerCase()));
        for (const material of materials) {
            const card = element('article', null, 'preview-material');
            card.append(element('h4', material.name));
            card.append(element('p', `Model part types: ${material.partTypes.join(', ') || 'unknown'}`, 'preview-provenance'));
            for (const parameter of material.parameters) {
                const row = element('div', null, 'preview-slot');
                row.classList.toggle('is-selected', parameter.id === selected);
                const button = element('button', parameter.name, 'secondary-button'); button.type = 'button';
                button.setAttribute('aria-pressed', String(parameter.id === selected));
                button.title = 'Locate this slot in the existing color editor';
                button.addEventListener('click', () => {
                    selected = parameter.id;
                    onSelect?.({ type: 'select', revision: current.revision, materialId: material.id, parameterId: parameter.id });
                    render();
                });
                row.append(button);
                for (const [label, values] of [['Original', parameter.baselineValues], ['Current', parameter.values]]) {
                    const color = hex(values);
                    const swatch = element('span', `${label}: ${color ?? 'unknown'}`, 'preview-swatch');
                    if (color) swatch.style.setProperty('--preview-color', color);
                    swatch.title = values ? `Linear RGBA: ${values.join(', ')}` : 'No verified material default is available.';
                    row.append(swatch);
                }
                row.append(element('span', `${parameter.source}${parameter.targets.length ? ` · shared default (${parameter.targets.length} targets)` : ''}${parameter.editable ? '' : ' · read only'}`, 'preview-provenance'));
                if (parameter.blockedReason) row.append(element('span', parameter.blockedReason, 'preview-provenance'));
                card.append(row);
            }
            list.append(card);
        }
        exportButton.disabled = !current?.palette;
        status.textContent = current?.palette
            ? `${materials.length} materials shown. Color values only; no mesh, mask or game-lighting preview is connected.`
            : 'Load CMD files to inspect effective material values.';
    }
    filter.addEventListener('input', render);
    clear.addEventListener('click', () => { selected = null; onSelect?.(null); render(); });
    exportButton.addEventListener('click', () => {
        if (!current?.palette) return;
        const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = element('a'); link.href = url; link.download = 'colorsync-preview-state.json';
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    return { update(snapshot) {
        current = snapshot;
        if (!snapshot.materials.some(m => m.parameters.some(p => p.id === selected))) selected = null;
        render();
    } };
}
