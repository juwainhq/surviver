/* ui.js — the retro skin.
 *
 * Minimal slate HUD (HP crests, class/level/XP, the four-slot bar with its
 * countdown and ult meter), floating callouts, damage numbers, the three Data
 * Chip cards offered after an arena, and the collapsible dev panel.
 */
import {
  FLOOR_H, FLOOR_TOP, H, MAX_LEVEL, STAGE_W, W, XP_STEPS, bus, clamp, ctx, depthScale,
  game, rand
} from './core.js';
import { PALETTES, bake, drawClip, CLIPS, textClip } from './pfx.js';
import { UNIVERSES, setUniverse, uni, universeIndex } from './world.js';
import { spawnEnemy, spawnWave } from './enemies.js';
import { CLASSES, CLASS_IDS, CLS, lockedSlots, player, resetPlayer } from './classes.js';

function addNumber(x, y, z, text, crit) {
  game.texts.push({ x, y, z, text, crit: !!crit, t: 0, life: 0.9, vx: rand(-18, 18) });
  if (game.texts.length > 40) game.texts.shift();
}

/* floating callouts are DOM: always crisp, never a canvas primitive */
const floatsEl = document.getElementById('floats');
function callout(text, kind) {
  const el = document.createElement('div');
  el.className = 'float ' + (kind || '');
  el.textContent = text;
  const px = Math.round((player.x - game.cam.x));
  const py = Math.round((player.y - player.z * depthScale(player.y) - game.cam.y - 96));
  el.style.left = clamp(px, 40, W - 40) + 'px';
  el.style.top = clamp(py, 60, H - 120) + 'px';
  floatsEl.appendChild(el);
  setTimeout(() => el.remove(), 820);
}

/* ============================================================= 8 · WAVES */
function denySlot(slot, why) {
  lockedSlots[slot] = 0.55;
  const el = slotEls[slot];
  if (el) {
    el.classList.add('deny');
    setTimeout(() => el.classList.remove('deny'), 180);
  }
  callout(why, 'red');
}

function drawTexts() {
  for (const t of game.texts) {
    const clip = textClip(t.text, t.crit);
    if (!clip) continue;
    const p = Math.round(t.x - game.cam.x);
    const y = Math.round(t.y - t.z - t.t * 40);
    const rise = 1 - t.t / t.life;
    drawClip(clip.key, p, y, 0, { scale: t.crit ? 0.55 : 0.6, alpha: clamp(rise * 1.7, 0, 1) });
  }
}

/* ------------------------------------------------------------- weather -- */
function drawCrosshair() {
  const mx = Math.round(game.mouse.x), my = Math.round(game.mouse.y);
  if (mx <= 0 && my <= 0) return;
  /* a 1 px plus with a 2x2 dot: the only sanctioned primitive on the field */
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  const gap = 5, len = 4;
  ctx.fillRect(mx - gap - len, my, len, 1);
  ctx.fillRect(mx + gap, my, len, 1);
  ctx.fillRect(mx, my - gap - len, 1, len);
  ctx.fillRect(mx, my + gap, 1, len);
  ctx.fillStyle = uni().accent;
  ctx.fillRect(mx - 1, my - 1, 2, 2);
}

/* ---------------------------------------------------------------- render -- */
function drawCombo() {
  const n = game.stats.combo;
  if (n < 3) return;
  const pips = Math.min(12, Math.floor(n / 2));
  const x = Math.round(W / 2 - 236), y = H - 62;
  ctx.globalAlpha = 0.95;
  for (let i = 0; i < pips; i++) {
    ctx.fillStyle = i % 2 ? '#f5c542' : '#ff8b5a';
    ctx.fillRect(x + i * 6, y - (i % 3) * 2, 4, 10);
  }
  ctx.globalAlpha = 1;
}

/* ================================================================= 13 · HUD */
const HUD = {
  className: document.getElementById('className'),
  hpRow: document.getElementById('hpRow'),
  lvText: document.getElementById('lvText'),
  xpFill: document.getElementById('xpFill'),
  waveTag: document.getElementById('waveTag'),
  bossWrap: document.getElementById('bossWrap'),
  bossName: document.getElementById('bossName'),
  bossFill: document.getElementById('bossFill'),
  ultFill: document.getElementById('ultFill'),
  banner: document.getElementById('banner'),
  slots: {
    shift: document.querySelector('[data-slot="shift"]'),
    q: document.querySelector('[data-slot="q"]'),
    e: document.querySelector('[data-slot="e"]'),
    r: document.querySelector('[data-slot="r"]')
  }
};
const slotEls = HUD.slots;

