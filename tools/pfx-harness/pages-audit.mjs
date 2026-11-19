/**
 * GitHub Pages audit
 * ------------------
 * The 2.5D build talks to the browser through a static ES module graph, and
 * GitHub Pages is not a plain file server: with the **legacy** builder it runs
 * Jekyll first, and Jekyll *deletes* every file and folder whose name starts
 * with `_` or `.`. pixelfx keeps twenty of them:
 *
 *   vendor/pixelfx/src/fx/{arcane,critters,…}/_lib.js
 *
 * `fx/index.js` imports every kit, every kit imports `./_lib.js`, so removing
 * them turns `./src/main.js` into "Could not load …/src/main.js — check the path
 * and that the server sends JavaScript" even though main.js is served fine. The
 * fix is one empty file, `.nojekyll`, beside `index.html`; Pages then serves the
 * branch byte for byte.
 *
 * This audit runs offline (no server needed) and locks in all three deployment
 * rules:
 *
 *   1. `.nojekyll` exists at the published root;
 *   2. `index.html` never uses a root-absolute path (`/src/main.js` would resolve
 *      to the user site root and 404 under `/surviver/`);
 *   3. every import specifier is relative, extension-explicit and **exact case**
 *      (Pages is a case-sensitive Linux filesystem, whatever your laptop does).
 *
 *   node tools/pfx-harness/pages-audit.mjs
 *
 * Exit code is non-zero on any violation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures++;
  console.log((ok ? '  ok  ' : ' FAIL ') + name.padEnd(52) + (detail === undefined ? '' : JSON.stringify(detail)));
};

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const exists = (p) => fs.existsSync(p);

/* ------------------------------------------------------------------ 1 · .nojekyll */
console.log('\n--- pages: jekyll ---');
const nojekyll = path.join(ROOT, '.nojekyll');
check('.nojekyll exists at the repository root', exists(nojekyll));
if (exists(nojekyll)) {
  const size = fs.statSync(nojekyll).size;
  check('.nojekyll is empty (marker file, not config)', size === 0, size + ' bytes');
  check('index.html sits beside it at the published root', exists(path.join(ROOT, 'index.html')));
}

/* files Jekyll would drop — this is *why* the marker is required */
const jekyllSensitive = [];
(function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { scan(full); continue; }
    if (/^[_.]/.test(e.name) && !/^\.nojekyll$/.test(e.name)) jekyllSensitive.push(rel(full));
  }
})(ROOT);
const underscore = jekyllSensitive.filter((f) => !/(^|\/)\.[^/]*$/.test(f));
check('jekyll-sensitive files are present in the repo', underscore.length > 0, underscore.length + ' files');
check('…all of them are the vendored pixelfx kits',
  underscore.every((f) => f.startsWith('vendor/pixelfx/src/fx/') && f.endsWith('/_lib.js')),
  underscore.filter((f) => !(f.startsWith('vendor/pixelfx/src/fx/') && f.endsWith('/_lib.js'))).slice(0, 4));
check('…and `.nojekyll` is what keeps them on Pages',
  exists(nojekyll) && underscore.length > 0, { marker: exists(nojekyll), files: underscore.length });

/* ------------------------------------------------------------------ 2 · the shell */
console.log('\n--- pages: the shell ---');
const htmlPath = path.join(ROOT, 'index.html');
check('index.html exists at the root', exists(htmlPath));
const html = fs.readFileSync(htmlPath, 'utf8');

const rootAbs = [...html.matchAll(/(?:src|href|action|poster)\s*=\s*"(\/[^"]*)"/g)].map((m) => m[1]);
check('no root-absolute src/href in index.html', rootAbs.length === 0, rootAbs.slice(0, 5));

