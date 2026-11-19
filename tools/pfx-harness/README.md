# PIXELFX harness

Headless verification for the pixelfx integration in `index.html`. It boots the
real game page in **jsdom**, replaces the 2D canvas with a recording stub,
injects the vendored pixelfx modules (jsdom cannot run the page's `import`
statements), and then drives the game through its own DOM listeners and its
`window.__SURVIVE` hook.

```bash
cd tools/pfx-harness
npm install                # jsdom only
node run.mjs               # behaviour: 65 checks
node boot-guard.mjs        # the inline boot guard in index.html
node http-graph.mjs        # module graph over HTTP (needs a server on :8080)
node http-boot.mjs         # cold boot over HTTP, browser-style MIME rules
```

What it proves:

* the boot bake finishes, clears its overlay and reports **no unresolved effect
  ids** (`MISSING` empty) on 75 clips,
* every id the class table points at exists in `vendor/pixelfx/src/fx/index.js`,
* physics: run, depth-lane walk, jump + double jump, gravity landing, platform
  landing snapping to `z`, and `S + SPACE` drop-through,
* all 4 classes × SHIFT/Q/E/R plus LMB animate on their own baked clip,
* combat: a hit damages, a heavy hit sets exactly 40 ms of hit-stop and punches
  the camera, Q launches, kills drop pickups, hits charge the ultimate, ranged
  classes fire travelling bolts that hit at range,
* waves: a gate locks the street and names the arena wave in the HUD, clearing a
  wave advances it, clearing the last one unlocks the camera,
* the stage boss spawns with its own bar and can be killed,
* HUD: four slots, per-class names, LV 3 gate, `5.0s` style countdown, gold
  `ult-ready` state,
* the dev bar opens on `` ` `` and every one of its six buttons works, and all six
  universes switch.

`http-boot.mjs` is the browser-fidelity run: it registers an ESM loader that
fetches each module over HTTP and refuses anything not served as JavaScript, so a
404, a wrong path or a `text/plain` `.js` fails here exactly as it would in
Chrome. `http-graph.mjs` is the same audit without booting anything.

What none of them can prove: how it looks — the canvas is a stub that only counts
calls. Do the visual pass in a real browser, served over http:

```bash
python3 -m http.server 8080    # then open /index.html
```
