import {
    createInstanceDataReader,
    parseSimpleTypeFields
} from "./rsz-fields.js";


// ============================================================
// FIRST-PASS INSTANCE PARSER
//
// This intentionally stops at the first unsupported field type.
// That lets us expand the browser parser from real SF6 data
// instead of guessing RE Engine layouts.
// ============================================================

export function parseRszInstances(
    buffer,
    rszInspection,
    typeRegistry
) {
    const reader =
        createInstanceDataReader(
            buffer,
            rszInspection.header.absoluteDataOffset
        );

    const parsedInstances = [];

    let currentOffset = 0;


    for (
        let index = 0;
        index
            < rszInspection.instanceInfos.length;
        index += 1
    ) {
        const instance =
            rszInspection.instanceInfos[
                index
            ];


        // Instance 0 is the RSZ null/sentinel instance.
        if (
            index === 0
            || instance.typeId === 0
        ) {
            parsedInstances.push({
                index,

                typeId:
                    instance.typeId,

                typeName:
                    instance.typeName,

                skipped:
                    true,

                reason:
                    "null-instance",
            });

            continue;
        }


        const typeInfo =
            typeRegistry.getTypeInfo(
                instance.typeId
            );


        if (
            !typeInfo
        ) {
            return {
                status:
                    "stopped",

                reason:
                    "missing-type",

                stoppedAt: {
                    index,

                    typeId:
                        instance.typeId,

                    typeIdHex:
                        instance.typeIdHex,

                    typeName:
                        instance.typeName,
                },

                currentOffset,

                parsedInstances,
            };
        }


        const fields =
            Array.isArray(
                typeInfo.fields
            )
                ? typeInfo.fields
                : [];


        // REasy does not advance the instance-data position
        // for types that contain no fields.
        if (
            fields.length === 0
        ) {
            parsedInstances.push({
                index,

                typeId:
                    instance.typeId,

                typeName:
                    instance.typeName,

                startOffset:
                    currentOffset,

                endOffset:
                    currentOffset,

                fields: {},
            });

            continue;
        }


        const startOffset =
            currentOffset;


        try {
            const parsed =
                parseSimpleTypeFields(
                    reader,
                    typeInfo,
                    currentOffset,
                    {
                        baseMod:
                            (
                                rszInspection
                                    .header
                                    .absoluteDataOffset
                                % 16
                            ),
                    }
                );


            currentOffset =
                parsed.nextOffset;


            parsedInstances.push({
                index,

                typeId:
                    instance.typeId,

                typeIdHex:
                    instance.typeIdHex,

                typeName:
                    instance.typeName,

                startOffset,

                endOffset:
                    currentOffset,

                byteLength:
                    currentOffset
                    - startOffset,

                fields:
                    parsed.fields,
            });
        }
        catch (error) {
            return {
                status:
                    "stopped",

                reason:
                    "unsupported-field",

                stoppedAt: {
                    index,

                    typeId:
                        instance.typeId,

                    typeIdHex:
                        instance.typeIdHex,

                    typeName:
                        instance.typeName,

                    startOffset,
                },

                currentOffset,

                error:
                    error.message,

                parsedInstances,
            };
        }
    }


    return {
        status:
            "complete",

        currentOffset,

        parsedInstances,
    };
}