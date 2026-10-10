// Distant terrain: blocky level-of-detail sections drawn beyond the real
// block chunks, in the spirit of Distant Horizons / Voxy.
//
// Sections are picked with a quadtree around the player: a section splits
// into four finer ones (half the cell size) while it is close relative to
// its size. Workers build the meshes; a new set of sections replaces the old
// one only once it is complete, so terrain never flickers out. Where real
// chunks are drawn, a per-chunk mask hides the LOD in the shader.
import * as THREE from 'three';
import { CELLS } from './lodMesh.js';
import { MASK_SIZE } from './world.js';

const ROOT_LEVEL = 7;      // 4096-block root sections
const REPLAN_STEP = 16;    // re-plan after moving this many blocks
const CACHE_EXTRA = 160;   // built sections kept around after leaving the set

const sectionSize = (level) => CELLS << level;
const keyOf = (level, sx, sz) => `${level}:${sx}:${sz}`;

const VERTEX = /* glsl */ `
  attribute vec3 lodColor;
  varying vec3 vColor;
  varying vec2 vWorldXZ;
  #include <fog_pars_vertex>
  void main() {
    vColor = lodColor;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldXZ = world.xz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    vec3 transformed = position;
    #include <fog_vertex>
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec2 uMaskOrigin;
  varying vec3 vColor;
  varying vec2 vWorldXZ;
  #include <fog_pars_fragment>
  void main() {
    // Hide LOD over chunks drawn with real blocks (mask = 1). In the outer
    // ring of loaded chunks (mask = 0.5) LOD stays, sitting under the blocks.
    vec2 c = floor(vWorldXZ / 16.0) - uMaskOrigin;
    if (all(greaterThanEqual(c, vec2(0.0))) && all(lessThan(c, vec2(${MASK_SIZE}.0)))) {
      if (texture2D(uMask, (c + 0.5) / ${MASK_SIZE}.0).r > 0.75) discard;
    }
    gl_FragColor = vec4(vColor, 1.0); // colours are already sRGB
    #include <fog_fragment>
  }
`;

