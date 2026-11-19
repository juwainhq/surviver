/* world.js — the stage.
 *
 * Everything behind and under the fight: the six universes, the baked sky, the
 * 0.25x silhouettes, the 0.75x stone wall with its braziers, the perspective
 * street, the raised decks, the arena gates, the weather field and the camera.
 */
import {
  H, HORIZON, FLOOR_BOTTOM, FLOOR_H, FLOOR_TOP, STAGE_W, W, WALL_TOP,
  bus, clamp, ctx, depthScale, depthV, game, lerp, mix, rand, shade
} from './core.js';
import { CLIPS, bake, drawClip } from './pfx.js';

const UNIVERSES = [
  {
    id: 'medieval', name: 'MEDIEVAL 1347',
    sky: ['#050a1a', '#15233f', '#35486a'],
    body: 'moon', bodyCol: '#dfe8f5', bodyGlow: '#7fa6d8',
    far: '#131d2e', mid: '#1d2a3e', wall: '#2b3a4f', wallHi: '#465a73', wallLit: '#7d93ad',
    floorA: '#1a1e26', floorB: '#242a34', seam: '#0b0e13', curb: '#333c4a',
    accent: '#f5c542', torch: '#ffb347',
    weather: { id: 'weather/rain', alpha: 0.12, tint: [0.92, 0.98, 1.12] }
  },
  {
    id: 'egypt', name: 'ANCIENT EGYPT',
    sky: ['#2a0c05', '#7c2d10', '#d97a2c'],
    body: 'sun', bodyCol: '#ffe9a8', bodyGlow: '#ff9a3c',
    far: '#4a2410', mid: '#63371a', wall: '#7d4c22', wallHi: '#a9712f', wallLit: '#d8a05a',
    floorA: '#2b2118', floorB: '#3b2d20', seam: '#160f09', curb: '#5a4227',
    accent: '#f5b642', torch: '#ffcf6a',
    weather: { id: 'weather/fog', alpha: 0.14, tint: [1.16, 0.96, 0.62] }
  },
  {
    id: 'japan', name: 'FEUDAL JAPAN',
    sky: ['#170a1e', '#4a1030', '#a83a63'],
    body: 'moon', bodyCol: '#ffe3f0', bodyGlow: '#ff7fb0',
    far: '#2a1024', mid: '#3f1731', wall: '#53304a', wallHi: '#7d4a6b', wallLit: '#b07a97',
    floorA: '#201a22', floorB: '#2b222e', seam: '#110d13', curb: '#3d2b3a',
    accent: '#f472b6', torch: '#ffc0d4',
    weather: { id: 'weather/cherry-blossoms', alpha: 0.15, tint: [1.1, 0.82, 0.92] }
  },
  {
    id: 'wasteland', name: 'POST-APOCALYPSE',
    sky: ['#1b1c0a', '#494a18', '#8a9432'],
    body: 'sun', bodyCol: '#f2f7c0', bodyGlow: '#b9d13a',
    far: '#2b2c14', mid: '#3c3d1d', wall: '#4d4e27', wallHi: '#6d6e3a', wallLit: '#9a9a58',
    floorA: '#1e2016', floorB: '#282b1d', seam: '#0e100a', curb: '#3a3d24',
    accent: '#a3e635', torch: '#d9f99d',
    weather: { id: 'weather/storm', alpha: 0.13, tint: [0.92, 1.0, 0.72] }
  },
  {
    id: 'space', name: 'DEEP SPACE',
    sky: ['#02030c', '#0a1030', '#1d2c60'],
    body: 'nebula', bodyCol: '#8fb6ff', bodyGlow: '#5b6bff',
    far: '#0b1126', mid: '#131b36', wall: '#1d2748', wallHi: '#33406a', wallLit: '#5d6f9e',
    floorA: '#11141f', floorB: '#1a1f2d', seam: '#070912', curb: '#232c42',
    accent: '#22d3ee', torch: '#67e8f9',
    weather: { id: 'weather/shooting-stars', alpha: 0.14, tint: [0.82, 0.96, 1.18] }
  },
  {
    id: 'void', name: 'THE VOID',
    sky: ['#05010c', '#150428', '#2c0b4c'],
    body: 'nebula', bodyCol: '#c9a6ff', bodyGlow: '#7b3cff',
    far: '#0d0520', mid: '#160a30', wall: '#221043', wallHi: '#3a2068', wallLit: '#64419c',
    floorA: '#100b19', floorB: '#191126', seam: '#07050d', curb: '#241834',
    accent: '#c084fc', torch: '#e9d5ff',
    weather: { id: 'weather/aurora', alpha: 0.15, tint: [1.06, 0.86, 1.24] }
  }
];
let universeIndex = 0;
const uni = () => UNIVERSES[universeIndex];

