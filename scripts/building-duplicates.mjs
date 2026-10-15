#!/usr/bin/env node
// The municipal model sometimes carries a building twice: an OpenStreetMap-matched part and a bare block with
// the same walls. Both drawn, the coplanar walls z-fight into two-tone triangles. Bounding boxes can't tell a
// copy from a part that holds a building's other walls, so this compares the actual triangles: a part is a copy
// when at least 85 % of its surface lies within 0.5 m of another part's surface (and that other part is not
// itself mostly covered by it, else the smaller / unnamed of the two goes). A crude stand-in of a few triangles
// lying within 2 m of a detailed part's walls goes too.
// Writes public/cities/<city>/duplicates.json: ["<tile file>:<vertex start>", ...].   node scripts/building-duplicates.mjs copenhagen
import fs from 'node:fs';import zlib from 'node:zlib';
const city=process.argv[2]||'copenhagen',dir=`public/cities/${city}`;
const index=JSON.parse(fs.readFileSync(`${dir}/buildings3d-index.json`));
const read=f=>{let b=fs.readFileSync(`${dir}/${f}`);if(b[0]===31&&b[1]===139)b=zlib.gunzipSync(b);return new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const parts=[];for(const t of index.tiles){const a=read(t.file);for(const p of t.parts){const tri=[];p.key=t.file+':'+p.start;for(let v=p.start;v+2<p.start+p.count;v+=3){const o=v*5;tri.push([a[o],a[o+1],a[o+2],a[o+5],a[o+6],a[o+7],a[o+10],a[o+11],a[o+12]]);}parts.push({p,tri});}}
// point–triangle distance (Ericson, Real-Time Collision Detection 5.1.5)
function dist2(px,py,pz,t){const [ax,ay,az,bx,by,bz,cx,cy,cz]=t;
 const abx=bx-ax,aby=by-ay,abz=bz-az,acx=cx-ax,acy=cy-ay,acz=cz-az,apx=px-ax,apy=py-ay,apz=pz-az;
 const d1=abx*apx+aby*apy+abz*apz,d2=acx*apx+acy*apy+acz*apz;let qx,qy,qz;
 if(d1<=0&&d2<=0){qx=ax;qy=ay;qz=az;}else{
 const bpx=px-bx,bpy=py-by,bpz=pz-bz,d3=abx*bpx+aby*bpy+abz*bpz,d4=acx*bpx+acy*bpy+acz*bpz;
 if(d3>=0&&d4<=d3){qx=bx;qy=by;qz=bz;}else{const vc=d1*d4-d3*d2;
 if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);qx=ax+v*abx;qy=ay+v*aby;qz=az+v*abz;}else{
 const cpx=px-cx,cpy=py-cy,cpz=pz-cz,d5=abx*cpx+aby*cpy+abz*cpz,d6=acx*cpx+acy*cpy+acz*cpz;
 if(d6>=0&&d5<=d6){qx=cx;qy=cy;qz=cz;}else{const vb=d5*d2-d1*d6;
 if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6);qx=ax+w*acx;qy=ay+w*acy;qz=az+w*acz;}else{const va=d3*d6-d5*d4;
 if(va<=0&&d4-d3>=0&&d5-d6>=0){const w=(d4-d3)/((d4-d3)+(d5-d6));qx=bx+w*(cx-bx);qy=by+w*(cy-by);qz=bz+w*(cz-bz);}else{
 const den=1/(va+vb+vc),v=vb*den,w=vc*den;qx=ax+abx*v+acx*w;qy=ay+aby*v+acy*w;qz=az+abz*v+acz*w;}}}}}}
 return (px-qx)**2+(py-qy)**2+(pz-qz)**2;}
