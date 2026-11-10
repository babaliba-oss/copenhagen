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

// Walkers and the bus shelters (scripts/shelter-walks.mjs): footways ran through 18 of the 125 shelters' boxes (within a
// walker's reach, 1.15 m, of 29), and walkers stood against them until they were recycled.
test('no walker\'s footway runs through a bus shelter, and those taken round one keep to the pavement',async()=>{
 const {shelterCrossings,crosses}=await import('../scripts/shelter-walks.mjs'),{cutWalksAtKerbs}=await import('../src/mobility-pack.js'),{SOLIDS}=await import('../src/mapped-furniture.js');
 const m=expandMobility(read('mobility.json')),walks=cutWalksAtKerbs(m.walks,m.walkerCut).walks,items=read('furniture.json').items,shelters=items.filter(i=>i.k==='shelter');
 assert.deepEqual(shelterCrossings(walks,shelters,.3).map(h=>`${h.shelter.ref} ${h.a} -> ${h.b}`),[]); /* two shelters stand across the only paving (-38,-1022 and -2029,1530): the footway ends short of them (kerb-walks.mjs) */
 assert.ok(shelterCrossings(walks,shelters,.9).length<=30,'most pass 0.9 m clear or more'); // 28 segments at 10 shelters on narrow paving
 /* by the shelters: every walker's footway on paving, off the carriageway, out of the houses and the other solid furniture */
 const houses=city.buildings.filter(b=>!/^(roof|construction|carport|bridge)$/.test(b.kind||'')),roads=city.roads.filter(r=>!/island|Koroke/.test(r.kind||'')),solid=items.filter(i=>/^(shelter|toilet|hotdog-stand)$/.test(i.k)); /* what a walker cannot walk through (mapped-furniture.js: the rest is knocked over) */
 const inAny=(list,x,z)=>list.some(r=>r.bbox[0]<=x&&x<=r.bbox[2]&&r.bbox[1]<=z&&z<=r.bbox[3]&&inside(r.rings[0],x,z)&&!r.rings.slice(1).some(h=>inside(h,x,z)));
 const bad=[];let seen=0;
 for(const e of walks.edges){if(e.crossing)continue;for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],by=shelters.filter(s=>crosses(s,a,b,4));if(!by.length)continue;
  const near=l=>l.filter(r=>by.some(s=>r.bbox[0]<=s.x+12&&s.x-12<=r.bbox[2]&&r.bbox[1]<=s.z+12&&s.z-12<=r.bbox[3])),H=near(houses),R=near(roads),P=near(city.pavement),n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.25));
  for(let k=0;k<=n;k++){const x=a[0]+(b[0]-a[0])*k/n,z=a[1]+(b[1]-a[1])*k/n;if(!by.some(s=>Math.hypot(x-s.x,z-s.z)<6))continue;seen++;
   const what=inAny(H,x,z)?'house':inAny(R,x,z)?'carriageway':!inAny(P,x,z)?'no paving':solid.some(it=>{const [w,d]=SOLIDS[it.k],c=Math.cos(it.yaw||0),n=Math.sin(it.yaw||0);return Math.abs((x-it.x)*c-(z-it.z)*n)<w/2&&Math.abs((x-it.x)*n+(z-it.z)*c)<d/2;})?'furniture':'';
   if(what)bad.push(`${what} at ${x.toFixed(1)},${z.toFixed(1)}`);}}}
 assert.ok(seen>1500,String(seen));assert.deepEqual(bad.slice(0,5),[]);
});

test('a footway through a shelter is taken round it, behind where there is room, its ends and its way back kept',async()=>{
 const {moveWalksOffShelters,shelterCrossings}=await import('../scripts/shelter-walks.mjs');
 const make=()=>{const n=[[-20,0],[20,0]];return {nodes:n.map(p=>[...p]),edges:[{from:0,to:1,points:[[-20,0],[20,0]],length:40,crossing:false},{from:1,to:0,points:[[20,0],[-20,0]],length:40,crossing:false}]};};
 const s={k:'shelter',x:0,z:.2,yaw:0,ref:['t']}; /* open side to +z: the road is that way */
 let w=make(),r=moveWalksOffShelters(w,[s],()=>true);
 assert.equal(r.moved,1);assert.equal(r.left.length,0);assert.equal(shelterCrossings(w,[s],1.15).length,0);
 const [e,back]=w.edges;assert.deepEqual(e.points[0],[-20,0]);assert.deepEqual(e.points.at(-1),[20,0]);assert.deepEqual(back.points,[...e.points].reverse());
 assert.ok(e.points.length>2&&e.points.slice(1,-1).every(p=>p[1]<=0),'behind the shelter');assert.ok(e.length>40&&e.length<43&&back.length===e.length,String(e.length));
 assert.equal(moveWalksOffShelters(w,[s],()=>true).moved,0,'a second run changes nothing');
 /* paving only 1 m deep behind it: round it closer; none at all: left as it is and said so */
 w=make();r=moveWalksOffShelters(w,[s],(x,z)=>z>-1.6&&z<.01);assert.equal(r.moved,1);assert.ok(r.left[0].clear<1.15&&r.left[0].clear>=.3);assert.equal(shelterCrossings(w,[s],.3).length,0);
 w=make();r=moveWalksOffShelters(w,[s],(x,z,c,own,bare)=>!!bare);assert.equal(r.moved,0);assert.equal(r.left.length,1);assert.deepEqual(w.edges[0].points,[[-20,0],[20,0]]);
});
