export const SF6_IMAGE_CHARACTER_MAP = {
    esf001: { display: "Ryu", folder: "ryu" },
    esf002: { display: "Luke", folder: "luke" },
    esf003: { display: "Kimberly", folder: "kimberly" },
    esf004: { display: "Chun-Li", folder: "chunli" },
    esf005: { display: "Manon", folder: "manon" },
    esf006: { display: "Zangief", folder: "zangief" },
    esf007: { display: "JP", folder: "jp" },
    esf008: { display: "Dhalsim", folder: "dhalsim" },
    esf009: { display: "Cammy", folder: "cammy" },
    esf010: { display: "Ken", folder: "ken" },
    esf011: { display: "Dee Jay", folder: "deejay" },
    esf012: { display: "Lily", folder: "lily" },
    esf013: { display: "A.K.I", folder: "aki" },
    esf014: { display: "Rashid", folder: "rashid" },
    esf015: { display: "Blanka", folder: "blanka" },
    esf016: { display: "Juri", folder: "juri" },
    esf017: { display: "Marisa", folder: "marisa" },
    esf018: { display: "Guile", folder: "guile" },
    esf019: { display: "Ed", folder: "ed" },
    esf020: { display: "E. Honda", folder: "ehonda" },
    esf021: { display: "Jamie", folder: "jamie" },
    esf022: { display: "Akuma", folder: "akuma" },
    esf025: { display: "Sagat", folder: "sagat" },
    esf026: { display: "M. Bison", folder: "vega_mbison" },
    esf027: { display: "Terry", folder: "terry" },
    esf028: { display: "Mai", folder: "mai" },
    esf029: { display: "Elena", folder: "elena" },
    esf030: { display: "C. Viper", folder: "cviper" },
    esf031: { display: "Alex", folder: "alex" },
    esf032: { display: "Ingrid", folder: "ingrid" },
    esf033: { display: "Yasmine", folder: "yasmine" },
};

export const SF6_OUTFIT_COLOR_COUNTS = {
    "001": 10,
    "002": 10,
    "003": 10,
    "004": 10,
    "005": 2,
};

const SF6_IMAGE_ROOT =
    "https://www.streetfighter.com/6/assets/images/character";

export function buildSf6ReferenceUrl(esfId, costumeFolder, paletteNumber) {
    const character = SF6_IMAGE_CHARACTER_MAP[esfId];
    if (!character) return null;

    const colorCount = SF6_OUTFIT_COLOR_COUNTS[costumeFolder] ?? 10;
    if (paletteNumber > colorCount) return null;

    const outfit = costumeFolder.slice(-2);
    const color = Number(paletteNumber).toString().padStart(2, "0");
    return `${SF6_IMAGE_ROOT}/${character.folder}/outfit/l/outfit${outfit}_c${color}.jpg`;
}

export function buildSf6ReferenceImages(cmdEntries) {
    return cmdEntries.flatMap(entry => {
        const metadata = entry.metadata;
        const url = buildSf6ReferenceUrl(
            metadata.esfId,
            metadata.costumeFolder,
            metadata.paletteNumber
        );
        if (!url) return [];
        return [{
            src: url,
            label: `${metadata.characterName} C${metadata.costumeNumber} - Color ${metadata.paletteNumber}`,
            type: "official",
            file: entry.file.name,
            esfId: metadata.esfId,
            costume: metadata.costumeFolder,
            palette: metadata.paletteNumber,
        }];
    });
}

export function preloadImage(src) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve({ ok: true, src });
        img.onerror = () => resolve({ ok: false, src });
        img.src = src;
    });
}

export async function validateReferenceImages(images) {
    const checks = await Promise.all(
        images.map(
            async image => {
                const check = await preloadImage(image.src);
                return check.ok ? image : null;
            }
        )
    );

    return checks.filter(Boolean);
}
