// Shared player travel for every city. Distances and speeds are world metres.
import {insidePlayable,pointInPolygon} from './geo.js';
import {makeCar} from './physics.js';
import {sweptContact} from './contact-geometry.js';
import {slopeAt} from './terrain.js';

export const TRAVEL_MODES=Object.freeze({
 walk:{label:'On foot',speed:2,run:4.8,acceleration:8,braking:12,halfWidth:.28,halfLength:.28},
 bike:{label:'Bicycle',speed:7,acceleration:2.4,braking:7,halfWidth:.34,halfLength:.9},
 scooter:{label:'Scooter',speed:25/3.6,acceleration:2.8,braking:8,halfWidth:.3,halfLength:.62},
});
export const CRASH_SPEED=2.2; // m/s: slower bumps just stop the ride
// Impact kinds (impacts.js HITTER_MASS) of the player's own body, and the speeds below which people simply step aside.
export const HIT_KIND={walk:'walker',bike:'bicycle',scooter:'scooter'},HIT_SPEED={walker:1,bicycle:1.2,scooter:1.2};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// Speed factor for a grade along the direction of travel (rise/run, uphill positive). Walking follows
// Tobler's hiking rule (a gentle descent is easiest, steep either way is slow); bicycles slow hard uphill
// and roll a little faster downhill; the scooter's motor holds better uphill and is limited downhill.
export function slopeFactor(mode,grade){
 const g=clamp(grade,-.4,.4);
 if(mode==='walk')return clamp(Math.exp(-3.5*(Math.abs(g+.05)-.05)),.35,1.1);
 if(mode==='bike')return g>0?Math.max(.3,1/(1+9*g)):Math.min(1.35,1-4*g);
 if(mode==='scooter')return g>0?Math.max(.45,1/(1+4.5*g)):Math.min(1.15,1-2*g);
 return 1;
}
const slope=[0,0];
export function gradeAhead(p,direction=1){slopeAt(p.x,p.z,slope);return -(slope[0]*Math.sin(p.heading)+slope[1]*Math.cos(p.heading))*direction;}
const gap=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const offset=(p,x,z)=>({x:p.x+x*Math.cos(p.heading)+z*Math.sin(p.heading),z:p.z-x*Math.sin(p.heading)+z*Math.cos(p.heading),heading:p.heading});
const bodySize=a=>({hw:a.halfWidth??a.hw??.98,hl:a.halfLength??a.hl??2.36});
function bodyContains(body,x,z,margin=.3){
 const c=Math.cos(body.heading||0),s=Math.sin(body.heading||0),dx=x-body.x,dz=z-body.z,{hw,hl}=bodySize(body);
 return Math.abs(dx*c-dz*s)<hw+margin&&Math.abs(dx*s+dz*c)<hl+margin;
}
export function travelCollision(p,mode,world,obstacles=[],ignore=[],from=null){
 const spec=TRAVEL_MODES[mode],w=spec.halfWidth,l=spec.halfLength;
 const buildings=world.collisionBuildings||world.buildings;
 for(const [sx,sz] of [[0,0],[-w,-l],[w,-l],[-w,l],[w,l],[0,-l],[0,l]]){
  const q=offset(p,sx,sz);
  if(!insidePlayable(q.x,q.z,.2))return 'boundary';
  const building=ignore.length&&buildings.near?buildings.near(q.x,q.z).find(b=>!b.disabled&&!ignore.includes(b)&&pointInPolygon(q.x,q.z,b.rings)):buildings.at(q.x,q.z);
  if(building&&!ignore.includes(building))return 'building';
  if(!world.roads.at(q.x,q.z)&&!world.pavement?.at(q.x,q.z)&&world.water?.some(b=>pointInPolygon(q.x,q.z,b.rings)))return 'water';
 }
 const dimensions={halfWidth:w,halfLength:l,ignore};
 if(from&&world.objects?.blocksStep?world.objects.blocksStep(from,p,dimensions):world.objects?.overlap(p,dimensions))return 'building';
 if(obstacles.some(b=>b!==p&&!b.disabled&&!b.playerTaken&&b.edge!==null&&!ignore.includes(b)&&bodyContains(b,p.x,p.z,spec.halfWidth)))return 'vehicle';
 return null;
}
export function clearTravelPath(from,to,world,obstacles=[],ignore=[]){
 const n=Math.max(1,Math.ceil(gap(from,to)/.25));
 let previous=from;
 for(let i=1;i<=n;i++){const next={...from,x:from.x+(to.x-from.x)*i/n,z:from.z+(to.z-from.z)*i/n};if(travelCollision(next,'walk',world,obstacles,ignore,previous))return false;previous=next;}
 return true;
}
// A dock can surround the front wheel. Roll the ride a short way onto clear
// ground before mounting, without removing the dock or crossing a solid wall.
export function mountPosition(ride,mode,world,obstacles=[],ignore=[]){
 if(!travelCollision(ride,mode,world,obstacles,ignore))return {x:ride.x,z:ride.z,heading:ride.heading};
 for(const [x,z] of [[0,.3],[0,.6],[0,.9],[0,1.2],[-.6,0],[.6,0],[-1.1,0],[1.1,0],[0,-.6],[0,-1.1]]){
  const p=offset(ride,x,z);
  if(!travelCollision(p,mode,world,obstacles,ignore)&&clearTravelPath(ride,p,world,obstacles,ignore))return {...p,heading:p.heading+(z>0?Math.PI:0)};
 }
 return null;
}
export function exitPosition(p,mode,world,obstacles=[]){
 const car=mode==='car',side=car?1.7:.9,end=car?3:1.5;
 for(const [x,z] of [[-side,0],[side,0],[-side,1],[side,1],[0,end],[0,-end]]){
  const q=offset(p,x,z);
  if(!travelCollision(q,'walk',world,[p,...obstacles])&&clearTravelPath(p,q,world,obstacles.filter(b=>b!==p)))return q;
 }
 return null;
}
function makeActor(p,mode,distance=0){return {...p,speed:0,steer:0,distance,travelMode:mode,...(mode==='car'?{}:{halfWidth:TRAVEL_MODES[mode].halfWidth,halfLength:TRAVEL_MODES[mode].halfLength,walking:mode==='walk'})};}

