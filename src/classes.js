/* classes.js — the player.
 *
 * Seven classes, the four-slot kit (SHIFT / Q / E / R) plus ground and air
 * attacks, and the whole (x, y, z) movement + combat solve: platforms, launches,
 * recoil, hit-stop, damage, pickups and progression.
 */
import {
  DEPTH_TOL, DOUBLE_JUMP_VZ, FLOOR_BOTTOM, FLOOR_H, FLOOR_TOP, GRAVITY, HEIGHT_TOL,
  HITSTOP, JUMP_VZ, MAX_LEVEL, SPEED_X, SPEED_Y, SPRITE, STAGE_W, ULT_PER_HIT,
  ULT_PER_KILL, XP_STEPS, bodyScreen, bus, clamp, ctx, depthScale, game, input, keys,
  rand, sign
} from './core.js';
import {
  ACTION_KEY, CLIPS, MISSING, PALETTES, bake, drawClip, spawnFx, textClip
} from './pfx.js';
import { ARENAS, platforms, shadowAt } from './world.js';

const CLASSES = {
  knight: {
    name: 'VANGUARD KNIGHT', short: 'KNIGHT', body: 'knight', ramp: 'steel', hp: 10, accent: '#f5c542',
    lmb:   { name: 'SWORD COMBO', clip: 'moves/sword-combo', vfx: 'impacts/hit-spark', kind: 'melee', reach: 128, dmg: 4, dur: 0.32, level: 1 },
    air:   { name: 'GROUND POUND', clip: 'moves/ground-pound', vfx: 'impacts/ground-slam', kind: 'aoe', reach: 156, dmg: 7, dur: 0.44, level: 1 },
    shift: { name: 'DASH STRIKE', clip: 'moves/dash-strike', vfx: 'impacts/hit-spark', kind: 'dash', dist: 300, dmg: 3, dur: 0.26, cd: 3, level: 1 },
    q:     { name: 'UPPERCUT', clip: 'melee/uppercut', vfx: 'impacts/hit-spark', kind: 'launch', reach: 120, dmg: 5, launch: 430, dur: 0.3, cd: 5, level: 1 },
    e:     { name: 'EARTH STOMP', clip: 'moves/earth-stomp', vfx: 'nature/quake', kind: 'aoe', reach: 210, dmg: 10, dur: 0.52, cd: 10, level: 3 },
    r:     { name: 'HOLY SMITE', clip: 'moves/holy-smite', vfx: 'holy/holy-pillar', kind: 'aoe', reach: 300, dmg: 18, dur: 0.7, cd: 0, level: 5 }
  },
  gunslinger: {
    name: 'GUNSLINGER', short: 'GUNSLINGER', body: 'gunslinger', ramp: 'gold', hp: 9, accent: '#ffcf4d',
    lmb:   { name: 'PISTOLS', clip: 'moves/pistol-shots', vfx: 'projectiles/bullet-tracer', bolt: 'projectiles/bullet-tracer', kind: 'shot', speed: 900, reach: 520, dmg: 3, dur: 0.3, level: 1 },
    air:   { name: 'AIR PISTOLS', clip: 'moves/pistol-shots', bolt: 'projectiles/bullet-tracer', kind: 'shot', speed: 900, reach: 520, dmg: 4, dur: 0.3, level: 1, down: 1 },
    shift: { name: 'DODGE ROLL', clip: 'moves/dash-strike', vfx: 'explosions/smoke-bomb', kind: 'dash', dist: 310, dmg: 2, dur: 0.28, cd: 3, level: 1 },
    q:     { name: 'GRENADE', clip: 'moves/pistol-shots', bolt: 'explosions/grenade', vfx: 'explosions/grenade', kind: 'lob', speed: 620, dmg: 7, dur: 0.32, cd: 5, level: 1, bounce: true },
    e:     { name: 'ROCKET RECOIL', clip: 'moves/rocket-launcher', vfx: 'explosions/big-explosion', kind: 'rocket', speed: 760, dmg: 13, dur: 0.5, cd: 10, level: 3, recoil: 300 },
    r:     { name: 'SMG BARRAGE', clip: 'moves/pistol-shots', vfx: 'projectiles/muzzle-smg', kind: 'barrage', speed: 1000, dmg: 5, shots: 8, dur: 0.6, cd: 0, level: 5 }
  },
  mage: {
    name: 'CHRONO MAGE', short: 'MAGE', body: 'mage', ramp: 'arcane', hp: 8, accent: '#4cd6f0',
    lmb:   { name: 'FIREBALL', clip: 'moves/fireball-throw', bolt: 'arcane/arcane-orb', kind: 'shot', speed: 620, reach: 560, dmg: 4, dur: 0.34, level: 1 },
    air:   { name: 'AIR FIREBALL', clip: 'moves/fireball-throw', bolt: 'arcane/arcane-orb', kind: 'shot', speed: 620, reach: 560, dmg: 5, dur: 0.34, level: 1, down: 1 },
    shift: { name: 'BLINK', clip: 'arcane/blink-out', vfx: 'arcane/blink-in', kind: 'blink', dist: 280, dmg: 0, dur: 0.3, cd: 3, level: 1 },
    q:     { name: 'ICE LANCE', clip: 'moves/ice-lance-throw', bolt: 'ice/freeze', vfx: 'ice/ice-shatter', kind: 'frost', speed: 720, dmg: 6, dur: 0.36, cd: 5, level: 1, snare: 2.2 },
    e:     { name: 'CHAIN STORM', clip: 'moves/lightning-call', vfx: 'lightning/chain-lightning', kind: 'aoe', reach: 250, dmg: 12, dur: 0.56, cd: 10, level: 3 },
    r:     { name: 'TIME STOP + METEOR', clip: 'moves/meteor-call', vfx: 'arcane/time-stop', kind: 'aoe', reach: 340, dmg: 20, dur: 0.72, cd: 0, level: 5, stop: 2.4 }
  },
  sniper: {
    name: 'RIFT SNIPER', short: 'SNIPER', body: 'sniper', ramp: 'mint', hp: 8, accent: '#5eead4',
    lmb:   { name: 'ARROW SHOT', clip: 'moves/arrow-shot', bolt: 'projectiles/laser-bolt', kind: 'shot', speed: 1100, reach: 720, dmg: 5, dur: 0.3, level: 1 },
    air:   { name: 'AIR ARROW', clip: 'moves/arrow-shot', bolt: 'projectiles/laser-bolt', kind: 'shot', speed: 1100, reach: 720, dmg: 6, dur: 0.3, level: 1, down: 1 },
    shift: { name: 'WARP', clip: 'scifi/warp-out', vfx: 'scifi/warp-in', kind: 'blink', dist: 300, dmg: 0, dur: 0.3, cd: 3, level: 1 },
    q:     { name: 'LASER GRID', clip: 'moves/arrow-shot', vfx: 'scifi/laser-grid', kind: 'snare', reach: 190, dmg: 5, dur: 0.34, cd: 5, level: 1, snare: 3 },
    e:     { name: 'ARCANE BEAM', clip: 'arcane/arcane-beam', vfx: 'arcane/arcane-beam', kind: 'rail', reach: 640, dmg: 14, dur: 0.5, cd: 10, level: 3 },
    r:     { name: 'EMP STRIKE', clip: 'moves/arrow-shot', vfx: 'scifi/emp-blast', kind: 'aoe', reach: 360, dmg: 20, dur: 0.7, cd: 0, level: 5, strike: 'lightning/lightning-strike' }
  },
  berserker: {
    name: 'BERSERKER', short: 'BERSERKER', body: 'berserker', ramp: 'spark', hp: 13, accent: '#ff7a3d',
    lmb:   { name: 'HEAVY CLEAVE', clip: 'melee/heavy-cleave', vfx: 'impacts/blunt-hit', kind: 'melee', reach: 142, dmg: 6, dur: 0.36, level: 1 },
    air:   { name: 'HAMMER SMASH', clip: 'melee/hammer-smash', vfx: 'impacts/ground-slam', kind: 'aoe', reach: 168, dmg: 9, dur: 0.46, level: 1, down: 1 },
    shift: { name: 'BERSERK LEAP', clip: 'moves/ground-pound', vfx: 'impacts/heavy-landing', kind: 'leap', dist: 240, dmg: 3, dur: 0.3, cd: 2.5, level: 1, hop: 620 },
    q:     { name: 'SPIN SLASH', clip: 'melee/spin-slash', vfx: 'impacts/hit-spark', kind: 'aoe', reach: 150, dmg: 7, dur: 0.34, cd: 4, level: 1 },
    e:     { name: 'SEISMIC POUND', clip: 'moves/ground-pound', vfx: 'fire/fire-ring', kind: 'aoe', reach: 230, dmg: 13, dur: 0.54, cd: 9, level: 3, launch: 300 },
    r:     { name: 'RAGE TORNADO', clip: 'status/rage', vfx: 'fire/fire-tornado', kind: 'aoe', reach: 320, dmg: 22, dur: 0.72, cd: 0, level: 5, rage: 8 }
  },
  assassin: {
    name: 'SHADOW ASSASSIN', short: 'ASSASSIN', body: 'assassin', ramp: 'violet', hp: 8, accent: '#b8a2ff',
    lmb:   { name: 'DAGGER FLURRY', clip: 'melee/dagger-flurry', vfx: 'impacts/crit-hit', kind: 'melee', reach: 104, dmg: 3, dur: 0.22, level: 1 },
    air:   { name: 'AIR FLURRY', clip: 'melee/dagger-flurry', vfx: 'impacts/hit-spark', kind: 'melee', reach: 104, dmg: 4, dur: 0.24, level: 1, down: 1 },
    shift: { name: 'SHADOW STEP', clip: 'shadow/shadow-flames', vfx: 'shadow/shadow-flames', kind: 'blink', dist: 320, dmg: 2, dur: 0.26, cd: 3, level: 1 },
    q:     { name: 'GRASPING HANDS', clip: 'shadow/grasping-hands', vfx: 'shadow/grasping-hands', kind: 'snare', reach: 200, dmg: 4, dur: 0.3, cd: 5, level: 1, snare: 2.6, mark: 1 },
    e:     { name: 'VOID ORB', clip: 'shadow/void-orb', vfx: 'shadow/dark-explosion', kind: 'aoe', reach: 230, dmg: 13, dur: 0.5, cd: 9, level: 3 },
    r:     { name: 'BLACK HOLE', clip: 'shadow/black-hole', vfx: 'shadow/necro-skulls', kind: 'aoe', reach: 340, dmg: 24, dur: 0.78, cd: 0, level: 5, pull: 1 }
  },
  tech: {
    name: 'TECH SPECIALIST', short: 'TECH', body: 'tech', ramp: 'toxic', hp: 9, accent: '#7cffcf',
    lmb:   { name: 'ENERGY DISC', clip: 'moves/pistol-shots', bolt: 'projectiles/energy-disc', vfx: 'impacts/bullet-impact', kind: 'lob', speed: 640, reach: 520, dmg: 3, dur: 0.28, level: 1, bounce: true },
    air:   { name: 'AIR DISC', clip: 'moves/pistol-shots', bolt: 'projectiles/energy-disc', kind: 'lob', speed: 640, reach: 520, dmg: 4, dur: 0.28, level: 1, bounce: true, down: 1 },
    shift: { name: 'JETPACK', clip: 'scifi/jetpack', vfx: 'scifi/jetpack', kind: 'leap', dist: 150, dmg: 0, dur: 0.34, cd: 2.5, level: 1, hop: 700 },
    q:     { name: 'FORCE FIELD', clip: 'scifi/force-field', vfx: 'scifi/force-field', kind: 'dome', reach: 200, dmg: 3, dur: 0.4, cd: 6, level: 1, snare: 1.6, shield: 2.2 },
    e:     { name: 'TRACTOR BEAM', clip: 'scifi/tractor-beam', vfx: 'explosions/plasma-explosion', kind: 'rail', reach: 420, dmg: 11, dur: 0.48, cd: 8, level: 3, pull: 1 },
    r:     { name: 'ENERGY CORE', clip: 'scifi/energy-core', vfx: 'explosions/nuke', kind: 'aoe', reach: 380, dmg: 26, dur: 0.8, cd: 0, level: 5, strike: 'explosions/plasma-explosion' }
  }
};
const CLASS_IDS = ['knight', 'gunslinger', 'mage', 'sniper', 'berserker', 'assassin', 'tech'];

