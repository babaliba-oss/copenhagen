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
import {dropWalksThroughBuildings} from '../src/mobility-pack.js';
test('footway edges through a drawn house, or hugging its wall, are dropped; crossings and paths beside it stay',()=>{
 const house={rings:[[[0,0],[20,0],[20,10],[0,10],[0,0]]]},edge=(points,crossing=false)=>({points,length:points.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-points[i][0],p[1]-points[i][1]),0),crossing});
 const through=edge([[-5,5],[25,5]]),hugging=edge([[2,10.3],[18,10.3]]),beside=edge([[-5,12],[25,12]]),door=edge([[10,10.5],[10,14]]),zebra=edge([[-5,5],[25,5]],true);
 const walks={edges:[through,hugging,beside,door,zebra]};
 assert.equal(dropWalksThroughBuildings(walks,[house]),2);
 assert.deepEqual(walks.edges,[beside,door,zebra]);
 const c=JSON.parse(gunzipSync(fs.readFileSync('public/cities/copenhagen/city.pack'))),m=expandMobility(JSON.parse(fs.readFileSync('public/cities/copenhagen/mobility.json','utf8')));
 const n=m.walks.edges.length,dropped=dropWalksThroughBuildings(m.walks,expandCity(c).buildings.filter(b=>!/^(roof|construction|carport|bridge)$/.test(b.kind||'')));
 assert.ok(dropped>500&&dropped<n*.04,`${dropped} of ${n} Copenhagen footway edges dropped`);
 assert.ok(!m.walks.edges.some(e=>e.points.some(([x,z])=>Math.abs(x-162.43)<.01&&Math.abs(z-377.18)<.01)),'the path along the Thorvaldsen Museum\'s wall is gone');
});

test('the walkers\' footways are cut to the pavement: stretches on the carriageway go, short spurs left at a kerb are pruned, crossings stay; the full graph stays for the GPS',async()=>{
 const {kerbPieces,cutWalksAtKerbs}=await import('../src/mobility-pack.js');
 /* pavement z<10, carriageway 10..20, pavement beyond; a footway along the pavement (0,5)-(40,5) with a 4 m spur (20,5)-(20,9) running on to the centreline (20,15), a crossing (30,9)-(30,21) */
 const walkable=(x,z)=>z<10||z>20,N=[[0,5],[20,5],[40,5],[20,15],[30,9],[30,21],[30,5]];
 const E=[],pair=(f,t,crossing=false)=>{const P=[N[f],N[t]],l=Math.hypot(P[1][0]-P[0][0],P[1][1]-P[0][1]);E.push({from:f,to:t,points:P.map(p=>[...p]),length:l,lane:0,crossing,signal:-1},{from:t,to:f,points:P.map(p=>[...p]).reverse(),length:l,lane:0,crossing,signal:-1});};
 pair(0,1);pair(1,6);pair(6,2);pair(1,3);pair(4,5,true);pair(6,4);
 const full={nodes:N.map(p=>[...p]),edges:E},r=cutWalksAtKerbs(full,kerbPieces(full,walkable)),walks=r.walks;
 assert.equal(full.edges.length,12,'the full graph is left as it is');assert.equal(full.nodes.length,7);
 assert.equal(r.cut,1,'the spur is cut at the kerb');assert.equal(r.pruned,1,'and the 4 m left of it pruned back to the footway');
 assert.ok(!walks.edges.some(e=>e.from===3||e.to===3),'nothing reaches the centreline');
 assert.equal(walks.edges.filter(e=>e.crossing).length,2,'the crossing stays');assert.equal(walks.edges.length,10);
 for(const e of walks.edges){assert.deepEqual(e.points[0],walks.nodes[e.from]);assert.deepEqual(e.points.at(-1),walks.nodes[e.to]);}
 /* Copenhagen as shipped (scripts/kerb-walks.mjs): no walker's footway runs onto the carriageway any more; the GPS's graph keeps the street */
 const {SpatialIndex}=await import('../src/geo.js'),c=expandCity(JSON.parse(gunzipSync(fs.readFileSync('public/cities/copenhagen/city.pack')))),m=expandMobility(JSON.parse(fs.readFileSync('public/cities/copenhagen/mobility.json','utf8'))),w=cutWalksAtKerbs(m.walks,m.walkerCut).walks,mid=e=>!e.crossing&&e.points.some(([x,z],i)=>i&&Math.hypot((x+e.points[i-1][0])/2-525.5,(z+e.points[i-1][1])/2+333.5)<1);
 const roads=new SpatialIndex(c.roads.filter(r=>!/Koroke/.test(r.kind||''))),on=w.edges.filter(e=>!e.crossing&&e.points.some(([x,z],i)=>i&&roads.at((x+e.points[i-1][0])/2,(z+e.points[i-1][1])/2)));
 assert.ok(w.edges.length<m.walks.edges.length/2);assert.ok(on.length<w.edges.length*.002,`${on.length} footway edges with a segment midpoint on the carriageway`);
 assert.ok(!w.edges.some(mid)&&m.walks.edges.some(mid),'the street centreline by 507,-304 is gone for walkers, there for the GPS');
});

