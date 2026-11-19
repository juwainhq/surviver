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
/** DUMMY rgb (packed) -> this body's rgb (packed), for the frame's own colour plane */
function bodyMapFor(body) {
  if (bodyMaps.has(body)) return bodyMaps.get(body);
  const pal = BODIES[body];
  let map = null;
  if (pal) {
    map = new Map();
    for (const k of Object.keys(DUMMY)) {
      const from = hexRgb(DUMMY[k]), to = hexRgb(pal[k] || DUMMY[k]);
      map.set(packRgb(from[0], from[1], from[2]), packRgb(to[0], to[1], to[2]));
    }
  }
  bodyMaps.set(body, map);
  return map;
}

/**
 * Recolour the stand-in actor on the frame's colour plane, BEFORE core.composite()
 * adds the spell glow. Composite is additive over the light plane, so remapping
 * afterwards only hits pixels whose rgb is still *exactly* a DUMMY colour — and a
 * fireball blooming across the mage's chest pushes exactly those off-value,
 * leaving him grey. Doing it here, on the raw palette, is exact for every pixel
 * and lets the character keep his class colours under any amount of bloom.
 */
function remapBody(frame, bmap) {
  const C = frame.color;
  for (let i = 0; i < C.length; i++) {
    const c = C[i];
    if (!(c >>> 24)) continue;
    const hit = bmap.get(c & 0xffffff);
    if (hit !== undefined) C[i] = (((c >>> 24) << 24) | hit) >>> 0;
  }
}

/* ================================================================ grips ====
 * pixelfx ships move kits, not idle/run acts, so the locomotion stances are
 * synthesised from the rig's own pose channel. Every *grip* below, though, is
 * copied verbatim from the kit that animates that weapon, so a character at rest
 * holds the weapon exactly the way his attack does — no one-size-fits-all
 * `sa: 1.15`, which rammed every blade out horizontally:
 *
 *   sword       melee/sword-slash      GUARD  { fx: 12, fy: -21, sa: -0.85 }
 *   greatsword  melee/heavy-cleave     REST_  { two, fx: 11, fy: -21, sa: -1 }
 *   pistol      moves/pistol-shots     REST_  { sa: 0.9 }  /  AIM { sa: 0 }
 *   bow         moves/arrow-shot       REST_  { sa: -0.4 } /  AIM { sa: 0, nocked }
 *   launcher    moves/rocket-launcher  REST_  { two, sa: -1 } / KNEEL { sa: 0 }
 *   dagger      melee/dagger-flurry    BASE, rolled to a reverse grip
 *   (bare)      moves/fireball-throw   HOLD / lightning-call UP for the air
 *
 * `sa` is the weapon axis angle in the rig: negative tips the blade up and back
 * over the shoulder, positive drives it forward and down towards the floor. Each
 * class then carries one override per stance for where the weapon sits while
 * running, rising and falling.
 */
const GRIPS = {
  knight: {
    weapon: 'sword', sa: -0.85, fx: 12, fy: -21, bx: 9, by: -21, crouch: 3, ffx: 8, fbx: -8,
    idle: {},
    run: { fx: 11, fy: -20, sa: -0.7 },
    jump: { fx: 13, fy: -26, sa: -1.2 },
    fall: { fx: 13, fy: -17, sa: -0.5 }
  },
  berserker: {
    /* two-handed: the far hand rides the haft, so bx/by are ignored by the rig */
    weapon: 'greatsword', two: true, sa: -1, fx: 11, fy: -21, crouch: 3, ffx: 8, fbx: -8,
    idle: {},
    run: { fx: 11, fy: -22, sa: -1.15 },
    jump: { fx: 12, fy: -28, sa: -1.4 },
    fall: { fx: 12, fy: -18, sa: -0.7 }
  },
  gunslinger: {
    weapon: 'pistol', sa: 0.9, fx: 10, fy: -17, bx: 7, by: -16, crouch: 3, ffx: 8, fbx: -8,
    idle: {},
    run: { fx: 11, fy: -18, sa: 0.75 },
    jump: { fx: 16, fy: -24, bx: 11, by: -22, sa: 0.15, lean: 2, armsFront: true },
    fall: { fx: 15, fy: -21, bx: 10, by: -19, sa: 0.35 }
  },
  sniper: {
    weapon: 'bow', sa: -0.4, fx: 12, fy: -20, bx: 6, by: -17, crouch: 3, ffx: 8, fbx: -8,
    idle: {},
    run: { fx: 12, fy: -21, sa: -0.5 },
    jump: { fx: 16, fy: -26, bx: 9, by: -25, sa: -0.05, nocked: true, armsFront: true },
    fall: { fx: 14, fy: -22, bx: 8, by: -21, sa: -0.2 }
  },
  tech: {
    /* shouldered tube, both hands on it, exactly like moves/rocket-launcher */
    weapon: 'launcher', two: true, sa: -1, fx: 9, fy: -19, crouch: 3, ffx: 8, fbx: -8,
    idle: {},
    run: { fx: 9, fy: -20, sa: -1.05 },
    jump: { crouch: 5, fx: 9, fy: -18, sa: -0.7 },
    fall: { fx: 10, fy: -17, sa: -0.4 }
  },
  mage: {
    /* bare-handed caster: no weapon at all (the stubby `handle` brick is gone).
       Lead hand up and open to cast, off hand low and back, as in fireball-throw. */
    fx: 13, fy: -22, bx: 7, by: -22, crouch: 3, lean: 1, ffx: 10, fbx: -8,
    idle: {},
    run: { fx: 12, fy: -21, lean: 0, bx: 6, by: -21 },
    jump: { fx: 5, fy: -40, bx: 7, by: -20, lean: -1 },      /* lightning-call UP */
    fall: { fx: 13, fy: -27, bx: -2, by: -21 }
  },
  assassin: {
    /* compact stealth crouch, dagger reversed down the forearm */
    weapon: 'dagger', sa: 2.2, fx: 13, fy: -22, bx: 8, by: -18, crouch: 5, lean: 3, ffx: 11, fbx: -9,
    idle: {},
    run: { crouch: 4, lean: 4, fx: 14, fy: -21, sa: 2.05 },
    jump: { crouch: 3, fx: 14, fy: -27, sa: 1.85 },
    fall: { crouch: 4, fx: 12, fy: -18, sa: 2.35 }
  }
};

