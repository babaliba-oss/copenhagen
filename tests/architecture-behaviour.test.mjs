import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {findWindowRegions,createModelledBuilding} from '../src/building-detail.js';
import {CATHEDRAL,createCathedral,createSenateSquare} from '../src/cathedral.js';
import {Mobility,approachingPedestrian,TRAFFIC_MAX_SPEED} from '../src/mobility.js';
import {driveStep,makeCar} from '../src/physics.js';
import {SpatialIndex} from '../src/geo.js';
const clear={at:()=>undefined},road={at:()=>true};
test('physical player cap is 140 km/h with gradual upper-end acceleration; traffic stays under 50',()=>{
 const player=makeCar(0,0),world={roads:road,buildings:clear,pavement:road,water:[]};for(let i=0;i<1200;i++){driveStep(player,new Set(['KeyW']),1/60,world);assert.ok(player.speed*3.6<=140.00001);}assert.ok(player.speed*3.6>130);
 const graph={nodes:[[0,0],[0,-1000]],edges:[{from:0,to:1,points:[[0,0],[0,-1000]],length:1000,lane:0,signal:-1}]},sim=new Mobility({roads:graph,walks:{nodes:[],edges:[]},signals:[]},world,{cars:1,people:0});
 Object.assign(sim.cars[0],{edge:sim.roads.edges[0],s:30,x:0,z:-30,cruise:90,speed:14});for(let i=0;i<120;i++){sim.step(1/60,{x:40,z:0,speed:0});assert.ok(sim.cars[0].speed<=TRAFFIC_MAX_SPEED);}
});
function pedestrianWorld(){
 const graph={nodes:[[3,-100],[3,100]],edges:[{from:0,to:1,points:[[3,-100],[3,100]],length:200,lane:0,signal:-1,crossing:false},{from:1,to:0,points:[[3,100],[3,-100]],length:200,lane:0,signal:-1,crossing:false}]};
 return new Mobility({roads:{nodes:[],edges:[]},walks:graph,signals:[]},{roads:{at:x=>Math.abs(x)<2},pavement:{at:x=>x>=2&&x<=5},buildings:clear},{cars:0,people:1});
}
test('pedestrians run away from a car on a collision course, then calm down',()=>{
 const sim=pedestrianWorld(),p=sim.people[0];Object.assign(p,{edge:sim.walks.edges[0],s:100,x:3,z:0,heading:Math.PI,speed:1});
 const car={x:3,z:10,heading:0,speed:10};assert.ok(approachingPedestrian(p,car));assert.equal(approachingPedestrian(p,{...car,speed:0}),false);assert.equal(approachingPedestrian(p,{...car,heading:Math.PI}),false);
 for(let i=0;i<60;i++)sim.step(1/60,car);assert.ok(p.running);assert.ok(p.speed>3);assert.ok(p.z<0,'escape runs away, not toward the car');assert.equal(sim.world.roads.at(p.x,p.z),false);
 for(let i=0;i<240;i++)sim.step(1/60,{...car,speed:0});assert.equal(p.running,false);assert.ok(p.speed<2);
});
test('a car that keeps to the road does not set the pavement running; one about to mount the kerb, or off the road, does',()=>{
 const walker=()=>{const sim=pedestrianWorld(),p=sim.people[0];Object.assign(p,{edge:sim.walks.edges[0],s:100,x:3,z:0,heading:Math.PI,speed:1});return [sim,p];};
 let [sim,p]=walker();for(let i=0;i<60;i++)sim.step(1/60,{x:0,z:10,heading:0,speed:10});assert.equal(p.running,false,'driving past in the lane, 3 m from the kerb walker');
 [sim,p]=walker();for(let i=0;i<60;i++)sim.step(1/60,{x:1.5,z:10,heading:0,speed:10});assert.ok(p.running,'swerving to 1.5 m of the walker');
 [sim,p]=walker();for(let i=0;i<60;i++)sim.step(1/60,{x:3,z:10,heading:0,speed:4.5,travelMode:'walk'});assert.equal(p.running,false,'the player sprinting at them on foot');
 [sim,p]=walker();for(let i=0;i<60;i++)sim.step(1/60,{x:3,z:10,heading:0,speed:6,travelMode:'bike'});assert.equal(p.running,false,'a bike');
 [sim,p]=walker();for(let i=0;i<60;i++)sim.step(1/60,{x:3,z:10,heading:0,speed:10,travelMode:'car'});assert.ok(p.running,'the car up on the pavement');
});
test('walking routes cannot enter a carriageway except a designated crossing',()=>{
 const sim=pedestrianWorld();assert.equal(sim.walkable(0,0,{crossing:false}),false);assert.equal(sim.walkable(0,0,{crossing:true}),true);assert.equal(sim.walkable(3,0,{crossing:false}),true);assert.equal(sim.walkable(6,0,{crossing:false}),false);
 assert.equal(sim.safeWalkSegment({x:3,z:0},{x:1.5,z:0},{crossing:false}),false);
});
test('window interpretation rejects blank walls, oversized shadows and edge fragments',()=>{
 const w=30,h=30,values=new Float32Array(w*h).fill(.8);assert.equal(findWindowRegions(values,w,h,.25,.4).length,0);
 for(let y=8;y<16;y++)for(let x=9;x<13;x++)values[y*w+x]=.1;
 assert.equal(findWindowRegions(values,w,h,.25,.4).length,1);
 values.fill(.1);assert.equal(findWindowRegions(values,w,h,.25,.4).length,0);
});
test('cathedral is physical geometry with columns and measured roof, and stairs have collisions',()=>{
 const index=JSON.parse(readFileSync('public/data/buildings3d-index.json')),tile=index.tiles.find(t=>t.parts.some(p=>p.ratu===211)),part=tile.parts.find(p=>p.ratu===211),buf=gunzipSync(readFileSync('public/data/'+tile.file)),a=new Float32Array(buf.buffer,buf.byteOffset,buf.byteLength/4),model=createCathedral(a,part);
 assert.equal(model.userData.columns,24);assert.ok(model.children.reduce((n,m)=>n+m.geometry.attributes.position.count,0)>20000);assert.ok(model.children.every(m=>!m.material.map));
 const square=createSenateSquare(),index2=new SpatialIndex(square.obstacles);assert.equal(CATHEDRAL.steps,46);assert.ok(index2.at(0,15));assert.equal(index2.at(0,115),undefined);
 for(const root of [model,square.group])root.traverse(m=>{if(m.isMesh){m.geometry.computeBoundingBox();assert.ok(Number.isFinite(m.geometry.boundingBox.max.y));}});
});
