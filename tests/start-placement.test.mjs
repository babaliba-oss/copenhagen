import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {startSurfaces,startClear,laneStart} from '../src/start-placement.js';
import {SpatialIndex} from '../src/geo.js';

// A 7 m two-way street running north (−z), 3 m pavement each side, an island splitting it at the far end.
const box=(x0,z0,x1,z1,kind,name)=>({kind,name,rings:[[[x0,z0],[x1,z0],[x1,z1],[x0,z1],[x0,z0]]]});
const roads=[box(-3.5,-200,3.5,0,'Ajorata','Testikatu'),box(-.5,-200,.5,-150,'Koroke')],pavement=[box(-6.5,-200,-3.5,0,'Jalkakäytävä'),box(3.5,-200,6.5,0,'Jalkakäytävä')];
const north={points:[[0,0],[0,-200]],length:200,lane:1.45},south={points:[[0,-200],[0,0]],length:200,lane:1.45};
const surfaces=startSurfaces(roads,pavement);

test('a car against the kerb, or on an island, is not a clear start',()=>{
 assert.ok(startClear({x:1.45,z:-60,heading:0},surfaces));
 assert.ok(!startClear({x:2.8,z:-60,heading:0},surfaces),'wheels at the kerb');
 assert.ok(!startClear({x:1.45,z:-60,heading:Math.PI/2},surfaces),'across the street');
 assert.ok(!startClear({x:0,z:-160,heading:0},surfaces),'on the island');
 assert.ok(!startClear({x:0,z:-144,heading:0},surfaces),'island straight ahead');
});

test('a start beside the pavement moves into the right-hand lane, facing the traffic',()=>{
 const p=laneStart({name:'Kerb',x:3.2,z:-60,heading:0},[north,south],surfaces);
 assert.ok(Math.abs(p.x-1.45)<1e-6&&Math.abs(p.z+60)<1.01,`${p.x},${p.z}`);assert.equal(p.heading,0);assert.equal(p.name,'Kerb');
 // Facing south it takes the southbound lane on the other side rather than driving against traffic.
 const q=laneStart({x:-3.2,z:-60,heading:Math.PI},[north,south],surfaces);
 assert.ok(Math.abs(q.x+1.45)<1e-6&&Math.abs(Math.abs(q.heading)-Math.PI)<1e-3);
 // A one-way street keeps the car pointing the legal way even when asked otherwise.
 const r=laneStart({x:0,z:-60,heading:Math.PI},[{...north,lane:.35}],surfaces);
 assert.equal(r.heading,0);assert.ok(startClear(r,surfaces));
 assert.equal(laneStart({x:500,z:500,heading:0},[north],surfaces),null,'nothing nearby');
});

test('R recovers the car onto the nearest clear lane spot: past a building on the lane, off a parked car, within reach',()=>{
 // A house built out over the northbound lane (z −70…−50): the car goes just past it, where its body and the 8 m ahead are clear.
 const house=new SpatialIndex([box(.2,-70,3.4,-50,'Rakennus')]),walled={drive:surfaces.drive,blocked:{at:(x,z)=>surfaces.blocked.at(x,z)||house.at(x,z)}};
 const p=laneStart({x:3.2,z:-60,heading:0},[north,south],walled,{step:1});
 assert.ok(Math.abs(p.x-1.45)<1e-6&&p.heading===0&&p.z<=-72.9&&p.z>-75,`${p.x},${p.z},${p.heading}`);assert.ok(startClear(p,walled));
 // Something standing in the lane (main.js: furniture, traffic) is ruled out by accept.
 const q=laneStart({x:3.2,z:-60,heading:0},[north,south],surfaces,{step:1,accept:s=>Math.hypot(s.x-1.45,s.z+60)>=6});
 assert.ok(Math.abs(q.x-1.45)<1e-6&&Math.abs(q.z+60)>=6&&Math.abs(q.z+60)<7,`${q.x},${q.z}`);
 // Reach is distance: the only lane 45 m away runs the other way and still counts (turning round is a penalty, not a limit).
 const r=laneStart({x:45,z:-60,heading:Math.PI},[{...north,lane:.35}],surfaces);
 assert.ok(r&&r.heading===0&&Math.abs(r.x-.35)<1e-6,`${r?.x},${r?.heading}`);
 assert.equal(laneStart({x:70,z:-60,heading:0},[north],surfaces),null,'nothing within 60 m: main.js falls back to the starting point');
});

const json=f=>JSON.parse(readFileSync(f)),unpack=f=>JSON.parse(gunzipSync(readFileSync(f))),INDEX='public/data/extensions/index.json';
test('Länsiväylä and Espoo starts: in a lane, clear of kerbs, facing the traffic',{skip:!existsSync(INDEX)},()=>{
 const index=json(INDEX),main=unpack('public/data/city.pack'),roads=[...main.roads],pavement=[...main.pavement],edges=[...json('public/data/mobility.json').roads.edges];
 for(const e of index.extensions){const c=unpack(`public/data/${e.dir}/city.pack`);roads.push(...c.roads);pavement.push(...c.pavement);edges.push(...json(`public/data/${e.dir}/mobility.json`).roads.edges);}
 const world=startSurfaces(roads,pavement),starts=index.extensions.filter(e=>['lansivayla','espoo'].includes(e.id)).flatMap(e=>e.starts);
 assert.deepEqual(starts.map(s=>s.name),['Lauttasaari','Koivusaari','Keilaniemi','Otaniemi (Aalto University)','Tapiola centre']);
 for(const s of starts){
  assert.ok(startClear(s,world),`${s.name}: car body on the carriageway with room around it`);
  // On a directed road edge's lane line, pointing the same way.
  let best=Infinity;for(const e of edges)for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!l)continue;const dx=(b[0]-a[0])/l,dz=(b[1]-a[1])/l,t=(s.x-a[0])*dx+(s.z-a[1])*dz;if(t<0||t>l)continue;
   const off=Math.hypot(a[0]+dx*t-dz*(e.lane||0)-s.x,a[1]+dz*t+dx*(e.lane||0)-s.z),turn=Math.abs(Math.atan2(Math.sin(s.heading-Math.atan2(-dx,-dz)),Math.cos(s.heading-Math.atan2(-dx,-dz))));if(turn<.26)best=Math.min(best,off);}
  assert.ok(best<1,`${s.name}: ${best.toFixed(2)} m from a lane facing its way`);
 }
 const keilaniemi=starts.find(s=>s.name==='Keilaniemi');assert.ok(startClear(keilaniemi,world,{margin:1}),'Keilaniemi: a metre clear of the kerbs');
});