/* =============================================================== 3 · BAKER
   Bake a pixelfx module into an offscreen atlas once, then blit frames. Frames
   are composited to RGBA, cropped to their ink, packed into a grid, and the
   clip remembers its anchor so a draw is a single drawImage. */
const platforms = [
  { x: 460,  z: 78,  w: 250, d: 0, lane: 0.78, style: 0 },
  { x: 820,  z: 118, w: 200, d: 0, lane: 0.58, style: 1 },
  { x: 1180, z: 88,  w: 300, d: 0, lane: 0.86, style: 0 },
  { x: 1560, z: 140, w: 210, d: 0, lane: 0.66, style: 1 },
  { x: 1900, z: 96,  w: 230, d: 0, lane: 0.52, style: 0 },
  { x: 2260, z: 155, w: 190, d: 0, lane: 0.80, style: 1 },
  { x: 2640, z: 82,  w: 280, d: 0, lane: 0.62, style: 0 },
  { x: 3020, z: 126, w: 240, d: 0, lane: 0.72, style: 1 }
];

function placePlatforms() {
  for (const p of platforms) {
    p.y = FLOOR_TOP + FLOOR_H * p.lane - FLOOR_H * 0.09;
    p.d = FLOOR_H * 0.28;   /* deep enough to read as a slab in profile */
  }
}

/* arena gates: enter the trigger and the street locks until the waves are out */
const ARENAS = [
  { id: 0, x: 640,  w: 780, waves: 2, label: 'THE LOWER STREET', pool: ['slime', 'frog'], done: false },
  { id: 1, x: 1660, w: 820, waves: 3, label: 'THE BROKEN STAIR', pool: ['slime', 'frog', 'bat', 'eyeball'], done: false },
  { id: 2, x: 2760, w: 840, waves: 2, label: 'THE HOLLOW GATE', pool: ['bat', 'eyeball', 'skull', 'frog'], done: false, boss: true }
];

function updateArena(dt, player) {
  const a = game.arena;
  if (!a) {
    for (const cand of ARENAS) {
      if (cand.done || cand.active) continue;
      if (player.x > cand.x && player.x < cand.x + cand.w) { bus.startArena(cand); break; }
    }
    return;
  }
  if (a.clearT > 0) {
    a.clearT -= dt;
    if (a.clearT <= 0) bus.nextWave(a);
    return;
  }
  const bossAlive = game.boss && !game.boss.dead;
  if (game.enemies.length === 0 && !bossAlive) {
    a.clearT = 0.9;
    if (a.wave + 1 >= a.waves && a.boss && !a.bossSpawned) a.clearT = 0.5;
  }
}

function updateCamera(dt, player) {
  const a = game.arena;
  let minX = 0, maxX = Math.max(0, STAGE_W - W);
  if (a) {
    if (a.w > W - 80) { minX = a.x0 - 80; maxX = a.x1 + 80 - W; }
    else { minX = maxX = a.cx - W / 2; }
    minX = clamp(minX, 0, Math.max(0, STAGE_W - W));
    maxX = clamp(Math.max(minX, maxX), 0, Math.max(0, STAGE_W - W));
  }
  const targetX = clamp(player.x - W * 0.42, minX, maxX);
  game.cam.x = lerp(game.cam.x, targetX, 1 - Math.pow(0.002, dt));
  /* positive cam.y shifts the world DOWN, i.e. the camera follows the player up */
  const targetY = clamp((player.z - 75) * 0.35, 0, 90);
  game.cam.y = lerp(game.cam.y, targetY, 1 - Math.pow(0.02, dt));
  if (game.cam.shake > 0) game.cam.shake = Math.max(0, game.cam.shake - dt * 34);
}

function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/* ---------------------------------------------------------------- sky ---- */
let skyCanvas = null;
function buildSky() {
  skyCanvas = document.createElement('canvas');
  skyCanvas.width = 8;
  skyCanvas.height = Math.max(2, HORIZON + 6);
  const c = skyCanvas.getContext('2d');
  const u = uni();
  const g = c.createLinearGradient(0, 0, 0, skyCanvas.height);
  g.addColorStop(0, u.sky[0]);
  g.addColorStop(0.58, u.sky[1]);
  g.addColorStop(1, u.sky[2]);
  c.fillStyle = g;
  c.fillRect(0, 0, skyCanvas.width, skyCanvas.height);
}

/* the disc of the current celestial body, so the skyline never eats it */
let bodyGuard = null;

