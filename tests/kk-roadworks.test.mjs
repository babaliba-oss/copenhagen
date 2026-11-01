import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {SpatialIndex} from '../src/geo.js';
import {datedNow,createMappedFurniture} from '../src/mapped-furniture.js';

// The city's current roadworks (scripts/kk-roadworks.py, k101 trafikmelding) as barrier rows at the kerb, shown while they run.
const dir=new URL('../public/cities/copenhagen/',import.meta.url),read=f=>JSON.parse(readFileSync(new URL(f,dir)));
const city=JSON.parse(gunzipSync(readFileSync(new URL('city.pack',dir)))),mob=read('mobility.json'),items=read('furniture.json').items.filter(i=>i.src==='kk-roadworks');

test('roadworks barriers and cones carry the works\' dates, and show only while the works run',()=>{
 const barriers=items.filter(i=>i.k==='barrier'),cones=items.filter(i=>i.k==='cone');
 assert.ok(barriers.length>500&&barriers.length<1500,`${barriers.length} barriers`);assert.ok(cones.length>20,`${cones.length} cones`);
 assert.ok(items.every(i=>/^\d{4}-\d\d-\d\d$/.test(i.since)&&/^\d{4}-\d\d-\d\d$/.test(i.until)&&i.since<=i.until&&i.until>='2026-11-01'));
 assert.ok(new Set(items.map(i=>i.ref[0])).size>=15,'works');
 const it={since:'2026-11-03',until:'2027-08-02'},t=s=>Date.parse(s);
 assert.equal(datedNow(it,t('2026-11-01T12:00Z')),false,'two days before');assert.equal(datedNow(it,t('2026-11-02T12:00Z')),true,'the day before');
 assert.equal(datedNow(it,t('2027-08-03T12:00Z')),true,'the day after');assert.equal(datedNow(it,t('2027-08-05T00:00Z')),false,'over');assert.equal(datedNow({k:'bench'},0),true,'undated');
});

test('a barrier never stands in a traffic lane (no route is closed), in a house or in the water',()=>{
 const G=20,lanes=new Map();
 for(const e of mob.roads.edges){if(e.crossing)continue;const off=e.lane||0;for(let i=1;i<e.points.length;i++){const [a,b]=[e.points[i-1],e.points[i]],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(l<.3)continue;const dx=(b[0]-a[0])/l,dz=(b[1]-a[1])/l,s=[[a[0]-dz*off,a[1]+dx*off],[b[0]-dz*off,b[1]+dx*off]];
  for(let gx=Math.floor((Math.min(a[0],b[0])-5)/G);gx<=Math.floor((Math.max(a[0],b[0])+5)/G);gx++)for(let gz=Math.floor((Math.min(a[1],b[1])-5)/G);gz<=Math.floor((Math.max(a[1],b[1])+5)/G);gz++){const k=gx+','+gz;if(!lanes.has(k))lanes.set(k,[]);lanes.get(k).push(s);}}}
 const d=(x,z,[a,b])=>{const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l));return Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);};
 const houses=new SpatialIndex(city.buildings),water=new SpatialIndex(city.water),roads=new SpatialIndex(city.roads);
 for(const it of items){const near=lanes.get(Math.floor(it.x/G)+','+Math.floor(it.z/G))||[],r=it.k==='cone'?1.39:1.69;
  assert.ok(near.every(s=>d(it.x,it.z,s)>=r),`${it.k} at ${it.x},${it.z} in a traffic lane`);assert.ok(!houses.at(it.x,it.z)&&!water.at(it.x,it.z));}
 assert.ok(items.filter(i=>roads.at(i.x,i.z)).length>items.length*.95,'on the carriageway, at the kerb');
 const m=createMappedFurniture({source:'t',items:items.slice(0,5)},{canvas:null});assert.ok(m.knockables.near(items[0].x,items[0].z,3).length>=1,'knocked over by the car');
 const today=JSON.parse(readFileSync(new URL('../public/cities/index.json',import.meta.url),'utf8')).cities.find(c=>c.id==='copenhagen');assert.match(today.attribution,/Trafikmeldinger, CC BY 4\.0/);
});
