// PixelFX integration. All simulation and pixel writes happen on offscreen
// canvases, incrementally during idle time; the game only draws cached images.
import { createFrame, clearFrame, createFx, composite } from '../vendor/pixelfx/src/core/index.js';

const EFFECTS = {
  'melee/sword-slash': 'melee/sword-slash', 'melee/heavy-cleave': 'melee/heavy-cleave',
  'melee/spin-slash': 'melee/spin-slash', 'melee/dagger-flurry': 'melee/dagger-flurry',
  'melee/hammer-smash': 'melee/hammer-smash',
  // The public names below map to the filenames in PixelFX 0.3.1.
  'projectiles/pistol-shot': 'projectiles/muzzle-pistol',
  'projectiles/laser-bolt': 'projectiles/laser-bolt', 'projectiles/energy-disc': 'projectiles/energy-disc',
  'arcane/arcane-orb': 'arcane/arcane-orb', 'arcane/time-stop': 'arcane/time-stop',
  'arcane/blink-in': 'arcane/blink-in', 'arcane/rune-circle': 'arcane/rune-circle',
  'lightning/tesla-coil': 'lightning/tesla-coil', 'sci-fi/emp-blast': 'scifi/emp-blast',
  'shadow/hex-sigil': 'shadow/hex-sigil', 'holy/divine-shield': 'holy/divine-shield',
  'impacts/hit-spark': 'impacts/hit-spark', 'impacts/critical-hit': 'impacts/crit-hit',
  'impacts/ground-slam': 'impacts/ground-slam', 'explosions/barrel-explosion': 'explosions/barrel-explosion',
  'spawn-and-death/spawn-portal': 'spawn/spawn-portal', 'spawn-and-death/soul-rise': 'spawn/soul-rise',
  'spawn-and-death/shatter-death': 'spawn/shatter-death', 'pickups/xp-orb': 'pickups/xp-orb',
  'pickups/gem-spin': 'pickups/gem-spin', 'fire/brazier': 'fire/brazier',
  'critters/ghost': 'critters/ghost', 'critters/bat': 'critters/bat',
  'critters/slime': 'critters/slime', 'critters/flying-skull': 'critters/flying-skull',
  'critters/eyeball': 'critters/eyeball', 'critters/wisp': 'critters/wisp', 'critters/snake': 'critters/snake'
};

export const ERA_PALETTES = [
  ['#261306','#56300d','#8c4a12','#c67620','#e5a83d','#f4cc77','#fff0b8','#ffffff'],
  ['#2a1605','#5c3108','#96510d','#ca7419','#efa92e','#ffd36b','#fff0ae','#ffffff'],
  ['#260a16','#5b122a','#941c3e','#c83b5a','#ea7086','#f5a9b8','#ffe0e6','#ffffff'],
  ['#101d09','#243d0d','#3d6814','#5c9920','#8dca39','#bde86c','#e8ffb2','#ffffff'],
  ['#061c29','#0a394d','#0e637c','#138ca9','#28bad0','#79ddec','#c0f6ff','#ffffff'],
  ['#150b2c','#2d1551','#4b227e','#7037b1','#a75de0','#c99aef','#ecd9ff','#ffffff']
];

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const idle = cb => typeof requestIdleCallback === 'function' ? requestIdleCallback(cb, { timeout: 250 }) : setTimeout(cb, 16);

