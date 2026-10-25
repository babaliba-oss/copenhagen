import {SpatialIndex} from './geo.js';
import {groundAt} from './terrain.js';
const THREE_CLAMP=(v,a,b)=>Math.max(a,Math.min(b,v));
import {createPersonBatch,advanceGait,personLook} from './person-model.js';
import {createLooseMicromobility} from './parked-micromobility.js';
import {createBakedPeople,WALK_FRAMES} from './skinned-people.js';

// The character models for the instanced crowds, once loaded (main.js): each crowd then draws its people within `range`
// as the baked characters, walking, standing or (café guests) seated, and the procedural figure only for the fallen,
// the far and the tiny (a stand-in hidden behind a rigged figure).
let bakedPeople=null;
// The road index (world.roads, see setCrowdRoads): a car that keeps to the road only scares the crowd when it comes very close.
let crowdRoads=null;export function setCrowdRoads(index){crowdRoads=index;}
// Does the player's approach send a free-standing person running? Only a car (or the 1760 coach) does, moving at more
// than 2 m/s: someone on foot, a bike or a scooter walks through a crowd without scattering it. A car that is on the
// road scares people within 3.5 m; one off the road, on the square among them, within 7 m.
export function crowdPanics(p,player){
 if(!player||(player.travelMode??'car')!=='car'||Math.abs(player.speed||0)<=2)return false;
 const d=Math.hypot(p.x-player.x,p.z-player.z);return d<(crowdRoads?.at?.(player.x,player.z)?3.5:7);
}
export function setBakedPeople(lib,{range=90,pick=p=>p.id}={}){bakedPeople=lib?{lib,range,pick,version:(bakedPeople?.version||0)+1}:null;}

