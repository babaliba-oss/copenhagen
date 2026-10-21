import {leavingBody,nudgeOut} from './contact-geometry.js';
import {prepareGraph,routePoint} from './mobility.js';
import {signalGreen,untilGreen,oncomingPasses} from './lane-model.js';

export const BUS_DIMENSIONS=Object.freeze({city:{length:12,width:2.55,height:3.3,wheelbase:6},coach:{length:12,width:2.55,height:3.3,wheelbase:6},trunk:{length:15,width:2.55,height:3.3,wheelbase:7.6},tourist:{length:11.4,width:2.55,height:4.3,wheelbase:5.6}});
const dims=a=>BUS_DIMENSIONS[a.kind]||{length:(a.halfLength??2.36)*2,width:(a.halfWidth??.98)*2};
const turn=(a,b)=>Math.atan2(Math.sin(b-a),Math.cos(b-a));
export function busSamples(p){const d=dims(p),c=Math.cos(p.heading),s=Math.sin(p.heading),out=[];for(let along=-d.length/2;along<=d.length/2+.01;along+=.5)for(const side of [-d.width/2,0,d.width/2])out.push([p.x+c*side+s*along,p.z-s*side+c*along]);return out;}
// Adjacent municipal road polygons do not always meet exactly: a hair-thin unmapped sliver at a seam is
// still road if there is mapped road on both sides of it. Buses used to stall on those for good.
const SEAM=.4;
function onRoad(world,x,z){if(world.roads.at(x,z))return true;return (world.roads.at(x+SEAM,z)&&world.roads.at(x-SEAM,z))||(world.roads.at(x,z+SEAM)&&world.roads.at(x,z-SEAM));}
// The footprint points of busSamples, tested as they are generated (no list, no closures: every bus, every step).
function freeAt(world,x,z){return onRoad(world,x,z)&&!world.buildings.at(x,z)&&!world.trafficForbidden?.at(x,z);}
export function busFitsRoad(p,world){
 if(!freeAt(world,p.x,p.z))return false;
 const d=dims(p),c=Math.cos(p.heading),s=Math.sin(p.heading),w=d.width/2;
 for(let along=-d.length/2;along<=d.length/2+.01;along+=.5)for(let k=-1;k<=1;k++){const side=k*w;if(!freeAt(world,p.x+c*side+s*along,p.z-s*side+c*along))return false;}
 return true;
}
export function busOverlaps(a,b,margin=0){const da=dims(a),db=dims(b),dx=b.x-a.x,dz=b.z-a.z;if(Math.hypot(dx,dz)>(da.length+db.length)/2+margin+3)return false;const axes=p=>[[Math.cos(p.heading),-Math.sin(p.heading)],[Math.sin(p.heading),Math.cos(p.heading)]],aa=axes(a),bb=axes(b);for(const v of [...aa,...bb]){const dot=u=>Math.abs(v[0]*u[0]+v[1]*u[1]);if(Math.abs(dx*v[0]+dz*v[1])>=(da.width/2+margin)*dot(aa[0])+(da.length/2+margin)*dot(aa[1])+db.width/2*dot(bb[0])+db.length/2*dot(bb[1]))return false;}return true;}
export function safeBusSweep(a,b,world){const distance=Math.hypot(b.x-a.x,b.z-a.z),angle=turn(a.heading,b.heading);if(distance>.02&&Math.abs(angle)/distance>1/8)return false;const n=Math.max(1,Math.ceil(distance/.35),Math.ceil(Math.abs(angle)*dims(a).length/.35));for(let i=0;i<=n;i++){const t=i/n;if(!busFitsRoad({...a,x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,heading:a.heading+angle*t},world))return false;}return true;}
// Lane assignment: a route line from GTFS or OpenStreetMap usually follows the middle of the street, so
// both directions would share it head-on. `lanes` (from scripts/bus-lanes.mjs) holds a right-hand offset
// every LANE_STEP metres, as far right as the bus fits; buses then keep to their own side like cars.
export const LANE_STEP=3,BUS_LANE_OFFSETS=[1.6,1.2,.8,.4];
export function laneOffset(path,s){const l=path.lanes;if(!l?.length)return 0;const i=Math.max(0,Math.min(l.length-1,s/LANE_STEP)),k=Math.floor(i),t=i-k;return k+1<l.length?l[k]+(l[k+1]-l[k])*t:l[k];}
// `pull(s)` is an extra offset to the right: the bus pulling in to a stop and out again (busStopPull).
export function busPose(path,s,kind='city',pull=null){
 const at=s=>routePoint(path,s,laneOffset(path,s)+(pull?pull(s):0)),centre=at(s),front=at(s+3),rear=at(s-3);
 return {...centre,kind,heading:Math.atan2(rear.x-front.x,rear.z-front.z)};
}
// Bus stops (dated stop poles from the data, `data.stops`). A path takes the stops beside its right-hand kerb
// (doors side) within reach of its line, or exactly its own stops when the data lists them (`stopIds`).
// `s` is where the bus centre halts: the front door level with the pole.
export const BUS_STOP_REACH=12,BUS_PULL_IN=22,BUS_PULL_OUT=16;
export function assignBusStops(path,stops=[]){
 if(path.kind==='tourist'||path.kind==='coach')return []; // sightseeing and charter coaches keep off HSL stops
 const own=path.stopIds&&new Set(path.stopIds),half=dims(path).length/2,out=[];let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
 for(const [x,z] of path.points){x0=Math.min(x0,x);z0=Math.min(z0,z);x1=Math.max(x1,x);z1=Math.max(z1,z);}
 for(const stop of stops){if(own?!own.has(stop.id):stop.x<x0-BUS_STOP_REACH||stop.x>x1+BUS_STOP_REACH||stop.z<z0-BUS_STOP_REACH||stop.z>z1+BUS_STOP_REACH)continue;let best=own?25:BUS_STOP_REACH,at=null;
  for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz||1,t=Math.max(0,Math.min(1,((stop.x-a[0])*dx+(stop.z-a[1])*dz)/l2)),ox=stop.x-a[0]-dx*t,oz=stop.z-a[1]-dz*t,d=Math.hypot(ox,oz);
   if(d<best&&(own||ox*-dz+oz*dx>0||d<1)){best=d;at=path.cumulative[i-1]+Math.sqrt(l2)*t;}}
  const s=at-half+1.5;if(at!==null&&s>path.start+BUS_PULL_IN&&s<path.end-BUS_PULL_OUT&&!out.some(o=>Math.abs(o.s-s)<30))out.push({id:stop.id,name:stop.name,s,x:stop.x,z:stop.z});}
 return out.sort((a,b)=>a.s-b.s);
}
// Sideways ease towards the kerb over BUS_PULL_IN metres, back out over BUS_PULL_OUT after the stop.
export function busStopPull(stop,amount){const e=t=>t<=0?0:t>=1?1:t*t*(3-2*t);return s=>amount*(s<=stop.s?e((s-stop.s+BUS_PULL_IN)/(BUS_PULL_IN-6)):1-e((s-stop.s)/BUS_PULL_OUT));}
// How far the bus may pull in at a stop: the most of 1.6 m whose whole swept approach and departure stays on
// mapped road; a kerb-side lane or a narrow street keeps the bus in its lane (0).
export function stopPullFor(path,stop,kind,world){
 for(const amount of [1.6,1.2,.8,.4]){const pull=busStopPull(stop,amount);let ok=true,previous=null;
  for(let s=stop.s-BUS_PULL_IN;s<=stop.s+BUS_PULL_OUT&&ok;s+=1){const p=busPose(path,s,kind,pull);ok=busFitsRoad(p,world)&&(!previous||safeBusSweep(previous,p,world));previous=p;}
  if(ok)return amount;}
 return 0;
}
// Doors stay open for a few seconds; deterministic per bus and stop so replays match.
export const busDwell=(bus,stopIndex)=>4+((bus.id*3+stopIndex*7)%5);
// Dated GTFS stop and departure-shape evidence, not a guessed parking grid.
// A stop coordinate is often on the kerb: only accept a nearby, fully road-clear
// body pose on the departure shape. No pavement permission is introduced.
export function stationBayPoses(data,world){const result=[];
 for(const line of ['78','611','600']){const stop=data.stationStops?.find(s=>s.lines?.includes(line));if(!stop)continue;
  const source=data.paths.find(p=>p.line===line&&p.destination!=='Rautatientori'&&Math.hypot(p.points[0][0]-stop.x,p.points[0][1]-stop.z)<12);if(!source)continue;
  const a=source.points[0],b=source.points[1],length=Math.hypot(b[0]-a[0],b[1]-a[1]),dx=(b[0]-a[0])/length,dz=(b[1]-a[1])/length,heading=Math.atan2(-dx,-dz);let found;
  for(const along of [-3,0,3])for(const offset of [0,1,-1,2,-2]){const p={kind:source.kind,x:a[0]+dx*along-dz*offset,z:a[1]+dz*along+dx*offset,heading};if(!found&&busFitsRoad(p,world)&&!result.some(q=>busOverlaps(p,q,1))){found={...p,stopId:stop.id,platform:stop.platform,line,destination:source.destination,reference:'HSL 2026-09-16 station stop and departure shape; approximate standing position, not photo-surveyed bus pose'};}}
  if(found)result.push(found);
 }return result;
}
// Dense footprints/sweeps are checked once at load, not for every bus each frame.
// The GTFS line may lie between lanes. Try a consistent right offset per section;
// never snap a bus sideways frame-by-frame or send it onto random car roads.
export function usableBusPaths(data,world){const good=[];for(const source of data.paths||[]){if(source.kind==='tourist'&&!source.verified)continue;const graph=prepareGraph({nodes:[0,1],edges:[{...source,from:0,to:1,lane:0}]}),base=graph.edges[0];if(base.length<40)continue;
 for(const offset of [0,1.5,3]){const points=[];for(let s=0;s<base.length;s+=3){const p=routePoint(base,s,offset);points.push([p.x,p.z]);}const end=routePoint(base,base.length,offset);points.push([end.x,end.z]);const path=prepareGraph({nodes:[0,1],edges:[{...source,points,from:0,to:1,lane:0,offset}]}).edges[0];path.id=source.id;let start=null,previous=null;
  const finish=s=>{if(start!==null&&s-start>=60)good.push({...path,start:start+1,end:s-1,kind:source.kind||'city',segmentId:source.id+':'+offset+':'+start});start=null;};
  for(let s=8;s<=path.length-8;s+=3){const p=busPose(path,s,source.kind||'city'),valid=busFitsRoad(p,world)&&(!previous||safeBusSweep(previous,p,world));if(valid){if(start===null)start=s;}else finish(s-3);previous=p;}finish(path.length-8);
  // Prefer real GTFS lane location whenever it fits; do not double the fleet.
  if(good.some(p=>p.id===source.id))break;
 }}return good;}

