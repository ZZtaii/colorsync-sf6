import {
    BinaryReader
} from "./binary-reader.js";


// ============================================================
// ALIGNMENT
// ============================================================

export function alignOffset(
    offset,
    alignment,
    baseMod = 0
) {
    if (
        !alignment
        || alignment <= 1
    ) {
        return offset;
    }

    const remainder =
        (
            offset
            + baseMod
        )
        % alignment;

    if (
        remainder === 0
    ) {
        return offset;
    }

    return (
        offset
        + (
            alignment
            - remainder
        )
    );
}


// ============================================================
// FIELD NORMALIZATION
//
// rszsf6.json field definitions contain information such as:
//
// name
// type
// size
// align
// array
// original_type
//
// Keep this tolerant because dump revisions can contain
// slightly different key naming.
// ============================================================

export function normalizeFieldDefinition(
    field
) {
    return {
        name:
            field.name
            ?? "",

        type:
            String(
                field.type
                ?? ""
            ).toLowerCase(),

        size:
            Number(
                field.size
                ?? 0
            ),

        align:
            Number(
                field.align
                ?? 1
            ),

        isArray:
            Boolean(
                field.array
                ?? field.is_array
                ?? false
            ),

        originalType:
            field.original_type
            ?? field.originalType
            ?? "",
    };
}


// ============================================================
// FIELD DEBUG DESCRIPTION
// ============================================================

export function describeTypeFields(
    typeInfo
) {
    const fields =
        Array.isArray(
            typeInfo?.fields
        )
            ? typeInfo.fields
            : [];

    return fields.map(
        (
            field,
            index
        ) => ({
            index,
            ...normalizeFieldDefinition(
                field
            ),
            raw:
                field,
        })
    );
}


// ============================================================
// PRIMITIVE READERS
//
// This is intentionally NOT a full REasy parser yet.
// Only the field kinds required for CostumeMaterialData
// are being added initially.
// ============================================================

function readBool(
    reader,
    size
) {
    if (
        size === 4
    ) {
        return (
            reader.readUint32()
            !== 0
        );
    }

    return (
        reader.readUint8()
        !== 0
    );
}


function readUnsigned(
    reader,
    size
) {
    switch (
        size
    ) {
        case 1:
            return reader.readUint8();

        case 2:
            return reader.readUint16();

        case 4:
            return reader.readUint32();

        case 8:
            return reader.readBigUint64();

        default:
            throw new Error(
                `Unsupported unsigned integer size: ${size}`
            );
    }
}


function readSigned(
    reader,
    size
) {
    switch (
        size
    ) {
        case 1:
            return reader.readInt8();

        case 2:
            return reader.readInt16();

        case 4:
            return reader.readInt32();

        case 8:
            return reader.readBigInt64();

        default:
            throw new Error(
                `Unsupported signed integer size: ${size}`
            );
    }
}


// ============================================================
// COLOR
//
// REasy's ColorData used here is four float32 values.
//
// We keep both normalized floats and RGB8 display values.
// ============================================================




function readColor(
    reader
) {
    const absoluteOffset =
        reader.absoluteOffset();

    const relativeOffset =
        reader.tell();


    const r =
        reader.readUint8();

    const g =
        reader.readUint8();

    const b =
        reader.readUint8();

    const a =
        reader.readUint8();


    return {
        kind:
            "color",

        r,
        g,
        b,
        a,

        hex:
            "#"
            + [
                r,
                g,
                b,
                a,
            ]
                .map(
                    value =>
                        value
                            .toString(16)
                            .padStart(
                                2,
                                "0"
                            )
                )
                .join(""),

        absoluteOffset,

        byteLength:
            4,

        rawHex:
            reader.hex(
                relativeOffset,
                4
            )
                .toUpperCase(),
    };
}


// ============================================================
// SINGLE FIELD VALUE
// ============================================================

function readString(
    reader
) {
    const charCount =
        reader.readUint32();

    if (
        charCount === 0
    ) {
        return {
            kind:
                "string",

            value:
                "",

            charCount:
                0,
        };
    }

    const value =
        reader.readUtf16LeChars(
            charCount
        );

    return {
        kind:
            "string",

        value:
            value.endsWith(
                "\u0000"
            )
                ? value.slice(
                    0,
                    -1
                )
                : value,

        charCount,
    };
}

