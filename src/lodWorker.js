// Builds LOD sections off the main thread.
import { Terrain } from './terrain.js';
import { buildSection } from './lodMesh.js';

let terrain = null;

self.onmessage = (e) => {
  const { id, seed, level, sx, sz } = e.data;
  if (!terrain || terrain.seed !== seed) terrain = new Terrain(seed);
  const out = buildSection(terrain, level, sx, sz);
  self.postMessage({ id, ...out }, [out.positions.buffer, out.colors.buffer, out.indices.buffer]);
};
