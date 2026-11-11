import assert from "node:assert/strict";
import test from "node:test";
import {
    FLOAT_MARGIN, FLOAT_MIN_HEIGHT, FLOAT_MIN_WIDTH,
    fitFloatRect, moveFloatRect, parseFloatPlacement, reanchorFloatRect, resizeFloatRect, serializeFloatPlacement,
} from "../lib/preview-float.js";

const viewport = { width: 1280, height: 800 };
const start = { left: 800, top: 300, width: 380, height: 456 };
const inside = (rect, view = viewport) => rect.left >= FLOAT_MARGIN && rect.top >= FLOAT_MARGIN
    && rect.left + rect.width <= view.width - FLOAT_MARGIN && rect.top + rect.height <= view.height - FLOAT_MARGIN;

test("a moved window follows the pointer and stops at the viewport edges", () => {
    assert.deepEqual(moveFloatRect(start, -100, 20, viewport), { ...start, left: 700, top: 320 });
    const pushed = moveFloatRect(start, 5000, 5000, viewport);
    assert.deepEqual(pushed, { ...start, left: 1280 - FLOAT_MARGIN - 380, top: 800 - FLOAT_MARGIN - 456 });
    assert.deepEqual(moveFloatRect(start, -5000, -5000, viewport), { ...start, left: FLOAT_MARGIN, top: FLOAT_MARGIN });
});

test("resizing moves only the dragged edges", () => {
    assert.deepEqual(resizeFloatRect(start, "se", 40, -50, viewport), { left: 800, top: 300, width: 420, height: 406 });
    assert.deepEqual(resizeFloatRect(start, "nw", -100, -60, viewport), { left: 700, top: 240, width: 480, height: 516 });
    assert.deepEqual(resizeFloatRect(start, "e", 30, 999, viewport), { ...start, width: 410 });
    assert.deepEqual(resizeFloatRect(start, "n", 999, 100, viewport), { ...start, top: 400, height: 356 });
});

test("resizing stops at the minimum size and at the viewport edges", () => {
    const tiny = resizeFloatRect(start, "nw", 5000, 5000, viewport);
    assert.deepEqual(tiny, { left: 800 + 380 - FLOAT_MIN_WIDTH, top: 300 + 456 - FLOAT_MIN_HEIGHT, width: FLOAT_MIN_WIDTH, height: FLOAT_MIN_HEIGHT });
    const huge = resizeFloatRect(start, "nw", -5000, -5000, viewport);
    assert.deepEqual(huge, { left: FLOAT_MARGIN, top: FLOAT_MARGIN, width: 800 + 380 - FLOAT_MARGIN, height: 300 + 456 - FLOAT_MARGIN });
    for (const direction of ["n", "e", "s", "w", "ne", "se", "sw", "nw"]) {
        for (const [dx, dy] of [[9999, 9999], [-9999, -9999], [9999, -9999], [-9999, 9999]]) {
            const rect = resizeFloatRect(start, direction, dx, dy, viewport);
            assert.ok(inside(rect), `${direction} ${dx},${dy}`);
            assert.ok(rect.width >= FLOAT_MIN_WIDTH && rect.height >= FLOAT_MIN_HEIGHT, `${direction} ${dx},${dy}`);
        }
    }
});

test("a window larger than the viewport is shrunk to fit it", () => {
    const phone = { width: 375, height: 640 };
    const rect = fitFloatRect({ left: 900, top: 500, width: 600, height: 900 }, phone);
    assert.ok(inside(rect, phone));
    assert.deepEqual(rect, { left: FLOAT_MARGIN, top: FLOAT_MARGIN, width: 375 - 2 * FLOAT_MARGIN, height: 640 - 2 * FLOAT_MARGIN });
    const sliver = { width: 120, height: 100 };
    assert.ok(inside(fitFloatRect(start, sliver), sliver));
});

test("a window keeps its distance to the nearer viewport edges", () => {
    const corner = { left: 1280 - 16 - 380, top: 800 - 16 - 456, width: 380, height: 456 };
    const wider = { width: 1600, height: 900 };
    assert.deepEqual(reanchorFloatRect(corner, viewport, wider), { ...corner, left: 1600 - 16 - 380, top: 900 - 16 - 456 });
    const topLeft = { left: 20, top: 30, width: 300, height: 360 };
    assert.deepEqual(reanchorFloatRect(topLeft, viewport, wider), topLeft);
    assert.ok(inside(reanchorFloatRect(corner, viewport, { width: 400, height: 500 }), { width: 400, height: 500 }));
});

test("saved placements round-trip and bad ones are ignored", () => {
    const saved = parseFloatPlacement(serializeFloatPlacement({ left: 10.4, top: 20.6, width: 300, height: 360 }, viewport));
    assert.deepEqual(saved, { rect: { left: 10, top: 21, width: 300, height: 360 }, viewport });
    for (const bad of [null, "", "{", "[]", "{\"left\":1}", JSON.stringify({ left: 1, top: 1, width: 0, height: 5, viewportWidth: 9, viewportHeight: 9 })]) {
        assert.equal(parseFloatPlacement(bad), null);
    }
});
