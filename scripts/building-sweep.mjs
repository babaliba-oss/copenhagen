// Hollow-building sweep: finds buildings you can see into (walls missing) as the game shows them.
// For every part, points inside it under its roof, at half its wall height, shoot 8 horizontal rays; a ray that
// leaves for 80 m without crossing any building triangle (this part's or a neighbour's) means an open wall.
// Parts the era hides (GONE names in main.js for 1760) are left out, so walls they used to close show up.
// node scripts/building-sweep.mjs copenhagen-1760 [radius]  -> JSON summary to stdout
import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';
const city=process.argv[2]||'copenhagen-1760',R=+(process.argv[3]||1700),root=`public/cities/${city}`;
const idx=JSON.parse(fs.readFileSync(path.join(root,'buildings3d-index.json'),'utf8'));
let gone=null;if(city.endsWith('1760')){const src=fs.readFileSync('src/main.js','utf8'),m=src.match(/const GONE=(\/\^.*?\/[a-z]*);/);if(m)gone=eval(m[1]);}
const dups=new Set((()=>{try{return JSON.parse(fs.readFileSync(path.join(root,'duplicates.json'),'utf8'));}catch{return [];}})());
// triangles
const T=[];const parts=[];
for(const t of idx.tiles){const b=t.bbox;if(Math.hypot((b[0]+b[2])/2,(b[1]+b[3])/2)>R+200)continue;
 let raw=fs.readFileSync(path.join(root,t.file));if(raw[0]===31&&raw[1]===139)raw=zlib.gunzipSync(raw);
 const a=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));
 for(const p of t.parts){if(gone&&gone.test(p.name||''))continue;if(dups.has(t.file+':'+p.start))continue;
  const first=T.length/9;for(let v=p.start;v+2<p.start+p.count;v+=3)for(let k=0;k<3;k++)T.push(a[(v+k)*5],a[(v+k)*5+1],a[(v+k)*5+2]);
  parts.push({p,tile:t.file,t0:first,t1:T.length/9});}}
const N=T.length/9,C=4,grid=new Map(),ck=(i,j)=>i*100000+j;
for(let n=0;n<N;n++){const o=n*9;let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;for(let k=0;k<3;k++){x0=Math.min(x0,T[o+k*3]);x1=Math.max(x1,T[o+k*3]);z0=Math.min(z0,T[o+k*3+2]);z1=Math.max(z1,T[o+k*3+2]);}
 for(let i=Math.floor(x0/C);i<=Math.floor(x1/C);i++)for(let j=Math.floor(z0/C);j<=Math.floor(z1/C);j++){const k=ck(i,j);let l=grid.get(k);if(!l)grid.set(k,l=[]);l.push(n);}}
function hitT(ox,oy,oz,dx,dy,dz,n){const o=n*9,ax=T[o],ay=T[o+1],az=T[o+2],e1x=T[o+3]-ax,e1y=T[o+4]-ay,e1z=T[o+5]-az,e2x=T[o+6]-ax,e2y=T[o+7]-ay,e2z=T[o+8]-az;
 const px=dy*e2z-dz*e2y,py=dz*e2x-dx*e2z,pz=dx*e2y-dy*e2x,det=e1x*px+e1y*py+e1z*pz;if(Math.abs(det)<1e-9)return -1;const inv=1/det,tx=ox-ax,ty=oy-ay,tz=oz-az,u=(tx*px+ty*py+tz*pz)*inv;if(u<-1e-4||u>1+1e-4)return -1;
 const qx=ty*e1z-tz*e1y,qy=tz*e1x-tx*e1z,qz=tx*e1y-ty*e1x,v=(dx*qx+dy*qy+dz*qz)*inv;if(v<-1e-4||u+v>1+1e-4)return -1;const t=(e2x*qx+e2y*qy+e2z*qz)*inv;return t>1e-3?t:-1;}
function ray(ox,oy,oz,dx,dz,max){const seen=new Set();for(let s=0;s<=max;s+=C/2){const i=Math.floor((ox+dx*s)/C),j=Math.floor((oz+dz*s)/C),l=grid.get(ck(i,j));if(!l)continue;for(const n of l){if(seen.has(n))continue;seen.add(n);const t=hitT(ox,oy,oz,dx,0,dz,n);if(t>0&&t<=max)return t;}}return -1;}
function down(x,z,y,t0,t1){let best=-1;for(let n=t0;n<t1;n++){const t=hitT(x,y,z,0,-1,0,n);if(t>0&&(best<0||t<best))best=t;}return best;} // first surface of this part below y
const dirs=Array.from({length:8},(_,k)=>[Math.cos(k*Math.PI/4),Math.sin(k*Math.PI/4)]);
const out=[];
for(const {p,tile,t0,t1} of parts){const [x0,z0,x1,z1]=p.bbox,cx=(x0+x1)/2,cz=(z0+z1)/2;if(Math.hypot(cx,cz)>R)continue;
 let ymin=Infinity,ymax=-Infinity;for(let n=t0;n<t1;n++)for(let k=0;k<3;k++){const y=T[n*9+k*3+1];ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}
 if(!(ymax-ymin>2.5))continue;const step=Math.max(2,Math.min(6,Math.sqrt((x1-x0)*(z1-z0))/5));let tested=0,open=0,openDirs=0;const where=[];
 for(let x=x0+step/2;x<x1;x+=step)for(let z=z0+step/2;z<z1;z+=step){
  const r=down(x,z,ymax+5,t0,t1);if(r<0)continue;const top=ymax+5-r;if(top-ymin<2.5)continue; // not under this part's roof
  const y=ymin+(top-ymin)*.45;tested++;let esc=0;for(const [dx,dz] of dirs)if(ray(x,y,z,dx,dz,80)<0)esc++;
  if(esc>=2){open++;openDirs+=esc;if(where.length<3)where.push([+x.toFixed(1),+z.toFixed(1)]);}}
 if(tested)out.push({id:p.id,name:p.name||'',tile,start:p.start,x:+cx.toFixed(1),z:+cz.toFixed(1),h:+(ymax-ymin).toFixed(1),tested,open,share:+(open/tested).toFixed(2),where});}
const bad=out.filter(o=>o.open>=2&&o.share>=.15).sort((a,b)=>b.share*Math.sqrt(b.open)-a.share*Math.sqrt(a.open));
console.log(JSON.stringify({city,checked:out.length,hollow:bad.length,list:bad},null,0));
