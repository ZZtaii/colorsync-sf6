import test from 'node:test';
import assert from 'node:assert/strict';
import * as zlib from 'node:zlib';
import { deflateSync } from '../lib/fflate.js';
import { decompressZstd } from '../lib/zstd-decoder.js';
import { murmur3Utf16, pakPathHashes, openPak } from '../lib/re-pak-reader.js';
import { gatherCostumeFiles, costumeFromPath, PREVIEW_TEXTURE_SLOTS } from '../lib/game-file-source.js';

const hasZstd = typeof zlib.zstdCompressSync === 'function';
const bytes = text => new TextEncoder().encode(text);
/** Deterministic pseudo-random bytes. */
function noise(length, seed = 1) { const out = new Uint8Array(length); let s = seed >>> 0; for (let i = 0; i < length; i++) { s = Math.imul(s, 1664525) + 1013904223 >>> 0; out[i] = s >>> 24; } return out; }

/** Builds a KPKA v4 PAK in memory. files: [{ path, data, compression: 'none'|'deflate'|'zstd' }] */
function buildPak(files, { major = 4, features = 0 } = {}) {
    const stored = files.map(f => f.compression === 'deflate' ? deflateSync(f.data) : f.compression === 'zstd' ? new Uint8Array(zlib.zstdCompressSync(f.data)) : f.data);
    const head = new Uint8Array(16 + files.length * 48), view = new DataView(head.buffer);
    view.setUint32(0, 0x414B504B, true); view.setUint8(4, major); view.setUint16(6, features, true); view.setUint32(8, files.length, true);
    let offset = head.length;
    files.forEach((file, i) => {
        const at = 16 + i * 48, { lower, upper } = pakPathHashes(file.path);
        view.setUint32(at, lower, true); view.setUint32(at + 4, upper, true);
        view.setBigUint64(at + 8, BigInt(offset), true); view.setBigUint64(at + 16, BigInt(stored[i].length), true); view.setBigUint64(at + 24, BigInt(file.data.length), true);
        view.setBigUint64(at + 32, BigInt({ none: 0, deflate: 1, zstd: 2 }[file.compression]), true);
        offset += stored[i].length;
    });
    const all = new Uint8Array(offset); all.set(head); let at = head.length;
    for (const blob of stored) { all.set(blob, at); at += blob.length; }
    const reads = [];
    return { reads, source: { name: 'test.pak', size: all.length, read: async (o, l) => { reads.push([o, l]); return all.subarray(o, o + l); } } };
}

test('path hashes are MurmurHash3 over UTF-16 text and match values read from a real SF6 PAK', () => {
    assert.equal(murmur3Utf16('', 0), 0);
    // These two were found in the game PAK's table for this exact path.
    assert.deepEqual(pakPathHashes('natives/stm/product/model/esf/esf001/001/01/esf001_001_01.mesh.230110883'), REAL_HASH);
    assert.deepEqual(pakPathHashes('\\Natives\\STM\\product/model/esf/esf001/001/01/ESF001_001_01.mesh.230110883'), REAL_HASH, 'slashes and letter case do not matter');
});
const REAL_HASH = { lower: 2464832767, upper: 3877211120 };

test('PAK reader finds files by path and unpacks stored and deflated entries', async () => {
    const text = bytes('colour '.repeat(500)), raw = noise(300);
    const { source, reads } = buildPak([{ path: 'natives/stm/a/one.tex.1', data: text, compression: 'deflate' }, { path: 'natives/stm/a/two.mesh.2', data: raw, compression: 'none' }]);
    const pak = await openPak(source);
    assert.equal(pak.fileCount, 2);
    assert.equal(pak.has('NATIVES/STM/A/ONE.TEX.1'), true);
    assert.deepEqual(await pak.read('natives/stm/a/one.tex.1'), text);
    assert.deepEqual(await pak.read('natives\\stm\\a\\two.mesh.2'), raw);
    assert.equal(await pak.read('natives/stm/a/absent.tex.1'), null);
    assert.ok(reads.every(([, length]) => length <= 16 + 2 * 48 || length <= 600), 'only the header, the table and the requested files are read');
});

test('PAK reader rejects files it cannot read safely', async () => {
    await assert.rejects(openPak({ size: 20, read: async () => new Uint8Array(16) }), /KPKA/);
    await assert.rejects(openPak(buildPak([], { major: 2 }).source), /Unsupported PAK version/);
    await assert.rejects(openPak(buildPak([], { features: 8 }).source), /encrypted/);
    const truncated = buildPak([{ path: 'a.tex.1', data: noise(50), compression: 'none' }]).source;
    await assert.rejects(openPak({ ...truncated, size: 40 }), /damaged or truncated/);
});

