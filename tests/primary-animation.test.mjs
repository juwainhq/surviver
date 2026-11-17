import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const chars=readFileSync(new URL('../js/pixel-characters.js',import.meta.url),'utf8');
function part(a,b){const i=html.indexOf(a),j=html.indexOf(b,i);assert.ok(i>=0&&j>i);return html.slice(i,j);}
const requests=[];
const env={pixelCharacters:{request(...args){requests.push(args)}},pixelSkin:()=>null,actorAnimator:null,game:{player:null,enemies:[],boss:null},PixelFX:{spawn(){}},Math};
vm.createContext(env);
vm.runInContext(part('function integrateHeight(', 'function updatePlayer(dt)'),env);
vm.runInContext(part('const PRIMARY_ANIMATION_MOVES', 'function primaryCooldownProgress()'),env);
const expected={knight:'sword-combo',mage:'fireball-throw',gunslinger:'pistol-shots',sniper:'arrow-shot',tech:'rocket-launcher',berserker:'ground-pound',shadow:'dagger-flurry'};
for(const [cls,move] of Object.entries(expected)) {
  const p={classId:cls,z:0,vz:0,vx:0,vy:0,reloadT:0};env.game.player=p;
  env.p=p;vm.runInContext('registerPrimaryAttack(p, 0.8)',env);
  assert.equal(p.currentMove,move);assert.equal(p.animationState,'attack');assert.equal(p.primaryAnimDuration,0.8);
  assert.equal(requests.at(-1)[3],move);
  vm.runInContext('updateHeightPhysics(0.4)',env);
  assert.equal(p.animationState,'attack');assert.equal(p.primaryAnimElapsed,0.4);
  p.vx=1;vm.runInContext('updateHeightPhysics(0.4)',env);
  assert.equal(p.animationState,'run');assert.equal(p.currentMove,null);
  p.vx=0;vm.runInContext('updateHeightPhysics(0.01)',env);assert.equal(p.animationState,'idle');
  p.reloadT=0.3;vm.runInContext('registerPrimaryAttack(p, 0.2)',env);assert.equal(p.primaryAnimDuration,0.5);
}
assert.match(chars,/melee\/dagger-flurry\.js/);
assert.match(chars,/options\.animDuration/);
assert.match(chars,/if \(!job\.player\) details/);
assert.doesNotMatch(part('function drawPlayer()', '/* =============================================================================\n   RENDERING'),/\.(?:fillRect|rect)\s*\(/);
console.log('Seven primary moves, cooldown timing, transitions and player overlay isolation verified');