function drawSkyBody(u, camX) {
  const px = W * 0.74 - (camX * 0.04) % (W * 2);
  const cx = ((px % (W * 1.6)) + W * 1.6) % (W * 1.6) - W * 0.3;
  const cy = HORIZON * 0.34;
  const r = Math.min(W, H) * (u.body === 'nebula' ? 0.2 : 0.085);
  bodyGuard = { x0: cx - r, x1: cx + r, y0: cy - r, y1: cy + r };

  if (u.body === 'nebula') {
    /* a soft pixel nebula: overlapping blobs, no hard edges */
    for (let i = 0; i < 7; i++) {
      const a = i * 1.9;
      const bx = cx + Math.cos(a) * r * 0.9;
      const by = cy + Math.sin(a * 1.3) * r * 0.5;
      const g = ctx.createRadialGradient(bx, by, 1, bx, by, r * (0.7 + hash(i) * 0.5));
      g.addColorStop(0, u.bodyGlow);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = g;
      ctx.fillRect(bx - r * 1.3, by - r * 1.3, r * 2.6, r * 2.6);
    }
    ctx.globalAlpha = 1;
    return;
  }

  /* moon / sun: a pixel disc built from horizontal runs, plus a soft halo */
  const glow = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2.6);
  glow.addColorStop(0, u.bodyGlow);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = u.body === 'sun' ? 0.4 : 0.24;
  ctx.fillStyle = glow;
  ctx.fillRect(cx - r * 2.6, cy - r * 2.6, r * 5.2, r * 5.2);
  ctx.globalAlpha = 1;

  ctx.fillStyle = u.bodyCol;
  for (let y = -r; y <= r; y += 2) {
    const w = Math.round(Math.sqrt(Math.max(0, r * r - y * y)) / 2) * 2;
    if (w <= 0) continue;
    ctx.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2, 2);
  }
  if (u.body === 'moon') {
    ctx.fillStyle = shade(u.bodyCol, -0.18);
    const craters = [[-0.3, -0.35, 0.2], [0.25, 0.1, 0.26], [-0.05, 0.45, 0.16], [0.42, -0.3, 0.12]];
    for (const [ox, oy, s] of craters) {
      const cr = r * s;
      for (let y = -cr; y <= cr; y += 2) {
        const w = Math.round(Math.sqrt(Math.max(0, cr * cr - y * y)));
        if (w <= 0) continue;
        ctx.fillRect(Math.round(cx + ox * r - w), Math.round(cy + oy * r + y), w * 2, 2);
      }
    }
  } else {
    /* sun rays, stepped */
    ctx.fillStyle = shade(u.bodyCol, 0.05);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      for (let d = r * 1.3; d < r * 1.9; d += 6) {
        const w = Math.max(2, Math.round(6 - (d - r) * 0.02));
        ctx.fillRect(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), w, w);
      }
    }
  }
}

/* -------------------------------------------------------- parallax shapes */
function cone(cx, halfW, h, col, baseY) {
  const steps = Math.max(8, Math.round(h / 7));
  const sh = Math.ceil(h / steps);
  for (let s = 0; s < steps; s++) {
    const t = s / steps;
    ctx.fillStyle = s === 0 ? mix(col, '#dce8f6', 0.2)
      : s === 1 ? mix(col, '#ffffff', 0.06)
      : col;
    const taper = Math.pow(t, 0.78) * (1 + 0.1 * Math.sin(t * 9 + cx));
    const w = Math.max(1, Math.round(halfW * taper));
    const y = Math.round(baseY - h + t * h);
    ctx.fillRect(Math.round(cx - w), y, w * 2, sh);
  }
}

/**
 * A silhouette tower is allowed to overlap the sky, never the moon: if its box
 * would cross the body's disc the tower is shortened to sit under it. Without
 * this a dark mid tower cuts a hard rectangular notch out of the moon.
 */
function clearOfBody(cx, w, h, baseY) {
  const g = bodyGuard;
  if (!g) return h;
  if (cx + w / 2 < g.x0 - 16 || cx - w / 2 > g.x1 + 16) return h;
  const top = baseY - h;
  if (top > g.y1 + 14) return h;
  return Math.max(8, baseY - (g.y1 + 14));
}

function towerBlock(cx, w, h, col, baseY, merlon) {
  const x = Math.round(cx - w / 2), top = Math.round(baseY - h);
  ctx.fillStyle = col;
  ctx.fillRect(x, top, Math.round(w), Math.round(h));
  if (merlon) {
    const n = Math.max(2, Math.floor(w / 16));
    const mw = Math.max(4, Math.floor(w / (n * 2)));
    for (let m = 0; m < n; m++) ctx.fillRect(Math.round(x + m * (w / n)), top - 10, mw, 10);
  }
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = shade(col, 0.35);
  ctx.fillRect(x + w * 0.3, top + h * 0.3, 3, 6);
  ctx.fillRect(x + w * 0.62, top + h * 0.55, 3, 6);
  ctx.globalAlpha = 1;
}