export class DistantTerrain {
  constructor(scene, world, seed) {
    this.world = world;
    this.seed = seed;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.maskTexture = new THREE.DataTexture(world.mask, MASK_SIZE, MASK_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
    this.maskTexture.magFilter = this.maskTexture.minFilter = THREE.NearestFilter;
    this.maskTexture.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        { uMask: { value: null }, uMaskOrigin: { value: new THREE.Vector2() } },
      ]),
    });
    this.material.uniforms.uMask.value = this.maskTexture;

    this.sections = new Map();  // key -> { level, sx, sz, mesh, pending, used }
    this.shown = new Set();
    this.desired = [];
    this.queue = [];
    this.range = 0;
    this.split = 2.25;   // split a section while closer than split x its size
    this.innerRadius = 0;
    this.planAt = null;
    this.frame = 0;

    const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('./lodWorker.js', import.meta.url), { type: 'module' });
      w.busy = false;
      w.onmessage = (e) => this._onBuilt(w, e.data);
      w.onerror = (e) => console.error('LOD worker error', e.message);
      this.workers.push(w);
    }
  }

  // Distance in blocks out to which distant terrain is drawn (0 = off).
  setRange(range) {
    this.range = range;
    this.group.visible = range > 0;
    this.planAt = null;
  }

  // Detail: higher keeps finer cells further out (more vertices).
  setDetail(split) {
    if (split !== this.split) {
      this.split = split;
      this.planAt = null;
    }
  }

  // Radius (blocks) fully covered by real chunks, where no LOD is needed.
  setInnerRadius(r) {
    if (r !== this.innerRadius) {
      this.innerRadius = r;
      this.planAt = null;
    }
  }

  get stats() {
    let built = 0, pending = 0, vertices = 0;
    for (const s of this.sections.values()) {
      if (s.mesh) built++;
      if (s.pending) pending++;
    }
    for (const k of this.shown) {
      const s = this.sections.get(k);
      if (s && s.mesh) vertices += s.mesh.geometry.attributes.position.count;
    }
    return { shown: this.shown.size, built, pending, queued: this.queue.length, vertices };
  }

  get ready() {
    return this.range === 0 || (this.desired.length > 0 && this.desired.every((k) => this.shown.has(k)));
  }

  update(px, pz) {
    this.frame++;
    if (this.world.maskDirty) {
      this.maskTexture.needsUpdate = true;
      this.world.maskDirty = false;
    }
    this.material.uniforms.uMaskOrigin.value.set(this.world.maskOrigin.x, this.world.maskOrigin.z);
    if (this.range <= 0) return;

    if (!this.planAt || Math.hypot(px - this.planAt.x, pz - this.planAt.z) > REPLAN_STEP) {
      this._plan(px, pz);
    }
    this._dispatch();

    // Swap to the new set once every section in it is built. On the very
    // first load show sections as they arrive instead.
    const missing = this.desired.some((k) => !this.sections.get(k)?.mesh);
    if (!missing || this.shown.size === 0 || this._firstLoad) {
      this._show(this.desired.filter((k) => this.sections.get(k)?.mesh));
      if (!missing) this._firstLoad = false;
    }
  }

  _plan(px, pz) {
    this.planAt = { x: px, z: pz };
    if (this.shown.size === 0) this._firstLoad = true;
    const leaves = [];
    const R = this.range, inner = this.innerRadius;
    const visit = (level, sx, sz) => {
      const size = sectionSize(level);
      const x0 = sx * size, z0 = sz * size;
      const dx = Math.max(x0 - px, 0, px - (x0 + size));
      const dz = Math.max(z0 - pz, 0, pz - (z0 + size));
      const near = Math.hypot(dx, dz);
      if (near > R) return;
      const far = Math.hypot(Math.max(Math.abs(px - x0), Math.abs(px - x0 - size)), Math.max(Math.abs(pz - z0), Math.abs(pz - z0 - size)));
      if (far < inner) return; // entirely inside the real-block area
      if (level > 1 && near < this.split * size) {
        for (let k = 0; k < 4; k++) visit(level - 1, sx * 2 + (k & 1), sz * 2 + (k >> 1));
      } else {
        leaves.push({ key: keyOf(level, sx, sz), level, sx, sz, dist: near });
      }
    };
    const root = sectionSize(ROOT_LEVEL);
    for (let sz = Math.floor((pz - R) / root); sz <= Math.floor((pz + R) / root); sz++) {
      for (let sx = Math.floor((px - R) / root); sx <= Math.floor((px + R) / root); sx++) visit(ROOT_LEVEL, sx, sz);
    }
    leaves.sort((a, b) => a.dist - b.dist);
    this.desired = leaves.map((l) => l.key);
    this.queue = leaves.filter((l) => {
      const s = this.sections.get(l.key);
      return !s || (!s.mesh && !s.pending);
    });
  }

  _dispatch() {
    for (const w of this.workers) {
      if (w.busy || !this.queue.length) continue;
      const l = this.queue.shift();
      let s = this.sections.get(l.key);
      if (!s) {
        s = { level: l.level, sx: l.sx, sz: l.sz, mesh: null, pending: false, used: this.frame };
        this.sections.set(l.key, s);
      }
      if (s.mesh || s.pending) continue;
      s.pending = true;
      w.busy = true;
      w.postMessage({ id: l.key, seed: this.seed, level: l.level, sx: l.sx, sz: l.sz });
    }
  }

  _onBuilt(worker, data) {
    worker.busy = false;
    const s = this.sections.get(data.id);
    if (!s) return;
    s.pending = false;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geo.setAttribute('lodColor', new THREE.BufferAttribute(data.colors, 3, true));
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.material);
    const size = sectionSize(s.level);
    mesh.position.set(s.sx * size, 0, s.sz * size);
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.visible = false;
    this.group.add(mesh);
    s.mesh = mesh;
    this._dispatch();
  }

  _show(keys) {
    const next = new Set(keys);
    for (const k of this.shown) {
      if (!next.has(k)) {
        const s = this.sections.get(k);
        if (s && s.mesh) s.mesh.visible = false;
      }
    }
    for (const k of next) {
      const s = this.sections.get(k);
      s.mesh.visible = true;
      s.used = this.frame;
    }
    this.shown = next;
    this._trimCache();
  }

  // Drop the least recently shown hidden sections beyond the cache budget.
  _trimCache() {
    const hidden = [];
    for (const [k, s] of this.sections) if (s.mesh && !this.shown.has(k)) hidden.push([k, s]);
    if (hidden.length <= CACHE_EXTRA) return;
    hidden.sort((a, b) => a[1].used - b[1].used);
    for (const [k, s] of hidden.slice(0, hidden.length - CACHE_EXTRA)) {
      this.group.remove(s.mesh);
      s.mesh.geometry.dispose();
      this.sections.delete(k);
    }
  }
}
