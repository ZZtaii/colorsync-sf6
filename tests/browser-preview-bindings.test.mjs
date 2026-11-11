import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBrowserPreviewMaterials} from '../lib/browser-preview-bindings.js';
const mesh={parts:[{materialIndex:0}],materialNames:['same name']};
const snapshot={materials:[{id:'exact',name:'same name',parameters:[{id:'slot',values:[.1,.2,.3,1]}]}]};
test('browser preview does not guess material names or color slots',()=>{
 assert.equal(resolveBrowserPreviewMaterials(mesh,snapshot)[0].materialId,null);
 assert.equal(resolveBrowserPreviewMaterials(mesh,snapshot,{0:{materialId:'exact',parameterId:'missing'}})[0].materialId,null);
});
test('explicit browser binding uses linear values without conversion or aliasing',()=>{
 const value=resolveBrowserPreviewMaterials(mesh,snapshot,{0:{materialId:'exact',parameterId:'slot'}})[0];
 assert.deepEqual(value.color,[.1,.2,.3,1]);value.color[0]=9;assert.equal(snapshot.materials[0].parameters[0].values[0],.1);
});
test('stale and unresolved browser bindings return neutral geometry',()=>{
 assert.equal(resolveBrowserPreviewMaterials(mesh,{materials:[]},{0:{materialId:'exact',parameterId:'slot'}})[0].materialId,null);
 assert.equal(resolveBrowserPreviewMaterials(mesh,{materials:[{id:'exact',parameters:[{id:'slot',values:null}]}]},{0:{materialId:'exact',parameterId:'slot'}})[0].materialId,null);
});
