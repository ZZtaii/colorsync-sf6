import {
    BinaryReader
} from "./binary-reader.js";


// ============================================================
// USR HEADER
//
// REasy layout:
//
// <4s3I3QQ>
//
// 4 bytes  signature
// 4 bytes  resource_count
// 4 bytes  userdata_count
// 4 bytes  info_count
// 8 bytes  resource_info_tbl
// 8 bytes  userdata_info_tbl
// 8 bytes  data_offset
// 8 bytes  reserved
//
// Total: 48 bytes
// ============================================================

export const USR_HEADER_SIZE = 48;


// ============================================================
// HELPERS
// ============================================================

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


// ============================================================
// PARSE USR HEADER
// ============================================================

export function parseUsrHeader(
    buffer
) {
    if (
        !(buffer instanceof ArrayBuffer)
    ) {
        throw new TypeError(
            "parseUsrHeader expects an ArrayBuffer."
        );
    }

    if (
        buffer.byteLength
        < USR_HEADER_SIZE
    ) {
        throw new RangeError(
            (
                "File is too small to contain "
                + `a USR header. `
                + `Expected at least ${USR_HEADER_SIZE} bytes, `
                + `got ${buffer.byteLength}.`
            )
        );
    }

    const reader =
        new BinaryReader(
            buffer
        );


    // --------------------------------------------------------
    // SIGNATURE
    // --------------------------------------------------------

    const signature =
        reader.readAscii(
            4
        );

    if (
        signature !== "USR\u0000"
    ) {
        throw new Error(
            "Not a USR file."
        );
    }


    // --------------------------------------------------------
    // COUNTS
    // --------------------------------------------------------

    const resourceCount =
        reader.readUint32();

    const userdataCount =
        reader.readUint32();

    const infoCount =
        reader.readUint32();


    // --------------------------------------------------------
    // OFFSETS
    // --------------------------------------------------------

    const resourceInfoTableBig =
        reader.readBigUint64();

    const userdataInfoTableBig =
        reader.readBigUint64();

    const dataOffsetBig =
        reader.readBigUint64();

    const reservedBig =
        reader.readBigUint64();


    const resourceInfoTable =
        bigintToSafeNumber(
            resourceInfoTableBig,
            "resourceInfoTable"
        );

    const userdataInfoTable =
        bigintToSafeNumber(
            userdataInfoTableBig,
            "userdataInfoTable"
        );

    const dataOffset =
        bigintToSafeNumber(
            dataOffsetBig,
            "dataOffset"
        );

    const reserved =
        bigintToSafeNumber(
            reservedBig,
            "reserved"
        );


    // --------------------------------------------------------
    // BASIC VALIDATION
    // --------------------------------------------------------

    if (
        dataOffset < USR_HEADER_SIZE
    ) {
        throw new RangeError(
            (
                "USR dataOffset points inside "
                + "the USR header: "
                + `${dataOffset}`
            )
        );
    }

    if (
        dataOffset
        >= buffer.byteLength
    ) {
        throw new RangeError(
            (
                "USR dataOffset is outside the file: "
                + `${dataOffset} >= ${buffer.byteLength}`
            )
        );
    }


    if (
        resourceInfoTable !== 0
        && resourceInfoTable
            >= buffer.byteLength
    ) {
        throw new RangeError(
            (
                "resourceInfoTable is outside the file: "
                + resourceInfoTable
            )
        );
    }


    if (
        userdataInfoTable !== 0
        && userdataInfoTable
            >= buffer.byteLength
    ) {
        throw new RangeError(
            (
                "userdataInfoTable is outside the file: "
                + userdataInfoTable
            )
        );
    }


    return {
        signature,

        headerSize:
            USR_HEADER_SIZE,

        resourceCount,

        userdataCount,

        infoCount,

        resourceInfoTable,

        userdataInfoTable,

        dataOffset,

        reserved,

        fileSize:
            buffer.byteLength,
    };
}


// ============================================================
// INSPECT EMBEDDED DATA
// ============================================================

export function inspectUsrDataStart(
    buffer,
    header
) {
    const reader =
        new BinaryReader(
            buffer
        );

    const offset =
        header.dataOffset;

    const previewSize =
        Math.min(
            64,
            buffer.byteLength
                - offset
        );

    return {
        offset,

        hex:
            reader.hex(
                offset,
                previewSize
            ),

        ascii:
            reader.asciiAt(
                offset,
                Math.min(
                    4,
                    previewSize
                )
            ),
    };
}


// ============================================================
// COMPLETE OUTER USR INSPECTION
// ============================================================

export function inspectUsr(
    buffer
) {
    const header =
        parseUsrHeader(
            buffer
        );

    const dataStart =
        inspectUsrDataStart(
            buffer,
            header
        );

    return {
        header,
        dataStart,
    };
}