import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

// Today's trees from Københavns Kommune's current tree register (scripts/kk-trees.py, k101 trae_basis, 2026-09).
const dir=new URL('../public/cities/copenhagen/',import.meta.url);
const city=JSON.parse(gunzipSync(readFileSync(new URL('city.pack',dir)))),trees=city.trees,kk=trees.filter(t=>t.src==='kk');

test('the register\'s street, park and churchyard trees replace the older street-tree export',()=>{
 assert.ok(kk.length>22000&&kk.length<26000,`${kk.length} register trees`);
 assert.equal(trees.filter(t=>t.height&&!t.fill&&t.src!=='kk').length,0,'no tree left from the older export');
 assert.ok(kk.filter(t=>Math.abs(t.p[0]+1667)<200&&Math.abs(t.p[1]+1169)<200).length>1500,'Assistens Kirkegård\'s trees');
 assert.ok(trees.length<48000,`${trees.length} trees in all (the far crowns cost ~200 triangles each)`);
});

test('the crowns keep their variety: species and heights from the register',()=>{
 const genera=new Set(kk.filter(t=>t.species).map(t=>t.species.split(' ')[0]));assert.ok(genera.size>60,`${genera.size} genera`);
 const h=kk.map(t=>t.height);assert.ok(Math.min(...h)<5&&Math.max(...h)>=18,'young and old trees');
 const buckets=new Set(h.map(v=>Math.round(v)));assert.ok(buckets.size>=14,`${buckets.size} height classes`);
});

test('no OpenStreetMap or filled-in tree doubles a register tree',()=>{
 const G=8,grid=new Map();for(const t of kk){const k=Math.floor(t.p[0]/G)+','+Math.floor(t.p[1]/G);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(t);}
 const near=(p,r)=>{for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const t of grid.get((Math.floor(p[0]/G)+i)+','+(Math.floor(p[1]/G)+j))||[])if(Math.hypot(t.p[0]-p[0],t.p[1]-p[1])<r)return true;return false;};
 assert.equal(trees.filter(t=>t.src!=='kk'&&!t.fill&&near(t.p,4)).length,0,'OpenStreetMap trees within 4 m');
 assert.ok(trees.filter(t=>t.fill&&near(t.p,3)).length<200,'fill trees on top of a register tree');
 const today=JSON.parse(readFileSync(new URL('../public/cities/index.json',import.meta.url),'utf8')).cities.find(c=>c.id==='copenhagen');assert.match(today.attribution,/Københavns Kommune, Træer \(trae_basis/);
});
