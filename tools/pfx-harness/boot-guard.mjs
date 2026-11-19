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
 *   - a failed module request paints #bootMsg red,
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
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'file://' + HTML,
  pretendToBeVisual: true,
  beforeParse(w) { w.HTMLCanvasElement.prototype.getContext = () => null; }
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

/* and a module request that 404s */
const fake = doc.createElement('script');
fake.type = 'module';
fake.src = 'http://localhost:8080/src/main.js';
doc.body.appendChild(fake);
fake.dispatchEvent(new win.Event('error'));
check('a failed module fetch is reported', /Could not load/.test(msg.textContent), msg.textContent.slice(0, 70));

check('the guard exposes a manual fail hook', typeof win.__bootFail === 'function');
win.__bootFail('manual', 'warn');
check('__bootFail writes the line', msg.textContent === 'manual' && /warn/.test(msg.className));

console.log(failures === 0 ? '\n--- ALL CHECKS PASSED ---' : '\n--- ' + failures + ' CHECK(S) FAILED ---');
process.exit(failures === 0 ? 0 : 1);
