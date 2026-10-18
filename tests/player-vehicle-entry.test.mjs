import test from 'node:test';
import assert from 'node:assert/strict';
import {PlayerTravel} from '../src/player-travel.js';
import {createParkedCarSource} from '../src/parked-car-sources.js';
import {SpatialIndex} from '../src/geo.js';
import {makeCar} from '../src/physics.js';
import {Mobility} from '../src/mobility.js';

const rect=(x,z,w,d)=>({rings:[[[x,z],[x+w,z],[x+w,z+d],[x,z+d]]]});
const world=(walls=[])=>({buildings:new SpatialIndex(walls),roads:new SpatialIndex([rect(-800,-800,1600,1600)]),pavement:new SpatialIndex([]),water:[]});
const source=(x=0,z=0,id='parked',obstacle=rect(x-1,z-2,2,4))=>createParkedCarSource({id,actor:{x,z,heading:0,speed:0,edge:{}},obstacle,visual:{type:'estate',paint:'#3a6386'}});
function beside(travel,s,x=2.2){assert.equal(travel.interact().ok,true);Object.assign(travel.actor,{x:s.actor.x+x,z:s.actor.z});}

test('a stopped nearby car can be taken, parked and reused without cloning it again or moving the starter car',()=>{
 const s=source(),w=world([s.obstacle]),home=makeCar(-20,0),travel=new PlayerTravel(home,w,{cars:()=>[s]});home.damage=.41;
 beside(travel,s);travel.actor.distance=73;s.actor.speed=5;assert.equal(travel.interact(s.id).ok,false,'a moving car cannot be taken');s.actor.speed=0;
 assert.equal(travel.interact(s.id).ok,true);assert.equal(travel.mode,'car');assert.equal(s.actor.playerTaken,true);assert.equal(s.actor.edge,null);assert.equal(s.obstacle.disabled,true);
 assert.equal(travel.car.visual,s.visual);assert.equal(travel.car.distance,73);assert.equal(travel.cars.length,2);assert.equal(home.x,-20);assert.equal(home.damage,.41);
 const taken=travel.car;taken.x=40;taken.z=-10;taken.damage=.62;
 assert.equal(travel.interact().ok,true);assert.equal(travel.mode,'walk');assert.ok(travel.parked().includes(taken));
 assert.equal(travel.interact(s.id).ok,true);assert.equal(travel.car,taken);assert.equal(travel.cars.length,2);assert.equal(taken.damage,.62);
});

test('car entry ignores only its own obstacle, still checks a real intervening wall, and ignores disabled old car colliders',()=>{
 const s=source(),wall=rect(1.1,-3,.25,6),w=world([s.obstacle,wall]),travel=new PlayerTravel(makeCar(-20,0),w,{cars:()=>[s]});beside(travel,s);
 assert.equal(travel.interact(s.id).ok,false,'a building between the player and door blocks entry');
 wall.disabled=true;
 assert.equal(travel.interact(s.id).ok,true,'disabled footprints from already claimed cars no longer act as walls');
});

test('an intervening live vehicle prevents entering another car through it',()=>{
 const s=source(),travel=new PlayerTravel(makeCar(-20,0),world([s.obstacle]),{cars:()=>[s]});beside(travel,s);
 const other={x:1.5,z:0,heading:0,halfWidth:.15,halfLength:1,speed:0,edge:{}};
 assert.equal(travel.interact(s.id,[other,s.actor]).ok,false,'the target is ignored but another vehicle blocks access');
 assert.equal(s.actor.playerTaken,undefined);assert.equal(s.obstacle.disabled,undefined);
 assert.equal(travel.interact(s.id,[s.actor]).ok,true,'the stopped target itself does not block its own entry');
});

test('reset releases all claimed sources and the same travel class can use another city and source list',()=>{
 const a=source(),b=source(220,-170,'other-city'),w=world([a.obstacle]),nextWorld=world([b.obstacle]);let sources=[a];
 const travel=new PlayerTravel(makeCar(-20,0),w,{cars:()=>sources});beside(travel,a);travel.interact(a.id);
 sources=[b];const nextCar=makeCar(200,-170);travel.reset(nextCar,nextWorld);
 assert.equal(a.actor.playerTaken,false);assert.equal(a.obstacle.disabled,false);assert.ok(a.actor.edge);
 assert.equal(travel.homeCar,nextCar);assert.equal(travel.cars.length,1);assert.equal(travel.mode,'car');
 beside(travel,b);assert.equal(travel.interact(b.id).ok,true);assert.equal(travel.car.x,220);assert.equal(travel.car.z,-170);
});

test('claimed traffic stays removed through simulation and explicit spawn attempts until reset',()=>{
 const graph={nodes:[[0,0],[0,-160]],edges:[{from:0,to:1,points:[[0,0],[0,-160]],lane:0,signal:-1},{from:1,to:0,points:[[0,-160],[0,0]],lane:0,signal:-1}]};
 const sim=new Mobility({roads:graph,walks:{nodes:[],edges:[]},signals:[]},world(),{cars:1,people:0,random:()=>.4}),npc=sim.cars[0];
 Object.assign(npc,{edge:sim.roads.edges[0],x:0,z:-30,s:30,heading:0,speed:0,playerTaken:true});npc.edge=null;
 const p={x:60,z:-70,heading:0,speed:0};
 for(let i=0;i<120;i++)sim.step(1/60,p);sim.spawn(npc,p);
 assert.equal(npc.edge,null);assert.equal(npc.x,0);assert.equal(npc.z,-30);assert.equal(npc.playerTaken,true);
 sim.reset(p);assert.equal(npc.playerTaken,undefined);assert.ok(npc.edge,'reset makes the traffic slot available again');
});
