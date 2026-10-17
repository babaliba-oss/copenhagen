// Close hollow buildings: walls whose lower edge hangs in the air (the storeys below were a separate part in the
// municipal model that this era's build left out, or never modelled) get a wall strip down to the first surface
// below them, or the part's base. Rewrites the tile packs and the index (part starts shift), and remaps the
// file:start keys in duplicates.json, insets.json and recolour.json. Run per city:
//   node scripts/building-skirts.mjs copenhagen-1760 [--dry]
import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';
const city=process.argv[2],dry=process.argv.includes('--dry'),root=`public/cities/${city}`;
const idxFile=path.join(root,'buildings3d-index.json'),idx=JSON.parse(fs.readFileSync(idxFile,'utf8'));
const read=f=>{let r=fs.readFileSync(path.join(root,f));const gz=r[0]===31&&r[1]===139;if(gz)r=zlib.gunzipSync(r);return {a:new Float32Array(r.buffer.slice(r.byteOffset,r.byteOffset+r.byteLength)),gz};};
// all wall/surface triangles of all tiles, in a 4 m grid, for "is there something below / beside" queries
// streets and squares that run under buildings (passages, arcades): never closed
const cityPack=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'city.pack'))));
const open=[...cityPack.roads,...cityPack.pavement].filter(f=>f.rings?.[0]?.length>2&&f.bbox[2]-f.bbox[0]<400&&f.bbox[3]-f.bbox[1]<400);const og=new Map(); // not the town-wide 1760 ground fill
for(const f of open){const b=f.bbox;for(let i=Math.floor(b[0]/16);i<=Math.floor(b[2]/16);i++)for(let j=Math.floor(b[1]/16);j<=Math.floor(b[3]/16);j++){const k=i*100000+j;let l=og.get(k);if(!l)og.set(k,l=[]);l.push(f);}}
const pip=(x,z,r)=>{let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
const onStreet=(x,z)=>(og.get(Math.floor(x/16)*100000+Math.floor(z/16))||[]).some(f=>{const b=f.bbox;return x>=b[0]&&x<=b[2]&&z>=b[1]&&z<=b[3]&&pip(x,z,f.rings[0])&&!f.rings.slice(1).some(h=>pip(x,z,h));});
const tiles=idx.tiles.map(t=>({t,...read(t.file)}));
const C=4,grid=new Map(),tri=[];const ck=(i,j)=>i*100000+j;
for(const {t,a} of tiles)for(const p of t.parts)for(let v=p.start;v+2<p.start+p.count;v+=3){const id=tri.length;const P=[0,1,2].map(k=>[a[(v+k)*5],a[(v+k)*5+1],a[(v+k)*5+2]]);tri.push(P);
 const xs=P.map(q=>q[0]),zs=P.map(q=>q[2]);for(let i=Math.floor(Math.min(...xs)/C);i<=Math.floor(Math.max(...xs)/C);i++)for(let j=Math.floor(Math.min(...zs)/C);j<=Math.floor(Math.max(...zs)/C);j++){const k=ck(i,j);let l=grid.get(k);if(!l)grid.set(k,l=[]);l.push(id);}}
const near=(x,z)=>grid.get(ck(Math.floor(x/C),Math.floor(z/C)))||[];
function rayDown(x,y,z){let best=Infinity;for(const id of near(x,z)){const [A,B,Cc]=tri[id];const d1=(B[0]-A[0])*(Cc[2]-A[2])-(Cc[0]-A[0])*(B[2]-A[2]);if(Math.abs(d1)<1e-6)continue;
 const u=((x-A[0])*(Cc[2]-A[2])-(Cc[0]-A[0])*(z-A[2]))/d1,v=((B[0]-A[0])*(z-A[2])-(x-A[0])*(B[2]-A[2]))/d1;if(u<-1e-3||v<-1e-3||u+v>1+1e-3)continue;
 const yy=A[1]+u*(B[1]-A[1])+v*(Cc[1]-A[1]);if(yy<y-.05&&y-yy<best)best=y-yy;}return best;}
// a vertical wall surface covering point (x,y,z) in the plane with normal n (any part): the storey below exists
function wallAt(x,y,z,nx,nz){for(const id of near(x,z)){const [A,B,Cc]=tri[id];const ux=B[0]-A[0],uy=B[1]-A[1],uz=B[2]-A[2],wx=Cc[0]-A[0],wy=Cc[1]-A[1],wz=Cc[2]-A[2];
 let px=uy*wz-uz*wy,py=uz*wx-ux*wz,pz=ux*wy-uy*wx;const l=Math.hypot(px,py,pz);if(l<1e-6)continue;px/=l;py/=l;pz/=l;if(Math.abs(py)>.3)continue;if(Math.abs(px*nx+pz*nz)<.9)continue;
 if(Math.abs((x-A[0])*px+(y-A[1])*py+(z-A[2])*pz)>.25)continue; // plane distance
 // barycentric in the plane (drop the dominant axis)
 const ax=Math.abs(px)>Math.abs(pz)?2:0;const q=[x,y,z],a2=[A[ax],A[1]],b2=[B[ax],B[1]],c2=[Cc[ax],Cc[1]],p2=[q[ax],q[1]];
 const d=(b2[0]-a2[0])*(c2[1]-a2[1])-(c2[0]-a2[0])*(b2[1]-a2[1]);if(Math.abs(d)<1e-6)continue;const s=((p2[0]-a2[0])*(c2[1]-a2[1])-(c2[0]-a2[0])*(p2[1]-a2[1]))/d,t=((b2[0]-a2[0])*(p2[1]-a2[1])-(p2[0]-a2[0])*(b2[1]-a2[1]))/d;
 if(s>-.02&&t>-.02&&s+t<1.02)return true;}return false;}
let added=0,partsFixed=0;const report=[];
const newStart=new Map(); // old file:start -> new start
for(const T of tiles){const {t,a}=T;const chunks=[];let cursor=0;
 for(const p of t.parts){const tris=[];for(let v=p.start;v<p.start+p.count;v++)tris.push(a.subarray(v*5,v*5+5));
  let base=Infinity;for(let v=p.start;v<p.start+p.count;v++)base=Math.min(base,a[v*5+1]);
  const extra=[];
  for(let v=p.start;v+2<p.start+p.count;v+=3){const P=[0,1,2].map(k=>[a[(v+k)*5],a[(v+k)*5+1],a[(v+k)*5+2],a[(v+k)*5+3],a[(v+k)*5+4]]);
   const ux=P[1][0]-P[0][0],uy=P[1][1]-P[0][1],uz=P[1][2]-P[0][2],wx=P[2][0]-P[0][0],wy=P[2][1]-P[0][1],wz=P[2][2]-P[0][2];
   let nx=uy*wz-uz*wy,ny=uz*wx-ux*wz,nz=ux*wy-uy*wx;const l=Math.hypot(nx,ny,nz);if(l<1e-6||Math.abs(ny/l)>.15)continue;nx/=l;nz/=l;
   // the triangle's lowest horizontal edge
   for(let k=0;k<3;k++){const E0=P[k],E1=P[(k+1)%3],O=P[(k+2)%3];if(Math.abs(E0[1]-E1[1])>.05||O[1]<=E0[1]+.3)continue;const y=E0[1];if(y-base<1.5)continue;
    const len=Math.hypot(E1[0]-E0[0],E1[2]-E0[2]);if(len<.5)continue;
    // floating if, at three points along the edge, there is no wall surface 0.6 m below in this plane
    let floating=0;for(const f of [.2,.5,.8]){const x=E0[0]+(E1[0]-E0[0])*f,z=E0[2]+(E1[2]-E0[2])*f;let found=false;for(const d of [0,.4,.8,1.2,1.6,-.4])if(wallAt(x-nx*d,y-.6,z-nz*d,nx,nz)){found=true;break;}if(!found)floating++;} // a wall below, flush or set back up to 1.6 m (cornices, bays): not floating
    if(floating<3)continue;
    {const mx=(E0[0]+E1[0])/2,mz=(E0[2]+E1[2])/2;if(onStreet(mx-nx*1.5,mz-nz*1.5)||onStreet(mx+nx*.5,mz+nz*.5)&&onStreet(mx-nx*.5,mz-nz*.5))continue;} // a passage over a street
    // down to the first surface below (a lower roof, a podium) or the part's base
    const mx=(E0[0]+E1[0])/2,mz=(E0[2]+E1[2])/2,drop=Math.min(rayDown(mx-nx*.3,y,mz-nz*.3),y-base);if(!(drop>.8))continue;const y0=y-drop;
    const a0=[E0[0],y0,E0[2],E0[3],E0[4]],a1=[E1[0],y0,E1[2],E1[3],E1[4]];
    // same facing as the source wall (its normal points out of the building)
    let t1=[E0,a0,a1],t2=[E0,a1,E1];
    {const [p,q,r]=t1,ux=q[0]-p[0],uy=q[1]-p[1],uz=q[2]-p[2],wx=r[0]-p[0],wy=r[1]-p[1],wz=r[2]-p[2];if((uy*wz-uz*wy)*nx+(ux*wy-uy*wx)*nz<0){t1=[E0,a1,a0];t2=[E0,E1,a1];}}
    for(const q of [...t1,...t2])extra.push(Float32Array.from(q));
    added+=2;}
  }
  if(extra.length){partsFixed++;report.push([p.id,p.name||'',Math.round((p.bbox[0]+p.bbox[2])/2),Math.round((p.bbox[1]+p.bbox[3])/2),extra.length/3]);}
  newStart.set(t.file+':'+p.start,cursor);
  chunks.push({p,verts:[...tris,...extra]});cursor+=tris.length+extra.length;}
 T.out=new Float32Array(cursor*5);let o=0;for(const {p,verts} of chunks){p._newStart=o;for(const v of verts)T.out.set(v,(o++)*5);p._newCount=verts.length;}
}
console.log(JSON.stringify({city,partsFixed,trianglesAdded:added,worst:report.sort((a,b)=>b[4]-a[4]).slice(0,25)}));
if(dry)process.exit(0);
for(const T of tiles){let buf=Buffer.from(T.out.buffer);if(T.gz)buf=zlib.gzipSync(buf,{level:9});fs.writeFileSync(path.join(root,T.t.file),buf);for(const p of T.t.parts){p.start=p._newStart;p.count=p._newCount;delete p._newStart;delete p._newCount;}}
fs.writeFileSync(idxFile,JSON.stringify(idx));
const remap=k=>{const i=k.lastIndexOf(':');const n=newStart.get(k);return n===undefined?k:k.slice(0,i)+':'+n;};
for(const f of ['duplicates.json','insets.json']){const p=path.join(root,f);if(!fs.existsSync(p))continue;fs.writeFileSync(p,JSON.stringify(JSON.parse(fs.readFileSync(p,'utf8')).map(remap)));}
{const p=path.join(root,'recolour.json');if(fs.existsSync(p)){const r=JSON.parse(fs.readFileSync(p,'utf8')),o={};for(const [k,[owners,flat]] of Object.entries(r))o[remap(k)]=[owners.map(remap),flat];fs.writeFileSync(p,JSON.stringify(o));}}
