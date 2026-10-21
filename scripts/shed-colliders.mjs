#!/usr/bin/env node
// Small houses you drive through (1760). scripts/fit-colliders.py gives a visible house with no footprint under it one of its
// own only when 20 m² of it are left (pulled in 0.3 m, minus the footprints and roads), so the sheds, privies, booths and
// pillars the model draws, and those whose mapped footprint fit-colliders removed (cover < .5: the shed drawn beside it),
// stood with no collision: the coach and the walkers passed through their walls.
// This finds the parts the game draws (main.js's 1760 filters: GONE names, HIDE_1760, era.json anachronisms, duplicates,
// OpenStreetMap boxes inside the model's own house, boxes in the water or on the carriageway) standing at least 1.5 m, with
// 70 % of their roof plan on no footprint, and adds a footprint for each: the plan's convex hull pulled in 0.3 m (0.15 m
// under 4 m²), `kind: 'model'`, cover 1 (main.js keeps small footprints with cover >= .5 solid).
//   node scripts/shed-colliders.mjs copenhagen-1760 [--write]
import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';
import {decodeTerrain,setTerrain,groundAt,liftBuildings} from '../src/terrain.js';
import {SpatialIndex,inWaterPolygons,bounds} from '../src/geo.js';
import {isRampart} from '../src/ramparts.js';
import {HIDE_1760} from '../src/copenhagen/landmarks.js';
const city=process.argv[2]||'copenhagen-1760',write=process.argv.includes('--write'),root=`public/cities/${city}`;
const idx=JSON.parse(fs.readFileSync(path.join(root,'buildings3d-index.json'),'utf8'));
const pack=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'city.pack'))));
{let tb=fs.readFileSync(path.join(root,'terrain.pack'));if(tb[0]===31)tb=zlib.gunzipSync(tb);setTerrain(decodeTerrain(tb.buffer.slice(tb.byteOffset,tb.byteOffset+tb.byteLength)));}
const GONE=eval(fs.readFileSync('src/main.js','utf8').match(/const GONE=(\/\^.*?\/[a-z]*);/)[1]);
const dups=new Set(JSON.parse(fs.readFileSync(path.join(root,'duplicates.json'),'utf8'))),late=new Set(JSON.parse(fs.readFileSync(path.join(root,'era.json'),'utf8')).anachronisms||[]);
const hidden=new Set(HIDE_1760),kind=new Map(pack.buildings.map(b=>[b.id,b.kind])),lanes=new SpatialIndex(pack.roads.filter(r=>/^Ajorata/.test(r.kind||'')));
const kk=new Map();for(const t of idx.tiles)for(const p of t.parts)if(p.id.startsWith('kk-osm-'))kk.set(p.id.slice(3),p.bbox);
const wetBox=([a,b,c,d])=>{const ix=(c-a)*.25,iz=(d-b)*.25;return [[(a+c)/2,(b+d)/2],[a+ix,b+iz],[c-ix,b+iz],[a+ix,d-iz],[c-ix,d-iz]].filter(([x,z])=>inWaterPolygons(pack.water,x,z)).length>=4;};
const drawnPart=(t,p)=>{if(dups.has(t.file+':'+p.start)||late.has(p.id)||hidden.has(p.id)||p.name&&GONE.test(p.name)||p.embankment||/vold|bastion|batteri|skanse|krudt/i.test(p.name||'')||wetBox(p.bbox))return false;
 const b=kk.get(p.id),a=p.bbox;if(b&&Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]))/Math.max(1e-6,(a[2]-a[0])*(a[3]-a[1]))>=.5)return false; // an OpenStreetMap box inside the model's house
 if(p.name)return true;const [x0,z0,x1,z1]=a,st=Math.max(.5,Math.min(x1-x0,z1-z0)/6);let s=0,r=0;for(let x=x0+st/2;x<x1;x+=st)for(let z=z0+st/2;z<z1;z+=st){s++;if(lanes.at(x,z))r++;}
 return !(/^(bridge|elevator)$/.test(kind.get(p.id.replace(/^kk-/,''))||'')||s&&r/s>=.85);}; // main.js: skyways, lifts and boxes on the carriageway
