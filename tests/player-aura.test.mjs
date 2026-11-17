import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const a=html.indexOf('function drawPlayer() {'),b=html.indexOf('/* =============================================================================\n   RENDERING',a);
assert.ok(a>=0 && b>a);
const body=html.slice(a,b);
assert.doesNotMatch(body,/\.(?:fillRect|strokeRect|arc|ellipse|lineTo)\s*\(/);
const calls=[];
const player={classId:'mage',x:100,y:150,z:10,angle:0,vx:0,vy:0};
const game={player,time:3};
const env={game,gameState:{currentClass:'mage'},ctx:{},drawPlayerGroundShadow(){calls.push(['shadow']);},pixelSkin(){return null;},
  pixelCharacters:{draw(...args){calls.push(['player',args[1]]);if(args[1]==='mage')args[8].onStaffTip(112,65);return true;}},
  PixelFX:{loop(...args){calls.push(['fx',...args]);return true;}}};
vm.createContext(env);vm.runInContext(body,env);vm.runInContext('drawPlayer()',env);
assert.deepEqual(calls.map(c=>c[0]==='fx'?c[2]:c[0]),['shadow','arcane/rune-circle','player','arcane/arcane-orb']);
assert.equal(calls[1][3],100);assert.equal(calls[1][4],150);
assert.equal(calls[3][3],112);assert.equal(calls[3][4],65);assert.ok(calls[3][6].offsetY<0);
calls.length=0;player.classId='knight';vm.runInContext('drawPlayer()',env);
assert.deepEqual(calls.map(c=>c[0]==='fx'?c[2]:c[0]),['shadow','player','holy/halo']);
assert.equal(calls[2][4],140);
console.log('Primitive-free player rendering and class aura placement verified');
