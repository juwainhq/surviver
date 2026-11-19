/* enemies.js — critters and stage bosses.
 *
 * Ground hoppers, hover fliers and stealth elites, all driven by the same
 * (x, y, z) physics as the player, plus the wave spawner and the arena flow that
 * the stage gates ride on.
 */
import {
  FLOOR_BOTTOM, FLOOR_H, FLOOR_TOP, GRAVITY, SPRITE, STAGE_W,
  bus, clamp, ctx, depthScale, depthV, game, lerp, rand, sign
} from './core.js';
import { CLIPS, bake, drawClip, spawnFx } from './pfx.js';
import { contactShadow } from './world.js';
import { gainXp, hurtPlayer, player, spawnHostileBolt } from './classes.js';

const ENEMY_TYPES = {
  slime:      { critter: 'critters/slime',        hp: 8,  h: 26, speed: 58, fly: false, xp: 1 },
  frog:       { critter: 'critters/frog',         hp: 9,  h: 24, speed: 74, fly: false, xp: 1 },
  bat:        { critter: 'critters/bat',          hp: 6,  h: 24, speed: 104, fly: true, hover: 78, xp: 1 },
  eyeball:    { critter: 'critters/eyeball',      hp: 7,  h: 22, speed: 86, fly: true, hover: 106, xp: 1 },
  skull:      { critter: 'critters/flying-skull', hp: 10, h: 26, speed: 92, fly: true, hover: 66, xp: 2 },
  boss:       { critter: 'critters/ghost',        hp: 90, h: 96, speed: 52, fly: true, hover: 74, xp: 12, boss: true }
};

function spawnEnemy(type, x, y) {
  const t = ENEMY_TYPES[type] || ENEMY_TYPES.slime;
  const key = 'en:' + type;
  if (!CLIPS.has(key)) bake({ key, id: t.critter, window: 1.6, fps: 12, maxFrames: 16, loop: true, frontOnly: true });
  const e = {
    type, def: t, key,
    x: clamp(x, 40, STAGE_W - 40),
    y: clamp(y, FLOOR_TOP + 8, FLOOR_BOTTOM - 4),
    z: t.fly ? t.hover : 0,
    vx: 0, vy: 0, vz: 0,
    hp: t.hp, maxHp: t.hp, h: t.h,
    facing: 1, t: rand(0, 2), flash: 0, dead: false,
    hopT: rand(0.2, 1.1), atkCd: rand(0.8, 1.6),
    snare: 0, spawnT: 0.45, lastHitToken: -1, airT: 0, marked: 0
  };
  game.enemies.push(e);
  spawnFx('spawn/spawn-portal', e.x, e.y, 0, { scale: t.boss ? 2.2 : 1, life: 0.8 });
  return e;
}

function spawnWave(n, pool, around) {
  const types = pool || ['slime', 'frog', 'bat'];
  const room = 24 - game.enemies.length;
  const count = Math.max(0, Math.min(n, room));
  for (let i = 0; i < count; i++) {
    const type = types[i % types.length];
    const span = around != null ? around : 460;
    const base = game.arena ? game.arena.cx : player.x;
    const x = clamp(base + rand(-span, span) * (i % 2 ? 1 : -1), (game.arena ? game.arena.x0 + 60 : 90), (game.arena ? game.arena.x1 - 60 : STAGE_W - 90));
    const y = FLOOR_TOP + rand(0.12, 0.96) * FLOOR_H;
    spawnEnemy(type, x, y);
  }
}

function startArena(a) {
  a.active = true;
  a.wave = 0;
  a.x0 = a.x;
  a.x1 = a.x + a.w;
  a.cx = a.x + a.w * 0.5;
  game.arena = a;
  game.cam.lock = 1;
  spawnWave(a.waves * 3 + 1, a.pool, a.w * 0.34);
  bus.banner(a.label, 'WAVE 1 / ' + a.waves);
  bus.audio('gate');
}

