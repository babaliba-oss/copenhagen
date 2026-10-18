// Hollow-building sweep: finds buildings you can see into (walls missing) as the game shows them.
// For every part, points inside it under its roof, at half its wall height, shoot 8 horizontal rays; a ray that reaches
// the street (open sky joined to the map edge) without crossing a building triangle means an open wall you can see through.
// (A fixed 80 m reach read every hall longer than 80 m as open and let a house 50 m away hide a real hole; a ray may
// pass from one house into the next, since a block's houses share their party walls only in plan.)
// Parts the era hides (GONE names in main.js for 1760) are left out, so walls they used to close show up.
// Houses stand where the game puts them (relative parts lifted onto the terrain like liftBuildings) and a ray that runs
// into the ground counts as blocked, so a house on a slope is not reported for its uphill walls.
// node scripts/building-sweep.mjs copenhagen-1760 [radius] [data dir] [--hide]  -> JSON summary to stdout
import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';
import {decodeTerrain,setTerrain,groundAt,liftBuildings} from '../src/terrain.js';
const args=process.argv.slice(2).filter(a=>!a.startsWith('--')),city=args[0]||'copenhagen-1760',R=+(args[1]||1700),root=args[2]||`public/cities/${city}`;
const idx=JSON.parse(fs.readFileSync(path.join(root,'buildings3d-index.json'),'utf8'));
{let tb=fs.readFileSync(`public/cities/${city}/terrain.pack`);if(tb[0]===31)tb=zlib.gunzipSync(tb);setTerrain(decodeTerrain(tb.buffer.slice(tb.byteOffset,tb.byteOffset+tb.byteLength)));}
let gone=null;if(city.endsWith('1760')){const src=fs.readFileSync('src/main.js','utf8'),m=src.match(/const GONE=(\/\^.*?\/[a-z]*);/);if(m)gone=eval(m[1]);}
const dups=new Set((()=>{try{return JSON.parse(fs.readFileSync(path.join(root,'duplicates.json'),'utf8'));}catch{return [];}})());
// triangles
const T=[];const parts=[];
for(const t of idx.tiles){const b=t.bbox;if(Math.hypot((b[0]+b[2])/2,(b[1]+b[3])/2)>R+200)continue;
 let raw=fs.readFileSync(path.join(root,t.file));if(raw[0]===31&&raw[1]===139)raw=zlib.gunzipSync(raw);
 const a=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));liftBuildings(a,t.parts.map(p=>({...p})));
 for(const p of t.parts){if(gone&&gone.test(p.name||''))continue;if(dups.has(t.file+':'+p.start))continue;
  const first=T.length/9;for(let v=p.start;v+2<p.start+p.count;v+=3)for(let k=0;k<3;k++)T.push(a[(v+k)*5],a[(v+k)*5+1],a[(v+k)*5+2]);
  parts.push({p,tile:t.file,t0:first,t1:T.length/9});}}
const N=T.length/9,C=4,grid=new Map(),ck=(i,j)=>i*100000+j;
for(let n=0;n<N;n++){const o=n*9;let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;for(let k=0;k<3;k++){x0=Math.min(x0,T[o+k*3]);x1=Math.max(x1,T[o+k*3]);z0=Math.min(z0,T[o+k*3+2]);z1=Math.max(z1,T[o+k*3+2]);}
 for(let i=Math.floor(x0/C);i<=Math.floor(x1/C);i++)for(let j=Math.floor(z0/C);j<=Math.floor(z1/C);j++){const k=ck(i,j);let l=grid.get(k);if(!l)grid.set(k,l=[]);l.push(n);}}
