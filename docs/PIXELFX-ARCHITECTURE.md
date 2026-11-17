# PIXELFX Integration Architecture

**Branch:** `arena/3ddae62f-surviver` (test branch, from `7840286`)
**Scope:** the complete rendering + combat overhaul of SURVIVE, built on [patch-gg/pixelfx](https://github.com/patch-gg/pixelfx) **@main**.

---

## 0 · The hard constraint, and how it is proven

> `ctx.fillRect`, `ctx.arc`, `ctx.lineTo` and primitive canvas shapes may not draw **any** entity, projectile, particle or battlefield UI element. Every visual comes from a pixelfx module, baked into an offscreen cache, blitted with `drawImage` and `imageSmoothingEnabled = false`.

The engine enforces this structurally rather than by discipline:

1. Every kit under `src/fx/**` is executed **once, at load**, on a scratch sheet (`createFrame` → `inst.draw` → `composite`). Nothing of pixelfx runs per frame except arithmetic for `drawImage` source rects.
2. The whole battlefield render path (`render()` in `index.html`) is re-pointed at 42 painter functions whose only drawing verb is `ctx.drawImage`.
3. The game's own viewport `clip()` path was removed — the canvas edge is the clip now.
4. A **primitive audit** wraps the live battlefield context and counts `fillRect / fill / stroke / arc / lineTo / fillText / strokeText / ellipse / roundRect / moveTo / beginPath / rect / putImageData`. `?pfxaudit=1` turns it on.

Measured in the headless harness (`tools/pfx-harness/run.mjs --audit`), plain and low-spec profiles:

```
audit positive control: {"fillRect":1}          <- the counter is wired, proven
audit: 0 forbidden primitive calls over 300 frames ({})
audit: 337 drawImage/frame at 12 enemies
```

Zero. The positive control proves the zero is real and not a dead hook.

---

## 1 · File topology

There is no bundler in this repository and the game is a single-file build, so the integration is one **engine block** plus **twelve one-line hooks**:

| Path | Role |
| --- | --- |
| `index.html` | the whole game. The engine is the block that begins with `PIXELFX ENGINE — render + combat overhaul for SURVIVE` and ends just before `/* The SVG buttons use exactly the same casts… */`. Search for that banner. |
| `vendor/pixelfx/src/**` | the complete upstream library (2.9 MB, `core/` + 281 `fx/**` files), plus `LICENSE`, `NOTICE.md`. Source of truth for offline play. |
| `tools/pfx-harness/run.mjs` | the verification harness described in §10. |

The engine is a single IIFE that exports one global, `PFX`. It is ~2 500 lines and is deliberately in the same script scope as the game so it can wrap the game's own global functions (`drawPlayer`, `swingSword`, …) without a module boundary.

**Serving:** the engine uses real ES module `import()`, so `index.html` must be served over **http(s)** (`python3 -m http.server`, any static host). Opening it from `file://` blocks module loading; the engine then fails soft (see §2.3) and the legacy renderer keeps running.

---

## 2 · Module loading & boot state machine

### 2.1 Loader

```js
const CDN_BASE   = 'https://cdn.jsdelivr.net/gh/patch-gg/pixelfx@main/src/';
const LOCAL_BASE = 'vendor/pixelfx/src/';           // resolved against the document
```

`importModule(path)` tries jsDelivr first, then the mirror, per module, and records `PFX.stats().source` (`jsDelivr` | `local mirror`). Only two aggregate modules are imported up front:

* `core/index.js` — `actBounds`, `actSpan`, `createAct`, `createFx`, `createFrame`, `clearFrame`, `composite`, `screenMeta`, `clipTo`.
* `fx/index.js` — `{ effects, categories }`, the generated index of all 281 kits.

If `fx/index.js` cannot be fetched, the loader falls back to importing **only** the 91 kits the manifest needs, one at a time, and survives partial failures (`state.errors`).

### 2.2 Boot sequence

```
PFX.boot()
 └ start()
    ├ bootCanvas()               #pfxBoot, z-index 99999, fixed, pixelated
    ├ rAF(bootFrame)             # rune-circle meter + title + % only from baked clips
    ├ load()                     # core + fx/index.js   (CDN → mirror)
    ├ bake boot.rune / boot.title (2 individual clips)
    ├ bakeManifest()             # 119 clips, yields a frame every 4 clips
    │    ├ lazy entries → FXCache.request()  (23 clips deferred)
    │    └ onProgress → progress meter
    ├ flushOnDemand(200)         # 3 boot words, dynamic text
    ├ install()                  # OVERRIDES + input + audit
    ├ wait 260 ms @ 100 %
    └ wipeT = 0 → transitions/pixel-dissolve over the menu
         └ removeBoot() → startWarmup(): bakes the deferred clips, one per ~90 ms, until 95 % of budget
```

### 2.3 Failure behaviour

Any throw sets `state.status = 'failed'`, logs to `state.errors`, and removes the overlay after 1.2 s. `PFX.ready` stays `false`, so:

* every hook is a no-op,
* `install()` never runs,

and the game renders exactly as it did before the branch. There is no half-installed state and no black screen.

---

## 3 · The bake pipeline

`FXCache.bake(def)` — the single funnel every clip goes through.

**Pass 1 — performance capture.** The kit is instantiated through `createAct` (moves: a fully posed character performance) or `createFx` (everything else), stepped at the clip's fps, and each frame is composited into a scratch sheet:

```
clearFrame(frame) → inst.draw(frame, 'back'|'front') → composite(frame, img.data, null)
→ palette remap (body) → tint (multiply) → putImageData into the sheet column
```

While capturing, an alpha bounding box (`frameBounds`) accumulates over **all** frames.

**Pass 2 — crop & atlas.** The union box (+6 px pad, or the full frame for `noCrop` screen clips like weather/transitions) becomes the atlas cell; the sheet is stamped into a `cols × rows` grid with `drawImage` and `imageSmoothingEnabled = false`. The scratch sheet is released immediately (`width = height = 1`).

Resulting clip record:

```js
{ key, id, kind, w, h, ox, oy, n, cols, rows, fps, loop, canvas, scale, bytes, meta }
```

`ox/oy` is the **origin inside the cropped cell**, which is what makes rotated/scaled blits anchor correctly:

```js
ctx.drawImage(clip.canvas, sx, sy, clip.w, clip.h,
              x - clip.ox * s, y - clip.oy * s, clip.w * s, clip.h * s);
```

**Frame budget per clip** (`clipFrames`): `fps = def.fps || (act ? 10 : loop ? 10 : 16)`, `n = ceil(min(window, 1.8 | 1.4 | 1.6) × fps)` capped at 64 frames and 11 Mpx. `window` is per-clip, which is how a 0.4 s hit-spark and a 2 s burn loop live in the same budget.

### 3.1 Palette tinting

Two independent mechanisms:

* `body: CLASS_BODY[cls]` remaps the stock 2× actor palette (`DUMMY_PAL`: keys `k,A,B,C,D,E,F,G,J,m`) into a per-class ramp — Steel Knight, Indigo Mage, etc. Identical geometry, seven identities.
* `palette: INKS.*` and `tint: [r,g,b]` remap/tint any kit. Nine ink ramps (`spark, steel, ice, toxic, violet, gold, blood, arcane, bone`) drive damage numbers, critters and weather tints.

### 3.2 Memory

| Profile | Clips | Pixels | RGBA |
| --- | --- | --- | --- |
| desktop boot (`119` eager) | 121 | 27.6 Mpx | **≈ 105 MB** |
| desktop after warm-up | 141 | 30.5 Mpx | ≈ 116 MB |
| `?pfxlow=1` / ≤ 4 GB device / coarse pointer ≤ 820 px | 144 | 18.2 Mpx | **≈ 70 MB** |
| hard ceiling | — | — | `CFG.cacheBudget = 132 MB` |

Accounting is exact (`w × h × n × 4` per clip). Two rules keep it bounded:

* **everything the boot pass bakes is `pinned`** — the LRU trim may never reclaim gameplay art (this was a real bug the harness caught: trimming evicted all projectiles).
* **one universe's weather is live at a time** — six universes × two 320×180 loops would be 40 MB of sky nobody is looking at; `requestWeather()` drops the previous pairs.

### 3.3 Dynamic clips

`FXCache.request(key, id, opts)` returns `null` immediately and parks the definition; `flushOnDemand(ms)` bakes parked clips inside that time slice on the next tick. This is how floating text (`num:N`, `word:…`, arbitrary strings) and the 23 deferred clips enter the cache without ever stalling a frame.

---

## 4 · The render queue

```js
const LAYER = { GROUND:0, DECAL:1, SHADOW:2, BACK:3, BODY:4, FRONT:5, AIR:6, TEXT:7, SCREEN:8 };
```

Entities push `{layer, y, draw}`; `flushQueue()` sorts by `(layer, y)` and runs the painters — a painter's algorithm for the 2.5D depth, with no per-entity canvas state churn. Every `draw` is wrapped in `try/catch` that appends to `state.errors`, so one bad kit can never take a frame down.

`drawClip(key, x, y, t, o)` supports `scale, rot, alpha, flip, layer, tint, anchor, life`; `drawTiled` and `drawClipSlice` cover weather parallax and HP pips.

### 4.1 The override surface

`install()` replaces **42** global painters. Nothing else in `render()` changes.

| Group | Functions |
| --- | --- |
| world | `drawGround, drawArenaGround, drawBossArena, drawPortal, drawObstacles, drawSandPillars, drawMines, drawBossHazards, drawClassAbilities, drawHiddenSpots, drawFootsteps` |
| pickups | `drawGems, drawShards, drawChests, drawPickups, drawBreakables` |
| actors | `drawEnemy, drawBoss, drawPlayer, drawPetEntity, drawDecoy, drawRift` |
| combat | `drawBullets, drawEnemyBullets, drawTurrets, drawBombs, drawDiscs, drawBeams, drawParticles` |
| feedback | `drawThreatArcs, drawHitIndicator, drawDeathImpactRing, drawDeathParticles, drawClassFx` |
| screen | `paintBackdrop, drawAmbient, drawPostFx, drawObjectiveArrows, drawArenaWatchdogArrows, drawMinimap, drawDeathVignette, drawTouchAimLaser, drawTacticalCrosshair, drawPetAlerts` |

Each original is saved in `LEGACY[name]` before being replaced, so nothing is unrecoverable. `drawTexts` does not exist in the host game — floating combat text is emitted by the engine's own `addText`/`addCrit` and painted from `game.texts` inside the same pass.

Ground, arena runes and the boss ring are drawn as one `PFXWorld.drawGround()` (seamless 128 px tiles generated per universe) plus rune-circle blits, which is why `drawArenaGround`/`drawBossArena` become no-ops.

---

## 5 · 2.5D physics & the moves rig

```js
const Z = { z: 0, vz: 0, ground: true, gravity: 1500, pound: false };
```

`updateZ(dt)` integrates; landing at `z <= 0` runs the impact branch. **Space** jumps (`vz = 520`, Berserker `600`), **LMB while airborne** drives `vz = -1400` into a ground pound that plays `moves/ground-pound`, blits `impacts/ground-slam`, shakes the camera and deals `2.4 ×` damage in a 150 px radius with `stunned` applied.

Class → module mapping (baked as `act:<class>:<slot>`):

| class | LMB | Shift / ability | element |
| --- | --- | --- | --- |
| knight | `moves/sword-combo` | `moves/dash-strike` | steel (ice above tier 2) |
| gunslinger | `moves/pistol-shots` | `moves/rocket-launcher` | physical |
| sniper | `moves/rocket-launcher` | `moves/ice-lance-throw` | ice |
| mage | `moves/fireball-throw` | `moves/lightning-call` | fire |
| berserker | `moves/earth-stomp` | `moves/ground-pound` | fire |
| shadow | `moves/dash-strike` | `moves/dash-strike` | poison |
| tech | `moves/pistol-shots` | `moves/rocket-launcher` | electric |

`install()` wraps the host weapon functions (`swingSword, firePistols, fireSniper, fireMageOrbs, swingAxes, fireDaggers, fireDisc → lmb`; `castClassAbility, dash, throwBomb, novaBlast, startRage → alt`) so the performance plays on the exact frame the shot leaves the barrel, independent of class internals.

The player body is `critters/…`-free: `pfxDrawPlayer` blits the current act clip at `z`, with a dash trail of three alpha-faded past blits, a baked shadow whose scale shrinks with altitude, status overlays, and the invuln/rage shells.

---

## 6 · The bestiary

Humanoid enemy art is gone. Six kits × three palette variants = 20 critter clips:

| role | kits | hover `z` |
| --- | --- | --- |
| rushers | `critters/slime`, `critters/frog` | 0 |
| swarm / fliers | `critters/bat`, `critters/eyeball` | 26 / 18 |
| elites / stealth | `critters/ghost`, `critters/flying-skull` | 14 / 24 |
| pets | `critters/wisp`, `critters/bird` | live loops |

`CRITTER_BY_TYPE` maps ~40 host enemy types onto those six; `HOVER` adds per-frame bob; elites scale ×1.45, bosses ×3.1. Spawns blit `spawn/spawn-portal`, deaths choose `spawn/shatter-death` or `spawn/soul-rise` (flyers rise, grounders shatter), plus one shared `impacts/hit-spark` per hit.

---

## 7 · Ailments

`entity.statuses = { burning, frozen, poisoned, stunned, electrified, arcane }`.

| element | status | kit | behaviour |
| --- | --- | --- | --- |
| fire | `burning` 3.2 s | `status/burning` | 2.4 dps DOT, looping fire overlay |
| ice | `frozen` 2.6 s | `status/frozen`, `ice/freeze` | `e.freeze` stops movement; **the next hit shatters** for 60 % bonus → `ice/ice-shatter` |
| poison / shadow | `poisoned` 4.2 s | `status/poisoned` | 1.1–1.4 dps, leaves `nature/toxic-puddle` decals |
| electric | `stunned` + `electrified` | `lightning/electrified` | 1.4 s stun + `lightning/chain-lightning` to the two nearest bodies (55 %) |
| arcane | `arcane` | `arcane/magic-circle-cast` | 0.8 dps |
| shockwave | `stunned` | `impacts/ground-slam` | ground pound, EMP, boss slams |

Statuses are applied through the single `onEnemyHit` rider, with `meta.status` recursion guards, and tick once per frame in `PFXStatus.update` (damage through `damageEnemy(..., {dot:true})` so it obeys the game's own death path).

Sci-fi / mage kits are wired too: `scifi/emp-blast`, `scifi/force-field`, `scifi/laser-grid`, `scifi/hologram`, `scifi/scanner`, `arcane/magic-circle-cast`, `shadow/black-hole`, `shadow/eclipse`.

---

## 8 · Universes

Ground: one seamless 128 px tile per universe generated by `hash()` + a course/speck/pebble pass, cached, and blitted with a parallax detail layer.

| # | year | ground theme | weather pair (baked 320×180, 8 fps) | props / hazards |
| --- | --- | --- | --- | --- |
| U1 | Medieval 1347 | `village` | `weather/rain` + `weather/falling-leaves` | campfire, brazier, barrel |
| U2 | Egypt 2500 BC | `desert` | `weather/fog` (sand tint `1.0,0.78,0.48`) + `weather/god-rays` | brazier, campfire, urn |
| U3 | Feudal Japan 1600 | `dojo` | `weather/cherry-blossoms` + `nature/leaf-storm` | campfire, lantern, spore pod |
| U4 | Post-Apoc 2087 | `wasteland` | `nature/poison-cloud` (acid tint) + `weather/storm` | barrel, campfire, spore pod |
| U5 | Deep Space 3500 | `spaceship` | `weather/shooting-stars` + `weather/fireflies` + **10 `scifi/laser-grid` floor traps** | brazier, barrel, canister |
| U6 | The Void | `void` | `shadow/eclipse` (×2.4) + `weather/aurora` | brazier, spore pod, void shard |

24 rasterized prop shapes (`barrel, crate, haybale, mossrock, log, brokenwall, portcullis, crystalpillar, shard, sandstone, obelisk, urn, stonelantern, bambooclump, ricebarrel, carhulk, jersey, oildrum, rack, canister, hullcrate, voidspire, voidslab, voidshard`) are generated at boot; 22 interactive props per zone are scattered with a seeded PRNG avoiding spawn, arenas, boss zone and the existing obstacle set.

* `fire/campfire`, `fire/brazier`, `fire/torch`, `fire/candle` loop as live props.
* **Barrels detonate** when shot → `explosions/barrel-explosion` + radial damage; **spore pods** burst into `nature/spore-burst` + a poison cloud that applies `poisoned`.

---

## 9 · UI, pickups, combat text, level-up

* **Damage numbers.** `ui/damage-number` / `ui/crit-number`; the common rolls (1–12, heals `+1…+12`, `BLOCK/SHIELDED/MISS`) are baked eagerly, anything else is requested on demand. Text rises, scales and fades through the queue.
* **Pickups.** `pickups/xp-orb`, `pickups/gem-spin`, `pickups/crystal-shard`, `pickups/heart-pickup`, `pickups/power-star`, `pickups/loot-beam`, `pickups/chest-open`, `pickups/collect-burst`.
* **Level-up ritual.** `queueClassLevelUp` → the engine sets `game.timeScale = 0` for 1 s, drops a `holy/holy-pillar` on the player, plays `ui/level-up` as a rising title, `holy/heal` motes, and restores time. (Verified: `timeScale` returns to 1 after 1.5 s.)
* **Screen space.** `paintBackdrop` (per-universe gradient sky built from baked gradient strips), `drawAmbient` (weather + fog tint), `drawPostFx` (vignette, scanline, hit flash, `impacts/impact-frame` on big hits), death vignette (`shadow/eclipse`), tactical crosshair, touch-aim laser, minimap (blits `ink:blood`, `pick.gem`, `fx.portal` markers — no primitives).

---

## 10 · Host hooks (the only edits to game logic)

Twelve lines, each guarded so a failed boot cannot break combat:

| where | hook | why |
| --- | --- | --- |
| `damageEnemy` after `e.hp -= dmg` | `PFX.hooks.onEnemyHit(e, dmg, meta)` | ailment rider, damage number, hit spark |
| `damageEnemy` death branch | `onEnemyDeath(e)` | shatter / soul rise |
| `spawnEnemy` before `push` | `onEnemySpawn(e)` | critter identity, spawn portal |
| `hurtPlayer` after `p.hp -= amount` | `onPlayerHit(amount, source)` | combat text, impact frame |
| `update` after `updateEnemies(sdt)` | `tick(sdt, dt)` | z-physics, moves, live fx, ailments, props, weather |
| `loadZone` before `showBriefing()` | `onZoneLoad()` | universe theme + props + traps + weather |
| `queueClassLevelUp` | `onLevelUp()` | the freeze ritual |
| `render()` | (via `install()`) | the 42 painters |
| boot IIFE | `PFX.boot()` | start the pipeline |
| `render()` viewport | clip path removed | no path ops on the battlefield |

`tick` receives both the scaled and the real dt, so DOTs freeze with the rest of the world while the level-up ritual keeps its own clock.

---

## 11 · Verification

`tools/pfx-harness/run.mjs` boots the real `index.html` in jsdom with a stubbed 2D canvas, injects the vendored modules (jsdom has no dynamic `import()`), and drives real frames.

```
boot: status=ready ready=true 3522ms clips=141 mb=116.4 lowSpec=false
boot missing clips: []
U0..U5: clips=149 mb=142.9 weather=2 props=22      (2 weather loops live, not 12)
class knight..tech: clip=act:<class>:* enemies=0   (all 12 actions × 7 classes clean)
boss: present=true
level-up: after 1.5s timeScale=1
death: screen=gameover
audit positive control: {"fillRect":1}
audit: 0 forbidden primitive calls over 300 frames ({})
audit: 337 drawImage/frame at 12 enemies
engine errors: []
--- ALL CHECKS PASSED ---
```

Also verified in isolation:

* all 142 manifest clips bake, **0 missing, 0 empty, 0 errors**, 91 unique kits;
* every `draw*` the host `render()` calls is in `OVERRIDES` (checked programmatically against the call list);
* the harness's positive control proves the audit counts primitives;
* low-spec profile: 70 MB and a 2.5 s bake, same zero-forbidden result.

**What the harness cannot check:** how it *looks*. There is no browser in this sandbox (playwright has no binary), so composition, tint balance, atlas crop correctness and the dissolve timing are reviewed by eye in a real browser.

---

## 12 · Known limits / next steps

1. **Visual QA.** Open it on a static server with a network connection (jsDelivr path) and again with `?pfxlow=1`. Watch for: clip origins on the rotated projectiles, the boss scale, and weather tint strength.
2. **`spawn-and-death/*` vs `spawn/*`.** The brief's ids carry a `spawn-and-death/` prefix; upstream has no such directory. Resolved to `spawn/spawn-portal`, `spawn/shatter-death`, `spawn/soul-rise`.
3. **Battlefield UI is fully pixelfx**, but the DOM HUD (hearts, ability bar, shop, cards) is untouched CSS — it was never on the canvas.
4. **Moves are pose-stepped at 10 fps** and interpolate nothing between cells; if motion looks choppy on a 144 Hz display, raise `CFG.actFps` to 12–15 (costs ~6 MB).
5. **`game.player.classId` values** are the host's (`knight, gunslinger, sniper, mage, berserker, shadow, tech`). Unknown ids fall back to `CLASS_ACTIONS.knight`.
6. **Memory** is ~105 MB of canvas at boot on desktop. If that is too much for a target, the low-spec profile is automatic on weak devices; the next lever is halving the atlas for clips over ~24 000 px.