const area=t=>{const ux=t[3]-t[0],uy=t[4]-t[1],uz=t[5]-t[2],vx=t[6]-t[0],vy=t[7]-t[1],vz=t[8]-t[2];return Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/2;};
// sample points: centroid plus the three edge midpoints pulled 25 % toward it, area-weighted
const samples=t=>{const c=[(t[0]+t[3]+t[6])/3,(t[1]+t[4]+t[7])/3,(t[2]+t[5]+t[8])/3],out=[c];for(const [i,j] of [[0,3],[3,6],[6,0]])out.push([.75*(t[i]+t[j])/2+.25*c[0],.75*(t[i+1]+t[j+1])/2+.25*c[1],.75*(t[i+2]+t[j+2])/2+.25*c[2]]);return out;};
function coverage(A,B,lim=.25){ // share of A's area within 0.5 m of B
 const cell=4,grid=new Map();B.tri.forEach((t,i)=>{const x0=Math.floor(Math.min(t[0],t[3],t[6])/cell),x1=Math.floor(Math.max(t[0],t[3],t[6])/cell),z0=Math.floor(Math.min(t[2],t[5],t[8])/cell),z1=Math.floor(Math.max(t[2],t[5],t[8])/cell);
  if((x1-x0+1)*(z1-z0+1)>400)return;for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const k=x*100003+z;let l=grid.get(k);if(!l)grid.set(k,l=[]);l.push(i);}});
 let tot=0,cov=0;for(const t of A.tri){const a=area(t);if(a<1e-4)continue;tot+=a;let hit=0;const s=samples(t);
  for(const [px,py,pz] of s){const k=Math.floor(px/cell)*100003+Math.floor(pz/cell);const l=grid.get(k)||[];let ok=false;for(const i of l)if(dist2(px,py,pz,B.tri[i])<lim){ok=true;break;}if(ok)hit++;}
  cov+=a*hit/s.length;}
 return tot?cov/tot:0;}
// candidates: bounding boxes overlapping by at least half of the smaller one
const grid=new Map(),C=50;parts.forEach((q,i)=>{const b=q.p.bbox;for(let x=Math.floor(b[0]/C);x<=Math.floor(b[2]/C);x++)for(let z=Math.floor(b[1]/C);z<=Math.floor(b[3]/C);z++){const k=x+','+z;if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);}});
const ar=b=>Math.max(0,b[2]-b[0])*Math.max(0,b[3]-b[1]),drop=new Set();let pairs=0;
const seen=new Set();
for(const list of grid.values())for(let x=0;x<list.length;x++)for(let y=x+1;y<list.length;y++){const i=list[x],j=list[y],key=i<j?i+':'+j:j+':'+i;if(seen.has(key))continue;seen.add(key);
 const A=parts[i],B=parts[j],a=A.p.bbox,b=B.p.bbox,both=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
 if(both<.5*Math.min(ar(a),ar(b)))continue;pairs++;
 const ab=coverage(A,B),ba=coverage(B,A);let loser=null;
 if(ab>=.85&&ba>=.85)loser=(!!A.p.name!==!!B.p.name)?(A.p.name?B:A):(A.tri.length<B.tri.length?A:B);else if(ab>=.85)loser=A;else if(ba>=.85)loser=B;
 else{ // a crude stand-in (a few triangles) sitting within 2 m of a detailed part's walls: the same building, roughly
  const [c,d]=A.tri.length<B.tri.length?[A,B]:[B,A];if(c.tri.length<=40&&c.tri.length*4<=d.tri.length&&coverage(c,d,4)>=.7)loser=c;}
 if(loser)drop.add(loser.p.key);}
fs.writeFileSync(`${dir}/duplicates.json`,JSON.stringify([...drop]));
console.log(city,'pairs checked',pairs,'copies',drop.size);
if(process.env.PAIR){const [x,y]=process.env.PAIR.split(',');const A=parts.find(q=>q.p.id===x),B=parts.find(q=>q.p.id===y);for(const lim of [.25,1,4])console.log(x,'by',y,lim,coverage(A,B,lim).toFixed(2),'|',y,'by',x,coverage(B,A,lim).toFixed(2),A.tri.length,B.tri.length);}
