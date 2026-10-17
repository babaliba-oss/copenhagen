// Roofless buildings: parts with walls but (almost) no roof surface get a flat roof from their mapped footprint
// (city.pack building with the same OSM id) at the top of their walls. Rewrites packs + index and remaps
// file:start keys like building-skirts.mjs.   node scripts/building-caps.mjs copenhagen-1760 [--dry]
import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';import earcut from 'earcut';
const city=process.argv[2],dry=process.argv.includes('--dry'),root=`public/cities/${city}`;
const idxFile=path.join(root,'buildings3d-index.json'),idx=JSON.parse(fs.readFileSync(idxFile,'utf8'));
const cityPack=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'city.pack'))));
const foot=new Map(cityPack.buildings.map(b=>[b.id,b]));
const ringArea=r=>{let s=0;for(let i=0,j=r.length-1;i<r.length;j=i++)s+=(r[j][0]+r[i][0])*(r[j][1]-r[i][1]);return Math.abs(s)/2;};
let capped=0;const newStart=new Map(),report=[];
for(const t of idx.tiles){let raw=fs.readFileSync(path.join(root,t.file));const gz=raw[0]===31&&raw[1]===139;if(gz)raw=zlib.gunzipSync(raw);
 const a=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));const chunks=[];let cursor=0,changed=false;
 for(const p of t.parts){const verts=[];for(let v=p.start;v<p.start+p.count;v++)verts.push(a.subarray(v*5,v*5+5));
  const f=foot.get(p.id.replace(/^kk-/,''));let extra=[];
  if(f&&f.rings?.[0]?.length>3){let flat=0,wall=0,ymin=Infinity,ymax=-Infinity;
   for(let v=p.start;v+2<p.start+p.count;v+=3){const P=[0,1,2].map(k=>[a[(v+k)*5],a[(v+k)*5+1],a[(v+k)*5+2]]);for(const q of P){ymin=Math.min(ymin,q[1]);ymax=Math.max(ymax,q[1]);}
    const ux=P[1][0]-P[0][0],uy=P[1][1]-P[0][1],uz=P[1][2]-P[0][2],wx=P[2][0]-P[0][0],wy=P[2][1]-P[0][1],wz=P[2][2]-P[0][2];const ny=uz*wx-ux*wz,l=Math.hypot(uy*wz-uz*wy,ny,ux*wy-uy*wx);if(l<1e-9)continue;if(Math.abs(ny)/l>.3)flat+=Math.abs(ny)/2;else wall+=l/2;}
   const A=ringArea(f.rings[0])-f.rings.slice(1).reduce((s,r)=>s+ringArea(r),0);
   if(A>20&&ymax-ymin>2.5&&wall>15&&flat<A*.08){
    const flatPts=[],holes=[];for(const [k,r] of f.rings.entries()){if(k)holes.push(flatPts.length/2);for(const q of r)flatPts.push(q[0],q[1]);}
    const tri=earcut(flatPts,holes);for(let i=0;i<tri.length;i+=3){const c=[tri[i],tri[i+2],tri[i+1]];for(const k of c)extra.push(Float32Array.of(flatPts[k*2],ymax,flatPts[k*2+1],0,0));}
    // both faces: the winding of the municipal shells is not consistent
    const n=extra.length;for(let i=0;i<n;i+=3)extra.push(extra[i],extra[i+2],extra[i+1]);
    capped++;changed=true;report.push([p.id,p.name||'',Math.round((p.bbox[0]+p.bbox[2])/2),Math.round((p.bbox[1]+p.bbox[3])/2),Math.round(A)]);}}
  chunks.push({key:t.file+':'+p.start,start:cursor,p,verts:[...verts,...extra]});cursor+=verts.length+extra.length;}
 if(!changed||dry)continue;
 for(const c of chunks)newStart.set(c.key,c.start);
 const out=new Float32Array(cursor*5);let o=0;for(const {p,verts} of chunks){p.start=o;for(const v of verts)out.set(v,(o++)*5);p.count=verts.length;}
 let buf=Buffer.from(out.buffer);if(gz)buf=zlib.gzipSync(buf,{level:9});fs.writeFileSync(path.join(root,t.file),buf);}
console.log(JSON.stringify({city,capped,list:report.slice(0,30)}));
if(dry)process.exit(0);
fs.writeFileSync(idxFile,JSON.stringify(idx));
const remap=k=>{const i=k.lastIndexOf(':');const n=newStart.get(k);return n===undefined?k:k.slice(0,i)+':'+n;};
for(const f of ['duplicates.json','insets.json']){const p=path.join(root,f);if(!fs.existsSync(p))continue;fs.writeFileSync(p,JSON.stringify(JSON.parse(fs.readFileSync(p,'utf8')).map(remap)));}
{const p=path.join(root,'recolour.json');if(fs.existsSync(p)){const r=JSON.parse(fs.readFileSync(p,'utf8')),o={};for(const [k,[owners,flat]] of Object.entries(r))o[remap(k)]=[owners.map(remap),flat];fs.writeFileSync(p,JSON.stringify(o));}}