function nextWave(a) {
  a.wave++;
  if (a.wave >= a.waves) {
    if (a.boss && !a.bossSpawned) {
      a.bossSpawned = true;
      bus.banner(a.label, 'THE WARDEN AWAKENS');
      const b = spawnEnemy('boss', a.cx + 220, FLOOR_TOP + FLOOR_H * 0.55);
      game.boss = b;
      b.hp = b.maxHp = 110 + game.level * 12;
    } else {
      a.done = true;
      a.active = false;
      game.arena = null;
      game.cam.lock = 0;
      bus.banner('AREA CLEARED', a.label);
      bus.audio('gate');
      bus.go(a);
      gainXp(3);
      bus.cards();
    }
    return;
  }
  spawnWave(a.waves * 3 + 1, a.pool, a.w * 0.3);
  bus.banner(a.label, 'WAVE ' + (a.wave + 1) + ' / ' + a.waves);
}

function updateEnemies(dt) {
  for (const e of game.enemies) {
    if (e.dead) continue;
    e.t += dt;
    if (e.flash > 0) e.flash -= dt;
    if (e.marked > 0) e.marked = Math.max(0, e.marked - dt * 0.5);
    if (e.spawnT > 0) { e.spawnT -= dt; continue; }
    if (e.snare > 0) { e.snare -= dt; }
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const dist = Math.abs(dx);
    e.facing = dx >= 0 ? 1 : -1;

    if (e.snare <= 0) {
      if (e.def.boss) {
        /* three phases: bolt volleys -> wider volley + ground slam -> suicide rush */
        const frac = e.hp / Math.max(1, e.maxHp);
        const phase = frac > 0.66 ? 1 : frac > 0.33 ? 2 : 3;
        if (phase !== e.phase) {
          if (e.phase) {
            bus.banner('PHASE ' + phase, phase === 3 ? 'THE WARDEN UNMAKES ITSELF' : 'THE WARDEN RAGES');
            spawnFx('explosions/big-explosion', e.x, e.y, e.z, { scale: 1.5, life: 0.7 });
            game.cam.shake = 14;
            for (let i = 0; i < 3; i++) spawnEnemy('skull', e.x + rand(-140, 140), e.y + rand(-20, 20));
          }
          e.phase = phase;
        }
        const hover = e.def.hover + Math.sin(e.t * 1.6) * 10;
        e.z = lerp(e.z, hover, 1 - Math.pow(0.05, dt));
        e.x += sign(dx) * e.def.speed * (1 + (phase - 1) * 0.35) * dt;
        e.y += clamp(dy, -1, 1) * 34 * dt;
        e.auraT = (e.auraT || 0) - dt;
        if (e.auraT <= 0) {
          e.auraT = 2.2;
          spawnFx('arcane/rune-circle', e.x, e.y, 0, { scale: 1.9, life: 1.4, alpha: 0.75 });
        }
        e.atkCd -= dt;
        if (e.atkCd <= 0 && dist < 620) {
          e.atkCd = phase === 1 ? 2.1 : phase === 2 ? 1.5 : 1.0;
          const spread = phase === 1 ? 1 : 2;
          for (let i = -spread; i <= spread; i++) {
            spawnHostileBolt(e.x, e.y, e.z + i * 16, sign(dx) * (330 + phase * 40), 2);
          }
          if (phase >= 2) {
            spawnFx('impacts/ground-slam', e.x, e.y, 0, { scale: 1.4, life: 0.5 });
            game.cam.shake = Math.max(game.cam.shake, 6);
          }
          spawnFx('lightning/charge-up', e.x, e.y, e.z + 30, { scale: 1.2, life: 0.5 });
        }
      } else if (e.def.fly) {
        const hover = e.def.hover + Math.sin(e.t * 2.3) * 9;
        e.z = lerp(e.z, hover, 1 - Math.pow(0.02, dt));
        e.x += sign(dx) * e.def.speed * dt * 0.85;
        e.y += sign(dy) * Math.min(Math.abs(dy), e.def.speed * 0.7 * dt);
      } else {
        e.hopT -= dt;
        if (e.hopT <= 0 && e.z <= 0.6) {
          e.hopT = rand(0.75, 1.4);
          e.vz = rand(230, 300);
          e.vx = sign(dx) * e.def.speed;
        }
        e.vz -= GRAVITY * dt;
        e.z += e.vz * dt;
        if (e.z <= 0) { e.z = 0; e.vz = 0; e.vx *= 0.35; }
        e.x += e.vx * dt * (e.snare > 0 ? 0 : 1);
        e.y += clamp(dy, -1, 1) * e.def.speed * 0.42 * dt;
      }
    } else {
      /* launched / frozen: pure z physics so juggles read */
      e.vz -= GRAVITY * dt;
      e.z += e.vz * dt;
      if (e.z <= 0) { e.z = 0; e.vz = 0; }
    }

    e.x = clamp(e.x, 30, STAGE_W - 30);
    e.y = clamp(e.y, FLOOR_TOP, FLOOR_BOTTOM);

    /* contact damage */
    e.atkCd -= dt;
    const near = Math.abs(e.x - player.x) < (e.def.boss ? 62 : 36) &&
                 Math.abs(e.y - player.y) < 30 &&
                 Math.abs(e.z + e.h * 0.4 - (player.z + 24)) < 54;
    if (near && e.atkCd <= 0 && player.invuln <= 0) {
      e.atkCd = e.def.boss ? 1.4 : 1.15;
      hurtPlayer(e.def.boss ? 2 : 1, !!e.def.boss);
      spawnFx('impacts/blunt-hit', player.x, player.y, player.z + 24, { scale: 0.9, life: 0.3 });
    }
  }
  game.enemies = game.enemies.filter((e) => !e.dead);
  if (game.boss && game.boss.dead) game.boss = null;
}