function drawParallax() {
  const u = uni();
  const camX = game.cam.x;
  ctx.imageSmoothingEnabled = false;

  /* ---- the sky ---- */
  if (skyCanvas) ctx.drawImage(skyCanvas, 0, 0, skyCanvas.width, skyCanvas.height, 0, 0, W, HORIZON + 10);
  drawSkyBody(u, camX);

  /* ---- stars, 0.06x ---- */
  const skyW = W + 64;
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 130; i++) {
    let sx = (hash(i * 3.13) * skyW * 2 - camX * 0.06) % skyW;
    if (sx < 0) sx += skyW;
    ctx.globalAlpha = 0.07 + hash(i * 1.77) * 0.26;
    ctx.fillRect(Math.round(sx), Math.round(hash(i * 7.71) * HORIZON * 0.86), 2, 2);
  }
  ctx.globalAlpha = 1;

  /* ---- far mountains, 0.25x ---- */
  const farTile = 720;
  let off = -((camX * 0.25) % farTile);
  if (off > 0) off -= farTile;
  const farCol = mix(u.far, u.sky[2], 0.09);
  for (let i = -1; i < Math.ceil(W / farTile) + 2; i++) {
    const bx = off + i * farTile;
    cone(bx + 150, 220, Math.round(H * 0.2), farCol, HORIZON + 2);
    cone(bx + 380, 160, Math.round(H * 0.27), farCol, HORIZON + 2);
    cone(bx + 590, 210, Math.round(H * 0.16), farCol, HORIZON + 2);
  }

  /* ---- mid-ground castle / ruin silhouettes, 0.42x ---- */
  const midTile = 520;
  off = -((camX * 0.42) % midTile);
  if (off > 0) off -= midTile;
  for (let i = -1; i < Math.ceil(W / midTile) + 2; i++) {
    const bx = off + i * midTile;
    const kind = Math.floor(hash(i * 4.71) * 3);
    if (kind === 0) {
      towerBlock(bx + 90, 64, Math.round(clearOfBody(bx + 90, 64, H * 0.19, HORIZON + 4)), u.mid, HORIZON + 4, true);
      towerBlock(bx + 170, 90, Math.round(clearOfBody(bx + 170, 90, H * 0.26, HORIZON + 4)), u.mid, HORIZON + 4, true);
      towerBlock(bx + 270, 46, Math.round(clearOfBody(bx + 270, 46, H * 0.14, HORIZON + 4)), u.mid, HORIZON + 4, true);
    } else if (kind === 1) {
      towerBlock(bx + 120, 120, Math.round(clearOfBody(bx + 120, 120, H * 0.22, HORIZON + 4)), u.mid, HORIZON + 4, true);
      towerBlock(bx + 260, 52, Math.round(clearOfBody(bx + 260, 52, H * 0.3, HORIZON + 4)), u.mid, HORIZON + 4, false);
      towerBlock(bx + 350, 74, Math.round(clearOfBody(bx + 350, 74, H * 0.16, HORIZON + 4)), u.mid, HORIZON + 4, true);
    } else {
      towerBlock(bx + 70, 48, Math.round(clearOfBody(bx + 70, 48, H * 0.3, HORIZON + 4)), u.mid, HORIZON + 4, false);
      towerBlock(bx + 200, 140, Math.round(clearOfBody(bx + 200, 140, H * 0.17, HORIZON + 4)), u.mid, HORIZON + 4, true);
      towerBlock(bx + 380, 60, Math.round(clearOfBody(bx + 380, 60, H * 0.23, HORIZON + 4)), u.mid, HORIZON + 4, true);
    }
  }

  /* ---- the stone back wall, 0.75x: arches, columns, braziers ---- */
  const wt = wallTexture(u);
  const tileW = wt.canvas.width;
  off = -((camX * 0.75) % tileW);
  if (off > 0) off -= tileW;
  for (let i = -1; i < Math.ceil(W / tileW) + 2; i++) {
    const bx = Math.round(off + i * tileW);
    ctx.drawImage(wt.canvas, 0, 0, tileW, wt.canvas.height, bx, wt.top, tileW, wt.canvas.height);
    /* a torch on every second pier, with the real pixelfx fire */
    if ((i & 1) === 0) {
      const fx0 = bx + Math.round(tileW * 0.5);
      const torchY = wt.top + wt.band;
      ctx.fillStyle = shade(u.wallHi, -0.25);
      ctx.fillRect(fx0 - 3, torchY + 4, 6, 22);
      ctx.fillStyle = u.wallHi;
      ctx.fillRect(fx0 - 9, torchY, 18, 5);
      const glow = ctx.createRadialGradient(fx0, torchY - 14, 2, fx0, torchY - 14, 62);
      glow.addColorStop(0, u.torch);
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = glow;
      ctx.fillRect(fx0 - 62, torchY - 76, 124, 124);
      ctx.globalAlpha = 1;
      drawClip('prop:brazier', fx0, torchY + 2, game.time + i * 0.8, { scale: 0.95, alpha: 0.96 });
    }
  }
}

