import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMaterialPreviewState, resolvePreviewCommand } from '../lib/material-preview-state.js';
import { cmdRgbaToLinearFloatRgba } from '../lib/sf6-color-space.js';

function fixture(enabled = true) {
    const originalBuffer = new ArrayBuffer(16);
    new Uint8Array(originalBuffer).set([enabled ? 1 : 0, 0, 0, 0, 128, 64, 32, 200]);
    const slot = { index: 0, enabled, materialName: 'cloth',
        color: { r: 128, g: 64, b: 32, a: 200, absoluteOffset: 4 },
        enable: { absoluteOffset: 0, byteLength: 1 } };
    const cmd = { originalBuffer, workingBuffer: originalBuffer.slice(0),
        file: { name: 'example.user.2' }, metadata: { esfId: 'esf001', costumeFolder: '001', variant: 'standard', paletteNumber: 1 },
        colorClusters: [{ name: 'cloth', instanceId: 2, materialPartTypes: [1], colors: [slot] }] };
    const state = { cmdEntries: [cmd], activeCmdIndex: 0, materialDefaultBuffers: new Map() };
    return { state, slot, cmd };
}
const parameter = state => buildMaterialPreviewState(state).materials[0].parameters[0];

test('active CMD converts RGB exactly once and alpha stays linear', () => {
    const { state } = fixture(); const p = parameter(state);
    assert.deepEqual(p.values, cmdRgbaToLinearFloatRgba([128,64,32,200]));
    assert.equal(p.source, 'cmd'); assert.equal(p.values[3], 200/255);
    assert.deepEqual(p.values, p.baselineValues);
});
test('inactive unresolved CMD never masquerades as an effective color', () => {
    const { state } = fixture(false); const p = parameter(state);
    assert.equal(p.values, null); assert.equal(p.source, 'unresolved');
    assert.deepEqual(p.cmdRgba, [128,64,32,200]);
});
test('stock default floats retain precision and active override takes precedence', () => {
    const { state, slot } = fixture(false);
    Object.assign(slot.color, { r: 128, g: 128, b: 128 }); // never-set placeholder: the material default applies
    slot.mdfFallbackLinearRgba = [0.0123456789, 0.5, 0.9, 0.7]; slot.mdfFallbackPath = 'stock';
    assert.deepEqual(parameter(state).values, slot.mdfFallbackLinearRgba);
    assert.equal(parameter(state).source, 'stock-mdf');
    slot.enabled = true; assert.equal(parameter(state).source, 'cmd');
    assert.deepEqual(parameter(state).baselineValues, slot.mdfFallbackLinearRgba);
});
test('mod defaults have precise immutable original and current values', () => {
    const { state, slot } = fixture(false);
    slot.mdfFallbackPath = 'mod.mdf2.40'; slot.mdfFallbackLinearRgba = [.3,.4,.5,1];
    state.materialDefaultBuffers.set(slot.mdfFallbackPath, { originalMaterials: [{ name: 'cloth', customizeColors: [{ index: 0, linearRgba: [.1,.2,.3,1] }] }] });
    const p = parameter(state); assert.equal(p.source, 'mod-mdf');
    assert.deepEqual(p.baselineValues, [.1,.2,.3,1]); assert.deepEqual(p.values, [.3,.4,.5,1]);
});
test('different component defaults are unresolved until component is selected', () => {
    const { state, slot } = fixture(false); slot.mdfFallbackLinearRgba = [.1,.2,.3,1];
    slot.materialDefaultTargets = [[.1,.2,.3,1],[.9,.8,.7,1]].map((linearRgba, materialIndex) => ({sourcePath: `component${materialIndex}`, materialIndex, customizeColors:[{index:0,linearRgba}]}));
    assert.equal(parameter(state).values, null); assert.equal(parameter(state).source, 'unresolved');
    assert.equal(parameter(state).targets.length, 2);
});
test('blocked actual MDF cannot silently fall back to a stock preview value', () => {
    const { state, slot } = fixture(false); slot.mdfFallbackLinearRgba = [.1,.2,.3,1]; slot.materialEditBlockedReason = 'Ambiguous';
    assert.equal(parameter(state).values, null); assert.equal(parameter(state).editable, false);
});
test('snapshot and selection are read-only and do not alias source arrays', () => {
    const { state, slot, cmd } = fixture(); const before = cmd.workingBuffer.slice(0);
    const s = buildMaterialPreviewState(state, {revision: 3}); const m = s.materials[0]; const p = m.parameters[0];
    resolvePreviewCommand(s, {type:'select',revision:3,materialId:m.id,parameterId:p.id});
    p.cmdRgba[0] = 255; p.values[0] = 99; m.partTypes.push(999);
    assert.equal(slot.color.r,128); assert.deepEqual(cmd.workingBuffer,before); assert.deepEqual(cmd.colorClusters[0].materialPartTypes,[1]);
});
test('duplicate names get independent compound identities and palette changes invalidate identity', () => {
    const { state, cmd } = fixture(); cmd.colorClusters.push({...cmd.colorClusters[0],instanceId:3});
    const s = buildMaterialPreviewState(state); assert.notEqual(s.materials[0].id,s.materials[1].id);
    cmd.metadata.paletteNumber=2; assert.notEqual(buildMaterialPreviewState(state).materials[0].id,s.materials[0].id);
});
test('same identity collision fails closed', () => {
    const { state,cmd } = fixture();cmd.colorClusters.push(cmd.colorClusters[0]);assert.throws(()=>buildMaterialPreviewState(state),/Ambiguous/);
});
test('stale, foreign, unsupported, non-byte and read-only commands are rejected', () => {
    const { state } = fixture(); const s = buildMaterialPreviewState(state,{revision:5});const m=s.materials[0],p=m.parameters[0];
    const c={type:'edit',revision:5,materialId:m.id,parameterId:p.id,cmdRgba:[1,2,3,255]};
    assert.deepEqual(resolvePreviewCommand(s,c).cmdRgba,c.cmdRgba);
    for(const override of [{revision:4},{materialId:'cloth'},{parameterId:'0'},{type:'delete'},{cmdRgba:[NaN,2,3,4]},{cmdRgba:[256,2,3,4]},{cmdRgba:[1.5,2,3,4]}]) assert.throws(()=>resolvePreviewCommand(s,{...c,...override}));
    p.editable=false;p.blockedReason='Blocked';assert.throws(()=>resolvePreviewCommand(s,c),/Blocked/);
});
test('malformed color bytes are unresolved instead of silently clamped',()=>{
    const {state,slot}=fixture();slot.color.r=999;assert.equal(parameter(state).values,null);assert.equal(parameter(state).source,'unresolved');
});
test('empty/unloaded state clears materials and carries no guessed resource build',()=>{
    const s=buildMaterialPreviewState({cmdEntries:[]});assert.equal(s.palette,null);assert.deepEqual(s.materials,[]);assert.equal(s.resourceVersion,null);
});
test('active confirmed CMD blend rates override separately from color enabled state',()=>{const {state,cmd,slot}=fixture(false);slot.optionInstanceId=4;cmd.instanceParse={parsedInstances:[{index:4,fields:{BlendRate:{kind:'object',instanceId:5}}},{index:5,fields:{Enable:{kind:'bool',value:true},_Value:{kind:'f32',value:.75}}}]};assert.deepEqual(buildMaterialPreviewState(state).materials[0].scalarParameters,[{name:'CustomizeColor_0_BlendRate',values:[.75],enabled:true,source:'cmd'}]);cmd.instanceParse.parsedInstances[1].fields.Enable.value=false;assert.deepEqual(buildMaterialPreviewState(state).materials[0].scalarParameters,[]);});

