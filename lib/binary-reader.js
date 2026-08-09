// ============================================================
// Minimal binary reader for SF6 CMD / USR / RSZ work.
//
// This wraps DataView with explicit little-endian helpers.
// It is intentionally small and dependency-free.
// ============================================================

export class BinaryReader {
    constructor(
        buffer,
        offset = 0,
        length = null
    ) {
        if (
            !(buffer instanceof ArrayBuffer)
        ) {
            throw new TypeError(
                "BinaryReader expects an ArrayBuffer."
            );
        }

        const byteLength =
            length === null
                ? buffer.byteLength - offset
                : length;

        if (
            offset < 0
            || byteLength < 0
            || offset + byteLength
                > buffer.byteLength
        ) {
            throw new RangeError(
                "BinaryReader range is outside the buffer."
            );
        }

        this.buffer = buffer;

        this.view = new DataView(
            buffer,
            offset,
            byteLength
        );

        this.baseOffset = offset;

        this.length = byteLength;

        this.position = 0;
    }


    // ========================================================
    // POSITION
    // ========================================================

    tell() {
        return this.position;
    }


    absoluteOffset() {
        return (
            this.baseOffset
            + this.position
        );
    }


    remaining() {
        return (
            this.length
            - this.position
        );
    }


    seek(
        position
    ) {
        this.assertRange(
            position,
            0
        );

        this.position =
            position;

        return this;
    }


    skip(
        amount
    ) {
        return this.seek(
            this.position
            + amount
        );
    }


    align(
        alignment
    ) {
        if (
            !Number.isInteger(
                alignment
            )
            || alignment <= 0
        ) {
            throw new RangeError(
                "Alignment must be a positive integer."
            );
        }

        const remainder =
            this.position
            % alignment;

        if (
            remainder !== 0
        ) {
            this.skip(
                alignment
                - remainder
            );
        }

        return this;
    }


    // ========================================================
    // RANGE CHECK
    // ========================================================

    assertRange(
        position,
        size
    ) {
        if (
            !Number.isInteger(
                position
            )
            || !Number.isInteger(
                size
            )
            || position < 0
            || size < 0
            || position + size
                > this.length
        ) {
            throw new RangeError(
                (
                    "Binary read outside buffer: "
                    + `position=${position}, `
                    + `size=${size}, `
                    + `length=${this.length}`
                )
            );
        }
    }


    assertReadable(
        size
    ) {
        this.assertRange(
            this.position,
            size
        );
    }


    // ========================================================
    // INTEGER READS
    // ========================================================

    readUint8() {
        this.assertReadable(
            1
        );

        const value =
            this.view.getUint8(
                this.position
            );

        this.position += 1;

        return value;
    }


    readInt8() {
        this.assertReadable(
            1
        );

        const value =
            this.view.getInt8(
                this.position
            );

        this.position += 1;

        return value;
    }


    readUint16() {
        this.assertReadable(
            2
        );

        const value =
            this.view.getUint16(
                this.position,
                true
            );

        this.position += 2;

        return value;
    }


    readInt16() {
        this.assertReadable(
            2
        );

        const value =
            this.view.getInt16(
                this.position,
                true
            );

        this.position += 2;

        return value;
    }


    readUint32() {
        this.assertReadable(
            4
        );

        const value =
            this.view.getUint32(
                this.position,
                true
            );

        this.position += 4;

        return value;
    }


    readInt32() {
        this.assertReadable(
            4
        );

        const value =
            this.view.getInt32(
                this.position,
                true
            );

        this.position += 4;

        return value;
    }


    readBigUint64() {
        this.assertReadable(
            8
        );

        const value =
            this.view.getBigUint64(
                this.position,
                true
            );

        this.position += 8;

        return value;
    }


    readBigInt64() {
        this.assertReadable(
            8
        );

        const value =
            this.view.getBigInt64(
                this.position,
                true
            );

        this.position += 8;

        return value;
    }


    // ========================================================
    // FLOAT READS
    // ========================================================

    readFloat32() {
        this.assertReadable(
            4
        );

        const value =
            this.view.getFloat32(
                this.position,
                true
            );

        this.position += 4;

        return value;
    }


    readFloat64() {
        this.assertReadable(
            8
        );

        const value =
            this.view.getFloat64(
                this.position,
                true
            );

        this.position += 8;

        return value;
    }


    // ========================================================
    // RANDOM ACCESS READS
    // ========================================================

    uint8At(
        position
    ) {
        this.assertRange(
            position,
            1
        );

        return this.view.getUint8(
            position
        );
    }


    uint16At(
        position
    ) {
        this.assertRange(
            position,
            2
        );

        return this.view.getUint16(
            position,
            true
        );
    }


