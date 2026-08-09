// ============================================================
// SF6 COSTUME COLOR EXTRACTION
//
// Converts parsed RSZ instances into useful SF6 material
// clusters:
//
//   ClusterData.Name
//   ClusterData.CustomizeColors[]
//
// Each CustomizeColors[N] points to a
// CustomizeColorData instance containing:
//
//   Enable
//   Color
//   Option
//
// Confirmed mapping:
//
//   CMD CustomizeColors[N]
//       ->
//   runtime CustomizeColor_N
// ============================================================


const CLUSTER_TYPE =
    "app.CostumeMaterialData.ClusterData";

const COLOR_TYPE =
    "app.CostumeMaterialData.CustomizeColorData";


// ============================================================
// VALUE HELPERS
// ============================================================

function getStringValue(
    field
) {
    if (
        field?.kind !== "string"
    ) {
        return null;
    }

    return field.value;
}


function getBoolValue(
    field
) {
    if (
        field?.kind !== "bool"
    ) {
        return null;
    }

    return field.value;
}


function getObjectId(
    field
) {
    if (
        field?.kind !== "object"
    ) {
        return null;
    }

    return field.instanceId;
}


function getObjectArrayIds(
    field
) {
    if (
        field?.kind !== "array"
        || !Array.isArray(
            field.values
        )
    ) {
        return [];
    }

    return field.values
        .map(
            value =>
                value?.instanceId
        )
        .filter(
            value =>
                Number.isInteger(
                    value
                )
        );
}


// ============================================================
// INSTANCE LOOKUP
// ============================================================

function makeInstanceMap(
    parsedInstances
) {
    const map =
        new Map();

    for (
        const instance
        of parsedInstances
    ) {
        map.set(
            instance.index,
            instance
        );
    }

    return map;
}


// ============================================================
// EXTRACT ONE COLOR SLOT
// ============================================================

function extractCustomizeColor(
    instanceId,
    slotIndex,
    instanceMap
) {
    const instance =
        instanceMap.get(
            instanceId
        );

    if (
        !instance
    ) {
        return {
            index:
                slotIndex,

            runtimeName:
                `CustomizeColor_${slotIndex}`,

            instanceId,

            error:
                "Referenced instance does not exist.",
        };
    }


    if (
        instance.typeName
        !== COLOR_TYPE
    ) {
        return {
            index:
                slotIndex,

            runtimeName:
                `CustomizeColor_${slotIndex}`,

            instanceId,

            typeName:
                instance.typeName,

            error:
                (
                    "Referenced instance is not "
                    + "CustomizeColorData."
                ),
        };
    }


    const fields =
        instance.fields
        ?? {};


    const enableField =
        fields.Enable?.kind === "bool"
            ? fields.Enable
            : null;


    const enabled =
        getBoolValue(
            enableField
        );


    const colorField =
        fields.Color?.kind === "color"
            ? fields.Color
            : null;


    const optionInstanceId =
        getObjectId(
            fields.Option
        );


    return {
        index:
            slotIndex,

        runtimeName:
            `CustomizeColor_${slotIndex}`,

        instanceId,

        enabled,

        // Keep write metadata for Enable so sync can force-enable targets.
        enable:
            enableField
                ? {
                    value:
                        enableField.value,

                    absoluteOffset:
                        enableField.absoluteOffset
                        ?? null,

                    byteLength:
                        enableField.byteLength
                        ?? 1,

                    rawHex:
                        enableField.rawHex
                        ?? null,
                }
                : null,

        color:
            colorField
                ? {
                    r:
                        colorField.r,

                    g:
                        colorField.g,

                    b:
                        colorField.b,

                    a:
                        colorField.a,

                    hex:
                        colorField.hex,

                    absoluteOffset:
                        colorField.absoluteOffset
                        ?? null,

                    byteLength:
                        colorField.byteLength
                        ?? 4,

                    rawHex:
                        colorField.rawHex
                        ?? null,
                }
                : null,

        optionInstanceId,
    };
}


// ============================================================
// EXTRACT CLUSTERS
// ============================================================

export function extractSf6ColorClusters(
    instanceParse
) {
    if (
        !instanceParse
        || instanceParse.status
            !== "complete"
    ) {
        throw new Error(
            "RSZ instance parsing must complete before extracting colors."
        );
    }


    const parsedInstances =
        instanceParse.parsedInstances;

    const instanceMap =
        makeInstanceMap(
            parsedInstances
        );


    const clusters = [];


    for (
        const instance
        of parsedInstances
    ) {
        if (
            instance.typeName
            !== CLUSTER_TYPE
        ) {
            continue;
        }


        const fields =
            instance.fields
            ?? {};


        const name =
            getStringValue(
                fields.Name
            );


        const colorInstanceIds =
            getObjectArrayIds(
                fields.CustomizeColors
            );


        const colors =
            colorInstanceIds.map(
                (
                    colorInstanceId,
                    slotIndex
                ) =>
                    extractCustomizeColor(
                        colorInstanceId,
                        slotIndex,
                        instanceMap
                    )
            );


        clusters.push({
            instanceId:
                instance.index,

            name:
                name
                ?? `Cluster ${instance.index}`,

            customizeColorCount:
                colors.length,

            colors,

            emissiveInstanceId:
                getObjectId(
                    fields.Emissive
                ),

            bodyInstanceId:
                getObjectId(
                    fields.Body
                ),
        });
    }


    return clusters;
}


// ============================================================
// COMPACT DEBUG VIEW
// ============================================================

// Debug-only compact view. Editing/sync must use full clusters
// from extractSf6ColorClusters (offsets + enable metadata).
export function summarizeSf6ColorClusters(
    clusters
) {
    return clusters.map(
        cluster => ({
            name:
                cluster.name,

            instanceId:
                cluster.instanceId,

            colors:
                cluster.colors.map(
                    color => ({
                        index:
                            color.index,

                        slot:
                            color.runtimeName,

                        enabled:
                            color.enabled,

                        enableOffset:
                            color.enable?.absoluteOffset
                            ?? null,

                        hex:
                            color.color?.hex
                            ?? null,

                        offset:
                            color.color?.absoluteOffset
                            ?? null,

                        offsetHex:
                            Number.isInteger(
                                color.color?.absoluteOffset
                            )
                                ? (
                                    "0x"
                                    + color.color
                                        .absoluteOffset
                                        .toString(16)
                                        .toUpperCase()
                                )
                                : null,

                        bytes:
                            color.color?.rawHex
                            ?? null,

                        rgba:
                            color.color
                                ? [
                                    color.color.r,
                                    color.color.g,
                                    color.color.b,
                                    color.color.a,
                                ]
                                : null,

                        instanceId:
                            color.instanceId,
                    })
                ),
        })
    );
}