# SURVIVE — Commander Rael and the Six Rifts

A time-travel action roguelike that ships as **one `index.html`** (no build step, no
bundler, no framework). You are Commander Rael, thrown out of a burning ship and
into six collapsing eras, fighting from 1347 AD to the end of time.

The render + combat engine has been rebuilt on
[`patch-gg/pixelfx`](https://github.com/patch-gg/pixelfx): every entity,
projectile, particle, pickup and battlefield UI element is a pixelfx module baked
into an offscreen atlas and blitted with `drawImage` — **no primitive canvas
drawing anywhere in the battlefield path** (the single exception is the 2 px aim
reticle). `imageSmoothingEnabled` is off everywhere, so everything reads as
16-bit pixel art.

---

## Latest updates

| Area | What changed |
|---|---|
| **Rendering** | Full pixelfx overhaul: 9 painter layers, ~165 baked clips across 24 categories, z-sorted 2.5D (jump/gravity/ground-pound), class-palette tinting on the skeletal rig, six themed floors and weather fields |
| **Retro UI skin** | `#pfx-retro-ui`: pixel font, hard 2 px edges, slab panels, no glows — applied to the HUD, menus, cards and shop, with the cooldown readout explicitly allowed to keep its black outline |
| **Ability system** | One gatekeeper (`castAbilitySlot`) for every trigger, level-based unlocks (LMB/SHIFT from LV 1, Q 3, E 5, F 10, R 15), padlock + `LV3`-style badges, 0.2 s white/gold slot flash, draining cooldown fill with a live `3.4s` pixel-font timer, floating callout + camera punch on heavy casts |
| **Combat feedback** | Real pixelfx performances per class (`moves/sword-combo`, `moves/fireball-throw`, `moves/lightning-call`, `moves/dash-strike`, …) that return to an upright idle/run stance the moment the swing ends |
| **Developer Admin Panel** | Hidden overlay (`#devPanel`, `` ` `` / `~` / `?dev=1` / DEV chip): levels, cooldowns, god mode, class swap, universe jump, swarm, boss, wipe |
| **Effect-ID audit** | Every manifest id is checked against `vendor/pixelfx/src/fx/index.js`; unresolved keys warn once and fail the harness instead of failing silently |
| **Mobile** | Twin-stick touch layer: left stick moves, right stick aims and fires, ability/satchel icons are tappable; aim converts world → screen correctly |
| **Fixes** | Two unclosed `<style>` tags, duplicate CSS rules, duplicate how-to-play row, duplicate `color:` declaration, stuck-trigger release, touch-aim coordinate space |

---

## How the game works

**Core loop, per zone**

1. **Explore** a 6000 × 6000 zone — fog of war, props, destructibles, patrolling enemies.
2. **Clear 3 arenas** in any order (each is 3 waves, with a marked arena ring).
3. **Defeat the zone boss** — the champion spawns at its arena once all three are clear.
4. **Enter the rift portal** the boss leaves behind → next zone, or the next universe.

**Six universes, five zones each** (30 zones, 30 bosses)

| # | Universe | Era | Zones | Zone boss (final) |
|---|---|---|---|---|
| 1 | Medieval — *The Shattered Kingdom* | 1347 AD | The Ashen Hamlet · Blightwood Thicket · Garrison Portcullis · Astral Belfry · The Siege | **The Black Knight** |
| 2 | Ancient Egypt — *The Sun That Never Sets* | 2500 BC | Sunken Obelisk · Valley of Jackals · Sandstone Catacombs · Temple of Anubis · Solar Pyramid Core | **The Pharaoh** |
| 3 | Feudal Japan — *The Last Blossom* | 1600 AD | Bamboo Outpost · Weeping Shrine · Iron Tenshu Keep · Blood Moon Courtyard · Torii of the Abyss | **Shogun Kage** |
| 4 | Post-Apocalypse — *The Rust Between Stars* | 2087 AD | Scorched Overpass · Dead-Zone Refinery · Scrap Titan Boneyard · Reactor Crater · Vault Zero Silo | **Warlord Rex** |
| 5 | Deep Space — *The Hive at the Edge* | 3500 AD | Derelict Hangar · Cryo-Pod Deck · Orbital Rail Spine · Xeno-Bio Lab · Singularity Engine | **The Hive Queen** |
| 6 | The Void — *End of Time* | — | Shattered Chronos · Echoes of Rael · Null-Gravity Sanctum · Paradox Citadel · Throne of Oblivion | **The Architect of Oblivion** |

Each universe brings its own enemies (4 archetypes), floor tile, prop set, sky,
weather field, palette and boss kit. Difficulty scales per universe, and each
zone beyond the first of a universe adds enemy speed and health.

---

## Classes & progression

**Seven classes** — four are starter doctrines, three are bought from the Armory
(*Orders* tab) and stay unlocked forever.

| Class | Weapon | Fantasy | Q ability | Starter? |
|---|---|---|---|---|
| **Vanguard Knight** | Longsword arc | 7 health orbs, forgiving | Shield Bash | ✅ free |
| **Gunslinger** | Twin piercing pistols | Fastest fire rate | Bullet Storm | ✅ free |
| **Sniper** | Screen-long rail beam | One-shot lines | Railgun | ✅ free |
| **Chrono Mage** | Three homing time orbs | Screen control | Temporal Rift | ✅ free |
| **Berserker** | Dual energy axes | 3 HP, huge damage | Rage | 300 gems |
| **Shadow Assassin** | Shadow daggers | Burst and reposition | Death Mark | 400 gems |
| **Tech Specialist** | Bouncing disc + turrets | Zoning | System Overload | 500 gems |

**Permanent, per-class progression.** Every class keeps its own **XP, level (max
**20**) and skill tree** across runs, zones and universes, saved in `localStorage`.

* XP: regular enemy **10** · elite (Oni, Mutant, Mech, Chaos Titan) **25** · boss **150**.
* **1 Skill Point per level**, plus a bonus SP at **5 / 10 / 15** → **22 SP** lifetime.
* **3-row skill tree**, unlocked left-to-right; tiers cost **1 / 1 / 2 / 3 SP** and
  require class levels **2 / 5 / 10 / 15**.

**Ability unlock levels** (one rule, everywhere — HUD, how-to-play and input):

| Input | Ability | Unlocks |
|---|---|---|
| **LMB** | Primary attack (class weapon) | Level 1 |
| **SHIFT** | Dash / mobility (class charge or roll) | Level 1 |
| **Q** | Class ability (`cls.q`) | Level 3 |
| **E** | Ability 2 (nova / burst / shot) | Level 5 |
| **F** | Ability 3 (turret / mines / war cry) | Level 10 |
| **R** | Ability 4 (storm / overcharge / eagle eye) | Level 15 |
| **1 / 2 / 3** | Satchel supplies | always |

Locked slots show a dimmed icon, a padlock and a badge (**LV3 / LV5 / LV10 /
LV15**); pressing the key does nothing at all — no cooldown burn, no animation.
The Dev Panel's `[Lv MAX + Unlock All]` opens everything for testing.

**In-run Data Chips.** Clearing arenas drops a choice of **20 chips in four
families** (Offensive, Defensive, Utility, Unique) — Plasma Amplifier, Arc
Cannon, Chain Lightning, Vampiric Strike, Temporal Shield, Phase Cloak, Gem
Magnet, Reactor Coils, Second Wind, Chrono Surge and friends. They live for the
run only.

**The Armory** (between runs, paid in gems):

| Tab | What it sells |
|---|---|
| **Enhancements** | Permanent, multi-rank stat upgrades (damage, fire rate, armour, magnet, luck) |
| **Provisions** | Consumables for the satchel slots (1 / 2 / 3) |
| **Livery** | Cosmetic armours and palettes, including Void Walker |
| **Companions** | Pets that fight alongside you |
| **Orders** | The three unlockable classes: Berserker, Shadow Assassin, Tech Specialist |

---

## Controls

**Desktop**

| Input | Action |
|---|---|
| `W A S D` / arrows | Move |
| Mouse | Aim (the reticle is a 2 px white cross with a 2×2 red pip) |
| **LMB** | Primary attack |
| **Q / E / F / R** | Class abilities (level-gated) |
| **SHIFT** | Dash / mobility |
| **Right-click** | Dash (same gate as SHIFT) |
| `Space` | Jump — LMB in the air ground-pounds |
| `1` `2` `3` | Satchel supplies |
| `Esc` | Pause / settings |
| `` ` `` or `~` | Developer Admin Panel (`?dev=1` also opens it) |

**Mobile / touch**

* Left thumb **moves**, right thumb **aims and fires** (twin-stick, with a dashed aim laser).
* Ability and satchel icons are **tap targets** — they go through the same gatekeeper as the keys.
* Touch mode is detected automatically (or forced with `?touch=1`); the HUD switches to the mobile layout.

---

## Running locally & debug flags

The page loads pixelfx from jsDelivr and falls back to the vendored mirror
(`vendor/pixelfx/`), so it **must be served over http(s)** — ES module imports are
blocked on `file://` (the failure is soft: the overlay clears and the legacy
renderer runs).

```bash
python3 -m http.server 8080
# open http://localhost:8080/index.html
```

| Flag | Effect |
|---|---|
| `?pfxaudit=1` | Marks the battlefield context so primitives are counted; read with `PFX.audit()` |
| `?pfxlow=1` | Forces the low-memory bake profile (fewer frames per clip, ~70 MB instead of ~140 MB). Applied automatically on weak devices |
| `?dev=1` | Opens the Developer Admin Panel on load |
| `?touch=1` | Forces the mobile twin-stick HUD |

**Developer Admin Panel** (`#devPanel`, bottom-right DEV chip, `` ` `` / `~`, or `?dev=1`):
`[+1 Level]`, `[Lv MAX + Unlock All]`, `[Reset Cooldowns]`, `[God Mode: ON/OFF]`,
`[Switch Class]` (all seven, level carried across), `U1…U6` universe jumps,
`[Spawn Swarm]` (20 slimes), `[Spawn Boss]`, `[Wipe Map]`. Dev levels are granted
in memory only — they never touch your save.

---

## 2.5D platformer prototype

`platformer-test.html` is a separate, self-contained proof-of-feel file: a true
semi-3D platformer-brawler sandbox that imports the **local** pixelfx tree
(`./vendor/pixelfx/src/`) directly and shares no code with `index.html`. Same
server, no flags:

```bash
python3 -m http.server 8080
# open http://localhost:8080/platformer-test.html
```

It exists to answer one question — does a perspective lane with real height beat
the top-down arena? — so all six universes, three class kits and the whole enemy
roster are wired to a test bar and nothing else.

* **World** — `STAGE_W` 3200, horizon at 42 % of the viewport. Sky, then a far
  ridge (0.22×) behind a near ridge (0.30×), then mid ruins (0.55×), then a
  crenellated battlement with `fire/brazier` torches (0.75×). The lower 58 % is a
  walkable lane with receding tile rows and a foreground lip.
* **Physics** — every body carries `(x, y, z, vx, vy, vz)`: `x` across the stage,
  `y` depth inside the lane, `z` height over the surface below it. Gravity 1500,
  jump 560 (double jump 520), landing snaps onto a platform top when `vz < 0`
  over its footprint, `S + Space` drops through. Sprites draw at
  `y - z * depthScale(y)`, shadows stay on the ground at `y`, and everything —
  platforms, enemies, the player, VFX, pickups — goes through one painter's list
  sorted by depth every frame.
* **Combat** — pixelfx skeletal acts are pre-baked into offscreen atlases at boot
  (38 clips in ~2.2 s), then blitted. Knight: LMB `moves/sword-combo`, Q
  `moves/earth-stomp`, Shift `moves/dash-strike`, air + LMB `moves/ground-pound`.
  Mage: LMB `moves/fireball-throw`, Q `moves/lightning-call`, E
  `moves/meteor-call`, Shift blink (`arcane/blink-in` + `arcane/blink-out`).
  Gunslinger: LMB `moves/pistol-shots`, Q `moves/rocket-launcher`, Shift
  dodge-roll with a dust puff.
* **Hit tests** — `|dx|` against reach, `|dy| < 42 px` (depth) and `|dz| < 56 px`
  (height), so a jump really does clear a ground slam.
* **Enemies** — `critters/slime` and `critters/frog` hop along the lane,
  `critters/bat`, `critters/eyeball` and `critters/flying-skull` hover at
  `z = 60…110`. `spawn/spawn-portal` on arrival, `impacts/hit-spark` +
  `impacts/crit-hit` with 40 ms hit-stop and camera shake, `ui/damage-number`,
  `spawn/shatter-death`, `pickups/xp-orb` / `pickups/gem-spin`.
* **Weather** — one kit per universe (`rain`, `fog`, `cherry-blossoms`, `storm`,
  `shooting-stars`, `aurora`) at ≤ 0.18 alpha.
* **Test bar** (top right) — Class, Universe 1–6, Spawn Wave, Hitboxes. `A/D`
  move, `W/S` depth, `Space` jump, `S + Space` drop through, `LMB` attack, `Q`
  heavy, `E` mage extra, `Shift` dash.

`window.__PT` exposes `state()`, `step(dt)`, `setClass()`, `setUniverse()`,
`spawnWave()` and the live `game`/`player`/`platforms` objects for console or
harness poking.

---

## Verification

`tools/pfx-harness/` boots the real page in jsdom with a rasteriser and drives it
headlessly:

```bash
cd tools/pfx-harness
npm install
node run.mjs            # add --audit for the primitive audit
```

It covers boot/bake, all six universes, every class action × 7 classes, boss
spawn, level-up freeze and restore, death, and a **primitive audit with a
positive control**, plus an **effect-id audit** against the vendor tree. Current
result:

```
effect ids: 92 unique, 0 unresolved
runtime unresolved keys: []
audit: 0 forbidden primitive calls over 300 frames ({})
audit: 1500 sanctioned calls (the crosshair block)
audit: 304 drawImage/frame at 12 enemies
engine errors: []
--- ALL CHECKS PASSED ---
```

Engine internals, layer order, the 2.5D/animation contracts, weather tuning and
the round-by-round change log live in
[`docs/PIXELFX-ARCHITECTURE.md`](docs/PIXELFX-ARCHITECTURE.md).

---

## Project layout

```
index.html                     the whole game (markup, CSS, engine, game logic)
platformer-test.html           standalone 2.5D platformer prototype (local pixelfx only)
vendor/pixelfx/                vendored pixelfx (src/, LICENSE, NOTICE)
docs/PIXELFX-ARCHITECTURE.md   engine design + verification log
tools/pfx-harness/             headless jsdom + rasteriser test harness
```

## Credits

Rendering built on **[pixelfx](https://github.com/patch-gg/pixelfx)** by
`patch-gg` (MIT — see `vendor/pixelfx/LICENSE` and `NOTICE`).
