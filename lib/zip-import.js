import { unzip } from "./fflate.js";

/**
 * Keep central-directory order even when large entries finish inflating later.
 * Mod managers may cache entry positions when an existing ZIP is replaced.
 */
export async function readCompressedZip(bytes, { maxUnpackedBytes = Infinity } = {}) {
    if (Number.isFinite(maxUnpackedBytes)) {
        const unpackedBytes = await measureUnpackedZip(bytes);
        if (unpackedBytes > maxUnpackedBytes) {
            throw Object.assign(new Error("This ZIP unpacks to more than the import limit."), { code: "ZIP_TOO_LARGE", unpackedBytes });
        }
    }
    return new Promise((resolve, reject) => {
        const paths = [];
        const seen = new Set();
        let duplicatePath = null;
        unzip(bytes, {
            filter({ name }) {
                if (seen.has(name)) {
                    duplicatePath ??= name;
                    return false;
                }
                seen.add(name);
                paths.push(name);
                return true;
            },
        }, (error, files) => {
            if (error) reject(error);
            else if (duplicatePath !== null) {
                reject(new Error(`This ZIP contains a duplicate path: ${duplicatePath}. Rebuild it with one entry per path.`));
            } else {
                resolve(Object.fromEntries(paths.map(path => [path, files[path]])));
            }
        });
    });
}

/**
 * Total unpacked size as declared in the central directory. Nothing is inflated, so an oversized
 * archive can be refused before it takes any memory.
 */
export function measureUnpackedZip(bytes) {
    return new Promise((resolve, reject) => {
        let total = 0;
        unzip(bytes, {
            filter({ originalSize }) {
                total += originalSize;
                return false;
            },
        }, error => (error ? reject(error) : resolve(total)));
    });
}
