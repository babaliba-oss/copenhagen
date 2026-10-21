import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {SpatialIndex} from '../src/geo.js';
import {BUS_DIMENSIONS,busSamples,busOverlaps,busFitsRoad,busPose,safeBusSweep,BusSimulation} from '../src/bus-simulation.js';
import {createBusModel,createBusRenderer} from '../src/bus-renderer.js';
import {terminalAnchors} from '../src/bus-terminal.js';
import {HARBOUR_START} from '../src/demo-route.js';
const world={roads:{at:()=>true},buildings:{at:()=>false}};
test('adding one bus retains existing rendered fleet geometry',()=>{
 const bus=id=>({kind:'city',x:0,z:id*20,heading:0,path:{segmentId:String(id),line:'',destination:'RAUTATIENTORI'}});
 const sim={buses:[bus(1)]},renderer=createBusRenderer(sim);renderer.update({x:0,z:0});const model=renderer.group.children[0],geometry=model.children[0].geometry;
 sim.buses.push(bus(2));renderer.update({x:0,z:0});assert.equal(renderer.group.children[0],model);assert.equal(model.children[0].geometry,geometry);assert.equal(renderer.group.children.length,2);
 sim.buses.shift();renderer.update({x:0,z:0});assert.equal(renderer.group.children.length,1);
});
test('bus footprint is long, tests rear overhang and rejects a pavement corner',()=>{
 const p={x:0,z:0,heading:0,kind:'city'};
 assert.equal(BUS_DIMENSIONS.city.length,12);assert.ok(busSamples(p).length>=70);
 assert.ok(busOverlaps(p,{x:0,z:7.5,heading:0}));assert.equal(busOverlaps(p,{x:0,z:9,heading:0}),false);
 assert.equal(busFitsRoad(p,{...world,roads:{at:(x,z)=>z<5}}),false);
 assert.equal(safeBusSweep(p,{...p,x:1,heading:Math.PI/2},world),false,'reject physically impossible sharp turn');
});
test('bus model dimensions remain full-sized and render within modest batch budget',()=>{
 for(const kind of ['city','trunk','tourist','coach']){const m=createBusModel(kind),b=new THREE.Box3().setFromObject(m),size=b.getSize(new THREE.Vector3());assert.ok(size.z>=BUS_DIMENSIONS[kind].length);assert.ok(size.y>3);assert.ok(size.x<3.3);assert.ok(m.children.length<=12);m.traverse(o=>{if(o.isMesh)for(const v of o.geometry.attributes.position.array)assert.ok(Number.isFinite(v));});}
});
test('simulation uses only supplied paths, moves, respects full-body obstacles and 30 km/h',()=>{
 const data={paths:[{id:'dated-route',line:'23',kind:'city',points:[[0,0],[0,-100],[0,-300]]},{id:'unverified-tour',kind:'tourist',points:[[10,0],[10,-300]]}]};
 const sim=new BusSimulation(data,world,{cityCount:1});assert.ok(sim.paths.length);assert.ok(sim.paths.every(p=>p.kind==='city'));
 const player={x:25,z:0,heading:0,speed:0};sim.reset(player);assert.equal(sim.buses.length,1);const start=sim.buses[0].z;
 for(let i=0;i<300;i++)sim.step(1/30,player);assert.ok(sim.buses[0].z<start-10);assert.ok(sim.buses[0].speed<=30/3.6);
 const b=sim.buses[0],hit={x:b.x,z:b.z+5.5,heading:0,speed:10};sim.step(0,hit);assert.equal(hit.speed,0);assert.equal(sim.obstacles.length,5);
});
test('a bus waits beside the player\'s car left touching it (nudge-out blocked by a kerb wall) instead of creeping through it',()=>{
 const w={roads:{at:()=>true},buildings:{at:x=>x>2.1}},sim=new BusSimulation({paths:[{id:'straight',kind:'city',points:[[0,0],[0,-300]]}]},w,{cityCount:1});sim.supplyAt=1e9;
 const b={id:0,path:sim.paths[0],s:100,speed:0,edge:true,...busPose(sim.paths[0],100,'city')};sim.buses=[b];const player={x:b.x+2,z:b.z,heading:b.heading,speed:0};
 for(let i=0;i<600;i++){sim.step(1/60,player);player.speed=0;}assert.ok(busOverlaps(b,player),'still touching: the wall stops the nudge');assert.ok(b.s-100<.01,`the bus held (moved ${(b.s-100).toFixed(3)} m)`);
});
test('solid traffic obstruction brakes buses before contact',()=>{
 const sim=new BusSimulation({paths:[{id:'straight',kind:'city',points:[[0,0],[0,-300]]}]},world,{cityCount:1});const player={x:30,z:0,speed:0,heading:0};sim.reset(player);const b=sim.buses[0],obstacle={x:b.x,z:b.z-25,heading:0,edge:true};for(let i=0;i<900;i++)sim.step(1/30,player,[obstacle]);assert.equal(busOverlaps(b,obstacle),false);assert.ok(b.speed<.1);
});
test('Rautatientori photo routes use dated mapped bays and do not occupy pavement',()=>{
 const data=JSON.parse(readFileSync('public/data/bus-corridors.json')),city=JSON.parse(gunzipSync(readFileSync('public/data/city.pack'))),w={roads:new SpatialIndex(city.roads.filter(r=>!/Koroke/.test(r.kind))),buildings:new SpatialIndex(city.buildings),trafficForbidden:new SpatialIndex(city.roads.filter(r=>/Koroke/.test(r.kind)))};
 assert.deepEqual(data.stationBays.filter(b=>!b.demoStaging).map(b=>b.line),['78','611','600']);assert.equal(data.stationBays.length,10);
 for(const b of data.stationBays){assert.ok(busFitsRoad(b,w));const stop=data.stationStops.find(s=>s.id===b.stopId);if(b.line)assert.ok(stop.lines.includes(b.line));assert.ok(Math.hypot(b.x-stop.x,b.z-stop.z)<8);assert.ok(data.stationBays.every(q=>q===b||!busOverlaps(b,q,1)));}
 const sim=new BusSimulation(data,w),player={x:-600,z:-15,heading:Math.PI/2,speed:0};sim.reset(player);const bays=sim.buses.filter(b=>b.parked);assert.equal(bays.length,10);const before=bays.map(b=>[b.x,b.z]);for(let i=0;i<30;i++)sim.step(1/30,player);assert.deepEqual(sim.buses.filter(b=>b.parked).map(b=>[b.x,b.z]),before);assert.equal(BUS_DIMENSIONS.trunk.length,15);
});
test('continuous harbour approach populates ten station bays and shows early charter coaches',()=>{
 const data=JSON.parse(readFileSync('public/data/bus-corridors.json')),city=JSON.parse(gunzipSync(readFileSync('public/data/city.pack')));
 const w={roads:new SpatialIndex(city.roads.filter(r=>!/Koroke/.test(r.kind))),buildings:new SpatialIndex(city.buildings),trafficForbidden:new SpatialIndex(city.roads.filter(r=>/Koroke/.test(r.kind)))};
 const sim=new BusSimulation(data,w),player={...HARBOUR_START,speed:0};sim.reset(player);
 assert.equal(sim.buses.filter(b=>b.parked).length,0);
 assert.ok(sim.buses.some(b=>b.kind==='coach'&&Math.hypot(b.x-player.x,b.z-player.z)<400),'coach visible earlier along harbour drive');
 for(const [x,z] of [[54,690],[27,555],[15,320],[69.9,251.1],[260,160],[0,70],[-350,-15],[-470,-49]]){
  const start={...player};for(let i=1;i<=300;i++){player.x=start.x+(x-start.x)*i/300;player.z=start.z+(z-start.z)*i/300;sim.step(1/30,player);}
 }
 assert.equal(sim.snapshot().filter(b=>b.parked).length,10);
 assert.deepEqual(sim.snapshot().filter(b=>b.parked&&b.line).map(b=>b.line).sort(),['600','611','78']);
 assert.ok(sim.buses.every(b=>busFitsRoad(b,w)));
 assert.ok(sim.buses.length<=25,'thirteen moving slots plus ten fixed station bays and two Kauppatori tour-bus bays');
 const before=sim.buses.filter(b=>b.parked);
 for(let i=0;i<300;i++)sim.step(1/30,player);
 assert.ok(before.every(b=>sim.buses.includes(b)),'resupply preserves existing visible bay actors');
});
test('terminal signs and shelter footprints stay off the carriageways',()=>{
 const data=JSON.parse(readFileSync('public/data/bus-corridors.json')),city=JSON.parse(gunzipSync(readFileSync('public/data/city.pack'))),w={roads:new SpatialIndex(city.roads.filter(r=>!/Koroke/.test(r.kind))),buildings:new SpatialIndex(city.buildings),pavement:new SpatialIndex(city.pavement),trafficForbidden:new SpatialIndex(city.roads.filter(r=>/Koroke/.test(r.kind)))};
 const anchors=terminalAnchors(data.stationStops,w);assert.ok(anchors.length>=8);assert.ok(anchors.filter(a=>a.shelter).length>=3);
 for(const a of anchors){assert.ok(!w.roads.at(a.x,a.z));assert.ok(!w.buildings.at(a.x,a.z));if(a.shelter){const c=Math.cos(a.heading),s=Math.sin(a.heading);for(const x of [-.8,0,.8])for(const z of [-2.7,0,2.7]){const px=a.shelter.x+c*x+s*z,pz=a.shelter.z-s*x+c*z;assert.ok(!w.roads.at(px,pz));assert.ok(!w.buildings.at(px,pz));}}}
});