export class PixelFXCache {
  constructor() { this.entries = new Map(); this.queue = []; this.scheduled = false; }
  key(id, palette) { return id + '|' + (palette ? palette.join(',') : ''); }
  request(id, palette, priority = true) {
    if (!EFFECTS[id]) return null;
    const key = this.key(id, palette);
    let entry = this.entries.get(key);
    if (entry) {
      if (priority && entry.job) {
        const i = this.queue.indexOf(entry.job);
        if (i > 0) { this.queue.splice(i, 1); this.queue.unshift(entry.job); }
      }
      return entry.ready ? entry : null;
    }
    entry = { ready: false, failed: false, frames: [], job: null };
    this.entries.set(key, entry);
    // One failed module or palette must never prevent other effects from working.
    import('../vendor/pixelfx/src/fx/' + EFFECTS[id] + '.js').then(mod => {
      const m = mod.meta, w = m.size[0], h = m.size[1];
      const frame = createFrame(w, h), scratch = canvas(w, h), scratchCtx = scratch.getContext('2d');
      if (!scratchCtx) throw new Error('Canvas unavailable');
      const image = scratchCtx.createImageData(w, h);
      const opts = { x: m.origin[0], y: m.origin[1], light: 0.3 }; if (palette) opts.palette = palette;
      const fx = createFx(mod, opts);
      const ratio = 96 / Math.max(w, h);
      entry.originX = m.origin[0] * ratio; entry.originY = m.origin[1] * ratio;
      entry.duration = 1; // 20 cached frames played at 20 fps
      entry.loopDuration = m.duration || 1;
      const job = { id, entry, frame, scratch, scratchCtx, image, fx, ratio, w, h, index: 0, duration: id === 'spawn-and-death/spawn-portal' ? 1.25 : (m.duration || 1) };
      entry.job = job;
      if (priority) this.queue.unshift(job); else this.queue.push(job);
      this.schedule();
    }).catch(() => { entry.failed = true; });
    return null;
  }
  schedule() {
    if (this.scheduled || !this.queue.length) return;
    this.scheduled = true;
    idle(() => {
      this.scheduled = false;
      const job = this.queue.shift();
      if (!job) return;
      try {
        const { entry, frame, fx, scratch, scratchCtx, image, ratio, w, h } = job;
        // Twenty samples spread over the authored animation; playback is capped
        // to one second for combat effects and loops retain their authored period.
        if (job.index) fx.update(job.duration / 20);
        clearFrame(frame); fx.draw(frame);
        composite(frame, image.data, null);
        scratchCtx.putImageData(image, 0, 0); // never the game canvas
        const out = canvas(96, 96), outCtx = out.getContext('2d');
        if (!outCtx) throw new Error('Canvas unavailable');
        outCtx.imageSmoothingEnabled = false;
        outCtx.drawImage(scratch, 0, 0, w * ratio, h * ratio);
        entry.frames.push(out);
        if (++job.index === 20) { entry.ready = true; entry.job = null; }
        else this.queue.push(job);
      } catch (_) { job.entry.failed = true; job.entry.job = null; job.entry.frames.length = 0; }
      this.schedule();
    });
  }
  prewarm() { for (const id of Object.keys(EFFECTS)) this.request(id, null, false); }
}

export class PixelFXManager {
  constructor() { this.cache = new PixelFXCache(); this.live = []; this.cache.prewarm(); }
  spawn(id, x, y, options = {}) {
    const entry = this.cache.request(id, options.palette);
    if (!entry || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (this.live.length >= 64) this.live.shift();
    this.live.push({ entry, x, y, angle: options.angle || 0, scale: options.scale || 1.6, time: 0 });
    return true;
  }
  update(dt) {
    if (!(dt > 0)) return;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const fx = this.live[i]; fx.time += dt;
      if (fx.time >= fx.entry.duration) this.live.splice(i, 1);
    }
  }
  clear() { this.live.length = 0; }
  paint(ctx, entry, x, y, time, duration, angle, scale, offsetX = 0, offsetY = 0) {
    const frame = entry.frames[Math.min(19, Math.floor(Math.max(0, time) / duration * 20))];
    if (!frame) return false;
    ctx.save();
    try {
      ctx.translate(x, y); ctx.rotate(angle || 0); ctx.scale(scale, scale);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(frame, -entry.originX - offsetX, -entry.originY - offsetY);
    } finally { ctx.restore(); }
    return true;
  }
  drawLoop(ctx, id, x, y, time, options = {}) {
    const entry = this.cache.request(id, options.palette);
    if (!entry) return false;
    const duration = options.duration || entry.loopDuration;
    const t = options.progress == null ? ((time % duration) + duration) % duration : Math.max(0, Math.min(0.9999, options.progress)) * duration;
    return this.paint(ctx, entry, x, y, t, duration, options.angle || 0, options.scale || 1.6, options.offsetX || 0, options.offsetY || 0);
  }
  draw(ctx) { for (const fx of this.live) this.paint(ctx, fx.entry, fx.x, fx.y, fx.time, fx.entry.duration, fx.angle, fx.scale); }
}