// Marked rides are gameplay objects, placed on clear ground near each selected
// start. Their positions do not claim to be real rental stations.
// Per-city look of the starter rides, e.g. {bike:{kind:'ladcykel',color:'#2d3a33'}} (set by main.js before the game starts).
export const STARTER_VISUALS={};
export function starterRides(car,world){
 const origin=exitPosition(car,'car',world),rides=[];
 if(!origin)return rides;
 for(const mode of ['bike','scooter']){
  if(STARTER_VISUALS.none?.includes(mode))continue;
  let best=null;
  // Parked on the pavement (never the carriageway or a cycle track) when there is any within 30 m;
  // only a start with no pavement near falls back to the nearest clear spot.
  for(const strict of [true,false]){
   for(let radius=3;radius<=(strict?30:22);radius+=1.5)for(let i=0;i<24;i++){
    const a=i*Math.PI/12,q={x:car.x+Math.cos(a)*radius,z:car.z+Math.sin(a)*radius,heading:car.heading};
    const pavement=world.pavement?.at(q.x,q.z),onWalk=!!pavement&&!world.roads.at(q.x,q.z)&&!/pyör|Pyör|cycle/.test(pavement.kind||'');
    if(strict&&!onWalk)continue;
    // on the pavement only the spot itself must be clear (parked cars or racks along the kerb may stand between)
    if(travelCollision(q,mode,world,[car,...rides])||(!strict&&!clearTravelPath(origin,q,world,[car,...rides]))||rides.some(r=>gap(r,q)<2.3))continue;
    const score=gap(origin,q)+(onWalk?0:14);
    if(!best||score<best.score)best={...q,score};
   }
   if(best)break;
  }
  if(best)rides.push({...makeActor({x:best.x,z:best.z,heading:best.heading},mode),id:mode,mode,parked:true,...(STARTER_VISUALS[mode]?{visual:{...STARTER_VISUALS[mode]}}:{})});
 }
 return rides;
}

