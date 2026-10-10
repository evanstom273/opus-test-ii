// Game loop: renderer, camera, world streaming, block targeting, breaking and
// placing, and the HUD.
import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { AIR, BLOCKS, HOTBAR, createAtlas, blockIcon } from './blocks.js';
import { Settings } from './settings.js';
import { DistantTerrain } from './lod.js';
import { Sky, HORIZON } from './sky.js';

const REACH = 5;

// Voxel raycast (Amanatides & Woo). Returns the first solid block within
// `max` and the empty block in front of the face that was hit.
export function raycast(world, origin, dir, max) {
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
  const tdx = sx ? Math.abs(1 / dir.x) : Infinity;
  const tdy = sy ? Math.abs(1 / dir.y) : Infinity;
  const tdz = sz ? Math.abs(1 / dir.z) : Infinity;
  const frac = (o, s) => (s > 0 ? Math.floor(o) + 1 - o : o - Math.floor(o));
  let tx = sx ? frac(origin.x, sx) * tdx : Infinity;
  let ty = sy ? frac(origin.y, sy) * tdy : Infinity;
  let tz = sz ? frac(origin.z, sz) * tdz : Infinity;
  let px = x, py = y, pz = z;
  let t = 0;
  while (t <= max) {
    if (world.getBlock(x, y, z) !== AIR) {
      return { x, y, z, place: { x: px, y: py, z: pz } };
    }
    px = x; py = y; pz = z;
    if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; }
    else if (ty < tz) { y += sy; t = ty; ty += tdy; }
    else { z += sz; t = tz; tz += tdz; }
  }
  return null;
}