/* =============================================================== 5 · STATE */
const player = {
  x: 220, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
  onGround: true, groundZ: 0, jumps: 0,
  facing: 1, hp: 10, maxHp: 10, invuln: 0, dashT: 0, dropThrough: 0,
  anim: { key: '', t: 0, busy: 0, dur: 1, clipDur: 1, fired: true, def: null, slot: null }
};

const CLS = () => CLASSES[game.classId];

function resetPlayer(soft) {
  const c = CLS();
  player.x = soft ? player.x : 220;
  player.y = FLOOR_TOP + FLOOR_H * 0.74;
  player.z = 0; player.vx = 0; player.vy = 0; player.vz = 0;
  player.onGround = true; player.groundZ = 0; player.jumps = 0;
  player.maxHp = c.hp + (game.upgrades.hp || 0);
  player.hp = player.maxHp;
  player.invuln = 0; player.dashT = 0; player.dropThrough = 0;
  player.facing = 1;
  player.anim = { key: '', t: 0, busy: 0, dur: 1, clipDur: 1, fired: true, def: null, slot: null };
}

/* ============================================================== 6 · BOLTS */
function spawnBolt(def, extra) {
  const o = extra || {};
  const s = depthScale(player.y);
  const lvl = o.z != null ? o.z : player.z + 26;
  const dirX = player.facing;
  const key = def.bolt || def.vfx || 'projectiles/bullet-tracer';
  if (!CLIPS.has('fx:' + key)) bake({ key: 'fx:' + key, id: key, window: 1.0, fps: 18, maxFrames: 10, tint: def.tint || null });
  const b = {
    x: player.x + dirX * 22,
    y: player.y,
    z: lvl,
    vx: dirX * (def.speed || 700),
    vz: o.vz || 0,
    dmg: (def.dmg || 4) * (o.mult || 1),
    key: 'fx:' + key,
    kind: def.kind,
    pierce: def.kind === 'rail' ? 99 : (o.pierce || 0),
    bounce: !!def.bounce,
    snare: def.snare || 0,
    life: def.kind === 'rail' ? 0.4 : (def.reach ? def.reach / (def.speed || 700) : 1.1),
    spin: rand(0, 6),
    hit: new Set(),
    s
  };
  if (o.down) { b.vz = -140; b.vx = dirX * (def.speed || 700) * 0.72; }
  game.bolts.push(b);
  spawnFx(key, b.x, b.y, b.z, { scale: 0.9, life: 0.18 });
  return b;
}

