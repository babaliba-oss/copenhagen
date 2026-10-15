// Pure simulation: routes come from Helsinki's measured mobility network.
import {crashImpulse,knockCar,stepKnocked,playerSpeedAfter,REST_RECYCLE_AFTER} from './crash-physics.js';
import {vehicleFitsRoad,safeVehicleSegment,trafficFootprintsOverlap} from './road-safety.js';
import {cornerSpeedLimit,edgeCruise,approachCruise,edgeTopSpeed,carLane} from './traffic-driving.js';
import {sweptContact} from './contact-geometry.js';
import {annotateJunctions,annotateCrossings,annotateTramRelations,annotateTramSignals,signalGreen as phaseGreen,tramThreat,boxesOverlap,carBox,oncomingPasses,CAR_HALF_LENGTH} from './lane-model.js';
import {mergeGraph} from './graph-extension.js';
export const TRAFFIC_MAX_SPEED=50/3.6;
export const nearStation=p=>Math.hypot(p.x+620,p.z+45)<430;
export const inStationTrafficArea=p=>p.x>-885&&p.x<-440&&p.z>-145&&p.z<55;
export function prepareGraph(graph){
 const outgoing=Array.from({length:graph.nodes.length},()=>[]);
 graph.edges.forEach((e,id)=>{e.id=id;e.cumulative=[0];for(let i=1;i<e.points.length;i++)e.cumulative.push(e.cumulative.at(-1)+Math.hypot(e.points[i][0]-e.points[i-1][0],e.points[i][1]-e.points[i-1][1]));e.length=e.cumulative.at(-1);outgoing[e.from].push(e);});
 return {...graph,outgoing};
}
// Lane positions are offset sideways from the centreline. The offset direction is blended across polyline
// corners (CORNER_BLEND metres each side) so a car does not jump sideways and snap its heading at every vertex.
const CORNER_BLEND=2.5;
const edgeStartDirection=e=>{const a=e.points[0],b=e.points[1],l=e.cumulative[1]||1;return [(b[0]-a[0])/l,(b[1]-a[1])/l];};
const edgeEndDirection=e=>{const n=e.points.length,a=e.points[n-2],b=e.points[n-1],l=e.cumulative[n-1]-e.cumulative[n-2]||1;return [(b[0]-a[0])/l,(b[1]-a[1])/l];};
// nextDir/prevDir: unit directions of the adjacent edges, so the blend also runs across junction nodes.
export function routePoint(edge,distance,offset=edge.lane,nextDir,prevDir){
 // Hot path (thousands of calls per frame): no allocations beyond the returned point.
 const s=Math.max(0,Math.min(distance,edge.length)),pts=edge.points,cum=edge.cumulative;let i=1;
 while(i<pts.length-1&&cum[i]<s)i++;
 const a=pts[i-1],b=pts[i],length=cum[i]-cum[i-1]||1,t=(s-cum[i-1])/length;
 let dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length;
 const toNext=cum[i]-s,fromPrev=s-cum[i-1];
 if(i<pts.length-1&&toNext<CORNER_BLEND){const c=pts[i+1],l=cum[i+1]-cum[i]||1,k=.5*(1-toNext/CORNER_BLEND);dx+=((c[0]-b[0])/l-dx)*k;dz+=((c[1]-b[1])/l-dz)*k;}
 else if(i>1&&fromPrev<CORNER_BLEND){const o=pts[i-2],l=cum[i-1]-cum[i-2]||1,k=.5*(1-fromPrev/CORNER_BLEND);dx+=((a[0]-o[0])/l-dx)*k;dz+=((a[1]-o[1])/l-dz)*k;}
 else if(nextDir&&i===pts.length-1&&toNext<CORNER_BLEND){const k=.5*(1-toNext/CORNER_BLEND);dx+=(nextDir[0]-dx)*k;dz+=(nextDir[1]-dz)*k;}
 else if(prevDir&&i===1&&fromPrev<CORNER_BLEND){const k=.5*(1-fromPrev/CORNER_BLEND);dx+=(prevDir[0]-dx)*k;dz+=(prevDir[1]-dz)*k;}
 const n=Math.hypot(dx,dz)||1;dx/=n;dz/=n;
 return {x:a[0]+(b[0]-a[0])*t-dz*offset,z:a[1]+(b[1]-a[1])*t+dx*offset,heading:Math.atan2(-dx,-dz)};
}
export function signalGreen(edge,time){
 if(edge.signal<0)return true;
 // Road edges carry their junction's own axes (lane-model.js); other edges fall back to north/south.
 return phaseGreen(edge.signal,edge.signalGroup??Math.abs(Math.cos(routePoint(edge,Math.max(0,edge.length-4),0).heading))>.707,time);
}
export function approachingPedestrian(person,car){
 const speed=Math.abs(car.speed||0);if(speed<2)return false;
 const vx=-Math.sin(car.heading||0)*car.speed,vz=-Math.cos(car.heading||0)*car.speed,dx=person.x-car.x,dz=person.z-car.z;
 const t=(dx*vx+dz*vz)/(speed*speed);
 return t>-.15&&t<2.2&&Math.hypot(dx-vx*Math.max(0,t),dz-vz*Math.max(0,t))<5.5&&Math.hypot(dx,dz)<Math.min(28,8+speed*1.7);
}
// Recycle a car that has made no real progress this long when it is away from the player (last resort).
const STALLED_AFTER=40;
// How far ahead a car plans its route, and so how far it looks for junctions and tram tracks.
const LOOKAHEAD=45;
// Same direction only: the car behind gives way when two footprints touch (merging lanes); the leader may pull away.
// Side by side, the lower id goes first. Previously both refused to move and deadlocked forever.
const yieldsTo=(a,b)=>{if(Math.cos(a.heading-b.heading)<.9)return true;const forward=(b.x-a.x)*-Math.sin(a.heading)+(b.z-a.z)*-Math.cos(a.heading);return forward>.3||(forward>-.3&&b.id<a.id);};
export class Mobility {
 constructor(data,world,{cars=52,people=100,stationCars=0,corridorCars=0,corridor=null,random=Math.random}={}){
  this.roads=prepareGraph(data.roads);this.walks=prepareGraph(data.walks);this.signals=data.signals;this.signalControl=annotateJunctions(this.roads,data.signals||[]);annotateCrossings(this.walks,this.signalControl);this.signalAxes=this.signalControl.axes;this.world=world;this.random=random;this.time=0;this.collisions=0;this.externalObstacles=[];this.externalBodies=[];this.trams=null;this.edgeCars=new Map();this.boxCars=new Map();this.approaching=new Map();
  this.stationEdges=this.roads.edges.filter(e=>e.points.some(([x,z])=>inStationTrafficArea({x,z})));
  // Main-road pool: extra cars that live only on a busy corridor (e.g. Olympia terminal → Kauppatori), both directions.
  this.corridor=corridor;this.corridorEdges=corridor?this.roads.edges.filter(e=>e.length>10&&corridor(...e.points[Math.floor(e.points.length/2)])):[];
  this.corridorIds=new Set(this.corridorEdges.map(e=>e.id));
  this.cars=Array.from({length:cars+stationCars+(this.corridorEdges.length?corridorCars:0)},(_,id)=>({id,stationOnly:id>=cars&&id<cars+stationCars,corridorOnly:id>=cars+stationCars,walking:false,edge:null,s:0,speed:0,cruise:6+random()*5,x:0,z:0,heading:0}));
  this.people=Array.from({length:people},(_,id)=>({id,walking:true,edge:null,s:0,speed:0,cruise:.85+random()*.65,x:0,z:0,heading:0}));
 }
 // Trams share the street: tracks are related to lanes once, and their positions are read every step.
 attachTrams(trams){this.trams=trams;annotateTramRelations(this.roads.edges,trams.paths);annotateTramSignals(trams.paths,this.signals||[],this.signalControl);}
 // Buses stop at the same junction stop lines, in the same signal groups, as cars and trams.
 attachBuses(buses){this.buses=buses;annotateTramSignals(buses.paths,this.signals||[],this.signalControl);buses.keepBaysClear?.(box=>this.laneTaken(box));}
 // Existing actor routes, claimed cars, panic and contact state survive a
 // streamed region. Only derived junction and route lookup data is refreshed.
 appendRegion(data){
  const offset=this.signals.length,roads=this.roads.edges.length,walks=this.walks.edges.length;
  this.signals.push(...data.signals);mergeGraph(this.roads,data.roads,offset);mergeGraph(this.walks,data.walks,offset);this.roads._grid=this.walks._grid=null;
  for(const e of this.roads.edges)if(e.mappedSignal!==undefined)e.signal=e.mappedSignal;
  this.signalControl=annotateJunctions(this.roads,this.signals);annotateCrossings(this.walks,this.signalControl);this.signalAxes=this.signalControl.axes;
  this.stationEdges=this.roads.edges.filter(e=>e.points.some(([x,z])=>inStationTrafficArea({x,z})));
  this.corridorEdges=this.corridor?this.roads.edges.filter(e=>e.length>10&&this.corridor(...e.points[Math.floor(e.points.length/2)])):[];
  this.corridorIds=new Set(this.corridorEdges.map(e=>e.id));
  if(this.trams)this.attachTrams(this.trams);if(this.buses)this.attachBuses(this.buses);
  return {roads:this.roads.edges.slice(roads),walks:this.walks.edges.slice(walks),signalOffset:offset};
 }
 // True when a body (an oriented box) covers any car lane position.
 laneTaken(box){
  const r=box.hl+3;
  for(const e of this.roads.edges){e.bounds??=e.points.reduce((b,[x,z])=>[Math.min(b[0],x),Math.min(b[1],z),Math.max(b[2],x),Math.max(b[3],z)],[Infinity,Infinity,-Infinity,-Infinity]);
   const b=e.bounds;if(box.x+r<b[0]-3||box.x-r>b[2]+3||box.z+r<b[1]-3||box.z-r>b[3]+3)continue;
   for(let s=0;s<=e.length;s+=1.5){const p=routePoint(e,s);if(Math.abs(p.x-box.x)<r&&Math.abs(p.z-box.z)<r&&boxesOverlap(carBox(p),box))return true;}}
  return false;
 }
 // Cars plan their next edges ahead (LOOKAHEAD metres) so junction and track rules can see past short edges.
 plan(a){
  const plan=a.plan||(a.plan=[]);let distance=a.edge.length-a.s,last=a.edge;
  for(const e of plan){distance+=e.length;last=e;}
  while(distance<LOOKAHEAD&&plan.length<8){const next=this.pickNext(last);if(!next)break;plan.push(next);distance+=next.length;last=next;}
  return plan;
 }
 position(a){
  // Cars know their next edge a few metres early so the lane offset can blend across the junction.
  let nextDir,prevDir;
  if(!a.walking){const remaining=a.edge.length-a.s;
   if(remaining<CORNER_BLEND){const next=this.plan(a)[0];if(next)nextDir=edgeStartDirection(next);}
   if(a.s<CORNER_BLEND&&a.prevDir)prevDir=a.prevDir;}
  let p=routePoint(a.edge,a.s,a.edge.lane,nextDir,prevDir);
  // Never fall back to the centre line when the right-hand lane is blocked.
  // Spawn/segment clearance rejects that route instead of using opposing space.
  // Move to the outer right-hand lane only when a mapped road surface exists
  // there. Shared narrow streets remain shared; crossing rails cause no detour.
  let target=a.edge.lane;
  if(!a.walking&&a.edge.laneOffsets){const own=carLane(a.edge,a.id),q=routePoint(a.edge,a.s,own,nextDir,prevDir);if(vehicleFitsRoad(q,this.world)){target=own;p=q;}}
  // A car is either clear of a parallel track (by a tram's half width plus its own) or on it, sharing the lane
  // with trams; straddling the edge of a tram's path would hold up both. Keep to the right where the road allows.
  const rails=this.world.railAvoidance;
  if(!a.walking&&!a.edge.separateCarriageway&&rails&&!rails.clear(p)){let chosen=false;
   for(const offset of [a.edge.lane+.6,a.edge.lane+1.2,a.edge.lane+1.8,a.edge.lane+2.6,a.edge.lane+3.2]){const candidate=routePoint(a.edge,a.s,offset,nextDir,prevDir);if(vehicleFitsRoad(candidate,this.world)&&rails.clear(candidate)){target=offset;p=candidate;chosen=true;break;}}
   const shift=chosen?null:rails.onTrack(p);if(shift!==null&&Math.abs(shift)>.3){const candidate=routePoint(a.edge,a.s,a.edge.lane+shift,nextDir,prevDir);if(vehicleFitsRoad(candidate,this.world)){target=a.edge.lane+shift;p=candidate;}}}
  // A standing bus (a mapped bay on the carriageway) is passed on whichever side the road allows, starting
  // a few metres before it; the lane offset eases across like any other shift.
  else if(!a.walking&&this.standing?.length){const lane=a.edge.lane,ahead=s=>routePoint(a.edge,Math.min(a.edge.length,a.s+s),lane);
   if(this.standingAt(p)||this.standingAt(ahead(5))||this.standingAt(ahead(10)))for(const offset of [lane-1.1,lane-1.7,lane-2.3,lane+.9,lane+1.6]){const candidate=routePoint(a.edge,a.s,offset,nextDir,prevDir),further=routePoint(a.edge,Math.min(a.edge.length,a.s+8),offset);
    if(vehicleFitsRoad(candidate,this.world)&&vehicleFitsRoad(further,this.world)&&!this.standingAt(candidate)&&!this.standingAt(further)){target=offset;p=candidate;break;}}}
  if(a.walking)return p;
  // Slide to the new lateral offset at a walking pace rather than jumping 1.8 m sideways in one frame.
  if(a.offset===undefined||!(this.dt>0))a.offset=target;else{const max=1.4*this.dt;a.offset+=Math.max(-max,Math.min(max,target-a.offset));}
  if(Math.abs(a.offset-target)>.01){const eased=routePoint(a.edge,a.s,a.offset,nextDir,prevDir);if(vehicleFitsRoad(eased,this.world))return eased;a.offset=target;}
  return p;
 }
 walkable(x,z,edge){
  if(this.world.buildings.at(x,z))return false;
  if(this.world.roads.at(x,z))return !!edge?.crossing;
  return !!this.world.pavement?.at(x,z);
 }
 safeWalkSegment(a,p,edge){
  const distance=Math.hypot(p.x-a.x,p.z-a.z);if(distance>2)return false;
  for(let i=1,n=Math.max(1,Math.ceil(distance/.25));i<=n;i++)if(!this.walkable(a.x+(p.x-a.x)*i/n,a.z+(p.z-a.z)*i/n,edge))return false;
  return true;
 }
 // Edges whose midpoint lies near the player, from a 100 m grid built once per graph (spawning used to scan
 // every edge in the city per agent: a long frame whenever many respawned at once).
 edgesNear(graph,player,r){
  const C=100;if(!graph._grid){const g=new Map();graph.edges.forEach((e,i)=>{e._gi=i;const p=e.points[Math.floor(e.points.length/2)],k=Math.floor(p[0]/C)+','+Math.floor(p[1]/C);let l=g.get(k);if(!l)g.set(k,l=[]);l.push(e);});graph._grid=g;}
  if(!player)return graph.edges;const out=[],x0=Math.floor((player.x-r)/C),x1=Math.floor((player.x+r)/C),z0=Math.floor((player.z-r)/C),z1=Math.floor((player.z+r)/C);
  for(let i=x0;i<=x1;i++)for(let j=z0;j<=z1;j++){const l=graph._grid.get(i+','+j);if(l)for(const e of l)out.push(e);}
  return out.sort((a,b)=>a._gi-b._gi); // graph order, so seeded spawns pick the same edges as a full scan
 }
 nearCorridor(player){return this.corridorEdges.some(e=>{const p=e.points[Math.floor(e.points.length/2)];return Math.hypot(p[0]-player.x,p[1]-player.z)<420;});}
 spawn(a,player){
  if(a.playerTaken){a.edge=null;a.speed=0;return;}
  delete a.knocked;delete a.damage;
  if(a.stationOnly&&!nearStation(player)){a.edge=null;a.speed=0;return;}
  if(a.corridorOnly&&!this.nearCorridor(player)){a.edge=null;a.speed=0;return;}
  const graph=a.walking?this.walks:this.roads;
  // Prefer nearby routes; edge midpoint avoids choosing a remote end of a long road.
  const nearby=(a.stationOnly?this.stationEdges:a.corridorOnly?this.corridorEdges:this.edgesNear(graph,player,a.walking?200:320)).filter(e=>{const p=e.points[Math.floor(e.points.length/2)],d=Math.hypot(p[0]-player.x,p[1]-player.z);return (!a.walking||!e.crossing)&&d<(a.walking?200:a.corridorOnly?520:320)&&e.length>(a.walking?3:10)&&!(!a.walking&&(this.obstructed?.has(e)||this.trap(e,2)));});
  for(let trial=0;trial<80&&nearby.length;trial++){
   a.edge=nearby[Math.floor(this.random()*nearby.length)];a.s=this.random()*a.edge.length;a.plan=[];a.prevDir=undefined;
   const p=this.position(a);
   if(a.stationOnly&&!inStationTrafficArea(p))continue;
   if(!a.walking&&(this.cars.some(b=>b!==a&&b.edge&&trafficFootprintsOverlap(p,b))||this.hitsBody(carBox(p,1))||this.inConflict(a.edge,a.s)))continue;
   // Walkers spread out: at most one per 8 m of footway. Where few paths are near (a pier, a quay between
   // canals) the 300 walkers otherwise all landed on the same few edges and moved about as one clump.
   if(a.walking){let on=0;for(const b of this.people)if(b!==a&&b.edge===a.edge)on++;if(on>=Math.max(1,a.edge.length/8))continue;}
   if(this.world.buildings.at(p.x,p.z)||(a.walking?!this.walkable(p.x,p.z,a.edge):!vehicleFitsRoad(p,this.world)))continue;
   // A long straight main road is almost always in view; corridor cars may appear there, but only in the far haze.
   const distance=Math.hypot(p.x-player.x,p.z-player.z);
   if(distance<12||(!a.walking&&this.visibilityTest?.(p)&&!(a.corridorOnly&&distance>300)))continue;
   if(!a.walking){const dx=p.x-player.x,dz=p.z-player.z,along=-dx*Math.sin(player.heading||0)-dz*Math.cos(player.heading||0),side=Math.abs(dx*Math.cos(player.heading||0)-dz*Math.sin(player.heading||0));if(along>-24&&along<(this.time<3?95:45)&&side<4.5)continue;} // a clear first 95 m when the drive starts
   if(!a.walking&&this.cars.some(b=>b!==a&&b.edge&&Math.hypot(p.x-b.x,p.z-b.z)<8))continue;
   Object.assign(a,p);a.offset=undefined;a.prevDir=undefined;a.speed=edgeCruise(a.edge,a.cruise);a.waiting=0;a.passing=null;a.unjam=null;a.gridlock=0;a.hold=null;a.holdBy=null;a.deadlocked=false;a.hiddenFor=0;a.panicUntil=0;a.running=false;a.stuck=0;a.progressPoint={x:p.x,z:p.z};return;
  }
  a.edge=null;a.speed=0;
 }
 reset(player){this.updateParked();for(const a of [...this.cars,...this.people]){a.edge=null;delete a.playerTaken;delete a.conversation;}for(const a of [...this.cars,...this.people])this.spawn(a,player);}
 canRecycle(a,player){return Math.hypot(a.x-player.x,a.z-player.z)>80&&(a.hiddenFor||0)>2;}
 retire(a,player,force=false){a.speed=0;if(force||a.walking||this.canRecycle(a,player))a.edge=null;}
 // Lanes a parked bus stands in (mapped bays on the carriageway) are avoided when routing allows; a car that
 // must pass one steers around it (position()).
 // Never spawn inside a junction box or on a tram conflict: a car must have arrived there under the rules.
 inConflict(e,s){if(e.startGap&&s<e.startGap&&this.roads.junctionNode?.[e.from])return true;return this.zonesOf(e).some(z=>s>z.start-CAR_HALF_LENGTH-1&&s<z.end+CAR_HALF_LENGTH+1);}
 standingAt(p){for(const b of this.standing)if(Math.abs(b.x-p.x)<9&&Math.abs(b.z-p.z)<9&&boxesOverlap(carBox(p,.3),b))return true;return false;}
 updateParked(){
  let key='';for(const b of this.externalBodies)if(b.ref?.parked||b.ref?.standing)key+=`${Math.round(b.x)},${Math.round(b.z)};`;
  if(key===this.parkedKey)return;this.parkedKey=key;this.obstructed=new Set();
  const parked=this.standing=this.externalBodies.filter(b=>b.ref?.parked||b.ref?.standing);if(!parked.length)return;
  for(const e of this.roads.edges){const m=e.points[Math.floor(e.points.length/2)];if(!parked.some(b=>Math.hypot(b.x-m[0],b.z-m[1])<e.length/2+15))continue;
   for(let s=0;s<=e.length;s+=2){const p=routePoint(e,s);if(parked.some(b=>boxesOverlap(carBox(p),b))){this.obstructed.add(e);break;}}}
 }
 // An edge whose lane runs off the mapped carriageway somewhere would stop a car there for good: route
 // around it when there is a choice. Checked once per edge, when a car first considers it.
 fits(e){if(e.fits===undefined){e.fits=true;for(let s=Math.min(1,e.length/2);s<e.length;s+=2)if(!vehicleFitsRoad(routePoint(e,s),this.world)){e.fits=false;break;}}return e.fits;}
 trap(e,depth){
  if(!this.fits(e))return true;if(!depth)return false;
  const key=depth*1e6+e.id;this.traps??=new Map();if(this.traps.has(key))return this.traps.get(key);
  this.traps.set(key,false);const next=this.roads.outgoing[e.to].filter(o=>o.to!==e.from),result=next.length>0&&next.every(o=>this.trap(o,depth-1));
  this.traps.set(key,result);return result;
 }
 pickNext(edge){
  let options=this.roads.outgoing[edge.to].filter(e=>e.to!==edge.from);
  if(this.obstructed?.size&&options.some(e=>!this.obstructed.has(e)))options=options.filter(e=>!this.obstructed.has(e));
  // Avoid lanes that leave the carriageway, and lanes that lead only into such lanes; turn back instead.
  const good=options.filter(e=>!this.trap(e,3));
  if(good.length)options=good;else{const back=this.roads.outgoing[edge.to].find(e=>e.to===edge.from);if(back&&!this.trap(back,1))options=[back];}
  // Dead end: a U-turn where the reverse direction exists.
  if(!options.length)options=this.roads.outgoing[edge.to];
  return options.length?options[Math.floor(this.random()*options.length)]:null;
 }
 nextEdge(a){
  if(!a.walking)return this.pickNext(a.edge);
  const graph=this.walks;
  let options=graph.outgoing[a.edge.to].filter(e=>e.to!==a.edge.from);
  // Dead end: walkers turn back.
  if(!options.length)options=graph.outgoing[a.edge.to];
  {options=options.filter(e=>{const p=routePoint(e,Math.min(.4,e.length),0);return this.walkable(p.x,p.z,e);});if(a.running&&options.some(e=>!e.crossing))options=options.filter(e=>!e.crossing);}
  if(!options.length)return null;
  return options[Math.floor(this.random()*options.length)];
 }
 // Crowd reactions (crowd-reaction.js): run from a point for a while, turning back
 // along the path when it leads there; or stand still and watch.
 scare(a,from,seconds){
  if(!a.walking||!a.edge)return;
  const ahead=routePoint(a.edge,Math.min(a.edge.length,a.s+5),0),behind=routePoint(a.edge,Math.max(0,a.s-5),0);
  if(Math.hypot(behind.x-from.x,behind.z-from.z)>Math.hypot(ahead.x-from.x,ahead.z-from.z)+.2){const reverse=this.walks.outgoing[a.edge.to].find(e=>e.to===a.edge.from&&Math.abs(e.length-a.edge.length)<.8);if(reverse){a.s=reverse.length-a.s;a.edge=reverse;}}
  a.panicUntil=this.time+seconds;a.turnAfter=this.time+Math.min(2,seconds);a.holdUntil=0;
 }
 hold(a,seconds){if(a.walking)a.holdUntil=this.time+seconds;}
 flee(a,player){
  const threatened=approachingPedestrian(a,player);
  if(threatened){
   if(!a.running||this.time>(a.turnAfter||0)){
    const ahead=routePoint(a.edge,Math.min(a.edge.length,a.s+5),0),behind=routePoint(a.edge,Math.max(0,a.s-5),0),px=player.x-Math.sin(player.heading)*player.speed*.5,pz=player.z-Math.cos(player.heading)*player.speed*.5;
    const score=p=>Math.hypot(p.x-px,p.z-pz)+(this.world.roads.at(p.x,p.z)?-5:0);
    if(score(behind)>score(ahead)+.2){const reverse=this.walks.outgoing[a.edge.to].find(e=>e.to===a.edge.from&&Math.abs(e.length-a.edge.length)<.8);if(reverse){a.s=reverse.length-a.s;a.edge=reverse;}}
    a.turnAfter=this.time+.65;
   }
   a.panicUntil=this.time+2.8;
  }
  a.running=this.time<(a.panicUntil||0);return a.running;
 }
 passes(a,b){return !!a.unjam&&(b===a.unjam||b.ref===a.unjam)||this.cars[b.id]===b&&a.passing===b.id;}
 // A stopped car whose chain of "waiting for" links (through cars, trams and buses) leads back to itself:
 // a junction standoff, or a queue that has wrapped round a block. The loop is broken by the lowest-id car
 // in it that waits for another car (a car cannot squeeze past a tram).
 inGridlock(a){
  if(a.speed>.2||!a.holdBy)return false;
  // A car and a tram or bus each holding the other (a corner of one in the other's path): the car edges past.
  if(this.cars[a.holdBy.id]!==a.holdBy)return a.holdBy.holdBy===a&&(a.holdBy.speed||0)<.2;
  let b=a.holdBy,lowest=a.id;
  for(let i=0;i<30&&b;i++){if(b===a)return lowest===a.id;if(b.speed>.2||b.edge===null)return false;
   if(this.cars[b.id]===b&&this.cars[b.holdBy?.id]===b.holdBy)lowest=Math.min(lowest,b.id);b=b.holdBy;}
  return false;
 }
 // Static conflict zones of an edge, relative to its start: tram crossings, places where the lane joins a
 // track, and the junction box at its end (stopGap/startGap come from lane-model.js).
 zonesOf(e){
  if(e.zones)return e.zones;const zones=[];
  for(const c of e.tramConflicts||[])if(!c.afterShared)zones.push({start:c.from-1,end:c.to+1,path:c.path,lo:c.trackLo,hi:c.trackHi,join:c.from<1});
  for(const r of e.tramShared||[])zones.push({start:r.from-1.5,end:r.from+1.5,path:r.path,lo:r.trackFrom,hi:r.trackFrom,join:r.from<1});
  if(e.junction)zones.push({start:e.length-(e.stopGap-CAR_HALF_LENGTH),end:e.length+(e.stopGap-CAR_HALF_LENGTH),signal:e.signal>=0,node:e.to});
  return e.zones=zones.sort((a,b)=>a.start-b.start);
 }
 // Zones ahead on the planned route are merged into blocks that a car either clears in one go or does not
 // enter: a red signal, a tram on or approaching the track, or no room to leave the block holds the car
 // before the block, never inside it. Returns the speed that stops it there (Infinity when it may go).
 zoneLimit(a,plan,trams){
  this.zoneWhy=null;this.zoneBy=null;
  let base=-a.s,blockStart=0,blockEnd=-Infinity,open=false,prev=null;
  for(let i=-1;i<plan.length&&base<LOOKAHEAD;i++){const e=i<0?a.edge:plan[i];
   for(const z of this.zonesOf(e)){
    if(z.join&&(i<0?a.edge.tramShared?.some(r=>r.path===z.path&&r.from<=a.s+1&&r.to>=a.s-1):prev?.tramShared?.some(r=>r.path===z.path&&r.to>prev.length-2)))continue; // already on that track
    const start=base+z.start,end=base+z.end;if(end+CAR_HALF_LENGTH<0)continue;
    if(open&&start-blockEnd<2*CAR_HALF_LENGTH+1&&blockEnd-blockStart<30)blockEnd=Math.max(blockEnd,end);
    else{if(open&&this.blockExitTaken(a,plan,blockStart,blockEnd))return this.stopBefore(a,blockStart);open=true;blockStart=start;blockEnd=end;}
    if(blockStart-CAR_HALF_LENGTH<-.3)continue; // committed: already in the block
    // Only the signal where the block starts counts: a second one inside it belongs to the same junction.
    if(z.signal&&start===blockStart&&!signalGreen(e,this.time)&&blockStart-CAR_HALF_LENGTH-.5>a.speed*a.speed/10-1){this.zoneWhy='signal';return this.stopBefore(a,blockStart);}
    if(z.node!==undefined){const b=this.giveWayAt(a,z.node,plan,z.signal,start,end);if(b){this.zoneWhy='give way';this.zoneBy=b;return this.stopBefore(a,blockStart);}}
    if(z.path){const d=end+CAR_HALF_LENGTH,t=tramThreat(trams,z.path,z.lo,z.hi,(a.speed>3?d/a.speed:Math.sqrt(d/1.1))+1.5);if(t){this.zoneWhy='tram';this.zoneBy=t;return this.stopBefore(a,blockStart);}}
   }
   base+=e.length;prev=e;
  }
  if(open&&this.blockExitTaken(a,plan,blockStart,blockEnd))return this.stopBefore(a,blockStart);
  return Infinity;
 }
 // Right of way at a junction box: a car already in it on another route goes first, and so does one arriving
 // from the right at the same time (moving, so four cars at a quiet crossing never all wait on each other).
 // At a signal the lights give the right of way: only crossing traffic still clearing the box is waited for.
 giveWayAt(a,node,plan,signalled,start,end){
  const box=this.boxCars.get(node);
  // Only box occupants that are actually on this car's way through (a big junction holds several flows).
  if(box){let way=null;for(const b of box){if(b===a||b===a.unjam||b.edge===a.edge||plan.includes(b.edge)||b.holdBy===a||signalled&&Math.abs(Math.cos(b.heading-a.heading))>.7)continue;
   way??=this.wayThrough(a,plan,start,end);if(way.some(p=>Math.abs(b.x-p.x)<5&&Math.abs(b.z-p.z)<5&&boxesOverlap(carBox(p,.4),carBox(b))))return b;}}
  const near=!signalled&&this.approaching.get(node);if(!near)return null;
  const fx=-Math.sin(a.heading),fz=-Math.cos(a.heading),rx=Math.cos(a.heading),rz=-Math.sin(a.heading);
  for(const b of near){if(b===a||b===a.unjam||b.speed<1||b.edge===a.edge)continue;const x=b.x-a.x,z=b.z-a.z;if(x*rx+z*rz>2&&x*fx+z*fz>-4&&Math.cos(b.heading-a.heading)<.7)return b;}
  return null;
 }
 // Comfortable braking (3 m/s²) to the stop line, tapering to a crawl over the last metres.
 stopBefore(a,start){this.zoneWhy??='keep clear';const d=Math.max(0,start-CAR_HALF_LENGTH-.5);return Math.min(Math.sqrt(6*d),d*1.3);}
 // A slow car (or a tram or bus body) in the block or in the car-length beyond it: entering would block the box.
 blockExitTaken(a,plan,start,end){
  if(start-CAR_HALF_LENGTH<-.3)return false;
  const limit=end+3*CAR_HALF_LENGTH+1;let base=-a.s;
  for(let i=-1;i<plan.length&&base<limit;i++){const e=i<0?a.edge:plan[i],cars=this.edgeCars.get(e);
   if(cars)for(const b of cars){if(b===a||b.speed>4||b===a.unjam)continue;const d=base+b.s;if(d>start&&d<=limit){this.zoneBy=b;return true;}}
   base+=e.length;}
  // The way through the block itself: a stopped car standing in it (waiting at another approach's stop line
  // on a corner the lane cuts) would leave this car stuck half way.
  const still=[];for(const b of this.cars)if(b!==a&&b.edge&&b.speed<3&&b!==a.unjam&&Math.abs(b.x-a.x)<end+8&&Math.abs(b.z-a.z)<end+8)still.push(b);
  if(still.length)for(let d=Math.max(start,CAR_HALF_LENGTH+1);d<=end+CAR_HALF_LENGTH;d+=2){const p=this.routeAt(a,plan,d);if(!p)break;for(const b of still)if(Math.abs(b.x-p.x)<6&&Math.abs(b.z-p.z)<6&&boxesOverlap(carBox(p),carBox(b))){this.zoneBy=b;return true;}}
  if(this.externalBodies.length){const p=this.routeAt(a,plan,end+CAR_HALF_LENGTH+.5);if(p)for(const body of this.externalBodies){if(Math.abs(body.x-p.x)>20||Math.abs(body.z-p.z)>20||(body.speed||0)>2)continue;if(boxesOverlap(carBox(p),body)){this.zoneBy=body.ref||body;return true;}}}
  return false;
 }
 wayThrough(a,plan,start,end){const way=[];for(let d=Math.max(start,0);d<=end+CAR_HALF_LENGTH;d+=1.5){const p=this.routeAt(a,plan,d);if(!p)break;way.push(p);}return way;}
 routeAt(a,plan,d){let s=a.s+d;for(let i=-1;i<plan.length;i++){const e=i<0?a.edge:plan[i];if(s<=e.length)return routePoint(e,s,e.lane);s-=e.length;}return null;}
 hitsBody(box){for(const body of this.externalBodies)if(boxesOverlap(box,body))return body;return null;}
 // Moving into a tram or bus body is refused; moving out of one (it drove into us) is allowed.
 bodyBlocking(a,p){
  for(const body of this.externalBodies){if(Math.abs(body.x-p.x)>20||Math.abs(body.z-p.z)>20)continue;if(boxesOverlap(carBox(p),body)&&!boxesOverlap(carBox(a),body)&&!oncomingPasses(p,body)&&(body.ref||body)!==a.unjam)return body.ref||body;}
  return null;
 }
 crossingClear(edge,player){
  if(!signalGreen(edge,this.time))return false;
  const middle=routePoint(edge,edge.length/2,0);
  return ![player,...this.cars,...this.externalObstacles].some(c=>c.edge!==null&&(Math.hypot(c.x-middle.x,c.z-middle.z)<(Math.abs(c.speed||0)<.5?3:5)||approachingPedestrian(middle,c)));
 }
 step(dt,player){
  this.time+=dt;this.dt=dt;
  // Per step rather than per car: who is on which edge, and everything a car must not drive into.
  this.edgeCars.clear();this.boxCars.clear();this.approaching.clear();
  const add=(map,key,c)=>{const list=map.get(key);if(list)list.push(c);else map.set(key,[c]);};
  for(const c of this.cars)if(c.edge&&!c.knocked){add(this.edgeCars,c.edge,c);const e=c.edge,remaining=e.length-c.s;
   // Junction boxes: cars inside one (front past the stop line, or rear not yet out), and cars about to enter.
   if(e.junction&&remaining<e.stopGap-.3)add(this.boxCars,e.to,c);else if(e.junction&&remaining<e.stopGap+5)add(this.approaching,e.to,c);
   if(e.startGap&&c.s<e.startGap&&this.roads.junctionNode?.[e.from])add(this.boxCars,e.from,c);}
  const traffic=[player,...this.cars,...this.externalObstacles];for(const p of this.people)if(p.edge?.crossing&&this.world.roads.at(p.x,p.z))traffic.push(p);
  const tramList=this.trams?.trams||[];this.updateParked();
  for(const a of [...this.cars,...this.people]){
   if(a.playerTaken)continue;
   a.hiddenFor=(this.visibilityTest?this.visibilityTest(a):Math.hypot(a.x-player.x,a.z-player.z)<350)?0:(a.hiddenFor||0)+dt;
   if(a.knockdown){a.speed=0;a.running=false;continue;}
   if(a.walking&&this.time<(a.holdUntil||0)){a.speed=0;a.running=false;continue;}
   if(a.walking&&a.conversation){a.speed=0;continue;}
   // A car the player crashed into coasts on its own momentum, then sits where it stopped as an obstacle
   // until it is out of sight (or long enough has passed) and gets recycled like any other car.
   if(a.knocked){if(!stepKnocked(a,dt,this.world,this.time,{cars:this.cars,obstacles:this.externalObstacles,knock:(b,pose,impulse)=>{if(this.cars[b.id]===b&&b.edge){knockCar(b,impulse,this.time);this.collisions++;}}})&&(this.time-a.knocked.rest>REST_RECYCLE_AFTER&&Math.hypot(a.x-player.x,a.z-player.z)>80||this.canRecycle(a,player)&&Math.hypot(a.x-player.x,a.z-player.z)>160)){delete a.knocked;delete a.damage;a.edge=null;this.spawn(a,player);}continue;}
   if(a.stationOnly){
    if(!nearStation(player)){this.retire(a,player);continue;}
    // Leaving the area: keep driving normally and recycle once unseen. (retire() would zero the speed every
    // frame while the car is still in view, freezing it and everything queued behind it.)
    if(a.edge&&!inStationTrafficArea(a)&&this.canRecycle(a,player))a.edge=null;
    if(!a.edge){if(this.time<(a.retryAt||0))continue;a.retryAt=this.time+.5;this.spawn(a,player);continue;}
   }
   if(a.corridorOnly){
    if(!this.nearCorridor(player)){this.retire(a,player);continue;}
    if(a.edge&&!this.corridorIds.has(a.edge.id)&&this.canRecycle(a,player))a.edge=null;
    if(!a.edge){if(this.time<(a.retryAt||0))continue;a.retryAt=this.time+.5;this.spawn(a,player);continue;}
   }
   if(!a.edge||(Math.hypot(a.x-player.x,a.z-player.z)>(a.walking?330:500)&&(a.walking||this.canRecycle(a,player)))){this.spawn(a,player);continue;}
   // A car that has made no progress for a long time is holding up a queue: recycle it unless it is close by.
   // Away from the player a deadlocked car is recycled rather than squeezing through another one.
   if(!a.walking&&((a.waiting||0)>STALLED_AFTER||a.deadlocked)&&Math.hypot(a.x-player.x,a.z-player.z)>60){a.deadlocked=false;this.spawn(a,player);continue;}
   const running=a.walking&&this.flee(a,player);
   let desired=running?4.2+a.id%4*.2:a.cruise;const remaining=a.edge.length-a.s,dx=-Math.sin(a.heading),dz=-Math.cos(a.heading);
   if(a.walking){
    if(!running){const x=player.x-a.x,z=player.z-a.z,forward=x*dx+z*dz;if(forward>0&&forward<5&&Math.abs(x*dz-z*dx)<1.7)desired=Math.min(desired,Math.max(0,(forward-2.8)*.85));}
    if(a.edge.crossing&&a.s<.35&&!running&&!this.world.roads.at(a.x,a.z)&&!this.crossingClear(a.edge,player))desired=0;
   }else{
    const plan=this.plan(a);let hold=null,holdBy=null;
    desired=cornerSpeedLimit(a.edge,a.s,approachCruise(edgeCruise(a.edge,desired),plan[0],desired,remaining),plan.length?[plan[0]]:[]);
    if(a.edge.roundabout)desired=Math.min(desired,6);
    // Yield to circulating traffic before entering, never to an imaginary signal in the middle of the roundabout.
    if(!a.edge.roundabout&&remaining<10&&this.roads.outgoing[a.edge.to].some(e=>e.roundabout)){
     const entry=routePoint(a.edge,a.edge.length),b=this.cars.find(b=>b!==a&&b.edge?.roundabout&&Math.hypot(b.x-entry.x,b.z-entry.z)<13)||this.externalObstacles.find(b=>b.edge?.roundabout&&Math.hypot(b.x-entry.x,b.z-entry.z)<13);
     if(b){const v=Math.max(0,(remaining-4)*1.2);if(v<desired){desired=v;hold='give way';holdBy=b;}}
    }
    // Gridlock (cars waiting on each other in a closed loop): the lowest id squeezes past the car it waits
    // for when the player is near, and is recycled elsewhere. Junction and track rules keep this rare.
    if(a.unjam&&(this.time>a.unjamUntil||a.unjam.edge===null))a.unjam=null;
    a.gridlock=this.inGridlock(a)?(a.gridlock||0)+dt:0;
    if(a.gridlock>1.5){a.gridlock=0;if(Math.hypot(a.x-player.x,a.z-player.z)>60)a.deadlocked=true;else{a.unjam=a.holdBy;a.unjamUntil=this.time+5;}}
    const zone=this.zoneLimit(a,plan,tramList);
    if(zone<desired){desired=zone;hold=this.zoneWhy;holdBy=this.zoneBy;}
    if(a.passing!=null&&!(this.cars[a.passing]?.edge&&trafficFootprintsOverlap(a,this.cars[a.passing])))a.passing=null;
    for(const b of traffic){if(b===a||b.edge===null)continue;const x=b.x-a.x,z=b.z-a.z;if(x>20||x<-20||z>20||z<-20)continue;
     if(b.ref?.parked||b.ref?.standing)continue; // standing buses: checked along the lane actually driven, below
     const forward=x*dx+z*dz;if(forward<=0||forward>=20||Math.abs(x*dz-z*dx)>=2.1||this.passes(a,b)||oncomingPasses(a,b))continue;
     const v=Math.max(0,(forward-6)*.85);if(v<desired){desired=v;hold='follow';holdBy=b.ref||b;}
    }
    if(this.standing?.length)for(const d of [3,6,10,15]){if(a.s+d>a.edge.length)break;const q=routePoint(a.edge,a.s+d,a.offset??a.edge.lane);if(this.standingAt(q)){const v=Math.max(0,(d-3.5)*.85);if(v<desired){desired=v;hold='follow';holdBy=null;}break;}}
    a.hold=hold;a.holdBy=holdBy;a.atSignal=hold==='signal';
   }
   a.speed+=Math.max(-7*dt,Math.min((running?8:a.walking?2:2.2)*dt,desired-a.speed));
   if(!a.walking)a.speed=Math.min(edgeTopSpeed(a.edge,TRAFFIC_MAX_SPEED),a.speed);
   const oldS=a.s,oldEdge=a.edge,oldPrev=a.prevDir;a.s+=a.speed*dt;
   if(a.s>=a.edge.length){const next=a.walking?this.nextEdge(a):a.plan.length?a.plan.shift():this.pickNext(a.edge);if(!a.walking)a.prevDir=edgeEndDirection(a.edge);if(!next){a.s=oldS;this.retire(a,player,!a.walking&&Math.hypot(a.x-player.x,a.z-player.z)>40);continue;}if(a.walking&&next.crossing&&!this.world.roads.at(a.x,a.z)&&!this.crossingClear(next,player)){a.s=oldS;a.speed=0;continue;}a.s-=a.edge.length;a.edge=next;}
   const p=this.position(a);
   // Undo a step that cannot be taken; a car keeps its planned route.
   const undo=by=>{if(a.edge!==oldEdge){a.plan?.unshift(a.edge);a.prevDir=oldPrev;}a.s=oldS;a.edge=oldEdge;a.speed=0;a.waiting=(a.waiting||0)+dt;a.stuck=(a.stuck||0)+dt;if(!a.walking){a.hold=by?'contact':'road';a.holdBy=by;}};
   if(!a.walking){let by=sweptContact(a,p,player)?player:null;
    if(!by)for(const b of this.cars){if(b===a||!b.edge)continue;const x=b.x-p.x,z=b.z-p.z;if(x>5.2||x<-5.2||z>5.2||z<-5.2||!trafficFootprintsOverlap(p,b)||!yieldsTo(a,b))continue;if(this.passes(a,b)){a.passing=b.id;continue;}by=b;break;}
    by||=this.bodyBlocking(a,p);
    if(by){undo(by);if(a.stuck>4)this.retire(a,player);continue;}}
   // The last half-step out of a crossing is still part of that crossing. Testing
   // it as an ordinary footway strands pedestrians on the road and blocks cars.
   const segmentEdge=a.walking&&oldEdge.crossing?oldEdge:a.edge;
   if(this.world.buildings.at(p.x,p.z)||(a.walking?(!this.walkable(p.x,p.z,a.edge)||!this.safeWalkSegment(a,p,segmentEdge)):!safeVehicleSegment(a,p,this.world))){undo(null);
    // A lane that runs off the mapped carriageway never clears; recycle it once it is not right beside the player.
    if(a.stuck>3)this.retire(a,player,!a.walking&&a.stuck>8&&Math.hypot(a.x-player.x,a.z-player.z)>40);continue;}
   // Tiny successful steps between repeated failures are not real progress.
   // Previously they reset the recovery timer, leaving actors stuck indefinitely.
   if(!a.progressPoint||Math.hypot(p.x-a.progressPoint.x,p.z-a.progressPoint.z)>.5){a.stuck=0;a.progressPoint={x:p.x,z:p.z};}
   // Time spent without real progress (2 m), red lights included: a queue that never clears is stalled.
   if(!a.walking){if(!a.waitFrom||Math.hypot(p.x-a.waitFrom.x,p.z-a.waitFrom.z)>2){a.waitFrom={x:p.x,z:p.z};a.waiting=0;}else a.waiting=(a.waiting||0)+dt;}
   Object.assign(a,p);
  }
  // The impact pass owns contact resolution. Do not push the player sideways
  // into a second, differently sized envelope and lock them there. Existing
  // overlap can retreat; only motion farther into traffic is stopped here.
  const next={...player,x:player.x-Math.sin(player.heading||0)*player.speed*dt,z:player.z-Math.cos(player.heading||0)*player.speed*dt};
  for(const a of this.cars)if(a.edge&&trafficFootprintsOverlap(player,a)&&sweptContact(player,next,a)){
   if(a.knocked&&a.knocked.at>=this.time-dt)continue; // the impact pass already shoved it this frame
   // Both cars move: shove the other one and let the player keep the rest of the speed (crash-physics.js).
   const impulse=player.travelMode&&player.travelMode!=='car'?null:this.knock(a,player,next);
   if(impulse)player.speed=playerSpeedAfter(player,impulse);else{player.speed=0;a.speed=0;}
  }
 }
 // The player's sweep from `from` to `car` hit NPC `a`: shove it (see crash-physics.js). Returns the impulse,
 // or null when the cars were not really closing on each other.
 knock(a,from,car){
  if(this.cars[a.id]!==a||!a.edge||a.walking)return null;
  const impulse=crashImpulse(from,car,a);if(!impulse)return null;
  knockCar(a,impulse,this.time);this.collisions++;if(!impulse.push)this.onCrash?.(a,impulse);return impulse;
 }
 snapshot(){return {time:this.time,collisions:this.collisions,cars:this.cars.filter(a=>a.edge).map(({x,z,speed,heading})=>({x,z,speed,heading})),people:this.people.filter(a=>a.edge).map(({id,x,z,speed,heading,running,edge})=>({id,x,z,speed,heading,running,crossing:edge.crossing,onRoad:!!this.world.roads.at(x,z)}))};}
}