test('1760: the bridges listed as built later are left out, with the footways and lanes along them, and each is a bridge in the data',async()=>{
 const fs=await import('node:fs'),zlib=await import('node:zlib'),{dropLateBridges}=await import('../src/mobility-pack.js');
 const era=JSON.parse(fs.readFileSync('public/cities/copenhagen-1760/era.json','utf8')),gone=era.lateBridges;assert.ok(Object.keys(gone).length>=20);
 for(const [id,why] of Object.entries(gone))assert.ok(typeof why==='string'&&why.length>10,`${id} has a reason`);
 const city=expandCity(JSON.parse(zlib.gunzipSync(fs.readFileSync('public/cities/copenhagen-1760/city.pack')))),{walks,roads}=expandMobility(JSON.parse(fs.readFileSync('public/cities/copenhagen-1760/mobility.json','utf8'))),n=walks.edges.length,m=roads.edges.length;
 const late=dropLateBridges(city,walks,gone,roads);assert.equal(late.length,Object.keys(gone).length,'every id is in the 1760 data');
 {const silta=late.filter(p=>/\(Silta\)/.test(p.kind)),touch=(p,q)=>p.bbox[0]<=q.bbox[2]+3&&q.bbox[0]<=p.bbox[2]+3&&p.bbox[1]<=q.bbox[3]+3&&q.bbox[1]<=p.bbox[3]+3;assert.ok(late.every(p=>silta.includes(p)||silta.some(q=>touch(p,q))),'only bridges, and the untagged footways, cycle track and island lying on them');}assert.ok(walks.edges.length<n,'the footways across them go');
 assert.deepEqual([...new Set(late.filter(p=>/Ajorata/.test(p.kind)).map(p=>p.name))].sort(),['Bryghusbroen','Børsbroen','Christian D. IV\'s Bro','Danneskiold-Samsøes Allé','Nyhavnsbroen'],'carriage bridges: Nyhavn 1874, Bryghusbroen 1935, Børsbroen 1880, Christian IV\'s 1961, Værftsbroen to Holmen 1860-70');
 assert.ok(roads.edges.length<m&&!roads.edges.some(e=>e.points.some(([x,z])=>x>950&&x<975&&z<30)&&e.points.some(([x,z])=>x>950&&x<975&&z>50)),'no lane crosses the mouth of Nyhavn');
 {const adj=new Map();for(const e of roads.edges)for(const [a,b] of [[e.from,e.to],[e.to,e.from]])(adj.get(a)||adj.set(a,[]).get(a)).push(b);const s=roads.edges[0].from,seen=new Set([s]),q=[s];while(q.length)for(const w of adj.get(q.pop()))if(!seen.has(w)){seen.add(w);q.push(w);}
  assert.equal(seen.size,adj.size,'no stub of a dropped bridge is left as an island of lanes (the Harbour Run started from one and was never planned)');}
 assert.ok(![...city.roads,...city.pavement].some(p=>p.id in gone));
 assert.ok(!roads.edges.some(e=>e.points.some(([x,z])=>x>1550&&z<95&&z>-300)),'no coach on Holmen: no land link before 1860');assert.ok(roads.edges.some(e=>e.points.some(([x,z])=>x>640&&x<690&&z>520&&z<565)&&e.points.some(([x,z])=>x>720&&x<770&&z>600&&z<650)),'Knippelsbro still carries the coaches');
 assert.ok(city.pavement.some(p=>p.name==='Ved Norgesporten')&&city.pavement.some(p=>p.name==='Grønne Bro'),'the citadel\'s Norway Gate and Rosenborg\'s bridge stay');
});

