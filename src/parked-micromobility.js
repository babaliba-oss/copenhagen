import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {SpatialIndex,segmentDistance,bounds} from './geo.js';
import {createKnockables} from './knockables.js';
import {crossingChains} from './crossing-markings.js';
import {createKnockableRideSources} from './ride-sources.js';

// Parked micromobility the car can plough through: shared e-scooter clusters
// (Voi / Tier / Bolt colours, no branding) and HSL city-bike stations (fixed
// dock posts + terminal pillar as solid obstacles, yellow bikes that fly out of
// their docks). Everything is placed on mapped pavement polygons, kept off
// carriageways, crossings, NPC lanes, tram rails and other furniture, and
// knocked over by the shared knockables system (knockables.js): kicked by the
// car, tumbles, slides, lies on its side, respawns after 60 s once the car is
// far away.

export const OPERATORS=[{name:'voi',accent:'#f26d5b'},{name:'tier',accent:'#1b9c8c'},{name:'bolt',accent:'#2fcf7c'}];
export const CITY_BIKE_YELLOW='#f4c01e';
// Hide every site beyond this distance (same order as PERSON_LOD.hide); sites stay simulated so respawns still happen.
export const MICROMOBILITY_VIEW_RANGE=240;
export const DOCK_SPACING=.78,SCOOTER_SPACING=.62,BIKE_DEPTH=1.9,SCOOTER_DEPTH=1.1;

// HSL city-bike stations on or beside the demo route. Position, name and dock count are the live HSL
// station feed (GBFS, read through api.citybik.es/v2/networks/citybikes-helsinki on 2026-10-07; station
// ids are HSL's "smoove:NNN"). Game coordinates are that WGS84 point in the city's GK25 frame (same
// projection as scripts/build-data.mjs). Dock row orientation and the exact spot on the pavement are
// interpreted: the planner snaps each station to the nearest fitting mapped pavement within 30 m.
export const CITY_BIKE_STATIONS=[
 {id:'smoove:002',name:'Laivasillankatu',lat:60.160959,lon:24.956347,capacity:12,x:229.5,z:1018.6},
 {id:'smoove:047',name:'Vanha Kauppahalli',lat:60.165343,lon:24.953535,capacity:22,x:73.7,z:530.1},
 {id:'smoove:011',name:'Unioninkatu',lat:60.167457,lon:24.951023,capacity:22,x:-65.6,z:294.4},
 {id:'smoove:012',name:'Kanavaranta',lat:60.168384,lon:24.958381,capacity:34,x:343,z:191.4},
 {id:'smoove:014',name:'Senaatintori',lat:60.169112,lon:24.952197,capacity:22,x:-.2,z:110.1},
 {id:'smoove:161',name:'Eteläesplanadi',lat:60.167022,lon:24.947708,capacity:16,x:-249.6,z:342.7},
 {id:'smoove:019',name:'Rautatientori / itä',lat:60.170781,lon:24.942534,capacity:20,x:-536.5,z:-76.3},
 {id:'smoove:022',name:'Rautatientori / länsi',lat:60.170606,lon:24.93976,capacity:16,x:-690.5,z:-56.9},
 {id:'smoove:024',name:'Mannerheimintie',lat:60.169718,lon:24.937737,capacity:18,x:-802.9,z:41.9},
 {id:'smoove:023',name:'Kiasma',lat:60.171273,lon:24.937106,capacity:18,x:-837.8,z:-131.4},
 {id:'smoove:025',name:'Narinkka',lat:60.170042,lon:24.934607,capacity:40,x:-976.7,z:5.6},
];
// Shared e-scooter clusters: anchor points at tram stops, the terminal, square edges and the station
// (interpreted spots, no operator parking data is public); each snaps to the nearest fitting pavement.
export const SCOOTER_SPOTS=[
 {id:'olympia-terminal',name:'Olympia terminal stop',x:232,z:952,count:5},
 {id:'etelaranta',name:'Eteläranta stop',x:22,z:550,count:3},
 {id:'kauppatori-stop',name:'Kauppatori tram stop',x:-14,z:290,count:4},
 {id:'kauppatori-edge',name:'Kauppatori square edge',x:150,z:250,count:6},
 {id:'esplanadi',name:'Pohjoisesplanadi',x:-279,z:258,count:4},
 {id:'senaatintori',name:'Senaatintori stop',x:-113,z:122,count:3},
 {id:'aleksanterinkatu',name:'Aleksanterinkatu stop',x:-318,z:132,count:4},
 {id:'ritarihuone',name:'Ritarihuone stop',x:205,z:105,count:3},
 {id:'mikonkatu',name:'Mikonkatu stop',x:-380,z:-8,count:5},
 {id:'rautatientori',name:'Rautatientori',x:-490,z:-67,count:6},
 {id:'paarautatieasema',name:'Central station stop',x:-626,z:-33,count:4},
 {id:'lasipalatsi',name:'Lasipalatsi stop',x:-800,z:-28,count:5},
 {id:'forum',name:'Forum / Mannerheimintie',x:-790,z:30,count:4},
];

