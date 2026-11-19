/**
 * HTTP cold boot — browser fidelity
 * ---------------------------------
 * The jsdom harness (`run.mjs`) imports the modules straight off disk, so it can
 * never catch what actually breaks a page: a 404 under the server root, a server
 * that sends `text/plain` for `.js` (browsers refuse to execute such a module),
 * or an import specifier that only Node can resolve.
 *
 * This does what the browser does: registers a loader that fetches every module
 * over HTTP, rejects anything that is not served as JavaScript, and only then
 * links the graph — with a real DOM around it.
 *
 *   python3 -m http.server 8080 &
 *   node tools/pfx-harness/http-boot.mjs [base]
 *
 * Exit code is non-zero when the page would not boot in a browser.
 */
import fs from 'node:fs';
import { register } from 'node:module';

const BASE = (process.argv[2] || 'http://127.0.0.1:8080/').replace(/\/?$/, '/');

/* --- the loader: fetch over HTTP, enforce the browser's MIME rule --------- */
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('http://') || spec.startsWith('https://')) return { url: spec, shortCircuit: true, format: 'module' };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return next(url, ctx);
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  const type = (res.headers.get('content-type') || '').toLowerCase();
  if (!/javascript|ecmascript/.test(type)) {
    throw new Error('refused to execute module ' + url + ' — served as "' + type + '"');
  }
  return { format: 'module', source: await res.text(), shortCircuit: true };
}
`));

/* --- the page ------------------------------------------------------------ */
const page = await (await fetch(BASE + 'index.html')).text();
if (!/<script[^>]*type="module"[^>]*src="([^"]+)"/.test(page)) {
  console.error('index.html has no module entry script');
  process.exit(1);
}

const { JSDOM } = await import('jsdom');

const draw = { image: 0, rect: 0 };
const gradient = () => ({ addColorStop() {} });
function makeCtx() {
  return {
    canvas: null, imageSmoothingEnabled: true, globalAlpha: 1, fillStyle: '#000', strokeStyle: '#000',
    lineWidth: 1, font: '', textAlign: '', globalCompositeOperation: 'source-over',
    createLinearGradient: gradient, createRadialGradient: gradient, createPattern: () => null,
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() { draw.image++; }, drawImage() { draw.image++; },
    fillRect() { draw.rect++; }, strokeRect() { draw.rect++; }, clearRect() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, rect() {},
    fill() {}, stroke() {}, clip() {}, save() {}, restore() {}, translate() {}, scale() {},
    rotate() {}, setTransform() {}, measureText: (t) => ({ width: String(t).length * 6 }),
    fillText() {}, strokeText() {}
  };
}

const errors = [];
const dom = new JSDOM(page, {
  runScripts: 'outside-only',
  pretendToBeVisual: true,
  url: BASE + 'index.html',
  beforeParse(window) {
    window.HTMLCanvasElement.prototype.getContext = function () { return makeCtx(); };
    window.ImageData = class { constructor(a, b) { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); } };
    window.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  }
});
const win = dom.window;
for (const g of ['document', 'ImageData', 'requestAnimationFrame', 'cancelAnimationFrame', 'MouseEvent', 'KeyboardEvent', 'Event']) {
  if (win[g] === undefined) continue;
  try { globalThis[g] = win[g]; } catch { /* getter-only in Node */ }
}
globalThis.window = win;
globalThis.self = win;
win.console.error = (...a) => errors.push(a.map(String).join(' '));
win.console.warn = () => {};

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log((ok ? '  ok  ' : ' FAIL ') + name.padEnd(46) + (detail === undefined ? '' : JSON.stringify(detail)));
};

console.log('\n--- cold boot over ' + BASE + ' ---');
const t0 = Date.now();
try {
  await import(BASE + 'src/main.js');
} catch (err) {
  console.log(' FAIL could not import the entry module');
  console.log('      ' + (err && (err.message || err)));
  process.exit(1);
}
const linked = Date.now() - t0;

const S = win.__SURVIVE;
check('the module graph linked over HTTP', !!S, linked + ' ms');
if (!S) process.exit(1);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bootEl = win.document.getElementById('boot');
for (let i = 0; i < 1500 && !bootEl.classList.contains('done'); i++) await sleep(20);
const booted = Date.now() - t0;

const msg = win.document.getElementById('bootMsg');
check('the boot overlay dismissed', bootEl.classList.contains('done'));
check('the progress bar reached 100 %', win.document.getElementById('bootFill').style.width === '100%',
  win.document.getElementById('bootFill').style.width);
check('the boot line is the bake report', /ready · \d+ clips/.test(msg.textContent), msg.textContent);
check('the boot line is not in an error state', !/err/.test(msg.className), msg.className);
check('the title overlay built 7 class chips', win.document.querySelectorAll('#bootClasses .bc').length === 7,
  win.document.querySelectorAll('#bootClasses .bc').length);
check('the engine checked in (window.__SURVIVE)', !!S && !!S.state);
check('clips baked', S.CLIPS.size >= 100, S.CLIPS.size);
check('no unresolved effect ids', S.MISSING.length === 0, S.MISSING);
check('boot took under 30 s', booted < 30000, booted + ' ms');

win.requestAnimationFrame = () => 0;
await sleep(30);
const before = draw.image;
for (let i = 0; i < 30; i++) S.step(1 / 60);
check('the stage renders frames', draw.image > before, { drawImage: draw.image - before });
check('the live state is sane', (() => {
  const st = S.state();
  return st.clips > 100 && st.hp > 0 && typeof st.uni === 'string';
})(), S.state().uni + ' · hp ' + S.state().hp);
check('boot hands over to the title screen', S.state().screen === 'title', S.state().screen);
/* and PLAY really does start a run, over HTTP, in a real DOM */
win.document.querySelector('#screen-title [data-act="play"]')
  .dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
S.step(1 / 60);
check('PLAY starts the run', S.state().screen === 'playing' && S.game.enemies.length > 0,
  { screen: S.state().screen, enemies: S.game.enemies.length });
check('no console errors during boot', errors.length === 0, errors.slice(0, 3));

console.log(failures === 0 ? '\n--- BROWSER BOOT OK ---' : '\n--- ' + failures + ' CHECK(S) FAILED ---');
process.exit(failures === 0 ? 0 : 1);
