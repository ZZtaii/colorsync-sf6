# SF6 CMD Color Sync

A browser-based color editor for Street Fighter 6 CMD palette files.

## Use the app

**[Open SF6 CMD Color Sync](https://colorsync-sf6.pages.dev/)**

Load CMD (`.user.*`) files for the same character and costume, edit their
CustomizeColor slots, synchronize colors between materials or palettes, and
export modified CMD files or a game-ready mod ZIP. All file processing happens
locally in your browser—files are never uploaded to a server.

## Features

- Edit RGBA values and Enable bytes in-place.
- Color Sync: copy an active CMD slot to one or more target slots.
- Pattern Sync: apply the same slot mapping across selected CMD palettes.
- Replace an exact color throughout the active CMD.
- Review, revert, and export only staged changes.
- Build a [Fluffy Manager](https://www.fluffyquack.com/)-ready mod ZIP with `modinfo.ini` and an optional
  screenshot.
- Optionally save CMD and ZIP exports directly to remembered folders in
  Chromium browsers; other browsers use normal downloads.

## Basic workflow

1. Load one or more CMD palette files for the same character and costume.
2. Choose an active CMD and edit slots directly, or use Color Sync / Pattern
   Sync.
3. Review the staged changes.
4. Export modified CMD files, or build a game-ready ZIP.

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

The editor itself works in current desktop browsers. Remembered direct-folder
exports use the File System Access API and are available in Chromium-based
browsers. Firefox uses its standard download flow instead.

## Project credits

- RSZ understanding: [REasy](https://github.com/seifhassine/REasy) and its
  contributors.
- ZIP generation: [fflate](https://github.com/101arrowz/fflate).

## License

This project is source-available for personal, non-commercial Street Fighter 6
modding use. See [LICENSE.md](LICENSE.md) for the full terms and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party notices.
