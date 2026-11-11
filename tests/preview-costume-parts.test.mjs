// Which costume an import is about, which meshes open by default, and where shared parts come from.
// The path layouts below are copied from real mods (file contents are not needed for these rules).
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeMeshPath, pickCostume, defaultMeshPaths, summarizeMaterialNotes } from '../lib/browser-preview-panel.js';
import { gatherCostumeFiles } from '../lib/game-file-source.js';
import { findMeshMdf } from '../lib/browser-asset-resolver.js';

const blob = n => new Uint8Array([n, n, n, n]);
const ESF = 'natives/stm/product/model/esf';
const mesh = (character, costume, part, prefix = '') => `${ESF}/${character}/${costume}/${part}/${prefix}${character}_${costume}_${part}.mesh.230110883`;
const cmd = (character, costume, n = '000', name = 'CMD') => `${ESF}/${character}/${costume}/${character}_${costume}_${name}_${n}.user.2`;

test('mesh paths are described by character, costume, part and variant', () => {
    assert.deepEqual(describeMeshPath(mesh('esf009', '001', '01')), { character: 'esf009', costume: '001', part: '01', variant: '', canonical: true });
    assert.deepEqual(describeMeshPath(`Mod Folder\\${mesh('esf009', '001', '01', 'No Cape ').replaceAll('/', '\\')}`),
        { character: 'esf009', costume: '001', part: '01', variant: 'No Cape', canonical: false });
    assert.equal(describeMeshPath(mesh('esf030', '001', '01', '2 ')).variant, '2');
    assert.equal(describeMeshPath(mesh('esf013', '001', '01', 'FOR NO HOOD ')).variant, 'FOR NO HOOD');
    assert.equal(describeMeshPath(`${ESF}/esf009/001/01/custom_body.mesh.230110883`).variant, 'custom body');
    assert.deepEqual(describeMeshPath('esf001_001_01.mesh.230110883'), { character: '', costume: '', part: '', variant: '', canonical: false });
});

test('the costume comes from the CMD files, not from a shared head in folder 000', () => {
    // Aki Nun: head and hair replace the shared 000 files, the body and CMDs are costume 001.
    const aki = [mesh('esf013', '000', '00'), mesh('esf013', '000', '02'), cmd('esf013', '001'), mesh('esf013', '001', '01')];
    assert.deepEqual(pickCostume(aki), { character: 'esf013', costume: '001' });
    // No CMD at all (Manon Sailor): textures in 000 come first in the ZIP, the mesh decides.
    const manon = [`${ESF}/esf005/000/01/esf005_000_01_body_albd.tex.143230113`, mesh('esf005', '001', '01')];
    assert.deepEqual(pickCostume(manon), { character: 'esf005', costume: '001' });
    // Only the shared folder is present: it is still an answer.
    assert.deepEqual(pickCostume([mesh('esf013', '000', '00')]), { character: 'esf013', costume: '000' });
    assert.equal(pickCostume([]), null);
    assert.equal(pickCostume(['readme.txt', 'modinfo.ini']), null);
});

test('the active CMD wins when the import contains its costume or has no costume paths', () => {
    const pack = [cmd('esf032', '002', '000', 'cmd'), mesh('esf032', '002', '01'), mesh('esf032', '005', '01')];
    assert.deepEqual(pickCostume(pack, { character: 'esf032', costume: '005' }), { character: 'esf032', costume: '005' });
    // Loose CMD files carry no paths: only the active CMD knows the costume.
    assert.deepEqual(pickCostume([], { character: 'esf001', costume: '001' }), { character: 'esf001', costume: '001' });
    // A CMD left over from an earlier import must not decide for a new, different import.
    assert.deepEqual(pickCostume(pack, { character: 'esf030', costume: '001' }), { character: 'esf032', costume: '002' });
});

test('default meshes: one per part, own costume first, then the shared folder, never a variant over the real file', () => {
    const supergirl = [mesh('esf009', '001', '01', 'Cape '), mesh('esf009', '001', '01'), mesh('esf009', '001', '01', 'No Cape '), mesh('esf009', '000', '00'), mesh('esf009', '001', '02')];
    assert.deepEqual([...defaultMeshPaths(supergirl, { character: 'esf009', costume: '001' })].sort(),
        [mesh('esf009', '000', '00'), mesh('esf009', '001', '01'), mesh('esf009', '001', '02')].sort());
    // Only variants exist for the body: the first one is shown rather than nothing.
    const onlyVariants = [mesh('esf009', '001', '01', 'B '), mesh('esf009', '001', '01', 'A ')];
    assert.deepEqual([...defaultMeshPaths(onlyVariants, { character: 'esf009', costume: '001' })], [mesh('esf009', '001', '01', 'A ')]);
});

