// PixelFX integration. All simulation and pixel writes happen on offscreen
// canvases, incrementally during idle time; the game only draws cached images.
import { createFrame, clearFrame, createFx, composite } from '../vendor/pixelfx/src/core/index.js';

// Critical combat assets are local static imports so a first frame can be
// baked immediately, before the deferred full animation cache is ready.
import { blobShadow } from '../vendor/pixelfx/src/fx/pickups/_lib.js';
import * as slime from '../vendor/pixelfx/src/fx/critters/slime.js';
import * as bat from '../vendor/pixelfx/src/fx/critters/bat.js';
import * as eyeball from '../vendor/pixelfx/src/fx/critters/eyeball.js';
import * as ghost from '../vendor/pixelfx/src/fx/critters/ghost.js';
import * as skull from '../vendor/pixelfx/src/fx/critters/flying-skull.js';
import * as tracer from '../vendor/pixelfx/src/fx/projectiles/bullet-tracer.js';
import * as laser from '../vendor/pixelfx/src/fx/projectiles/laser-bolt.js';
import * as disc from '../vendor/pixelfx/src/fx/projectiles/energy-disc.js';
import * as plasma from '../vendor/pixelfx/src/fx/projectiles/plasma-shot.js';
import * as orb from '../vendor/pixelfx/src/fx/arcane/arcane-orb.js';
import * as rune from '../vendor/pixelfx/src/fx/arcane/rune-circle.js';
import * as portal from '../vendor/pixelfx/src/fx/arcane/portal.js';
import * as halo from '../vendor/pixelfx/src/fx/holy/halo.js';
import * as hitSpark from '../vendor/pixelfx/src/fx/impacts/hit-spark.js';
import * as slash from '../vendor/pixelfx/src/fx/melee/sword-slash.js';
import * as cleave from '../vendor/pixelfx/src/fx/melee/heavy-cleave.js';
import * as hammer from '../vendor/pixelfx/src/fx/melee/hammer-smash.js';
import * as flurry from '../vendor/pixelfx/src/fx/melee/dagger-flurry.js';
import * as missile from '../vendor/pixelfx/src/fx/projectiles/magic-missile.js';
import * as heart from '../vendor/pixelfx/src/fx/pickups/heart-pickup.js';
import * as xp from '../vendor/pixelfx/src/fx/pickups/xp-orb.js';
import * as gem from '../vendor/pixelfx/src/fx/pickups/gem-spin.js';
import * as powerStar from '../vendor/pixelfx/src/fx/pickups/power-star.js';
import * as chest from '../vendor/pixelfx/src/fx/pickups/chest-open.js';
import * as core from '../vendor/pixelfx/src/fx/scifi/energy-core.js';
import * as levelUp from '../vendor/pixelfx/src/fx/ui/level-up.js';
import * as blunt from '../vendor/pixelfx/src/fx/impacts/blunt-hit.js';
import * as crit from '../vendor/pixelfx/src/fx/impacts/crit-hit.js';
import * as poof from '../vendor/pixelfx/src/fx/spawn/poof.js';
import * as shatter from '../vendor/pixelfx/src/fx/spawn/shatter-death.js';
// Use PixelFX's own pickup shadow painter for ground contact, cached offscreen.
const groundShadow = {meta:{size:[64,32],origin:[32,16],duration:1,loop:true},
  draw(p) { blobShadow(p,0,15,0.8); }};
const COMBAT_MODULES = {
  'fx/ground-shadow':groundShadow, 'critters/slime':slime, 'critters/bat':bat, 'critters/eyeball':eyeball,
  'critters/ghost':ghost, 'critters/flying-skull':skull,
  'projectiles/bullet-tracer':tracer, 'projectiles/laser-bolt':laser,
  'projectiles/energy-disc':disc, 'arcane/arcane-orb':orb,
  'arcane/rune-circle':rune, 'arcane/portal':portal, 'holy/halo':halo, 'impacts/hit-spark':hitSpark,
  'melee/sword-slash':slash, 'melee/heavy-cleave':cleave,
  'melee/hammer-smash':hammer, 'melee/dagger-flurry':flurry,
  'pickups/heart-pickup':heart, 'pickups/xp-orb':xp, 'pickups/gem-spin':gem, 'pickups/power-star':powerStar,
  'pickups/chest-open':chest, 'sci-fi/energy-core':core,
  'ui/level-up':levelUp, 'impacts/blunt-hit':blunt, 'impacts/critical-hit':crit,
  'spawn-and-death/poof':poof, 'spawn-and-death/shatter-death':shatter
};
export const ENEMY_PLASMA_PALETTE = ['#280812','#5b1020','#a31b2c','#ec3044','#ff7962','#ffc7a2','#fff4df','#ffffff'];

