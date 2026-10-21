import test from 'node:test';
import assert from 'node:assert/strict';
import {crossesStrip,headingAlong,ARREST,createRoadblock,planRoadblock,spanAcross,ROADBLOCK} from '../src/roadblock.js';
import {roadblockClear,roadblockDistanceAhead} from '../src/roadblock-planning.js';
import {Scene} from 'three';
import {createPlayerCarRenderer} from '../src/player-car-renderer.js';
import {PoliceSimulation} from '../src/police.js';
import {makeCar,driveStep,FLAT_TYRES} from '../src/physics.js';

const strip={a:{x:0,z:-10},b:{x:0,z:10}};
test('the spike strip catches a car driving over it, not one beside it',()=>{
 assert.equal(crossesStrip({x:5,z:0},{x:-5,z:0},strip),true,'drove straight across');
 assert.equal(crossesStrip({x:5,z:0},{x:1.5,z:0},strip),true,'front wheels on the spikes');
 assert.equal(crossesStrip({x:9,z:0},{x:6,z:0},strip),false,'still approaching');
 assert.equal(crossesStrip({x:5,z:20},{x:-5,z:20},strip),false,'passed beyond the end');
 assert.equal(crossesStrip({x:15,z:-15},{x:-15,z:25},strip),true,'fast diagonal crossing before the end position leaves the strip');
 assert.ok(Math.abs(headingAlong(-1,0)-Math.PI/2)<1e-9,'forward is (-sin h, -cos h)');
});
test('shredded tyres drag a fast car down to a crawl and cap its drive',()=>{
 const world={roads:{at:()=>true},pavement:{at:()=>true},buildings:{at:()=>null},water:[]};
 const car=makeCar(0,0);car.speed=25;car.flat=1;
 for(let i=0;i<240;i++)driveStep(car,new Set(['KeyW']),1/60,world);
 assert.ok(car.speed<=FLAT_TYRES.speed+.5,`crawling at ${car.speed}`);
});
test('parked roadblock units stay put, survive resets and can arrest at once',()=>{
 const graph={nodes:[{x:0,z:0},{x:100,z:0}],edges:[],outgoing:[[],[]]};
 const police=new PoliceSimulation(graph,{buildings:{at:()=>null}});
 police.setParked([{x:10,z:0,heading:0}]);police.reset();
 assert.equal(police.units.length,1);assert.equal(police.units[0].parked,true);
 assert.equal(police.arrestNow('Busted.'),true);assert.equal(police.busted,true);assert.equal(police.arrestNow(),false);
 police.setParked([]);assert.equal(police.units.length,0);
 assert.ok(ARREST.card<ARREST.up[0]&&ARREST.card>ARREST.cuff[0],'the BUSTED card comes up while the cuffs go on');
});
test('an arrest door uses the car currently driven after switching model and paint',()=>{
 const scene=new Scene(),renderer=createPlayerCarRenderer(scene),home=makeCar(0,0),travel={homeCar:home,car:home,actor:home,cars:[home]};renderer.sync(travel);
 const world={buildings:{at:()=>null},roads:{at:()=>true},pavement:{at:()=>true}},police={units:[],setParked(){}};
 const block=createRoadblock(scene,{world,police,carModel:renderer.group}),taken={...makeCar(3,4),visual:{type:'van',paint:'#946a2e'}};
 travel.cars.push(taken);travel.car=travel.actor=taken;renderer.sync(travel);block.startArrest(taken);
 const door=renderer.group.children.at(-1),panel=door.children[0].children[0]; // hung on the car model, tilting with it
 assert.equal(panel.material.color.getHexString(),'946a2e');
 // the shaped door (skin with its window cut out) runs from the sill to this car's roof line
 panel.geometry.computeBoundingBox();const bb=panel.geometry.boundingBox,spec=renderer.group.userData.spec;
 assert.ok(Math.abs(bb.min.y-(.34-.012))<.01&&Math.abs(bb.max.y-(spec.h-.12+.012))<.01,`door ${bb.min.y.toFixed(3)}..${bb.max.y.toFixed(3)} for a ${spec.h} m car`);
 block.clearArrest();assert.ok(!renderer.group.children.includes(door),'Continue takes the door off the car');
});
test('hemmed in by houses, the arrest camera looks down from above the roofs, never from inside a house',()=>{
 const scene=new Scene(),car=makeCar(0,0),house={at:(x,z)=>Math.hypot(x,z)>3?{}:null}; // only the car's own spot is open
 const world={buildings:house,cameraBuildings:house,roads:{at:()=>true},pavement:{at:()=>true}},police={units:[],setParked(){}};
 const block=createRoadblock(scene,{world,police});block.startArrest(car);for(let i=0;i<60;i++)block.update(1/30,car);
 assert.ok(block.cameraPose().position[1]>15,`camera at ${block.cameraPose().position[1].toFixed(1)} m`);
 const open=createRoadblock(new Scene(),{world:{...world,buildings:{at:()=>null},cameraBuildings:{at:()=>null}},police});open.startArrest(car);open.update(1/30,car);
 assert.ok(open.cameraPose().position[1]<5,'a clear street keeps the low view');
});

