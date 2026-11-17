// Cached 16-bit character skins built from PixelFX's articulated rig. All
// pixel writes and costume details are baked offscreen, never in the render loop.
import { posed, poseAt, skeleton, STAND } from '../vendor/pixelfx/src/core/index.js';
const STYLES = {
  knight: ['#334155','#94a3b8','#f59e0b','#991b1b','knight'],
  gunslinger: ['#451a03','#a16207','#dc2626','#78350f','gunslinger'],
  sniper: ['#1e293b','#475569','#10b981','#064e3b','sniper'],
  mage: ['#312e81','#6366f1','#f59e0b','#1e1b4b','mage'],
  berserker: ['#7f1d1d','#d97757','#dc2626','#78350f','berserker'],
  shadow: ['#0f172a','#475569','#a855f7','#6b21a8','shadow'],
  tech: ['#1e293b','#64748b','#06b6d4','#0e7490','tech'],
  enemyKnight: ['#202532','#64748b','#ef4444','#7f1d1d','knight'],
  enemyArcher: ['#182e22','#52654b','#e8b56a','#3b2518','archer'],
  enemyMage: ['#291b3b','#714b83','#c084fc','#351543','cultist'],
  enemyBrute: ['#29292d','#8c7373','#ef4444','#4a2020','brute'],
  enemyBomber: ['#3d3425','#98734b','#fb923c','#4b2917','bomber'],
  boss: ['#271321','#78364b','#f59e0b','#7f1d1d','boss']
};
// These costumes are reserved for the player; enemy and menu sprites keep
// their existing palettes and silhouette caches.
const PLAYER_STYLES = {
  knight: ['#334155', '#475569', '#fbbf24', '#991b1b', 'knight'],
  mage: ['#312e81', '#4338ca', '#f59e0b', '#1e1b4b', 'mage'],
  sniper: ['#0f172a', '#334155', '#10b981', '#064e3b', 'sniper'],
  gunslinger: ['#451a03', '#78350f', '#ef4444', '#78350f', 'gunslinger']
};
const PLAYER_OUTLINES = { knight:'#f59e0b', mage:'#06b6d4', sniper:'#10b981', gunslinger:'#ef4444' };
const MOVES = {knight:'sword-combo',gunslinger:'pistol-shots',sniper:'pistol-shots',mage:'fireball-throw',berserker:'ground-pound',shadow:'sword-combo',tech:'pistol-shots',enemyKnight:'sword-combo',enemyArcher:'arrow-shot',enemyMage:'fireball-throw',enemyBrute:'ground-pound',enemyBomber:'ground-pound',boss:'sword-combo'};
const DURATIONS = {'sword-combo':0.38,'dash-strike':0.4,'ground-pound':0.8,'earth-stomp':0.4,'fireball-throw':0.45,'meteor-call':0.6,'pistol-shots':0.3,'rocket-launcher':0.45,'arrow-shot':0.4};
const SOURCE_DURATIONS = {'sword-combo':1.55,'dash-strike':1.8,'ground-pound':1.4,'earth-stomp':1.2,'fireball-throw':1.6,'meteor-call':2.3,'pistol-shots':1.2,'rocket-launcher':1.5,'arrow-shot':1.1};
const NAMED_MOVES = Object.keys(DURATIONS);
const later = cb => typeof requestIdleCallback === 'function' ? requestIdleCallback(cb,{timeout:200}) : setTimeout(cb,16);
function rgb(hex) { const v=parseInt(String(hex).replace('#',''),16); return [(v>>16)&255,(v>>8)&255,v&255]; }
function mix(a,b,t) { return a.map((x,i)=>Math.round(x+(b[i]-x)*t)); }
function fixedPose(state, i, count) {
  if (state === 'run') {
    const t=i*Math.PI*2/count, leg=Math.round(Math.sin(t)*5);
    return {...STAND, lean:1, crouch:1, ffx:leg-2, ffy:-Math.max(0,Math.round(Math.cos(t)*3)),
      fbx:-leg+2, fby:-Math.max(0,Math.round(-Math.cos(t)*3)), fx:-3-leg, bx:5+leg};
  }
  if(state==='jump') return {...STAND,crouch:1,ffx:-4,ffy:-5,fbx:4,fby:-3,fx:-5,fy:-22,bx:7,by:-22};
  return {...STAND, lean:0, crouch:1, ffx:-3, fbx:3, fx:0, fy:-16, bx:5, by:-15};
}
function rect(g,color,x,y,w,h){ g.fillStyle=color; g.fillRect(x,y,w,h); }
function details(g, spec, state, frame) {
  const [dark,light,accent,cloth,kind]=spec, ink='#090d16';
  // Back-facing silhouettes and a weapon are attached at the rig's hand/torso.
  g.globalCompositeOperation='destination-over';
  if(['knight','boss','sniper','mage','shadow','cultist'].includes(kind)) {
    rect(g,ink,35,49,10,25); rect(g,cloth,36,50,8,23+(frame%2));
  }
  g.globalCompositeOperation='source-over';
  if(kind==='gunslinger') { rect(g,ink,40,37,19,3); rect(g,dark,43,32,12,5); rect(g,accent,45,46,8,2); }
  else if(kind==='mage'||kind==='cultist') { rect(g,ink,43,31,12,8); rect(g,dark,44,32,10,7); rect(g,accent,47,30,4,2); }
  else if(kind==='berserker'||kind==='brute') { rect(g,ink,40,35,18,6); rect(g,light,38,33,3,5); rect(g,light,57,33,3,5); }
  else if(kind==='boss') { rect(g,ink,40,31,17,8); rect(g,accent,41,32,3,5); rect(g,accent,47,29,3,8); rect(g,accent,53,32,3,5); }
  else if(kind==='archer'||kind==='sniper'||kind==='shadow') { rect(g,ink,41,36,15,7); rect(g,dark,42,37,13,6); rect(g,accent,49,41,6,2); }
  else { rect(g,ink,40,36,16,8); rect(g,dark,41,37,14,6); rect(g,accent,47,41,7,2); }
  // Held weapon silhouettes, pixel-sized, distinguish every class/archetype.
  if(kind==='knight'||kind==='boss') { rect(g,ink,56,43,4,23); rect(g,light,57,43,2,18); rect(g,accent,54,59,8,2); rect(g,ink,37,51,7,14); rect(g,light,38,52,5,11); }
  else if(kind==='gunslinger') { rect(g,ink,56,52,12,4); rect(g,light,57,52,10,2); rect(g,ink,40,57,8,3); rect(g,accent,42,57,5,1); }
  else if(kind==='sniper') { rect(g,ink,55,48,19,4); rect(g,light,56,49,17,2); rect(g,accent,65,47,4,1); }
  else if(kind==='mage'||kind==='cultist') { rect(g,ink,59,39,4,29); rect(g,light,60,40,2,27); rect(g,accent,58,37,6,5); }
  else if(kind==='berserker'||kind==='brute') { rect(g,ink,58,45,4,25); rect(g,cloth,59,46,2,23); rect(g,ink,55,39,14,9); rect(g,light,56,40,12,7); }
  else if(kind==='shadow') { rect(g,ink,56,51,9,3); rect(g,accent,57,52,7,1); rect(g,ink,38,58,8,3); rect(g,accent,39,59,6,1); }
  else if(kind==='tech') { rect(g,ink,56,49,12,8); rect(g,light,57,50,10,6); rect(g,accent,62,51,4,4); rect(g,accent,39,50,3,8); }
  else if(kind==='archer') { rect(g,ink,61,43,2,22); rect(g,light,62,44,2,20); rect(g,ink,55,52,13,2); rect(g,accent,55+(state==='attack'? -2:0),52,12,1); }
  else if(kind==='bomber') { rect(g,ink,34,48,10,14); rect(g,cloth,35,49,8,12); rect(g,accent,37,47,4,3); }
}
export class PixelCharacters {
  constructor(onReady) {
    this.cache=new Map();this.queue=[];this.working=false;this.moves={};this.onReady=onReady;
    for(const name of NAMED_MOVES) { this.moves[name]=null; import('../vendor/pixelfx/src/fx/moves/'+name+'.js').then(m=>{this.moves[name]=m;}).catch(()=>{this.moves[name]=false;}); }
    for(const style of Object.keys(STYLES)) this.prewarm(style);
  }
  key(style,state,skin,move,player) { return [style,state,skin ? [skin.navyDark,skin.navy,skin.navyLit,skin.visor].join(',') : '',move||'',player?'player':''].join('|'); }
  prewarm(style,skin,player=false) { for(const state of ['idle','run','attack','jump']) this.request(style,state,skin,'',player); }
  request(style,state,skin,move,player=false) {
    style=STYLES[style]?style:'knight';
    if(state!=='attack') move='';
    const key=this.key(style,state,skin,move,player), prior=this.cache.get(key);
    if(prior) return prior.ready || (player && prior.length) ? prior : null;
    const frames=[], spec=[...(player && PLAYER_STYLES[style] ? PLAYER_STYLES[style] : STYLES[style])];
    if(skin && skin.navy && skin.navyLit) { spec[0]=skin.navyDark||skin.navy; spec[1]=skin.navyLit; spec[2]=skin.visor||spec[2]; spec[3]=skin.navy; }
    const job={key,style,state,player,move:move||MOVES[style],frames,spec,index:0,count:state==='idle'?4:state==='jump'?2:6};
    this.cache.set(key,frames); if(player) this.queue.unshift(job); else this.queue.push(job); this.schedule();return null;
  }
  schedule() {
    if(this.working||!this.queue.length)return; this.working=true;
    later(()=>{this.working=false; const job=this.queue.shift();
      if((job.state==='attack' && this.moves[job.move] === null) || (job.player && job.style==='knight' && job.state==='idle' && this.moves['sword-combo'] === null)) { this.queue.push(job); this.schedule(); return; }
      try {
        let pose=fixedPose(job.state,job.index,job.count);
        const move=this.moves[job.move];
        if(job.player && job.style==='knight' && job.state==='idle' && this.moves['sword-combo'])
          pose=poseAt(this.moves['sword-combo'].act.poses,0);
        if(job.state==='attack' && move && move.act && move.act.poses) pose=poseAt(move.act.poses,job.index*(SOURCE_DURATIONS[job.move]||1)/6);
        // Never bake translation into the body: gameplay owns world x/y/z.
        // Mage's staff-like spear is PixelFX's own rig geometry, not a drawn overlay.
        if (job.player && job.style === 'mage') pose={...pose,weapon:'spear',sa:-Math.PI/2};
        const rigPose={...pose,x:0,y:0};
        const rig=posed(rigPose);
        const c=document.createElement('canvas');c.width=c.height=96;const g=c.getContext('2d'),image=g.createImageData(96,96);
        const dark=rgb(job.spec[0]),light=rgb(job.spec[1]),accent=rgb(job.spec[2]);
        // Outline the complete rig before filling it, once per cached frame.
        if (job.player && PLAYER_OUTLINES[job.style]) {
          const outline=rgb(PLAYER_OUTLINES[job.style]);
          for(let i=0;i<rig.n;i++) for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) {
            if(Math.abs(dx)+Math.abs(dy)>2) continue;
            const x=rig.xs[i]+48+dx,y=rig.ys[i]+78+dy;
            if(x<0||y<0||x>=96||y>=96) continue;
            const k=(y*96+x)*4; image.data[k]=outline[0]; image.data[k+1]=outline[1]; image.data[k+2]=outline[2]; image.data[k+3]=255;
          }
        }
        for(let i=0;i<rig.n;i++) {
          const x=rig.xs[i]+48,y=rig.ys[i]+78;if(x<0||y<0||x>=96||y>=96)continue;
          const v=rig.color[i],r=v&255,gr=(v>>>8)&255,b=(v>>>16)&255, lum=(r+gr+b)/3;
          let col=lum<32?[9,13,22]:mix(dark,light,Math.max(0,Math.min(1,(lum-35)/190)));
          if(job.player && job.style==='mage' && rig.src[i]<0 && !rig.ink[i]) col=[r,gr,b];
          else if(job.player && PLAYER_OUTLINES[job.style] && !rig.ink[i] && rig.src[i]>=0) {
            // src identifies the corresponding rest-pose pixel: center head and
            // torso versus arms and legs, even when animated into a new pose.
            const src=rig.src[i], sx=src%24, sy=Math.floor(src/24);
            col = src>=0 && (sy>=25 || sx<8 || sx>16) ? light : dark;
          } else if(r>170&&b>120&&gr<100) col=accent;
          const k=(y*96+x)*4;image.data[k]=col[0];image.data[k+1]=col[1];image.data[k+2]=col[2];image.data[k+3]=v>>>24;
        }
        g.putImageData(image,0,0);
        if (!job.player) details(g,job.spec,job.state,job.index);
        if (job.player && job.style === 'mage') {
          const hand=skeleton(rigPose).joints.handN;
          c.staffTip={x:hand[0],y:hand[1]-47};
        }
        job.frames.push(c); if(++job.index<job.count)this.queue.push(job);
        else {job.frames.ready=true;if(this.onReady) this.onReady(job.style,job.state);}
      } catch (_) { this.cache.delete(job.key); }
      this.schedule();
    });
  }
  draw(ctx,style,state,x,y,angle,time,skin,options={}) {
    const move=state==='attack'?options.move||'':'';
    let frames=this.request(style,state,skin,move,!!options.player);
    if(!frames) frames=this.request(style,'idle',skin,'',!!options.player);
    if(!frames)return false;
    const duration=DURATIONS[move]||1;
    const n=state==='attack'&&move?Math.min(frames.length-1,Math.floor((options.animTime||0)/duration*frames.length)):
      Math.floor((time||0)*(state==='run'?10:4))%frames.length;
    ctx.save();try {
      ctx.translate(x,y);ctx.scale(Math.cos(angle||0)<0?-1:1,1);ctx.imageSmoothingEnabled=false;
      const scale=options.scale||1.25;ctx.scale(scale,scale);
      const bob=state==='idle'?Math.round(Math.sin((time||0)*2)*2)/scale:0;
      const frame=frames[Math.min(n,frames.length-1)];
      ctx.drawImage(frame,-48,-78+bob);
      if (frame.staffTip && options.onStaffTip) {
        const face=Math.cos(angle||0)<0?-1:1;
        options.onStaffTip(x+face*scale*frame.staffTip.x,y+scale*(frame.staffTip.y+bob));
      }
    } finally {ctx.restore();}return true;
  }
}
