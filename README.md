# SURVIVE — The Hollow Street

A **semi-3D (2.5D) side-view action platformer-brawler**: seven classes, a
3600 px stone street that recedes to a real horizon, raised decks you can fight
on and drop through, arena gates that slam shut behind you, and a stage boss that
changes phase as it dies — behind a full title → class-select → run → pause →
game-over/victory flow.

No build tools, no bundler, no framework. The page is native ES modules
(`<script type="module" src="./src/main.js">`) so it runs as-is on GitHub Pages,
on `python3 -m http.server`, or anywhere else that serves files over HTTP.

Every visual — fighters, critters, bosses, decks, torches, weather, pickups,
projectiles, damage numbers, HUD ability icons — comes from the vendored
[`patch-gg/pixelfx`](https://github.com/patch-gg/pixelfx) renderer, baked once
into offscreen atlases at boot and blitted with `drawImage`.
`imageSmoothingEnabled` is off on every canvas.

Each clip is baked into an atlas of `content + 4 px` cells — a 2 px transparent
gutter on every side — so sampling one frame can never pull a line of the
neighbouring frame onto a sprite's edge. The character's class palette is
remapped on the frame's **colour plane**, before the glow is composited: after
it, additive light pushes body pixels off their exact palette value and the
fighter turns grey inside his own spell. The crop box is measured from the
composited pixels, so the bloom around an orb, a gem or a fireball stays inside
its frame, and anything below alpha 10 is scrubbed so a glow fades into the floor
instead of ending on a hard 1 px edge.

![frame](docs/media/frame.png)

---

## Running it

```bash
cd /path/to/surviver
python3 -m http.server 8080     # → http://localhost:8080/index.html
```

Any static server works; the only requirement is that `.js` is served as
JavaScript. **Do not open `index.html` from disk** — `file://` makes browsers
refuse ES modules, and the page will tell you so in red.

First boot fetches ~290 modules, then bakes **137 clips** behind a progress bar
that keeps animating; after that a frame is pure `drawImage` blits. The loader
then hands over to the **title screen** — it never drops you straight into the
street.

Add `?dev=1` to the URL to boot with the dev panel open.

### Deploying to GitHub Pages

The site is published from the repository **root**, so every URL lives under a
subpath (`https://juwainhq.github.io/surviver/`). Two rules make that work, and
both are enforced by `npm run test:pages`:

1. **`.nojekyll` must exist at the root.** With the legacy Pages builder, GitHub
   runs Jekyll before publishing, and Jekyll **silently deletes every file or
   folder whose name starts with `_`**. pixelfx ships twenty of them —
   `vendor/pixelfx/src/fx/{arcane,critters,fire,…}/_lib.js` — and every kit imports
   its own `./_lib.js`, so the whole module graph dies at `./src/main.js` with
   `Could not load …/src/main.js — check the path and that the server sends
   JavaScript`, even though `main.js` is served correctly. An empty `.nojekyll`
   next to `index.html` turns Jekyll off and Pages publishes the branch byte for
   byte (including 1.4 MB `legacy-topdown.html` and `docs/`).
   ```bash
   : > .nojekyll        # empty file, committed, beside index.html
   ```
2. **Everything is a relative, exact-case, explicit path.** No `/src/main.js`
   (that resolves to the *user site* root, not `/surviver/`), no extension-less
   specifiers, and no case drift — Pages is a case-sensitive Linux filesystem
   whatever your laptop does. `index.html` loads exactly one module
   (`./src/main.js`) plus its `modulepreload`, and the other 286 modules are
   reached only through `./` / `../` imports.

Verify before you push:

```bash
npm run test:pages      # .nojekyll, subpath safety, exact-case resolution (offline)
```

If the deployed page still fails, the boot guard now probes the deep files on
failure and names the one that 404'd, instead of blaming the entry script.

### If the boot screen does not move

It cannot stay silent: an inline guard in `index.html` runs before the engine and
writes the reason into `#bootMsg`.

| What you see | What it means |
|---|---|
| amber `Opened from file://` | you double-clicked the file — serve it instead |
| red `Could not load …/src/main.js` | wrong server root, a 404, or a server sending `text/plain` for `.js` — the guard probes deeper and names the file that actually failed |
| red `HTTP 404 on …/_lib.js` | GitHub Pages ran Jekyll and stripped the `_`-prefixed kits: commit an empty `.nojekyll` at the repo root |
| red `Boot error: …` | a throw inside a module, with the file, line and full path |
| amber `Still loading the engine modules (6s)…` | the ~290 module requests are slow (proxy/network); it is working |
| red `Engine never started after 20 s` | the module graph never arrived — DevTools (F12) → Network lists every request |
| red `Baked N clips, M failed` | one manifest failed to bake; the rest of the game still boots |

---

## Game flow

`game.screen` is the single source of truth, and one function
(`ui.setScreen(name)`) owns every transition:

```
boot ──► title ──► classSelect ──► playing ──► paused
                          ▲            │  ▲        │
                          └────────────┘  └────────┘
                                  │
              cards ◄─────────────┤
                                  ├──► gameover  (hp 0)
                                  └──► victory   (every gate open + warden down)
```

| Screen | What is on it |
|---|---|
| **Title** | `[PLAY] [SELECT CLASS] [SELECT UNIVERSE] [CONTROLS]` over the *live* street: the camera pans across the parallax, torches flicker, weather falls |
| **Class select** | 7 pixel-framed cards · a live `act:<cls>:idle` canvas preview (click it to play that class's attack clip) · name, HP pips, weapon style · a breakdown of all four abilities plus Ground/Air LMB · the universe strip `1–6` · `[DEPLOY]` |
| **Paused** (ESC) | `[RESUME] [CHANGE CLASS] [RESTART STAGE] [CONTROLS] [MAIN MENU]` |
| **Game over** | a death burst first, then **YOU FELL** with kills / max combo / level and `[RETRY] [CHANGE CLASS] [MAIN MENU]` — no silent respawn |
| **Victory** | **STAGE CLEARED** with the run summary and `[NEXT UNIVERSE] [PLAY AGAIN]` |
| **Cards** | the Data Chip draft after a gate clears (`1` / `2` / `3`) |

The HUD fades out on every screen that is not `playing`. `ESC` toggles pause;
`Enter`/`Space` confirms on the menus; `1–7` pick a class on the class screen
(and while the dev panel is open).

---

## The 16-bit UI

Everything is a **forged-iron plate**: a 2 px dark step, an iron bevel, an inner
top highlight, an inset bottom shadow and a hard drop shadow — no rounded
corners, no blur, and `--accent` (the universe's, or the class's, colour) on the
trim.

| Rule | Why |
|---|---|
| Press Start 2P is used **only at 10–18 px** (titles, numbers, keycaps) | 6/7 px pixel type is illegible at 1× |
| Body copy, blurbs, run summaries use an 11–12 px **bold monospace** (`Silkscreen` first) | readable when the pixel font has not loaded |
| The four ability slots are `<canvas>` thumbnails | each one is the **mid-frame of that slot's baked pixelfx clip**, blitted with `imageSmoothingEnabled = false` — real pixels, not CSS bars |
| `#hint` and `#lmbTip` are gone | the live HUD is HP crests, class/level/XP, the wave tag, the boss bar and the four slots |
| `#devToggle` is hidden until the panel opens | `` ` `` / `~`, or `?dev=1` |

---

## The stage

The viewport splits at a **46 % horizon**: sky above, walkable street below.

| Layer | Scroll | What it is |
|---|---|---|
| Sky | — | Baked gradient, stars/nebula, moon or sun with halo |
| Far skyline | **0.25×** | Mountain cones and silhouettes |
| Mid skyline | **0.42×** | Castle towers, keeps and ruins (kept clear of the moon) |
| Back wall | **0.75×** | Stone battlement: courses, blind arches, columns, animated `fire/brazier` torches |
| Curb | 1.0× | The stone lip that marks the horizon |
| Street | 1.0× | Perspective paving: converging joints, per-tile shading, depth haze |
| Decks | 1.0× | Raised slabs with an **angled 3D top face**, a cut front face, a lit lip, iron brackets to the street and a cast shadow |
| Actors | 1.0× | Depth-sorted by `y` every frame, so you can stand in front of *or* behind a deck |

The street spans **`STAGE_W = 3600`**, decks hang at **`z = 75 … 155`** with a
deck depth of **`FLOOR_H × 0.28`**, and three **arena gates** lock the road when
you walk in — amber barrier columns at both edges, camera clamped between them,
dissolving with a blinking `GO →` when the wave is dead.

### Projection is 1:1

A deck is drawn at the **raw** `x - game.cam.x` for both its far and near edge —
no horizontal `spread` squash against the viewport centre. If you can stand on
it at world `x`, it is drawn at screen `x - cam.x`, so the fighter's feet always
land on the pixels of the deck. The 3D read comes from the tapered far edge, the
cut front face, the brackets and the shadow — never from moving the surface.

---

## Coordinates and physics

```
x    along the street        (0 … 3600)
y    across the depth lane   (FLOOR_TOP … FLOOR_BOTTOM)
z    height above the street (0 = grounded)
```

Actors are blitted at `(x, y - z·s)` with a contact shadow drawn **on the surface
they are standing over** (`y - groundZ·s`) that shrinks and fades as
`z - groundZ` grows. `s = depthScale(y) = lerp(0.86, 1.04, v)`.

| Constant | Value |
|---|---|
| `SPEED_X` / `SPEED_Y` | 268 / 200 (diagonals are normalised) |
| `ACCEL` / `DECEL` / `AIR_CONTROL` | 2100 / 2600 / 0.72 |
| `JUMP_VZ` / `DOUBLE_JUMP_VZ` | 580 / 545 |
| `GRAVITY` | 1550 |
| `JUMP_BUFFER` | 0.12 s — a press just before landing still jumps |
| `COYOTE_TIME` | 0.10 s — leaving a ledge keeps the jump |
| variable jump | releasing early cuts the rise (`vz ×= 0.55`) |
| `HITSTOP` | 0.04 s (+ camera punch) |
| hit tolerance | `DEPTH_TOL 44` / `HEIGHT_TOL 60` / melee `75` |
| horizon | 46 % of the viewport |

Landing is solved against the deck under you: it only catches you when you are
falling onto its top face with your depth `y` inside its footprint. **S + SPACE**
drops through it. `peakZ` is tracked, so a fall from height always lands as a
heavy landing (dust + shake) no matter how short the last frame was.

The camera follows the fighter **up**: `cam.y = clamp((z - 75) × 0.35, 0, 90)`
shifts the world down as you climb, and a resize re-clamps `y` back into the
lane.

### Grips and poses

`stanceMod()` bakes `act:<class>:idle / run / jump / fall` for all seven rigs
(the body plays **jump** while `vz > 40`, **fall** while `vz <= 40`). The legs,
the carriage and the head are shared pose data; the **arms are not**. Each class
carries its own grip, copied from the kit that animates that weapon, so a
fighter at rest holds the weapon exactly the way his attack does:

| Class | Weapon | Grip, and where it comes from |
|---|---|---|
| Knight | `sword` | `melee/sword-slash` **GUARD** — blade up and forward (`fx 12, fy -21, sa -0.85`) |
| Berserker | `greatsword` | `melee/heavy-cleave` **REST_** — two-handed, blade back over the shoulder (`sa -1`) |
| Gunslinger | `pistol` | `moves/pistol-shots` **REST_** — low ready (`sa 0.9`); aims in the air (`sa 0.15`) |
| Sniper | `bow` | `moves/arrow-shot` **REST_** — bow across the body (`sa -0.4`); draws aloft |
| Tech | `launcher` | `moves/rocket-launcher` **REST_** — tube shouldered, both hands (`sa -1`) |
| Chrono Mage | *none* | `moves/fireball-throw` **HOLD** — bare hands; the air pose is `lightning-call`'s **UP** |
| Assassin | `dagger` | `melee/dagger-flurry` **BASE**, rolled to a crouched reverse grip (`sa 2.2`) |

`sa` is the weapon axis: **negative** tips the blade up and back, **positive**
drives it forward and down. There is no shared `sa: 1.15` — that rammed every
blade out horizontally. The mage holds nothing at all: the old `handle` weapon
read as a stubby brick in his fist.

---

## Firing, aiming and abilities

* **The body is always a rigged act clip.** A `moves/*` kit animates the rig
  itself; every other effect (`melee/uppercut`, `shadow/void-orb`,
  `scifi/force-field`, `status/rage`, …) is drawn as a **world VFX overlay** while
  the character holds a baked *cast* pose. Nothing ever replaces or hides the
  fighter — Berserker, Assassin, Tech, Knight-Q, Mage-SHIFT, Sniper-SHIFT and
  Sniper-E all keep their sprite on screen.
* **Hold LMB to chain.** Melee combos and ranged fire both repeat from
  `game.mouse.down` as soon as the act ends. Facing never flips mid-swing.
* **Ranged fires at 12 % of the act; melee at 28 %.**
* **Cursor-true 2.5D aiming.** The shot leaves the hand toward
  `(mouseX + cam.x, mouseY)` — screen `y` is inverted back into a height at the
  fighter's lane — inside a clamped cone, with a gentle aim assist that snaps to
  the nearest valid target in front of you. Grounded players can hit Bats,
  Eyeballs and Skulls hovering overhead.
* **Melee is forgiving vertically** (`HEIGHT_TOL 75`) so you can swat what is
  above you.
* **Air Slam** (`GROUND POUND`, `HAMMER SMASH`): `vz = -720`, and the shockwave
  resolves on **landing**, not in mid-air.
* **Gunslinger Q** lobs a grenade on a real arc (`vz ≈ 340`) that bounces once,
  then detonates.
* **Tech LMB** throws a bouncing `projectiles/energy-disc` (`kind: 'disc'`): it
  skips along the deck, passes through targets and sparks
  `impacts/bullet-impact` on each.
* **Rail beams always render**, hit or miss; a `def.strike` telegraph is drawn on
  every target it touches regardless of the skill's `kind`.
* **Assassin marks**: Q sets `e.marked = 4`; each following hit deals **×1.75**
  and shows the `impacts/crit-hit` spark.
* A dash resolves its damage exactly **once**.

Audio is wired to the action: `jump`, `land`, `lmb`, `cast`, `hit`, `crit`,
`kill`, `pick`, `gate` (lock + open), `hurt` and `die`.

---

## The four-slot kit

Every class has **LMB** (a different move in the air), **SHIFT** (mobility,
2.5–4 s), **Q** (tactical, 4–6 s), **E** (heavy, LV 3, 8–12 s) and **R**
(ultimate, LV 5). A cast animates the rig on its own baked clip, fires its
pixelfx performance, applies hit-stop + shake when it lands hard, floats a
callout, and starts a white pixel countdown (`4.2s`) on its slot.

The ultimate is not a timer: it charges **+8 % per hit** and **+15 % per kill**,
glows gold at 100 %, and empties when used.

| Class | LMB / Air | SHIFT | Q | E · LV 3 | R · LV 5 |
|---|---|---|---|---|---|
| **Vanguard Knight** | `moves/sword-combo` · `moves/ground-pound` *(air slam)* | `moves/dash-strike` | `melee/uppercut` *(launch 430)* | `moves/earth-stomp` + `nature/quake` | `moves/holy-smite` + `holy/holy-pillar` |
| **Gunslinger** | `moves/pistol-shots` + `projectiles/bullet-tracer` | dodge roll + `explosions/smoke-bomb` | `explosions/grenade` *(arc + 1 bounce)* | `moves/rocket-launcher` + `explosions/big-explosion` *(recoil)* | `projectiles/muzzle-smg` × 8 |
| **Chrono Mage** | `moves/fireball-throw` + `arcane/arcane-orb` | `arcane/blink-out` → `blink-in` | `moves/ice-lance-throw` + `ice/freeze` | `moves/lightning-call` + `lightning/chain-lightning` | `moves/meteor-call` + `arcane/time-stop` |
| **Rift Sniper** | `moves/arrow-shot` + `projectiles/laser-bolt` | `scifi/warp-out` → `warp-in` | `scifi/laser-grid` *(snare)* | `arcane/arcane-beam` *(rail)* | `scifi/emp-blast` + `lightning/lightning-strike` |
| **Berserker** | `melee/heavy-cleave` · `melee/hammer-smash` *(air slam)* | berserk leap (`moves/ground-pound`) | `melee/spin-slash` | `moves/ground-pound` + `fire/fire-ring` | `status/rage` + `fire/fire-tornado` *(+40 % damage)* |
| **Shadow Assassin** | `melee/dagger-flurry` | `shadow/shadow-flames` blink | `shadow/grasping-hands` *(root + mark)* | `shadow/void-orb` + `shadow/dark-explosion` | `shadow/black-hole` + `shadow/necro-skulls` |
| **Tech Specialist** | bouncing `projectiles/energy-disc` | `scifi/jetpack` boost | `scifi/force-field` *(dome)* | `scifi/tractor-beam` + `explosions/plasma-explosion` | `scifi/energy-core` + `explosions/nuke` |

**Progression** — `XP_STEPS = [0, 6, 16, 30, 50]` → **LV 5**; E opens at LV 3,
R at LV 5. Clearing an arena gate drops three **Data Chip** cards (pick one with
a click or `1` / `2` / `3`): extra HP, +15 % damage, +10 % speed, +25 % ultimate
charge or −20 % cooldowns.

---

## Enemies & bosses

| Enemy | Kit | HP / speed | Behaviour |
|---|---|---|---|
| Slime | `critters/slime` | 8 / 58 | Hops along the lane |
| Frog | `critters/frog` | 9 / 74 | Long hops |
| Bat | `critters/bat` | 6 / 104 | Flies at `z 60–110` |
| Eyeball | `critters/eyeball` | 7 / 86 | Hovers, tracks you |
| Flying skull | `critters/flying-skull` | 10 / 92 | Weaves and dives |
| **The Hollow Warden** | `critters/ghost` + rune circle | `110 + 12 × LV` | Stage boss with three phases |

Death is not one animation for everyone. `spawn/shatter-death` is a **humanoid**
dummy bursting apart, so it is reserved for the player: a slime or a bat dying
that way used to read as a person standing inside the critter. Regular critters
now die as their own kind — a `spawn/poof` cloud and an `impacts/hit-spark`
baked in the creature's own ramp (toxic green for slime/frog, violet for
bat/eyeball/skull), or `ice/ice-shatter` + `ice/freeze` if they died while
`snare > 0`. The Warden goes up in `explosions/big-explosion` ×3 plus a
`shadow/dark-explosion`, and no statue either.

The warden is a real fight: **phase 1** hurls three-bolt volleys, **phase 2**
widens the spread and slams the street, **phase 3** speeds up and summons a
skull escort — each shift announced with a banner, a blast and a camera kick.
Killing it with every gate already open raises **STAGE CLEARED**.

| # | Arena | Waves | Pool |
|---|---|---|---|
| 0 | **THE LOWER STREET** | 2 | slime, frog |
| 1 | **THE BROKEN STAIR** | 3 | slime, frog, bat, eyeball |
| 2 | **THE HOLLOW GATE** | 2 + boss | bat, eyeball, skull, frog |

---

## Six universes

`setUniverse(i)` repaints the sky, both skylines, the wall, the paving and the
weather in one frame — and re-tints `--accent`, so the menus follow. Weather is
capped at **0.18 alpha** so it never hides the fight.

| # | Universe | Body | Weather |
|---|---|---|---|
| 1 | **MEDIEVAL 1347** | moon | `weather/rain` |
| 2 | **ANCIENT EGYPT** | sun with rays | `weather/fog` |
| 3 | **FEUDAL JAPAN** | blood moon | `weather/cherry-blossoms` |
| 4 | **POST-APOCALYPSE** | dust sun | `weather/storm` |
| 5 | **DEEP SPACE** | ringed planet | `weather/shooting-stars` |
| 6 | **THE VOID** | eclipse + nebula | `weather/aurora` |

---

## Controls

| Input | Action |
|---|---|
| **A / D** | run along the street |
| **W / S** | move across the depth lane |
| **SPACE** | jump · again in the air for a double jump · hold for height |
| **S + SPACE** | drop through the deck under you |
| **LMB** | ground attack · air attack while airborne · **hold to chain** |
| **cursor** | aim — shots fly from the hand to the pointer |
| **SHIFT** | mobility (dash / roll / blink / warp / leap — invincible while it runs) |
| **Q / E / R** | tactical · heavy (LV 3) · ultimate (LV 5) |
| **ESC** | pause / resume |
| **1 / 2 / 3** | pick a Data Chip when a draft is open |
| **1 – 7** | pick a class on the class screen (or with the dev panel open) |
| **`** or **~** | open / close the dev panel |

### Dev panel

`[Class]` (all seven) · `[Universe 1–6]` · `[+1 Level]` ·
`[Unlock All + Fill Ult]` · `[God Mode]` · `[Spawn Wave]` · `[Spawn Boss]` ·
`[Reset Cooldowns]` · `[Wipe Map]`. It is hidden until you ask for it, and the
`[DEV]` toggle only appears while it is open.

The same actions are on `window.__SURVIVE`: `setClass`, `setUniverse`, `unlockAll`,
`toggleGod`, `spawnWave`, `spawnEnemy`, `devBoss`, `resetCds`, `wipeMap`,
`openCards`, `takeCard`, `castSlot`, `basicAttack`, `gainXp`, `gainUlt`,
`hurtPlayer`, `setScreen`, `startStage`, `pauseGame`, `resumeGame`,
`showGameOver`, `showVictory`, `tickMenus`, `step`, `state`.

---

## Verification

Five harnesses, all runnable from the repo root:

```bash
npm install                       # jsdom, once (inside tools/pfx-harness)
npm test                          # behaviour: imports src/main.js, 154 checks
npm run test:guard                # the boot guard: file://, throws, 404 probe, DevTools hint
npm run test:pages                # deployment: .nojekyll + subpath-safe, exact-case graph
npm run test:graph                # walks the module graph over HTTP (+ cycle check)
npm run test:browser              # cold boot over HTTP, then link and boot
node /tmp/render13.mjs /tmp/r13   # optional: PNG frames via @napi-rs/canvas
```

```
npm test              → 154 checks · --- ALL CHECKS PASSED ---
npm run test:guard    →  14 checks · --- ALL CHECKS PASSED ---
npm run test:pages    →  15 checks · --- PAGES OK ---
npm run test:graph    → 287 modules · acyclic yes · 0 problems
npm run test:browser  → linked 1.9 s, boot 7.1 s · 137 clips · title → PLAY verified · --- BROWSER BOOT OK ---
```

`npm test` also pins the art rules from the rig work: six classes carry their
authored grip and the mage carries none, `sa: 1.15` is gone, every class bakes
its four locomotion stances plus a rigged cast body for every non-`moves/*`
slot, `remapBody()` swaps an exact palette pixel but leaves a glow-shifted one
alone (the reason the body palette is remapped *before* `core.composite()`),
every atlas cell is `content + 4 px`, critter deaths never spawn
`spawn/shatter-death`, a frozen critter dies in ice, the boss dies in
explosions, and the mage's orb spawns `x + dirX · 36` clear of his torso.

`test:pages` is the one that has to stay green for the deployed site: it fails if
`.nojekyll` disappears from the root, if anything in `index.html` is root-absolute,
if an import specifier is bare/extension-less/case-drifted, or if two tracked files
differ only by case.

`test:browser` is the one that behaves like a real browser: it registers an ESM
loader that fetches every module over HTTP and **refuses anything not served as
JavaScript** — the rule that silently kills module scripts — then links the graph
and boots the page, asserting the overlay dismisses, the bar reaches 100 %, the
seven class chips exist, the bake reports, a frame renders and the console stays
clean. `test:graph` is the same audit without a DOM — plus a DFS that proves the
import graph is **acyclic** — so it can be pointed at any deployment.

`npm test` fails on: a boot error, an unresolved effect id, any of the 7 classes ×
4 slots failing to animate *on a rigged body clip*, a body that gives way to a
VFX id, a hit that deals no damage, a heavy hit without exactly 40 ms hit-stop, a
jump that ignores its buffer or coyote window, a platform drawn with a viewport
squash, a shot that cannot hit a hovering flier, an air slam that does not drive
down, a disc that is not a disc, a rail that does not render when it whiffs, a
dead menu button, a broken wave count, a card draft that will not open, a boss
that will not die, a death that respawns silently, a victory screen that never
appears, or a HUD slot without its countdown.

World pixels were verified separately against a real rasteriser
(`@napi-rs/canvas`): frame-1 sky, a fighter standing exactly on a deck, jump and
fall poses, all seven classes idle, a cursor-aimed shot at a hovering bat, a
cast-pose body that stays on screen, and an air-slam impact.

---

## Layout

```
.nojekyll                  empty marker: stops GitHub Pages running Jekyll (keeps vendor/…/_lib.js)
index.html                 page shell: canvas, pixel HUD, title/class/pause/over/win screens, dev panel
src/main.js                loop, input, audio blips, depth-sorted render list, boot + bake
src/core.js                constants, viewport, shared state, screen enum, math helpers (imports nothing)
src/pfx.js                 pixelfx loader + id verification + atlas baker + stances + thumbnail blitter
src/world.js               six universes, parallax, wall, street, decks, gates, weather, camera, shadows
src/classes.js             seven classes, the 4-slot kit, aiming, z-axis combat, physics
src/enemies.js             critters, boss phases, wave spawner, arena flow
src/ui.js                  screen machine, menus, HUD, ability bar, callouts, Data Chip cards, dev panel
vendor/pixelfx/            the vendored renderer (unmodified)
tools/pfx-harness/         jsdom + HTTP verification harnesses
legacy-topdown.html        the previous top-down engine, kept for reference only
platformer-test.html       the earlier side-scrolling prototype, reference only
```

Module graph (strictly one-way, verified acyclic):

```
core → pfx → world → classes → enemies / ui → main
```

`core.js` also exposes a `bus` for the handful of upward notifications
(`banner`, `callout`, `number`, `deny`, `hud`, `dev`, `cards`, `go`, `audio`,
`startArena`, `nextWave`), which is what keeps `classes` from importing `ui`.

---

## Credits

Renderer: [`patch-gg/pixelfx`](https://github.com/patch-gg/pixelfx), vendored
under `vendor/pixelfx`, unmodified.
