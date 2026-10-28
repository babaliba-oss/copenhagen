import * as THREE from 'three';
import {createPersonBatch,advanceGait,personLook} from './person-model.js';
import {createDoor} from './angry-drivers.js';
import {groundAt} from './terrain.js';
import {ROADBLOCK,roadblockSearch,roadblockVisible,roadblockClear,roadblockDistanceAhead,crossesStrip} from './roadblock-planning.js';
export {ROADBLOCK,planRoadblock,spanAcross,headingAlong,crossesStrip} from './roadblock-planning.js';

// Five-star pursuits can deploy a block on a suitable road ahead, in any city.
// The independent arrest scene can also play without a deployed roadblock.
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const ease=v=>{v=Math.min(1,Math.max(0,v));return v*v*(3-2*v);};
const lerp=(a,b,t)=>a+(b-a)*t;
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));

// Finnish police patrol uniform: dark navy jacket with POLIISI across the back
// (or a hi-vis vest over it), navy trousers, duty belt, black boots, peaked cap.
const OFFICER_LOOK={shirt:'#1b2436',trousers:'#1a2232',hat:'#1b2436',hairStyle:'police',shoes:'#121214',coat:0,skirt:false,bagType:null,
 uniform:'jacket',outer:'uniform',scarf:null,accessory:null,phoneWalk:false,stoop:0,age:'adult',stride:1};
const VEST_LOOK={...OFFICER_LOOK,uniform:'vest'};
export const officerLook=(seed,vest=false)=>personLook(9000+seed*13,vest?VEST_LOOK:OFFICER_LOOK);

// Arrest timeline, seconds after the door officers reach the car.
// pull: out of the seat; drag: turned to the car beside the rear door; down:
// leaned over, palms on the roof; cuff: wrists taken behind the back and
// cuffed; up: straightened and turned; walk: escorted to the patrol car.
// Fast: door to cuffs in about two seconds. `card` is when the
// BUSTED card comes up – while the cuffs are going on; the scene keeps playing behind it.
export const ARREST={reach:3,run:7,door:.35,pull:[.15,.8],drag:[.8,1.35],down:[1.35,1.65],cuff:[1.65,3.4],up:[3.4,4.2],walk:[4.2,7],card:2.2};

