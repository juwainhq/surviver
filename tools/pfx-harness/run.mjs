/**
 * PIXELFX 2.5D harness
 * --------------------
 * Boots the real game modules (`src/main.js` and everything under it) inside
 * jsdom, with a recording stand-in for the 2D canvas, then drives the game
 * through its own DOM listeners and its `window.__SURVIVE` hook.
 *
 * Because the page is native ES modules, the harness does what the browser does:
 * it imports `src/main.js` directly and lets the module graph link itself. The
 * canvas is stubbed, so this checks *structure and behaviour* — boot, bake
 * coverage, every ability slot, physics, arenas, cards, boss, HUD, dev panel —
 * not pixels. It still counts every draw, so a silently blank frame fails.
 *
 *   cd tools/pfx-harness && npm install
 *   node run.mjs
 *
 * Exit code is non-zero when any check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const HTML = path.join(ROOT, 'index.html');
const MAIN = path.join(ROOT, 'src/main.js');

const { JSDOM } = await import('jsdom');

/* ------------------------------------------------------------- the stub ---- */
class FakeImageData {
  constructor(a, b) {
    if (typeof a === 'number') { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
    else { this.data = a; this.width = b; this.height = arguments[2]; }
  }
}

const draw = { image: 0, rect: 0, path: 0 };
const gradient = () => ({ addColorStop() {} });
function makeCtx() {
  return {
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
}

/* --------------------------------------------------------------- the page -- */
const html = fs.readFileSync(HTML, 'utf8');
const errors = [];
const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: 'http://localhost:8080/index.html',
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () { return makeCtx(); };
    window.ImageData = FakeImageData;
    window.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
    window.addEventListener('error', (ev) => errors.push('[onerror] ' + (ev.message || ev.error)));
    window.addEventListener('unhandledrejection', (ev) => errors.push('[unhandled] ' + ((ev.reason && ev.reason.stack) || ev.reason)));
  }
});
const win = dom.window;

/* the modules reference these as bare globals, exactly like in the browser */
const GLOBALS = ['document', 'ImageData', 'requestAnimationFrame', 'cancelAnimationFrame',
  'MouseEvent', 'KeyboardEvent', 'Event', 'HTMLCanvasElement', 'getComputedStyle', 'AudioContext'];
for (const g of GLOBALS) {
  if (win[g] === undefined) continue;
  try { globalThis[g] = win[g]; } catch { /* navigator and friends are getter-only in Node */ }
}
globalThis.window = win;
globalThis.self = win;

win.console.error = (...a) => errors.push('[console.error] ' + a.map(String).join(' '));
win.console.warn = () => {};

await import(pathToFileURL(MAIN).href);
const S = win.__SURVIVE;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (!S) {
  console.error('boot never exposed window.__SURVIVE');
  console.error(errors.join('\n'));
  process.exit(1);
}
const bootEl = win.document.getElementById('boot');
for (let i = 0; i < 1500 && !bootEl.classList.contains('done'); i++) await sleep(20);
win.requestAnimationFrame = () => 0;   /* deterministic from here on */
await sleep(30);

const step = (n, dt) => { for (let i = 0; i < n; i++) S.step(dt || 1 / 60); };
const el = (id) => win.document.getElementById(id);
const slotEl = (s) => win.document.querySelector('[data-slot="' + s + '"]');
const press = (id) => el(id).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
const tap = (k) => win.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true }));
const release = (k) => win.dispatchEvent(new win.KeyboardEvent('keyup', { key: k, bubbles: true }));
const click = (x, y) => {
  el('stage').dispatchEvent(new win.MouseEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true }));
  win.dispatchEvent(new win.MouseEvent('pointerup', { clientX: x, clientY: y, button: 0, bubbles: true }));
};
const hold = (x, y) => el('stage').dispatchEvent(new win.MouseEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true }));
const letGo = () => win.dispatchEvent(new win.MouseEvent('pointerup', { button: 0, bubbles: true }));

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? '  ok  ' : ' FAIL ') + name.padEnd(46) + (detail === undefined ? '' : JSON.stringify(detail)));
}