/* the back wall strip, baked once per universe + viewport */
const wallCache = new Map();
function wallTexture(u) {
  const key = u.id + ':' + H + ':' + W;
  const hit = wallCache.get(key);
  if (hit) return hit;
  const TILE = 320;
  const top = WALL_TOP;
  const base = Math.round(FLOOR_TOP + 10);
  const hgt = base - top + 40;
  const cv = document.createElement('canvas');
  cv.width = TILE;
  cv.height = hgt;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  const band = 26;                                  /* crenellation band height */

  /* parapet band + wall body */
  c.fillStyle = u.wall;
  c.fillRect(0, 0, TILE, hgt);
  c.fillStyle = u.wallHi;
  for (let i = 0; i < 8; i++) c.fillRect(i * 40 + 2, 0, 26, 12);
  c.fillStyle = u.seam;
  c.globalAlpha = 0.5;
  for (let i = 0; i < 8; i++) c.fillRect(i * 40 + 28, 12, 12, 6);
  c.globalAlpha = 1;
  c.fillStyle = u.wallLit;
  c.fillRect(0, 11, TILE, 2);

  /* courses + staggered joints */
  c.globalAlpha = 0.42;
  c.fillStyle = u.seam;
  for (let r = 0, y = band; y < hgt; r++, y += 18) {
    c.fillRect(0, y, TILE, 1);
    for (let j = 0; j < 10; j++) c.fillRect(((j * 32) + (r & 1 ? 16 : 0)) % TILE, y, 1, 18);
  }
  c.globalAlpha = 1;

  /* a blind arch between two columns: the detail that sells "back wall" */
  const archX = 96, archW = 128, archTop = band + 24, archBot = hgt - 26;
  c.fillStyle = shade(u.wall, 0.06);
  c.fillRect(archX - 12, band + 8, 12, archBot - band - 8);           /* left column */
  c.fillRect(archX + archW, band + 8, 12, archBot - band - 8);        /* right column */
  c.fillStyle = u.wallLit;
  c.fillRect(archX - 12, band + 8, 12, 3);
  c.fillRect(archX + archW, band + 8, 12, 3);
  c.fillStyle = shade(u.wall, -0.55);                                  /* the opening */
  c.fillRect(archX, archTop, archW, archBot - archTop);
  c.fillStyle = shade(u.wall, -0.25);
  for (let s = 0; s < 26; s++) {
    const t = s / 26;
    const w = Math.round(archW * Math.sqrt(Math.max(0, 1 - t * t)));
    c.fillRect(archX + (archW - w) / 2, archTop - s, w, 1);
  }
  c.fillStyle = shade(u.wall, 0.14);
  c.fillRect(archX - 16, archTop - 4, archW + 32, 5);                  /* arch lintel */

  /* base shadow so the floor meets stone */
  const g = c.createLinearGradient(0, hgt - 20, 0, hgt);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.5)');
  c.fillStyle = g;
  c.fillRect(0, hgt - 20, TILE, 20);

  const rec = { canvas: cv, top, band };
  wallCache.set(key, rec);
  return rec;
}

