// Small Zstandard decompressor (RFC 8878), written for reading files out of RE Engine PAKs in the
// browser, where no native zstd is available. Decode only, no dictionaries, checksums not verified.
// Checked against Node's built-in zstd on real game files (tools/zstd-check.mjs).
const POW2 = Array.from({ length: 54 }, (_, i) => 2 ** i);
const fail = message => { throw new Error(`Invalid zstd data: ${message}`); };
const highBit = v => 31 - Math.clz32(v);

/** Reads n bits (n <= 40) at absolute bit position `pos` of a little-endian bit field. Bits below 0 read as zero. */
function bitsAt(src, start, pos, n) {
    if (n === 0) return 0;
    let low = 0;
    if (pos < 0) { if (-pos >= n) return 0; low = -pos; n -= low; pos = 0; }
    const byte = start + (pos >>> 3), shift = pos & 7, need = shift + n;
    let v = src[byte] || 0;
    if (need > 8) v += (src[byte + 1] || 0) * 256;
    if (need > 16) v += (src[byte + 2] || 0) * 65536;
    if (need > 24) v += (src[byte + 3] || 0) * 16777216;
    if (need > 32) v += (src[byte + 4] || 0) * 4294967296;
    if (need > 40) v += (src[byte + 5] || 0) * 1099511627776;
    v = Math.floor(v / (1 << shift)) % POW2[n];
    return low ? v * POW2[low] : v;
}
/** Backward bitstream: starts just below the highest set bit of the last byte and reads toward the start. */
function backwardReader(src, start, end) {
    if (end <= start) fail('empty bitstream');
    const last = src[end - 1];
    if (!last) fail('bitstream has no end marker');
    const reader = { pos: (end - 1 - start) * 8 + highBit(last), read(n) { reader.pos -= n; return bitsAt(src, start, reader.pos, n); } };
    return reader;
}

// ---- FSE ---------------------------------------------------------------------------------
function buildFseTable(frequencies, accuracyLog) {
    const size = 1 << accuracyLog, symbols = new Uint8Array(size), numBits = new Uint8Array(size), base = new Uint16Array(size);
    const next = new Uint16Array(frequencies.length);
    let high = size;
    for (let s = 0; s < frequencies.length; s++) if (frequencies[s] === -1) { symbols[--high] = s; next[s] = 1; }
    const step = (size >> 1) + (size >> 3) + 3, mask = size - 1;
    let pos = 0;
    for (let s = 0; s < frequencies.length; s++) {
        if (frequencies[s] <= 0) continue;
        next[s] = frequencies[s];
        for (let i = 0; i < frequencies[s]; i++) {
            symbols[pos] = s;
            do { pos = (pos + step) & mask; } while (pos >= high);
        }
    }
    if (pos !== 0) fail('FSE table does not fill');
    for (let i = 0; i < size; i++) {
        const state = next[symbols[i]]++;
        numBits[i] = accuracyLog - highBit(state);
        base[i] = (state << numBits[i]) - size;
    }
    return { accuracyLog, symbols, numBits, base };
}
/** Reads an FSE table description at byte `at`. Returns the table and the byte position after it. */
function readFseTable(src, at, end, maxAccuracyLog, maxSymbols) {
    let bit = 0;
    const read = n => { const v = bitsAt(src, at, bit, n); bit += n; return v; };
    const accuracyLog = 5 + read(4);
    if (accuracyLog > maxAccuracyLog) fail('FSE accuracy log too large');
    let remaining = 1 << accuracyLog, symbol = 0;
    const frequencies = new Int16Array(maxSymbols + 1);
    while (remaining > 0 && symbol <= maxSymbols) {
        const bits = highBit(remaining + 1) + 1;
        let value = read(bits);
        const lowerMask = (1 << (bits - 1)) - 1, threshold = (1 << bits) - 1 - (remaining + 1);
        if ((value & lowerMask) < threshold) { bit--; value &= lowerMask; }
        else if (value > lowerMask) value -= threshold;
        const probability = value - 1;
        remaining -= Math.abs(probability);
        frequencies[symbol++] = probability;
        if (probability === 0) {
            let repeat = read(2);
            for (;;) {
                for (let i = 0; i < repeat && symbol <= maxSymbols; i++) frequencies[symbol++] = 0;
                if (repeat === 3) repeat = read(2); else break;
            }
        }
    }
    if (remaining !== 0 || symbol > maxSymbols + 1) fail('FSE distribution is inconsistent');
    const next = at + ((bit + 7) >>> 3);
    if (next > end) fail('FSE table runs past its block');
    return { table: buildFseTable(frequencies.subarray(0, symbol), accuracyLog), next };
}
const rleTable = symbol => ({ accuracyLog: 0, symbols: Uint8Array.of(symbol), numBits: Uint8Array.of(0), base: Uint16Array.of(0) });