test('default meshes: parts of another costume stay optional', () => {
    // Ingrid pack for costumes 002 and 005, plus the stock head and an extra part read from the game.
    const pack = [mesh('esf032', '002', '00'), mesh('esf032', '002', '01'), mesh('esf032', '002', '02'), mesh('esf032', '005', '01'), mesh('esf032', '002', '10')];
    assert.deepEqual([...defaultMeshPaths(pack, { character: 'esf032', costume: '002' })].sort(),
        [mesh('esf032', '002', '00'), mesh('esf032', '002', '01'), mesh('esf032', '002', '02')].sort());
    // Costume 005 has only a body; hair from costume 001 is a stand-in and is not switched on by itself.
    const five = [mesh('esf032', '005', '01'), mesh('esf032', '000', '00'), mesh('esf032', '001', '02'), mesh('esf032', '002', '01')];
    assert.deepEqual([...defaultMeshPaths(five, { character: 'esf032', costume: '005' })].sort(),
        [mesh('esf032', '000', '00'), mesh('esf032', '005', '01')].sort());
    // The body of another costume is never shown in place of a missing one.
    assert.deepEqual([...defaultMeshPaths([mesh('esf004', '001', '01'), mesh('esf004', '000', '00')], { character: 'esf004', costume: '002' })], [mesh('esf004', '000', '00')]);
});

test('default meshes: no known costume and files outside the game layout', () => {
    const aki = [mesh('esf013', '000', '00'), mesh('esf013', '000', '02'), mesh('esf013', '001', '01')];
    assert.deepEqual([...defaultMeshPaths(aki)].sort(), [...aki].sort(), 'the body decides the costume, the shared head and hair join it');
    const loose = ['esf001_001_00.mesh.230110883', 'esf001_001_01.mesh.230110883'];
    assert.deepEqual([...defaultMeshPaths(loose)], loose, 'loose files are all shown');
    assert.deepEqual([...defaultMeshPaths([])], []);
});

test('a variant mesh uses the material file of its costume part folder', () => {
    const root = 'Cammy - Supergirl/', mdf = `${ESF}/esf009/001/01/esf009_001_01_v00.mdf2.31`;
    const variant = root + mesh('esf009', '001', '01', 'No Cape ');
    assert.equal(findMeshMdf({ [root + mdf]: blob(1), [variant]: blob(2) }, variant), root + mdf, 'the file next to it');
    assert.equal(findMeshMdf({ [mdf]: blob(1), [variant]: blob(2) }, variant), mdf, 'or the stock one read from the game');
    assert.equal(findMeshMdf({ [`${ESF}/esf009/001/02/esf009_001_02_v00.mdf2.31`]: blob(1) }, variant), null, 'never another part');
    const real = root + mesh('esf009', '001', '01');
    assert.equal(findMeshMdf({ [root + mdf]: blob(1) }, real), root + mdf, 'the real file is unchanged');
    assert.equal(findMeshMdf({ 'a/body.mdf2.31': blob(1) }, 'a/other.mesh.1'), null, 'no guessing outside the costume layout');
});

test('material notes are reduced to the few that change what is shown', () => {
    // Notes exactly as lib/sf6-browser-materials.js writes them (taken from the Ingrid Frieren mod).
    const report = [
        { name: 'esf_Head00', notes: ['mask mapping inferred from the shared CustomizeColor layout (character_face.mmtrs); not checked against this shader.'] },
        { name: 'esf_Eye00', notes: ['CustomizeColor_2_BlendRate outside supported 0..1 range; slot not previewed.', 'mask mapping inferred from the shared CustomizeColor layout (character_eye.mmtrs); not checked against this shader.'] },
        { name: 'esf_Tear00', notes: ['eye-tear/refraction layer omitted: no false opaque gray lens. Refraction is unsupported.'] },
        { name: 'esf_ClothA_Dress', notes: ['specialized finish/detail terms are not reproduced (ClothAniso_PrimalySpecularColor).'] },
        { name: 'esf_ClothB_Mantle', notes: ['CustomizeColor_3_BlendRate outside supported 0..1 range; slot not previewed.'] },
        { name: 'esf_HairFront1', notes: ['CustomizeColor_Mask could not decode: Only single-image 2D TEX files are supported (no arrays, volumes or cubemaps)', 'those slots are not previewed.'] },
        { name: 'esf_SideHair', notes: ['hair base color/uniform tint and UV0 cutouts only; anisotropy, strand lighting and smooth transparency are not reproduced.'] },
        { name: 'esf_Teeth', notes: ['no matching MDF; neutral gray.'] },
        { name: 'esf_Odd', notes: ['ambiguous albedo binding; not guessed.'] },
        { name: 'esf_Plain' },
    ];
    const { issues, routine } = summarizeMaterialNotes(report);
    assert.deepEqual(issues, [
        { label: 'Color slot not shown', materials: ['esf_Eye00 (slot 2)', 'esf_ClothB_Mantle (slot 3)'] },
        { label: 'Texture could not be read', materials: ['esf_HairFront1'] },
        { label: 'No material data', materials: ['esf_Teeth'] },
        { label: 'Ambiguous albedo binding; not guessed', materials: ['esf_Odd'] },
    ]);
    assert.equal(routine, 6);
    assert.deepEqual(summarizeMaterialNotes([]), { issues: [], routine: 0 });
    assert.deepEqual(summarizeMaterialNotes(undefined), { issues: [], routine: 0 });
});

