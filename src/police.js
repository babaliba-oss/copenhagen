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
// The escape clock only runs once the units have had a fair chance: a unit has seen the player during this pursuit, or the
// first unit has had time to drive to where the player was reported (its route at half cruise speed, plus `slack`, at most
// `max` s), or `fallback` s have passed without any unit being dispatched. Units spawn 65–150 m out, so a player who simply
// stopped used to be cleared before anyone arrived (Copenhagen halves escape times: 7.5 s at one star).
export const CONTACT={pace:.5,slack:4,max:25,fallback:30};
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
// Route field reach in metres of road (units are retired 450 m out; spawn and backup points are well inside).
export const ROUTE_REACH=1500;
export const SURGE={spawn:[60,110],dispatch:.7,minUnits:3,bustTime:2,arrestRange:40,sight:220,escapeScale:3,cruise:6,duration:40,backupAfter:2,backupSpawn:[26,42]};
export const BUST_TIME=4;
// Hands-on arrest, everywhere: a unit physically at the car (centre to centre
// within `range`, any side, even boxed in by traffic) with the player stopped
// or crawling below `speed` (world m/s; 8 km/h) makes the arrest after `time`
// seconds, instead of waiting out the ordinary or surge bust timers.
export const CONTACT_BUST={range:7,speed:8/3.6,time:1};
// On foot: a unit within `range` of a stopped player, in sight, that has got no closer (by 1 m) for `after` seconds stops
// and an officer walks over at `speed` m/s; the arrest range is then measured from the officer. Units could sit for good
// 20-70 m from a stopped player: wedged where the next step is too narrow for a car, boxed in by another unit, with no
// route onward, or circling a tiny loop near the target; they are only retired when stuck more than 85 m out.
export const ON_FOOT={range:80,after:5,speed:3.5};
// Closing speed between the player and another road user.
export function closingSpeed(a,b){
 const as=a.speed||0,bs=b.speed||0;
 return Math.hypot(-Math.sin(a.heading||0)*as+Math.sin(b.heading||0)*bs,-Math.cos(a.heading||0)*as+Math.cos(b.heading||0)*bs);
}

// Swept contacts, independent of render frame rate. Persistent contact is one
// incident, not one offence per physics tick. Only moving player impacts count.
import {sweptContact} from './contact-geometry.js';
export {sweptContact} from './contact-geometry.js';

// Tiny min-heap for shared reverse Dijkstra; one route field serves all units. Costs and nodes in typed arrays shared by
// every field (a [cost,node] pair per push was most of a field's garbage); the same comparisons, so the same order.
let heapF=new Float64Array(4096),heapN=new Int32Array(4096),heapSize=0;
function push(cost,node){if(heapSize===heapF.length){const F=new Float64Array(heapSize*2),N=new Int32Array(heapSize*2);F.set(heapF);N.set(heapN);heapF=F;heapN=N;}let i=heapSize++;while(i){const p=(i-1)>>1;if(heapF[p]<=cost)break;heapF[i]=heapF[p];heapN[i]=heapN[p];i=p;}heapF[i]=cost;heapN[i]=node;}
let popped=0; // pop() returns the cost; the node is left in popped
function pop(){const cost=heapF[0];popped=heapN[0];const n=--heapSize;if(n){const lf=heapF[n],ln=heapN[n];let i=0;while(i*2+1<n){let child=i*2+1;if(child+1<n&&heapF[child+1]<heapF[child])child++;if(heapF[child]>=lf)break;heapF[i]=heapF[child];heapN[i]=heapN[child];i=child;}heapF[i]=lf;heapN[i]=ln;}return cost;}

// Any of the obstacles listed (indices into the step's copies of their positions) overlapping p's footprint: only those
// within reach (trafficFootprintsOverlap's own first test, with 1.5 m to spare) are tested exactly.
let OX,OZ,OL,OBS;
const overlapsAny=(p,list)=>{const al=p.halfLength??2.36;for(let k=0;k<list.length;k++){const i=list[k],dx=OX[i]-p.x,dz=OZ[i]-p.z,r=al+OL[i]+2;if(dx*dx+dz*dz<r*r&&trafficFootprintsOverlap(p,OBS[i]))return true;}return false;};

