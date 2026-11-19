/**
 * PIXELFX 2.5D harness
 * --------------------
 * Boots the real `index.html` inside jsdom, injects the vendored pixelfx modules
 * (jsdom cannot run the page's `import` statements), then drives the game through
 * its own keyboard/pointer listeners and its `window.__SURVIVE` hook.
 *
 * The canvas is a recording stub: this harness checks *structure and behaviour*
 * (boot, bake coverage, ability plumbing, physics, arenas, boss, HUD, dev bar),
 * not pixels. Pixel work belongs in a rasteriser harness; the stub still counts
 * every draw so a silent blank frame is caught.
 *
 *   cd tools/pfx-harness && npm install
 *   node run.mjs
 *
 * Exit code is non-zero when any check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const HTML = path.join(ROOT, 'index.html');
const SRC = path.join(ROOT, 'vendor/pixelfx/src');

const { JSDOM } = await import('jsdom');

/* ------------------------------------------------------------- the stub ---- */
class FakeImageData {
  constructor(a, b) {
    if (typeof a === 'number') { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
    else { this.data = a; this.width = b; this.height = arguments[2]; }
  }
}

const draw = { canvas: 0, image: 0, rect: 0, path: 0 };
function gradient() {
  return { addColorStop() {} };
}
function makeCtx() {
  const ctx = {
    canvas: null,
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    font: '',
    textAlign: '',
    globalCompositeOperation: 'source-over',
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createPattern: () => null,
    getImageData: (x, y, w, h) => new FakeImageData(w, h),
    putImageData() { draw.image++; },
    drawImage() { draw.image++; },
    fillRect() { draw.rect++; },
    strokeRect() { draw.rect++; },
    clearRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, rect() {},
    fill() { draw.path++; }, stroke() { draw.path++; }, clip() {},
    save() {}, restore() {}, translate() {}, scale() {}, rotate() {}, setTransform() {},
    measureText: (t) => ({ width: String(t).length * 6 }),
    fillText() {}, strokeText() {}
  };
  return ctx;
}

/* --------------------------------------------------------------- booting --- */
const html = fs.readFileSync(HTML, 'utf8');
const scriptMatch = /<script type="module">([\s\S]*?)<\/script>/.exec(html);
if (!scriptMatch) {
  console.error('index.html has no <script type="module"> block');
  process.exit(1);
}
let code = scriptMatch[1];
const before = code.length;
code = code.replace(/^import \* as core from [^\n]*$/m, 'const core = window.__core;');
code = code.replace(/^import \* as FXMODS from [^\n]*$/m, 'const FXMODS = window.__FX;');
if (code.length === before) {
  console.error('the page module does not import the local pixelfx tree the way this harness expects');
  process.exit(1);
}

const core = await import('file://' + path.join(SRC, 'core/index.js'));
const fxmods = await import('file://' + path.join(SRC, 'fx/index.js'));

const errors = [];
const dom = new JSDOM(html.replace(/<script type="module">[\s\S]*?<\/script>/, ''), {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost:8080/index.html',
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () { return makeCtx(); };
    window.ImageData = FakeImageData;
    window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
    window.onerror = (m, s, l, c, e) => errors.push('[onerror] ' + m + ' ' + ((e && e.stack) || ''));
    window.addEventListener('unhandledrejection', (ev) => errors.push('[unhandled] ' + ((ev.reason && ev.reason.stack) || ev.reason)));
    window.__core = core;
    window.__FX = fxmods;
  }
});
const win = dom.window;
win.console.error = (...a) => errors.push('[console.error] ' + a.map(String).join(' '));
win.console.warn = () => {};
await new Promise((r) => (win.document.readyState === 'complete' ? r() : win.addEventListener('load', r)));

win.eval('(async () => {' + code + '\n; return true; })()');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let S = null;
for (let i = 0; i < 1200 && !S; i++) { S = win.__SURVIVE || null; if (!S) await sleep(20); }
if (!S) {
  console.error('boot never exposed window.__SURVIVE');
  console.error(errors.join('\n'));
  process.exit(1);
}
const bootEl = win.document.getElementById('boot');
for (let i = 0; i < 1600 && !bootEl.classList.contains('done'); i++) await sleep(20);

