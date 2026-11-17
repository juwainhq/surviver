import assert from 'node:assert/strict';
import { ActorAnimator } from '../js/actor-animator.js';
const tasks=[];
globalThis.requestIdleCallback = cb => tasks.push(cb);
let pixels = 0;
globalThis.document = { createElement: () => ({ getContext: () => ({
  createImageData: (w,h) => ({data: new Uint8ClampedArray(w*h*4)}),
  putImageData(image) { for (let i=3; i<image.data.length; i+=4) if(image.data[i]) pixels++; }
}) }) };
const a=new ActorAnimator();
for (let n=0;n<1500;n++) {
  await new Promise(resolve => setImmediate(resolve));
  if (tasks.length) tasks.shift()();
  if (a.frames.size === 12 && [...a.frames.values()].every(f=>f.ready)) break;
}
for(const id of ['idle','run','jump','sword-combo','dash-strike','ground-pound','earth-stomp','fireball-throw','meteor-call','pistol-shots','rocket-launcher','arrow-shot'])
  assert.ok(a.frames.get(id)?.ready, id + ' frames should bake');
assert.ok(pixels > 10000, 'poses should contain visible pixels');
const p={x:20,y:30,z:40,vz:2,vx:0,vy:0,angle:Math.PI,animLock:0};
a.update(p,.01); assert.equal(p.animState,'jump');
assert.ok(a.play(p,'sword-combo')); assert.equal(a.play(p,'pistol-shots'),false);
const ops=[]; const ctx={save(){},restore(){},translate(...v){ops.push(['translate',...v]);},scale(...v){ops.push(['scale',...v]);},drawImage(){ops.push(['draw']);},set imageSmoothingEnabled(v){assert.equal(v,false)}};
assert.ok(a.draw(ctx,p,0));
assert.deepEqual(ops[0],['translate',20,-10]); assert.deepEqual(ops[1],['scale',-1,1]);
a.update(p,2); assert.equal(p.animState,'jump');
console.log('Rig baking, move lock, jump pose and facing checks passed');
