# Voxel Test

A first-pass voxel sandbox that runs in the browser (Three.js, no build step).
The world is flat and infinite: 16×16 chunks load around you as you walk and unload behind you.
Blocks you change are remembered when their chunk unloads.

Desktop only for now. Needs a browser with WebGL.

## Play

- **Online:** the GitHub Pages site for this repo, deployed from `main` by `.github/workflows/pages.yml`.
- **Locally:** `python3 -m http.server 8000` in this folder, then open http://localhost:8000.

Click the page to capture the mouse; `Esc` releases it and pauses.

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

- `src/world.js`: chunk storage, flat generation, streaming, and meshing (hidden faces culled, per-vertex ambient occlusion).
- `src/player.js`: movement, sprint, sneak, jumping, and collision against the block grid.
- `src/game.js`: render loop, block raycast, break/place, hotbar and HUD.
- `src/blocks.js`: block types and the procedurally painted 16×16 texture atlas.
- `src/input.js`: keyboard, mouse and pointer lock.