// ---- Huffman literals --------------------------------------------------------------------
function readHuffmanTable(src, at, end) {
    const header = src[at++];
    const weights = new Uint8Array(256);
    let count = 0;
    if (header >= 128) {
        count = header - 127;
        const bytes = (count + 1) >>> 1;
        if (at + bytes > end) fail('Huffman weights run past their block');
        for (let i = 0; i < count; i++) weights[i] = i & 1 ? src[at + (i >>> 1)] & 15 : src[at + (i >>> 1)] >>> 4;
        at += bytes;
    } else {
        const stop = at + header;
        if (stop > end) fail('Huffman weights run past their block');
        const { table, next } = readFseTable(src, at, stop, 6, 255);
        const reader = backwardReader(src, next, stop);
        let s1 = reader.read(table.accuracyLog), s2 = reader.read(table.accuracyLog);
        for (;;) {
            if (count > 254) fail('too many Huffman weights');
            weights[count++] = table.symbols[s1];
            s1 = table.base[s1] + reader.read(table.numBits[s1]);
            if (reader.pos < 0) { weights[count++] = table.symbols[s2]; break; }
            if (count > 254) fail('too many Huffman weights');
            weights[count++] = table.symbols[s2];
            s2 = table.base[s2] + reader.read(table.numBits[s2]);
            if (reader.pos < 0) { weights[count++] = table.symbols[s1]; break; }
        }
        at = stop;
    }
    let total = 0;
    for (let i = 0; i < count; i++) if (weights[i]) total += 1 << (weights[i] - 1);
    if (!total) fail('empty Huffman tree');
    const maxBits = highBit(total) + 1, left = (1 << maxBits) - total;
    if (maxBits > 11 || (left & (left - 1)) !== 0) fail('Huffman weights are inconsistent');
    weights[count++] = highBit(left) + 1;

    const size = 1 << maxBits, symbols = new Uint8Array(size), lengths = new Uint8Array(size);
    const rankStart = new Int32Array(maxBits + 2);
    // Longest codes sit at the start of the table; within one length, symbols go in ascending order.
    const perLength = new Int32Array(maxBits + 1);
    for (let i = 0; i < count; i++) if (weights[i]) perLength[maxBits + 1 - weights[i]]++;
    rankStart[maxBits] = 0;
    for (let bits = maxBits; bits >= 1; bits--) rankStart[bits - 1] = rankStart[bits] + perLength[bits] * (1 << (maxBits - bits));
    if (rankStart[0] !== size) fail('Huffman table does not fill');
    for (let i = 0; i < count; i++) {
        if (!weights[i]) continue;
        const bits = maxBits + 1 - weights[i], span = 1 << (maxBits - bits), from = rankStart[bits];
        symbols.fill(i, from, from + span); lengths.fill(bits, from, from + span);
        rankStart[bits] += span;
    }
    return { table: { maxBits, symbols, lengths }, next: at };
}
function decodeHuffmanStream(src, start, end, out, outPos, count, table) {
    if (end <= start) fail('empty Huffman stream');
    const last = src[end - 1];
    if (!last) fail('Huffman stream has no end marker');
    const { maxBits, symbols, lengths } = table, mask = (1 << maxBits) - 1;
    let bitCount = highBit(last), buffer = last & ((1 << bitCount) - 1), bytePos = end - 2;
    const stop = outPos + count;
    while (outPos < stop) {
        while (bitCount <= 24 && bytePos >= start) { buffer = (buffer << 8) | src[bytePos--]; bitCount += 8; }
        const index = bitCount >= maxBits ? (buffer >>> (bitCount - maxBits)) & mask : (buffer << (maxBits - bitCount)) & mask;
        out[outPos++] = symbols[index];
        bitCount -= lengths[index];
        if (bitCount < 0) fail('Huffman stream ends early');
        if (bitCount < 32) buffer &= (1 << bitCount) - 1;
    }
    if (bitCount !== 0 || bytePos >= start) fail('Huffman stream has leftover data');
}

// ---- Sequences ---------------------------------------------------------------------------
const LL_BASE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 40, 48, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536];
const LL_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const ML_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 37, 39, 41, 43, 47, 51, 59, 67, 83, 99, 131, 259, 515, 1027, 2051, 4099, 8195, 16387, 32771, 65539];
const ML_BITS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const DEFAULT_LL = buildFseTable(Int16Array.of(4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1), 6);
const DEFAULT_ML = buildFseTable(Int16Array.of(1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1, -1, -1), 6);
const DEFAULT_OF = buildFseTable(Int16Array.of(1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1), 5);
const SEQUENCE_TABLES = [
    { key: 'll', fallback: DEFAULT_LL, maxLog: 9, maxSymbol: 35 },
    { key: 'of', fallback: DEFAULT_OF, maxLog: 8, maxSymbol: 31 },
    { key: 'ml', fallback: DEFAULT_ML, maxLog: 9, maxSymbol: 52 },
];

