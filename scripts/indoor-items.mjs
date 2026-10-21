#!/usr/bin/env node
// Street furniture and trees standing inside a drawn house (today's Copenhagen). The photo detections, the municipal
// registers and the tree register place some points inside the city model's buildings: lamps, signs, racks and benches
// poking through a roof or standing in a hall the car cannot enter. A point is inside when a model part's roof is drawn
// over it, it is more than DEPTH from every ground-level wall, and a house stands there: its collision footprint (city.pack
// with collision-trim.json, kk-footprints.json) or the part's own ground walls closed round it. Canopies, skyways and
// building sites (footprint kind roof, bridge, carport, construction) are not houses; duplicate parts (duplicates.json, the
// OpenStreetMap box inside the model's own building) are not drawn.
// Run after scripts/furniture-ground.mjs: drops those items from furniture.json, writes indoor-trees.json ([x,z] of the
// register trees main.js leaves out).
//   node scripts/indoor-items.mjs copenhagen
import {readFileSync,writeFileSync} from 'fs';
import {gunzipSync} from 'zlib';
import {expandCity} from '../src/city-pack.js';
import {SpatialIndex,bounds} from '../src/geo.js';
import {decodeTerrain,setTerrain,groundAt} from '../src/terrain.js';

const id=process.argv[2]||'copenhagen',dir=`public/cities/${id}/`,FURNITURE_DEPTH=1,TREE_DEPTH=.5;
const unzip=b=>b[0]===31&&b[1]===139?gunzipSync(b):b,floats=b=>{b=unzip(b);return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
setTerrain(decodeTerrain(new Uint8Array(unzip(readFileSync(dir+'terrain.pack')))));
const data=expandCity(JSON.parse(unzip(readFileSync(dir+'city.pack')).toString()));
const UNDRAWN=/^(roof|construction|carport|bridge)$/,kind=new Map(data.buildings.map(b=>[b.id,b.kind]));
// Collision footprints as main.js builds them.
{const trim=JSON.parse(readFileSync(dir+'collision-trim.json')),seen=new Map();for(const b of data.buildings){const k=seen.get(b.id)||0;seen.set(b.id,k+1);const r=trim[k?`${b.id}#${k}`:b.id];if(r===undefined)continue;if(r){b.rings=r;b.bbox=bounds([r.flat()]);}else b.disabled=true;}}
const footprints=new SpatialIndex([...data.buildings.filter(b=>!b.disabled&&!UNDRAWN.test(b.kind||'')),...JSON.parse(readFileSync(dir+'kk-footprints.json'))]);
// Drawn parts: roofs (non-vertical triangles, not ground-level plates), walls reaching down to the ground, each part's ground row.
const index=JSON.parse(readFileSync(dir+'buildings3d-index.json')),dup=new Set(JSON.parse(readFileSync(dir+'duplicates.json')));
{const kk=new Map();for(const t of index.tiles)for(const p of t.parts)if(p.id.startsWith('kk-osm-'))kk.set(p.id.slice(3),p.bbox);
 for(const t of index.tiles)for(const p of t.parts){const b=kk.get(p.id),a=p.bbox;if(!b)continue;const share=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]))/Math.max(1e-6,(a[2]-a[0])*(a[3]-a[1]));if(share>=.5)dup.add(t.file+':'+p.start);}} // main.js: the OpenStreetMap box inside the model's own building
