import {routePoint} from './mobility.js';
import {safeVehicleSegment,vehicleFitsRoad,trafficFootprintsOverlap} from './road-safety.js';
import {cornerSpeedLimit} from './traffic-driving.js';

export const wantedLevel=heat=>heat>=24?5:heat>=16?4:heat>=10?3:heat>=6?2:heat>=3?1:0;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);

// Relative closing speed in world m/s (HUD shows 70%). A parking-speed tap
// is ignored; a real collision starts at two stars, anywhere in the world.
export const CRASH_MIN_SPEED=4;
export const INCIDENT_WINDOW=12,CONTACT_COOLDOWN=3;
export const RECKLESS={speed:75/3.6,turnSpeed:40/3.6,lateralAcceleration:5,pavementSpeed:30/3.6,duration:2,cooldown:8};
export function incidentHeat(kind,speed=8){
 if(kind==='reckless')return 3;
 if(kind==='bump')return 1; // shoving past someone on foot
 // Hitting a person: a stumble, a knock-down or a throw (impacts.js SEVERITY_REPORT); 7 when unknown.
 if(kind==='pedestrian')return speed<3?6:speed<9?7:10;
 if(!(speed>=CRASH_MIN_SPEED))return 0;
 if(kind==='police')return 8;
 return speed>=16?7:6;
}
// Use actual motion for dangerous cornering; holding the steering key against
// a wall does not count. Missing pavement data never invents an offence.
export function recklessDriving(from,player,dt,world){
 if(!(dt>0))return false;
 const speed=Math.abs(player.speed||0);
 if(speed>=RECKLESS.speed)return true;
 const turn=Math.abs(Math.atan2(Math.sin(player.heading-from.heading),Math.cos(player.heading-from.heading)))/dt;
 if(speed>=RECKLESS.turnSpeed&&speed*turn>=RECKLESS.lateralAcceleration)return true;
 return speed>=RECKLESS.pavementSpeed&&!world?.roads?.at(player.x,player.z)&&!!world?.pavement?.at(player.x,player.z);
}
// Seconds out of every unit's sight before the search is called off.
export const escapeTime=level=>level?10+level*5:0;
export const heatForLevel=level=>[0,3,6,10,16,24][Math.max(0,Math.min(5,Math.round(level)))];
// Four- and five-star incidents call a stronger response in every city.
// Units arrive closer, prefer spots the player cannot see, and arrest sooner.
// arrestRange: a car stopped on the tram tracks is 10–20 m from the lane
// beside the platform where units can actually pull up, so the surge arrests
// from further away than the ordinary 10 m.
// backupAfter/backupSpawn: when the player has been stopped for backupAfter
// seconds and no unit has reached arrest range (the first wave is boxed in by
// traffic at a junction, as happens at Lasipalatsi), one unit pulls up 26–42 m
// away out of the player's view – behind them or behind a building.
export const SURGE={spawn:[60,110],dispatch:.7,minUnits:3,bustTime:2,arrestRange:40,sight:220,escapeScale:3,cruise:6,duration:40,backupAfter:2,backupSpawn:[26,42]};
export const BUST_TIME=4;
// Hands-on arrest, everywhere: a unit physically at the car (centre to centre
// within `range`, any side, even boxed in by traffic) with the player stopped
// or crawling below `speed` (world m/s; 8 km/h) makes the arrest after `time`
// seconds, instead of waiting out the ordinary or surge bust timers.
export const CONTACT_BUST={range:7,speed:8/3.6,time:1};
// Closing speed between the player and another road user.
export function closingSpeed(a,b){
 const as=a.speed||0,bs=b.speed||0;
 return Math.hypot(-Math.sin(a.heading||0)*as+Math.sin(b.heading||0)*bs,-Math.cos(a.heading||0)*as+Math.cos(b.heading||0)*bs);
}

// Swept contacts, independent of render frame rate. Persistent contact is one
// incident, not one offence per physics tick. Only moving player impacts count.
import {sweptContact} from './contact-geometry.js';
export {sweptContact} from './contact-geometry.js';