export class PoliceSimulation{
 constructor(graph,world){
  this.graph=graph;this.world=world;this.incoming=Array.from({length:graph.nodes.length},()=>[]);
  graph.edges.forEach(e=>this.incoming[e.to].push(e));this.reset();
 }
 // Extension edges retain their IDs; wanted state and units are left intact.
 refreshGraph(){this.grid=null;
  this.incoming=Array.from({length:this.graph.nodes.length},()=>[]);
  for(const e of this.graph.edges)this.incoming[e.to].push(e);
  this.costs=[];this.target=null;this.intercept=null;this.predicted=null;this.repath=0;
 }
 reset(){this.time=0;this.heat=0;this.units=[];this.contacts=new Map();this.recentIncidents=[];this.recklessSeconds=0;this.recklessAt=-Infinity;this.blocked=new Map();this.escape=0;this.bust=0;this.contact=0;this.stopped=0;this.backupAt=-Infinity;this.grace=0;this.repath=0;this.dispatch=0;this.costs=[];this.target=null;this.message=null;this.serial=0;this.busted=false;this.lastSeen=null;this.seen=false;this.intercept=null;this.predicted=null;this.pressure=false;this.surgeUntil=-Infinity;this.minUnits=0;this.sighted=false;this.contactBy=0;this.contactPlanned=false;this.units=[...(this.parked||[])];}
 // A pursuit starting from no stars: nobody has seen the player yet and no unit is on its way (see CONTACT).
 startContact(){this.sighted=false;this.contactBy=this.time+CONTACT.fallback;this.contactPlanned=false;}
 get contactMade(){return this.sighted||this.time>=this.contactBy;}
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
  if(!this.level)this.startContact();
  this.heat=Math.max(this.heat,heatForLevel(level));this.grace=0;
  this.escape=0;this.standoff=0;this.lastSeen=null;this.repath=0;this.dispatch=this.time;this.surgeUntil=this.time+SURGE.duration;
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
  const before=this.level;if(!before)this.startContact();
  this.recentIncidents=this.recentIncidents.filter(t=>this.time-t<=INCIDENT_WINDOW);
  this.heat=Math.min(30,this.heat+add+Math.min(3,this.recentIncidents.length));
  this.recentIncidents.push(this.time);
  if(this.level>=4)this.surgeUntil=this.time+SURGE.duration;
  this.escape=0;this.standoff=0;this.lastSeen=null;this.repath=0;this.dispatch=Math.min(this.dispatch,this.time+.5);
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
 sampleGrid(){
  if(this.grid?.edges===this.graph.edges.length)return this.grid;
  // Built block by block as the search reaches it: each edge is filed under the 200 m blocks its points (plus 6 m for the
  // lane offset) cover, and the first time a 40 m cell is looked at, the edges filed under its block are sampled.
  // Sampling the whole city at once (~290k samples, an object and a fresh point each) took 120 ms and ~90 MB of garbage
  // in the frame the first unit was called. A cell's samples are kept in edge order, then along the edge, as before.
  const edges=this.graph.edges,byCell=new Map();
  edges.forEach((e,ei)=>{let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;for(const q of e.points){if(q[0]<x0)x0=q[0];if(q[0]>x1)x1=q[0];if(q[1]<z0)z0=q[1];if(q[1]>z1)z1=q[1];}
   for(let i=Math.floor((x0-6)/200);i<=Math.floor((x1+6)/200);i++)for(let j=Math.floor((z0-6)/200);j<=Math.floor((z1+6)/200);j++){const k=i*100003+j;let a=byCell.get(k);if(!a)byCell.set(k,a=[]);a.push(ei);}});
  this.grid={edges:edges.length,byCell,cells:new Map(),complete:new Set(),blocks:new Set(),sampled:new Uint8Array(edges.length),X:[],Z:[],H:[],S:[],E:[],K:[],p:{x:0,z:0,heading:0}};return this.grid;
 }
 gridCell(grid,i,j){const k=i*100003+j;
  if(grid.complete.has(k))return grid.cells.get(k);grid.complete.add(k);
  const {X,Z,H,S,E,K,p,cells,sampled}=grid,edges=this.graph.edges,b=Math.floor(i/5)*100003+Math.floor(j/5);
  if(!grid.blocks.has(b)){grid.blocks.add(b);for(const ei of grid.byCell.get(b)||[]){if(sampled[ei])continue;sampled[ei]=1;const e=edges[ei];
   for(let s=0,j=0;s<=e.length;s+=Math.max(5,e.length/12),j++){routePoint(e,s,e.lane,undefined,undefined,p);const n=X.length;X.push(p.x);Z.push(p.z);H.push(p.heading);S.push(s);E.push(ei);K.push(ei*16+j);
    const c=Math.floor(p.x/40)*100003+Math.floor(p.z/40);let a=cells.get(c);if(!a)cells.set(c,a=[]);a.push(n);}}}
  const a=cells.get(k);if(a)a.sort((u,v)=>K[u]-K[v]);return a;
 }
 plan(player){const f=this.field(player);this.target=f.target;this.costs=f.costs;}
 // One reverse-Dijkstra route field towards a point. Chase units use the last
 // seen position; interceptors use a field towards where the player is heading.
 field(player){
  let nearest=Infinity;let target=null;
  // Sample points sit in a 40 m grid (built once): search rings outwards instead of every edge in the city (44k edges in Copenhagen took ~90 ms, twice every 2 s at high wanted levels).
  const grid=this.sampleGrid(),{X,Z,H,S,E}=grid,c=this.samplePoint||={x:0,z:0,heading:0},gx=Math.floor(player.x/40),gz=Math.floor(player.z/40);
  for(let r=0;r<=40&&(r-1)*40<nearest;r++)for(let i=gx-r;i<=gx+r;i++)for(let j=gz-r;j<=gz+r;j++){if(Math.max(Math.abs(i-gx),Math.abs(j-gz))!==r)continue;
   const cell=this.gridCell(grid,i,j);if(cell)for(const k of cell){const d=Math.hypot(X[k]-player.x,Z[k]-player.z);if(d<nearest){c.x=X[k];c.z=Z[k];c.heading=H[k];if(vehicleFitsRoad(c,this.world)){nearest=d;target={edge:this.graph.edges[E[k]],s:S[k]};}}}
  }
  // Long harbour edges can be hundreds of metres: the coarse graph search
  // alone stops a patrol 10–15 m short of the actual car. Refine its stop point.
  if(target){const {edge,s:centre}=target,radius=Math.max(5,edge.length/12);for(let s=Math.max(0,centre-radius);s<=Math.min(edge.length,centre+radius);s+=.5){const p=routePoint(edge,s,edge.lane,undefined,undefined,c),d=distance(p,player);if(d<nearest&&vehicleFitsRoad(p,this.world)){nearest=d;target={edge,s};}}}
  const costs=new Float64Array(this.graph.nodes.length).fill(Infinity),field={target,costs};if(!target)return field;
  const {edge,s}=target;costs[edge.from]=s;heapSize=0;push(s,edge.from);
  while(heapSize){const cost=pop(),node=popped;if(cost!==costs[node])continue;if(cost>ROUTE_REACH)break; /* units live within 450 m of the player: the rest of the city is never driven */
   for(const e of this.incoming[node]){if((this.blocked.get(e.id)||0)>this.time)continue;const next=cost+e.length;if(next<costs[e.from]){costs[e.from]=next;push(next,e.from);}}
  }
  return field;
 }
 spawn(player,traffic){
  if(!this.target)return;
  const candidates=[],role=this.units.length%2?'intercept':'chase',surge=this.surging,[near,far]=surge?SURGE.spawn:[65,150];
  for(const edge of this.graph.edges){if(!Number.isFinite(this.costs[edge.to])&&edge!==this.target.edge)continue;
   const s=edge.length*.5,p=routePoint(edge,s,edge.lane,undefined,undefined,this.spawnPoint||={x:0,z:0,heading:0}),d=distance(p,player); /* copied into the candidate below */
   if(d<near||d>far||(this.blocked.get(edge.id)||0)>this.time)continue;
   // Surge: score by driving distance to the player, not as the crow flies, so the unit really arrives in seconds.
   const route=edge===this.target.edge?Math.max(0,this.target.s-s):edge.length-s+this.costs[edge.to];
   if(!vehicleFitsRoad(p,this.world)||traffic.some(a=>a.edge!==null&&distance(p,a)<12)||this.units.some(a=>a.edge!==null&&distance(p,a)<12))continue;
   const ahead=-(p.x-player.x)*Math.sin(player.heading)-(p.z-player.z)*Math.cos(player.heading);
   // Chase cars arrive from behind; every second unit tries to head the player off.
   candidates.push({edge,s,...p,ahead,route,score:(surge?Math.min(route,far*2):d)+((ahead>0)!==(role==='intercept')?50:0)});
  }
  candidates.sort((a,b)=>a.score-b.score);if(!candidates.length)return;
  // Surge: among the nearest few by driving distance, prefer a spot the player
  // cannot see (behind them or behind a building) so the unit does not pop into view.
  // Every level now (an interceptor used to appear 65-150 m up the street the player was looking down): a spot in plain
  // sight ahead loses to any hidden one among the few best.
  {const few=candidates.slice(0,8);for(const c of few)if(c.ahead>0&&this.clearSight(c,player))c.score+=surge?40:200;few.sort((a,b)=>a.score-b.score);candidates[0]=few[0];}
  this.units.push(this.newUnit(candidates[0],role,false));
  if(!this.contactPlanned&&!this.sighted){this.contactPlanned=true;this.contactBy=this.time+Math.min(CONTACT.max,candidates[0].route/((24+this.level*2.6)*CONTACT.pace)+CONTACT.slack);} // the first unit's fair chance to arrive
 }
 // Every unit with the same fields in the same order (the spawn and backup candidates were spread in, with braking and
 // progressPoint added later): step() saw several unit shapes and kept being thrown out of its optimised code ('wrong map').
 newUnit(c,role,backup){return {edge:c.edge,s:c.s,x:c.x,z:c.z,heading:c.heading,ahead:c.ahead??0,route:c.route??0,score:c.score,id:`police-${this.serial++}`,role,speed:0,stuck:0,braking:false,progressPoint:null,backup,closest:Infinity,idle:0,foot:0};}
 // Surge backup: one unit pulls up close to a stopped player, out of their
 // view, when the first wave has not reached arrest range (boxed in by traffic).
 backup(player,traffic){
  const [near,far]=SURGE.backupSpawn,candidates=[];
  for(const edge of this.graph.edges){
   if(edge.points.every(q=>Math.hypot(q[0]-player.x,q[1]-player.z)>far+edge.length))continue;
   for(let s=4;s<=edge.length-4;s+=6){
    const p=routePoint(edge,s,edge.lane,undefined,undefined,this.spawnPoint||={x:0,z:0,heading:0}),d=distance(p,player);if(d<near||d>far)continue;
    if(!vehicleFitsRoad(p,this.world)||traffic.some(a=>a.edge!==null&&distance(p,a)<9)||this.units.some(a=>a.edge!==null&&distance(p,a)<9))continue;
    const ahead=-(p.x-player.x)*Math.sin(player.heading)-(p.z-player.z)*Math.cos(player.heading),visible=ahead>-6&&this.clearSight(p,player);
    candidates.push({edge,s,...p,score:d+(visible?60:0)+(Number.isFinite(this.costs[edge.to])?0:10)});
   }
  }
  candidates.sort((a,b)=>a.score-b.score);if(!candidates.length)return false;
  this.units.push(this.newUnit(candidates[0],'chase',true));this.backupAt=this.time;return true;
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
  const obstacles=this.obstacleList||=[];obstacles.length=0;obstacles.push(player);for(const a of traffic)obstacles.push(a);for(const a of this.units)obstacles.push(a); // one list per step (was a ~400-item spread per unit per frame)
  // Where each obstacle is, read once a step into typed arrays: each unit's tests below then run over the few within reach
  // (26 m ahead; a footprint overlap at most 2.36 + their half length + 0.5 m from a point within 6.5 m of the unit: lane
  // or kerb-side offset and a step's travel) instead of all ~400 cars and walkers three or four times. Reading x, z and half
  // length from so many kinds of object boxed a fresh number on every read (~110 KB a frame at 3 stars).
  const n=obstacles.length;if(!this.obsX||this.obsX.length<n){this.obsX=new Float64Array(n*2);this.obsZ=new Float64Array(n*2);this.obsL=new Float64Array(n*2);this.obsR=new Float64Array(n*2);}
  OX=this.obsX;OZ=this.obsZ;OL=this.obsL;OBS=obstacles;const OR=this.obsR,near=this.nearList||=[],P=this.stepPoint||={x:0,z:0,heading:0},Q=this.offsetPoint||={x:0,z:0,heading:0};
  for(let i=0;i<n;i++){const a=obstacles[i];if(a.edge===null){OX[i]=NaN;continue;}OX[i]=a.x;OZ[i]=a.z;const l=OL[i]=a.halfLength??2.36,r=Math.max(27.5,l+17);OR[i]=r*r;}
  for(let j=0,base=n-this.units.length;j<this.units.length;j++){const unit=this.units[j],self=base+j; // self: the unit's own slot, kept up to date as it moves
   if(unit.parked)continue;
   near.length=0;{const ux=unit.x,uz=unit.z;for(let i=0;i<n;i++){const dx=OX[i]-ux,dz=OZ[i]-uz;if(dx*dx+dz*dz<OR[i]&&obstacles[i]!==unit)near.push(i);}}
   const field=this.fieldFor(unit);
   let desired=cornerSpeedLimit(unit.edge,unit.s,cruise,[this.next(unit.edge,field)]);
   const gap=distance(unit,player);if(gap<18)desired=Math.min(desired,Math.max(0,(gap-5)*1.6));if(unit.foot>0)desired=0; // the officer is out on foot: the car waits
   // Surge: a unit that has a stopped player within arrest range creeps up to the car and makes the arrest, instead of driving on to the lane target and looping the block.
   if(surge&&gap<SURGE.arrestRange&&Math.abs(player.speed)<1&&this.clearSight(unit,player))desired=Math.min(desired,unit.backup?0:Math.max(0,(gap-10)*.6)); // a backup unit has pulled up: it holds there
   const sh=Math.sin(unit.heading),ch=Math.cos(unit.heading);
   for(let k=0;k<near.length;k++){const a=obstacles[near[k]],dx=a.x-unit.x,dz=a.z-unit.z;if(dx*dx+dz*dz>676)continue;const forward=-dx*sh-dz*ch,side=Math.abs(dx*ch-dz*sh);if(forward>0&&forward<24&&side<2.3)desired=Math.min(desired,Math.max(0,(forward-6)*1.4));}
   const previousSpeed=unit.speed;
   unit.speed+=Math.max(-18*dt,Math.min(accel*dt,desired-unit.speed));
   unit.braking=unit.speed<previousSpeed-.01;
   let edge=unit.edge,s=unit.s+unit.speed*dt;
   if(edge===field.target?.edge&&unit.s<=field.target.s&&s>field.target.s)s=field.target.s;
   if(s>=edge.length){const next=this.next(edge,field);if(next){s-=edge.length;edge=next;}else{unit.speed=0;unit.stuck+=dt;continue;}}
   let p=routePoint(edge,s,edge.lane,undefined,undefined,P);
   // Emergency vehicles may pass a queue only where a full, swept car fits
   // the carriageway. Roundabouts retain their single directed centre line.
   if(!edge.roundabout&&overlapsAny(p,near)){
    for(let o=0;o<2;o++){const q=routePoint(edge,s,o?0:edge.lane+2.7,undefined,undefined,Q);if(safeVehicleSegment(unit,q,this.world)&&!overlapsAny(q,near)){p=q;break;}}
   }
   if(!safeVehicleSegment(unit,p,this.world)||overlapsAny(p,near)){
    unit.speed=0;unit.stuck+=dt;if(unit.stuck>2&&!((this.blocked.get(edge.id)||0)>this.time)){this.blocked.set(edge.id,this.time+8);this.repath=Math.min(this.repath,this.time+.5);} /* once per blocked edge: this used to re-plan every frame while a unit sat stuck */continue;
   }
   if(!unit.progressPoint||distance(p,unit.progressPoint)>.5){unit.stuck=0;if(unit.progressPoint){unit.progressPoint.x=p.x;unit.progressPoint.z=p.z;}else unit.progressPoint={x:p.x,z:p.z};}else if(gap>14)unit.stuck+=dt;
   unit.x=p.x;unit.z=p.z;unit.heading=p.heading;unit.edge=edge;unit.s=s;OX[self]=p.x;OZ[self]=p.z;
  }
  // Never teleport a visible stuck car. Retire units only well away from player.
  this.units=this.units.filter(u=>u.parked||distance(u,player)<450&&!(u.stuck>8&&distance(u,player)>85));
  this.seen=this.units.some(u=>this.canSee(u,player));if(this.seen)this.sighted=true;
  const halted=Math.abs(player.speed)<1,arrestRange=surge?SURGE.arrestRange:10;
  for(const u of this.units){if(u.parked)continue;const d=distance(u,player); /* ON_FOOT: a unit that cannot get any closer to a stopped player sends an officer on foot */
   if(!halted||d>ON_FOOT.range){u.closest=Infinity;u.idle=u.foot=0;continue;}
   if(d<u.closest-1){u.closest=d;u.idle=0;}else if((u.idle+=dt)>ON_FOOT.after&&d-u.foot>=arrestRange&&this.clearSight(u,player)){if(!u.foot)this.message='An officer gets out and walks over.';u.foot=Math.min(d,u.foot+ON_FOOT.speed*dt);}
  }
  const canArrest=this.units.some(u=>distance(u,player)-(u.foot||0)<arrestRange&&this.clearSight(u,player));
  // Stand-off: the player is off any road the units can drive (a plaza, Strøget) and they can only watch from the kerb.
  // After 10 s of that the escape clock runs as if unseen (the wanted level used to stay frozen for good).
  this.standoff=this.seen&&!canArrest&&!this.world.roads?.at?.(player.x,player.z)&&this.units.every(u=>Math.abs(u.speed||0)<.5)?(this.standoff||0)+dt:0;
  this.escape=(!this.seen||this.standoff>10)&&this.contactMade?this.escape+dt:0; // no escape before the units have had a fair chance (CONTACT)
  this.bust=canArrest&&Math.abs(player.speed)<1?this.bust+dt:0;
  // Hands-on arrest: a unit at the car (any side, no line of sight needed) and a stopped or crawling player.
  const atCar=this.units.some(u=>distance(u,player)<CONTACT_BUST.range);
  const still=player.walking?.5:CONTACT_BUST.speed,handsOn=atCar&&Math.abs(player.speed)<still&&(!player.walking||this.units.some(u=>distance(u,player)<CONTACT_BUST.range&&this.clearSight(u,player)));
  this.contact=handsOn?this.contact+dt:0; // on foot: only stopped and in sight (walking pace is 2.2 m/s, under the car's 'crawling', and it worked through walls)
  if(this.bust>=this.bustTime||this.contact>=CONTACT_BUST.time){this.busted=true;this.heat=0;this.bust=this.bustTime;this.escape=0;player.speed=0;for(const u of this.units)u.speed=0;this.message='Busted — pursuit ended.';}
  else if(this.escape>=escapeTime(this.level)*(surge?SURGE.escapeScale:1)*(this.relaxed?.5:1)){
   const was=this.level;this.heat=0;this.units=[...(this.parked||[])];this.lastSeen=null;this.intercept=null;
   this.recentIncidents=[];this.contacts.clear();this.recklessSeconds=0;this.recklessAt=-Infinity;this.surgeUntil=-Infinity;
   this.message=!was?null:was<=1?'The patrol gave up — wanted level cleared.':'Escaped — wanted level cleared.';
  }
 }
 snapshot(){return {level:this.level,heat:this.heat,busted:this.busted,seen:this.seen,surging:this.surging,status:this.busted?'BUSTED':!this.level?'CLEAR':this.bust?'STOPPED':this.escape>2?'SEARCHING':'PURSUIT',escapeSeconds:Math.max(0,Math.ceil(escapeTime(this.level)-this.escape)),bustProgress:Math.max(this.bust/this.bustTime,this.contact/CONTACT_BUST.time),bustSeconds:Math.ceil(Math.min(this.bustTime-this.bust,CONTACT_BUST.time-this.contact)),lastSeen:this.lastSeen?{...this.lastSeen}:null,units:this.units.map(({id,x,z,heading,speed,role})=>({id,x,z,heading,speed,role}))};}
}
