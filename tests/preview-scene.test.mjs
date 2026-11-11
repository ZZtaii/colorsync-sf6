import test from 'node:test';
import assert from 'node:assert/strict';
import { combinePreviewMeshes, pickPreviewMip, createBrowserSceneAssetResolver } from '../lib/browser-asset-resolver.js';
import { constantTextureFor } from '../lib/sf6-constant-textures.js';
import { previewCamera, DEFAULT_PREVIEW_VIEW } from '../lib/material-webgl-preview.js';
import { makeMdf } from './fixtures/mdf.mjs';

test('scene combination records which mesh each material came from', () => {
    const scene = combinePreviewMeshes([
        { materialNames: ['skin', 'hair'], parts: [{ materialIndex: 1 }], warnings: ['w'] },
        { materialNames: ['hair'], parts: [{ materialIndex: 0 }], warnings: ['w'] },
    ]);
    assert.deepEqual(scene.materialNames, ['skin', 'hair', 'hair']);
    assert.deepEqual(scene.materialMeshIndex, [0, 0, 1]);
    assert.deepEqual(scene.parts.map(p => p.materialIndex), [1, 2]);
    assert.deepEqual(scene.warnings, ['w']);
});

test('preview mip is the largest level inside the budget, else the smallest available', () => {
    const mips = [2048, 1024, 512, 256].map(size => ({ width: size, height: size }));
    assert.equal(pickPreviewMip(mips, 512), 2);
    assert.equal(pickPreviewMip(mips, 4096), 0);
    assert.equal(pickPreviewMip(mips.slice(0, 2), 512), 1);
});

test('engine placeholder textures resolve to their real texel values', () => {
    assert.deepEqual([...constantTextureFor('systems/rendering/NullWhite.tex').data], [255, 255, 255, 255]);
    // The file name says alpha 0, but the game file is BC1 and decodes to opaque.
    assert.deepEqual([...constantTextureFor('Product/MasterMaterial/texture/Null_RGBA_255_0_0_0.tex').data], [255, 0, 0, 255]);
    assert.deepEqual([...constantTextureFor('natives/stm/systems/rendering/nullatos.tex.241101895').data], [255, 0, 255, 255]);
    assert.equal(constantTextureFor('product/model/esf/esf001/001/01/real_albd.tex'), null);
    assert.equal(constantTextureFor('systems/rendering/NullWhite.tex'), constantTextureFor('systems/rendering/nullwhite'));
});

test('scene resolver answers materials per mesh and falls back to placeholder textures', async () => {
    const mdf = color => new Uint8Array(makeMdf([{ name: 'esf_Hair00', colors: [{ index: 0, values: color }] }], 31));
    const entries = {
        'natives/stm/model/a/head.mesh.1': new Uint8Array(1),
        'natives/stm/model/a/head_v00.mdf2.31': mdf([1, 0, 0, 1]),
        'natives/stm/model/a/hair.mesh.1': new Uint8Array(1),
        'natives/stm/model/a/hair_v00.mdf2.31': mdf([0, 1, 0, 1]),
        'natives/stm/model/a/lone.mesh.1': new Uint8Array(1),
    };
    const scene = createBrowserSceneAssetResolver(entries, ['natives/stm/model/a/head.mesh.1', 'natives/stm/model/a/hair.mesh.1', 'natives/stm/model/a/lone.mesh.1']);
    assert.equal(scene.mdfMaterials.length, 2, 'both distinct esf_Hair00 materials are kept');
    assert.deepEqual(scene.materialFor(0, 'esf_Hair00').customizeColors[0].linearRgba.slice(0, 3), [1, 0, 0]);
    assert.deepEqual(scene.materialFor(1, 'esf_Hair00').customizeColors[0].linearRgba.slice(0, 3), [0, 1, 0]);
    assert.equal(scene.materialFor(2, 'esf_Hair00'), null);
    assert.deepEqual(scene.missingMdfPaths, ['natives/stm/model/a/lone.mesh.1']);
    assert.deepEqual([...(await scene.resolveTexture({ slot: 'x', path: 'systems/rendering/NullWhite.tex' })).data], [255, 255, 255, 255]);
    assert.equal(await scene.resolveTexture({ slot: 'x', path: 'model/a/absent.tex' }), null);
});

test('orbit camera keeps the model centred and pans in screen space', () => {
    const centred = previewCamera(DEFAULT_PREVIEW_VIEW, 1);
    assert.ok(Math.abs(Math.hypot(...centred.eye) - DEFAULT_PREVIEW_VIEW.distance) < 1e-6);
    const project = (mvp, p) => { const w = mvp[3] * p[0] + mvp[7] * p[1] + mvp[11] * p[2] + mvp[15]; return [(mvp[0] * p[0] + mvp[4] * p[1] + mvp[8] * p[2] + mvp[12]) / w, (mvp[1] * p[0] + mvp[5] * p[1] + mvp[9] * p[2] + mvp[13]) / w]; };
    assert.deepEqual(project(centred.mvp, [0, 0, 0]).map(v => Math.round(v * 1e6) / 1e6 + 0), [0, 0]);
    const panned = project(previewCamera({ ...DEFAULT_PREVIEW_VIEW, panX: .2, panY: -.1 }, 1).mvp, [0, 0, 0]);
    assert.ok(panned[0] < 0 && panned[1] > 0, 'panning the camera right/down moves the model left/up');
    for (const light of Object.values(centred.lights)) assert.ok(Math.abs(Math.hypot(...light) - 1) < 1e-6);
});
