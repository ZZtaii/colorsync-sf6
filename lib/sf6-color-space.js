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

// Bulk REFramework exports keep the original linear float channels. Do not
// quantize them to runtime hex bytes before converting to visual CMD bytes.
export function linearFloatRgbaToCmdRgba(rgba) {
    return rgba.map((value, index) => {
        if (index === 3) return clampByte(value * 255);
        const srgb = value <= 0.0031308
            ? value * 12.92
            : (1.055 * (value ** (1 / 2.4))) - 0.055;
        return clampByte(srgb * 255);
    });
}

// Keep full linear precision when exporting CMD bytes to the shared clipboard
// format. Runtime hex would discard dark-channel detail before re-import.
export function cmdRgbaToLinearFloatRgba(rgba) {
    return rgba.map((value, index) => {
        const channel = clampByte(value) / 255;
        if (index === 3) return channel;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
}