function drawEnemy(e) {
  const s = depthScale(e.y);
  const sy = e.y - e.z * s;
  const flip = e.facing < 0;
  const sc = e.def.boss ? SPRITE.boss : SPRITE.enemy;
  /* the contact shadow sits on the deck and shrinks as the critter hovers */
  contactShadow(e.x, e.y, e.z, e.def.boss ? 2.6 : (e.def.fly ? 1 : 1.3), 1, 0);

  ctx.save();
  if (e.spawnT > 0) ctx.globalAlpha = clamp(1 - e.spawnT / 0.45, 0.12, 1);
  if (e.flash > 0) {
    ctx.globalAlpha = clamp(e.flash * 5, 0, 0.6);
    ctx.fillStyle = '#ffffff';
    const hh = Math.round(e.h * sc * 0.8);
    ctx.fillRect(Math.round(e.x - game.cam.x) - hh * 0.45, Math.round(sy) - hh, hh * 0.9, hh);
    ctx.globalAlpha = 1;
  }
  if (e.snare > 0) ctx.globalAlpha = 0.85;
  drawClip(e.key, e.x - game.cam.x, sy, e.t, { scale: sc, flip });
  ctx.restore();

  /* boss ground marker */
  if (e.def.boss) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#ffb3a0';
    ctx.fillRect(Math.round(e.x - game.cam.x) - 40, Math.round(e.y) - 1, 80, 2);
    ctx.globalAlpha = 1;
  }
  if (e.snare > 0) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#b6f2ff';
    ctx.fillRect(Math.round(e.x - game.cam.x) - 14, Math.round(sy) - Math.round(e.h * sc) - 6, 28, 2);
    ctx.globalAlpha = 1;
  }
  /* assassin's mark: a violet tag over the head while it is vulnerable */
  if (e.marked > 0) {
    const mx = Math.round(e.x - game.cam.x);
    const my = Math.round(sy) - Math.round(e.h * sc) - 14;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#b8a2ff';
    ctx.fillRect(mx - 5, my, 10, 2);
    ctx.fillRect(mx - 1, my + 2, 2, 5);
    ctx.fillRect(mx - 3, my - 2, 6, 2);
    ctx.globalAlpha = 1;
  }
}
export {
  ENEMY_TYPES, drawEnemy, nextWave, spawnEnemy, spawnWave, startArena, updateEnemies
};
