/**
 * core.js — the kernel.
 *
 * Viewport numbers, the contract constants, the shared `game` state object, the
 * input tables and the small math helpers every other module leans on. This file
 * imports nothing, so the whole dependency graph stays acyclic:
 *
 *   core → pfx → world → classes → enemies / ui → main
 *
 * The viewport values (W, H, HORIZON, FLOOR_TOP …) are live `let` bindings: only
 * `layout()` here may write them, every other module just reads the current
 * value through its import.
 */

/* ------------------------------------------------------------------ config */

export const STAGE_W = 3600;          /* the street is 3600 px of walkable x */
export const GRAVITY = 1550;
export const JUMP_VZ = 580;
export const DOUBLE_JUMP_VZ = 545;
export const SPEED_X = 268;
export const SPEED_Y = 200;           /* depth is a little slower than width */
export const DEPTH_TOL = 44;          /* |dy| tolerance for every hit test */
export const HEIGHT_TOL = 60;         /* |dz| tolerance for every hit test */
export const HITSTOP = 0.04;          /* 40 ms freeze on a clean hit */
export const HORIZON_FRAC = 0.46;     /* the horizon line sits at 46 % of the view */
export const MAX_LEVEL = 5;
export const ULT_PER_HIT = 8;         /* % of the charge meter per hit */
export const ULT_PER_KILL = 15;
export const XP_STEPS = [0, 6, 16, 30, 50];   /* xp needed to BE level n+1 */
export const SPRITE = { player: 2.5, enemy: 1.8, boss: 3.3, fx: 1.2, pickup: 1.35, bolt: 1.0 };

/* ---------------------------------------------------------------- viewport */

export let W = 0, H = 0;
/** the battlefield surface + its context, installed once by main.js */
export let canvas = null;
export let ctx = null;
export let HORIZON = 0, FLOOR_TOP = 0, FLOOR_BOTTOM = 0, FLOOR_H = 0, WALL_TOP = 0;

/* ------------------------------------------------------------------ maths */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const sign = (v) => (v < 0 ? -1 : 1);

/** 0 at the back of the lane, 1 at the front — drives every depth cue */
export const depthV = (y) => clamp((y - FLOOR_TOP) / Math.max(1, FLOOR_H), 0, 1);
/** further away = a little smaller */
export const depthScale = (y) => lerp(0.86, 1.04, depthV(y));

/** '#rrggbb' or 'rgb(r,g,b)' -> [r,g,b], so mixes can be chained */
export function parseCol(c) {
  if (c[0] === '#') {
    const h = c.slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const m = c.match(/\d+/g) || [0, 0, 0];
  return [+m[0], +m[1], +m[2]];
}
/** blend two colours into an rgb() string — used for all depth shading */
export function mix(a, b, t) {
  const A = parseCol(a), B = parseCol(b);
  const r = Math.round(A[0] + (B[0] - A[0]) * t);
  const g = Math.round(A[1] + (B[1] - A[1]) * t);
  const bl = Math.round(A[2] + (B[2] - A[2]) * t);
  return 'rgb(' + r + ',' + g + ',' + bl + ')';
}
export function shade(c, t) { return mix(c, t < 0 ? '#000000' : '#ffffff', Math.abs(t)); }

/* -------------------------------------------------------------- game state */

export const game = {
  time: 0,
  cam: { x: 0, y: 0, shake: 0, lock: 0 },
  hitStop: 0,
  classId: 'knight',
  level: 1,
  xp: 0,
  ult: 0,
  god: false,
  paused: false,
  boss: null,
  cd: { shift: 0, q: 0, e: 0, r: 0 },
  mouse: { x: 0, y: 0, down: false },
  enemies: [],
  bolts: [],
  fx: [],
  pickups: [],
  texts: [],
  barrage: null,
  arena: null,
  banner: { text: '', sub: '', t: 0 },
  hitToken: 0,
  cards: [],
  upgrades: { hp: 0, power: 0, speed: 0, charge: 0, cdr: 0 },
  stats: { hits: 0, kills: 0, casts: 0, maxCombo: 0, combo: 0, comboT: 0 }
};

/* ------------------------------------------------------------------ input */

/** key state, written by main.js and read by the movement code */
export const keys = Object.create(null);
/** one-shot flags that have to survive a frame */
export const input = { jump: false, jumpBuf: 0 };

/* --------------------------------------------------------------- helpers */

/** world (x, y, z) -> screen (x, y) plus the depth scale at that lane spot */
export function bodyScreen(b) {
  const s = depthScale(b.y);
  return { x: b.x - game.cam.x, y: b.y - (b.z || 0) * s, s };
}

/**
 * Recompute the viewport split. 46 % sky, a stone curb, then the walkable lane.
 * Only this function writes the layout bindings.
 */
export function layout(cv) {
  W = cv.width = Math.max(480, Math.floor(window.innerWidth));
  H = cv.height = Math.max(300, Math.floor(window.innerHeight));
  HORIZON = Math.round(H * HORIZON_FRAC);
  FLOOR_TOP = HORIZON + Math.round(H * 0.032);
  FLOOR_BOTTOM = H - Math.round(H * 0.075);
  FLOOR_H = Math.max(60, FLOOR_BOTTOM - FLOOR_TOP);
  WALL_TOP = Math.round(HORIZON - H * 0.085);   /* top of the back wall */
}

/** install the battlefield canvas and size it for the current window */
export function setCanvas(cv) {
  canvas = cv;
  ctx = cv.getContext('2d', { alpha: false });
  layout(cv);
  ctx.imageSmoothingEnabled = false;
}

/**
 * Cross-module notifications, wired once in main.js. Keeping them in one flat
 * object is what stops `ui` and `classes` from importing each other.
 */
export const bus = {
  banner: () => {},
  callout: () => {},
  number: () => {},
  deny: () => {},
  hud: () => {},
  dev: () => {},
  cards: () => {},
  audio: () => {}
};