export class Game {
  constructor(container, ui) {
    this.ui = ui;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(HORIZON);
    this.sky = new Sky(this.scene);
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.camera.rotation.order = 'YXZ';
    this.baseFov = 75;

    const atlas = createAtlas();
    this.atlas = atlas;
    // ?seed=123 in the URL picks a different world.
    const seedParam = parseInt(new URLSearchParams(location.search).get('seed'), 10);
    this.seed = Number.isFinite(seedParam) ? seedParam : 20261010;
    this.settings = new Settings();
    this.world = new World(this.scene, atlas.texture, this.settings.get('renderDistance'), this.seed);
    this.scene.fog = new THREE.Fog(HORIZON, 1, 2);
    this.lod = new DistantTerrain(this.scene, this.world, this.seed);
    this.player = new Player(this.world, 0.5, this.world.surfaceHeight(0, 0) + 1, 0.5);
    this.input = new Input(renderer.domElement);
    this._applySettings();
    this.settings.onChange(() => this._applySettings());

    // Outline around the block you're looking at.
    const box = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004));
    this.outline = new THREE.LineSegments(box, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
    this.outline.visible = false;
    this.scene.add(this.outline);

    this.slot = 0;
    this.target = null;
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._buildHotbar();

    this.input.onLockChange = (locked) => {
      ui.overlay.hidden = locked;
      ui.overlayTitle.textContent = this.started ? 'Paused' : 'Voxel Test';
      ui.play.textContent = this.started ? 'Resume' : 'Click to play';
    };
    // Play, or a click on the dimmed backdrop, starts the game; clicks inside
    // the panel (settings) don't.
    const play = () => {
      this.started = true;
      this.input.lock();
    };
    ui.play.addEventListener('click', play);
    ui.overlay.addEventListener('click', (e) => {
      if (e.target === ui.overlay) play();
    });
    this.settings.buildPanel(ui.settingsView);
    ui.toggleSettings.addEventListener('click', () => {
      const open = ui.settingsView.hidden;
      ui.settingsView.hidden = !open;
      ui.controlsView.hidden = open;
      ui.toggleSettings.textContent = open ? 'Controls' : 'Settings';
    });
    renderer.domElement.addEventListener('click', () => {
      if (!this.input.locked) this.input.lock();
    });
    // Ctrl+W closes the tab and no page can block it; ask before leaving.
    window.addEventListener('beforeunload', (e) => {
      if (this.started) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
    window.addEventListener('resize', () => this._resize());

    this.last = performance.now();
  }

  _applySettings() {
    const s = this.settings;
    const rd = s.get('renderDistance');
    this.world.setRenderDistance(rd);
    const lodRange = s.get('distantTerrain');
    this.lod.setRange(lodRange);
    this.lod.setDetail(s.get('lodDetail'));
    // Distant terrain isn't needed where real chunks always cover the ground.
    this.lod.setInnerRadius(Math.max(0, (rd - 2) * 16));
    // Fog only fades out the very edge of what's drawn.
    const view = lodRange > 0 ? lodRange : rd * 16;
    if (s.get('fog')) {
      this.scene.fog.near = lodRange > 0 ? view * 0.6 : view * 0.7;
      this.scene.fog.far = lodRange > 0 ? view : view * 0.95;
    } else {
      this.scene.fog.near = this.scene.fog.far = 1e9;
    }
    this.camera.far = Math.max(1000, view * 1.4 + 300);
    this.camera.updateProjectionMatrix();
    this.baseFov = s.get('fov');
    this.player.sensitivity = s.get('sensitivity') / 100;
    this.player.invertY = s.get('invertY');
    this.ui.debug.hidden = !s.get('showDebug');
  }

  start() {
    // Load the chunks around spawn before the first frame so the world is there.
    for (let i = 0; i < 200 && !this.world.settled; i++) this.world.update(this.player.pos.x, this.player.pos.z, 1000);
    const loop = () => {
      requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.step(dt);
    };
    requestAnimationFrame(loop);
  }

  step(dt) {
    const { input, player } = this;
    if (input.locked) {
      player.look(input.mouseDX, input.mouseDY);
      player.update(dt, input);
      this._interact();
      this._hotbarInput();
    }
    this.world.update(player.pos.x, player.pos.z);
    this.lod.update(player.pos.x, player.pos.z);

    this.camera.position.set(player.pos.x, player.eyeY, player.pos.z);
    this.camera.rotation.set(player.pitch, player.yaw, 0);
    const fov = this.baseFov + (player.sprinting ? 8 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 10);
      this.camera.updateProjectionMatrix();
    }

    this._updateTarget();
    this.sky.update(this.camera);
    this.renderer.render(this.scene, this.camera);
    this._updateHud(dt);
    input.endFrame();
  }

  _lookDir() {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return d;
  }

  _updateTarget() {
    this.camera.updateMatrixWorld();
    this.target = raycast(this.world, this.camera.position, this._lookDir(), REACH);
    if (this.target) {
      this.outline.position.set(this.target.x + 0.5, this.target.y + 0.5, this.target.z + 0.5);
      this.outline.visible = true;
    } else {
      this.outline.visible = false;
    }
  }

  _interact() {
    const { input, world, player } = this;
    if (!input.clicks.size) return;
    this._updateTarget();
    const t = this.target;
    if (!t) return;
    if (input.clicks.has(0)) {
      const id = world.getBlock(t.x, t.y, t.z);
      if (!BLOCKS[id].unbreakable && world.setBlock(t.x, t.y, t.z, AIR)) world.rebuildAt(t.x, t.z);
    } else if (input.clicks.has(2)) {
      const p = t.place;
      if (world.getBlock(p.x, p.y, p.z) === AIR && !player.overlapsBlock(p.x, p.y, p.z)) {
        if (world.setBlock(p.x, p.y, p.z, HOTBAR[this.slot])) world.rebuildAt(p.x, p.z);
      }
    }
  }

  _hotbarInput() {
    const { input } = this;
    for (let i = 0; i < HOTBAR.length; i++) {
      if (input.hit(`Digit${i + 1}`)) this._selectSlot(i);
    }
    if (input.wheel) this._selectSlot((this.slot + input.wheel + HOTBAR.length) % HOTBAR.length);
  }

  _buildHotbar() {
    const bar = this.ui.hotbar;
    bar.innerHTML = '';
    this.slots = HOTBAR.map((id, i) => {
      const el = document.createElement('div');
      el.className = 'slot';
      el.appendChild(blockIcon(this.atlas.canvas, id, 32));
      const n = document.createElement('span');
      n.textContent = i + 1;
      el.appendChild(n);
      bar.appendChild(el);
      return el;
    });
    this._selectSlot(0);
  }

  _selectSlot(i) {
    this.slot = i;
    this.slots.forEach((el, j) => el.classList.toggle('active', j === i));
    this.ui.blockName.textContent = BLOCKS[HOTBAR[i]].name;
    this.ui.blockName.classList.remove('fade');
    void this.ui.blockName.offsetWidth; // restart the fade animation
    this.ui.blockName.classList.add('fade');
  }

  _updateHud(dt) {
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
      const p = this.player;
      const state = p.sneaking ? 'Sneaking' : p.sprinting ? 'Sprinting' : p.onGround ? 'Walking' : 'Airborne';
      const w = this.world.terrain.regionWeights(p.pos.x, p.pos.z);
      const region = w.mountains > 0.5 ? 'Mountains' : w.plains > 0.5 ? 'Plains' : 'Hills';
      this.ui.debug.textContent =
        `${this.fps} fps · XYZ ${p.pos.x.toFixed(1)} ${p.pos.y.toFixed(1)} ${p.pos.z.toFixed(1)} · ` +
        `${region} · ${this.world.loadedCount} chunks · ${state} · seed ${this.seed}`;
      if (this.lod.range > 0) {
        const l = this.lod.stats;
        this.ui.debug.textContent += ` · LOD ${l.shown} sections, ${(l.vertices / 1e6).toFixed(2)}M verts` + (l.queued || l.pending ? `, ${l.queued + l.pending} building` : '');
      }
    }
  }

  _resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