function hitT(ox,oy,oz,dx,dy,dz,n){const o=n*9,ax=T[o],ay=T[o+1],az=T[o+2],e1x=T[o+3]-ax,e1y=T[o+4]-ay,e1z=T[o+5]-az,e2x=T[o+6]-ax,e2y=T[o+7]-ay,e2z=T[o+8]-az;
 const px=dy*e2z-dz*e2y,py=dz*e2x-dx*e2z,pz=dx*e2y-dy*e2x,det=e1x*px+e1y*py+e1z*pz;if(Math.abs(det)<1e-9)return -1;const inv=1/det,tx=ox-ax,ty=oy-ay,tz=oz-az,u=(tx*px+ty*py+tz*pz)*inv;if(u<-1e-4||u>1+1e-4)return -1;
 const qx=ty*e1z-tz*e1y,qy=tz*e1x-tx*e1z,qz=tx*e1y-ty*e1x,v=(dx*qx+dy*qy+dz*qz)*inv;if(v<-1e-4||u+v>1+1e-4)return -1;const t=(e2x*qx+e2y*qy+e2z*qz)*inv;return t>1e-3?t:-1;}
// roof cover: the highest roof (of any house) over each 1 m cell
const CB=[Infinity,Infinity,-Infinity,-Infinity];for(const {p} of parts){const b=p.bbox;CB[0]=Math.min(CB[0],b[0]);CB[1]=Math.min(CB[1],b[1]);CB[2]=Math.max(CB[2],b[2]);CB[3]=Math.max(CB[3],b[3]);}
const SAMPLE=[[.5,.5],[.02,.02],[.98,.02],[.02,.98],[.98,.98]]; // a cell any roof touches counts as covered (no cracks between triangles)
const CW=Math.ceil(CB[2]-CB[0])+2,CH=Math.ceil(CB[3]-CB[1])+2,cover=new Float32Array(CW*CH).fill(-1e9);
for(let n=0;n<N;n++){const o=n*9,ax=T[o],ay=T[o+1],az=T[o+2],bx=T[o+3],by=T[o+4],bz=T[o+5],cx=T[o+6],cy=T[o+7],cz=T[o+8];
 const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az,nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz);if(!(l>1e-9)||Math.abs(ny/l)<.3)continue;
 const d=ux*vz-uz*vx;if(Math.abs(d)<1e-9)continue;
 for(let i=Math.floor(Math.min(ax,bx,cx)-CB[0]);i<=Math.floor(Math.max(ax,bx,cx)-CB[0]);i++)for(let j=Math.floor(Math.min(az,bz,cz)-CB[1]);j<=Math.floor(Math.max(az,bz,cz)-CB[1]);j++){
  const k=j*CW+i;for(const [ox,oz] of SAMPLE){const px=CB[0]+i+ox-ax,pz=CB[1]+j+oz-az,s1=(px*vz-pz*vx)/d,s2=(ux*pz-uz*px)/d;if(s1<-.02||s2<-.02||s1+s2>1.02)continue;
   const y=ay+s1*uy+s2*vy;if(y>cover[k])cover[k]=y;}}}
const roofAbove=(x,z)=>{const i=Math.floor(x-CB[0]),j=Math.floor(z-CB[1]);return i<0||j<0||i>=CW||j>=CH?-1e9:cover[j*CW+i];};
// street air: cells with no roof over head height that connect to the edge of the map. A roof hole, a light well or a
// shut courtyard is open sky too, but nobody in the street sees into a house through it, so a ray must reach street air.
const street=new Uint8Array(CW*CH);{const q=new Int32Array(CW*CH);let h=0,t=0;
 const open=k=>cover[k]<groundAt(CB[0]+k%CW+.5,CB[1]+Math.floor(k/CW)+.5)+2.2;
 const push=k=>{if(!street[k]&&open(k)){street[k]=1;q[t++]=k;}};
 for(let i=0;i<CW;i++){push(i);push((CH-1)*CW+i);}for(let j=0;j<CH;j++){push(j*CW);push(j*CW+CW-1);}
 while(h<t){const k=q[h++],i=k%CW;if(i>0)push(k-1);if(i<CW-1)push(k+1);if(k>=CW)push(k-CW);if(k<CW*(CH-1))push(k+CW);}}