/* ---------------------------------------------------------------- floor -- */
function drawFloor() {
  const u = uni();
  ctx.imageSmoothingEnabled = false;
  const rows = 11;
  const colW = 150;
  const startCol = Math.floor((game.cam.x - 340) / colW);
  const endCol = Math.ceil((game.cam.x + W + 340) / colW);

  const px = (worldX, v) => W / 2 + (worldX - game.cam.x - W / 2) * lerp(0.74, 1.0, v);
  const py = (v) => FLOOR_TOP + Math.pow(v, 1.12) * FLOOR_H;

  /* the street bed */
  ctx.fillStyle = u.floorA;
  ctx.fillRect(0, FLOOR_TOP - 4, W, FLOOR_H + 60);

  for (let r = 0; r < rows; r++) {
    const v0 = r / rows, v1 = (r + 1) / rows;
    const y0 = Math.round(py(v0)), y1 = Math.round(py(v1));
    ctx.fillStyle = mix(u.floorB, u.sky[2], 0.18 * (1 - v0));
    ctx.fillRect(0, y0, W, y1 - y0 + 1);
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#000000';
    for (let c2 = startCol; c2 < endCol; c2++) {
      if ((c2 + r) & 1) continue;
      const x0 = Math.round(px(c2 * colW, v0)), x1 = Math.round(px((c2 + 1) * colW, v0));
      const x2 = Math.round(px((c2 + 1) * colW, v1)), x3 = Math.round(px(c2 * colW, v1));
      ctx.beginPath();
      ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.lineTo(x2, y1); ctx.lineTo(x3, y1);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* paving seams: flat courses, converging joints */
  ctx.strokeStyle = u.seam;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.75;
  for (let r = 0; r <= rows; r++) {
    const y = Math.round(py(r / rows));
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  for (let c2 = startCol; c2 <= endCol; c2++) {
    ctx.beginPath();
    ctx.moveTo(Math.round(px(c2 * colW, 0)), Math.round(py(0)));
    ctx.lineTo(Math.round(px(c2 * colW, 0.5)), Math.round(py(0.5)));
    ctx.lineTo(Math.round(px(c2 * colW, 1)), Math.round(py(1)));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  /* depth haze under the wall */
  const hz = ctx.createLinearGradient(0, FLOOR_TOP, 0, FLOOR_TOP + FLOOR_H * 0.24);
  hz.addColorStop(0, u.sky[2]);
  hz.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalAlpha = 0.34;
  ctx.fillStyle = hz;
  ctx.fillRect(0, FLOOR_TOP, W, FLOOR_H * 0.24);
  ctx.globalAlpha = 1;

  /* the stone curb that separates backdrop from street */
  const curbY = Math.round(HORIZON + (FLOOR_TOP - HORIZON) * 0.32);
  const curbH = Math.max(10, Math.round(H * 0.022));
  ctx.fillStyle = u.curb;
  ctx.fillRect(0, curbY, W, curbH);
  ctx.fillStyle = mix(u.curb, '#ffffff', 0.28);
  ctx.fillRect(0, curbY, W, 3);
  ctx.fillStyle = shade(u.curb, -0.5);
  ctx.fillRect(0, curbY + curbH - 3, W, 3);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = u.seam;
  for (let x = -((game.cam.x * 0.9) % 84); x < W; x += 84) ctx.fillRect(Math.round(x), curbY, 2, curbH);
  ctx.globalAlpha = 1;

  /* foreground lip: the near edge of the walkway */
  const lipY = Math.round(FLOOR_BOTTOM + 3);
  if (H - lipY > 2) {
    const lg = ctx.createLinearGradient(0, lipY, 0, H);
    lg.addColorStop(0, shade(u.floorA, -0.42));
    lg.addColorStop(1, '#04060a');
    ctx.fillStyle = lg;
    ctx.fillRect(0, lipY, W, H - lipY + 8);
    ctx.fillStyle = mix(u.curb, '#000000', 0.35);
    ctx.fillRect(0, lipY, W, 3);
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = u.seam;
    for (let x = -((game.cam.x) % 110); x < W; x += 110) ctx.fillRect(Math.round(x), lipY, 2, H - lipY);
    ctx.globalAlpha = 1;
  }
}

/* ------------------------------------------------------------ platforms -- */
function drawPlatform(p) {
  const u = uni();
  const sx0 = Math.round(p.x - game.cam.x), sx1 = Math.round(p.x + p.w - game.cam.x);
  if (sx1 < -160 || sx0 > W + 160) return;
  const vFar = depthV(p.y), vNear = depthV(p.y + p.d);
  const sFar = depthScale(p.y), sNear = depthScale(p.y + p.d);
  const yFar = Math.round(p.y - p.z * sFar);
  const yNear = Math.round(p.y + p.d - p.z * sNear);
  /* 1:1 with the walkable lane — a platform at world x must sit at screen
     x - cam.x, or the player never lands where the deck is drawn. Depth is sold
     by the tapered top face, the cut front and the brackets, not by a squash. */
  const x0f = sx0, x1f = sx1, x0n = sx0, x1n = sx1;
  const vMid = (vFar + vNear) * 0.5;
  const taper = Math.max(0, Math.round(10 * lerp(1.2, 0.6, vMid)));   /* far edge bevel */
  const slab = Math.max(11, Math.round(19 * sNear));                   /* cut thickness */

  const stone = mix(mix(u.floorB, u.wallHi, 0.6), u.curb, 0.25);
  const topFar = shade(stone, -0.16);
  const topNear = shade(stone, 0.24);
  const lip = mix(stone, '#ffffff', 0.6);
  const faceTop = shade(u.floorA, -0.2);
  const faceBot = shade(u.floorA, -0.7);
  const seamCol = shade(u.floorA, -0.9);
  const pillarCol = mix(u.wall, '#000000', 0.35);
  const pillarLit = mix(u.wallHi, '#000000', 0.1);

  /* ---- cast shadow, thrown onto the street under the slab ---- */
  ctx.save();
  const baseY = Math.round(p.y + p.d + 8);
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#04060a';
  ctx.beginPath();
  ctx.moveTo(x0f + 16, baseY);
  ctx.lineTo(x1f + 16, baseY);
  ctx.lineTo(x1n + 4, baseY + 9);
  ctx.lineTo(x0n + 4, baseY + 9);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.1;
  ctx.fillRect(x0f + 6, baseY - 2, x1f - x0f - 12, 3);
  ctx.restore();

  /* ---- iron brackets down to the street (drawn behind the deck) ---- */
  if (p.z > 24) {
    const pillarW = Math.max(8, Math.round(15 * sNear));
    const topY = yNear + slab - 2;
    const bottomY = Math.round(p.y + p.d + 8);
    if (bottomY - topY > 14) {
      for (const t of [0.18, 0.82]) {
        const bx = Math.round(p.x + p.w * t - game.cam.x);
        ctx.fillStyle = pillarCol;
        ctx.fillRect(bx - pillarW / 2, topY, pillarW, bottomY - topY);
        ctx.fillStyle = pillarLit;
        ctx.globalAlpha = 0.4;
        ctx.fillRect(bx - pillarW / 2, topY, 3, bottomY - topY);
        ctx.globalAlpha = 1;
        /* capital + base flare */
        ctx.fillStyle = shade(pillarCol, -0.35);
        ctx.fillRect(bx - pillarW, topY, pillarW * 2, 4);
        ctx.fillRect(bx - Math.round(pillarW * 1.2), bottomY - 4, Math.round(pillarW * 2.4), 4);
      }
    }
  }

  /* ---- cut front face ---- */
  const fg = ctx.createLinearGradient(0, yNear, 0, yNear + slab);
  fg.addColorStop(0, faceTop);
  fg.addColorStop(0.55, faceTop);
  fg.addColorStop(1, faceBot);
  ctx.fillStyle = fg;
  ctx.fillRect(x0n, yNear, x1n - x0n, slab);
  ctx.strokeStyle = seamCol;
  ctx.lineWidth = 1;
  ctx.strokeRect(x0n + 0.5, yNear + 0.5, x1n - x0n - 1, slab - 1);
  ctx.fillStyle = seamCol;
  ctx.globalAlpha = 0.7;
  for (let bx = x0n + 26; bx < x1n - 6; bx += 26) ctx.fillRect(Math.round(bx), yNear + 2, 1, slab - 4);
  ctx.globalAlpha = 1;
  ctx.fillStyle = shade(faceTop, 0.35);
  ctx.fillRect(x0n + 1, yNear + 1, x1n - x0n - 2, 1);

  /* ---- walkable top face: tapered stone deck ---- */
  const g = ctx.createLinearGradient(0, yFar, 0, yNear);
  g.addColorStop(0, topFar);
  g.addColorStop(1, topNear);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x0f + taper, yFar);
  ctx.lineTo(x1f - taper, yFar);
  ctx.lineTo(x1n, yNear);
  ctx.lineTo(x0n, yNear);
  ctx.closePath();
  ctx.fill();

  ctx.save();
  ctx.clip();
  /* flagstone courses, foreshortened toward the back */
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = seamCol;
  for (let t = 0.34; t < 1; t += 0.33) {
    const y = Math.round(lerp(yFar, yNear, t));
    const l = Math.round(lerp(x0f + taper, x0n, t)), r2 = Math.round(lerp(x1f - taper, x1n, t));
    ctx.fillRect(l, y, r2 - l, 1);
  }
  ctx.globalAlpha = 0.35;
  for (let t = 0.17; t < 1; t += 0.34) {
    const xx = Math.round(lerp(x0f + taper, x1f - taper, t));
    const xn = Math.round(lerp(x0n, x1n, t));
    ctx.beginPath();
    ctx.moveTo(xx, yFar);
    ctx.lineTo(xn, yNear);
    ctx.strokeStyle = seamCol;
    ctx.stroke();
  }
  /* a little ambient light pooling at the front edge */
  ctx.globalAlpha = 0.26;
  ctx.fillStyle = lip;
  ctx.fillRect(x0n, yNear - 7, x1n - x0n, 7);
  ctx.restore();

  /* ---- lit lip + outline ---- */
  ctx.fillStyle = lip;
  ctx.fillRect(x0n, yNear - 3, Math.max(0, x1n - x0n), 3);
  ctx.strokeStyle = seamCol;
  ctx.beginPath();
  ctx.moveTo(x0f + taper, yFar);
  ctx.lineTo(x1f - taper, yFar);
  ctx.lineTo(x1n, yNear);
  ctx.lineTo(x0n, yNear);
  ctx.closePath();
  ctx.stroke();
  /* corner rivets */
  ctx.fillStyle = mix(lip, '#ffffff', 0.3);
  ctx.fillRect(x0n + 4, yNear - 6, 3, 3);
  ctx.fillRect(x1n - 7, yNear - 6, 3, 3);
}

/** the contact shadow: drawn on the surface under you, shrinking as you lift off */
export function contactShadow(x, y, z, size, squish, surfaceZ) {
  const surf = surfaceZ || 0;
  const air = Math.max(0, z - surf);
  const k = 1 / (1 + air * 0.0055);
  const v = depthV(y);
  const s = (size || 1) * lerp(0.78, 1.16, v);
  const sx = Math.round(x - game.cam.x);
  const sy = Math.round(y - surf * s);
  const rx = Math.max(3, Math.round(19 * s * k));
  const ry = Math.max(1, Math.round(6 * s * (squish || 1) * k));
  ctx.save();
  ctx.globalAlpha = 0.45 * (0.35 + 0.65 * k);
  ctx.fillStyle = '#05070c';
  for (let dy = -ry; dy <= ry; dy++) {
    const t = dy / ry;
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - t * t)));
    if (w <= 0) continue;
    ctx.fillRect(sx - w, sy + dy, w * 2, 1);
  }
  ctx.restore();
}