const G=8,roofs=new Map(),walls=new Map(),put=(m,x0,z0,x1,z1,v)=>{for(let gx=Math.floor(x0/G);gx<=Math.floor(x1/G);gx++)for(let gz=Math.floor(z0/G);gz<=Math.floor(z1/G);gz++){const k=gx*100003+gz;let l=m.get(k);if(!l)m.set(k,l=[]);l.push(v);}};
for(const t of index.tiles){const a=floats(readFileSync(dir+t.file));
 for(const p of t.parts){if(dup.has(t.file+':'+p.start)||UNDRAWN.test(kind.get(p.id.replace(/^kk-/,''))||''))continue;let lo=Infinity;for(let v=p.start;v<p.start+p.count;v++)lo=Math.min(lo,a[v*5+1]);const part={id:p.id,base:[]};
  for(let v=p.start;v+2<p.start+p.count;v+=3){const o=v*5,P=[[a[o],a[o+1],a[o+2]],[a[o+5],a[o+6],a[o+7]],[a[o+10],a[o+11],a[o+12]]],cx=(P[0][0]+P[1][0]+P[2][0])/3,cz=(P[0][2]+P[1][2]+P[2][2])/3,g=p.abs?groundAt(cx,cz):lo,ys=P.map(q=>q[1]);
   if(Math.abs((P[1][0]-P[0][0])*(P[2][2]-P[0][2])-(P[1][2]-P[0][2])*(P[2][0]-P[0][0]))<.05){if(Math.min(...ys)>g+2.5)continue; /* a wall: its ground row closes the part, any low wall bounds the depth */
    let bi=0,bj=1,bd=-1;for(let i=0;i<3;i++)for(let j=i+1;j<3;j++){const d=Math.hypot(P[i][0]-P[j][0],P[i][2]-P[j][2]);if(d>bd){bd=d;bi=i;bj=j;}}if(bd<.05)continue;const s=[P[bi][0],P[bi][2],P[bj][0],P[bj][2]];put(walls,Math.min(s[0],s[2]),Math.min(s[1],s[3]),Math.max(s[0],s[2]),Math.max(s[1],s[3]),s);
    const low=P.filter(q=>q[1]<g+1.2);if(low.length===2&&Math.abs(low[0][1]-low[1][1])<=.3&&Math.min(low[0][1],low[1][1])>=g-3)part.base.push([low[0][0],low[0][2],low[1][0],low[1][2]]);continue;}
   if(Math.min(...ys)<g+1.6&&Math.max(...ys)<g+2)continue; // ground-level plates (plinth tops, steps): not a roof
   put(roofs,Math.min(P[0][0],P[1][0],P[2][0]),Math.min(P[0][2],P[1][2],P[2][2]),Math.max(P[0][0],P[1][0],P[2][0]),Math.max(P[0][2],P[1][2],P[2][2]),[P[0][0],P[0][2],P[1][0],P[1][2],P[2][0],P[2][2],part]);}}}
const roofAt=(x,z)=>{for(const r of roofs.get(Math.floor(x/G)*100003+Math.floor(z/G))||[]){const [ax,az,bx,bz,qx,qz]=r,s1=(bx-ax)*(z-az)-(bz-az)*(x-ax),s2=(qx-bx)*(z-bz)-(qz-bz)*(x-bx),s3=(ax-qx)*(z-qz)-(az-qz)*(x-qx);if(s1>=0&&s2>=0&&s3>=0||s1<=0&&s2<=0&&s3<=0)return r[6];}return null;};
const d2seg=(px,pz,ax,az,bx,bz)=>{const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/l)):0;return Math.hypot(px-ax-dx*t,pz-az-dz*t);};
const wallDist=(x,z,lim)=>{let d=lim;const seen=new Set();for(let gx=Math.floor((x-lim)/G);gx<=Math.floor((x+lim)/G);gx++)for(let gz=Math.floor((z-lim)/G);gz<=Math.floor((z+lim)/G);gz++)for(const s of walls.get(gx*100003+gz)||[]){if(seen.has(s))continue;seen.add(s);d=Math.min(d,d2seg(x,z,...s));}return d;};
const closed=(part,x,z)=>{let cx=0,cz=0;for(const [ax,az,bx,bz] of part.base){if((az>z)!==(bz>z)&&ax+(z-az)*(bx-ax)/(bz-az)>x)cx++;if((ax>x)!==(bx>x)&&az+(x-ax)*(bz-az)/(bx-ax)>z)cz++;}return cx%2===1&&cz%2===1;};
const indoors=(x,z,depth)=>{const part=roofAt(x,z);return !!part&&wallDist(x,z,depth+.01)>depth&&(!!footprints.at(x,z)||closed(part,x,z));};
const layer=JSON.parse(readFileSync(dir+'furniture.json','utf8')),before=layer.items.length,kinds={};
layer.items=layer.items.filter(it=>{if(it.k==='wire-lamp'||!indoors(it.x,it.z,FURNITURE_DEPTH))return true;kinds[it.k]=(kinds[it.k]||0)+1;return false;}); /* wire lamps hang over the street */
writeFileSync(dir+'furniture.json',JSON.stringify(layer));
const trees=data.trees.filter(t=>indoors(t.p[0],t.p[1],TREE_DEPTH)).map(t=>t.p.map(v=>+v.toFixed(2)));
writeFileSync(dir+'indoor-trees.json',JSON.stringify(trees));
console.log(`${id}: ${before-layer.items.length} furniture items inside drawn houses dropped`,kinds,`; ${trees.length} trees inside drawn houses listed in indoor-trees.json`);
