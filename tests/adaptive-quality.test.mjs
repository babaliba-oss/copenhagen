import test from 'node:test';
import assert from 'node:assert/strict';
import {createAdaptiveResolution} from '../src/adaptive-quality.js';

const run=(q,ms,seconds)=>{for(let t=0;t<seconds;t+=ms/1000)q.update(ms,ms/1000);};

test('adaptive resolution lowers under sustained load and recovers when fast',()=>{
  const q=createAdaptiveResolution({max:1.5,min:.75});
  run(q,16.7,3);assert.equal(q.scale,1.5);
  run(q,33.3,8);assert.equal(q.scale,.75);
  run(q,8,120);assert.equal(q.scale,1.5);
});

test('adaptive resolution ignores isolated hitches and suspended tabs',()=>{
  const q=createAdaptiveResolution();
  run(q,16.7,2);q.update(120,.12);q.update(900,.9);run(q,16.7,1);
  assert.equal(q.scale,1.5);
});

test('adaptive resolution does not oscillate between a slow level and the one below it',()=>{
  const q=createAdaptiveResolution({max:1.5,min:.75});let changes=0;
  // Full resolution costs 20 ms; one step down costs 12 ms — the classic ping-pong case.
  for(let t=0;t<60;t+=1/60){const ms=q.scale>=1.5?20:12;if(q.update(ms,ms/1000))changes++;}
  assert.equal(q.scale,1.375);assert.ok(changes<=3,`changed ${changes} times in a minute`);
});
test('capture lock holds a fixed scale through slow frames and unlock resumes adapting',()=>{
 const r=createAdaptiveResolution({max:1.5,min:.75});
 assert.equal(r.lock(2),true);assert.equal(r.scale,2);assert.equal(r.locked,true);
 for(let i=0;i<600;i++)assert.equal(r.update(40,1/30),false,'no steps while locked');
 assert.equal(r.scale,2);
 assert.equal(r.unlock(),true);assert.equal(r.scale,1.5);assert.equal(r.locked,false);
 let changed=false;for(let i=0;i<600;i++)changed=r.update(40,1/30)||changed;
 assert.ok(changed&&r.scale<1.5,'adapts again after unlock');
});

test('a sustained run of very slow frames (8 fps) still lowers the resolution',()=>{
 const q=createAdaptiveResolution({max:1.5,min:.75});run(q,16.7,2);
 run(q,125,6);assert.ok(q.scale<1.5,`scale ${q.scale}`);
});
import {createQualityGovernor} from '../src/quality-governor.js';
test('quality governor drops extras one at a time only while the lowest resolution is still slow',()=>{
 const done=[];const g=createQualityGovernor([()=>done.push('ao'),()=>done.push('bloom'),()=>done.push('msaa')]);
 for(let i=0;i<600;i++)g.update(1/60,{atMin:false,smoothed:40});assert.deepEqual(done,[]);
 for(let i=0;i<600;i++)g.update(1/60,{atMin:true,smoothed:12});assert.deepEqual(done,[]);
 for(let i=0;i<300;i++)g.update(1/60,{atMin:true,smoothed:40});assert.deepEqual(done,['ao']);
 for(let i=0;i<3000;i++)g.update(1/60,{atMin:true,smoothed:40});assert.deepEqual(done,['ao','bloom','msaa']);assert.equal(g.level,3);
});

test('a CPU-bound frame rate keeps its resolution (fewer pixels would not help)',()=>{
 const q=createAdaptiveResolution({max:1.5,min:.75});
 for(let t=0;t<10;t+=1/30)q.update(33.3,1/30,31);
 assert.equal(q.scale,1.5,'33 ms frames that are 31 ms of CPU work do not shrink the canvas');assert.equal(q.cpuBound,true);
 for(let t=0;t<10;t+=1/30)q.update(33.3,1/30,8);
 assert.ok(q.scale<1.5,'the same frame time with the CPU mostly idle (GPU-bound) does');
});

test('quality governor steps down CPU-bound frames too, starting with the draw-call step',()=>{
 const done=[];const g=createQualityGovernor([()=>done.push('ao'),()=>done.push('bloom'),()=>done.push('msaa'),()=>done.push('lod')],{cpuStep:3});
 for(let i=0;i<300;i++)g.update(1/60,{atMin:false,smoothed:40,cpuBound:true});assert.deepEqual(done,['lod']);assert.equal(g.has(3),true);
 for(let i=0;i<3000;i++)g.update(1/60,{atMin:false,smoothed:40,cpuBound:true});assert.deepEqual(done,['lod'],'GPU extras stay while the CPU is the limit');
 for(let i=0;i<3000;i++)g.update(1/60,{atMin:true,smoothed:40});assert.deepEqual(done,['lod','ao','bloom','msaa']);assert.equal(g.level,4);
});
