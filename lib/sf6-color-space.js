// SF6 stores CMD RGB channels as sRGB bytes, while the game/runtime exposes
// the decoded linear values. Alpha is not color-space encoded.

function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

export function srgbByteToLinearByte(value) {
    const srgb = clampByte(value) / 255;
    const linear = srgb <= 0.04045
        ? srgb / 12.92
        : ((srgb + 0.055) / 1.055) ** 2.4;
    return clampByte(linear * 255);
}

export function linearByteToSrgbByte(value) {
    const linear = clampByte(value) / 255;
    const srgb = linear <= 0.0031308
        ? linear * 12.92
        : (1.055 * (linear ** (1 / 2.4))) - 0.055;
    return clampByte(srgb * 255);
}

export function cmdRgbaToRuntimeRgba(rgba) {
    return [
        srgbByteToLinearByte(rgba?.[0]),
        srgbByteToLinearByte(rgba?.[1]),
        srgbByteToLinearByte(rgba?.[2]),
        clampByte(rgba?.[3] ?? 255),
    ];
}

export function runtimeRgbaToCmdRgba(rgba) {
    return [
        linearByteToSrgbByte(rgba?.[0]),
        linearByteToSrgbByte(rgba?.[1]),
        linearByteToSrgbByte(rgba?.[2]),
        clampByte(rgba?.[3] ?? 255),
    ];
}
