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

## Distant terrain

Beyond the real block chunks, the world keeps going as blocky level-of-detail terrain,
in the style of the Distant Horizons and Voxy mods for Minecraft (`src/lod.js`, `src/lodMesh.js`):

- Sections of 32×32 cells are picked with a quadtree around the player. Each step out doubles
  the cell size (2, 4, 8, 16, 32 blocks), so far terrain stays blocky but cheap.
- A cell's height is the highest block inside it, so distant peaks don't shrink.
- Sections are built in Web Workers straight from the terrain generator, nearest first, and a new
  set replaces the old one only once it's complete, so nothing flickers out while you move.
- Where real chunks are drawn, a per-chunk mask hides the LOD in the shader. In the outermost ring
  of loaded chunks the LOD stays just below the blocks, so the seam never shows sky.

Fog only fades the far edge of the distant terrain (1, 2 or 4 km).

Desktop only for now. Needs a browser with WebGL.

## Play

- **Online:** the GitHub Pages site for this repo, deployed from `main` by `.github/workflows/pages.yml`.
- **Locally:** `python3 -m http.server 8000` in this folder, then open http://localhost:8000.

Click the page to capture the mouse; `Esc` releases it and pauses.

## Settings

Press `Esc`, then **Settings**: block render distance (2–16 chunks), distant terrain range
(off, 1, 2 or 4 km), distant detail (low, medium, high), fog, field of view, mouse sensitivity,
invert mouse Y, and the debug line. Changes apply immediately and are saved in your browser.
If the frame rate is low, lower **Distant detail** first.

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
- `src/lod.js`, `src/lodMesh.js`, `src/lodWorker.js`: distant terrain (quadtree, mesh builder, worker).
- `src/sky.js`: sky gradient that meets the fog at the horizon.
- `src/settings.js`: settings menu and saved preferences.
- `src/player.js`: movement, sprint, sneak, jumping, and collision against the block grid.
- `src/game.js`: render loop, block raycast, break/place, hotbar and HUD.
- `src/blocks.js`: block types and the procedurally painted 16×16 texture atlas.
- `src/input.js`: keyboard, mouse and pointer lock.
