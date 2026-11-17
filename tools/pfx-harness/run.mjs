/**
 * PIXELFX integration harness
 * ---------------------------
 * Boots the real `index.html` inside jsdom with a stubbed 2D canvas, injects the
 * vendored pixelfx modules (jsdom cannot perform the dynamic `import()` the
 * browser does), runs the boot pipeline, the sweep and the primitive audit.
 *
 *   cd tools/pfx-harness && npm install jsdom
 *   node run.mjs              # boot + sweep + audit
 *   node run.mjs --boot       # boot pipeline only
 *   node run.mjs --sweep      # universes / classes / boss / death
 *   node run.mjs --audit      # 300 frames with the primitive audit on
 *
 * Exit code is non-zero when a scenario throws or the audit records a single
 * forbidden primitive call on the battlefield canvas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const HTML = path.join(ROOT, 'index.html');
const SRC = path.join(ROOT, 'vendor/pixelfx/src');
const ARGS = process.argv.slice(2);
const want = (f) => (!ARGS.length || ARGS.includes(f));

const { JSDOM } = await import('jsdom');

/* ---------------------------------------------------------------- stubs ---- */
class FakeImageData {
  constructor(a, b) {
    if (typeof a === 'number') { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
    else { this.data = a; this.width = b; this.height = arguments[2]; }
  }
}
const noop = () => {};
const gradient = () => ({ addColorStop: noop });

function fakeCtx(canvas) {
  const state = { canvas, globalAlpha: 1, imageSmoothingEnabled: true, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1 };
  const methods = {
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop, transform: noop, setTransform: noop, resetTransform: noop,
    clearRect: noop, fillRect: noop, strokeRect: noop, beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop,
    arcTo: noop, ellipse: noop, rect: noop, roundRect: noop, quadraticCurveTo: noop, bezierCurveTo: noop, fill: noop, stroke: noop,
    clip: noop, fillText: noop, strokeText: noop, setLineDash: noop, drawImage: noop, putImageData: noop,
    measureText: () => ({ width: 8 }),
    createLinearGradient: gradient, createRadialGradient: gradient, createConicGradient: gradient,
    createPattern: () => ({}),
    createImageData: (w, h) => new FakeImageData(w, h),
    getImageData: (x, y, w, h) => new FakeImageData(Math.max(1, w | 0), Math.max(1, h | 0)),
    isPointInPath: () => false
  };
  return new Proxy(state, {
    get(t, k) {
      if (k in t) return t[k];
      if (k in methods) return methods[k];
      if (k === 'then' || k === Symbol.toPrimitive) return undefined;
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

const errors = [];
const dom = new JSDOM(fs.readFileSync(HTML, 'utf8'), {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/survive/' + (process.env.PFX_LOW ? '?pfxlow=1' : ''),
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () { return fakeCtx(this); };
    window.ImageData = FakeImageData;
    window.AudioContext = undefined;
    window.webkitAudioContext = undefined;
    window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 4);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
    window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }));
    window.onerror = (m, s, l, c, e) => errors.push('[onerror] ' + m + ' ' + (e && e.stack || ''));
    window.addEventListener('unhandledrejection', (e) => errors.push('[unhandled] ' + (e.reason && e.reason.stack || e.reason)));
  }
});
const win = dom.window;
win.console.error = (...a) => errors.push('[console.error] ' + a.map(String).join(' '));
win.console.warn = noop;
await new Promise((r) => (win.document.readyState === 'complete' ? r() : win.addEventListener('load', r)));
await new Promise((r) => setTimeout(r, 400));

const PFX = win.eval('PFX');
const out = [];
const say = (s) => { out.push(s); console.log(s); };

/* the vendored modules, injected because jsdom has no dynamic import */
const core = await import('file://' + SRC + '/core/index.js');
const fx = await import('file://' + SRC + '/fx/index.js');
const state = PFX._internals.state;
state.core = core;
state.effects = fx.effects;
state.categories = fx.categories;
state.source = 'harness';

/* ---------------------------------------------------------------- boot ----- */
if (want('--boot')) {
  const t0 = Date.now();
  PFX.boot();
  while (PFX.status !== 'ready' && Date.now() - t0 < 90000) await new Promise((r) => setTimeout(r, 50));
  const bakeMs = Date.now() - t0;
  const missing = win.eval("JSON.stringify(PFX.MANIFEST.filter(d=>!d.lazy && !PFX.clips.has(d.key)).map(d=>d.key))");
  say(`boot: status=${PFX.status} ready=${PFX.ready} ${bakeMs}ms clips=${PFX.clips.size} mb=${PFX.stats.mb} lowSpec=${PFX.stats.lowSpec}`);
  say('boot missing clips: ' + missing);
  if (missing !== '[]') errors.push('boot left clips unbaked: ' + missing);
  /* let the dissolve run and the overlay come off */
  let w = 0;
  while (win.document.getElementById('pfxBoot') && w < 15000) { await new Promise((r) => setTimeout(r, 50)); w += 50; }
  say('boot overlay removed after ' + w + 'ms');
}