test('an inactive slot shows its stored color unless that is a placeholder', () => {
    const { state, slot } = fixture(false);
    const storedLinear = cmdRgbaToLinearFloatRgba([128,64,32,200]);
    // Neutral stock default, and a stock default holding some other value: the stored color shows.
    for (const stock of [[128/255, 128/255, 128/255, 1], [1, 0, 0, 1]]) {
        slot.mdfFallbackLinearRgba = stock; slot.mdfFallbackPath = 'stock';
        const p = parameter(state);
        assert.equal(p.source, 'cmd-default'); assert.deepEqual(p.values, storedLinear); assert.deepEqual(p.baselineValues, p.values);
    }
    // Placeholder bytes (#808080 never set, #BBBBBB neutral) are not colors: the material default stays.
    for (const level of [128, 187]) {
        Object.assign(slot.color, { r: level, g: level, b: level });
        assert.equal(parameter(state).source, 'stock-mdf');
    }
    Object.assign(slot.color, { r: 128, g: 64, b: 32 });
    // Stored and default agree: the material file's exact floats are kept.
    slot.mdfFallbackLinearRgba = [storedLinear[0] + .001, storedLinear[1], storedLinear[2], 1];
    assert.equal(parameter(state).source, 'stock-mdf');
    // A mod's material file wins with a real default, and gives way when it is neutral.
    slot.mdfFallbackPath = 'mod.mdf2.40';
    state.materialDefaultBuffers.set(slot.mdfFallbackPath, { originalMaterials: [] });
    slot.mdfFallbackLinearRgba = [.3, .4, .5, 1];
    assert.equal(parameter(state).source, 'mod-mdf');
    slot.mdfFallbackLinearRgba = [128/255, 128/255, 128/255, 1];
    assert.equal(parameter(state).source, 'cmd-default');
});
