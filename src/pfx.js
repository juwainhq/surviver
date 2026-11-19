/* pfx.js — the pixelfx layer.
 *
 * Loads the vendored renderer, verifies every effect id the game asks for
 * against the real manifest, and bakes each one into an offscreen atlas with
 * `imageSmoothingEnabled = false`. Everything else in the game only ever sees
 * `CLIPS` (baked, trimmed, tinted) and `drawClip('key', x, y, t, opts)`.
 */
import * as core from '../vendor/pixelfx/src/core/index.js';
import * as FXMODS from '../vendor/pixelfx/src/fx/index.js';
import { SPRITE, clamp, ctx, depthScale, game } from './core.js';

/** every effect manifest, keyed by its documented id */
export const FX = FXMODS.effects;

/**
 * Check a list of ids against the manifest. Unknown ids land in MISSING (which
 * the boot report prints and the harness fails on) instead of silently baking a
 * blank clip.
 */
export function verifyIds(ids) {
  for (const id of ids) if (!FX[id] && !MISSING.includes(id)) MISSING.push(id);
  return ids.filter((id) => !FX[id]);
}

export const CLIPS = new Map();
/** ids the game asked for that the manifest does not export */
export const MISSING = [];

const DUMMY = {
  k: '#0e0c14', A: '#e4e6ec', B: '#b6b9c3', C: '#868995', D: '#5c5e6a',
  E: '#6e707c', F: '#4b4d58', G: '#34353f', J: '#2a2b33', m: '#f53cd1'
};
const BODIES = {
  knight:     { k: '#05080c', A: '#93a4bb', B: '#64748b', C: '#4a596b', D: '#3d4a5a', E: '#334155', F: '#2a3644', G: '#212b37', J: '#161d26', m: '#f5c542' },
  gunslinger: { k: '#120a06', A: '#f3dcc0', B: '#d6b58c', C: '#b08962', D: '#8a6444', E: '#97724f', F: '#6b4a33', G: '#4a3224', J: '#2f2018', m: '#e2a83c' },
  mage:       { k: '#07061a', A: '#e0f2fe', B: '#22d3ee', C: '#0891b2', D: '#3730a3', E: '#312e81', F: '#241f5e', G: '#1b1745', J: '#100e2b', m: '#a5f3fc' },
  sniper:     { k: '#04100f', A: '#d7fff6', B: '#6ee7d8', C: '#22b8a6', D: '#0f7a78', E: '#0d5f63', F: '#0a464b', G: '#073136', J: '#04201f', m: '#5eead4' },
  berserker:  { k: '#170505', A: '#ffe1cd', B: '#e2703a', C: '#a33a1e', D: '#7a2415', E: '#5c1a10', F: '#42120c', G: '#2a0b08', J: '#180605', m: '#ff7a3d' },
  assassin:   { k: '#08060f', A: '#e8e2ff', B: '#8b6cf0', C: '#5a3fc0', D: '#3b2a8a', E: '#2b1f66', F: '#1e164a', G: '#140f33', J: '#0a0820', m: '#b8a2ff' },
  tech:       { k: '#03100c', A: '#d6fff0', B: '#35d6a0', C: '#16a37a', D: '#0d7a5c', E: '#0a5c46', F: '#073f31', G: '#052a21', J: '#031a14', m: '#7cffcf' }
};
const PALETTES = {
  steel:  ['#0b0d14', '#2b3340', '#5c6b80', '#93a4bb', '#cfdcec', '#ffffff'],
  spark:  ['#0b0a14', '#4a2233', '#b8332f', '#ff6a3d', '#ffc65c', '#fff3c8'],
  gold:   ['#1a1004', '#4a2c08', '#8a5a10', '#d49a22', '#ffd35c', '#fff8d4'],
  ice:    ['#0b1226', '#1d3a63', '#2f79b8', '#5fc8f0', '#b6f2ff', '#ffffff'],
  arcane: ['#080c1a', '#152a52', '#2a5ca8', '#4a9ee0', '#9fdcff', '#ffffff'],
  toxic:  ['#0a140b', '#1c3a1a', '#2f6b28', '#5cb82f', '#a8f04a', '#f4ffd0'],
  bone:   ['#0d0c12', '#2b2833', '#5d5768', '#9a92a6', '#d8d2e0', '#ffffff'],
  violet: ['#0d0818', '#2a1445', '#552a86', '#8b4fd0', '#c79bf5', '#fdf4ff'],
  mint:   ['#04120f', '#0d3a34', '#1a6f66', '#4ecdc4', '#a9f2ea', '#ffffff']
};

