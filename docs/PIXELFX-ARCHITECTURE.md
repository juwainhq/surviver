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

## 11b · Visual tuning pass (env clutter, retro UI, cast scale)

Three art-direction fixes landed after the first integration (see §12 for what still needs eyes).

### A · Environmental effects are background air now

The weather kits are full-frame *skyscapes*: they paint a wash over every pixel and then draw particles on top. Stretched to the viewport that read as a giant, veiling foreground effect. Four knobs, all in `WEATHER_TUNE` in the engine block:

| knob | value | what it does |
| --- | --- | --- |
| `scale` | `0.4` | every layer is tiled at 40 % of the old per-particle size (particles are 2.5× smaller on screen, the sky still covers) |
| `alpha` | `0.25` | hard ceiling on the weather overlay alpha, and it fades in over 1.6 s per zone |
| `density` | `0.25` | three of every four particles are deleted **at bake time** |
| `wash` | `0.22` | the static full-frame backdrop is cut to 22 % alpha (0.6 for field effects: fog, god-rays, eclipse) |

All four live in `WEATHER_TUNE` next to the `WEATHER` table, so the whole environmental look is four numbers.

Two one-time passes do the work on the baked sheet (`sparsifySheet`):

1. **static pass** — a pixel whose alpha barely changes across the loop is backdrop, not weather → alpha × `wash`;
2. **particle pass** — per frame, blobs of *moving* pixels are labelled with a seeded union-find and whole blobs are dropped until 25 % of the particle ink survives. Particles are deleted whole, never punched into holes, so leaves stay leaf-shaped.

Measured with the vendored compositor over 8 frames of each kit (`alpha-ink` = alpha-weighted coverage, i.e. what the eye actually sees):

| kit | alpha-ink before | after | screen after × 0.25 overlay |
| --- | --- | --- | --- |
| `weather/rain` | 46.6 % | 10.5 % | **2.6 %** |
| `weather/falling-leaves` | 40.5 % | 9.2 % | 2.3 % |
| `weather/snow` | 42.2 % | 9.4 % | 2.4 % |
| `weather/fog` | 14.9 % | 2.9 % | 0.7 % |
| `weather/cherry-blossoms` | 38.2 % | 8.6 % | 2.2 % |
| `nature/poison-cloud` | 3.6 % | 0.3 % | 0.1 % |
| `weather/storm` | 64.6 % | 13.7 % | 3.4 % |
| `weather/god-rays` | 53.7 % | 11.9 % | 3.0 % |

