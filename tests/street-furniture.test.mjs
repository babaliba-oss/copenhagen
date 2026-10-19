import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import * as THREE from 'three';
import {SpatialIndex,pointInPolygon,segmentDistance} from '../src/geo.js';
import {correctHarbourLanes} from '../src/road-safety.js';
import {crossingChains} from '../src/crossing-markings.js';
import {planStreetFurniture,createStreetFurniture,createGraniteKerbs,kerbStoneMaterial,parkedCarGeometry,parkedCarMaterial,combineKnockables,nearRoute,KERB} from '../src/street-furniture.js';
import {makeCar} from '../src/physics.js';

const city=JSON.parse(gunzipSync(readFileSync('public/data/city.pack')));
const mobility=correctHarbourLanes(JSON.parse(readFileSync('public/data/mobility.json')));
const trams=JSON.parse(readFileSync('public/data/trams.json'));
const plan=planStreetFurniture(city,mobility,trams,{obstacles:[]});

test('route furniture is placed on the mapped polygon kind it belongs to',()=>{
 const roads=new SpatialIndex(city.roads.filter(p=>!/Koroke/.test(p.kind))),pavement=new SpatialIndex(city.pavement),buildings=new SpatialIndex(city.buildings);
 assert.ok(plan.manholes.length>20&&plan.drains.length>10&&plan.cars.length>30&&plan.bins.length>8&&plan.scooters.length>6,JSON.stringify({m:plan.manholes.length,d:plan.drains.length,c:plan.cars.length,b:plan.bins.length,s:plan.scooters.length}));
 for(const m of plan.manholes){const r=roads.at(m.x,m.z);assert.ok(r&&/^Ajorata/.test(r.kind)&&!pavement.at(m.x,m.z),'manhole on a carriageway');assert.ok(nearRoute(m.x,m.z,80));}
 for(const d of plan.drains){const r=roads.at(d.x,d.z);assert.ok(r&&/^Ajorata/.test(r.kind),'gutter grate on a carriageway');}
 for(const b of [...plan.bins,...plan.scooters,...plan.racks]){const p=pavement.at(b.x,b.z);assert.ok(p&&!/pyör|Portaat/i.test(p.kind),'pavement furniture on walkable pavement');assert.ok(!roads.at(b.x,b.z)&&!buildings.at(b.x,b.z));}
 const parking=new Map(city.roads.filter(p=>p.kind==='Pysäköintialue').map(p=>[p.id,p]));
 for(const c of plan.cars){const polygon=parking.get(c.polygon);assert.ok(polygon,'parked car references a parking polygon');assert.ok(pointInPolygon(c.x,c.z,polygon.rings),'car centred in its bay');const body=[[-.8,-2.15],[.8,-2.15],[.8,2.15],[-.8,2.15]].map(([a,b])=>[c.x+a*Math.cos(c.yaw)+b*Math.sin(c.yaw),c.z-a*Math.sin(c.yaw)+b*Math.cos(c.yaw)]);
  for(const [x,z] of body){assert.ok(!pavement.at(x,z)||pointInPolygon(x,z,polygon.rings),'no overhang onto the pavement');assert.ok(!buildings.at(x,z));}}
});

test('parked cars, manholes and grates keep clear of crossings, tram rails and NPC lanes',()=>{
 const chains=crossingChains(mobility.walks.edges);
 const nearCrossing=(x,z,m)=>chains.some(c=>c.points.some((b,i)=>i&&segmentDistance(x,z,c.points[i-1],b)<m));
 const rails=trams.paths.flatMap(p=>p.points.map((b,i)=>i?[p.points[i-1],b]:null).filter(Boolean));
 const nearRail=(x,z,m)=>rails.some(([a,b])=>segmentDistance(x,z,a,b)<m);
 const lanes=mobility.roads.edges.flatMap(e=>{const lane=e.lane||0;return e.points.map((b,i)=>{if(!i)return null;const a=e.points[i-1],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!l)return null;const dx=(b[0]-a[0])/l,dz=(b[1]-a[1])/l;return [[a[0]-dz*lane,a[1]+dx*lane],[b[0]-dz*lane,b[1]+dx*lane]];}).filter(Boolean);});
 for(const m of plan.manholes){assert.ok(!nearCrossing(m.x,m.z,3.4));assert.ok(!nearRail(m.x,m.z,1.3));}
 for(const c of plan.cars){assert.ok(!nearCrossing(c.x,c.z,3.9),'parked car away from crossings');for(const [x,z] of c.footprint)assert.ok(!lanes.some(([a,b])=>segmentDistance(x,z,a,b)<1.3),'parked car clear of the lane traffic drives');}
 for(const s of plan.cars)for(const t of plan.cars)if(s!==t)assert.ok(Math.hypot(s.x-t.x,s.z-t.z)>=2.6,'parked cars do not overlap');
});

test('parking polygons already filled by another module are skipped',()=>{
 const lot=city.roads.find(p=>p.kind==='Pysäköintialue'&&p.name==='Olympiaranta');
 const withObstacle=planStreetFurniture(city,mobility,trams,{obstacles:[{id:'terminal-parked',rings:lot.rings,bbox:lot.bbox}]});
 assert.ok(!withObstacle.parkingPolygons.includes(lot.id));
 assert.ok(withObstacle.cars.length<=plan.cars.length);
});