/* Body motion only: the legs, the carriage and the head. `dch` / `dlean` are
   deltas on the class's own grip, so the crouched assassin stays crouched while
   he breathes and runs. `cast` is the one stance that moves the hands itself. */
const STANCE_BODY = {
  idle: {
    meta: { name: 'Idle', duration: 2.4 },
    keys: [[0, {}], [0.6, { dch: 1, hy: 0.4 }], [1.2, { hx: 1 }], [1.8, { dch: 1, hy: 0.4 }], [2.4, {}]]
  },
  run: {
    meta: { name: 'Run', duration: 0.5 },
    keys: [
      [0, { dlean: 0.1, ffx: 7, ffy: 0, fbx: -7, fby: 0 }],
      [0.125, { dlean: 0.12, ffx: 8, ffy: -3, fbx: -4, fby: 0 }],
      [0.25, { dlean: 0.1, ffx: 5, ffy: -1, fbx: -6, fby: -2 }],
      [0.375, { dlean: 0.12, ffx: 3, ffy: 0, fbx: -8, fby: -3 }],
      [0.5, { dlean: 0.1, ffx: 7, ffy: 0, fbx: -7, fby: 0 }]
    ]
  },
  jump: {
    meta: { name: 'Jump', duration: 0.24 },
    keys: [
      [0, { dch: 3, ffx: 9, ffy: -9, fbx: -4, fby: -4 }],
      [0.12, { dch: 2, ffx: 10, ffy: -12, fbx: -5, fby: -6 }],
      [0.24, { dch: 1, ffx: 9, ffy: -10, fbx: -6, fby: -5 }]
    ]
  },
  fall: {
    meta: { name: 'Fall', duration: 0.32 },
    keys: [
      [0, { dch: -2, ffx: 12, ffy: -2, fbx: -8, fby: 0 }],
      [0.16, { dch: -2, ffx: 13, ffy: 0, fbx: -9, fby: 1 }],
      [0.32, { dch: -2, ffx: 12, ffy: -1, fbx: -8, fby: 0 }]
    ]
  },
  cast: {
    meta: { name: 'Cast', duration: 0.28 },
    keys: [[0, {}], [0.14, { fx: 15, fy: -24, dlean: 0.1 }], [0.28, { fx: 14, fy: -23, dlean: 0.08 }]]
  }
};
const STANCE_KEYS = ['idle', 'run', 'jump', 'fall', 'cast'];
const STANCE_META = { size: [160, 160], origin: [80, 128], loop: true, fps: 30, duration: 2.4, options: { seed: 3 } };

