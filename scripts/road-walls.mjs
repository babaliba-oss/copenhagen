#!/usr/bin/env node
// Collision for the walls the city model draws down to the street on a mapped road (today's Copenhagen). The footprints
// stop at the roads (scripts/kk-collision.py takes the roads out of the model-only parts so a deck or passage over a
// street stays drivable; scripts/collision-trim.py cuts mapped footprints back off the street), so where the model's
// walls do reach the ground on the road polygons (annexes, sheds, pavilions and drive-under entrances mapped as
// carriageway) nothing was solid: the car drove through them and traffic lanes ran through them. This writes each such
// wall's run on a road as a 0.6 m thick strip, public/cities/<city>/road-walls.json ({id, rings, height}): main.js
// makes them solid (world.buildings, so traffic also routes round lanes that cross them).
// Walls: vertical model triangles from within 0.5 m of the ground to over 1.5 m; parts not drawn (duplicates.json, the
// OpenStreetMap box inside the model's own building) and canopies, skyways and building sites (footprint kind roof,
// bridge, carport, construction) are left out; runs already inside a collision footprint are not repeated.
// 1760 (copenhagen-1760): the parts that era draws (main.js: GONE names, HIDE_1760, era.json anachronisms, earthworks, boxes in
// the water), set on the ground as the game does; solid footprints as main.js's undrawnFootprint keeps them. There the coaches
// drove through gateways and house ends the model draws shut across the mapped carriageway.
//   node scripts/road-walls.mjs copenhagen
//   node scripts/road-walls.mjs copenhagen-1760
import {readFileSync,writeFileSync,existsSync} from 'fs';
import {gunzipSync} from 'zlib';
import {expandCity} from '../src/city-pack.js';
import {SpatialIndex,bounds,inWaterPolygons} from '../src/geo.js';
import {decodeTerrain,setTerrain,groundAt,liftBuildings} from '../src/terrain.js';
import {isRampart} from '../src/ramparts.js';
import {HIDE_1760,cutParts1760} from '../src/copenhagen/landmarks.js';

const id=process.argv[2]||'copenhagen',dir=`public/cities/${id}/`,HALF=.3,STEP=.25,era1760=id.endsWith('-1760');
const unzip=b=>b[0]===31&&b[1]===139?gunzipSync(b):b,floats=b=>{b=unzip(b);return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
setTerrain(decodeTerrain(new Uint8Array(unzip(readFileSync(dir+'terrain.pack')))));
const data=expandCity(JSON.parse(unzip(readFileSync(dir+'city.pack')).toString()));
const UNDRAWN=/^(roof|construction|carport|bridge)$/,kind=new Map(data.buildings.map(b=>[b.id,b.kind]));
if(existsSync(dir+'collision-trim.json')){const trim=JSON.parse(readFileSync(dir+'collision-trim.json')),seen=new Map();for(const b of data.buildings){const k=seen.get(b.id)||0;seen.set(b.id,k+1);const r=trim[k?`${b.id}#${k}`:b.id];if(r===undefined)continue;if(r){b.rings=r;b.bbox=bounds([r.flat()]);}else b.disabled=true;}}
const hidden=new Set(era1760?HIDE_1760:[]),undrawn=b=>{const bb=b.bbox??=bounds(b.rings);return b.disabled||UNDRAWN.test(b.kind||'')||era1760&&((bb[2]-bb[0])*(bb[3]-bb[1])<60&&!(b.cover>=.5)||isRampart(b)||hidden.has('kk-'+b.id)||hidden.has(b.id));}; // main.js undrawnFootprint
const solid=new SpatialIndex([...data.buildings.filter(b=>!undrawn(b)),...(existsSync(dir+'kk-footprints.json')?JSON.parse(readFileSync(dir+'kk-footprints.json')):[])]);
const roads=new SpatialIndex(data.roads.filter(r=>!/Koroke/.test(r.kind||'')));
const index=JSON.parse(readFileSync(dir+'buildings3d-index.json')),dup=new Set(JSON.parse(readFileSync(dir+'duplicates.json')));
{const kk=new Map();for(const t of index.tiles)for(const p of t.parts)if(p.id.startsWith('kk-osm-'))kk.set(p.id.slice(3),p.bbox);
 for(const t of index.tiles)for(const p of t.parts){const b=kk.get(p.id),a=p.bbox;if(!b)continue;const share=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]))/Math.max(1e-6,(a[2]-a[0])*(a[3]-a[1]));if(share>=.5)dup.add(t.file+':'+p.start);}} // main.js: the OpenStreetMap box inside the model's own building
