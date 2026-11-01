import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

// Copenhagen's parked cars, bus stops and bus shelters from Københavns Kommune's map data (scripts/parked-cars.py,
// scripts/movia-stops.mjs, scripts/kk-shelters.py).
const dir=new URL('../public/cities/copenhagen/',import.meta.url),read=f=>JSON.parse(readFileSync(new URL(f,dir)));
const city=JSON.parse(gunzipSync(readFileSync(new URL('city.pack',dir)))),parked=read('parked.json');
const inside=(ring,x,z)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [ax,az]=ring[i],[bx,bz]=ring[j];if((az>z)!==(bz>z)&&x<ax+(z-az)*(bx-ax)/(bz-az))c=!c;}return c;};
const onStreet=(names,x,z)=>city.roads.some(r=>names.includes(r.name)&&r.bbox[0]<=x&&x<=r.bbox[2]&&r.bbox[1]<=z&&z<=r.bbox[3]&&inside(r.rings[0],x,z));
const near=(x,z,r)=>parked.cars.filter(c=>Math.hypot(c[0]-x,c[1]-z)<r).length;

test('parked cars stand where the city has kerbside parking, and nowhere on the pedestrian streets',()=>{
 assert.match(parked.source,/Københavns Kommune/);
 assert.ok(parked.cars.length>2500&&parked.cars.length<4000,String(parked.cars.length));
 assert.ok(near(-1699,1113,150)>=40,'Saxogade, Vesterbro: parking both sides'); // 14 within 200 m before the register
 assert.ok(parked.cars.some(c=>onStreet(['Saxogade'],c[0],c[1])));
 const pedestrian=['Købmagergade','Østergade','Amagertorv','Vimmelskaftet','Nygade','Frederiksberggade','Strøget'];
 assert.equal(parked.cars.filter(c=>onStreet(pedestrian,c[0],c[1])).length,0);
 assert.equal(near(189,156,200),0,'none around Amagertorv');
 assert.equal(near(176,-134,60),0,'none on Købmagergade by Kultorvet');
});

test('bus stops carry Movia\'s names, and the city\'s bus shelters stand off the road',()=>{
 const bus=read('bus-corridors.json');assert.match(bus.stopsSource,/Movia/);
 assert.ok(bus.stops.some(s=>s.name==='Christiansborg'&&s.movia));
 assert.ok(bus.stops.some(s=>s.name==='Østerport st.'));
 assert.ok(bus.stops.filter(s=>s.movia).length>450);
 const shelters=read('furniture.json').items.filter(i=>i.k==='shelter'&&i.src==='kk-afa');
 assert.ok(shelters.length>100,String(shelters.length));
 const roads=city.roads.filter(r=>!/island/.test(r.kind||''));
 for(const s of shelters)assert.ok(!roads.some(r=>r.bbox[0]<=s.x&&s.x<=r.bbox[2]&&r.bbox[1]<=s.z&&s.z<=r.bbox[3]&&inside(r.rings[0],s.x,s.z)),`shelter ${s.ref} on the road`);
});
