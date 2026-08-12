const MDF_MAGIC = 0x0046444D;
const MDF_NAME_RE = /\.mdf2\.(?<version>\d+)$/i;
const CUSTOMIZE_COLOR_RE = /^CustomizeColor_(?<index>\d+)$/i;


function clampByte(value) {
    return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}


function linearChannelToSrgbByte(value) {
    const linear = Math.max(0, Math.min(1, Number(value) || 0));
    const srgb = linear <= 0.0031308
        ? linear * 12.92
        : (1.055 * (linear ** (1 / 2.4))) - 0.055;
    return clampByte(srgb * 255);
}


function assertRange(view, offset, byteLength, label) {
    if (
        !Number.isInteger(offset)
        || !Number.isInteger(byteLength)
        || offset < 0
        || byteLength < 0
        || offset + byteLength > view.byteLength
    ) {
        throw new RangeError(`${label} points outside the MDF file.`);
    }
}


function safeOffset(value, label) {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RangeError(`${label} is outside the supported MDF offset range.`);
    }
    return Number(value);
}


function readUtf16String(view, offset, label) {
    if (offset === 0) return "";
    assertRange(view, offset, 2, label);
    const units = [];
    for (let position = offset; position + 2 <= view.byteLength; position += 2) {
        const unit = view.getUint16(position, true);
        if (unit === 0) return String.fromCharCode(...units);
        units.push(unit);
    }
    throw new RangeError(`${label} is not null-terminated inside the MDF file.`);
}


function readMaterialHeader(view, start, version, index) {
    let position = start;
    const take32 = label => {
        assertRange(view, position, 4, label);
        const value = view.getInt32(position, true);
        position += 4;
        return value;
    };
    const take64 = label => {
        assertRange(view, position, 8, label);
        const value = safeOffset(view.getBigInt64(position, true), label);
        position += 8;
        return value;
    };
    const skip = (byteLength, label) => {
        assertRange(view, position, byteLength, label);
        position += byteLength;
    };

    const prefix = `MDF material ${index}`;
    const nameOffset = take64(`${prefix} name`);
    skip(4, `${prefix} name hash`);
    if (version === 6) skip(8, `${prefix} version-6 field`);
    const parameterDataSize = take32(`${prefix} parameter data size`);
    const parameterCount = take32(`${prefix} parameter count`);
    take32(`${prefix} texture count`);
    if (version >= 19) skip(8, `${prefix} GPU buffer counts`);
    if (version >= 31) skip(4, `${prefix} bake texture array size`);
    skip(4, `${prefix} shader type`);
    if (version >= 31) {
        skip(8, `${prefix} material flags`);
        if (version >= 51) skip(8, `${prefix} version-51 field`);
        skip(4, `${prefix} shader LOD count`);
    } else {
        skip(4, `${prefix} material flags`);
    }
    const parameterHeaderOffset = take64(`${prefix} parameter table`);
    take64(`${prefix} texture table`);
    if (version >= 19) take64(`${prefix} GPU buffer table`);
    const parameterDataOffset = take64(`${prefix} parameter data`);
    take64(`${prefix} MMTR path`);
    if (version >= 31) take64(`${prefix} shader LOD redirects`);

    if (parameterCount < 0 || parameterCount > 100_000) {
        throw new RangeError(`${prefix} has an invalid parameter count.`);
    }
    return {
        nextOffset: position,
        nameOffset,
        parameterCount,
        parameterHeaderOffset,
        parameterDataOffset,
        parameterDataSize,
    };
}


export function parseMdfMaterialNames(buffer, filename) {
    const match = MDF_NAME_RE.exec(String(filename ?? ""));
    if (!match) throw new Error("MDF filename must end in .mdf2.<version>.");
    if (!(buffer instanceof ArrayBuffer)) {
        throw new TypeError("parseMdfMaterialNames expects an ArrayBuffer.");
    }
    const version = Number(match.groups.version);
    const view = new DataView(buffer);
    assertRange(view, 0, 16, "MDF header");
    if (view.getUint32(0, true) !== MDF_MAGIC) throw new Error("Not an MDF file.");
    const materialCount = view.getInt16(6, true);
    if (materialCount < 0 || materialCount > 10_000) {
        throw new RangeError("MDF material count is invalid.");
    }

    const headers = [];
    let position = 16;
    for (let index = 0; index < materialCount; index += 1) {
        const header = readMaterialHeader(view, position, version, index);
        headers.push(header);
        position = header.nextOffset;
    }

    return headers.map((header, materialIndex) => {
        const parameters = [];
        for (let index = 0; index < header.parameterCount; index += 1) {
            const entryOffset = header.parameterHeaderOffset + (index * 24);
            assertRange(view, entryOffset, 24, `MDF material ${materialIndex} parameter ${index}`);
            const nameOffset = safeOffset(
                view.getBigInt64(entryOffset, true),
                `MDF material ${materialIndex} parameter ${index} name`,
            );
            const name = readUtf16String(
                view,
                nameOffset,
                `MDF material ${materialIndex} parameter ${index} name`,
            );
            const relativeDataOffset = view.getUint32(entryOffset + 16, true);
            const componentCount = view.getUint32(entryOffset + 20, true);
            const dataOffset = header.parameterDataOffset + relativeDataOffset;
            const dataByteLength = componentCount * 4;
            assertRange(view, dataOffset, dataByteLength, `MDF material ${materialIndex} parameter ${index} data`);
            if (relativeDataOffset + dataByteLength > header.parameterDataSize) {
                throw new RangeError(`MDF material ${materialIndex} parameter ${index} exceeds its parameter data block.`);
            }
            parameters.push({ name, componentCount, dataOffset });
        }
        const customizeColors = parameters.flatMap(parameter => {
            const colorMatch = CUSTOMIZE_COLOR_RE.exec(parameter.name);
            if (!colorMatch || parameter.componentCount < 3) return [];
            const index = Number(colorMatch.groups.index);
            if (!Number.isInteger(index)) return [];
            const linearRgba = [0, 1, 2].map(component => (
                view.getFloat32(parameter.dataOffset + (component * 4), true)
            ));
            linearRgba.push(parameter.componentCount >= 4
                ? view.getFloat32(parameter.dataOffset + 12, true)
                : 1);
            const cmdRgba = [
                linearChannelToSrgbByte(linearRgba[0]),
                linearChannelToSrgbByte(linearRgba[1]),
                linearChannelToSrgbByte(linearRgba[2]),
                clampByte(Math.max(0, Math.min(1, linearRgba[3])) * 255),
            ];
            return [{ index, linearRgba, cmdRgba }];
        }).sort((a, b) => a.index - b.index);
        return {
            name: readUtf16String(view, header.nameOffset, `MDF material ${materialIndex} name`),
            materialIndex,
            customizeColorIndexes: [...new Set(customizeColors.map(color => color.index))],
            customizeColors,
        };
    });
}


export function isMdfFilename(filename) {
    return MDF_NAME_RE.test(String(filename ?? ""));
}
