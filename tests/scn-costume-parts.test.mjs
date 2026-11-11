import assert from 'node:assert/strict';
import test from 'node:test';
import { findCostumeScn, readScnParts, scnCostume, scnPathFor } from '../lib/scn-costume-parts.js';
import { gatherCostumeFiles } from '../lib/game-file-source.js';
import { findMeshMdf } from '../lib/browser-asset-resolver.js';
import { defaultMeshPaths, modFolderLabels, sceneMeshOf } from '../lib/browser-preview-panel.js';

// A synthetic scene: the "SCN\0" magic, then UTF-16LE strings separated by binary filler.
function scene(strings) {
    const chunks = [Uint8Array.from([0x53, 0x43, 0x4e, 0, 1, 0, 0, 0])];
    for (const text of strings) {
        const bytes = new Uint8Array(text.length * 2 + 6);
        for (let i = 0; i < text.length; i++) bytes[i * 2] = text.charCodeAt(i);
        bytes.set([0, 0, 0xff, 0x7f, 3, 0], text.length * 2);
        chunks.push(bytes);
    }
    const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
    let offset = 0; for (const c of chunks) { out.set(c, offset); offset += c.length; }
    return out;
}
const SWAP = scene([
    'Product/CharParam/esf/esf016/prefab/esf016v00.pfb',
    '@Product/Model/esf/esf001/002/01/sakope_001_01.mesh', 'Product/Model/esf/esf001/002/01/sakope_001_01_v00.mdf2',
    '@Product/Model/esf/esf001/002/00/sakope_000_00.mesh', 'Product/Model/esf/esf001/002/00/sakope_000_00_v00.mdf2',
    '@Product/Model/esf/esf001/002/10/sakope_000_10.mesh', 'Product/Model/esf/esf016/000/10/esf016_000_10_v00.mdf2',
    'Product/Animation/esf/esf001/esf001_JointMap.jmap',
    // Scenes list their resources twice; repeats must not create second parts.
    '@Product/Model/esf/esf001/002/01/sakope_001_01.mesh', 'Product/Model/esf/esf001/002/01/sakope_001_01_v00.mdf2',
]);
const ROOT = 'natives/stm/product/model/esf/esf001/002';

test('scene paths map to costumes (vXX is costume XX + 1)', () => {
    assert.deepEqual(scnCostume('01 Main/natives/STM/product/charparam/esf/esf001/esf001v01.scn.20'), { character: 'esf001', costume: '002' });
    assert.equal(scnCostume('natives/stm/product/charparam/esf/esf001/esf002v01.scn.20'), null);
    assert.equal(scnCostume('natives/stm/product/model/esf/esf001/002/esf001_002_cmd_001.user.2'), null);
    assert.equal(scnPathFor('ESF001', '002'), 'natives/stm/product/charparam/esf/esf001/esf001v01.scn');
    assert.equal(scnPathFor('esf001', '000'), null);
});

test('scene parts are read in order, paired with their material file, without repeats', () => {
    assert.deepEqual(readScnParts(SWAP), [
        { mesh: 'product/model/esf/esf001/002/01/sakope_001_01.mesh', mdf: 'product/model/esf/esf001/002/01/sakope_001_01_v00.mdf2', folder: '01' },
        { mesh: 'product/model/esf/esf001/002/00/sakope_000_00.mesh', mdf: 'product/model/esf/esf001/002/00/sakope_000_00_v00.mdf2', folder: '00' },
        { mesh: 'product/model/esf/esf001/002/10/sakope_000_10.mesh', mdf: 'product/model/esf/esf016/000/10/esf016_000_10_v00.mdf2', folder: '10' },
    ]);
    assert.deepEqual(readScnParts(new Uint8Array(64)), []);
    assert.deepEqual(readScnParts(new TextEncoder().encode('not a scene')), []);
    assert.equal(findCostumeScn({ 'a/natives/stm/product/charparam/esf/esf001/esf001v01.scn.20': SWAP }, { character: 'esf001', costume: '001' }), null);
    assert.equal(findCostumeScn({ 'a/natives/stm/product/charparam/esf/esf001/esf001v01.scn.20': SWAP }, { character: 'ESF001', costume: '002' }).parts.length, 3);
});

test('a mod scene decides the parts: swapped meshes are used and the stock body is not fetched', async () => {
    const read = [];
    const game = { read: async path => { read.push(path); return path === 'natives/stm/product/model/esf/esf016/000/10/esf016_000_10_v00.mdf2.31' ? new Uint8Array(4) : null; } };
    const have = {
        'main/natives/stm/product/charparam/esf/esf001/esf001v01.scn.20': SWAP,
        ['legs a/' + ROOT + '/01/sakope_001_01.mesh.230110883']: new Uint8Array(1),
        ['legs b/' + ROOT + '/01/sakope_001_01.mesh.230110883']: new Uint8Array(1),
        ['main/' + ROOT + '/00/sakope_000_00.mesh.230110883']: new Uint8Array(1),
        ['main/' + ROOT + '/10/sakope_000_10.mesh.230110883']: new Uint8Array(1),
    };
    const result = await gatherCostumeFiles({ paks: [game], character: 'esf001', costume: '002', have });
    assert.equal(result.scene.source, 'mod');
    assert.deepEqual(result.parts.map(p => `${p.folder}:${p.source}`), ['01:mod', '00:mod', '10:mod']);
    // Only what the mod lacks is read from the game; no stock esf001_002_01 body is probed.
    assert.ok(!read.some(path => /esf001_002_0\d\.mesh/.test(path)), read.join('\n'));
    assert.deepEqual(Object.keys(result.entries), ['natives/stm/product/model/esf/esf016/000/10/esf016_000_10_v00.mdf2.31']);
});

