import assert from 'node:assert/strict';
import { PixelCharacters } from '../js/pixel-characters.js';
const tasks=[]; globalThis.requestIdleCallback=cb=>tasks.push(cb);
let visible=0,colors=new Set();
globalThis.document={createElement(){return {getContext(){return {
  createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
  putImageData(img){for(let i=0;i<img.data.length;i+=4)if(img.data[i+3]){visible++; colors.add(`${img.data[i]},${img.data[i+1]},${img.data[i+2]}`);}},
  fillRect(){},set fillStyle(v){},set globalCompositeOperation(v){}
}}}}};
const renderer=new PixelCharacters();
for(let i=0;i<1600;i++){await new Promise(r=>setImmediate(r));if(tasks.length)tasks.shift()();if(!tasks.length&&renderer.queue.length===0)break;}
for(const style of ['knight','gunslinger','sniper','mage','berserker','shadow','tech','enemyKnight','enemyArcher','enemyMage','enemyBrute','enemyBomber','boss']) {
  assert.equal(renderer.request(style,'idle').length,4,style+' idle');
  assert.equal(renderer.request(style,'run').length,6,style+' run');
  assert.equal(renderer.request(style,'attack').length,6,style+' attack');
}
assert.ok(visible>10000&&colors.size>50,'sprites must be visible and colored');
const ops=[]; const ctx={save(){},restore(){},translate(...x){ops.push(['translate',...x]);},scale(...x){ops.push(['scale',...x]);},drawImage(){ops.push(['draw']);},set imageSmoothingEnabled(v){assert.equal(v,false)}};
assert.ok(renderer.draw(ctx,'knight','run',4,5,Math.PI,2,null,{scale:1.25}));
assert.deepEqual(ops[1],['scale',-1,1]);
const skin={navy:'#c82135',navyDark:'#410b16',navyLit:'#fa5567',visor:'#f3ce35'};
assert.equal(renderer.request('knight','idle',skin),null);
for(let i=0;i<10&&tasks.length;i++)tasks.shift()();
assert.equal(renderer.request('knight','idle',skin).length,4);
console.log('Class and enemy pixel sprite cache, palette, frame counts and facing checks passed');
