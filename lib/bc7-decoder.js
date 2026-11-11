/*
Browser JavaScript adaptation of bcdec_bc7 from https://github.com/iOrange/bcdec
Chosen license: MIT. Partition tables and decoding algorithm by Sergii Kudlai.
Copyright (c) 2022 Sergii Kudlai

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
const PARTITIONS = [[[[128,0,1,1],[0,0,1,1],[0,0,1,1],[0,0,1,129]],[[128,0,0,1],[0,0,0,1],[0,0,0,1],[0,0,0,129]],[[128,1,1,1],[0,1,1,1],[0,1,1,1],[0,1,1,129]],[[128,0,0,1],[0,0,1,1],[0,0,1,1],[0,1,1,129]],[[128,0,0,0],[0,0,0,1],[0,0,0,1],[0,0,1,129]],[[128,0,1,1],[0,1,1,1],[0,1,1,1],[1,1,1,129]],[[128,0,0,1],[0,0,1,1],[0,1,1,1],[1,1,1,129]],[[128,0,0,0],[0,0,0,1],[0,0,1,1],[0,1,1,129]],[[128,0,0,0],[0,0,0,0],[0,0,0,1],[0,0,1,129]],[[128,0,1,1],[0,1,1,1],[1,1,1,1],[1,1,1,129]],[[128,0,0,0],[0,0,0,1],[0,1,1,1],[1,1,1,129]],[[128,0,0,0],[0,0,0,0],[0,0,0,1],[0,1,1,129]],[[128,0,0,1],[0,1,1,1],[1,1,1,1],[1,1,1,129]],[[128,0,0,0],[0,0,0,0],[1,1,1,1],[1,1,1,129]],[[128,0,0,0],[1,1,1,1],[1,1,1,1],[1,1,1,129]],[[128,0,0,0],[0,0,0,0],[0,0,0,0],[1,1,1,129]],[[128,0,0,0],[1,0,0,0],[1,1,1,0],[1,1,1,129]],[[128,1,129,1],[0,0,0,1],[0,0,0,0],[0,0,0,0]],[[128,0,0,0],[0,0,0,0],[129,0,0,0],[1,1,1,0]],[[128,1,129,1],[0,0,1,1],[0,0,0,1],[0,0,0,0]],[[128,0,129,1],[0,0,0,1],[0,0,0,0],[0,0,0,0]],[[128,0,0,0],[1,0,0,0],[129,1,0,0],[1,1,1,0]],[[128,0,0,0],[0,0,0,0],[129,0,0,0],[1,1,0,0]],[[128,1,1,1],[0,0,1,1],[0,0,1,1],[0,0,0,129]],[[128,0,129,1],[0,0,0,1],[0,0,0,1],[0,0,0,0]],[[128,0,0,0],[1,0,0,0],[129,0,0,0],[1,1,0,0]],[[128,1,129,0],[0,1,1,0],[0,1,1,0],[0,1,1,0]],[[128,0,129,1],[0,1,1,0],[0,1,1,0],[1,1,0,0]],[[128,0,0,1],[0,1,1,1],[129,1,1,0],[1,0,0,0]],[[128,0,0,0],[1,1,1,1],[129,1,1,1],[0,0,0,0]],[[128,1,129,1],[0,0,0,1],[1,0,0,0],[1,1,1,0]],[[128,0,129,1],[1,0,0,1],[1,0,0,1],[1,1,0,0]],[[128,1,0,1],[0,1,0,1],[0,1,0,1],[0,1,0,129]],[[128,0,0,0],[1,1,1,1],[0,0,0,0],[1,1,1,129]],[[128,1,0,1],[1,0,129,0],[0,1,0,1],[1,0,1,0]],[[128,0,1,1],[0,0,1,1],[129,1,0,0],[1,1,0,0]],[[128,0,129,1],[1,1,0,0],[0,0,1,1],[1,1,0,0]],[[128,1,0,1],[0,1,0,1],[129,0,1,0],[1,0,1,0]],[[128,1,1,0],[1,0,0,1],[0,1,1,0],[1,0,0,129]],[[128,1,0,1],[1,0,1,0],[1,0,1,0],[0,1,0,129]],[[128,1,129,1],[0,0,1,1],[1,1,0,0],[1,1,1,0]],[[128,0,0,1],[0,0,1,1],[129,1,0,0],[1,0,0,0]],[[128,0,129,1],[0,0,1,0],[0,1,0,0],[1,1,0,0]],[[128,0,129,1],[1,0,1,1],[1,1,0,1],[1,1,0,0]],[[128,1,129,0],[1,0,0,1],[1,0,0,1],[0,1,1,0]],[[128,0,1,1],[1,1,0,0],[1,1,0,0],[0,0,1,129]],[[128,1,1,0],[0,1,1,0],[1,0,0,1],[1,0,0,129]],[[128,0,0,0],[0,1,129,0],[0,1,1,0],[0,0,0,0]],[[128,1,0,0],[1,1,129,0],[0,1,0,0],[0,0,0,0]],[[128,0,129,0],[0,1,1,1],[0,0,1,0],[0,0,0,0]],[[128,0,0,0],[0,0,129,0],[0,1,1,1],[0,0,1,0]],[[128,0,0,0],[0,1,0,0],[129,1,1,0],[0,1,0,0]],[[128,1,1,0],[1,1,0,0],[1,0,0,1],[0,0,1,129]],[[128,0,1,1],[0,1,1,0],[1,1,0,0],[1,0,0,129]],[[128,1,129,0],[0,0,1,1],[1,0,0,1],[1,1,0,0]],[[128,0,129,1],[1,0,0,1],[1,1,0,0],[0,1,1,0]],[[128,1,1,0],[1,1,0,0],[1,1,0,0],[1,0,0,129]],[[128,1,1,0],[0,0,1,1],[0,0,1,1],[1,0,0,129]],[[128,1,1,1],[1,1,1,0],[1,0,0,0],[0,0,0,129]],[[128,0,0,1],[1,0,0,0],[1,1,1,0],[0,1,1,129]],[[128,0,0,0],[1,1,1,1],[0,0,1,1],[0,0,1,129]],[[128,0,129,1],[0,0,1,1],[1,1,1,1],[0,0,0,0]],[[128,0,129,0],[0,0,1,0],[1,1,1,0],[1,1,1,0]],[[128,1,0,0],[0,1,0,0],[0,1,1,1],[0,1,1,129]]],[[[128,0,1,129],[0,0,1,1],[0,2,2,1],[2,2,2,130]],[[128,0,0,129],[0,0,1,1],[130,2,1,1],[2,2,2,1]],[[128,0,0,0],[2,0,0,1],[130,2,1,1],[2,2,1,129]],[[128,2,2,130],[0,0,2,2],[0,0,1,1],[0,1,1,129]],[[128,0,0,0],[0,0,0,0],[129,1,2,2],[1,1,2,130]],[[128,0,1,129],[0,0,1,1],[0,0,2,2],[0,0,2,130]],[[128,0,2,130],[0,0,2,2],[1,1,1,1],[1,1,1,129]],[[128,0,1,1],[0,0,1,1],[130,2,1,1],[2,2,1,129]],[[128,0,0,0],[0,0,0,0],[129,1,1,1],[2,2,2,130]],[[128,0,0,0],[1,1,1,1],[129,1,1,1],[2,2,2,130]],[[128,0,0,0],[1,1,129,1],[2,2,2,2],[2,2,2,130]],[[128,0,1,2],[0,0,129,2],[0,0,1,2],[0,0,1,130]],[[128,1,1,2],[0,1,129,2],[0,1,1,2],[0,1,1,130]],[[128,1,2,2],[0,129,2,2],[0,1,2,2],[0,1,2,130]],[[128,0,1,129],[0,1,1,2],[1,1,2,2],[1,2,2,130]],[[128,0,1,129],[2,0,0,1],[130,2,0,0],[2,2,2,0]],[[128,0,0,129],[0,0,1,1],[0,1,1,2],[1,1,2,130]],[[128,1,1,129],[0,0,1,1],[130,0,0,1],[2,2,0,0]],[[128,0,0,0],[1,1,2,2],[129,1,2,2],[1,1,2,130]],[[128,0,2,130],[0,0,2,2],[0,0,2,2],[1,1,1,129]],[[128,1,1,129],[0,1,1,1],[0,2,2,2],[0,2,2,130]],[[128,0,0,129],[0,0,0,1],[130,2,2,1],[2,2,2,1]],[[128,0,0,0],[0,0,129,1],[0,1,2,2],[0,1,2,130]],[[128,0,0,0],[1,1,0,0],[130,2,129,0],[2,2,1,0]],[[128,1,2,130],[0,129,2,2],[0,0,1,1],[0,0,0,0]],[[128,0,1,2],[0,0,1,2],[129,1,2,2],[2,2,2,130]],[[128,1,1,0],[1,2,130,1],[129,2,2,1],[0,1,1,0]],[[128,0,0,0],[0,1,129,0],[1,2,130,1],[1,2,2,1]],[[128,0,2,2],[1,1,0,2],[129,1,0,2],[0,0,2,130]],[[128,1,1,0],[0,129,1,0],[2,0,0,2],[2,2,2,130]],[[128,0,1,1],[0,1,2,2],[0,1,130,2],[0,0,1,129]],[[128,0,0,0],[2,0,0,0],[130,2,1,1],[2,2,2,129]],[[128,0,0,0],[0,0,0,2],[129,1,2,2],[1,2,2,130]],[[128,2,2,130],[0,0,2,2],[0,0,1,2],[0,0,1,129]],[[128,0,1,129],[0,0,1,2],[0,0,2,2],[0,2,2,130]],[[128,1,2,0],[0,129,2,0],[0,1,130,0],[0,1,2,0]],[[128,0,0,0],[1,1,129,1],[2,2,130,2],[0,0,0,0]],[[128,1,2,0],[1,2,0,1],[130,0,129,2],[0,1,2,0]],[[128,1,2,0],[2,0,1,2],[129,130,0,1],[0,1,2,0]],[[128,0,1,1],[2,2,0,0],[1,1,130,2],[0,0,1,129]],[[128,0,1,1],[1,1,130,2],[2,2,0,0],[0,0,1,129]],[[128,1,0,129],[0,1,0,1],[2,2,2,2],[2,2,2,130]],[[128,0,0,0],[0,0,0,0],[130,1,2,1],[2,1,2,129]],[[128,0,2,2],[1,129,2,2],[0,0,2,2],[1,1,2,130]],[[128,0,2,130],[0,0,1,1],[0,0,2,2],[0,0,1,129]],[[128,2,2,0],[1,2,130,1],[0,2,2,0],[1,2,2,129]],[[128,1,0,1],[2,2,130,2],[2,2,2,2],[0,1,0,129]],[[128,0,0,0],[2,1,2,1],[130,1,2,1],[2,1,2,129]],[[128,1,0,129],[0,1,0,1],[0,1,0,1],[2,2,2,130]],[[128,2,2,130],[0,1,1,1],[0,2,2,2],[0,1,1,129]],[[128,0,0,2],[1,129,1,2],[0,0,0,2],[1,1,1,130]],[[128,0,0,0],[2,129,1,2],[2,1,1,2],[2,1,1,130]],[[128,2,2,2],[0,129,1,1],[0,1,1,1],[0,2,2,130]],[[128,0,0,2],[1,1,1,2],[129,1,1,2],[0,0,0,130]],[[128,1,1,0],[0,129,1,0],[0,1,1,0],[2,2,2,130]],[[128,0,0,0],[0,0,0,0],[2,1,129,2],[2,1,1,130]],[[128,1,1,0],[0,129,1,0],[2,2,2,2],[2,2,2,130]],[[128,0,2,2],[0,0,1,1],[0,0,129,1],[0,0,2,130]],[[128,0,2,2],[1,1,2,2],[129,1,2,2],[0,0,2,130]],[[128,0,0,0],[0,0,0,0],[0,0,0,0],[2,129,1,130]],[[128,0,0,130],[0,0,0,1],[0,0,0,2],[0,0,0,129]],[[128,2,2,2],[1,2,2,2],[0,2,2,2],[129,2,2,130]],[[128,1,0,129],[2,2,2,2],[2,2,2,2],[2,2,2,130]],[[128,1,1,129],[2,0,1,1],[130,2,0,1],[2,2,2,0]]]];
const COLOR_BITS = [4,6,5,7,5,7,7,5], ALPHA_BITS = [0,0,0,0,6,8,7,5];
const WEIGHTS = {2:[0,21,43,64],3:[0,9,18,27,37,46,55,64],4:[0,4,9,13,17,21,26,30,34,38,43,47,51,55,60,64]};
const P_BITS = 0b11001011;
/** Decode a single 16-byte BC7 block, all eight modes, into 64 RGBA bytes. */
export function decodeBC7Block(source, offset = 0, output = new Uint8Array(64)) {
    if (!(source instanceof Uint8Array) || !Number.isInteger(offset) || offset < 0 || offset + 16 > source.length || output.length < 64)
        throw new RangeError('BC7 block needs 16 input bytes and 64 output bytes');
    let bit = 0;
    const read = n => {
        const byte = bit >>> 3, shift = bit & 7;
        const value = (source[offset + byte] | ((source[offset + byte + 1] || 0) << 8)) >>> shift;
        bit += n; return value & ((1 << n) - 1);
    };
    let mode = 0; while (mode < 8 && !read(1)) mode++;
    if (mode === 8) { output.fill(0,0,64); return output; }
    let subsetCount = 1, partition = 0, rotation = 0, indexSelection = 0;
    if ([0,1,2,3,7].includes(mode)) {subsetCount = mode === 0 || mode === 2 ? 3 : 2;partition = read(mode === 0 ? 4 : 6);}
    if (mode === 4 || mode === 5) { rotation = read(2); if (mode === 4) indexSelection = read(1); }
    const endpointCount = subsetCount * 2, endpoints = new Int32Array(24);
    for (let c = 0; c < 3; c++) for (let e = 0; e < endpointCount; e++) endpoints[e*4+c] = read(COLOR_BITS[mode]);
    if (ALPHA_BITS[mode]) for (let e = 0; e < endpointCount; e++) endpoints[e*4+3] = read(ALPHA_BITS[mode]);
    if (P_BITS & (1 << mode)) {
        for (let e = 0; e < endpointCount*4; e++) endpoints[e] <<= 1;
        if (mode === 1) {
            const first = read(1), second = read(1);
            for (let e = 0; e < 4; e++) for (let c = 0; c < 3; c++) endpoints[e*4+c] |= e < 2 ? first : second;
        } else for (let e = 0; e < endpointCount; e++) {const p = read(1); for (let c = 0; c < 4; c++) endpoints[e*4+c] |= p;}
    }
    for (let e = 0; e < endpointCount; e++) for (let c = 0; c < 4; c++) {
        if (c === 3 && !ALPHA_BITS[mode]) { endpoints[e*4+c] = 255; continue; }
        const precision = (c === 3 ? ALPHA_BITS[mode] : COLOR_BITS[mode]) + ((P_BITS >>> mode) & 1);
        const expanded = endpoints[e*4+c] << (8 - precision); endpoints[e*4+c] = expanded | (expanded >>> precision);
    }
    const indexBits = mode === 0 || mode === 1 ? 3 : mode === 6 ? 4 : 2;
    const secondaryBits = mode === 4 ? 3 : mode === 5 ? 2 : 0;
    const subsets = subsetCount === 1 ? null : PARTITIONS[subsetCount-2][partition];
    const indices = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {const subset = subsets ? subsets[i>>>2][i&3] : i === 0 ? 128 : 0;indices[i] = read(indexBits - (subset & 128 ? 1 : 0));}
    for (let i = 0; i < 16; i++) {
        const subset = subsets ? subsets[i>>>2][i&3] & 3 : 0;
        const secondary = secondaryBits ? read(secondaryBits - (i === 0 ? 1 : 0)) : 0;
        for (let c = 0; c < 4; c++) {
            const useSecondary = secondaryBits && (c === 3 ? !indexSelection : indexSelection);
            const weight = WEIGHTS[useSecondary ? secondaryBits : indexBits][useSecondary ? secondary : indices[i]];
            const endpoint = subset*8+c;output[i*4+c] = ((64-weight)*endpoints[endpoint] + weight*endpoints[endpoint+4]+32) >>> 6;
        }
        if (rotation) {const c = i*4+rotation-1, a = i*4+3, old = output[c];output[c] = output[a];output[a] = old;}
    }
    return output;
}
export function decodeBC7(source, width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width*height > 16777216)
        throw new RangeError('BC7 dimensions exceed browser limits');
    const columns = Math.ceil(width/4), rows = Math.ceil(height/4);
    if (!(source instanceof Uint8Array) || source.length !== columns*rows*16) throw new RangeError('BC7 block payload size does not match dimensions');
    const data = new Uint8Array(width*height*4), block = new Uint8Array(64);
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
        decodeBC7Block(source,(y*columns+x)*16,block);
        for (let by = 0; by < Math.min(4,height-y*4); by++) {
            const length = Math.min(4,width-x*4)*4;
            data.set(block.subarray(by*16,by*16+length),((y*4+by)*width+x*4)*4);
        }
    }
    return {width,height,data};
}