function banner(text, sub) {
  const el = HUD.banner;
  el.innerHTML = text + (sub ? '<small>' + sub + '</small>' : '');
  el.classList.add('on');
  game.banner.t = 1.9;
  clearTimeout(banner._t);
  banner._t = setTimeout(() => el.classList.remove('on'), 1750);
}

let hudHp = -1, hudClass = '', hudLevel = -1;

function syncHud() {
  const c = CLS();

  if (hudClass !== game.classId) {
    hudClass = game.classId;
    HUD.className.textContent = c.name;
    HUD.className.style.color = c.accent;
    for (const s of ['shift', 'q', 'e', 'r']) {
      const def = c[s];
      const el = HUD.slots[s];
      if (!def || !el) continue;
      el.querySelector('.nm').textContent = def.name;
      el.querySelector('.lv').textContent = 'LV' + def.level;
    }
  }
  if (hudHp !== player.maxHp) {
    hudHp = player.maxHp;
    HUD.hpRow.innerHTML = '';
    for (let i = 0; i < player.maxHp; i++) {
      const d = document.createElement('div');
      d.className = 'pip';
      HUD.hpRow.appendChild(d);
    }
  }
  const pips = HUD.hpRow.children;
  for (let i = 0; i < pips.length; i++) {
    pips[i].className = 'pip' + (i < player.hp ? ' on' : '');
  }
  if (hudLevel !== game.level || hudLevel !== -1) {
    HUD.lvText.textContent = 'LV ' + game.level;
  }
  const lo = XP_STEPS[Math.max(0, game.level - 1)] || 0;
  const hi = XP_STEPS[Math.min(XP_STEPS.length - 1, game.level)] || lo + 1;
  const pct = game.level >= MAX_LEVEL ? 1 : clamp((game.xp - lo) / Math.max(1, hi - lo), 0, 1);
  HUD.xpFill.style.width = Math.round(pct * 100) + '%';

  for (const s of ['shift', 'q', 'e', 'r']) {
    const def = c[s];
    const el = HUD.slots[s];
    if (!def || !el) continue;
    const locked = def.level > game.level;
    const cd = game.cd[s] || 0;
    const cooling = cd > 0.05;
    el.classList.toggle('locked', locked);
    el.classList.toggle('cooling', !locked && cooling);
    const cdEl = el.querySelector('.cd');
    if (locked) {
      cdEl.textContent = 'LV ' + def.level;
    } else if (cooling) {
      cdEl.textContent = cd.toFixed(1) + 's';
    } else {
      cdEl.textContent = '';
    }
    if (s === 'r') {
      const ready = !locked && game.ult >= 100;
      el.classList.toggle('ult-ready', ready);
      HUD.ultFill.style.width = Math.round(game.ult) + '%';
      if (!locked && !ready) cdEl.textContent = Math.round(game.ult) + '%';
      if (locked) HUD.ultFill.style.width = '0%';
    } else {
      el.classList.toggle('ready', !locked && !cooling);
    }
  }

  const a = game.arena;
  if (a) {
    HUD.waveTag.classList.add('on');
    HUD.waveTag.innerHTML = a.label + ' · <b>WAVE ' + Math.min(a.waves, a.wave + 1) + ' / ' + a.waves + '</b>';
  } else if (game.enemies.length > 0) {
    HUD.waveTag.classList.add('on');
    HUD.waveTag.innerHTML = '<b>' + game.enemies.length + '</b> HOSTILE' + (game.enemies.length > 1 ? 'S' : '') + ' IN THE STREET';
  } else {
    HUD.waveTag.classList.remove('on');
 }

  const boss = game.boss;
  if (boss && !boss.dead) {
    HUD.bossWrap.classList.add('on');
    HUD.bossFill.style.width = Math.max(0, (boss.hp / boss.maxHp) * 100) + '%';
  } else {
    HUD.bossWrap.classList.remove('on');
  }
}

/* ================================================================ 14 · DEV */
let devOpen = false;
function toggleDev(force) {
  devOpen = force != null ? force : !devOpen;
  document.getElementById('devBar').classList.toggle('on', devOpen);
  document.getElementById('devToggle').classList.toggle('on', devOpen);
}

function setClass(id) {
  if (!CLASSES[id]) return;
  game.classId = id;
  resetPlayer();
  game.cd.shift = 0; game.cd.q = 0; game.cd.e = 0;
  hudClass = '';
  hudHp = -1;
  banner(CLASSES[id].name, 'CLASS SWITCH');
  markDev();
  syncHud();
}

