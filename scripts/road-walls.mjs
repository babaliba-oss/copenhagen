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
//   node scripts/road-walls.mjs copenhagen
import {readFileSync,writeFileSync} from 'fs';
import {gunzipSync} from 'zlib';
import {expandCity} from '../src/city-pack.js';
import {SpatialIndex,bounds} from '../src/geo.js';
import {decodeTerrain,setTerrain,groundAt} from '../src/terrain.js';

const id=process.argv[2]||'copenhagen',dir=`public/cities/${id}/`,HALF=.3,STEP=.25;
const unzip=b=>b[0]===31&&b[1]===139?gunzipSync(b):b,floats=b=>{b=unzip(b);return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
setTerrain(decodeTerrain(new Uint8Array(unzip(readFileSync(dir+'terrain.pack')))));
const data=expandCity(JSON.parse(unzip(readFileSync(dir+'city.pack')).toString()));
const UNDRAWN=/^(roof|construction|carport|bridge)$/,kind=new Map(data.buildings.map(b=>[b.id,b.kind]));
{const trim=JSON.parse(readFileSync(dir+'collision-trim.json')),seen=new Map();for(const b of data.buildings){const k=seen.get(b.id)||0;seen.set(b.id,k+1);const r=trim[k?`${b.id}#${k}`:b.id];if(r===undefined)continue;if(r){b.rings=r;b.bbox=bounds([r.flat()]);}else b.disabled=true;}}
const solid=new SpatialIndex([...data.buildings.filter(b=>!b.disabled&&!UNDRAWN.test(b.kind||'')),...JSON.parse(readFileSync(dir+'kk-footprints.json'))]);
const roads=new SpatialIndex(data.roads.filter(r=>!/Koroke/.test(r.kind||'')));
const index=JSON.parse(readFileSync(dir+'buildings3d-index.json')),dup=new Set(JSON.parse(readFileSync(dir+'duplicates.json')));
{const kk=new Map();for(const t of index.tiles)for(const p of t.parts)if(p.id.startsWith('kk-osm-'))kk.set(p.id.slice(3),p.bbox);
 for(const t of index.tiles)for(const p of t.parts){const b=kk.get(p.id),a=p.bbox;if(!b)continue;const share=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]))/Math.max(1e-6,(a[2]-a[0])*(a[3]-a[1]));if(share>=.5)dup.add(t.file+':'+p.start);}} // main.js: the OpenStreetMap box inside the model's own building
const out=[],seen=new Set();let metres=0;const parts=new Set();
for(const t of index.tiles){let a=null;
 for(const p of t.parts){if(dup.has(t.file+':'+p.start)||UNDRAWN.test(kind.get(p.id.replace(/^kk-/,''))||''))continue;const [x0,z0,x1,z1]=p.bbox;if(!roads.near((x0+x1)/2,(z0+z1)/2).length&&!roads.at(x0,z0)&&!roads.at(x1,z1))continue;
  a??=floats(readFileSync(dir+t.file));let lo=Infinity;if(!p.abs)for(let v=p.start;v<p.start+p.count;v++)lo=Math.min(lo,a[v*5+1]);
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
