// Geometry for the floating 3D preview window: keeping it inside the viewport, moving it, resizing
// it from any edge or corner, and following the nearer viewport edges when the browser is resized.
// Pure functions on { left, top, width, height } rectangles in CSS pixels; no DOM here.

export const FLOAT_MIN_WIDTH = 150;
export const FLOAT_MIN_HEIGHT = 170;
export const FLOAT_MARGIN = 8;
export const RESIZE_DIRECTIONS = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const room = viewportSize => Math.max(1, viewportSize - 2 * FLOAT_MARGIN);
// A viewport smaller than the minimum window still gets a window that fits it.
const least = (viewportSize, min) => Math.min(min, room(viewportSize));

/** Shrinks and shifts a rectangle so all of it is inside the viewport. */
export function fitFloatRect(rect, viewport) {
    const width = clamp(rect.width, least(viewport.width, FLOAT_MIN_WIDTH), room(viewport.width));
    const height = clamp(rect.height, least(viewport.height, FLOAT_MIN_HEIGHT), room(viewport.height));
    return {
        left: clamp(rect.left, FLOAT_MARGIN, viewport.width - FLOAT_MARGIN - width),
        top: clamp(rect.top, FLOAT_MARGIN, viewport.height - FLOAT_MARGIN - height),
        width, height,
    };
}

/** The rectangle after dragging it by (dx, dy) from where the drag started. */
export function moveFloatRect(start, dx, dy, viewport) {
    return fitFloatRect({ ...start, left: start.left + dx, top: start.top + dy }, viewport);
}

/**
 * The rectangle after dragging one edge or corner by (dx, dy). `direction` names the edges being
 * dragged ("n", "se" ...); the opposite edges stay where they were.
 */
export function resizeFloatRect(start, direction, dx, dy, viewport) {
    let { left, top } = start;
    let right = start.left + start.width, bottom = start.top + start.height;
    const minWidth = least(viewport.width, FLOAT_MIN_WIDTH), minHeight = least(viewport.height, FLOAT_MIN_HEIGHT);
    if (direction.includes('e')) right = clamp(right + dx, left + minWidth, viewport.width - FLOAT_MARGIN);
    if (direction.includes('w')) left = clamp(left + dx, FLOAT_MARGIN, right - minWidth);
    if (direction.includes('s')) bottom = clamp(bottom + dy, top + minHeight, viewport.height - FLOAT_MARGIN);
    if (direction.includes('n')) top = clamp(top + dy, FLOAT_MARGIN, bottom - minHeight);
    return fitFloatRect({ left, top, width: right - left, height: bottom - top }, viewport);
}

/**
 * Where a rectangle placed in one viewport belongs in another: it keeps its distance to whichever
 * side it was nearer to, so a window parked in the bottom right corner stays in that corner.
 */
export function reanchorFloatRect(rect, from, to) {
    const nearRight = rect.left + rect.width / 2 > from.width / 2;
    const nearBottom = rect.top + rect.height / 2 > from.height / 2;
    return fitFloatRect({
        ...rect,
        left: rect.left + (nearRight ? to.width - from.width : 0),
        top: rect.top + (nearBottom ? to.height - from.height : 0),
    }, to);
}

/** Reads a saved placement; anything malformed counts as "never placed". */
export function parseFloatPlacement(text) {
    try {
        const saved = JSON.parse(text);
        const numbers = [saved.left, saved.top, saved.width, saved.height, saved.viewportWidth, saved.viewportHeight];
        if (!numbers.every(value => Number.isFinite(value)) || saved.width <= 0 || saved.height <= 0) return null;
        return {
            rect: { left: saved.left, top: saved.top, width: saved.width, height: saved.height },
            viewport: { width: saved.viewportWidth, height: saved.viewportHeight },
        };
    } catch { return null; }
}

export function serializeFloatPlacement(rect, viewport) {
    const round = value => Math.round(value);
    return JSON.stringify({
        left: round(rect.left), top: round(rect.top), width: round(rect.width), height: round(rect.height),
        viewportWidth: round(viewport.width), viewportHeight: round(viewport.height),
    });
}
