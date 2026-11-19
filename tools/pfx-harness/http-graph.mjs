/**
 * HTTP module-graph audit
 * -----------------------
 * Node and the browser resolve `import` specifiers differently enough that a
 * graph can link locally and die on a page: extension-less paths, case
 * mismatches, a server that sends `text/plain` for `.js` (browsers refuse to
 * execute a module script with a non-JavaScript MIME type), or a 404 under a
 * sub-path. This walks the graph exactly like a browser does — over HTTP, from
 * `index.html` outwards — and fails on any of it.
 *
 *   python3 -m http.server 8080 &
 *   node tools/pfx-harness/http-graph.mjs [base]
 *
 * Exit code is non-zero when a module is missing, mis-typed or mis-resolved.
 */
const BASE = (process.argv[2] || 'http://127.0.0.1:8080/').replace(/\/?$/, '/');
const seen = new Map();
const problems = [];

async function fetchText(url) {
  const res = await fetch(url);
  return { status: res.status, type: (res.headers.get('content-type') || '').trim(), text: await res.text() };
}

function specifiers(src) {
  const out = [];
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[\s\S]{0,200}?from\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of src.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of src.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

async function walk(url, from) {
  if (seen.has(url)) return seen.get(url);
  const rec = { url, from, deps: [] };
  seen.set(url, rec);
  let res;
  try {
    res = await fetchText(url);
  } catch (err) {
    problems.push({ url, from, error: String(err) });
    return rec;
  }
  rec.status = res.status;
  rec.type = res.type;
  rec.bytes = res.text.length;
  if (res.status !== 200) problems.push({ url, from, status: res.status });
  else if (!/javascript|ecmascript/i.test(res.type)) problems.push({ url, from, mime: res.type });
  for (const spec of specifiers(res.text)) {
    if (!/^(\.{0,2}\/|[a-z]+:)/i.test(spec)) problems.push({ url, from, bare: spec });
    const abs = new URL(spec, url).href;
    rec.deps.push(abs);
    await walk(abs, url);
  }
  return rec;
}

const page = await fetchText(BASE + 'index.html');
const entries = [...page.text.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
if (!entries.length) problems.push({ url: BASE + 'index.html', error: 'no module entry script' });

const t0 = Date.now();
for (const e of entries) await walk(new URL(e, BASE + 'index.html').href, 'index.html');

/* cycles: a strongly connected component of size > 1 (or a self-edge) would
   make the module graph non-acyclic, which the project forbids */
function findCycle() {
  const state = new Map();          /* 0 = new, 1 = on stack, 2 = done */
  const stack = [];
  let cycle = null;
  const visit = (url) => {
    if (cycle) return;
    const st = state.get(url) || 0;
    if (st === 1) {
      const at = stack.indexOf(url);
      cycle = stack.slice(at >= 0 ? at : 0).concat(url);
      return;
    }
    if (st === 2) return;
    state.set(url, 1);
    stack.push(url);
    for (const d of (seen.get(url) || {}).deps || []) visit(d);
    stack.pop();
    state.set(url, 2);
  };
  for (const url of seen.keys()) visit(url);
  return cycle;
}
const cycle = findCycle();
if (cycle) problems.push({ url: cycle[0], error: 'import cycle', path: cycle.map((u) => u.split('/').pop()) });

const mods = [...seen.values()];
const js = mods.filter((m) => /javascript/i.test(m.type || ''));
const ms = Date.now() - t0;
console.log('base            ' + BASE);
console.log('entry           ' + entries.join(' '));
console.log('modules         ' + mods.length + ' (' + js.length + ' javascript, ' + Math.round(js.reduce((a, m) => a + (m.bytes || 0), 0) / 1024) + ' KiB)');
console.log('depth           ' + Math.max(...mods.map((m) => (m.deps || []).length)) + ' deps on one module (vendor fx barrel)');
console.log('walked in       ' + ms + ' ms');
console.log('extension-less  ' + (mods.filter((m) => !/\.(js|mjs)(\?|$)/.test(m.url)).length || 'none'));
console.log('acyclic         ' + (cycle ? 'NO — ' + cycle.map((u) => u.split('/').pop()).join(' → ') : 'yes'));
console.log('problems        ' + (problems.length ? JSON.stringify(problems.slice(0, 8), null, 2) : 'none'));
console.log(problems.length ? '\n--- GRAPH FAILED ---' : '\n--- GRAPH OK ---');
process.exit(problems.length ? 1 : 0);
