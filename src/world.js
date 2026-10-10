// Infinite chunked voxel world: generation, block edits, meshing and
// streaming chunks in and out around the player.
import * as THREE from 'three';
import { AIR, BLOCKS, TILE, ATLAS_TILES } from './blocks.js';
import { Terrain, columnBlock } from './terrain.js';

export const CHUNK = 16;    // chunk width and depth
export const HEIGHT = 256;  // world height in blocks

const key = (cx, cz) => `${cx},${cz}`;
const idx = (x, y, z) => (y * CHUNK + z) * CHUNK + x;

function generateChunk(cols) {
  const data = new Uint8Array(CHUNK * CHUNK * HEIGHT);
  for (let z = 0; z < CHUNK; z++) {
    for (let x = 0; x < CHUNK; x++) {
      const i = z * CHUNK + x;
      const h = cols.heights[i], top = cols.top[i];
      for (let y = 0; y <= h; y++) data[idx(x, y, z)] = columnBlock(y, h, top);
    }
  }
  return data;
}

// Six faces: normal, the four corners (counter-clockwise seen from outside),
// and a brightness factor so faces read clearly without real lighting.
const FACES = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], light: 0.8, tile: 1 },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], light: 0.8, tile: 1 },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], light: 1.0, tile: 0 },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], light: 0.5, tile: 2 },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], light: 0.65, tile: 1 },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], light: 0.65, tile: 1 },
];
// UVs for the four corners: side faces put corner 0 at the bottom of the tile.
const FACE_UV = [[0, 0], [0, 1], [1, 1], [1, 0]];
const TOP_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
const AO_LEVELS = [0.5, 0.68, 0.84, 1.0];

export class World {
  constructor(scene, atlasTexture, renderDistance = 8, seed = 1) {
    this.scene = scene;
    this.renderDistance = renderDistance;
    this.terrain = new Terrain(seed);
    this.chunks = new Map();  // key -> { cx, cz, data, mesh, dirty }
    this.saved = new Map();   // edited chunk data kept after a chunk unloads
    this.columns = new Map(); // key -> heights and surface blocks, cached
    this.material = new THREE.MeshBasicMaterial({ map: atlasTexture, vertexColors: true });
    this.loadQueue = [];
  }