export class PlayerTravel{
 constructor(car,world,{cars=()=>[],rides=()=>[],obstacles=()=>[]}={}){this.carSources=cars;this.rideSources=rides;this.obstacles=obstacles;this.reset(car,world);}
 reset(car,world){
  for(const source of this.claimedSources||[])source.release?.();
  this.claimedSources=[];this.world=world;this.car=car;this.homeCar=car;car.travelMode='car';car.id='car';this.cars=[car];this.actor=car;this.mode='car';this.rides=starterRides(car,world);this.riding=null;this.transition=null;this.sprint=false;
 }
 parked(){return [...this.cars.filter(c=>c!==this.actor),...this.rides.filter(r=>r!==this.riding)];}
 parkedBodies(){return this.parked().map(p=>({...p,hw:p.halfWidth??.98,hl:p.halfLength??2.36,ref:{...p,parked:true}}));}
 choices(obstacles=this.obstacles()){
  const sources=[...this.carSources().map(s=>({source:s,mode:'car'})),...this.rideSources().filter(s=>s.mode==='bike'||s.mode==='scooter').map(source=>({source,mode:source.mode}))].filter(({source:s})=>s.actor&&!s.actor.playerTaken&&s.actor.edge!==null&&gap(this.actor,s.actor)<14),parked=this.parked();
  const entries=[...this.cars.map(actor=>({id:actor.id,mode:'car',actor,label:actor.label||'Car'})),...this.rides.map(actor=>({id:actor.id,mode:actor.mode,actor,label:actor.label||TRAVEL_MODES[actor.mode].label})),...sources.map(({source,mode})=>({id:source.id,mode,actor:source.actor,label:source.label||(mode==='car'?'Car':TRAVEL_MODES[mode].label),source}))];
  return entries.map(r=>{
   const distance=gap(this.actor,r.actor),near=r.mode==='car'?bodyContains(r.actor,this.actor.x,this.actor.z,1.4):distance<3;
   // The target vehicle's own collider is ignored only for reaching it;
   // real buildings and intervening vehicles still prevent entry.
   const ignore=r.source?.obstacle?[r.source.obstacle]:[],bodies=[...parked,...obstacles].filter(b=>b!==r.actor),stopped=Math.abs(r.actor.speed||0)<=1.2;
   const path=this.mode==='walk'&&near&&stopped&&r.source?.canClaim?.()!==false&&clearTravelPath(this.actor,r.actor,this.world,bodies,ignore);
   const mount=path&&r.mode!=='car'?mountPosition(r.actor,r.mode,this.world,bodies,ignore):null;
   return {...r,distance,mount,available:!!path&&(r.mode==='car'||!!mount)};
  });
 }
 nearest(obstacles=this.obstacles()){return this.choices(obstacles).filter(c=>c.available).sort((a,b)=>a.distance-b.distance)[0]||null;}
 interact(id=null,obstacles=this.obstacles()){
  if(this.mode!=='walk'){
   if(Math.abs(this.actor.speed)>1.2)return {ok:false,message:'Stop before getting off.'};
   const position=exitPosition(this.actor,this.mode,this.world,[...this.parked(),...obstacles]);
   if(!position)return {ok:false,message:'There is no room to get off here. Move to a clear spot.'};
   this.actor.speed=0;this.actor.steer=0;if(this.riding){Object.assign(this.riding,this.actor);this.riding.parked=true;}
   const from={...this.actor};this.actor=makeActor(position,'walk',this.actor.distance);this.mode='walk';this.riding=null;this.startTransition(from);
   return {ok:true,message:'On foot'};
  }
  const choice=id?this.choices(obstacles).find(c=>c.id===id&&c.available):this.nearest(obstacles);
  if(!choice)return {ok:false,message:'Move beside a stopped car, bicycle or scooter.'};
  let target=choice.actor;
  if(choice.source){
   const taken=choice.source.claim?.();if(taken===false)return {ok:false,message:'Wait for the ride to stop.'};
   target=choice.mode==='car'?{...makeCar(target.x,target.z,target.heading),travelMode:'car'}:{...makeActor(choice.mount,choice.mode),mode:choice.mode,parked:false};
   Object.assign(target,{id:choice.id,label:choice.label,visual:choice.source.visual});
   (choice.mode==='car'?this.cars:this.rides).push(target);this.claimedSources.push(choice.source);
  }else if(choice.mount){
   Object.assign(target,choice.mount);
  }
  const from={...this.actor};target.distance=this.actor.distance;target.speed=0;target.steer=0;this.actor=target;this.mode=choice.mode;if(choice.mode==='car')this.car=target;this.startTransition(from);
  this.riding=choice.mode==='car'?null:target;if(this.riding){this.riding.parked=false;delete this.riding.fallen;}
  return {ok:true,message:choice.label};
 }
 // A bike or scooter that hits something at speed falls over; the rider lands beside it and gets up after a moment.
 crash(speed,obstacles=[]){
  const ride=this.riding,from={...this.actor};if(!ride)return;
  Object.assign(ride,{speed:0,steer:0,parked:true,fallen:{side:Math.random()<.5?-1:1,elapsed:0}});
  const spot=exitPosition(this.actor,this.mode,this.world,[...this.parked(),...obstacles])||from;
  this.actor=makeActor({x:spot.x,z:spot.z,heading:from.heading},'walk',from.distance);this.mode='walk';this.riding=null;this.sprint=false;this.transition=null;
  this.actor.knockdown={elapsed:.001,duration:clamp(1.8+speed*.3,2,4.5),prone:speed>4.5,side:ride.fallen.side};
 }
 // The player's body against pedestrians over one step (from: the body before it). A ride hits them by
 // its mass and speed and a hard hit throws the rider off; on foot it is only a bump, a stumble and a
 // grumble. Returns {kind,severity,actor,bumped|fell} for the first person hit, or null.
 hitPeople(from,people,impacts,{police=null,obstacles=[]}={}){
  const p=this.actor,kind=HIT_KIND[this.mode],speed=Math.abs(from.speed||0);
  if(!kind||p.knockdown||this.transition||speed<HIT_SPEED[kind])return null;
  const walk=kind==='walker',body={...from,halfWidth:p.halfWidth,halfLength:p.halfLength};
  for(const a of people){
   if(a.edge===null||a.knockdown||!Number.isFinite(a.x)||!sweptContact(body,p,a,true))continue;
   const severity=impacts.hit(a,{x:from.x,z:from.z,heading:from.heading,speed:from.speed},{kind,gentle:walk,police:walk?null:police});
   if(!severity)continue;
   if(walk){police?.report('bump',a.id);p.speed=0;return {kind,severity,actor:a,bumped:true};}
   if(severity.riderFalls){this.crash(speed,obstacles);return {kind,severity,actor:a,fell:speed};}
   p.speed=Math.sign(p.speed||from.speed)*Math.min(Math.abs(p.speed),severity.vehicleSpeed);if(this.riding)this.riding.speed=p.speed;
   return {kind,severity,actor:a};
  }
  return null;
 }
 startTransition(from){this.transition={from,elapsed:0,duration:.38};this.sprint=false;}
 advanceTransition(dt){if(this.transition){this.transition.elapsed+=Math.max(0,dt);if(this.transition.elapsed>=this.transition.duration)this.transition=null;}}
 viewActor(){
  if(!this.transition)return this.actor;
  const {from,elapsed,duration}=this.transition,t=clamp(elapsed/duration,0,1),s=t*t*(3-2*t);
  return {...this.actor,x:from.x+(this.actor.x-from.x)*s,z:from.z+(this.actor.z-from.z)*s,heading:from.heading+Math.atan2(Math.sin(this.actor.heading-from.heading),Math.cos(this.actor.heading-from.heading))*s};
 }
 step(keys,dt,obstacles=[]){
  if(this.mode==='car')return {collision:null};
  const fall=this.actor.knockdown;if(fall){fall.elapsed+=Math.max(0,dt);this.actor.speed=0;if(fall.elapsed>=fall.duration)delete this.actor.knockdown;return {collision:null};}
  const p=this.actor,spec=TRAVEL_MODES[this.mode],walk=this.mode==='walk';
  const up=keys.has('KeyW')||keys.has('ArrowUp'),down=keys.has('KeyS')||keys.has('ArrowDown'),brake=keys.has('Space');
  const steer=(keys.has('KeyA')||keys.has('ArrowLeft')?1:0)-(keys.has('KeyD')||keys.has('ArrowRight')?1:0)||(keys.tilt||0);
  const sprint=walk&&(this.sprint||keys.has('ShiftLeft')||keys.has('ShiftRight'));
  const base=brake?0:up===down?0:up?(sprint?spec.run:spec.speed):walk?-1.4:p.speed>.15?0:-1.3;
  const target=base*slopeFactor(this.mode,gradeAhead(p,Math.sign(base)));
  const acceleration=target===0||target*p.speed<0||Math.abs(target)<Math.abs(p.speed)?spec.braking:spec.acceleration;
  p.speed+=clamp(target-p.speed,-acceleration*dt,acceleration*dt);p.steer+=(steer-p.steer)*(1-Math.exp(-dt*(walk?14:8)));
  const before={...p},turn=p.steer*(walk?2.8:1.6*clamp(Math.abs(p.speed)/2,.15,1))*dt*(p.speed<-.05?-1:1);
  const travel=p.speed*dt,n=Math.max(1,Math.ceil(Math.abs(travel)/.15),Math.ceil(Math.abs(turn)/.08));let collision=null;
  for(let i=0;i<n;i++){
   const heading=p.heading+turn/n,q={...p,heading,x:p.x-Math.sin(heading)*travel/n,z:p.z-Math.cos(heading)*travel/n};
   collision=travelCollision(q,this.mode,this.world,[...this.parked(),...obstacles],[],p);
   if(collision){p.speed=0;break;}
   p.distance+=gap(p,q);Object.assign(p,{x:q.x,z:q.z,heading:q.heading});
  }
  if(this.riding)Object.assign(this.riding,p);
  if(collision&&!walk&&Math.abs(before.speed)>=CRASH_SPEED){const v=Math.abs(before.speed);this.crash(v,obstacles);return {collision,moved:gap(before,p),crashed:v};}
  return {collision,moved:gap(before,p)};
 }
 snapshot(){const copy=({visual,...actor})=>({...actor});return {mode:this.mode,sprint:this.sprint,actor:copy(this.actor),car:copy(this.car),cars:this.cars.map(copy),rides:this.rides.map(copy),choices:this.choices().map(({id,mode,label,distance,available})=>({id,mode,label,distance,available}))};}
}