// Lateral offsets for one usable path (prepared edge with start/end). `target(s)` gives the car lane of the
// same direction nearby (signed offset), so buses share lanes with cars; without one the bus keeps as far
// right as it fits. The offset changes by at most 0.15 m per metre, and every pose and sweep between start
// and end is checked like the route line was; where a shifted pose does not fit, that stretch falls back
// towards the verified line.
export function busLaneOffsets(path,world,kind=path.kind||'city',target=()=>null){
 const n=Math.ceil(path.length/LANE_STEP)+1,lanes=new Array(n).fill(0);
 const fits=(s,o)=>{const c=routePoint(path,s,o),f=routePoint(path,s+3,o),r=routePoint(path,s-3,o);return busFitsRoad({...c,kind,heading:Math.atan2(r.x-f.x,r.z-f.z)},world);};
 for(let i=0;i<n;i++){const s=i*LANE_STEP;if(s<path.start-6||s>path.end+6)continue;const t=target(s);
  if(t!==null&&fits(s,t)){lanes[i]=t;continue;}for(const o of BUS_LANE_OFFSETS)if(fits(s,o)){lanes[i]=o;break;}}
 // A circuit closes on itself (end == loopTo), so both ends of the closing stretch share one offset.
 const close=()=>{if(path.loopTo==null)return;const at=s=>Math.round(s/LANE_STEP),ends=[...Array(9).keys()].flatMap(k=>[at(path.loopTo)+k-4,at(path.end)+k-4]).filter(i=>i>=0&&i<n),v=Math.min(...ends.map(i=>lanes[i]));for(const i of ends)lanes[i]=v;};
 const smooth=()=>{close();for(let k=0;k<2;k++){for(let i=1;i<n;i++)lanes[i]=Math.max(lanes[i-1]-.45,Math.min(lanes[i-1]+.45,lanes[i]));for(let i=n-2;i>=0;i--)lanes[i]=Math.max(lanes[i+1]-.45,Math.min(lanes[i+1]+.45,lanes[i]));}close();};
 const probe={...path,lanes};
 for(let pass=0;pass<10;pass++){smooth();let bad=false,previous=null;
  for(let s=path.start;s<=path.end;s+=1){const p=busPose(probe,s,kind);if(!busFitsRoad(p,world)||previous&&!safeBusSweep(previous,p,world)){bad=true;const i=Math.round(s/LANE_STEP);for(let j=Math.max(0,i-2);j<=Math.min(n-1,i+2);j++)lanes[j]=Math.sign(lanes[j])*Math.max(0,Math.abs(lanes[j])-.4);}previous=p;}
  if(!bad)return lanes.map(v=>+v.toFixed(2));}
 return new Array(n).fill(0);
}
export class BusSimulation{
 constructor(data,world,{cityCount=6,trunkCount=2,touristCount=3,coachCount=2}={}){this.world=world;this.paths=data.clearancePrecomputed?data.paths.filter(p=>p.kind!=='tourist'||p.verified).map(p=>({...prepareGraph({nodes:[0,1],edges:[{...p,from:0,to:1,lane:0}]}).edges[0],id:p.id})):usableBusPaths(data,world);this.stationBays=[...(data.stationBays||[]),...(data.sightseeingBays||[])];this.cityCount=Math.min(6,cityCount);this.trunkCount=Math.min(2,trunkCount);this.touristCount=Math.min(3,touristCount);this.coachCount=Math.min(2,coachCount);this.buses=[];this.obstacles=[];this.bodies=[];this.time=0;this.supplyAt=4;
  this.signalPoints=data.signals||[];this.stops=[];this.addStops(data.stops);
 }
 // Paths and stops arriving later (a map extension's transit.json), prepared like the city's own.
 addPaths(data){const paths=(data.paths||[]).map(p=>({...prepareGraph({nodes:[0,1],edges:[{...p,from:0,to:1,lane:0}]}).edges[0],id:p.id}));this.paths.push(...paths);this.addStops(data.stops,paths);this.signalPoints.push(...(data.signals||[]));return paths;}
 addStops(stops=[],paths=this.paths){this.stops.push(...stops);for(const p of paths)p.busStops=assignBusStops(p,this.stops);}
 // Standing buses (station and tour bays) belong at the kerb, not in a car lane: nothing behind them could
 // ever pass. `laneTaken(box)` (from mobility.js) says whether a body would cover a car lane; a bay that does
 // moves sideways in 25 cm steps until it is clear and still fits; otherwise cars steer around it.
 keepBaysClear(laneTaken){
  for(const bay of this.stationBays){const box=b=>({x:b.x,z:b.z,heading:b.heading,hl:dims(b).length/2,hw:dims(b).width/2});if(!laneTaken(box(bay)))continue;
   const c=Math.cos(bay.heading),s=Math.sin(bay.heading);let moved=null;
   for(let k=.25;k<=3&&!moved;k+=.25)for(const side of [1,-1]){const p={...bay,x:bay.x+c*k*side,z:bay.z-s*k*side};if(busFitsRoad(p,this.world)&&!laneTaken(box(p))){moved=p;break;}}
   if(moved)Object.assign(bay,{x:moved.x,z:moved.z});}
 }
 // Fallback for paths no road graph has annotated (mobility.attachBuses gives signalStops): mapped signal
 // points near the route, found once per path when first needed.
 legacySignals(path){if(path.signals)return path.signals;path.signals=[];for(const [id,signal]of this.signalPoints.entries()){let best=12,at=null;for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz),t=Math.max(0,Math.min(1,((signal.p[0]-a[0])*dx+(signal.p[1]-a[1])*dz)/(l*l||1))),distance=Math.hypot(signal.p[0]-a[0]-dx*t,signal.p[1]-a[1]-dz*t);if(distance<best){best=distance;at=path.cumulative[i-1]+t*l;}}if(at!==null&&at>path.start&&at<path.end+10)path.signals.push({id,s:at});}return path.signals;}
 cap(kind){return kind==='city'?this.cityCount:kind==='trunk'?this.trunkCount:kind==='coach'?this.coachCount:this.touristCount;}
 reset(player,traffic=[]){this.buses=[];const clear=p=>!traffic.some(o=>o.edge!==null&&busOverlaps(p,o,1));for(const bay of this.stationBays){if(!clear(bay)||Math.hypot(bay.x-player.x,bay.z-player.z)>(bay.radius||650)||!busFitsRoad(bay,this.world)||busOverlaps(bay,player,2)||this.buses.some(b=>busOverlaps(b,bay,1)))continue;const id='station-bay-'+(bay.stopId||bay.line)+(bay.radius?'-'+Math.round(bay.z):'');this.buses.push({...bay,id:this.buses.length,parked:true,speed:0,edge:true,path:{id,segmentId:id,line:bay.line,destination:bay.destination}});}const used=new Set();for(const kind of ['city','trunk','tourist','coach']){const count=this.cap(kind);const candidates=this.paths.filter(p=>p.kind===kind).map(path=>{let best=Infinity,at=path.start;for(let s=path.start;s<=path.end;s+=15){const p=busPose(path,s,kind),d=Math.hypot(p.x-player.x,p.z-player.z);if(d<best){best=d;at=s;}}return {path,best,at};}).filter(p=>p.best<650).sort((a,b)=>a.best-b.best);let added=0;for(const {path,at}of candidates){if(added>=count)break;if(used.has(path.id))continue;let s=path.end-at<90?path.start+5:Math.min(path.end-25,Math.max(path.start,at+65+added*45)),p=busPose(path,s,kind);const distance=Math.hypot(p.x-player.x,p.z-player.z);if(!busFitsRoad(p,this.world)||!clear(p)||distance<30||distance>650||this.supplying&&distance<300&&this.visibilityTest?.(p)||/* no bus appearing in view */this.buses.some(b=>Math.hypot(b.x-p.x,b.z-p.z)<55))continue;this.buses.push({id:this.buses.length,path,s,speed:0,edge:true,...p});used.add(path.id);added++;}}this.refreshObstacles();}
 // Every step: five sample boxes along each bus and one body per bus, written into objects kept on the bus (a fresh
 // {...bus} copy for each, five a bus a step, was a steady source of garbage).
 refreshObstacles(){const obs=this.obstacles=[],bodies=this.bodies=[];
  for(const b of this.buses){const d=dims(b),reach=d.length/2-2,sin=Math.sin(b.heading),cos=Math.cos(b.heading),cache=b._obstacles??=[{},{},{},{},{}];
   for(let i=0;i<5;i++){const o=cache[i],along=(i/2-1)*reach;for(const k in b)if(k!=='_obstacles'&&k!=='_body')o[k]=b[k];o.x=b.x+sin*along;o.z=b.z+cos*along;o.busId=b.id;o.bus=true;o.ref=b;obs.push(o);}
   const body=b._body??={};body.x=b.x;body.z=b.z;body.heading=b.heading;body.hl=d.length/2;body.hw=d.width/2;body.speed=b.speed;body.ref=b;bodies.push(body);}}
 step(dt,player,traffic=[]){this.time+=dt;if(this.time>this.supplyAt){this.supplyAt=this.time+4;const previous=this.buses.filter(b=>Math.hypot(b.x-player.x,b.z-player.z)<550);this.supplying=true;try{this.reset(player);}finally{this.supplying=false;}const candidates=this.buses;this.buses=previous;for(const c of candidates){
   // Fixed, mapped bay occupants have their own bounded slots. Moving buses
   // must not consume them before a continuous drive reaches the station.
   const count=this.buses.filter(b=>!b.parked&&b.kind===c.kind).length;
   const blocked=this.buses.some(b=>b.path.id===c.path.id||(c.parked?busOverlaps(c,b,1):Math.hypot(b.x-c.x,b.z-c.z)<55));
   if((c.parked||count<this.cap(c.kind))&&!blocked&&!traffic.some(o=>o.edge!==null&&busOverlaps(c,o,1)))this.buses.push(c);
  }this.buses.forEach((b,i)=>b.id=i);}
  for(const b of this.buses){if(b.parked)continue;b.redFor=0;
   // At a stop: doors open, then close a moment before it pulls out.
   if(b.dwell>0){b.dwell=Math.max(0,b.dwell-dt);b.speed=0;b.held=0;b.doorsOpen=b.dwell>.8;continue;}
   let desired=Math.min(30/3.6,b.path.speedLimitKmh?b.path.speedLimitKmh/3.6:30/3.6),remaining=b.path.end-b.s;if(b.path.loopTo==null)desired=Math.min(desired,Math.sqrt(Math.max(0,remaining-.4)*2));
   const stops=b.path.busStops||[];if(b.stop&&b.s>b.stop.s+BUS_PULL_OUT){b.stop=null;b.pull=null;}
   if(b.nextStop==null){const i=stops.findIndex(st=>st.s-b.s>BUS_PULL_IN);b.nextStop=i<0?stops.length:i;}
   if(!b.stop&&b.nextStop<stops.length&&stops[b.nextStop].s-b.s<=80){const st=stops[b.nextStop++];
    if(st.s-b.s>BUS_PULL_IN-1){st.pull??={};st.pull[b.kind]??=stopPullFor(b.path,st,b.kind,this.world);b.stop=st;b.served=false;b.pull=st.pull[b.kind]?busStopPull(st,st.pull[b.kind]):null;}}
   if(b.stop&&!b.served){const gap=b.stop.s-b.s;if(gap<.5){b.served=true;b.dwell=busDwell(b,stops.indexOf(b.stop));b.doorsOpen=true;b.speed=0;continue;}desired=Math.min(desired,Math.sqrt(Math.max(0,gap-.3)*1.6));}
   if(b.path.signalStops){for(const g of b.path.signalStops){const gap=g.s-b.s-dims(b).length/2;if(gap<0)continue;if(gap>45)break;if(!signalGreen(g.signal,g.group,this.time)&&gap>b.speed*b.speed/6-.5){b.redFor=untilGreen(g.signal,g.group,this.time);desired=Math.min(desired,Math.sqrt(Math.max(0,gap-1)*2));}break;}}
   else for(const light of this.legacySignals(b.path)){const dist=light.s-b.s;if(dist<8||dist>45)continue;const phase=(this.time+light.id*2.13)%32,northSouth=Math.abs(Math.cos(b.heading))>.707,green=northSouth?phase<13:phase>=16&&phase<29;if(!green)desired=Math.min(desired,Math.sqrt(Math.max(0,dist-BUS_DIMENSIONS[b.kind].length/2-3)*2));}
   // Full long footprint probes, including lateral cross traffic; conservative
   // early braking prevents a long body from clipping cars on a shallow turn.
   // Only what lies ahead of the front counts: a car waiting in the next lane beside the bus is not in its way.
   // Last resort for two vehicles that wait on each other head-on (mismatched mapped lanes): after 2 s the
   // bus squeezes past that one vehicle; everything else is still respected.
   if(b.unjam&&this.time>b.unjamUntil&&!(b.unjam.edge!==null&&busOverlaps(b,b.unjam)))b.unjam=null; // keeps going until clear of it
   const other=b.holdBy;b.gridlock=other&&other.holdBy===b&&b.speed<.1&&(!this.buses.includes(other)||b.id<other.id)?(b.gridlock||0)+dt:0;
   if(b.gridlock>2){b.unjam=other;b.unjamUntil=this.time+5;b.gridlock=0;}
   const others=[player,...traffic,...this.buses].filter(o=>o!==b&&o.edge!==null&&(!b.unjam||o!==b.unjam&&o.ref!==b.unjam)&&Math.abs(o.x-b.x)<40&&Math.abs(o.z-b.z)<40&&(o.x-b.x)*-Math.sin(b.heading)+(o.z-b.z)*-Math.cos(b.heading)>dims(b).length/2-2.5&&!oncomingPasses(b,o));b.holdBy=null;
   for(let ahead=2;ahead<28;ahead+=2){const p=busPose(b.path,Math.min(b.path.end,b.s+ahead),b.kind,b.pull),o=others.find(o=>busOverlaps(p,o,.25));if(o){desired=Math.min(desired,Math.sqrt(Math.max(0,ahead-3)*2));b.holdBy=o.ref||o;break;}}
   b.speed+=Math.max(-3.2*dt,Math.min(1.1*dt,desired-b.speed));const nextS=Math.min(b.path.end,b.s+b.speed*dt),next=busPose(b.path,nextS,b.kind,b.pull);
   // Authored street furniture can change after offline road validation. Check a
   // metre ahead periodically against the live world before entering it.
   if(!b.clearUntil||nextS>b.clearUntil){const checkS=Math.min(b.path.end,nextS+1),check=busPose(b.path,checkS,b.kind,b.pull);b.clearUntil=safeBusSweep(b,check,this.world)?checkS:0;}
   const hit=[player,...traffic,...this.buses].find(o=>o!==b&&o.edge!==null&&(!b.unjam||o!==b.unjam&&o.ref!==b.unjam)&&busOverlaps(next,o)&&!busOverlaps(b,o));
   if(!b.clearUntil||hit){b.speed=0;b.held=(b.held||0)+dt;if(hit)b.holdBy=hit.ref||hit;}else{b.s=nextS;Object.assign(b,next);b.held=0;}
   // A bus that has finished its route, or is held by live furniture for a long time, restarts its route once the
   // player is well away. It used to wait at a route end until the player was 450 m off, standing in a live lane.
   // Sightseeing circuits close on themselves: the usable end lies on the same spot as `loopTo`, so the bus carries straight on.
   if(b.path.loopTo!=null&&remaining<1.5){b.s=b.path.loopTo-remaining;b.clearUntil=0;b.stop=b.pull=b.nextStop=null;Object.assign(b,busPose(b.path,b.s,b.kind));continue;}
   // Out of the camera's view counts as away too (main.js sets visibilityTest), so a bus at the end of its
   // mapped run does not stand in a live lane for as long as the player stays nearby.
   // At the end of its mapped run a bus stands like a parked one: cars steer round it (mobility.js).
   b.standing=remaining<1;b.standFor=b.standing?(b.standFor||0)+dt:0;
   const distance=Math.hypot(b.x-player.x,b.z-player.z),away=distance>150||distance>40&&this.visibilityTest&&!this.visibilityTest(b)||b.standFor>20&&distance>60;
   // The route start must be clear: restarting on top of queued cars used to wedge them inside the bus.
   if((remaining<1||(b.held||0)>12)&&away){const start=busPose(b.path,b.path.start,b.kind);if(![player,...traffic,...this.buses].some(o=>o!==b&&o.edge!==null&&busOverlaps(start,o,1))){b.s=b.path.start;b.held=0;b.clearUntil=0;b.stop=b.pull=b.nextStop=null;Object.assign(b,start);}else b.done=true;}
  }
  // A bus that cannot restart leaves the street; the supply brings a new one in later.
  if(this.buses.some(b=>b.done)){this.buses=this.buses.filter(b=>!b.done);this.buses.forEach((b,i)=>b.id=i);}
  // Stop player contact against the actual 12/13 m body, never a tiny car box.
  for(const b of this.buses)if(!player.cinematic&&busOverlaps(b,player)){ /* the trailer's car is placed, not pushed: it keeps behind the bus instead (cine-drive.js) */if(!leavingBody(player,dt,b))player.speed=0;b.speed=0;const side=(player.x-b.x)*Math.cos(b.heading)-(player.z-b.z)*Math.sin(b.heading);nudgeOut(player,b.heading,(BUS_DIMENSIONS[b.kind].width/2+(player.halfWidth??.98)+.05-Math.abs(side))*(side<0?-1:1),this.world);}
  this.refreshObstacles();
 }
 snapshot(){return this.buses.map(({id,kind,path,x,z,heading,speed,parked,stopId,platform,dwell,doorsOpen,stop})=>({id,kind,line:path.line,destination:path.destination,x,z,heading,speed,parked:!!parked,stopId,platform,dwelling:dwell>0,doorsOpen:!!doorsOpen,busStop:dwell>0?stop?.name||null:null}));}
}