function unlockAll() {
  game.level = MAX_LEVEL;
  game.xp = XP_STEPS[MAX_LEVEL - 1];
  game.ult = 100;
  game.cd.shift = 0; game.cd.q = 0; game.cd.e = 0; game.cd.r = 0;
  player.hp = player.maxHp;
  banner('EVERYTHING UNLOCKED', 'ULTIMATE CHARGED');
  callout('ULTIMATE READY', 'gold');
  syncHud();
}

function toggleGod() {
  game.god = !game.god;
  if (game.god) player.hp = player.maxHp;
  banner(game.god ? 'GOD MODE ON' : 'GOD MODE OFF', 'INVULNERABLE');
  markDev();
}

function devWave() {
  const a = game.arena;
  spawnWave(6, a ? a.pool : ['slime', 'frog', 'bat', 'eyeball'], a ? a.w * 0.34 : 420);
  callout('WAVE', 'gold');
}

function devBoss() {
  if (game.boss && !game.boss.dead) return;
  const x = clamp(player.x + 260, 80, STAGE_W - 80);
  const b = spawnEnemy('boss', x, FLOOR_TOP + FLOOR_H * 0.55);
  b.hp = b.maxHp = 110 + game.level * 12;
  game.boss = b;
  banner('THE HOLLOW WARDEN', 'STAGE BOSS');
}

function resetCds() {
  game.cd.shift = 0; game.cd.q = 0; game.cd.e = 0; game.cd.r = 0;
  callout('COOLDOWNS RESET', 'cyan');
  syncHud();
}

function markDev() {
  document.querySelectorAll('[data-dev-class]').forEach((b) => b.classList.toggle('on', b.dataset.devClass === game.classId));
  document.querySelectorAll('[data-dev-uni]').forEach((b) => b.classList.toggle('on', +b.dataset.devUni === universeIndex));
  document.getElementById('devGod').classList.toggle('on', game.god);
}

function buildDevBar() {
  const dc = document.getElementById('devClasses');
  for (const id of CLASS_IDS) {
    const b = document.createElement('button');
    b.className = 'db';
    b.dataset.devClass = id;
    b.textContent = CLASSES[id].short;
    b.addEventListener('click', () => setClass(id));
    dc.appendChild(b);
  }
  const du = document.getElementById('devUnis');
  UNIVERSES.forEach((u, i) => {
    const b = document.createElement('button');
    b.className = 'db mini';
    b.dataset.devUni = String(i);
    b.textContent = String(i + 1);
    b.title = u.name;
    b.addEventListener('click', () => setUniverse(i));
    du.appendChild(b);
  });
  document.getElementById('devToggle').addEventListener('click', () => toggleDev());
  document.getElementById('devUnlock').addEventListener('click', unlockAll);
  document.getElementById('devGod').addEventListener('click', toggleGod);
  document.getElementById('devWave').addEventListener('click', devWave);
  document.getElementById('devBoss').addEventListener('click', devBoss);
  document.getElementById('devCds').addEventListener('click', resetCds);
  document.getElementById('devLevel').addEventListener('click', addLevel);
  document.getElementById('devWipe').addEventListener('click', wipeMap);
}



/* --------------------------------------------------------------- boot UI -- */

/** the seven class chips on the title overlay */
export function buildBootClasses() {
  const root = document.getElementById('bootClasses');
  if (!root) return;
  root.innerHTML = '';
  for (const id of CLASS_IDS) {
    const b = document.createElement('button');
    b.className = 'bc' + (id === game.classId ? ' on' : '');
    b.dataset.bootClass = id;
    b.textContent = CLASSES[id].short;
    b.addEventListener('click', () => { setClass(id); buildBootClasses(); });
    root.appendChild(b);
  }
}

/* -------------------------------------------------------------- dev extras */

/** [+1 LEVEL] — one level, clamped, with the unlock banner */
function addLevel() {
  if (game.level >= MAX_LEVEL) { banner('LEVEL MAX', 'LV ' + MAX_LEVEL); return; }
  gainXpForLevel(game.level + 1);
  markDev();
  syncHud();
}
function gainXpForLevel(lv) {
  game.level = clamp(lv, 1, MAX_LEVEL);
  game.xp = XP_STEPS[game.level - 1] || 0;
  player.maxHp = CLS().hp + game.upgrades.hp;
  player.hp = player.maxHp;
  banner('LEVEL ' + game.level, game.level >= 5 ? 'ULTIMATE ONLINE' : 'KIT UPGRADED');
  bus.audio('level');
}

