// Read-only SF6 TEX reader. Layout reference: REasy v0.7.9 (MIT),
// file_handlers/tex/{tex_file,profiles}.py. See THIRD_PARTY_NOTICES.md.
import {binaryView} from './re-mesh-parser.js';
import {decodeBC7} from './bc7-decoder.js';
const FORMATS = new Map([
    [28,['RGBA8',4,0,false]], [29,['RGBA8',4,0,true]], [49,['RG8',2,0,false]], [61,['R8',1,0,false]],
    [87,['BGRA8',4,0,false]], [91,['BGRA8',4,0,true]],
    [71,['BC1',0,8,false]], [72,['BC1',0,8,true]], [74,['BC2',0,16,false]], [75,['BC2',0,16,true]],
    [77,['BC3',0,16,false]], [78,['BC3',0,16,true]], [80,['BC4',0,8,false]], [83,['BC5',0,16,false]],
    [98,['BC7',0,16,false]], [99,['BC7',0,16,true]],
]);
export function parseReTex(input) {
    const r = binaryView(input, 'TEX'); r.check(0, 40);
    if (r.u32(0) !== 0x00584554) throw new Error('Not a TEX file');
    const version = r.u32(4), warnings = [];
    // What a mod's texture has to get right is its layout, which is checked below. The version
    // number is not a reason to refuse: converters write 36 or other values into files the game
    // loads (found in 10 of 266 installed mods), with the same header and mip table.
    if (![143230113,241101895].includes(version)) warnings.push(`unusual TEX version ${version}; read with the standard SF6 layout`);
    const width = r.u16(8), height = r.u16(10), depth = r.u16(12), packed = r.u16(14), imageCount = packed & 4095, mipCount = packed >>> 12, format = r.u32(16);
    // 8192 x 8192 is in real use (7 of 266 mods). The preview only ever decodes a small mip.
    if (!width || !height || width > 16384 || height > 16384 || width * height > 67108864) throw new Error('TEX dimensions exceed browser preview limits');
    if (depth !== 1 || imageCount !== 1 || r.u32(24)) throw new Error('Only single-image 2D TEX files are supported (no arrays, volumes or cubemaps)');
    if (r.u32(20) !== 0xffffffff) throw new Error('Swizzled TEX files are unsupported');
    if (!mipCount || mipCount > Math.floor(Math.log2(Math.max(width,height))) + 1) throw new Error('Invalid TEX mip count');
    const definition = FORMATS.get(format);
    if (!definition) throw new Error(`Unsupported TEX DXGI format ${format}; use a PNG copy for this texture`);
    const [formatName, pixelBytes, blockBytes, srgb] = definition;
    const mips = []; let expected = 40 + mipCount * 16; r.check(40, mipCount * 16);
    for (let i = 0; i < mipCount; i++) {
        const p = 40 + i * 16, offset = r.ptr(p), declaredPitch = r.u32(p + 8), size = r.u32(p + 12), w = Math.max(1, width >> i), h = Math.max(1,height >> i);
        const rows = blockBytes ? Math.ceil(h / 4) : h, naturalPitch = blockBytes ? Math.ceil(w / 4) * blockBytes : w * pixelBytes;
        // Some converters write a row pitch that does not match their data (a 16-byte block pitch on
        // 8-byte BC4). When the size is exactly the packed size, the data is packed whatever it says.
        const pitch = size === naturalPitch * rows ? naturalPitch : declaredPitch;
        // A mip may hold more rows than the size needs: converters round odd sizes (800 x 600) up.
        const storedRows = pitch ? size / pitch : 0;
        // Mips must follow each other in order without overlapping; a few bytes of alignment
        // padding before one (seen after the mip table) are fine.
        if (offset < expected || pitch < naturalPitch || !Number.isInteger(storedRows) || storedRows < rows) throw new Error('TEX mip offsets, size or row pitch are inconsistent');
        if (offset + size > r.bytes.length) {
            // The file ends inside this mip. Larger mips are complete, so they are still usable.
            if (!i) throw new Error('TEX is truncated: its largest mip is incomplete');
            warnings.push(`the ${mipCount - i} smallest mip level(s) are cut off and were ignored`);
            break;
        }
        expected = offset + size;
        // RE Engine pads rows (usually to 256 B). GPU/CPU decoding wants packed rows. Mips are
        // unpacked on first use, so an 8K texture costs nothing until a mip is actually read.
        const mip = {width:w,height:h};
        let data = null;
        Object.defineProperty(mip, 'data', { enumerable: true, get() {
            if (!data) {
                data = new Uint8Array(naturalPitch * rows);
                for (let row = 0; row < rows; row++) data.set(r.bytes.subarray(offset + row * pitch, offset + row * pitch + naturalPitch), row * naturalPitch);
            }
            return data;
        } });
        mips.push(mip);
    }
    // Bytes after the last listed mip are tolerated: common texture converters append 48 unlisted
    // bytes (three spare BC7 blocks) and the game loads them.
    if (mips.length === mipCount && expected < r.bytes.length) warnings.push(`${r.bytes.length - expected} unlisted bytes after the last mip were ignored`);
    return {version,width,height,format,formatName,srgb,compressed:!!blockBytes,mips,warnings};
}
function rgb565(n) { return [Math.round(((n >>> 11) & 31)*255/31),Math.round(((n >>> 5)&63)*255/63),Math.round((n&31)*255/31),255]; }
function decodeColor(data, p, forceFour) {
    const a = data[p] | data[p+1]<<8, b = data[p+2] | data[p+3]<<8, palette = [rgb565(a),rgb565(b)];
    if (a > b || forceFour) {
        palette.push(palette[0].map((v,c) => c === 3 ? 255 : Math.floor((2*v + palette[1][c])/3)));
        palette.push(palette[0].map((v,c) => c === 3 ? 255 : Math.floor((v + 2*palette[1][c])/3)));
    } else { palette.push(palette[0].map((v,c) => c === 3 ? 255 : Math.floor((v+palette[1][c])/2))); palette.push([0,0,0,0]); }
    const selectors = (data[p+4] | data[p+5]<<8 | data[p+6]<<16 | data[p+7]<<24) >>> 0;
    return Array.from({length:16}, (_,i) => palette[(selectors >>> (i*2)) & 3].slice());
}
function decodeChannel(data,p) {
    const a=data[p],b=data[p+1],values=[a,b];
    if(a>b) for(let i=1;i<=6;i++) values.push(Math.floor(((7-i)*a+i*b)/7));
    else { for(let i=1;i<=4;i++) values.push(Math.floor(((5-i)*a+i*b)/5)); values.push(0,255); }
    // 48 bits exceed JS bitwise width; exact integer division avoids BigInt per texel.
    let bits=0; for(let i=0;i<6;i++) bits += data[p+2+i]*2**(i*8);
    return Array.from({length:16},(_,i)=>values[Math.floor(bits/2**(3*i))%8]);
}
export function decodeReTex(texture, {mipLevel = 0} = {}) {
    const mip=texture.mips[mipLevel]; if(!mip) throw new Error('TEX mip level is absent');
    const {width,height}=mip, source=mip.data, name=texture.formatName;
    if(name==='BC7') return decodeBC7(source,width,height);
    const data=new Uint8Array(width*height*4);
    if(!texture.compressed) {
        const stride = name==='R8'?1:name==='RG8'?2:4;
        for(let i=0;i<width*height;i++) {
            const p=i*stride,q=i*4;
            data[q]=source[p+(name==='BGRA8'?2:0)];
            data[q+1]=stride===1?0:source[p+1]; data[q+2]=stride===4?source[p+(name==='BGRA8'?0:2)]:0;
            data[q+3]=stride===4?source[p+3]:255;
        }
    } else {
        const bytes=name==='BC1'||name==='BC4'?8:16, columns=Math.ceil(width/4), rows=Math.ceil(height/4);
        for(let by=0;by<rows;by++) for(let bx=0;bx<columns;bx++) {
            const p=(by*columns+bx)*bytes;
            const pixels=name==='BC4'||name==='BC5'?Array.from({length:16},()=>[0,0,0,255]):decodeColor(source,p+(name==='BC1'?0:8),name!=='BC1');
            if(name==='BC2') for(let i=0;i<16;i++) pixels[i][3]=((source[p+(i>>1)] >>> ((i&1)*4))&15)*17;
            if(name==='BC3') {const alpha=decodeChannel(source,p); for(let i=0;i<16;i++) pixels[i][3]=alpha[i];}
            if(name==='BC4'||name==='BC5') {const red=decodeChannel(source,p),green=name==='BC5'?decodeChannel(source,p+8):null; for(let i=0;i<16;i++){pixels[i][0]=red[i];if(green)pixels[i][1]=green[i];}}
            for(let y=0;y<4;y++) for(let x=0;x<4;x++) if(bx*4+x<width&&by*4+y<height) data.set(pixels[y*4+x],((by*4+y)*width+bx*4+x)*4);
        }
    }
    return {width,height,data};
}
