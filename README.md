# Paletools Mobile + FUT.GG SBC Addon

This repository contains a mobile bookmarklet build of Paletools plus a local addon focused on SBC workflows in EA FC Companion/Web App.

The addon adds:
- FUT.GG rating and cost chips on SBC tiles.
- FUT.GG player detail lookup in player context views.
- On-tile SBC `Auto xN` controls to run Smart Builder + Submit loops.
- Log and helper panels injected into in-app menus.

## Repository Layout

- `paletools-mobile.user.js`
  - Main script userscript payload.
  - Includes upstream Paletools bundle and local FUT.GG addon logic.
- `mobile-bookmark.prod.js`
  - URL-encoded bookmark payload generated from `paletools-mobile.user.js`.
- `index.html`
  - Drag-to-bookmarks page that exposes the bookmarklet from `mobile-bookmark.prod.js`.
- `paletools-mobile-futgg-sbc-ratings.user.js`
  - Older standalone addon variant kept for reference.

## How It Works

1. `paletools-mobile.user.js` is the source of truth.
2. It is URL-encoded into `mobile-bookmark.prod.js` as:
   - `window.paletools["paletools-mobile-custom"] = "...encoded..."`
3. `index.html` loads `mobile-bookmark.prod.js` and sets an anchor `href="javascript:..."`.
4. You drag that anchor to bookmarks and run it on the EA FC web app page.

## Quick Start

1. Open `index.html` in a browser.
2. Drag `Paletools iOS ... (Drag Me)` to your bookmarks bar.
3. Open EA FC Companion web app.
4. Run the bookmark.
5. Go to SBC screens and use the injected controls.

## Development Workflow

### 1) Edit source

Make changes in:
- `paletools-mobile.user.js`

### 2) Bump build ID

Update the build string in all generated touchpoints:
- `paletools-mobile.user.js` (`BUILD_ID`)
- `index.html` script query string and display build text

### 3) Regenerate bookmark payload

Run:

```bash
python3 - <<'PY'
from pathlib import Path
import urllib.parse

build='pt-futgg-YYYYMMDD-XX'
user_path=Path('paletools-mobile.user.js')
text=user_path.read_text().replace("const BUILD_ID = 'OLD';", f"const BUILD_ID = '{build}';")
user_path.write_text(text)

idx=Path('index.html').read_text().replace('OLD', build)
Path('index.html').write_text(idx)

payload=urllib.parse.quote(user_path.read_text(), safe='')
Path('mobile-bookmark.prod.js').write_text(
    'window.paletools=window.paletools||{};\n'
    f'window.paletools["paletools-mobile-custom"]="{payload}";\n'
)
PY
```

### 4) Validate syntax

```bash
node --check paletools-mobile.user.js
```

### 5) Commit and push

```bash
git add paletools-mobile.user.js mobile-bookmark.prod.js index.html
git commit -m "Describe change"
git push origin master
```

## Runtime Notes

- The addon now supports safe reinjection:
  - Previous runtime is shut down on new inject.
  - Old intervals/observers are cleaned up.
  - Old SBC auto buttons are replaced by current build handlers.
- Overlay chip/status UI uses `pointer-events: none` to avoid blocking mobile taps.

## Troubleshooting

### `FUT.GG: ID not detected`

- Open `FUT.GG Logs` from settings/menu and inspect lookup logs.
- Ensure the player details panel is fully open.
- Reinjection can help if handlers are stale.

### SBC `Auto` prompt/max does not match tile

- Reinject latest build.
- Confirm tile labels and prompt come from same injected build.
- In this build, `Repeatable: N` is treated as available count.

### Script appears stuck after first loop

- Check `FUT.GG Logs` for stop reason.
- Common causes are UI flow differences and post-submit navigation state.

## Safety

This project automates UI actions in the official web app. Use at your own risk.

