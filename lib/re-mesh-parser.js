// Browser-only, read-only SF6 geometry decoder. Format reference: REasy v0.7.9
// (MIT), file_handlers/mesh/mesh_file.py and profiles/sf6_profile.py.
// See THIRD_PARTY_NOTICES.md. No REasy installation or game assets are included.
export function binaryView(input, label = 'asset') {
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) :
        ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null;
    if (!bytes) throw new TypeError(`${label}: expected an ArrayBuffer or typed array`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const check = (offset, size) => {
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset > bytes.length - size)
            throw new Error(`${label}: invalid or truncated byte range ${offset}+${size}`);
        return offset;
    };
    return {bytes, check, u8: p => view.getUint8(check(p, 1)), i8: p => view.getInt8(check(p, 1)),
        u16: p => view.getUint16(check(p, 2), true), u32: p => view.getUint32(check(p, 4), true),
        f32: p => view.getFloat32(check(p, 4), true),
        ptr: p => { const n = view.getBigUint64(check(p, 8), true); if (n > BigInt(bytes.length)) throw new Error(`${label}: pointer outside file`); return Number(n); }};
}
export function halfToFloat(bits) {
    const sign = bits & 0x8000 ? -1 : 1, exponent = (bits >>> 10) & 31, fraction = bits & 1023;
    return sign * (exponent === 31 ? (fraction ? NaN : Infinity) : exponent ? (1 + fraction / 1024) * 2 ** (exponent - 15) : fraction * 2 ** -24);
}
export function parseReMesh(input) {
    const r = binaryView(input, 'MESH'); r.check(0, 168);
    if (r.u32(0) !== 0x4853454d) throw new Error('Not a MESH file (MPLY meshlets are unsupported)');
    const version = r.u32(4);
    if (![220705151, 230403828].includes(version)) throw new Error(`Unsupported SF6 MESH internal version ${version}`);
    const main = r.ptr(32), buffer = r.ptr(72), materialTable = r.ptr(112), namesTable = r.ptr(144);
    if (!main || !buffer || !materialTable || !namesTable) throw new Error('MESH is missing required resident geometry tables');
    r.check(main, 64); r.check(buffer, 36);
    const lodCount = r.u8(main), materialCount = r.u8(main + 1), nameCount = r.u16(20);
    if (!lodCount || !materialCount || !nameCount) throw new Error('MESH contains no drawable LOD/material names');
    r.check(namesTable, nameCount * 8); r.check(materialTable, materialCount * 2);
    const decoder = new TextDecoder('utf-8', {fatal: true});
    const materialNames = Array.from({length: materialCount}, (_, i) => {
        const index = r.u16(materialTable + i * 2);
        if (index >= nameCount) throw new Error('MESH material name index is out of bounds');
        const start = r.ptr(namesTable + index * 8); if (!start) throw new Error('MESH material name pointer is null'); r.check(start, 1);
        let end = start; while (end < r.bytes.length && r.bytes[end] && end - start < 4096) end++;
        if (end === r.bytes.length || end - start === 4096) throw new Error('MESH material name is unterminated or too long');
        return decoder.decode(r.bytes.subarray(start, end));
    });
    const elements = r.ptr(buffer), vertices = r.ptr(buffer + 8), totalSize = r.u32(buffer + 24), vertexSize = r.u32(buffer + 28), elementCount = r.u16(buffer + 32);
    if (vertexSize > totalSize || !elementCount || elementCount > 32) throw new Error('Invalid MESH buffer layout');
    r.check(vertices, totalSize); r.check(elements, elementCount * 8);
    const streams = new Map();
    for (let i = 0; i < elementCount; i++) {
        const p = elements + i * 8, type = r.u16(p), stride = r.u16(p + 2), offset = r.u32(p + 4);
        if (!stride || offset > vertexSize || streams.has(type)) throw new Error('Invalid or duplicate MESH vertex stream');
        streams.set(type, {stride, offset});
    }
    for (const stream of streams.values()) stream.end = Math.min(vertexSize, ...[...streams.values()].filter(other => other.offset > stream.offset).map(other => other.offset));
    if (!streams.has(0)) throw new Error('MESH has no position stream');
    const lodTable = r.ptr(main + 56); r.check(lodTable, lodCount * 8);
    const lod = r.ptr(lodTable); if (!lod) throw new Error('MESH LOD0 is absent'); r.check(lod, 16);
    const groupCount = r.u8(lod), groups = r.ptr(lod + 8); r.check(groups, groupCount * 8);
    const parts = [], bounds = {min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity]};
    const indexSize = r.u8(main + 6) ? 4 : 2, indexBase = vertices + vertexSize;
    let groupVertexBase = 0, decodedVertices = 0, decodedIndices = 0;
    for (let gi = 0; gi < groupCount; gi++) {
        const group = r.ptr(groups + gi * 8); if (!group) continue; r.check(group, 16);
        const count = r.u8(group + 1), groupVertices = r.u32(group + 8); r.check(group + 16, count * 24);
        const groupEnd = groupVertexBase + groupVertices;
        for (let si = 0; si < count; si++) {
            const p = group + 16 + si * 24, materialIndex = r.u8(p), vertexStart = r.u32(p + 12);
            const vertexEnd = si + 1 < count ? r.u32(p + 36) : groupEnd, n = vertexEnd - vertexStart;
            const indexCount = r.u32(p + 4), faceStart = r.u32(p + 8);
            if (r.u8(p + 2)) throw new Error('This MESH needs an external streaming geometry buffer; resident-only preview is unsupported');
            if (r.u8(p + 1)) throw new Error('Quad MESH topology is unsupported');
            if (materialIndex >= materialCount || n < 0 || vertexStart < groupVertexBase || vertexEnd > groupEnd || indexCount % 3) throw new Error('Invalid MESH submesh range/material/topology');
            decodedVertices += n; decodedIndices += indexCount;
            if (decodedVertices > 4000000 || decodedIndices > 24000000) throw new Error('MESH exceeds browser preview geometry limits');
            const readAttribute = (type, components, width, read) => {
                const stream = streams.get(type); if (!stream) return null;
                if (stream.stride < components * width || stream.offset + vertexEnd * stream.stride > stream.end) throw new Error('MESH attribute exceeds vertex buffer');
                const output = new Float32Array(n * components);
                for (let i = 0; i < n; i++) for (let c = 0; c < components; c++) {
                    const value = read(vertices + stream.offset + (vertexStart + i) * stream.stride + c * width);
                    if (!Number.isFinite(value)) throw new Error('MESH attribute contains a non-finite value');
                    output[i * components + c] = value;
                }
                return output;
            };
            const positions = readAttribute(0, 3, 4, r.f32), normals = readAttribute(1, 3, 1, p => Math.max(-1, r.i8(p) / 127)), uvs = readAttribute(2, 2, 2, p => halfToFloat(r.u16(p)));
            if ((faceStart + indexCount) * indexSize > totalSize - vertexSize) throw new Error('MESH indices exceed index buffer');
            const indices = indexSize === 4 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
            for (let i = 0; i < indexCount; i++) { const value = indexSize === 4 ? r.u32(indexBase + (faceStart + i) * 4) : r.u16(indexBase + (faceStart + i) * 2); if (value >= n) throw new Error('MESH index references a missing vertex'); indices[i] = value; }
            for (let i = 0; i < positions.length; i++) { const c = i % 3; bounds.min[c] = Math.min(bounds.min[c], positions[i]); bounds.max[c] = Math.max(bounds.max[c], positions[i]); }
            if (indexCount) parts.push({materialIndex, materialName: materialNames[materialIndex], groupId: r.u8(group), positions, normals, uvs, indices});
        }
        groupVertexBase = groupEnd;
    }
    if (!parts.length) throw new Error('MESH LOD0 has no triangles');
    return {version, parts, materialNames, bounds, warnings: ['Static LOD0 bind-pose preview; skinning, animation, blend shapes and runtime normal recalculation are not applied.']};
}
