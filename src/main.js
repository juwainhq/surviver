/* main.js — entry point.
 *
 * Owns the canvas, the input tables, the audio blips, the depth-sorted render
 * list and the boot pipeline. Everything it draws comes from the modules below
 * it, so this is the only file that knows the whole game.
 */
import {
  FLOOR_BOTTOM, FLOOR_TOP, H, JUMP_BUFFER, W, STAGE_W, bus, clamp, ctx, game, input, keys, rand,
  setCanvas
} from './core.js';
import {
  ACTION_KEY, CLIPS, MISSING, PALETTES, bake, drawFxOne, riggedClip, updateFx, verifyIds
} from './pfx.js';
import {
  ARENAS, drawArenaLock, drawFloor, drawParallax, drawPlatform, drawWeather, placePlatforms,
  platforms, setUniverse, uni, updateArena, updateCamera, wallCache, buildSky
} from './world.js';
import {
  CLASSES, CLASS_IDS, basicAttack, castSlot, drawBolt, drawPickupOne, drawPlayer, gainUlt,
  gainXp, hurtPlayer, lockedSlots, player, resetPlayer, respawn, updateAnim, updateBarrage,
  updateBolts, updatePickups, updatePlayer, updateTexts
} from './classes.js';
import { ENEMY_TYPES, drawEnemy, nextWave, spawnEnemy, spawnWave, startArena, updateEnemies } from './enemies.js';
import {
  addNumber, banner, bindArenas, buildBootClasses, buildDevBar, callout, cardsVisible, closeControls,
  controlsVisible, denySlot, devBoss, devOpenState, devWave, drawCombo, drawCrosshair, drawTexts,
  markDev, openCards, pauseGame, resetCds, resumeGame, setClass, setScreen, showGameOver, showGo,
  showVictory, startStage, syncHud, takeCard, tickGo, tickMenus, toggleDev, toggleGod, unlockAll,
  wipeMap
} from './ui.js';

/* ----------------------------------------------------------------- canvas */

const stage = document.getElementById('stage');
setCanvas(stage);

/* the module graph is live: say so, so a silent boot screen is never ambiguous */
const bootMsgEl = document.getElementById('bootMsg');
if (bootMsgEl) { bootMsgEl.className = 'ok'; bootMsgEl.textContent = 'engine modules loaded · building the stage…'; }

/* ------------------------------------------------------------------ audio */

/**
 * Tiny WebAudio blip bank — no files, no samples: each cue is a two-oscillator
 * square blip through a fast decay. Muted until the first user gesture, which is
 * the browser's rule anyway.
 */
const audio = (() => {
  let actx = null;
  const cues = {
    cast: [520, 660, 0.06], hit: [220, 180, 0.05], crit: [880, 1320, 0.05],
    kill: [180, 90, 0.12], level: [660, 990, 0.14], card: [740, 1100, 0.1],
    pick: [900, 1400, 0.06], gate: [300, 620, 0.16], hurt: [150, 70, 0.12],
    /* movement + feedback cues, so every action in the game has a voice */
    jump: [430, 620, 0.07], land: [150, 64, 0.1], lmb: [320, 240, 0.04],
    deny: [180, 140, 0.08], die: [220, 60, 0.22]
  };
  const unlock = () => {
    if (!actx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (C) actx = new C();
    }
    if (actx && actx.state === 'suspended') actx.resume();
  };
  const play = (kind) => {
    if (!actx || actx.state !== 'running') return;
    const c = cues[kind] || cues.cast;
    const t0 = actx.currentTime;
    const g = actx.createGain();
    g.gain.setValueAtTime(0.045, t0);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + c[2] * 3);
    g.connect(actx.destination);
    for (let i = 0; i < 2; i++) {
      const o = actx.createOscillator();
      o.type = i ? 'triangle' : 'square';
      o.frequency.setValueAtTime(i ? c[1] : c[0], t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(40, c[0] * 0.5), t0 + c[2] * 2);
      o.connect(g);
      o.start(t0);
      o.stop(t0 + c[2] * 3);
    }
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
  return { play, unlock };
})();

/* --------------------------------------------------------------- bus wiring */

