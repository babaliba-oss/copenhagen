import test from 'node:test';import assert from 'node:assert/strict';
import {createParkedCars} from '../src/copenhagen/parked-cars.js';
const world={buildings:{at:(x,z)=>x>20}}; // a wall at x=20
test('the player car shoves a parked car instead of stopping dead',()=>{
 const p=createParkedCars({cars:[[0,0,Math.PI/2,0],[5,0,Math.PI/2,0]],paints:['#888']}); // two cars nose to tail along x
 const car={x:0,z:6,heading:0,speed:6}; // forward is -z at heading 0
 let hit=0;for(let k=0;k<60;k++){car.z+=-Math.cos(car.heading)*car.speed*(1/60);hit=Math.max(hit,p.step(1/60,car,world));}
 assert.ok(hit>0,'contact registered');assert.ok(p.moved()>=1,'the parked car moved');
 assert.ok(car.z>-3,'the player was slowed by the push, z='+car.z);assert.ok(car.speed<6);
});
test('a parked car against a wall stops the player',()=>{
 const p=createParkedCars({cars:[[18,0,0,0]],paints:['#888']}); // long axis along z, its right side 1.1 m from the wall
 const car={x:13,z:0,heading:Math.PI/2,speed:-8}; // driving toward +x
 for(let k=0;k<120;k++){car.x+=-Math.sin(car.heading)*car.speed*(1/60);p.step(1/60,car,world);}
 assert.ok(car.x<17,'player held off by the pinned car, x='+car.x);
});
test('walkers get parked cars as boxes',()=>{
 const p=createParkedCars({cars:[[0,0,0,0]],paints:['#888']});
 assert.equal(p.near(1,1,10).length,1);
});
