// Cinematic mode (?cinematic): the camera flies a fixed list of shots by itself, no HUD, the city alive around it,
// so a trailer can be recorded on any machine with a real GPU. The same places in both eras, so the two runs cut
// together. Between shots the screen fades to black while the player (and the tile streaming that follows the
// player) jumps to the next place and its buildings load.
//
// A shot: at = where the player waits (streaming centre), dur seconds, eye/target pairs [from, to] in world
// metres (x, height above ground, z), eased. orbit shots turn around a centre instead.
export const SHOTS=[
 {name:'Nyhavn from the harbour',at:[902,37],dur:7,eye:[[1035,38,95],[925,22,48]],target:[[860,4,20],[790,4,-5]]},
 {name:'Nyhavn quay',at:[902,37],dur:6,eye:[[968,2.6,56],[870,2.6,24]],target:[[920,2.4,40],[820,2.4,8]]},
 {name:'Kongens Nytorv',at:[599,33],dur:7,orbit:{c:[599,33],r:[150,125],h:[70,52],a:[-.35,.55]},look:[599,4,33]},
 {name:'Strøget',at:[190,135],dur:6,eye:[[262,3,122],[150,3,142]],target:[[200,2.5,133],[90,2.5,152]]},
 {name:'Spires over the old town',at:[-80,150],dur:7,eye:[[175,115,-45],[115,98,15]],target:[[-60,10,160],[-110,10,175]]},
 {name:'Christiansborg and the harbour',at:[181,472],dur:7,eye:[[470,62,640],[350,48,540]],target:[[200,12,420],[160,12,440]]},
 {name:'Amalienborg',at:[990,-488],dur:7,orbit:{c:[1072,-430],r:[170,140],h:[80,60],a:[2.2,2.95]},look:[1072,6,-430]},
 {name:'The city from above',at:[300,200],dur:8,eye:[[320,140,320],[470,270,470]],target:[[120,0,120],[60,0,60]]},
];
const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
const mix=(a,b,t)=>a+(b-a)*t;
const lerp3=(a,b,t)=>[mix(a[0],b[0],t),mix(a[1],b[1],t),mix(a[2],b[2],t)];

export function createCinematic({doc=document,ground,teleport,setCamera,loaded,onEnd=()=>{}}){
 const style=doc.createElement('style');
 style.textContent='body.cinematic *{visibility:hidden!important;cursor:none!important}body.cinematic canvas#world,body.cinematic #cine-fade{visibility:visible!important}#cine-fade{position:fixed;inset:0;background:#000;z-index:100;opacity:1;transition:opacity .7s;pointer-events:none}';
 doc.head.append(style);doc.body.classList.add('cinematic');
 const fade=doc.createElement('div');fade.id='cine-fade';doc.body.append(fade);
 let i=-1,phase='wait',t=0,waited=0;
 const pose=(s,u)=>{const e=ease(u);
  if(s.orbit){const o=s.orbit,a=mix(o.a[0],o.a[1],e),r=mix(o.r[0],o.r[1],e),x=o.c[0]+Math.sin(a)*r,z=o.c[1]+Math.cos(a)*r;
   return {eye:[x,ground(x,z)+mix(o.h[0],o.h[1],e),z],target:[s.look[0],ground(s.look[0],s.look[2])+s.look[1],s.look[2]]};}
  const E=lerp3(s.eye[0],s.eye[1],e),T=lerp3(s.target[0],s.target[1],e);
  return {eye:[E[0],ground(E[0],E[2])+E[1],E[2]],target:[T[0],ground(T[0],T[2])+T[1],T[2]]};};
 const next=()=>{i++;if(i>=SHOTS.length){phase='done';fade.style.opacity='1';setCamera(null);onEnd();return;}
  phase='wait';t=0;waited=0;fade.style.opacity='1';teleport(SHOTS[i].at[0],SHOTS[i].at[1]);setCamera(pose(SHOTS[i],0));};
 return {
  get shot(){return SHOTS[i]?.name||null;},get debug(){return {i,phase,t,waited};},
  start(){next();},
  // checking shots: park on shot n at fraction u (teleport, hold the camera there)
  hold(n,u=.5){i=n;phase='hold';fade.style.opacity='0';teleport(SHOTS[n].at[0],SHOTS[n].at[1]);setCamera(pose(SHOTS[n],u));},
  update(dt){
   if(phase==='done'||i<0)return;const s=SHOTS[i];if(phase==='hold')return;
   if(phase==='wait'){waited+=dt;setCamera(pose(s,0));if(waited>3.5&&(loaded()||waited>14)){phase='play';fade.style.opacity='0';}return;}
   t+=dt;const u=Math.min(1,t/s.dur);setCamera(pose(s,u));
   if(t>s.dur-.7)fade.style.opacity='1';
   if(u>=1)next();
  }
 };
}
