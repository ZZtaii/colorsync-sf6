# EMV / Freecam → SF6 Color Sync

Download the current [exporter v1.6 ZIP](SF6-Color-Sync-REFramework-v1.6.zip).
The exporter is also available on
[Nexus Mods](https://www.nexusmods.com/streetfighter6/mods/3837?tab=files).
If EMV Engine and Lua Freecam are not set up yet, follow the
[EMV Engine and Lua Freecam setup video](https://www.youtube.com/watch?v=fKdNqtsoxu0&t=2s).
Keep REFramework installed.

Once EMV Engine and Lua Freecam are ready, place the exporter ZIP in Fluffy
Mod Manager's `Games/SF6/Mods` folder. Refresh the mod list, enable
**SF6 Color Sync - Freecam Exporter**, then start SF6.
When upgrading, disable the older exporter entry before enabling v1.6 and
restart the game to load the new script.

For manual installation, place `SF6 Color Sync.lua` in your SF6 game's
`reframework/autorun/` folder.
This companion script reads EMV's cached material values and adds an
**SF6 Color Sync** panel under REFramework's Script Generated UI.

1. Open the character's **Materials** editor in EMV / Freecam, then edit its
   `CustomizeColor_N` slots normally. Open each mesh's Materials editor for
   meshes you want to include. EMV's **Change Multiple** edits are included
   when its affected meshes are in the material cache.
2. Open **SF6 Color Sync**. Only characters with edited supported colors appear.
   A single edited character is selected automatically. When several have edits,
   choose the character to export. Entries show the Freecam player, character, costume resource, and
   cached mesh count, for example **P1 - Ingrid C2 (8 cached meshes)**.
   Freecam's player roots keep the two actors separate even if a color controller
   is shared. A player owns its hair/head even when those reuse another costume's
   resources; the main body resource supplies the label when available.
   Without player roots, groups use the controller and its body costume when
   ownership is unambiguous. Reused parts from another costume stay in that group;
   unedited cached characters do not add entries.
   If neither is available, select individual meshes and export/import separately.
   Character names are also recognized from resource filenames, mesh names,
   and parent object names when full paths are unavailable, for example
   **Ingrid (costume unknown)**. Runtime names such as `esf032v00` identify
   Ingrid but do not identify her costume. Unidentified players include a
   unique object address so duplicate names remain distinguishable.
   Each copy scans the current cache, including meshes opened since the last
   refresh. If character grouping is unavailable, refresh after opening a new
   mesh so it appears in the picker, then export that mesh separately.
3. Click **Copy for Color Sync**. This exports only color values that differ
   from EMV's original cached values. Unchanged values are omitted, so inactive
   CMD slots do not get enabled unnecessarily. Open EMV before editing; changes
   made before EMV captured its original values cannot be distinguished.
4. Load your target mod ZIP or CMD into Color Sync, select the active color,
   and open **Import Freecam Colors** in section 2. Paste the string, preview
   the changes, and click **Apply Colors**. Inactive Color 1 defaults update the
   actual material files in the loaded mod ZIP, preserving inactive CMD overrides.
   Review the shared palette and component scope shown in the preview.
5. Export your CMD or mod ZIP normally. Material-default edits require their
   material files; use the full mod ZIP for shared bundle components.
   **Undo Last Import** restores the exact pre-import CMD and affected material
   bytes, including earlier edits. Later changes to those files make undo unavailable.

If clipboard copy fails, copy the text box with Ctrl+A / Ctrl+C. Alternatively,
click **Save color export JSON** and import
`reframework/data/SF6ColorSync/colors.sf6freecam.json` with **Load Export JSON**.

## Supported data

- Exact material names and `CustomizeColor_N` indexes.
- Named shader colors, including specular, occlusion, rim light, and `BaseColor`,
  are omitted. Older transfers containing them show unsupported entries in the
  browser preview; valid CustomizeColor entries remain available.
- RGBA vectors between 0 and 1, exported as original runtime floats.
- RGB converts from linear runtime values directly into sRGB CMD bytes, with
  rounding only at the final byte write. Alpha is scaled directly to 0–255.
- Matching ordinary CMD target slots are enabled when their enable field is writable.
- Inactive Color 1 defaults use existing RGB/RGBA MDF properties in the complete
  mod ZIP. Runtime floats are stored directly at float32 precision, with no CMD
  byte quantization. RGB-only properties require alpha 1. Missing or unsupported
  targets appear as skipped entries in the preview.
- Choose any loaded CMD as the target. Import matches its exact material names
  and supported color parameter names. Shared MDF edits can affect other palettes
  and explicitly linked variants; that scope is shown before applying. The exporter does
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
edits. Inactive slots and material defaults are omitted from this CMD-only string export.
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

`skippedFields` counts unsupported or out-of-range edits in the scanned meshes.
It does not count meshes that EMV has not cached, unchanged colors, or slots
without an original cached value. Hair materials listed in a CMD may belong to a
different in-game mesh from the clothing: open that mesh's Materials editor
before editing and copying its colors.

## Validation status

The bridge targets the EMV Engine SILVER `Material` cache inspected from
version `2.0.73-SILVER` and REFramework's Lua APIs. Automated checks use mocked
REFramework/EMV objects and real CMD samples. Version 1.0 was also confirmed
working in-game by the user; version 1.1 removes automatic palette detection.
Version 1.2 scans newly cached meshes on every copy and rejects obsolete cache
wrappers, with regression checks for hair opened after character refresh.
Version 1.3 added named CMD hair colors and player/costume groups. The dropdown
guards shared controllers,
identical raw mesh names, and shared hair resources.
Version 1.4 resolves friendly character names from partial resources and runtime
object names too. Checks cover every mapped character, unknown IDs, and names
without costume information.
Version 1.5 removes named hair shader color exports and controls while retaining
player/costume identification and ordinary CustomizeColor transfers.
Version 1.6 shows only edited characters, automatically selects a single edited
character, and groups reused costume parts under the owning body costume.
Automated cache tests cover the A.K.I. C1/C6 grouping case and independent actors.
The new exporter behavior still needs in-game confirmation.

References: [EMV Engine SILVER](https://github.com/SilverEzredes/EMV-Engine-SILVER),
[REFramework](https://github.com/praydog/REFramework).

## Rebuilding the Fluffy package

Run `node integrations/reframework/build-fluffy-mod.mjs` from the repository
root after updating the Lua script or this guide. The ZIP contains root mod
metadata, the autorun script and a guide under `reframework/data/SF6ColorSync`.
The builder verifies every archived file against its source bytes.
