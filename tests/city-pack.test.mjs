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
