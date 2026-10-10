// Terrain heights and surface blocks.
//
// Three layers of noise:
//  - region: very low frequency fBm that decides where plains, rolling hills
//    and mountains are, with smooth blends between them.
//  - base: OpenSimplex2 fBm for ordinary hills, valleys and elevation.
//  - ridge: ridged multifractal that gives mountains sharp crests.
import { fbm, ridged } from './noise.js';
import { GRASS, DIRT, STONE, BEDROCK, AIR } from './ids.js';

export const SEA_LEVEL = 64;   // reference elevation for the plains
const MAX_Y = 250;
export const ROCK_LINE = 168;  // bare stone above this height
const CLIFF_SLOPE = 3;         // height step to a neighbour that exposes stone
const DIRT_DEPTH = 3;

const REGION_SCALE = 700;      // blocks per region-noise unit
const BASE_SCALE = 220;
const DETAIL_SCALE = 40;
const RIDGE_SCALE = 320;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Terrain {
  constructor(seed) {
    this.seed = seed | 0;
  }

  // How much of each terrain type applies at (x, z). The weights sum to 1.
  regionWeights(x, z) {
    const r = fbm(this.seed + 11, x / REGION_SCALE, z / REGION_SCALE, 2);
    const plains = 1 - smoothstep(-0.35, -0.08, r);
    const mountains = smoothstep(0.12, 0.4, r);
    return { plains, hills: Math.max(0, 1 - plains - mountains), mountains };
  }

  // Height of the top solid block at column (x, z).
  height(x, z) {
    const w = this.regionWeights(x, z);
    const base = fbm(this.seed + 23, x / BASE_SCALE, z / BASE_SCALE, 5);

    let h = 0;
    if (w.plains > 0) {
      const detail = fbm(this.seed + 37, x / DETAIL_SCALE, z / DETAIL_SCALE, 2);
      h += w.plains * (SEA_LEVEL + base * 2.5 + detail * 0.6);
    }
    if (w.hills > 0) {
      h += w.hills * (SEA_LEVEL + 2 + base * 22);
    }
    if (w.mountains > 0) {
      const ridge = ridged(this.seed + 41, x / RIDGE_SCALE, z / RIDGE_SCALE, 5);
      h += w.mountains * (SEA_LEVEL + 8 + base * 12 + Math.pow(ridge, 1.25) * 150);
    }
    return Math.max(1, Math.min(MAX_Y, Math.round(h)));
  }

  // Heights and surface blocks for one 16x16 chunk. Heights are sampled with a
  // one-block border so slopes can be measured at the chunk edges.
  chunkColumns(cx, cz, size) {
    const b = size + 2;
    const border = new Int16Array(b * b);
    for (let z = 0; z < b; z++) {
      for (let x = 0; x < b; x++) border[z * b + x] = this.height(cx * size + x - 1, cz * size + z - 1);
    }
    const heights = new Int16Array(size * size);
    const top = new Uint8Array(size * size);
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const i = (z + 1) * b + (x + 1);
        const h = border[i];
        const slope = Math.max(
          Math.abs(h - border[i - 1]), Math.abs(h - border[i + 1]),
          Math.abs(h - border[i - b]), Math.abs(h - border[i + b]),
        );
        heights[z * size + x] = h;
        top[z * size + x] = slope >= CLIFF_SLOPE || h > ROCK_LINE ? STONE : GRASS;
      }
    }
    return { heights, top };
  }
}

// Block at height y in a column whose top solid block is h with surface `top`.
export function columnBlock(y, h, top) {
  if (y === 0) return BEDROCK;
  if (y > h) return AIR;
  if (y === h) return top;
  if (top === GRASS && y > h - 1 - DIRT_DEPTH) return DIRT;
  return STONE;
}