test('without a mod scene the game scene is used, and without any scene the folders are probed', async () => {
    const stock = scene(['@Product/Model/esf/esf001/005/01/esf001_005_01.mesh', 'Product/Model/esf/esf001/005/01/esf001_005_01_v00.mdf2',
        '@Product/Model/esf/esf001/001/02/esf001_001_02.mesh', 'Product/Model/esf/esf001/001/02/esf001_001_02_v00.mdf2']);
    const files = new Map([
        ['natives/stm/product/charparam/esf/esf001/esf001v04.scn.20', stock],
        ['natives/stm/product/model/esf/esf001/005/01/esf001_005_01.mesh.230110883', new Uint8Array(2)],
        ['natives/stm/product/model/esf/esf001/001/02/esf001_001_02.mesh.230110883', new Uint8Array(2)],
    ]);
    const game = { read: async path => files.get(path) ?? null };
    const viaScene = await gatherCostumeFiles({ paks: [game], character: 'esf001', costume: '005' });
    assert.equal(viaScene.scene.source, 'game');
    assert.deepEqual(viaScene.parts.map(p => `${p.borrowedFrom ?? 'own'}/${p.folder}`), ['own/01', '001/02']);
    files.delete('natives/stm/product/charparam/esf/esf001/esf001v04.scn.20');
    const viaFolders = await gatherCostumeFiles({ paks: [game], character: 'esf001', costume: '005' });
    assert.equal(viaFolders.scene, null);
    assert.deepEqual(viaFolders.parts.map(p => `${p.borrowedFrom ?? 'own'}/${p.folder}`), ['own/01', '001/02']);
});

test('default meshes and material files follow the scene', () => {
    const parts = readScnParts(SWAP);
    const paths = [
        'legs a/' + ROOT + '/01/sakope_001_01.mesh.230110883', 'legs b/' + ROOT + '/01/sakope_001_01.mesh.230110883',
        'main/' + ROOT + '/00/sakope_000_00.mesh.230110883', 'main/' + ROOT + '/10/sakope_000_10.mesh.230110883',
        // A stock body that is not in the scene must not be switched on beside the swap.
        'natives/stm/product/model/esf/esf001/002/01/esf001_002_01.mesh.230110883',
    ];
    assert.deepEqual([...defaultMeshPaths(paths, { character: 'esf001', costume: '002' }, parts)].sort(), [paths[0], paths[2], paths[3]].sort());
    assert.equal(sceneMeshOf(paths[1], parts).folder, '01');
    assert.equal(sceneMeshOf(paths[4], parts), null);
    // Without scene parts the old rule still applies (the exact game file name wins).
    assert.ok(defaultMeshPaths(paths, { character: 'esf001', costume: '002' }).has(paths[4]));
    const entries = {
        ['main/' + ROOT + '/01/sakope_001_01_v00.mdf2.31']: new Uint8Array(1),
        'natives/stm/product/model/esf/esf016/000/10/esf016_000_10_v00.mdf2.31': new Uint8Array(1),
    };
    // A material file with another name, in another folder, is found through the scene's hint.
    assert.equal(findMeshMdf(entries, paths[3]), null);
    assert.equal(findMeshMdf(entries, paths[3], parts[2].mdf), 'natives/stm/product/model/esf/esf016/000/10/esf016_000_10_v00.mdf2.31');
    assert.equal(findMeshMdf(entries, paths[0], parts[0].mdf), 'main/' + ROOT + '/01/sakope_001_01_v00.mdf2.31');
});

test('mod folders are labelled by what their names do not share', () => {
    assert.deepEqual([...modFolderLabels(['Leon-Requiem-Luke-C1-Main', 'Leon-Requiem-Luke-C1-Muscles', 'Leon-Requiem-Luke-C1-Original-Hair']).values()], ['Main', 'Muscles', 'Original-Hair']);
    assert.deepEqual([...modFolderLabels(['03 Original legs - Swimsuit Sakura as Ryu C2', '04 Slender legs - Swimsuit Sakura as Ryu C2']).values()], ['Original legs', 'Slender legs']);
    assert.deepEqual([...modFolderLabels(['Only One']).values()], ['Only One']);
    assert.deepEqual([...modFolderLabels(['', 'A', 'A']).keys()], ['A']);
});