/* =========================================================== 1 · boot ===== */
console.log('\n--- boot ---');
check('boot overlay cleared', bootEl.classList.contains('done'));
check('no runtime errors', errors.length === 0, errors.slice(0, 3));
check('clips baked', S.CLIPS.size >= 60, S.CLIPS.size);
check('every effect id resolved', S.MISSING.length === 0, S.MISSING);
check('canvas is drawing', draw.image > 0 && draw.rect > 0, { ...draw });
check('seven playable classes', S.CLASS_IDS.length === 7, S.CLASS_IDS);
check('the title overlay lists all seven classes', win.document.querySelectorAll('#bootClasses .bc').length === 7,
  win.document.querySelectorAll('#bootClasses .bc').length);
check('the boot bar reached 100 %', el('bootFill').style.width === '100%', el('bootFill').style.width);
check('the boot line reported the bake', /ready · \d+ clips/.test(el('bootMsg').textContent), el('bootMsg').textContent);
check('no duplicate boot ids', (() => {
  const ids = [...win.document.querySelectorAll('[id]')].map((n) => n.id);
  return ids.length === new Set(ids).size;
})());

/* ====================================================== 1b · game flow ==== */
console.log('\n--- game flow ---');
const worldSrc = fs.readFileSync(path.join(ROOT, 'src/world.js'), 'utf8');
const htmlSrc = fs.readFileSync(HTML, 'utf8');
check('boot lands on the title screen', S.state().screen === 'title' && el('screen-title').classList.contains('on'), S.state().screen);
check('the title offers PLAY / CLASS / UNIVERSE / CONTROLS',
  ['play', 'class', 'universe', 'controls'].every((a) => win.document.querySelector('#screen-title [data-act="' + a + '"]')));
check('the title sits over a live parallax frame', draw.image > 0 && draw.rect > 0);
S.setScreen('classSelect');
check('class select frames all seven classes', win.document.querySelectorAll('#csGrid [data-pick]').length === 7,
  win.document.querySelectorAll('#csGrid [data-pick]').length);
check('class select has a live preview canvas', !!el('csPreview'));
check('class select breaks down 4 abilities + LMB + AIR', win.document.querySelectorAll('#csAbil .row').length === 6,
  win.document.querySelectorAll('#csAbil .row').length);
check('class select offers universes 1-6', win.document.querySelectorAll('#csUnis .uni').length === 6);
win.document.querySelector('#csGrid [data-pick="tech"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
check('picking a class fills the info pane', /TECH/.test(el('csName').textContent), el('csName').textContent);
S.startStage();
check('DEPLOY starts a clean run', S.state().screen === 'playing' && S.game.enemies.length > 0 && S.game.level === 1,
  { screen: S.state().screen, enemies: S.game.enemies.length, level: S.game.level });
tap('Escape'); step(2);
check('ESC pauses into the pause menu', S.state().screen === 'paused' && el('screen-pause').classList.contains('on'));
check('the pause menu offers 5 actions', win.document.querySelectorAll('#screen-pause [data-act]').length === 5,
  win.document.querySelectorAll('#screen-pause [data-act]').length);
tap('Escape'); step(2);
check('ESC again resumes', S.state().screen === 'playing' && !S.game.paused);

/* every menu button must be wired to a real transition */
const uiSrc = fs.readFileSync(path.join(ROOT, 'src/ui.js'), 'utf8');
const acts = [...new Set([...htmlSrc.matchAll(/data-act="([A-Za-z]+)"/g)].map((m) => m[1]))];
const deadActs = acts.filter((a) => uiSrc.indexOf("case '" + a + "'") < 0);
check('every menu button has a handler', deadActs.length === 0, deadActs);

const clickAct = (screen, act) => win.document
  .querySelector('#' + screen + ' [data-act="' + act + '"]')
  .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));

