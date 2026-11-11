import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {buildMaterialPreviewState,previewMaterialId,resolvePreviewCommand} from '../lib/material-preview-state.js';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const names=['applyMaterialPreviewCommand','applyColorEdit','planColorSlotEdit','applyColorSlotEdit','isSlotEditable','writeRgbaAtOffset','updateColorModelAtOffset','forceEnableSlot','writeEnableAtOffset','clampByte','rgbaToHexString'];
const functions=names.map(name=>{const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);return source.slice(start,source.indexOf('\n}',start)+2);}).join('\n');
function fixture(){
 const originalBuffer=new ArrayBuffer(32);const bytes=new Uint8Array(originalBuffer);bytes.set([1,0,0,0,128,64,32,255,1,0,0,0,8,9,10,255]);
 const color=(offset,r,g,b)=>({index:0,enabled:true,color:{r,g,b,a:255,absoluteOffset:offset+4},enable:{absoluteOffset:offset,byteLength:1}});
 const cmd={originalBuffer,workingBuffer:originalBuffer.slice(0),metadata:{esfId:'esf999',costumeFolder:'001',paletteNumber:1},colorClusters:[{instanceId:2,name:'duplicate',colors:[color(0,128,64,32)]},{instanceId:3,name:'duplicate',colors:[color(8,8,9,10)]}]};
 const state={cmdEntries:[cmd],activeCmdIndex:0,materialDefaultBuffers:new Map()};let revision=0,fingerprint='',snapshot;let plannerCalls=0;
 const publishMaterialPreview=()=>{const next=buildMaterialPreviewState(state);const key=JSON.stringify(next);if(key!==fingerprint){fingerprint=key;next.revision=++revision;snapshot=next;}return snapshot;};
 const api=runInNewContext(`${functions}\n({applyMaterialPreviewCommand})`,{state,buildMaterialPreviewState,previewMaterialId,resolvePreviewCommand,publishMaterialPreview,document:{querySelectorAll:()=>[]},updateInspectorDirtyUi(){},renderCurrentChanges(){},renderSyncPanels(){},updateExportButtons(){},renderColorClusters(){},cmdColorSlots:c=>c.colors});
 return {state,cmd,api,snapshot:publishMaterialPreview};
}
test('actual app command edits exact cluster even with duplicate names, leaves unrelated bytes and original intact',()=>{
 const {cmd,api,snapshot}=fixture(),s=snapshot(),m=s.materials[1],p=m.parameters[0],original=cmd.originalBuffer.slice(0);
 api.applyMaterialPreviewCommand({type:'edit',revision:s.revision,materialId:m.id,parameterId:p.id,cmdRgba:[1,2,3,4]});
 assert.deepEqual(Array.from(new Uint8Array(cmd.workingBuffer).slice(4,8)),[128,64,32,255]);
 assert.deepEqual(Array.from(new Uint8Array(cmd.workingBuffer).slice(12,16)),[1,2,3,4]);
 assert.deepEqual(cmd.originalBuffer,original);assert.equal(snapshot().materials[1].parameters[0].source,'cmd');
});
test('actual app stale commands, foreign identities and read-only slots cannot mutate working bytes',()=>{
 const {cmd,api,snapshot}=fixture(),s=snapshot(),m=s.materials[0],p=m.parameters[0];
 const c={type:'edit',revision:s.revision,materialId:m.id,parameterId:p.id,cmdRgba:[1,2,3,4]};
 cmd.colorClusters[0].colors[0].materialEditBlockedReason='Read only';const before=cmd.workingBuffer.slice(0);
 assert.throws(()=>api.applyMaterialPreviewCommand(c),/changed/);
 c.revision=snapshot().revision;assert.throws(()=>api.applyMaterialPreviewCommand(c),/Read only/);
 assert.throws(()=>api.applyMaterialPreviewCommand({...c,materialId:'duplicate'}),/Unknown/);assert.deepEqual(cmd.workingBuffer,before);
});
test('actual app slot selection never changes bytes',()=>{
 const {cmd,api,snapshot}=fixture(),s=snapshot(),m=s.materials[0],p=m.parameters[0],before=cmd.workingBuffer.slice(0);
 api.applyMaterialPreviewCommand({type:'select',revision:s.revision,materialId:m.id,parameterId:p.id});assert.deepEqual(cmd.workingBuffer,before);
});
