// Read-only RE Engine PAK reader (KPKA v4, unencrypted table), for pulling single files out of the
// user's own game install. Nothing is uploaded: only the byte ranges of the requested files are read.
//
// A PAK has no file names. Each entry is keyed by two MurmurHash3 values of the file's path
// (lower-cased and upper-cased, UTF-16LE, seed 0xFFFFFFFF), so a file is found by hashing the path
// we already know we want.
import { inflateSync } from './fflate.js';
import { decompressZstd } from './zstd-decoder.js';

const MAGIC = 0x414B504B; // "KPKA"
const HEADER_BYTES = 16, ENTRY_BYTES = 48;
const MAX_ENTRIES = 4_000_000, MAX_FILE_BYTES = 512 * 1024 * 1024;
const COMPRESSION = { 0: 'none', 1: 'deflate', 2: 'zstd' };

export function murmur3Utf16(text, seed = 0xFFFFFFFF) {
    let h = seed >>> 0;
    const length = text.length * 2;
    const byteAt = i => { const unit = text.charCodeAt(i >> 1); return i & 1 ? unit >>> 8 : unit & 255; };
    const blocks = length & ~3;
    for (let i = 0; i < blocks; i += 4) {
        let k = byteAt(i) | byteAt(i + 1) << 8 | byteAt(i + 2) << 16 | byteAt(i + 3) << 24;
        k = Math.imul(k, 0xcc9e2d51); k = k << 15 | k >>> 17; k = Math.imul(k, 0x1b873593);
        h ^= k; h = h << 13 | h >>> 19; h = Math.imul(h, 5) + 0xe6546b64 | 0;
    }
    let k = 0;
    switch (length & 3) {
        case 3: k ^= byteAt(blocks + 2) << 16; // falls through
        case 2: k ^= byteAt(blocks + 1) << 8; // falls through
        case 1: k ^= byteAt(blocks);
            k = Math.imul(k, 0xcc9e2d51); k = k << 15 | k >>> 17; k = Math.imul(k, 0x1b873593); h ^= k;
    }
    h ^= length;
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
}

export function normalizePakPath(path) { return String(path).replace(/\\/g, '/').replace(/^\/+/, ''); }
export function pakPathHashes(path) {
    const clean = normalizePakPath(path);
    return { lower: murmur3Utf16(clean.toLowerCase()), upper: murmur3Utf16(clean.toUpperCase()) };
}

/** Byte source over a browser File/Blob. Works on files far larger than memory. */
export function fileSource(file) {
    return { name: file.name, size: file.size, read: async (offset, length) => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()) };
}

/**
 * Opens a PAK. `source` is { size, read(offset, length) -> Promise<Uint8Array>, name? }.
 * Returns { name, fileCount, find(path), has(path), read(path) }. `read` resolves to the unpacked
 * bytes, or null when the path is not in this PAK.
 */
export async function openPak(source) {
    if (!source || typeof source.read !== 'function' || !Number.isFinite(source.size)) throw new Error('A readable PAK source is required.');
    if (source.size < HEADER_BYTES) throw new Error('This file is too small to be a PAK.');
    const header = await source.read(0, HEADER_BYTES);
    const head = new DataView(header.buffer, header.byteOffset, header.byteLength);
    if (head.getUint32(0, true) !== MAGIC) throw new Error('Not an RE Engine PAK file (missing KPKA header).');
    const major = head.getUint8(4), minor = head.getUint8(5), features = head.getUint16(6, true), fileCount = head.getUint32(8, true);
    if (major !== 4) throw new Error(`Unsupported PAK version ${major}.${minor}.`);
    if (features !== 0) throw new Error('This PAK has an encrypted or extended file table, which is not supported.');
    if (fileCount > MAX_ENTRIES || HEADER_BYTES + fileCount * ENTRY_BYTES > source.size) throw new Error('The PAK file table is damaged or truncated.');

    const table = await source.read(HEADER_BYTES, fileCount * ENTRY_BYTES);
    if (table.byteLength !== fileCount * ENTRY_BYTES) throw new Error('The PAK file table could not be read completely.');
    const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
    // lower hash -> entry index (or indices when two entries share a lower hash).
    const index = new Map();
    for (let i = 0; i < fileCount; i++) {
        const lower = view.getUint32(i * ENTRY_BYTES, true), seen = index.get(lower);
        if (seen === undefined) index.set(lower, i);
        else if (typeof seen === 'number') index.set(lower, [seen, i]);
        else seen.push(i);
    }
    const entryAt = i => {
        const at = i * ENTRY_BYTES, flags = view.getBigUint64(at + 32, true);
        return {
            lower: view.getUint32(at, true), upper: view.getUint32(at + 4, true),
            offset: Number(view.getBigUint64(at + 8, true)), compressedSize: Number(view.getBigUint64(at + 16, true)),
            size: Number(view.getBigUint64(at + 24, true)),
            compression: COMPRESSION[Number(flags & 0xFn)] ?? 'unknown', encryption: Number((flags >> 16n) & 0xFFn),
        };
    };
    function find(path) {
        const { lower, upper } = pakPathHashes(path), hit = index.get(lower);
        if (hit === undefined) return null;
        for (const i of typeof hit === 'number' ? [hit] : hit) { const entry = entryAt(i); if (entry.upper === upper) return entry; }
        return null;
    }
    /** Reads and unpacks one table entry. `label` only names the file in error messages. */
    async function readEntry(entry, label = 'file') {
        if (entry.encryption) throw new Error(`${label} is stored encrypted in the PAK, which is not supported.`);
        if (entry.size > MAX_FILE_BYTES || entry.compressedSize > MAX_FILE_BYTES || entry.offset + entry.compressedSize > source.size) throw new Error(`${label} has an invalid size or position in the PAK.`);
        const raw = await source.read(entry.offset, entry.compressedSize);
        if (raw.byteLength !== entry.compressedSize) throw new Error(`${label} could not be read completely.`);
        let out;
        if (entry.compression === 'none') out = raw;
        else if (entry.compression === 'deflate') out = inflateSync(raw, { out: new Uint8Array(entry.size) });
        else if (entry.compression === 'zstd') out = decompressZstd(raw, entry.size);
        else throw new Error(`${label} uses an unknown compression type.`);
        if (out.byteLength !== entry.size) throw new Error(`${label} unpacked to an unexpected size.`);
        return out;
    }
    async function read(path) {
        const entry = find(path);
        return entry ? readEntry(entry, normalizePakPath(path).split('/').pop()) : null;
    }
    return { name: source.name ?? 'pak', version: `${major}.${minor}`, fileCount, find, has: path => find(path) !== null, read, readEntry, entryAt, source };
}
