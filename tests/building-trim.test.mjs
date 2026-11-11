import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

// Roof sheets the 2013 model pulls to a far point are cut off the houses named in scripts/building-trim.py, and a
// house whose model was another building is drawn as its footprint. Church spires look the same to the detector
// (scripts/building-strays.py) and must stay.
const dir='public/cities/copenhagen/';
const unzip=b=>b[0]===31&&b[1]===139?zlib.gunzipSync(b):b;
const idx=JSON.parse(fs.readFileSync(dir+'buildings3d-index.json','utf8'));
const city=JSON.parse(unzip(fs.readFileSync(dir+'city.pack')));
const hidden=new Set(JSON.parse(fs.readFileSync(dir+'duplicates.json','utf8')));
const parts=new Map();for(const t of idx.tiles)for(const p of t.parts)parts.set(p.id,{t,p});
const verts=id=>{const {t,p}=parts.get(id);const a=new Float32Array(unzip(fs.readFileSync(dir+t.file)).buffer.slice(0));return a.subarray(p.start*5,(p.start+p.count)*5);};
const rings=id=>city.buildings.find(b=>b.id===id.slice(3)).rings;
const inside=(x,z,rs)=>{let c=false;for(const r of rs)for(let i=0,j=r.length-1;i<r.length;j=i++){const A=r[i],B=r[j];if((A[1]>z)!==(B[1]>z)&&x<(B[0]-A[0])*(z-A[1])/(B[1]-A[1])+A[0])c=!c;}return c;};
const outside=(x,z,rs)=>{if(inside(x,z,rs))return 0;let d=Infinity;for(const r of rs)for(let i=0,j=r.length-1;i<r.length;j=i++){const [ax,az]=r[j],[bx,bz]=r[i],l=(bx-ax)**2+(bz-az)**2,s=l?Math.max(0,Math.min(1,((x-ax)*(bx-ax)+(z-az)*(bz-az))/l)):0;d=Math.min(d,Math.hypot(x-ax-s*(bx-ax),z-az-s*(bz-az)));}return d;};
const farthest=id=>{const v=verts(id),rs=rings(id);let m=0;for(let i=0;i<v.length;i+=5)m=Math.max(m,outside(v[i],v[i+2],rs));return m;};

const TRIMMED=['kk-osm-way-67528468','kk-osm-way-253797399','kk-osm-way-105951035','kk-osm-way-133961765'];
const LOCKE='kk-osm-way-1103097512';

test('no roof sheet reaches far out of the trimmed houses', () => {
 for(const id of TRIMMED){const m=farthest(id);assert.ok(m<=15.01,`${id}: a corner ${m.toFixed(1)} m outside its footprint`);
  const {p}=parts.get(id),v=verts(id);let x0=Infinity,x1=-Infinity;for(let i=0;i<v.length;i+=5){x0=Math.min(x0,v[i]);x1=Math.max(x1,v[i]);}
  assert.ok(Math.abs(p.bbox[0]-x0)<.02&&Math.abs(p.bbox[2]-x1)<.02,`${id}: bbox follows the mesh`);}
 // the hall on Grønlandske Handels Plads (pulled down) with the widest sheet of all is not drawn
 const {t,p}=parts.get('kk-osm-way-587591587');assert.ok(hidden.has(t.file+':'+p.start),'kk-osm-way-587591587 is hidden');
});

test('Locke Aparthotel is its footprint pushed up, solid on all of it', () => {
 assert.ok(farthest(LOCKE)<.02);
 const v=verts(LOCKE),{p}=parts.get(LOCKE);let top=-Infinity,low=Infinity;for(let i=1;i<v.length;i+=5){top=Math.max(top,v[i]);low=Math.min(low,v[i]);}
 for(let i=1;i<v.length;i+=5)assert.ok(v[i]===top||v[i]===low,'only a flat roof and wall feet');
 assert.ok(top-low>p.height&&top-low<p.height+6,`${(top-low).toFixed(1)} m of wall for a ${p.height} m house`);
 const cut=JSON.parse(fs.readFileSync(dir+'collision-trim.json','utf8'));
 assert.ok(!Object.keys(cut).some(k=>k.split('#')[0]===LOCKE.slice(3)),'footprint not cut back to the old model');
});

test('the sheets leave no collision behind', () => {
 const plan=id=>{const v=verts(id),tris=[];for(let i=0;i<v.length;i+=15)tris.push([[v[i],v[i+2]],[v[i+5],v[i+7]],[v[i+10],v[i+12]]]);return tris;};
 for(const id of [...TRIMMED,LOCKE]){const tris=plan(id);
  for(const b of city.buildings.filter(b=>b.id.startsWith(`model-${id}-`))){
   const [x0,z0,x1,z1]=b.bbox;let n=0,hit=0;
   for(let x=x0+.5;x<x1;x+=1)for(let z=z0+.5;z<z1;z+=1){if(!inside(x,z,b.rings))continue;n++;if(tris.some(t=>inside(x,z,[t])))hit++;}
   assert.ok(hit>=n*.5,`${b.id}: ${hit} of ${n} m2 under the house's roofs`);}}
 for(const gone of ['model-kk-osm-way-253797399-1','model-kk-osm-way-133961765-0','model-kk-osm-way-1103097512-3'])assert.ok(!city.buildings.some(b=>b.id===gone),gone);
});

test('the spires stand', () => {
 // [vertices, top]: Børsen's dragon spire and Sankt Johannes Kirke's
 for(const [id,count,top] of [['kk-osm-way-25466204',1461,48.78],['kk-osm-way-41252796',1614,54.62]]){
  const v=verts(id);let y=-Infinity;for(let i=1;i<v.length;i+=5)y=Math.max(y,v[i]);
  assert.equal(v.length/5,count,id);assert.ok(Math.abs(y-top)<.01,`${id}: top at ${y}`);}
});

test('the file:start keys still point at parts', () => {
 const keys=new Set();for(const t of idx.tiles)for(const p of t.parts)keys.add(t.file+':'+p.start);
 for(const k of hidden)assert.ok(keys.has(k),k);
});