test('zstd decoder matches the reference on varied inputs', { skip: !hasZstd && 'this Node has no zstd' }, () => {
    const samples = [
        new Uint8Array(0), bytes('a'), new Uint8Array(5000).fill(7), bytes('the quick brown fox '.repeat(4000)),
        noise(70000, 3), Uint8Array.from({ length: 400000 }, (_, i) => (i * i >>> 5) & 31),
        (() => { const mixed = noise(300000, 9); for (let i = 0; i < mixed.length; i += 7) mixed[i] = 65; mixed.fill(0, 100000, 180000); return mixed; })(),
    ];
    for (const sample of samples) for (const level of [1, 3, 19]) {
        const packed = new Uint8Array(zlib.zstdCompressSync(sample, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level } }));
        assert.deepEqual(decompressZstd(packed, sample.length), sample, `length ${sample.length}, level ${level}`);
    }
});

test('zstd decoder refuses damaged data and wrong sizes instead of writing out of bounds', { skip: !hasZstd && 'this Node has no zstd' }, () => {
    const sample = bytes('street fighter '.repeat(300)), packed = new Uint8Array(zlib.zstdCompressSync(sample));
    assert.throws(() => decompressZstd(packed, sample.length - 1), /Invalid zstd data/);
    assert.throws(() => decompressZstd(packed, sample.length + 1), /Invalid zstd data/);
    assert.throws(() => decompressZstd(packed.subarray(0, packed.length - 6), sample.length), /Invalid zstd data/);
    assert.throws(() => decompressZstd(bytes('not zstd at all'), 10), /Invalid zstd data/);
    for (let i = 4; i < packed.length; i += 3) { const broken = packed.slice(); broken[i] ^= 0x5A; try { decompressZstd(broken, sample.length); } catch (error) { assert.match(error.message, /Invalid zstd data|offset is out of bounds|Source is too large/); } }
});

test('PAK reader unpacks zstd entries', { skip: !hasZstd && 'this Node has no zstd' }, async () => {
    const data = bytes('mask '.repeat(3000));
    const pak = await openPak(buildPak([{ path: 'natives/stm/z.tex.1', data, compression: 'zstd' }]).source);
    assert.deepEqual(await pak.read('natives/stm/z.tex.1'), data);
});

test('costume is recognised from any costume file path', () => {
    assert.deepEqual(costumeFromPath('Mod\\natives\\STM\\product\\model\\esf\\esf032\\002\\esf032_002_cmd_001.user.2'), { character: 'esf032', costume: '002' });
    assert.equal(costumeFromPath('natives/stm/product/model/cmn/thing.mesh.1'), null);
});

test('gatherer fetches stock parts and only the textures the preview reads, and lets the mod win', async () => {
    const { makeMdfWithTextures } = await import('./fixtures/mdf-textures.mjs');
    const root = 'natives/stm/product/model/esf/esf009/003';
    const stockMdf = makeMdfWithTextures('esf_Head00', [['BaseDielectricMap', 'Product/Model/esf/esf009/003/00/head_ALBD.tex'], ['NormalRoughnessCavityMap', 'Product/Model/esf/esf009/003/00/head_NRRC.tex'], ['CustomizeColor_Mask', 'Product/MasterMaterial/texture/Null_RGBA_255_0_0_0.tex']]);
    const modMdf = makeMdfWithTextures('esf_Body00', [['BaseDielectricMap', 'Product/Model/esf/esf009/003/01/mod_ALBD.tex'], ['CustomizeColor_Mask', 'Product/Model/esf/esf009/001/01/shared_CMASK.tex'], ['AlphaTranslucentOcclusionSSSMap', 'Product/Model/esf/esf009/003/01/gone_ATOS.tex']]);
    const game = {
        [`${root}/00/esf009_003_00.mesh.230110883`]: noise(40, 1), [`${root}/00/esf009_003_00_v00.mdf2.31`]: stockMdf,
        [`${root}/01/esf009_003_01.mesh.230110883`]: noise(40, 2), [`${root}/01/esf009_003_01_v00.mdf2.31`]: noise(10, 5),
        'natives/stm/product/model/esf/esf009/003/00/head_albd.tex.241101895': noise(30, 3),
        'natives/stm/product/model/esf/esf009/003/00/head_nrrc.tex.241101895': noise(30, 4),
        'natives/stm/product/model/esf/esf009/001/01/shared_cmask.tex.143230113': noise(30, 6),
        'natives/stm/product/model/esf/esf009/003/01/mod_albd.tex.241101895': noise(30, 7),
    };
    const asked = [];
    const pak = { read: async path => { if (!(path.toLowerCase() in game)) return null; asked.push(path); return game[path.toLowerCase()]; } };
    const have = { [`Mod/${root}/01/esf009_003_01.mesh.230110883`]: noise(40, 8), [`Mod/${root}/01/esf009_003_01_v00.mdf2.31`]: modMdf, 'Mod/natives/stm/product/model/esf/esf009/003/01/mod_albd.tex.241101895': noise(30, 9) };
    const result = await gatherCostumeFiles({ paks: [pak], character: 'esf009', costume: '003', have });
    assert.deepEqual(Object.keys(result.entries).sort(), [
        'natives/stm/product/model/esf/esf009/001/01/shared_cmask.tex.143230113',
        `${root}/00/esf009_003_00.mesh.230110883`, `${root}/00/esf009_003_00_v00.mdf2.31`,
        'natives/stm/product/model/esf/esf009/003/00/head_albd.tex.241101895',
    ].sort());
    assert.deepEqual(result.parts.map(p => `${p.folder}:${p.source}`), ['00:game', '01:mod']);
    assert.equal(result.textures, 2);
    assert.deepEqual(result.missing, ['natives/stm/product/model/esf/esf009/003/01/gone_atos.tex']);
    assert.ok(!asked.some(path => /nrrc|null_rgba|esf009_003_01\.mesh|mod_albd/.test(path)), 'normal maps, placeholders and mod-provided files are never read from the game');
    assert.ok(PREVIEW_TEXTURE_SLOTS.has('CustomizeColor_Mask2') && !PREVIEW_TEXTURE_SLOTS.has('NormalRoughnessCavityMap'));
});