  setRenderDistance(r) {
    if (r === this.renderDistance) return;
    this.renderDistance = r;
    this._lastCx = undefined; // rebuild the load queue on the next update
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= HEIGHT) return AIR;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(key(cx, cz));
    if (c) return c.data[idx(x - cx * CHUNK, y, z - cz * CHUNK)];
    const saved = this.saved.get(key(cx, cz));
    if (saved) return saved[idx(x - cx * CHUNK, y, z - cz * CHUNK)];
    const cols = this._columns(cx, cz);
    const i = (z - cz * CHUNK) * CHUNK + (x - cx * CHUNK);
    return columnBlock(y, cols.heights[i], cols.top[i]);
  }

  // Generated surface height at a column (ignores player edits).
  surfaceHeight(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    return this._columns(cx, cz).heights[(z - cz * CHUNK) * CHUNK + (x - cx * CHUNK)];
  }

  _columns(cx, cz) {
    const k = key(cx, cz);
    let cols = this.columns.get(k);
    if (!cols) {
      cols = this.terrain.chunkColumns(cx, cz, CHUNK);
      cols.cx = cx;
      cols.cz = cz;
      this.columns.set(k, cols);
    }
    return cols;
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= HEIGHT) return false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    const c = this.chunks.get(key(cx, cz));
    if (!c) return false;
    const lx = x - cx * CHUNK, lz = z - cz * CHUNK;
    c.data[idx(lx, y, lz)] = id;
    c.edited = true;
    c.dirty = true;
    // Faces on the neighbouring chunk can change when an edge block changes.
    if (lx === 0) this._markDirty(cx - 1, cz);
    if (lx === CHUNK - 1) this._markDirty(cx + 1, cz);
    if (lz === 0) this._markDirty(cx, cz - 1);
    if (lz === CHUNK - 1) this._markDirty(cx, cz + 1);
    return true;
  }

  isSolid(x, y, z) {
    return this.getBlock(x, y, z) !== AIR;
  }

  _markDirty(cx, cz) {
    const c = this.chunks.get(key(cx, cz));
    if (c) c.dirty = true;
  }

  // Load chunks near the player (closest first), unload far ones, and rebuild
  // a bounded number of meshes per frame to keep frame times steady.
  update(px, pz, budgetMs = 6) {
    const pcx = Math.floor(px / CHUNK), pcz = Math.floor(pz / CHUNK);
    const r = this.renderDistance;

    for (const [k, c] of this.chunks) {
      // Unload a ring further out than chunks load, so chunks at the edge
      // don't flicker in and out as you walk back and forth.
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > (r + 1) * (r + 1) + r + 1) {
        if (c.edited) this.saved.set(k, c.data);
        if (c.mesh) {
          this.scene.remove(c.mesh);
          c.mesh.geometry.dispose();
        }
        this.chunks.delete(k);
      }
    }
    for (const [k, cols] of this.columns) {
      if (Math.abs(cols.cx - pcx) > r + 3 || Math.abs(cols.cz - pcz) > r + 3) this.columns.delete(k);
    }

    if (pcx !== this._lastCx || pcz !== this._lastCz) {
      this._lastCx = pcx;
      this._lastCz = pcz;
      this.loadQueue = [];
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > r * r + r) continue;
          if (!this.chunks.has(key(pcx + dx, pcz + dz))) this.loadQueue.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
        }
      }
      this.loadQueue.sort((a, b) => b[2] - a[2]); // pop() takes the closest
    }

    let loads = 8;
    while (loads-- > 0 && this.loadQueue.length) {
      const [cx, cz] = this.loadQueue.pop();
      const k = key(cx, cz);
      if (this.chunks.has(k)) continue;
      const data = this.saved.get(k) || generateChunk(this._columns(cx, cz));
      const edited = this.saved.has(k);
      this.saved.delete(k);
      this.chunks.set(k, { cx, cz, data, mesh: null, dirty: true, edited });
    }

    // Rebuild dirty chunks, nearest first.
    const dirty = [];
    for (const c of this.chunks.values()) if (c.dirty) dirty.push(c);
    dirty.sort((a, b) => ((a.cx - pcx) ** 2 + (a.cz - pcz) ** 2) - ((b.cx - pcx) ** 2 + (b.cz - pcz) ** 2));
    const start = performance.now();
    for (let i = 0; i < dirty.length; i++) {
      this._buildMesh(dirty[i]);
      if (performance.now() - start > budgetMs) break;
    }
  }

  // True once every chunk in range is loaded and meshed.
  get settled() {
    if (this.loadQueue.length) return false;
    for (const c of this.chunks.values()) if (c.dirty) return false;
    return true;
  }

  // Rebuild one chunk immediately (used right after a player edit).
  rebuildAt(x, z) {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.get(key(cx + dx, cz + dz));
        if (c && c.dirty) this._buildMesh(c);
      }
    }
  }

  get loadedCount() {
    return this.chunks.size;
  }

  // Lowest air block in the chunk's own columns and the ring of columns
  // around it (from neighbouring chunks).
  _lowestAir(c) {
    let low = HEIGHT;
    const scan = (data, x, z) => {
      for (let y = 1; y < low; y++) {
        if (data[idx(x, y, z)] === AIR) { low = y; return; }
      }
    };
    for (let z = 0; z < CHUNK; z++) for (let x = 0; x < CHUNK; x++) scan(c.data, x, z);
    const sides = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dx, dz] of sides) {
      const ncx = c.cx + dx, ncz = c.cz + dz, k = key(ncx, ncz);
      const n = this.chunks.get(k);
      const data = n ? n.data : this.saved.get(k);
      for (let i = 0; i < CHUNK; i++) {
        // the column of the neighbour that touches this chunk
        const x = dx === -1 ? CHUNK - 1 : dx === 1 ? 0 : i;
        const z = dz === -1 ? CHUNK - 1 : dz === 1 ? 0 : i;
        if (data) scan(data, x, z);
        else low = Math.min(low, this._columns(ncx, ncz).heights[z * CHUNK + x] + 1);
      }
    }
    return low;
  }

  _buildMesh(c) {
    c.dirty = false;
    const pos = [], uv = [], col = [], ind = [];
    const ox = c.cx * CHUNK, oz = c.cz * CHUNK;
    const data = c.data;
    // Neighbour lookup that stays inside this chunk's array when it can.
    const solid = (x, y, z) => {
      if (y < 0) return true;
      if (y >= HEIGHT) return false;
      if (x >= 0 && x < CHUNK && z >= 0 && z < CHUNK) return data[idx(x, y, z)] !== AIR;
      return this.getBlock(ox + x, y, oz + z) !== AIR;
    };
    const tw = 1 / ATLAS_TILES, inset = 0.5 / (TILE * ATLAS_TILES);

    let topY = 0;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i] !== AIR) { topY = Math.floor(i / (CHUNK * CHUNK)); break; }
    }
    // Below the lowest air in this chunk and its bordering columns, every
    // block is buried on all six sides, so the scan can start just under it.
    const startY = Math.max(0, this._lowestAir(c) - 1);

    for (let y = startY; y <= topY; y++) {
      for (let z = 0; z < CHUNK; z++) {
        for (let x = 0; x < CHUNK; x++) {
          const id = data[idx(x, y, z)];
          if (id === AIR) continue;
          const block = BLOCKS[id];
          for (const f of FACES) {
            const [nx, ny, nz] = f.n;
            if (solid(x + nx, y + ny, z + nz)) continue;
            const base = pos.length / 3;
            const tile = block.tiles[f.tile];
            const u0 = tile * tw + inset, u1 = (tile + 1) * tw - inset;
            const uvs = ny === 0 ? FACE_UV : TOP_UV;
            const ao = [];
            for (let i = 0; i < 4; i++) {
              const [cx, cy, cz] = f.c[i];
              pos.push(ox + x + cx, y + cy, oz + z + cz);
              uv.push(uvs[i][0] ? u1 : u0, uvs[i][1]);
              // Ambient occlusion from the two edge neighbours and the corner
              // neighbour in front of this face.
              const sx = cx * 2 - 1, sy = cy * 2 - 1, sz = cz * 2 - 1;
              const fx = x + nx, fy = y + ny, fz = z + nz;
              let s1, s2, corner;
              if (nx !== 0) {
                s1 = solid(fx, fy + sy, fz); s2 = solid(fx, fy, fz + sz); corner = solid(fx, fy + sy, fz + sz);
              } else if (ny !== 0) {
                s1 = solid(fx + sx, fy, fz); s2 = solid(fx, fy, fz + sz); corner = solid(fx + sx, fy, fz + sz);
              } else {
                s1 = solid(fx + sx, fy, fz); s2 = solid(fx, fy + sy, fz); corner = solid(fx + sx, fy + sy, fz);
              }
              const level = s1 && s2 ? 0 : 3 - (s1 + s2 + corner);
              ao.push(level);
              const b = f.light * AO_LEVELS[level];
              col.push(b, b, b);
            }
            // Flip the quad's diagonal so AO gradients don't look anisotropic.
            if (ao[0] + ao[2] > ao[1] + ao[3]) ind.push(base, base + 1, base + 2, base, base + 2, base + 3);
            else ind.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          }
        }
      }
    }

    // uv.v is 0..1 within the tile row; the atlas is one row tall so it maps directly.
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(ind);
    geo.computeBoundingSphere();

    if (c.mesh) {
      c.mesh.geometry.dispose();
      c.mesh.geometry = geo;
    } else {
      c.mesh = new THREE.Mesh(geo, this.material);
      this.scene.add(c.mesh);
    }
  }
}
