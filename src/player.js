// First-person player: mouse look, walking, sprinting, sneaking, jumping and
// axis-by-axis collision against the voxel grid.
const WIDTH = 0.6;
const HEIGHT_STAND = 1.8;
const HEIGHT_SNEAK = 1.5;
const EYE_STAND = 1.62;
const EYE_SNEAK = 1.27;

const SPEED_WALK = 4.3;
const SPEED_SPRINT = 5.6;
const SPEED_SNEAK = 1.3;
const GRAVITY = 32;
const JUMP_VELOCITY = 9;
const MAX_FALL = 60;
const SENSITIVITY = 0.0022;

export class Player {
  constructor(world, x, y, z) {
    this.world = world;
    this.pos = { x, y, z };          // centre of the feet
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;                    // 0 looks toward -Z
    this.pitch = 0;
    this.onGround = true;            // spawns standing on the surface
    this.sprinting = false;
    this.sneaking = false;
    this.height = HEIGHT_STAND;
    this.eye = EYE_STAND;
  }

  get eyeY() {
    return this.pos.y + this.eye;
  }

  look(dx, dy) {
    this.yaw -= dx * SENSITIVITY;
    this.pitch -= dy * SENSITIVITY;
    const lim = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  update(dt, input) {
    const fwd = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const strafe = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);

    // Sneak, but only stand back up when there's headroom.
    const wantSneak = input.down('ShiftLeft', 'ShiftRight');
    if (wantSneak) this.sneaking = true;
    else if (this.sneaking && !this._collides(this.pos.x, this.pos.y, this.pos.z, HEIGHT_STAND)) this.sneaking = false;
    this.height = this.sneaking ? HEIGHT_SNEAK : HEIGHT_STAND;
    const eyeTarget = this.sneaking ? EYE_SNEAK : EYE_STAND;
    this.eye += (eyeTarget - this.eye) * Math.min(1, dt * 14);

    // Sprint starts with Ctrl while moving forward and lasts until you stop.
    if (input.down('ControlLeft', 'ControlRight') && fwd > 0 && !this.sneaking) this.sprinting = true;
    if (fwd <= 0 || this.sneaking) this.sprinting = false;

    const speed = this.sneaking ? SPEED_SNEAK : this.sprinting ? SPEED_SPRINT : SPEED_WALK;
    let mx = 0, mz = 0;
    if (fwd || strafe) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // forward is (-sin, -cos); right is (cos, -sin)
      mx = -sin * fwd + cos * strafe;
      mz = -cos * fwd - sin * strafe;
      const len = Math.hypot(mx, mz);
      mx = (mx / len) * speed;
      mz = (mz / len) * speed;
    }
    const accel = this.onGround ? 18 : 5;
    const k = Math.min(1, dt * accel);
    this.vel.x += (mx - this.vel.x) * k;
    this.vel.z += (mz - this.vel.z) * k;

    if (this.onGround && input.down('Space')) {
      this.vel.y = JUMP_VELOCITY;
      this.onGround = false;
    }
    this.vel.y = Math.max(-MAX_FALL, this.vel.y - GRAVITY * dt);

    this._move(dt);

    // Fell through the bottom somehow (shouldn't happen with bedrock): reset.
    if (this.pos.y < -20) {
      this.pos.y = 40;
      this.vel.y = 0;
    }
  }

  // Does an AABB with feet at (x, y, z) overlap any solid block?
  _collides(x, y, z, h = this.height) {
    const r = WIDTH / 2, e = 1e-4;
    const x0 = Math.floor(x - r + e), x1 = Math.floor(x + r - e);
    const y0 = Math.floor(y + e), y1 = Math.floor(y + h - e);
    const z0 = Math.floor(z - r + e), z1 = Math.floor(z + r - e);
    for (let by = y0; by <= y1; by++) {
      for (let bz = z0; bz <= z1; bz++) {
        for (let bx = x0; bx <= x1; bx++) {
          if (this.world.isSolid(bx, by, bz)) return true;
        }
      }
    }
    return false;
  }

  // Is there ground under an AABB placed at (x, z)?
  _hasGround(x, z) {
    return this._collides(x, this.pos.y - 0.05, z, 0.05);
  }

  _move(dt) {
    const p = this.pos, v = this.vel;
    const r = WIDTH / 2;

    // Vertical first, so onGround is current for the sneak edge check.
    const dy = v.y * dt;
    if (this._collides(p.x, p.y + dy, p.z)) {
      if (dy < 0) {
        p.y = Math.floor(p.y + dy) + 1;
        // A large step could land several blocks below; search back up.
        while (this._collides(p.x, p.y, p.z)) p.y += 1;
        this.onGround = true;
      } else {
        p.y = Math.floor(p.y + this.height + dy) - this.height;
        while (this._collides(p.x, p.y, p.z)) p.y -= 1;
      }
      v.y = 0;
    } else {
      p.y += dy;
      this.onGround = false;
    }

    for (const axis of ['x', 'z']) {
      const d = v[axis] * dt;
      if (!d) continue;
      const nx = axis === 'x' ? p.x + d : p.x;
      const nz = axis === 'z' ? p.z + d : p.z;
      // Sneaking keeps you from walking off a ledge.
      if (this.sneaking && this.onGround && !this._hasGround(nx, nz)) {
        v[axis] = 0;
        continue;
      }
      if (this._collides(nx, p.y, nz)) {
        // Snap flush against the block face we hit.
        p[axis] = d > 0 ? Math.floor(p[axis] + d + r) - r - 1e-3 : Math.floor(p[axis] + d - r) + 1 + r + 1e-3;
        v[axis] = 0;
        this.sprinting = false;
      } else {
        p[axis] = axis === 'x' ? nx : nz;
      }
    }
  }

  // Does the player's body overlap block (bx, by, bz)? Used to stop placing a
  // block inside yourself.
  overlapsBlock(bx, by, bz) {
    const r = WIDTH / 2;
    return (
      this.pos.x + r > bx && this.pos.x - r < bx + 1 &&
      this.pos.z + r > bz && this.pos.z - r < bz + 1 &&
      this.pos.y + this.height > by && this.pos.y < by + 1
    );
  }
}