bus.banner = banner;
bus.callout = callout;
bus.number = addNumber;
bus.deny = denySlot;
bus.hud = syncHud;
bus.dev = markDev;
bus.cards = openCards;
bus.go = showGo;
bus.audio = audio.play;
bus.startArena = startArena;
bus.nextWave = nextWave;
bindArenas(() => ARENAS);

/* ------------------------------------------------------------------ input */

function normKey(e) {
  return e.key.length === 1 ? e.key.toLowerCase() : e.key;
}

const DIGITS = ['1', '2', '3', '4', '5', '6', '7'];

function pickClassByIndex(i) {
  const id = CLASS_IDS[i];
  if (!id) return;
  if (game.screen === 'classSelect') {
    const card = document.querySelectorAll('#csGrid [data-pick]')[i];
    if (card) card.click();
    return;
  }
  setClass(id);
}

window.addEventListener('keydown', (e) => {
  const k = normKey(e);
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', '`'].includes(k)) e.preventDefault();

  /* cards take 1 / 2 / 3 and swallow the rest while they are open */
  if (cardsVisible()) {
    if (k === '1' || k === '2' || k === '3') takeCard(+k - 1);
    if (k === '`' || k === '~') toggleDev();
    return;
  }
  if (k === '`' || k === '~') { toggleDev(); return; }

  if (k === 'Escape') {
    if (controlsVisible()) { closeControls(); return; }
    if (game.screen === 'playing') pauseGame();
    else if (game.screen === 'paused') resumeGame();
    return;
  }
  if (game.screen === 'title' && (k === 'Enter' || k === ' ')) { startStage(); return; }
  if (game.screen === 'classSelect' && (k === 'Enter' || k === ' ')) {
    const go = document.getElementById('csDeploy');
    if (go) go.click();
    return;
  }
  if (game.screen === 'gameover' && (k === 'Enter' || k === ' ')) { startStage(); return; }
  if (game.screen === 'victory' && (k === 'Enter' || k === ' ')) { startStage(); return; }

  /* 1-7 pick a class while the dev panel is open (or on the class screen) */
  if (DIGITS.indexOf(k) >= 0 && (devOpenState() || game.screen === 'classSelect')) {
    pickClassByIndex(DIGITS.indexOf(k));
    return;
  }
  if (game.screen !== 'playing') return;

  if (keys[k]) return;
  keys[k] = true;
  if (k === ' ') { input.jumpBuf = JUMP_BUFFER; input.jumpHeld = true; input.jump = true; }
  if (k === 'Shift') castSlot('shift');
  if (k === 'q') castSlot('q');
  if (k === 'e') castSlot('e');
  if (k === 'r') castSlot('r');
});

window.addEventListener('keyup', (e) => {
  const k = normKey(e);
  keys[k] = false;
  if (k === ' ') {
    input.jumpHeld = false;
    input.jump = false;
    if (player.vz > 0) player.vz *= 0.55;      /* variable jump height */
  }
});
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  input.jump = false; input.jumpBuf = 0; input.jumpHeld = false;
  game.mouse.down = false;
});

stage.addEventListener('pointermove', (e) => {
  game.mouse.x = e.clientX;
  game.mouse.y = e.clientY;
});
stage.addEventListener('pointerdown', (e) => {
  if (cardsVisible() || game.screen !== 'playing') return;
  audio.unlock();
  game.mouse.x = e.clientX;
  game.mouse.y = e.clientY;
  game.mouse.down = true;
  /* never flip the body mid-swing: the rig owns its own facing during an act */
  if (player.anim.busy <= 0 && player.dashT <= 0) {
    player.facing = (e.clientX + game.cam.x) >= player.x ? 1 : -1;
  }
  basicAttack();
});
window.addEventListener('pointerup', () => { game.mouse.down = false; });
stage.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('resize', () => {
  setCanvas(stage);
  buildSky();
  wallCache.clear();
  placePlatforms();
  /* the lane moved with the viewport: keep the fighter inside it */
  player.y = clamp(player.y, FLOOR_TOP + 4, FLOOR_BOTTOM - 4);
  player.x = clamp(player.x, 26, STAGE_W - 26);
});

