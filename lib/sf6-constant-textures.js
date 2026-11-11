// SF6 materials often point unused slots at tiny engine placeholder textures. A mod ZIP
// never ships them, so the preview substitutes their flat texel values.
//
// Values are the decoded texels of the game's own 8x8 files (tools/dump-constant-textures.mjs),
// not the numbers in the file names: several names do not match their contents.
const CONSTANTS = new Map([
    ['systems/rendering/nullwhite', [255, 255, 255, 255, true]],
    ['systems/rendering/nullblack', [0, 0, 0, 255, true]],
    ['systems/rendering/nullgray', [128, 128, 128, 255, false]],
    ['systems/rendering/nullatos', [255, 0, 255, 255, false]],
    ['systems/rendering/nullnormal', [127, 126, 255, 0, false]],
    ['systems/rendering/nullnormalroughness', [128, 128, 254, 128, false]],
    ['systems/rendering/nullnormalroughnessocclusion', [127, 127, 255, 127, false]],
    ['product/mastermaterial/texture/nullnormalroughnesscavity', [255, 128, 255, 92, false]],
    ['product/mastermaterial/texture/null_stitch', [128, 129, 255, 0, false]],
    ['product/mastermaterial/texture/null_rgb_128_128_0', [128, 128, 0, 255, false]],
    ['product/mastermaterial/texture/null_rgba_0000', [0, 0, 0, 0, false]],
    ['product/mastermaterial/texture/null_rgba_0_255_0_255', [0, 255, 0, 255, false]],
    ['product/mastermaterial/texture/null_rgba_128_128_128_128', [128, 128, 128, 128, false]],
    ['product/mastermaterial/texture/null_rgba_128_128_255_0', [128, 129, 255, 0, false]],
    ['product/mastermaterial/texture/null_rgba_128_128_255_128', [128, 128, 0, 127, false]],
    ['product/mastermaterial/texture/null_rgba_128_128_255_255', [128, 128, 255, 255, false]],
    ['product/mastermaterial/texture/null_rgba_255_0_0_0', [255, 0, 0, 255, true]],
    ['product/mastermaterial/texture/null_rgba_255_128_0_128', [255, 127, 0, 126, false]],
    ['product/mastermaterial/texture/null_rgba_255_255_255_255', [255, 255, 255, 255, false]],
]);

const cache = new Map();

export function constantTextureKey(reference) {
    return String(reference ?? '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase()
        .replace(/^natives\/stm\//, '').replace(/\.tex(?:\.\d+)?$/, '');
}

/** Returns a shared 1x1 RGBA texture for a known engine placeholder path, otherwise null. */
export function constantTextureFor(reference) {
    const key = constantTextureKey(reference);
    const value = CONSTANTS.get(key);
    if (!value) return null;
    if (!cache.has(key)) {
        cache.set(key, { width: 1, height: 1, data: new Uint8Array(value.slice(0, 4)), srgb: value[4], constant: true });
    }
    return cache.get(key);
}
