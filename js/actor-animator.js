// Pre-baked PixelFX skeletal poses. The rig is rasterized offscreen once;
// gameplay draws only cached canvases and never writes pixels to the main canvas.
import { posed, poseAt, STAND } from '../vendor/pixelfx/src/core/index.js';
const MOVES = {
  'sword-combo': 0.38, 'dash-strike': 0.4, 'ground-pound': 0.8,
  'earth-stomp': 0.4, 'fireball-throw': 0.45, 'meteor-call': 0.6,
  'pistol-shots': 0.3, 'rocket-launcher': 0.45, 'arrow-shot': 0.4
};
const later = cb => typeof requestIdleCallback === 'function' ? requestIdleCallback(cb, { timeout: 200 }) : setTimeout(cb, 16);

export class ActorAnimator {
  constructor() {
    this.frames = new Map(); this.queue = []; this.running = false;
    this.add('idle', 8, i => ({...STAND, crouch: Math.round(Math.sin(i * Math.PI / 4))}));
    this.add('run', 12, i => {
      const t = i * Math.PI * 2 / 12, a = Math.round(Math.sin(t) * 7);
      return {...STAND, lean: 2, ffx: a, ffy: -Math.max(0, Math.round(Math.cos(t) * 5)), fbx: -a,
        fby: -Math.max(0, Math.round(-Math.cos(t) * 5)), fx: -3 - a, bx: 5 + a};
    });
    this.add('jump', 2, i => ({...STAND, crouch: 1, ffx: -5, ffy: -7, fbx: 5, fby: -4,
      fx: i ? 2 : -6, fy: i ? -20 : -27, bx: i ? -5 : 8, by: -24}));
    for (const [name, duration] of Object.entries(MOVES)) {
      import('../vendor/pixelfx/src/fx/moves/' + name + '.js').then(mod => {
        this.add(name, Math.ceil(duration * 20), i => poseAt(mod.act.poses, i / 20));
      }).catch(() => {});
    }
  }
  add(name, count, getPose) {
    const frames = []; this.frames.set(name, frames);
    this.queue.push({name, count, getPose, frames, i: 0}); this.schedule();
  }
  schedule() {
    if (this.running || !this.queue.length) return;
    this.running = true;
    later(() => {
      this.running = false;
      const job = this.queue.shift();
      try {
        const p = job.getPose(job.i);
        // Move keyframes contain stage translation and jump arcs. Ground position
        // and height are supplied by the game's own physics, not the preview rig.
        const rig = posed({...p, x: 0, y: 0});
        const c = document.createElement('canvas'); c.width = c.height = 96;
        const g = c.getContext('2d'), image = g.createImageData(96, 96);
        for (let i = 0; i < rig.n; i++) {
          const x = rig.xs[i] + 48, y = rig.ys[i] + 78;
          if (x < 0 || y < 0 || x >= 96 || y >= 96) continue;
          const v = rig.color[i], k = (y * 96 + x) * 4;
          image.data[k] = v & 255; image.data[k + 1] = (v >>> 8) & 255;
          image.data[k + 2] = (v >>> 16) & 255; image.data[k + 3] = v >>> 24;
        }
        g.putImageData(image, 0, 0); job.frames.push(c);
        if (++job.i < job.count) this.queue.push(job);
        else job.frames.ready = true;
      } catch (_) { this.frames.delete(job.name); }
      this.schedule();
    });
  }
  play(p, name, force = false) {
    if (!p || !MOVES[name] || (!force && p.animLock > 0)) return false;
    p.animMove = name; p.animTime = 0; p.animLock = MOVES[name]; p.attackAnimTimer = MOVES[name];
    p.animState = name === 'dash-strike' ? 'dash' : 'attack';
    return true;
  }
  update(p, dt) {
    if (!p || dt <= 0) return;
    if (p.animLock > 0) { p.animLock = Math.max(0, p.animLock - dt); p.attackAnimTimer = p.animLock; p.animTime += dt; }
    if (!(p.animLock > 0)) {
      p.animMove = null;
      p.animState = p.z > 0 ? 'jump' : p.dashTimer > 0 ? 'dash' : Math.hypot(p.vx || 0, p.vy || 0) > 0.01 ? 'run' : 'idle';
    }
  }
  draw(ctx, p, time) {
    let name = p.animMove && p.animLock > 0 ? p.animMove : p.animState === 'dash' ? 'run' : p.animState || 'idle';
    let frames = this.frames.get(name);
    if (!frames || !frames.ready) { name = 'idle'; frames = this.frames.get(name); }
    if (!frames || !frames.ready) return false;
    const index = name === 'jump' ? (p.vz < 0 ? 1 : 0) : p.animMove && name === p.animMove
      ? Math.min(frames.length - 1, Math.floor(p.animTime * 20)) : Math.floor(time * (name === 'run' ? 14 : 6)) % frames.length;
    ctx.save();
    try {
      ctx.translate(p.x, p.y - (p.z || 0)); ctx.scale(Math.cos(p.angle || 0) < 0 ? -1 : 1, 1);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(frames[index], -60, -97.5, 120, 120);
    } finally { ctx.restore(); }
    return true;
  }
}