function spawnHostileBolt(x, y, z, vx, dmg, key) {
  const k = key || 'lightning/zap-hit';
  const id = 'lightning/zap-hit';
  if (!CLIPS.has('fx:' + id)) bake({ key: 'fx:' + id, id, window: 0.6, fps: 18, maxFrames: 8 });
  game.bolts.push({
    x, y, z, vx, vz: 0, dmg, key: 'fx:' + id, kind: 'hostile', pierce: 0,
    bounce: false, snare: 0, life: 1.6, spin: rand(0, 6), hit: new Set(), s: depthScale(y), foe: true
  });
}

/* ================================================================ 7 · FX */
function levelForXp(xp) {
  let lv = 1;
  for (let i = 1; i < XP_STEPS.length; i++) if (xp >= XP_STEPS[i]) lv = i + 1;
  return Math.min(MAX_LEVEL, lv);
}

function gainXp(n) {
  game.xp += n;
  const lv = levelForXp(game.xp);
  if (lv > game.level) {
    game.level = lv;
    player.hp = player.maxHp;
    bus.banner('LEVEL ' + lv, lv === 3 ? 'E · HEAVY UNLOCKED' : lv === 5 ? 'R · ULTIMATE UNLOCKED' : 'STAY SHARP');
    bus.callout('LEVEL ' + lv, 'gold');
    spawnFx('ui/level-up', player.x, player.y, player.z + 40, { scale: 1.1, life: 0.9 });
  }
}

