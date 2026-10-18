import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {Mobility,prepareGraph,routePoint,signalGreen} from '../src/mobility.js';
import {SpatialIndex} from '../src/geo.js';
const network=JSON.parse(readFileSync('public/data/mobility.json'));
const city=JSON.parse(gunzipSync(readFileSync('public/data/city.pack')));
const world={buildings:new SpatialIndex(city.buildings),roads:new SpatialIndex(city.roads.filter(r=>!/Koroke/.test(r.kind))),pavement:new SpatialIndex(city.pavement),water:city.water};
function seeded(){let n=75;return ()=>{n=(1664525*n+1013904223)>>>0;return n/4294967296;};}
test('measured route geometry uses the right-hand lane and joins mapped nodes',()=>{
 const graph=prepareGraph(structuredClone(network.roads));assert.ok(graph.edges.length>8000);
 for(const e of graph.edges){assert.ok(e.length>0);assert.ok(Math.hypot(...graph.nodes[e.from].map((x,i)=>x-e.points[0][i]))<.76);assert.ok(Math.hypot(...graph.nodes[e.to].map((x,i)=>x-e.points.at(-1)[i]))<.76);}
 const edge=prepareGraph({nodes:[[0,0],[0,-30]],edges:[{from:0,to:1,points:[[0,0],[0,-30]],lane:1.5}]}).edges[0];
 assert.deepEqual(routePoint(edge,10),{x:1.5,z:-10,heading:-0});
});
test('simulated junction phases never give both crossing directions green',()=>{
 const edges=prepareGraph({nodes:[[0,0],[0,-30],[30,0]],edges:[{from:0,to:1,points:[[0,0],[0,-30]],signal:0},{from:0,to:2,points:[[0,0],[30,0]],signal:0}]}).edges;
 for(let t=0;t<64;t+=.1)assert.ok(!(signalGreen(edges[0],t)&&signalGreen(edges[1],t)));
});
test('cars and pedestrians move on Helsinki routes without entering buildings',()=>{
 const sim=new Mobility(structuredClone(network),world,{random:seeded(),cars:20,people:30}),player={...city.landmarks[0],speed:0};sim.reset(player);
 const before=sim.snapshot();assert.equal(before.cars.length,20);assert.equal(before.people.length,30);
 for(let i=0;i<240;i++)sim.step(1/30,player);
 const after=sim.snapshot();assert.ok(after.cars.some((p,i)=>Math.hypot(p.x-before.cars[i]?.x,p.z-before.cars[i]?.z)>3));assert.ok(after.people.some((p,i)=>Math.hypot(p.x-before.people[i]?.x,p.z-before.people[i]?.z)>1));
 for(const p of [...after.cars,...after.people])assert.equal(world.buildings.at(p.x,p.z),undefined);
 for(const p of after.cars)assert.ok(world.roads.at(p.x,p.z));
});
test('traffic stops for a player ahead and makes solid contact',()=>{
 const graph={nodes:[[0,0],[0,-200]],edges:[{from:0,to:1,points:[[0,0],[0,-200]],length:200,lane:0,signal:-1}]};
 const sim=new Mobility({roads:structuredClone(graph),walks:{nodes:[],edges:[]},signals:[]},{roads:{at:()=>true},buildings:{at:()=>undefined}},{cars:1,people:0});
 Object.assign(sim.cars[0],{edge:sim.roads.edges[0],s:20,x:0,z:-20,heading:0,speed:8});const player={x:0,z:-40,speed:0};
 for(let i=0;i<300;i++)sim.step(1/60,player);
 assert.ok(sim.cars[0].z>-35);assert.ok(sim.cars[0].speed<.5);
 player.z=sim.cars[0].z-3;player.heading=0;player.speed=-12;sim.step(1/60,player);assert.ok(player.speed<0&&player.speed>-6,`reversing into a car shoves it and costs most of the speed, got ${player.speed}`);assert.ok(sim.cars[0].knocked);assert.ok(sim.collisions>0);
});
test('textured buildings have valid meshes, UVs and aligned cathedral geometry',()=>{
 const index=JSON.parse(readFileSync('public/data/buildings3d-index.json'));assert.ok(index.buildings>5000);
 for(const tile of index.tiles){assert.ok(existsSync('public/data/'+tile.file));for(const p of tile.parts)if(p.texture)assert.ok(existsSync('public/data/'+p.texture));}
 const tile=index.tiles.find(t=>t.parts.some(p=>p.ratu===211)),part=tile.parts.find(p=>p.ratu===211),old=JSON.parse(readFileSync('public/data/roof-index.json')).registry.find(p=>p.ratu===211);
 part.bbox.forEach((v,i)=>assert.ok(Math.abs(v-old.bbox[i])<.01));
 const buffer=gunzipSync(readFileSync('public/data/'+tile.file));assert.equal(buffer.length%20,0);
 let uvVariation=false;for(let i=part.start;i<part.start+part.count;i++){const u=buffer.readFloatLE(i*20+12),v=buffer.readFloatLE(i*20+16);assert.ok(Number.isFinite(u)&&Number.isFinite(v));if(u!==0&&v!==0)uvVariation=true;}assert.ok(uvVariation);
});
test('mobility contact pass permits retreat and prevents an NPC driving into the player',()=>{
 const graph={nodes:[[0,0],[0,-200]],edges:[{from:0,to:1,points:[[0,0],[0,-200]],lane:0,signal:-1}]};
 const sim=new Mobility({roads:graph,walks:{nodes:[],edges:[]},signals:[]},{roads:{at:()=>true},buildings:{at:()=>false}},{cars:1,people:0});
 Object.assign(sim.cars[0],{edge:sim.roads.edges[0],s:20,x:0,z:-20,heading:0,speed:0});
 const player={x:0,z:-15.4,heading:0,speed:-2};sim.step(1/60,player);assert.equal(player.speed,-2,'player can reverse out of bumper overlap');
 Object.assign(sim.cars[0],{s:20,x:0,z:-20,speed:20});Object.assign(player,{z:-25,speed:0});
 sim.step(1/30,player);assert.equal(sim.cars[0].z,-20,'NPC cannot advance into player footprint');
});
test('a car stranded at a dead end with no way back stays beside the player but is recycled further away',()=>{
 // Visible stranded cars used to stay forever, so every car behind them queued forever too.
 const graph={nodes:[[0,0],[0,-200]],edges:[{from:0,to:1,points:[[0,0],[0,-200]],lane:0,signal:-1}]};
 const make=()=>new Mobility({roads:graph,walks:{nodes:[],edges:[]},signals:[]},{roads:{at:()=>true},buildings:{at:()=>false}},{cars:1,people:0});
 const close=make(),closeCar=close.cars[0];Object.assign(closeCar,{edge:close.roads.edges[0],s:199.99,x:0,z:-199.99,heading:0,speed:6});close.visibilityTest=()=>true;
 for(let i=0;i<360;i++)close.step(1/60,{x:10,z:-190,heading:0,speed:0});
 assert.equal(closeCar.edge,close.roads.edges[0],'no car vanishes right next to the player');
 const far=make(),farCar=far.cars[0];Object.assign(farCar,{edge:far.roads.edges[0],s:199.99,x:0,z:-199.99,heading:0,speed:6});far.visibilityTest=()=>true;
 for(let i=0;i<60;i++)far.step(1/60,{x:100,z:100,heading:0,speed:0});
 assert.ok(farCar.edge===null||farCar.z>-195,'a distant stranded car is recycled instead of blocking the lane');
});

