import test from 'node:test';import assert from 'node:assert/strict';
import {createFramePacer} from '../src/frame-pacer.js';
test('a phone stuck at ~40 fps is held at an even 30',()=>{
 const p=createFramePacer();for(let i=0;i<300;i++)p.record(25,.025);assert.equal(p.half,true);
 // at 30 fps every other vsync is skipped
 let drawn=0;for(let t=0;t<1000;t+=16.7)if(!p.skip(t))drawn++;assert.ok(drawn>=29&&drawn<=31,`drawn ${drawn}`);
});
test('a fast device stays at 60 and a held one retries',()=>{
 const p=createFramePacer();for(let i=0;i<600;i++)p.record(16.7,.0167);assert.equal(p.half,false);
 const q=createFramePacer({retryEvery:2});for(let i=0;i<300;i++)q.record(25,.025);assert.equal(q.half,true);
 let n=0;while(q.half&&n++<200)q.record(33.3,.0333);assert.equal(q.half,false,'retried 60');
 for(let i=0;i<400;i++)q.record(16.7,.0167);assert.equal(q.half,false,'kept 60 when it holds');
});
test('off when disabled',()=>{const p=createFramePacer({enabled:false});for(let i=0;i<300;i++)p.record(30,.03);assert.equal(p.half,false);});
test('120 Hz screens are held at an even 30 too',()=>{
 const p=createFramePacer();for(let i=0;i<300;i++)p.record(25,.025);
 const gaps=[];let last=null;for(let t=0;t<2000;t+=8.33)if(!p.skip(t)){if(last!==null)gaps.push(t-last);last=t;}
 const later=gaps.slice(10);assert.ok(later.every(g=>Math.abs(g-33.3)<1),'gaps '+[...new Set(later.map(Math.round))]);
});
