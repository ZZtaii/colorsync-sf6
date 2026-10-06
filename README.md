# SF6 CMD Color Sync

A browser-based color editor for Street Fighter 6 CMD palette files.

## Use the app

**[Open SF6 CMD Color Sync](https://colorsync-sf6.pages.dev/)**

[Feature Guide](https://colorsync-sf6.pages.dev/features) ·
[Changelog](https://colorsync-sf6.pages.dev/changelog/)

Load CMD (`.user.*`) files for the same character and outfit, or import an
existing mod ZIP. Edit CustomizeColor slots, synchronize colors between
materials or palettes, and export modified CMD files or a game-ready mod ZIP.
All file processing happens locally in your browser. Files are never uploaded
to a server.

## Features

- Edit Street Fighter 6 CMD palette colors in your browser.
- Sync colors and patterns across costume palettes.
- Copy a complete palette to another color with Duplicate Palette.
- Save your color work and restore it later.
- Import edited in-game colors from EMV / Lua Freecam with one copy and paste.
- Export the active CMD's current colors as a string to paste back into Color Sync.
- Export finished palettes as a mod-ready ZIP.

## Detailed features

- Edit colors for any material slot.
- Edit inactive Color 1 material defaults from the actual mod ZIP while keeping
  their CMD overrides inactive. Shared defaults show the affected palettes and
  component variants before export.
- Replace an exact color throughout the active CMD.
- Randomize the active slots in one material with Surprise Me.
- Add custom local images to the resizable reference viewer.
- Color Sync: copy an active CMD slot to one or more target slots.
- Pattern Sync: apply the same slot mapping across selected CMD palettes.
- Duplicate Palette: swap all colors from the current active slot to another,
  e.g. swapping EX Color 2 to Color 9.
- Save and restore color states as portable files. Or enable backups and restore
  anytime from exported colors.
- Jump between Load, Edit, Replace, Sync, and Export from the section rail or
  with the 1-5 keyboard shortcut.

### Mod ZIP workflow

- Import a mod ZIP up to 200 MiB and preserve its metadata, screenshot, and
  unrelated archive files byte-for-byte.
- Preserve the imported ZIP's entry order during background decompression and
  full export. When no entries are removed, existing positions stay intact;
  new files are appended.
- Keep CMD palettes already supplied by a mod and fill only missing standard
  Colors 1-10 from
  [SF6 Colors.zip](https://www.nexusmods.com/streetfighter6/mods/3837?tab=files).
  EX and DX library entries are excluded.
- Optionally remember one SF6 Colors.zip in browser storage for future imports,
  including in Firefox, and remove it at any time with the Forget control.
- Restore original colors or dated pre-export snapshots embedded in ZIPs built
  by Color Sync. Restores remain staged until a new ZIP is exported.
- Build a [Fluffy Manager](https://www.fluffyquack.com/)-ready mod ZIP with
  `modinfo.ini` and an optional screenshot.
- Export a colors-only ZIP when you want the edited CMD files without the rest
  of the imported archive. Material files required by default-color edits are
  included too when they belong to the same mod component. Shared defaults in
  dependent bundle variants require the full mod ZIP.
- Optionally save CMD and ZIP exports directly to remembered folders in
  Chromium browsers; other browsers use normal downloads.

When updating a mod already installed in Fluffy, disable its components before
replacing the ZIP, refresh the mod list, then enable them again. If an earlier
export was installed with mismatched cached file indexes, use a newly named
replacement ZIP after removing the old archive from the Mods folder.

## Basic workflow

1. Load one or more CMD palette files for the same character and outfit, or
   drop an existing mod ZIP.
2. If the mod is missing standard palettes, select SF6 Colors.zip to add only
   the missing Colors 1-10.
3. Choose an active CMD and edit slots directly, use Surprise Me, or apply Color
   Sync, Pattern Sync, or Replace Color Everywhere.
4. Review or revert the staged changes.
5. Export modified CMD files, a colors-only ZIP, or a game-ready mod ZIP.

Normal CMD color exports patch existing color fields at known offsets. Material
default edits patch existing MDF color properties with the game's linear RGB
values; unrelated material properties and file structure are preserved.

### Material defaults and inactive slots

Load the complete mod ZIP when editing an inactive Color 1 CustomizeColor slot.
If its material file is available, the editor updates the material default and
retains the inactive CMD override. Defaults are shared by palettes that do not
override that slot; the editor shows that scope. Existing active palette colors
continue to use their CMD values.

For component bundles, the editor also reads the material files from variants
that explicitly depend on the selected Main files entry. Default edits update
those matching variants together. Unrelated mod components remain untouched.
Materials or color properties absent from the actual mod's MDF files are read
only. A loose Color 1 CMD needs the full mod ZIP for inactive default edits.

Use the full mod ZIP for shared defaults across bundle components. A single-mod
colors-only ZIP can also carry its material edits. A CMD-only export cannot
carry the material files. Current Changes, revert, saved color states,
and color backups include material default edits. Freecam imports use the same
safe material-default route and preserve their runtime float values. Palette
duplication that would activate an inactive default requires the direct color
editor or sync workflow instead.

## EMV / Lua Freecam color import

Get the current [exporter v1.6 ZIP](integrations/reframework/SF6-Color-Sync-REFramework-v1.6.zip).
For EMV Engine and Lua Freecam setup, follow the
[setup video](https://www.youtube.com/watch?v=fKdNqtsoxu0&t=2s).
Once both are ready, enable the exporter ZIP in Fluffy Mod Manager.
For manual installation, place the [Lua exporter](integrations/reframework/SF6%20Color%20Sync.lua)
in your game's `reframework/autorun` folder. Open Materials before editing colors,
open REFramework's **SF6 Color Sync** panel, and click **Copy for Color Sync**.
Only characters with edited supported colors appear. A single edited character
is selected automatically; choose one when multiple characters have edits.
Reused costume parts stay with their owning character's body costume.
In section 2 of the browser editor, use **Import Freecam Colors** to paste,
preview, and apply the supported slots to the active CMD of your choice.
Material names and CustomizeColor indexes determine matches. Named shader
colors are omitted. Inactive Color 1 defaults need the complete mod ZIP; the
preview shows their shared scope, and import updates their material files
without activating CMD overrides. Export the full mod ZIP for shared components.
See the [setup and format guide](integrations/reframework/README.md).

## Copyable color exports

In section 2, select the active color and open **Export Colors as String**.
Use **Generate String** to view the export, or **Copy String** to generate and
copy it directly. The export includes every active supported color field
from the working CMD's CustomizeColor slots, including applied edits.
Inactive fields are omitted.
Paste the string into **Import Freecam Colors**, preview it for your chosen
CMD, then apply. RGB and alpha survive an export/import round trip exactly.

Copy always generates a fresh string. Editing or switching the active CMD
clears the earlier string. If clipboard access is unavailable, the text is
selected for manual copying with Ctrl+C.

## Run locally

This is a static ES-module site. It needs an HTTP server; opening `index.html`
with `file://` will not work.

### With Node.js

```powershell
npx --yes serve -l 8000
```

### With Python

```powershell
python -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

There is no package installation, bundler, or build step.

## Browser support

The editor and remembered SF6 Colors.zip option work in current desktop
browsers. Remembered direct-folder exports use the File System Access API and
are available in Chromium-based browsers. Firefox uses its standard download
flow instead.

Imported mod files and custom reference images are held only for the current
session and are released when unloaded. The optional remembered SF6 Colors.zip
is the only imported archive deliberately stored by the app, and the Forget
control removes it.

## Project credits

- RSZ and CMD color-data understanding:
  [REasy](https://github.com/seifhassine/REasy).
- ZIP generation: [fflate](https://github.com/101arrowz/fflate).
- Live material editing integration:
  [EMV Engine SILVER](https://github.com/SilverEzredes/EMV-Engine-SILVER) and
  [REFramework](https://github.com/praydog/REFramework).

## License

This project is source-available for personal, non-commercial Street Fighter 6
modding use. See [LICENSE.md](LICENSE.md) for the full terms and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party notices.
