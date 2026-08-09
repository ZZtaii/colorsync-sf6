// ============================================================
// SF6 RSZ Type Registry
//
// Loads rszsf6.json and resolves numeric RSZ type IDs to
// their class/type definitions.
//
// REasy's JSON uses lowercase hexadecimal keys without "0x".
// Example:
//
//     0xf3356698
//
// becomes:
//
//     "f3356698"
// ============================================================


export class TypeRegistry {
    constructor(
        registryObject
    ) {
        if (
            !registryObject
            || typeof registryObject
                !== "object"
            || Array.isArray(
                registryObject
            )
        ) {
            throw new TypeError(
                "TypeRegistry expects the parsed rszsf6.json object."
            );
        }

        this.registry =
            registryObject;

        this.nameIndex =
            null;

            
    }


    // ========================================================
    // TYPE ID KEY
    // ========================================================

    static keyFromTypeId(
        typeId
    ) {
        if (
            !Number.isInteger(
                typeId
            )
            || typeId < 0
        ) {
            throw new TypeError(
                "RSZ type ID must be an unsigned integer."
            );
        }

        return (
            typeId >>> 0
        )
            .toString(16);
    }


    // ========================================================
    // LOOKUP BY TYPE ID
    // ========================================================

    getTypeInfo(
        typeId
    ) {
        const key =
            TypeRegistry.keyFromTypeId(
                typeId
            );

        return (
            this.registry[key]
            ?? null
        );
    }


    getTypeName(
        typeId
    ) {
        const info =
            this.getTypeInfo(
                typeId
            );

        if (
            !info
            || typeof info.name
                !== "string"
        ) {
            return null;
        }

        return info.name;
    }


    getFields(
        typeId
    ) {
        const info =
            this.getTypeInfo(
                typeId
            );

        if (
            !info
            || !Array.isArray(
                info.fields
            )
        ) {
            return [];
        }

        return info.fields;
    }


// ========================================================
// LOOKUP BY NAME
// ========================================================


    // ========================================================
    // LOOKUP BY NAME
    // ========================================================

    buildNameIndex() {
        const index =
            new Map();

        for (
            const [
                key,
                info,
            ]
            of Object.entries(
                this.registry
            )
        ) {
            if (
                !info
                || typeof info
                    !== "object"
                || typeof info.name
                    !== "string"
            ) {
                continue;
            }

            const typeId =
                Number.parseInt(
                    key,
                    16
                );

            if (
                !Number.isFinite(
                    typeId
                )
            ) {
                continue;
            }

            index.set(
                info.name,
                {
                    typeId:
                        typeId >>> 0,

                    info,
                }
            );
        }

        this.nameIndex =
            index;
    }


    findTypeByName(
        name
    ) {
        if (
            this.nameIndex === null
        ) {
            this.buildNameIndex();
        }

        return (
            this.nameIndex.get(
                name
            )
            ?? null
        );
    }
}


// ============================================================
// LOAD STATIC JSON
// ============================================================

export async function loadSf6TypeRegistry(
    url = "./data/rszsf6.min.json"
) {
    const response =
        await fetch(
            url
        );

    if (
        !response.ok
    ) {
        throw new Error(
            (
                "Could not load SF6 type registry: "
                + `${response.status} `
                + response.statusText
            )
        );
    }

    const json =
        await response.json();

    return new TypeRegistry(
        json
    );
}


// ============================================================
// RESOLVE INSTANCE TABLE
// ============================================================

export function resolveInstanceTypes(
    instanceInfos,
    registry
) {
    return instanceInfos.map(
        instance => {
            const typeInfo =
                registry.getTypeInfo(
                    instance.typeId
                );

            return {
                ...instance,

                typeName:
                    typeInfo?.name
                    ?? null,

                typeFound:
                    Boolean(
                        typeInfo
                    ),
            };
        }
    );
}