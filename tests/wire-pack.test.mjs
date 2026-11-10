import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {slimFurniture,compactBusCorridors,expandBusCorridors} from '../src/wire-pack.js';
test('shipped furniture.json drops the provenance fields and nothing else',()=>{
 const f=JSON.parse(fs.readFileSync('public/cities/copenhagen/furniture.json','utf8')),s=slimFurniture(f);
 assert.equal(s.items.length,f.items.length);assert.equal(s.attribution,f.attribution);assert.deepEqual(s.faces,f.faces);
 for(let i=0;i<f.items.length;i+=97){const {mly,seen,ref,...rest}=f.items[i];assert.deepEqual(s.items[i],rest);}
 assert.ok(!s.items.some(it=>'mly' in it||'seen' in it||'ref' in it));assert.ok(f.items.some(it=>it.mly),'the file in public/ keeps them');
 assert.ok(JSON.stringify(s).length<JSON.stringify(f).length*.8);
 assert.deepEqual(slimFurniture({note:1}),{note:1});
});
test('shipped bus-corridors.json expands back to the same paths, to the centimetre',()=>{
 const d=JSON.parse(fs.readFileSync('public/cities/copenhagen/bus-corridors.json','utf8')),c=compactBusCorridors(d),e=expandBusCorridors(JSON.parse(JSON.stringify(c)));
 assert.equal(c.packed,1);assert.ok(!('packed' in e));assert.ok(JSON.stringify(c).length<JSON.stringify(d).length*.6);
 assert.deepEqual(e.stops,d.stops);assert.deepEqual(e.signals,d.signals);assert.equal(e.paths.length,d.paths.length);
 d.paths.forEach((p,i)=>{const q=e.paths[i],{points,...rest}=p,{points:got,...restGot}=q;assert.deepEqual(restGot,rest);assert.equal(got.length,points.length);
  for(let k=0;k<points.length;k++){assert.ok(Math.abs(got[k][0]-points[k][0])<=.00501&&Math.abs(got[k][1]-points[k][1])<=.00501);}});
 assert.equal(expandBusCorridors(d),d,'the plain file passes through');assert.equal(compactBusCorridors(c),c);
});
