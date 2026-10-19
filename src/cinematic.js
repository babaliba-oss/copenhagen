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
//   orbit: {c, r:[from,to], h:[from,to], a:[from,to], follow?} around c (or around the character `follow`, live), looking at look:[x,height,z].
// Extras: sky (a weather.js look for the shot, golden otherwise), season ('halloween' | 'christmas', kept for the shots after),
// hud ('radio': the now-playing card tuning through the stations; 'quest': a saga starting, its banner and red beam).
// ?shots=Nyhavn,Bredgade (names, case-insensitive prefixes) or ?shots=0,3 runs only those.
export const SHOTS=[
 {name:'Nyhavn',drive:{from:[952,58],toward:[770,2]},cam:'front',dur:5},
 {name:'Nyhavn bumper',drive:{from:[935,52],toward:[770,2]},cam:'low',dur:4},
 {name:'H.C. Andersen',era:'today',at:[900,37],dur:4,orbit:{follow:'hca',c:[892.8,38.5],r:[3.2,2.6],h:[1.75,1.6],a:[2.7,3.6]},look:[892.8,1.45,38.5]}, // in front of him (he faces the canal, north); behind him are the houses
 {name:'Kongens Nytorv',drive:{from:[612,22],toward:[712,-100]},cam:'heli',dur:5},
 {name:'Radio',era:'today',drive:{from:[760,-170],toward:[950,-600]},cam:'chase',dur:5,hud:'radio'},
 {name:'Bredgade',era:1760,drive:{from:[760,-170],toward:[950,-600]},cam:'chase',dur:4},
 {name:'Amalienborg',at:[990,-488],dur:5,orbit:{c:[1072,-430],r:[150,118],h:[58,44],a:[2.25,2.85]},look:[1072,6,-430]},
 {name:'Holmens Kanal',drive:{from:[600,100],toward:[640,260]},cam:'side',dur:4},
 {name:'Saga',era:'today',drive:{from:[950,58],toward:[800,0]},cam:'chase',dur:5,hud:'quest',saga:'hca'}, // along Nyhavn towards the red beam at Nyhavn 20 (from Toldbodgade the chase camera swung across the corner's sign and traffic light as the car turned in)
 {name:'Saga',era:1760,drive:{from:[560,360],toward:[480,480]},cam:'chase',dur:5,hud:'quest',saga:'eye'}, // south towards Børsen: its red beam ahead and to the right (the old route kept it off screen to the left)
 {name:'Knippelsbro',drive:{from:[650,520],toward:[800,660]},cam:'low',dur:4},
 {name:'Christianshavn canal',drive:{from:[1063,669],toward:[853,896]},cam:'pass',dur:4},
 {name:'Gammel Strand',drive:{from:[220,262],toward:[100,285]},cam:'wheel',dur:4},
 {name:'Nissefar',at:[207,-584],dur:4,orbit:{follow:'nisse',c:[207.6,-584.5],r:[3,2.3],h:[1.1,.85],a:[2.6,3.6]},look:[207.6,.55,-584.5]},
 {name:'Kongens Nytorv west',drive:{from:[560,-95],toward:[598,30]},cam:'top',dur:4},
 {name:'Andersen statue',era:'today',at:[-427,520],dur:4,orbit:{c:[-427.1,520.1],r:[4.6,3.6],h:[2.3,2],a:[-1.25,-.3]},look:[-427.1,1.75,520.1]}, // from the boulevard he looks out over (landmarks.js rot -.725); City Hall's wall is behind him
 {name:'Rådhuspladsen',era:'today',drive:{from:[-286,664],toward:[-83,843]},cam:'heli',dur:4},
 {name:'Strøget',at:[130,140],dur:4,eye:[[146,1.8,134],[134,1.8,137]],target:[[100,1.6,149],[90,1.6,149]]}, // down the street from Amagertorv (the old path ran through the houses)
 {name:'Harbour',at:[1100,175],dur:5,eye:[[1110,4,160],[1150,4,190]],target:[[1230,3,280],[1250,3,300]]}, // low over the water (heights from the surface)
 {name:'The city from above',at:[300,200],dur:6,eye:[[320,140,320],[470,270,470]],target:[[120,0,120],[60,0,60]]},
 {name:'Halloween',era:'today',sky:'night',season:'halloween',drive:{from:[952,58],toward:[770,2]},cam:'chase',dur:5}, // chase: both pavements and the strings of lights ahead (the side camera saw one pumpkin, and a lamp post crossed the car)
 {name:'Christmas',era:'today',sky:'night',season:'christmas',at:[604,6],dur:5,orbit:{follow:'tree:Kongens Nytorv',c:[615.4,29.6],r:[34,26],h:[14,9],a:[3.4,4.2]},look:[615.4,7,29.6]}, // circles the square's tree (it stood off to one side and filled the foreground); a 3.4-4.2: houses block the view from 0 to 1.3
 {name:'Christmas on Strøget',era:'today',sky:'night',season:'christmas',at:[150,132],dur:4,eye:[[176,1.7,127],[160,1.7,130]],target:[[126,2.6,138],[118,2.6,141]]},
];
const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
const mix=(a,b,t)=>a+(b-a)*t;
const lerp3=(a,b,t)=>[mix(a[0],b[0],t),mix(a[1],b[1],t),mix(a[2],b[2],t)];
// Keep the lens out of the houses: walk from the subject out to the eye, stop short of the first wall in the way and back
// in until the lens has `room` metres of air around it (never nearer the subject than `min`). solid(x,z,y): inside a building.
const RING=[[1,0],[-1,0],[0,1],[0,-1],[.7,.7],[-.7,.7],[.7,-.7],[-.7,-.7]];
export function clearEye(eye,focus,solid,{room=1,min=2,los=true}={}){
 if(!solid)return eye;
 if(!los){ // only the lens: out of any wall it is in or brushing, towards the subject (a view over the roofs may look past houses)
  const roomy=p=>!solid(p[0],p[2],p[1])&&!RING.some(([a,b])=>solid(p[0]+a*room,p[2]+b*room,p[1]));if(roomy(eye))return eye;
  const dx=focus[0]-eye[0],dy=focus[1]-eye[1],dz=focus[2]-eye[2],L=Math.hypot(dx,dy,dz);
  for(let d=.25;d<L-min;d+=.25){const p=[eye[0]+dx*d/L,eye[1]+dy*d/L,eye[2]+dz*d/L];if(roomy(p))return p;}return eye;}
 const dx=eye[0]-focus[0],dy=eye[1]-focus[1],dz=eye[2]-focus[2],L=Math.hypot(dx,dy,dz);if(L<=min)return eye;
 const at=t=>[focus[0]+dx*t,focus[1]+dy*t,focus[2]+dz*t],n=Math.ceil(L/.25);let tmax=1;
 for(let i=1;i<=n;i++){const p=at(i/n);if(solid(p[0],p[2],p[1])){tmax=Math.max(0,i/n-room/L);break;}}
 const roomy=p=>!RING.some(([a,b])=>solid(p[0]+a*room,p[2]+b*room,p[1]));
 for(let t=tmax;t*L>=min;t-=.25/L){const p=at(t);if(roomy(p))return p;}
 return at(Math.max(min/L,tmax));
}

