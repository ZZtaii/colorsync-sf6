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
- Export finished palettes as a mod-ready ZIP.

## Detailed features

- Edit RGBA values and Enable bytes in-place.
- Color Sync: copy an active CMD slot to one or more target slots.
- Pattern Sync: apply the same slot mapping across selected CMD palettes.
- Duplicate Palette: copy a complete palette from a standard, EX, or DX source
  into matching standard target palettes, with an option to undo the last copy.
- Replace an exact color throughout the active CMD.
- Save and restore color states as portable files when you want to resume work
  on the same CMD or ZIP set later.
- Randomize the active slots in one material with Surprise Me, preserving alpha
  and inactive slots, then keep or discard the result.
- Review and revert individual staged changes before export.
- Add custom local images to the resizable reference viewer.
- Inspect DX CMD palettes with clear reference-only labeling.
- See the decoded linear RGB value used by REFramework while keeping visual CMD
  sRGB values primary for editing.
- Jump between Load, Edit, Replace, Sync, and Export from the section rail or
  with the 1-5 keyboard shortcuts.

### Mod ZIP workflow

- Import a mod ZIP up to 200 MiB and preserve its metadata, screenshot, and
  unrelated archive files byte-for-byte.
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
  of the imported archive.
- Optionally save CMD and ZIP exports directly to remembered folders in
  Chromium browsers; other browsers use normal downloads.

## Basic workflow

1. Load one or more CMD palette files for the same character and outfit, or
   drop an existing mod ZIP.
2. If the mod is missing standard palettes, select SF6 Colors.zip to add only
   the missing Colors 1-10.
3. Choose an active CMD and edit slots directly, use Surprise Me, or apply Color
   Sync, Pattern Sync, or Replace Color Everywhere.
4. Review or revert the staged changes.
5. Export modified CMD files, a colors-only ZIP, or a game-ready mod ZIP.

CMD exports are patched at known absolute offsets in the working buffer. This
tool does not rebuild RSZ graphs.  

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

## License

This project is source-available for personal, non-commercial Street Fighter 6
modding use. See [LICENSE.md](LICENSE.md) for the full terms and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party notices.