// Original geometry, photo-guided atmosphere rather than recorded individual people.
// Appearance (clothing, skin, hair, build, bags) comes from the shared person model.
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function rng(seed=6126){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function rectangle(x,z,w,d){return {rings:[[[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]]]};}

export function marketPlacementValidator(city,stalls=[],extraObstacles=[]){
 const square=new SpatialIndex(city.pavement.filter(p=>p.name==='Kauppatori'&&p.kind==='Aukiot'));
 const forbidden=new SpatialIndex([...city.roads,...city.buildings,...city.water,...city.pavement.filter(p=>/pyör|cycle|Portaat/i.test(p.kind)),...extraObstacles]);
 const blocked=[...stalls.map(s=>rectangle(s.x,s.z,s.w+1,s.d+1)),rectangle(124.882,275.284,8,8),rectangle(-39.066,281.183,13,13)];
 const structures=new SpatialIndex(blocked);
 return (x,z,r=.35)=>{
  if(z<252||z>340||x<18||x>212)return false;
  for(const [dx,dz] of [[0,0],[-r,-r],[r,-r],[r,r],[-r,r],[0,-r],[r,0],[0,r],[-r,0]])if(!square.at(x+dx,z+dz)||forbidden.at(x+dx,z+dz)||structures.at(x+dx,z+dz))return false;
  return true;
 };
}

export function marketLifePlacements(city,stalls=[],options={}){
 const safe=marketPlacementValidator(city,stalls,options.obstacles||[]),random=rng(),people=[],scooters=[];
 // The photographed north-edge scooters are behind the segregated cycle path.
 // Find its safe plaza-side margin, checking each complete scooter envelope.
 for(let i=0;i<12;i++){
  const x=71+i*1.15;
  for(let z=252;z<273;z+=.25)if(safe(x,z,.85)){
   scooters.push({id:`market-scooter-${i}`,x,z,heading:(i%3-1)*.10,color:['#53a775','#333a39','#bf5148'][i%3]});break;
  }
 }
 const add=(x,z,heading,pose)=>{
  if(!safe(x,z)||people.some(p=>Math.hypot(p.x-x,p.z-z)<.82)||scooters.some(p=>Math.hypot(p.x-x,p.z-z)<1.3))return false;
  const i=people.length,child=i%17===0;
  people.push({id:`market-${i}`,x,z,homeX:x,homeZ:z,heading,pose,walking:true,edge:{crossing:false,market:true},speed:0,running:0,panicUntil:0,
   ...personLook(6126+i*7,{phase:(random(),random(),random()*Math.PI*2)}),...(child?{height:1.2,body:.92,coat:0,skirt:false,bagType:null,hairStyle:'short'}:{})});return true;
 };
 for(const s of stalls)for(let i=0;i<3;i++)add(s.x+(i-1)*1.05,s.z+s.d/2+1.2+(i%2)*.35,Math.PI,'browse');
 for(let attempt=0;people.length<(options.count??140)&&attempt<25000;attempt++){
  const x=28+random()*167,z=257+random()*73;
  add(x,z,random()*Math.PI*2,people.length%4===0?'walk':people.length%3===0?'phone':'chat');
 }
 return {people,scooters,safe};
}

// Reusable scooter row for other photo-guided squares. No downloaded brand assets. Knockable (parked-micromobility.js):
// the car sends them flying. Returns the knockable set; add its `.group` to the scene and step it with the other knockables.
// Lift .13 matches the raised plaza paving the old static rows stood on.
export const createParkedScooters=(records,name='Parked electric scooters')=>createLooseMicromobility(records,{kind:'scooter',name,lift:.13});
// Same for parked personal bicycles; `parts` adds rigid extras (frame labels) that fly with each bike.
export const createParkedBicycles=(records,name='Parked city bicycles',parts=[])=>createLooseMicromobility(records,{kind:'bicycle',name,lift:.13,parts});

export function createInstancedPeople(records,options={}){
 const safe=options.safe||(()=>false),scooters=options.scooters||[],center=options.center||{x:records[0]?.x||0,z:records[0]?.z||0};
 const people=records.map((p,i)=>({id:`crowd-${i}`,homeX:p.x,homeZ:p.z,heading:0,pose:'chat',walking:true,edge:{crossing:false,market:true},speed:0,running:0,panicUntil:0,...personLook(i*13+(options.seed??0)),...p}));
 // One shared articulated person batch (torso, head, hair, limbs, coats, bags/luggage).
 const batch=createPersonBatch(people.length,{name:options.name||'Instanced pedestrian crowd',luggage:!!options.luggage,frustumCulled:true});
 const group=batch.group;let time=0,lastDraw=-1,viewer=null,models=null;
 // The character models (setBakedPeople): one renderer for walking and standing, one for sitting, made on first use.
 const hash=v=>{let h=2166136261;for(const c of String(v))h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;};
 const phases=new Map(),FR=WALK_FRAMES;
 function releaseModels(){if(!models)return;for(const r of models.r){group.remove(r.group);r.dispose();}models=null;}
 function modelsNow(){
  if(!bakedPeople||options.models===false){releaseModels();return null;}
  if(models?.version===bakedPeople.version)return models;releaseModels();
  const {lib,range}=bakedPeople,cap=Math.max(4,Math.min(48,Math.ceil(people.length/lib.models.length*1.6)+2)),pick=p=>hash(p.id??'');
  const walk=createBakedPeople(lib,{set:'walk',capacity:cap,range,pick,name:`${options.name||'Crowd'} (models)`}),sit=people.some(p=>p.seated)?createBakedPeople(lib,{set:'sit',capacity:cap,range,pick,name:`${options.name||'Crowd'} (models, seated)`}):null;
  models={version:bakedPeople.version,walk,sit,r:[walk,sit].filter(Boolean)};for(const r of models.r)group.add(r.group);return models;
 }
 function drawModel(m,p){
  if(p.knockdown||(p.height??1.7)<.6)return false;
  const y=(p.groundY??.13)+groundAt(p.x,p.z);
  if(p.seated)return !!m.sit&&m.sit.draw(p,p,0,1,0,0,{y:(p.groundY??0)+groundAt(p.x,p.z),heading:p.heading||0}); // the chairs stand on the ground, not the pavement's lift
  const speed=Math.abs(p.speed||0);if(speed<.15)return m.walk.draw(p,p,FR,1,0,0,{y,heading:p.heading||0});
  const k=m.walk.kindOf(p);if(!k)return false;let st=phases.get(p);if(!st)phases.set(p,st={ph:hash(p.id??'')%1000/1000,t:time});
  st.ph=(st.ph+(time-st.t)*THREE_CLAMP(speed/(1.25*(p.height||1.72)/k.height),.55,2.2)/k.D)%1;st.t=time;
  const f=st.ph*FR,i0=Math.floor(f)%FR,w=f-Math.floor(f);return m.walk.draw(p,p,i0,1-w,(i0+1)%FR,w,{y,heading:p.heading||0});
 }
 // The batch picks each person's detail level from the viewer's position (see person-model.js).
 function render(){const m=modelsNow();batch.begin(viewer);if(m)for(const r of m.r)r.begin(viewer);
  for(const p of people){if(m&&drawModel(m,p))continue;batch.draw(p,p,p,time);}
  batch.end();if(m)for(const r of m.r)r.end();}
 const clear=(x,z,p)=>safe(x,z)&&!people.some(q=>q!==p&&Math.hypot(q.x-x,q.z-z)<.69)&&!scooters.some(q=>Math.hypot(q.x-x,q.z-z)<1.2);
 function update(dt,player){
  const step=clamp(dt||0,0,.08);time+=step;viewer=player||null;
  const away=player?Math.hypot(player.x-center.x,player.z-center.z):0,shown=options.range??650;group.visible=away<shown;
  if(!group.visible){if(models&&away>shown+150)releaseModels();return;} // far away: the character models go (rebuilt from the shared bakes on return); kept, every crowd passed added ~30 idle instanced meshes for good
  for(const p of options.externalMotion?[]:people){
   if(p.knockdown){p.speed=0;continue;}
   if(p.seated){p.speed=0;continue;} // café guests stay in their chairs
   // Crowd reactions (crowd-reaction.js): standing to watch, or running from a crash.
   if(p.heldFor>0){p.heldFor-=step;p.speed=0;continue;}
   if(p.scared&&(p.scared.left-=step)<=0)p.scared=null;
   if(p.conversation){p.speed=0;continue;}
   // Authored chase (the Andersen easter egg): run at the player until caught or out of breath, then walk home.
   if(p.chaseUntil){p.chaseLeft=(p.chaseLeft??0)-step;const walk=options.walkable||(()=>true);
    const go=(tx,tz,speed)=>{const dx=tx-p.x,dz=tz-p.z,l=Math.hypot(dx,dz);if(l<.05)return l;const v=Math.min(l,speed*step),x=p.x+dx/l*v,z=p.z+dz/l*v;if(walk(x,z)){p.x=x;p.z=z;}p.speed=speed;p.heading=Math.atan2(-dx,-dz);return l;};
    const far=Math.hypot(p.x-p.homeX,p.z-p.homeZ)>45; // he stays on his own stretch of quay
    if(p.chaseLeft>0&&player&&!p.caught&&!far){const l=go(player.x,player.z,3.4);p.running=1;if(l<1.3){p.caught=true;p.chaseLeft=0;options.onEvent?.('caught',p);}continue;}
    if(!p.gaveUp&&!p.caught){p.gaveUp=true;options.onEvent?.('gave-up',p);}
    p.running=0;if(go(p.homeX,p.homeZ,1.2)>.3)continue;
    p.chaseUntil=0;p.gaveUp=false;p.caught=false;p.speed=0;p.heading=p.homeHeading??p.heading;continue;}
   const panic=crowdPanics(p,player);
   p.running=panic||p.panicUntil>time||p.scared?1:0;p.speed=0;
   let dx=0,dz=0;
   if(p.running&&(p.scared||player)){const from=p.scared||player;dx=p.x-from.x;dz=p.z-from.z;}
   else if(p.pose==='walk'){dx=p.homeX+Math.cos(time*.16+p.phase)*1.3-p.x;dz=p.homeZ+Math.sin(time*.16+p.phase)*1.3-p.z;}
   const length=Math.hypot(dx,dz),speed=p.running?2.7:.42;
   if(length>.08){const x=p.x+dx/length*Math.min(length,speed*step),z=p.z+dz/length*Math.min(length,speed*step);
    if(clear(x,z,p)){p.x=x;p.z=z;p.speed=speed;p.heading=Math.atan2(-dx,-dz);}
   }
  }
  // Gait follows each person's actual speed (idle, amble, walk, run).
  for(const p of people)advanceGait(p,p,step);
  if(time-lastDraw>1/45){render();lastDraw=time;}
 }
 render();group.userData={people:people.length,drawCalls:batch.drawCalls};
 return {group,people,update,batch,reset(){time=0;lastDraw=-1;for(const p of people){p.x=p.homeX;p.z=p.homeZ;p.running=0;p.panicUntil=0;p.speed=0;}render();}};
}

export function createMarketLife(city,stalls=[],options={}){
 const {people,scooters,safe}=marketLifePlacements(city,stalls,options);
 const crowd=createInstancedPeople(people,{safe,scooters,center:{x:120,z:290},name:'Kauppatori market-day crowd'});
 const parked=createParkedScooters(scooters,'Kauppatori parked e-scooters');crowd.group.add(parked.group);
 crowd.group.userData={people:people.length,scooters:scooters.length,drawCalls:crowd.batch.drawCalls+1,placement:'Municipal plaza polygons with road, cycleway, water, stall and monument exclusion',reference:'August 2024 reference photography; illustrative market-day crowd, not a survey of individuals'};
 return {...crowd,scooters,knockables:parked};
}

// Kauppatori's gulls, as bird colony data for birds.js: a big flock hanging low
// over the canopies, gulls on the stall ridges, the Havis Amanda fountain rim
// and the quay edge, a crowd of them walking among the shoppers, and flocks
// working the harbour basin out towards the ferries and Katajanokka.
export function marketGullColony(city,stalls=[],{shore=[],inWater=()=>false,amanda={x:-39.066,z:281.183}}={}){
 const random=rng(4471),safe=marketPlacementValidator(city,stalls);
 const ridges=stalls.flatMap(s=>[-1,0,1].map(k=>({x:s.x+k*(s.w/2-.6),y:3.28,z:s.z})));
 const fountain=Array.from({length:6},(_,i)=>{const a=i/6*Math.PI*2;return {x:amanda.x+Math.cos(a)*4.6,y:.75,z:amanda.z+Math.sin(a)*4.6,heading:-a-Math.PI/2};});
 const quay=shore.filter(s=>s.x>-70&&s.x<260&&s.z>240&&s.z<420).filter((_,i)=>i%2===0).map(s=>({x:s.x-s.nx*.7,y:.12,z:s.z-s.nz*.7,heading:Math.atan2(-s.nx,-s.nz)}));
 // Walking gulls gather in knots by the stall fronts and the quay end of the square, where the food is.
 const knots=[];for(const st of [...stalls].sort(()=>random()-.5)){const x=st.x+(random()-.5)*st.w*.6,z=st.z+st.d/2+1.8+random()*2.5;if(safe(x,z,.6)&&knots.every(k=>Math.hypot(k.x-x,k.z-z)>12))knots.push({x,z});if(knots.length>=5)break;}
 for(let i=0;i<3000&&knots.length<7;i++){const x=150+random()*55,z=262+random()*60;if(safe(x,z,.6)&&knots.every(k=>Math.hypot(k.x-x,k.z-z)>12))knots.push({x,z});}
 // Over the water off the square's east quay, in view of the Market Square start.
 const east=shore.filter(s=>Math.hypot(s.x-255,s.z-262)<90).sort((a,b)=>Math.hypot(a.x-255,a.z-262)-Math.hypot(b.x-255,b.z-262))[0];
 const off=east?{x:east.x+east.nx*22,z:east.z+east.nz*22}:{x:150,z:350};
 const colonies=[
  {kind:'gull',name:'Kauppatori canopies',x:112,z:292,radius:20,alt:[3.5,8.5],count:26,perches:[...ridges,...fountain],perchShare:.45},
  {kind:'gull',name:'Kauppatori square',x:110,z:296,radius:16,alt:[3,8],count:20,walkers:20,spots:knots,perches:fountain,spread:4},
  {kind:'gull',name:'Kauppatori quay',x:off.x,z:off.z,radius:16,alt:[3,9],count:16,perches:quay,perchShare:.5},
 ];
 // Flocks over open water in the harbour basin, well off the quays.
 const harbour=[];
 for(let x=60;x<=560;x+=40)for(let z=200;z<=640;z+=40)if(inWater(x,z)&&shore.every(s=>Math.hypot(s.x-x,s.z-z)>35))harbour.push({x,z,d:Math.hypot(x-150,z-330)});
 harbour.sort((a,b)=>a.d-b.d);const picked=[];
 for(const h of harbour){if(picked.length>=3)break;if(h.d>90&&picked.every(p=>Math.hypot(p.x-h.x,p.z-h.z)>150))picked.push(h);}
 picked.forEach((h,i)=>colonies.push({kind:'gull',name:`Eteläsatama ${i+1}`,x:h.x,z:h.z,radius:30+i*8,alt:[8,30],count:10,perches:quay,perchShare:.1}));
 return colonies;
}
