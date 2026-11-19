# PIXELFX harness

Headless verification for the game in `index.html`. It boots the real page in
**jsdom**, replaces the 2D canvas with a recording stub, imports the real module
graph (native ESM, exactly like the browser), and then drives the game through
its own DOM listeners and its `window.__SURVIVE` hook.

```bash
cd tools/pfx-harness
npm install                # jsdom only
node run.mjs               # behaviour: 120 checks
node boot-guard.mjs        # the inline boot guard: file://, throws, 404 probe (14)
node pages-audit.mjs       # deployment: .nojekyll + subpath-safe, exact-case graph (15)
node http-graph.mjs        # module graph over HTTP + acyclicity (server on :8080)
node http-boot.mjs         # cold boot over HTTP, browser-style MIME rules
```

What it proves:

* **boot** — the bake finishes, reports `ready · N clips`, clears its overlay
  with **no unresolved effect ids** on 137 clips, no duplicate ids, a drawn
  frame;
* **game flow** — boot lands on `title`, the title offers PLAY / CLASS /
  UNIVERSE / CONTROLS, the class screen frames 7 classes with a live preview
  canvas, an ability breakdown and the 1–6 universe strip, DEPLOY starts a clean
  run, ESC pauses into a 5-action menu and ESC again resumes, every menu button
  in the HTML has a handler, and each transition (PLAY, RESTART STAGE, CHANGE
  CLASS → DEPLOY, BACK, CONTROLS, SELECT UNIVERSE) actually lands where it says;
* **physics** — run, depth-lane walk, jump + double jump, gravity landing,
  variable height on early release, jump **buffer** firing on touchdown,
  platform landing snapping to `z`, `S + SPACE` drop-through, and a source check
  that `drawPlatform` no longer squashes x against the viewport centre;
* **kits** — all 7 classes × SHIFT/Q/E/R plus LMB animate, and every one of them
  animates a **rigged body clip** (`cls::slot::moves/…` or `cls::slot::cast`) —
  never a bare VFX id, which is what used to make the fighter disappear;
* **combat** — a hit damages, a heavy hit sets exactly 40 ms of hit-stop and
  punches the camera, Q launches, kills drop pickups, hits charge the ultimate,
  ranged bolts hit at range;
* **aiming & kit specifics** — a cursor aimed at a hovering bat kills it, holding
  LMB chains shots, the grenade lobs, the tech disc is `kind: 'disc'`, the air
  slam drives the body down and lands, the assassin mark lands and the next hit
  is bigger, a whiffed rail still renders its beam, and jump/fall poses exist for
  all seven classes;
* **waves** — a gate locks the street and names the wave in the HUD, clearing a
  wave advances it, clearing the last unlocks the camera and drafts cards, a
  card applies, the boss spawns with its own bar and can be killed;
* **death & victory** — hp 0 starts a burst (not a respawn), the run summary
  fills in, RETRY restarts cleanly, killing the last Warden raises STAGE CLEARED,
  and NEXT UNIVERSE moves on and restarts;
* **HUD & dev** — four slots with four pixelfx thumbnail canvases, no
  `#hint`/`#lmbTip`, no 6/7 px pixel type left in the shell, a hidden
  `#devToggle`, per-class slot names, the LV 3 gate, a `5.0s` countdown, the gold
  `ult-ready` state, all nine dev buttons and all six universes.

`boot-guard.mjs` also drives the **deployment probe**: it stubs `fetch` so that
`vendor/pixelfx/src/fx/*/_lib.js` answers 404 (exactly what GitHub Pages does when
Jekyll strips `_`-prefixed files), fires the module `error` event, and asserts the
boot screen names that `.js` file and the `.nojekyll` fix instead of blaming
`src/main.js` — plus a `F12 → Network` pointer in every failure path.

`pages-audit.mjs` is the offline deployment gate, and it needs no server:

* `.nojekyll` exists at the published root and is empty;
* the twenty Jekyll-sensitive files are still the vendored `_lib.js` kits;
* `index.html` has exactly one relative module entry and no root-absolute
  `src`/`href`/`url()` (a leading `/` resolves to the *user site* root and 404s
  under `/surviver/`);
* all 785 import specifiers in the 287-module graph are relative, carry a file
  extension, and resolve **with exact case** against the on-disk directory
  listing — the same case-sensitivity Pages enforces.

`http-boot.mjs` is the browser-fidelity run: it registers an ESM loader that
fetches each module over HTTP and refuses anything not served as JavaScript, so a
404, a wrong path or a `text/plain` `.js` fails here exactly as it would in
Chrome. `http-graph.mjs` is the same audit without booting anything, plus a DFS
that fails on an **import cycle**.

What none of them can prove: how it looks — the canvas is a stub that only counts
calls. Do the visual pass with a real rasteriser or in a browser, served over
http:

```bash
python3 -m http.server 8080    # then open /index.html
```

(For a headless pixel pass, `@napi-rs/canvas` can stand in for the 2D context and
`canvas.encode('png')` writes frames; that is how the platform alignment, the
jump/fall poses and the aim-at-a-flier frames in the README were checked.)