// The shots for this era and this URL (?shots=...).
export function pickShots(era,search='',list=SHOTS){
 const forEra=list.filter(s=>s.era===undefined||(era===1760?s.era===1760:s.era==='today'));
 const raw=/[?&]shots=([^&]*)/.exec(search)?.[1]||'',want=decodeURIComponent(raw.replace(/\+/g,' ')).split(',').map(w=>w.trim().toLowerCase()).filter(Boolean); /* decoded first: the page rewrites its URL with ',' as %2C */
 const dur=+(/[?&]dur=([\d.]+)/.exec(search)?.[1]||0),cut=list=>dur>0?list.map(s=>({...s,dur:Math.min(s.dur,dur)})):list; /* ?dur=2.4: shorter shots, for a capture that only needs their start */
 if(!want.length)return cut(forEra);
 return cut(forEra.filter((s,i)=>want.some(w=>/^\d+$/.test(w)?+w===i:s.name.toLowerCase().startsWith(w))));
}

// ground(x,z): terrain height; roads(): the road graph; teleport(x,z,heading): start the player's car there (a new
// start: traffic and streaming follow); place(x,z,heading,speed): move it there this frame (while it drives); setCamera({eye,target}|null); loaded(): tiles in; clear(x,z): no building there (a side camera
// goes to the open side of the street).
export function createCinematic({doc=document,ground,teleport,place=null,roads=()=>null,cars=()=>null,clear=()=>true,solid=null,near=null,setCamera,loaded,era=null,shots=SHOTS,speed=null,onEnd=()=>{},setSky=null,setSeason=null,hud=null,find=()=>null,wait=[2.5,14],clearRoute=null}){
 const style=doc.createElement('style');
 style.textContent='body.cinematic *{visibility:hidden!important;cursor:none!important}body.cinematic canvas#world,body.cinematic #cine-fade{visibility:visible!important}body.cinematic.cine-radio #radio-now,body.cinematic.cine-radio #radio-now *,body.cinematic.cine-quest #cph-banner,body.cinematic.cine-quest #cph-banner *,body.cinematic.cine-quest #cph-saga,body.cinematic.cine-quest #cph-saga *{visibility:visible!important}#cine-fade{position:fixed;inset:0;background:#000;z-index:100;opacity:1;transition:opacity .35s;pointer-events:none}';
 doc.head.append(style);doc.body.classList.add('cinematic');
 const fade=doc.createElement('div');fade.id='cine-fade';doc.body.append(fade);
 const pace=speed??(era===1760?7:14); // m/s: town traffic today, a coach and pair at a brisk trot in 1760
 const size=era===1760?{front:3.4,half:1}:{front:2.4,half:1}; // the car's nose (a coach's horses) ahead of its centre, and its half width
 const drives=s=>createCineDrive(roads(),{from:s.drive.from,toward:s.drive.toward,speed:s.drive.speed??pace,...size});
 let i=-1,phase='wait',t=0,waited=0,drive=null,car=null,side=1,eye0=null,holdU=.5;const sm={eye:null,target:null};
 // near(x,z,y): a post, sign, tree trunk or other street object within a metre of that point. The lens keeps out of them,
 // easing in towards its subject (the chase camera went through a sign at the Saga corner, the pass camera stood in a trunk).
 const lens=(eye,focus)=>near?clearEye(eye,focus,near,{los:false,room:.01,min:2}):eye;
 const nearAt=(e,d)=>!!near&&near(e[0],e[2],e[1],d);
 // Which side of the car a tracking camera rides: the side whose lens, over the whole shot, passes fewest houses (clear) and
 // fewest street objects within 2 m (posts, signs, trunks). The chase camera over the right-hand pavement filled the frame
 // with a traffic sign at the Saga corner; on the left it rides over the road.
 const pickSide=s=>{const n=Math.round(s.dur*30),score={1:0,'-1':0};
  for(const side of [1,-1]){const probe=drives(s);if(!probe)return 1;let p=probe.pose();
   for(let k=0;k<=n;k++){if(k)p=probe.step(1/30);const r=rigPose(s.cam,p,k/n,{side}),g=ground(p.x,p.z),eye=[r.eye[0],g+r.eye[1],r.eye[2]];
    if(!clear(eye[0],eye[2]))score[side]+=4;if(nearAt(eye,2))score[side]+=1;}}
  return score[-1]<score[1]?-1:1;};
 const fromRig=(s,u)=>{const r=rigPose(s.cam,car,u,{side});const g=ground(car.x,car.z);
  const eye=s.cam==='pass'&&eye0?eye0:[r.eye[0],Math.max(ground(r.eye[0],r.eye[2]),g-.4)+r.eye[1],r.eye[2]];
  return {eye:s.cam==='pass'?eye:lens(clearEye(eye,[car.x,g+1.1,car.z],solid),[car.x,g+1.1,car.z]),target:[r.target[0],g+r.target[1],r.target[2]]};};
 const pose=(s,u)=>{
  if(s.drive)return car?fromRig(s,u):null;
  const e=ease(u);
  if(s.orbit){const o=s.orbit,c=(o.follow&&find(o.follow))||o.c,a=mix(o.a[0],o.a[1],e),r=mix(o.r[0],o.r[1],e),x=c[0]+Math.sin(a)*r,z=c[1]+Math.cos(a)*r;
   const lx=o.follow?c[0]:s.look[0],lz=o.follow?c[1]:s.look[2],target=[lx,ground(lx,lz)+s.look[1],lz];return {eye:lens(clearEye([x,ground(x,z)+mix(o.h[0],o.h[1],e),z],target,solid),target),target};}
  const E=lerp3(s.eye[0],s.eye[1],e),T=lerp3(s.target[0],s.target[1],e),target=[T[0],ground(T[0],T[2])+T[1],T[2]];
  return {eye:lens(clearEye([E[0],ground(E[0],E[2])+E[1],E[2]],target,solid,{los:false}),target),target};};
 const show=(p,snap,dt=0)=>{if(!p)return;if(snap||!sm.eye){sm.eye=[...p.eye];sm.target=[...p.target];}
  else{const k=1-Math.exp(-dt*9);for(let j=0;j<3;j++){sm.eye[j]+=(p.eye[j]-sm.eye[j])*k;sm.target[j]+=(p.target[j]-sm.target[j])*k;}}
  setCamera({eye:[...sm.eye],target:[...sm.target]});};
 const openSide=(s)=>{ // which side of the route has room for a side camera: sample the first stretch of the drive
  const probe=drives(s);if(!probe)return 1;let left=0,right=0;
  for(let k=0;k<12;k++){const p=probe.step(.35),rx=Math.cos(p.heading),rz=-Math.sin(p.heading);if(clear(p.x+rx*6.5,p.z+rz*6.5))right++;if(clear(p.x-rx*6.5,p.z-rz*6.5))left++;}
  return right>=left?1:-1;};
 let hudOn=null;const hudOff=()=>{if(!hudOn)return;doc.body.classList.remove('cine-'+hudOn);hud?.(hudOn,false);hudOn=null;};
 const next=()=>{hudOff();i++;if(i>=shots.length){phase='done';fade.style.opacity='1';setCamera(null);setSky?.('golden');onEnd();return;}
  const s=shots[i];setSky?.(s.sky||'golden');setSeason?.(s.season||null); /* the date's own season stays out of the other shots: in October every golden-hour street had pumpkins, and the Halloween shot was nothing new */phase='wait';t=0;waited=0;fade.style.opacity='1';drive=null;car=null;eye0=null;sm.eye=null;
  if(s.drive&&roads())drive=drives(s);
  if(drive){car=drive.pose();side=s.side??(near?pickSide(s):s.cam==='side'||s.cam==='pass'||s.cam==='wheel'?openSide(s):1);
   if(s.cam==='pass'){const probe=drives(s);let p=probe.pose();for(let k=0;k<Math.round(s.dur*30*.5);k++)p=probe.step(1/30);
    const rx=Math.cos(p.heading),rz=-Math.sin(p.heading),fx=-Math.sin(p.heading),fz=-Math.cos(p.heading),focus=[p.x,ground(p.x,p.z)+1.1,p.z];
    const at=(d,a=0)=>{const x=p.x+rx*d*side+fx*a,z=p.z+rz*d*side+fz*a;return [x,Math.max(ground(x,z),ground(p.x,p.z)-.4)+1.5,z];};
    // The camera stands where no trunk or post is within 2 m (it stood in a tree on the Christianshavn canal): beside the
    // car's mid-shot position first, else a little along the street either way (a quay with a row of trees every 7 m has
    // a gap between them), and failing all of that where the nearest object is furthest off.
    const spots=[];for(const a of [0,2.5,-2.5,5,-5])for(const d of [6,5,7,4.5,8])spots.push([d,a]);
    const room=([d,a])=>{const e=at(d,a);if(!clear(e[0],e[2]))return -1;for(const r of [2,1.5,1,.5])if(!nearAt(e,r))return r;return 0;};
    let best=spots.find(sp=>room(sp)>=2);if(!best){let r=-2;for(const sp of spots){const q=room(sp);if(q>r){r=q;best=sp;}}}
    eye0=lens(clearEye(at(...(best||[6,0])),focus,solid),focus);}
   teleport(car.x,car.z,car.heading);
   if(clearRoute){const probe=drives(s);clearRoute(probe.route(-3,(s.drive.speed??pace)*s.dur+25,1.5).map(p=>[p.x,p.z]));}} // nothing parked in the car's lane
  else{clearRoute?.([]);teleport(...((s.orbit?.follow&&find(s.orbit.follow))||s.at||[s.orbit?.c?.[0]??0,s.orbit?.c?.[1]??0]));}
  show(pose(s,0),true);};
 return {
  get shot(){return shots[i]?.name||null;},get phase(){return phase;},get driving(){return phase!=='done'&&!!drive;},
  get debug(){return {i,phase,t,waited,shot:shots[i]?.name||null,car:car&&{x:car.x,z:car.z,heading:car.heading}};},
  get car(){return car;},get speed(){return drive?.speed||0;},
  start(){next();},
  // checking shots: park on shot n at fraction u (the car placed where it would be)
  get shots(){return shots.map(s=>s.name);},
  hold(n,u=.5){if(!(n>=0&&n<shots.length))return;i=n-1;next();const s=shots[n];if(drive){for(let k=0;k<Math.round(s.dur*30*u);k++)car=drive.step(1/30);place?.(car.x,car.z,car.heading,0);}phase='hold';holdU=u;fade.style.opacity='0';show(pose(s,u),true);if(s.hud){hudOn=s.hud;doc.body.classList.add('cine-'+s.hud);hud?.(s.hud,true,s);}},
  update(dt){
   if(phase==='done'||i<0)return;const s=shots[i];if(phase==='hold'){show(pose(s,holdU),true);return;}
   if(phase==='wait'){waited+=dt;show(pose(s,0),true);if(waited>wait[0]&&(loaded()||waited>wait[1])){phase='play';fade.style.opacity='0';if(s.hud){hudOn=s.hud;doc.body.classList.add('cine-'+s.hud);hud?.(s.hud,true,s);}}return;}
   t+=dt;const u=Math.min(1,t/s.dur);
   if(drive){car=drive.step(dt,cars());place?.(car.x,car.z,car.heading,drive.speed);}
   show(pose(s,u),false,dt);
   if(t>s.dur-.35)fade.style.opacity='1';
   if(u>=1)next();
  }
 };
}
