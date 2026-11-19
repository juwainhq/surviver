/* ui.js — the retro skin and the screen machine.
 *
 * Two jobs:
 *   1. the DOM HUD — HP crests, class/level/XP, the four-slot bar with its real
 *      pixelfx thumbnails, countdowns and the ultimate meter;
 *   2. the screens — `game.screen` ∈ boot | title | classSelect | playing |
 *      paused | cards | gameover | victory, with the menus that drive them.
 *
 * The menus live over the live canvas on purpose: the title screen is the stage
 * itself (parallax, torches, weather), not a poster. Nothing here draws the
 * world — main.js owns the frame loop and ui.js only reacts to state.
 */
import {
  FLOOR_H, FLOOR_TOP, H, MAX_LEVEL, STAGE_W, W, XP_STEPS, bus, clamp, ctx, depthScale,
  game, input, keys, rand
} from './core.js';
import { ACTION_KEY, CLIPS, PALETTES, bake, blitClip, drawClip, textClip } from './pfx.js';
import { UNIVERSES, setUniverse, uni, universeIndex } from './world.js';
import { spawnEnemy, spawnWave } from './enemies.js';
import { CLASSES, CLASS_IDS, CLS, lockedSlots, player, resetPlayer } from './classes.js';

const $ = (id) => document.getElementById(id);
const SLOT_IDS = ['shift', 'q', 'e', 'r'];

function addNumber(x, y, z, text, crit) {
  game.texts.push({ x, y, z, text, crit: !!crit, t: 0, life: 0.9, vx: rand(-18, 18) });
  if (game.texts.length > 40) game.texts.shift();
}

