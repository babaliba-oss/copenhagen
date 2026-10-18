import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCar,driveStep} from '../src/physics.js';
import {dialAngle,smoothSpeed} from '../src/speedometer.js';
const world={roads:{at:()=>true},buildings:{at:()=>false},pavement:{at:()=>false},water:[]};
test('the car never runs out: no battery to drain, full power both ways after any distance',()=>{
 for(const key of ['KeyW','KeyS']){const car=makeCar(0,0);for(let i=0;i<120;i++)driveStep(car,new Set([key]),1/60,world);assert.ok(car.distance>0);assert.equal('battery' in car,false);}
 const fresh=makeCar(0,0),driven=makeCar(0,0);driven.distance=1e6;
 for(const car of [fresh,driven])driveStep(car,new Set(['KeyW']),.5,world);
 assert.ok(driven.speed>3);assert.equal(driven.speed,fresh.speed,'a long drive leaves the car as lively as a fresh one');
 const back=makeCar(0,0);driveStep(back,new Set(['KeyS']),1,world);assert.ok(back.speed<0,'reverse always works');
});
test('speed needle is bounded and smoothly approaches its target independently of frame rate',()=>{
 assert.equal(dialAngle(0),-120);assert.equal(dialAngle(60),0);assert.equal(dialAngle(120),120);assert.equal(dialAngle(999),120);
 const results=[30,60,120].map(fps=>{let shown=0;for(let i=0;i<fps;i++)shown=smoothSpeed(shown,80,1/fps);return shown;});
 assert.ok(results.every(n=>n>79&&n<80));assert.ok(Math.abs(results[0]-results[2])<1e-9);
 assert.equal(smoothSpeed(20,40,0),20);
});
