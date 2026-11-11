// Minimal MDF (version 31) with one material, no parameters and the given texture bindings.
export function makeMdfWithTextures(name, textures, mmtrPath = 'Product/MasterMaterial/Character/Test.mmtrs') {
    const HEADER = 100, buffer = new ArrayBuffer(4096), view = new DataView(buffer);
    view.setUint32(0, 0x0046444D, true); view.setUint16(4, 1, true); view.setUint16(6, 1, true);
    let cursor = 16 + HEADER;
    const string = value => { const at = cursor; for (const ch of value) { view.setUint16(cursor, ch.charCodeAt(0), true); cursor += 2; } cursor += 2; return at; };
    const nameAt = string(name), mmtrAt = string(mmtrPath);
    const slotAt = textures.map(([slot]) => string(slot)), pathAt = textures.map(([, path]) => string(path));
    cursor = Math.ceil(cursor / 16) * 16;
    const tableAt = cursor;
    textures.forEach((_, i) => { view.setBigUint64(tableAt + i * 32, BigInt(slotAt[i]), true); view.setBigUint64(tableAt + i * 32 + 16, BigInt(pathAt[i]), true); });
    cursor += textures.length * 32;
    const dataAt = cursor;
    let p = 16;
    const put32 = v => { view.setUint32(p, v, true); p += 4; }, put64 = v => { view.setBigUint64(p, BigInt(v), true); p += 8; };
    put64(nameAt); put32(0); put32(0); put32(0); put32(textures.length); put32(0); put32(0); put32(0); put32(0);
    put32(0); put32(0); put32(0);
    put64(dataAt); put64(tableAt); put64(0); put64(dataAt); put64(mmtrAt); put64(0);
    if (p !== 16 + HEADER) throw new Error('fixture header size');
    return new Uint8Array(buffer.slice(0, cursor + 16));
}
