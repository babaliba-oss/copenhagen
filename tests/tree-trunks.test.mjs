import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {trunkRadius,trunkObstacle,createTreeTrunks,LaneIndex,TRUNK_RADIUS,offCarriageway} from '../src/tree-trunks.js';
import {WorldObjects} from '../src/world-objects.js';
import {SpatialIndex} from '../src/geo.js';
import {makeCar,driveStep} from '../src/physics.js';
import {PlayerTravel,CRASH_SPEED} from '../src/player-travel.js';

const square=(x,z,w,d)=>({rings:[[[x,z],[x+w,z],[x+w,z+d],[x,z+d]]]});
const open={at:()=>({})};
const worldFor=objects=>({buildings:new SpatialIndex([]),roads:new SpatialIndex([square(-500,-500,1000,1000)]),pavement:new SpatialIndex([square(-500,-500,1000,1000)]),water:[],objects});

test('trunk radius comes from girth, then the diameter class, then the drawn height, never zero',()=>{
 assert.ok(Math.abs(trunkRadius({girth:157})-.25)<.001,'157 cm girth is a 25 cm radius');
 assert.equal(trunkRadius({girth:2000}),TRUNK_RADIUS.max,'huge girths are clamped');
 assert.equal(trunkRadius({girth:10}),TRUNK_RADIUS.min,'saplings keep a solid minimum');
 assert.equal(trunkRadius({size:'30 - 50 cm'}),.2);
 assert.equal(trunkRadius({size:'50 - 70 cm'}),.3);
 assert.ok(trunkRadius({size:'70 cm -'})>.4);
 assert.equal(trunkRadius({size:'0 - 10 cm'}),TRUNK_RADIUS.min);
 assert.ok(trunkRadius({girth:157,size:'0 - 10 cm'})>.2,'girth wins over the class');
 const tall=trunkRadius({size:'',height:16}),short=trunkRadius({size:null,height:5});
 assert.ok(tall>short&&tall<=.45&&short>=.15);
 for(const t of [{},{size:'null'},{size:'',height:0},{girth:0}])assert.ok(trunkRadius(t)>=.15&&trunkRadius(t)<=.45,JSON.stringify(t));
});

test('spatial query: thousands of trunks share one index and only nearby cells are checked',()=>{
 const trunks=[];for(let i=0;i<200;i++)for(let j=0;j<200;j++)trunks.push(trunkObstacle({p:[i*7,j*7],size:'30 - 50 cm'}));
 const objects=new WorldObjects(trunks);
 assert.equal(objects.snapshot().solid,40000);
 const near=objects.index.near(700,700);assert.ok(near.length<40,`cell holds ${near.length} trunks`);
 assert.equal(objects.overlap({x:700,z:700,heading:0},{halfWidth:.28,halfLength:.28}).id,'tree:700,700');
 assert.equal(objects.overlap({x:703.5,z:703.5,heading:0},{halfWidth:.28,halfLength:.28}),null,'between trunks is clear');
 // Crown size never matters: a car whose body passes .25 m beside a trunk is clear.
 assert.equal(objects.overlap({x:700+.98+.2+.25,z:700,heading:0}),null);
 const started=performance.now();for(let k=0;k<20000;k++)objects.blocksStep({x:350+k%50,z:350,heading:0},{x:350+k%50,z:349.5,heading:0});
 assert.ok(performance.now()-started<1500,'20k swept checks stay cheap');
});

test('a car at 100 km/h stops at a trunk without passing through it',()=>{
 for(const offset of [0,.6,-.9]){
  const tree=trunkObstacle({p:[offset,-40],size:'20 - 30 cm'}),objects=new WorldObjects([tree]),car=makeCar(0,0,0);car.speed=100/3.6;
  let hit=null;for(let i=0;i<240&&!hit;i++)hit=driveStep(car,new Set(['KeyW']),1/30,worldFor(objects)).collision;
  assert.equal(hit,'building',`offset ${offset}`);assert.equal(car.speed,0);
  assert.ok(car.z>-40+tree.radius+2.3-.05,`bumper stays in front of the trunk (car z ${car.z.toFixed(2)})`);
  assert.equal(objects.overlap(car),null,'never inside the trunk');
 }
 // Backing away from the trunk is free.
 const tree=trunkObstacle({p:[0,-5],size:'30 - 50 cm'}),objects=new WorldObjects([tree]),car=makeCar(0,0,0);car.speed=10;
 for(let i=0;i<30;i++)driveStep(car,new Set(['KeyW']),1/30,worldFor(objects));
 const z=car.z;for(let i=0;i<30;i++)driveStep(car,new Set(['KeyS']),1/30,worldFor(objects));assert.ok(car.z>z+.2);
});

