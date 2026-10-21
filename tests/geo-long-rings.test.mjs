import test from 'node:test';
import assert from 'node:assert/strict';
import {SpatialIndex,pointInPolygon} from '../src/geo.js';

// Long rings are tested by z bands inside SpatialIndex.at: the answer must be pointInPolygon's, edges, vertices and holes included.
test('SpatialIndex.at answers like pointInPolygon on long rings with holes',()=>{
 const star=(n,cx,cz,r0,r1)=>Array.from({length:n},(_,i)=>{const a=i/n*Math.PI*2,r=i%2?r0:r1;return [cx+Math.round(Math.cos(a)*r*4)/4,cz+Math.round(Math.sin(a)*r*4)/4];});
 const poly={rings:[star(400,0,0,60,140),star(120,10,-5,15,30),[[60,60],[70,60],[70,70],[60,70]]]},small={rings:[[[200,0],[210,0],[210,10],[200,10]]]};
 const index=new SpatialIndex([poly,small]);let seed=5;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
 for(let i=0;i<20000;i++){const x=i%4?rnd()*440-160:Math.round(rnd()*280-140),z=i%4?rnd()*300-150:Math.round(rnd()*4*280-560)/4; // a quarter on the 25 cm grid the vertices sit on
  const want=pointInPolygon(x,z,poly.rings)?poly:pointInPolygon(x,z,small.rings)?small:undefined;assert.equal(index.at(x,z),want,`${x},${z}`);}
});
