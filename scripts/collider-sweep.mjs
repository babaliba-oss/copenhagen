// Collider sweep: walls you hit but cannot see, and houses you can drive through.
// Building colliders are the city's footprints (city.pack buildings, world.buildings in the game); what you see is the
// house model (buildings3d tiles, minus the parts an era hides). The two come from different sources, so they can
// disagree: a footprint whose house is hidden or was never built is an invisible wall; a house with no footprint
// under it lets the car drive through its walls.
// node scripts/collider-sweep.mjs copenhagen-1760 [min m²] -> JSON to stdout: {invisible:[...], unblocked:[...]}
import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';
import {SpatialIndex,pointInPolygon,inWaterPolygons} from '../src/geo.js';
const city=process.argv[2]||'copenhagen-1760',MIN=+(process.argv[3]||12),root=`public/cities/${city}`;
const idx=JSON.parse(fs.readFileSync(path.join(root,'buildings3d-index.json'),'utf8'));
const pack=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'city.pack'))));
let gone=null;if(city.endsWith('1760')){const src=fs.readFileSync('src/main.js','utf8'),m=src.match(/const GONE=(\/\^.*?\/[a-z]*);/);if(m)gone=eval(m[1]);}
const dups=new Set((()=>{try{return JSON.parse(fs.readFileSync(path.join(root,'duplicates.json'),'utf8'));}catch{return [];}})());
// main.js: in 1760 a part with 4 of 5 points of its box on mapped water (boats, pontoons drawn as buildings) is hidden
const afloat=p=>{if(!gone)return false;const [a,b,c,d]=p.bbox,ix=(c-a)*.25,iz=(d-b)*.25;return [[(a+c)/2,(b+d)/2],[a+ix,b+iz],[c-ix,b+iz],[a+ix,d-iz],[c-ix,d-iz]].filter(([x,z])=>inWaterPolygons(pack.water,x,z)).length>=4;};
// what you see: every visible triangle's plan, rasterised on a 1 m grid (a cell any triangle touches counts)
let B=[Infinity,Infinity,-Infinity,-Infinity];for(const t of idx.tiles){B=[Math.min(B[0],t.bbox[0]),Math.min(B[1],t.bbox[1]),Math.max(B[2],t.bbox[2]),Math.max(B[3],t.bbox[3])];}
for(const b of pack.buildings)for(const [x,z] of b.rings[0]){B=[Math.min(B[0],x),Math.min(B[1],z),Math.max(B[2],x),Math.max(B[3],z)];}
const W=Math.ceil(B[2]-B[0])+2,H=Math.ceil(B[3]-B[1])+2,seen=new Int32Array(W*H).fill(-1),partsById=[];
for(const t of idx.tiles){let raw=fs.readFileSync(path.join(root,t.file));if(raw[0]===31&&raw[1]===139)raw=zlib.gunzipSync(raw);
 const a=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
 for(const p of t.parts){if(gone&&gone.test(p.name||''))continue;if(dups.has(t.file+':'+p.start))continue;if(afloat(p))continue;const id=partsById.push(p)-1;
  for(let v=p.start;v+2<p.start+p.count;v+=3){const ax=a[v*5],az=a[v*5+2],bx=a[(v+1)*5],bz=a[(v+1)*5+2],cx=a[(v+2)*5],cz=a[(v+2)*5+2];
   const d=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);
   if(Math.abs(d)<1e-3){for(const [ux,uz,vx,vz] of [[ax,az,bx,bz],[bx,bz,cx,cz],[cx,cz,ax,az]]){const n=Math.ceil(Math.hypot(vx-ux,vz-uz)*2)+1; // a wall seen edge-on: the cells along its line
     for(let q=0;q<=n;q++){const i=Math.floor(ux+(vx-ux)*q/n-B[0]),j=Math.floor(uz+(vz-uz)*q/n-B[1]);if(i>=0&&j>=0&&i<W&&j<H&&seen[j*W+i]<0)seen[j*W+i]=id;}}continue;}
   for(let i=Math.floor(Math.min(ax,bx,cx)-B[0]);i<=Math.floor(Math.max(ax,bx,cx)-B[0]);i++)for(let j=Math.floor(Math.min(az,bz,cz)-B[1]);j<=Math.floor(Math.max(az,bz,cz)-B[1]);j++){
    const k=j*W+i;if(seen[k]>=0)continue;
    for(const [ox,oz] of [[.5,.5],[.05,.05],[.95,.05],[.05,.95],[.95,.95]]){const px=B[0]+i+ox-ax,pz=B[1]+j+oz-az,s=((cx-ax)*pz-(cz-az)*px)/-d,u=((bx-ax)*pz-(bz-az)*px)/d;if(s<-.05||u<-.05||s+u>1.05)continue;seen[k]=id;break;}}}}}
const cell=(x,z)=>{const i=Math.floor(x-B[0]),j=Math.floor(z-B[1]);return i<0||j<0||i>=W||j>=H?-1:seen[j*W+i];};
const inside=(rings,x,z)=>pointInPolygon(x,z,rings); // courtyards (inner rings) are open, as in the game
// footprints with no house over most of them
const invisible=[];
for(const b of pack.buildings){const r=b.rings[0];let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;for(const [x,z] of r){x0=Math.min(x0,x);z0=Math.min(z0,z);x1=Math.max(x1,x);z1=Math.max(z1,z);}
 if(b.cover!==undefined&&b.cover<.5&&!/^(roof|construction|carport|bridge)$/.test(b.kind||''))continue; // main.js draws a plain house on a footprint the model does not cover
 let area=0,bare=0;const near=new Set();for(let x=Math.floor(x0)+.5;x<x1;x++)for(let z=Math.floor(z0)+.5;z<z1;z++){if(!inside(b.rings,x,z))continue;area++;const s=cell(x,z);if(s<0)bare++;else near.add(s);}
 if(bare>=MIN&&bare>.35*area)invisible.push({name:b.name||'',kind:b.kind||'',x:Math.round((x0+x1)/2),z:Math.round((z0+z1)/2),area,bare,parts:[...near].slice(0,4).map(i=>partsById[i].name||partsById[i].id)});}
// houses with no footprint under most of them
const foot=new SpatialIndex(pack.buildings),unblocked=[];
for(const p of partsById){const [x0,z0,x1,z1]=p.bbox;if((x1-x0)*(z1-z0)<MIN||p.embankment)continue; /* earthworks are walkable */let n=0,open=0;
 for(let x=Math.floor(x0)+.5;x<x1;x++)for(let z=Math.floor(z0)+.5;z<z1;z++){if(cell(x,z)<0)continue;n++;if(!foot.at(x,z))open++;}
 if(open>=Math.max(MIN,25)&&open>.5*n&&(p.height||0)>2)unblocked.push({id:p.id,name:p.name||'',x:Math.round((x0+x1)/2),z:Math.round((z0+z1)/2),cells:n,open,height:p.height});}
invisible.sort((a,b)=>b.bare-a.bare);unblocked.sort((a,b)=>b.open-a.open);
console.log(JSON.stringify({city,footprints:pack.buildings.length,parts:partsById.length,invisible,unblocked},null,1));