function decodeBlock(src, at, end, out, outPos, frame) {
    // Literals section
    const b0 = src[at], type = b0 & 3, format = (b0 >> 2) & 3;
    let regenerated, compressed = 0, header, streams = 1;
    if (type < 2) {
        if (format === 1) { regenerated = (b0 >> 4) + (src[at + 1] << 4); header = 2; }
        else if (format === 3) { regenerated = (b0 >> 4) + (src[at + 1] << 4) + (src[at + 2] << 12); header = 3; }
        else { regenerated = b0 >> 3; header = 1; }
    } else {
        const bits = format <= 1 ? 10 : format === 2 ? 14 : 18;
        header = format <= 1 ? 3 : format === 2 ? 4 : 5;
        streams = format === 0 ? 1 : 4;
        regenerated = bitsAt(src, at, 4, bits); compressed = bitsAt(src, at, 4 + bits, bits);
    }
    at += header;
    if (regenerated > 131072 + 3) fail('literals section too large');
    let literals, literalPos = 0;
    if (type === 0) {
        if (at + regenerated > end) fail('raw literals run past their block');
        literals = src.subarray(at, at + regenerated); at += regenerated;
    } else if (type === 1) {
        if (at >= end) fail('RLE literals run past their block');
        literals = new Uint8Array(regenerated).fill(src[at]); at += 1;
    } else {
        const stop = at + compressed;
        if (stop > end) fail('compressed literals run past their block');
        if (type === 2) { const tree = readHuffmanTable(src, at, stop); frame.huffman = tree.table; at = tree.next; }
        else if (!frame.huffman) fail('treeless literals without a previous Huffman table');
        literals = new Uint8Array(regenerated);
        if (streams === 1) decodeHuffmanStream(src, at, stop, literals, 0, regenerated, frame.huffman);
        else {
            if (at + 6 > stop) fail('missing Huffman jump table');
            const s1 = src[at] | src[at + 1] << 8, s2 = src[at + 2] | src[at + 3] << 8, s3 = src[at + 4] | src[at + 5] << 8;
            const each = (regenerated + 3) >>> 2, first = at + 6;
            if (first + s1 + s2 + s3 > stop || each * 3 > regenerated) fail('Huffman jump table is inconsistent');
            decodeHuffmanStream(src, first, first + s1, literals, 0, each, frame.huffman);
            decodeHuffmanStream(src, first + s1, first + s1 + s2, literals, each, each, frame.huffman);
            decodeHuffmanStream(src, first + s1 + s2, first + s1 + s2 + s3, literals, each * 2, each, frame.huffman);
            decodeHuffmanStream(src, first + s1 + s2 + s3, stop, literals, each * 3, regenerated - each * 3, frame.huffman);
        }
        at = stop;
    }

    // Sequences section
    if (at >= end) fail('missing sequences section');
    let sequenceCount = src[at++];
    if (sequenceCount >= 128) {
        if (sequenceCount === 255) { sequenceCount = src[at] + (src[at + 1] << 8) + 0x7F00; at += 2; }
        else { sequenceCount = ((sequenceCount - 128) << 8) + src[at]; at += 1; }
    }
    if (sequenceCount > 0) {
        if (at >= end) fail('missing sequence modes');
        const modes = src[at++];
        SEQUENCE_TABLES.forEach((spec, i) => {
            const mode = (modes >> (6 - i * 2)) & 3;
            if (mode === 0) frame[spec.key] = spec.fallback;
            else if (mode === 1) { if (at >= end) fail('missing RLE symbol'); frame[spec.key] = rleTable(src[at++]); }
            else if (mode === 2) { const parsed = readFseTable(src, at, end, spec.maxLog, spec.maxSymbol); frame[spec.key] = parsed.table; at = parsed.next; }
            else if (!frame[spec.key]) fail('repeat mode without a previous table');
        });
        const { ll, of, ml } = frame, rep = frame.rep, reader = backwardReader(src, at, end), limit = out.length;
        let llState = reader.read(ll.accuracyLog), ofState = reader.read(of.accuracyLog), mlState = reader.read(ml.accuracyLog);
        for (let i = 0; i < sequenceCount; i++) {
            const ofCode = of.symbols[ofState], mlCode = ml.symbols[mlState], llCode = ll.symbols[llState];
            if (ofCode > 31 || mlCode > 52 || llCode > 35) fail('sequence code out of range');
            const offsetValue = POW2[ofCode] + reader.read(ofCode);
            const matchLength = ML_BASE[mlCode] + reader.read(ML_BITS[mlCode]);
            const literalLength = LL_BASE[llCode] + reader.read(LL_BITS[llCode]);
            let offset;
            if (offsetValue > 3) { offset = offsetValue - 3; rep[2] = rep[1]; rep[1] = rep[0]; rep[0] = offset; }
            else {
                const index = offsetValue - 1 + (literalLength === 0 ? 1 : 0);
                if (index === 0) offset = rep[0];
                else {
                    offset = index < 3 ? rep[index] : rep[0] - 1;
                    if (index > 1) rep[2] = rep[1];
                    rep[1] = rep[0]; rep[0] = offset;
                }
            }
            if (i + 1 < sequenceCount) {
                llState = ll.base[llState] + reader.read(ll.numBits[llState]);
                mlState = ml.base[mlState] + reader.read(ml.numBits[mlState]);
                ofState = of.base[ofState] + reader.read(of.numBits[ofState]);
            }
            if (literalPos + literalLength > literals.length || outPos + literalLength + matchLength > limit) fail('sequence overruns its buffers');
            out.set(literals.subarray(literalPos, literalPos + literalLength), outPos);
            literalPos += literalLength; outPos += literalLength;
            if (offset <= 0 || offset > outPos) fail('match offset points before the start');
            let from = outPos - offset;
            if (offset >= matchLength) { out.copyWithin(outPos, from, from + matchLength); outPos += matchLength; }
            else for (let k = 0; k < matchLength; k++) out[outPos++] = out[from++];
        }
        if (reader.pos !== 0) fail('sequence bitstream has leftover data');
    }
    const rest = literals.length - literalPos;
    if (outPos + rest > out.length) fail('output is larger than expected');
    out.set(literals.subarray(literalPos), outPos);
    return outPos + rest;
}

