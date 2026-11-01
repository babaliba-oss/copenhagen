import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';

// Houses the 2013 city model has that have been pulled down since (scripts/kk-demolished.py, against GeoDanmark's
// current buildings) are gone from today's map: their meshes, their collision footprints and the ground pads under them.
const dir='public/cities/copenhagen/';
const unzip=b=>b[0]===31&&b[1]===139?zlib.gunzipSync(b):b;
const idx=JSON.parse(fs.readFileSync(dir+'buildings3d-index.json','utf8'));
const city=JSON.parse(unzip(fs.readFileSync(dir+'city.pack')));
const feet=JSON.parse(fs.readFileSync(dir+'kk-footprints.json','utf8'));
const list=JSON.parse(fs.readFileSync('cities/copenhagen/demolished.json','utf8'));
const parts=new Map();for(const t of idx.tiles)for(const p of t.parts)parts.set(p.id,{t,p});

// whole houses gone: lots that are now lawns, car parks and building sites, the Botanical Garden's old research
// glasshouses, a round tank at Lynetten, the old building by Dybbølsbro
const DEMOLISHED=['kk--2014--1065','kk--596-2686','kk-802-2016','kk--146--891','kk--2336--2326','kk-2439--1893','kk--1013-1537'];
// still standing: ordinary model-only back houses GeoDanmark has, and pieces it does not register as buildings
// (a glazed link between two halls, a skyway over a drive-in) that are left in place
const STANDING=['kk-1393--796','kk--2683--1947'];

test('demolished houses are gone from the tiles and the collision', () => {
 assert.ok(list.pieces.length>200,`${list.pieces.length} pieces listed`);
 for(const id of DEMOLISHED){
  assert.ok(list.pieces.some(p=>p.id===id),`${id} listed`);
  assert.ok(!parts.has(id),`${id} still drawn`);
  assert.ok(!feet.some(f=>f.id===id),`${id} still in kk-footprints`);
  assert.ok(!city.buildings.some(b=>b.id.startsWith(`model-${id}-`)),`${id} still has a model footprint`);
 }
});

test('houses still standing remain', () => {
 for(const id of STANDING){assert.ok(parts.has(id),`${id} is drawn`);assert.ok(list.leftInPlace.some(p=>p.id===id),`${id} left in place on purpose`);}
 const kk=[...parts.keys()].filter(id=>/^kk-(?!osm-)/.test(id));
 assert.ok(kk.length>3000,`${kk.length} model-only houses left`);
});

test('a house partly demolished keeps only what stands', () => {
 // kk-726-1933: the big hall's site is a lawn now (2,272 m2 gone); smaller pieces of the same model house stand
 const {t,p}=parts.get('kk-726-1933');const a=new Float32Array(unzip(fs.readFileSync(dir+t.file)).buffer.slice(0));
 const gone=list.pieces.filter(q=>q.id==='kk-726-1933');assert.ok(gone.some(q=>q.area>2000));
 const inside=(x,z,r)=>{let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const A=r[i],B=r[j];if((A[1]>z)!==(B[1]>z)&&x<(B[0]-A[0])*(z-A[1])/(B[1]-A[1])+A[0])c=!c;}return c;};
 let n=0;for(let v=p.start;v<p.start+p.count;v+=3){const x=(a[v*5]+a[v*5+5]+a[v*5+10])/3,z=(a[v*5+2]+a[v*5+7]+a[v*5+12])/3;if(gone.some(q=>inside(x,z,q.ring)))n++;}
 assert.ok(n<p.count/30,`${n} of ${p.count/3} triangles still over the removed pieces`);
});

test('the file:start keys still point at parts', () => {
 const keys=new Set();for(const t of idx.tiles)for(const p of t.parts)keys.add(t.file+':'+p.start);
 for(const k of JSON.parse(fs.readFileSync(dir+'duplicates.json','utf8')))assert.ok(keys.has(k),k);
 for(const t of idx.tiles){const n=unzip(fs.readFileSync(dir+t.file)).length/20;const last=t.parts.at(-1);assert.equal(last.start+last.count,n,t.file);}
});