const hash=(a,b=0)=>{let h=Math.imul((a*73856093)^(b*19349663),2654435761)>>>0;h^=h>>>13;h=Math.imul(h,1274126177)>>>0;return (h>>>8)/16777216;};
const rect=(x,z,yaw,w,d)=>[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([a,b])=>[x+a*Math.cos(yaw)+b*Math.sin(yaw),z-a*Math.sin(yaw)+b*Math.cos(yaw)]);
const pad=(points,m)=>{const b=bounds([points]);return [b[0]-m,b[1]-m,b[2]+m,b[3]+m];};
// Most clearance probes are far from a segment, especially rows already placed at other sites.
// Reject those using precomputed bounds before doing the exact distance calculation.
const clearanceSegment=(a,b)=>({a,b,minX:Math.min(a[0],b[0]),minZ:Math.min(a[1],b[1]),maxX:Math.max(a[0],b[0]),maxZ:Math.max(a[1],b[1])});
const nearSegment=(x,z,s,m)=>x>=s.minX-m&&x<=s.maxX+m&&z>=s.minZ-m&&z<=s.maxZ+m&&segmentDistance(x,z,s.a,s.b)<m;

// ---------------------------------------------------------------------------
// Planning (pure data, unit-testable). Rows are laid along the nearest traffic lane's direction (kerbs
// run parallel to it) and may use either side of the row for the bikes / scooter bodies.
export function planParkedMicromobility(city,mobility,trams,{obstacles=[],avoid=[],stations=CITY_BIKE_STATIONS,spots=SCOOTER_SPOTS}={}){
 const roads=new SpatialIndex(city.roads.filter(p=>!/Koroke/.test(p.kind))),pavement=new SpatialIndex(city.pavement),buildings=new SpatialIndex(city.buildings||[]);
 const blocked=new SpatialIndex([...obstacles.map(o=>({...o,bbox:o.bbox||bounds(o.rings)})),...avoid.map(a=>({rings:[rect(a.x,a.z,0,(a.r||.6)*2,(a.r||.6)*2)]}))]);
 const sites=[...stations.map(s=>({...s,kind:'station'})),...spots.map(s=>({...s,kind:'scooters'}))];
 // Only geometry within ~130–260 m of a site matters: a coarse cell set around the sites filters the city-wide graphs.
 const CELL=128,siteCells=new Set();for(const s of sites)for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)siteCells.add(`${Math.floor(s.x/CELL)+i},${Math.floor(s.z/CELL)+j}`);
 const nearSite=p=>siteCells.has(`${Math.floor(p[0]/CELL)},${Math.floor(p[1]/CELL)}`);
 const chains=crossingChains(mobility.walks.edges.filter(e=>e.crossing&&nearSite(e.points[0])));
 const chainIndex=new SpatialIndex(chains.map(c=>({segments:c.points.slice(1).map((b,i)=>clearanceSegment(c.points[i],b)),rings:[c.points],bbox:pad(c.points,6)})),16);
 const nearCrossing=(x,z,m)=>chainIndex.near(x,z).some(c=>c.segments.some(s=>nearSegment(x,z,s,m)));
 const segments=(edges,offset=()=>0)=>{const out=[];for(const e of edges){if(!e.points.some(nearSite))continue;const lane=offset(e);for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!l)continue;const dx=(b[0]-a[0])/l,dz=(b[1]-a[1])/l;out.push({...clearanceSegment([a[0]-dz*lane,a[1]+dx*lane],[b[0]-dz*lane,b[1]+dx*lane]),dx,dz,rings:[[a,b]],bbox:pad([a,b],4)});}}return out;};
 const lanes=segments(mobility.roads.edges,e=>e.lane||0),laneIndex=new SpatialIndex(lanes,16);
 const nearLane=(x,z,m)=>laneIndex.near(x,z).some(s=>nearSegment(x,z,s,m));
 const walkIndex=new SpatialIndex(segments(mobility.walks.edges.filter(e=>!e.crossing)),16);
 const nearWalk=(x,z,m)=>walkIndex.near(x,z).some(s=>nearSegment(x,z,s,m));
 const railIndex=new SpatialIndex(segments((trams?.paths||[]).map(p=>({points:p.points}))),16);
 const nearRail=(x,z,m)=>railIndex.near(x,z).some(s=>nearSegment(x,z,s,m));
 const walkable=(x,z)=>{const p=pavement.at(x,z);return !!p&&!/pyör|Pyör|Portaat/.test(p.kind);};
 const placed=[],placedIndex=new SpatialIndex([],16);
 const nearPlaced=(x,z)=>placedIndex.near(x,z).some(p=>nearSegment(x,z,p,p.margin+.4));
 // Static clearance (everything but rows placed earlier) is memoised on a 25 cm lattice: a station search
 // probes tens of thousands of points, most of them repeatedly.
 const cache=new Map();
 const clear=(x,z,solid)=>{const key=(Math.round(x*4)*65536+Math.round(z*4))*2+(solid?1:0);let v=cache.get(key);
  if(v===undefined){v=walkable(x,z)&&!roads.at(x,z)&&!buildings.at(x,z)&&!blocked.at(x,z)&&!nearCrossing(x,z,3.5)&&!nearLane(x,z,2)&&!nearRail(x,z,1.6)&&(!solid||!nearWalk(x,z,1));cache.set(key,v);}
  return v;};
 const fits=(x,z,solid=false)=>clear(x,z,solid)&&!nearPlaced(x,z);
 const laneDirection=(x,z)=>{let best=null,bestD=Infinity;for(const s of lanes){const d=segmentDistance(x,z,s.a,s.b);if(d<bestD){bestD=d;best=s;}}return best&&bestD<60?[best.dx,best.dz]:[1,0];};
 // Best row for `count` items with `spacing` along the row and `depth` of clear pavement on one side.
 // Score: fitted slots minus a quarter point per metre from the measured spot (four metres ≈ one slot).
 function placeRow(site,count,spacing,depth,radius,minimum,solid){
  const [ux,uz]=laneDirection(site.x,site.z),candidates=[];
  for(let dx=-radius;dx<=radius;dx+=1)for(let dz=-radius;dz<=radius;dz+=1){const d=Math.hypot(dx,dz);if(d<=radius&&fits(site.x+dx,site.z+dz,solid))candidates.push({x:site.x+dx,z:site.z+dz,d});}
  candidates.sort((a,b)=>a.d-b.d);
  let best=null;
  const slotFits=(x,z,nx,nz)=>fits(x,z,solid)&&fits(x+nx*depth*.5,z+nz*depth*.5)&&fits(x+nx*depth,z+nz*depth)&&fits(x-nx*.35,z-nz*.35,solid);
  for(const c of candidates){
   if(best&&count-c.d/4<=best.score)break; // no later (farther) candidate can score higher
   for(const [ax,az] of [[ux,uz],[-uz,ux]])for(const side of [1,-1]){
    const nx=-az*side,nz=ax*side;
    if(!slotFits(c.x,c.z,nx,nz))continue;
    // Longest contiguous run of fitting slots through the centre keeps the row in one piece.
    let lo=Math.floor((count-1)/2),hi=lo;
    for(let i=lo-1;i>=0;i--){const t=(i-(count-1)/2)*spacing;if(slotFits(c.x+ax*t,c.z+az*t,nx,nz))lo=i;else break;}
    for(let i=hi+1;i<count;i++){const t=(i-(count-1)/2)*spacing;if(slotFits(c.x+ax*t,c.z+az*t,nx,nz))hi=i;else break;}
    const fitted=hi-lo+1,score=fitted-c.d/4;
    if(fitted>=minimum&&(!best||score>best.score))best={x:c.x,z:c.z,ax,az,nx,nz,fitted,first:lo,distance:c.d,score};
   }
  }
  if(!best)return null;
  const slots=[];for(let i=best.first;i<best.first+best.fitted;i++){const t=(i-(count-1)/2)*spacing;slots.push({x:best.x+best.ax*t,z:best.z+best.az*t});}
  const yaw=Math.atan2(best.nx,best.nz); // items face across the row, towards the kerb side (heading 0 = -z)
  const occupied={...clearanceSegment([slots[0].x,slots[0].z],[slots.at(-1).x,slots.at(-1).z]),margin:depth+.6};
  const clearance=occupied.margin+.4;
  occupied.bbox=[occupied.minX-clearance,occupied.minZ-clearance,occupied.maxX+clearance,occupied.maxZ+clearance];
  placed.push(occupied);placedIndex.add([occupied]);
  return {x:best.x,z:best.z,ax:best.ax,az:best.az,nx:best.nx,nz:best.nz,yaw,slots,fitted:best.fitted,requested:count,snapped:Math.round(best.distance*10)/10};
 }
 const omitted=[],result=[],scooters=[],bikes=[];
 for(const [n,s] of stations.entries()){
  const row=placeRow(s,s.capacity,DOCK_SPACING,BIKE_DEPTH,30,6,true);
  if(!row){omitted.push({id:s.id,name:s.name,reason:'no fitting pavement within 30 m'});continue;}
  // Docks face the cleared (+normal) side of the row; bikes stand there facing the dock (heading = row.yaw, i.e.
  // forward = -normal) with their front wheel locked in. Roughly 60 % of docks are occupied.
  const docks=row.slots.map((p,i)=>({x:p.x,z:p.z,yaw:row.yaw+Math.PI,index:i}));
  const stationBikes=docks.filter((d,i)=>hash(n*31+i,7)<.6||i<3).map(d=>({id:`${s.id}-bike-${d.index}`,x:d.x+row.nx*.95,z:d.z+row.nz*.95,yaw:row.yaw,dock:d.index}));
  // Terminal pillar at whichever row end has clear pavement; none when neither end has.
  const others=placed.slice(0,-1),free=(x,z)=>clear(x,z,true)&&!others.some(p=>nearSegment(x,z,p,p.margin+.4));
  const ends=[[docks.at(-1),1],[docks[0],-1]].map(([d,k])=>({x:d.x+row.ax*.75*k,z:d.z+row.az*.75*k,yaw:row.yaw+Math.PI})),totem=ends.find(t=>free(t.x,t.z)&&free(t.x+row.nx*.4,t.z+row.nz*.4))||null;
  const station={...s,x:row.x,z:row.z,yaw:row.yaw,axis:[row.ax,row.az],normal:[row.nx,row.nz],docks,bikes:stationBikes,totem,fitted:row.fitted,snapped:row.snapped,measured:{lat:s.lat,lon:s.lon,x:s.x,z:s.z,capacity:s.capacity}};
  result.push(station);bikes.push(...stationBikes.map(b=>({...b,station:s.id})));
 }
 const clusters=[];
 for(const [n,s] of spots.entries()){
  const row=placeRow(s,s.count,SCOOTER_SPACING,SCOOTER_DEPTH,16,2,false);
  if(!row){omitted.push({id:s.id,name:s.name,reason:'no fitting pavement within 16 m'});continue;}
  const dominant=OPERATORS[Math.floor(hash(n,3)*OPERATORS.length)];
  const items=row.slots.map((p,i)=>{const op=hash(n*17+i,5)<.7?dominant:OPERATORS[Math.floor(hash(n*17+i,9)*OPERATORS.length)];
   return {id:`${s.id}-scooter-${i}`,x:p.x+row.nx*.1,z:p.z+row.nz*.1,yaw:row.yaw+(hash(n,i+11)-.5)*.3,operator:op.name,accent:op.accent,cluster:s.id};});
  clusters.push({...s,x:row.x,z:row.z,yaw:row.yaw,scooters:items,fitted:row.fitted,snapped:row.snapped});scooters.push(...items);
 }
 return {stations:result,clusters,scooters,bikes,omitted};
}