if(era1760){const GONE=eval(readFileSync('src/main.js','utf8').match(/const GONE=(\/\^.*?\/[a-z]*);/)[1]),late=new Set(JSON.parse(readFileSync(dir+'era.json')).anachronisms||[]);
 const wet=([a,b,c,d])=>{const ix=(c-a)*.25,iz=(d-b)*.25;return [[(a+c)/2,(b+d)/2],[a+ix,b+iz],[c-ix,b+iz],[a+ix,d-iz],[c-ix,d-iz]].filter(([x,z])=>inWaterPolygons(data.water,x,z)).length>=4;};
 for(const t of index.tiles)for(const p of t.parts)if(late.has(p.id)||hidden.has(p.id)||p.name&&GONE.test(p.name)||p.embankment||/vold|bastion|batteri|skanse|krudt/i.test(p.name||'')||wet(p.bbox))dup.add(t.file+':'+p.start);} // not drawn in 1760
const out=[],seen=new Set();let metres=0;const parts=new Set();
for(const t of index.tiles){let a=null;
 for(const p of t.parts){if(dup.has(t.file+':'+p.start)||(era1760?p.skyway:UNDRAWN.test(kind.get(p.id.replace(/^kk-/,''))||'')))continue; // 1760 draws a covered bridge or shed the index does not lift as a skyway from the ground up, mapped kind or notconst [x0,z0,x1,z1]=p.bbox;if(!roads.near((x0+x1)/2,(z0+z1)/2).length&&!roads.at(x0,z0)&&!roads.at(x1,z1))continue;
  if(!a){a=floats(readFileSync(dir+t.file));if(era1760)liftBuildings(a,t.parts.map(q=>({...q})));} // 1760: each part stands on its lowest ground (main.js)
  let lo=Infinity;if(!p.abs)for(let v=p.start;v<p.start+p.count;v++)lo=Math.min(lo,a[v*5+1]);
  for(let v=p.start;v+2<p.start+p.count;v+=3){const o=v*5,P=[[a[o],a[o+1],a[o+2]],[a[o+5],a[o+6],a[o+7]],[a[o+10],a[o+11],a[o+12]]];
   if(Math.abs((P[1][0]-P[0][0])*(P[2][2]-P[0][2])-(P[1][2]-P[0][2])*(P[2][0]-P[0][0]))>.05)continue; // not a wall
   let bi=0,bj=1,bd=-1;for(let i=0;i<3;i++)for(let j=i+1;j<3;j++){const d=Math.hypot(P[i][0]-P[j][0],P[i][2]-P[j][2]);if(d>bd){bd=d;bi=i;bj=j;}}if(bd<.3)continue;
   const [ax,,az]=P[bi],[bx,,bz]=P[bj],g=p.abs?groundAt((ax+bx)/2,(az+bz)/2):lo,ys=P.map(q=>q[1]);if(Math.min(...ys)>g+.5||Math.max(...ys)<g+1.5)continue; // from the ground up past a car
   const key=[ax,az,bx,bz].map(v=>v.toFixed(1)).join();if(seen.has(key))continue;seen.add(key); // the wall's other triangle
   const n=Math.max(1,Math.ceil(bd/STEP)),ux=(bx-ax)/bd,uz=(bz-az)/bd;let run=-1;
   const emit=(i0,i1)=>{const s0=Math.max(0,i0*STEP-HALF),s1=Math.min(bd,i1*STEP+HALF);if(s1-s0<.5)return;const px=-uz*HALF,pz=ux*HALF,A=[ax+ux*s0,az+uz*s0],B=[ax+ux*s1,az+uz*s1];
    const ring=[[A[0]+px,A[1]+pz],[B[0]+px,B[1]+pz],[B[0]-px,B[1]-pz],[A[0]-px,A[1]-pz]].map(q=>q.map(v=>+v.toFixed(2)));out.push({id:p.id,rings:[ring],height:+(Math.max(...ys)-g).toFixed(1)});metres+=s1-s0;parts.add(p.id);};
   for(let i=0;i<=n;i++){const s=Math.min(bd,i*STEP),x=ax+ux*s,z=az+uz*s,on=!!roads.at(x,z)&&!solid.at(x,z);if(on&&run<0)run=i;if(!on&&run>=0){emit(run,i-1);run=-1;}}if(run>=0)emit(run,n);}}}
