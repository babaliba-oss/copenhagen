import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createMappedFurniture,SOLIDS,KNOCK_SOLID} from '../src/mapped-furniture.js';

// Copenhagen's drinking posts and public toilets from Københavns Kommune's registers (scripts/kk-water-toilets.py).
const dir=new URL('../public/cities/copenhagen/',import.meta.url),read=f=>JSON.parse(readFileSync(new URL(f,dir)));
const city=JSON.parse(gunzipSync(readFileSync(new URL('city.pack',dir)))),kk=read('kk-footprints.json'),items=read('furniture.json').items;
const inside=(ring,x,z)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [ax,az]=ring[i],[bx,bz]=ring[j];if((az>z)!==(bz>z)&&x<ax+(z-az)*(bx-ax)/(bz-az))c=!c;}return c;};
const bbox=r=>{const xs=r.map(p=>p[0]),zs=r.map(p=>p[1]);return [Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)];};
const on=(list,x,z)=>list.some(p=>{const b=p.bbox||(p.bbox=bbox(p.rings[0]));return b[0]<=x&&x<=b[2]&&b[1]<=z&&z<=b[3]&&inside(p.rings[0],x,z)&&!p.rings.slice(1).some(h=>inside(h,x,z));});
const corners=(it)=>{const [w,d]=SOLIDS[it.k],c=Math.cos(it.yaw||0),s=Math.sin(it.yaw||0);return [[0,0],[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([a,b])=>[it.x+a*c+b*s,it.z-a*s+b*c]);};

test('the city\'s drinking posts and toilets stand clear of the roads, the houses and the water',()=>{
 const posts=items.filter(i=>i.k==='drinking-post'),toilets=items.filter(i=>i.k==='toilet');
 assert.ok(posts.length>=60&&posts.every(i=>i.src==='kk-vand'),`${posts.length} drinking posts`);
 assert.ok(toilets.length>=30&&toilets.every(i=>i.src==='kk-toilet'),`${toilets.length} toilets`);
 const roads=city.roads.filter(r=>!/island/.test(r.kind||'')),houses=[...city.buildings,...kk];
 for(const it of [...posts,...toilets])for(const [x,z] of corners(it)){
  assert.ok(!on(roads,x,z),`${it.k} ${it.ref} on the road`);assert.ok(!on(houses,x,z),`${it.k} ${it.ref} in a house`);assert.ok(!on(city.water,x,z),`${it.k} ${it.ref} in the water`);}
 assert.equal(posts.filter(p=>Math.hypot(p.x+720,p.z+38)<40).length,2,'Ørstedsparken\'s two posts');assert.ok(posts.some(p=>Math.hypot(p.x+450,p.z+290)<5),'one on Israels Plads');
 assert.ok(toilets.some(t=>t.name==='Blågårds Plads'));
});

test('drinking posts are knockable posts and toilets solid cabins, one instanced set each',()=>{
 assert.ok(KNOCK_SOLID.has('drinking-post')&&!KNOCK_SOLID.has('toilet'));
 const m=createMappedFurniture({source:'test',items:[{k:'drinking-post',x:0,z:0,yaw:0,src:'kk-vand',ref:['a']},{k:'drinking-post',x:5,z:0,yaw:1,src:'kk-vand',ref:['b']},{k:'toilet',x:20,z:0,yaw:0,src:'kk-toilet',ref:[1]}]},{canvas:null});
 assert.equal(m.obstacles.length,1,'the toilet is solid');assert.equal(m.obstacles[0].name,'toilet');
 const sets=[];m.group.traverse(o=>{if(o.isInstancedMesh)sets.push(o.name);});
 assert.ok(sets.includes('Mapped toilet'),sets.join());
 const near=m.knockables.near(0,0,3);assert.ok(near.length>=1,'the post near (0,0) can be knocked');
});
