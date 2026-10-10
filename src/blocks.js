// Block types and a procedurally painted texture atlas (16x16 pixel tiles).
import * as THREE from 'three';

export const AIR = 0;

// tiles: [top, side, bottom] atlas indices
export const BLOCKS = [
  null,
  { id: 1, name: 'Grass', tiles: [0, 1, 2] },
  { id: 2, name: 'Dirt', tiles: [2, 2, 2] },
  { id: 3, name: 'Stone', tiles: [3, 3, 3] },
  { id: 4, name: 'Cobblestone', tiles: [4, 4, 4] },
  { id: 5, name: 'Planks', tiles: [5, 5, 5] },
  { id: 6, name: 'Log', tiles: [7, 6, 7] },
  { id: 7, name: 'Bricks', tiles: [8, 8, 8] },
  { id: 8, name: 'Sand', tiles: [9, 9, 9] },
  { id: 9, name: 'Bedrock', tiles: [10, 10, 10], unbreakable: true },
];

export const GRASS = 1, DIRT = 2, STONE = 3, BEDROCK = 9;

// Blocks offered in the hotbar, in slot order.
export const HOTBAR = [1, 2, 3, 4, 5, 6, 7, 8];

export const TILE = 16;
export const ATLAS_TILES = 11;

// Small deterministic RNG so the textures look the same on every load.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade([r, g, b], f) {
  return `rgb(${Math.max(0, Math.min(255, r * f)) | 0},${Math.max(0, Math.min(255, g * f)) | 0},${Math.max(0, Math.min(255, b * f)) | 0})`;
}

// Fill a tile with per-pixel brightness noise around a base colour.
function speckle(ctx, ox, base, amount, seed) {
  const r = rng(seed);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      ctx.fillStyle = shade(base, 1 - amount + r() * amount * 2);
      ctx.fillRect(ox + x, y, 1, 1);
    }
  }
}