const EFFECTS = {
  'fx/ground-shadow': 'critters/slime',
  'melee/sword-slash': 'melee/sword-slash', 'melee/heavy-cleave': 'melee/heavy-cleave',
  'melee/spin-slash': 'melee/spin-slash', 'melee/dagger-flurry': 'melee/dagger-flurry',
  'melee/hammer-smash': 'melee/hammer-smash',
  // The public names below map to the filenames in PixelFX 0.3.1.
  'projectiles/pistol-shot': 'projectiles/muzzle-pistol',
  'projectiles/laser-bolt': 'projectiles/laser-bolt', 'projectiles/energy-disc': 'projectiles/energy-disc',
  'projectiles/bullet-tracer': 'projectiles/bullet-tracer', 'projectiles/plasma-shot': 'projectiles/plasma-shot',
  'projectiles/magic-missile': 'projectiles/magic-missile',
  'arcane/arcane-missiles': 'arcane/arcane-missiles',
  'impacts/blunt-hit': 'impacts/blunt-hit', 'spawn-and-death/poof': 'spawn/poof',
  'pickups/heart-pickup': 'pickups/heart-pickup', 'pickups/power-star': 'pickups/power-star',
  'pickups/chest-open': 'pickups/chest-open', 'sci-fi/energy-core': 'scifi/energy-core',
  'ui/level-up': 'ui/level-up', 'fire/fire-ring': 'fire/fire-ring',
  'arcane/arcane-orb': 'arcane/arcane-orb', 'arcane/time-stop': 'arcane/time-stop', 'arcane/portal': 'arcane/portal',
  'arcane/blink-in': 'arcane/blink-in', 'arcane/rune-circle': 'arcane/rune-circle',
  'lightning/tesla-coil': 'lightning/tesla-coil', 'sci-fi/emp-blast': 'scifi/emp-blast',
  'shadow/hex-sigil': 'shadow/hex-sigil', 'holy/divine-shield': 'holy/divine-shield', 'holy/halo': 'holy/halo',
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
      if (priority && entry.job && !entry.frames.length) {
        const i = this.queue.indexOf(entry.job);
        if (i > 0) { this.queue.splice(i, 1); this.queue.unshift(entry.job); }
      }
      return entry.frames.length ? entry : null;
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
      if (id === 'holy/halo') opts.actor = {mask:{w:0,h:0},pixels:[]};
      const fx = createFx(mod, opts);
      const ratio = 96 / Math.max(w, h);
      entry.originX = m.origin[0] * ratio; entry.originY = m.origin[1] * ratio;
      entry.duration = m.duration || 1;
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
  prime(id, mod, palette) {
    const key=this.key(id,palette);
    if (this.entries.has(key)) return;
    const entry={ready:false,failed:false,frames:[],job:null};
    this.entries.set(key,entry);
    try {
      const m=mod.meta, w=m.size[0], h=m.size[1], ratio=96/Math.max(w,h);
      const frame=createFrame(w,h), scratch=canvas(w,h), scratchCtx=scratch.getContext('2d');
      const image=scratchCtx.createImageData(w,h);
      const opts={x:m.origin[0],y:m.origin[1],light:0.3}; if(palette) opts.palette=palette;
      if (id === 'holy/halo') opts.actor = {mask:{w:0,h:0},pixels:[]};
      const fx=createFx(mod,opts);
      entry.originX=m.origin[0]*ratio; entry.originY=m.origin[1]*ratio;
      entry.duration=m.duration || 1; entry.loopDuration=m.duration || 1;
      // Take the first meaningful sample so even one-shot effects are visible.
      fx.update((m.duration || 1)/20); fx.draw(frame); composite(frame,image.data,null);
      scratchCtx.putImageData(image,0,0);
      const out=canvas(96,96), outCtx=out.getContext('2d'); outCtx.imageSmoothingEnabled=false;
      outCtx.drawImage(scratch,0,0,w*ratio,h*ratio); entry.frames.push(out);
      const job={id,entry,frame,scratch,scratchCtx,image,fx,ratio,w,h,index:1,duration:m.duration || 1};
      entry.job=job; this.queue.push(job);
    } catch (_) { entry.failed=true; }
  }
  prewarm() {
    for (const [id,mod] of Object.entries(COMBAT_MODULES)) this.prime(id,mod,null);
    this.prime('projectiles/plasma-shot',plasma,ENEMY_PLASMA_PALETTE);
    this.prime('projectiles/magic-missile',missile,ENEMY_PLASMA_PALETTE);
    this.prime('critters/slime',slime,['#061412','#0b2f1c','#16532a','#228b32','#48c852','#a6f06a','#f0ffd2']);
    this.prime('critters/slime',slime,['#20080b','#401016','#681522','#922034','#c83542','#ed7774','#ffe0cb']);
    this.prime('critters/eyeball',eyeball,ENEMY_PLASMA_PALETTE);
    this.schedule();
    for (const id of Object.keys(EFFECTS)) this.request(id, null, false);
  }
}

export class PixelFXManager {
  constructor() { this.cache = new PixelFXCache(); this.live = []; this.cache.prewarm(); }
  spawn(id, x, y, options = {}) {
    if (!EFFECTS[id] || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    const entry = this.cache.request(id, options.palette);
    if (!entry) return false;
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
    const frame = entry.frames[Math.min(entry.frames.length - 1, Math.floor(Math.max(0, time) / duration * 20))];
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