/** A game source backed by a plain { path: bytes } map. */
const fakeGame = files => ({ read: async path => files[path] ?? null });

test('game files: a costume without its own head or hair borrows the shared folder, then a stand-in', async () => {
    const files = {
        [mesh('esf001', '005', '01')]: blob(1),
        [mesh('esf001', '000', '00')]: blob(2),
        [mesh('esf001', '001', '02')]: blob(3),
        [mesh('esf001', '002', '02')]: blob(4),
        [mesh('esf001', '001', '01')]: blob(5),
    };
    const result = await gatherCostumeFiles({ paks: [fakeGame(files)], character: 'esf001', costume: '005' });
    assert.deepEqual(result.parts.map(part => [part.folder, part.source, part.borrowedFrom]), [['01', 'game', null], ['00', 'game', '000'], ['02', 'game', '001']]);
    assert.deepEqual(Object.keys(result.entries).sort(), [mesh('esf001', '005', '01'), mesh('esf001', '000', '00'), mesh('esf001', '001', '02')].sort());
});

test('game files: own parts are never replaced, the body is never borrowed, a bald fighter stays bald', async () => {
    const own = { [mesh('esf017', '002', '00')]: blob(1), [mesh('esf017', '002', '01')]: blob(2), [mesh('esf017', '002', '02')]: blob(3), [mesh('esf017', '000', '00')]: blob(9) };
    const full = await gatherCostumeFiles({ paks: [fakeGame(own)], character: 'esf017', costume: '002' });
    assert.deepEqual(full.parts.map(part => [part.folder, part.borrowedFrom]), [['00', null], ['01', null], ['02', null]]);
    // The stock body is hidden (a mod is installed): head and hair still come, no other costume's body does.
    const hidden = { [mesh('esf004', '002', '02')]: blob(1), [mesh('esf004', '000', '00')]: blob(2), [mesh('esf004', '001', '01')]: blob(3) };
    const partial = await gatherCostumeFiles({ paks: [fakeGame(hidden)], character: 'esf004', costume: '002' });
    assert.deepEqual(partial.parts.map(part => [part.folder, part.borrowedFrom]), [['02', null], ['00', '000']]);
    const bald = await gatherCostumeFiles({ paks: [fakeGame({ [mesh('esf008', '001', '00')]: blob(1), [mesh('esf008', '001', '01')]: blob(2) })], character: 'esf008', costume: '001' });
    assert.deepEqual(bald.parts.map(part => part.folder), ['00', '01']);
});

test('game files: a shared head shipped by the mod is used instead of the game one', async () => {
    const modHead = `Aki - Nun/${mesh('esf013', '000', '00')}`, modBody = `Aki - Nun/${mesh('esf013', '001', '01')}`;
    const game = { [mesh('esf013', '000', '00')]: blob(7), [mesh('esf013', '000', '02')]: blob(8) };
    const result = await gatherCostumeFiles({ paks: [fakeGame(game)], character: 'esf013', costume: '001', have: { [modHead]: blob(1), [modBody]: blob(2) } });
    assert.deepEqual(result.parts.map(part => [part.folder, part.source, part.borrowedFrom]), [['01', 'mod', null], ['00', 'mod', '000'], ['02', 'game', '000']]);
    assert.deepEqual(Object.keys(result.entries), [mesh('esf013', '000', '02')], 'only what the mod lacks is read from the game');
});
