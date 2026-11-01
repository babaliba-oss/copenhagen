import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {SpatialIndex,pointInPolygon} from '../src/geo.js';

// Today's carriageways widened out to the city's kerb lines (scripts/kk-kerbs.py: GeoDanmark road edges, Københavns
// Kommune's WFS k101 vejkant): strips in city.pack (kk-kerb-*) and in the surface chunks at 6.8 cm, the cycle tracks out
// to their own edge at 5.2 cm, the furniture moved off the new carriageway.
const dir=new URL('../public/cities/copenhagen/',import.meta.url),unzip=b=>b[0]===31&&b[1]===139?gunzipSync(b):b,read=f=>JSON.parse(readFileSync(new URL(f,dir)));
const city=JSON.parse(unzip(readFileSync(new URL('city.pack',dir))));
const strips=city.roads.filter(r=>String(r.id).startsWith('kk-kerb-')),stripIndex=new SpatialIndex(strips);
const area=ring=>{let a=0;for(let i=0,j=ring.length-1;i<ring.length;j=i++)a+=(ring[j][0]-ring[i][0])*(ring[j][1]+ring[i][1]);return Math.abs(a)/2;};

test('the carriageways reach the city\'s kerbs: strips beside the OpenStreetMap roads, named after them',()=>{
 const m2=strips.reduce((s,r)=>s+area(r.rings[0]),0);
 assert.ok(strips.length>10000&&m2>450000&&m2<800000,`${strips.length} strips, ${Math.round(m2)} m2`);
 for(const name of ['Istedgade','Ryesgade','Nørrebrogade','Saxogade'])assert.ok(strips.some(r=>r.name===name),name);
 assert.ok(strips.every(r=>/^Ajorata$/.test(r.kind)&&['Asfaltti','Nupukivi','Betonikivi'].includes(r.material)));
});

test('no strip on a house or in the water, and none in Frederiksberg (no kerb data there)',()=>{
 const houses=new SpatialIndex(city.buildings.filter(b=>!/^(roof|bridge|carport|construction)$/.test(b.kind||''))),water=new SpatialIndex(city.water);
 const bad=[];for(const r of strips){const ring=r.rings[0];for(let i=0;i<ring.length-1;i+=3){const x=(ring[i][0]+ring[i+1][0])/2,z=(ring[i][1]+ring[i+1][1])/2;if(houses.at(x,z)||water.at(x,z))bad.push([x|0,z|0]);}}
 assert.ok(bad.length<20,`${bad.length} strip edges on a house or in the water: ${JSON.stringify(bad.slice(0,6))}`);
 assert.equal(strips.filter(r=>r.bbox[2]>-1959&&r.bbox[0]<-1879&&r.bbox[3]>572&&r.bbox[1]<652).length,0,'Frederiksberg Allé');
});

test('the parking lanes are drawn now, and the cars stand in them on the residential streets',()=>{
 const parked=read('parked.json').cars,roads=new SpatialIndex(city.roads.filter(r=>r.name));
 const on=name=>parked.filter(([x,z])=>roads.near(x,z).some(r=>r.name===name&&pointInPolygon(x,z,r.rings))).length;
 assert.ok(parked.length>10000,String(parked.length));
 for(const [name,n] of [['Istedgade',40],['Ryesgade',50],['Saxogade',20]])assert.ok(on(name)>=n,`${name}: ${on(name)}`);
});

test('the surface chunks draw the strips (6.8 cm) and the cycle tracks out to their edge (5.2 cm)',()=>{
 let road=0,track=0;
 for(const r of read('surface-index.json')){const b=unzip(readFileSync(new URL(r.file+'.pack',dir))),a=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
  for(let i=1;i<a.length;i+=18){if(Math.abs(a[i]-.068)<1e-4)road++;else if(Math.abs(a[i]-.052)<1e-4)track++;}}
 assert.ok(road>50000&&track>20000,`${road} carriageway, ${track} cycle-track triangles`);
});

test('no street furniture or painted bicycle left on the wider carriageway',()=>{
 // (the roadworks barriers, scripts/kk-roadworks.py, stand in the parking lane at the kerb on purpose)
 const items=read('furniture.json').items.filter(i=>i.k!=='wire-lamp'&&i.src!=='kk-roadworks'&&stripIndex.at(i.x,i.z));
 assert.ok(items.length<40,`${items.length} on the strips: ${JSON.stringify(items.slice(0,5).map(i=>[i.k,i.x,i.z]))}`);
 const marks=read('cycle-marks.json').marks.filter(([x,z])=>stripIndex.at(x,z));
 assert.equal(marks.length,0);
});

test('today\'s Copenhagen credits the city\'s road edges',()=>{
 const today=JSON.parse(readFileSync(new URL('../public/cities/index.json',import.meta.url),'utf8')).cities.find(c=>c.id==='copenhagen');
 assert.match(today.attribution,/Kerb lines \(carriageway and cycle-track edges\): Københavns Kommune \/ GeoDanmark, Vejkant, CC BY 4\.0/);
});
