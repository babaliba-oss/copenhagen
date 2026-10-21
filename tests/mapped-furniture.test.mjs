import test from 'node:test';
import assert from 'node:assert/strict';
import {makeCar} from '../src/physics.js';
import {breakableSigns} from '../src/breakable-signs.js';
import {createMappedFurniture,plateLayout} from '../src/mapped-furniture.js';

test('runtime: plates stack by facing; posts are breakable, bins and junction boxes knockable, shelters solid',()=>{
 const layout=plateLayout([{face:'no-parking',code:'regulatory--no-parking'},{face:'complementary-text',code:'complementary--texts'},{face:'parking',code:'information--parking'}],[0,0,Math.PI]);
 assert.equal(layout.length,3);assert.ok(layout[1].y<layout[0].y,'second plate below the first');assert.equal(layout[2].y,layout[0].y,'back-to-back plate at the top');
 const layer={source:'test',faces:[{face:'no-parking',code:'regulatory--no-parking'}],items:[{k:'lamp',x:0,z:-6,yaw:0,mly:['l']},{k:'sign',x:20,z:0,yaw:0,faces:['no-parking'],yaws:[0],mly:['s']},{k:'traffic-light',x:40,z:0,yaw:0,mly:['t']},
  {k:'bin',x:60,z:0,yaw:0,mly:['b']},{k:'junction-box',x:80,z:0,yaw:0,mly:['j']},{k:'shelter',x:100,z:0,yaw:0,mly:['h']}]};
 const before=breakableSigns.snapshot().count;
 const m=createMappedFurniture(layer,{canvas:null});
 assert.equal(breakableSigns.snapshot().count-before,3,'lamp, sign and signal posts join the breakable sets');
 assert.equal(m.obstacles.length,1,'the shelter stays solid');for(const f of ['step','update','near','snapshot','resetAll'])assert.equal(typeof m.knockables[f],'function',`knockables.${f}`);m.knockables.update({x:0,z:0});m.knockables.step(1/60,makeCar(0,0,0),null);assert.equal(m.knockables.snapshot().count,2,'the bin and the junction box are knocked over');assert.equal(m.lights.length,1);
 // Drive into the lamp at 10 m/s: it bends or snaps and the hit counts.
 const car=makeCar(0,0,0);car.speed=10;const hits=breakableSigns.snapshot().hits;
 for(let i=0;i<60;i++){car.z-=car.speed/60;breakableSigns.step(1/60,car,null);}
 const lamp=[...m.chunks.values()].flatMap(c=>c.signs.bodies).find(b=>b.id==='mapped-lamp-l');
 assert.ok(lamp.knocked&&lamp.state!=='upright');assert.equal(breakableSigns.snapshot().hits-hits,1);
 for(const c of m.chunks.values())c.signs.dispose();
});

test('furniture placed just inside the mapped water moves ashore past the coping; on a bridge deck it stays',async()=>{
 const {bringAshore}=await import('../src/mapped-furniture.js');
 const wet=(x,z)=>x>0,deck=(x,z)=>z>50&&z<60,blocked=(x,z)=>x<-30;
 const r=bringAshore([{k:'bench',x:1.2,z:0},{k:'lamp',x:-5,z:0},{k:'sign',x:2,z:55},{k:'bin',x:40,z:0}],{wet,deck,blocked});
 assert.equal(r.moved,1);assert.equal(r.dropped,1,'well out on the water: dropped');
 const bench=r.items.find(i=>i.k==='bench');assert.ok(bench.x<=-.5&&bench.x>-1.5&&Math.abs(bench.z)<.01,`bench at ${bench.x},${bench.z}`);
 assert.deepEqual(r.items.find(i=>i.k==='lamp'),{k:'lamp',x:-5,z:0});assert.equal(r.items.find(i=>i.k==='sign').x,2,'on the deck');
});
