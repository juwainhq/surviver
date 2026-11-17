# PIXELFX harness

Headless verification for the pixelfx integration in `index.html`. It boots the
real game page in **jsdom**, stubs the 2D canvas, injects the vendored pixelfx
modules (jsdom cannot do the dynamic `import()` the browser does), then runs the
boot pipeline, a six-universe + seven-class sweep, a boss fight, a death, and a
300-frame **primitive audit**.

```bash
cd tools/pfx-harness
npm install          # jsdom only
node run.mjs         # everything; exit code 1 on any failure
node run.mjs --boot  # boot/bake pipeline
node run.mjs --sweep # universes, classes, boss, level-up, death
node run.mjs --audit # positive control + 300 audited frames
PFX_LOW=1 node run.mjs --boot   # simulate the low-memory profile
```

What it proves:

* every manifest clip bakes (no missing / empty clips, no engine errors),
* every `draw*` the host `render()` calls is overridden,
* all 12 class actions × 7 classes run without a throw,
* the primitive audit counter works (positive control) and records **0**
  forbidden canvas primitives on the battlefield over 300 live frames,
* the level-up freeze restores `timeScale`, zones load in all six universes,
  weather stays at two live loops regardless of how many universes are visited.

What it cannot prove: how any of it looks. There is no browser in this sandbox.
Do the visual pass in a real browser, served over http:

```bash
python3 -m http.server 8080    # then open /index.html
```