function stanceMod(cls, which) {
  const base = STANCE_BODY[which] || STANCE_BODY.idle;
  const grip = GRIPS[cls] || {};
  const arm = grip[which] || {};
  const meta = Object.assign({}, STANCE_META, base.meta);
  const poses = base.keys.map(([t, k]) => {
    const pose = Object.assign({}, grip, arm, k);
    for (const st of STANCE_KEYS) delete pose[st];
    if (k.dch != null) pose.crouch = (grip.crouch || 0) + k.dch;
    if (k.dlean != null) pose.lean = (arm.lean != null ? arm.lean : (grip.lean || 0)) + k.dlean;
    delete pose.dch;
    delete pose.dlean;
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
  return { canvas: c.canvas, sx: (f % c.cols) * c.cw + GUTTER, sy: Math.floor(f / c.cols) * c.ch + GUTTER, w: c.w, h: c.h };
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
  const sx = (f % c.cols) * c.cw + GUTTER, sy = Math.floor(f / c.cols) * c.ch + GUTTER;
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

/* A pixel fainter than this is a halo lip, not art: it is scrubbed so a glow
   fades into the floor instead of ending on a hard 1-pixel edge. */
const ALPHA_FLOOR = 10;
/* Transparent band around every atlas cell. Without it, sampling the cell beside
   a glow can pull a 1-px line of the neighbour onto a sprite's bottom edge. */
const GUTTER = 2;

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
  const d = img.data;
  const tr = def.tint ? def.tint[0] : 1, tg = def.tint ? def.tint[1] : 1, tb = def.tint ? def.tint[2] : 1;

  for (let i = 0; i < n; i++) {
    core.clearFrame(frame);
    if (mode === 'act') inst.draw(frame, { target: false });
    else { if (!def.frontOnly) inst.draw(frame, 'back'); inst.draw(frame, 'front'); }
    /* exact palette swap on the colour plane, while every body pixel still holds
       its authored value — the glow is not added until composite() below */
    if (bmap) remapBody(frame, bmap);
    core.composite(frame, img.data, null);
    /* scrub the halo lip, and measure the box from the composited pixels so the
       bloom around an orb, a gem or a spell is inside the crop, not cut off */
    for (let p = 0; p < d.length; p += 4) {
      if (d[p + 3] < ALPHA_FLOOR) {
        d[p] = 0; d[p + 1] = 0; d[p + 2] = 0; d[p + 3] = 0;
        continue;
      }
      if (def.tint) {
        d[p] = Math.min(255, Math.round(d[p] * tr));
        d[p + 1] = Math.min(255, Math.round(d[p + 1] * tg));
        d[p + 2] = Math.min(255, Math.round(d[p + 2] * tb));
      }
      const q = p >> 2, x = q % w, y = (q / w) | 0;
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
    }
    sctx.putImageData(img, 0, i * h);
    inst.update(1 / fps);
  }
  if (box.x1 < 0) { box.x0 = 0; box.y0 = 0; box.x1 = 0; box.y1 = 0; }
  if (def.noCrop) { box.x0 = 0; box.y0 = 0; box.x1 = w - 1; box.y1 = h - 1; }
  const bw = Math.max(1, box.x1 - box.x0 + 1);
  const bh = Math.max(1, box.y1 - box.y0 + 1);

  const cw = bw + GUTTER * 2, ch = bh + GUTTER * 2;
  let cols = Math.max(1, Math.min(n, Math.floor(2048 / cw)));
  let rows = Math.ceil(n / cols);
  while (cols * cw * rows * ch > 8e6 && cols > 1) { cols--; rows = Math.ceil(n / cols); }
  const atlas = document.createElement('canvas');
  atlas.width = Math.max(1, cols * cw);
  atlas.height = Math.max(1, rows * ch);
  const actx = atlas.getContext('2d', { alpha: true });
  actx.imageSmoothingEnabled = false;
  for (let i = 0; i < n; i++) {
    /* every frame sits inset by the gutter, so its neighbours can never bleed */
    const cx = (i % cols) * cw + GUTTER, cy = Math.floor(i / cols) * ch + GUTTER;
    actx.drawImage(sheet, box.x0, i * h + box.y0, bw, bh, cx, cy, bw, bh);
  }
  sheet.width = sheet.height = 1;

  const clip = {
    key: def.key, id: def.id || ('stance:' + def.stance), mode,
    canvas: atlas, w: bw, h: bh, cw, ch, n, cols, fps,
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
  const sx = (f % c.cols) * c.cw + GUTTER, sy = Math.floor(f / c.cols) * c.ch + GUTTER;
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

/** a recoloured variant of an effect bakes and caches as its own clip */
function fxKey(id, palette) {
  if (!palette) return 'fx:' + id;
  return 'fx:' + id + '#' + palette.map((c) => String(c).replace('#', '')).join('');
}

function spawnFx(id, x, y, z, o) {
  o = o || {};
  const pal = o.palette || null;
  const key = fxKey(id, pal);
  if (!CLIPS.has(key)) {
    bake({ key, id, window: 1.0, fps: 18, maxFrames: 18, opts: pal ? { palette: pal } : null });
  }
  const clip = CLIPS.get(key);
  if (!clip) return null;
  const inst = {
    key, id, x, y, z: z || 0, t: 0,
    life: o.life || Math.min(clip.dur, 0.8),
    scale: o.scale || 1,
    alpha: o.alpha != null ? o.alpha : 1,
    flip: !!o.flip,
    follow: o.follow || null
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
  ACTION_KEY, GRIPS, PALETTES, bake, bodyMapFor, drawClip, drawFxOne,
  fxKey, remapBody, spawnFx, textClip, updateFx
};
