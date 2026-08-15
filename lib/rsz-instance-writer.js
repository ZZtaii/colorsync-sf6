import {
    alignOffset,
    normalizeFieldDefinition,
} from "./rsz-fields.js";


const CLUSTER_TYPE = "app.CostumeMaterialData.ClusterData";
const MATERIAL_TYPE = "app.CostumeMaterialData.MaterialData";


class ByteWriter {
    constructor() {
        this.bytes = [];
    }

    get length() {
        return this.bytes.length;
    }

    padTo(position) {
        if (position < this.length) throw new RangeError("Cannot pad a writer backwards.");
        while (this.length < position) this.bytes.push(0);
    }

    align(alignment, baseMod = 0) {
        this.padTo(alignOffset(this.length, alignment, baseMod));
    }

    pushBytes(bytes) {
        this.bytes.push(...bytes);
    }

    pushNumber(method, byteLength, value) {
        const scratch = new ArrayBuffer(byteLength);
        const view = new DataView(scratch);
        view[method](0, value, true);
        this.pushBytes(new Uint8Array(scratch));
    }

    uint8(value) { this.bytes.push(Number(value) & 0xFF); }
    int8(value) { this.pushNumber("setInt8", 1, Number(value)); }
    uint16(value) { this.pushNumber("setUint16", 2, Number(value)); }
    int16(value) { this.pushNumber("setInt16", 2, Number(value)); }
    uint32(value) { this.pushNumber("setUint32", 4, Number(value)); }
    int32(value) { this.pushNumber("setInt32", 4, Number(value)); }
    uint64(value) { this.pushNumber("setBigUint64", 8, BigInt(value)); }
    int64(value) { this.pushNumber("setBigInt64", 8, BigInt(value)); }
    float32(value) { this.pushNumber("setFloat32", 4, Number(value)); }
    float64(value) { this.pushNumber("setFloat64", 8, Number(value)); }

    finish() {
        return Uint8Array.from(this.bytes);
    }
}


function writeSizedInteger(writer, value, size, signed) {
    const prefix = signed ? "int" : "uint";
    const method = `${prefix}${size * 8}`;
    if (typeof writer[method] !== "function") {
        throw new Error(`Unsupported ${signed ? "signed" : "unsigned"} integer size: ${size}`);
    }
    writer[method](value);
}


function writeString(writer, field) {
    const value = String(field?.value ?? "");
    const charCount = field?.charCount === 0 && value === ""
        ? 0
        : value.length + 1;
    writer.uint32(charCount);
    if (charCount === 0) return;
    for (let index = 0; index < value.length; index += 1) {
        writer.uint16(value.charCodeAt(index));
    }
    writer.uint16(0);
}


function writeSimpleValue(writer, definition, value) {
    const type = definition.type;
    const size = definition.size;
    const originalType = String(definition.originalType ?? "").toLowerCase();

    if (type === "string") {
        writeString(writer, value);
        return;
    }
    if (type === "object" || type === "objectdata") {
        writer.uint32(value?.instanceId ?? 0);
        return;
    }
    if (type === "bool") {
        writeSizedInteger(writer, value?.value ? 1 : 0, size || 1, false);
        return;
    }
    if (["s8", "s16", "s32", "s64", "int"].includes(type)) {
        writeSizedInteger(writer, value?.value ?? 0, size || 4, true);
        return;
    }
    if (["u8", "u16", "u32", "u64", "uint"].includes(type)) {
        writeSizedInteger(writer, value?.value ?? 0, size || 4, false);
        return;
    }
    if (type === "f32" || type === "float") {
        writer.float32(value?.value ?? 0);
        return;
    }
    if (type === "f64" || type === "double") {
        writer.float64(value?.value ?? 0);
        return;
    }
    if (
        originalType === "via.color"
        || originalType.endsWith(".color")
        || type === "color"
    ) {
        writer.uint8(value?.r ?? 0);
        writer.uint8(value?.g ?? 0);
        writer.uint8(value?.b ?? 0);
        writer.uint8(value?.a ?? 0);
        return;
    }

    throw new Error(
        `Unsupported RSZ field while writing: ${definition.name} (${definition.type}).`,
    );
}


