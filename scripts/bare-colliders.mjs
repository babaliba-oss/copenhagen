// Footprints you bump into with nothing standing on them (1760). The car and the walkers collide with the city's
// footprints (city.pack buildings); scripts/fit-colliders.py keeps those the model's roofs cover in plan. But a roof in plan
// is not a house you can see: the plinths and paved decks main.js collapses (flat roofs within a metre of the street),
// and rampart tiers buried in the terrain (the elevation model already has today's hills where 1760's Volden stood, the
// earthwork drawn on top of them sinks into the hill), cover a footprint and draw nothing above the ground. Driving
// onto open ground stopped at a wall there.
// This measures, on a 1 m grid, the highest drawn surface over each footprint as the game prepares the houses (parts the
// era hides left out, each part lifted onto its lowest ground, plinths collapsed), and counts the cells where nothing
// stands half a metre above the ground. A footprint that is mostly bare (60 %) is removed with --write.
// node scripts/bare-colliders.mjs copenhagen-1760 [--write] -> JSON summary to stdout
import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';
import {decodeTerrain,setTerrain,groundAt,liftBuildings} from '../src/terrain.js';
import {pointInPolygon,inWaterPolygons} from '../src/geo.js';
const city=process.argv[2]||'copenhagen-1760',write=process.argv.includes('--write'),root=`public/cities/${city}`,SHARE=.6,MIN=12;
const idx=JSON.parse(fs.readFileSync(path.join(root,'buildings3d-index.json'),'utf8'));
const pack=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'city.pack'))));
{let tb=fs.readFileSync(path.join(root,'terrain.pack'));if(tb[0]===31)tb=zlib.gunzipSync(tb);setTerrain(decodeTerrain(tb.buffer.slice(tb.byteOffset,tb.byteOffset+tb.byteLength)));}
let gone=null;if(city.endsWith('1760')){const m=fs.readFileSync('src/main.js','utf8').match(/const GONE=(\/\^.*?\/[a-z]*);/);if(m)gone=eval(m[1]);}
const dups=new Set((()=>{try{return JSON.parse(fs.readFileSync(path.join(root,'duplicates.json'),'utf8'));}catch{return [];}})());
const afloat=p=>{if(!gone)return false;const [a,b,c,d]=p.bbox,ix=(c-a)*.25,iz=(d-b)*.25;return [[(a+c)/2,(b+d)/2],[a+ix,b+iz],[c-ix,b+iz],[a+ix,d-iz],[c-ix,d-iz]].filter(([x,z])=>inWaterPolygons(pack.water,x,z)).length>=4;};
// highest drawn surface per 1 m cell (walls seen edge-on: along their line, at their top)
const top=new Map(),key=(x,z)=>Math.floor(x)*1e6+Math.floor(z),raise=(k,y)=>{if(!(top.get(k)>=y))top.set(k,y);};
for(const t of idx.tiles){let raw=fs.readFileSync(path.join(root,t.file));if(raw[0]===31&&raw[1]===139)raw=zlib.gunzipSync(raw);
 const a=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength).slice(0));
 const parts=t.parts.filter(p=>!(gone&&gone.test(p.name||''))&&!dups.has(t.file+':'+p.start)&&!afloat(p)).map(p=>({...p}));liftBuildings(a,parts);
 for(const p of parts)for(let v=p.start;v+2<p.start+p.count;v+=3){const o=v*5,ax=a[o],ay=a[o+1],az=a[o+2],bx=a[o+5],by=a[o+6],bz=a[o+7],cx=a[o+10],cy=a[o+11],cz=a[o+12];
  if(Math.max(ay,by,cy)-Math.min(ay,by,cy)<=.8){const g=groundAt((ax+bx+cx)/3,(az+bz+cz)/3),y=(ay+by+cy)/3;if(y<=g+1.3&&y>=g-1.5)continue;} // main.js collapses it (a plinth)
  const d=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);
  if(Math.abs(d)<1e-6){const y=Math.max(ay,by,cy);for(const [px,pz,qx,qz] of [[ax,az,bx,bz],[bx,bz,cx,cz],[cx,cz,ax,az]]){const n=Math.ceil(Math.hypot(qx-px,qz-pz)*2)+1;for(let q=0;q<=n;q++)raise(key(px+(qx-px)*q/n,pz+(qz-pz)*q/n),y);}continue;}
  for(let i=Math.floor(Math.min(ax,bx,cx));i<=Math.floor(Math.max(ax,bx,cx));i++)for(let j=Math.floor(Math.min(az,bz,cz));j<=Math.floor(Math.max(az,bz,cz));j++){let best=-Infinity;
   for(const [ox,oz] of [[.5,.5],[.05,.05],[.95,.05],[.05,.95],[.95,.95]]){const px=i+ox-ax,pz=j+oz-az,s=(px*(cz-az)-pz*(cx-ax))/d,u=((bx-ax)*pz-(bz-az)*px)/d;if(s<-.02||u<-.02||s+u>1.02)continue;best=Math.max(best,ay+s*(by-ay)+u*(cy-ay));}
   if(best>-Infinity)raise(i*1e6+j,best);}}}
// main.js: kinds and small 1760 footprints that are never solid, and footprints it draws a plain house on
const bboxOf=r=>{let a=[Infinity,Infinity,-Infinity,-Infinity];for(const [x,z] of r)a=[Math.min(a[0],x),Math.min(a[1],z),Math.max(a[2],x),Math.max(a[3],z)];return a;};
const notSolid=b=>{const bb=b.bbox||bboxOf(b.rings[0]);return /^(roof|construction|carport|bridge)$/.test(b.kind||'')||city.endsWith('1760')&&(bb[2]-bb[0])*(bb[3]-bb[1])<60;};
const plainHouse=b=>{const bb=b.bbox||bboxOf(b.rings[0]);return b.cover!==undefined&&b.cover<.5&&!inWaterPolygons(pack.water,(bb[0]+bb[2])/2,(bb[1]+bb[3])/2);};
let cells=0,bareCells=0;const bare=[],removed=new Set();
for(const b of pack.buildings){if(notSolid(b)||plainHouse(b))continue;const bb=bboxOf(b.rings[0]);let n=0,open=0;
 for(let x=Math.floor(bb[0])+.5;x<bb[2];x++)for(let z=Math.floor(bb[1])+.5;z<bb[3];z++){if(!pointInPolygon(x,z,b.rings))continue;n++;const y=top.get(key(x,z));if(y===undefined||y<groundAt(x,z)+.5)open++;}
 cells+=n;bareCells+=open;if(open>=MIN&&open>=SHARE*n){bare.push({id:b.id,name:b.name||'',kind:b.kind||'',x:Math.round((bb[0]+bb[2])/2),z:Math.round((bb[1]+bb[3])/2),cells:n,bare:open});removed.add(b);}}
bare.sort((p,q)=>q.bare-p.bare);
if(write&&removed.size){pack.buildings=pack.buildings.filter(b=>!removed.has(b));fs.writeFileSync(path.join(root,'city.pack'),zlib.gzipSync(JSON.stringify(pack),{level:9}));console.error(`removed ${removed.size} footprints from ${root}/city.pack`);}
console.log(JSON.stringify({city,footprintCells:cells,bareCells,mostlyBare:bare.length,bareInThem:bare.reduce((s,o)=>s+o.bare,0),list:bare},null,0));
