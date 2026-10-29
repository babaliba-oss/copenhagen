import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {Mobility,prepareGraph,routePoint,signalGreen,SPAWN_WORK,FIT_WARM} from '../src/mobility.js';
import {SpatialIndex} from '../src/geo.js';
import {trafficFootprintsOverlap} from '../src/road-safety.js';
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
test('cars, walkers and the edges they use keep one shape while the simulation runs (no fields added mid-game)',()=>{
 const sim=new Mobility(structuredClone(network),world,{random:seeded(),cars:20,people:30}),player={...city.landmarks[0],speed:0};
 const keys=o=>Object.keys(o).join(),agent=keys(sim.cars[0]),road=new Map(sim.roads.edges.map(e=>[e,keys(e)])),walk=new Map(sim.walks.edges.map(e=>[e,keys(e)]));
 const a=sim.people[0];assert.equal(a.x,0);assert.equal(a.offset,undefined);assert.equal(a.edge,null);assert.equal(a.walking,true);assert.ok(Number.isInteger(a.id)); // the shape settling leaves the values as made
 sim.reset(player);for(let i=0;i<240;i++){player.x+=.4;sim.step(1/30,player);}
 for(const b of [...sim.cars,...sim.people])assert.equal(keys(b),agent);
 for(const [e,k] of road)assert.equal(keys(e),k);for(const [e,k] of walk)assert.equal(keys(e),k);
 assert.ok(sim.roads.edges.some(e=>e.fits!==undefined)&&sim.walks.edges.some(e=>e._room!==undefined)); // those fields were worked out meanwhile
});
test('spawning spends at most SPAWN_WORK.trials spots a step, carries the rest over, and fills the streets as fast within a few seconds',()=>{
 const run=limit=>{const saved=SPAWN_WORK.trials;SPAWN_WORK.trials=limit;try{
  const sim=new Mobility(structuredClone(network),world,{random:seeded(),cars:20,people:80}),player={...city.landmarks[0],speed:0};sim.reset(player);
  for(let i=0;i<200;i++)sim.step(1/60,player); // past the first 3 s, when everyone may be placed at once
  const far={x:player.x+900,z:player.z+300,speed:0};sim.visibilityTest=p=>p.x>far.x-300; /* most spots in view: most tried in vain */const spawn=sim.spawn,placed=[];let worst=0,carried=0,tried=0;sim.spawn=function(a,p){const w0=this.spawnWork;spawn.call(this,a,p);tried+=Math.max(0,w0)-Math.max(0,this.spawnWork);if(a.spawnTrials>0)carried++;}; // spots tried
  for(let i=0;i<300;i++){tried=0;sim.step(1/60,far);worst=Math.max(worst,tried);if(i%60===59)placed.push(sim.people.filter(a=>a.edge&&Math.hypot(a.x-far.x,a.z-far.z)<250).length+sim.cars.filter(a=>a.edge).length);}
  return {worst,placed,carried};}finally{SPAWN_WORK.trials=saved;}};
 const free=run(1e9),capped=run(SPAWN_WORK.trials);
 assert.ok(free.worst>SPAWN_WORK.trials,`the jump asks for more than a step's work (${free.worst})`);
 assert.ok(capped.worst<=SPAWN_WORK.trials,`at most ${SPAWN_WORK.trials} spots a step, got ${capped.worst}`);
 assert.ok(capped.carried>0,'some searches went on into the next step');
 assert.ok(capped.placed.at(-1)>=.95*free.placed.at(-1),`as many placed after 5 s: ${capped.placed} vs ${free.placed}`);
});
test('after a jump the lanes\' fit tests are spread over steps (FIT_WARM, SPAWN_WORK.fitSamples) and cars are still placed there',()=>{
 const run=free=>{const saved=[FIT_WARM.samples,SPAWN_WORK.fitSamples];if(free)FIT_WARM.samples=SPAWN_WORK.fitSamples=1e9;try{
  const sim=new Mobility(structuredClone(network),world,{random:seeded(),cars:30,people:0}),player={...city.landmarks[0],speed:0};sim.reset(player);
  for(let i=0;i<200;i++)sim.step(1/60,player);
  const far={x:player.x+1500,z:player.z+500,speed:0},fits=sim.fits;let n=0,worst=0,longest=0;sim.fits=function(e){if(e.fits===undefined){const k=Math.ceil(e.length/2);n+=k;longest=Math.max(longest,k);}return fits.call(this,e);};
  for(let i=0;i<600;i++){n=0;sim.step(1/60,far);worst=Math.max(worst,n);}
  return {worst,longest,placed:sim.cars.filter(a=>a.edge&&Math.hypot(a.x-far.x,a.z-far.z)<500).length};}finally{[FIT_WARM.samples,SPAWN_WORK.fitSamples]=saved;}};
 const free=run(true),capped=run(false);
 assert.ok(free.worst>FIT_WARM.samples+SPAWN_WORK.fitSamples+2*free.longest,`the jump's first step tests ${free.worst} spots`);
 assert.ok(capped.worst<=FIT_WARM.samples+SPAWN_WORK.fitSamples+2*capped.longest,`at most a step's budget (and one edge over each), got ${capped.worst}`);
 assert.ok(capped.placed>=.9*free.placed&&capped.placed>10,`cars placed by the new spot after 10 s: ${capped.placed} vs ${free.placed}`);
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
test('traffic does not drive into a police unit (externalVehicles): one overtaking towards it in its lane, or one across a junction',()=>{
 const graph={nodes:[[0,0],[0,-200]],edges:[{from:0,to:1,points:[[0,0],[0,-200]],lane:0,signal:-1}]};
 const run=(unit,listed)=>{const sim=new Mobility({roads:structuredClone(graph),walks:{nodes:[],edges:[]},signals:[]},{roads:{at:()=>true},buildings:{at:()=>false}},{cars:1,people:0});
  Object.assign(sim.cars[0],{edge:sim.roads.edges[0],s:20,x:0,z:-20,heading:0,speed:8});const player={x:0,z:-190,speed:0},u={id:'police-0',edge:{},speed:0,...unit};let overlap=0;
  for(let i=0;i<120;i++){sim.externalObstacles=[u];sim.externalVehicles=listed?[u]:[];sim.step(1/30,player);if(trafficFootprintsOverlap(sim.cars[0],u))overlap++;}return overlap;};
 const oncoming={x:1.3,z:-45,heading:Math.PI},across={x:-2.6,z:-45,heading:Math.PI/2};
 assert.ok(run(oncoming,false)>0,'as an oncoming body the car passes through it');
 assert.equal(run(oncoming,true),0,'listed: it stops for it');assert.equal(run(across,true),0,'across its way: never inside it');
});
test('a car held behind a police unit standing in its lane (its officer out on foot) goes round it within a few seconds, but not round one waiting in a queue',()=>{
 // A unit whose officer is out skips the police step and stands where it stopped: the cars behind it queued 40 s and more.
 const graph={nodes:[[0,0],[0,-200]],edges:[{from:0,to:1,points:[[0,0],[0,-200]],lane:0,signal:-1}]};
 const run=queued=>{const sim=new Mobility({roads:structuredClone(graph),walks:{nodes:[],edges:[]},signals:[]},{roads:{at:()=>true},buildings:{at:()=>false}},{cars:2,people:0});
  const [a,b]=sim.cars;Object.assign(a,{edge:sim.roads.edges[0],s:20,x:0,z:-20,heading:0,speed:8});
  if(queued)Object.assign(b,{edge:sim.roads.edges[0],s:52,x:0,z:-52,heading:0,speed:0,cruise:0});else b.edge=null;
  const player={x:30,z:-190,speed:0},u={id:'police-0',edge:sim.roads.edges[0],s:45,x:0,z:-45,heading:0,speed:0,officer:{}};let held=0,overlap=0;
  for(let i=0;i<30*16;i++){sim.externalObstacles=[u];sim.externalVehicles=[u];if(!queued)b.edge=null;sim.step(1/30,player);if(a.speed<.1&&a.holdBy===u)held++;if(trafficFootprintsOverlap(a,u))overlap++;}return {a,held:held/30,overlap};};
 const free=run(false);assert.ok(free.a.z<-52,'past the unit: '+free.a.z.toFixed(1));assert.ok(free.held<4,'held '+free.held.toFixed(1)+' s');assert.equal(free.overlap,0,'never inside it');
 const queue=run(true);assert.ok(queue.a.z>-40,'still behind the unit at the back of a queue: '+queue.a.z.toFixed(1));
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
test('a walker at the end of its path turns back in view instead of vanishing',()=>{
 const pave={rings:[[[-6,5],[6,5],[6,-45],[-6,-45]]],kind:'Jalkakäytävä'},none=new SpatialIndex([]);
 const sim=new Mobility({roads:{nodes:[],edges:[]},walks:{nodes:[[0,0],[0,-40]],edges:[{from:0,to:1,points:[[0,0],[0,-40]],lane:0},{from:1,to:0,points:[[0,-40],[0,0]],lane:0}]},signals:[]},{buildings:none,roads:none,pavement:new SpatialIndex([pave])},{cars:0,people:1});
 const a=sim.people[0],edge=sim.walks.edges.find(e=>e.from===0);Object.assign(a,{edge,s:38,speed:1.2,cruise:1.2,side:.4});Object.assign(a,sim.position(a));sim.visibilityTest=()=>true;
 const player={x:20,z:-20,speed:0};let gone=0;for(let i=0;i<300;i++){sim.step(1/30,player);if(!a.edge)gone++;}
 assert.equal(gone,0,'never recycled while seen');assert.ok(a.z>-38,`walked back: z=${a.z.toFixed(1)}`);
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
test('coaches held by the player standing in their way go round it where the street leaves room, or back off, instead of waiting for good',async()=>{
 // Seen in 1760 (and today): the player stopped head-on in a coach's lane, or across it, held it and the one queued behind
 // it for 70 s and more, and the player pressed between them could move neither way until R.
 const {boxesOverlap,carBox}=await import('../src/lane-model.js');
 const run=(width,heading)=>{
  const graph={nodes:[[0,0],[0,-200]],edges:[{from:0,to:1,points:[[0,0],[0,-200]],length:200,lane:1.6,signal:-1},{from:1,to:0,points:[[0,-200],[0,0]],length:200,lane:1.6,signal:-1}]};
  const m=new Mobility({roads:graph,walks:{nodes:[],edges:[]},signals:[]},{roads:{at:x=>Math.abs(x)<width},buildings:{at:()=>undefined},water:[]},{cars:2,people:0});
  m.time=10;m.visibilityTest=()=>true;m.spawn=a=>{a.edge=null;}; // nothing respawns: a recycled coach would just vanish
  const [a,b]=m.cars,put=(c,s)=>{Object.assign(c,{edge:m.roads.edges[0],s,plan:[],cruise:6,speed:4,halfLength:3.4,halfWidth:.95});Object.assign(c,m.position(c));};put(a,30);put(b,20);
  const player={x:1.6,z:-60,heading,speed:0,halfLength:3.4,halfWidth:.95};let held=0,touched=false;
  for(let t=0;t<40;t+=1/30){m.step(1/30,player);if(Math.abs(a.speed)<.3&&Math.hypot(a.x-player.x,a.z-player.z)<10)held+=1/30;touched||=boxesOverlap(carBox(a),carBox(player))||boxesOverlap(carBox(b),carBox(a));}
  return {a,b,held,touched,player};};
 {const {a,b,held,touched}=run(6,Math.PI); // head-on in its lane on a two-lane street: round it by the other lane, then back to its own
  assert.ok(held<8,`held ${held.toFixed(1)} s`);assert.ok(a.z<-100&&b.z<-75,`both went on past (z ${a.z.toFixed(0)}, ${b.z.toFixed(0)})`);assert.ok(Math.abs(a.x-1.6)<.3,'back in its lane');assert.ok(!touched);}
 {const {a,b,touched,player}=run(2.9,Math.PI/2); // across a narrow street: no way round; the two back off and leave the player room
  assert.ok(player.z-a.z<-(3.4+3.4+3),`a gap of ${(a.z-player.z-6.8).toFixed(1)} m in front of the player`);assert.ok(b.z-a.z>6.8&&!touched,'the one behind backed off first');}
 {const {a,player}=run(6,0); // the player stopped the same way (at a red light, say): the coach behind waits its turn
  assert.ok(a.z>player.z+6&&!a.around&&a.hold==='follow','still queued behind the player');}
});
