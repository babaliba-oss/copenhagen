// Pure simulation: routes come from Helsinki's measured mobility network.
import {crashImpulse,knockCar,stepKnocked,playerSpeedAfter,REST_RECYCLE_AFTER} from './crash-physics.js';
import {vehicleFitsRoad,safeVehicleSegment,trafficFootprintsOverlap,markWalledLanes} from './road-safety.js';
import {cornerSpeedLimit,edgeCruise,approachCruise,edgeTopSpeed,carLane} from './traffic-driving.js';
import {sweptContact} from './contact-geometry.js';
import {annotateJunctions,annotateCrossings,annotateTramRelations,annotateTramSignals,signalGreen as phaseGreen,tramThreat,boxesOverlap,carBox,oncomingPasses,CAR_HALF_LENGTH} from './lane-model.js';
const STANDING_PROBES=[3,6,10,15]; // metres ahead checked for a standing bus
const NEXT_ONE=[null],NO_EDGES=[]; // the next planned edge, passed to cornerSpeedLimit without a fresh array per car
// Walker grid cells (mobility step): a 1024-slot hash of 1.5 m cells; collisions only cost a distance test.
const WALK_CELLS=1024,walkCell=(gx,gz)=>(Math.imul(gx,73856093)^Math.imul(gz,19349663))&(WALK_CELLS-1);
import {mergeGraph} from './graph-extension.js';
import {inWaterPolygons} from './geo.js';
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
// A vehicle longer than a car (1760: coach and pair, COACH_HALF_LENGTH) carries its size to the footprints it is tested with.
const sized=(p,a)=>{if(a.halfLength!==undefined){p.halfLength=a.halfLength;p.halfWidth=a.halfWidth;}return p;};
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
export function approachingPedestrian(person,car,lateral=5.5){ // lateral: how far from the car's line the person counts as in its way
 const speed=Math.abs(car.speed||0);if(speed<2)return false;
 const vx=-Math.sin(car.heading||0)*car.speed,vz=-Math.cos(car.heading||0)*car.speed,dx=person.x-car.x,dz=person.z-car.z;
 const t=(dx*vx+dz*vz)/(speed*speed);
 return t>-.15&&t<2.2&&Math.hypot(dx-vx*Math.max(0,t),dz-vz*Math.max(0,t))<lateral&&Math.hypot(dx,dz)<Math.min(28,8+speed*1.7);
}
// Whether the player's approach makes a walker run (flee below). Only a car (or the 1760 coach) does: on foot, on a bike
// or a scooter the player passes without anyone running. A walker on the pavement beside a car that keeps to the road
// runs only when the car would pass within 2 m (about to mount the kerb); a car off the road, on a square or the
// pavement, sends anyone within 5.5 m of its line running. Before, a car driving down any street at more than 7 km/h
// set the whole pavement running.
export function threatens(person,player,roads){
 if(player.travelMode&&player.travelMode!=='car')return false;
 if(!approachingPedestrian(person,player,5.5))return false; /* the wide test first: two road lookups a walker a frame (300 walkers) for nobody near the car's line */
 return !(roads?.at(player.x,player.z)&&!roads.at(person.x,person.z))||approachingPedestrian(person,player,2);
}
// Recycle a car that has made no real progress this long when it is away from the player (last resort).
const STALLED_AFTER=40;
// How far ahead a car plans its route, and so how far it looks for junctions and tram tracks.
const LOOKAHEAD=45;
// Same direction only: the car behind gives way when two footprints touch (merging lanes); the leader may pull away.
// Side by side, the lower id goes first. Previously both refused to move and deadlocked forever.
const yieldsTo=(a,b)=>{if(Math.cos(a.heading-b.heading)<.9)return true;const forward=(b.x-a.x)*-Math.sin(a.heading)+(b.z-a.z)*-Math.cos(a.heading);return forward>.3||(forward>-.3&&b.id<a.id);};
export class Mobility {
 constructor(data,world,{cars=52,people=100,stationCars=0,corridorCars=0,corridor=null,random=Math.random,walkSpawn=200,walkRecycle=330,streetWalking=false}={}){
  this.walkSpawn=walkSpawn;this.walkRecycle=walkRecycle;this.streetWalking=streetWalking; /* 1760: no pavements, people walk in the street (walkable) and give way to coaches (coachYield) */this.spawnBudget=6; // walkers appear within walkSpawn m of the player and are recycled past walkRecycle
  this.roads=prepareGraph(data.roads);this.walks=prepareGraph(data.walks);this.signals=data.signals;this.signalControl=annotateJunctions(this.roads,data.signals||[]);annotateCrossings(this.walks,this.signalControl);this.signalAxes=this.signalControl.axes;this.world=world;this.random=random;this.time=0;this.collisions=0;this.externalObstacles=[];this.externalBodies=[];this.trams=null;this.edgeCars=new Map();this.boxCars=new Map();this.approaching=new Map();
  if(world?.laneWalls)this.walledLanes=markWalledLanes(this.roads.edges,world.laneWalls); // lanes through a wall the model draws on the road (road-walls.json) are routed round
  this.stationEdges=this.roads.edges.filter(e=>e.points.some(([x,z])=>inStationTrafficArea({x,z})));
  // Main-road pool: extra cars that live only on a busy corridor (e.g. Olympia terminal → Kauppatori), both directions.
  this.corridor=corridor;this.corridorEdges=corridor?this.roads.edges.filter(e=>e.length>10&&corridor(...e.points[Math.floor(e.points.length/2)])):[];
  this.corridorIds=new Set(this.corridorEdges.map(e=>e.id));
  this.cars=Array.from({length:cars+stationCars+(this.corridorEdges.length?corridorCars:0)},(_,id)=>({id,stationOnly:id>=cars&&id<cars+stationCars,corridorOnly:id>=cars+stationCars,walking:false,edge:null,s:0,speed:0,cruise:6+random()*5,x:0,z:0,heading:0}));
  // side: each walker's own distance to the right of the path's line (0.2-0.9 m, spread by id so seeded runs keep their random sequence)
  this.people=Array.from({length:people},(_,id)=>({id,walking:true,edge:null,s:0,speed:0,dodge:0,yieldSide:undefined,yieldHeld:0,unpocket:false,cruise:.85+random()*.65,side:.2+(id*.6180339887%1)*.7,x:0,z:0,heading:0}));
 }
 // Trams share the street: tracks are related to lanes once, and their positions are read every step.
 attachTrams(trams){this.trams=trams;annotateTramRelations(this.roads.edges,trams.paths);annotateTramSignals(trams.paths,this.signals||[],this.signalControl);}
 // Buses stop at the same junction stop lines, in the same signal groups, as cars and trams.
 attachBuses(buses){this.buses=buses;annotateTramSignals(buses.paths,this.signals||[],this.signalControl);buses.keepBaysClear?.(box=>this.laneTaken(box));}
 // Existing actor routes, claimed cars, panic and contact state survive a
 // streamed region. Only derived junction and route lookup data is refreshed.
 appendRegion(data){
  const offset=this.signals.length,roads=this.roads.edges.length,walks=this.walks.edges.length;
  this.signals.push(...data.signals);mergeGraph(this.roads,data.roads,offset);mergeGraph(this.walks,data.walks,offset);this.roads._grid=this.walks._grid=this.roads._long=null;this.parkedKey=null;
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
  if(a.walking)return this.walkerPlace(a,p);
  // Slide to the new lateral offset at a walking pace rather than jumping 1.8 m sideways in one frame.
  if(a.offset===undefined||!(this.dt>0))a.offset=target;else{const max=1.4*this.dt;a.offset+=Math.max(-max,Math.min(max,target-a.offset));}
  if(Math.abs(a.offset-target)>.01){const eased=routePoint(a.edge,a.s,a.offset,nextDir,prevDir);if(vehicleFitsRoad(eased,this.world))return sized(eased,a);a.offset=target;}
  return sized(p,a);
 }
 // Back onto the lane from where a knock left the car: the nearest point of its own edge, if it is close and the car still
 // faces roughly that way; the lateral offset then eases back to the lane (position()) instead of jumping.
 rejoinLane(a){
  const e=a.edge;if(!e?.points?.length)return false;let best=Infinity,bs=0,acc=0;
  for(let i=1;i<e.points.length;i++){const [ax,az]=e.points[i-1],[bx,bz]=e.points[i],dx=bx-ax,dz=bz-az,l=Math.hypot(dx,dz);if(!l)continue;const t=Math.max(0,Math.min(1,((a.x-ax)*dx+(a.z-az)*dz)/(l*l))),d=Math.hypot(a.x-ax-dx*t,a.z-az-dz*t);if(d<best){best=d;bs=acc+t*l;}acc+=l;}
  const c=routePoint(e,Math.min(e.length,bs),0),turn=Math.abs(Math.atan2(Math.sin(a.heading-c.heading),Math.cos(a.heading-c.heading)));
  if(best>4||turn>1.1)return false;
  a.s=Math.min(e.length-.01,bs);a.offset=(a.x-c.x)*Math.cos(c.heading)-(a.z-c.z)*Math.sin(c.heading);a.speed=0;a.waiting=0;a.stuck=0;return true;
 }
 // A walker's place across the path: its own side distance to the right of the way it walks, halved where the
 // path is too narrow for it, and eased (round corners, onto a reversed edge) rather than jumped. Everybody used
 // to walk the line itself, so people walking together, or waiting at the same kerb, stood inside one another.
 walkerPlace(a,p){
  const rx=Math.cos(p.heading),rz=-Math.sin(p.heading);let side=a.yieldSide??(a.side||0)+(a.dodge||0); // dodge: a step aside for someone in the way (walkDodge); yieldSide: out of a coach's way (coachYield)
  while(Math.abs(side)>.08&&!this.walkable(p.x+rx*side,p.z+rz*side,a.edge))side*=.5;
  if(Math.abs(side)<=.08)side=0;
  const tx=rx*side,tz=rz*side;
  if(a.ox===undefined||!(this.dt>0)){a.ox=tx;a.oz=tz;}
  else{const ex=tx-a.ox,ez=tz-a.oz,l=Math.hypot(ex,ez),max=(a.yieldSide!==undefined?1.8:a.dodge?1.2:.7)*this.dt;if(l>max){a.ox+=ex/l*max;a.oz+=ez/l*max;}else{a.ox=tx;a.oz=tz;}}
  if(!this.walkable(p.x+a.ox,p.z+a.oz,a.edge)){a.ox=tx;a.oz=tz;}
  p.x+=a.ox;p.z+=a.oz;return p;
 }
 // How fast a walker may go so as to stay a step behind whoever walks ahead of it the same way (a queue at a
 // kerb, a pair on a narrow pavement), or to leave room for someone standing just in front on another path (the
 // higher id waits). Walkers by 1.5 m cell come from step(); the limiting walker is kept in a.gapBy.
 walkGap(a,dx,dz){
  let v=Infinity;a.gapBy=null;const head=this._walkHead,next=this._walkNext,gx=Math.floor(a.x/1.5),gz=Math.floor(a.z/1.5);
  for(let ix=-1;ix<=1;ix++)for(let iz=-1;iz<=1;iz++)for(let j=head[walkCell(gx+ix,gz+iz)];j>=0;j=next[j]){const b=this.people[j];if(b===a)continue;
   const x=b.x-a.x,z=b.z-a.z,forward=x*dx+z*dz;if(forward<=.05||forward>1.6)continue;
   const lateral=Math.abs(x*dz-z*dx),same=-Math.sin(b.heading)*dx-Math.cos(b.heading)*dz>.3;
   if(same?lateral>=.5:forward*forward+lateral*lateral>=.6||a.id<b.id)continue;
   const u=Math.max(0,(forward-.7)*1.5);if(u<v){v=u;a.gapBy=b;}}
  return v;
 }
 // A step aside for a walker in view (the player sees people meet): from anyone within 90 cm across its way and a
 // little ahead (2.5 m when coming the other way), it moves to the side away from them, both keeping right when they
 // meet head on; walkerPlace eases it there. Walkers walked through each other where paths cross or come back the other
 // way (the riding ground, the squares): walkGap only holds back someone following, or the higher id about to touch.
 walkDodge(a,dx,dz){
  let push=0;const head=this._walkHead,next=this._walkNext,gx=Math.floor(a.x/1.5),gz=Math.floor(a.z/1.5);
  for(let ix=-2;ix<=2;ix++)for(let iz=-2;iz<=2;iz++)for(let j=head[walkCell(gx+ix,gz+iz)];j>=0;j=next[j]){const b=this.people[j];if(b===a)continue;
   const x=b.x-a.x,z=b.z-a.z;if(x>2.5||x<-2.5||z>2.5||z<-2.5)continue;
   const forward=x*dx+z*dz,right=x*-dz+z*dx,toward=-Math.sin(b.heading)*dx-Math.cos(b.heading)*dz<-.3&&b.speed>.1,reach=toward?2.5:.9;
   if(forward<-.3||forward>reach||right>.9||right<-.9)continue;
   const w=(1-Math.max(0,forward)/reach)*(1-Math.abs(right)/.9);push+=(right>.05?-w:right<-.05||toward||a.id>b.id?w:-w);}
  a.dodge=push>1?.6:push<-1?-.6:push*.6;
 }
 // 1760 (streetWalking): a walker in the street gives way to a coach coming along it, the player's or a traffic coach.
 // It steps to whichever side of the coach's line it is already on, far enough for the coach to pass (eased by walkerPlace),
 // and while it cannot get clear with the coach close it waits, or turns back when the coach has stopped for it (an oncoming
 // coach in a lane too narrow to step out of). Traffic coaches stop for anyone still in their way (step: walkers in the
 // street join the traffic list). Returns the speed the walker may go.
 coachYield(a,player,desired){
  let side,wait=false;const rx=Math.cos(a.heading),rz=-Math.sin(a.heading),bx=a.x-(a.ox||0),bz=a.z-(a.oz||0);
  for(let i=-1;i<this.cars.length;i++){const c=i<0?player:this.cars[i];if(i<0?c.travelMode&&c.travelMode!=='car':!c.edge||c.knocked)continue;
   const x=a.x-c.x,z=a.z-c.z;if(x>25||x<-25||z>25||z<-25)continue;
   const hx=-Math.sin(c.heading||0),hz=-Math.cos(c.heading||0),v=c.speed||0,hl=c.halfLength??CAR_HALF_LENGTH,hw=c.halfWidth??1,ahead=x*hx+z*hz;
   const standing=v<.3&&c.holdBy!==a; // standing (not for this walker): only walked round
   if(ahead<-hl-.5||ahead>hl+2+(standing?0:Math.max(0,v)*2.5))continue; // behind it or too far ahead
   const lat=-x*hz+z*hx,clear=hw+.6;if(Math.abs(lat)>=clear+.4)continue;
   const k=-hz*rx+hx*rz;if(Math.abs(k)<.5){if(v>=.3&&ahead>-hl-.5&&(Math.abs(lat)<clear||Math.abs(lat)<clear+1.5&&lat*(-hz*rz-hx*rx)<0))wait=true;continue;} // its path crosses the coach's: wait at the side for it to pass (one stopped for it is crossed in front of)
   const toward=Math.abs(lat)>.1?Math.sign(lat):(a.side||0)*k>=0?1:-1,base=-(bx-c.x)*hz+(bz-c.z)*hx;side=Math.max(-3,Math.min(3,(toward*(clear+(a.side||0)*.6)-base)/k)); /* each a little further by its own side, so two meeting there do not stand in one another */
   if(!standing&&Math.abs(lat)<clear-.05&&ahead>0&&ahead<hl+3){wait=true;if(c.holdBy===a&&v<.5&&(a.yieldHeld=(a.yieldHeld||0)+this.dt)>1.5){a.yieldHeld=0;this.scare(a,c,3);}}}
  a.yieldSide=side;if(!wait)a.yieldHeld=0;
  return wait?0:desired;
 }
 // The first walker (from step's traffic list) inside coach a's box at pose p, 10 cm grown.
 walkerUnder(p,a,traffic){
  const hx=-Math.sin(p.heading),hz=-Math.cos(p.heading),hl=(a.halfLength??CAR_HALF_LENGTH)+.1,hw=(a.halfWidth??1)+.1;
  for(let i=0;i<traffic.length;i++){const b=traffic[i];if(!b.walking)continue;const x=b.x-p.x,z=b.z-p.z;if(x>6||x<-6||z>6||z<-6)continue;const f=x*hx+z*hz,l=-x*hz+z*hx;if(f<hl&&f>-hl&&l<hw&&l>-hw)return b;}
  return null;
 }
 // Whether walker a's step to p goes into a traffic coach (one it is not already inside: it may walk out).
 coachOver(p,a){
  for(let i=0;i<this.cars.length;i++){const c=this.cars[i];if(!c.edge)continue;const x=p.x-c.x,z=p.z-c.z;if(x>6||x<-6||z>6||z<-6)continue;
   const hx=-Math.sin(c.heading),hz=-Math.cos(c.heading),hl=c.halfLength??CAR_HALF_LENGTH,hw=c.halfWidth??1,f=x*hx+z*hz,l=-x*hz+z*hx;if(f>=hl||f<=-hl||l>=hw||l<=-hw)continue;
   const ax=a.x-c.x,az=a.z-c.z,g=ax*hx+az*hz,m=-ax*hz+az*hx;if(g>=hl||g<=-hl||m>=hw||m<=-hw)return true;}
  return false;
 }
 // What lies under a point (0 building, 1 road, 2 pavement, 3 neither), memoised on a 25 cm grid: walkers ask
 // this for every 25 cm of every step, and three polygon lookups each was the biggest cost in a frame.
 groundKind(x,z){
  const w=this.world;if(this._kindOf!==w.buildings||this._kindRoads!==w.roads||this._kindPave!==w.pavement||this._kinds.size>80000){this._kinds=new Map(); /* 80k: a 500k map (~20 MB) freed at once stalled phones */this._kindOf=w.buildings;this._kindRoads=w.roads;this._kindPave=w.pavement;}
  const X=Math.round(x*4),Z=Math.round(z*4),k=(X+60000)*120000+(Z+60000);let v=this._kinds.get(k);
  if(v===undefined){const px=X/4,pz=Z/4;v=w.buildings.at(px,pz)?0:w.roads.at(px,pz)?1:w.pavement?.at(px,pz)?2:this.streetWalking&&inWaterPolygons(w.water,px,pz)?4:3;this._kinds.set(k,v);}
  return v;
 }
 // Today walkers keep to the pavement and use the carriageway only on a crossing. In 1760 there were no pavements: the
 // cobbled street and open ground are walkable too (houses, solid objects and water are not). Walkers there stood for good
 // at every "kerb" where a footway ran onto the carriageway or ground no pavement polygon covers (3,906 of 7,090 footways).
 walkable(x,z,edge){
  const v=this.groundKind(x,z);
  return v===2||v===1&&(this.streetWalking||!!edge?.crossing)||v===3&&this.streetWalking;
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
 // Spawn candidates are the same for every agent of a kind spawned in one frame from one spot: computed once.
 spawnCandidates(a,player,graph,compute){
  const key=(a.stationOnly?'s':a.corridorOnly?'c':a.walking?'w':'r')+Math.round(player.x/4)+','+Math.round(player.z/4)+','+this.time;
  if(!this._spawnCache||this._spawnCache.time!==this.time)this._spawnCache={time:this.time,lists:new Map()};
  let l=this._spawnCache.lists.get(key);if(!l)this._spawnCache.lists.set(key,l=compute());return l;
 }
 nearCorridor(player){return this.corridorEdges.some(e=>{const p=e.points[Math.floor(e.points.length/2)];return Math.hypot(p[0]-player.x,p[1]-player.z)<420;});}
 spawn(a,player){
  if(a.playerTaken){a.edge=null;a.speed=0;return;}
  a.knocked=undefined;a.damage=undefined; // not delete: a deleted property turns the agent into a slow dictionary object (and deoptimises step)
  if(a.stationOnly&&!nearStation(player)){a.edge=null;a.speed=0;return;}
  if(a.corridorOnly&&!this.nearCorridor(player)){a.edge=null;a.speed=0;return;}
  const graph=a.walking?this.walks:this.roads;
  // Prefer nearby routes; edge midpoint avoids choosing a remote end of a long road.
  const nearby=this.spawnCandidates(a,player,graph,()=>(a.stationOnly?this.stationEdges:a.corridorOnly?this.corridorEdges:this.edgesNear(graph,player,a.walking?this.walkSpawn:320)).filter(e=>{const p=e.points[Math.floor(e.points.length/2)],d=Math.hypot(p[0]-player.x,p[1]-player.z);return (!a.walking||!e.crossing)&&d<(a.walking?200:a.corridorOnly?520:320)&&e.length>(a.walking?3:10)&&!(!a.walking&&(this.obstructed?.has(e)||this.trap(e,2)));}));
  let occupancy=null; // walkers per edge, counted once per spawn rather than once per trial
  for(let trial=0;trial<80&&nearby.length;trial++){
   a.edge=nearby[Math.floor(this.random()*nearby.length)];a.s=this.random()*a.edge.length;a.plan=[];a.prevDir=undefined;a.ox=undefined;a.gapBy=null;a.gapHeld=0;
   const p=this.position(a);
   if(a.stationOnly&&!inStationTrafficArea(p))continue;
   if(!a.walking&&(this.cars.some(b=>b!==a&&b.edge&&trafficFootprintsOverlap(p,b))||this.hitsBody(carBox(p,1))||this.inConflict(a.edge,a.s)))continue;
   // Walkers spread out: at most one per 8 m of footway. Where few paths are near (a pier, a quay between
   // canals) the 300 walkers otherwise all landed on the same few edges and moved about as one clump.
   if(a.walking){if(!occupancy){occupancy=new Map();for(const b of this.people)if(b!==a&&b.edge)occupancy.set(b.edge,(occupancy.get(b.edge)||0)+1);}if((occupancy.get(a.edge)||0)>=Math.max(1,a.edge.length/8))continue;}
   if(this.streetWalking&&(a.walking?this.cars:this.people).some(b=>b.edge&&Math.abs(b.x-p.x)<4.5&&Math.abs(b.z-p.z)<4.5))continue; // 1760: not under a coach, nor a coach on top of someone
   if(this.world.buildings.at(p.x,p.z)||(a.walking?!this.walkable(p.x,p.z,a.edge):!vehicleFitsRoad(p,this.world)))continue;
   // A long straight main road is almost always in view; corridor cars may appear there, but only in the far haze.
   const distance=Math.hypot(p.x-player.x,p.z-player.z);
   if(distance<12||(this.visibilityTest?.(p)&&(a.walking?this.time>3&&!this.resetting&&distance<70:!(a.corridorOnly&&distance>300))))continue; // walkers too: people appeared on the pavement ahead
   if(!a.walking){const dx=p.x-player.x,dz=p.z-player.z,along=-dx*Math.sin(player.heading||0)-dz*Math.cos(player.heading||0),side=Math.abs(dx*Math.cos(player.heading||0)-dz*Math.sin(player.heading||0));if(along>-24&&along<(this.time<3?95:45)&&side<4.5)continue;} // a clear first 95 m when the drive starts
   if(!a.walking&&(this.cars.some(b=>b!==a&&b.edge&&Math.hypot(p.x-b.x,p.z-b.z)<8)||this.externalObstacles.some(o=>o.edge!==null&&Math.hypot(p.x-o.x,p.z-o.z)<8)))continue; // nor on a police unit, bus or tram (they blocked each other until one retired)
   Object.assign(a,p);a.offset=undefined;a.prevDir=undefined;a.speed=edgeCruise(a.edge,a.cruise);a.waiting=0;a.passing=null;a.unjam=null;a.gridlock=0;a.hold=null;a.holdBy=null;a.deadlocked=false;a.hiddenFor=0;a.panicUntil=0;a.running=false;a.stuck=0;a.progressPoint={x:p.x,z:p.z};return;
  }
  a.edge=null;a.speed=0;
 }
 // A reset (restart, map jump) respawns everyone against the old view's frustum: no visibility rule for walkers then.
 reset(player){this.resetting=true;try{this.updateParked();for(const a of [...this.cars,...this.people]){a.edge=null;a.playerTaken=undefined;a.conversation=undefined;}for(const a of [...this.cars,...this.people])this.spawn(a,player);}finally{this.resetting=false;}}
 canRecycle(a,player){return Math.hypot(a.x-player.x,a.z-player.z)>80&&(a.hiddenFor||0)>2;}
 retire(a,player,force=false){a.speed=0;
  // A walker at the end of its path or stuck there turns back (or stands) while you can see it: recycled on the spot it
  // vanished in front of you (two walkers met on a path, stood inside each other and were gone; the 1760 riding ground).
  if(a.walking&&!force&&a.edge&&(a.hiddenFor||0)<1.5&&Math.hypot(a.x-player.x,a.z-player.z)<120){const back=this.walks.outgoing[a.edge.to]?.find(e=>e.to===a.edge.from&&Math.abs(e.length-a.edge.length)<.8);if(back&&(a.turnedAt===undefined||this.time-a.turnedAt>2)){a.s=Math.max(0,back.length-a.s);a.edge=back;a.turnedAt=this.time;a.stuck=0;a.progressPoint=null;}return;}
  if(force||a.walking||this.canRecycle(a,player))a.edge=null;}
 // Lanes a parked bus stands in (mapped bays on the carriageway) are avoided when routing allows; a car that
 // must pass one steers around it (position()).
 // Never spawn inside a junction box or on a tram conflict: a car must have arrived there under the rules.
 inConflict(e,s){if(e.startGap&&s<e.startGap&&this.roads.junctionNode?.[e.from])return true;return this.zonesOf(e).some(z=>s>z.start-CAR_HALF_LENGTH-1&&s<z.end+CAR_HALF_LENGTH+1);}
 standingAt(p){for(const b of this.standing)if(Math.abs(b.x-p.x)<9&&Math.abs(b.z-p.z)<9&&boxesOverlap(carBox(p,.3),b))return true;return false;}
 updateParked(){
  let key='';for(const b of this.externalBodies)if(b.ref?.parked||b.ref?.standing)key+=`${Math.round(b.x)},${Math.round(b.z)};`;
  if(key===this.parkedKey)return;this.parkedKey=key;this.obstructed=new Set();
  const parked=this.standing=this.externalBodies.filter(b=>b.ref?.parked||b.ref?.standing);if(!parked.length)return;
  const G=this.roads;G._long??=G.edges.filter(e=>e.length>200);const near=new Set(G._long);for(const b of parked)for(const e of this.edgesNear(G,b,115))if(e.length<=200)near.add(e); /* edges by midpoint around each body (+ the few long ones), not all 44k: a bus pulling in or out of a stand re-ran this over the whole city (5-28 ms) */
  for(const e of near){const m=e.points[Math.floor(e.points.length/2)];if(!parked.some(b=>Math.hypot(b.x-m[0],b.z-m[1])<e.length/2+15))continue;
   for(let s=0;s<=e.length;s+=2){const p=routePoint(e,s);if(parked.some(b=>boxesOverlap(carBox(p),b))){this.obstructed.add(e);break;}}}
 }
 // An edge whose lane runs off the mapped carriageway somewhere would stop a car there for good: route
 // around it when there is a choice. Checked once per edge, when a car first considers it.
 fits(e){if(e.fits===undefined){e.fits=true;for(let s=Math.min(1,e.length/2);s<e.length;s+=2)if(!vehicleFitsRoad(routePoint(e,s),this.world)){e.fits=false;break;}}return e.fits;}
 trap(e,depth){
  if(!this.fits(e))return true;if(!depth)return false;
  const key=depth*1e6+e.id;this.traps??=new Map();if(this.traps.has(key))return this.traps.get(key);
  this.traps.set(key,false);let next=this.roads.outgoing[e.to].filter(o=>o.to!==e.from);if(!next.length)next=this.roads.outgoing[e.to]; // a dead end goes on by its U-turn: a trap when that lane is (1760: the way back along a wall)
  const result=next.length>0&&next.every(o=>this.trap(o,depth-1));
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
 hold(a,seconds){if(a.walking&&!a.edge?.crossing)a.holdUntil=this.time+seconds;} // never frozen on a zebra crossing (cars queued behind them)
 flee(a,player){
  const threatened=this.streetWalking?(!player.travelMode||player.travelMode==='car')&&approachingPedestrian(a,player,2.2):threatens(a,player,this.world.roads); // 1760: everyone is in the street; only those about to be run down run, the rest step aside (coachYield)
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
   if(cars)for(let ci=0;ci<cars.length;ci++){const b=cars[ci];if(b===a||b.speed>4||b===a.unjam)continue;const d=base+b.s;if(d>start&&d<=limit){this.zoneBy=b;return true;}}
   base+=e.length;}
  // The way through the block itself: a stopped car standing in it (waiting at another approach's stop line
  // on a corner the lane cuts) would leave this car stuck half way.
  const still=this._still||(this._still=[]);still.length=0;for(let ci=0;ci<this.cars.length;ci++){const b=this.cars[ci];if(b!==a&&b.edge&&b.speed<3&&b!==a.unjam&&Math.abs(b.x-a.x)<end+8&&Math.abs(b.z-a.z)<end+8)still.push(b);} // reused list: called per car per step near junctions
  if(still.length)for(let d=Math.max(start,CAR_HALF_LENGTH+1);d<=end+CAR_HALF_LENGTH;d+=2){const p=this.routeAt(a,plan,d);if(!p)break;for(const b of still)if(Math.abs(b.x-p.x)<6&&Math.abs(b.z-p.z)<6&&boxesOverlap(carBox(p),carBox(b))){this.zoneBy=b;return true;}}
  if(this.externalBodies.length){const p=this.routeAt(a,plan,end+CAR_HALF_LENGTH+.5);if(p)for(const body of this.externalBodies){if(Math.abs(body.x-p.x)>20||Math.abs(body.z-p.z)>20||(body.speed||0)>2)continue;if(boxesOverlap(carBox(p),body)){this.zoneBy=body.ref||body;return true;}}}
  return false;
 }
 wayThrough(a,plan,start,end){const way=[];for(let d=Math.max(start,0);d<=end+CAR_HALF_LENGTH;d+=1.5){const p=this.routeAt(a,plan,d);if(!p)break;way.push(p);}return way;}
 routeAt(a,plan,d){let s=a.s+d;for(let i=-1;i<plan.length;i++){const e=i<0?a.edge:plan[i];if(s<=e.length)return routePoint(e,s,e.lane);s-=e.length;}return null;}
 // A turn whose blended corner clips a kerb by a few centimetres (narrow streets meeting at a sharp angle, as in
 // Christianshavn) undid every step a car took there: it stood across the junction for good, beside the player where
 // nothing recycles it, and the cars giving way to it or queued behind it waited too. After half a second of that, a step
 // through the corner whose centre is still on the carriageway is taken anyway.
 kerbCorner(a,p,oldEdge){if(!((a.stuck||0)>.5||this.time<(a.kerbUntil||0))||!(a.edge!==oldEdge||a.s<CORNER_BLEND+1||a.edge.length-a.s<CORNER_BLEND+1)||!this.world.roads.at(p.x,p.z)||this.world.trafficForbidden?.at(p.x,p.z))return false;a.kerbUntil=this.time+1.5;return true;} // then through the rest of the corner without stopping again
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
  this.time+=dt;this.dt=dt;let spawns=0;
  // Per step rather than per car: who is on which edge, and everything a car must not drive into.
  // The per-key lists go back to a pool instead of being dropped (a few hundred fresh arrays a step).
  const pool=this.listPool??=[];for(const m of [this.edgeCars,this.boxCars,this.approaching]){for(const l of m.values()){l.length=0;pool.push(l);}m.clear();}
  const add=(map,key,c)=>{const list=map.get(key);if(list)list.push(c);else{const l=pool.pop()||[];l.push(c);map.set(key,l);}};
  for(let ci=0;ci<this.cars.length;ci++){const c=this.cars[ci];if(!c.edge||c.knocked)continue;add(this.edgeCars,c.edge,c);const e=c.edge,remaining=e.length-c.s;
   // Junction boxes: cars inside one (front past the stop line, or rear not yet out), and cars about to enter.
   if(e.junction&&remaining<e.stopGap-.3)add(this.boxCars,e.to,c);else if(e.junction&&remaining<e.stopGap+5)add(this.approaching,e.to,c);
   if(e.startGap&&c.s<e.startGap&&this.roads.junctionNode?.[e.from])add(this.boxCars,e.from,c);}
  // Indexed loops and reused lists in here: this runs every step for every agent, and for-of iteration and spread
  // copies were most of the garbage the game made per frame (collection pauses while driving).
  const traffic=this._traffic||(this._traffic=[]);traffic.length=0;traffic.push(player);for(let i=0;i<this.cars.length;i++)traffic.push(this.cars[i]);for(let i=0;i<this.externalObstacles.length;i++)traffic.push(this.externalObstacles[i]);
  // 1760: anyone walking (the cobbles are mapped as pavement too) within a 25 m cell of a coach's (every coach looks through this list)
  const coachCells=this.streetWalking?(this._coachCells||=new Set()):null;if(coachCells){coachCells.clear();for(let i=0;i<this.cars.length;i++){const c=this.cars[i];if(!c.edge)continue;const gx=Math.floor(c.x/25),gz=Math.floor(c.z/25);for(let u=-1;u<=1;u++)for(let w=-1;w<=1;w++)coachCells.add((gx+u)*65536+gz+w);}}
  for(let i=0;i<this.people.length;i++){const p=this.people[i];if(coachCells?p.edge&&!p.knockdown&&coachCells.has(Math.floor(p.x/25)*65536+Math.floor(p.z/25)):p.edge?.crossing&&this.world.roads.at(p.x,p.z))traffic.push(p);}
  // Walkers by 1.5 m cell in a fixed hash table (no garbage), for walkGap.
  {const head=this._walkHead||(this._walkHead=new Int32Array(WALK_CELLS)),chain=this._walkNext?.length>=this.people.length?this._walkNext:(this._walkNext=new Int32Array(this.people.length));head.fill(-1);
  for(let i=0;i<this.people.length;i++){const p=this.people[i];if(!p.edge||p.knockdown)continue;const h=walkCell(Math.floor(p.x/1.5),Math.floor(p.z/1.5));chain[i]=head[h];head[h]=i;}}
  const tramList=this.trams?.trams||[];this.updateParked();
  const undo=(a,oldS,oldEdge,oldPrev,by)=>{if(a.edge!==oldEdge){a.plan?.unshift(a.edge);a.prevDir=oldPrev;}a.s=oldS;a.edge=oldEdge;a.speed=0;a.waiting=(a.waiting||0)+dt;a.stuck=(a.stuck||0)+dt;if(!a.walking){a.hold=by?'contact':'road';a.holdBy=by;}};
  const nCars=this.cars.length,nAgents=nCars+this.people.length;
  for(let ai=0;ai<nAgents;ai++){const a=ai<nCars?this.cars[ai]:this.people[ai-nCars];
   if(a.playerTaken)continue;
   a.hiddenFor=(this.visibilityTest?this.visibilityTest(a):Math.hypot(a.x-player.x,a.z-player.z)<350)?0:(a.hiddenFor||0)+dt;
   if(a.knockdown){a.speed=0;a.running=false;continue;}
   if(a.walking&&this.time<(a.holdUntil||0)){a.speed=0;a.running=false;continue;}
   if(a.walking&&a.conversation){a.speed=0;continue;}
   // A car the player crashed into coasts on its own momentum, then sits where it stopped as an obstacle
   // until it is out of sight (or long enough has passed) and gets recycled like any other car.
   // A coach (1760: recoverKnocked set) that was shoved and has come to rest pulls back into its lane after a few seconds;
   // like a wrecked car it used to stand in the street, horses frozen, until you drove 80 m away.
   if(a.knocked&&this.recoverKnocked&&a.knocked.rest!=null&&this.time-a.knocked.rest>this.recoverKnocked&&this.rejoinLane(a)){a.knocked=undefined;continue;}
   if(a.knocked){if(!stepKnocked(a,dt,this.world,this.time,{cars:this.cars,obstacles:this.externalObstacles,knock:(b,pose,impulse)=>{if(this.cars[b.id]===b&&b.edge){knockCar(b,impulse,this.time);this.collisions++;}}})&&(this.time-a.knocked.rest>REST_RECYCLE_AFTER&&Math.hypot(a.x-player.x,a.z-player.z)>80&&!this.visibilityTest?.(a)||/* not while in view: wrecks vanished in front of the player */this.canRecycle(a,player)&&Math.hypot(a.x-player.x,a.z-player.z)>160)){a.knocked=undefined;a.damage=undefined;a.edge=null;this.spawn(a,player);}continue;}
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
   if(!a.edge||(Math.hypot(a.x-player.x,a.z-player.z)>(a.walking?this.walkRecycle:500)&&(a.walking||this.canRecycle(a,player)))){if(spawns++<this.spawnBudget||!a.edge&&this.time<3)this.spawn(a,player);continue;} // a few respawns per frame: after a turn dozens went at once (a hitch)
   // A car that has made no progress for a long time is holding up a queue: recycle it unless it is close by.
   // Away from the player a deadlocked car is recycled rather than squeezing through another one.
   if(!a.walking&&((a.waiting||0)>STALLED_AFTER||a.deadlocked)&&Math.hypot(a.x-player.x,a.z-player.z)>60){a.deadlocked=false;this.spawn(a,player);continue;}
   const running=a.walking&&this.flee(a,player);
   let desired=running?4.2+a.id%4*.2:a.cruise;const remaining=a.edge.length-a.s,dx=-Math.sin(a.heading),dz=-Math.cos(a.heading);
   if(a.walking){
    if(!running){const x=player.x-a.x,z=player.z-a.z,forward=x*dx+z*dz;if(forward>0&&forward<5&&Math.abs(x*dz-z*dx)<(this.streetWalking?(player.halfWidth??1)+.45:1.7))desired=Math.min(desired,Math.max(0,(forward-2.8)*.85));}
    if(a.edge.crossing&&a.s<.35&&!running&&!this.world.roads.at(a.x,a.z)&&!this.crossingClear(a.edge,player))desired=0;
    // Never on a crossing: someone waiting for a gap out on the carriageway would hold up the cars (and the cars them).
    if(!running&&desired>0&&!a.edge.crossing){const g=this.walkGap(a,dx,dz);
     if(g<desired){a.gapHeld=(a.gapHeld||0)+dt;let ring=false;
      // Walkers each waiting for the next round a ring would never move: after a while the lowest id in it steps on.
      if(a.gapHeld>4){let b=a.gapBy,min=a.id;for(let k=0;k<8&&b;k++){if(b===a){ring=min===a.id;break;}min=Math.min(min,b.id);b=b.gapBy;}}
      if(!ring)desired=g;}
     else a.gapHeld=0;}
    else{a.gapBy=null;a.gapHeld=0;}
    if(!running&&!a.edge.crossing&&a.hiddenFor===0)this.walkDodge(a,dx,dz);else a.dodge=0;
    if(this.streetWalking){if(!a.edge.crossing&&(coachCells.has(Math.floor(a.x/25)*65536+Math.floor(a.z/25))||Math.abs(player.x-a.x)<25&&Math.abs(player.z-a.z)<25)){const v=this.coachYield(a,player,desired);if(!running)desired=v;}else a.yieldSide=undefined;} // running from the player's coach, out of its way too
   }else{
    const plan=this.plan(a);let hold=null,holdBy=null;
    if(plan.length)NEXT_ONE[0]=plan[0];desired=cornerSpeedLimit(a.edge,a.s,approachCruise(edgeCruise(a.edge,desired),plan[0],desired,remaining),plan.length?NEXT_ONE:NO_EDGES);
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
    for(let ti=0;ti<traffic.length;ti++){const b=traffic[ti];if(b===a||b.edge===null)continue;const x=b.x-a.x,z=b.z-a.z;if(x>20||x<-20||z>20||z<-20)continue;
     if(b.ref?.parked||b.ref?.standing)continue; // standing buses: checked along the lane actually driven, below
     const forward=x*dx+z*dz,street=b.walking&&!b.edge.crossing;if(forward<=(street?(a.halfLength??CAR_HALF_LENGTH)-.3:0)||forward>=20||Math.abs(x*dz-z*dx)>=(street?(a.halfWidth??1)+.45:2.1)||this.passes(a,b)||oncomingPasses(a,b))continue;
     const v=Math.max(0,(forward-(a.halfLength??CAR_HALF_LENGTH)-(street?.5:b.halfLength??CAR_HALF_LENGTH)-1.3)*.85);if(v<desired){desired=v;hold='follow';holdBy=b.ref||b;} // stops ~1.3 m behind (6 m centres for two cars)
    }
    if(this.standing?.length)for(const d of STANDING_PROBES){if(a.s+d>a.edge.length)break;const q=routePoint(a.edge,a.s+d,a.offset??a.edge.lane);if(this.standingAt(q)){const v=Math.max(0,(d-3.5)*.85);if(v<desired){desired=v;hold='follow';holdBy=null;}break;}}
    a.hold=hold;a.holdBy=holdBy;a.atSignal=hold==='signal';
   }
   a.speed+=Math.max(-7*dt,Math.min((running?8:a.walking?2:2.2)*dt,desired-a.speed));
   if(!a.walking)a.speed=Math.min(edgeTopSpeed(a.edge,TRAFFIC_MAX_SPEED),a.speed);
   const oldS=a.s,oldEdge=a.edge,oldPrev=a.prevDir;a.s+=a.speed*dt;
   if(a.s>=a.edge.length){const next=a.walking?this.nextEdge(a):a.plan.length?a.plan.shift():this.pickNext(a.edge);if(!a.walking)a.prevDir=edgeEndDirection(a.edge);if(!next){a.s=oldS;this.retire(a,player,!a.walking&&Math.hypot(a.x-player.x,a.z-player.z)>40);continue;}if(a.walking&&next.crossing&&!this.world.roads.at(a.x,a.z)&&!this.crossingClear(next,player)){a.s=oldS;a.speed=0;continue;}a.s-=a.edge.length;a.edge=next;}
   const p=this.position(a);
   // A step that cannot be taken is undone (undo, above the loop); a car keeps its planned route.
   if(!a.walking){let by=sweptContact(a,p,player)?player:null;
    if(!by)for(let bi=0;bi<nCars;bi++){const b=this.cars[bi];if(b===a||!b.edge)continue;const x=b.x-p.x,z=b.z-p.z,r=(a.halfLength??CAR_HALF_LENGTH)+(b.halfLength??CAR_HALF_LENGTH)+.5;if(x>r||x<-r||z>r||z<-r||!trafficFootprintsOverlap(p,b)||!yieldsTo(a,b))continue;if(this.passes(a,b)){a.passing=b.id;continue;}by=b;break;}
    by||=this.bodyBlocking(a,p);
    if(!by&&this.streetWalking){const b=this.walkerUnder(p,a,traffic);if(b&&this.walkerUnder(a,a,traffic)!==b)by=b;} // 1760: a coach stops rather than drive into someone in the street (moving off one is allowed)
    if(by){undo(a,oldS,oldEdge,oldPrev,by);if(a.stuck>4)this.retire(a,player);continue;}}
   // The last half-step out of a crossing is still part of that crossing. Testing
   // it as an ordinary footway strands pedestrians on the road and blocks cars.
   const segmentEdge=a.walking&&oldEdge.crossing?oldEdge:a.edge;
   if(this.world.buildings.at(p.x,p.z)||(a.walking?(!this.walkable(p.x,p.z,a.edge)||!a.unpocket&&!this.safeWalkSegment(a,p,segmentEdge)||coachCells?.has(Math.floor(p.x/25)*65536+Math.floor(p.z/25))&&this.coachOver(p,a)):!safeVehicleSegment(a,p,this.world)&&!this.kerbCorner(a,p,oldEdge))){undo(a,oldS,oldEdge,oldPrev,null);
    // A walker whose step aside put it in a pocket of pavement between house corners (the 25 cm ground grid) could step
    // neither on nor back: it turned round every 3 s for good at the door end of a path. After a second and a half it steps
    // back onto the path's line.
    if(a.walking&&a.stuck>1.5&&(a.ox||a.oz)){a.ox=0;a.oz=0;a.unpocket=true;}
    // A lane that runs off the mapped carriageway never clears; recycle it once it is not right beside the player.
    if(a.stuck>3)this.retire(a,player,!a.walking&&a.stuck>8&&Math.hypot(a.x-player.x,a.z-player.z)>40);continue;}
   // Tiny successful steps between repeated failures are not real progress.
   // Previously they reset the recovery timer, leaving actors stuck indefinitely.
   if(!a.progressPoint||Math.hypot(p.x-a.progressPoint.x,p.z-a.progressPoint.z)>.5){a.stuck=0;if(a.progressPoint){a.progressPoint.x=p.x;a.progressPoint.z=p.z;}else a.progressPoint={x:p.x,z:p.z};}
   // Time spent without real progress (2 m), red lights included: a queue that never clears is stalled.
   if(!a.walking){if(!a.waitFrom||Math.hypot(p.x-a.waitFrom.x,p.z-a.waitFrom.z)>2){if(a.waitFrom){a.waitFrom.x=p.x;a.waitFrom.z=p.z;}else a.waitFrom={x:p.x,z:p.z};a.waiting=0;}else a.waiting=(a.waiting||0)+dt;}
   a.unpocket=false;Object.assign(a,p);
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