That is a **≈ 94–96 % reduction in weather ink** on the battlefield. Tiles are drawn with per-tile flip / time-offset / jitter (`drawTiled`'s `vary` flag) so a 0.4× field does not show its 2.5× repeat. Weather costs 32–50 `drawImage` calls per frame.

**Spore pods** are no longer smoke machines: the idle wisp is `scale 0.2 / alpha 0.3` (was `0.6 / 0.9`), the pod itself is the only solid element, and the detonation burst is `0.42` in the air over 1.4 s instead of `0.8` on the ground over 2.2 s.

### B · 16-bit interface

* **Type.** `Press Start 2P` is loaded from Google Fonts next to Cinzel/Rajdhani, and `--font-head` / `--font-stat` are re-pointed at `--font-pixel`. Because every rule in this build is written against those two variables, the *entire* interface — menus, cards, shop, HUD — re-fonts from two lines. `html, body, body *` gets the face with zero letter-spacing and no text-shadow, the canvas gets `ctx.font = '10px "Press Start 2P", …'` every frame, and the oversized display type is capped (`#pauseTitle`, `#skillTreePoints`) so the wider face cannot overflow its card.
* **Ability bar.** The pill-shaped bar and the 50 % radius slots are gone: `#abilities` is an unframed row and each slot is a chunky square — `background #1a1c23`, a `#475569` **2px inner** border (`inset box-shadow`), a 2px `#0b0d12` outer edge and a 4 px hard drop shadow. Cooling sweep squared off too.
* **Top HUD.** `#topLeft`, `#topRight`, `#objective`, `#classBadge` and `#bossBar` are solid `#1a1c23` slabs with 2px `#475569` borders, square corners and a hard offset shadow — no gradients, no translucency, no blur. The XP track and boss track are flat `#0b0d12` wells with a solid `#4ade80` / `#ef4444` fill, their `.shine` and gradient overlays removed. Zone badge is a bordered chip, zone name/timer/score are 6–11 px pixel type.
* The HP crests (already angular dark-iron SVG shields) are untouched — they were never modern-looking.

### C · The cast is 1.5× larger

`CFG.charScale = 1.5` multiplies the player skeleton, every critter, their shadows, status overlays and pips (`pfxDrawPlayer`, `pfxDrawEnemy`), so the pixel detail survives against the 128 px floor tiles. Bosses take **half** the bump (1.25×) deliberately: they already fill a third of the viewport at `3.1 × r/24`, and a 1.5× boss would be screen-filling.

**Hitboxes are unchanged** — the host's collision radii are gameplay data, not art, and rescaling them would change difficulty and arena pacing. The cast now reads larger than its collision shape; if that feels unfair, the correct fix is to scale `e.r` / `player.r` and the spawn spacing together, not to shrink the art back.

### Verified

`tools/pfx-harness/run.mjs` after the pass: boot OK, 6 universes, 7 classes × 12 actions, boss, level-up, death — **ALL CHECKS PASSED**, `0 forbidden primitive calls over 300 frames`, 339 `drawImage`/frame, weather fade reaches 1.0 and draws 32–50 blits per frame.

## 11c · Round three: palette, stance, one creature per enemy, slate floor

Four visual regressions were reported against 11b. Each had a single, findable
cause; the fixes are structural rather than cosmetic, and every one is verified
from rendered pixels (see the harness below).

### A · The class palette never reached a single pixel

`hexRgb()` in the engine utilities decoded `'#rrggbb'` as **BGR**:

```js
return [n & 255, (n >> 8) & 255, (n >> 16) & 255];   // blue first
```

`bodyPaletteMap()` builds its lookup with `packRgb(hexRgb(DUMMY[k]))`, and
`applyTint()` matches raw frame pixels against those keys. Packed BGR keys never
matched the RGB pixels in a frame, so **no** class colour was ever substituted
and the player was drawn with the stock `HERO2` ramp — white/grey bones with a
white blade. The same bug was quietly swapping red and blue in every generated
prop and floor tile.

The fix is one line, and it is load-bearing for three separate systems:

```js
return [(n >> 16) & 255, (n >> 8) & 255, n & 255];   // r, g, b
```

The palettes were then re-tuned to the requested classes: **Vanguard Knight**
`#334155` steel (`A #8fa0b5 … J #161d26`, gold ember `m #f0c761`) and **Chrono
Mage** indigo `#312e81` with cyan `#06b6d4` highlights (`A #e0f2fe, B #22d3ee,
C #0891b2, E #312e81`).

### B · The player was frozen in an attack frame

Two causes, both removed:

1. `updateMoves()` finished every clip by *rearming the attack*:
   `if (!moves.clip) moves.clip = 'act:' + classId + ':lmb'`. The body was in the
   first frame of the sword combo from the first second of the run.
2. pixelfx has **no locomotion acts** — `src/fx/moves/*` is twelve one-shot
   weapons. An idle had to be authored.

`IDLE_MOD` and `RUN_MOD` (engine, `POSE_ACTS`) are two synthetic acts built from
the core pose vocabulary: the idle is `READY` plus a 2.4 s breath (hips, hands
and head drift 1 px), the run is a 0.5 s four-key stride — contact, near foot up,
pass, far foot up — with the feet kept inside the leg's ~16 px reach so the
solver never sinks the hips. Both are baked through the **same** `createAct`
path, skeleton and class palette as a move kit, clipped as `act:<class>:idle`
and `act:<class>:run`, so they cost one sheet each (14 clips, +2.2 MB).

Draw-time selection (`pfxDrawPlayer`) is now a small state machine: a busy move
wins, otherwise `moves.speed > 16` picks the run, otherwise the idle. `speed` is
measured from the player's own frame-to-frame displacement inside `updateMoves`,
so the stance never depends on a host field that might be renamed.

### C · One creature per enemy

The critter kits were never the problem — a connected-component pass over the
composited frames shows slime, ghost and flying-skull are one body, eyeball two
(body + its wart), frog/bat a body plus 5–7 px accents. The stacking was in the
draw path, and it had three sources:

* **Role drift.** `CRITTER_BY_TYPE` sent rushers to `frog`, so a melee crowd and
  a ranged cluster could look like the same animal. The table is now role-based
  — a shooter is an **eyeball**, a body is a **slime**, a hoverer is a **bat**, a
  phased spirit is a **ghost** — with `critterOfRole()` as the fallback for a
  type that is not listed.
* **First-frame recompute.** `critterFor()` returned early once `e.critter` was
  set, so an entity whose key had been cleared drew nothing coherent. It now
  re-derives `critterKey`/`critterScale` from the cached type and never re-rolls
  the type itself.
* **Two portals per spawn.** `onEnemySpawn()` spawned a `spawn.portal` fx
  instance *and* `pfxDrawEnemy()` drew the telegraph portal at the same
  coordinates — two large violet vortexes per enemy, which is exactly what a
  "second critter" looked like. The fx instance is gone; the drawn portal now
  holds, then **crossfades** into the body over its last 0.3 s.

Overlapping bodies are also resolved at draw time (`crowdResolve()`): enemies
within 26 px are pushed apart up to 9 px, eased at 0.09 s intervals. This is a
*render* offset only — simulation, hitboxes and damage never move.

### D · The floor is slate, not mud

`THEMES[0]` was `#1b2a1c` village green, and the tile generator jittered **every
pixel** by ±7 around a 32×16 brick grid, which reads as mud at 1:1 and as noise
under the 1.5× cast. Both are replaced by the specified palette:

```js
const FLOOR = { base: '#16181d', light: '#1d2027', dark: '#0f1115' };
```

The tile is now a flat base with scattered **2×2** blocks of the light and dark
speck (13 % / 11 % over a 64×64 cell grid, hashed per universe so it never
repeats visibly), seeded straight into the `ImageData` buffer so the blocks stay
crisp. No grain, no courses, no green. All six universes share the palette —
their identity lives in props, light and weather, which is where it belongs.

One more thing surfaced while measuring: the floor showed faint horizontal
banding. The camera transform puts one world pixel on `viewScale × zoom` device
pixels — 0.8 on a 1280-wide viewport — so a 128 px tile covered 102.4 device px
and nearest sampling dropped a row at every tile edge. `PFXWorld.drawGround()`
now blits in **device space**, rounding each tile edge to a whole pixel and
butting neighbours edge to edge, so there is no seam or shimmer at any zoom the
host picks.

### E · The crosshair is the one sanctioned primitive

The reticle has to land on the exact cursor pixel, which no sprite can promise,
so `pfxDrawTacticalCrosshair()` draws with `ctx.fillRect` — explicitly allowed
for this one block:

* **2 px** white arms, **6 px hollow centre**, **7 px** arm length, and a **2×2**
  `#ef4444` pip dead centre; arms warm to `#ffe08a` while the trigger is down.
* It sits in the base `viewScale` transform (not the camera transform), snaps to
  whole device pixels, forces `globalAlpha = 1` and `source-over`, and uses
  `touchAim` when the twin-stick aim is active.

The audit was split accordingly: `state.auditExempt` is raised only around those
five `fillRect` calls, and `PFX.audit()` now returns `sanctioned` /
`sanctionedCalls` next to `forbidden` / `calls`. The measured result on the
300-frame audit is **0 forbidden / 1500 sanctioned** — exactly 5 per frame, the
crosshair — with every other battlefield pixel still arriving through
`drawImage`.

### Verified from pixels this time

`@napi-rs/canvas` behind jsdom gives the harness a real rasteriser, so the pass
was checked by rendering frames, not by reading the code:

* `player_knight_idle` — upright stance, slate-steel armour, gold crossguard,
  sword point-down at the side; no lunge, no white bones.
* `player_mage_idle` — indigo body with cyan highlights.
* `run_strip` — six consecutive frames of the stride, feet alternating.
* `crosshair` — 8× crop: white arms, hollow centre, red pip.
* `enemies_row` — `vanguard` → slimes, `sniper` → eyeballs, one creature each,
  bodies separated, no portals.
* `floor` — flat `#16181d` with 2×2 `#1d2027` / `#0f1115` speckle, no banding.

Harness after the pass: boot OK, 163 clips, 144.4 MB, six universes, seven
classes × twelve actions, boss, level-up, death — **ALL CHECKS PASSED**, `0
forbidden primitive calls over 300 frames`, 353 `drawImage`/frame at 12 enemies.

## 11d · Round four: combat input, weather ceiling, seamless floor

### A · Abilities and attacks: what was actually wrong

The listeners were wired; three separate things were swallowing the input, and
one thing was hiding it:

1. **The cast gate.** `hasAbility(slot)` read `gameState.unlockedAbilities`,
   which `syncAbilityUnlocks()` fills from `bossesDefeatedCount()`. On a fresh
   run that is zero, so **E, SHIFT, F and R returned before doing anything** —
   four of the five combat keys were dead until the second boss. They are now
   live from the first frame: `hasAbility()` answers true for any slot the class
   defines, and the unlock ceremony still runs (it just is not a gate).
2. **`pointerdown` was the only trigger path.** Touch emulation, a pen, or an
   overlay that eats the pointer all leave `game.mouse.down` false, and the
   primary attack reads exactly that flag. A `mousedown` listener now sets the
   same flag (and `onPointerMove` with it, so the aim follows), `pointercancel`
   clears it, and a stuck trigger can no longer outlive a lost pointer.
3. **Keys were matched on `e.key` only.** A non-US layout or an IME can change
   it. `e.code` (`KeyQ`, `KeyE`, `KeyF`, `KeyR`, `ShiftLeft/Right`) is accepted
   alongside it.
4. **The HUD lied.** `syncAbilityHud()` repaints the cooldown ring, and the
   keyboard path never called it — pressing Q burned the cooldown while the
   button still read "ready", which is exactly how an ability that *is* on
   cooldown feels broken. Every cast path now repaints: the engine wraps
   `castAbilitySlot`, so keyboard, HUD button, gamepad and touch all get it.

### B · Every cast sets the animation state

`PLAYER.animationState` reports `{ clip, move, kind, t, busy }` — the baked clip
key, the pixelfx move id behind it, and whether it is `lmb`, `dash`, `ability`
or `locomotion`. Verified by driving the real DOM events:

| input | clip | move | kind |
|---|---|---|---|
| LMB (mage) | `act:mage:lmb` | `moves/fireball-throw` | `lmb` |
| LMB (knight) | `act:knight:lmb` | `moves/sword-combo` | `lmb` |
| Q | `act:<cls>:alt` | class secondary | `ability` |
| SHIFT | `act:<cls>:dash` | `moves/dash-strike` | `dash` |
| E / F / R | `act:<cls>:alt` | class secondary | `ability` |

Two details make it *visible* rather than theoretical. Cast poses are
**forced** (`playMove(..., true)`): queueing an ability behind a swing that is
already playing is what made a cast look like nothing happened. And a dash is
now a **first-class clip** (`act:<class>:dash`, seven sheets, baked up front)
instead of borrowing the secondary performance, so Shift shows the same
dash-strike for every class — with `arcane/blink-in` spawned on the teleport
classes (`mage_blink`, `shadow_vanish`, `tech_jet`, and the charge abilities) as
the burst that says the dash landed.

Measured with `node /tmp/combat.mjs mage` driving real `mousedown`/`KeyE`
events: LMB → `moves/fireball-throw`, Q → `moves/lightning-call` + Q cooldown
burned, E/F/R → their slot cooldowns start (`#abilities .cooling` 1→4) and the
`--cooldown-angle` on each button counts down, SHIFT → `moves/dash-strike` with
`kind: dash`. `PLAYER.abilityState` exposes the same numbers for debugging.

### C · Weather is a whisper now

Round 3 had already cut the field once (0.4 scale, 0.25 alpha, one particle in
four). That was still a screen full of dark rain and brown leaf chips. The
ceiling is now flat and low:

| knob | round 3 | round 4 |
|---|---|---|
| `WEATHER_TUNE.density` (particles kept at bake) | 0.25 | **0.05** (one in twenty, −80 %) |
| `WEATHER_TUNE.alpha` (overlay ceiling) | 0.25 | **0.15** |
| `WEATHER_TUNE.wash` (static backdrop) | 0.22 | **0.08** |
| field kits (fog, god-rays, eclipse) | density 1, wash 0.6 | **density 0.35, wash 0.22** |
| falling leaves | 0.25 | **0.015** |

`explosions/dirt-explosion` is no longer baked at all: breaking a prop dropped
fistfuls of brown mud that read as clutter. It is an `impact.spark` puff now,
and the clip is gone from the manifest.

### D · The floor cannot tear any more

The banding from round 3 had a second cause beyond the fractional scale: a tile
edge that lands between two device pixels leaves a **1 device px hole**, and the
backdrop behind the floor is `#090a0f` — so at a 1.5–2× CSS zoom those holes
read as thick black lines across the screen, moving with the camera.

`PFXWorld.drawGround()` now composes the floor in device space in three passes,
none of which can leave a hole:

1. **Underlay** — the base tile stretched over the whole canvas plus 2 px of
   bleed, so an uncovered pixel can never be the backdrop colour;
2. **Tiles** — each edge rounded to a whole device pixel, neighbours sharing the
   same rounded edge (no gap, no overlap) and drawn +1 px so the seam is
   covered, extended a full tile past the viewport;
3. **Detail** — the same rule at four times the span.

Still `drawImage` only, so the primitive audit is unaffected: **0 forbidden**
over 300 frames, 305 `drawImage`/frame, 1500 sanctioned (the crosshair).

Verified by hunting for tears directly: 18 frames of sub-pixel camera panning at
three viewport/DPR configurations, scanning every row and column for runs of
backdrop-coloured pixels.

| viewport | DPR | canvas | worst row | worst column |
|---|---|---|---|---|
| 1024×768 | 1 | 1024×768 | 3.9 % | 3.0 % |
| 1440×900 | 2 | 2880×1800 | 3.8 % | 3.5 % |
| 1920×1080 | 1 | 1920×1080 | 3.8 % | 3.9 % |
| 900×600 | 1.5 | 1350×900 | 3.9 % | 3.3 % |

(The residual few percent is the `#0f1115` speck in the tile itself — a torn row
would be ~100 %.) Boot after the pass: **163 clips, 119.3 MB** — 25 MB lighter
than round 3, because the weather sheets are four-fifths empty and the dirt clip
is gone.

## 12 · Known limits / next steps

1. **Visual QA.** Open it on a static server with a network connection (jsDelivr path) and again with `?pfxlow=1`. Watch for: clip origins on the rotated projectiles, the boss scale, and weather tint strength.
2. **`spawn-and-death/*` vs `spawn/*`.** The brief's ids carry a `spawn-and-death/` prefix; upstream has no such directory. Resolved to `spawn/spawn-portal`, `spawn/shatter-death`, `spawn/soul-rise`.
3. **Battlefield UI is fully pixelfx**, but the DOM HUD (hearts, ability bar, shop, cards) is untouched CSS — it was never on the canvas.
4. **Moves are pose-stepped at 10 fps** and interpolate nothing between cells; if motion looks choppy on a 144 Hz display, raise `CFG.actFps` to 12–15 (costs ~6 MB).
5. **`game.player.classId` values** are the host's (`knight, gunslinger, sniper, mage, berserker, shadow, tech`). Unknown ids fall back to `CLASS_ACTIONS.knight`.
6. **Memory** is ~105 MB of canvas at boot on desktop. If that is too much for a target, the low-spec profile is automatic on weak devices; the next lever is halving the atlas for clips over ~24 000 px.