    uint32At(
        position
    ) {
        this.assertRange(
            position,
            4
        );

        return this.view.getUint32(
            position,
            true
        );
    }


    int32At(
        position
    ) {
        this.assertRange(
            position,
            4
        );

        return this.view.getInt32(
            position,
            true
        );
    }


    bigUint64At(
        position
    ) {
        this.assertRange(
            position,
            8
        );

        return this.view.getBigUint64(
            position,
            true
        );
    }


    float32At(
        position
    ) {
        this.assertRange(
            position,
            4
        );

        return this.view.getFloat32(
            position,
            true
        );
    }


    // ========================================================
    // BYTE READS
    // ========================================================

    readBytes(
        size
    ) {
        this.assertReadable(
            size
        );

        const start =
            this.position;

        const end =
            start + size;

        const result =
            new Uint8Array(
                this.view.buffer,
                this.view.byteOffset
                + start,
                size
            );

        this.position =
            end;

        return result;
    }


    bytesAt(
        position,
        size
    ) {
        this.assertRange(
            position,
            size
        );

        return new Uint8Array(
            this.view.buffer,
            this.view.byteOffset
            + position,
            size
        );
    }


    copyBytes(
        position,
        size
    ) {
        return new Uint8Array(
            this.bytesAt(
                position,
                size
            )
        );
    }


    // ========================================================
    // ASCII
    // ========================================================

    readAscii(
        size
    ) {
        return BinaryReader.decodeAscii(
            this.readBytes(
                size
            )
        );
    }


    asciiAt(
        position,
        size
    ) {
        return BinaryReader.decodeAscii(
            this.bytesAt(
                position,
                size
            )
        );
    }


    readNullTerminatedAscii(
        maxLength = null
    ) {
        const bytes = [];

        let count = 0;

        while (
            this.remaining() > 0
        ) {
            if (
                maxLength !== null
                && count >= maxLength
            ) {
                break;
            }

            const value =
                this.readUint8();

            if (
                value === 0
            ) {
                break;
            }

            bytes.push(
                value
            );

            count += 1;
        }

        return BinaryReader.decodeAscii(
            new Uint8Array(
                bytes
            )
        );
    }


    // ========================================================
    // UTF-16LE
    // ========================================================

    readUtf16LeChars(
        charCount
    ) {
        const byteCount =
            charCount * 2;

        const bytes =
            this.readBytes(
                byteCount
            );

        return BinaryReader.decodeUtf16Le(
            bytes
        );
    }


    utf16LeCharsAt(
        position,
        charCount
    ) {
        const byteCount =
            charCount * 2;

        return BinaryReader.decodeUtf16Le(
            this.bytesAt(
                position,
                byteCount
            )
        );
    }


    readNullTerminatedUtf16Le(
        maxChars = null
    ) {
        const codeUnits = [];

        let count = 0;

        while (
            this.remaining() >= 2
        ) {
            if (
                maxChars !== null
                && count >= maxChars
            ) {
                break;
            }

            const value =
                this.readUint16();

            if (
                value === 0
            ) {
                break;
            }

            codeUnits.push(
                value
            );

            count += 1;
        }

        return String.fromCharCode(
            ...codeUnits
        );
    }


    // ========================================================
    // CHILD READER
    // ========================================================

    sliceReader(
        position,
        size
    ) {
        this.assertRange(
            position,
            size
        );

        return new BinaryReader(
            this.buffer,
            this.baseOffset
            + position,
            size
        );
    }


    // ========================================================
    // STATIC DECODERS
    // ========================================================

    static decodeAscii(
        bytes
    ) {
        let result = "";

        for (
            let i = 0;
            i < bytes.length;
            i += 1
        ) {
            result += String.fromCharCode(
                bytes[i]
            );
        }

        return result;
    }


    static decodeUtf16Le(
        bytes
    ) {
        if (
            bytes.length % 2
            !== 0
        ) {
            throw new RangeError(
                "UTF-16LE byte count must be even."
            );
        }

        const codeUnits = [];

        for (
            let i = 0;
            i < bytes.length;
            i += 2
        ) {
            codeUnits.push(
                bytes[i]
                | (
                    bytes[i + 1]
                    << 8
                )
            );
        }

        return String.fromCharCode(
            ...codeUnits
        );
    }


    // ========================================================
    // HEX UTILITY
    // ========================================================

    hex(
        position,
        size
    ) {
        const bytes =
            this.bytesAt(
                position,
                size
            );

        return Array.from(
            bytes,
            byte => (
                byte
                    .toString(16)
                    .padStart(
                        2,
                        "0"
                    )
            )
        ).join(
            " "
        );
    }
}