function gainUlt(n) {
  if (game.level < 5) return;
  const was = game.ult;
  game.ult = clamp(game.ult + n * (1 + (game.upgrades.charge || 0) * 0.25), 0, 100);
  if (was < 100 && game.ult >= 100) bus.callout('ULTIMATE READY', 'gold');
}

/* ============================================================== 9 · INPUT */
function startAnim(key, def, slot, durOverride) {
  /* every ability act is baked per class so each keeps its own body palette */
  if (slot && ACTION_KEY[game.classId] && ACTION_KEY[game.classId][slot]) key = ACTION_KEY[game.classId][slot];
  const clip = CLIPS.get(key);
  const len = Math.max(0.12, durOverride || (def && def.dur) || 0.32);
  player.anim = {
    key, t: 0, busy: len, dur: len,
    clipDur: clip ? clip.dur : len,
    fired: false, def: def || null, slot: slot || null
  };
}

function basicAttack() {
  const c = CLS();
  const def = player.onGround || player.z < 6 ? c.lmb : c.air;
  if (player.anim.busy > 0 || player.dashT > 0) return;
  startAnim(def.clip, def, player.onGround ? 'lmb' : 'air');
}

function castSlot(slot) {
  const c = CLS();
  const def = c[slot];
  if (!def) return;
  if (def.level > game.level) { bus.deny(slot, 'LV ' + def.level); return; }
  if (slot === 'r' && game.ult < 100) { bus.deny('r', Math.floor(game.ult) + '%'); return; }
  if (game.cd[slot] > 0) return;
  if (player.anim.busy > 0 && slot !== 'shift') return;

  game.cd[slot] = (def.cd || 0) * (1 - Math.min(0.6, (game.upgrades.cdr || 0) * 0.2));
  game.stats.casts++;
  startAnim(def.clip, def, slot);

  if (slot === 'r') game.ult = 0;

  /* movement abilities resolve immediately */
  if (def.kind === 'dash' || def.kind === 'blink') {
    const dir = player.facing;
    if (def.kind === 'blink') {
      spawnFx(def.vfx, player.x, player.y, player.z + 20, { scale: 1.15, life: 0.5 });
      player.x = clamp(player.x + dir * def.dist, 30, STAGE_W - 30);
      spawnFx(def.vfx, player.x, player.y, player.z + 20, { scale: 1.15, life: 0.5 });
    } else {
      player.dashT = 0.26;
      player.vx = dir * (def.dist / 0.26);
      spawnFx(def.vfx, player.x, player.y, player.z + 14, { scale: 1, life: 0.6 });
      resolveAbility(def, slot, { radiusBoost: 1 });
    }
    player.invuln = Math.max(player.invuln, 0.34);          /* i-frames */
    player.vz = Math.max(player.vz, 0);
    bus.callout(def.name, 'cyan');
  } else {
    bus.callout(def.name, def.kind === 'aoe' ? 'gold' : '');
  }
}

