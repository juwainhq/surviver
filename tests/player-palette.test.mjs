import assert from 'node:assert/strict';
import { PixelCharacters } from '../js/pixel-characters.js';
const tasks=[];
globalThis.requestIdleCallback=cb=>tasks.push(cb);
globalThis.document={createElement(){
  const canvas={marks:[]};
  canvas.getContext=()=>({fillStyle:'',globalCompositeOperation:'source-over',
    createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),
    putImageData(image){canvas.pixels=image.data;},
    fillRect(x,y,w,h){canvas.marks.push({color:this.fillStyle,x,y,w,h,mode:this.globalCompositeOperation});}
  });
  return canvas;
}};
const renderer=new PixelCharacters();
for (const cls of ['knight','mage','gunslinger']) renderer.request(cls,'idle',null,'',true);
for(let i=0;i<1200;i++) {
  await new Promise(r=>setImmediate(r));if(tasks.length)tasks.shift()();
  if(['knight','mage','gunslinger'].every(cls=>renderer.request(cls,'idle',null,'',true)))break;
}
const sprite=cls=>renderer.request(cls,'idle',null,'',true)[0];
const has=(cls,color)=>sprite(cls).marks.some(m=>m.color===color);
assert.ok(has('knight','#ef4444') && has('knight','#cbd5e1') && has('knight','#fbbf24'));
assert.ok(sprite('knight').marks.some(m=>m.color==='#991b1b'&&m.mode==='destination-over'));
assert.ok(has('mage','#f59e0b') && has('mage','#78350f') && has('mage','#22d3ee'));
assert.ok(has('gunslinger','#ef4444') && has('gunslinger','#cbd5e1'));
function pixelColor(cls, hex) {
  const bytes=hex.match(/[0-9a-f]{2}/gi).map(x=>parseInt(x,16)), pixels=sprite(cls).pixels;
  for(let i=0;i<pixels.length;i+=4) if(pixels[i]===bytes[0]&&pixels[i+1]===bytes[1]&&pixels[i+2]===bytes[2]&&pixels[i+3])return true;
  return false;
}
for (const [cls,colors] of Object.entries({knight:['334155','475569','f59e0b'],mage:['312e81','4338ca','06b6d4'],gunslinger:['451a03','78350f','ef4444']}))
  for(const color of colors) assert.ok(pixelColor(cls,color),`${cls} missing ${color}`);
assert.notEqual(renderer.key('knight','idle',null,'',true),renderer.key('knight','idle',null,'',false));
console.log('Player-only costume colors, cape, weapons, and cache isolation verified');