/* ----------------------------------------------------------------- update */

function update(dt) {
  game.time += dt;
  /* death and victory are performances first, screens second */
  if (game.deathT > 0) {
    game.deathT -= dt;
    if (game.deathT <= 0) { game.deathT = 0; showGameOver(); }
  }
  if (game.victoryT > 0) {
    game.victoryT -= dt;
    if (game.victoryT <= 0) { game.victoryT = 0; showVictory(); }
  }
  if (game.rageT > 0) game.rageT = Math.max(0, game.rageT - dt);
  for (const k in game.cd) game.cd[k] = Math.max(0, game.cd[k] - dt);
  for (const k in lockedSlots) lockedSlots[k] = Math.max(0, lockedSlots[k] - dt);
  if (game.stats.comboT > 0) {
    game.stats.comboT -= dt;
    if (game.stats.comboT <= 0) game.stats.combo = 0;
  }
  if (game.banner.t > 0) game.banner.t -= dt;

  let d = dt;
  if (game.hitStop > 0) { game.hitStop -= dt; d = 0; }

  updatePlayer(d);
  if (game.mouse.down && !player.dead) basicAttack();   /* hold LMB to chain */
  updateAnim(d);
  updateBarrage(d);
  updateEnemies(d);
  updateBolts(d);
  updatePickups(d);
  updateTexts(d);
  updateFx(d);
  updateArena(dt, player);
  updateCamera(dt, player);
  tickGo(dt);
  tickMenus(dt);
  syncHud();

  /* a boss that leaves the arena is pulled back in */
  if (game.boss && game.arena) {
    game.boss.x = clamp(game.boss.x, game.arena.x0 + 40, game.arena.x1 - 40);
  }
}

/* ------------------------------------------------------------------ draw */

function render() {
  const shake = game.cam.shake;
  const sx = shake > 0 ? Math.round(rand(-1, 1) * shake * 0.5) : 0;
  const sy = shake > 0 ? Math.round(rand(-1, 1) * shake * 0.5) : 0;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#04060a';
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.translate(sx, sy + Math.round(game.cam.y));

  drawParallax();
  drawFloor();
  drawArenaLock();

  /* one painter's list: platforms, bodies, bolts, VFX and pickups, by depth */
  const list = [];
  for (const p of platforms) list.push({ y: p.y - 1, draw: () => drawPlatform(p) });
  for (const e of game.enemies) list.push({ y: e.y, draw: () => drawEnemy(e) });
  /* the title and class screens are the street itself — no fighter standing in it */
  if (game.screen !== 'title' && game.screen !== 'classSelect') list.push({ y: player.y, draw: drawPlayer });
  for (const b of game.bolts) list.push({ y: b.y, draw: () => drawBolt(b) });
  for (const f of game.fx) list.push({ y: f.y, draw: () => drawFxOne(f) });
  for (const p of game.pickups) list.push({ y: p.y, draw: () => drawPickupOne(p) });
  list.sort((a, b) => a.y - b.y);
  for (const item of list) item.draw();

  drawTexts();
  drawWeather();
  ctx.restore();

  drawCrosshair();
  drawCombo();
}

/** menus still need a living world behind them: parallax, torches, weather */
function menuTick(dt) {
  game.time += dt;
  game.menu.t += dt;
  updateFx(dt);
  const maxX = Math.max(0, STAGE_W - W);
  const target = maxX * (0.5 + 0.5 * Math.sin(game.menu.t * 0.07 + game.menu.pan));
  game.cam.x = lerpCam(game.cam.x, clamp(target, 0, maxX), 1 - Math.pow(0.02, dt));
  game.cam.y = lerpCam(game.cam.y, 0, 1 - Math.pow(0.05, dt));
  if (game.cam.shake > 0) game.cam.shake = Math.max(0, game.cam.shake - dt * 34);
  tickMenus(dt);          /* the class-select preview animates while paused */
}
const lerpCam = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------- boot: bake */

const bootEl = document.getElementById('boot');
const bootFill = document.getElementById('bootFill');
const bootMsg = document.getElementById('bootMsg');

