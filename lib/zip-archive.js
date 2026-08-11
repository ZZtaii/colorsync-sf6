import { AsyncZipDeflate, Zip, ZipDeflate } from "./fflate.js";

const ASYNC_COMPRESSION_MIN_BYTES = 160_000;

function joinChunks(chunks, totalBytes) {
    const output = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        output.set(chunk, offset);
        offset += chunk.length;
    }
    return output;
}

function compressEntry(archive, path, bytes, level) {
    return new Promise((resolve, reject) => {
        const useWorker = typeof Worker !== "undefined" && bytes.length >= ASYNC_COMPRESSION_MIN_BYTES;
        const entry = useWorker
            ? new AsyncZipDeflate(path, { level })
            : new ZipDeflate(path, { level });

        archive.add(entry);
        const writeEntryData = entry.ondata;
        entry.ondata = (error, chunk, final) => {
            writeEntryData(error, chunk, final);
            if (error) reject(error);
            else if (final) resolve();
        };

        // AsyncZipDeflate transfers its input buffer to a worker. Send a copy so
        // imported mod entries remain available for later exports and restores.
        entry.push(useWorker ? bytes.slice() : bytes, true);
    });
}

/**
 * Builds a DEFLATE-compressed ZIP without starting a worker for every large
 * archive entry at once. Sequential workers cap peak memory use for large mods.
 */
export function createCompressedZip(files, { level = 6, onProgress } = {}) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;
        let settled = false;
        const archive = new Zip((error, chunk, final) => {
            if (settled) return;
            if (error) {
                settled = true;
                reject(error);
                return;
            }
            chunks.push(chunk);
            totalBytes += chunk.length;
            if (final) {
                settled = true;
                resolve(joinChunks(chunks, totalBytes));
            }
        });

        (async () => {
            const entries = Object.entries(files);
            for (let index = 0; index < entries.length; index += 1) {
                const [path, bytes] = entries[index];
                await compressEntry(archive, path, bytes, level);
                onProgress?.(index + 1, entries.length, path);
            }
            archive.end();
        })().catch(error => {
            if (settled) return;
            settled = true;
            archive.terminate();
            reject(error);
        });
    });
}