/* floating callouts are DOM: always crisp, never a canvas primitive */
const floatsEl = () => $('floats');
function callout(text, kind) {
  const host = floatsEl();
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'float ' + (kind || '');
  el.textContent = text;
  const px = Math.round((player.x - game.cam.x));
  const py = Math.round((player.y - player.z * depthScale(player.y) - game.cam.y - 96));
  el.style.left = clamp(px, 40, W - 40) + 'px';
  el.style.top = clamp(py, 60, H - 120) + 'px';
  host.appendChild(el);
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
  bus.audio('deny');
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

/* ------------------------------------------------------------- crosshair -- */
function drawCrosshair() {
  if (game.screen !== 'playing') return;
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
  if (n < 3 || game.screen !== 'playing') return;
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
  className: $('className'),
  hpRow: $('hpRow'),
  lvText: $('lvText'),
  xpFill: $('xpFill'),
  waveTag: $('waveTag'),
  bossWrap: $('bossWrap'),
  bossName: $('bossName'),
  bossFill: $('bossFill'),
  ultFill: $('ultFill'),
  banner: $('banner'),
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
  if (!el) return;
  el.innerHTML = text + (sub ? '<small>' + sub + '</small>' : '');
  el.classList.add('on');
  game.banner.t = 1.9;
  clearTimeout(banner._t);
  banner._t = setTimeout(() => el.classList.remove('on'), 1750);
}

/* ---------------------------------------------- slot thumbnails (pixelfx) */
/** blit the mid-frame of each slot's baked VFX clip into its HUD canvas */
function paintSlotIcons() {
  const c = CLS();
  for (const s of SLOT_IDS) {
    const el = HUD.slots[s];
    if (!el) continue;
    const cv = el.querySelector('canvas.thumb');
    if (!cv || !cv.getContext) continue;
    const c2d = cv.getContext('2d');
    if (!c2d) continue;
    const def = c[s];
    if (!def) continue;
    const id = def.vfx || def.bolt || def.clip;
    let key = 'fx:' + id;
    if (!CLIPS.has(key)) key = 'act:' + game.classId + ':' + s;
    if (!CLIPS.has(key)) key = 'act:' + game.classId + ':idle';
    blitClip(c2d, key, cv.width, cv.height, 0, { phase: 0.5, middle: true, zoom: 0.94 });
  }
}

let hudHp = -1, hudClass = '', hudLevel = -1;

function syncHud() {
  const c = CLS();
  if (game.screen === 'playing') document.documentElement.style.setProperty('--accent', c.accent);

  if (hudClass !== game.classId) {
    hudClass = game.classId;
    if (HUD.className) {
      HUD.className.textContent = c.name;
      HUD.className.style.color = c.accent;
    }
    for (const s of SLOT_IDS) {
      const def = c[s];
      const el = HUD.slots[s];
      if (!def || !el) continue;
      el.querySelector('.nm').textContent = def.name;
      el.querySelector('.lv').textContent = 'LV' + def.level;
    }
    paintSlotIcons();
  }
  if (HUD.hpRow && hudHp !== player.maxHp) {
    hudHp = player.maxHp;
    HUD.hpRow.innerHTML = '';
    for (let i = 0; i < player.maxHp; i++) {
      const d = document.createElement('div');
      d.className = 'pip';
      HUD.hpRow.appendChild(d);
    }
  }
  const pips = HUD.hpRow ? HUD.hpRow.children : [];
  for (let i = 0; i < pips.length; i++) pips[i].className = 'pip' + (i < player.hp ? ' on' : '');
  if (hudLevel !== game.level) {
    hudLevel = game.level;
    if (HUD.lvText) HUD.lvText.textContent = 'LV ' + game.level;
  }
  const lo = XP_STEPS[Math.max(0, game.level - 1)] || 0;
  const hi = XP_STEPS[Math.min(XP_STEPS.length - 1, game.level)] || lo + 1;
  const pct = game.level >= MAX_LEVEL ? 1 : clamp((game.xp - lo) / Math.max(1, hi - lo), 0, 1);
  if (HUD.xpFill) HUD.xpFill.style.width = Math.round(pct * 100) + '%';

  for (const s of SLOT_IDS) {
    const def = c[s];
    const el = HUD.slots[s];
    if (!def || !el) continue;
    const locked = def.level > game.level;
    const cd = game.cd[s] || 0;
    const cooling = cd > 0.05;
    el.classList.toggle('locked', locked);
    el.classList.toggle('cooling', !locked && cooling);
    const cdEl = el.querySelector('.cd');
    if (locked) cdEl.textContent = 'LV ' + def.level;
    else if (cooling) cdEl.textContent = cd.toFixed(1) + 's';
    else cdEl.textContent = '';
    if (s === 'r') {
      const ready = !locked && game.ult >= 100;
      el.classList.toggle('ult-ready', ready);
      if (HUD.ultFill) HUD.ultFill.style.width = (locked ? 0 : Math.round(game.ult)) + '%';
      if (!locked && !ready) cdEl.textContent = Math.round(game.ult) + '%';
    } else {
      el.classList.toggle('ready', !locked && !cooling);
    }
  }

  const a = game.arena;
  if (HUD.waveTag) {
    if (a) {
      HUD.waveTag.classList.add('on');
      HUD.waveTag.innerHTML = a.label + ' · <b>WAVE ' + Math.min(a.waves, a.wave + 1) + ' / ' + a.waves + '</b>';
    } else if (game.enemies.length > 0) {
      HUD.waveTag.classList.add('on');
      HUD.waveTag.innerHTML = '<b>' + game.enemies.length + '</b> HOSTILE' + (game.enemies.length > 1 ? 'S' : '') + ' IN THE STREET';
    } else {
      HUD.waveTag.classList.remove('on');
    }
  }

  const boss = game.boss;
  if (HUD.bossWrap) {
    if (boss && !boss.dead) {
      HUD.bossWrap.classList.add('on');
      if (HUD.bossFill) HUD.bossFill.style.width = Math.max(0, (boss.hp / boss.maxHp) * 100) + '%';
    } else {
      HUD.bossWrap.classList.remove('on');
    }
  }
}

/* ====================================================== 14 · SCREEN MACHINE */

const SCREEN_IDS = {
  title: 'screen-title',
  classSelect: 'screen-class',
  paused: 'screen-pause',
  gameover: 'screen-over',
  victory: 'screen-win'
};

const els = {};
function screenEl(name) {
  if (!(name in els)) els[name] = $(SCREEN_IDS[name]);
  return els[name];
}

function paintAccent(hex) {
  document.documentElement.style.setProperty('--accent', hex);
}

/** the single entry point for every flow transition */
export function setScreen(name) {
  game.screen = name;
  game.paused = name !== 'playing' && name !== 'boot';
  document.body.dataset.screen = name;
  for (const k of Object.keys(SCREEN_IDS)) {
    const el = screenEl(k);
    if (el) el.classList.toggle('on', k === name);
  }
  const ctl = $('screen-controls');
  if (ctl && name !== 'classSelect') ctl.classList.remove('on');

  if (name !== 'playing') {
    for (const k in keys) keys[k] = false;
    input.jumpBuf = 0;
    input.jumpHeld = false;
    game.mouse.down = false;
    const go = $('goPrompt');
    if (go) go.classList.remove('on');
  }
  if (name === 'title') refreshTitle();
  if (name === 'classSelect') buildClassSelect();
  if (name === 'gameover') fillGameOver();
  if (name === 'victory') fillVictory();
  syncHud();
}
export function closeControls() {
  const ctl = $('screen-controls');
  if (ctl) ctl.classList.remove('on');
}
export function controlsVisible() {
  const ctl = $('screen-controls');
  return !!ctl && ctl.classList.contains('on');
}

/* ------------------------------------------------------------ stage start */
function clearField() {
  game.enemies.length = 0;
  game.bolts.length = 0;
  game.fx.length = 0;
  game.pickups.length = 0;
  game.texts.length = 0;
  game.cards = [];
  game.boss = null;
  game.arena = null;
  game.cam.lock = 0;
  game.hitStop = 0;
  game.barrage = null;
  game.deathT = 0;
  game.victoryT = 0;
  player.slamPend = null;
  for (const a of ARENAS_LIST()) { a.done = false; a.active = false; a.wave = 0; a.clearT = 0; a.bossSpawned = false; }
}

/** [PLAY] / [RETRY] / [RESTART STAGE] — one clean run, from the first gate */
export function startStage() {
  clearField();
  game.upgrades = { hp: 0, power: 0, speed: 0, charge: 0, cdr: 0 };
  game.level = 1;
  game.xp = 0;
  game.ult = 0;
  game.rageT = 0;
  game.cd.shift = 0; game.cd.q = 0; game.cd.e = 0; game.cd.r = 0;
  game.stats = { hits: 0, kills: 0, casts: 0, maxCombo: 0, combo: 0, comboT: 0 };
  game.run = { kills: 0, maxCombo: 0, level: 1, started: game.time, universe: universeIndex, deaths: 0 };
  resetPlayer();
  player.invuln = 0;
  player.dead = false;
  hudClass = '';
  hudHp = -1;
  setScreen('playing');
  spawnWave(3, ['slime', 'frog'], 380);
  banner('SURVIVE', 'HEAD RIGHT · HOLD THE STREET');
  syncHud();
}

export function pauseGame() {
  if (game.screen !== 'playing') return;
  game.prevScreen = 'playing';
  setScreen('paused');
}
export function resumeGame() {
  if (game.screen === 'paused') setScreen('playing');
}

/** death → the run summary; never a silent respawn */
export function showGameOver() {
  game.run.kills = Math.max(game.run.kills, game.stats.kills);
  game.run.maxCombo = Math.max(game.run.maxCombo, game.stats.maxCombo);
  game.run.level = game.level;
  game.run.best = Math.max(game.run.best || 0, game.run.kills);
  setScreen('gameover');
  bus.audio('die');
}
export function showVictory() {
  game.run.kills = Math.max(game.run.kills, game.stats.kills);
  game.run.maxCombo = Math.max(game.run.maxCombo, game.stats.maxCombo);
  game.run.level = game.level;
  game.run.victories = (game.run.victories || 0) + 1;
  game.run.best = Math.max(game.run.best || 0, game.run.kills);
  setScreen('victory');
  bus.audio('level');
}

/* ----------------------------------------------------------------- title -- */
export function refreshTitle() {
  const u = uni();
  const nameEl = $('titleUni');
  if (nameEl) nameEl.innerHTML = 'UNIVERSE <b>' + (universeIndex + 1) + '</b> · ' + u.name;
  paintAccent(u.accent);
  const best = $('titleBest');
  if (best) best.textContent = 'BEST · ' + Math.max(game.run.best || 0, game.stats.kills) + ' KILLS';
}

/* ---------------------------------------------------------- class select -- */
let pickClass = 'knight';
let previewClip = null, previewT = 0, previewDur = 0;
const csCanvas = () => $('csPreview');

function paintPreview() {
  const cv = csCanvas();
  if (!cv || !cv.getContext) return;
  const c2d = cv.getContext('2d');
  if (!c2d) return;
  const idle = 'act:' + pickClass + ':idle';
  const key = previewClip || idle;
  const t = previewClip ? Math.min(previewDur, previewT) : game.time;
  blitClip(c2d, CLIPS.has(key) ? key : idle, cv.width, cv.height, t, { zoom: 1.02, pad: 4 });
}

export function buildClassSelect() {
  const grid = $('csGrid');
  if (grid) {
    grid.innerHTML = '';
    for (const id of CLASS_IDS) {
      const c = CLASSES[id];
      const b = document.createElement('button');
      b.className = 'cscard' + (id === pickClass ? ' on' : '');
      b.dataset.pick = id;
      b.innerHTML = '<b>' + c.short + '</b><i>' + c.hp + ' HP</i>';
      b.style.setProperty('--card', c.accent);
      b.addEventListener('click', () => selectClass(id));
      grid.appendChild(b);
    }
  }
  const unis = $('csUnis');
  if (unis) {
    unis.innerHTML = '';
    UNIVERSES.forEach((u, i) => {
      const b = document.createElement('button');
      b.className = 'uni' + (i === universeIndex ? ' on' : '');
      b.dataset.uni = String(i);
      b.textContent = String(i + 1);
      b.title = u.name;
      b.style.setProperty('--card', u.accent);
      b.addEventListener('click', () => { setUniverse(i); buildClassSelect(); });
      unis.appendChild(b);
    });
  }
  fillClassInfo();
  previewClip = null;
  paintPreview();
}

/** clicking a card (or the preview) plays a live attack clip in the frame */
function selectClass(id) {
  if (!CLASSES[id]) return;
  pickClass = id;
  const grid = $('csGrid');
  if (grid) {
    for (const b of grid.querySelectorAll('[data-pick]')) b.classList.toggle('on', b.dataset.pick === id);
  }
  previewClip = (ACTION_KEY[id] && ACTION_KEY[id].lmb) || null;
  previewT = 0;
  previewDur = (CLASSES[id].lmb && CLASSES[id].lmb.dur) || 0.4;
  fillClassInfo();
  paintPreview();
  bus.audio('lmb');
}

function fillClassInfo() {
  const c = CLASSES[pickClass];
  paintAccent(c.accent);
  const nameEl = $('csName');
  if (nameEl) { nameEl.textContent = c.name; nameEl.style.color = c.accent; }
  const hpEl = $('csHp');
  if (hpEl) {
    hpEl.innerHTML = '';
    for (let i = 0; i < c.hp; i++) {
      const d = document.createElement('i');
      d.className = 'pip on';
      hpEl.appendChild(d);
    }
  }
  const styleEl = $('csStyle');
  if (styleEl) styleEl.textContent = STYLE_LINE[pickClass] || '';
  const ab = $('csAbil');
  if (ab) {
    const row = (k, name, extra, locked) =>
      '<div class="row' + (locked ? ' lock' : '') + '"><span class="k">' + k + '</span><span class="n">' + name +
      '</span><span class="x">' + extra + '</span></div>';
    ab.innerHTML =
      row('LMB', c.lmb.name, 'GROUND') +
      row('AIR', c.air.name, 'AIRBORNE') +
      row('SHIFT', c.shift.name, 'CD ' + (c.shift.cd || 0) + 's') +
      row('Q', c.q.name, 'CD ' + (c.q.cd || 0) + 's') +
      row('E', c.e.name, 'LV 3 · CD ' + (c.e.cd || 0) + 's', true) +
      row('R', c.r.name, 'LV 5 · ULT', true);
  }
}

const STYLE_LINE = {
  knight: 'SWORD + SHIELD · BALANCED FRONTLINE',
  gunslinger: 'DUAL PISTOLS · RANGE + RECOIL',
  mage: 'ARCANE CASTER · CROWD + TIME',
  sniper: 'RIFT BOW · PRECISION RAIL',
  berserker: 'GREATSWORD · HEAVY + UNSTOPPABLE',
  assassin: 'TWIN DAGGERS · MARKS + BURSTS',
  tech: 'LAUNCHER + DISC · ZONE CONTROL'
};

export function tickMenus(dt) {
  if (game.screen !== 'classSelect') return;
  if (previewClip) {
    previewT += dt;
    if (previewT >= previewDur + 0.25) previewClip = null;
  }
  paintPreview();
}

/* --------------------------------------------------------------- pause -- */
function fillGameOver() {
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  set('overKills', String(Math.max(game.run.kills, game.stats.kills)));
  set('overCombo', String(Math.max(game.run.maxCombo, game.stats.maxCombo)));
  set('overLevel', String(game.level));
  set('overClass', CLS().name);
}
function fillVictory() {
  const set = (id, v) => { const e = $(id); if (e) e.textContent = v; };
  set('winKills', String(Math.max(game.run.kills, game.stats.kills)));
  set('winCombo', String(Math.max(game.run.maxCombo, game.stats.maxCombo)));
  set('winLevel', String(game.level));
  set('winUni', uni().name);
  const btn = $('winNext');
  if (btn) btn.textContent = 'NEXT UNIVERSE → ' + UNIVERSES[(universeIndex + 1) % UNIVERSES.length].name;
}

/* ------------------------------------------------------------- menu glue -- */
function deploy() {
  setClass(pickClass);
  startStage();
}
function nextUniverse() {
  setUniverse((universeIndex + 1) % UNIVERSES.length);
  startStage();
}
function toggleControls() {
  const ctl = $('screen-controls');
  if (ctl) ctl.classList.toggle('on');
}

function bindMenus() {
  document.addEventListener('click', (e) => {
    const t = e.target && e.target.closest ? e.target.closest('[data-act],[data-pick],[data-uni]') : null;
    if (!t) return;
    if (t.dataset.pick) { selectClass(t.dataset.pick); return; }
    if (t.dataset.uni != null) { setUniverse(+t.dataset.uni); buildClassSelect(); refreshTitle(); return; }
    switch (t.dataset.act) {
      case 'play': startStage(); break;
      case 'class': setScreen('classSelect'); break;
      case 'universe': setUniverse((universeIndex + 1) % UNIVERSES.length); refreshTitle(); break;
      case 'controls': toggleControls(); break;
      case 'deploy': deploy(); break;
      case 'resume': resumeGame(); break;
      case 'changeClass': setScreen('classSelect'); break;
      case 'restart': startStage(); break;
      case 'menu': setScreen('title'); break;
      case 'retry': startStage(); break;
      case 'nextUni': nextUniverse(); break;
      case 'again': startStage(); break;
      case 'closeControls': closeControls(); break;
      case 'back': setScreen('title'); break;
      default: break;
    }
    bus.audio('pick');
  });
  const cv = csCanvas();
  if (cv) cv.addEventListener('click', () => {
    previewClip = (ACTION_KEY[pickClass] && ACTION_KEY[pickClass].lmb) || null;
    previewT = 0;
    previewDur = (CLASSES[pickClass].lmb && CLASSES[pickClass].lmb.dur) || 0.4;
  });
}

/* ================================================================ 15 · DEV */
let devOpen = false;
function toggleDev(force) {
  devOpen = force != null ? force : !devOpen;
  const bar = $('devBar');
  const tog = $('devToggle');
  if (bar) bar.classList.toggle('on', devOpen);
  if (tog) tog.classList.toggle('on', devOpen);
}
function devOpenState() { return devOpen; }

function setClass(id) {
  if (!CLASSES[id]) return;
  game.classId = id;
  resetPlayer();
  pickClass = id;
  game.cd.shift = 0; game.cd.q = 0; game.cd.e = 0;
  hudClass = '';
  hudHp = -1;
  paintAccent(CLASSES[id].accent);
  banner(CLASSES[id].name, 'CLASS SWITCH');
  markDev();
  syncHud();
}

function unlockAll() {
  game.level = MAX_LEVEL;
  game.xp = XP_STEPS[MAX_LEVEL - 1];
  game.ult = 100;
  game.cd.shift = 0; game.cd.q = 0; game.cd.e = 0; game.cd.r = 0;
  player.maxHp = CLS().hp + game.upgrades.hp;
  player.hp = player.maxHp;
  banner('EVERYTHING UNLOCKED', 'ULTIMATE CHARGED');
  callout('ULTIMATE READY', 'gold');
  bus.audio('level');
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
  const god = $('devGod');
  if (god) god.classList.toggle('on', game.god);
}

function buildDevBar() {
  const dc = $('devClasses');
  if (dc) {
    for (const id of CLASS_IDS) {
      const b = document.createElement('button');
      b.className = 'db';
      b.dataset.devClass = id;
      b.textContent = CLASSES[id].short;
      b.addEventListener('click', () => setClass(id));
      dc.appendChild(b);
    }
  }
  const du = $('devUnis');
  if (du) {
    UNIVERSES.forEach((u, i) => {
      const b = document.createElement('button');
      b.className = 'db mini';
      b.dataset.devUni = String(i);
      b.textContent = String(i + 1);
      b.title = u.name;
      b.addEventListener('click', () => { setUniverse(i); markDev(); });
      du.appendChild(b);
    });
  }
  const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
  on('devToggle', () => toggleDev());
  on('devUnlock', unlockAll);
  on('devGod', toggleGod);
  on('devWave', devWave);
  on('devBoss', devBoss);
  on('devCds', resetCds);
  on('devLevel', addLevel);
  on('devWipe', wipeMap);
  bindMenus();
}

/* --------------------------------------------------------------- boot UI -- */

/** the seven class chips on the title overlay, also a quick pick */
export function buildBootClasses() {
  const root = $('bootClasses');
  if (!root) return;
  root.innerHTML = '';
  for (const id of CLASS_IDS) {
    const b = document.createElement('button');
    b.className = 'bc' + (id === game.classId ? ' on' : '');
    b.dataset.bootClass = id;
    b.textContent = CLASSES[id].short;
    b.style.setProperty('--card', CLASSES[id].accent);
    b.addEventListener('click', () => { setClass(id); buildBootClasses(); refreshTitle(); });
    root.appendChild(b);
  }
}

/* -------------------------------------------------------------- dev extras */

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
function showGo() {
  if (!goEl) {
    goEl = $('goPrompt');
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
  const root = $('cards');
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
  game.screen = 'cards';
  game.paused = true;
  document.body.dataset.screen = 'cards';
  bus.audio('card');
  syncHud();
}

export function takeCard(i) {
  const c = game.cards[i];
  const root = $('cards');
  if (root) root.classList.remove('on');
  cardsOpen = false;
  if (!c) { setScreen('playing'); return; }
  c.apply();
  banner(c.title, c.blurb);
  bus.audio('pick');
  setScreen('playing');
  syncHud();
}

export function cardsVisible() { return cardsOpen; }

export {
  addLevel, addNumber, banner, buildDevBar, callout, denySlot, devBoss, devOpenState, devWave,
  drawCombo, drawCrosshair, drawTexts, markDev, resetCds, setClass, showGo, syncHud, toggleDev,
  toggleGod, unlockAll, wipeMap
};