function resolveAbility(def, slot, opts) {
  const o = opts || {};
  const reach = (def.reach || 100) * (o.radiusBoost || 1);
  const isAoe = def.kind === 'aoe' || def.kind === 'snare' || def.kind === 'strike';
  const isRail = def.kind === 'rail';
  const piercing = isRail || o.pierce;
  const zc = player.z + 26;
  let hitAny = false;
  const hitList = [];

  for (const e of game.enemies) {
    if (e.dead) continue;
    if (Math.abs(e.y - player.y) > DEPTH_TOL + (isAoe ? 26 : 0)) continue;
    if (Math.abs((e.z + e.h * 0.5) - zc) > HEIGHT_TOL + (isAoe ? 40 : 0)) continue;
    const dx = (e.x - player.x) * player.facing;
    if (!isAoe && !isRail && (dx < -26 || dx > reach)) continue;
    if (isAoe) {
      const dy = (e.y - player.y) * 1.7;
      const dz = (e.z + e.h * 0.5) - zc;
      if (Math.hypot(e.x - player.x, dy, dz) > reach) continue;
    }
    if (isRail && (dx < -10 || dx > reach)) continue;
    if (e.lastHitToken === game.hitToken) continue;
    e.lastHitToken = game.hitToken;
    hitList.push(e);
    hitAny = true;
    damageEnemy(e, def.dmg, def, isAoe || isRail);
    if (def.launch && !e.def.boss) { e.vz = def.launch; e.airT = 0.9; }
    if (def.snare) { e.snare = Math.max(e.snare, def.snare); spawnFx('ice/freeze', e.x, e.y, e.z + 10, { scale: 1, life: 0.5 }); }
    if (def.kind === 'strike' && def.strike) spawnFx(def.strike, e.x, e.y, e.z, { scale: 1.1, life: 0.5 });
    if (!piercing) break;
  }
  if (hitAny) {
    game.hitToken++;
    const heavy = isAoe || isRail || def.kind === 'launch';
    if (heavy) { game.hitStop = HITSTOP; game.cam.shake = Math.min(16, game.cam.shake + 9); }
    else game.cam.shake = Math.min(10, game.cam.shake + 3);
    if (def.vfx && !isRail) {
      for (const e of hitList.slice(0, 4)) spawnFx(def.vfx, e.x, e.y, e.z + e.h * 0.5, { scale: heavy ? 1.25 : 0.95 });
    }
  } else if (def.vfx && (isAoe || isRail)) {
    /* a whiff still shows the performance, but pushed out and scaled back so it
       frames the character instead of swallowing them */
    spawnFx(def.vfx, player.x + player.facing * reach * 0.58, player.y, player.z + 18,
      { scale: isRail ? 0.95 : 0.82, life: 0.6 });
  }
}

function fireAbility(def, slot) {
  const c = CLS();
  if (def.kind === 'shot' || def.kind === 'frost' || def.kind === 'lob' || def.kind === 'rocket') {
    spawnBolt(def);
    if (def.kind === 'rocket') {
      player.vz = Math.max(player.vz, def.recoil || 280);       /* recoil onto ledges */
      player.onGround = false;
      player.jumps = Math.max(player.jumps, 1);
      game.cam.shake = Math.min(12, game.cam.shake + 5);
    }
    return;
  }
  if (def.kind === 'barrage') {
    game.barrage = { def, left: def.shots || 6, t: 0, gap: (def.dur || 0.6) / (def.shots || 6) };
    return;
  }
  if (def.kind === 'dash') { resolveAbility(def, slot, { radiusBoost: 1 }); return; }
  if (def.kind === 'leap') {
    /* a mobility hop: forward + up, and everything under you on landing */
    player.vz = def.hop || 600;
    player.onGround = false;
    player.jumps = Math.max(player.jumps, 1);
    player.x = clamp(player.x + player.facing * (def.dist || 120) * 0.55, 26, STAGE_W - 26);
    resolveAbility(def, slot, { radiusBoost: 1.15 });
    game.cam.shake = Math.min(10, game.cam.shake + 4);
    return;
  }
  if (def.kind === 'dome') {
    /* a reflector dome: brief invulnerability + a stun ring */
    player.invuln = Math.max(player.invuln, def.shield || 2);
    resolveAbility(def, slot, { radiusBoost: 1.3 });
    return;
  }
  resolveAbility(def, slot);
  if (def.rage) { game.rageT = def.rage; bus.callout('RAGE', 'gold'); }
  if (def.pull) {
    for (const e of game.enemies) {
      if (e.dead || e.def.boss) continue;
      if (Math.abs(e.x - player.x) > (def.reach || 300)) continue;
      e.x += sign(player.x - e.x) * 40;
      e.snare = Math.max(e.snare, 0.5);
    }
  }
  if (def.stop) {
    for (const e of game.enemies) if (!e.dead && !e.def.boss) e.snare = Math.max(e.snare, def.stop);
    spawnFx('arcane/time-stop', player.x + player.facing * 80, player.y, player.z + 30, { scale: 1.6, life: 1.2 });
    game.hitStop = HITSTOP;
  }
}

