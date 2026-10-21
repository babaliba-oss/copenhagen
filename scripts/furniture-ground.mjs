#!/usr/bin/env node
// Second pass over furniture.json (after scripts/mapillary-features.mjs, and again whenever the street surface tiles are
// rebuilt): flags `bare:1` on the items that stand off the drawn street surfaces (surfaces/*.bin: roads, pavements, park
// paths and lawns). There the game draws the bare terrain ground, which lies under the height field (8 cm plus its 10 m
// triangles' sag; 50 cm in the cells touching a lawn) or a mapped lawn 22 cm down, and an item at groundAt floated over
// it: benches, bins and lamps beside the park lawns half a metre in the air. main.js stands flagged items on that ground.
// The test is the item's own spot: a post at the edge of the pavement whose foot is on the bare side stands on the lower,
// bare ground (kept at the surface's height it floated up to half a metre over it).
// Items the game moves (benches set back from the kerb, posts brought ashore: mapped-furniture.js placeBenches and
// bringAshore, in main.js's order) are tested where they end up: `mb:1` (bare where moved).
//   node scripts/furniture-ground.mjs copenhagen
import {readFileSync,writeFileSync} from 'fs';
import {gunzipSync} from 'zlib';
import {expandCity} from '../src/city-pack.js';
import {SpatialIndex,inWaterPolygons} from '../src/geo.js';
import {placeBenches,bringAshore} from '../src/mapped-furniture.js';

const id=process.argv[2]||'copenhagen',dir=`public/cities/${id}`;
const layer=JSON.parse(readFileSync(`${dir}/furniture.json`,'utf8')),index=JSON.parse(readFileSync(`${dir}/surface-index.json`,'utf8'));
const read=path=>{let b=readFileSync(path);if(b[0]===31&&b[1]===139)b=gunzipSync(b);return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
// Surface triangles (x,y,z,r,g,b per vertex) on a 4 m grid, read only from tiles that hold an item (or a spot it is moved to).
const G=4,grid=new Map(),cell=(x,z)=>Math.floor(x/G)*100003+Math.floor(z/G);
const wanted=index.filter(t=>layer.items.some(it=>it.x>=t.bbox[0]-5&&it.x<=t.bbox[2]+5&&it.z>=t.bbox[1]-5&&it.z<=t.bbox[3]+5));
for(const t of wanted){const a=read(`${dir}/${t.file}.pack`);
 for(let i=0;i+17<a.length;i+=18){const ax=a[i],az=a[i+2],bx=a[i+6],bz=a[i+8],cx=a[i+12],cz=a[i+14];
  for(let gx=Math.floor(Math.min(ax,bx,cx)/G);gx<=Math.floor(Math.max(ax,bx,cx)/G);gx++)for(let gz=Math.floor(Math.min(az,bz,cz)/G);gz<=Math.floor(Math.max(az,bz,cz)/G);gz++){const k=gx*100003+gz;let l=grid.get(k);if(!l)grid.set(k,l=[]);l.push([ax,az,bx,bz,cx,cz]);}}}
const covered=(x,z)=>(grid.get(cell(x,z))||[]).some(([ax,az,bx,bz,cx,cz])=>{const d=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(Math.abs(d)<1e-9)return false;const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/d,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/d;return u>=-1e-6&&v>=-1e-6&&u+v<=1+1e-6;});
let bare=0;const kinds={};
for(const it of layer.items){delete it.bare;delete it.mb;if(it.k==='wire-lamp')continue; /* hung over the carriageway */if(covered(it.x,it.z))continue;it.bare=1;bare++;kinds[it.k]=(kinds[it.k]||0)+1;}
// Where the game moves items (main.js: lane items dropped, benches set along the kerb, items out on the water dropped, the quay edge brought ashore).
let moved=0,movedBare=0;{let c=readFileSync(`${dir}/city.pack`);if(c[0]===31&&c[1]===139)c=gunzipSync(c);const data=expandCity(JSON.parse(c.toString()));
 const lanes=new SpatialIndex(data.roads.filter(r=>/^Ajorata/.test(r.kind))),islands=new SpatialIndex(data.roads.filter(r=>/Koroke/.test(r.kind))),walk=new SpatialIndex(data.pavement||[]),houses=new SpatialIndex(data.buildings||[]),wet=(x,z)=>inWaterPolygons(data.water||[],x,z);
 let items=layer.items.map(it=>({...it,src:it}));items=items.filter(it=>it.k==='wire-lamp'||!(lanes.at(it.x,it.z)&&!islands.at(it.x,it.z)));
 items=placeBenches(items,{houses,wheels:new SpatialIndex(data.roads.filter(r=>!/Koroke/.test(r.kind))),walk}).items;
 items=items.filter(it=>!([[0,0],[2.5,0],[-2.5,0],[0,2.5],[0,-2.5]].every(([a,b])=>wet(it.x+a,it.z+b))&&!lanes.at(it.x,it.z)&&!walk.at(it.x,it.z)));
 items=bringAshore(items,{wet,blocked:(x,z)=>!!houses.at(x,z)||lanes.at(x,z)&&!islands.at(x,z)}).items;
 for(const it of items){if(it.k==='wire-lamp'||it.x===it.src.x&&it.z===it.src.z)continue;moved++;if(!covered(it.x,it.z)){it.src.mb=1;movedBare++;}}}
writeFileSync(`${dir}/furniture.json`,JSON.stringify(layer));
console.log(`${id}: ${bare} of ${layer.items.length} items off the drawn street surfaces (${wanted.length} surface tiles); ${movedBare} of the ${moved} the game moves end up off them`,kinds);