export function createRoadblock(scene,{world,police,carModel,playerLook=null,graph=police.graph,isVisible=null,eye=null,obstacles=()=>[],onWarning=null,random=Math.random,config={}}){
 const settings={...ROADBLOCK,...config,arrestCrawl:{...ROADBLOCK.arrestCrawl,...config.arrestCrawl}};
 const group=new THREE.Group();group.name='Police roadblock';scene.add(group);
 const stripGroup=new THREE.Group();stripGroup.name='Spike strip';group.add(stripGroup);
 const batch=createPersonBatch(16,{name:'Police officers',police:true});group.add(batch.group);
 let plan=null,posts=[];
 const currentVehicle=()=>{
  let paint=null;carModel?.traverse(o=>{if(!paint&&o.isMesh&&o.material.name==='paint')paint=o.material;});
  return {spec:{belt:.95,...carModel?.userData.spec},material:paint,paint:paint?.color||new THREE.Color('#9aa0a0')};
 };
 let deployed=false,standDown=false,burst=null,crawl=0,time=0,scene_=null,camera=null;
 let pursuit=false,phase='idle',attempts=0,nextAttempt=0,pending=null,warningAt=null,lastReason=null,search=null; // search: the site search under way (roadblockSearch), run a slice a frame
 group.visible=false;
 function clearStrip(){
  for(const mesh of [...stripGroup.children]){stripGroup.remove(mesh);mesh.dispose?.();mesh.geometry?.dispose();mesh.material?.dispose();}
 }
 // Yellow/black segments and metal spikes follow the actual ground height.
 function buildStrip(){
  clearStrip();const {a,b}=plan.strip,L=dist(a,b),n=Math.max(1,Math.round(L/.5)),spikes=Math.round(L/.12);
  const heading=Math.atan2(-(b.z-a.z),b.x-a.x),base=groundAt((a.x+b.x)/2,(a.z+b.z)/2);
  stripGroup.position.set((a.x+b.x)/2,.13+base,(a.z+b.z)/2);stripGroup.rotation.y=heading;
  const seg=new THREE.InstancedMesh(new THREE.BoxGeometry(L/n,.045,.34),new THREE.MeshStandardMaterial({roughness:.7}),n);
  const m=new THREE.Matrix4(),c=new THREE.Color(),height=t=>groundAt(a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t)-base;
  for(let i=0;i<n;i++){const t=(i+.5)/n;m.makeTranslation(-L/2+t*L,.022+height(t),0);seg.setMatrixAt(i,m);seg.setColorAt(i,c.set(i%2?'#1c1c1c':'#e2c11d'));}
  const spike=new THREE.InstancedMesh(new THREE.ConeGeometry(.018,.07,4),new THREE.MeshStandardMaterial({color:'#c9ccd0',metalness:.85,roughness:.3}),spikes*2);
  for(let i=0;i<spikes*2;i++){const t=((i>>1)+.5)/spikes;m.makeTranslation(-L/2+t*L,.08+height(t),i%2?.08:-.08);spike.setMatrixAt(i,m);}
  seg.receiveShadow=true;stripGroup.add(seg,spike);
 }
 function deploy(next){
  plan=next;deployed=!!next;group.visible=deployed||!!scene_;stripGroup.visible=deployed;
  if(next){
   buildStrip();posts=next.officers.map((p,i)=>({...p,post:{...p},look:officerLook(i,i%2===0),gait:{},speed:0,pose:i===Math.floor(next.officers.length/2)?'stop':'belt',groundY:.13,id:`officer-${i}`}));
  }else{clearStrip();posts=[];}
  police.setParked(next?.cars||[]);
 }
 function clearPursuit(){
  if(deployed)deploy(null);
  pursuit=false;phase='idle';attempts=0;pending=null;search=null;warningAt=null;nextAttempt=0;burst=null;crawl=0;lastReason=null;
 }
 function retry(reason){pending=null;search=null;warningAt=null;lastReason=reason;phase=attempts>=settings.maxAttempts?'unavailable':'waiting';nextAttempt=time+settings.retry;}
 // The chance roll belongs to the pursuit, not the render/physics frame.
 // Clear/rearm even while on foot (main's `started` can be false for walkers).
 function step(dt,car,previous,{started=true,onBurst=null}={}){
  time+=dt;
  if(police.busted)return;
  if(!(police.level>0)){if(pursuit||deployed||pending)clearPursuit();standDown=false;return;}
  if(standDown||!car)return;
  const driving=started&&(!car.travelMode||car.travelMode==='car');
  if(!driving){if(pending||search)retry('left-vehicle');crawl=0;return;} // a burst tyre stays burst: hopping out and back in dodged the arrest
  if(!pursuit&&police.level>=settings.minLevel){
   pursuit=true;attempts=0;
   if(random()>=settings.chance){phase='skipped';lastReason='chance';}
   else{phase='waiting';nextAttempt=time+settings.delay[0]+random()*(settings.delay[1]-settings.delay[0]);}
  }
  if(pursuit&&!deployed&&police.level<settings.minLevel){if(pending||search)retry('wanted-reduced');return;}
  if(pending&&time-warningAt>=settings.warningLead){
   const d=dist(car,pending.centre),ahead=roadblockDistanceAhead(pending,car),safeDistance=Math.max(settings.minDeployDistance,Math.abs(car.speed||0)*2.5);
   if(ahead===null||d<safeDistance||ahead<safeDistance)retry('route-changed');
   else if(roadblockVisible(pending,world,car,isVisible,eye?.()))retry('in-view'); // eye: the camera's position, so the houses it cannot see through hide a site
   else if(!roadblockClear(pending,world,{obstacles:obstacles()}))retry('occupied');
   else{deploy(pending);pending=null;phase='deployed';lastReason=null;}
  }
  if(phase==='waiting'&&time>=nextAttempt&&Math.abs(car.speed||0)>=settings.minMovingSpeed){
   attempts++;const at=eye?.();
   search=roadblockSearch(world,graph,car,{config:settings,isVisible,eye:at&&{x:at.x,y:at.y,z:at.z},obstacles:obstacles()});phase='planning';
  }
  // The search runs a slice of at most sliceMs a frame, from where the car and camera were when it started. In today's
  // Copenhagen an attempt is now ~1 ms of work at the median, up to ~50 ms where many sites are tried; it was 25 ms at the
  // median and up to ~150 ms, all in one frame, rebuilding the road index each time.
  if(search){
   const end=performance.now()+settings.sliceMs;let r;do r=search.next();while(!r.done&&performance.now()<end);
   if(r.done){search=null;pending=r.value;
    if(pending){phase='warning';warningAt=time;onWarning?.(`Police are setting up a spike strip${pending.roadName?' on '+pending.roadName:' ahead'}. Find another route.`);}
    else retry('no-safe-site');}
  }
  if(!deployed)return;
  if(burst&&burst.car!==car)burst=null; // a different car: the old burst no longer blocks the strip
  if(!burst&&previous&&crossesStrip(previous,car,plan.strip)&&Math.abs(car.speed)>.5){
   burst={time,car};car.flat=1;onWarning?.('Spike strip! Tyres shredded.');onBurst?.();
  }
  if(burst&&burst.car===car){
   crawl=Math.abs(car.speed)<settings.arrestCrawl.speed?crawl+dt:0;
   if(crawl>=settings.arrestCrawl.time||time-burst.time>=settings.arrestCrawl.limit){car.speed=0;police.arrestNow('Stopped on the spike strip — busted.');}
  }
 }
 // Officers idle at their posts; the middle one holds a palm up at the oncoming car.
 function animatePosts(dt,car){
  for(const o of posts){if(o.busy)continue;
   if(car){const want=Math.atan2(-(car.x-o.x),-(car.z-o.z)),near=dist(o,car)<90;o.heading+=wrap((near?want:o.post.heading)-o.heading)*Math.min(1,dt*4);}
   o.speed=0;advanceGait(o,o.gait,dt,o.look);
  }
 }

 // ---------------- arrest scene ----------------
 // Car-local → world: x to the car's right, z towards its rear.
 function local(car,x,z){const s=Math.sin(car.heading),c=Math.cos(car.heading);return {x:car.x+c*x+s*z,z:car.z-s*x+c*z};}
 function startArrest(car){
  if(scene_||!car)return;
  const onFoot=!!car.travelMode&&car.travelMode!=='car',squad=[];
  // Roadblock officers close by join in; otherwise two officers jump out of each of the nearest patrol cars.
  if(deployed)for(const o of [...posts].sort((a,b)=>dist(a,car)-dist(b,car)))if(dist(o,car)<55&&squad.length<6){o.busy=true;squad.push(o);}
  const units=[...(police.units||[])].sort((a,b)=>dist(a,car)-dist(b,car));
  // Officers already out on foot (police.js FOOT_CHASE) are the ones at hand: they make the arrest from where they stand, in the
  // look they were drawn with (foot-officers.js). They used to vanish at the arrest, and two more ran in from cars 100 m off.
  for(const u of units){const f=u.officer;if(!f||f.back||squad.length>=6||dist(f,car)>40)continue;squad.push({x:f.x,z:f.z,heading:f.heading,look:f.look||officerLook(40+squad.length,squad.length%2===1),gait:{},speed:0,groundY:.13,spawned:true,id:`officer-f${squad.length}`});}
  for(const u of units){if(squad.length>=6)break;
   for(const side of [-1,1]){if(squad.length>=6)break;const s=Math.sin(u.heading),c=Math.cos(u.heading);
    const o={x:u.x+c*1.6*side,z:u.z-s*1.6*side,heading:u.heading,look:officerLook(40+squad.length,squad.length%2===1),gait:{},speed:0,groundY:.13,spawned:true,id:`officer-x${squad.length}`};squad.push(o);}
  }
  while(squad.length<4){const p=local(car,(squad.length%2?3:-3),14);squad.push({...p,heading:car.heading,look:officerLook(70+squad.length,squad.length%2===1),gait:{},speed:0,groundY:.13,spawned:true,id:`officer-y${squad.length}`});}
  // Two nearest to the driver's door (front left) do the arrest; the rest ring the car.
  const door=onFoot?car:local(car,-1.4,-.2);squad.sort((a,b)=>dist(a,door)-dist(b,door));
  const ring=[[-2.9,-3.3],[2.4,-3.5],[2.6,3.1],[-2.7,3.6],[.4,-5.6],[0,5.8]];
  squad.forEach((o,i)=>{o.role=i===0?'lead':i===1?'second':'ring';o.slot=i===0?(onFoot?[-.75,.6]:[-1.95,1.05]):i===1?(onFoot?[.75,.1]:[-2,2.05]):ring[(i-2)%ring.length];o.pose=null;o.running=true;});
  const doorMesh=onFoot?null:createDoor(currentVehicle());
  // The door hangs on the car model itself (same frame: forward -Z, left -X, origin on the ground): placed flat beside it
  // in the world, it floated off a car tilted by a slope or a kerb (Daniel's BUSTED shot, the door at a weird angle).
  if(doorMesh){if(carModel){doorMesh.root.position.set(0,0,0);carModel.add(doorMesh.root);}else{doorMesh.root.position.set(car.x,.12+groundAt(car.x,car.z),car.z);doorMesh.root.rotation.y=car.heading;group.add(doorMesh.root);}}group.visible=true;
  const look=playerLook||personLook(4242,{bagType:null,accessory:null,phoneWalk:false,stoop:0});
  const driver={x:car.x,z:car.z,heading:car.heading,speed:0,groundY:.13,look,gait:{},hidden:!onFoot,pose:onFoot?'grab':null};
  // Walked to the left rear door of the nearest patrol car, or back along the street.
  const unit=units.find(u=>dist(u,car)<14&&dist(u,car)>4),s=Math.sin(unit?.heading||0),c=Math.cos(unit?.heading||0);
  const patrol=unit?{x:unit.x-c*1.6+s*.6,z:unit.z+s*1.6+c*.6}:local(car,-2.6,9);
  scene_={car:{x:car.x,z:car.z,heading:car.heading},mode:car.travelMode||'car',onFoot,t:0,doorAt:null,squad,door:doorMesh,driver,patrol,walkFrom:null};
 }
 function moveTo(o,target,speed,dt,face){
  const dx=target.x-o.x,dz=target.z-o.z,d=Math.hypot(dx,dz);
  if(d>.05){const step=Math.min(d,speed*dt);o.x+=dx/d*step;o.z+=dz/d*step;o.speed=dt>0?step/dt:0;o.heading+=wrap(Math.atan2(-dx,-dz)-o.heading)*Math.min(1,dt*10);}
  else{o.speed=0;if(face!==undefined)o.heading+=wrap(face-o.heading)*Math.min(1,dt*8);}
  return d;
 }
 const face=(o,p)=>Math.atan2(-(p.x-o.x),-(p.z-o.z));
 function updateArrest(dt){
  const S=scene_;if(!S)return;S.t+=dt;const car=S.car,out=car.heading+Math.PI/2,A=ARREST;
  const [lead,second]=S.squad,driver=S.driver;
  if(S.doorAt===null){
   for(const o of S.squad){o.running=true;moveTo(o,local(car,...o.slot),A.run,dt,face(o,car));}
   if((dist(lead,local(car,...lead.slot))<.3&&dist(second,local(car,...second.slot))<.3)||S.t>=A.reach){
    // Late runners are hurried into place so the scene keeps its pace.
    for(const o of [lead,second]){const p=local(car,...o.slot);o.x=p.x;o.z=p.z;}S.doorAt=S.t;
   }
  }
  if(S.doorAt!==null){
   const t=S.t-S.doorAt;
   if(S.door){S.door.hinge.rotation.y=-1.1*ease(t/A.door);S.door.recess.visible=t>.02;}
   for(const o of S.squad.slice(2)){o.running=dist(o,local(car,...o.slot))>2;moveTo(o,local(car,...o.slot),o.running?A.run:1.6,dt,face(o,car));o.pose=o===S.squad[2]?'stop':o.speed<.1?'belt':null;}
   // Driver: pulled from the seat, put against the car, cuffed, stood up, walked to the patrol car.
   driver.hidden=!S.onFoot&&t<A.pull[0];driver.knockdown=null;
   const pull=ease((t-A.pull[0])/(A.pull[1]-A.pull[0])),drag=ease((t-A.drag[0])/(A.drag[1]-A.drag[0])),lean=ease((t-A.down[0])/(A.down[1]-A.down[0])),rise=ease((t-A.up[0])/(A.up[1]-A.up[0]));
   const px=driver.x,pz=driver.z,toCar=car.heading-Math.PI/2;
   if(t<A.walk[0]){
    // Out of the seat, round the open door to the rear door, a half step back to lean in.
    if(S.onFoot){driver.x=car.x;driver.z=car.z;driver.heading=car.heading+wrap(face(driver,S.patrol)-car.heading)*rise;}
    else{const p=local(car,lerp(lerp(-.45,-1.5,pull),-1.6-.22*lean*(1-rise),drag),lerp(-.25,.95,drag));driver.x=p.x;driver.z=p.z;
     driver.heading=t<A.drag[0]?out:t<A.up[0]?wrap(out+wrap(toCar-out)*drag):wrap(toCar+wrap(face(driver,S.patrol)-toCar)*rise);}
   }else{
    // Walking pace, a little quicker if the patrol car is far, arriving by the end of the walk.
    S.walkFrom??={x:driver.x,z:driver.z};
    const pace=Math.min(2.2,Math.max(1.1,dist(S.walkFrom,S.patrol)/(A.walk[1]-A.walk[0])));
    moveTo(driver,S.patrol,pace,dt);
   }
   driver.speed=dt>0?Math.min(2.4,Math.hypot(driver.x-px,driver.z-pz)/dt):0;
   driver.groundY=S.onFoot?.13:.13-.75*(1-ease(pull*1.4));
   const cuffed=t>=A.cuff[0]+.55;
   driver.pose=cuffed?'cuffed':S.onFoot?'grab':t>=A.down[0]?'handsOnCar':t>=A.pull[0]?'grab':null;
   driver.lean=S.onFoot?0:t<A.up[0]?lean*(cuffed?.22:.42):.22*(1-rise);driver.headPitch=!S.onFoot&&t>=A.down[0]&&t<A.up[1]?.25*(1-rise):0;
   // The arresting pair: hands on the driver while pulling and turning; the lead
   // cuffs from behind while the second holds the upper arm; then one each side, escorting.
   const fx=-Math.sin(driver.heading),fz=-Math.cos(driver.heading),rx=Math.cos(driver.heading),rz=-Math.sin(driver.heading);
   const at=(side,back)=>({x:driver.x+rx*side-fx*back,z:driver.z+rz*side-fz*back});
   if(t>=A.pull[0]){
    const against=t>=A.down[0]&&t<A.up[0];
    for(const [o,sgn] of [[lead,-1],[second,1]]){
     let target,pose,look;
     if(t<A.down[0]){target=at(sgn*.75,0);pose='grab';look=driver;}
     else if(against&&o===lead){target=at(-.12,.62);pose=t<A.cuff[0]?'grab':'cuffing';look=at(0,-1);}
     else if(against){target=at(-.7,.3);pose='escort';o.escortSide=1;look=at(0,-.6);}
     else{target=at(sgn*.62,.12);pose='escort';o.escortSide=-sgn;look=at(sgn*.62,-2);}
     o.running=false;moveTo(o,target,t<A.drag[1]?3:2.4,dt,face(o,look));o.pose=pose;
    }
   }else for(const o of [lead,second]){o.pose=null;o.heading+=wrap(face(o,local(car,-1,-.2))-o.heading)*Math.min(1,dt*8);}
  }
  for(const o of S.squad)advanceGait(o,o.gait,dt,o.look);
  if(!driver.hidden)advanceGait(driver,driver.gait,dt,driver.look);
  // Camera: low, beside the driver's side, looking at the driver; stays out of buildings.
  const focus=driver.hidden?local(car,-1.2,0):driver;
  const options=[[-4.6,7.5],[-7,4.5],[-7.5,-3.5],[-3,-9],[7,-8],[4.6,7.5],[7,4.5],[-9,0],[9,0],[0,10],[0,-10]].map(([x,z])=>local(car,x,z));
  const clear=p=>{const n=8;for(let i=0;i<=n;i++){const x=p.x+(focus.x-p.x)*i/n,z=p.z+(focus.z-p.z)*i/n;if((world.cameraBuildings||world.buildings).at(x,z))return false;}return true;};
  // No low view in the clear (a narrow lane, the car against a house): look down from above the roofs instead of from inside a house.
  const low=options.find(clear),eye=low||options[0],h=low?2.7+Math.min(1.2,S.t*.08):22;
  if(!camera)camera={x:eye.x,z:eye.z,tx:focus.x,tz:focus.z};
  const k=1-Math.exp(-dt*2.5);camera.x+=(eye.x-camera.x)*k;camera.z+=(eye.z-camera.z)*k;camera.tx+=(focus.x-camera.tx)*k;camera.tz+=(focus.z-camera.tz)*k;camera.h=camera.h===undefined?h:camera.h+(h-camera.h)*k;
 }
 return {
  group,step,startArrest,get plan(){return plan;},
  get deployed(){return deployed;},get burst(){return !!burst;},
  get playing(){return !!scene_&&(scene_.doorAt===null||scene_.t-scene_.doorAt<ARREST.card);},
  get active(){return !!scene_;},
  update(dt,viewer){
   animatePosts(dt,viewer);updateArrest(dt);
   batch.begin(viewer);
   if(deployed)for(const o of posts)if(!o.busy)batch.draw(o,o.look,o.gait,time);
   if(scene_){for(const o of scene_.squad)batch.draw(o,o.look,o.gait,time);if(!scene_.driver.hidden)batch.draw(scene_.driver,scene_.driver.look,scene_.driver.gait,time);}
   batch.end();
  },
  cameraPose(){if(!scene_||!camera)return null;const g=groundAt(camera.tx,camera.tz);return {position:[camera.x,camera.h+g,camera.z],target:[camera.tx,1+g,camera.tz]};},
  // Continue clears this response; a later pursuit can earn another one.
  clearArrest(){if(scene_?.door){scene_.door.root.removeFromParent();scene_.door.dispose();}scene_=null;camera=null;for(const o of posts){o.busy=false;Object.assign(o,o.post);o.pose='belt';o.knockdown=null;}if(posts.length)posts[Math.floor(posts.length/2)].pose='stop';group.visible=deployed;},
  standDown(){this.clearArrest();clearPursuit();standDown=true;},
  reset(){this.clearArrest();clearPursuit();standDown=false;time=0;},
  snapshot(){return {deployed,standDown,phase,pursuit,attempts,lastReason,warningAt,nextAttempt,pending:pending?{centre:pending.centre,roadName:pending.roadName,distanceAhead:pending.distanceAhead}:null,burst:!!burst,strip:plan?.strip||null,roadName:plan?.roadName||null,cars:plan?.cars.length||0,officers:posts.length,arrest:scene_?{mode:scene_.mode,hasDoor:!!scene_.door,t:+scene_.t.toFixed(2),doorAt:scene_.doorAt,squad:scene_.squad.length,driver:{x:scene_.driver.x,z:scene_.driver.z,hidden:scene_.driver.hidden,pose:scene_.driver.pose,prone:!!scene_.driver.knockdown,lean:+(scene_.driver.lean||0).toFixed(2),groundY:scene_.driver.groundY},patrol:scene_.patrol,officers:scene_.squad.slice(0,2).map(o=>({x:o.x,z:o.z,pose:o.pose}))}:null};},
 };
}