/* --------------------------------------------------------------- frames ---- */
function enterZone(u) {
  win.eval(`gameState.currentUniverse = ${u}; loadZone(${u === 0 ? 0 : u * 2}, { freshPlayer: true }); game.screen = 'playing'; currentScreen = 'gameCanvas';`);
  win.eval("for (let i=0;i<12;i++) spawnEnemy(['frog','slime','bat','eyeball','ghost','flying-skull'][i%6], game.player.x + 90 + i*22, game.player.y - 30 + (i%3)*16, 0);");
}
function frames(n, fn) {
  for (let i = 0; i < n; i++) {
    if (fn) fn(i);
    win.update(1 / 60);
    win.render();
  }
}

if (want('--sweep')) {
  for (let u = 0; u < 6; u++) {
    enterZone(u);
    frames(40);
    say(`U${u}: clips=${PFX.clips.size} mb=${PFX.stats.mb} weather=${win.eval("Array.from(PFX.clips.keys()).filter(k=>k.indexOf('#')>=0).length")} props=${win.eval('PFX.world.props.length')}`);
  }
  const acts = ['swingSword', 'firePistols', 'fireSniper', 'fireMageOrbs', 'swingAxes', 'fireDaggers', 'fireDisc', 'castClassAbility', 'dash', 'throwBomb', 'novaBlast', 'startRage'];
  for (const cls of ['knight', 'mage', 'sniper', 'gunslinger', 'berserker', 'shadow', 'tech']) {
    win.eval(`loadZone(0, {freshPlayer:true}); game.screen='playing'; currentScreen='gameCanvas'; game.player.classId='${cls}';`);
    for (const fn of acts) {
      const r = win.eval(`typeof ${fn} === 'function' ? (function(){ try { ${fn}(); return 'ok'; } catch(e) { return 'THROW ' + e.message; } })() : 'missing'`);
      if (r !== 'ok' && r !== 'missing') errors.push(cls + '.' + fn + ': ' + r);
    }
    frames(20);
    win.eval('PFX.hooks.jump();');
    frames(10);
    win.eval('PFX.hooks.groundPound();');
    frames(25);
    say(`class ${cls}: clip=${win.eval('PFX.moves.clip')} enemies=${win.eval('game.enemies.length')}`);
  }
  win.eval("loadZone(4, {freshPlayer:true}); game.screen='playing'; try { spawnBoss(); } catch(e) { 0 }");
  frames(60);
  say('boss: present=' + win.eval('!!game.boss'));
  win.eval("awardClassXP(5000, 'harness');");
  frames(90);
  say('level-up: after 1.5s timeScale=' + win.eval('game.timeScale'));
  win.eval('game.player.hp = 1; hurtPlayer(5, false, game.player);');
  frames(200);
  say('death: screen=' + win.eval('game.screen'));
}

/* ---------------------------------------------------------------- audit ---- */
if (want('--audit')) {
  enterZone(0);
  PFX.setAudit(true);
  win.eval('ctx.fillRect(0, 0, 4, 4);');            /* positive control */
  const control = PFX.audit(true);
  say('audit positive control: ' + JSON.stringify(control.calls) + ' (must be non-empty)');
  if (!control.forbidden) errors.push('audit positive control failed — the counter is not wired');
  let drawCalls = 0, measured = 0;
  const c = win.eval('ctx');
  const orig = c.drawImage;
  c.drawImage = function () { drawCalls++; return orig.apply(this, arguments); };
  frames(300);
  const snap = PFX.audit(false);
  delete c.drawImage;
  say(`audit: ${snap.forbidden} forbidden primitive calls over 300 frames (${snap.calls ? JSON.stringify(snap.calls) : '{}'})`);
  say(`audit: ${(drawCalls / 300).toFixed(0)} drawImage/frame at ${win.eval('game.enemies.length')} enemies`);
  if (snap.forbidden) errors.push('forbidden primitives on the battlefield canvas: ' + JSON.stringify(snap.calls));
}

const errs = state.errors.filter((e) => !/dynamic import/.test(e));
say('engine errors: ' + JSON.stringify(errs.slice(0, 8)));
if (errs.length) errors.push('engine errors: ' + JSON.stringify(errs.slice(0, 8)));

const real = errors.filter((e) => !/dynamic import/.test(e));
console.log('--- ' + (real.length ? real.length + ' FAILURE(S)' : 'ALL CHECKS PASSED') + ' ---');
real.slice(0, 10).forEach((e) => console.log(e));
process.exit(real.length ? 1 : 0);