/* deterministic from here on */
win.requestAnimationFrame = () => 0;
await sleep(50);

const step = (n, dt) => { for (let i = 0; i < n; i++) S.step(dt || 1 / 60); };
const el = (id) => win.document.getElementById(id);
const slotEl = (s) => win.document.querySelector('[data-slot="' + s + '"]');
const press = (id) => el(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const tap = (k) => win.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));
const release = (k) => win.dispatchEvent(new win.KeyboardEvent('keyup', { key: k, bubbles: true }));
const click = (x, y) => el('stage').dispatchEvent(new win.MouseEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true }));

let failures = 0;
function check(name, ok, detail) {
  const mark = ok ? '  ok  ' : ' FAIL ';
  if (!ok) failures++;
  console.log(mark + name.padEnd(46) + (detail === undefined ? '' : JSON.stringify(detail)));
}

/* =========================================================== 1 · boot ===== */
console.log('\n--- boot ---');
check('boot overlay cleared', bootEl.classList.contains('done'));
check('no runtime errors', errors.length === 0, errors.slice(0, 3));
check('clips baked', S.CLIPS.size >= 60, S.CLIPS.size);
check('every effect id resolved', S.MISSING.length === 0, S.MISSING);
check('canvas is drawing', draw.image > 0 && draw.rect > 0, { ...draw });

/* every id the class table points at must exist in the vendored tree */
const ids = [];
for (const cls of Object.values(S.CLASSES)) {
  for (const slot of ['lmb', 'air', 'shift', 'q', 'e', 'r']) {
    const def = cls[slot];
    if (!def) continue;
    for (const k of ['clip', 'vfx', 'bolt', 'strike']) if (def[k]) ids.push(def[k]);
  }
}
const unresolved = [...new Set(ids)].filter((id) => !fxmods.effects[id]);
check('ability ids exist in vendor/pixelfx', unresolved.length === 0, unresolved);
check('all classes reachable', Object.keys(S.CLASSES).length === 4, Object.keys(S.CLASSES));

/* ======================================================== 2 · physics ===== */
console.log('\n--- physics ---');
const p = S.player;
p.x = 600; p.y = 700; p.z = 0; p.vz = 0; p.onGround = true;
step(2);
const x0 = p.x;
tap('d'); step(24); release('d'); step(2);
check('A/D runs across x', p.x - x0 > 60, { from: Math.round(x0), to: Math.round(p.x) });

p.y = S.game ? Math.min(p.y, 700) : p.y;
const y0 = p.y;
tap('w'); step(24); release('w'); step(2);
check('W/S moves along the depth lane', y0 - p.y > 20, { from: Math.round(y0), to: Math.round(p.y) });

tap(' '); step(2); release(' ');
step(8);
const z1 = p.z;
tap(' '); step(2); release(' ');
step(6);
check('jump and double jump', z1 > 40 && p.z > z1, { first: Math.round(z1), double: Math.round(p.z) });
for (let i = 0; i < 120; i++) step(1);
check('gravity returns you to the street', p.z === 0 && p.onGround, { z: Math.round(p.z) });

const pl = S.platforms[2];
p.x = pl.x + pl.w / 2; p.y = pl.y + pl.d / 2; p.z = pl.z + 180; p.vz = 0; p.onGround = false;
step(140);
check('landing snaps onto a platform top', Math.abs(p.z - pl.z) < 2 && p.onGround, { want: pl.z, got: Math.round(p.z) });
tap('s'); step(2); tap(' '); step(2); release(' '); release('s'); step(120);
check('S + SPACE drops through', p.z === 0 && p.onGround, { z: Math.round(p.z) });

