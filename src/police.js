import {routePoint} from './mobility.js';
import {safeVehicleSegment,vehicleFitsRoad,trafficFootprintsOverlap} from './road-safety.js';
import {cornerSpeedLimit} from './traffic-driving.js';
import {inWaterPolygons} from './geo.js';

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
// Units whose route is longer than that follow a field of up to FAR_REACH m (every spot within 450 m of the player is
// within 6 km by road in today's Copenhagen), searched only as far as the unit needing it (farField).
export const FAR_REACH=6000,FAR_EVERY=5;
export const SURGE={spawn:[60,110],dispatch:.7,minUnits:3,bustTime:2,arrestRange:40,sight:220,escapeScale:3,cruise:6,duration:40,backupAfter:2,backupSpawn:[26,42]};
export const BUST_TIME=4;
// Hands-on arrest, everywhere: a unit physically at the car (centre to centre
// within `range`, any side, even boxed in by traffic) with the player stopped
// or crawling below `speed` (world m/s; 8 km/h) makes the arrest after `time`
// seconds, instead of waiting out the ordinary or surge bust timers.
export const CONTACT_BUST={range:7,speed:8/3.6,time:1};
// On foot: a unit within `range` of a stopped player, in sight, that has got no closer (by 1 m) for `after` seconds stops
// and its officer goes over on foot (as FOOT_CHASE, below; never over water or through a house); the arrest range is then
// also measured from the officer. Units could sit for good 20-70 m from a stopped player: wedged where the next step is too
// narrow for a car, boxed in by another unit, with no route onward, or circling a tiny loop near the target; they are only
// retired when stuck more than 85 m out.
export const ON_FOOT={range:80,after:5};
// Foot chase (today's Copenhagen: setWalks; 1760 has no police). A player on foot, or in a vehicle stopped or crawling
// (under `slow` m/s), off the road network (Strøget, Købmagergade by Rundetårn, the squares) was a hiding spot: units
// could only watch from the kerb and the stand-off let the escape clock run. Now a unit within `range` that has parked
// (got no closer for `after` s) sends its officer, at most `max` out at once, and the officer follows the player along the
// footway network at `run` m/s (the player runs at 4.8, walks at 2: running gets away, walking does not), towards where
// they were last seen when out of sight. Routes are planned on the footways once a `repath` s, or when the target has
// moved `moved` m; a short clear stretch (under `direct` m) is walked straight, and the graph is joined within `link` m by
// a clear, dry line. The officer sees the player within `sight` m (a clear line), arrests from the usual arrest range, or
// takes hold within `grab` m of someone on foot slower than `pace` (walking), and walks back to the car at `back` m/s
// (gone at once when out of the player's view) once the player drives off on a road, or strays `leash` m from the car.
export const FOOT_CHASE={run:4.4,back:3.5,slow:3,range:120,after:1.5,max:2,repath:1,moved:8,direct:40,link:30,sight:90,grab:1.6,pace:2.5,expand:6000,leash:300,door:1.3,apart:.9};
const FOOT_CELL=20;
// A unit parked with its officer out where no car gets past it (on neither passing offset a unit takes, its lane + 2.7 m or
// the centre line, is there road clear of it), on a street other than the one the chase target is on: the other units'
// routes count that street PARKED_DETOUR m longer while the officer is out, and no unit is sent out onto it or onto the
// street before it. A unit sent down it came up behind the parked one, could not pass and had no officer of its own to
// send (FOOT_CHASE.max): it stood there 16-52 s, to the end of the chase. (Not closed outright: a street with no way round
// is still driven, and on the target's own street the only way to the target is past it.)
const PARKED_DETOUR=300;
function narrowAt(u,world){const e=u.edge,P={x:0,z:0,heading:0};for(const o of [e.lane+2.7,0]){if(Math.abs(o-e.lane)<2.1)continue;routePoint(e,u.s,o,undefined,undefined,P);if(vehicleFitsRoad(P,world))return false;}return true;}
// Officer positions are kept on the unit (unit.officer): {x,z,heading,speed,back,path,k,...}; the renderer draws them there.
const newOfficer=(x,z,heading)=>({x,z,heading,speed:0,back:false,path:null,k:0,plan:0,gx:NaN,gz:NaN});
const doorPoint=u=>{const s=Math.sin(u.heading||0),c=Math.cos(u.heading||0);return {x:u.x-c*FOOT_CHASE.door,z:u.z+s*FOOT_CHASE.door};};
// Points along footway edge e from s0 to s1 (either way), both ends included, pushed onto `out` as x, z pairs.
function edgeStretch(e,s0,s1,out){
 const P=e.points,cum=[0];for(let i=1;i<P.length;i++)cum.push(cum[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));
 const at=s=>{s=Math.max(0,Math.min(cum.at(-1),s));let i=1;while(i<P.length-1&&cum[i]<s)i++;const l=cum[i]-cum[i-1]||1,t=(s-cum[i-1])/l;out.push(P[i-1][0]+(P[i][0]-P[i-1][0])*t,P[i-1][1]+(P[i][1]-P[i-1][1])*t);};
 at(s0);if(s1>s0){for(let i=1;i<P.length-1;i++)if(cum[i]>s0&&cum[i]<s1)out.push(P[i][0],P[i][1]);}else for(let i=P.length-2;i>0;i--)if(cum[i]<s0&&cum[i]>s1)out.push(P[i][0],P[i][1]);at(s1);
}
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
// A move from `from` to p that overlaps nothing new and deepens no overlap `from` already has (sweptContact): backing or
// creeping out of a car that drove into the unit.
const separates=(from,p,list)=>{const al=p.halfLength??2.36;for(let k=0;k<list.length;k++){const i=list[k],dx=OX[i]-p.x,dz=OZ[i]-p.z,r=al+OL[i]+2;if(dx*dx+dz*dz<r*r&&trafficFootprintsOverlap(p,OBS[i])&&sweptContact(from,p,OBS[i]))return false;}return true;};
const SEPARATE_SPEED=2; // m/s, forwards or back along its lane
const OFFSET_AHEAD=6; // m a passing offset must stay on the road ahead (offsetHolds)
// A stuck unit's step on a bend whose car corner clips the kerb (safeVehicleSegment refuses it, 3 m on is fine: it stood
// there 30-45 s, holding the cars behind it). As traffic's kerbCorner (mobility.js): taken where the centre stays on the
// carriageway (not a traffic island), the body's sides are at most 0.5 m over the kerb (KERB_INSET, 0.48 m out from its
// centre line, on the road: a unit standing on such a bend already showed that much), and the drawn body (0.98 x 2.36 m, corners and mid sides), swept over the step
// at most 0.5 m apart, meets no building or street obstacle and no water (unless a road or paving covers it).
const KERB_BODY=[.98,2.36,-.98,2.36,.98,-2.36,-.98,-2.36,.98,0,-.98,0,0,2.36,0,-2.36],KERB_INSET=[.48,2.36,-.48,2.36,.48,-2.36,-.48,-2.36,.48,0,-.48,0,0,1.86,0,-1.86];
export function kerbStep(a,b,world){
 if(!world.roads.at(b.x,b.z)||world.trafficForbidden?.at(b.x,b.z))return false;
 {const s=Math.sin(b.heading),c=Math.cos(b.heading);for(let k=0;k<KERB_INSET.length;k+=2){const lx=KERB_INSET[k],lz=KERB_INSET[k+1];if(!world.roads.at(b.x+lx*c+lz*s,b.z-lx*s+lz*c))return false;}}
 const B=world.buildings,W=world.water,turn=Math.atan2(Math.sin(b.heading-a.heading),Math.cos(b.heading-a.heading)),n=Math.max(1,Math.ceil(distance(a,b)/.5),Math.ceil(Math.abs(turn)/.15));
 for(let i=1;i<=n;i++){const t=i/n,x0=a.x+(b.x-a.x)*t,z0=a.z+(b.z-a.z)*t,h=a.heading+turn*t,s=Math.sin(h),c=Math.cos(h);
  for(let k=0;k<KERB_BODY.length;k+=2){const lx=KERB_BODY[k],lz=KERB_BODY[k+1],x=x0+lx*c+lz*s,z=z0-lx*s+lz*c;if(B.at(x,z)||W?.length&&!world.roads.at(x,z)&&!world.pavement?.at(x,z)&&inWaterPolygons(W,x,z))return false;}}
 return true;
}
// Junction boxes as traffic keeps them (lane-model.js stopGap/startGap): 1 for a unit still in the box at the start of its
// edge, -1 past the stop line at its end, 0 clear of both. A unit standing in one (its officer out on foot, held beside a
// stopped player, or behind a queue past the junction) held the cars behind it and those crossing 34-45 s: every way past
// it turned across its nose.
const boxAt=(g,e,s)=>e.startGap&&s<e.startGap&&g.junctionNode?.[e.from]?1:s>stopLine(e)+.05?-1:0;
const stopLine=e=>e.junction&&e.stopGap&&!e.inside?e.length-e.stopGap-.5:Infinity; // where a unit's centre stops short of the box at the end of its edge

