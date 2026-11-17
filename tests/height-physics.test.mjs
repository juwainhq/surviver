import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync('index.html','utf8');
const physics=src.slice(src.indexOf('function jumpPlayer() {'), src.indexOf('function updatePlayer(dt) {'));
const player={x:0,y:0,z:0,vz:0,damage:5}, enemy={x:20,y:0,z:0,vz:0,r:10}, airborne={x:10,y:0,z:60,vz:0,r:10};
const game={player,enemies:[enemy,airborne],screen:'playing',boss:null};
let damage=0,knock=0,fx=0;
const scope={game,isPaused:false,gameState:{isDying:false},actorAnimator:null,
  PixelFX:{spawn(){fx++;}},Sound:{bash(){}},buffedDamage:x=>x,
  dist:(x,y,a,b)=>Math.hypot(x-a,y-b),damageEnemy(){damage++;},knockEnemy(){knock++;},damageBoss(){}};
vm.createContext(scope);vm.runInContext(physics,scope);
assert.equal(scope.jumpPlayer(),true); assert.equal(scope.jumpPlayer(),false);
scope.updateHeightPhysics(.1); assert.ok(player.z>40); assert.equal(scope.heightsOverlap(player,enemy),false);
let elapsed=.1;while(player.z>0 && elapsed<2){scope.updateHeightPhysics(.01);elapsed+=.01;}
assert.equal(player.z,0);assert.equal(player.vz,0);assert.ok(elapsed>.6&&elapsed<.8);
airborne.z=60; airborne.vz=0;
player.pendingGroundPound=true;player.z=20;player.vz=-250;
scope.updateHeightPhysics(.1);assert.equal(player.pendingGroundPound,false);assert.equal(fx,1);assert.equal(damage,1);assert.equal(knock,1);
scope.updateHeightPhysics(.1);assert.equal(fx,1);
player.z=30;player.vz=-50;player.stompDelay=.06;scope.updateHeightPhysics(.07);
assert.equal(player.stompDelay,0);assert.equal(fx,1);
scope.updateHeightPhysics(.2);assert.equal(player.stompDelay,-1);assert.equal(fx,2);
console.log('Jump, gravity, height overlap and landing shockwave checks passed');