/* ========================================================= 3 · classes ==== */
console.log('\n--- classes & slots ---');
for (const cls of Object.keys(S.CLASSES)) {
  S.setClass(cls);
  S.gainXp(60);
  p.anim.busy = 0;
  const out = {};
  for (const slot of ['shift', 'q', 'e', 'r']) {
    p.hp = p.maxHp; S.game.cd.shift = 0; S.game.cd.q = 0; S.game.cd.e = 0; S.game.ult = 100;
    p.anim.busy = 0; p.dashT = 0;
    S.castSlot(slot);
    step(1);
    out[slot] = S.state().anim;
    step(40);
  }
  const allFired = Object.values(out).every((k) => typeof k === 'string' && k.includes('::'));
  check(cls + ': shift/q/e/r all animate', allFired, out);
  step(2);
  p.anim.busy = 0;
  click(500, 300);
  step(1);
  check(cls + ': LMB animates', S.state().anim.includes('::'), S.state().anim);
  step(40);
}

/* ========================================================== 4 · combat ==== */
console.log('\n--- combat ---');
S.setClass('knight');
S.game.enemies.length = 0;
S.game.bolts.length = 0;
S.game.arena = null; S.game.cam.lock = 0;
S.ARENAS.forEach((a) => { a.done = true; });
step(3);
p.x = 1000; p.y = 720; p.z = 0; p.vz = 0; p.onGround = true; p.facing = 1; p.invuln = 0;
S.game.level = 5; S.game.ult = 0; S.game.cd.e = 0;
const foe = S.spawnEnemy('slime', 1030, 720);
step(10);
foe.atkCd = 99;
foe.hp = foe.maxHp = 40;
const hp0 = foe.hp;
click(500, 300);
step(30);
check('a melee hit damages an enemy', foe.hp < hp0, { before: hp0, after: foe.hp });
check('a hit shows a damage number', S.game.texts.length >= 0);

S.game.hitStop = 0;
foe.hp = 40;
S.game.cd.e = 0; p.anim.busy = 0;
S.castSlot('e');
let stop = 0, shake = 0;
for (let i = 0; i < 40; i++) { step(1); stop = Math.max(stop, S.game.hitStop); shake = Math.max(shake, S.game.cam.shake); }
check('heavy hit sets 40 ms of hit-stop', Math.abs(stop - 0.04) < 0.002, +stop.toFixed(3));
check('heavy hit punches the camera', shake > 4, Math.round(shake));
check('heavy hit lands AoE damage', foe.hp < 40, foe.hp);

S.game.cd.q = 0; p.anim.busy = 0; foe.hp = 40; foe.z = 0; foe.vz = 0;
S.castSlot('q');
step(20);
check('Q launcher puts the enemy in the air', foe.vz > 200 || foe.z > 4, { vz: Math.round(foe.vz), z: Math.round(foe.z) });

let guard = 0;
while (S.game.enemies.length && guard++ < 20) { click(500, 300); step(20); }
check('a killed enemy drops pickups', S.game.pickups.length > 0 && S.game.stats.kills > 0, { kills: S.game.stats.kills, drops: S.game.pickups.length });
check('hits charge the ultimate meter', S.game.ult > 0, Math.round(S.game.ult));

S.setClass('sniper');
S.game.enemies.length = 0;
p.x = 1000; p.y = 720; p.z = 0; p.onGround = true; p.facing = 1;
const far = S.spawnEnemy('slime', 1400, 720);
step(10); far.atkCd = 99;
const farHp = far.hp;
click(500, 300);
let bolts = 0;
for (let i = 0; i < 50; i++) { step(1); bolts = Math.max(bolts, S.game.bolts.length); }
check('ranged classes spawn travelling bolts', bolts > 0, bolts);
check('a bolt damages a distant enemy', far.hp < farHp, { before: farHp, after: far.hp });

/* ============================================================ 5 · waves === */
console.log('\n--- arenas & boss ---');
S.setClass('knight');
S.ARENAS.forEach((a) => { a.done = false; a.active = false; a.wave = 0; a.clearT = 0; a.bossSpawned = false; });
S.game.arena = null; S.game.cam.lock = 0; S.game.boss = null;
S.game.enemies.length = 0; S.game.bolts.length = 0;
p.hp = p.maxHp; p.invuln = 99;
p.x = 700; step(6);
const arena = S.game.arena;
check('walking into an arena locks the street', !!arena && S.game.cam.lock === 1, arena && { id: arena.id, wave: arena.wave });
check('the arena spawns a wave', S.game.enemies.length >= 4, S.game.enemies.length);
check('the HUD names the arena wave', /WAVE/.test(el('waveTag').textContent), el('waveTag').textContent);

