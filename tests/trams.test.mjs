import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {TramSimulation,TRAM_DIMENSIONS,TRAM_FLEET_CAPACITY,TRAM_HOTSPOTS} from '../src/tram-simulation.js';
import {Mobility,routePoint} from '../src/mobility.js';
import {createTrafficRenderer} from '../src/traffic-renderer.js';
import {createGovernmentFront,isGovernmentFront} from '../src/government-palace.js';
const data=JSON.parse(readFileSync('public/data/trams.json'));
const world=()=>({buildings:{at:()=>undefined},roads:{at:()=>true},pavement:{at:()=>true}});
test('HSL tram data includes the real Olympia and Senate Square route corridors',()=>{
 assert.equal(data.date,'20260916');assert.ok(data.stops.length>30);assert.ok(data.paths.some(p=>p.line==='2'&&p.points.some(([x,z])=>Math.hypot(x-223.17,z-982.55)<50)));
 assert.ok(data.paths.some(p=>p.line==='4'&&p.points.some(([x,z])=>Math.hypot(x,z-117.7)<25)));
 assert.equal(TRAM_DIMENSIONS.width,2.4);assert.equal(TRAM_DIMENSIONS.gauge,1);assert.ok(Math.abs(TRAM_DIMENSIONS.sections.reduce((a,b)=>a+b,0)+.6-TRAM_DIMENSIONS.length)<1e-10);
});
test('articulated trams move on their HSL paths without exceeding demo cruise speed',()=>{
 const sim=new TramSimulation(data,world()),player={x:0,z:117.7,speed:0,heading:0};sim.reset(player);assert.ok(sim.trams.length>=4);const before=sim.snapshot();
 for(let i=0;i<120;i++)sim.step(1/30,player);
 assert.ok(sim.snapshot().filter((t,i)=>Math.hypot(t.x-before[i].x,t.z-before[i].z)>3).length>=3);
 for(const t of sim.trams){const p=routePoint(t.path,t.s);assert.ok(Math.hypot(t.x-p.x,t.z-p.z)<.01);assert.ok(t.speed<=8.301);}
 assert.equal(sim.obstacles.length,sim.trams.length*7);
});
test('player contact uses the full articulated tram footprint',()=>{
 const sim=new TramSimulation(data,world());sim.reset({x:0,z:117.7});sim.trams=sim.trams.slice(0,1);const t=sim.trams[0],rear=routePoint(t.path,t.s-17.9),player={...rear,speed:14};sim.step(0,player);assert.equal(player.speed,0);
});
test('mixed fleet keeps seven distinct body styles instanced within its draw budget',()=>{
 const actors=Array.from({length:52},(_,id)=>({id,edge:true,x:id*10,z:0,heading:0,speed:5})),fleet=createTrafficRenderer(actors);fleet.update(.016,{x:0,z:0});assert.equal(fleet.types.length,7);assert.ok(fleet.batchCount<=134); // two far-level box batches per family (TRAFFIC_LOD)assert.ok(fleet.group.children.every(m=>m.isInstancedMesh));
 const firstParts=fleet.types.map(t=>fleet.group.children.find(m=>m.userData.type===t)),farParts=fleet.types.map(t=>fleet.group.children.find(m=>m.userData.type===t&&m.userData.lod==='far'));const cars=m=>m.count/(m.userData.parts?.length||1);assert.equal(firstParts.reduce((n,m)=>n+cars(m),0)+farParts.reduce((n,m)=>n+m.count,0),52,'distant cars remain rendered (as box pairs beyond TRAFFIC_LOD.detail) instead of vanishing at 350 metres');assert.ok(firstParts.reduce((n,m)=>n+cars(m),0)>=15,'cars within 150 m keep full detail');
});
test('Government Palace front has clean geometry and does not replace unrelated facades',()=>{
 assert.ok(isGovernmentFront({normal:{x:-1},d:-83}));assert.equal(isGovernmentFront({normal:{x:1},d:83}),false);assert.equal(isGovernmentFront({normal:{x:-1},d:-170}),false);
 const meshes=createGovernmentFront();assert.ok(meshes.length>=4);assert.ok(meshes.every(m=>!m.material.map));assert.ok(meshes.reduce((n,m)=>n+m.geometry.attributes.position.count,0)>10000);
});
test('a pedestrian already on the crossing clears the road even after the signal changes',()=>{
 const graph={nodes:[[-4,0],[4,0],[8,0]],edges:[{from:0,to:1,points:[[-4,0],[4,0]],lane:0,signal:0,crossing:true},{from:1,to:2,points:[[4,0],[8,0]],lane:0,signal:-1,crossing:false}]},w={buildings:{at:()=>undefined},roads:{at:x=>Math.abs(x)<2},pavement:{at:x=>Math.abs(x)>=2}};
 const sim=new Mobility({roads:{nodes:[],edges:[]},walks:graph,signals:[]},w,{cars:0,people:1}),p=sim.people[0];Object.assign(p,{edge:sim.walks.edges[0],s:2.2,x:-1.8,z:0,speed:0,cruise:1.2,heading:-Math.PI/2});
 for(let i=0;i<120;i++)sim.step(1/30,{x:50,z:50,speed:0});assert.ok(p.x>2,'must clear the carriageway, not wait in it');
});
const seeded=(seed=7)=>()=>{seed=(seed*1664525+1013904223)%4294967296;return seed/4294967296;};
const LASIPALATSI={x:-800,z:-28},NORTH=/Käpylä|Messukeskus|Munkkiniemi|Pikku Huopalahti/,SOUTH=/Eira|Olympiaterminaali|Katajanokka|Kolmikulma/;
test('stops attach only to the door side of travel: no southbound halt at the northbound Lasipalatsi platform',()=>{
 const sim=new TramSimulation(data,world(),seeded());
 const north=sim.paths.filter(p=>NORTH.test(p.destination)&&p.stops.some(s=>s.id==='1020444')),south=sim.paths.filter(p=>SOUTH.test(p.destination)&&p.stops.some(s=>s.id==='1020443'));
 assert.equal(north.length,4,'lines 1, 2, 4 and 10B northbound');assert.equal(south.length,4);
 assert.ok(!sim.paths.some(p=>NORTH.test(p.destination)&&p.stops.some(s=>s.id==='1020443')));assert.ok(!sim.paths.some(p=>SOUTH.test(p.destination)&&p.stops.some(s=>s.id==='1020444')));
 assert.equal(TRAM_HOTSPOTS[0].name,'Lasipalatsi');assert.equal(sim.hotspots[0].groups.length,2);for(const g of sim.hotspots[0].groups)assert.equal(g.feeders.length,4);
});
test('Lasipalatsi keeps trams in both directions almost continuously, within the instanced capacity',()=>{
 const sim=new TramSimulation(data,world(),seeded(3)),player={x:-787,z:-26,speed:0,heading:.641};sim.reset(player);
 assert.ok(sim.trams.length<=TRAM_FLEET_CAPACITY);
 const near=()=>sim.snapshot().filter(t=>Math.hypot(t.x-LASIPALATSI.x,t.z-LASIPALATSI.z)<300);
 assert.ok(near().some(t=>t.waiting&&NORTH.test(t.destination))&&near().some(t=>t.waiting&&SOUTH.test(t.destination)),'a tram dwells at each platform from the start');
 let worstNorth=0,worstSouth=0,gapN=0,gapS=0,total=0,samples=0,dwellSamples=0;
 for(let i=0;i<240*20;i++){sim.step(1/20,player);assert.ok(sim.trams.length<=TRAM_FLEET_CAPACITY);
  if(i%20)continue;const n=near();samples++;total+=n.length;if(n.some(t=>t.waiting))dwellSamples++;
  gapN=n.some(t=>NORTH.test(t.destination))?0:gapN+1;gapS=n.some(t=>SOUTH.test(t.destination))?0:gapS+1;worstNorth=Math.max(worstNorth,gapN);worstSouth=Math.max(worstSouth,gapS);}
 assert.ok(total/samples>=2,`mean ${total/samples} trams within 300 m over four minutes`);
 assert.ok(worstNorth<=45&&worstSouth<=45,`longest gap without a tram: north ${worstNorth}s south ${worstSouth}s`);
 assert.ok(dwellSamples/samples>.25,'trams regularly dwell at the platforms');
 for(const t of sim.trams)assert.ok(t.speed<=8.301);assert.equal(sim.obstacles.length,sim.trams.length*7);
 // Far from the hotspot the fleet is the small camera-local one and hotspot trams retire.
 const far={x:1200,z:300,speed:0,heading:0},before=sim.trams.filter(t=>t.hotspot).length;for(let i=0;i<300*20;i++)sim.step(1/20,far);
 assert.ok(before>=4&&sim.trams.filter(t=>t.hotspot).length<before/2,'hotspot trams retire once they have left the stretch and the camera is far');
 sim.reset(far);assert.ok(sim.trams.length<=6);assert.ok(sim.trams.every(t=>!t.hotspot));
});