const inStreet=(x,z)=>{const i=Math.floor(x-CB[0]),j=Math.floor(z-CB[1]);return i<0||j<0||i>=CW||j>=CH||street[j*CW+i]===1;};
// distance to the first wall, or -1 when the ray gets out into the street without crossing one (ground blocks it)
function ray(ox,oy,oz,dx,dz){const seen=new Set();let hit=Infinity,air=0;
 const look=s=>{const l=grid.get(ck(Math.floor((ox+dx*s)/C),Math.floor((oz+dz*s)/C)));if(l)for(const n of l){if(seen.has(n))continue;seen.add(n);const t=hitT(ox,oy,oz,dx,0,dz,n);if(t>0&&t<hit)hit=t;}};
 for(let s=0;s<=400;s+=1){for(let f=0;f<=1;f+=.25)look(s+f);if(hit<=s+1)return hit;if(s>0&&groundAt(ox+dx*s,oz+dz*s)>oy)return s;
  const x=ox+dx*(s+.5),z=oz+dz*(s+.5);air=roofAbove(x,z)<oy+.3&&inStreet(x,z)?air+1:0;if(air>=3)return -1;} // 3 m out in the street
 return -1;}
function down(x,z,y,t0,t1){let best=-1;for(let n=t0;n<t1;n++){const t=hitT(x,y,z,0,-1,0,n);if(t>0&&(best<0||t<best))best=t;}return best;} // first surface of this part below y
const dirs=Array.from({length:8},(_,k)=>[Math.cos(k*Math.PI/4),Math.sin(k*Math.PI/4)]);
const out=[];
for(const {p,tile,t0,t1} of parts){const [x0,z0,x1,z1]=p.bbox,cx=(x0+x1)/2,cz=(z0+z1)/2;if(Math.hypot(cx,cz)>R)continue;
 let ymin=Infinity,ymax=-Infinity;for(let n=t0;n<t1;n++)for(let k=0;k<3;k++){const y=T[n*9+k*3+1];ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}
 if(!(ymax-ymin>2.5))continue;const step=Math.max(2,Math.min(6,Math.sqrt((x1-x0)*(z1-z0))/5));let tested=0,open=0,openDirs=0;const where=[];
 for(let x=x0+step/2;x<x1;x+=step)for(let z=z0+step/2;z<z1;z+=step){
  const r=down(x,z,ymax+5,t0,t1);if(r<0)continue;const top=ymax+5-r;if(top-ymin<2.5)continue; // not under this part's roof
  const gr=groundAt(x,z),foot=Math.max(ymin,gr);if(top-foot<2.5)continue;const y=foot+(top-foot)*.45;tested++;let esc=0;for(const [dx,dz] of dirs)if(ray(x,y,z,dx,dz)<0)esc++;
  if(esc>=2){open++;openDirs+=esc;if(where.length<3)where.push([+x.toFixed(1),+z.toFixed(1)]);}}
 if(tested)out.push({id:p.id,name:p.name||'',tile,start:p.start,x:+cx.toFixed(1),z:+cz.toFixed(1),h:+(ymax-ymin).toFixed(1),tested,open,share:+(open/tested).toFixed(2),where});}
const bad=out.filter(o=>o.open>=2&&o.share>=.15).sort((a,b)=>b.share*Math.sqrt(b.open)-a.share*Math.sqrt(a.open));
// --hide (1760): shells you see straight through (most rays out from under the roof reach the street) are the unnamed
// pieces of today's buildings the era's name filter missed (the Black Diamond's and the National Bank's annexes): they join
// duplicates.json and the game leaves them out. Run before scripts/fit-colliders.py, which then gives them no footprint.
if(process.argv.includes('--hide')&&city.endsWith('1760')){const shells=bad.filter(o=>o.share>=.7&&o.tested>=4).map(o=>`${o.tile}:${o.start}`);
 fs.writeFileSync(path.join(root,'duplicates.json'),JSON.stringify([...new Set([...dups,...shells])].sort()));console.error(`${shells.length} shells added to duplicates.json`);}
console.log(JSON.stringify({city,checked:out.length,hollow:bad.length,list:bad},null,0));