function writeInstance(writer, instance, typeInfo, baseMod) {
    const definitions = Array.isArray(typeInfo?.fields) ? typeInfo.fields : [];
    for (const rawDefinition of definitions) {
        const definition = normalizeFieldDefinition(rawDefinition);
        if (!definition.name) continue;
        const value = instance.fields?.[definition.name];

        if (definition.isArray) {
            writer.align(4, baseMod);
            const values = Array.isArray(value?.values) ? value.values : [];
            writer.uint32(values.length);
            if (definition.type !== "object" && definition.type !== "objectdata") {
                throw new Error(`Unsupported RSZ array while writing: ${definition.name}.`);
            }
            writer.align(definition.align || 4, baseMod);
            for (const item of values) writer.uint32(item?.instanceId ?? 0);
            continue;
        }

        writer.align(definition.align, baseMod);
        writeSimpleValue(writer, definition, value);
    }
}


export function serializeRszInstanceData(parsedInstances, typeRegistry, { baseMod = 0 } = {}) {
    const writer = new ByteWriter();
    for (const instance of parsedInstances) {
        if (instance?.index === 0 || instance?.typeId === 0) continue;
        const typeInfo = typeRegistry.getTypeInfo(instance.typeId);
        if (!typeInfo) throw new Error(`Missing RSZ type for instance ${instance.index}.`);
        writeInstance(writer, instance, typeInfo, baseMod);
    }
    return writer.finish();
}


function clone(value) {
    return structuredClone(value);
}


function findClusterOwner(parsedInstances, clusterInstanceId) {
    return parsedInstances.find(instance => (
        instance?.typeName === MATERIAL_TYPE
        && instance.fields?.Clusters?.kind === "array"
        && instance.fields.Clusters.values.some(value => value.instanceId === clusterInstanceId)
    )) ?? null;
}


function appendClonedInstance(parsedInstances, instanceInfos, sourceInstanceId) {
    const sourceInstance = parsedInstances[sourceInstanceId];
    const sourceInfo = instanceInfos[sourceInstanceId];
    if (!sourceInstance || !sourceInfo) {
        throw new Error(`Cannot clone missing RSZ instance ${sourceInstanceId}.`);
    }
    const index = parsedInstances.length;
    const instance = clone(sourceInstance);
    instance.index = index;
    delete instance.startOffset;
    delete instance.endOffset;
    delete instance.byteLength;
    parsedInstances.push(instance);
    instanceInfos.push({ ...clone(sourceInfo), index });
    return instance;
}


function rebuildCmdBuffer(buffer, usrInspection, rszInspection, parsedInstances, instanceInfos, typeRegistry) {
    const { header } = rszInspection;
    if (header.userdataCount !== 0) {
        throw new Error("Custom materials are not supported for CMD files with RSZ userdata.");
    }

    const rszBaseOffset = rszInspection.rszBaseOffset;
    const instanceTableEnd = header.instanceOffset + (instanceInfos.length * 8);
    const dataOffset = alignOffset(instanceTableEnd, 16);
    const absoluteDataOffset = rszBaseOffset + dataOffset;
    const instanceData = serializeRszInstanceData(parsedInstances, typeRegistry, {
        baseMod: absoluteDataOffset % 16,
    });
    const output = new ArrayBuffer(absoluteDataOffset + instanceData.byteLength);
    const outputBytes = new Uint8Array(output);
    const sourceBytes = new Uint8Array(buffer);

    outputBytes.set(sourceBytes.subarray(0, rszBaseOffset + header.instanceOffset));
    const view = new DataView(output);
    for (let index = 0; index < instanceInfos.length; index += 1) {
        const info = instanceInfos[index];
        const offset = rszBaseOffset + header.instanceOffset + (index * 8);
        view.setUint32(offset, info.typeId >>> 0, true);
        view.setUint32(offset + 4, info.crc >>> 0, true);
    }
    outputBytes.set(instanceData, absoluteDataOffset);

    view.setUint32(rszBaseOffset + 12, instanceInfos.length, true);
    view.setBigUint64(rszBaseOffset + 32, BigInt(dataOffset), true);
    view.setBigUint64(rszBaseOffset + 40, BigInt(dataOffset), true);

    // The outer USR header has no file-size field. Its data offset and tables
    // remain unchanged because the RSZ block still begins at the same address.
    if (usrInspection.header.dataOffset !== rszBaseOffset) {
        throw new Error("USR and RSZ offsets disagree while rebuilding the CMD.");
    }
    return output;
}


