// Builds one level-of-detail section: a 32x32 grid of cells, each cell a
// column of 2^level x 2^level blocks drawn as a box (top face plus walls
// where the neighbour is lower). Inspired by Distant Horizons / Voxy: far
// terrain stays blocky, just at a coarser block size.
//
// Pure function with no rendering imports, so it runs in a Web Worker.
import { ROCK_LINE } from './terrain.js';

export const CELLS = 32;  // cells per section side

// Average colours (sRGB) of the block textures as seen from a distance.
const GRASS_TOP = [96, 160, 62];
const GRASS_SIDE = [128, 98, 66];
const STONE = [121, 121, 121];

// Same face table as the block mesher: normal, corners (CCW from outside),
// brightness.
const FACES = [
  { c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], light: 0.8 },   // +x
  { c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], light: 0.8 },   // -x
  { c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], light: 1.0 },   // +y
  null,
  { c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], light: 0.65 },  // +z
  { c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], light: 0.65 },  // -z
];

const toLinear = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
// Shade in linear space, like the textured blocks, then store as sRGB.
const shade = (rgb, b) => rgb.map((c) => toSrgb(toLinear(c) * b));

// How far LOD sits below the real surface. Where LOD and blocks overlap at
// the edge of the block area, this keeps the real blocks on top. It is the
// same at every level so neighbouring levels line up.
export const LOD_DROP = 6;

export function buildSection(terrain, level, sx, sz) {
  const cell = 1 << level;
  const size = CELLS * cell;
  const ox = sx * size, oz = sz * size;
  const B = CELLS + 2; // with a one-cell border
  const top = new Int16Array(B * B);     // highest block in each cell
  const stone = new Uint8Array(B * B);   // 1 if the cell reads as bare rock

  // Sample up to 4x4 points per cell; for 2- and 4-block cells that is every block.
  const sub = Math.min(cell, 4), step = cell / sub;
  for (let j = 0; j < B; j++) {
    for (let i = 0; i < B; i++) {
      const cx = ox + (i - 1) * cell, cz = oz + (j - 1) * cell;
      let hi = -1, lo = 1e9;
      for (let b = 0; b < sub; b++) {
        for (let a = 0; a < sub; a++) {
          const h = terrain.height(cx + Math.floor((a + 0.5) * step), cz + Math.floor((b + 0.5) * step));
          if (h > hi) hi = h;
          if (h < lo) lo = h;
        }
      }
      top[j * B + i] = hi;
      stone[j * B + i] = hi > ROCK_LINE || hi - lo >= Math.max(3, 0.75 * cell) ? 1 : 0;
    }
  }

  const pos = [], col = [], ind = [];
  const drop = LOD_DROP;
  const lap = 0.02 * cell, edgeLap = 0.05 * cell;
  const shades = {
    top: [shade(GRASS_TOP, 1), shade(STONE, 1)],
    side: FACES.map((f) => f && [shade(GRASS_SIDE, f.light), shade(STONE, f.light)]),
  };
  const quad = (face, x0, y0, z0, x1, y1, z1, rgb) => {
    const base = pos.length / 3;
    for (const [a, b, c] of FACES[face].c) {
      pos.push(a ? x1 : x0, b ? y1 : y0, c ? z1 : z0);
      col.push(rgb[0], rgb[1], rgb[2]);
    }
    ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const at = (i, j) => (j + 1) * B + (i + 1); // cell (i, j) in section coords

  // Top faces, greedily merged into rectangles of equal height and material.
  const done = new Uint8Array(CELLS * CELLS);
  for (let j = 0; j < CELLS; j++) {
    for (let i = 0; i < CELLS; i++) {
      if (done[j * CELLS + i]) continue;
      const h = top[at(i, j)], s = stone[at(i, j)];
      const same = (x, z) => !done[z * CELLS + x] && top[at(x, z)] === h && stone[at(x, z)] === s;
      let w = 1;
      while (i + w < CELLS && same(i + w, j)) w++;
      let d = 1;
      outer: while (j + d < CELLS) {
        for (let x = i; x < i + w; x++) if (!same(x, j + d)) break outer;
        d++;
      }
      for (let z = j; z < j + d; z++) for (let x = i; x < i + w; x++) done[z * CELLS + x] = 1;
      const y = h + 1 - drop;
      // Top faces overlap their neighbours a little (more at the section
      // edge) so no pinholes or hairline cracks let the sky through.
      const x0 = i * cell - (i === 0 ? edgeLap : lap), x1 = (i + w) * cell + (i + w === CELLS ? edgeLap : lap);
      const z0 = j * cell - (j === 0 ? edgeLap : lap), z1 = (j + d) * cell + (j + d === CELLS ? edgeLap : lap);
      quad(2, x0, y - 1, z0, x1, y, z1, shades.top[s]);
    }
  }

  // Walls where a neighbour is lower. At the section edge always draw at
  // least a short skirt, which hides cracks against coarser neighbours.
  // Runs of identical walls along a row are merged into one face.
  const skirt = 2 * cell;
  const wall = (i, j, di, dj) => {
    const h = top[at(i, j)];
    const ni = i + di, nj = j + dj;
    const n = top[at(ni, nj)];
    const edge = ni < 0 || nj < 0 || ni >= CELLS || nj >= CELLS;
    const low = edge ? Math.min(n, h - skirt) : n;
    if (low >= h) return null;
    // A skirt where this level's neighbour isn't lower takes the top colour:
    // where it meets the top face any depth flicker is invisible, and where
    // a coarser neighbour really is lower it still closes the gap.
    return { y0: low + 1 - drop, y1: h + 1 - drop, s: stone[at(i, j)], skirt: edge && n >= h };
  };
  const same = (a, b) => a && b && a.y0 === b.y0 && a.y1 === b.y1 && a.s === b.s && a.skirt === b.skirt;
  // Walls facing +x / -x run along z; walls facing +z / -z run along x.
  for (const [face, di, dj] of [[0, 1, 0], [1, -1, 0], [4, 0, 1], [5, 0, -1]]) {
    const alongZ = di !== 0;
    for (let a = 0; a < CELLS; a++) {
      let b = 0;
      while (b < CELLS) {
        const i = alongZ ? a : b, j = alongZ ? b : a;
        const w = wall(i, j, di, dj);
        if (!w) { b++; continue; }
        let len = 1;
        while (b + len < CELLS && same(w, wall(alongZ ? a : b + len, alongZ ? b + len : a, di, dj))) len++;
        const x0 = i * cell, z0 = j * cell;
        const x1 = alongZ ? x0 + cell : (b + len) * cell, z1 = alongZ ? (b + len) * cell : z0 + cell;
        quad(face, x0, w.y0, z0, x1, w.y1, z1, w.skirt ? shades.top[w.s] : shades.side[face][w.s]);
        b += len;
      }
    }
  }

  const vertices = pos.length / 3;
  return {
    level, sx, sz,
    positions: new Float32Array(pos),
    colors: new Uint8Array(col),
    indices: vertices > 65535 ? new Uint32Array(ind) : new Uint16Array(ind),
  };
}
