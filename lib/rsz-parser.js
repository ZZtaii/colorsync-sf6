import {
    BinaryReader
} from "./binary-reader.js";


// ============================================================
// RSZ HEADER
//
// REasy v4+ layout:
//
// uint32 magic
// uint32 version
// uint32 object_count
// uint32 instance_count
// uint32 userdata_count
// uint32 reserved
// uint64 instance_offset
// uint64 data_offset
// uint64 userdata_offset
//
// Total: 48 bytes
// ============================================================

export const RSZ_HEADER_SIZE_V4 = 48;


function bigintToSafeNumber(
    value,
    fieldName
) {
    if (
        value
        > BigInt(
            Number.MAX_SAFE_INTEGER
        )
    ) {
        throw new RangeError(
            `${fieldName} is too large `
            + "for JavaScript safe integer handling."
        );
    }

    return Number(
        value
    );
}


export function parseRszHeader(
    buffer,
    rszBaseOffset
) {
    if (
        !(buffer instanceof ArrayBuffer)
    ) {
        throw new TypeError(
            "parseRszHeader expects an ArrayBuffer."
        );
    }

    if (
        rszBaseOffset < 0
        || rszBaseOffset + 32
            > buffer.byteLength
    ) {
        throw new RangeError(
            "RSZ base offset is outside the file."
        );
    }

    const reader =
        new BinaryReader(
            buffer,
            rszBaseOffset,
            buffer.byteLength
                - rszBaseOffset
        );


    const magic =
        reader.readUint32();

    const version =
        reader.readUint32();


    const objectCount =
        reader.readUint32();

    const instanceCount =
        reader.readUint32();


    let userdataCount = 0;
    let reserved = 0;


    if (
        version >= 4
    ) {
        userdataCount =
            reader.readUint32();

        reserved =
            reader.readUint32();
    }
    else {
        reserved =
            reader.readUint32();
    }


    const instanceOffset =
        bigintToSafeNumber(
            reader.readBigUint64(),
            "RSZ instanceOffset"
        );

    const dataOffset =
        bigintToSafeNumber(
            reader.readBigUint64(),
            "RSZ dataOffset"
        );


    let userdataOffset = 0;

    if (
        version >= 4
    ) {
        userdataOffset =
            bigintToSafeNumber(
                reader.readBigUint64(),
                "RSZ userdataOffset"
            );
    }


    const headerSize =
        version >= 4
            ? 48
            : 32;


    // --------------------------------------------------------
    // BASIC OFFSET VALIDATION
    //
    // RSZ offsets are relative to the start of the RSZ block.
    // --------------------------------------------------------

    const absoluteInstanceOffset =
        rszBaseOffset
        + instanceOffset;

    const absoluteDataOffset =
        rszBaseOffset
        + dataOffset;

    const absoluteUserdataOffset =
        userdataOffset
            ? (
                rszBaseOffset
                + userdataOffset
            )
            : 0;


    if (
        absoluteInstanceOffset
        > buffer.byteLength
    ) {
        throw new RangeError(
            "RSZ instance table points outside the file."
        );
    }


    if (
        absoluteDataOffset
        > buffer.byteLength
    ) {
        throw new RangeError(
            "RSZ instance data points outside the file."
        );
    }


    if (
        absoluteUserdataOffset
        > buffer.byteLength
    ) {
        throw new RangeError(
            "RSZ userdata table points outside the file."
        );
    }


    return {
        magic,
        magicHex:
            "0x"
            + magic
                .toString(16)
                .padStart(
                    8,
                    "0"
                ),

        version,

        headerSize,

        objectCount,

        instanceCount,

        userdataCount,

        reserved,

        instanceOffset,

        dataOffset,

        userdataOffset,

        absoluteInstanceOffset,

        absoluteDataOffset,

        absoluteUserdataOffset,
    };
}


// ============================================================
// OBJECT TABLE
// ============================================================

export function parseRszObjectTable(
    buffer,
    rszBaseOffset,
    header
) {
    const reader =
        new BinaryReader(
            buffer,
            rszBaseOffset,
            buffer.byteLength
                - rszBaseOffset
        );

    reader.seek(
        header.headerSize
    );

    const objects = [];

    for (
        let i = 0;
        i < header.objectCount;
        i += 1
    ) {
        objects.push(
            reader.readInt32()
        );
    }

    return objects;
}


// ============================================================
// INSTANCE INFO TABLE
//
// Each entry:
//   uint32 type_id
//   uint32 crc
//
// REasy uses 8 bytes per entry for RSZ v4+.
// ============================================================

export function parseRszInstanceInfos(
    buffer,
    rszBaseOffset,
    header
) {
    const reader =
        new BinaryReader(
            buffer,
            rszBaseOffset,
            buffer.byteLength
                - rszBaseOffset
        );

    reader.seek(
        header.instanceOffset
    );

    const instances = [];

    for (
        let index = 0;
        index < header.instanceCount;
        index += 1
    ) {
        const typeId =
            reader.readUint32();

        const crc =
            reader.readUint32();

        instances.push({
            index,

            typeId,

            typeIdHex:
                "0x"
                + typeId
                    .toString(16)
                    .padStart(
                        8,
                        "0"
                    ),

            crc,

            crcHex:
                "0x"
                + crc
                    .toString(16)
                    .padStart(
                        8,
                        "0"
                    ),
        });
    }

    return instances;
}


// ============================================================
// HIGH-LEVEL INSPECTION
// ============================================================

export function inspectRsz(
    buffer,
    usrHeader
) {
    const rszBaseOffset =
        usrHeader.dataOffset;

    const header =
        parseRszHeader(
            buffer,
            rszBaseOffset
        );

    const objectTable =
        parseRszObjectTable(
            buffer,
            rszBaseOffset,
            header
        );

    const instanceInfos =
        parseRszInstanceInfos(
            buffer,
            rszBaseOffset,
            header
        );

    return {
        rszBaseOffset,

        header,

        objectTable,

        instanceInfos,

        instanceDataPreview:
            new BinaryReader(
                buffer
            ).hex(
                header.absoluteDataOffset,
                Math.min(
                    64,
                    buffer.byteLength
                        - header.absoluteDataOffset
                )
            ),
    };
}