export function addCustomMaterialCluster({
    buffer,
    usrInspection,
    rszInspection,
    instanceParse,
    typeRegistry,
    templateClusterInstanceId,
    materialName,
    colorCount,
}) {
    const cleanName = String(materialName ?? "").trim();
    if (!cleanName || cleanName.includes("\u0000")) {
        throw new Error("Custom material name must be non-empty and cannot contain null characters.");
    }
    if (instanceParse.status !== "complete") {
        throw new Error("RSZ instance parsing must complete before adding a material.");
    }

    const parsedInstances = clone(instanceParse.parsedInstances);
    const instanceInfos = clone(rszInspection.instanceInfos);
    if (parsedInstances.some(instance => (
        instance?.typeName === CLUSTER_TYPE
        && instance.fields?.Name?.value === cleanName
    ))) {
        throw new Error(`CMD already contains material ${cleanName}.`);
    }

    const template = parsedInstances[templateClusterInstanceId];
    if (template?.typeName !== CLUSTER_TYPE) {
        throw new Error("Selected template is not a CMD material cluster.");
    }
    const owner = findClusterOwner(parsedInstances, templateClusterInstanceId);
    if (!owner) throw new Error("Could not find the CMD part that owns the selected template.");

    const templateColorIds = template.fields?.CustomizeColors?.values?.map(value => value.instanceId) ?? [];
    const requestedColorCount = colorCount === undefined ? templateColorIds.length : colorCount;
    if (
        !Number.isInteger(requestedColorCount)
        || requestedColorCount < 1
        || requestedColorCount > templateColorIds.length
    ) {
        throw new Error("Requested custom material slot count is not available in the template.");
    }
    const colorIds = templateColorIds.slice(0, requestedColorCount);
    const clonedColorIds = colorIds.map(sourceId => (
        appendClonedInstance(parsedInstances, instanceInfos, sourceId).index
    ));
    const newCluster = appendClonedInstance(
        parsedInstances,
        instanceInfos,
        templateClusterInstanceId,
    );
    newCluster.fields.Name.value = cleanName;
    newCluster.fields.Name.charCount = cleanName.length + 1;
    newCluster.fields.CustomizeColors.values = clonedColorIds.map(instanceId => ({
        kind: "object",
        instanceId,
        originalType: newCluster.fields.CustomizeColors.originalType,
    }));
    newCluster.fields.CustomizeColors.count = clonedColorIds.length;

    owner.fields.Clusters.values.push({
        kind: "object",
        instanceId: newCluster.index,
        originalType: owner.fields.Clusters.originalType,
    });
    owner.fields.Clusters.count = owner.fields.Clusters.values.length;

    return rebuildCmdBuffer(
        buffer,
        usrInspection,
        rszInspection,
        parsedInstances,
        instanceInfos,
        typeRegistry,
    );
}


export function extendMaterialClusterColorSlots({
    buffer,
    usrInspection,
    rszInspection,
    instanceParse,
    typeRegistry,
    clusterInstanceId,
    colorCount,
}) {
    if (instanceParse.status !== "complete") {
        throw new Error("RSZ instance parsing must complete before extending a material.");
    }
    if (!Number.isInteger(colorCount) || colorCount < 1) {
        throw new Error("The requested material slot count must be a positive integer.");
    }

    const parsedInstances = clone(instanceParse.parsedInstances);
    const instanceInfos = clone(rszInspection.instanceInfos);
    const cluster = parsedInstances[clusterInstanceId];
    if (cluster?.typeName !== CLUSTER_TYPE) {
        throw new Error("Selected material is not a CMD material cluster.");
    }
    const customizeColors = cluster.fields?.CustomizeColors;
    const existingValues = customizeColors?.values;
    if (!Array.isArray(existingValues) || existingValues.length < 1) {
        throw new Error("The selected CMD material has no color slot to use as a template.");
    }
    if (existingValues.length >= colorCount) return buffer;

    const sourceInstanceId = existingValues[existingValues.length - 1].instanceId;
    while (existingValues.length < colorCount) {
        const clonedColor = appendClonedInstance(
            parsedInstances,
            instanceInfos,
            sourceInstanceId,
        );
        existingValues.push({
            kind: "object",
            instanceId: clonedColor.index,
            originalType: customizeColors.originalType,
        });
    }
    customizeColors.count = existingValues.length;

    return rebuildCmdBuffer(
        buffer,
        usrInspection,
        rszInspection,
        parsedInstances,
        instanceInfos,
        typeRegistry,
    );
}