const PAINTERS = [
  // 0 grass top
  (ctx, ox) => speckle(ctx, ox, [96, 160, 62], 0.16, 1),
  // 1 grass side: dirt with a ragged grass fringe
  (ctx, ox) => {
    speckle(ctx, ox, [134, 96, 67], 0.14, 2);
    const r = rng(3);
    for (let x = 0; x < TILE; x++) {
      const depth = 3 + Math.floor(r() * 3);
      for (let y = 0; y < depth; y++) {
        ctx.fillStyle = shade([96, 160, 62], 0.85 + r() * 0.3);
        ctx.fillRect(ox + x, y, 1, 1);
      }
    }
  },
  // 2 dirt
  (ctx, ox) => speckle(ctx, ox, [134, 96, 67], 0.14, 4),
  // 3 stone
  (ctx, ox) => {
    speckle(ctx, ox, [125, 125, 125], 0.1, 5);
    const r = rng(6);
    for (let i = 0; i < 7; i++) {
      const x = Math.floor(r() * 13), y = Math.floor(r() * 15);
      ctx.fillStyle = shade([125, 125, 125], 0.78);
      ctx.fillRect(ox + x, y, 2 + Math.floor(r() * 2), 1);
    }
  },
  // 4 cobblestone: irregular rounded stones with dark mortar
  (ctx, ox) => {
    ctx.fillStyle = 'rgb(70,70,70)';
    ctx.fillRect(ox, 0, TILE, TILE);
    const r = rng(7);
    const stones = [[0, 0, 7, 5], [8, 0, 8, 4], [0, 6, 5, 5], [6, 5, 6, 6], [13, 5, 3, 6], [0, 12, 8, 4], [9, 12, 7, 4]];
    for (const [x, y, w, h] of stones) {
      const f = 0.85 + r() * 0.35;
      for (let yy = 0; yy < h - 1; yy++) {
        for (let xx = 0; xx < w - 1; xx++) {
          const edge = yy === 0 || xx === 0 ? 1.12 : 1;
          ctx.fillStyle = shade([128, 128, 128], f * edge * (0.92 + r() * 0.16));
          ctx.fillRect(ox + x + xx, y + yy, 1, 1);
        }
      }
    }
  },
  // 5 planks
  (ctx, ox) => {
    speckle(ctx, ox, [168, 132, 82], 0.08, 8);
    ctx.fillStyle = shade([168, 132, 82], 0.62);
    for (const y of [3, 7, 11, 15]) ctx.fillRect(ox, y, TILE, 1);
    for (const [x, y] of [[4, 0], [11, 4], [2, 8], [9, 12]]) ctx.fillRect(ox + x, y, 1, 3);
  },
  // 6 log side: vertical bark stripes
  (ctx, ox) => {
    const r = rng(9);
    for (let x = 0; x < TILE; x++) {
      const f = 0.8 + r() * 0.35;
      for (let y = 0; y < TILE; y++) {
        ctx.fillStyle = shade([104, 80, 50], f * (0.93 + r() * 0.14));
        ctx.fillRect(ox + x, y, 1, 1);
      }
    }
  },
  // 7 log top: growth rings
  (ctx, ox) => {
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        const ring = d > 6.5 ? 0.62 : Math.floor(d) % 2 ? 0.9 : 1.05;
        ctx.fillStyle = shade(d > 6.5 ? [104, 80, 50] : [176, 142, 92], ring);
        ctx.fillRect(ox + x, y, 1, 1);
      }
    }
  },
  // 8 bricks
  (ctx, ox) => {
    ctx.fillStyle = 'rgb(196,186,176)';
    ctx.fillRect(ox, 0, TILE, TILE);
    const r = rng(10);
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 4 : 0;
      for (let b = -1; b < 2; b++) {
        const x0 = b * 8 + off;
        const f = 0.85 + r() * 0.25;
        for (let yy = 0; yy < 3; yy++) {
          for (let xx = 0; xx < 7; xx++) {
            const x = x0 + xx;
            if (x < 0 || x >= TILE) continue;
            ctx.fillStyle = shade([150, 72, 56], f * (0.94 + r() * 0.12));
            ctx.fillRect(ox + x, row * 4 + yy, 1, 1);
          }
        }
      }
    }
  },
  // 9 sand
  (ctx, ox) => speckle(ctx, ox, [219, 207, 160], 0.07, 11),
  // 10 bedrock
  (ctx, ox) => {
    const r = rng(12);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        ctx.fillStyle = shade([80, 80, 80], r() < 0.35 ? 0.45 : 0.8 + r() * 0.6);
        ctx.fillRect(ox + x, y, 1, 1);
      }
    }
  },
];

export function createAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = TILE * ATLAS_TILES;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  PAINTERS.forEach((paint, i) => paint(ctx, i * TILE));
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  // Mip levels are averaged inside each tile so tiles never bleed into each
  // other; without them distant ground shimmers.
  tex.mipmaps = buildMipmaps(canvas);
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture: tex };
}

function buildMipmaps(canvas) {
  const levels = [canvas];
  let src = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  for (let size = TILE / 2; size >= 1; size /= 2) {
    const w = size * ATLAS_TILES, h = size;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const dst = ctx.createImageData(w, h);
    // Each destination pixel averages a 2x2 block, which always stays inside
    // one tile because tile sizes are powers of two.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let ch = 0; ch < 4; ch++) {
          let sum = 0;
          for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) sum += src.data[((y * 2 + dy) * src.width + x * 2 + dx) * 4 + ch];
          }
          dst.data[(y * w + x) * 4 + ch] = sum / 4;
        }
      }
    }
    ctx.putImageData(dst, 0, 0);
    levels.push(c);
    src = dst;
  }
  return levels;
}

// Draw one block's side tile into a small canvas, for the hotbar icons.
export function blockIcon(atlasCanvas, id, size = 32) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const t = BLOCKS[id].tiles[1];
  ctx.drawImage(atlasCanvas, t * TILE, 0, TILE, TILE, 0, 0, size, size);
  return c;
}