test('granite kerbs are chunked, carry a running stone coordinate and drop at crossings',()=>{
 const group=createGraniteKerbs([{a:[0,0],b:[3,0],lowered:false},{a:[3,0],b:[5,0],lowered:true},{a:[600,0],b:[603,0],lowered:false}]);
 assert.equal(group.children.length,2,'segments 600 m apart land in separate chunks');
 group.userData.update({x:0,z:0});assert.ok(group.children[0].visible&&!group.children[1].visible,'distant kerb chunks are culled');
 const g=group.children[0].geometry,along=g.attributes.along,p=g.attributes.position;
 assert.ok(along&&along.count===p.count);
 let maxY=0,minTop=Infinity;for(let i=0;i<p.count;i++){maxY=Math.max(maxY,p.getY(i));}
 assert.ok(Math.abs(maxY-(KERB.base+KERB.height))<1e-6,'raised kerb face height');
 // The lowered segment's top sits just above the carriageway.
 for(let i=0;i<p.count;i++)if(p.getX(i)>4.5)minTop=Math.min(minTop,p.getY(i)>KERB.base+.001?p.getY(i):Infinity);
 assert.ok(minTop<=KERB.base+KERB.loweredHeight+1e-6);
 // `along` continues across touching segments: the second segment starts where the first ended.
 const values=[...along.array];assert.ok(Math.max(...values)-Math.min(...values)>4.9&&Math.max(...values)-Math.min(...values)<5.1);
 const shader={vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};kerbStoneMaterial().onBeforeCompile(shader);
 assert.match(shader.fragmentShader,/kerbHash/);assert.match(shader.fragmentShader,/fwidth\(vAlong\)/);assert.match(shader.vertexShader,/attribute float along/);
});

test('parked car geometry is cheap, paint-masked and instanced with per-instance colour',()=>{
 const g=parkedCarGeometry();assert.ok(g.attributes.position.count/3<600,'under 600 triangles');
 assert.ok(g.attributes.paint&&g.attributes.color&&g.attributes.normal);
 const paint=[...g.attributes.paint.array];assert.ok(paint.includes(1)&&paint.includes(0));
 const shader={vertexShader:'#include <color_vertex>',fragmentShader:''};parkedCarMaterial().onBeforeCompile(shader);assert.match(shader.vertexShader,/mix\(color\.rgb,instanceColor\.rgb,paint\)/);
});

test('scene assembly: solid obstacles for cars and racks, knockable bins and scooters, few draw submissions',()=>{
 const {group,obstacles,knockables,enterableCars}=createStreetFurniture(city,mobility,trams,{obstacles:[]});
 assert.equal(obstacles.length,plan.cars.length+plan.racks.length);
 for(const o of obstacles)assert.ok(o.rings[0].length===4&&o.rings[0].every(p=>p.every(Number.isFinite)));
 let meshes=0;group.traverse(o=>{if(o.isMesh)meshes++;});
 assert.ok(meshes<=6,`at most six draw submissions, got ${meshes}`);
 assert.equal(enterableCars.length,plan.cars.length);const source=enterableCars[0],fleet=group.getObjectByName('Parked cars'),matrix=new THREE.Matrix4();fleet.getMatrixAt(0,matrix);const initial=matrix.clone();
 assert.ok(obstacles.includes(source.obstacle));assert.equal(source.visual.paint,plan.cars[0].colour);
 assert.equal(source.claim(),true);fleet.getMatrixAt(0,matrix);assert.equal(matrix.determinant(),0);assert.equal(source.obstacle.disabled,true);
 assert.equal(source.release(),true);fleet.getMatrixAt(0,matrix);assert.deepEqual(matrix.elements,initial.elements);assert.equal(source.obstacle.disabled,false);
 // Bins, scooters and the bikes parked at the racks are knockable; the rack hoops stay solid.
 assert.equal(knockables.snapshot().count,plan.bins.length+plan.scooters.length+plan.bicycles.length);
 const bike=plan.bicycles[0],bikeBody=knockables.bodies.find(b=>b.id===bike.id),bikeCar=makeCar(bike.x+Math.sin(bike.heading+Math.PI/2)*5,bike.z+Math.cos(bike.heading+Math.PI/2)*5,bike.heading+Math.PI/2);bikeCar.speed=9;
 for(let t=0;t<1;t+=1/60){bikeCar.x-=Math.sin(bikeCar.heading)*bikeCar.speed/60;bikeCar.z-=Math.cos(bikeCar.heading)*bikeCar.speed/60;knockables.step(1/60,bikeCar,null);}
 assert.ok(bikeBody.knocked&&Math.hypot(bikeBody.x-bike.x,bikeBody.z-bike.z)>1.5,'a rack bicycle is sent flying from the side');knockables.resetAll();
 const car=makeCar(plan.bins[0].x,plan.bins[0].z+4,0);car.speed=10;
 for(let t=0;t<.6;t+=1/60){car.z-=car.speed/60;knockables.step(1/60,car,null);}knockables.update();
 assert.ok(knockables.snapshot().knocked>=1,'a bin is knocked over by the car');
 const combined=combineKnockables([null,knockables]);assert.equal(combined.snapshot().count,knockables.snapshot().count);
 group.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});

test('kerb stubs shorter than 3 m in all are left out; runs joined end to end count together', async () => {
 const {keepLongKerbs}=await import('../src/street-furniture.js');
 const segs=[{a:[0,0],b:[1.5,0]},{a:[1.5,0],b:[3,0]},{a:[3,0],b:[4.5,0]}, // a 4.5 m kerb in three pieces: kept
  {a:[10,10],b:[11.2,10]}, // a lone 1.2 m stone in the road: dropped
  {a:[20,0],b:[21,0]},{a:[21,0],b:[21,1]}]; // a 2 m corner stub: dropped
 const kept=keepLongKerbs(segs);
 assert.equal(kept.length,3);
 assert.ok(kept.every(s=>s.a[1]===0&&s.a[0]<5));
});