/** [WIPE MAP] — clear the field, reopen every arena, drop the boss */
function wipeMap() {
  game.enemies.length = 0;
  game.bolts.length = 0;
  game.fx.length = 0;
  game.pickups.length = 0;
  game.texts.length = 0;
  game.boss = null;
  game.arena = null;
  game.cam.lock = 0;
  for (const a of ARENAS_LIST()) { a.done = false; a.active = false; a.wave = 0; a.clearT = 0; a.bossSpawned = false; }
  player.hp = player.maxHp;
  banner('MAP WIPED', 'ARENAS RESET');
  markDev();
  syncHud();
}
/* ARENAS is owned by world.js; pull it lazily to keep the import list honest */
let ARENAS_LIST = () => [];
export function bindArenas(fn) { ARENAS_LIST = fn; }

/* ------------------------------------------------------------ GO prompt -- */

let goEl = null, goT = 0;
/** the blinking pixel GO -> that appears when a gate dissolves */
function showGo() {
  if (!goEl) {
    goEl = document.getElementById('goPrompt');
    if (!goEl) return;
  }
  goEl.classList.add('on');
  goT = 1.6;
}
export function tickGo(dt) {
  if (goT > 0) {
    goT -= dt;
    if (goT <= 0 && goEl) goEl.classList.remove('on');
  }
}

/* ------------------------------------------------------- data chip cards -- */

const CHIP_POOL = [
  { id: 'vital', title: 'VITAL CORE', blurb: '+1 MAX HP, HEAL TO FULL', tone: 'hp',
    apply() { game.upgrades.hp += 1; player.maxHp = CLS().hp + game.upgrades.hp; player.hp = player.maxHp; } },
  { id: 'edge', title: 'EDGE MATRIX', blurb: '+15% DAMAGE ON EVERY HIT', tone: 'dmg',
    apply() { game.upgrades.power += 1; } },
  { id: 'servo', title: 'SWIFT SERVO', blurb: '+10% RUN + LANE SPEED', tone: 'spd',
    apply() { game.upgrades.speed += 1; } },
  { id: 'coil', title: 'CHARGE COIL', blurb: '+25% ULTIMATE CHARGE', tone: 'ult',
    apply() { game.upgrades.charge += 1; } },
  { id: 'coolant', title: 'COOLANT LOOP', blurb: '-20% ABILITY COOLDOWNS', tone: 'cd',
    apply() { game.upgrades.cdr += 1; } }
];

let cardsOpen = false;
/** Offer three chips after a gate clears. Numbers 1-3 also pick. */
export function openCards() {
  if (cardsOpen) return;
  const root = document.getElementById('cards');
  if (!root) return;
  const picks = [];
  const pool = CHIP_POOL.slice();
  for (let i = 0; i < 3 && pool.length; i++) picks.push(pool.splice(Math.floor(rand(0, pool.length)), 1)[0]);
  game.cards = picks;
  root.innerHTML = '<div class="cardhead">DATA CHIP ACQUIRED</div><div class="chiprow"></div>' +
    '<div class="cardfoot">click or press 1 / 2 / 3</div>';
  const row = root.querySelector('.chiprow');
  picks.forEach((c, i) => {
    const d = document.createElement('button');
    d.className = 'chip ' + c.tone;
    d.dataset.chip = c.id;
    d.innerHTML = '<span class="num">' + (i + 1) + '</span><b>' + c.title + '</b><i>' + c.blurb + '</i>';
    d.addEventListener('click', () => takeCard(i));
    row.appendChild(d);
  });
  root.classList.add('on');
  cardsOpen = true;
  game.paused = true;
  bus.audio('card');
  syncHud();
}

export function takeCard(i) {
  const c = game.cards[i];
  const root = document.getElementById('cards');
  if (root) root.classList.remove('on');
  cardsOpen = false;
  game.paused = false;
  if (!c) return;
  c.apply();
  banner(c.title, c.blurb);
  bus.audio('pick');
  syncHud();
}

export function cardsVisible() { return cardsOpen; }

export {
  addLevel, addNumber, banner, buildDevBar, callout, denySlot, devBoss, devWave, drawCombo,
  drawCrosshair, drawTexts, markDev, resetCds, setClass, showGo, syncHud, toggleDev,
  toggleGod, unlockAll, wipeMap
};