const undrawn=b=>{const bb=b.bbox??=bounds(b.rings);return /^(roof|construction|carport|bridge)$/.test(b.kind||'')||(bb[2]-bb[0])*(bb[3]-bb[1])<60&&!(b.cover>=.5)||isRampart(b)||hidden.has('kk-'+b.id)||hidden.has(b.id);};
const solid=new SpatialIndex(pack.buildings.filter(b=>!undrawn(b)));
const hull=pts=>{pts=pts.slice().sort((p,q)=>p[0]-q[0]||p[1]-q[1]);const cr=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]),lo=[],up=[];
 for(const p of pts){while(lo.length>1&&cr(lo[lo.length-2],lo[lo.length-1],p)<=1e-9)lo.pop();lo.push(p);}for(const p of pts.reverse()){while(up.length>1&&cr(up[up.length-2],up[up.length-1],p)<=1e-9)up.pop();up.push(p);}
 return lo.slice(0,-1).concat(up.slice(0,-1));}; // counter-clockwise in x,z
const inset=(h,d)=>{const n=h.length,L=[];for(let i=0;i<n;i++){const a=h[i],b=h[(i+1)%n],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);if(l<1e-6)return null;const nx=-dz/l,nz=dx/l;L.push([a[0]+nx*d,a[1]+nz*d,dx,dz]);}
 const out=[];for(let i=0;i<n;i++){const [px,pz,ux,uz]=L[(i+n-1)%n],[qx,qz,vx,vz]=L[i],den=ux*vz-uz*vx;if(Math.abs(den)<1e-9)continue;const t=((qx-px)*vz-(qz-pz)*vx)/den;out.push([px+ux*t,pz+uz*t]);}
 const area=out.reduce((s,p,i)=>{const q=out[(i+1)%out.length];return s+p[0]*q[1]-q[0]*p[1];},0)/2;return out.length>=3&&area>.1?out:null;};
const added=[];let m2=0;
for(const t of idx.tiles){let raw=fs.readFileSync(path.join(root,t.file));if(raw[0]===31&&raw[1]===139)raw=zlib.gunzipSync(raw);
 const a=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength).slice(0)),parts=t.parts.filter(p=>drawnPart(t,p)).map(p=>({...p}));liftBuildings(a,parts);
 for(const p of parts){let y0=Infinity,y1=-Infinity;for(let v=p.start;v<p.start+p.count;v++){y0=Math.min(y0,a[v*5+1]);y1=Math.max(y1,a[v*5+1]);}
  const [bx0,bz0,bx1,bz1]=p.bbox;if(y1-Math.max(y0,groundAt((bx0+bx1)/2,(bz0+bz1)/2))<1.5)continue;
  const tris=[],pts=[];for(let v=p.start;v+2<p.start+p.count;v+=3){const o=v*5,ax=a[o],az=a[o+2],bx=a[o+5],bz=a[o+7],cx=a[o+10],cz=a[o+12],d=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);if(Math.abs(d)<1e-4)continue;tris.push([ax,az,bx,bz,cx,cz,d]);pts.push([ax,az],[bx,bz],[cx,cz]);}
  if(!tris.length)continue;
  const inPlan=(x,z)=>tris.some(([ax,az,bx,bz,cx,cz,d])=>{const px=x-ax,pz=z-az,s=(px*(cz-az)-pz*(cx-ax))/d,u=((bx-ax)*pz-(bz-az)*px)/d;return s>=0&&u>=0&&s+u<=1;});
  const st=.5;let n=0,free=0;for(let x=bx0+st/2;x<bx1;x+=st)for(let z=bz0+st/2;z<bz1;z+=st){if(!inPlan(x,z))continue;n++;if(!solid.at(x,z)&&!inWaterPolygons(pack.water,x,z))free++;}
  if(!n||free<.7*n)continue;
  const h=hull(pts),area=h.reduce((s,q,i)=>{const r=h[(i+1)%h.length];return s+q[0]*r[1]-r[0]*q[1];},0)/2,ring=inset(h,area<4?.15:.3);if(!ring)continue;
  const rings=[ring.map(([x,z])=>[+x.toFixed(2),+z.toFixed(2)])],bb=bounds(rings);m2+=free*st*st;
  added.push({id:`model-${p.id}-s`,name:'',address:'',rings,bbox:bb.map(v=>+v.toFixed(2)),kind:'model',material:'',height:+(p.height||10).toFixed(2),cover:1});}}
const before=pack.buildings.length;pack.buildings=pack.buildings.filter(b=>!/^model-.*-s$/.test(b.id)).concat(added); // re-runs replace their own
if(write)fs.writeFileSync(path.join(root,'city.pack'),zlib.gzipSync(JSON.stringify(pack),{level:9}));
console.log(JSON.stringify({city,drawnPartsWithNoFootprint:added.length,m2:Math.round(m2),footprints:[before,pack.buildings.length],written:write,list:added.map(b=>b.id)}));