const cssAbs = [...html.matchAll(/url\(\s*['"]?(\/[^'")]*)/g)].map((m) => m[1]);
check('no root-absolute url() in the inline CSS', cssAbs.length === 0, cssAbs.slice(0, 5));

const entries = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
check('exactly one module entry, and it is relative',
  entries.length === 1 && /^\.\.?\//.test(entries[0]), entries);
check('every modulepreload is relative and on disk',
  preloads.length > 0 && preloads.every((p) => /^\.\.?\//.test(p) && exists(path.join(ROOT, p))), preloads);

/* ------------------------------------------------------------------ 3 · the graph */
console.log('\n--- pages: the module graph ---');
const seen = new Set();
const problems = [];
const SPEC_RES = [
  /(?:^|\n)\s*(?:import|export)\s[^;\n]*?from\s*['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
];

/** resolve one specifier, segment by segment, against the exact directory listing */
function resolveExact(fromFile, spec) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec)) { problems.push({ from: rel(fromFile), spec, why: 'absolute URL' }); return null; }
  if (spec.startsWith('//')) { problems.push({ from: rel(fromFile), spec, why: 'protocol-relative' }); return null; }
  if (!spec.startsWith('.')) { problems.push({ from: rel(fromFile), spec, why: 'bare specifier' }); return null; }
  if (spec.includes('\\')) { problems.push({ from: rel(fromFile), spec, why: 'backslash separator' }); return null; }
  if (!/\.(js|mjs|json|css)$/.test(spec)) { problems.push({ from: rel(fromFile), spec, why: 'no file extension' }); return null; }
  let dir = path.dirname(fromFile);
  for (const part of spec.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') { dir = path.dirname(dir); continue; }
    let entriesIn;
    try { entriesIn = fs.readdirSync(dir); } catch { problems.push({ from: rel(fromFile), spec, why: 'missing directory' }); return null; }
    if (!entriesIn.includes(part)) {
      const near = entriesIn.find((e) => e.toLowerCase() === part.toLowerCase());
      problems.push({ from: rel(fromFile), spec, why: near ? 'case mismatch, on disk: ' + near : 'not on disk' });
      return null;
    }
    dir = path.join(dir, part);
  }
  if (!fs.statSync(dir).isFile()) { problems.push({ from: rel(fromFile), spec, why: 'not a file' }); return null; }
  return dir;
}

function walk(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const src = fs.readFileSync(file, 'utf8');
  for (const re of SPEC_RES) {
    for (const m of src.matchAll(re)) {
      const target = resolveExact(file, m[1]);
      if (target) walk(target);
    }
  }
}

for (const e of entries) walk(path.join(ROOT, e));
for (const p of preloads) walk(path.join(ROOT, p));

check('every module in the graph resolves', problems.length === 0, problems.slice(0, 6));
check('…all of them lowercase (Pages is case-sensitive)',
  ![...seen].some((f) => rel(f) !== rel(f).toLowerCase()),
  [...seen].filter((f) => rel(f) !== rel(f).toLowerCase()).map(rel).slice(0, 4));
check('…and none hidden or underscore-prefixed outside vendor',
  ![...seen].some((f) => /(^|\/)[_.]/.test(rel(f)) && !rel(f).startsWith('vendor/pixelfx/')),
  [...seen].map(rel).filter((f) => /(^|\/)[_.]/.test(f) && !f.startsWith('vendor/pixelfx/')).slice(0, 4));

/* a case-colliding pair breaks a case-insensitive checkout and confuses Pages */
const tracked = [];
(function scanAll(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) scanAll(full); else tracked.push(rel(full));
  }
})(ROOT);
const byLower = new Map();
for (const f of tracked) {
  const k = f.toLowerCase();
  if (byLower.has(k) && byLower.get(k) !== f) problems.push({ spec: [byLower.get(k), f], why: 'case collision' });
  else byLower.set(k, f);
}
check('no two tracked files differ only by case',
  !problems.some((p) => p.why === 'case collision'),
  problems.filter((p) => p.why === 'case collision').slice(0, 4));

console.log('\nmodules on disk   ' + seen.size);
console.log('tracked files     ' + tracked.length);
console.log('jekyll-sensitive  ' + jekyllSensitive.length + (exists(nojekyll) ? ' (neutralised by .nojekyll)' : ' (WILL 404 ON PAGES)'));
console.log('problems          ' + (problems.length ? JSON.stringify(problems.slice(0, 8), null, 2) : 'none'));
console.log(failures === 0 ? '\n--- PAGES OK ---' : '\n--- ' + failures + ' CHECK(S) FAILED ---');
process.exit(failures === 0 ? 0 : 1);
