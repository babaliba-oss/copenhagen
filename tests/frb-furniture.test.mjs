import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {SpatialIndex} from '../src/geo.js';
import {SOLIDS} from '../src/mapped-furniture.js';

// Frederiksberg's street furniture and parking from Frederiksberg Kommune's open data (scripts/frb-furniture.py,
// scripts/parked-cars.py <wfs dir> <frb dir>): the west of the map, where Københavns Kommune's registers stop.
const dir=new URL('../public/cities/copenhagen/',import.meta.url),read=f=>JSON.parse(readFileSync(new URL(f,dir)));
const city=JSON.parse(gunzipSync(readFileSync(new URL('city.pack',dir)))),all=read('furniture.json').items,items=all.filter(i=>String(i.src).startsWith('frb-'));
const of=k=>items.filter(i=>i.k===k),SIZE={...SOLIDS,bin:[.5,.5],'parking-meter':[.3,.3]};
const corners=it=>{const [w,d]=SIZE[it.k],c=Math.cos(it.yaw),s=Math.sin(it.yaw);return [[0,0],[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([a,b])=>[it.x+a*c+b*s,it.z-a*s+b*c]);};
const PLAY=['swing','slide','climbing-frame','spring-rider','sandbox','goal'];

test('Frederiksberg gets its bins, parking machines, toilets, drinking posts and playgrounds, in the west only',()=>{
 assert.ok(of('bin').length>=400,`${of('bin').length} bins`);assert.ok(of('parking-meter').length>=5);assert.ok(of('toilet').length>=3);assert.equal(of('drinking-post').length,2);
 for(const k of PLAY.slice(0,5))assert.ok(of(k).length>=8,k);assert.ok(of('goal').length>=2);
 assert.ok(items.every(i=>i.x<-1100&&i.ref?.length===1&&/^frb-(skrald|automat|toilet|vand|leg)$/.test(i.src)),'all west of the lakes, each with its record id');
 {const one=items.filter(i=>i.k!=='goal');assert.equal(new Set(one.map(i=>i.src+i.k+i.ref[0])).size,one.length,'no record twice');} // a ball court has two goals
 assert.ok(of('bin').filter(i=>Math.hypot(i.x+1900,i.z-560)<400).length>=20,'bins round the east end of Gammel Kongevej and Frederiksberg Allé');
});

test('nothing is added on top of what was there: no second bin, machine or toilet beside one',()=>{
 const others=all.filter(i=>!String(i.src).startsWith('frb-'));
 for(const [k,r] of [['bin',4],['parking-meter',4],['toilet',15],['drinking-post',5]]){const old=others.filter(i=>i.k===k);
  for(const it of of(k))assert.ok(!old.some(o=>Math.abs(o.x-it.x)<r+2&&Math.hypot(o.x-it.x,o.z-it.z)<r-1.6),`${k} ${it.ref[0]} beside one that was there`);} // an item is moved up to 1.5 m from its register point
});

test('Frederiksberg\'s items stand clear of the roads, the houses and the water; play equipment off the paths too',()=>{
 const roads=new SpatialIndex(city.roads.filter(r=>!/island/.test(r.kind||''))),houses=new SpatialIndex([...city.buildings,...read('kk-footprints.json')]),water=new SpatialIndex(city.water),paths=new SpatialIndex([...city.roads,...city.pavement]);
 for(const it of items)for(const [x,z] of corners(it)){
  assert.ok(!roads.at(x,z),`${it.k} ${it.ref[0]} on the road`);assert.ok(!houses.at(x,z),`${it.k} ${it.ref[0]} in a house`);assert.ok(!water.at(x,z),`${it.k} ${it.ref[0]} in the water`);
  if(PLAY.includes(it.k))assert.ok(!paths.at(x,z),`${it.k} ${it.ref[0]} on a path`);}
 const play=items.filter(i=>PLAY.includes(i.k));
 for(let i=0;i<play.length;i++)for(let j=i+1;j<play.length;j++){const a=play[i],b=play[j];assert.ok(Math.hypot(a.x-b.x,a.z-b.z)>=(Math.min(...SOLIDS[a.k].slice(0,2))+Math.min(...SOLIDS[b.k].slice(0,2)))/2,`${a.k} and ${b.k} overlap at ${a.x},${a.z}`);}
});

test('parked cars stand on Frederiksberg\'s parking strips, and the municipality is credited',()=>{
 const parked=read('parked.json');assert.match(parked.source,/Frederiksberg Kommune, Parkeringspladser, CC BY 4\.0/);
 const west=parked.cars.filter(c=>c[0]<-1900&&c[1]>-900&&c[1]<1100).length;assert.ok(west>=300,`${west} cars in the map's west`); // 100 before, on Copenhagen's side of the border
 const today=JSON.parse(readFileSync(new URL('../public/cities/index.json',import.meta.url),'utf8')).cities.find(c=>c.id==='copenhagen');
 assert.match(today.attribution,/Frederiksberg Kommune, Skraldespande, Parkeringsautomater, Offentlige toiletter, Friluftstilbud and Parkeringspladser, CC BY 4\.0 \(opendata\.dk\/city-of-frederiksberg\)/);
 assert.match(read('furniture.json').licence,/Frederiksberg Kommune open data CC BY 4\.0/);
});