function damageEnemy(e, dmg, def, heavy) {
  const airborne = e.z > 6 && !e.def.fly;
  const crit = airborne || (def && (def.kind === 'aoe' || def.kind === 'rail'));
  /* chip upgrades + the berserker rage window both scale the number you see */
  const boost = (1 + (game.upgrades.power || 0) * 0.15) * (game.rageT > 0 ? 1.4 : 1);
  const amount = Math.max(1, Math.round(dmg * boost * (airborne ? 1.5 : 1)));
  e.hp -= amount;
  e.flash = 0.14;
  game.stats.hits++;
  game.stats.combo++;
  game.stats.comboT = 1.6;
  game.stats.maxCombo = Math.max(game.stats.maxCombo, game.stats.combo);
  gainUlt(ULT_PER_HIT);
  bus.number(e.x, e.y, e.z + e.h + 8, '-' + amount, crit);
  spawnFx('impacts/hit-spark', e.x, e.y, e.z + e.h * 0.55, { scale: crit ? 1.15 : 0.85, life: 0.3 });
  if (crit) spawnFx('impacts/crit-hit', e.x, e.y, e.z + e.h * 0.55, { scale: 1, life: 0.4 });
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  if (e.dead) return;
  e.dead = true;
  spawnFx('spawn/shatter-death', e.x, e.y, e.z, { scale: e.def.boss ? 2.4 : 1.15, life: 0.7 });
  game.stats.kills++;
  game.stats.combo += 2;
  gainUlt(ULT_PER_KILL);
  gainXp(e.def.xp || 1);
  const drops = e.def.boss ? 14 : 3;
  for (let i = 0; i < drops; i++) {
    game.pickups.push({
      kind: i === 0 ? 'gem' : 'xp',
      x: e.x + rand(-18, 18), y: e.y + rand(-8, 8), z: e.z + 12,
      vz: rand(150, 300), vx: rand(-90, 90), life: 14, spin: rand(0, 6)
    });
  }
  if (e.def.boss) {
    game.boss = null;
    bus.banner('WARDEN DOWN', 'THE STAGE IS YOURS');
    game.cam.shake = 18;
    for (let i = 0; i < 3; i++) spawnFx('explosions/big-explosion', e.x + rand(-40, 40), e.y, e.z + rand(0, 40), { scale: 1.6, life: 0.8 });
  }
}

function hurtPlayer(n, hard) {
  if (game.god || player.invuln > 0 || player.dashT > 0) return;
  player.hp -= n;
  player.invuln = game.god ? 0 : 0.85;
  game.cam.shake = Math.min(14, game.cam.shake + (hard ? 9 : 5));
  game.hitStop = HITSTOP * 0.6;
  spawnFx('impacts/hit-flash', player.x, player.y, player.z + 26, { scale: 0.9, life: 0.3 });
  bus.number(player.x, player.y, player.z + 50, '-' + n, false);
  game.stats.combo = 0;
  if (player.hp <= 0) respawn();
}

function respawn() {
  bus.banner('DOWN', 'THE STREET SPITS YOU BACK');
  player.hp = player.maxHp;
  player.invuln = 1.6;
  player.x = game.arena ? game.arena.x0 + 80 : Math.max(200, player.x - 200);
  player.y = FLOOR_TOP + FLOOR_H * 0.7;
  player.z = 140; player.vz = 0;
  game.enemies.length = 0;
  game.bolts.length = 0;
  game.arena = null;
  game.cam.lock = 0;
  for (const a of ARENAS) if (a.active) { a.active = false; a.wave = 0; if (!a.done) a.bossSpawned = false; }
  spawnFx('spawn/respawn-beam', player.x, player.y, 0, { scale: 1.4, life: 0.9 });
}

/* ============================================================== 11 · UPDATE */
const lockedSlots = { shift: 0, q: 0, e: 0, r: 0 };

function supportAt(x, y, fromZ) {
  let best = 0;
  for (const p of platforms) {
    if (x < p.x - 8 || x > p.x + p.w + 8) continue;
    if (y < p.y - 2 || y > p.y + p.d + 2) continue;
    if (p.z > fromZ + 3) continue;                 /* never snap up through it */
    if (p.z > best) best = p.z;
  }
  return best;
}