function setProgress(p, msg) {
  if (bootFill) bootFill.style.width = Math.round(p * 100) + '%';
  if (bootMsg && msg) { bootMsg.textContent = msg; bootMsg.className = ''; }
}

/** hand the main thread back so the browser can actually paint the bar */
const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

function bootFail(text) {
  if (window.__bootFail) window.__bootFail(text, 'err');
  else if (bootMsg) { bootMsg.className = 'err'; bootMsg.textContent = text; }
}

async function buildClips() {
  const list = [];
  const SLOTS = ['lmb', 'air', 'shift', 'q', 'e', 'r'];

  /* every class: locomotion stances + one act per ability slot */
  for (const cls of CLASS_IDS) {
    const c = CLASSES[cls];
    list.push({ key: 'act:' + cls + ':idle', stance: 'idle', cls, loop: true, fps: 12, window: 2.4, maxFrames: 16 });
    list.push({ key: 'act:' + cls + ':run', stance: 'run', cls, loop: true, fps: 16, window: 0.5, maxFrames: 10 });
    /* airborne poses: the rig must read as a jump and as a fall */
    list.push({ key: 'act:' + cls + ':jump', stance: 'jump', cls, fps: 14, window: 0.24, maxFrames: 6 });
    list.push({ key: 'act:' + cls + ':fall', stance: 'fall', cls, fps: 14, window: 0.32, maxFrames: 6 });
    ACTION_KEY[cls] = ACTION_KEY[cls] || {};
    for (const slot of SLOTS) {
      const def = c[slot];
      if (!def || !def.clip) continue;
      /* A `moves/*` kit animates the rig itself. Every other effect is a world
         VFX overlay, so the body switches to a rigged cast pose instead of
         disappearing into the effect. */
      const rigged = riggedClip(def.clip);
      const key = cls + '::' + slot + '::' + (rigged ? def.clip : 'cast');
      ACTION_KEY[cls][slot] = key;
      list.push(rigged
        ? { key, id: def.clip, cls, body: cls, window: 1.5, fps: 16, maxFrames: 22, palette: PALETTES[c.ramp] }
        : { key, stance: 'cast', cls, body: cls, fps: 16, window: 0.3, maxFrames: 6, palette: PALETTES[c.ramp] });
    }
  }

  /* critters */
  for (const [name, t] of Object.entries(ENEMY_TYPES)) {
    list.push({ key: 'en:' + name, id: t.critter, window: 1.6, fps: 12, maxFrames: 16, loop: true, frontOnly: true });
  }

  /* world props and pickups */
  const props = [
    ['prop:brazier', 'fire/brazier', 1.0, 12, true],
    ['pick:xp', 'pickups/xp-orb', 1.2, 10, true],
    ['pick:gem', 'pickups/gem-spin', 1.2, 10, true]
  ];
  for (const [key, id, win, fps, loop] of props) list.push({ key, id, window: win, fps, maxFrames: 12, loop });

  /* every effect the kits, critters and feedback lean on */
  const effects = new Set([
    'spawn/spawn-portal', 'spawn/shatter-death', 'spawn/poof', 'spawn/respawn-beam',
    'impacts/hit-spark', 'impacts/crit-hit', 'impacts/hit-flash', 'impacts/heavy-landing',
    'impacts/ground-slam', 'impacts/bullet-impact', 'impacts/blunt-hit',
    'pickups/collect-burst', 'ui/level-up', 'ui/damage-number', 'arcane/rune-circle',
    'lightning/charge-up', 'explosions/big-explosion', 'ice/freeze', 'status/rage'
  ]);
  for (const cls of CLASS_IDS) {
    const c = CLASSES[cls];
    for (const slot of SLOTS) {
      const def = c[slot];
      if (!def) continue;
      if (def.vfx) effects.add(def.vfx);
      if (def.bolt) effects.add(def.bolt);
      if (def.strike) effects.add(def.strike);
      if (def.clip && !riggedClip(def.clip)) effects.add(def.clip);   /* world overlay */
    }
  }
  verifyIds([...effects]);
  for (const id of effects) list.push({ key: 'fx:' + id, id, window: 1.0, fps: 18, maxFrames: 18 });

  let done = 0;
  const failed = [];
  for (const def of list) {
    try {
      bake(def);
    } catch (err) {
      /* one bad clip must not take the whole boot down */
      failed.push(def.id || def.key);
      console.error('[pfx] bake failed for ' + (def.id || def.key), err);
    }
    done++;
    if (done % 3 === 0 || done === list.length) {
      setProgress(done / list.length, 'baking ' + done + ' / ' + list.length + ' · ' + (def.id || def.key));
      await yieldFrame();          /* keeps #bootFill animating in a real browser */
    }
  }
  if (failed.length) bootFail('Baked ' + (list.length - failed.length) + ' clips, ' + failed.length + ' failed: ' + failed.slice(0, 3).join(', '));
  if (MISSING.length) console.warn('[pfx] unresolved ids:', MISSING.join(', '));
  return list.length;
}

