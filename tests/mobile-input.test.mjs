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
test('a second finger can tap a button while the first holds a pedal, and it counts once',async()=>{
 const {secondFingerTaps}=await import('../src/mobile-input.js');
 const L={};const doc={addEventListener:(t,f)=>{(L[t]??=[]).push(f);},elementFromPoint:()=>run};
 const fire=(t,e)=>{let stopped=false;for(const f of L[t]||[])if(!stopped)f({...e,stopImmediatePropagation(){stopped=true;},preventDefault(){}});return stopped;};
 let clicks=0;const run={disabled:false,closest:()=>run,click(){clicks++;}},go={disabled:false,closest:()=>go,click(){}};
 let t=0;secondFingerTaps(doc,{skip:b=>b===go,now:()=>t});
 fire('pointerdown',{pointerType:'touch',isPrimary:false,pointerId:2,target:run,clientX:10,clientY:10});fire('pointerup',{pointerId:2,clientX:12,clientY:11});
 assert.equal(clicks,1,'the second finger tapped Run');
 t=50;assert.equal(fire('click',{isTrusted:true,target:run}),true,'a browser click right after is dropped');
 fire('pointerdown',{pointerType:'touch',isPrimary:true,pointerId:1,target:run,clientX:10,clientY:10});fire('pointerup',{pointerId:1,clientX:10,clientY:10});
 assert.equal(clicks,1,'one finger: the browser clicks, not this');
 fire('pointerdown',{pointerType:'touch',isPrimary:false,pointerId:3,target:run,clientX:10,clientY:10});fire('pointerup',{pointerId:3,clientX:60,clientY:10});
 assert.equal(clicks,1,'a slide off the button is not a tap');
 fire('pointerdown',{pointerType:'touch',isPrimary:false,pointerId:4,target:go,clientX:10,clientY:10});fire('pointerup',{pointerId:4,clientX:10,clientY:10});
 assert.equal(clicks,1,'pedals are skipped');t=2000;assert.equal(fire('click',{isTrusted:true,target:run}),false,'a later real click goes through');
});