test('walkers keep their own place on the pavement and a step behind the one ahead, not inside each other',()=>{
 const pave={rings:[[[-6,5],[6,5],[6,-125],[-6,-125]]],kind:'Jalkakäytävä'},none=new SpatialIndex([]);
 const sim=new Mobility({roads:{nodes:[],edges:[]},walks:{nodes:[[0,0],[0,-120]],edges:[{from:0,to:1,points:[[0,0],[0,-120]],lane:0}]},signals:[]},{buildings:none,roads:none,pavement:new SpatialIndex([pave])},{cars:0,people:2});
 const edge=sim.walks.edges[0],[a,b]=sim.people;
 // the same line, a slow walker 3 m ahead of a fast one: they used to merge into one body and split again
 Object.assign(a,{edge,s:10,speed:1.4,cruise:1.45,side:.4});Object.assign(b,{edge,s:13,speed:.9,cruise:.9,side:.45});
 for(const p of [a,b])Object.assign(p,sim.position(p));
 const player={x:30,z:-60,speed:0};let closest=Infinity; // near enough that nobody is recycled, off the pavement
 for(let i=0;i<600;i++){sim.step(1/30,player);closest=Math.min(closest,Math.hypot(a.x-b.x,a.z-b.z));}
 assert.ok(closest>.6,`never closer than a step: ${closest.toFixed(2)} m`);assert.ok(b.s>13+.9*15,'the one ahead walks on at its own pace');
 assert.ok(Math.abs(a.x)>.15&&Math.abs(a.x)<.9,`off the line, to the right of the way it walks: x=${a.x.toFixed(2)}`);
});
test('a shoved coach (1760) pulls back into its lane once it has come to rest, instead of standing in the street',()=>{
 const graph={nodes:[[0,0],[0,-200]],edges:[{from:0,to:1,points:[[0,0],[0,-200]],length:200,lane:1.5,signal:-1}]};
 const sim=new Mobility({roads:structuredClone(graph),walks:{nodes:[],edges:[]},signals:[]},{roads:{at:()=>true},pavement:{at:()=>false},buildings:{at:()=>undefined},water:[]},{cars:1,people:0});
 sim.recoverKnocked=3;const a=sim.cars[0];
 Object.assign(a,{edge:sim.roads.edges[0],s:40,x:2.6,z:-40,heading:.25,speed:0,cruise:6,knocked:{vx:0,vz:0,spin:0,rest:0,pushedAt:-9}});
 const player={x:40,z:-100,speed:0};
 for(let i=0;i<60;i++)sim.step(1/30,player);assert.ok(a.knocked,'still shaken for a moment');
 for(let i=0;i<240;i++)sim.step(1/30,player);
 assert.equal(a.knocked,undefined);assert.ok(a.z<-45,`drives on along its lane, z=${a.z.toFixed(1)}`);assert.ok(Math.abs(a.x-1.5)<.3,`back in the lane, x=${a.x.toFixed(2)}`);
});
