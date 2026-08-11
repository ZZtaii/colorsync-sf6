# Agent handoff — v1.1 local checkpoint

## Current state

This repository contains the completed local v1.1 feature slice requested on
11 August 2026. It has not been pushed or deployed. The commit containing this
file is the checkpoint to continue from.

## What changed

- Existing mod ZIPs preserve their non-CMD files, metadata, and root screenshot
  through export.
- Exported ZIPs now own a versioned `backup_colors/` history with an original
  color set and dated pre-export snapshots. Re-importing a recognized ZIP shows
  restore controls; restores are staged for review before the next export.
- Partial mod palettes keep their supplied standard CMDs and fill only missing
  Colors 1–10 from a user-selected `SF6 Colors.zip`. EX/DX files in that library
  are ignored.
- The Reference viewer remains available. Direct DX loads are reference-only;
  DX/EX entries from `SF6 Colors.zip` are not imported.
- The material inspector has a `Surprise Me` action only while its material is
  expanded. It randomizes RGB for active editable slots, preserves alpha, and
  ignores inactive slots. `Discard Surprise` then appears beside it and restores
  the material to its state before the first randomization.
- The desktop section rail jumps instantly to sections and supports number keys
  1–5. It is intentionally hidden at mobile widths and visually subdued.
- Added a simple Changelog page with released v1.0/v1.1 entries, expanded the
  Feature Guide, added a v1.1 header notice, and updated navigation/SEO files.
- Test scripts live in the gitignored `scripts/` directory as requested.

## Important files

- `app.js` — import completion, backup restore UI/state, section navigation,
  Surprise Me and contextual discard behavior.
- `lib/color-backups.js` — backup path filtering, manifest validation, and
  snapshot archive construction.
- `index.html`, `styles.css` — new controls and visual treatment.
- `features/index.html`, `changelog/index.html` — v1.1 documentation.
- `data/feature-guide/*.png` — browser-generated feature screenshots.

## Verification completed

Run from the repository root:

```powershell
node --check app.js
node --test scripts/color-backups.test.mjs scripts/site-pages.test.mjs
node scripts/ui-regression.test.mjs
git diff --check
```

Latest results before this checkpoint:

- 9 Node tests passed.
- Full browser regression passed with 4 live CMDs, 2 snapshots, 4 restored CMDs,
  and 0 console errors.
- Visual review confirmed the section rail and horizontal Surprise/Discard
  controls match the existing desktop UI.

## Local test inputs and notes

- Approved screenshot source mod:
  `D:\Games\Fluffy - Copy\Games\SF6\Mods\Black Widow Colors.zip`
- The user stated they have the mod author's permission to use it in screenshots.
- User-provided reference screenshot:
  `C:\Users\Zain\Pictures\Screenshots\Screenshot 2026-08-10 201134.png`
- Browser test dependencies/artifacts are under ignored `temp/browser-test/`.
- Do not force-add `scripts/`, `temp/`, or other ignored browser artifacts.

## Product decisions to preserve

- Backup format was safe to change because it had not shipped before this work.
- Restore copy should say `Before export` and describe it as the state immediately
  before that export; avoid references to a global “Revert All Changes” action.
- Mod-provided standard palettes always win over the shared color library.
- ZIP color-library imports must not load EX/DX palettes.
- The tool is not designed for mobile; the desktop section rail should remain
  completely hidden on mobile.
