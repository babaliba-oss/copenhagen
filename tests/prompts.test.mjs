// First-time prompts: one at a time, once each, worded for the device.
import test from 'node:test';import assert from 'node:assert/strict';
import {createPrompts,promptText,PROMPT_IDS} from '../src/prompts.js';
const store=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),m};};
const base={started:true,busy:false,toast:false,device:'keys',era:0,mode:'car',speed:8,target:200,person:false,delivered:0,canEra:true};
const run=(p,s,seconds,dt=.14)=>{const out=[];for(let t=0;t<seconds;t+=dt){const id=p.update(dt,s);if(id)out.push(id);}return out;};

test('every prompt has wording for keys, touch and pad in both eras, with the right button names',()=>{
 for(const id of PROMPT_IDS)for(const device of ['keys','touch','pad'])for(const era of [0,1760])for(const mode of ['car','bike']){const t=promptText(id,{device,era,mode});assert.ok(t.length>10&&t.length<110,t);
  if(device!=='keys')assert.doesNotMatch(t,/WASD|\b[FGMJ] (to|opens)|Press Y/,t);if(device==='touch')assert.doesNotMatch(t,/RT|D-pad|\b[XY] to/,t);}
 assert.match(promptText('drive',{device:'keys',era:1760}),/drive the coach\. Follow the gold line/);assert.match(promptText('drive',{device:'pad'}),/^RT to drive, LT to brake, left stick to steer\. Follow the purple line to the beam: your first job\.$/);
 assert.match(promptText('exit',{device:'keys',era:1760}),/F to step down and walk/);assert.match(promptText('exit',{device:'touch',mode:'bike'}),/Tap Get off/);assert.match(promptText('exit',{device:'pad'}),/Y to get out/);
 assert.match(promptText('era',{device:'keys',era:1760}),/come back to today/);
});
test('how to drive comes first, once: a second visit starts without it',()=>{
 const s=store(),shown=[];let p=createPrompts({storage:s,show:(t,o)=>shown.push([t,o.ms])});
 assert.equal(p.update(.14,{...base,started:false}),null);assert.equal(p.update(.14,{...base,toast:true}),'drive','nothing to wait for at the start');
 assert.match(shown[0][0],/WASD or arrow keys to drive/);assert.ok(shown[0][1]>=8000,'long enough to read behind the fading start card');assert.equal(s.m.get('hint-drive'),'1');
 p=createPrompts({storage:s,show:t=>shown.push(t)});assert.deepEqual(run(p,base,30),[]);assert.equal(shown.length,1);
});
test('each of the others at its moment, never two together, never while busy',()=>{
 const shown=[],p=createPrompts({storage:store(),show:t=>shown.push(t),eraAfter:130});
 assert.deepEqual(run(p,base,1),['drive']);
 assert.deepEqual(run(p,{...base,speed:0,target:30},8),[],'the gap after a prompt');
 assert.deepEqual(run(p,{...base,speed:0,target:30,busy:true},9),[],'a race, a dialogue, the pause card');
 assert.deepEqual(run(p,{...base,speed:0,target:30,toast:true},9),[],'another toast is up');
 assert.deepEqual(run(p,{...base,speed:0,target:6},5),[],'at the beam: no need to get out');assert.deepEqual(run(p,{...base,speed:9,target:30},5),[],'driving past');
 assert.deepEqual(run(p,{...base,speed:0,target:30},5),['exit']);assert.match(shown[1],/Can't drive up to the beam\? F to get out and walk\./);
 assert.deepEqual(run(p,{...base,mode:'walk',speed:0,person:true},3),[],'still inside the gap');
 assert.deepEqual(run(p,{...base,mode:'walk',speed:0,person:true},12),['talk']);
 assert.deepEqual(run(p,{...base,delivered:1},3),[],'the Delivered banner first');assert.deepEqual(run(p,{...base,delivered:1},12),['map']);
 assert.deepEqual(run(p,{...base,delivered:1,canEra:false},60),[],'no era switch in the middle of a delivery');
 assert.deepEqual(run(p,{...base,delivered:1},20),['era']);assert.deepEqual(run(p,{...base,delivered:2,speed:0,target:30,person:true},60),[],'all said');assert.equal(shown.length,5);
});
test('a returning player with deliveries behind them is not told about the map at the start; storage that throws shows each once a visit',()=>{
 const s=store();s.setItem('hint-drive','1');const p=createPrompts({storage:s,show(){}});assert.deepEqual(run(p,{...base,delivered:7,canEra:false},30),[]);
 const shown=[],q=createPrompts({storage:{getItem(){throw Error('denied');},setItem(){throw Error('denied');}},show:t=>shown.push(t)});assert.deepEqual(run(q,{...base,canEra:false},40),['drive']);
});
