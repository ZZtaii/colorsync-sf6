import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMdfMaterialNames} from '../lib/mdf-materials.js';
import {makeMdf} from './fixtures/mdf.mjs';
test('MDF texture slots retain exact semantic slot and resource path',()=>{
 const source=makeMdf(),b=new ArrayBuffer(source.byteLength+512);new Uint8Array(b).set(new Uint8Array(source));const v=new DataView(b),table=source.byteLength;
 // MDF40 material starts at 16: texture count +20, texture pointer +60.
 v.setUint32(36,1,true);v.setBigUint64(76,BigInt(table),true);
 let cursor=table+32;
 for(const [field,value] of [[table,'BaseDielectricMap'],[table+16,'Product/Model/esf/base_albd']]){v.setBigUint64(field,BigInt(cursor),true);for(const c of value){v.setUint16(cursor,c.charCodeAt(0),true);cursor+=2;}cursor+=2;}
 assert.deepEqual(parseMdfMaterialNames(b,'test.mdf2.40')[0].textures,[{slot:'BaseDielectricMap',path:'Product/Model/esf/base_albd'}]);
 v.setBigUint64(table+16,999999n,true);assert.throws(()=>parseMdfMaterialNames(b,'test.mdf2.40'),/outside/);
});