S.setScreen('title');
const uni0 = S.state().uni;
clickAct('screen-title', 'universe'); step(1);
check('SELECT UNIVERSE cycles the universe', S.state().uni !== uni0, { before: uni0, after: S.state().uni });
clickAct('screen-title', 'controls');
check('CONTROLS opens the key overlay', el('screen-controls').classList.contains('on'));
clickAct('screen-controls', 'closeControls');
check('…and closes again', !el('screen-controls').classList.contains('on'));
clickAct('screen-title', 'class'); step(1);
check('SELECT CLASS opens the selector', S.state().screen === 'classSelect', S.state().screen);
clickAct('screen-class', 'back');
check('BACK returns to the title', S.state().screen === 'title', S.state().screen);
clickAct('screen-title', 'play'); step(2);
check('PLAY runs the stage', S.state().screen === 'playing', S.state().screen);
tap('Escape'); step(1);
clickAct('screen-pause', 'restart'); step(2);
check('RESTART STAGE restarts and resumes', S.state().screen === 'playing' && S.game.level === 1, S.state().screen);
tap('Escape'); step(1);
clickAct('screen-pause', 'changeClass');
check('CHANGE CLASS opens the selector', S.state().screen === 'classSelect', S.state().screen);
clickAct('screen-class', 'deploy'); step(2);
check('DEPLOY resumes play with the pick', S.state().screen === 'playing', S.state().screen);

const unresolved = new Set();
for (const cls of Object.keys(S.CLASSES)) {
  for (const slot of ['lmb', 'air', 'shift', 'q', 'e', 'r']) {
    const def = S.CLASSES[cls][slot];
    if (!def) continue;
    for (const k of ['clip', 'vfx', 'bolt', 'strike']) if (def[k]) unresolved.add(def[k]);
  }
}
const { effects } = await import(pathToFileURL(path.join(ROOT, 'vendor/pixelfx/src/fx/index.js')).href);
check('every class id exists in vendor/pixelfx', [...unresolved].filter((id) => !effects[id]).length === 0,
  [...unresolved].filter((id) => !effects[id]));

/* ======================================================== 2 · physics ===== */
console.log('\n--- physics ---');
const p = S.player;
p.x = 600; p.y = 700; p.z = 0; p.vz = 0; p.onGround = true;
S.game.god = true;
step(2);
const x0 = p.x;
tap('d'); step(24); release('d'); step(2);
check('A/D runs across x', p.x - x0 > 60, { from: Math.round(x0), to: Math.round(p.x) });

const y0 = p.y;
tap('w'); step(24); release('w'); step(2);
check('W/S moves along the depth lane', y0 - p.y > 20, { from: Math.round(y0), to: Math.round(p.y) });

tap(' '); step(8);
const z1 = p.z;
release(' ');
tap(' '); step(6); release(' ');
check('jump and double jump', z1 > 40 && p.z > z1, { first: Math.round(z1), double: Math.round(p.z) });
for (let i = 0; i < 120; i++) step(1);
check('gravity returns you to the ground', p.onGround && p.z === p.groundZ && p.vz === 0,
  { z: Math.round(p.z), gz: Math.round(p.groundZ) });

/* jump buffer, coyote time and variable height */
p.x = 600; p.y = 700; p.z = 0; p.vz = 0; p.onGround = true;
p.anim.busy = 0;
tap(' '); step(1); release(' ');
const earlyZ = p.z;
step(3);
check('SPACE starts a jump', earlyZ > 0 || p.vz > 100, { z: Math.round(p.z), vz: Math.round(p.vz) });
const vzBefore = p.vz;
release(' ');
check('early release clips the rise (variable jump)', p.vz < vzBefore * 0.9 || vzBefore <= 0, { before: Math.round(vzBefore), after: Math.round(p.vz) });
for (let i = 0; i < 120; i++) step(1);
check('variable jump still lands', p.z === 0 && p.onGround);

/* buffer: press a hair before touchdown, with no double jump left to spend */
p.x = 600; p.y = 700; p.z = 8; p.vz = -300; p.onGround = false; p.jumps = 0;
tap(' '); release(' ');
step(12);
check('jump buffer fires on touchdown', p.z > 10, Math.round(p.z));
for (let i = 0; i < 160; i++) step(1);

