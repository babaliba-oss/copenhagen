import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {SpatialIndex,segmentDistance,bounds,pointInPolygon} from './geo.js';
import {createKnockables} from './knockables.js';
import {crossingChains} from './crossing-markings.js';
import {OPERATORS,createLooseMicromobility} from './parked-micromobility.js';
import {createParkedCarSource,instancedCarVisibility} from './parked-car-sources.js';

// Street-level detail along the demo route: granite kerbstones, asphalt wheel
// tracks, manhole covers and gutter grates, parked cars, litter bins, e-scooters
// and bike racks. Everything is placed on mapped municipal polygons (carriageway,
// parking area, pavement) and kept off crossings, tram rails and traffic lanes.

// Demo itinerary as a corridor polyline (game metres): Olympia terminal →
// Laivasillankatu → Eteläranta → Kauppatori → Senate Square → Aleksanterinkatu →
// Mikonkatu → Rautatientori/Kaivokatu → Mannerheimintie (Lasipalatsi → Kiasma).
export const DEMO_ROUTE_WAYPOINTS=[[195,1084],[230,920],[148,804],[65,688],[23,562],[17,424],[9,289],[60,250],[121,244],[257,232],[256,108],[183,105],[66,100],[-100,120],[-250,128],[-370,133],[-381,60],[-381,-30],[-450,-30],[-600,-50],[-740,-20],[-800,-60],[-830,-100],[-880,-200]];
export const ROUTE_CORRIDOR=48;
export function nearRoute(x,z,margin=ROUTE_CORRIDOR){
 for(let i=1;i<DEMO_ROUTE_WAYPOINTS.length;i++)if(segmentDistance(x,z,DEMO_ROUTE_WAYPOINTS[i-1],DEMO_ROUTE_WAYPOINTS[i])<margin)return true;
 return false;
}
const hash=(a,b=0)=>{let h=Math.imul((a*73856093)^(b*19349663),2654435761)>>>0;h^=h>>>13;h=Math.imul(h,1274126177)>>>0;return (h>>>8)/16777216;};
const centre=p=>[(p.bbox[0]+p.bbox[2])/2,(p.bbox[1]+p.bbox[3])/2];
const overlaps=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
const rect=(x,z,yaw,w,d)=>[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([a,b])=>[x+a*Math.cos(yaw)+b*Math.sin(yaw),z-a*Math.sin(yaw)+b*Math.cos(yaw)]);
const nonIndexed=g=>{if(g.index){const o=g;g=o.toNonIndexed();o.dispose();}g.deleteAttribute('uv');g.deleteAttribute('normal');return g;};

