import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {SpatialIndex} from '../src/geo.js';
import {createMappedFurniture,SOLIDS} from '../src/mapped-furniture.js';

// Play equipment from Københavns Kommune's park register (scripts/kk-playgrounds.py, k101 dp_lege_aktivitetselementer_p).
const dir=new URL('../public/cities/copenhagen/',import.meta.url),read=f=>JSON.parse(readFileSync(new URL(f,dir)));
const city=JSON.parse(gunzipSync(readFileSync(new URL('city.pack',dir)))),items=read('furniture.json').items.filter(i=>i.src==='kk-leg');
const KINDS=['swing','slide','climbing-frame','spring-rider','sandbox','goal'];
const corners=it=>{const [w,d]=SOLIDS[it.k],c=Math.cos(it.yaw),s=Math.sin(it.yaw);return [[0,0],[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([a,b])=>[it.x+a*c+b*s,it.z-a*s+b*c]);};

test('the playgrounds get swings, slides, climbing frames, spring riders, sandboxes and goals',()=>{
 assert.ok(items.length>550,`${items.length} items`);for(const k of KINDS)assert.ok(items.filter(i=>i.k===k).length>=25,k);
 assert.ok(items.every(i=>KINDS.includes(i.k)&&i.ref?.[0]));
 assert.ok(items.filter(i=>Math.hypot(i.x+1392,i.z+1869)<20).length>=8,'the playground in Fælledparken\'s south-west');
});

test('play equipment stands on park ground, clear of roads, paths, houses, water and each other',()=>{
 const hard=new SpatialIndex([...city.roads,...city.pavement,...city.buildings]),water=new SpatialIndex(city.water);
 for(const it of items)for(const [x,z] of corners(it)){assert.ok(!hard.at(x,z),`${it.k} ${it.ref[0]} on a road, path or house`);assert.ok(!water.at(x,z),`${it.k} in the water`);}
 for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){const a=items[i],b=items[j];if(Math.hypot(a.x-b.x,a.z-b.z)<(Math.min(...SOLIDS[a.k].slice(0,2))+Math.min(...SOLIDS[b.k].slice(0,2)))/2-.05)assert.fail(`${a.k} and ${b.k} overlap at ${a.x},${a.z}`);}
});

test('each kind is one solid instanced set of our own low-poly model',()=>{
 const m=createMappedFurniture({source:'t',items:KINDS.map((k,i)=>({k,x:i*10,z:0,yaw:0,src:'kk-leg',ref:[k]}))},{canvas:null});
 assert.equal(m.obstacles.length,KINDS.length);const meshes=[];m.group.traverse(o=>{if(o.isInstancedMesh&&/Mapped (swing|slide|climbing|spring|sandbox|goal)/.test(o.name))meshes.push(o);});
 assert.equal(meshes.length,KINDS.length);for(const o of meshes){const tris=o.geometry.attributes.position.count/3;assert.ok(tris<=400,`${o.name} ${tris} triangles`);o.geometry.computeBoundingBox();const [w,d,h]=SOLIDS[o.name.replace('Mapped ','')],b=o.geometry.boundingBox;
  assert.ok(b.max.y<=h+.1&&b.min.y>=-.05&&b.max.x-b.min.x<=w+.15&&b.max.z-b.min.z<=d+.15,`${o.name} fits its footprint`);}
 const today=JSON.parse(readFileSync(new URL('../public/cities/index.json',import.meta.url),'utf8')).cities.find(c=>c.id==='copenhagen');assert.match(today.attribution,/Lege- og aktivitetselementer/);
});