// ---------------------------------------------------------------------------
// Geometry (local space, forward = -z, ground y = 0). Vertex-coloured, one material; `paint` = 1 marks the
// faces that take the per-instance operator colour.
const nonIndexed=g=>{if(g.index){const o=g;g=o.toNonIndexed();o.dispose();}g.deleteAttribute('uv');return g;};
function coloured(g,hex,paint=0){g=nonIndexed(g);const n=g.attributes.position.count,c=new THREE.Color(hex),col=new Float32Array(n*3),p=new Float32Array(n).fill(paint);for(let i=0;i<n;i++){col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setAttribute('paint',new THREE.BufferAttribute(p,1));return g;}
function tube(a,b,r,hex,paint=0,segments=5){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),d=bv.clone().sub(av),g=new THREE.CylinderGeometry(r,r,d.length(),segments);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.clone().normalize()));g.translate(...av.add(bv).multiplyScalar(.5).toArray());return coloured(g,hex,paint);}
function merge(parts){const g=mergeGeometries(parts);parts.forEach(p=>p.dispose());g.computeVertexNormals();return g;}
// Stand-up shared e-scooter: deck, raked stem, bar, two 10" wheels. Stem and rear guard carry the operator colour.
let scooterModel=null; // Blender e-scooter (scripts/blender/scooter.py) with `color` and `paint` attributes
export function setScooterModel(geometry){scooterModel=geometry||null;}
export function scooterGeometry(){
 if(scooterModel)return scooterModel.clone();
 const dark='#24282a',parts=[coloured(new THREE.BoxGeometry(.17,.045,.56).translate(0,.165,-.02),dark),coloured(new THREE.BoxGeometry(.15,.01,.5).translate(0,.193,-.02),'#3a3f42')];
 parts.push(tube([0,.2,-.34],[0,1.14,-.45],.021,'#ffffff',1,6),tube([0,.1,-.42],[0,.36,-.4],.026,dark));
 parts.push(coloured(new THREE.BoxGeometry(.5,.028,.028).translate(0,1.15,-.455),dark),coloured(new THREE.BoxGeometry(.08,.035,.1).translate(0,1.12,-.42),dark));
 for(const z of [-.42,.3]){parts.push(coloured(new THREE.CylinderGeometry(.125,.125,.045,10).rotateZ(Math.PI/2).translate(0,.125,z),'#1c1f20'));parts.push(coloured(new THREE.CylinderGeometry(.06,.06,.05,8).rotateZ(Math.PI/2).translate(0,.125,z),'#6c7375'));}
 parts.push(coloured(new THREE.BoxGeometry(.08,.03,.22).translate(0,.265,.3),'#ffffff',1));
 return merge(parts);
}
// HSL city bike: yellow step-through frame and mudguards, black tyres and saddle, front carrier. No lettering.
export function cityBikeGeometry({animated=false}={}){
 const y=CITY_BIKE_YELLOW,dark='#1e2223',parts=[];
 for(const wz of [-.56,.56]){if(!animated){parts.push(coloured(new THREE.TorusGeometry(.32,.03,5,14).rotateY(Math.PI/2).translate(0,.33,wz),dark));parts.push(coloured(new THREE.CylinderGeometry(.045,.045,.08,6).rotateZ(Math.PI/2).translate(0,.33,wz),'#7b8583'));
  for(const a of [0,.55,1.1,1.65,2.2,2.75])parts.push(tube([0,.33,wz],[0,.33+Math.sin(a)*.3,wz+Math.cos(a)*.3],.004,'#8d9597',0,3));}
  const guard=coloured(new THREE.TorusGeometry(.345,.016,4,9,Math.PI).rotateY(Math.PI/2).translate(0,.33,wz),y);parts.push(guard);}
 const n={rear:[0,.33,.56],front:[0,.33,-.56],bb:[0,.36,.08],seatLow:[0,.5,.14],seat:[0,.86,.19],head:[0,.86,-.4],headLow:[0,.56,-.32],bar:[0,1.0,-.46]};
 for(const [a,b,r] of [['rear','seatLow',.022],['rear','bb',.02],['seatLow','seat',.02],['bb','seatLow',.024],['headLow','bb',.03],['head','headLow',.03],['head','front',.02],['head','bar',.022]])parts.push(tube(n[a],n[b],r,y));
 parts.push(coloured(new THREE.BoxGeometry(.54,.026,.026).translate(0,1.0,-.47),dark),coloured(new THREE.BoxGeometry(.19,.055,.26).translate(0,.9,.2),dark));
 parts.push(coloured(new THREE.BoxGeometry(.3,.16,.24).translate(0,.93,-.62),'#2c3133'),coloured(new THREE.BoxGeometry(.05,.11,.36).translate(.06,.36,.3),y));
 if(!animated)parts.push(coloured(new THREE.BoxGeometry(.03,.03,.06).translate(.1,.36,.08),dark),coloured(new THREE.BoxGeometry(.03,.03,.06).translate(-.1,.36,.08),dark));
 return merge(parts);
}
// Personal parked bicycle (bike racks, photo-guided squares): same shape as the old static bikes, but one rigid
// knockable body. Frame tubes carry `paint` = 1 so each instance keeps its own frame colour.
export function bicycleGeometry({animated=false}={}){
 const dark='#2c3333',parts=[];
 for(const wz of animated?[]:[-.58,.58]){parts.push(coloured(new THREE.TorusGeometry(.32,.032,5,14).rotateY(Math.PI/2).translate(0,.33,wz),dark),coloured(new THREE.CylinderGeometry(.05,.05,.09,6).rotateZ(Math.PI/2).translate(0,.33,wz),'#7b8583'));
  for(const a of [0,.79,1.57,2.36])parts.push(tube([0,.33-Math.cos(a)*.3,wz-Math.sin(a)*.3],[0,.33+Math.cos(a)*.3,wz+Math.sin(a)*.3],.005,'#a0aaa7',0,3));}
 const n={back:[0,.33,.58],front:[0,.33,-.58],crank:[0,.33,.05],seat:[0,.84,.23],neck:[0,.91,-.42],low:[0,.5,-.26],bar:[0,1.05,-.48]};
 for(const [a,b] of [['back','seat'],['back','crank'],['seat','crank'],['crank','low'],['low','neck'],['neck','front'],['neck','bar']])parts.push(tube(n[a],n[b],.026,'#ffffff',1));
 parts.push(tube([-.27,1.05,-.48],[.27,1.05,-.48],.021,'#313d3c'),coloured(new THREE.BoxGeometry(.21,.08,.29).translate(0,.89,.24),'#343b3c'));
 if(!animated)parts.push(tube([-.18,.25,.08],[.18,.4,.08],.018,'#787e7b'),tube([.03,.35,.1],[.19,.035,.3],.014,'#5b6261'));
 return merge(parts);
}
// Dock post (fixed): a grey post with a wheel slot; the station's end pillar is a plain dark terminal with a yellow band.
export function dockGeometry(){return merge([coloured(new THREE.BoxGeometry(.14,.5,.38).translate(0,.25,.02),'#3b4043'),coloured(new THREE.BoxGeometry(.17,.07,.12).translate(0,.52,-.1),'#55595c'),coloured(new THREE.BoxGeometry(.08,.3,.05).translate(0,.4,-.2),'#2a2e30')]);}
export function totemGeometry(){return merge([coloured(new THREE.BoxGeometry(.36,1.75,.22).translate(0,.875,0),'#2f3436'),coloured(new THREE.BoxGeometry(.37,.34,.23).translate(0,1.32,0),CITY_BIKE_YELLOW),coloured(new THREE.BoxGeometry(.3,.26,.24).translate(0,.9,0),'#9aa3a6')]);}
export function micromobilityMaterial(){
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,metalness:.25});
 material.onBeforeCompile=shader=>{shader.vertexShader='attribute float paint;\n'+shader.vertexShader.replace('#include <color_vertex>','#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\nvColor.rgb=mix(color.rgb,instanceColor.rgb,paint);\n#endif');};
 material.customProgramCacheKey=()=>'micromobility-v1';
 return material;
}

