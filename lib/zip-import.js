import { unzip } from "./fflate.js";

/**
 * Keep central-directory order even when large entries finish inflating later.
 * Mod managers may cache entry positions when an existing ZIP is replaced.
 */
export function readCompressedZip(bytes) {
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