export function readSimpleFieldValue(
    reader,
    definition
) {
    const type =
        definition.type;

    const size =
        definition.size;

    const originalType =
        definition.originalType;

    // --------------------------------------------------------
    // UTF-16LE String
    // --------------------------------------------------------

    if (
        type === "string"
    ) {
        return readString(
            reader
        );
    }
    // --------------------------------------------------------
    // Object references
    //
    // RSZ ObjectData is a 32-bit instance index.
    // --------------------------------------------------------

    if (
        type === "object"
        || type === "objectdata"
    ) {
        return {
            kind:
                "object",

            instanceId:
                reader.readUint32(),

            originalType,
        };
    }


    // --------------------------------------------------------
    // bool
    // --------------------------------------------------------

    if (
        type === "bool"
    ) {
        return {
            kind:
                "bool",

            value:
                readBool(
                    reader,
                    size || 1
                ),
        };
    }


    // --------------------------------------------------------
    // signed integers
    // --------------------------------------------------------

    if (
        type === "s8"
        || type === "s16"
        || type === "s32"
        || type === "s64"
        || type === "int"
    ) {
        return {
            kind:
                "integer",

            value:
                readSigned(
                    reader,
                    size || 4
                ),
        };
    }


    // --------------------------------------------------------
    // unsigned integers
    // --------------------------------------------------------

    if (
        type === "u8"
        || type === "u16"
        || type === "u32"
        || type === "u64"
        || type === "uint"
    ) {
        return {
            kind:
                "unsigned",

            value:
                readUnsigned(
                    reader,
                    size || 4
                ),
        };
    }


    // --------------------------------------------------------
    // floats
    // --------------------------------------------------------

    if (
        type === "f32"
        || type === "float"
    ) {
        return {
            kind:
                "float",

            value:
                reader.readFloat32(),
        };
    }


    if (
        type === "f64"
        || type === "double"
    ) {
        return {
            kind:
                "float",

            value:
                reader.readFloat64(),
        };
    }


    // --------------------------------------------------------
    // Color
    // --------------------------------------------------------

    const lowerOriginal =
        String(
            originalType
        ).toLowerCase();

    if (
        lowerOriginal === "via.color"
        || lowerOriginal.endsWith(
            ".color"
        )
        || type === "color"
    ) {
        return readColor(
            reader
        );
    }


    throw new Error(
        (
            "Unsupported RSZ field type: "
            + `name=${definition.name}, `
            + `type=${definition.type}, `
            + `size=${definition.size}, `
            + `originalType=${definition.originalType}`
        )
    );
}


// ============================================================
// PARSE ONE SIMPLE TYPE
//
// For now:
//
// - non-array primitive fields
// - object references
// - arrays whose elements are object references
//
// That's enough to start probing CostumeMaterialData.
//
// Returns next absolute position in the instance data reader.
// ============================================================

export function parseSimpleTypeFields(
    reader,
    typeInfo,
    startOffset,
    {
        baseMod = 0,
    } = {}
) {
    const rawFields =
        Array.isArray(
            typeInfo?.fields
        )
            ? typeInfo.fields
            : [];

    const result = {};

    let position =
        startOffset;


    for (
        const rawField
        of rawFields
    ) {
        const field =
            normalizeFieldDefinition(
                rawField
            );


        if (
            !field.name
        ) {
            continue;
        }


        // ----------------------------------------------------
        // Arrays are always aligned to 4 for their count.
        // ----------------------------------------------------

        if (
            field.isArray
        ) {
            position =
                alignOffset(
                    position,
                    4,
                    baseMod
                );

            reader.seek(
                position
            );

            const count =
                reader.readUint32();

            position =
                reader.tell();


            // -----------------------------------------------
            // Initial minimal implementation:
            // object-reference arrays only.
            // -----------------------------------------------

            if (
                field.type === "object"
                || field.type === "objectdata"
            ) {
                position =
                    alignOffset(
                        position,
                        field.align || 4,
                        baseMod
                    );

                reader.seek(
                    position
                );

                const values = [];

                for (
                    let index = 0;
                    index < count;
                    index += 1
                ) {
                    values.push({
                        kind:
                            "object",

                        instanceId:
                            reader.readUint32(),

                        originalType:
                            field.originalType,
                    });
                }

                position =
                    reader.tell();

                result[
                    field.name
                ] = {
                    kind:
                        "array",

                    elementType:
                        "object",

                    originalType:
                        field.originalType,

                    count,

                    values,
                };

                continue;
            }


            throw new Error(
                (
                    "Unsupported RSZ array field: "
                    + `${field.name} `
                    + `type=${field.type} `
                    + `originalType=${field.originalType}`
                )
            );
        }


        // ----------------------------------------------------
        // NORMAL FIELD ALIGNMENT
        // ----------------------------------------------------

        position =
            alignOffset(
                position,
                field.align,
                baseMod
            );

        reader.seek(
            position
        );

        const absoluteOffset =
            reader.absoluteOffset();

        const relativeOffset =
            reader.tell();

        const parsedValue =
            readSimpleFieldValue(
                reader,
                field
            );

        const endRelativeOffset =
            reader.tell();

        const byteLength =
            endRelativeOffset
            - relativeOffset;


        // ----------------------------------------------------
        // Keep byte-location metadata.
        //
        // This will let the UI show:
        //
        // Offset: 0x1234
        // Bytes:  BB BB BB FF
        //
        // and later lets the writer modify the exact bytes.
        // ----------------------------------------------------

        if (
            parsedValue
            && typeof parsedValue
                === "object"
        ) {
            parsedValue.absoluteOffset =
                absoluteOffset;

            parsedValue.byteLength =
                byteLength;

            parsedValue.rawHex =
                reader.hex(
                    relativeOffset,
                    byteLength
                )
                    .toUpperCase();
        }


        result[
            field.name
        ] =
            parsedValue;


        position =
            reader.tell();
    }


    return {
        fields:
            result,

        nextOffset:
            position,
    };
}


// ============================================================
// CREATE DATA-BLOCK READER
// ============================================================

export function createInstanceDataReader(
    buffer,
    absoluteDataOffset
) {
    return new BinaryReader(
        buffer,
        absoluteDataOffset,
        buffer.byteLength
            - absoluteDataOffset
    );
}