function updatePlayer(dt) {
  const c = CLS();
  if (player.dashT > 0) {
    player.dashT -= dt;
    if (player.dashT <= 0) player.vx = 0;
  } else if (dt > 0) {
    let mx = 0;
    if (keys.a || keys.ArrowLeft) mx -= 1;
    if (keys.d || keys.ArrowRight) mx += 1;
    let my = 0;
    if (keys.w || keys.ArrowUp) my -= 1;
    if (keys.s || keys.ArrowDown) my += 1;
    const spd = 1 + (game.upgrades.speed || 0) * 0.1;
    player.vx = mx * SPEED_X * spd;
    player.vy = my * SPEED_Y * 0.62 * spd;
    if (mx !== 0 && player.anim.busy <= 0) player.facing = mx;
  }
  const minX = game.arena ? game.arena.x0 + 18 : 26;
  const maxX = game.arena ? game.arena.x1 - 18 : STAGE_W - 26;
  player.x = clamp(player.x + player.vx * dt, minX, maxX);
  player.y = clamp(player.y + player.vy * dt, FLOOR_TOP, FLOOR_BOTTOM);

  /* jump / double jump / drop through */
  if (dt > 0 && input.jump) {
    input.jump = false;
    if (keys.s && player.onGround && player.groundZ > 0) {
      player.dropThrough = 0.3;
      player.onGround = false;
      player.groundZ = 0;
      player.z -= 6;
      spawnFx('spawn/poof', player.x, player.y, player.z + 4, { scale: 0.8, life: 0.4 });
    } else if (player.onGround) {
      player.vz = JUMP_VZ;
      player.onGround = false;
      player.jumps = 1;
      spawnFx('spawn/poof', player.x, player.y, 2, { scale: 0.8, alpha: 0.55, life: 0.35 });
    } else if (player.jumps > 0) {
      player.vz = DOUBLE_JUMP_VZ;
      player.jumps = 0;
      spawnFx('spawn/poof', player.x, player.y, player.z, { scale: 0.7, alpha: 0.5, life: 0.3 });
    }
  }

  if (player.dropThrough > 0) player.dropThrough -= dt;
  const prevZ = player.z;
  player.vz -= GRAVITY * dt;
  player.z += player.vz * dt;
  const support = player.dropThrough > 0 ? 0 : supportAt(player.x, player.y, prevZ);
  const wasAir = !player.onGround;
  if (player.z <= support && player.vz <= 0) {
    const fell = player.groundZ - support;
    player.z = support;
    player.vz = 0;
    if (wasAir && fell > 70) {
      spawnFx('impacts/heavy-landing', player.x, player.y, support, { scale: 0.9, alpha: 0.7, life: 0.35 });
      game.cam.shake = Math.min(9, game.cam.shake + 3);
    }
    player.onGround = true;
    player.groundZ = support;
    player.jumps = 0;
  } else if (player.z > support + 1) {
    player.onGround = false;
  }
  player.groundZ = support;
  if (player.invuln > 0) player.invuln -= dt;

  /* walk off a ledge: no support under us any more */
  if (player.onGround && player.z > support + 2) player.onGround = false;
}

function updateAnim(dt) {
  const a = player.anim;
  if (a.busy <= 0) return;
  a.busy -= dt;
  a.t += dt;
  const p = a.t / Math.max(0.001, a.dur);
  if (a.def && !a.fired && p > 0.3) {
    a.fired = true;
    fireAbility(a.def, a.slot);
  }
  if (a.busy <= 0) {
    a.busy = 0;
    a.key = '';
    a.def = null;
    a.slot = null;
  }
}

function updateBarrage(dt) {
  const b = game.barrage;
  if (!b) return;
  b.t -= dt;
  if (b.t <= 0) {
    b.t = b.gap;
    b.left--;
    spawnBolt(b.def, { mult: 1 });
    game.cam.shake = Math.min(10, game.cam.shake + 1.5);
    if (b.left <= 0) game.barrage = null;
  }
}

function updateBolts(dt) {
  for (const b of game.bolts) {
    if (b.dead) continue;
    b.life -= dt;
    if (b.life <= 0) { b.dead = true; continue; }
    b.x += b.vx * dt;
    if (b.kind === 'lob' || b.bounce) {
      b.vz -= GRAVITY * 0.75 * dt;
      b.z += b.vz * dt;
      if (b.z <= 0) {
        b.z = 0;
        b.vz = Math.abs(b.vz) * 0.55;
        b.vx *= 0.7;
        if (Math.abs(b.vz) < 40) { explodeBolt(b); continue; }
      }
      if (b.x < 30 || b.x > STAGE_W - 30) { b.vx *= -0.7; b.x = clamp(b.x, 30, STAGE_W - 30); }
    } else if (b.vz) {
      b.vz -= GRAVITY * 0.35 * dt;
      b.z = Math.max(2, b.z + b.vz * dt);
    }
    if (b.x < 20 || b.x > STAGE_W - 20) { b.dead = true; continue; }

    const s = depthScale(b.y);
    if (b.foe) {
      if (Math.abs(b.x - player.x) < 30 && Math.abs(b.y - player.y) < 40 &&
          Math.abs(b.z - (player.z + 24)) < 54) {
        hurtPlayer(b.dmg, false);
        b.dead = true;
        spawnFx('impacts/bullet-impact', b.x, b.y, b.z, { scale: 0.9, life: 0.3 });
      }
      continue;
    }
    for (const e of game.enemies) {
      if (e.dead || b.hit.has(e)) continue;
      if (Math.abs(e.x - b.x) > (e.def.boss ? 54 : 28)) continue;
      if (Math.abs(e.y - b.y) > DEPTH_TOL) continue;
      if (Math.abs((e.z + e.h * 0.5) - b.z) > HEIGHT_TOL) continue;
      b.hit.add(e);
      damageEnemy(e, b.dmg, { kind: b.kind === 'frost' ? 'aoe' : 'shot' }, false);
      if (b.snare) { e.snare = Math.max(e.snare, b.snare); spawnFx('ice/freeze', e.x, e.y, e.z + 10, { scale: 1, life: 0.5 }); }
      if (b.kind === 'frost') spawnFx('ice/ice-shatter', e.x, e.y, e.z + 12, { scale: 1, life: 0.4 });
      else spawnFx('impacts/bullet-impact', b.x, b.y, b.z, { scale: 0.85, life: 0.3 });
      b.pierce = (b.pierce || 0) - 1;
      if (b.pierce <= 0) { explodeBolt(b); break; }
    }
  }
  game.bolts = game.bolts.filter((b) => !b.dead);
}

