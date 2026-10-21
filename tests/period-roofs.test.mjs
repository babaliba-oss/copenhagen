import test from 'node:test';import assert from 'node:assert/strict';
import {periodRoof} from '../src/period-roofs.js';
// A 10 x 20 m box, 12 m tall, flat roof: walls + two roof triangles (stride 5).
function box(w,d,h){const v=[],q=(a,b,c,e)=>v.push(...a,0,0,...b,0,0,...c,0,0,...a,0,0,...c,0,0,...e,0,0);
 const P=(x,y,z)=>[x,y,z];q(P(0,0,0),P(w,0,0),P(w,h,0),P(0,h,0));q(P(w,0,0),P(w,0,d),P(w,h,d),P(w,h,0));q(P(w,0,d),P(0,0,d),P(0,h,d),P(w,h,d));q(P(0,0,d),P(0,0,0),P(0,h,0),P(0,h,d));
 q(P(0,h,0),P(w,h,0),P(w,h,d),P(0,h,d));return new Float32Array(v);}
test('a flat-roofed house gets a hipped roof rising from its eaves to a ridge',()=>{
 const a=box(10,20,12),pos=periodRoof(a,{start:0,count:a.length/5});assert.ok(pos&&pos.length>=9);
 let lo=Infinity,hi=-Infinity;for(let i=1;i<pos.length;i+=3){lo=Math.min(lo,pos[i]);hi=Math.max(hi,pos[i]);}
 assert.ok(Math.abs(lo-12.04)<.01,'eaves sit on the wall tops');assert.ok(hi>15&&hi<12.04+4.21,'ridge a few metres up, capped');
});
test('pitched or low parts are left alone',()=>{const a=box(10,20,3);assert.equal(periodRoof(a,{start:0,count:a.length/5}),null);});
// The city model is cut along footprints: a terrace house has no wall where its neighbour stood.
test('an open cut (no wall under a roof edge) is walled, facing out; walled sides are left alone',async()=>{
 const {partyWalls,periodShapes}=await import('../src/period-roofs.js');
 const full=box(10,20,12),stride=30,cut=new Float32Array([...full.slice(0,stride),...full.slice(stride*2)]); // drop the x=10 wall (the second quad)
 assert.equal(partyWalls(full,{start:0,count:full.length/5}),null,'a closed house needs nothing');
 const pos=partyWalls(cut,{start:0,count:cut.length/5});assert.ok(pos&&pos.length>=18);
 let ylo=Infinity,yhi=-Infinity;for(let i=0;i<pos.length;i+=3){assert.ok(Math.abs(pos[i]-(10-.03))<1e-4,'3 cm inside the cut');ylo=Math.min(ylo,pos[i+1]);yhi=Math.max(yhi,pos[i+1]);}
 assert.equal(ylo,0);assert.equal(yhi,12);
 for(let i=0;i<pos.length;i+=9){const ux=pos[i+3]-pos[i],uy=pos[i+4]-pos[i+1],uz=pos[i+5]-pos[i+2],wx=pos[i+6]-pos[i],wy=pos[i+7]-pos[i+1],wz=pos[i+8]-pos[i+2];assert.ok(uy*wz-uz*wy>0,'faces +x, out of the house');}
 const shapes=periodShapes(cut,[{start:0,count:cut.length/5,roofColor:[.5,.2,.1],color:[.8,.7,.5]}]);assert.equal(shapes.length,2,'roof and wall');
 assert.equal(periodShapes(cut,[{start:0,count:cut.length/5,noRoof:true,noWalls:true}]).length,0);
});
// A side walled only near the top (it stood clear above a neighbour that is now taller than the house in 1760) is
// closed below, 10 cm inside so the measured wall above stays in front.
test('a side walled only near the top is closed below it',async()=>{
 const {partyWalls}=await import('../src/period-roofs.js');
 const full=box(10,20,12),stride=30,top=[10,8,0,0,0, 10,8,20,0,0, 10,12,20,0,0, 10,8,0,0,0, 10,12,20,0,0, 10,12,0,0,0];
 const a=new Float32Array([...full.slice(0,stride),...top,...full.slice(stride*2)]);
 const pos=partyWalls(a,{start:0,count:a.length/5});assert.ok(pos&&pos.length>=18,'the open lower part is walled');
 let ylo=Infinity,yhi=-Infinity;for(let i=0;i<pos.length;i+=3){assert.ok(Math.abs(pos[i]-(10-.1))<1e-4,'behind the measured wall');ylo=Math.min(ylo,pos[i+1]);yhi=Math.max(yhi,pos[i+1]);}
 assert.equal(ylo,0);assert.ok(yhi>=8,'up to the measured wall');
});