/**
 * Decompresses zstd `input` (one or more frames). `expectedSize` is required: PAK entries always
 * carry the unpacked size, and it bounds every write.
 */
export function decompressZstd(input, expectedSize) {
    if (!(input instanceof Uint8Array)) throw new TypeError('zstd input must be a Uint8Array.');
    if (!Number.isInteger(expectedSize) || expectedSize < 0) throw new TypeError('The unpacked size is required.');
    const out = new Uint8Array(expectedSize);
    let at = 0, outPos = 0;
    while (at < input.length) {
        if (at + 4 > input.length) fail('truncated frame');
        const magic = (input[at] | input[at + 1] << 8 | input[at + 2] << 16 | input[at + 3] << 24) >>> 0;
        at += 4;
        if ((magic & 0xFFFFFFF0) === 0x184D2A50) { // skippable frame
            if (at + 4 > input.length) fail('truncated skippable frame');
            at += 4 + ((input[at] | input[at + 1] << 8 | input[at + 2] << 16 | input[at + 3] << 24) >>> 0);
            continue;
        }
        if (magic !== 0xFD2FB528) fail('missing frame magic');
        const descriptor = input[at++], singleSegment = (descriptor >> 5) & 1, checksum = (descriptor >> 2) & 1, dictionaryFlag = descriptor & 3, sizeFlag = descriptor >> 6;
        if (descriptor & 8) fail('reserved frame bit set');
        if (!singleSegment) at += 1; // window descriptor: the whole output is kept, so it is not needed
        const dictionaryBytes = [0, 1, 2, 4][dictionaryFlag];
        for (let i = 0; i < dictionaryBytes; i++) if (input[at + i]) fail('dictionaries are not supported');
        at += dictionaryBytes;
        at += sizeFlag === 0 ? singleSegment : sizeFlag === 1 ? 2 : sizeFlag === 2 ? 4 : 8;
        const frame = { rep: [1, 4, 8], huffman: null, ll: null, of: null, ml: null };
        for (;;) {
            if (at + 3 > input.length) fail('truncated block header');
            const header = input[at] | input[at + 1] << 8 | input[at + 2] << 16, last = header & 1, type = (header >> 1) & 3, size = header >>> 3;
            at += 3;
            if (type === 0) {
                if (at + size > input.length || outPos + size > expectedSize) fail('raw block overruns');
                out.set(input.subarray(at, at + size), outPos); outPos += size; at += size;
            } else if (type === 1) {
                if (at >= input.length || outPos + size > expectedSize) fail('RLE block overruns');
                out.fill(input[at], outPos, outPos + size); outPos += size; at += 1;
            } else if (type === 2) {
                if (at + size > input.length) fail('compressed block overruns');
                outPos = decodeBlock(input, at, at + size, out, outPos, frame); at += size;
            } else fail('reserved block type');
            if (last) break;
        }
        if (checksum) at += 4;
    }
    if (outPos !== expectedSize) fail(`unpacked ${outPos} bytes, expected ${expectedSize}`);
    return out;
}
