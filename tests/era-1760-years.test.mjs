import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createLandmarks,CHAPEL1760,HIDE_1760} from '../src/copenhagen/landmarks.js';

// scripts/era-1760-years.py: the 1760 map checked against the BBR construction years of today's buildings.
const R='public/cities/copenhagen-1760/',read=f=>{const b=fs.readFileSync(R+f);return b[0]===0x1f?gunzipSync(b):b;};
const index=JSON.parse(fs.readFileSync(R+'buildings3d-index.json','utf8')),parts=new Map(index.tiles.flatMap(t=>t.parts.map(p=>[p.id,{...p,file:t.file}])));
const city=JSON.parse(read('city.pack')),picks=JSON.parse(fs.readFileSync('cities/copenhagen-1760/bbr-1760.json','utf8')).houses;
const era=JSON.parse(fs.readFileSync(R+'era.json','utf8'));
const inRing=(r,X,Z)=>{let q=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>Z)!==(b[1]>Z)&&X<(b[0]-a[0])*(Z-a[1])/(b[1]-a[1])+a[0])q=!q;}return q;};
const PERIOD=['#d9b26f','#e8d39a','#8e3b2e','#bdb6a6','#ece4d0','#d99c7f','#a8ae96','#a5503a','#c99a5b','#e3d5b8','#b46e4f'].map(h=>[1,3,5].map(i=>Math.round(parseInt(h.slice(i,i+2),16)/255*1000)/1000).join());

test('houses BBR dates to 1760 or earlier that the 1760 map left out are drawn, solid, in the period palette', () => {
 assert.ok(picks.length>=10,'picks '+picks.length);
 for(const h of picks){
  assert.ok(h.years.every(y=>y>=1500&&y<=1760),h.id);
  const p=parts.get(h.id);assert.ok(p,`${h.id} in the 1760 tiles`);assert.equal(p.texture,null);assert.ok(PERIOD.includes(p.color.join())||p.name==='Prinsens Palæ',`${h.id} period walls`);
  const v=new Float32Array(read(p.file).buffer.slice(0));assert.ok((p.start+p.count)*5<=v.length&&p.count>0&&p.count%3===0);
  const [a,b,c,d]=p.bbox;for(let i=p.start;i<p.start+p.count;i+=97){const x=v[i*5],z=v[i*5+2];assert.ok(x>=a-.05&&x<=c+.05&&z>=b-.05&&z<=d+.05,`${h.id} vertex in its box`);}
 }
 const palace=parts.get('kk-osm-relation-1989714');assert.equal(palace?.name,'Prinsens Palæ','the National Museum is Prinsens Palæ (1684, Eigtved 1743-44)');assert.deepEqual(palace.color,[.902,.863,.769],'plastered');
 const feet=city.buildings.filter(b=>b.id.startsWith('model-kk-osm-relation-1989714-'));assert.ok(feet.length&&feet.some(f=>inRing(f.rings[0],-73,591)),'Prinsens Palæ has a footprint');
 for(const t of index.tiles)for(const p of t.parts){const [a,b,c,d]=p.bbox;assert.ok(a>=t.bbox[0]-.01&&b>=t.bbox[1]-.01&&c<=t.bbox[2]+.01&&d<=t.bbox[3]+.01,`${p.id} inside its tile's box`);}
});

test('modern blocks where 1760 had no house are anachronisms, with no footprint left', () => {
 for(const id of ['kk-osm-way-28075587','kk-osm-relation-13732243','kk-osm-way-407543153','osm-relation-18181071','osm-way-539811464']){
  assert.ok(era.anachronisms.includes(id),id);assert.ok(parts.has(id),`${id} still in the tiles (hidden at load)`);
  assert.ok(!city.buildings.some(b=>b.id===id.replace(/^kk-/,'')),`${id}: footprint removed`);
 }
 assert.equal(new Set(era.anachronisms).size,era.anachronisms.length,'no repeats');
 assert.ok(Object.keys(era.lateBridges).length>=20&&era.mills.length===12,'the other era lists kept');
});

test('Operaparken (2023) is lawn in 1760: no paths in city.pack or the surface chunks', () => {
 const park=city.parks.find(p=>p.name==='Operaparken');assert.ok(park);const r=park.rings[0],inside=(x,z)=>inRing(r,x,z);
 const cen=ring=>[ring.reduce((s,q)=>s+q[0],0)/ring.length,ring.reduce((s,q)=>s+q[1],0)/ring.length];
 assert.equal(city.pavement.filter(p=>p.rings?.[0]&&inside(...cen(p.rings[0]))).length,0,'no path pieces');
 let lawn=0;for(const f of ['surfaces/4_-1.bin.pack','surfaces/5_-1.bin.pack']){const v=new Float32Array(read(f).buffer.slice(0));
  for(let i=0;i<v.length;i+=18){const x=(v[i]+v[i+6]+v[i+12])/3,z=(v[i+2]+v[i+8]+v[i+14])/3;if(!inside(x,z))continue;const y=v[i+1];assert.ok(Math.abs(y-.025)<1e-4||Math.abs(y-.07)<1e-4,`paving at ${x.toFixed(0)},${z.toFixed(0)} (y ${y})`);if(Math.abs(y-.025)<1e-4)lawn++;}}
 assert.ok(lawn>5000,'lawn triangles '+lawn);
});

test('1760 draws the first palace chapel, not Hansen\'s domed Slotskirke of 1826', () => {
 assert.ok(HIDE_1760.includes('kk-osm-way-25521086'));
 const lm=createLandmarks({era:1760,anchors:{},mills:[]}),o=lm.obstacles.filter(q=>q.name==='Slotskapellet');
 assert.equal(o.length,1);assert.ok(inRing(o[0].rings[0],CHAPEL1760.x,CHAPEL1760.z));
 const {x,z,rot,hx}=CHAPEL1760;assert.ok(!inRing(o[0].rings[0],x+(hx+3)*Math.cos(rot),z-(hx+3)*Math.sin(rot)),'open beyond its end');
 assert.equal(createLandmarks({era:null,anchors:{},mills:[]}).obstacles.filter(q=>q.name==='Slotskapellet').length,0,'today: the model\'s church');
 assert.ok(CHAPEL1760.top<33,'no dome: lower than the model\'s 33 m');
});
