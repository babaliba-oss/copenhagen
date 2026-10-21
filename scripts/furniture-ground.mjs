#!/usr/bin/env node
// Second pass over furniture.json (after scripts/mapillary-features.mjs, and again whenever the street surface tiles are
// rebuilt): flags `bare:1` on the items that stand off the drawn street surfaces (surfaces/*.bin: roads, pavements, park
// paths and lawns). There the game draws the bare terrain ground, which lies under the height field (8 cm plus its 10 m
// triangles' sag; 50 cm in the cells touching a lawn) or a mapped lawn 22 cm down, and an item at groundAt floated over
// it: benches, bins and lamps beside the park lawns half a metre in the air. main.js stands flagged items on that ground.
// An item within 35 cm of a surface keeps the surface's height (a post at the edge of the pavement).
//   node scripts/furniture-ground.mjs copenhagen
import {readFileSync,writeFileSync} from 'fs';
import {gunzipSync} from 'zlib';

const id=process.argv[2]||'copenhagen',dir=`public/cities/${id}`;
const layer=JSON.parse(readFileSync(`${dir}/furniture.json`,'utf8')),index=JSON.parse(readFileSync(`${dir}/surface-index.json`,'utf8'));
const read=path=>{let b=readFileSync(path);if(b[0]===31&&b[1]===139)b=gunzipSync(b);return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
// Surface triangles (x,y,z,r,g,b per vertex) on a 4 m grid, read only from tiles that hold an item.
const G=4,grid=new Map(),cell=(x,z)=>Math.floor(x/G)*100003+Math.floor(z/G);
const wanted=index.filter(t=>layer.items.some(it=>it.x>=t.bbox[0]-1&&it.x<=t.bbox[2]+1&&it.z>=t.bbox[1]-1&&it.z<=t.bbox[3]+1));
for(const t of wanted){const a=read(`${dir}/${t.file}.pack`);
 for(let i=0;i+17<a.length;i+=18){const ax=a[i],az=a[i+2],bx=a[i+6],bz=a[i+8],cx=a[i+12],cz=a[i+14];
  for(let gx=Math.floor(Math.min(ax,bx,cx)/G);gx<=Math.floor(Math.max(ax,bx,cx)/G);gx++)for(let gz=Math.floor(Math.min(az,bz,cz)/G);gz<=Math.floor(Math.max(az,bz,cz)/G);gz++){const k=gx*100003+gz;let l=grid.get(k);if(!l)grid.set(k,l=[]);l.push([ax,az,bx,bz,cx,cz]);}}}
const covered=(x,z)=>(grid.get(cell(x,z))||[]).some(([ax,az,bx,bz,cx,cz])=>{const d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(d)<1e-9)return false;const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/d,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/d;return u>=-1e-6&&v>=-1e-6&&u+v<=1+1e-6;});
const AROUND=[[0,0],[.35,0],[-.35,0],[0,.35],[0,-.35]];let bare=0;const kinds={};
for(const it of layer.items){delete it.bare;if(it.k==='wire-lamp')continue; /* hung over the carriageway */if(AROUND.some(([a,b])=>covered(it.x+a,it.z+b)))continue;it.bare=1;bare++;kinds[it.k]=(kinds[it.k]||0)+1;}
writeFileSync(`${dir}/furniture.json`,JSON.stringify(layer));
console.log(`${id}: ${bare} of ${layer.items.length} items off the drawn street surfaces (${wanted.length} surface tiles)`,kinds);
