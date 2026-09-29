# EMV / Freecam → SF6 Color Sync

Download the exporter ZIP from
[Nexus Mods](https://www.nexusmods.com/streetfighter6/mods/3837?tab=files).
If EMV Engine and Lua Freecam are not set up yet, follow the
[EMV Engine and Lua Freecam setup video](https://www.youtube.com/watch?v=fKdNqtsoxu0&t=2s).
Keep REFramework installed.

Once EMV Engine and Lua Freecam are ready, place the exporter ZIP in Fluffy
Mod Manager's `Games/SF6/Mods` folder. Refresh the mod list, enable
**SF6 Color Sync - Freecam Exporter**, then start SF6.

For manual installation, place `SF6 Color Sync.lua` in your SF6 game's
`reframework/autorun/` folder.
This companion script reads EMV's cached material values and adds an
**SF6 Color Sync** panel under REFramework's Script Generated UI.

1. Open the character's **Materials** editor in EMV / Freecam, then edit its
   `CustomizeColor_N` colors normally. Open each mesh's Materials editor for
   meshes you want to include. EMV's **Change Multiple** edits are included
   when its affected meshes are in the material cache.
2. Open **SF6 Color Sync**, click **Refresh characters**, and select the
   character. When a PlayerColorController is available, cached meshes belonging
   to the same character are grouped together. Otherwise, select individual
   meshes and export/import them separately.
3. Click **Copy for Color Sync**. This exports only color values that differ
   from EMV's original cached values. Unchanged values are omitted, so inactive
   CMD slots do not get enabled unnecessarily. Open EMV before editing; changes
   made before EMV captured its original values cannot be distinguished.
4. Load your target mod ZIP or CMD into Color Sync, select the active color,
   and open **Import Freecam Colors** in section 2. Paste the string, preview
   the changes, and click **Apply to Active CMD**.
5. Export your CMD or mod ZIP normally. **Undo Last Import** restores the exact
   pre-import buffer, including enable flags and earlier edits. It is available
   only while that CMD has no later changes.

If clipboard copy fails, copy the text box with Ctrl+A / Ctrl+C. Alternatively,
click **Save color export JSON** and import
`reframework/data/SF6ColorSync/colors.sf6freecam.json` with **Load Export JSON**.

## Supported data

- Exact material names and `CustomizeColor_N` indexes.
- RGBA vectors between 0 and 1, exported as original runtime floats.
- RGB converts from linear runtime values directly into sRGB CMD bytes, with
  rounding only at the final byte write. Alpha is scaled directly to 0–255.
- Matching target slots are enabled when their enable field is writable.
- Choose any loaded CMD as the target. Import modifies only that active CMD,
  matching exact material names and CustomizeColor indexes. The exporter does
  not detect the source palette, and the browser ignores palette metadata in
  older exports.
- Missing materials/slots, ambiguous CMD material names and conflicting
  mesh values are reported and skipped. Import the full mod ZIP with its MDF
  to make custom materials available through Color Sync's existing workflow.
- Other shader settings, blend rates, roughness, metalness, textures, and
  out-of-range/HDR vectors are omitted. This script does not write game values
  or CMD files and does not require the RSZ parser DLL.

## Version 1 transfer format

Color Sync's **Export Colors as String** panel uses this same format. It exports
all active supported slots from the selected working CMD, including applied
edits. Inactive slots are omitted because matching imported slots become active.
CMD bytes are decoded to full-precision linear floats so re-importing preserves
RGB and alpha bytes exactly. No REFramework installation is needed for this
browser-to-browser transfer.

Clipboard text starts with `SF6COLORS:1:` followed by compact JSON. File imports
also accept the same JSON without the prefix. Unicode names use JSON escapes
to preserve them through REFramework's Windows text clipboard. For example:

```json
{
  "format": "sf6-freecam-colors",
  "version": 1,
  "colorSpace": "linear",
  "source": {
    "object": "Player 1"
  },
  "changes": [
    { "material": "esf_Body00", "parameter": "CustomizeColor_0", "rgba": [0.25, 0.1, 0.05, 1] }
  ],
  "skippedFields": 0
}
```

The browser validates the whole payload before any edits. Maximum: 1 MiB and
4096 changes. Identical copies from multiple meshes combine into one slot;
different values for the same material/index are skipped rather than guessed.

## Validation status

The bridge targets the EMV Engine SILVER `Material` cache inspected from
version `2.0.73-SILVER` and REFramework's Lua APIs. Automated checks use mocked
REFramework/EMV objects and real CMD samples. Version 1.0 was also confirmed
working in-game by the user; version 1.1 removes automatic palette detection.

References: [EMV Engine SILVER](https://github.com/SilverEzredes/EMV-Engine-SILVER),
[REFramework](https://github.com/praydog/REFramework).

## Rebuilding the Fluffy package

Run `node integrations/reframework/build-fluffy-mod.mjs` from the repository
root after updating the Lua script or this guide. The ZIP contains root mod
metadata, the autorun script and a guide under `reframework/data/SF6ColorSync`.
The builder verifies every archived file against its source bytes.