/* ---------------------------------------------------------------- boot ---- */

async function boot() {
  try {
    bootClassChips();
    placePlatforms();
    buildSky();                     /* the sky must exist on frame 1 */
    resetPlayer();
    game.cam.x = 240;
    game.mouse.x = W * 0.6;
    game.mouse.y = H * 0.5;
    buildDevBar();
    markDev();
    if (typeof location !== 'undefined' && /[?&]dev=1/.test(location.search)) toggleDev(true);
    setProgress(0.02, 'stage built · baking pixelfx clips…');
    await yieldFrame();
    await yieldFrame();

    const t0 = performance.now();
    const n = await buildClips();
    const ms = Math.round(performance.now() - t0);
    setProgress(1, 'ready · ' + n + ' clips in ' + ms + 'ms');

    buildBootClasses();
    setScreen('title');
    syncHud();

    await new Promise((r) => setTimeout(r, 180));
    if (bootEl) bootEl.classList.add('done');
    requestAnimationFrame(frame);
  } catch (err) {
    console.error(err);
    bootFail('Boot failed: ' + (err && (err.message || err)));
  }
}

/** the seven class chips are the first thing on screen — build them immediately */
function bootClassChips() {
  try { buildBootClasses(); } catch (err) { console.error(err); }
}

let last = 0;
function frame(now) {
  if (!last) last = now;
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05);
  if (game.screen === 'playing') update(dt);
  else if (game.screen === 'title' || game.screen === 'classSelect' ||
           game.screen === 'gameover' || game.screen === 'victory') menuTick(dt);
  render();
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------- debug / harness -- */

window.__SURVIVE = {
  game, player, platforms, CLASSES, CLASS_IDS, CLIPS, MISSING, ARENAS, ENEMIES: ENEMY_TYPES,
  castSlot, basicAttack, hurtPlayer, respawn, spawnWave, spawnEnemy, gainXp, gainUlt, unlockAll, resetCds,
  setClass, setUniverse, toggleDev, toggleGod, devWave, devBoss, wipeMap, openCards, takeCard,
  syncHud, setScreen, startStage, pauseGame, resumeGame, showGameOver, showVictory, tickMenus,
  step: (dt) => { update(dt || 1 / 60); render(); syncHud(); },
  state: () => ({
    cls: game.classId, uni: uni().id, level: game.level, xp: game.xp, ult: Math.round(game.ult),
    hp: player.hp, maxHp: player.maxHp, x: Math.round(player.x), y: Math.round(player.y),
    z: Math.round(player.z), onGround: player.onGround, busy: +player.anim.busy.toFixed(2),
    anim: player.anim.key, enemies: game.enemies.length, bolts: game.bolts.length,
    fx: game.fx.length, pickups: game.pickups.length, texts: game.texts.length,
    arena: game.arena ? game.arena.id : null, boss: game.boss ? Math.round(game.boss.hp) : null,
    cd: { shift: +game.cd.shift.toFixed(1), q: +game.cd.q.toFixed(1), e: +game.cd.e.toFixed(1) },
    clips: CLIPS.size, missing: MISSING.slice(), kills: game.stats.kills, hits: game.stats.hits,
    paused: game.paused, screen: game.screen, upgrades: { ...game.upgrades },
    run: { ...game.run }
  })
};

boot();
