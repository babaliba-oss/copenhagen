import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHarbour} from '../src/harbour.js';
import {CYCLE_SURFACES,PLATFORM_SURFACES,FERRY,surfaceId} from '../src/harbour-layout.js';
import {HARBOUR_START} from '../src/demo-route.js';
import {SpatialIndex,pointInPolygon} from '../src/geo.js';
import {makeCar,carSamples,driveStep} from '../src/physics.js';
import {drivingCameraPose} from '../src/driving-camera.js';
import {trafficFootprintsOverlap} from '../src/road-safety.js';
import {WorldObjects} from '../src/world-objects.js';
import {TERMINAL_POSTS} from '../src/terminal-details.js';

const city=JSON.parse(gunzipSync(readFileSync('public/data/city.pack')));
const harbour=createHarbour(city);
test('the complete terminal destination board and outer supports stop a car',()=>{
 const p=TERMINAL_POSTS.find(p=>p.kind==='destination'),board=harbour.obstacles.find(p=>p.id==='terminal-destination-sign');
 assert.ok(board,'rendered destination board has a solid footprint');
 const objects=new WorldObjects([board]),world={buildings:new SpatialIndex([]),roads:{at:()=>({})},pavement:{at:()=>({})},water:[],objects};
 for(const side of [-1.3,0,1.3]){
  const car=makeCar(p.x+side*Math.cos(p.yaw)+8*Math.sin(p.yaw),p.z-side*Math.sin(p.yaw)+8*Math.cos(p.yaw),p.yaw);car.speed=18;
  let collision=null;for(let i=0;i<120&&!collision;i++)collision=driveStep(car,new Set(['KeyW']),1/60,world).collision;
  assert.equal(collision,'building',`board blocks the centre and outer supports (${side})`);
  assert.equal(car.speed,0);assert.equal(objects.overlap(car),null,'car stops outside the board');
 }
});
test('harbour parked fleet keeps claimable actor identity and removes exactly the taken vehicle',()=>{
 const source=harbour.enterableCars[0],fleet=harbour.group.getObjectByName('Instanced traffic fleet'),batch=fleet.children.find(m=>m.userData.type===source.visual.type&&!m.userData.lod),before=batch.count;
 assert.ok(harbour.enterableCars.length>=200);assert.ok(harbour.obstacles.includes(source.obstacle));assert.match(source.visual.paint,/^#[a-f0-9]{6}$/i);
 try{assert.equal(source.claim(),true);assert.equal(source.actor.edge,null);assert.equal(source.obstacle.disabled,true);assert.equal(batch.count,before-batch.userData.parts.length);}
 finally{source.release();}
 assert.ok(source.actor.edge);assert.equal(source.obstacle.disabled,false);assert.equal(batch.count,before);
});
test('north apron has separated parking rows, empty bays and clear public paths',()=>{
 const p=harbour.group.userData.terminalDetails,cars=p.parked.filter(p=>p.kind==='port-apron');
 const publicGround=new SpatialIndex([...city.pavement,...city.roads.filter(r=>r.kind!=='Pysäköintialue'),...city.buildings,...city.water]);
 assert.ok(cars.length>=180);assert.ok(p.parkingBays.length>cars.length+30);assert.equal(p.apronLights.length,3);
 for(const bay of p.parkingBays)for(const [x,z] of bay.ring)assert.ok(!publicGround.at(x,z),`bay must stay on private apron: ${x},${z}`);
 for(let i=0;i<cars.length;i++)for(let j=i+1;j<cars.length;j++)assert.equal(trafficFootprintsOverlap(cars[i],cars[j]),false,'parked cars must not intersect');
});
test('photographed west-kerb parked cars are on the road edge, never in the raised park or retaining wall',()=>{
 const fleet=harbour.group.userData.terminalDetails.parked.filter(p=>p.kind==='west-kerb');
 const roads=new SpatialIndex(city.roads),pavement=new SpatialIndex(city.pavement),parks=new SpatialIndex(city.parks);
 assert.ok(fleet.length>=25);
 for(const p of fleet){
  assert.equal(p.heading,.636+Math.PI,'west-kerb cars face south toward the terminal');
  assert.ok(-Math.cos(p.heading)>0&&-Math.sin(p.heading)>0,'vehicle forward vector points southeast');
 }
 for(const p of fleet)for(const [x,z] of p.ring){assert.ok(roads.at(x,z));assert.ok(!pavement.at(x,z));assert.ok(!parks.at(x,z));}
});
test('harbour surfaces use actual cycleway and platform footprints',()=>{
 for(const id of CYCLE_SURFACES)assert.match(city.pavement.find(p=>surfaceId(p)===id).kind,/pyörätie/);
 for(const id of PLATFORM_SURFACES)assert.equal(city.pavement.find(p=>surfaceId(p)===id).material,'Betonikivi');
 assert.equal(harbour.group.userData.cycleways,4);assert.equal(harbour.group.userData.platforms,4);
 assert.ok(harbour.group.userData.lamps>=10);assert.ok(harbour.group.userData.trailers>=3);
});
test('street detail is batched, finite and bounded',()=>{
 let triangles=0;
 assert.ok(harbour.group.children.length<130);
 harbour.group.traverse(m=>{if(!m.isMesh)return;const p=m.geometry.attributes.position;triangles+=p.count/3;assert.ok(p.array.every(Number.isFinite));});
 assert.ok(triangles>5000&&triangles<140000,`triangle budget: ${triangles}`);
});
test('southern approach starts in the right lane with space to accelerate and brake',()=>{
 const buildings=new SpatialIndex([...city.buildings,...harbour.obstacles]),roads=new SpatialIndex(city.roads.filter(p=>!/Koroke/.test(p.kind)));
 const car=makeCar(HARBOUR_START.x,HARBOUR_START.z,HARBOUR_START.heading);
 const pavement=new SpatialIndex(city.pavement),world={buildings,roads,pavement,water:city.water};
 assert.ok(car.z>1050&&car.z<1120,'start before the terminal drop-off, toward the south');
 assert.ok(car.heading<0&&car.heading>-.4,'face north-northeast along the approach');
 for(let i=0;i<204;i++){
  for(const [x,z] of carSamples(car)){assert.ok(roads.at(x,z));assert.ok(!pavement.at(x,z));assert.ok(!buildings.at(x,z));}
  assert.equal(driveStep(car,new Set([i<120?'KeyW':'Space']),1/60,world).collision,null);
 }
 assert.ok(car.distance>15);assert.equal(car.speed,0);
});
test('ferry is at sea, full scale and oriented bow southeast',()=>{
 assert.equal(FERRY.length,203);assert.equal(FERRY.width,31.5);
 for(const z of [-85,0,85])for(const x of [-15.75,15.75]){
  const gx=FERRY.x+x*Math.cos(FERRY.yaw)+z*Math.sin(FERRY.yaw),gz=FERRY.z-x*Math.sin(FERRY.yaw)+z*Math.cos(FERRY.yaw);
  assert.ok(city.water.some(w=>pointInPolygon(gx,gz,w.rings)),`ferry on land at ${gx},${gz}`);
 }
});
test('driving camera stays behind the car, keeps a usable eye height and supports looking around',()=>{
 for(const heading of [0,Math.PI/2,Math.PI,-Math.PI/2])for(const zoom of [36,240]){
  const car={x:223,z:982},p=drivingCameraPose(car,heading,zoom);
  assert.ok(p.position[1]>2.9&&p.position[1]<5);
  assert.ok((p.position[0]-car.x)*Math.sin(heading)+(p.position[2]-car.z)*Math.cos(heading)>5); // closest zoom sits 5.4 m back (arcade-style tighter chase)
  assert.ok(p.target.every(Number.isFinite));
 }
 assert.deepEqual(drivingCameraPose({x:0,z:0},0,240,1).position,drivingCameraPose({x:0,z:0},0).position,'looking around must not orbit into trees');
 assert.notDeepEqual(drivingCameraPose({x:0,z:0},0,240,1).target,drivingCameraPose({x:0,z:0},0).target);
});
