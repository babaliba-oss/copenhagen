import test from 'node:test';
import assert from 'node:assert/strict';
const {createPant,PANT_REACH,PANT_RESPAWN}=await import('../src/copenhagen/pant.js');

const items=[];
for(let i=0;i<400;i++)items.push({k:['bench','bin','shelter','hotdog-stand','lamp'][i%5],x:(i%20)*30,z:Math.floor(i/20)*30,yaw:(i*.7)%6.28});

test('cans go to a share of the furniture, the same spots every time, never where the ground is not clear', () => {
 const a=createPant({items}),b=createPant({items});
 assert.equal(a.count,b.count);
 assert.ok(a.count>100&&a.count<300,`${a.count} cans for 320 benches, bins, shelters and stands`);
 const none=createPant({items,clear:()=>false});assert.equal(none.count,0);
 const lamps=createPant({items:items.filter(i=>i.k==='lamp')});assert.equal(lamps.count,0);
});

test('a can within reach is picked up once, drawn no more, and comes back after the respawn time', () => {
 const p=createPant({items:[{k:'hotdog-stand',x:0,z:0,yaw:0}]});
 assert.equal(p.count,2);
 const mesh=p.group.children[0];
 assert.equal(p.update(.1,{x:200,z:200}),0);assert.equal(mesh.count,0); // nothing near
 assert.equal(p.update(.3,{x:0,z:0}),0);assert.equal(mesh.count,2); // drawn once near (the list is refilled four times a second; picked up from then on)
 let got=0;for(const r of [0,.5,1,1.5,2,2.5,3])for(let a=0;a<6.3;a+=.2)got+=p.update(.01,{x:Math.cos(a)*r,z:Math.sin(a)*r});
 assert.equal(got,2);assert.equal(mesh.count,0);
 p.update(PANT_RESPAWN+1,{x:50,z:50});p.update(.3,{x:50,z:50});assert.equal(mesh.count,2);
 assert.ok(PANT_REACH>1&&PANT_REACH<3);
});

test('no collecting while collect is off (the cinematic drives past)', () => {
 const p=createPant({items:[{k:'hotdog-stand',x:0,z:0,yaw:0}]});
 p.update(.3,{x:0,z:0});
 let got=0;for(let a=0;a<6.3;a+=.2)for(const r of [0,1,2])got+=p.update(.01,{x:Math.cos(a)*r,z:Math.sin(a)*r},{collect:false});
 assert.equal(got,0);
});