test('a hair-thin unmapped seam between two road polygons does not stop a bus, but a real road edge does',()=>{
 // Kaisaniemenkatu → Rautatientori had a 0.1 m sliver between adjacent road polygons; a bus stalled on it for good.
 const rect=(x0,z0,x1,z1)=>({rings:[[[x0,z0],[x1,z0],[x1,z1],[x0,z1]]]});
 const seam=new SpatialIndex([rect(-20,-5,0,5),rect(.1,-5,20,5)]),world={roads:seam,buildings:new SpatialIndex([]),trafficForbidden:new SpatialIndex([])};
 assert.ok(busFitsRoad({x:0,z:0,heading:Math.PI/2,kind:'city'},world),'bus straddling the seam fits');
 assert.ok(!busFitsRoad({x:18,z:0,heading:Math.PI/2,kind:'city'},world),'bus hanging over the end of the road does not fit');
 assert.ok(!busFitsRoad({x:0,z:4,heading:Math.PI/2,kind:'city'},world),'bus over the kerb line does not fit');
});

test('tourist model is a genuine double-decker: two deck floors, open rear top, plain red, no brand text',()=>{
 const m=createBusModel('tourist',{destination:'CITY TOUR'}),b=new THREE.Box3().setFromObject(m),size=b.getSize(new THREE.Vector3());
 assert.ok(size.y>=4.2&&size.y<4.6,'double-deck height');assert.ok(size.z>=11.4&&size.z<12.2,'~11.4 m body');
 const paint=m.children.find(o=>o.isMesh&&o.material.color.getHexString()==='b5242b');assert.ok(paint,'red livery');
 // Upper-deck seat rows and the deck floor slab sit above the lower-deck roofline (y > 3.5).
 const pos=paint.geometry.attributes.position;let upper=0;for(let i=0;i<pos.count;i++)if(pos.getY(i)>3.6)upper++;assert.ok(upper>200,'upper deck geometry present');
 assert.equal(m.userData.dimensions.length,11.4);assert.match(m.name,/double decker/);
});
test('Kauppatori: sightseeing circuits close on themselves and three or more double-deckers stand or circle near the market',()=>{
 const data=JSON.parse(readFileSync('public/data/bus-corridors.json')),city=JSON.parse(gunzipSync(readFileSync('public/data/city.pack')));
 const w={roads:new SpatialIndex(city.roads.filter(r=>!/Koroke/.test(r.kind))),buildings:new SpatialIndex(city.buildings),trafficForbidden:new SpatialIndex(city.roads.filter(r=>/Koroke/.test(r.kind)))};
 const loops=data.paths.filter(p=>p.loopTo!=null);assert.ok(loops.length>=2);assert.ok(loops.every(p=>p.kind==='tourist'&&p.verified));
 assert.equal(data.sightseeingBays.length,2);for(const b of data.sightseeingBays){assert.equal(b.kind,'tourist');assert.ok(busFitsRoad(b,w));assert.ok(Math.hypot(b.x-14,b.z-330)<30,'tour-bus stop on Eteläranta at Kauppatori');}
 const sim=new BusSimulation(data,w),player={x:14,z:380,heading:0,speed:0};sim.reset(player);
 const near=()=>sim.buses.filter(b=>b.kind==='tourist'&&Math.hypot(b.x-190,b.z-245)<320);
 assert.ok(near().length>=3,`only ${near().length} double-deckers near Kauppatori`);
 assert.equal(sim.buses.filter(b=>b.parked&&b.kind==='tourist').length,2);
 for(const loop of sim.paths.filter(p=>p.loopTo!=null)){const a=busPose(loop,loop.loopTo,'tourist'),b=busPose(loop,loop.end,'tourist');assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<.4,'loop end lies on loopTo');}
 // A circling bus crosses the closing stretch without stopping or jumping.
 const bus=sim.buses.find(b=>!b.parked&&b.path.loopTo!=null);assert.ok(bus);bus.s=bus.path.end-6;Object.assign(bus,busPose(bus.path,bus.s,'tourist'));bus.speed=6;
 let jump=0,stopped=0;for(let i=0;i<120;i++){const {x,z}=bus;sim.step(1/30,{x:-400,z:380,heading:0,speed:0});jump=Math.max(jump,Math.hypot(bus.x-x,bus.z-z));if(bus.speed<.5)stopped++;}
 assert.ok(bus.s<bus.path.end-20,'wrapped to loopTo');assert.ok(jump<.6,`teleported ${jump.toFixed(2)} m`);assert.equal(stopped,0);
 assert.ok(sim.buses.every(b=>busFitsRoad(b,w)));
});