function cityFixture(dx=0,dz=0){
 const road=(x,z)=>x>=dx-20&&x<=dx+900&&Math.abs(z-dz)<=7;
 const world={buildings:{at:()=>null},roads:{at:(x,z)=>road(x,z)?{name:'Test Street'}:null},pavement:{at:(x,z)=>Math.abs(z-dz)<11},water:[]};
 const graph={nodes:[[dx-20,dz],[dx+900,dz]],edges:[{from:0,to:1,points:[[dx-20,dz],[dx+900,dz]],lane:1.45}]};
 const car={...makeCar(dx,dz,-Math.PI/2),speed:10,travelMode:'car'};
 return {world,graph,car};
}
const hidden={isVisible:()=>false};
test('roadblock geometry follows the loaded city, translated without a location preset',()=>{
 const a=cityFixture(),b=cityFixture(12000,-9000),pa=planRoadblock(a.world,a.graph,a.car,hidden),pb=planRoadblock(b.world,b.graph,b.car,hidden);
 assert.ok(pa&&pb);assert.ok(pa.cars.length>=2&&pa.officers.length>=2);
 assert.ok(pa.distanceAhead>=ROADBLOCK.minAhead);assert.equal(pa.roadName,'Test Street');
 assert.ok(Math.abs(pb.centre.x-pa.centre.x-12000)<1e-7);assert.ok(Math.abs(pb.centre.z-pa.centre.z+9000)<1e-7);
 assert.equal(roadblockClear(pb,b.world),true);
 assert.ok(Math.hypot(pa.strip.b.x-pa.strip.a.x,pa.strip.b.z-pa.strip.a.z)<=14,'strip ends at the carriageway edge');
});
test('a mapped building without a Helsinki identifier and a median both stop the strip',()=>{
 const {world}=cityFixture();world.buildings.at=(x,z)=>z>2?{id:'way/12'}:null;
 const wall=spanAcross(world,{x:100,z:0},{x:0,z:1},20);
 assert.ok(wall.b.z<=2&&wall.b.z>1.5);
 world.buildings.at=()=>null;world.roads.at=(x,z)=>Math.abs(z)>.4&&Math.abs(z)<7;
 const median=spanAcross(world,{x:100,z:3},{x:0,z:1},20);
 assert.ok(median.a.z>.4,'does not cross the tree median to another carriageway');
});
test('planner skips water, bridges, narrow roads, traffic and steep cross slopes',()=>{
 const cases=[
  ['water',f=>{f.world.water=[{rings:[[[-30,-20],[950,-20],[950,20],[-30,20]]]}];}],
  ['bridge',f=>{f.graph.edges[0].bridge=true;}],
  ['tunnel',f=>{f.graph.edges[0].tunnel='yes';}],
  ['narrow road',f=>{f.world.roads.at=(x,z)=>Math.abs(z)<1.9;}],
  ['building',f=>{f.world.buildings.at=(x,z)=>x>120?{id:'osm/100'}:null;}],
 ];
 for(const [label,change] of cases){const f=cityFixture();change(f);assert.equal(planRoadblock(f.world,f.graph,f.car,hidden),null,label);}
 const f=cityFixture(),obstacles=[{x:178,z:0,hw:12,hl:12}],alternate=planRoadblock(f.world,f.graph,f.car,{...hidden,obstacles});
 assert.ok(alternate&&alternate.centre.x>185,'chooses another clear stretch after the occupied patrol line');
 assert.equal(roadblockClear(planRoadblock(f.world,f.graph,f.car,hidden),f.world,{obstacles}),false);
 assert.equal(roadblockClear(alternate,f.world,{obstacles}),true);
 assert.equal(planRoadblock(f.world,f.graph,f.car,{...hidden,heightAt:(x,z)=>z*.5}),null,'excessive cross slope');
});
test('planner does not deploy into clear view and follows connected roads',()=>{
 const f=cityFixture();assert.equal(planRoadblock(f.world,f.graph,f.car,{isVisible:()=>true}),null);
 assert.equal(planRoadblock(f.world,f.graph,f.car),null,'no camera callback conservatively assumes an unobstructed road is visible');
 f.graph.nodes.push([100,0],[900,4]);f.graph.edges=[{from:0,to:2,points:[[-20,0],[100,0]]},{from:3,to:1,points:[[100,4],[900,4]]}];
 assert.equal(planRoadblock(f.world,f.graph,f.car,hidden),null,'a nearby disconnected road is not ahead on the route');
 f.graph.edges[1]={from:2,to:1,points:[[100,0],[900,0]]};
 assert.ok(planRoadblock(f.world,f.graph,f.car,hidden),'continues across graph edge boundaries');
});
test('a hidden block around a bend remains ahead on the road, while a U-turn cancels it',()=>{
 const f=cityFixture();f.graph={nodes:[[-20,0],[100,0],[100,500]],edges:[{from:0,to:1,points:[[-20,0],[100,0]]},{from:1,to:2,points:[[100,0],[100,500]]}]};
 f.world.roads.at=(x,z)=>x>=-20&&x<=107&&Math.abs(z)<=7||Math.abs(x-100)<=7&&z>=0&&z<=500;
 const plan=planRoadblock(f.world,f.graph,f.car,{isVisible:p=>Math.abs(p.z)<40});assert.ok(plan);
 assert.ok(roadblockDistanceAhead(plan,f.car)>=ROADBLOCK.minAhead);
 assert.ok(roadblockDistanceAhead(plan,{x:100,z:30,heading:Math.PI,speed:10})<plan.distanceAhead,'progress follows the corner');
 assert.equal(roadblockDistanceAhead(plan,{...f.car,heading:Math.PI/2}),null,'heading back up the approach is no longer on the selected route');
});
function pursuitFixture(options={}){
 const f=cityFixture(),warnings=[];
 const police={level:0,busted:false,units:[],setParked(cars){this.units=cars.map(p=>({...p,parked:true}));},arrestNow(){this.busted=true;this.level=0;return true;}};
 const block=createRoadblock(new Scene(),{...f,police,...hidden,random:()=>0,onWarning:m=>warnings.push(m),config:{delay:[1,1],warningLead:2,retry:2,maxAttempts:3},...options});
 const tick=(duration,opts={})=>{for(let i=0;i<Math.round(duration*10);i++)block.step(.1,f.car,{...f.car},opts);};
 return {...f,police,block,warnings,tick};
}
test('five-star deployment waits once, warns, and does not escalate ordinary driving',()=>{
 const f=pursuitFixture();f.car.x=-809;f.car.z=61;f.tick(30);assert.equal(f.police.level,0);assert.equal(f.block.deployed,false,'old Simonkatu coordinates do nothing');
 Object.assign(f.car,{x:0,z:0});f.police.level=4;f.tick(20);assert.equal(f.block.snapshot().phase,'idle');
 f.police.level=5;f.tick(.5);assert.equal(f.block.snapshot().phase,'waiting');assert.equal(f.warnings.length,0);
 f.tick(1);assert.equal(f.block.snapshot().phase,'warning');assert.equal(f.block.deployed,false);assert.equal(f.warnings.length,1);
 f.tick(2);assert.equal(f.block.deployed,true);assert.ok(f.police.units.every(u=>u.parked));assert.equal(f.police.level,5);
});
test('chance is rolled once per pursuit, with bounded retries for missing sites',()=>{
 let draws=0;const skipped=pursuitFixture({random:()=>{draws++;return .99;}});skipped.police.level=5;skipped.tick(80);
 assert.equal(draws,1);assert.equal(skipped.block.snapshot().phase,'skipped');
 skipped.police.level=3;skipped.tick(2);skipped.police.level=5;skipped.tick(2);assert.equal(draws,1,'heat bouncing below five is not a new chance roll');
 skipped.police.level=0;skipped.tick(.1,{started:false});skipped.police.level=5;skipped.tick(.1);assert.equal(draws,2,'escape rearms a future pursuit');
 const blocked=pursuitFixture({isVisible:()=>true});blocked.police.level=5;blocked.tick(80);
 assert.equal(blocked.block.snapshot().attempts,3);assert.equal(blocked.block.snapshot().phase,'unavailable');assert.equal(blocked.warnings.length,0);
});
test('a warning is cancelled if the road becomes visible, occupied or the player gets out',()=>{
 let visible=false;const f=pursuitFixture({isVisible:()=>visible});f.police.level=5;f.tick(1.5);assert.equal(f.block.snapshot().phase,'warning');
 visible=true;f.tick(2);assert.equal(f.block.deployed,false);assert.equal(f.block.snapshot().lastReason,'in-view');
 const obstacles=[];const occupied=pursuitFixture({obstacles:()=>obstacles});occupied.police.level=5;occupied.tick(1.5);
 obstacles.push({x:occupied.block.snapshot().pending.centre.x+13,z:0,hw:15,hl:15});occupied.tick(2);
 assert.equal(occupied.block.deployed,false);assert.equal(occupied.block.snapshot().lastReason,'occupied');
 const walker=pursuitFixture();walker.police.level=5;walker.tick(1.5);walker.car.travelMode='walk';walker.tick(3,{started:false});
 assert.equal(walker.block.deployed,false);assert.equal(walker.block.snapshot().lastReason,'left-vehicle');
});
test('deployed spikes shred tyres, arrest the stopped driver and rearm after clearing',()=>{
 const f=pursuitFixture();f.police.level=5;f.tick(4);assert.equal(f.block.deployed,true);
 const x=f.block.plan.centre.x;Object.assign(f.car,{x:x+1,z:0});let bursts=0;
 f.block.step(.1,f.car,{x:x-5,z:0},{onBurst:()=>bursts++});assert.equal(f.car.flat,1);assert.equal(bursts,1);
 f.car.speed=0;f.tick(1.2);assert.equal(f.police.busted,true);
 f.block.standDown();assert.equal(f.police.units.length,0);assert.equal(f.block.group.visible,false);
 f.police.busted=false;f.tick(.1,{started:false});f.police.level=5;Object.assign(f.car,{x:0,z:0,speed:10});f.tick(4);
 assert.equal(f.block.deployed,true,'a new pursuit after Continue can deploy');
 f.police.level=0;f.tick(.1,{started:false});assert.equal(f.block.deployed,false,'escaping on foot still cleans up patrol cars');
 f.block.reset();assert.equal(f.block.snapshot().phase,'idle');assert.equal(f.block.plan,null);
});
test('walk, bike and scooter arrests stay upright and never create a phantom car door',()=>{
 for(const mode of ['walk','bike','scooter']){
  const f=pursuitFixture();f.car.travelMode=mode;f.block.startArrest(f.car);
  let arrest=f.block.snapshot().arrest;
  assert.equal(arrest.mode,mode);assert.equal(arrest.hasDoor,false);assert.equal(arrest.driver.hidden,false);
  assert.equal(f.block.deployed,false,'arrest works independently of a roadblock');
  for(let i=0;i<65;i++)f.block.update(.1,f.car);
  arrest=f.block.snapshot().arrest;assert.equal(arrest.driver.pose,'cuffed');assert.equal(arrest.driver.lean,0);assert.equal(arrest.driver.groundY,.13);
  assert.ok(f.block.cameraPose());assert.equal(f.block.playing,false);assert.doesNotThrow(()=>f.block.clearArrest());assert.equal(f.block.active,false);
 }
});
