import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {expandMobility} from '../src/mobility-pack.js';
import {prepareGraph,routePoint} from '../src/mobility.js';

// Copenhagen's parked cars, bus stops and bus shelters from Københavns Kommune's map data (scripts/parked-cars.py,
// scripts/movia-stops.mjs, scripts/kk-shelters.py).
const dir=new URL('../public/cities/copenhagen/',import.meta.url),read=f=>JSON.parse(readFileSync(new URL(f,dir)));
const city=JSON.parse(gunzipSync(readFileSync(new URL('city.pack',dir)))),parked=read('parked.json');
const inside=(ring,x,z)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [ax,az]=ring[i],[bx,bz]=ring[j];if((az>z)!==(bz>z)&&x<ax+(z-az)*(bx-ax)/(bz-az))c=!c;}return c;};
const onStreet=(names,x,z)=>city.roads.some(r=>names.includes(r.name)&&r.bbox[0]<=x&&x<=r.bbox[2]&&r.bbox[1]<=z&&z<=r.bbox[3]&&inside(r.rings[0],x,z));
const near=(x,z,r)=>parked.cars.filter(c=>Math.hypot(c[0]-x,c[1]-z)<r).length;

test('parked cars stand where the city has kerbside parking, and nowhere on the pedestrian streets',()=>{
 assert.match(parked.source,/Københavns Kommune/);
 assert.ok(parked.cars.length>10000&&parked.cars.length<16000,String(parked.cars.length)); // 3,025 before the carriageways reached the kerbs (kk-kerbs.py)
 assert.ok(near(-1699,1113,150)>=40,'Saxogade, Vesterbro: parking both sides'); // 14 within 200 m before the register
 assert.ok(parked.cars.some(c=>onStreet(['Saxogade'],c[0],c[1])));
 const pedestrian=['Købmagergade','Østergade','Amagertorv','Vimmelskaftet','Nygade','Frederiksberggade','Strøget'];
 assert.equal(parked.cars.filter(c=>onStreet(pedestrian,c[0],c[1])).length,0);
 assert.equal(near(189,156,120),0,'none around Amagertorv'); // the nearest kerbside parking: Valkendorfsgade, Nikolaj Plads (140 m)
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

test('no parked car stands where a car driving its lane would touch it, on the bends and junction turns too (parked-lanes.mjs)',()=>{
 const roads=prepareGraph(expandMobility(read('mobility.json')).roads),grid=new Map(),C=10,key=(x,z)=>Math.floor(x/C)+','+Math.floor(z/C);
 for(const c of parked.cars){const k=key(c[0],c[1]);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(c);}
 const box=(a,b,[aw,al],[bw,bl])=>{const axes=[a[2],b[2]].flatMap(y=>[[Math.sin(y),Math.cos(y)],[Math.cos(y),-Math.sin(y)]]),dx=b[0]-a[0],dz=b[1]-a[1],r=(c,w,l,[ux,uz])=>l*Math.abs(Math.sin(c[2])*ux+Math.cos(c[2])*uz)+w*Math.abs(Math.cos(c[2])*ux-Math.sin(c[2])*uz);return axes.every(ax=>Math.abs(dx*ax[0]+dz*ax[1])<r(a,aw,al,ax)+r(b,bw,bl,ax));};
 const hit=new Set();
 for(const e of roads.edges){if(e.crossing)continue;for(let s=0;s<=e.length;s+=.5){const p=routePoint(e,s,e.lane),m=[p.x,p.z,p.heading],gx=Math.floor(p.x/C),gz=Math.floor(p.z/C);
  for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const c of grid.get((gx+i)+','+(gz+j))||[])if(box(c,m,[.9,2.15],[.98,2.36]))hit.add(c);}}
 assert.equal(hit.size,0,JSON.stringify([...hit].slice(0,5))); // 8 of 13,204 before (one across the lane at -2194,-1363)
});