/* --------------------------------------------------------------- bodies -- */
function weatherClip(u) {
  const key = 'wx:' + u.id;
  if (CLIPS.has(key)) return CLIPS.get(key);
  return bake({
    key, id: u.weather.id, window: 1.0, fps: 8, maxFrames: 8,
    noCrop: true, loop: true, tint: u.weather.tint || null
  });
}

function drawWeather() {
  const u = uni();
  const clip = weatherClip(u);
  if (!clip) return;
  const scale = Math.max(W / clip.w, H / clip.h) * 1.1;
  const dw = Math.ceil(clip.w * scale), dh = Math.ceil(clip.h * scale);
  const f = Math.floor(game.time * clip.fps) % clip.n;
  const sx = (f % clip.cols) * clip.w, sy = Math.floor(f / clip.cols) * clip.h;
  ctx.save();
  ctx.globalAlpha = Math.min(0.15, u.weather.alpha);            /* spec ceiling */
  ctx.imageSmoothingEnabled = false;
  const stepX = Math.round(dw * 0.7), stepY = Math.round(dh * 0.7);
  for (let x = -stepX; x < W + stepX; x += stepX) {
    for (let y = -stepY; y < H + stepY; y += stepY) {
      ctx.drawImage(clip.canvas, sx, sy, clip.w, clip.h, x, y, dw, dh);
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------- arena gates ---- */
function drawArenaLock() {
  const a = game.arena;
  if (!a) return;
  const pulse = 0.55 + Math.sin(game.time * 5) * 0.18;
  for (const gx of [a.x0, a.x1]) {
    const x = gx - game.cam.x;
    if (x < -60 || x > W + 60) continue;
    ctx.save();
    ctx.globalAlpha = 0.18 * pulse;
    ctx.fillStyle = uni().accent;
    ctx.fillRect(Math.round(x) - 26, WALL_TOP, 52, FLOOR_BOTTOM - WALL_TOP);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = uni().accent;
    ctx.fillRect(Math.round(x) - 2, WALL_TOP, 4, FLOOR_BOTTOM - WALL_TOP);
    for (let y = WALL_TOP + 10; y < FLOOR_BOTTOM; y += 34) {
      ctx.fillRect(Math.round(x) - 12, y, 24, 3);
    }
    ctx.restore();
  }
}

/* ------------------------------------------------------------- crosshair -- */

/**
 * Swap the universe: repaint the sky, drop the cached wall and announce it.
 */
export function setUniverse(i) {
  universeIndex = clamp(i, 0, UNIVERSES.length - 1);
  buildSky();
  wallCache.clear();
  bus.banner(UNIVERSES[universeIndex].name, 'UNIVERSE ' + (universeIndex + 1));
  bus.dev();
}


export {
  ARENAS, UNIVERSES, buildSky, drawArenaLock, drawFloor, drawParallax, drawPlatform,
  drawSkyBody, drawWeather, placePlatforms, platforms, uni, universeIndex,
  updateArena, updateCamera, wallCache, wallTexture
};
