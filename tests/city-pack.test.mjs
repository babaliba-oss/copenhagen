import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {gunzipSync} from 'node:zlib';
import {compactCity,expandCity} from '../src/city-pack.js';
test('compacted city.pack expands back to the same rings and bboxes',()=>{
 const raw=fs.readFileSync('public/cities/copenhagen-1760/city.pack'),city=JSON.parse(gunzipSync(raw));
 const packed=JSON.parse(JSON.stringify(compactCity(JSON.parse(JSON.stringify(city)))));
 assert.equal(packed.packed,2);assert.ok(!('rings' in packed.buildings[0]));
 const back=expandCity(packed);
 for(const k of ['buildings','roads','pavement','parks','water']){assert.equal(back[k].length,city[k].length);
  city[k].forEach((f,i)=>{const g=back[k][i];assert.equal(g.rings.length,f.rings.length);g.rings.forEach((r,j)=>{assert.equal(r.length,f.rings[j].length);r.forEach((p,n)=>{assert.ok(Math.abs(p[0]-f.rings[j][n][0])<=.0051&&Math.abs(p[1]-f.rings[j][n][1])<=.0051);});});g.bbox.forEach((v,n)=>assert.ok(Math.abs(v-f.bbox[n])<=.0051));assert.equal(g.address,f.address);assert.equal(g.kind,f.kind);});}
});
test('plain city.pack passes through expandCity untouched',()=>{const c={buildings:[{rings:[[[0,0],[1,0],[1,1]]],bbox:[0,0,1,1]}]};assert.equal(expandCity(c),c);});
import {compactMobility,expandMobility} from '../src/mobility-pack.js';
test('compacted mobility graph expands back to the same edges',()=>{
 const m=JSON.parse(fs.readFileSync('public/cities/copenhagen-1760/mobility.json','utf8'));
 const packed=JSON.parse(JSON.stringify(compactMobility(JSON.parse(JSON.stringify(m)))));
 assert.equal(packed.packed,2);
 const back=expandMobility(packed),near=(a,b)=>Math.abs(a-b)<=.0051;
 for(const g of ['roads','walks']){assert.equal(back[g].nodes.length,m[g].nodes.length);assert.equal(back[g].edges.length,m[g].edges.length);
  m[g].nodes.forEach((p,i)=>assert.ok(near(p[0],back[g].nodes[i][0])&&near(p[1],back[g].nodes[i][1])));
  m[g].edges.forEach((e,i)=>{const f=back[g].edges[i];assert.equal(f.from,e.from);assert.equal(f.to,e.to);assert.equal(f.length,e.length);assert.equal(f.lane,e.lane);assert.equal(f.crossing,e.crossing);assert.equal(f.signal,e.signal);
   assert.equal(f.points.length,e.points.length);e.points.forEach((p,j)=>assert.ok(near(p[0],f.points[j][0])&&near(p[1],f.points[j][1])));
   assert.deepEqual(f.points[0],back[g].nodes[f.from]);});}
 assert.deepEqual(back.signals,m.signals);
});