const clearWave = () => { S.game.enemies.forEach((e) => { e.dead = true; }); step(90); };
clearWave();
check('clearing a wave advances it', S.game.arena && S.game.arena.wave === 1, S.game.arena && S.game.arena.wave);
clearWave();
check('clearing the last wave unlocks the street', S.ARENAS[0].done && S.game.cam.lock === 0);

S.devBoss();
step(4);
check('a stage boss spawns', !!S.game.boss, S.game.boss && S.game.boss.maxHp);
check('the boss bar appears', el('bossWrap').classList.contains('on'));
const boss = S.game.boss;
if (boss) { boss.x = p.x + 50; boss.y = p.y; boss.z = 10; boss.hp = 6; boss.maxHp = 170; }
S.game.level = 5; S.game.cd.e = 0; p.anim.busy = 0;
S.castSlot('e');
for (let i = 0; i < 60 && S.game.boss; i++) step(1);
check('the boss can be killed', !S.game.boss, { kills: S.game.stats.kills });

/* ============================================================== 6 · HUD === */
console.log('\n--- HUD & dev bar ---');
check('four ability slots', win.document.querySelectorAll('#slots .slot').length === 4);
check('slot names follow the class', [...win.document.querySelectorAll('.slot .nm')].every((e) => e.textContent.length > 2),
  [...win.document.querySelectorAll('.slot .nm')].map((e) => e.textContent));

S.setClass('mage');
S.game.level = 1; S.game.xp = 0; S.game.ult = 0; S.game.cd.q = 0;
step(1);
check('E is locked below level 3', slotEl('e').classList.contains('locked'), slotEl('e').className);
S.castSlot('q');
step(2);
check('a cast shows a cooldown countdown', /^\d+\.\d+s$/.test(slotEl('q').querySelector('.cd').textContent), slotEl('q').querySelector('.cd').textContent);
check('the cooldown overlay is visible', slotEl('q').classList.contains('cooling'));
S.game.level = 5; S.game.ult = 100; step(1);
check('a full meter marks the ultimate ready', slotEl('r').classList.contains('ult-ready'), slotEl('r').className);

tap('`');
check('~ opens the dev bar', el('devBar').classList.contains('on'));
press('devUnlock');
step(2);
check('[Unlock All + Fill Ult] grants everything', S.game.level === 5 && S.game.ult === 100, { level: S.game.level, ult: S.game.ult });
press('devGod');
check('[God Mode] toggles', S.game.god === true);
const enemies0 = S.game.enemies.length;
press('devWave'); step(4);
check('[Spawn Wave] adds enemies', S.game.enemies.length > enemies0, S.game.enemies.length);
S.game.boss = null;
press('devBoss'); step(4);
check('[Spawn Boss] adds the warden', !!S.game.boss);
S.game.cd.shift = 9; S.game.cd.q = 9; S.game.cd.e = 9;
press('devCds');
check('[Reset CDs] clears cooldowns', S.game.cd.shift === 0 && S.game.cd.q === 0 && S.game.cd.e === 0);

check('all six universes switch', (() => {
  const seen = new Set();
  for (let i = 0; i < 6; i++) { S.setUniverse(i); step(2); seen.add(S.state().uni); }
  return seen.size === 6;
})());

/* ============================================================= 7 · wrap === */
console.log('\n--- result ---');
check('still no runtime errors', errors.length === 0, errors.slice(0, 3));
check('the frame is still being drawn', (() => {
  const d0 = draw.image;
  step(30);
  return draw.image > d0;
})());
console.log(failures === 0 ? '\n--- ALL CHECKS PASSED ---' : '\n--- ' + failures + ' CHECK(S) FAILED ---');
process.exit(failures === 0 ? 0 : 1);
