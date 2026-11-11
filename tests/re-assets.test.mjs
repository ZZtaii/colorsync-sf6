import test from 'node:test';
import assert from 'node:assert/strict';
import {parseReMesh, halfToFloat} from '../lib/re-mesh-parser.js';
import {parseReTex,decodeReTex} from '../lib/re-tex-parser.js';
// Synthetic binary fixtures contain no game assets.
function mesh({int32=false}={}) {
 const b=new ArrayBuffer(1024), v=new DataView(b);
 const u8=(p,n)=>v.setUint8(p,n),u16=(p,n)=>v.setUint16(p,n,true),u32=(p,n)=>v.setUint32(p,n,true),ptr=(p,n)=>v.setBigUint64(p,BigInt(n),true);
 u32(0,0x4853454d);u32(4,220705151);u32(8,1024);u16(20,1);
 ptr(32,176);ptr(72,400);ptr(112,600);ptr(144,608);ptr(608,624);new Uint8Array(b,624,5).set([66,111,100,121,0]);
 u8(176,1);u8(177,1);u8(182,int32?1:0);ptr(232,240);ptr(240,256);u8(256,1);ptr(264,280);ptr(280,304);
 u8(305,1);u32(312,3);u32(316,3);u32(324,3);
 ptr(400,448);ptr(408,480);u32(424,36+3*(int32?4:2));u32(428,36);u16(432,1);u16(434,1);u16(448,0);u16(450,12);
 [0,0,0,1,0,0,0,1,0].forEach((n,i)=>v.setFloat32(480+i*4,n,true));
 [0,1,2].forEach((n,i)=>int32?u32(516+i*4,n):u16(516+i*2,n)); return b;
}
function tex(format=28,{width=2,height=2,pitch=256,version=143230113}={}) {
 const compressed=format>=71&&format<=99&&![87,91].includes(format),rows=compressed?Math.ceil(height/4):height;
 const b=new ArrayBuffer(56+rows*pitch),v=new DataView(b);
 v.setUint32(0,0x00584554,true);v.setUint32(4,version,true);v.setUint16(8,width,true);v.setUint16(10,height,true);v.setUint16(12,1,true);v.setUint16(14,0x1001,true);v.setUint32(16,format,true);v.setUint32(20,0xffffffff,true);v.setBigUint64(40,56n,true);v.setUint32(48,pitch,true);v.setUint32(52,rows*pitch,true);return b;
}
test('SF6 resident geometry preserves material identity and typed indices',()=>{
 for(const int32 of [false,true]) {const result=parseReMesh(mesh({int32}));assert.deepEqual(result.materialNames,['Body']);assert.equal(result.parts[0].materialIndex,0);assert.deepEqual([...result.parts[0].indices],[0,1,2]);assert.equal(result.parts[0].indices.BYTES_PER_ELEMENT,int32?4:2);assert.deepEqual(result.bounds,{min:[0,0,0],max:[1,1,0]});}
});
test('mesh truncation, unsupported version, pointers, streaming and index corruption fail closed',()=>{
 assert.throws(()=>parseReMesh(mesh().slice(0,100)),/truncated/);
 for(const [offset,value,kind] of [[4,7,'u32'],[32,999999,'ptr'],[322,1,'u8'],[516,3,'u16'],[480,Infinity,'f32']]) {const b=mesh(),v=new DataView(b);if(kind==='ptr')v.setBigUint64(offset,BigInt(value),true);else if(kind==='u8')v.setUint8(offset,value);else if(kind==='u16')v.setUint16(offset,value,true);else if(kind==='f32')v.setFloat32(offset,value,true);else v.setUint32(offset,value,true);assert.throws(()=>parseReMesh(b));}
});
test('half float conversion handles sign, subnormal and non-finite',()=>{assert.equal(halfToFloat(0x3c00),1);assert.equal(halfToFloat(0xbc00),-1);assert.equal(halfToFloat(1),2**-24);assert.ok(Number.isNaN(halfToFloat(0x7e00)));});
test('TEX removes padded rows and decodes exact RGBA bytes',()=>{
 const b=tex(),s=new Uint8Array(b);s.set([255,0,0,255,0,255,0,255],56);s.set([0,0,255,255,128,64,32,255],312);
 const parsed=parseReTex(b),decoded=decodeReTex(parsed);assert.equal(parsed.mips[0].data.length,16);assert.deepEqual([...decoded.data],[255,0,0,255,0,255,0,255,0,0,255,255,128,64,32,255]);
});
test('BC1-5 constant blocks decode and crop partial blocks',()=>{
 for(const format of [71,74,77,80,83]) {const b=tex(format),s=new Uint8Array(b),offset=format===71?56:64;if([71,74,77].includes(format)){s[offset]=0;s[offset+1]=248;}if(format===74)s.fill(255,56,64);if([77,80,83].includes(format))s[56]=255;if(format===83)s[64]=128; const decoded=decodeReTex(parseReTex(b));assert.equal(decoded.data.length,16);assert.equal(decoded.data[0],255);assert.equal(decoded.data[3],255);if(format===83)assert.equal(decoded.data[1],128);}
});
test('BC7 retained for GPU with browser CPU fallback',()=>{const parsed=parseReTex(tex(98));assert.equal(parsed.formatName,'BC7');assert.equal(parsed.mips[0].data.length,16);assert.deepEqual([...decodeReTex(parsed).data],Array(16).fill(0));});
test('TEX rejects arrays, bad offsets, pitches and payload truncation',()=>{
 for(const [offset,value,size] of [[12,2,2],[14,0x1002,2],[48,1,4],[40,0,4]]){const b=tex(),v=new DataView(b);size===2?v.setUint16(offset,value,true):v.setUint32(offset,value,true);assert.throws(()=>parseReTex(b));}
 assert.throws(()=>parseReTex(tex().slice(0,70)));assert.equal(parseReTex(tex(28,{version:241101895})).version,241101895);
});
test('BC1 transparent mode and BC3 alpha selector interpolation',()=>{
 const b=tex(71),bytes=new Uint8Array(b);bytes[58]=255;bytes[59]=255;bytes.fill(255,60,64);const rgba=decodeReTex(parseReTex(b)).data;assert.deepEqual([...rgba.slice(0,4)],[0,0,0,0]);
 const a=tex(77),s=new Uint8Array(a);s[56]=255;s[57]=0;s[58]=2;assert.equal(decodeReTex(parseReTex(a)).data[3],218);
});
test('MESH accepts views with nonzero byte offsets without reading adjacent data',()=>{const b=mesh(),envelope=new Uint8Array(b.byteLength+16);envelope.set(new Uint8Array(b),8);assert.deepEqual(parseReMesh(envelope.subarray(8,-8)).materialNames,['Body']);});

