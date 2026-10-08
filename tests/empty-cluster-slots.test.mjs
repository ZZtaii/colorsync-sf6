import assert from "node:assert/strict";
import test from "node:test";
import { inspectUsr } from "../lib/usr-parser.js";
import { inspectRsz } from "../lib/rsz-parser.js";
import { parseRszInstances } from "../lib/rsz-instance-parser.js";
import { extractSf6ColorClusters } from "../lib/sf6-colors.js";
import { extendMaterialClusterColorSlots, serializeRszInstanceData } from "../lib/rsz-instance-writer.js";
import { TypeRegistry, resolveInstanceTypes } from "../lib/type-registry.js";

const colorType = "app.CostumeMaterialData.CustomizeColorData";
const clusterType = "app.CostumeMaterialData.ClusterData";
const materialType = "app.CostumeMaterialData.MaterialData";
const registry = new TypeRegistry({
    "1": { name: colorType, fields: [
        { name: "Enable", type: "Bool", size: 1, align: 1 },
        { name: "Color", type: "Color", original_type: "via.Color", size: 4, align: 4 },
        { name: "Option", type: "Object", size: 4, align: 4 },
    ] },
    "2": { name: clusterType, fields: [
        { name: "Name", type: "String", align: 4 },
        { name: "CustomizeColors", type: "Object", original_type: colorType, array: true, align: 4 },
        { name: "Emissive", type: "Object", size: 4, align: 4 },
        { name: "Body", type: "Object", size: 4, align: 4 },
    ] },
    "3": { name: materialType, fields: [
        { name: "Type", type: "S32", size: 4, align: 4 },
        { name: "Clusters", type: "Object", original_type: clusterType, array: true, align: 4 },
    ] },
});
const ref = instanceId => ({ kind: "object", instanceId });
const refs = (type, ids) => ({ kind: "array", originalType: type, values: ids.map(ref), count: ids.length });

function fixture({ donorInSamePart = true } = {}) {
    const cluster = (index, name, colors) => ({ index, typeId: 2, typeName: clusterType, fields: {
        Name: { value: name }, CustomizeColors: refs(colorType, colors), Emissive: ref(0), Body: ref(0),
    } });
    const instances = [
        { index: 0, typeId: 0 },
        { index: 1, typeId: 1, typeName: colorType, fields: {
            Enable: { value: false }, Color: { r: 23, g: 45, b: 67, a: 255 }, Option: ref(0),
        } },
        cluster(2, "esf_Template", [1]), cluster(3, "esf_Empty", []),
        { index: 4, typeId: 3, typeName: materialType, fields: {
            Type: { value: 1 }, Clusters: refs(clusterType, donorInSamePart ? [2, 3] : [3]),
        } },
    ];
    if (!donorInSamePart) instances.push({ index: 5, typeId: 3, typeName: materialType, fields: {
        Type: { value: 0 }, Clusters: refs(clusterType, [2]),
    } });
    const data = serializeRszInstanceData(instances, registry);
    const instanceOffset = 64;
    const dataOffset = Math.ceil((instanceOffset + instances.length * 8) / 16) * 16;
    const buffer = new ArrayBuffer(48 + dataOffset + data.length);
    const view = new DataView(buffer);
    view.setUint32(0, 0x00525355, true);
    view.setBigUint64(32, 48n, true);
    view.setUint32(48, 0x005A5352, true);
    view.setUint32(52, 16, true);
    view.setUint32(56, 1, true);
    view.setUint32(60, instances.length, true);
    view.setBigUint64(72, BigInt(instanceOffset), true);
    view.setBigUint64(80, BigInt(dataOffset), true);
    view.setBigUint64(88, BigInt(dataOffset), true);
    view.setUint32(96, 4, true);
    for (const instance of instances) view.setUint32(48 + instanceOffset + instance.index * 8, instance.typeId, true);
    new Uint8Array(buffer).set(data, 48 + dataOffset);
    return buffer;
}

function parse(buffer) {
    const usrInspection = inspectUsr(buffer);
    const rszInspection = inspectRsz(buffer, usrInspection.header);
    rszInspection.instanceInfos = resolveInstanceTypes(rszInspection.instanceInfos, registry);
    const instanceParse = parseRszInstances(buffer, rszInspection, registry);
    assert.equal(instanceParse.status, "complete");
    return { usrInspection, rszInspection, instanceParse };
}

test("empty CMD clusters gain independent compatible slots without changing their owner or donor", () => {
    const buffer = fixture();
    const before = buffer.slice(0);
    const parsed = parse(buffer);
    const result = extendMaterialClusterColorSlots({ buffer, ...parsed, typeRegistry: registry, clusterInstanceId: 3, colorCount: 4 });
    const rebuilt = parse(result);
    const clusters = extractSf6ColorClusters(rebuilt.instanceParse);
    const target = clusters.find(cluster => cluster.name === "esf_Empty");
    const donor = clusters.find(cluster => cluster.name === "esf_Template");
    assert.equal(target.instanceId, 3);
    assert.equal(target.colors.length, 4);
    assert.equal(donor.colors.length, 1);
    assert.equal(new Set(target.colors.map(slot => slot.instanceId)).size, 4);
    assert.ok(target.colors.every(slot => slot.instanceId !== donor.colors[0].instanceId));
    assert.deepEqual(rebuilt.instanceParse.parsedInstances[4].fields.Clusters.values.map(value => value.instanceId), [2, 3]);
    assert.equal(rebuilt.instanceParse.parsedInstances[4].fields.Type.value, 1);
    assert.equal(rebuilt.rszInspection.instanceInfos.length, parsed.rszInspection.instanceInfos.length + 4);
    assert.deepEqual(buffer, before);
    const edited = result.slice(0);
    new Uint8Array(edited).set([1, 2, 3, 255], target.colors[0].color.absoluteOffset);
    const after = extractSf6ColorClusters(parse(edited).instanceParse);
    assert.equal(after.find(cluster => cluster.name === "esf_Template").colors[0].color.hex, donor.colors[0].color.hex);
    assert.equal(after.find(cluster => cluster.name === "esf_Empty").colors[0].color.hex.toUpperCase(), "#010203FF");
});

test("empty clusters cannot borrow a color instance from another model part", () => {
    const buffer = fixture({ donorInSamePart: false });
    const before = buffer.slice(0);
    assert.throws(() => extendMaterialClusterColorSlots({ buffer, ...parse(buffer), typeRegistry: registry,
        clusterInstanceId: 3, colorCount: 4 }), /No compatible CMD color slot/);
    assert.deepEqual(buffer, before);
});
