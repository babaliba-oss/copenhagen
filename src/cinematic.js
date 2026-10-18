import {createCineDrive,rigPose} from './cine-drive.js';

// Cinematic mode (?cinematic): the camera runs a fixed list of short shots by itself, no HUD, the city alive around
// it, so a trailer can be recorded on any machine with a real GPU (or frame by frame with ?fixed=30, see below).
// Most shots follow the player's car (a coach and pair in 1760) driving itself through the real streets
// (cine-drive.js) with a tracking camera: chase, bumper, front, side, wheel, helicopter, from above, a pass-by.
// The same routes run in both eras at the same pace, so the two recordings cut together mid-drive.
// Between shots the screen is black while the car jumps to the next place and its buildings load; the edit
// cuts those parts out.
//
// A shot: name, dur (s), era ('today' | 1760 | both when absent), and one of
//   drive: {from:[x,z], toward:[x,z], speed?} with cam (a rig in cine-drive.js) — the car drives, the camera tracks it;
//   eye/target pairs [from, to] in world metres (x, height above ground, z), eased, with at:[x,z] the streaming centre;
//   orbit: {c, r:[from,to], h:[from,to], a:[from,to]} around c, looking at look:[x,height,z].
// ?shots=Nyhavn,Bredgade (names, case-insensitive prefixes) or ?shots=0,3 runs only those.
export const SHOTS=[
 {name:'Nyhavn',drive:{from:[952,58],toward:[770,2]},cam:'front',dur:5},
 {name:'Nyhavn bumper',drive:{from:[935,52],toward:[770,2]},cam:'low',dur:4},
 {name:'Kongens Nytorv',drive:{from:[612,22],toward:[712,-100]},cam:'heli',dur:5},
 {name:'Bredgade',drive:{from:[760,-170],toward:[950,-600]},cam:'chase',dur:4},
 {name:'Amalienborg',at:[990,-488],dur:5,orbit:{c:[1072,-430],r:[150,118],h:[58,44],a:[2.25,2.85]},look:[1072,6,-430]},
 {name:'Holmens Kanal',drive:{from:[600,100],toward:[640,260]},cam:'side',dur:4},
 {name:'Knippelsbro',drive:{from:[650,520],toward:[800,660]},cam:'heli',dur:5},
 {name:'Christianshavn canal',drive:{from:[1063,669],toward:[853,896]},cam:'pass',dur:4},
 {name:'Gammel Strand',drive:{from:[220,262],toward:[100,285]},cam:'wheel',dur:4},
 {name:'Kongens Nytorv west',drive:{from:[560,-95],toward:[598,30]},cam:'top',dur:4},
 {name:'Strøget',at:[130,140],dur:4,eye:[[152,1.7,172],[134,1.7,152]],target:[[110,1.5,122],[100,1.5,118]]},
 {name:'H.C. Andersen',era:'today',at:[900,37],dur:4,orbit:{c:[892.5,39.2],r:[3.4,2.7],h:[1.75,1.6],a:[-.4,.5]},look:[892.5,1.45,39.2]},
 {name:'Rådhuspladsen',era:'today',drive:{from:[-286,664],toward:[-83,843]},cam:'heli',dur:4},
 {name:'HDMS Gorm',era:'today',at:[1440,-280],dur:4,eye:[[1412,5,-312],[1440,3.5,-318]],target:[[1468,3,-256],[1478,3,-250]]},
 {name:'Ramparts',era:1760,at:[-610,30],dur:4,eye:[[-598,22,62],[-612,15,14]],target:[[-643,3,25],[-640,3,30]]},
 {name:'Harbour',at:[1060,330],dur:5,eye:[[1000,5,250],[1062,4,312]],target:[[1150,3,450],[1182,3,482]]},
 {name:'The city from above',at:[300,200],dur:6,eye:[[320,140,320],[470,270,470]],target:[[120,0,120],[60,0,60]]},
];
const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
const mix=(a,b,t)=>a+(b-a)*t;
const lerp3=(a,b,t)=>[mix(a[0],b[0],t),mix(a[1],b[1],t),mix(a[2],b[2],t)];

// The shots for this era and this URL (?shots=...).
export function pickShots(era,search='',list=SHOTS){
 const forEra=list.filter(s=>s.era===undefined||(era===1760?s.era===1760:s.era==='today'));
 const want=(/[?&]shots=([^&]*)/.exec(search)?.[1]||'').split(',').map(w=>decodeURIComponent(w).trim().toLowerCase()).filter(Boolean);
 const dur=+(/[?&]dur=([\d.]+)/.exec(search)?.[1]||0),cut=list=>dur>0?list.map(s=>({...s,dur:Math.min(s.dur,dur)})):list; /* ?dur=2.4: shorter shots, for a capture that only needs their start */
 if(!want.length)return cut(forEra);
 return cut(forEra.filter((s,i)=>want.some(w=>/^\d+$/.test(w)?+w===i:s.name.toLowerCase().startsWith(w))));
}