// ---------------------------------------------------------------------------
// Granite kerbstones. Helsinki kerbs are long pink-grey granite stones with a
// ~14 cm exposed face; segments are given a running `along` coordinate so the
// shader can draw the stone joints and per-stone tone at close range and fade
// them to the mean before they reach pixel size.
export const KERB={width:.17,height:.16,loweredHeight:.035,base:.05,stone:1.25};
export function kerbStoneMaterial(){
 const material=new THREE.MeshStandardMaterial({color:'#9d9089',roughness:.88});
 material.onBeforeCompile=shader=>{
  shader.vertexShader='attribute float along;varying float vAlong;varying vec3 vKerb;varying float vKerbUp;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvAlong=along;vKerb=position;vKerbUp=normal.y;');
  shader.fragmentShader='varying float vAlong;varying vec3 vKerb;varying float vKerbUp;\nfloat kerbHash(float n){vec2 q=fract(vec2(n*.1031,n*.1030)+vec2(.11,.37));q+=dot(q,q.yx+33.33);return fract((q.x+q.y)*q.x);}\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
   float kerbFw=fwidth(vAlong),kerbFp=max(length(dFdx(vKerb.xz)),length(dFdy(vKerb.xz)));
   float stone=floor(vAlong/${KERB.stone.toFixed(2)});float kh=kerbHash(stone),kh2=kerbHash(stone+91.0);
   // Rose, grey and warm stones as cut from Finnish granite; fades to the mean with distance.
   vec3 tint=(kh<.4?vec3(1.04,.96,.94):kh<.75?vec3(.97,.98,1.0):vec3(1.03,1.0,.95))*(.9+.2*kh2);
   float near=1.0-smoothstep(.03,.14,kerbFw);
   float j=abs(fract(vAlong/${KERB.stone.toFixed(2)})-.5)*${KERB.stone.toFixed(2)};
   float joint=(1.0-smoothstep(.006,.016+kerbFw,j))*near;
   float speck=(fract(sin(dot(floor(vKerb.xz*40.0)+floor(vKerb.y*40.0),vec2(12.9898,78.233)))*43758.5453)-.5)*(1.0-smoothstep(.015,.05,kerbFp));
   diffuseColor.rgb*=mix(vec3(1.0),tint,near)*(1.0-joint*.5)*(1.0+speck*.16)*mix(.84,1.0,smoothstep(.3,.9,vKerbUp));
  `);
 };
 material.customProgramCacheKey=()=>'granite-kerb-v1';
 return material;
}
// Kerb runs shorter than `min` metres in all (segments joined end to end) dropped: a pavement fragment poking into the
// carriageway left one or two stones standing in the road, which read as bricks dropped there (Rådhuspladsen).
export function keepLongKerbs(segments,min=3){
 const key=p=>`${Math.round(p[0]*10)},${Math.round(p[1]*10)}`,parent=new Map(),find=k=>{while(parent.get(k)!==k){parent.set(k,parent.get(parent.get(k)));k=parent.get(k);}return k;};
 const add=k=>{if(!parent.has(k))parent.set(k,k);},union=(a,b)=>{add(a);add(b);const ra=find(a),rb=find(b);if(ra!==rb)parent.set(ra,rb);};
 for(const s of segments)union(key(s.a),key(s.b));
 const total=new Map();for(const s of segments){const r=find(key(s.a));total.set(r,(total.get(r)||0)+Math.hypot(s.b[0]-s.a[0],s.b[1]-s.a[1]));}
 return segments.filter(s=>total.get(find(key(s.a)))>=min);
}
// segments: [{a:[x,z],b:[x,z],lowered}] in world metres. Returns a group of
// chunked merged meshes so distant kerbs are frustum-culled instead of drawn.
export const KERB_VIEW_RANGE=520;
export function createGraniteKerbs(segments,{chunk=300,range=KERB_VIEW_RANGE}={}){
 const group=new THREE.Group();group.name='Granite kerbstones';
 const material=kerbStoneMaterial(),chunks=new Map();let along=0,previous=null,count=0;
 for(const s of segments){
  const dx=s.b[0]-s.a[0],dz=s.b[1]-s.a[1],length=Math.hypot(dx,dz);if(length<.05)continue;
  // Continue the stone coordinate along touching segments; restart elsewhere.
  if(!previous||Math.hypot(previous[0]-s.a[0],previous[1]-s.a[1])>.05)along=hash(Math.round(s.a[0]*10),Math.round(s.a[1]*10))*KERB.stone;
  const h=s.lowered?KERB.loweredHeight:KERB.height,g=new THREE.BoxGeometry(KERB.width,h,length);
  // Drop the never-visible underside: box groups are px,nx,py,ny,pz,nz (6 indices each).
  const idx=g.index.array;g.setIndex([...idx.slice(0,18),...idx.slice(24)]);g.deleteAttribute('uv');
  const p=g.attributes.position,a=new Float32Array(p.count);for(let i=0;i<p.count;i++)a[i]=along+p.getZ(i)+length/2;g.setAttribute('along',new THREE.BufferAttribute(a,1));
  g.rotateY(Math.atan2(dx,dz));g.translate((s.a[0]+s.b[0])/2,KERB.base+h/2,(s.a[1]+s.b[1])/2);
  const key=`${Math.floor((s.a[0]+s.b[0])/2/chunk)},${Math.floor((s.a[1]+s.b[1])/2/chunk)}`;if(!chunks.has(key))chunks.set(key,[]);chunks.get(key).push(g);
  along+=length;previous=s.b;count++;
 }
 for(const [key,gs] of chunks){const mesh=new THREE.Mesh(mergeGeometries(gs),material);mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;const [cx,cz]=key.split(',').map(Number);mesh.userData.centre=[(cx+.5)*chunk,(cz+.5)*chunk];group.add(mesh);gs.forEach(g=>g.dispose());}
 // A 16 cm kerb is sub-pixel long before the fog closes: only chunks near the player are submitted.
 group.userData={segments:count,chunks:chunks.size,height:KERB.height,stoneLength:KERB.stone,range,update(player){if(!player)return;for(const m of group.children){const [x,z]=m.userData.centre;m.visible=Math.hypot(x-player.x,z-player.z)<range+chunk*.71;}}};
 return group;
}

// ---------------------------------------------------------------------------
// Low-poly parked car (~430 triangles) with a paint mask, so one InstancedMesh
// with per-instance colour draws the whole parked fleet.
function ringPoints(w,lo,hi){const b=Math.min(.09,(hi-lo)*.25);return [[-w+b,lo],[w-b,lo],[w,lo+b],[w,hi-b],[w-b,hi],[-w+b,hi],[-w,hi-b],[-w,lo+b]];}
function loft(sections,colourOf){
 const pos=[],col=[],paint=[];const push=(p,c)=>{pos.push(...p);col.push(...c.rgb);paint.push(c.paint);};
 const rings=sections.map(([z,w,lo,hi])=>ringPoints(w,lo,hi).map(([x,y])=>[x,y,z]));
 for(let i=0;i<rings.length-1;i++)for(let j=0;j<8;j++){const k=(j+1)%8,c=colourOf(j),a=rings[i][j],b=rings[i][k],d=rings[i+1][j],e=rings[i+1][k];push(a,c);push(b,c);push(d,c);push(b,c);push(e,c);push(d,c);}
 for(const [r,flip] of [[rings[0],false],[rings.at(-1),true]])for(let j=1;j<7;j++){const c=colourOf(4),a=r[0],b=r[j],d=r[j+1];if(flip){push(a,c);push(b,c);push(d,c);}else{push(a,c);push(d,c);push(b,c);}}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(col,3));g.setAttribute('paint',new THREE.Float32BufferAttribute(paint,1));return g;
}
function coloured(g,hex,paint=0){g=nonIndexed(g);const n=g.attributes.position.count,c=new THREE.Color(hex),col=new Float32Array(n*3),p=new Float32Array(n).fill(paint);for(let i=0;i<n;i++){col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setAttribute('paint',new THREE.BufferAttribute(p,1));return g;}
export function parkedCarGeometry(){
 const PAINT={rgb:[1,1,1],paint:1},GLASS={rgb:new THREE.Color('#2b3a43').toArray(),paint:0};
 const parts=[];
 parts.push(loft([[-2.2,.72,.44,.70],[-2.02,.86,.37,.80],[-1.45,.89,.36,.86],[-.4,.89,.36,.90],[1.35,.89,.38,.90],[2.0,.86,.40,.86],[2.2,.74,.46,.78]],()=>PAINT));
 parts.push(loft([[-.95,.80,.88,.92],[-.5,.75,.88,1.40],[.95,.75,.88,1.40],[1.6,.80,.88,.93]],j=>j>=3&&j<=5?PAINT:GLASS));
 for(const side of [-1,1])for(const z of [-1.35,1.35]){const w=new THREE.CylinderGeometry(.31,.31,.2,10);w.rotateZ(Math.PI/2);w.translate(side*.78,.31,z);parts.push(coloured(w,'#1d2022'));}
 for(const side of [-1,1]){
  parts.push(coloured(new THREE.BoxGeometry(.34,.10,.08).translate(side*.6,.66,-2.2),'#e8ecd8'));
  parts.push(coloured(new THREE.BoxGeometry(.34,.11,.08).translate(side*.6,.68,2.2),'#a81b22'));
  parts.push(coloured(new THREE.BoxGeometry(.16,.1,.2).translate(side*.95,.98,-.85),'#1c2124'));
 }
 parts.push(coloured(new THREE.BoxGeometry(1.7,.16,.12).translate(0,.44,-2.2),'#1c2124'));
 parts.push(coloured(new THREE.BoxGeometry(1.7,.16,.12).translate(0,.46,2.2),'#1c2124'));
 parts.push(coloured(new THREE.BoxGeometry(.5,.12,.03).translate(0,.62,2.24),'#eef0e4'));
 const g=mergeGeometries(parts);parts.forEach(p=>p.dispose());g.computeVertexNormals();return g;
}
export const PARKED_PAINT=['#c7cac6','#e6e8e2','#2d4a63','#b23a2c','#394238','#3a3c42','#a39c8b','#5a7585','#6b4a38','#d9d2b8'];
export function parkedCarMaterial(){
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.45,metalness:.2});
 material.onBeforeCompile=shader=>{
  shader.vertexShader='attribute float paint;\n'+shader.vertexShader.replace('#include <color_vertex>','#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\nvColor.rgb=mix(color.rgb,instanceColor.rgb,paint);\n#endif');
 };
 material.customProgramCacheKey=()=>'parked-car-v1';
 return material;
}

// ---------------------------------------------------------------------------
// Knockable light furniture templates (local space, vertex-coloured, one material).
function binTemplate(){
 const parts=[coloured(new THREE.CylinderGeometry(.028,.028,.55,6).translate(0,.275,0),'#5b615f'),
  coloured(new THREE.CylinderGeometry(.215,.2,.68,10).translate(0,.86,0),'#3a4541'),
  coloured(new THREE.CylinderGeometry(.23,.215,.06,10).translate(0,1.22,0),'#2f3836'),
  coloured(new THREE.BoxGeometry(.2,.1,.46).translate(0,1.0,.0),'#2a3230')];
 const g=mergeGeometries(parts);parts.forEach(p=>p.dispose());g.computeVertexNormals();return g;
}
export function combineKnockables(list){
 const all=list.filter(Boolean);
 return {group:null,bodies:all.flatMap(k=>k.bodies),rideSources:all.flatMap(k=>k.rideSources||[]),step(dt,car,world){for(const k of all)k.step(dt,car,world);},update(focus){for(const k of all)k.update(focus);},resetAll(){for(const k of all)k.resetAll();},
  snapshot(){const s=all.map(k=>k.snapshot());return {count:s.reduce((n,x)=>n+x.count,0),knocked:s.reduce((n,x)=>n+x.knocked,0),hits:s.reduce((n,x)=>n+x.hits,0)};}};
}

// ---------------------------------------------------------------------------
// Planning: pure data in, placement records out (unit-testable without WebGL).
const edgeLength=e=>{let l=0;for(let i=1;i<e.points.length;i++)l+=Math.hypot(e.points[i][0]-e.points[i-1][0],e.points[i][1]-e.points[i-1][1]);return l;};
function alongEdge(e,s,offset){
 let acc=0;for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(acc+l>=s||i===e.points.length-1){const t=l?Math.max(0,Math.min(1,(s-acc)/l)):0,dx=l?(b[0]-a[0])/l:0,dz=l?(b[1]-a[1])/l:0;return {x:a[0]+(b[0]-a[0])*t-dz*offset,z:a[1]+(b[1]-a[1])*t+dx*offset,dx,dz,yaw:Math.atan2(dx,dz)};}acc+=l;}
 return null;
}
function principalAxis(ring){
 let best=null,bestLength=0;for(let i=1;i<ring.length;i++){const l=Math.hypot(ring[i][0]-ring[i-1][0],ring[i][1]-ring[i-1][1]);if(l>bestLength){bestLength=l;best=[(ring[i][0]-ring[i-1][0])/l,(ring[i][1]-ring[i-1][1])/l];}}
 return best;
}
export function planStreetFurniture(city,mobility,trams,{obstacles=[],corridor=nearRoute}={}){
 const carriageways=city.roads.filter(p=>!/Koroke/.test(p.kind)),roads=new SpatialIndex(carriageways),pavement=new SpatialIndex(city.pavement),buildings=new SpatialIndex(city.buildings);
 const blocked=new SpatialIndex(obstacles.map(o=>({...o,bbox:o.bbox||bounds(o.rings)})));
 const chains=crossingChains(mobility.walks.edges);const chainIndex=new SpatialIndex(chains.map(c=>({rings:[c.points],bbox:[c.bbox[0]-6,c.bbox[1]-6,c.bbox[2]+6,c.bbox[3]+6],points:c.points})));
 const nearCrossing=(x,z,margin)=>chainIndex.near(x,z).some(c=>c.points.some((b,i)=>i&&segmentDistance(x,z,c.points[i-1],b)<margin));
 const railSegments=[];for(const path of trams?.paths||[])for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i];if(corridor(a[0],a[1],ROUTE_CORRIDOR+20)||corridor(b[0],b[1],ROUTE_CORRIDOR+20))railSegments.push({a,b});}
 const pad=(r,m)=>{const b=bounds(r);return [b[0]-m,b[1]-m,b[2]+m,b[3]+m];};
 const railIndex=new SpatialIndex(railSegments.map(s=>({...s,rings:[[s.a,s.b]],bbox:pad([[s.a,s.b]],6)})));
 const nearRail=(x,z,margin)=>railIndex.near(x,z).some(s=>segmentDistance(x,z,s.a,s.b)<margin);
 // Traffic lanes the NPC fleet actually drives: parked cars and islands of furniture keep clear of them.
 const laneSegments=[];const routeEdges=[];
 for(const e of mobility.roads.edges){
  const mid=e.points[Math.floor(e.points.length/2)];if(!corridor(mid[0],mid[1],ROUTE_CORRIDOR+30))continue;routeEdges.push(e);
  const lane=e.lane||0;for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!l)continue;const dx=(b[0]-a[0])/l,dz=(b[1]-a[1])/l;laneSegments.push({a:[a[0]-dz*lane,a[1]+dx*lane],b:[b[0]-dz*lane,b[1]+dx*lane]});}
 }
 const laneIndex=new SpatialIndex(laneSegments.map(s=>({...s,rings:[[s.a,s.b]],bbox:pad([[s.a,s.b]],6)})));
 const nearLane=(x,z,margin)=>laneIndex.near(x,z).some(s=>segmentDistance(x,z,s.a,s.b)<margin);
 const clearGround=(x,z)=>!buildings.at(x,z)&&!blocked.at(x,z);
 const placedIndex=[];const farFromPlaced=(x,z,r)=>!placedIndex.some(p=>Math.hypot(p[0]-x,p[1]-z)<r);
 const record=(kind,x,z)=>{placedIndex.push([x,z]);};

 // 1. Wheel tracks and manholes on asphalt carriageways followed by traffic.
 const tracks=[],manholes=[];
 for(const e of routeEdges){
  const length=edgeLength(e);if(length<6)continue;
  const lane=e.lane||0;const mid=alongEdge(e,length/2,lane);const surface=mid&&roads.at(mid.x,mid.z);
  if(!surface||!/^Ajorata/.test(surface.kind))continue;
  const asphalt=/Asfaltti/.test(surface.material||'');
  if(asphalt)for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(l<1.5||!corridor((a[0]+b[0])/2,(a[1]+b[1])/2))continue;const dx=(b[0]-a[0])/l,dz=(b[1]-a[1])/l;
   for(const side of [-.78,.78]){const o=lane+side;tracks.push({a:[a[0]-dz*o,a[1]+dx*o],b:[b[0]-dz*o,b[1]+dx*o],edge:e.id});}}
  const spacing=34;for(let s=12+hash(e.from,e.to)*spacing;s<length-6;s+=spacing){
   const p=alongEdge(e,s,lane);if(!p)continue;const here=roads.at(p.x,p.z);
   if(!here||!corridor(p.x,p.z)||!/^Ajorata/.test(here.kind)||pavement.at(p.x,p.z)||nearCrossing(p.x,p.z,3.5)||nearRail(p.x,p.z,1.4)||!clearGround(p.x,p.z)||!farFromPlaced(p.x,p.z,8))continue;
   manholes.push({x:p.x,z:p.z,yaw:p.yaw});record('manhole',p.x,p.z);
  }
 }
 // 2. Kerb lines along the corridor (pavement edges beside a carriageway), walked in ~9 m slots:
 //    gutter grates on the road side; litter bins, e-scooter clusters and bike racks on the pavement side.
 const drains=[],bins=[],scooters=[],racks=[],bicycles=[];
 let kerbRun=0;
 const walkable=(px,pz)=>{const p=pavement.at(px,pz);return !!p&&!/pyör|Portaat/i.test(p.kind);};
 const pavements=city.pavement.filter(p=>corridor(...centre(p),ROUTE_CORRIDOR+20)&&!/pyör|Pyör|Portaat/.test(p.kind));
 for(const polygon of pavements)for(const ring of polygon.rings)for(let i=1;i<ring.length;i++){
  const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<2.5)continue;
  const ux=dx/length,uz=dz/length,yaw=Math.atan2(dx,dz),slots=Math.max(1,Math.round(length/9));
  for(let k=0;k<slots;k++){
   const t0=k/slots,t1=(k+1)/slots,x=a[0]+dx*(t0+t1)/2,z=a[1]+dz*(t0+t1)/2,slot=length/slots;
   // Which side is the carriageway?
   let side=0;for(const s of [1,-1]){const r=roads.at(x-uz*.4*s,z+ux*.4*s);if(r&&/^Ajorata/.test(r.kind)&&!pavement.at(x-uz*.4*s,z+ux*.4*s)){side=s;break;}}
   if(!side||!corridor(x,z))continue;
   kerbRun+=slot;
   const roadSide=(px,pz,d)=>[px-uz*d*side,pz+ux*d*side],walkSide=(px,pz,d)=>[px+uz*d*side,pz-ux*d*side];
   // Gutter grate every ~40 m of kerb, 0.3 m into the carriageway, never on a dropped kerb.
   if(kerbRun>40&&slot>4){const [gx,gz]=roadSide(x,z,.32);const r=roads.at(gx,gz);
    if(r&&/^Ajorata/.test(r.kind)&&!nearCrossing(gx,gz,3)&&!nearRail(gx,gz,1.2)&&clearGround(gx,gz)&&farFromPlaced(gx,gz,6)){drains.push({x:gx,z:gz,yaw});record('drain',gx,gz);kerbRun=0;}}
   const h=hash(Math.round(x*7),Math.round(z*7));
   const fits=(px,pz,depth)=>{const [wx,wz]=walkSide(px,pz,depth);return walkable(px,pz)&&walkable(wx,wz)&&!roads.at(px,pz)&&clearGround(px,pz)&&clearGround(wx,wz)&&!nearCrossing(px,pz,3.5)&&!nearLane(px,pz,2.2);};
   const u=t0+(t1-t0)*(.3+hash(k,i)*.4),px=a[0]+dx*u,pz=a[1]+dz*u;
   // Litter bin: on the pavement 0.6 m behind the kerb with 1.8 m of clear pavement behind it.
   if(h<.3&&slot>5){const [bx,bz]=walkSide(px,pz,.6);
    if(fits(bx,bz,1.8)&&farFromPlaced(bx,bz,16)){bins.push({x:bx,z:bz,yaw,id:`bin-${bins.length}`});record('bin',bx,bz);}}
   // E-scooter cluster: 2–4 scooters side by side, parked along the kerb on wide pavement.
   else if(h>.82&&slot>6){const n=2+Math.floor(hash(k,i+7)*3),[cx,cz]=walkSide(px,pz,.95);
    if(fits(cx,cz,2.2)&&farFromPlaced(cx,cz,24)){for(let j=0;j<n;j++){const sx=cx+ux*(j-(n-1)/2)*.62,sz=cz+uz*(j-(n-1)/2)*.62;if(fits(sx,sz,1.5))scooters.push({x:sx,z:sz,yaw:yaw+(hash(j,k+i)-.5)*.3,id:`scooter-${scooters.length}`});}record('scooters',cx,cz);}}
   // Bike rack with a few bikes: wide pavement, hoops perpendicular to the kerb 1.35 m behind it.
   else if(h>.7&&slot>7){const [cx,cz]=walkSide(px,pz,1.35);
    if(fits(cx,cz,2.6)&&farFromPlaced(cx,cz,45)){const hoops=4,bikes=[];let added=0;
     for(let j=0;j<hoops;j++){const hx=cx+ux*(j-(hoops-1)/2)*.8,hz=cz+uz*(j-(hoops-1)/2)*.8;if(!fits(hx,hz,2.4))continue;racks.push({x:hx,z:hz,yaw:yaw+Math.PI/2});added++;
      if(hash(j,k+i+3)<.7){const [bx,bz]=walkSide(hx,hz,.36);bikes.push({id:`rack-bike-${bicycles.length+bikes.length}`,x:bx,z:bz,heading:yaw+Math.PI/2,color:['#c9c6bb','#2d3d4e','#e6c432','#7a2d2a'][j%4]});}}
     if(added){bicycles.push(...bikes);record('rack',cx,cz);}}}
  }
 }
 // 3. Parked cars on mapped parking polygons (Pysäköintialue) along the route that no other module already fills.
 const cars=[],parking=[],parkingPolygons=city.roads.filter(p=>p.kind==='Pysäköintialue'&&corridor(...centre(p),ROUTE_CORRIDOR+10)&&!obstacles.some(o=>overlaps(o.bbox||bounds(o.rings),p.bbox)));
 for(const polygon of parkingPolygons){
  const ring=polygon.rings[0],axis=principalAxis(ring),report={id:polygon.id,street:polygon.name,bays:0,placed:0,rejected:{}};parking.push(report);
  const reject=why=>{report.rejected[why]=(report.rejected[why]||0)+1;};
  if(!axis){reject('degenerate');continue;}
  const [ax,az]=axis,proj=ring.map(([x,z])=>[x*ax+z*az,-x*az+z*ax]),s0=Math.min(...proj.map(p=>p[0])),s1=Math.max(...proj.map(p=>p[0])),t0=Math.min(...proj.map(p=>p[1])),t1=Math.max(...proj.map(p=>p[1]));
  const width=t1-t0;report.width=Math.round(width*10)/10;report.length=Math.round((s1-s0)*10)/10;if(width<1.6||s1-s0<4.6){reject('too small');continue;}
  // Kerbside bays are mapped 1.7–2.3 m wide (Aleksanterinkatu, Senaatintori): a parked car sits centred in the
  // bay and may overhang onto the adjacent carriageway, never onto the pavement. Wider lots get perpendicular rows.
  const perpendicular=width>=4.6,step=perpendicular?2.75:6.0,yaw=Math.atan2(ax,az)+(perpendicular?Math.PI/2:0);
  const rows=perpendicular?(width>=9.5?[t0+2.5,t1-2.5]:[(t0+t1)/2]):[(t0+t1)/2];
  if(perpendicular&&width>=20)for(let t=t0+2.5+11.5;t<t1-8;t+=11.5)rows.push(t);
  for(const row of rows)for(let s=s0+(perpendicular?1.4:2.6);s<=s1-(perpendicular?1.4:2.6);s+=step){
   // Centre each kerbside car in the bay's local width (mapped strips curve slightly).
   let t=row;if(!perpendicular){let lo=Infinity,hi=-Infinity;for(let q=t0;q<=t1;q+=.1)if(pointInPolygon(s*ax-q*az,s*az+q*ax,polygon.rings)){lo=Math.min(lo,q);hi=Math.max(hi,q);}if(hi-lo<1.4){reject('outside bay');continue;}t=(lo+hi)/2;}
   const x=s*ax-t*az,z=s*az+t*ax;report.bays++;
   if(hash(Math.round(x*3),Math.round(z*3))<.28){reject('left empty');continue;} // empty bays break up the row
   const footprint=rect(x,z,yaw,1.85,4.5);
   // Tested 12 cm inside the body: a car flush with the kerb may overhang the mapped bay edge by that much.
   const onBay=([px,pz])=>pointInPolygon(px,pz,polygon.rings),onCarriageway=([px,pz])=>{const r=roads.at(px,pz);return !!r&&/^Ajorata/.test(r.kind)&&!pavement.at(px,pz);};
   if(!pointInPolygon(x,z,polygon.rings)||!rect(x,z,yaw,1.6,4.3).every(c=>onBay(c)||(!perpendicular&&onCarriageway(c)))){reject('outside bay');continue;}
   if(!footprint.every(([px,pz])=>clearGround(px,pz))){reject('building or obstacle');continue;}
   if(footprint.some(([px,pz])=>nearLane(px,pz,1.35))){reject('traffic lane');continue;}
   if(nearRail(x,z,2.3)){reject('tram rail');continue;}
   if(nearCrossing(x,z,4)){reject('crossing');continue;}
   if(!farFromPlaced(x,z,perpendicular?2.4:3)){reject('occupied');continue;}
   cars.push({x,z,yaw,colour:PARKED_PAINT[Math.floor(hash(Math.round(x),Math.round(z))*PARKED_PAINT.length)],footprint,polygon:polygon.id,street:polygon.name});record('car',x,z);report.placed++;
  }
 }
 return {tracks,manholes,drains,bins,scooters,racks,bicycles,cars,parking,parkingPolygons:parkingPolygons.map(p=>p.id),routeEdges:routeEdges.length};
}

// ---------------------------------------------------------------------------
export function createStreetFurniture(city,mobility,trams,options={}){
 const plan=planStreetFurniture(city,mobility,trams,options),group=new THREE.Group(),obstacles=[],enterableCars=[];group.name='Route street furniture';
 const dummy=new THREE.Object3D();
 // Wheel tracks: translucent dark strips where the NPC fleet actually drives (asphalt only).
 if(plan.tracks.length){
  const gs=plan.tracks.map(t=>{const l=Math.hypot(t.b[0]-t.a[0],t.b[1]-t.a[1]);const g=new THREE.PlaneGeometry(.62,l+.3);g.rotateX(-Math.PI/2);g.rotateY(Math.atan2(t.b[0]-t.a[0],t.b[1]-t.a[1]));g.translate((t.a[0]+t.b[0])/2,.086,(t.a[1]+t.b[1])/2);return g;});
  // Soft-edged: the strip fades out across its width (plane uv.x) so tracks read as worn bands, not painted lines.
  const material=new THREE.MeshStandardMaterial({color:'#000000',transparent:true,opacity:.16,depthWrite:false,roughness:1,polygonOffset:true,polygonOffsetFactor:-1});
  material.onBeforeCompile=shader=>{shader.vertexShader='varying vec2 vTrackUv;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvTrackUv=uv;');shader.fragmentShader='varying vec2 vTrackUv;\n'+shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.a*=1.0-smoothstep(0.1,0.5,abs(vTrackUv.x-0.5));');};
  material.customProgramCacheKey=()=>'wheel-tracks-v1';
  const mesh=new THREE.Mesh(mergeGeometries(gs),material);mesh.name='Asphalt wheel tracks';mesh.receiveShadow=true;mesh.renderOrder=1;group.add(mesh);gs.forEach(g=>g.dispose());
 }
 // Static ironwork: manhole covers, gutter grates and bike-rack hoops (fixed, solid) in one vertex-coloured mesh.
 const iron=[];
 for(const m of plan.manholes){
  iron.push(coloured(new THREE.RingGeometry(.31,.38,20).rotateX(-Math.PI/2).translate(m.x,.079,m.z),'#6d6f6a'));
  iron.push(coloured(new THREE.CircleGeometry(.31,20).rotateX(-Math.PI/2).translate(m.x,.081,m.z),'#2f3232'));
  iron.push(coloured(new THREE.RingGeometry(.1,.2,12).rotateX(-Math.PI/2).translate(m.x,.083,m.z),'#3d4140'));
 }
 for(const d of plan.drains){iron.push(coloured(new THREE.BoxGeometry(.36,.02,.58).rotateY(d.yaw).translate(d.x,.078,d.z),'#262a29'));iron.push(coloured(new THREE.BoxGeometry(.3,.02,.52).rotateY(d.yaw).translate(d.x,.084,d.z),'#3b3f3d'));for(let k=-2;k<=2;k++){iron.push(coloured(new THREE.BoxGeometry(.3,.02,.05).rotateY(d.yaw).translate(d.x+Math.sin(d.yaw)*k*.11,.088,d.z+Math.cos(d.yaw)*k*.11),'#1d2120'));}}
 for(const r of plan.racks){for(const o of [-.3,.3]){iron.push(coloured(new THREE.CylinderGeometry(.025,.025,.8,6).translate(0,.4,o).rotateY(r.yaw).translate(r.x,.05,r.z),'#7d8482'));}iron.push(coloured(new THREE.CylinderGeometry(.025,.025,.6,6).rotateX(Math.PI/2).translate(0,.8,0).rotateY(r.yaw).translate(r.x,.05,r.z),'#7d8482'));obstacles.push({id:`rack-${obstacles.length}`,rings:[rect(r.x,r.z,r.yaw,.12,.7)]});}
 if(iron.length){const g=mergeGeometries(iron);g.computeVertexNormals();const mesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.6,metalness:.5}));mesh.name='Manholes, gutter grates and bike racks';mesh.castShadow=false;mesh.receiveShadow=true;group.add(mesh);iron.forEach(i=>i.dispose());}
 // Parked cars: one instanced low-poly body with per-instance paint; solid obstacles.
 if(plan.cars.length){
  const mesh=new THREE.InstancedMesh(parkedCarGeometry(),parkedCarMaterial(),plan.cars.length);mesh.name='Parked cars';mesh.castShadow=true;mesh.receiveShadow=true;
  plan.cars.forEach((c,i)=>{
   dummy.position.set(c.x,.08,c.z);dummy.rotation.set(0,c.yaw,0);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);mesh.setColorAt(i,new THREE.Color(c.colour));
   const obstacle={id:`parked-${i}`,rings:[c.footprint],bbox:bounds([c.footprint])};obstacles.push(obstacle);
   enterableCars.push(createParkedCarSource({id:`street-parked-${i}`,label:'Parked car',actor:{id:`street-parked-${i}`,x:c.x,z:c.z,heading:c.yaw,speed:0,edge:{},parked:true},obstacle,visual:{type:'estate',paint:c.colour},setHidden:instancedCarVisibility([{mesh,index:i}])}));
  });
  mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();group.add(mesh);
 }
 // Light furniture the car knocks over rather than stops against.
 const knockableMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7,metalness:.2});
 const sets=[];
 if(plan.bins.length){const k=createKnockables(plan.bins.map(b=>({id:b.id,x:b.x,z:b.z,yaw:b.yaw})),[{geometry:binTemplate(),material:knockableMaterial}],{radius:.26});k.group.name='Litter bins';k.group.children.forEach(m=>{m.castShadow=false;});group.add(k.group);sets.push(k);}
 if(plan.scooters.length){
  // Same stand-up scooter as the clusters in parked-micromobility.js; the stem takes a per-instance operator colour (plain Voi/Tier/Bolt shades, no branding).
  const items=plan.scooters.map(s=>({...s,...OPERATORS[Math.floor(hash(Math.round(s.x),Math.round(s.z)+5)*OPERATORS.length)]}));
  const k=createLooseMicromobility(items.map(s=>({...s,color:s.accent,operator:s.name})),{kind:'scooter',name:'Street e-scooters'});group.add(k.group);sets.push(k);
 }
 // Bikes leaning on the racks fly off when hit; the bolted hoops stay put.
 if(plan.bicycles.length){const k=createLooseMicromobility(plan.bicycles,{kind:'bicycle',name:'Rack bicycles',lift:.05});group.add(k.group);sets.push(k);}
 const knockables=sets.length?combineKnockables(sets):null;
 group.userData={tracks:plan.tracks.length,manholes:plan.manholes.length,drains:plan.drains.length,bins:plan.bins.length,scooters:plan.scooters.length,racks:plan.racks.length,bicycles:plan.bicycles.length,parkedCars:plan.cars.length,parkingPolygons:plan.parkingPolygons.length,routeEdges:plan.routeEdges,
  reference:'Municipal polygons (Ajorata, Pysäköintialue, pavement), HSL rail shapes and the traffic graph; furniture positions interpreted, not surveyed'};
 return {group,obstacles,knockables,plan,enterableCars,rideSources:knockables?.rideSources||[]};
}