// Loose parked scooters / bikes outside the clusters and stations (squares, bike racks, terminal docks): one
// knockable set (one InstancedMesh per part, so no per-item draws). Items carry {x,z,yaw|heading,color?}; extra
// rigid parts (e.g. a frame label) ride along with each body. `lift` raises the set onto raised plaza paving.
// Hidden beyond MICROMOBILITY_VIEW_RANGE of the set (still simulated, so respawns happen).
export function createLooseMicromobility(items,{kind='scooter',name='Parked micromobility',lift=0,parts=[]}={}){
 const geometry=kind==='scooter'?scooterGeometry():kind==='citybike'?cityBikeGeometry():bicycleGeometry(),scooter=kind==='scooter';
 const k=createKnockables(items.map((p,i)=>({id:p.id??`${name}-${i}`,x:p.x,z:p.z,yaw:p.yaw??p.heading??0})),[{geometry,material:micromobilityMaterial()},...parts],{radius:scooter?.3:.5,height:scooter?1.1:1});
 k.group.name=name;k.group.position.y=lift;const colour=new THREE.Color();
 k.group.children.forEach((m,j)=>{m.castShadow=false;if(j===0&&items.some(p=>p.color)){items.forEach((p,i)=>m.setColorAt(i,colour.set(p.color||'#ffffff')));m.instanceColor.needsUpdate=true;}});
 k.rideSources=createKnockableRideSources(k,items,{kind,prefix:name,lift,parts});
 const cx=items.reduce((a,p)=>a+p.x,0)/(items.length||1),cz=items.reduce((a,p)=>a+p.z,0)/(items.length||1),reach=MICROMOBILITY_VIEW_RANGE+Math.max(0,...items.map(p=>Math.hypot(p.x-cx,p.z-cz)));
 return {...k,step(dt,car,world){if(car){const visible=Math.hypot(car.x-cx,car.z-cz)<reach;if(k.group.visible!==visible)k.group.visible=visible;}k.step(dt,car,world);},update(){if(k.group.visible)k.update();}};
}

