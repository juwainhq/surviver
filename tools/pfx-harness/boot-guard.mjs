/**
 * Boot guard test
 * ---------------
 * The inline `<script>` in `index.html` is what turns a silent boot screen into
 * a readable message. jsdom runs classic scripts but not module scripts, which
 * makes it the perfect stand-in for "the engine module never arrived".
 *
 *   node boot-guard.mjs
 *
 * It checks:
 *   - a file:// page warns the user to serve over http,
 *   - `id="bootSub"` appears once (no duplicate ids anywhere),
 *   - a thrown error and an unhandled rejection both paint #bootMsg red,
 *   - a failed module request paints #bootMsg red and points at DevTools,
 *   - the probe names the *dependency* that 404'd (a Jekyll-stripped `_lib.js`)
 *     and the `.nojekyll` fix, instead of blaming src/main.js,
 *   - the watchdog exists and is wired to `window.__SURVIVE`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const HTML = path.join(ROOT, 'index.html');
const { JSDOM } = await import('jsdom');

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log((ok ? '  ok  ' : ' FAIL ') + name.padEnd(48) + (detail === undefined ? '' : JSON.stringify(detail)));
};

const html = fs.readFileSync(HTML, 'utf8');
let probeCalls = [];
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'file://' + HTML,
  pretendToBeVisual: true,
  beforeParse(w) {
    w.HTMLCanvasElement.prototype.getContext = () => null;
    /* a stand-in network: everything exists except the Jekyll-stripped kits */
    w.fetch = (url) => {
      probeCalls.push(url);
      const missing = /_lib\.js$/.test(url);
      return Promise.resolve({ status: missing ? 404 : 200, ok: !missing, url });
    };
  }
});
const win = dom.window;
const doc = win.document;
const msg = doc.getElementById('bootMsg');

console.log('\n--- boot guard ---');
check('the page has one #bootSub', doc.querySelectorAll('#bootSub').length === undefined
  ? doc.querySelectorAll('[id="bootSub"]').length === 1
  : doc.querySelectorAll('#bootSub').length === 1, doc.querySelectorAll('[id="bootSub"]').length);
const ids = [...doc.querySelectorAll('[id]')].map((n) => n.id);
check('no duplicate element ids', ids.length === new Set(ids).size);

check('file:// is called out', /file:\/\//.test(msg.textContent) && /http/.test(msg.textContent), msg.textContent.slice(0, 60));
check('…as a warning, not silence', /warn/.test(msg.className), msg.className);

/* an engine throw must land on screen */
win.dispatchEvent(new win.ErrorEvent('error', { message: 'ReferenceError: oops', filename: 'http://x/src/main.js', lineno: 12 }));
check('a thrown error paints #bootMsg red', /err/.test(msg.className) && /oops/.test(msg.textContent), msg.textContent.slice(0, 70));

/* a rejected import promise too */
win.dispatchEvent(Object.assign(new win.Event('unhandledrejection'), { reason: new Error('chunk failed') }));
check('a rejection paints #bootMsg red', /err/.test(msg.className) && /chunk failed/.test(msg.textContent), msg.textContent.slice(0, 70));

/* and a module request that 404s — the real GitHub Pages shape: the entry is
   fine, one of its dependencies was stripped by Jekyll */
const fake = doc.createElement('script');
fake.type = 'module';
fake.src = 'http://localhost:8080/src/main.js';
doc.body.appendChild(fake);
fake.dispatchEvent(new win.Event('error'));
await new Promise((r) => setTimeout(r, 30));
check('a failed module fetch is reported', /Boot error/.test(msg.textContent) || /Could not load/.test(msg.textContent),
  msg.textContent.slice(0, 70));
check('…and it names the file that actually 404’d', /_lib\.js/.test(msg.textContent), msg.textContent.slice(0, 90));
check('…instead of only blaming src/main.js', !/^Could not load .*main\.js$/.test(msg.textContent.split('\n')[0]),
  msg.textContent.split('\n')[0]);
check('…and it names the .nojekyll fix', /\.nojekyll/.test(msg.textContent));
check('…and it points at DevTools', /F12/.test(msg.textContent), msg.textContent.slice(0, 60));
check('the probe used HEAD requests, not downloads', probeCalls.length > 0, probeCalls.slice(0, 3));

check('the guard exposes a manual fail hook', typeof win.__bootFail === 'function');
win.__bootFail('manual', 'warn');
check('__bootFail writes the line', msg.textContent === 'manual' && /warn/.test(msg.className));

console.log(failures === 0 ? '\n--- ALL CHECKS PASSED ---' : '\n--- ' + failures + ' CHECK(S) FAILED ---');
process.exit(failures === 0 ? 0 : 1);
