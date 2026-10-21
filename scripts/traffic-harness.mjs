// Headless traffic flow check: steps cars, trams and buses together exactly as the game loop does
// (no browser, seeded randomness) and reports vehicles that stop making progress, and why.
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {Mobility} from '../src/mobility.js';
import {TramSimulation} from '../src/tram-simulation.js';
import {BusSimulation,busOverlaps,BUS_DIMENSIONS} from '../src/bus-simulation.js';
import {SpatialIndex} from '../src/geo.js';
import {oncomingPasses} from '../src/lane-model.js';
import {trafficFootprintsOverlap,correctHarbourLanes,harbourCorridor,olympiaTramOnlySurfaces,HARBOUR_CORRIDOR_CARS} from '../src/road-safety.js';
import {inHarbour} from '../src/harbour-layout.js';
import {createSenateSquare} from '../src/cathedral.js';
import {routePoint} from '../src/mobility.js';
import {TRAM_DIMENSIONS} from '../src/tram-simulation.js';

// Places worth watching: tram streets, shared lanes, busy junctions. Coordinates are local metres.
export const FLOW_SPOTS={
 helsinki:[
  {name:'Kauppatori',x:150,z:250,heading:-Math.PI/2},
  {name:'Mannerheimintie (Lasipalatsi)',x:-800,z:-28,heading:0},
  {name:'Rautatieasema (Kaivokatu)',x:-626,z:-34,heading:Math.PI/2},
  {name:'Senate Square',x:-4,z:118,heading:Math.PI/2},
  {name:'Hakaniemi',x:0,z:-1013,heading:0},
 ],
 'copenhagen-1760':[ // coaches and pairs (createScenario size: COACH_HALF_LENGTH) on the old town's streets
  {name:'Vimmelskaftet (1760)',x:-341,z:-327,heading:0},
  {name:'Kongens Nytorv (1760)',x:620,z:-130,heading:Math.PI/2},
 ],
 tampere:[
  {name:'Hämeenkatu (Keskustori)',x:-49,z:5,heading:-Math.PI/2},
  {name:'Hämeenkatu (east)',x:300,z:-20,heading:-Math.PI/2},
  {name:'Rautatieasema',x:650,z:-50,heading:0},
  {name:'Kaupungintalo',x:-125,z:-237,heading:0},
 ],
};
const REPO=new URL('..',import.meta.url).pathname;
export function cityRoot(id){return REPO+(id==='helsinki'?'public/data':`public/cities/${id}`);}
const cache=new Map();
// The same world the game builds for traffic (see boot() in main.js), minus decorative street furniture.
export function loadCity(id){
 if(cache.has(id))return cache.get(id);
 const root=cityRoot(id);if(!existsSync(`${root}/mobility.json`))throw Error(`No built city at ${root}`);
 const helsinki=id==='helsinki',read=f=>JSON.parse(readFileSync(`${root}/${f}`));
 const city=JSON.parse(gunzipSync(readFileSync(`${root}/city.pack`))),mobility=read('mobility.json'),trams=existsSync(`${root}/trams.json`)?read('trams.json'):{paths:[],stops:[]},buses=existsSync(`${root}/bus-corridors.json`)?read('bus-corridors.json'):{paths:[]};
 const islands=city.roads.filter(r=>/Koroke/.test(r.kind));
 const world={buildings:new SpatialIndex(helsinki?[...city.buildings,...createSenateSquare().obstacles]:city.buildings),roads:new SpatialIndex(city.roads.filter(r=>!/Koroke/.test(r.kind))),pavement:new SpatialIndex(city.pavement),
  trafficForbidden:new SpatialIndex(helsinki?[...city.pavement.filter(inHarbour),...islands,...olympiaTramOnlySurfaces(city)]:islands),water:city.water};
 if(existsSync(`${root}/road-walls.json`)){const walls=read('road-walls.json');world.buildings.add(walls);world.laneWalls=walls;} // main.js: the model's walls on the roads
 const out={id,helsinki,city,mobility:helsinki?correctHarbourLanes(mobility):mobility,trams,buses,world};cache.set(id,out);return out;
}
export function seeded(seed=1){let n=seed>>>0||1;return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
// A parked observer beside the street: spawning centres on it and the camera cone decides what may be recycled.
function observerAt(world,x,z){
 // Clear of every carriageway by 4 m, so it never stands in a lane or beside a track.
 const free=(px,pz)=>!world.buildings.at(px,pz)&&[0,1,2,3,4,5,6,7].every(k=>{const qx=px+Math.cos(k*Math.PI/4)*4,qz=pz+Math.sin(k*Math.PI/4)*4;return !world.roads.at(qx,qz)&&!world.trafficForbidden?.at(qx,qz);})&&!world.roads.at(px,pz);
 for(let r=0;r<60;r+=1.5)for(let a=0;a<12;a++){const px=x+Math.cos(a*Math.PI/6)*r,pz=z+Math.sin(a*Math.PI/6)*r;if(free(px,pz))return {x:px,z:pz};}
 return {x,z};
}
export function createScenario(id,spot,{seed=1,cars,people=40,size=null}={}){
 const c=loadCity(id),random=seeded(seed),at=observerAt(c.world,spot.x,spot.z);
 const player={x:at.x,z:at.z,heading:spot.heading||0,speed:0,edge:undefined};
 const options={random,people,...(cars?{cars}:{})};
 if(c.helsinki)Object.assign(options,{stationCars:16,corridorCars:HARBOUR_CORRIDOR_CARS,corridor:harbourCorridor(c.world.roads)});
 const mobility=new Mobility(structuredClone(c.mobility),c.world,options);
 if(size)for(const a of mobility.cars){a.halfLength=size.halfLength;a.halfWidth=size.halfWidth;} // a longer vehicle than a car (1760: a coach and pair)
 // Chase-camera view: everything in a wide cone ahead counts as seen and is never recycled.
 mobility.visibilityTest=a=>{const dx=a.x-player.x,dz=a.z-player.z,d=Math.hypot(dx,dz);return d<450&&(d<25||(-dx*Math.sin(player.heading)-dz*Math.cos(player.heading))/d>.45);};
 const trams=new TramSimulation(structuredClone(c.trams),c.world,random);
 const buses=new BusSimulation(structuredClone(c.buses),c.world);buses.visibilityTest=mobility.visibilityTest;
 mobility.attachTrams(trams);mobility.attachBuses(buses);
 trams.reset(player);buses.reset(player,trams.obstacles);mobility.externalBodies=[...trams.bodies,...buses.bodies];mobility.reset(player);
 return {id,spot,city:c,player,mobility,trams,buses};
}
// One frame in the order main.js uses.
export function stepScenario(s,dt){
 const {player,mobility,trams,buses}=s;
 trams.step(dt,player,[...mobility.cars,...buses.obstacles]);
 buses.step(dt,player,[...mobility.cars,...trams.obstacles]);
 mobility.externalObstacles=[...trams.obstacles,...buses.obstacles];mobility.externalBodies=[...trams.bodies,...buses.bodies];
 mobility.step(dt,player);
}
const STUCK_AFTER=25,PROGRESS=2,QUEUE_LIMIT=75;
// Follows the model's own "waiting for" links (mobility hold/holdBy, tram holdBy) to a signal or a stop.
function waitingFor(s,ref){
 for(let i=0;i<12&&ref;i++){
  if(s.mobility.cars.includes(ref)){if(ref.hold==='signal')return 'signal';ref=ref.holdBy;continue;}
  if(s.trams.trams.includes(ref)){if(ref.wait>0)return 'tram stop';if(ref.redFor>0)return 'signal';ref=ref.holdBy;continue;}
  if(s.buses.buses.includes(ref)){if(ref.redFor>0)return 'signal';ref=ref.holdBy;continue;}
  return null;
 }
 return null;
}
const ahead=(a,b,reach,width)=>{const x=b.x-a.x,z=b.z-a.z,dx=-Math.sin(a.heading),dz=-Math.cos(a.heading),f=x*dx+z*dz;return f>0&&f<reach&&Math.abs(x*dz-z*dx)<width?f:Infinity;};
// Section boxes of an articulated tram, for overlap checks.
const tramBoxes=t=>TRAM_DIMENSIONS.centres.map((c,i)=>({...routePoint(t.path,t.s+c,0),hl:TRAM_DIMENSIONS.sections[i]/2,hw:TRAM_DIMENSIONS.width/2}));
function boxes(a,b){const dx=b.x-a.x,dz=b.z-a.z;if(Math.hypot(dx,dz)>a.hl+b.hl+a.hw+b.hw)return false;const ax=p=>[[Math.cos(p.heading),-Math.sin(p.heading)],[Math.sin(p.heading),Math.cos(p.heading)]],A=ax(a),B=ax(b);
 for(const v of [...A,...B]){const d=u=>Math.abs(v[0]*u[0]+v[1]*u[1]);if(Math.abs(dx*v[0]+dz*v[1])>=a.hw*d(A[0])+a.hl*d(A[1])+b.hw*d(B[0])+b.hl*d(B[1]))return false;}return true;}
const carBox=c=>({x:c.x,z:c.z,heading:c.heading,hl:2.3,hw:.95}),busBox=b=>({x:b.x,z:b.z,heading:b.heading,hl:(BUS_DIMENSIONS[b.kind]?.length||12)/2,hw:(BUS_DIMENSIONS[b.kind]?.width||2.55)/2});
const keys=new WeakMap();let nextKey=0;const keyOf=(kind,o)=>{if(!keys.has(o))keys.set(o,kind+(nextKey++));return keys.get(o);};
// What is in front of a stalled vehicle: the nearest actor in its path.
function blockerOf(s,v){
 const {mobility,trams,buses,player}=s;let best=Infinity,found=null;
 const consider=(b,kind,reach=20,width=2.2)=>{const f=ahead(v,b,reach,width);if(f<best){best=f;found={kind,ref:b,f};}};
 consider(player,'player');
 for(const c of mobility.cars)if(c.edge&&c!==v.ref)consider(c,'car');
 for(const o of trams.obstacles){const t=trams.trams.find(t=>t.id===o.tramId);if(t&&t!==v.ref){const f=ahead(v,o,20,2.2);if(f<best){best=f;found={kind:'tram',ref:t,f};}}}
 for(const b of buses.buses)if(b!==v.ref)consider(b,'bus',v.kind==='bus'?28:20,(BUS_DIMENSIONS[b.kind]?.width||2.6)/2+1);
 for(const p of mobility.people)if(p.edge?.crossing&&mobility.world.roads.at(p.x,p.z))consider(p,'pedestrian',12);
 if(found)found.key=found.kind==='player'?'player':keyOf(found.kind,found.ref);
 return found;
}
const streetName=(world,x,z)=>world.roads.at(x,z)?.name||world.pavement.at(x,z)?.name||'';
export function vehicles(s){
 const out=[];
 for(const c of s.mobility.cars)if(c.edge&&!c.knocked)out.push({key:keyOf('car',c),kind:'car',ref:c,id:c.id,x:c.x,z:c.z,heading:c.heading,speed:c.speed,exempt:false});
 for(const t of s.trams.trams)out.push({key:keyOf('tram',t),kind:'tram',ref:t,id:t.id,x:t.x,z:t.z,heading:t.heading,speed:t.speed,exempt:t.wait>0||t.s>=t.path.length-1});
 for(const b of s.buses.buses)if(!b.parked)out.push({key:keyOf('bus',b),kind:'bus',ref:b,id:b.id,x:b.x,z:b.z,heading:b.heading,speed:b.speed,exempt:b.s>=b.path.end-1||b.dwell>0});
 return out;
}
// Steps a scenario and watches every vehicle. A vehicle is stuck when it has not moved PROGRESS metres
// for STUCK_AFTER seconds and is not dwelling at a stop; queueing for a red light or a tram at its
// platform counts only after QUEUE_LIMIT seconds.
export function runFlow(s,{seconds=180,dt=1/30,sample=.5,warmup=10}={}){
 const track=new Map(),episodes=[],overlaps=new Map(),tight=new Map(),squeezes=new Map(),recycled=[],queued=[];let vehicleSeconds=0,tramBlockedSeconds=0,tramSeconds=0,samples=0,next=0;
 const world=s.city.world;
 for(let t=0;t<seconds;t+=dt){
  stepScenario(s,dt);
  if(s.mobility.time<next)continue;next=s.mobility.time+sample;samples++;
  const now=s.mobility.time,live=vehicles(s),seen=new Set();
  for(const v of live){seen.add(v.key);let r=track.get(v.key);
   if(r&&Math.hypot(v.x-r.last.x,v.z-r.last.z)>40){if(now-r.since>=20&&!r.reported&&v.kind==='car')recycled.push({key:v.key,stalled:Math.round(now-r.since),x:Math.round(r.x),z:Math.round(r.z),street:streetName(world,r.x,r.z)});r=null;} // respawned elsewhere
   if(!r){r={x:v.x,z:v.z,since:now,reported:false,travelled:0,last:{x:v.x,z:v.z}};track.set(v.key,r);}
   r.travelled+=Math.hypot(v.x-r.last.x,v.z-r.last.z);r.last={x:v.x,z:v.z};
   if(now<warmup){r.x=v.x;r.z=v.z;r.since=now;continue;}
   vehicleSeconds+=sample;
   if(v.kind==='tram'){tramSeconds+=sample;if(!v.exempt&&v.speed<.3){const b=blockerOf(s,v);if(b&&b.kind!=='tram')tramBlockedSeconds+=sample;}}
   if(v.exempt||Math.hypot(v.x-r.x,v.z-r.z)>PROGRESS){r.x=v.x;r.z=v.z;r.since=now;r.reported=false;r.queued=false;r.holds=null;r.waited=0;r.legit=0;continue;}
   if(v.kind==='car'){r.holds??={};const h=v.ref.hold||'moving';r.holds[h]=(r.holds[h]||0)+1;}
   r.waited=(r.waited||0)+1;const reason=waitingFor(s,v.ref)||(v.kind==='car'&&v.ref.hold==='signal'?'signal':null);if(reason){r.legit=(r.legit||0)+1;r.reason=reason;}
   if(!r.reported&&now-r.since>STUCK_AFTER){
    // Waiting at a red light or behind a tram at its platform, directly or in a queue, is legitimate
    // for a while: two red phases in a slow queue is normal, a queue that never discharges is not.
    const why=(r.legit||0)>(r.waited||0)/2?r.reason:null; // mostly waiting for a signal or a platformif(why&&now-r.since<QUEUE_LIMIT){if(!r.queued){r.queued=true;queued.push({key:v.key,why,x:Math.round(v.x),z:Math.round(v.z)});}continue;}
    r.reported=true;const b=blockerOf(s,v),ref=v.ref;
    let cause=b?`behind ${b.kind}`:'nothing ahead';
    if(v.kind==='car'){const main=Object.entries(r.holds||{}).sort((a,b)=>b[1]-a[1])[0]?.[0];cause=(main||ref.hold||'yielding')+(b?` (${b.kind} ahead)`:'');}
    if(v.kind==='tram')cause=ref.redFor>0?'red signal':ref.holdBy?`waiting for ${s.trams.trams.includes(ref.holdBy)?'tram':s.buses.buses.includes(ref.holdBy)?'bus':'car'}`:cause;
    if(v.kind==='bus')cause=ref.redFor>0?'red signal':!ref.clearUntil?'path blocked by street geometry':ref.holdBy?`waiting for ${s.trams.trams.includes(ref.holdBy)?'tram':s.buses.buses.includes(ref.holdBy)?'bus':ref===s.player?'player':'car'}`:cause;
    episodes.push({holds:r.holds,key:v.key,kind:v.kind,id:v.id,x:Math.round(v.x),z:Math.round(v.z),street:streetName(world,v.x,v.z),cause,blocker:b?.key||null,at:Math.round(now)});}
  }
  for(const k of track.keys())if(!seen.has(k)){const r=track.get(k);if(k.startsWith('car')&&now-r.since>=20&&!r.reported)recycled.push({key:k,stalled:Math.round(now-r.since),x:Math.round(r.x),z:Math.round(r.z),street:streetName(world,r.x,r.z)});track.delete(k);}
  // Bodies that interpenetrate (cars, trams and buses) are a model failure too.
  const cars=s.mobility.cars.filter(c=>c.edge&&!c.knocked).map(c=>({key:keyOf('car',c),box:carBox(c),c}));
  const trams=s.trams.trams.map(t=>({key:keyOf('tram',t),boxes:tramBoxes(t),t})),buses=s.buses.buses.map(b=>({key:keyOf('bus',b),box:busBox(b),b}));
  // Oncoming vehicles more than ONCOMING_PASS apart sideways are on mapped tracks or lanes closer together
  // than their bodies (source data): they pass, which is reported apart from real overlaps. So is the
  // gridlock breaker's deliberate squeeze past one vehicle.
  const note=(a,b,kind,p,ra,rb)=>{const squeeze=ra&&rb&&(ra.unjam===rb||rb.unjam===ra||ra.passing===rb.id&&s.mobility.cars[rb.id]===rb||rb.passing===ra.id&&s.mobility.cars[ra.id]===ra);
   const key=`${a}/${b}`,close=ra&&rb&&oncomingPasses(ra,rb);if(!squeeze&&!close&&(squeezes.has(key)||tight.has(key)))return; // the same pass, now side by side
   (squeeze?squeezes:close?tight:overlaps).set(key,{x:Math.round(p.x),z:Math.round(p.z),kind,street:streetName(world,p.x,p.z)});};
  for(let i=0;i<cars.length;i++){const a=cars[i];
   for(let j=i+1;j<cars.length;j++)if(trafficFootprintsOverlap(a.c,cars[j].c))note(a.key,cars[j].key,'car-car',a.box,a.c,cars[j].c);
   for(const t of trams)if(t.boxes.some(b=>boxes(a.box,b)))note(a.key,t.key,'car-tram',a.box,a.c,t.t);
   for(const b of buses)if(boxes(a.box,b.box))note(a.key,b.key,'car-bus',a.box,a.c,b.b);
  }
  for(let i=0;i<trams.length;i++){for(let j=i+1;j<trams.length;j++)if(trams[i].boxes.some(a=>trams[j].boxes.some(b=>boxes(a,b))))note(trams[i].key,trams[j].key,'tram-tram',trams[i].boxes[0],trams[i].t,trams[j].t);
   for(const b of buses)if(trams[i].boxes.some(a=>boxes(a,b.box)))note(trams[i].key,b.key,'tram-bus',b.box,trams[i].t,b.b);}
  for(let i=0;i<buses.length;i++)for(let j=i+1;j<buses.length;j++)if(boxes(buses[i].box,buses[j].box))note(buses[i].key,buses[j].key,'bus-bus',buses[i].box,buses[i].b,buses[j].b);
 }
 // Deadlock: stuck vehicles that wait on each other in a cycle.
 const waits=new Map(episodes.filter(e=>e.blocker).map(e=>[e.key,e.blocker])),cycles=[];
 for(const start of waits.keys()){const seen=[start];let k=waits.get(start);while(k&&!seen.includes(k)&&waits.has(k)){seen.push(k);k=waits.get(k);}if(k===start&&seen[0]===seen.slice().sort()[0])cycles.push(seen);}
 const live=vehicles(s);
 return {city:s.id,spot:s.spot.name,seconds:Math.round(s.mobility.time),vehicleMinutes:+(vehicleSeconds/60).toFixed(1),episodes,recycled,queued,cycles,overlaps:[...overlaps].map(([k,v])=>({pair:k,...v})),tightPassing:[...tight].map(([k,v])=>({pair:k,...v})),squeezes:[...squeezes].map(([k,v])=>({pair:k,...v})),
  stuckPer100VehicleMinutes:+(episodes.length/(vehicleSeconds/60)*100).toFixed(2),
  stuckNow:live.filter(v=>{const r=track.get(v.key);return r&&!v.exempt&&s.mobility.time-r.since>STUCK_AFTER;}).length,
  tramBlockedShare:tramSeconds?+(tramBlockedSeconds/tramSeconds).toFixed(3):0,
  trams:s.trams.trams.map(t=>({id:t.id,line:t.path.line,travelled:Math.round(track.get(keyOf('tram',t))?.travelled||0)})),cars:s.mobility.cars.length};
}
export function summarize(reports){
 const sum=k=>reports.reduce((n,r)=>n+(Array.isArray(r[k])?r[k].length:r[k]),0),minutes=reports.reduce((n,r)=>n+r.vehicleMinutes,0);
 const causes={},overlapKinds={};for(const r of reports){for(const e of r.episodes)causes[`${e.kind} ${e.cause}`]=(causes[`${e.kind} ${e.cause}`]||0)+1;for(const o of r.overlaps)overlapKinds[o.kind]=(overlapKinds[o.kind]||0)+1;}
 return {stuck:sum('episodes'),tightPassing:sum('tightPassing'),squeezes:sum('squeezes'),recycledAfterStall:sum('recycled'),queuedAtStops:sum('queued'),deadlocks:sum('cycles'),overlaps:sum('overlaps'),vehicleMinutes:+minutes.toFixed(1),stuckPer100VehicleMinutes:minutes?+(sum('episodes')/minutes*100).toFixed(2):0,causes,overlapKinds};
}