test('bytes after the last listed mip are ignored with a warning',()=>{const b=tex(98),padded=new Uint8Array(b.byteLength+48);padded.set(new Uint8Array(b));const parsed=parseReTex(padded.buffer);assert.equal(parsed.mips[0].data.length,16);assert.equal(parsed.warnings.length,1);assert.equal(parseReTex(b).warnings.length,0);});

test('reader accepts what real mods ship: other version numbers, 8K sizes, rounded-up and cut-off small mips',()=>{
 const odd=tex(98,{version:36});assert.equal(parseReTex(odd).warnings.length,1);assert.equal(parseReTex(odd).mips[0].data.length,16);
 // 8192 x 8192 header with one mip: the size limit must let it through to the layout checks (the file is short, so it fails later, not on size).
 const big=tex(98),bv=new DataView(big);bv.setUint16(8,8192,true);bv.setUint16(10,8192,true);assert.throws(()=>parseReTex(big),/inconsistent|truncated/);
 // A mip that stores more rows than its size needs.
 const tall=tex(98),tv=new DataView(tall),extra=new Uint8Array(tall.byteLength+256);tv.setUint32(52,512,true);extra.set(new Uint8Array(tall));assert.equal(parseReTex(extra.buffer).mips[0].data.length,16);
 // Missing data in the largest mip is still refused.
 assert.throws(()=>parseReTex(tex(98).slice(0,60)));
});

test('reader accepts alignment padding before the first mip and a wrong declared pitch on packed data',()=>{
 // 8 bytes of padding between the mip table and the data.
 const b=tex(98),src=new Uint8Array(b),moved=new Uint8Array(b.byteLength+8);moved.set(src.subarray(0,56));moved.set(src.subarray(56),64);new DataView(moved.buffer).setBigUint64(40,64n,true);
 assert.equal(parseReTex(moved.buffer).mips[0].data.length,16);
 // Packed BC4 (one 8-byte block) declaring a 16-byte pitch.
 const c=tex(80,{pitch:8}),cv=new DataView(c);cv.setUint32(48,16,true);assert.equal(parseReTex(c).mips[0].data.length,8);
 // A mip that starts before the previous one ended is still refused.
 const d=tex(98),dv=new DataView(d);dv.setBigUint64(40,48n,true);assert.throws(()=>parseReTex(d),/inconsistent/);
});