export class PoliceSimulation{
 constructor(graph,world){
  this.graph=graph;this.world=world;this.incoming=Array.from({length:graph.nodes.length},()=>[]);
  graph.edges.forEach(e=>this.incoming[e.to].push(e));this.reset();this.sampleGrid(); /* while the map loads: the first call took 25-40 ms in the frame the first unit was called */
 }
 // Extension edges retain their IDs; wanted state and units are left intact.
 refreshGraph(){this.grid=null;
  this.incoming=Array.from({length:this.graph.nodes.length},()=>[]);
  for(const e of this.graph.edges)this.incoming[e.to].push(e);
  this.costs=[];this.target=null;this.far=null;this.intercept=null;this.predicted=null;this.repath=0;
 }
 reset(){this.time=0;this.heat=0;this.units=[];this.contacts=new Map();this.recentIncidents=[];this.recklessSeconds=0;this.recklessAt=-Infinity;this.blocked=new Map();this.parkedOn=new Map();this.escape=0;this.bust=0;this.contact=0;this.stopped=0;this.backupAt=-Infinity;this.grace=0;this.repath=0;this.dispatch=0;this.costs=[];this.target=null;this.far=null;this.farAt=0;this.message=null;this.serial=0;this.busted=false;this.lastSeen=null;this.seen=false;this.intercept=null;this.predicted=null;this.pressure=false;this.surgeUntil=-Infinity;this.minUnits=0;this.sighted=false;this.contactBy=0;this.contactPlanned=false;this.footBy=0;this.units=[...(this.parked||[])];}
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
  return this.search(target,ROUTE_REACH); /* units live within 450 m of the player: the rest of the city is never driven */
 }
 search(target,reach,goal=-1){
  const costs=new Float64Array(this.graph.nodes.length).fill(Infinity),field={target,costs};if(!target)return field;
  const {edge,s}=target;costs[edge.from]=s;heapSize=0;
  if(goal<0){push(s,edge.from);
   while(heapSize){const cost=pop(),node=popped;if(cost!==costs[node])continue;if(cost>reach)break;
    for(const e of this.incoming[node]){if((this.blocked.get(e.id)||0)>this.time)continue;const next=cost+e.length+((this.parkedOn.get(e.id)||0)>this.time?PARKED_DETOUR:0);if(next<costs[e.from]){costs[e.from]=next;push(next,e.from);}}
   }
   return field;
  }
  // Towards one goal (farField): A*, ordered by cost plus the straight distance on to the goal (never more than the road:
  // consistent), so the search heads for the unit instead of filling every street within its route's length (up to ~20 ms
  // for a goal across the harbour). Every cost it sets is the length of a real route to the target, and those on the
  // goal's best route are exact, so a unit following the field still drives down its shortest route.
  const N=this.graph.nodes,[gx,gz]=N[goal],h=v=>Math.hypot(N[v][0]-gx,N[v][1]-gz);push(s+h(edge.from),edge.from);
  while(heapSize){const f=pop(),node=popped,cost=costs[node];if(f!==cost+h(node))continue;if(node===goal)break;
   for(const e of this.incoming[node]){if((this.blocked.get(e.id)||0)>this.time)continue;const next=cost+e.length+((this.parkedOn.get(e.id)||0)>this.time?PARKED_DETOUR:0);if(next<=reach&&next<costs[e.from]){costs[e.from]=next;push(next+h(e.from),e.from);}}
  }
  return field;
 }
 // A unit whose road route to the target is longer than ROUTE_REACH (the harbour, a canal, a one-way maze or an edge blocked
 // by a stuck unit between it and a player 85-450 m away) found no next edge and stood still until it was retired (3.5% of
 // the road spots a unit can stand on 85-450 m from a player in today's Copenhagen). It follows a coarse field instead: the
 // same search from the chase target, out to the unit (FAR_REACH at most), run again for a unit no field covers, and all
 // dropped when FAR_EVERY s old (it lags the target by up to that; the unit takes the ordinary field once back within reach).
 farField(unit){const goal=unit.edge.to;if(!this.far||this.time>=this.farAt){this.far=new Map();this.farAt=this.time+FAR_EVERY;}let f=this.far.get(goal);if(!f){for(const g of this.far.values())if(Number.isFinite(g.costs[goal])){f=g;break;}if(!f)this.far.set(goal,f=this.search(this.target,FAR_REACH,goal));}return f;} // far: the fields searched since the last fresh run, by goal (each search heads for its own unit: one replacing another left the first without a route); a goal with no route at all is searched once per run, not every frame
 // The edges filed under the 200 m blocks (sampleGrid) within r of a point, in graph order: the only ones that can have a
 // spot within r - 6 m of it (spawn and backup went through all 44k edges in today's Copenhagen: 2-40 ms a call).
 nearEdges(x,z,r){
  const {byCell}=this.sampleGrid(),seen=new Set();
  for(let i=Math.floor((x-r)/200);i<=Math.floor((x+r)/200);i++)for(let j=Math.floor((z-r)/200);j<=Math.floor((z+r)/200);j++)for(const k of byCell.get(i*100003+j)||[])seen.add(k);
  return [...seen].sort((a,b)=>a-b);
 }
 spawn(player,traffic){
  if(!this.target)return;
  const candidates=[],role=this.units.length%2?'intercept':'chase',surge=this.surging,[near,far]=surge?SURGE.spawn:[65,150];
  traffic=traffic.filter(a=>a.edge!==null&&distance(a,player)<far+12); // only these can be within 12 m of a spot (was every car and walker for every spot)
  for(const k of this.nearEdges(player.x,player.z,far+12)){const edge=this.graph.edges[k];if(!Number.isFinite(this.costs[edge.to])&&edge!==this.target.edge||edge.inside)continue; /* not inside a signal cluster (all junction box): one that appeared there stood in it behind a car at the red light out, and held the cars behind it 15 s */
   const s=edge.length*.5,p=routePoint(edge,s,edge.lane,undefined,undefined,this.spawnPoint||={x:0,z:0,heading:0}),d=distance(p,player); /* copied into the candidate below */
   if(d<near||d>far||(this.blocked.get(edge.id)||0)>this.time||this.parkedOn.size&&[edge,this.next(edge)].some(e=>e&&(this.parkedOn.get(e.id)||0)>this.time))continue; /* not on, nor just before, a street a parked unit closes (PARKED_DETOUR) */
   // Surge: score by driving distance to the player, not as the crow flies, so the unit really arrives in seconds.
   const route=edge===this.target.edge?Math.max(0,this.target.s-s):edge.length-s+this.costs[edge.to];
   if(!vehicleFitsRoad(p,this.world)||traffic.some(a=>distance(p,a)<12)||this.units.some(a=>a.edge!==null&&distance(p,a)<12))continue;
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
  if(!this.contactPlanned&&!this.sighted){this.contactPlanned=true;const kerb=this.walks&&!this.world.roads?.at?.(player.x,player.z)?FOOT_CHASE.after+distance(routePoint(this.target.edge,this.target.s,this.target.edge.lane),player)*1.4/FOOT_CHASE.run:0;this.contactBy=this.time+Math.min(CONTACT.max,candidates[0].route/((24+this.level*2.6)*CONTACT.pace)+CONTACT.slack)+kerb;} // the first unit's fair chance to arrive (off the roads, and for its officer to get from the kerb on foot)
 }
 // Every unit with the same fields in the same order (the spawn and backup candidates were spread in, with braking and
 // progressPoint added later): step() saw several unit shapes and kept being thrown out of its optimised code ('wrong map').
 newUnit(c,role,backup){return {edge:c.edge,s:c.s,x:c.x,z:c.z,heading:c.heading,ahead:c.ahead??0,route:c.route??0,score:c.score,id:`police-${this.serial++}`,role,speed:0,stuck:0,braking:false,progressPoint:null,backup,closest:Infinity,idle:0,officer:null,footTry:0,pull:false,yieldUntil:0,narrow:false,roundUntil:0};}
 // Surge backup: one unit pulls up close to a stopped player, out of their
 // view, when the first wave has not reached arrest range (boxed in by traffic).
 backup(player,traffic){
  const [near,far]=SURGE.backupSpawn,candidates=[];
  traffic=traffic.filter(a=>a.edge!==null&&distance(a,player)<far+9);
  for(const k of this.nearEdges(player.x,player.z,far+12)){const edge=this.graph.edges[k];if(edge.inside)continue;
   if(edge.points.every(q=>Math.hypot(q[0]-player.x,q[1]-player.z)>far+edge.length))continue;
   for(let s=4;s<=edge.length-4;s+=6){
    const p=routePoint(edge,s,edge.lane,undefined,undefined,this.spawnPoint||={x:0,z:0,heading:0}),d=distance(p,player);if(d<near||d>far)continue;
    if(!vehicleFitsRoad(p,this.world)||traffic.some(a=>distance(p,a)<9)||this.units.some(a=>a.edge!==null&&distance(p,a)<9))continue;
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
   const cost=e===target?.edge?target.s:e.length+costs[e.to]+((this.parkedOn.get(e.id)||0)>this.time?PARKED_DETOUR:0);
   if((e===target?.edge||Number.isFinite(costs[e.to]))&&cost<bestCost){best=e;bestCost=cost;}
  }
  return best;
 }
 // Interceptors only cut ahead of a player who is visibly driving away.
 fieldFor(unit){const f=unit.role==='intercept'&&this.intercept?.target?this.intercept:this,on=g=>!!g.costs&&(unit.edge===g.target?.edge||Number.isFinite(g.costs[unit.edge.to]));return on(f)?f:on(this)||!this.target?this:this.farField(unit);}
 clearSight(a,b){
  // At high wanted levels, platform furniture does not hide a car from units
  // in the adjacent lane. Real buildings still block the line of sight.
  const index=this.surging&&this.world.sightBuildings||this.world.buildings;
  const d=distance(a,b),n=Math.ceil(d/4);for(let i=1;i<n;i++)if(index.at(a.x+(b.x-a.x)*i/n,a.z+(b.z-a.z)*i/n))return false;return true;
 }
 // The footway network officers chase along (FOOT_CHASE): today's full footway graph ({nodes,edges}), read only: its edge
 // objects are shared with the walkers' graph (mobility.js gives them their ids), so the lengths, adjacency and a 20 m
 // grid are built here, once, while the map loads (~0.1 s for Copenhagen's 94k edges: not mid-chase).
 setWalks(graph){this.walks=graph?.edges?.length?graph:null;this.fnet=null;this.footNet();}
 footNet(){
  const g=this.walks;if(!g)return null;if(this.fnet)return this.fnet;
  const E=g.edges,N=g.nodes.length,len=new Float64Array(E.length),start=new Int32Array(N+1),adj=new Int32Array(E.length);
  let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;for(const n of g.nodes){if(n[0]<x0)x0=n[0];if(n[0]>x1)x1=n[0];if(n[1]<z0)z0=n[1];if(n[1]>z1)z1=n[1];}
  const box=new Float64Array(E.length*4);
  for(let i=0;i<E.length;i++){const P=E[i].points;let l=0,a=P[0][0],b=P[0][1],c=a,d=b;for(let k=1;k<P.length;k++){const x=P[k][0],z=P[k][1];l+=Math.hypot(x-P[k-1][0],z-P[k-1][1]);if(x<a)a=x;if(x>c)c=x;if(z<b)b=z;if(z>d)d=z;}len[i]=l;box[i*4]=a;box[i*4+1]=b;box[i*4+2]=c;box[i*4+3]=d;start[E[i].from+1]++;}
  for(let n=0;n<N;n++)start[n+1]+=start[n];const fill=start.slice(0,N);for(let i=0;i<E.length;i++)adj[fill[E[i].from]++]=i;
  // Grid of edges by the 20 m cells their bounding box covers (one of each pair of twins, the same way back), counted then filled.
  const cols=Math.floor((x1-x0)/FOOT_CELL)+1,rows=Math.floor((z1-z0)/FOOT_CELL)+1,cell=new Int32Array(cols*rows+1);
  for(let i=0;i<E.length;i++){const e=E[i];if(e.from>e.to){let twin=false;for(let q=start[e.to];q<start[e.to+1];q++)if(E[adj[q]].to===e.from&&Math.abs(len[adj[q]]-len[i])<.8){twin=true;break;}if(twin){box[i*4]=NaN;continue;}}
   const ca=box[i*4]=Math.floor((box[i*4]-x0)/FOOT_CELL),cb=box[i*4+1]=Math.floor((box[i*4+1]-z0)/FOOT_CELL),cc=box[i*4+2]=Math.floor((box[i*4+2]-x0)/FOOT_CELL),cd=box[i*4+3]=Math.floor((box[i*4+3]-z0)/FOOT_CELL);
   for(let x=ca;x<=cc;x++)for(let z=cb;z<=cd;z++)cell[x*rows+z+1]++;}
  for(let k=0;k<cols*rows;k++)cell[k+1]+=cell[k];const at=cell.slice(0,cols*rows),list=new Int32Array(cell[cols*rows]);
  for(let i=0;i<E.length;i++){if(box[i*4]!==box[i*4])continue;for(let x=box[i*4];x<=box[i*4+2];x++)for(let z=box[i*4+1];z<=box[i*4+3];z++)list[at[x*rows+z]++]=i;}
  return this.fnet={E,nodes:g.nodes,len,start,adj,x0,z0,cols,rows,cell,list,seen:new Int32Array(E.length),g:new Float64Array(N),f:new Float64Array(N),stamp:new Int32Array(N),prev:new Int32Array(N),serial:0};
 }
 // On foot from a to b in a straight line: no building in the way and no water (roads and paving over it are bridges).
 footFree(a,b){const B=this.world.buildings,w=this.world.water,n=Math.ceil(distance(a,b)/.75);for(let i=1;i<=n;i++){const x=a.x+(b.x-a.x)*i/n,z=a.z+(b.z-a.z)*i/n;if(B?.at?.(x,z)||w?.length&&inWaterPolygons(w,x,z)&&!this.world.roads?.at?.(x,z)&&!this.world.pavement?.at?.(x,z))return false;}return true;}
 // The nearest point on the footways within `link` m that p can walk to in a straight line: {e,s,x,z}.
 footAttach(net,p){
  const r=Math.ceil(FOOT_CHASE.link/FOOT_CELL),gx=Math.floor((p.x-net.x0)/FOOT_CELL),gz=Math.floor((p.z-net.z0)/FOOT_CELL),found=[],id=++net.serial;
  for(let i=Math.max(0,gx-r);i<=Math.min(net.cols-1,gx+r);i++)for(let j=Math.max(0,gz-r);j<=Math.min(net.rows-1,gz+r);j++)for(let q=net.cell[i*net.rows+j];q<net.cell[i*net.rows+j+1];q++){const ei=net.list[q];if(net.seen[ei]===id)continue;net.seen[ei]=id;
   const P=net.E[ei].points;for(let k=1;k<P.length;k++){const x0=P[k-1][0],z0=P[k-1][1],dx=P[k][0]-x0,dz=P[k][1]-z0,l2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((p.x-x0)*dx+(p.z-z0)*dz)/l2)),x=x0+dx*t,z=z0+dz*t,d=Math.hypot(x-p.x,z-p.z);if(d<=FOOT_CHASE.link)found.push({d,e:ei,k,t,x,z});}}
  found.sort((a,b)=>a.d-b.d);
  for(let n=0,tried=0;n<found.length&&tried<6;n++){const c=found[n];if(n&&c.x===found[n-1].x&&c.z===found[n-1].z)continue;tried++;if(!this.footFree(p,c))continue;
   const P=net.E[c.e].points;let s=0;for(let k=1;k<c.k;k++)s+=Math.hypot(P[k][0]-P[k-1][0],P[k][1]-P[k-1][1]);s+=Math.hypot(P[c.k][0]-P[c.k-1][0],P[c.k][1]-P[c.k-1][1])*c.t;return {e:c.e,s,x:c.x,z:c.z};}
  return null;
 }
 // A* on the footways from attach point a to b; the route's points (x, z pairs) from a to b, or null.
 footRoute(net,a,b){
  const {E,nodes,len,start,adj,g,f,stamp,prev}=net,eb=E[b.e],tx=b.x,tz=b.z,id=++net.serial,h=n=>Math.hypot(nodes[n][0]-tx,nodes[n][1]-tz);
  let best=Infinity,end=-1,direct=false;if(a.e===b.e){best=Math.abs(a.s-b.s);direct=true;}
  heapSize=0;const seed=(n,cost,mark)=>{if(stamp[n]===id&&g[n]<=cost)return;stamp[n]=id;g[n]=cost;prev[n]=mark;f[n]=cost+h(n);push(f[n],n);};
  const ea=E[a.e];seed(ea.from,a.s,-2);seed(ea.to,len[a.e]-a.s,-3);
  for(let expanded=0;heapSize;){const cost=pop(),n=popped;if(stamp[n]!==id||cost>f[n]+1e-9)continue;if(cost>=best||++expanded>FOOT_CHASE.expand)break;
   const here=g[n];if(n===eb.from&&here+b.s<best){best=here+b.s;end=n;direct=false;}if(n===eb.to&&here+len[b.e]-b.s<best){best=here+len[b.e]-b.s;end=n;direct=false;}
   for(let q=start[n];q<start[n+1];q++){const ei=adj[q],to=E[ei].to,c=here+len[ei];if(stamp[to]!==id||c<g[to]){stamp[to]=id;g[to]=c;prev[to]=ei;f[to]=c+h(to);push(f[to],to);}}}
  if(direct){const out=[];edgeStretch(ea,a.s,b.s,out);return out;}
  if(end<0)return null;
  const chain=[];let n=end;while(prev[n]>=0){chain.push(prev[n]);n=E[prev[n]].from;}
  const out=[];edgeStretch(ea,a.s,prev[n]===-2?0:len[a.e],out);
  for(let i=chain.length-1;i>=0;i--){const P=E[chain[i]].points;for(let k=1;k<P.length;k++)out.push(P[k][0],P[k][1]);}
  edgeStretch(eb,end===eb.from?0:len[b.e],b.s,out);return out;
 }
 // An officer's way from `from` to `goal` (x, z pairs, ending at the goal): straight when short and clear, else along the
 // footways; null when there is none (the officer stands). Without a footway network (other cities) only the straight walk.
 footPath(from,goal){
  const net=this.footNet();if((!net||distance(from,goal)<FOOT_CHASE.direct)&&this.footFree(from,goal))return [goal.x,goal.z];if(!net)return null;
  const a=this.footAttach(net,from),b=a&&this.footAttach(net,goal),route=b&&this.footRoute(net,a,b);
  if(!route)return null;route.unshift(a.x,a.z);route.push(goal.x,goal.z);return route;
 }
 // One step of an officer towards `goal` at `speed`, re-planned once a FOOT_CHASE.repath s or when the goal has moved;
 // stops `stop` m short of `face` (the player, when chasing). Never steps into a building.
 walkOfficer(o,goal,speed,dt,face,stop){
  if(this.time>=o.plan||Math.hypot(goal.x-o.gx,goal.z-o.gz)>FOOT_CHASE.moved){o.path=this.footPath(o,goal);o.k=0;o.plan=this.time+FOOT_CHASE.repath;o.gx=goal.x;o.gz=goal.z;}
  const x0=o.x,z0=o.z,P=o.path;let left=speed*dt;
  // Close behind the player on the last stretch: keep after where they are now, not where they were at the last plan
  // (an officer stopping a step behind someone walking away fell back out of reach every second).
  if(face&&P&&o.k>=P.length-2&&distance(o,face)<10&&this.footFree(o,face)){P[P.length-2]=face.x;P[P.length-1]=face.z;o.k=P.length-2;}
  while(P&&left>1e-6&&o.k<P.length&&!(face&&distance(o,face)<=stop)){const dx=P[o.k]-o.x,dz=P[o.k+1]-o.z,d=Math.hypot(dx,dz),step=Math.min(d,left),x=o.x+(d?dx/d*step:0),z=o.z+(d?dz/d*step:0);
   if(this.world.buildings?.at?.(x,z)){o.plan=Math.min(o.plan,this.time+.25);break;}o.x=x;o.z=z;left-=step;if(step>=d)o.k+=2;}
  const mx=o.x-x0,mz=o.z-z0,moved=Math.hypot(mx,mz);o.speed=dt>0?moved/dt:0;
  const want=moved>.01?Math.atan2(-mx,-mz):face?Math.atan2(-(face.x-o.x),-(face.z-o.z)):o.heading;o.heading+=Math.atan2(Math.sin(want-o.heading),Math.cos(want-o.heading))*Math.min(1,dt*10);
 }
 // A unit sees the player from its car, or through its officer on foot (any direction, within FOOT_CHASE.sight).
 sees(u,player){const o=u.officer;return this.canSee(u,player)||!!o&&!o.back&&distance(o,player)<FOOT_CHASE.sight&&this.clearSight(o,player);}
 canSee(unit,player){
  const d=distance(unit,player);if(d>(this.surging?SURGE.sight:145))return false;
  const forward=-(player.x-unit.x)*Math.sin(unit.heading)-(player.z-unit.z)*Math.cos(unit.heading);
  return (d<35||forward>d*.5||this.surging)&&this.clearSight(unit,player);
 }
 // Whether a unit nearing the junction box at the end of its edge stops at the stop line instead of in the box: it has no
 // way on (it stood at the very end), it is going to stand by the player in the box (its target there, or the player within
 // 5.5 m of its way through: it stops 5 m short of them) and the stop line is still in arrest reach, or a slow car or unit
 // (under 3 m/s) stands on its way through the box or the car length beyond it (it stood in the box behind it).
 holdsShort(unit,ahead,field,line,near,player,reach){
  if(!ahead)return true;
  const e=unit.edge,T=field.target,P=this.boxPoint||={x:0,z:0,heading:0},exit=(ahead.startGap||0)+2*2.36+1,far=distance(unit,player)>e.length-unit.s+exit+40;
  let byPlayer=!far&&T&&(T.edge===e&&T.s>line||T.edge===ahead&&T.s<(ahead.startGap||0)),slow=false;
  for(let k=0;k<near.length;k++){const a=OBS[near[k]];if(a!==player&&!a.walking&&Math.abs(a.speed||0)<3){slow=true;break;}}
  if(far&&!slow)return false;
  for(let i=0,r=e;i<4&&r;i++,r=i===1?ahead:r.inside?this.next(r,field):null){const last=i&&!r.inside;for(let s=i?0:line+2;s<=(last?Math.min(r.length,exit):r.length);s+=2){routePoint(r,s,r.lane,undefined,undefined,P); /* on through the edges inside a signal cluster (all box) to the exit beyond */
   if(!far&&!byPlayer&&distance(P,player)<5.5)byPlayer=true;
   if(slow)for(let k=0;k<near.length;k++){const j=near[k],a=OBS[j];if(a===player||a.walking||Math.abs(a.speed||0)>=3||Math.abs(OX[j]-P.x)>6||Math.abs(OZ[j]-P.z)>6)continue;if(trafficFootprintsOverlap(P,a)){slow=2;break;}}
   if(slow===2)break;}if(slow===2)break;}
  if(byPlayer)return distance(routePoint(e,line,e.lane,undefined,undefined,P),player)<reach;
  return slow===2;
 }
 // One creep (SEPARATE_SPEED) out of the junction box a standing unit is in, at its present offset from the centre line: on
 // along its edge out of the box at its start (box 1), or back to the stop line at its end (-1); only where that overlaps
 // nothing new (separates).
 leaveBox(unit,box,near,dt,self){const e=unit.edge;return this.creep(unit,box>0?Math.min(e.length,unit.s+SEPARATE_SPEED*dt):Math.max(stopLine(e),unit.s-SEPARATE_SPEED*dt),near,self);}
 // Whether a passing offset stays on the carriageway for OFFSET_AHEAD m on from s (on into the next edge at the same offset
 // from the centre line). A unit turning out of a junction past a car crossing its nose took the passing offset in the wide
 // start box, where it ran off the road 1 m on, and stood there with that car boxed in beside it, each waiting on the other
 // (15 s; 40 s with a car that set off round it). Tested in a start box only: at a junction mouth the offset is a step past
 // a car before the turn (tested there too, units held cars 8 s more). Kept from it, a unit beside a car entering the same
 // street waits until that car backs off for it (mobility.js UNIT_WAIT).
 offsetHolds(edge,s,off,ahead,field){
  const P=this.holdPoint||={x:0,z:0,heading:0};
  for(let d=2;d<=OFFSET_AHEAD;d+=2){const t=s+d;if(t<=edge.length)routePoint(edge,t,off,undefined,undefined,P);else{const nx=ahead!==undefined?ahead:this.next(edge,field);if(!nx)return true;routePoint(nx,Math.min(nx.length,t-edge.length),off-edge.lane+nx.lane,undefined,undefined,P);}
   if(!vehicleFitsRoad(P,this.world))return false;}
  return true;
 }
 creep(unit,t,near,self){
  const e=unit.edge;if(!(t!==unit.s))return false;
  const q=this.boxPoint||={x:0,z:0,heading:0},c=routePoint(e,unit.s,0,undefined,undefined,q),off=(unit.x-c.x)*Math.cos(c.heading)-(unit.z-c.z)*Math.sin(c.heading);routePoint(e,t,off,undefined,undefined,q);
  if(!safeVehicleSegment(unit,q,this.world)||!separates(unit,q,near))return false;
  unit.x=q.x;unit.z=q.z;unit.heading=q.heading;unit.s=t;OX[self]=q.x;OZ[self]=q.z;return true;
 }
 step(dt,player,traffic=[]){
  this.time+=dt;this.player=player;
  for(const [key,t]of this.contacts)if(this.time-t>10)this.contacts.delete(key);
  if(!this.heat||this.busted)return;
  this.seen=this.units.some(u=>this.sees(u,player));
  if(!this.lastSeen||this.seen)this.lastSeen={x:player.x,z:player.z,heading:player.heading};
  if(this.level&&this.time>=this.repath){
   this.plan(this.lastSeen);this.repath=this.time+2;this.intercept=null;
   const lead=Math.min(70,Math.max(0,player.speed)*3.2);
   if(this.seen&&lead>25&&this.units.some(u=>u.role==='intercept'))this.predicted={x:player.x-Math.sin(player.heading)*lead,z:player.z-Math.cos(player.heading)*lead,due:true};
  }else if(this.level&&this.predicted?.due){this.predicted.due=false;this.intercept=this.field(this.predicted);} // the next step: two fields in one step were up to ~8 ms
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
   if(unit.officer){unit.speed=0;unit.braking=false;unit.stuck=0;if(unit.narrow)this.parkedOn.set(unit.edge.id,this.time+1);const box=boxAt(this.graph,unit.edge,unit.s);if(box){near.length=0;const ux=unit.x,uz=unit.z;for(let i=0;i<n;i++){const dx=OX[i]-ux,dz=OZ[i]-uz;if(dx*dx+dz*dz<OR[i]&&obstacles[i]!==unit)near.push(i);}this.leaveBox(unit,box,near,dt,self);}continue;} // its officer is out on foot: the car waits at the kerb (out of a junction box)
   near.length=0;{const ux=unit.x,uz=unit.z;for(let i=0;i<n;i++){const dx=OX[i]-ux,dz=OZ[i]-uz;if(dx*dx+dz*dz<OR[i]&&obstacles[i]!==unit)near.push(i);}}
   const field=this.fieldFor(unit),ahead=this.next(unit.edge,field);
   let desired=cornerSpeedLimit(unit.edge,unit.s,cruise,[ahead]);
   const gap=distance(unit,player);if(gap<18)desired=Math.min(desired,Math.max(0,(gap-5)*1.6));if(unit.pull)desired=0; // pulling over to send its officer (FOOT_CHASE)
   // Surge: a unit that has a stopped player within arrest range creeps up to the car and makes the arrest, instead of driving on to the lane target and looping the block.
   if(surge&&gap<SURGE.arrestRange&&Math.abs(player.speed)<1&&this.clearSight(unit,player))desired=Math.min(desired,unit.backup?0:Math.max(0,(gap-10)*.6)); // a backup unit has pulled up: it holds there
   const sh=Math.sin(unit.heading),ch=Math.cos(unit.heading);
   const pass=unit.stuck>2&&!(this.time<unit.yieldUntil); // see lane, below
   // What is ahead on its way: a car straight on from its nose counts only if it is also on the lane it drives (where the way
   // turns, a unit turning out of a junction box stood 15-20 s for a car waiting at another approach's stop line, across the box
   // from it, and held the cars behind it).
   // A unit standing with its officer out stands for as long as the chase on foot lasts: one that has waited 2 s behind it
   // goes round it for the next 3 s (it drives up, and its step then takes a passing offset where one is clear and on the
   // road, below; where none is, the step is refused and it stands). It used to keep its following distance behind it, its
   // step never reached the parked unit, and no passing offset was ever tried: it stood there 16 s and more.
   const round=unit.stuck>2||this.time<unit.roundUntil;
   let room=Infinity,front=null,off;for(let k=0;k<near.length;k++){const a=obstacles[near[k]],dx=a.x-unit.x,dz=a.z-unit.z,d2=dx*dx+dz*dz;if(d2>676||pass&&a.holdBy===unit)continue;if(round&&a.officer&&near[k]>=base){if(unit.stuck>2)unit.roundUntil=this.time+3;continue;}const forward=-dx*sh-dz*ch;if(forward<=0||forward>=24)continue;
    let side=Math.abs(dx*ch-dz*sh);const d=unit.s+Math.sqrt(d2),e=unit.edge;if(near[k]<base&&a!==player&&side<2.3&&d<=e.length+(ahead?ahead.length:0)){ /* the player and the other units: straight on, as before (how close it follows them) */const W=this.wayPoint||={x:0,z:0,heading:0}; /* at its present offset from the centre line (a passing offset, or its lane) */if(off===undefined){routePoint(e,unit.s,0,undefined,undefined,W);off=(unit.x-W.x)*Math.cos(W.heading)-(unit.z-W.z)*Math.sin(W.heading);}
     if(d<=e.length)routePoint(e,d,off,undefined,undefined,W);else routePoint(ahead,d-e.length,off-e.lane+ahead.lane,undefined,undefined,W);side=Math.abs((a.x-W.x)*Math.cos(W.heading)-(a.z-W.z)*Math.sin(W.heading));}
    if(side<2.3){desired=Math.min(desired,Math.max(0,(forward-6)*1.4));if(forward<room){room=forward;front=a;}}}
   {const line=stopLine(unit.edge),d=line-unit.s;if(d>-.3&&d<30&&this.holdsShort(unit,ahead,field,line,near,player,surge?SURGE.arrestRange:10)){const t=Math.max(0,d);desired=Math.min(desired,Math.sqrt(6*t),t*1.3);}} // stop at the stop line (traffic's comfortable stop: mobility.js stopBefore)
   if(this.time<unit.yieldUntil)desired=0; // letting by a car that waited on it (below)
   const previousSpeed=unit.speed;
   unit.speed+=Math.max(-18*dt,Math.min(accel*dt,desired-unit.speed));
   unit.braking=unit.speed<previousSpeed-.01;
   if(front?.holdBy===unit&&(unit.stuck>1||this.time<unit.yieldUntil)){unit.yieldUntil=this.time+2;if(this.creep(unit,Math.max(boxAt(this.graph,unit.edge,0)?unit.edge.startGap:0,unit.s-SEPARATE_SPEED*dt),near,self)){unit.speed=0;continue;}} /* not back into the box it came through */ // the car it waits on is waiting on it (each in the other's way, turning across in a signal cluster: both stood 30 s): it backs off its way and lets it by
   if(unit.speed<.05&&desired<.5&&room>7&&boxAt(this.graph,unit.edge,unit.s)===1&&this.leaveBox(unit,1,near,dt,self)){unit.speed=0;continue;} // standing in the box it has just come through: on out of it
   let edge=unit.edge,s=unit.s+unit.speed*dt;
   if(edge===field.target?.edge&&unit.s<=field.target.s&&s>field.target.s)s=field.target.s;
   if(s>=edge.length){const next=this.next(edge,field);if(next){s-=edge.length;edge=next;}else{unit.speed=0;unit.stuck+=dt;continue;}}
   let p=routePoint(edge,s,edge.lane,undefined,undefined,P);
   // A car that is itself waiting on the unit (its step into the unit refused, or following it) and stands in the unit's way: neither could move for good (a unit and a car turning across each other in a junction box stood 20 s, and a unit in a signal cluster with the car it faced and the one behind it both waiting on it, 15-30 s). After 2 s, when it cannot back off (below), the unit drives on past that car where its lane or a passing offset is clear of it, or in a move that deepens no overlap (separates): driving on through it overlapped the two (17-28 unit-steps a seed). Where neither is left, the car backs off for it (mobility.js, a car held by a stuck unit).
   const lane=pass?near.filter(i=>obstacles[i].holdBy!==unit):near,waited=lane.length<near.length||!pass&&near.some(i=>obstacles[i].holdBy===unit); // a car waits on it: keep to a nearer offset it has taken past that car
   // Emergency vehicles may pass a queue only where a full, swept car fits
   // the carriageway. Roundabouts retain their single directed centre line.
   if(!edge.roundabout&&overlapsAny(p,near)){
    for(let o=0,m=waited?4:2;o<m;o++){const off=o===0?edge.lane+2.7:o===1?0:edge.lane+(o===2?1.35:.7),q=routePoint(edge,s,off,undefined,undefined,Q);if(safeVehicleSegment(unit,q,this.world)&&!overlapsAny(q,near)&&(boxAt(this.graph,edge,s)!==1||this.offsetHolds(edge,s,off,edge===unit.edge?ahead:undefined,field))){p=q;break;}} /* past a car waiting on it, nearer offsets too (a narrow street's kerb-side one is off the carriageway); in a junction start box only where it stays on the road beyond the box (offsetHolds) */
   }
   let fits=safeVehicleSegment(unit,p,this.world);if(!fits&&(unit.stuck>.5||this.time<unit.kerbUntil)&&!overlapsAny(p,lane)&&kerbStep(unit,p,this.world)){fits=true;unit.kerbUntil=this.time+1.5;} // stuck on a bend, its corner over the kerb (kerbStep): on, and through the rest of the bend without stopping again
   if(!fits||overlapsAny(p,lane)||pass&&!separates(unit,p,near)){
    // Already overlapping something (a traffic car drove into it while it stood): every move was refused and both stood
    // locked together for good. It creeps out instead, forwards or back, in its lane or at the passing offsets.
    if(overlapsAny(unit,near)){let out=null;for(let d=0;d<2&&!out;d++){const t=Math.min(unit.edge.length,Math.max(0,unit.s+(d?-1:1)*SEPARATE_SPEED*dt));if(t===unit.s)continue;for(let o=0;o<3;o++){const q=routePoint(unit.edge,t,o===0?unit.edge.lane:o===1?unit.edge.lane+2.7:0,undefined,undefined,Q);if(safeVehicleSegment(unit,q,this.world)&&separates(unit,q,near)){out=q;break;}}if(out)s=t;}
     if(out){unit.speed=0;unit.x=out.x;unit.z=out.z;unit.heading=out.heading;unit.s=s;OX[self]=out.x;OZ[self]=out.z;continue;}}
    {const box=boxAt(this.graph,unit.edge,unit.s);if(box)this.leaveBox(unit,box,near,dt,self);} // wedged in a junction box: out of it, on or back to the stop line (where it then holds: holdsShort)
    unit.speed=0;unit.stuck+=dt;if(unit.stuck>2&&!((this.blocked.get(edge.id)||0)>this.time)){this.blocked.set(edge.id,this.time+8);this.repath=Math.min(this.repath,this.time+.5);} /* once per blocked edge: this used to re-plan every frame while a unit sat stuck */continue;
   }
   if(!unit.progressPoint||distance(p,unit.progressPoint)>.5){unit.stuck=0;if(unit.progressPoint){unit.progressPoint.x=p.x;unit.progressPoint.z=p.z;}else unit.progressPoint={x:p.x,z:p.z};}else if(gap>14)unit.stuck+=dt;
   unit.x=p.x;unit.z=p.z;unit.heading=p.heading;unit.edge=edge;unit.s=s;OX[self]=p.x;OZ[self]=p.z;
  }
  // Never teleport a visible stuck car. Retire units only well away from player (not while its officer is out chasing on foot: FOOT_CHASE.leash calls them back).
  this.units=this.units.filter(u=>u.parked||u.officer&&!u.officer.back||distance(u,player)<450&&!(u.stuck>8&&distance(u,player)>85));
  const halted=Math.abs(player.speed)<1,arrestRange=surge?SURGE.arrestRange:10,net=!!this.walks,offRoad=net&&!this.world.roads?.at?.(player.x,player.z);
  const call=halted||offRoad&&(player.walking||Math.abs(player.speed)<FOOT_CHASE.slow); // ON_FOOT, and FOOT_CHASE off the roads: officers get out
  const keep=net?player.walking||halted||offRoad&&Math.abs(player.speed)<FOOT_CHASE.run*1.5:halted; // and stay after the player; else they walk back to the car
  let out=0;for(const u of this.units)if(u.officer)out++;
  for(const u of this.units){if(u.parked)continue;const d=distance(u,player),o=u.officer;
   if(o){
    if(!o.back&&(!keep||distance(o,u)>FOOT_CHASE.leash)){o.back=true;o.plan=0;}
    if(o.back){const door=doorPoint(u);if(distance(o,door)<.6||distance(o,player)>60||!this.clearSight(o,player)){u.officer=null;u.closest=Infinity;u.idle=0;u.pull=false;continue;} /* back in the car, or out of the player's view: gone */this.walkOfficer(o,door,FOOT_CHASE.back,dt,null,0);}
    else this.walkOfficer(o,this.seen?player:this.lastSeen||player,FOOT_CHASE.run,dt,this.seen?player:null,player.walking?1:2.6); // after the player, or to where they were last seen
    continue;}
   if(!call||d>(offRoad?FOOT_CHASE.range:ON_FOOT.range)){u.closest=Infinity;u.idle=u.pull=0;continue;}
   if(d<u.closest-1){u.closest=d;u.idle=0;continue;}
   // A unit that has got no closer for a while (parked at the kerb, wedged, or driving round the block) stops, and sends its
   // officer when one can get there on foot. Off the roads it pulls over where it is.
   if((u.idle+=dt)<=(offRoad?FOOT_CHASE.after:ON_FOOT.after)||this.time<u.footTry)continue;
   if(out>=FOOT_CHASE.max||!offRoad&&(d<arrestRange||!this.clearSight(u,player))){u.pull=false;continue;} // on a road (ON_FOOT): only for a player it can see and not already arrest
   if(Math.abs(u.speed)>.5&&u.stuck<.5){u.pull=offRoad;continue;}
   const door=doorPoint(u),from=this.footFree(u,door)?door:{x:u.x,z:u.z},goal=this.seen?player:this.lastSeen||player,path=this.footPath(from,goal);
   if(!path){u.footTry=this.time+1;u.pull=false;continue;}
   u.narrow=u.edge!==this.target?.edge&&narrowAt(u,this.world);if(u.narrow)this.repath=Math.min(this.repath,this.time);
   const officer=u.officer=newOfficer(from.x,from.z,u.heading);officer.path=path;officer.plan=this.time+FOOT_CHASE.repath;officer.gx=goal.x;officer.gz=goal.z;out++;
   {let l=Math.hypot(path[0]-from.x,path[1]-from.z);for(let i=2;i<path.length;i+=2)l+=Math.hypot(path[i]-path[i-2],path[i+1]-path[i-1]);this.footBy=Math.max(this.footBy,this.time+l/FOOT_CHASE.run+CONTACT.slack);} // the officer's fair chance to get there (as CONTACT): no escape on the clock while they run over
   this.message=offRoad?'An officer gets out and comes after you on foot.':'An officer gets out and walks over.';
  }
  // Two officers out keep `apart` m between them: units parked near each other sent theirs down the same footway route, and they
  // ran in one body (0.7-1 m apart for 130 m at Rundetårn) and stood on one spot at the arrest. The later one steps aside (not into a house).
  {const f=this.units.filter(u=>u.officer);for(let i=1;i<f.length;i++)for(let j=0;j<i;j++){const a=f[j].officer,b=f[i].officer,dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);if(d>=FOOT_CHASE.apart)continue;
   const ux=d>.01?dx/d:Math.cos(a.heading),uz=d>.01?dz/d:-Math.sin(a.heading);for(const [vx,vz] of [[ux,uz],[-uz,ux],[uz,-ux]]){const q={x:a.x+vx*FOOT_CHASE.apart,z:a.z+vz*FOOT_CHASE.apart};if(this.footFree(b,q)){b.x=q.x;b.z=q.z;break;}}}}
  this.seen=this.units.some(u=>this.sees(u,player));if(this.seen)this.sighted=true;
  const after=o=>o&&!o.back; // an officer out after the player (not walking back)
  const canArrest=this.units.some(u=>distance(u,player)<arrestRange&&this.clearSight(u,player)||after(u.officer)&&distance(u.officer,player)<arrestRange&&this.clearSight(u.officer,player));
  // Stand-off: the player is off any road the units can drive and they can only watch from the kerb (no officer can get there on foot).
  // After 10 s of that the escape clock runs as if unseen (the wanted level used to stay frozen for good). An officer on their way is not a stand-off.
  this.standoff=this.seen&&!canArrest&&!this.world.roads?.at?.(player.x,player.z)&&this.units.every(u=>Math.abs(u.speed||0)<.5&&!(after(u.officer)&&u.officer.path))?(this.standoff||0)+dt:0;
  this.escape=(!this.seen||this.standoff>10)&&this.contactMade&&this.time>=this.footBy?this.escape+dt:0; // no escape before the units have had a fair chance (CONTACT), nor while an officer first runs over (FOOT_CHASE)
  this.bust=canArrest&&Math.abs(player.speed)<1?this.bust+dt:0;
  // Hands-on arrest: a unit at the car (any side, no line of sight needed) and a stopped or crawling player; or an officer on foot
  // within reach of someone walking (FOOT_CHASE.grab, slower than .pace: running gets away) or of a crawling car.
  const atCar=this.units.some(u=>distance(u,player)<CONTACT_BUST.range);
  const held=Math.abs(player.speed)<(player.walking?FOOT_CHASE.pace:CONTACT_BUST.speed)&&this.units.some(u=>after(u.officer)&&distance(u.officer,player)<(player.walking?FOOT_CHASE.grab:CONTACT_BUST.range));
  const still=player.walking?.5:CONTACT_BUST.speed,handsOn=held||atCar&&Math.abs(player.speed)<still&&(!player.walking||this.units.some(u=>distance(u,player)<CONTACT_BUST.range&&this.clearSight(u,player)));
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
