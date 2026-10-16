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