/** In-memory stand-in for the browser's folder handles. tree: { name: Uint8Array | subtree } */
function fakeDirectory(tree, name = 'root') {
    const missing = () => Object.assign(new Error('missing'), { name: 'NotFoundError' });
    return {
        kind: 'directory', name,
        async *values() { for (const [key, value] of Object.entries(tree)) yield value instanceof Uint8Array ? { kind: 'file', name: key, getFile: async () => ({ name: key, size: value.length, arrayBuffer: async () => value.slice().buffer }) } : fakeDirectory(value, key); },
        async getDirectoryHandle(key) { const hit = Object.entries(tree).find(([k, v]) => k.toLowerCase() === key.toLowerCase() && !(v instanceof Uint8Array)); if (!hit) throw missing(); return fakeDirectory(hit[1], hit[0]); },
        async getFileHandle(key) { const hit = Object.entries(tree).find(([k, v]) => k.toLowerCase() === key.toLowerCase() && v instanceof Uint8Array); if (!hit) throw missing(); return { getFile: async () => ({ name: hit[0], size: hit[1].length, arrayBuffer: async () => hit[1].slice().buffer }) }; },
    };
}

test('game folder yields PAKs in load order and a loose natives source that outranks them', async () => {
    const { sourcesFromDirectory, looseFolderSource } = await import('../lib/game-folder.js');
    const root = 'natives/stm/product/model/esf/esf009/003', mesh = `${root}/00/esf009_003_00.mesh.230110883`;
    const folder = fakeDirectory({
        'StreetFighter6.exe': noise(4), 're_chunk_000.pak.patch_001.pak': noise(16, 2), 're_chunk_000.pak': noise(16, 1),
        dlc: { 're_dlc_stm_2.pak': noise(16, 4), 're_dlc_stm_1.pak': noise(16, 3), 'readme.txt': noise(3) },
        natives: { stm: { product: { model: { esf: { esf009: { '003': { '00': { 'esf009_003_00.mesh.230110883': noise(8, 9) } } } } } } } },
    });
    const found = await sourcesFromDirectory(folder);
    assert.deepEqual(found.pakFiles.map(f => f.name), ['re_chunk_000.pak', 're_chunk_000.pak.patch_001.pak', 're_dlc_stm_1.pak', 're_dlc_stm_2.pak']);
    assert.deepEqual(await found.loose.read(mesh), noise(8, 9));
    assert.equal(await found.loose.read(`${root}/01/esf009_003_01.mesh.230110883`), null);
    assert.equal(await found.loose.read('natives/../secret.txt'), null);
    assert.equal(await found.loose.read('other/stm/file.tex.1'), null);
    const pak = { read: async path => path === mesh ? noise(8, 1) : null };
    const result = await gatherCostumeFiles({ paks: [pak, found.loose], character: 'esf009', costume: '003' });
    assert.deepEqual(result.entries[mesh], noise(8, 9), 'an installed mod in natives is what the game shows, so it wins over the PAK');
    await assert.rejects(sourcesFromDirectory(fakeDirectory({ 'notes.txt': noise(2) })), /No \.pak files/);
    assert.equal(looseFolderSource(fakeDirectory({})).name, 'natives folder');
});

test('gatherer prefers later PAKs and reports unreadable files without stopping', async () => {
    const root = 'natives/stm/product/model/esf/esf009/003', mesh = `${root}/00/esf009_003_00.mesh.230110883`;
    const base = { read: async path => path === mesh ? noise(8, 1) : null };
    const patch = { read: async path => path === mesh ? noise(8, 2) : null };
    const first = await gatherCostumeFiles({ paks: [base, patch], character: 'esf009', costume: '003' });
    assert.deepEqual(first.entries[mesh], noise(8, 2));
    const broken = { read: async path => { if (path === mesh) throw new Error('boom'); return null; } };
    const second = await gatherCostumeFiles({ paks: [broken], character: 'esf009', costume: '003' });
    assert.deepEqual(second.entries, {});
    assert.equal(second.errors[0].message, 'boom');
    await assert.rejects(gatherCostumeFiles({ paks: [], character: 'esf009', costume: '003' }), /at least one/);
    await assert.rejects(gatherCostumeFiles({ paks: [base], character: '../x', costume: '003' }), /character and costume/);
});
