import test from 'node:test';
import assert from 'node:assert/strict';
import {createTouchInput,thumbSteering} from '../src/mobile-input.js';

test('thumb steering is proportional, centred and bounded',()=>{
 assert.equal(thumbSteering(80,10,140),0);
 assert.equal(thumbSteering(81,10,140),0,'small thumb jitter has a dead zone');
 assert.ok(thumbSteering(60,10,140)>.08&&thumbSteering(60,10,140)<.3,'a gentle slide is a gentle turn (squared response)');
 assert.equal(thumbSteering(-100,10,140),1);assert.equal(thumbSteering(250,10,140),-1);
});
test('steering and acceleration belong to separate fingers and release independently',()=>{
 const keys=new Set(),input=createTouchInput(keys);
 assert.equal(input.steer(11,.4),true);input.press(12,'ArrowUp');
 assert.equal(keys.tilt,.4);assert.equal(keys.has('ArrowUp'),true);
 input.release(11);assert.equal(keys.tilt,0);assert.equal(keys.has('ArrowUp'),true);
 input.release(12);assert.equal(keys.has('ArrowUp'),false);assert.equal(input.size,0);
});
test('a second finger cannot steal steering, or release a pedal held by another finger',()=>{
 const keys=new Set(),input=createTouchInput(keys);input.steer(1,.2);
 assert.equal(input.steer(2,-1),false);assert.equal(keys.tilt,.2);
 input.press(2,'ArrowDown');input.press(3,'ArrowDown');input.release(2);
 assert.equal(keys.has('ArrowDown'),true);input.release(3);assert.equal(keys.has('ArrowDown'),false);
 input.release(1);assert.equal(keys.tilt,0);assert.equal(input.size,0);
});
test('pause, cancelled contacts and orientation changes release only touch-owned keys',()=>{
 const keys=new Set(['KeyW']),input=createTouchInput(keys);input.press(9,'ArrowUp');input.press(10,'ArrowLeft');input.steer(11,-.7);
 input.clear();assert.deepEqual([...keys],['KeyW']);assert.equal(keys.tilt,0);assert.equal(input.size,0);
 input.release(9);input.release(11);assert.equal(keys.tilt,0,'late lost-capture events are harmless');
 input.steer(22,NaN);assert.equal(keys.tilt,0);input.clear();
});