// ---------------------------------------------------------------------------
// Scene assembly: one knockable set per site (bikes or scooters, one InstancedMesh each), static docks and
// terminal per station, distance LOD on whole sites. The returned `knockables` plugs into combineKnockables.
export function createParkedMicromobility(city,mobility,trams,options={}){
 const plan=planParkedMicromobility(city,mobility,trams,options),group=new THREE.Group(),obstacles=[],sites=[];group.name='Parked micromobility';
 const material=micromobilityMaterial(),scooter=scooterGeometry(),bike=cityBikeGeometry(),dock=dockGeometry(),totem=totemGeometry(),colour=new THREE.Color();
 const place=(g,p,yaw)=>{const c=g.clone();c.rotateY(yaw);c.translate(p.x,.07,p.z);return c;};
 for(const s of plan.stations){
  const site=new THREE.Group();site.name=`City bike station ${s.name}`;
  const fixed=s.docks.map(d=>place(dock,d,d.yaw));if(s.totem)fixed.push(place(totem,s.totem,s.totem.yaw));
  const first=s.docks[0],last=s.docks.at(-1),length=Math.hypot(last.x-first.x,last.z-first.z)+.3;
  const rail=new THREE.BoxGeometry(length,.05,.07);rail.rotateY(Math.atan2(s.axis[0],s.axis[1])+Math.PI/2);rail.translate((first.x+last.x)/2,.095,(first.z+last.z)/2);fixed.push(coloured(rail,'#3b4043'));
  const mesh=new THREE.Mesh(merge(fixed),material);mesh.name='Docks and terminal';mesh.receiveShadow=true;site.add(mesh);
  const [ax,az]=s.axis,[nx,nz]=s.normal;
  obstacles.push({name:`${s.name} city bike docks`,rings:[rect((first.x+last.x)/2+nx*.05,(first.z+last.z)/2+nz*.05,Math.atan2(ax,az),length,.5)]});
  if(s.totem)obstacles.push({name:`${s.name} city bike terminal`,rings:[rect(s.totem.x,s.totem.z,s.totem.yaw,.4,.3)]});
  const knockables=createKnockables(s.bikes.map(b=>({id:b.id,x:b.x,z:b.z,yaw:b.yaw})),[{geometry:bike,material}],{radius:.5,height:1});
  knockables.rideSources=createKnockableRideSources(knockables,s.bikes,{kind:'citybike',prefix:'citybike'});
  knockables.group.name='City bikes';knockables.group.children.forEach(m=>{m.castShadow=false;});site.add(knockables.group);
  group.add(site);sites.push({group:site,knockables,x:s.x,z:s.z});
 }
 for(const c of plan.clusters){
  const knockables=createKnockables(c.scooters.map(s=>({id:s.id,x:s.x,z:s.z,yaw:s.yaw})),[{geometry:scooter,material}],{radius:.3,height:1.1});
  knockables.rideSources=createKnockableRideSources(knockables,c.scooters,{kind:'scooter',prefix:'rental-scooter'});
  knockables.group.name=`E-scooters ${c.name}`;knockables.group.children.forEach(m=>{m.castShadow=false;c.scooters.forEach((s,i)=>m.setColorAt(i,colour.set(s.accent)));m.instanceColor.needsUpdate=true;});
  group.add(knockables.group);sites.push({group:knockables.group,knockables,x:c.x,z:c.z});
 }
 const knockables={
  bodies:sites.flatMap(s=>s.knockables.bodies),
  rideSources:sites.flatMap(s=>s.knockables.rideSources||[]),
  step(dt,car,world){for(const s of sites){if(car){const visible=Math.hypot(car.x-s.x,car.z-s.z)<MICROMOBILITY_VIEW_RANGE;if(s.group.visible!==visible)s.group.visible=visible;}s.knockables.step(dt,car,world);}},
  update(){for(const s of sites)if(s.group.visible)s.knockables.update();},
  resetAll(){for(const s of sites)s.knockables.resetAll();},
  snapshot(){const all=sites.map(s=>s.knockables.snapshot());return {count:all.reduce((n,x)=>n+x.count,0),knocked:all.reduce((n,x)=>n+x.knocked,0),hits:all.reduce((n,x)=>n+x.hits,0)};},
 };
 group.userData={stations:plan.stations.map(s=>({id:s.id,name:s.name,capacity:s.capacity,docks:s.docks.length,bikes:s.bikes.length,x:Math.round(s.x),z:Math.round(s.z),yaw:s.yaw,snapped:s.snapped})),clusters:plan.clusters.map(c=>({id:c.id,scooters:c.scooters.length,x:Math.round(c.x),z:Math.round(c.z),snapped:c.snapped})),omitted:plan.omitted,
  scooters:plan.scooters.length,bikes:plan.bikes.length,viewRange:MICROMOBILITY_VIEW_RANGE,reference:'HSL city-bike station feed (positions, dock counts) on mapped pavement; scooter spots and all orientations interpreted'};
 return {group,obstacles,knockables,plan,sites,rideSources:knockables.rideSources};
}