const hexRgb = (h) => {
  const v = parseInt(String(h).replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};
const packRgb = (r, g, b) => (r | (g << 8) | (b << 16)) >>> 0;

const bodyMaps = new Map();
function bodyMapFor(body) {
  if (bodyMaps.has(body)) return bodyMaps.get(body);
  const pal = BODIES[body];
  let map = null;
  if (pal) {
    map = new Map();
    for (const k of Object.keys(DUMMY)) {
      const from = hexRgb(DUMMY[k]), to = hexRgb(pal[k] || DUMMY[k]);
      map.set(packRgb(from[0], from[1], from[2]), to);
    }
  }
  bodyMaps.set(body, map);
  return map;
}

/* The two locomotion stances. pixelfx ships move kits, not idle/run acts, so a
   quiet loop is synthesised from the rig's own pose channel. */
const READY_POSE = { crouch: 3, fx: 11, fy: -21, bx: 9, by: -21, ffx: 7, fbx: -7 };
const WEAPON_BY_CLASS = {
  knight: 'sword', gunslinger: 'pistol', mage: 'handle', sniper: 'bow',
  berserker: 'greatsword', assassin: 'dagger', tech: 'launcher'
};
const STANCE_META = { size: [160, 160], origin: [80, 128], loop: true, fps: 30, duration: 2.4, options: { seed: 3 } };
const IDLE_POSES = [
  [0.0, {}],
  [0.6, { crouch: 4, fy: -20, by: -20, hy: 0.4 }],
  [1.2, { crouch: 3, fy: -21, by: -21, hx: 1 }],
  [1.8, { crouch: 4, fy: -20, by: -20, hy: 0.4 }],
  [2.4, {}]
];
const RUN_POSES = [
  [0.0, { lean: 0.1, ffx: 7, ffy: 0, fbx: -7, fby: 0, fx: 11, fy: -21, bx: 9, by: -21 }],
  [0.125, { lean: 0.12, ffx: 8, ffy: -3, fbx: -4, fby: 0, fx: 13, fy: -22, bx: 8, by: -20 }],
  [0.25, { lean: 0.1, ffx: 5, ffy: -1, fbx: -6, fby: -2, fx: 12, fy: -21, bx: 9, by: -21 }],
  [0.375, { lean: 0.12, ffx: 3, ffy: 0, fbx: -8, fby: -3, fx: 10, fy: -20, bx: 11, by: -22 }],
  [0.5, { lean: 0.1, ffx: 7, ffy: 0, fbx: -7, fby: 0, fx: 11, fy: -21, bx: 9, by: -21 }]
];
/* Airborne + cast stances. The rig is the only thing that may be on screen for
   the player's body — world effects are drawn as a separate overlay — so every
   slot that is not backed by a `moves/*` kit animates through CAST_POSES. */
const JUMP_POSES = [
  [0.0, { crouch: 6, fx: 12, fy: -26, bx: 10, by: -24, ffx: 9, ffy: -9, fbx: -4, fby: -4, lean: 0.06 }],
  [0.12, { crouch: 5, fx: 13, fy: -28, bx: 10, by: -25, ffx: 10, ffy: -12, fbx: -5, fby: -6, lean: 0.08 }],
  [0.24, { crouch: 4, fx: 12, fy: -27, bx: 9, by: -24, ffx: 9, ffy: -10, fbx: -6, fby: -5, lean: 0.06 }]
];
const FALL_POSES = [
  [0.0, { crouch: 1, fx: 13, fy: -19, bx: 9, by: -19, ffx: 12, ffy: -2, fbx: -8, fby: 0, lean: -0.04 }],
  [0.16, { crouch: 1, fx: 14, fy: -18, bx: 8, by: -18, ffx: 13, ffy: 0, fbx: -9, fby: 1, lean: -0.06 }],
  [0.32, { crouch: 1, fx: 13, fy: -19, bx: 9, by: -19, ffx: 12, ffy: -1, fbx: -8, fby: 0, lean: -0.04 }]
];
const CAST_POSES = [
  [0.0, { crouch: 4, fx: 10, fy: -21, bx: 9, by: -21 }],
  [0.14, { crouch: 2, fx: 15, fy: -24, bx: 7, by: -20, lean: 0.1, sa: 0.55 }],
  [0.28, { crouch: 3, fx: 14, fy: -23, bx: 8, by: -21, lean: 0.08, sa: 0.7 }]
];
const STANCES = {
  idle: { meta: { name: 'Idle', duration: 2.4 }, poses: IDLE_POSES },
  run: { meta: { name: 'Run', duration: 0.5 }, poses: RUN_POSES },
  jump: { meta: { name: 'Jump', duration: 0.24 }, poses: JUMP_POSES },
  fall: { meta: { name: 'Fall', duration: 0.32 }, poses: FALL_POSES },
  cast: { meta: { name: 'Cast', duration: 0.28 }, poses: CAST_POSES }
};
function stanceMod(cls, which) {
  const base = STANCES[which] || STANCES.idle;
  const meta = Object.assign({}, STANCE_META, base.meta);
  const ready = core.READY || READY_POSE;
  const weapon = WEAPON_BY_CLASS[cls];
  const poses = base.poses.map(([t, p]) => {
    const pose = Object.assign({}, ready, p);
    if (weapon) Object.assign(pose, { weapon, sa: p.sa != null ? p.sa : 1.15 });
    return [t, pose];
  });
  return { meta, act: { poses }, draw() {}, drawBack() {} };
}

/** `moves/*` kits animate the rig; everything else is a pure world effect */
export function riggedClip(id) {
  return typeof id === 'string' && id.startsWith('moves/');
}

/**
 * One frame of a baked clip, as an atlas rect — used by the HUD ability slots to
 * blit a real pixelfx thumbnail instead of drawing CSS bars.
 */
export function clipFrame(key, frame) {
  const c = CLIPS.get(key);
  if (!c) return null;
  const n = c.n || 1;
  const f = ((Math.round(frame == null ? Math.floor(n * 0.5) : frame) % n) + n) % n;
  return { canvas: c.canvas, sx: (f % c.cols) * c.w, sy: Math.floor(f / c.cols) * c.h, w: c.w, h: c.h };
}

/**
 * Draw one frame of a baked clip into any 2D context (a menu preview canvas or a
 * HUD slot thumbnail). Always nearest-neighbour: the whole point is crisp pixels.
 */
export function blitClip(c2d, key, w, h, t, opt) {
  const c = CLIPS.get(key);
  if (!c || !c2d) return false;
  const o = opt || {};
  let f = Math.floor((t || 0) * c.fps + (o.phase ? o.phase * c.n : 0));
  if (c.loop) f = ((f % c.n) + c.n) % c.n;
  else f = Math.max(0, Math.min(c.n - 1, f));
  const sx = (f % c.cols) * c.w, sy = Math.floor(f / c.cols) * c.h;
  const zoom = o.zoom || 1;
  const s = Math.min(w / c.w, h / c.h) * zoom;
  const dw = Math.max(1, Math.round(c.w * s)), dh = Math.max(1, Math.round(c.h * s));
  c2d.imageSmoothingEnabled = false;
  c2d.clearRect(0, 0, w, h);
  c2d.save();
  if (o.flip) { c2d.translate(w, 0); c2d.scale(-1, 1); }
  const dx = Math.round((w - dw) / 2);
  const dy = o.middle ? Math.round((h - dh) / 2) : Math.round(h - dh - (o.pad || 0));
  if (o.bg) { c2d.fillStyle = o.bg; c2d.fillRect(0, 0, w, h); }
  c2d.drawImage(c.canvas, sx, sy, c.w, c.h, dx, dy, dw, dh);
  c2d.restore();
  return true;
}

function frameBounds(frame, w, h) {
  const d = frame.color;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (d[row + x] >>> 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { x0, y0, x1, y1 };
}

function bake(def) {
  if (CLIPS.has(def.key)) return CLIPS.get(def.key);
  let mod = def.stance ? stanceMod(def.cls, def.stance) : FX[def.id];
  if (!mod) {
    if (!MISSING.includes(def.id)) MISSING.push(def.id);
    console.warn('[pfx] unresolved effect id "' + def.id + '" — skipped');
    return null;
  }
  /* the module decides how it is instantiated: acts animate a rig, fx do not */
  const mode = def.stance || mod.act ? 'act' : 'fx';
  const meta = Object.assign({ size: [64, 64], origin: [32, 32], duration: 1, fps: 30 }, mod.meta || {});
  const fps = def.fps || (mode === 'act' ? 16 : 18);
  const win = def.window || 1.5;
  const n = Math.max(3, Math.min(def.maxFrames || 26, Math.ceil(win * fps)));
  const opts = Object.assign({}, meta.options || {}, def.opts || {});
  if (def.palette) opts.palette = def.palette;

  let w, h, ax, ay, inst;
  if (mode === 'act') {
    const b = core.actBounds(mod);
    const pad = 8;
    w = Math.ceil(b.x1 - b.x0) + pad * 2;
    h = Math.ceil(b.y1 - b.y0) + pad * 2;
    ax = Math.round(pad - b.x0);
    ay = Math.round(pad - b.y0);
    inst = core.createAct(mod, Object.assign({}, opts, { x: ax, y: ay }));
  } else {
    w = Math.ceil(meta.size[0]);
    h = Math.ceil(meta.size[1]);
    ax = meta.origin[0];
    ay = meta.origin[1];
    inst = core.createFx(mod, Object.assign({}, opts, { x: ax, y: ay }));
  }
  w = clamp(w, 8, 640);
  h = clamp(h, 8, 384);

  const frame = core.createFrame(w, h);
  const sheet = document.createElement('canvas');
  sheet.width = w;
  sheet.height = h * n;
  const sctx = sheet.getContext('2d', { alpha: true });
  const img = new ImageData(w, h);
  const bmap = mode === 'act' ? bodyMapFor(def.body || def.cls) : null;
  const box = { x0: w, y0: h, x1: -1, y1: -1 };

  for (let i = 0; i < n; i++) {
    core.clearFrame(frame);
    if (mode === 'act') inst.draw(frame, { target: false });
    else { if (!def.frontOnly) inst.draw(frame, 'back'); inst.draw(frame, 'front'); }
    core.composite(frame, img.data, null);
    if (bmap || def.tint) {
      const d = img.data;
      const tr = def.tint ? def.tint[0] : 1, tg = def.tint ? def.tint[1] : 1, tb = def.tint ? def.tint[2] : 1;
      for (let p = 0; p < d.length; p += 4) {
        if (!d[p + 3]) continue;
        if (bmap) {
          const hit = bmap.get(packRgb(d[p], d[p + 1], d[p + 2]));
          if (hit) { d[p] = hit[0]; d[p + 1] = hit[1]; d[p + 2] = hit[2]; }
        }
        if (def.tint) {
          d[p] = Math.min(255, Math.round(d[p] * tr));
          d[p + 1] = Math.min(255, Math.round(d[p + 1] * tg));
          d[p + 2] = Math.min(255, Math.round(d[p + 2] * tb));
        }
      }
    }
    sctx.putImageData(img, 0, i * h);
    const bb = frameBounds(frame, w, h);
    box.x0 = Math.min(box.x0, bb.x0); box.y0 = Math.min(box.y0, bb.y0);
    box.x1 = Math.max(box.x1, bb.x1); box.y1 = Math.max(box.y1, bb.y1);
    inst.update(1 / fps);
  }
  if (box.x1 < 0) { box.x0 = 0; box.y0 = 0; box.x1 = 0; box.y1 = 0; }
  if (def.noCrop) { box.x0 = 0; box.y0 = 0; box.x1 = w - 1; box.y1 = h - 1; }
  const bw = Math.max(1, box.x1 - box.x0 + 1);
  const bh = Math.max(1, box.y1 - box.y0 + 1);

  let cols = Math.max(1, Math.min(n, Math.floor(2048 / bw)));
  let rows = Math.ceil(n / cols);
  while (cols * bw * rows * bh > 8e6 && cols > 1) { cols--; rows = Math.ceil(n / cols); }
  const atlas = document.createElement('canvas');
  atlas.width = Math.max(1, cols * bw);
  atlas.height = Math.max(1, rows * bh);
  const actx = atlas.getContext('2d', { alpha: true });
  actx.imageSmoothingEnabled = false;
  for (let i = 0; i < n; i++) {
    const cx = (i % cols) * bw, cy = Math.floor(i / cols) * bh;
    actx.drawImage(sheet, box.x0, i * h + box.y0, bw, bh, cx, cy, bw, bh);
  }
  sheet.width = sheet.height = 1;

  const clip = {
    key: def.key, id: def.id || ('stance:' + def.stance), mode,
    canvas: atlas, w: bw, h: bh, n, cols, fps,
    ox: ax - box.x0, oy: ay - box.y0,
    loop: def.loop !== undefined ? def.loop : (mode === 'act' && !!def.stance) || !!meta.loop,
    dur: n / fps,
    scale: def.scale || 1,
    body: def.body || def.cls || null
  };
  CLIPS.set(def.key, clip);
  return clip;
}

function drawClip(key, x, y, t, o) {
  const c = CLIPS.get(key);
  if (!c) return false;
  o = o || {};
  let f = Math.floor((t || 0) * c.fps + (o.phase ? o.phase * c.n : 0));
  if (c.loop) f = ((f % c.n) + c.n) % c.n;
  else f = Math.max(0, Math.min(c.n - 1, f));
  const s = (o.scale || 1) * c.scale;
  const sx = (f % c.cols) * c.w, sy = Math.floor(f / c.cols) * c.h;
  const px = Math.round(x), py = Math.round(y);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (o.alpha != null) ctx.globalAlpha = clamp(o.alpha, 0, 1);
  if (o.flip) {
    ctx.translate(px, py);
    ctx.scale(-1, 1);
    ctx.drawImage(c.canvas, sx, sy, c.w, c.h, -c.ox * s, -c.oy * s, c.w * s, c.h * s);
  } else {
    ctx.drawImage(c.canvas, sx, sy, c.w, c.h, px - c.ox * s, py - c.oy * s, c.w * s, c.h * s);
  }
  ctx.restore();
  return true;
}

/* ============================================================== 4 · CLASSES
   Every id below is verified against vendor/pixelfx/src/fx/index.js.
   `clip` animates the character (an act), `vfx` is what the world shows. */
const textCache = new Map();
function textClip(text, crit) {
  const key = 'num:' + (crit ? 'c' : 'n') + ':' + text;
  if (textCache.has(key)) return textCache.get(key) || null;
  bake({
    key, id: crit ? 'ui/crit-number' : 'ui/damage-number',
    window: 0.95, fps: 14, loop: false, maxFrames: 14,
    opts: { text: String(text), label: crit ? 'CRIT' : '', palette: crit ? PALETTES.spark : PALETTES.bone }
  });
  const clip = CLIPS.get(key) || null;
  textCache.set(key, clip);
  return clip;
}

function drawFxOne(f) {
  const clip = CLIPS.get(f.key);
  if (!clip) return;
  const s = depthScale(f.y);
  drawClip(f.key, f.x - game.cam.x, f.y - (f.z || 0) * s, f.t, {
    scale: f.scale * SPRITE.fx, alpha: f.alpha, flip: f.flip
  });
}

/* cls -> slot -> the clip key that slot actually plays (filled by the baker) */
const ACTION_KEY = {};
function spawnFx(id, x, y, z, o) {
  const key = 'fx:' + id;
  if (!CLIPS.has(key)) bake({ key, id, window: 1.0, fps: 18, maxFrames: 18 });
  const clip = CLIPS.get(key);
  if (!clip) return null;
  const inst = {
    key, id, x, y, z: z || 0, t: 0,
    life: (o && o.life) || Math.min(clip.dur, 0.8),
    scale: (o && o.scale) || 1,
    alpha: (o && o.alpha) != null ? o.alpha : 1,
    flip: !!(o && o.flip),
    follow: (o && o.follow) || null
  };
  game.fx.push(inst);
  if (game.fx.length > 90) game.fx.shift();
  return inst;
}

function updateFx(dt) {
  for (const f of game.fx) {
    f.t += dt;
    if (f.follow) { f.x = f.follow.x; f.y = f.follow.y; f.z = f.follow.z + 20; }
  }
  game.fx = game.fx.filter((f) => f.t < f.life);
}

export {
  ACTION_KEY, PALETTES, bake, bodyMapFor, drawClip, drawFxOne,
  spawnFx, textClip, updateFx
};