// ground(x,z): terrain height; roads(): the road graph; teleport(x,z,heading): start the player's car there (a new
// start: traffic and streaming follow); place(x,z,heading,speed): move it there this frame (while it drives); setCamera({eye,target}|null); loaded(): tiles in; clear(x,z): no building there (a side camera
// goes to the open side of the street).
export function createCinematic({doc=document,ground,teleport,place=null,roads=()=>null,cars=()=>null,clear=()=>true,setCamera,loaded,era=null,shots=SHOTS,speed=null,onEnd=()=>{}}){
 const style=doc.createElement('style');
 style.textContent='body.cinematic *{visibility:hidden!important;cursor:none!important}body.cinematic canvas#world,body.cinematic #cine-fade{visibility:visible!important}#cine-fade{position:fixed;inset:0;background:#000;z-index:100;opacity:1;transition:opacity .35s;pointer-events:none}';
 doc.head.append(style);doc.body.classList.add('cinematic');
 const fade=doc.createElement('div');fade.id='cine-fade';doc.body.append(fade);
 const pace=speed??(era===1760?7:14); // m/s: town traffic today, a coach and pair at a brisk trot in 1760
 let i=-1,phase='wait',t=0,waited=0,drive=null,car=null,side=1,eye0=null;const sm={eye:null,target:null};
 const fromRig=(s,u)=>{const r=rigPose(s.cam,car,u,{side});const g=ground(car.x,car.z);
  const eye=s.cam==='pass'&&eye0?eye0:[r.eye[0],Math.max(ground(r.eye[0],r.eye[2]),g-.4)+r.eye[1],r.eye[2]];
  return {eye,target:[r.target[0],g+r.target[1],r.target[2]]};};
 const pose=(s,u)=>{
  if(s.drive)return car?fromRig(s,u):null;
  const e=ease(u);
  if(s.orbit){const o=s.orbit,a=mix(o.a[0],o.a[1],e),r=mix(o.r[0],o.r[1],e),x=o.c[0]+Math.sin(a)*r,z=o.c[1]+Math.cos(a)*r;
   return {eye:[x,ground(x,z)+mix(o.h[0],o.h[1],e),z],target:[s.look[0],ground(s.look[0],s.look[2])+s.look[1],s.look[2]]};}
  const E=lerp3(s.eye[0],s.eye[1],e),T=lerp3(s.target[0],s.target[1],e);
  return {eye:[E[0],ground(E[0],E[2])+E[1],E[2]],target:[T[0],ground(T[0],T[2])+T[1],T[2]]};};
 const show=(p,snap,dt=0)=>{if(!p)return;if(snap||!sm.eye){sm.eye=[...p.eye];sm.target=[...p.target];}
  else{const k=1-Math.exp(-dt*9);for(let j=0;j<3;j++){sm.eye[j]+=(p.eye[j]-sm.eye[j])*k;sm.target[j]+=(p.target[j]-sm.target[j])*k;}}
  setCamera({eye:[...sm.eye],target:[...sm.target]});};
 const openSide=(s)=>{ // which side of the route has room for a side camera: sample the first stretch of the drive
  const probe=createCineDrive(roads(),{from:s.drive.from,toward:s.drive.toward,speed:pace});if(!probe)return 1;let left=0,right=0;
  for(let k=0;k<12;k++){const p=probe.step(.35),rx=Math.cos(p.heading),rz=-Math.sin(p.heading);if(clear(p.x+rx*6.5,p.z+rz*6.5))right++;if(clear(p.x-rx*6.5,p.z-rz*6.5))left++;}
  return right>=left?1:-1;};
 const next=()=>{i++;if(i>=shots.length){phase='done';fade.style.opacity='1';setCamera(null);onEnd();return;}
  const s=shots[i];phase='wait';t=0;waited=0;fade.style.opacity='1';drive=null;car=null;eye0=null;sm.eye=null;
  if(s.drive&&roads()){drive=createCineDrive(roads(),{from:s.drive.from,toward:s.drive.toward,speed:s.drive.speed??pace});}
  if(drive){car=drive.pose();side=s.side??(s.cam==='side'||s.cam==='pass'||s.cam==='wheel'?openSide(s):1);
   if(s.cam==='pass'){const probe=createCineDrive(roads(),{from:s.drive.from,toward:s.drive.toward,speed:s.drive.speed??pace});let p=probe.pose();for(let k=0;k<Math.round(s.dur*30*.5);k++)p=probe.step(1/30);
    const rx=Math.cos(p.heading),rz=-Math.sin(p.heading);eye0=[p.x+rx*6*side,Math.max(ground(p.x+rx*6*side,p.z+rz*6*side),ground(p.x,p.z)-.4)+1.5,p.z+rz*6*side];}
   teleport(car.x,car.z,car.heading);}
  else teleport(...(s.at||[s.orbit?.c?.[0]??0,s.orbit?.c?.[1]??0]));
  show(pose(s,0),true);};
 return {
  get shot(){return shots[i]?.name||null;},get phase(){return phase;},get driving(){return phase!=='done'&&!!drive;},
  get debug(){return {i,phase,t,waited,shot:shots[i]?.name||null,car:car&&{x:car.x,z:car.z,heading:car.heading}};},
  get car(){return car;},get speed(){return drive?.speed||0;},
  start(){next();},
  // checking shots: park on shot n at fraction u (the car placed where it would be)
  get shots(){return shots.map(s=>s.name);},
  hold(n,u=.5){if(!(n>=0&&n<shots.length))return;i=n-1;next();const s=shots[n];if(drive){for(let k=0;k<Math.round(s.dur*30*u);k++)car=drive.step(1/30);place?.(car.x,car.z,car.heading,0);}phase='hold';fade.style.opacity='0';show(pose(s,u),true);},
  update(dt){
   if(phase==='done'||i<0)return;const s=shots[i];if(phase==='hold'){show(pose(s,.5),true);return;}
   if(phase==='wait'){waited+=dt;show(pose(s,0),true);if(waited>2.5&&(loaded()||waited>14)){phase='play';fade.style.opacity='0';}return;}
   t+=dt;const u=Math.min(1,t/s.dur);
   if(drive){car=drive.step(dt,cars());place?.(car.x,car.z,car.heading,drive.speed);}
   show(pose(s,u),false,dt);
   if(t>s.dur-.35)fade.style.opacity='1';
   if(u>=1)next();
  }
 };
}
