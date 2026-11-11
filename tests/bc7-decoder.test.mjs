import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decodeBC7Block,decodeBC7} from '../lib/bc7-decoder.js';
const {vectors}=JSON.parse(readFileSync(new URL('./fixtures/bc7-vectors.json',import.meta.url)));
test('BC7 all eight modes match upstream MIT decoder on 64 independent synthetic blocks',()=>{
 for(const {mode,input,rgba} of vectors) assert.equal(Buffer.from(decodeBC7Block(Buffer.from(input,'hex'))).toString('hex'),rgba,`mode ${mode}`);
});
test('BC7 truncation/size limits fail and partial blocks crop correctly',()=>{
 assert.throws(()=>decodeBC7Block(new Uint8Array(15)),/16/);assert.throws(()=>decodeBC7(new Uint8Array(16),0,1));assert.throws(()=>decodeBC7(new Uint8Array(17),4,4));
 const block=Buffer.from(vectors[0].input,'hex'),full=decodeBC7Block(block),cropped=decodeBC7(block,2,3).data;
 assert.deepEqual([...cropped],[...full.slice(0,8),...full.slice(16,24),...full.slice(32,40)]);
 assert.deepEqual([...decodeBC7Block(new Uint8Array(16))],Array(64).fill(0));
});