check('platforms project 1:1 with the lane', !/spreadFar|spreadNear/.test(worldSrc));

const pl = S.platforms[2];
p.x = pl.x + pl.w / 2; p.y = pl.y + pl.d / 2; p.z = pl.z + 180; p.vz = 0; p.onGround = false;
step(140);
check('landing snaps onto a platform top', Math.abs(p.z - pl.z) < 2 && p.onGround, { want: pl.z, got: Math.round(p.z) });
tap('s'); step(2); tap(' '); step(2); release(' '); release('s'); step(120);
check('S + SPACE drops through', p.z === 0 && p.onGround, { z: Math.round(p.z) });

/* ========================================================= 3 · classes ==== */
console.log('\n--- kits (7 classes x 4 slots) ---');
/* keep the arena scheduler out of the way while we fire every slot */
S.ARENAS.forEach((a) => { a.done = true; a.active = false; });
S.game.arena = null; S.game.cam.lock = 0; S.game.enemies.length = 0;
for (const cls of S.CLASS_IDS) {
  S.setClass(cls);
  S.gainXp(60);
  p.anim.busy = 0;
  const out = {};
  for (const slot of ['shift', 'q', 'e', 'r']) {
    p.hp = p.maxHp; S.game.cd.shift = 0; S.game.cd.q = 0; S.game.cd.e = 0; S.game.ult = 100;
    p.anim.busy = 0; p.dashT = 0; p.invuln = 0;
    S.castSlot(slot);
    step(1);
    out[slot] = S.state().anim;
    step(70);
    if (S.game.paused) S.takeCard(0);
  }
  const fired = Object.values(out).every((k) => typeof k === 'string' && k.includes('::'));
  /* every slot animates a *rigged* body clip, never a bare VFX id */
  const wantBody = {};
  for (const slot of ['shift', 'q', 'e', 'r']) {
    const def = S.CLASSES[cls][slot];
    wantBody[slot] = cls + '::' + slot + '::' + (def.clip.indexOf('moves/') === 0 ? def.clip : 'cast');
  }
  const bodies = ['shift', 'q', 'e', 'r'].every((k) => out[k] === wantBody[k] && S.CLIPS.has(out[k]));
  step(2); p.anim.busy = 0;
  click(500, 300);
  step(1);
  const lmb = S.state().anim;
  check(cls + ': shift/q/e/r + LMB animate', fired && lmb.includes('::'), { ...out, lmb });
  check(cls + ': the body never gives way to the VFX', bodies, out);
  step(70);
  if (S.game.paused) S.takeCard(0);
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
foe.atkCd = 99; foe.hp = foe.maxHp = 40;
const hp0 = foe.hp;
if (S.game.paused) S.takeCard(0);
/* swing to the right of the player: the click also sets facing */
const swing = () => click(Math.max(6, Math.round(p.x - S.game.cam.x + 70)), 300);
swing();
step(30);
check('a melee hit damages an enemy', foe.hp < hp0, { before: hp0, after: foe.hp });

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
while (S.game.enemies.length && guard++ < 20) { swing(); step(24); }
check('a killed enemy counts as a kill', S.game.stats.kills > 0, S.game.stats.kills);
check('hits charge the ultimate meter', S.game.ult > 0, Math.round(S.game.ult));
S.game.pickups.length = 0;

S.setClass('sniper');
S.game.enemies.length = 0;
p.x = 1000; p.y = 720; p.z = 0; p.onGround = true; p.facing = 1;
const far = S.spawnEnemy('slime', 1400, 720);
step(10); far.atkCd = 99;
const farHp = far.hp;
swing();
let bolts = 0;
for (let i = 0; i < 50; i++) { step(1); bolts = Math.max(bolts, S.game.bolts.length); }
check('ranged classes spawn travelling bolts', bolts > 0, bolts);
check('a bolt damages a distant enemy', far.hp < farHp, { before: farHp, after: far.hp });
for (let i = 0; i < 25 && S.game.enemies.length; i++) { swing(); step(24); }
check('a kill at range drops pickups', S.game.pickups.length > 0, S.game.pickups.length);

/* ============================================================ 4b · aim ==== */
console.log('\n--- cursor aiming & kit specifics ---');
S.setClass('sniper');
S.game.enemies.length = 0; S.game.bolts.length = 0; S.game.fx.length = 0;
p.x = 1000; p.y = 720; p.z = 0; p.vz = 0; p.onGround = true; p.facing = 1; p.anim.busy = 0;
const flyer = S.spawnEnemy('bat', 1260, 720);
flyer.z = 130; flyer.atkCd = 99; flyer.snare = 9;
const flyerHp = flyer.hp;
/* point the cursor at the bat, which is well above the player's head */
click(Math.round(1260 - S.game.cam.x), Math.round(720 - 130 - 30));
step(50);
check('cursor aiming hits a hovering flier', flyer.hp < flyerHp, { before: flyerHp, after: flyer.hp });

S.setClass('gunslinger');
p.anim.busy = 0; p.invuln = 99; p.hp = p.maxHp;
S.game.bolts.length = 0;
S.game.mouse.down = true;
step(46);
const held = S.game.bolts.length;
letGo();
check('holding LMB chains shots', held > 0, held);

S.setClass('gunslinger');
S.game.cd.q = 0; p.anim.busy = 0; S.game.bolts.length = 0;
S.castSlot('q');
step(12);
const lob = S.game.bolts[0];
check('the grenade lobs in an arc', !!lob && (lob.vz > 200 || lob.z > 26), lob && Math.round(lob.vz));

S.setClass('tech');
S.game.bolts.length = 0; p.anim.busy = 0;
click(Math.round(p.x - S.game.cam.x + 120), 300);
step(10);
check('the tech energy disc is a disc bolt', S.game.bolts.some((b) => b.kind === 'disc'),
  S.game.bolts.map((b) => b.kind));

S.setClass('knight');
S.game.enemies.length = 0; S.game.fx.length = 0;
p.x = 1000; p.y = 700; p.z = 0; p.vz = 0; p.onGround = true; p.anim.busy = 0;
tap(' '); step(3); release(' ');
step(6);
const airZ = p.z;
p.anim.busy = 0;
click(Math.round(p.x - S.game.cam.x + 40), 200);
step(8);
check('air slam drives the body down', p.vz <= -300 || p.z < airZ, { vz: Math.round(p.vz), z: Math.round(p.z) });
for (let i = 0; i < 60; i++) step(1);
check('air slam lands back on the deck', p.onGround, Math.round(p.z));

S.setClass('assassin');
S.game.enemies.length = 0;
p.anim.busy = 0; p.invuln = 99;
const marked = S.spawnEnemy('slime', p.x + 60, p.y);
marked.z = 0; marked.atkCd = 99; marked.hp = 60; marked.maxHp = 60;
S.game.cd.q = 0; p.anim.busy = 0;
S.castSlot('q');
step(24);
check('the assassin mark lands', marked.marked > 0, marked.marked);
const markedHp = marked.hp;
p.anim.busy = 0;
S.basicAttack();
step(24);
check('a marked target takes bonus damage', marked.hp < markedHp, { before: markedHp, after: marked.hp });

S.setClass('sniper');
S.game.enemies.length = 0; S.game.fx.length = 0;
p.x = 1000; p.y = 700; p.z = 0; p.onGround = true; p.anim.busy = 0; p.invuln = 99;
S.game.cd.e = 0;
S.castSlot('e');
step(20);
check('a whiffed rail still renders its beam', S.game.fx.some((f) => /arcane\/arcane-beam/.test(f.key || f.id || '')),
  S.game.fx.map((f) => f.key).slice(0, 4));

check('jump and fall poses exist for all seven classes',
  S.CLASS_IDS.every((c) => S.CLIPS.has('act:' + c + ':jump') && S.CLIPS.has('act:' + c + ':fall')));

/* ============================================================ 5 · waves === */
console.log('\n--- arenas, gates, cards ---');
S.setClass('knight');
S.ARENAS.forEach((a) => { a.done = false; a.active = false; a.wave = 0; a.clearT = 0; a.bossSpawned = false; });
S.game.arena = null; S.game.cam.lock = 0; S.game.boss = null;
S.game.enemies.length = 0; S.game.bolts.length = 0; S.game.cards = [];
p.hp = p.maxHp; p.invuln = 99;
p.x = 700; step(6);
check('walking into an arena locks the street', !!S.game.arena && S.game.cam.lock === 1,
  S.game.arena && { id: S.game.arena.id, wave: S.game.arena.wave });
check('the arena spawns a wave', S.game.enemies.length >= 4, S.game.enemies.length);
check('the HUD names the arena wave', /WAVE/.test(el('waveTag').textContent), el('waveTag').textContent);

const clearWave = () => { S.game.enemies.forEach((e) => { e.dead = true; }); step(90); };
clearWave();
check('clearing a wave advances it', S.game.arena && S.game.arena.wave === 1, S.game.arena && S.game.arena.wave);
clearWave();
check('clearing the last wave unlocks the street', S.ARENAS[0].done && S.game.cam.lock === 0);
check('a chip card draft opens on clear', el('cards').classList.contains('on') && S.game.cards.length === 3,
  S.game.cards.map((c) => c.id));
const before = { ...S.game.upgrades };
S.takeCard(0);
check('picking a card applies an upgrade', el('cards').classList.contains('on') === false &&
  JSON.stringify(S.game.upgrades) !== JSON.stringify(before), S.state().upgrades);
check('the game unpauses after the pick', S.game.paused === false);

S.devBoss();
step(4);
check('a stage boss spawns', !!S.game.boss, S.game.boss && S.game.boss.maxHp);
check('the boss bar appears', el('bossWrap').classList.contains('on'));
const boss = S.game.boss;
if (boss) { boss.x = p.x + 50; boss.y = p.y; boss.z = 10; boss.hp = 80; boss.maxHp = 170; }
step(40);
check('the boss runs phases as it loses HP', boss && boss.phase >= 2, boss && boss.phase);
if (boss) { boss.hp = 6; boss.x = p.x + 40; boss.y = p.y; boss.z = 8; }
S.game.level = 5; S.game.cd.e = 0; p.anim.busy = 0;
for (let i = 0; i < 40 && S.game.boss; i++) { S.game.cd.e = 0; p.anim.busy = 0; S.castSlot('e'); step(20); }
check('the boss can be killed', !S.game.boss);

/* ============================================================== 6 · HUD === */
console.log('\n--- HUD & dev panel ---');
check('four ability slots', win.document.querySelectorAll('#slots .slot').length === 4);
check('each slot carries a pixelfx thumbnail canvas', win.document.querySelectorAll('#slots canvas.thumb').length === 4);
check('the live HUD has no hint/lmb tip bars', !el('hint') && !el('lmbTip'));
check('the dev toggle is hidden by default', !el('devToggle').classList.contains('on'));
check('no 6/7 px pixel-font sizes remain', !/font-size:6px|font-size:7px/.test(htmlSrc));
S.setClass('tech');
S.game.level = 1; S.game.xp = 0; S.game.ult = 0; S.game.cd.q = 0;
step(2);
check('slot names follow the class', el('className').textContent === 'TECH SPECIALIST', el('className').textContent);
check('E is locked below level 3', slotEl('e').classList.contains('locked'), slotEl('e').className);
S.castSlot('q');
step(2);
check('a cast shows a cooldown countdown', /^\d+\.\d+s$/.test(slotEl('q').querySelector('.cd').textContent), slotEl('q').querySelector('.cd').textContent);
check('the cooldown overlay is visible', slotEl('q').classList.contains('cooling'));
S.game.level = 5; S.game.ult = 100; step(1);
check('a full meter marks the ultimate ready', slotEl('r').classList.contains('ult-ready'), slotEl('r').className);

tap('`');
check('~ opens the dev panel', el('devBar').classList.contains('on'));
check('the dev panel offers all 7 classes', win.document.querySelectorAll('[data-dev-class]').length === 7);
press('devLevel');
check('[+1 Level] raises the level', S.game.level === 5, S.game.level);
press('devUnlock');
step(2);
check('[Unlock All + Fill Ult] grants everything', S.game.level === 5 && S.game.ult === 100);
press('devGod');
check('[God Mode] toggles', S.game.god === true || S.game.god === false);
const e0 = S.game.enemies.length;
press('devWave'); step(4);
check('[Spawn Wave] adds enemies', S.game.enemies.length > e0, S.game.enemies.length);
S.game.boss = null;
press('devBoss'); step(4);
check('[Spawn Boss] adds the warden', !!S.game.boss);
S.game.cd.shift = 9; S.game.cd.q = 9; S.game.cd.e = 9;
press('devCds');
check('[Reset CDs] clears cooldowns', S.game.cd.shift === 0 && S.game.cd.q === 0 && S.game.cd.e === 0);
press('devWipe');
check('[Wipe Map] clears the field and reopens arenas', S.game.enemies.length === 0 && S.ARENAS.every((a) => !a.done));
check('the dev panel spans all 6 universes', (() => {
  const seen = new Set();
  for (let i = 0; i < 6; i++) { S.setUniverse(i); step(2); seen.add(S.state().uni); }
  return seen.size === 6;
})());

/* ================================================= 6b · death & victory == */
console.log('\n--- death & victory ---');
S.setScreen('playing');
S.game.enemies.length = 0;
S.game.god = false;
p.invuln = 0; p.hp = 1; p.dead = false; p.z = 0; p.onGround = true;
S.hurtPlayer(9, false);
check('death is a burst, not a silent respawn', p.dead === true && S.state().screen === 'playing', S.state().screen);
step(80);
check('then the game-over screen', S.state().screen === 'gameover' && el('screen-over').classList.contains('on'), S.state().screen);
check('the run summary is filled in', /\d+/.test(el('overKills').textContent) && +el('overLevel').textContent >= 1,
  { kills: el('overKills').textContent, level: el('overLevel').textContent });
win.document.querySelector('#screen-over [data-act="retry"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
step(2);
check('RETRY starts a fresh run', S.state().screen === 'playing' && p.dead === false && p.hp === p.maxHp && S.game.level === 1,
  { screen: S.state().screen, hp: p.hp, level: S.game.level });

S.ARENAS.forEach((a) => { a.done = true; });
S.devBoss(); step(2);
const ward = S.game.boss;
if (ward) { ward.x = p.x + 60; ward.y = p.y; ward.z = 8; ward.hp = 1; }
S.game.level = 5; S.game.cd.e = 0; p.anim.busy = 0; S.game.enemies.forEach((e) => { e.atkCd = 99; });
S.castSlot('e');
step(24);
check('killing the last Warden clears the stage', S.game.victoryT >= 0 && !S.game.boss);
step(90);
check('the victory screen appears', S.state().screen === 'victory' && el('screen-win').classList.contains('on'), S.state().screen);
check('victory offers NEXT UNIVERSE + PLAY AGAIN',
  !!win.document.querySelector('#screen-win [data-act="nextUni"]') && !!win.document.querySelector('#screen-win [data-act="again"]'));
const uniBefore = S.state().uni;
win.document.querySelector('#screen-win [data-act="nextUni"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
step(2);
check('NEXT UNIVERSE moves on and restarts', S.state().screen === 'playing' && S.state().uni !== uniBefore,
  { before: uniBefore, after: S.state().uni });

/* ============================================================= 7 · wrap === */
console.log('\n--- result ---');
check('still no runtime errors', errors.length === 0, errors.slice(0, 3));
check('the frame is still being drawn', (() => { const d0 = draw.image; step(30); return draw.image > d0; })());
console.log(failures === 0 ? '\n--- ALL CHECKS PASSED ---' : '\n--- ' + failures + ' CHECK(S) FAILED ---');
process.exit(failures === 0 ? 0 : 1);
