import test from 'node:test';
import assert from 'node:assert/strict';
import {createStuckWatch,STUCK_AFTER} from '../src/stuck.js';
test('holding the pedal without moving is stuck after a while; moving or letting go is not',()=>{
 const w=createStuckWatch();
 for(let t=0;t<STUCK_AFTER-.1;t+=1/60)assert.equal(w.update(true,0,0,1/60),false);
 for(let t=0;t<.2;t+=1/60)w.update(true,.01,0,1/60);assert.ok(w.stuck,'wedged');
 assert.equal(w.update(false,0,0,1/60),false,'let go');
 for(let t=0,x=0;t<5;t+=1/60,x+=.1)assert.equal(w.update(true,x,0,1/60),false,'driving along');
 for(let t=0;t<5;t+=1/60)assert.equal(w.update(true,Math.sin(t*9)*.2,0,1/60)&&t<STUCK_AFTER,false,'rocking in place counts from the first hold');
});
