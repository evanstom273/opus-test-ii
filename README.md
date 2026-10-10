# Voxel Test

A first-pass voxel sandbox that runs in the browser (Three.js, no build step).
The world is infinite and procedurally generated: 16×16×256 chunks load around you as you walk
and unload behind you. Blocks you change are remembered when their chunk unloads.

## Terrain

Heights come from three layers of OpenSimplex2 noise (`src/noise.js`, `src/terrain.js`):

- **Region map:** very low-frequency fBm (about 700 blocks per feature) decides where plains,
  rolling hills and mountains are, with smooth blends between them.
- **Base elevation:** 5-octave fBm for ordinary hills, valleys and height changes.
  Plains use a damped version of it; hills use it at full strength.
- **Mountains:** ridged multifractal noise added on top, which gives sharp crests and ridgelines
  instead of oversized rounded hills. Peaks reach about y=230.

Surfaces are grass over three blocks of dirt over stone. Steep slopes and anything above y=168 are bare stone.
Add `?seed=123` to the URL to generate a different world.

Desktop only for now. Needs a browser with WebGL.

## Play

- **Online:** the GitHub Pages site for this repo, deployed from `main` by `.github/workflows/pages.yml`.
- **Locally:** `python3 -m http.server 8000` in this folder, then open http://localhost:8000.

Click the page to capture the mouse; `Esc` releases it and pauses.

## Settings

Press `Esc`, then **Settings**: render distance (2–16 chunks), field of view, mouse sensitivity,
invert mouse Y, and the debug line. Changes apply immediately and are saved in your browser.

## Controls

| Key | Action |
|---|---|
| W A S D | Move |
| Mouse | Look |
| Space | Jump |
| Ctrl | Sprint (hold while moving forward; lasts until you stop) |
| Shift | Sneak: crouch, move slowly, and don't walk off edges |
| Left click | Break block (bedrock can't be broken) |
| Right click | Place the selected block |
| 1–8 / mouse wheel | Choose block |

Press Ctrl *after* W. Browsers reserve Ctrl+W for closing the tab and no page can block it,
so the game asks for confirmation before the page closes.

## Code

- `src/noise.js`: OpenSimplex2, fBm and ridged multifractal noise.
- `src/terrain.js`: region blending, column heights and surface blocks.
- `src/world.js`: chunk storage, streaming, and meshing (hidden faces culled, per-vertex ambient occlusion).
- `src/settings.js`: settings menu and saved preferences.
- `src/player.js`: movement, sprint, sneak, jumping, and collision against the block grid.
- `src/game.js`: render loop, block raycast, break/place, hotbar and HUD.
- `src/blocks.js`: block types and the procedurally painted 16×16 texture atlas.
- `src/input.js`: keyboard, mouse and pointer lock.
