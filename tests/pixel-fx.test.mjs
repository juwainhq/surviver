// Run with: node tests/pixel-fx.test.mjs
import assert from 'node:assert/strict';
import { PixelFXCache, PixelFXManager, ERA_PALETTES, ENEMY_PLASMA_PALETTE } from '../js/pixel-fx-manager.js';

const tasks = [];
globalThis.requestIdleCallback = cb => tasks.push(cb);
let writes = 0, visiblePixels = 0, centeredPixels = 0;
globalThis.document = { createElement() {
  return { width: 0, height: 0, getContext() { return {
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4) }; },
    putImageData(image) {
      writes++;
      // The spawn portal's origin is (104,122). Its ground effect must not be
      // accidentally rasterized at the image's top-left and clipped away.
      const width = 208;
      for (let y = 85; y < 145; y++) for (let x = 65; x < 143; x++) {
        if (image.data[(y * width + x) * 4 + 3]) centeredPixels++;
      }
      for (let i = 3; i < image.data.length; i += 4) if (image.data[i]) visiblePixels++;
    }, drawImage() {}, imageSmoothingEnabled: true
  }; } };
} };
const flush = async (entry, cache) => {
  for (let n = 0; n < 500 && !entry.ready && !entry.failed; n++) {
    await new Promise(resolve => setImmediate(resolve));
    if (tasks.length) tasks.shift()();
  }
  assert.equal(entry.failed, false);
  assert.equal(entry.ready, true);
  assert.equal(entry.frames.length, 20);
};
const cache = new PixelFXCache();
assert.equal(cache.request('not-an-effect'), null);
const id = 'spawn-and-death/spawn-portal', palette = ERA_PALETTES[2];
assert.equal(cache.request(id, palette), null);
const entry = cache.entries.get(cache.key(id, palette));
await flush(entry, cache);
assert.equal(writes, 20); // only offscreen contexts received putImageData
assert.ok(visiblePixels > 1000 && centeredPixels > 500, 'portal must be visible at its authored origin');
const draws = [];
const main = { save(){}, restore(){}, translate(){}, rotate(){}, scale(){},
  drawImage(...args){ draws.push(args); }, set imageSmoothingEnabled(v){ assert.equal(v, false); },
  putImageData(){ throw Error('main canvas pixel write'); } };
const manager = Object.create(PixelFXManager.prototype);
manager.cache = cache; manager.live = [];
assert.equal(manager.spawn(id, 5, 7, { palette }), true);
manager.update(0.1); manager.draw(main);
assert.equal(draws.length, 1);
assert.equal(manager.drawLoop(main, id, 5, 7, 0, { palette, progress: 0.5 }), true);
manager.update(entry.duration); assert.equal(manager.live.length, 0);
assert.equal(manager.spawn('missing', 0, 0), false);
const red=['#280812','#5b1020','#a31b2c','#ec3044','#ff7962','#ffc7a2','#fff4df'];
cache.request('arcane/arcane-orb',red);
const orb=cache.entries.get(cache.key('arcane/arcane-orb',red));
await flush(orb,cache);
const orbOffset=-52*96/136;
assert.equal(manager.drawLoop(main,'arcane/arcane-orb',8,9,0.3,{palette:red,angle:Math.PI/2,scale:1.5,offsetY:orbOffset}),true);
assert.ok(Math.abs(draws.at(-1)[2]-(-orb.originY-orbOffset))<0.001, 'orb center must stay at collision position');
const primed = new PixelFXManager();
for (const name of ['critters/slime','critters/bat','critters/eyeball','projectiles/bullet-tracer','projectiles/laser-bolt','projectiles/energy-disc','arcane/arcane-orb','melee/sword-slash','melee/heavy-cleave','melee/hammer-smash','melee/dagger-flurry']) {
  const first=primed.cache.request(name);
  assert.ok(first && first.frames.length, name+' must be drawable immediately');
}
assert.ok(primed.cache.request('projectiles/plasma-shot', ENEMY_PLASMA_PALETTE));
console.log('PixelFX cache, palette, world-space draw and fallback checks passed');