writeFileSync(dir+'road-walls.json',JSON.stringify(out));
console.log(`${id}: ${out.length} wall runs on the roads (${Math.round(metres)} m) from ${parts.size} model parts -> ${dir}road-walls.json`);
// camera-walls.json, for the drive camera only (never collision: the car still drives up to the mapped footprint): the drawn
// walls sectioned at the lens's heights (2.6-5.5 m up: 3.3 m at the default zoom, higher on a short boom) wherever they stand
// more than CAM_IN outside the camera's footprints (cornices, bays, a footprint mapped short; a skyway-less "bridge" block,
// which has no collision but is drawn from the ground) and within CAM_ROAD of a road, where a camera can follow the car.
// Each run is a segment [x0,z0,x1,z1] (0.1 m); driving-camera.js cameraWallStrips makes it a strip CAM_HALF either side.
// The boom's ring of 8 probes at CAMERA_CLEARANCE.r = 1 m meets such a strip wherever its wall comes within ~1.4 m of the lens.
{const HS=[2.6,3.3,4.2,5.5],CAM_IN=.45,CAM_ROAD=12,ring=r=>[0,1,2,3,4,5,6,7].map(k=>[Math.cos(k*Math.PI/4)*r,Math.sin(k*Math.PI/4)*r]),IN=ring(CAM_IN),R1=ring(CAM_ROAD/2),R2=ring(CAM_ROAD);
 const allRoads=new SpatialIndex(data.roads),lanes=new SpatialIndex(data.roads.filter(r=>/^Ajorata/.test(r.kind||'')));
 const exposed=(x,z)=>!solid.at(x,z)&&!IN.some(([dx,dz])=>solid.at(x+dx,z+dz))&&(!!allRoads.at(x,z)||R1.some(([dx,dz])=>allRoads.at(x+dx,z+dz))||R2.some(([dx,dz])=>allRoads.at(x+dx,z+dz)));
 const skyway=p=>{if(era1760)return !!p.skyway;if(kind.get(p.id.replace(/^kk-/,''))!=='bridge'||!(p.height>8))return false;const [a,b,c,d]=p.bbox,st=Math.max(.5,Math.min(c-a,d-b)/6);let s=0,r=0;for(let x=a+st/2;x<c;x+=st)for(let z=b+st/2;z<d;z+=st){s++;if(lanes.at(x,z))r++;}return s>0&&r/s>=.85;}; // main.js: lifted off the street (SKYWAY_CLEAR)
 const segs=[],done=new Set();let m=0;
 for(const t of index.tiles){let a=null;
  for(const p of t.parts){if(dup.has(t.file+':'+p.start)||skyway(p)||!era1760&&/^(roof|construction|carport)$/.test(kind.get(p.id.replace(/^kk-/,''))||''))continue;
   if(!a){a=floats(readFileSync(dir+t.file));if(era1760){liftBuildings(a,t.parts.map(q=>({...q})));cutParts1760(a,t.parts);}} // 1760: as main.js sets the parts (lifted, the landmarks' regions cut out)
   let lo=Infinity;if(!p.abs)for(let v=p.start;v<p.start+p.count;v++)lo=Math.min(lo,a[v*5+1]);
   for(let v=p.start;v+2<p.start+p.count;v+=3){const o=v*5,P=[[a[o],a[o+1],a[o+2]],[a[o+5],a[o+6],a[o+7]],[a[o+10],a[o+11],a[o+12]]],g=p.abs?groundAt((P[0][0]+P[1][0]+P[2][0])/3,(P[0][2]+P[1][2]+P[2][2])/3):lo;
    for(const h of HS){const y=g+h,q=[];for(const [A,B] of [[P[0],P[1]],[P[1],P[2]],[P[2],P[0]]])if((A[1]-y)*(B[1]-y)<0){const s=(y-A[1])/(B[1]-A[1]);q.push([A[0]+s*(B[0]-A[0]),A[2]+s*(B[2]-A[2])]);}
     if(q.length!==2)continue;const [[ax,az],[bx,bz]]=q,L=Math.hypot(bx-ax,bz-az);if(L<.1)continue;const key=[ax,az,bx,bz].map(v=>v.toFixed(1)).join();if(done.has(key))continue;done.add(key); // a plumb wall cuts the same at every height
     const n=Math.max(1,Math.ceil(L/STEP)),ux=(bx-ax)/L,uz=(bz-az)/L;let run=-1;
     const emit=(i0,i1)=>{const s0=Math.max(0,(i0-1)*STEP),s1=Math.min(L,(i1+1)*STEP);segs.push([ax+ux*s0,az+uz*s0,ax+ux*s1,az+uz*s1]);m+=s1-s0;};
     for(let i=0;i<=n;i++){const s=Math.min(L,i*STEP),on=exposed(ax+ux*s,az+uz*s);if(on&&run<0)run=i;if(!on&&run>=0){emit(run,i-1);run=-1;}}if(run>=0)emit(run,n);}}}}
 // one run per wall line: the pieces of a wall (its triangles, its cuts at each height, a run broken for a sample) lie on
 // nearly the same line (in a 16 m cell, direction to 0.3 degree, offset to 0.1 m): merge their overlapping or touching (0.3 m) spans
 const lines=new Map();for(const [ax,az,bx,bz] of segs){let t=Math.atan2(bz-az,bx-ax);if(t<0)t+=Math.PI;if(t>=Math.PI-.0025)t-=Math.PI;const ox=Math.floor((ax+bx)/32)*16+8,oz=Math.floor((az+bz)/32)*16+8,ux=Math.cos(t),uz=Math.sin(t),rho=-uz*(ax-ox)+ux*(az-oz),k=ox+','+oz+','+Math.round(t/.005)+','+Math.round(rho/.1);
  let l=lines.get(k);if(!l)lines.set(k,l={ox,oz,ux,uz,rho,spans:[]});const s0=(ax-l.ox)*l.ux+(az-l.oz)*l.uz,s1=(bx-l.ox)*l.ux+(bz-l.oz)*l.uz;l.spans.push(s0<s1?[s0,s1]:[s1,s0]);}
 const flat=[];for(const l of lines.values()){l.spans.sort((p,q)=>p[0]-q[0]);let cur=null;const put=([s0,s1])=>flat.push(...[l.ox+l.ux*s0-l.uz*l.rho,l.oz+l.uz*s0+l.ux*l.rho,l.ox+l.ux*s1-l.uz*l.rho,l.oz+l.uz*s1+l.ux*l.rho].map(v=>+v.toFixed(1)));
  for(const s of l.spans){if(cur&&s[0]<=cur[1]+.3)cur[1]=Math.max(cur[1],s[1]);else{if(cur)put(cur);cur=[...s];}}put(cur);}
 writeFileSync(dir+'camera-walls.json',JSON.stringify(flat));
 console.log(`${id}: ${flat.length/4} wall runs (${segs.length} pieces) at lens height outside the camera's footprints near the roads (${Math.round(m)} m) -> ${dir}camera-walls.json`);}