test('a scooter that hits a trunk at speed crashes; a walker never walks through it',()=>{
 const tree=trunkObstacle({p:[0,-12],size:'30 - 50 cm'}),world=worldFor(new WorldObjects([tree]));
 const travel=new PlayerTravel(makeCar(30,10,0),world);travel.interact();assert.equal(travel.mode,'walk');
 const scooter=travel.rides.find(r=>r.mode==='scooter');Object.assign(travel.actor,{x:scooter.x,z:scooter.z});assert.ok(travel.interact(scooter.id).ok);
 Object.assign(travel.actor,{x:0,z:-4,heading:0,speed:CRASH_SPEED+3});Object.assign(travel.riding,travel.actor);
 let crashed=null;for(let i=0;i<120&&!crashed;i++)crashed=travel.step(new Set(['KeyW']),1/60).crashed;
 assert.ok(crashed>=CRASH_SPEED,'the scooter crashed into the trunk');assert.equal(travel.mode,'walk');assert.ok(scooter.fallen,'the scooter tipped over');
 for(let i=0;i<60*6;i++)travel.step(new Set(),1/60);assert.ok(!travel.actor.knockdown);
 Object.assign(travel.actor,{x:0,z:-9,heading:0,speed:0});
 for(let i=0;i<60*4;i++){travel.step(new Set(['KeyW','ShiftLeft']),1/60);assert.equal(world.objects.overlap(travel.actor,{halfWidth:.28,halfLength:.28}),null,'never inside the trunk');}
 // in clear space a walker pushing straight at a trunk goes round it instead of sticking to it
 const clear=worldFor(new WorldObjects([tree])),walker=new PlayerTravel(makeCar(30,10,0),clear);walker.interact();Object.assign(walker.actor,{x:0,z:-9,heading:0,speed:0});
 for(let i=0;i<60*4;i++)walker.step(new Set(['KeyW','ShiftLeft']),1/60);
 assert.ok(walker.actor.z<-12-tree.radius,`walked round the trunk (z ${walker.actor.z.toFixed(2)})`);
});

test('NPC scooters that follow mapped paths can opt out of trunks',()=>{
 const tree=trunkObstacle({p:[0,0]}),objects=new WorldObjects([tree]);
 assert.equal(objects.overlap({x:0,z:0,heading:0},{halfWidth:.24,halfLength:.56,trees:false}),null);
 assert.equal(objects.overlap({x:0,z:0,heading:0},{halfWidth:.24,halfLength:.56}),tree);
});

test('no trunk sits in a traffic lane: carriageway points are dropped, pavement ones stay solid',()=>{
 const lanes=[{points:[[-50,0],[50,0]],lane:1.75},{points:[[-50,20],[50,20]],lane:0,laneOffsets:[-1.6,1.6]}];
 const kerb=square(-50,2.4,100,5),world={buildings:new SpatialIndex([square(30,-20,5,5)]),pavement:new SpatialIndex([kerb])};
 const trunks=createTreeTrunks({lanes});
 const trees=[{p:[0,1.75]},{p:[5,2.9],size:'30 - 50 cm'},{p:[10,6]},{p:[0,18.4]},{p:[0,20]},{p:[32,-17]},{p:[10,6]}];
 const {draw,obstacles}=trunks.build(trees,world);
 assert.deepEqual(draw.map(t=>t.p),[[5,2.9],[10,6],[0,20],[10,6]]);
 assert.deepEqual(obstacles.map(o=>o.id),['tree:5,2.9','tree:10,6','tree:0,20'],'duplicates are added once');
 assert.equal(trunks.stats.laneDropped,2);assert.equal(trunks.stats.inLaneOnPavement,1);assert.equal(trunks.stats.insideBuildings,1);
 const index=new LaneIndex(lanes);
 for(const o of obstacles.filter(o=>!world.pavement.at(o.x,o.z)))assert.ok(index.distance(o.x,o.z)>=o.radius+1.05);
});

for(const [id,root] of [['helsinki','public/data'],['tampere','public/cities/tampere']])
 test(`${id}: no trunk obstacle off the pavement inside a lane traffic drives`,{skip:!existsSync(`${root}/city.pack`)},()=>{
  const city=JSON.parse(gunzipSync(readFileSync(`${root}/city.pack`))),mobility=JSON.parse(readFileSync(`${root}/mobility.json`));
  const world={buildings:new SpatialIndex(city.buildings),pavement:new SpatialIndex(city.pavement)},trunks=createTreeTrunks({lanes:mobility.roads.edges});
  const {obstacles}=trunks.build(city.trees,world),lanes=new LaneIndex(mobility.roads.edges);
  assert.ok(obstacles.length>10000,`${obstacles.length} trunks`);
  for(const o of obstacles)if(lanes.distance(o.x,o.z)<o.radius+1.05)assert.ok(world.pavement.at(o.x,o.z),`${o.id} in a lane`);
  assert.ok(trunks.stats.laneDropped<100,JSON.stringify(trunks.stats));
 });

test('a tree point inside a drawn carriageway is moved out to the kerb, or dropped when the far side is a house or road',()=>{
 const road={kind:'Ajorata',rings:[[[-50,-4],[50,-4],[50,4],[-50,4]]]},walk=square(-50,4,100,4);
 const world={roads:new SpatialIndex([road]),pavement:new SpatialIndex([walk,square(-50,-4,100,8)]),buildings:new SpatialIndex([square(18,-8,6,4)])};
 const trunks=createTreeTrunks({lanes:[]}),trees=[{p:[0,3.8]},{p:[10,2.5]},{p:[20,-3]},{p:[30,6]}];
 const {draw}=trunks.build(trees,world);
 assert.deepEqual(draw.map(t=>t.p),[[0,3.8],[10,4.52],[30,6]],'at the kerb line it stays; 1.5 m in, it goes onto the footway; by a house it is dropped');
 assert.equal(trunks.stats.carriagewayMoved,1);assert.equal(trunks.stats.carriagewayDropped,1);
 assert.equal(offCarriageway({roads:new SpatialIndex([{kind:'traffic_island',rings:road.rings}])},0,0),false,'islands are not carriageway');
});
