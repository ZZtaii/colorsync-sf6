import assert from "node:assert/strict";

// Independent MDF fixture builder. Includes nonzero property flags, padding,
// hashes, a scalar, and out-of-order CustomizeColor indices, all kept on write.
export function makeMdf(materials = [{ name: "esf_Swimwear", colors: [
    { index: 2, values: [0.25, 0.5, 0.75, 0.4] },
    { index: 0, values: [0.1, 0.2, 0.3, 0.6] },
] }], version = 40) {
    const headerSize = version >= 51 ? 108 : version >= 31 ? 100 : version >= 19 ? 80 : 64;
    const buffer = new ArrayBuffer(8192);
    const view = new DataView(buffer);
    new Uint8Array(buffer).fill(0xAD);
    view.setUint32(0, 0x0046444D, true);
    view.setUint16(4, 1, true);
    view.setUint16(6, materials.length, true);
    let cursor = 16 + headerSize * materials.length;
    const string = value => {
        const offset = cursor;
        for (const char of value) {
            view.setUint16(cursor, char.charCodeAt(0), true);
            cursor += 2;
        }
        view.setUint16(cursor, 0, true);
        cursor += 2;
        return offset;
    };
    for (const [materialIndex, material] of materials.entries()) {
        let position = 16 + materialIndex * headerSize;
        const put32 = value => { view.setUint32(position, value, true); position += 4; };
        const put64 = value => { view.setBigUint64(position, BigInt(value), true); position += 8; };
        const nameOffset = string(material.name);
        const params = material.colors.map(color => ({ name: `CustomizeColor_${color.index}`, values: color.values }));
        params.push({ name: "SyntheticScalar", values: [0.8125] });
        const parameterNames = params.map(parameter => string(parameter.name));
        cursor = Math.ceil(cursor / 16) * 16;
        const tableOffset = cursor;
        cursor += params.length * 24;
        const dataOffset = cursor;
        const dataSize = params.reduce((size, parameter) => size + parameter.values.length * 4 + 12, 8);
        cursor += dataSize;
        put64(nameOffset);
        put32(0xABCD1234);
        put32(dataSize);
        put32(params.length);
        put32(0);
        if (version >= 19) { put32(0); put32(0); }
        if (version >= 31) put32(0);
        put32(7);
        put32(0x1D0E0F00);
        if (version >= 31) { put32(0x55667788); put32(0); }
        if (version >= 51) put64(0);
        put64(tableOffset);
        put64(0);
        if (version >= 19) put64(0);
        put64(dataOffset);
        put64(0);
        if (version >= 31) put64(0);
        assert.equal(position, 16 + (materialIndex + 1) * headerSize);
        let relativeDataOffset = 8;
        for (const [index, parameter] of params.entries()) {
            const entryOffset = tableOffset + index * 24;
            view.setBigUint64(entryOffset, BigInt(parameterNames[index]), true);
            view.setUint32(entryOffset + 8, 0x12345678, true);
            view.setUint32(entryOffset + 12, 0x87654321, true);
            if (version >= 13) {
                view.setInt32(entryOffset + 16, relativeDataOffset, true);
                view.setUint16(entryOffset + 20, parameter.values.length, true);
                view.setUint16(entryOffset + 22, 0xA17, true);
            } else {
                view.setUint32(entryOffset + 16, parameter.values.length, true);
                view.setInt32(entryOffset + 20, relativeDataOffset, true);
            }
            for (const [component, value] of parameter.values.entries()) {
                view.setFloat32(dataOffset + relativeDataOffset + component * 4, value, true);
            }
            relativeDataOffset += parameter.values.length * 4 + 12;
        }
    }
    return buffer.slice(0, cursor + 16);
}