test('1760: a dropped bridge\'s ramps are cut to the dry ground; their land parts and the quay lanes over them stay',async()=>{
 const zlib=await import('node:zlib'),{default:pc}=await import('polygon-clipping'),{dropLateBridges}=await import('../src/mobility-pack.js');
 const era=JSON.parse(fs.readFileSync('public/cities/copenhagen-1760/era.json','utf8')),city=expandCity(JSON.parse(zlib.gunzipSync(fs.readFileSync('public/cities/copenhagen-1760/city.pack')))),{walks,roads}=expandMobility(JSON.parse(fs.readFileSync('public/cities/copenhagen-1760/mobility.json','utf8')));
 const area=m=>{let s=0;for(const poly of m)poly.forEach((r,i)=>{let a=0;for(let k=0;k<r.length-1;k++)a+=r[k][0]*r[k+1][1]-r[k+1][0]*r[k][1];s+=(i?-1:1)*Math.abs(a/2);});return s;},hit=(a,b)=>a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
 const ids=['1132467848','1132467849','1113367435','1111604188'].map(i=>'osm-way-'+i),of=id=>[...city.roads,...city.pavement].filter(p=>p.id===id),wet=p=>{const ws=city.water.filter(w=>hit(w.bbox,p.bbox));return ws.length?area(pc.intersection(p.rings,pc.union(...ws.map(w=>w.rings)))):0;};
 const before=new Map(ids.map(id=>[id,of(id).reduce((s,p)=>s+area([p.rings]),0)]));for(const id of ids)assert.ok(of(id).reduce((s,p)=>s+wet(p),0)>14,`${id} reaches over the water as mapped`);
 dropLateBridges(city,walks,era.lateBridges,roads);
 for(const id of ids){const ps=of(id);assert.ok(ps.length,`${id} keeps its land part`);assert.ok(ps.reduce((s,p)=>s+wet(p),0)<.5,`${id}: nothing over the water`);const kept=ps.reduce((s,p)=>s+area([p.rings]),0);assert.ok(kept>before.get(id)*.5&&kept<before.get(id)-10,`${id}: the dry part stays (${kept.toFixed(0)} of ${before.get(id).toFixed(0)} m²)`);}
 {const {pointInPolygon}=await import('../src/geo.js');for(const id of ids)assert.ok(roads.edges.some(e=>e.points.some((q,i,a)=>i&&[0,.5].some(t=>of(id).some(p=>pointInPolygon(a[i-1][0]+(q[0]-a[i-1][0])*t,a[i-1][1]+(q[1]-a[i-1][1])*t,p.rings))))),`${id}: the quay lane over the ramp's dry part stays`);}
 for(const e of walks.edges)assert.ok(walks.nodes[e.from]&&walks.nodes[e.to],'every edge ends at a node');
});

test('a road dead end at a house is cut back until a coach standing at it is clear of the wall; a short one goes with its way back',async()=>{
 const {trimDeadEndsAtHouses}=await import('../src/mobility-pack.js'),{SpatialIndex}=await import('../src/geo.js');
 const houses=new SpatialIndex([{rings:[[[20,-5],[30,-5],[30,5],[20,5]]]},{rings:[[[-5,6],[5,6],[5,14],[-5,14]]]}]);
 const nodes=[[0,0],[20,0],[-10,0],[0,5]],e=(from,to)=>({from,to,points:[nodes[from],nodes[to]].map(p=>[...p]),length:Math.hypot(nodes[to][0]-nodes[from][0],nodes[to][1]-nodes[from][1]),lane:1.45,crossing:false,signal:null});
 const roads={nodes:nodes.map(p=>[...p]),edges:[e(2,0),e(0,2),e(0,1),e(1,0),e(0,3),e(3,0)]};
 assert.deepEqual(trimDeadEndsAtHouses(roads,houses),{trimmed:1,dropped:2});
 const drive=roads.edges.find(x=>x.from===0&&x.to===1);assert.ok(drive.points.at(-1)[0]<=20-3.3&&drive.points.at(-1)[0]>15,'cut back to 3.3 m from the wall');
 assert.deepEqual(roads.nodes[1],drive.points.at(-1));assert.deepEqual(roads.edges.find(x=>x.from===1).points,[...drive.points].reverse());
 assert.ok(!roads.edges.some(x=>x.from===3||x.to===3),'the 5 m spur ending 1 m from a house went (under 4 m once cut back)');
 assert.equal(roads.edges.filter(x=>x.from===2||x.to===2).length,2,'a dead end in the open stays');
});