// Tiny min-heap for shared reverse Dijkstra; one route field serves all units.
function push(heap,item){let i=heap.length;heap.push(item);while(i){const p=(i-1)>>1;if(heap[p][0]<=item[0])break;heap[i]=heap[p];i=p;}heap[i]=item;}
function pop(heap){const result=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1][0]<heap[child][0])child++;if(heap[child][0]>=last[0])break;heap[i]=heap[child];i=child;}heap[i]=last;}return result;}

export class PoliceSimulation{
 constructor(graph,world){
  this.graph=graph;this.world=world;this.incoming=Array.from({length:graph.nodes.length},()=>[]);
  graph.edges.forEach(e=>this.incoming[e.to].push(e));this.reset();
 }
 // Extension edges retain their IDs; wanted state and units are left intact.
 refreshGraph(){
  this.incoming=Array.from({length:this.graph.nodes.length},()=>[]);
  for(const e of this.graph.edges)this.incoming[e.to].push(e);
  this.costs=[];this.target=null;this.intercept=null;this.predicted=null;this.repath=0;
 }
 reset(){this.time=0;this.heat=0;this.units=[];this.contacts=new Map();this.recentIncidents=[];this.recklessSeconds=0;this.recklessAt=-Infinity;this.blocked=new Map();this.escape=0;this.bust=0;this.contact=0;this.stopped=0;this.backupAt=-Infinity;this.grace=0;this.repath=0;this.dispatch=0;this.costs=[];this.target=null;this.message=null;this.serial=0;this.busted=false;this.lastSeen=null;this.seen=false;this.intercept=null;this.predicted=null;this.pressure=false;this.surgeUntil=-Infinity;this.minUnits=0;this.units=[...(this.parked||[])];}
 get level(){return wantedLevel(this.heat);}
 get obstacles(){return this.units;}
 // Location never starts or ends the stronger response.
 get surging(){return this.level>=4&&this.time<this.surgeUntil;}
 get bustTime(){return this.surging?SURGE.bustTime:BUST_TIME;}
 setPressure(active){this.pressure=!!active;}
 // Roadblock (src/roadblock.js): parked units stand still with lights on, block
 // the road and can make the arrest, but never chase or retire.
 setParked(list=[]){this.units=this.units.filter(u=>!u.parked);this.parked=list.map((p,i)=>({id:`police-rb${i}`,role:'parked',parked:true,speed:0,stuck:0,braking:false,...p}));this.units.push(...this.parked);}
 // Arrest right now (a car crippled on the spike strip).
 arrestNow(message='Busted — pursuit ended.'){
  if(this.busted)return false;this.busted=true;this.heat=0;this.bust=this.bustTime;this.escape=0;
  if(this.player)this.player.speed=0;for(const u of this.units)u.speed=0;this.message=message;return true;
 }
 // Explicit escalation for scripted incidents; ordinary driving uses report().
 escalate({level=4,message='Police alerted — units converging.'}={}){
  if(this.busted)return false;
  this.heat=Math.max(this.heat,heatForLevel(level));this.grace=0;
  this.escape=0;this.lastSeen=null;this.repath=0;this.dispatch=this.time;this.surgeUntil=this.time+SURGE.duration;
  this.message=message;return true;
 }
 report(kind,id,speed){
  if(this.busted||this.time<this.grace)return false;
  // Relaxed cities (Copenhagen): only running people over or ramming a patrol car brings the police, and at one star less.
  if(this.relaxed&&kind!=='pedestrian'&&kind!=='police')return false;
  let add=incidentHeat(kind,speed);if(!add)return false;
  if(this.relaxed)add=Math.max(3,add-3);
  const key=`${kind}:${id}`,last=this.contacts.get(key)??-Infinity;this.contacts.set(key,this.time);
  if(this.time-last<CONTACT_COOLDOWN)return false;
  const before=this.level;
  this.recentIncidents=this.recentIncidents.filter(t=>this.time-t<=INCIDENT_WINDOW);
  this.heat=Math.min(30,this.heat+add+Math.min(3,this.recentIncidents.length));
  this.recentIncidents.push(this.time);
  if(this.level>=4)this.surgeUntil=this.time+SURGE.duration;
  this.escape=0;this.lastSeen=null;this.repath=0;this.dispatch=Math.min(this.dispatch,this.time+.5);
  this.message=kind==='bump'?(this.level>before?'Shoving people — a patrol is responding.':null):kind==='reckless'?(before?'Reckless driving — wanted level increased.':'Reckless driving — a patrol is responding.'):kind==='pedestrian'?'Pedestrian hit — police alerted.':kind==='police'?'You hit a police car!':!before?'Crash reported — a patrol is responding.':this.level>before?'Another crash — wanted level increased.':'Crash reported.';
  this.onIncident?.(kind,id,speed,this.level);
  return true;
 }
 // Called once per movement step, including driving:false on foot or a bike.
 // Two seconds of sustained risk earns a report; continuous risky driving can
 // escalate again only after eight seconds, independently of render rate.
 observeDriving(from,player,dt,{driving=player?.travelMode==='car'}={}){
  if(!(dt>0)||!Number.isFinite(dt))return false;
  if(!driving||!from||!player||this.busted||this.time<this.grace){this.recklessSeconds=0;return false;}
  this.recklessSeconds=recklessDriving(from,player,dt,this.world)?this.recklessSeconds+Math.max(0,dt):Math.max(0,this.recklessSeconds-Math.max(0,dt)*2);
  if(this.recklessSeconds+1e-9<RECKLESS.duration||this.time<this.recklessAt)return false;
  if(!this.report('reckless','driving',Math.abs(player.speed)))return false;
  this.recklessSeconds=0;this.recklessAt=this.time+RECKLESS.cooldown;return true;
 }
 observe(from,player,cars,people){
  const moving=Math.abs(player.speed)>=2&&this.time>=this.grace;
  for(const a of cars)if(moving&&a.edge&&distance(player,a)<distance(from,player)+8&&sweptContact(from,player,a))this.report('vehicle',a.id,closingSpeed(from,a));
  for(const a of people)if(moving&&a.edge&&distance(player,a)<distance(from,player)+6&&sweptContact(from,player,a,true)){
   this.report('pedestrian',a.id);a.panicUntil=this.time+3;player.speed*=.75;
  }
  for(const unit of this.units)if(sweptContact(from,player,unit)){
   if(moving)this.report('police',unit.id,closingSpeed(from,unit));player.x=from.x;player.z=from.z;player.heading=from.heading;player.speed=0;break;
  }
 }
 plan(player){const f=this.field(player);this.target=f.target;this.costs=f.costs;}
 // One reverse-Dijkstra route field towards a point. Chase units use the last
 // seen position; interceptors use a field towards where the player is heading.
 field(player){
  let nearest=Infinity;let target=null;
  for(const e of this.graph.edges)for(let s=0;s<=e.length;s+=Math.max(5,e.length/12)){
   const p=routePoint(e,s),d=distance(p,player);if(d<nearest&&vehicleFitsRoad(p,this.world)){nearest=d;target={edge:e,s};}
  }
  // Long harbour edges can be hundreds of metres: the coarse graph search
  // alone stops a patrol 10–15 m short of the actual car. Refine its stop point.
  if(target){const {edge,s:centre}=target,radius=Math.max(5,edge.length/12);for(let s=Math.max(0,centre-radius);s<=Math.min(edge.length,centre+radius);s+=.5){const p=routePoint(edge,s),d=distance(p,player);if(d<nearest&&vehicleFitsRoad(p,this.world)){nearest=d;target={edge,s};}}}
  const costs=Array(this.graph.nodes.length).fill(Infinity),field={target,costs};if(!target)return field;
  const {edge,s}=target,heap=[];costs[edge.from]=s;push(heap,[s,edge.from]);
  while(heap.length){const [cost,node]=pop(heap);if(cost!==costs[node])continue;
   for(const e of this.incoming[node]){if((this.blocked.get(e.id)||0)>this.time)continue;const next=cost+e.length;if(next<costs[e.from]){costs[e.from]=next;push(heap,[next,e.from]);}}
  }
  return field;
 }
 spawn(player,traffic){
  if(!this.target)return;
  const candidates=[],role=this.units.length%2?'intercept':'chase',surge=this.surging,[near,far]=surge?SURGE.spawn:[65,150];
  for(const edge of this.graph.edges){if(!Number.isFinite(this.costs[edge.to])&&edge!==this.target.edge)continue;
   const s=edge.length*.5,p=routePoint(edge,s),d=distance(p,player);
   if(d<near||d>far||(this.blocked.get(edge.id)||0)>this.time)continue;
   // Surge: score by driving distance to the player, not as the crow flies, so the unit really arrives in seconds.
   const route=edge===this.target.edge?Math.max(0,this.target.s-s):edge.length-s+this.costs[edge.to];
   if(!vehicleFitsRoad(p,this.world)||[...traffic,...this.units].some(a=>a.edge!==null&&distance(p,a)<12))continue;
   const ahead=-(p.x-player.x)*Math.sin(player.heading)-(p.z-player.z)*Math.cos(player.heading);
   // Chase cars arrive from behind; every second unit tries to head the player off.
   candidates.push({edge,s,...p,ahead,route,score:(surge?Math.min(route,far*2):d)+((ahead>0)!==(role==='intercept')?50:0)});
  }
  candidates.sort((a,b)=>a.score-b.score);if(!candidates.length)return;
  // Surge: among the nearest few by driving distance, prefer a spot the player
  // cannot see (behind them or behind a building) so the unit does not pop into view.
  if(surge){const few=candidates.slice(0,8);for(const c of few)if(c.ahead>0&&this.clearSight(c,player))c.score+=40;few.sort((a,b)=>a.score-b.score);candidates[0]=few[0];}
  this.units.push({...candidates[0],id:`police-${this.serial++}`,role,speed:0,stuck:0});
 }
 // Surge backup: one unit pulls up close to a stopped player, out of their
 // view, when the first wave has not reached arrest range (boxed in by traffic).
 backup(player,traffic){
  const [near,far]=SURGE.backupSpawn,candidates=[];
  for(const edge of this.graph.edges){
   if(edge.points.every(q=>Math.hypot(q[0]-player.x,q[1]-player.z)>far+edge.length))continue;
   for(let s=4;s<=edge.length-4;s+=6){
    const p=routePoint(edge,s),d=distance(p,player);if(d<near||d>far)continue;
    if(!vehicleFitsRoad(p,this.world)||[...traffic,...this.units].some(a=>a.edge!==null&&distance(p,a)<9))continue;
    const ahead=-(p.x-player.x)*Math.sin(player.heading)-(p.z-player.z)*Math.cos(player.heading),visible=ahead>-6&&this.clearSight(p,player);
    candidates.push({edge,s,...p,score:d+(visible?60:0)+(Number.isFinite(this.costs[edge.to])?0:10)});
   }
  }
  candidates.sort((a,b)=>a.score-b.score);if(!candidates.length)return false;
  this.units.push({...candidates[0],id:`police-${this.serial++}`,role:'chase',speed:0,stuck:0,backup:true});this.backupAt=this.time;return true;
 }
 next(edge,field=this){
  const {target,costs}=field;if(!costs)return undefined;
  let best,bestCost=Infinity;
  for(const e of this.graph.outgoing[edge.to]){
   if((this.blocked.get(e.id)||0)>this.time)continue;
   const cost=e===target?.edge?target.s:e.length+costs[e.to];
   if((e===target?.edge||Number.isFinite(costs[e.to]))&&cost<bestCost){best=e;bestCost=cost;}
  }
  return best;
 }
 // Interceptors only cut ahead of a player who is visibly driving away.
 fieldFor(unit){return unit.role==='intercept'&&this.intercept?.target?this.intercept:this;}
 clearSight(a,b){
  // At high wanted levels, platform furniture does not hide a car from units
  // in the adjacent lane. Real buildings still block the line of sight.
  const index=this.surging&&this.world.sightBuildings||this.world.buildings;
  const d=distance(a,b),n=Math.ceil(d/4);for(let i=1;i<n;i++)if(index.at(a.x+(b.x-a.x)*i/n,a.z+(b.z-a.z)*i/n))return false;return true;
 }
 canSee(unit,player){
  const d=distance(unit,player);if(d>(this.surging?SURGE.sight:145))return false;
  const forward=-(player.x-unit.x)*Math.sin(unit.heading)-(player.z-unit.z)*Math.cos(unit.heading);
  return (d<35||forward>d*.5||this.surging)&&this.clearSight(unit,player);
 }
 step(dt,player,traffic=[]){
  this.time+=dt;this.player=player;
  for(const [key,t]of this.contacts)if(this.time-t>10)this.contacts.delete(key);
  if(!this.heat||this.busted)return;
  this.seen=this.units.some(u=>this.canSee(u,player));
  if(!this.lastSeen||this.seen)this.lastSeen={x:player.x,z:player.z,heading:player.heading};
  if(this.level&&this.time>=this.repath){
   this.plan(this.lastSeen);this.repath=this.time+2;this.intercept=null;
   const lead=Math.min(70,Math.max(0,player.speed)*3.2);
   if(this.seen&&lead>25&&this.units.some(u=>u.role==='intercept')){
    this.predicted={x:player.x-Math.sin(player.heading)*lead,z:player.z-Math.cos(player.heading)*lead};
    this.intercept=this.field(this.predicted);
   }
  }
  const surge=this.surging,wanted=Math.max(surge?Math.max(this.level,SURGE.minUnits):this.level,this.level?this.minUnits:0),chasing=this.units.filter(u=>!u.parked).length;
  if(this.level&&chasing<wanted&&this.time>=this.dispatch){this.spawn(player,traffic);this.dispatch=this.time+(surge?SURGE.dispatch:Math.max(1.5,3.4-this.level*.4));}
  // Surge backup: the player has been stopped for a while and nobody is within arrest range yet.
  this.stopped=Math.abs(player.speed)<1?this.stopped+dt:0;
  if(surge&&this.stopped>=SURGE.backupAfter&&this.time-this.backupAt>8&&!this.units.some(u=>distance(u,player)<SURGE.arrestRange&&this.clearSight(u,player)))this.backup(player,traffic);
  const cruise=24+this.level*2.6+(surge?SURGE.cruise:0),accel=8+this.level*.6;
  for(const unit of this.units){
   if(unit.parked)continue;
   const field=this.fieldFor(unit);
   let desired=cornerSpeedLimit(unit.edge,unit.s,cruise,[this.next(unit.edge,field)]);
   const gap=distance(unit,player);if(gap<18)desired=Math.min(desired,Math.max(0,(gap-5)*1.6));
   // Surge: a unit that has a stopped player within arrest range creeps up to the car and makes the arrest, instead of driving on to the lane target and looping the block.
   if(surge&&gap<SURGE.arrestRange&&Math.abs(player.speed)<1&&this.clearSight(unit,player))desired=Math.min(desired,unit.backup?0:Math.max(0,(gap-10)*.6)); // a backup unit has pulled up: it holds there
   const obstacles=[player,...traffic,...this.units];
   for(const a of obstacles){if(a===unit||a.edge===null)continue;const dx=a.x-unit.x,dz=a.z-unit.z,forward=-dx*Math.sin(unit.heading)-dz*Math.cos(unit.heading),side=Math.abs(dx*Math.cos(unit.heading)-dz*Math.sin(unit.heading));if(forward>0&&forward<24&&side<2.3)desired=Math.min(desired,Math.max(0,(forward-6)*1.4));}
   const previousSpeed=unit.speed;
   unit.speed+=Math.max(-18*dt,Math.min(accel*dt,desired-unit.speed));
   unit.braking=unit.speed<previousSpeed-.01;
   let edge=unit.edge,s=unit.s+unit.speed*dt;
   if(edge===field.target?.edge&&unit.s<=field.target.s&&s>field.target.s)s=field.target.s;
   if(s>=edge.length){const next=this.next(edge,field);if(next){s-=edge.length;edge=next;}else{unit.speed=0;unit.stuck+=dt;continue;}}
   let p=routePoint(edge,s);
   // Emergency vehicles may pass a queue only where a full, swept car fits
   // the carriageway. Roundabouts retain their single directed centre line.
   if(!edge.roundabout&&obstacles.some(a=>a!==unit&&a.edge!==null&&trafficFootprintsOverlap(p,a))){
    for(const offset of [edge.lane+2.7,0]){const q=routePoint(edge,s,offset);if(safeVehicleSegment(unit,q,this.world)&&!obstacles.some(a=>a!==unit&&a.edge!==null&&trafficFootprintsOverlap(q,a))){p=q;break;}}
   }
   if(!safeVehicleSegment(unit,p,this.world)||obstacles.some(a=>a!==unit&&a.edge!==null&&trafficFootprintsOverlap(p,a))){
    unit.speed=0;unit.stuck+=dt;if(unit.stuck>2){this.blocked.set(edge.id,this.time+8);this.repath=0;}continue;
   }
   if(!unit.progressPoint||distance(p,unit.progressPoint)>.5){unit.stuck=0;unit.progressPoint={x:p.x,z:p.z};}else if(gap>14)unit.stuck+=dt;
   Object.assign(unit,p,{edge,s});
  }
  // Never teleport a visible stuck car. Retire units only well away from player.
  this.units=this.units.filter(u=>u.parked||distance(u,player)<450&&!(u.stuck>8&&distance(u,player)>85));
  this.seen=this.units.some(u=>this.canSee(u,player));
  this.escape=!this.seen?this.escape+dt:0;
  const canArrest=this.units.some(u=>distance(u,player)<(surge?SURGE.arrestRange:10)&&this.clearSight(u,player));
  this.bust=canArrest&&Math.abs(player.speed)<1?this.bust+dt:0;
  // Hands-on arrest: a unit at the car (any side, no line of sight needed) and a stopped or crawling player.
  const atCar=this.units.some(u=>distance(u,player)<CONTACT_BUST.range);
  this.contact=atCar&&Math.abs(player.speed)<CONTACT_BUST.speed?this.contact+dt:0;
  if(this.bust>=this.bustTime||this.contact>=CONTACT_BUST.time){this.busted=true;this.heat=0;this.bust=this.bustTime;this.escape=0;player.speed=0;for(const u of this.units)u.speed=0;this.message='Busted — pursuit ended.';}
  else if(this.escape>=escapeTime(this.level)*(surge?SURGE.escapeScale:1)*(this.relaxed?.5:1)){
   const was=this.level;this.heat=0;this.units=[...(this.parked||[])];this.lastSeen=null;this.intercept=null;
   this.recentIncidents=[];this.contacts.clear();this.recklessSeconds=0;this.recklessAt=-Infinity;this.surgeUntil=-Infinity;
   this.message=!was?null:was<=1?'The patrol gave up — wanted level cleared.':'Escaped — wanted level cleared.';
  }
 }
 snapshot(){return {level:this.level,heat:this.heat,busted:this.busted,seen:this.seen,surging:this.surging,status:this.busted?'BUSTED':!this.level?'CLEAR':this.bust?'STOPPED':this.escape>2?'SEARCHING':'PURSUIT',escapeSeconds:Math.max(0,Math.ceil(escapeTime(this.level)-this.escape)),bustProgress:Math.max(this.bust/this.bustTime,this.contact/CONTACT_BUST.time),bustSeconds:Math.ceil(Math.min(this.bustTime-this.bust,CONTACT_BUST.time-this.contact)),lastSeen:this.lastSeen?{...this.lastSeen}:null,units:this.units.map(({id,x,z,heading,speed,role})=>({id,x,z,heading,speed,role}))};}
}