function explodeBolt(b) {
  if (b.dead) return;
  b.dead = true;
  if (b.kind === 'lob') {
    spawnFx('explosions/grenade', b.x, b.y, b.z, { scale: 1.4, life: 0.6 });
    spawnFx('explosions/small-explosion', b.x, b.y, b.z + 8, { scale: 1.1, life: 0.5 });
    game.cam.shake = Math.min(14, game.cam.shake + 7);
    for (const e of game.enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - b.x, (e.y - b.y) * 1.6) < 110 && Math.abs(e.z - b.z) < 120) {
        damageEnemy(e, b.dmg, { kind: 'aoe' }, true);
      }
    }
  }
}

function updatePickups(dt) {
  for (const p of game.pickups) {
    if (p.life <= 0) continue;
    p.life -= dt;
    const dx = player.x - p.x, dy = player.y - p.y;
    const near = Math.abs(dx) < 190 && Math.abs(dy) < 120;
    if (near) {
      p.vx += sign(dx) * 1600 * dt;
      p.vx *= 0.9;
      p.y += sign(dy) * Math.min(Math.abs(dy), 200 * dt);
    }
    p.vz -= GRAVITY * dt;
    p.z += p.vz * dt;
    p.x += p.vx * dt;
    if (p.z <= 0) { p.z = 0; p.vz = Math.abs(p.vz) * 0.45; p.vx *= 0.62; }
    if (Math.abs(dx) < 44 && Math.abs(dy) < 36 && p.z < 72) {
      p.life = 0;
      spawnFx('pickups/collect-burst', p.x, p.y, p.z + 10, { scale: 0.7, life: 0.35 });
      gainUlt(2);
      gainXp(1);
      if (player.hp < player.maxHp && Math.random() < 0.3) player.hp = Math.min(player.maxHp, player.hp + 1);
    }
  }
  game.pickups = game.pickups.filter((p) => p.life > 0);
}

function updateTexts(dt) {
  for (const t of game.texts) { t.t += dt; t.x += t.vx * dt; }
  game.texts = game.texts.filter((t) => t.t < t.life);
}

function drawPlayer() {
  const p = bodyScreen(player);
  const key = player.anim.busy > 0 && CLIPS.has(player.anim.key)
    ? player.anim.key
    : (Math.abs(player.vx) > 8 || Math.abs(player.vy) > 8) && player.onGround
      ? 'act:' + game.classId + ':run'
      : 'act:' + game.classId + ':idle';
  let t = game.time;
  if (player.anim.busy > 0 && CLIPS.has(player.anim.key)) {
    t = player.anim.t * (player.anim.clipDur / Math.max(0.001, player.anim.dur));
  }

  shadowAt(player.x, player.y, 1.7, player.z > 10 ? 0.9 : 1);

  ctx.save();
  if (player.invuln > 0 && Math.floor(game.time * 22) % 2 === 0) ctx.globalAlpha = 0.55;
  drawClip(key, p.x, p.y, t, { scale: SPRITE.player, flip: player.facing < 0 });
  ctx.restore();

  /* a small class-coloured marker under the feet keeps the read instant */
  if (CLIPS.has(key)) {
    const c = CLASSES[game.classId];
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = c.accent;
    ctx.fillRect(Math.round(p.x) - 16, Math.round(player.y) - 2, 32, 2);
    ctx.globalAlpha = 1;
  }
}

function drawBolt(b) {
  const s = depthScale(b.y);
  const sy = b.y - b.z * s;
  const x = b.x - game.cam.x;
  /* two ghost frames behind it read as motion at 1x */
  for (let i = 2; i >= 1; i--) {
    drawClip(b.key, x - (b.vx * 0.012 * i), sy, 0, { scale: SPRITE.bolt * (1 - i * 0.12), alpha: 0.22 });
  }
  drawClip(b.key, x, sy, 0, { scale: SPRITE.bolt, flip: b.vx < 0 });
}

function drawPickupOne(p) {
  const key = p.kind === 'gem' ? 'pick:gem' : 'pick:xp';
  const s = depthScale(p.y);
  shadowAt(p.x, p.y, 0.7, 0.9);
  drawClip(key, p.x - game.cam.x, p.y - p.z * s, game.time + p.spin, { scale: SPRITE.pickup });
}
export {
  CLASSES, CLASS_IDS, CLS, basicAttack, castSlot, damageEnemy, drawBolt, drawPickupOne,
  drawPlayer, gainUlt, gainXp, hurtPlayer, killEnemy, levelForXp, lockedSlots, player,
  resetPlayer, respawn, resolveAbility, spawnBolt, spawnHostileBolt, supportAt, updateAnim,
  updateBarrage, updateBolts, updatePickups, updatePlayer, updateTexts
};
