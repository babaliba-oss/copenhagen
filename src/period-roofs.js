import * as THREE from 'three';

// 1760: town houses stood under steep tiled roofs, but much of the municipal model (today's blocks, roof
// terraces, rebuilt attics) ends flat. Each flat roof gets a hipped roof over it: the flat roof triangles are
// subdivided near their outline and every vertex rises with its distance from the outline (a distance-field
// roof, which closes into hips and a ridge on narrow houses and leaves a low plateau on deep blocks).
// The flat roof stays underneath; the new roof starts 4 cm above it at the eaves.
const SLOPE=.95,EDGE=1.2;

function segDist2(px,pz,ax,az,bx,bz){const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz;let t=l?((px-ax)*dx+(pz-az)*dz)/l:0;t=t<0?0:t>1?1:t;const x=ax+t*dx-px,z=az+t*dz-pz;return x*x+z*z;}

// array: tile Float32Array (stride 5). Returns {positions, colours} for one part, or null when it has no flat roof.
export function periodRoof(array,part,{maxRise=4.2}={}){
 let top=-Infinity,bottom=Infinity;
 for(let v=part.start;v<part.start+part.count;v++){const y=array[v*5+1];if(y>top)top=y;if(y<bottom)bottom=y;}
 const height=top-bottom;if(!(height>=4.5))return null;
 const flat=[];let flatArea=0,roofArea=0;
 for(let v=part.start;v+2<part.start+part.count;v+=3){const o=v*5;
  const ax=array[o],ay=array[o+1],az=array[o+2],bx=array[o+5],by=array[o+6],bz=array[o+7],cx=array[o+10],cy=array[o+11],cz=array[o+12];
  const ux=bx-ax,uy=by-ay,uz=bz-az,wx=cx-ax,wy=cy-ay,wz=cz-az,nx=uy*wz-uz*wy,ny=uz*wx-ux*wz,nz=ux*wy-uy*wx,l=Math.hypot(nx,ny,nz);if(l<1e-6)continue;
  const c=Math.abs(ny)/l;if(c<.35)continue;roofArea+=l/2;
  if(c>.985&&Math.min(ay,by,cy)>bottom+3){flat.push([[ax,ay,az],[bx,by,bz],[cx,cy,cz]]);flatArea+=l/2;}
 }
 if(flatArea<25||flatArea<roofArea*.5)return null; // pitched already (or a flat patch on a pitched roof)
 // Outline: edges used by one flat triangle only.
 const key=p=>`${Math.round(p[0]*20)},${Math.round(p[2]*20)}`,ekey=p=>key(p)+','+Math.round(p[1]*2),edges=new Map(); // edges keyed with height: a step between two flat levels is an outline for both
 for(const t of flat)for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3],ka=ekey(a),kb=ekey(b),k=ka<kb?ka+'|'+kb:kb+'|'+ka;const e=edges.get(k);if(e)e.n++;else edges.set(k,{a,b,n:1});}
 const seg=[];for(const e of edges.values())if(e.n===1)seg.push([e.a[0],e.a[2],e.b[0],e.b[2]]);
 if(!seg.length)return null;
 const rise=Math.min(maxRise,Math.max(2.2,height*.42)),run=rise/SLOPE;
 // Distance to the outline, capped at the run (all the roof needs): segments bucketed in 4 m cells, only the
 // cells within the run are searched; memoised per 5 cm point.
 const C=4,grid=new Map();seg.forEach((s,i)=>{for(let x=Math.floor(Math.min(s[0],s[2])/C);x<=Math.floor(Math.max(s[0],s[2])/C);x++)for(let z=Math.floor(Math.min(s[1],s[3])/C);z<=Math.floor(Math.max(s[1],s[3])/C);z++){const k=x*65536+z;let l=grid.get(k);if(!l)grid.set(k,l=[]);l.push(i);}});
 const R=Math.ceil(run/C),memo=new Map();
 const dist=(x,z)=>{const mk=Math.round(x*20)*1e6+Math.round(z*20);let d=memo.get(mk);if(d!==undefined)return d;
  let m=run*run;const cx=Math.floor(x/C),cz=Math.floor(z/C),seen=new Set();
  for(let i=cx-R;i<=cx+R;i++)for(let j=cz-R;j<=cz+R;j++){const l=grid.get(i*65536+j);if(l)for(const n of l){if(seen.has(n))continue;seen.add(n);const s=seg[n],q=segDist2(x,z,s[0],s[1],s[2],s[3]);if(q<m)m=q;}}
  d=Math.sqrt(m);memo.set(mk,d);return d;};
 const out=[],cache=new Map();
 const lift=p=>{const k=key(p)+','+Math.round(p[1]*20);let y=cache.get(k);if(y===undefined){y=p[1]+.04+Math.min(dist(p[0],p[2]),run)*SLOPE;cache.set(k,y);}return [p[0],y,p[2]];};
 const split=(t,depth)=>{
  let li=0,ll=0;for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3],l=Math.hypot(a[0]-b[0],a[2]-b[2]);if(l>ll){ll=l;li=i;}}
  // Plateau triangles (all corners beyond the run, well clear of the outline) stay whole.
  // Split while the roof surface bends inside the triangle (checked at the edge midpoints and the centre).
  const h=p=>Math.min(dist(p[0],p[2]),run),hv=t.map(h);
  let err=Math.abs(h([(t[0][0]+t[1][0]+t[2][0])/3,0,(t[0][2]+t[1][2]+t[2][2])/3])-(hv[0]+hv[1]+hv[2])/3);
  for(let k=0;k<3&&err<=.25;k++){const a=t[k],b=t[(k+1)%3];err=Math.max(err,Math.abs(h([(a[0]+b[0])/2,0,(a[2]+b[2])/2])-(hv[k]+hv[(k+1)%3])/2));}
  if(ll>EDGE&&depth<16&&err>.25){
   const a=t[li],b=t[(li+1)%3],c=t[(li+2)%3],m=[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];
   split([a,m,c],depth+1);split([m,b,c],depth+1);return;}
  out.push(t);
 };
 for(const t of flat)split(t,0);
 const positions=new Float32Array(out.length*9);let i=0;
 for(const t of out){const v=t.map(lift);
  // Face up whatever the source winding.
  const ux=v[1][0]-v[0][0],uz=v[1][2]-v[0][2],wx=v[2][0]-v[0][0],wz=v[2][2]-v[0][2],up=uz*wx-ux*wz>0;
  for(const p of up?v:[v[0],v[2],v[1]])positions.set(p,(i++)*3);}
 return positions;
}

// The municipal model is one continuous city cut into parts along today's footprints: a terrace's party walls are
// not there (about a fifth of a block's roof outline in the old town ends in an open cut). Today the neighbours stand
// flush and hide it; 1760 gives each house its own period height (and drops later buildings), so a taller house
// showed sky through its side above a lower neighbour, and a row ended without its gable wall. Every roof outline
// edge with no wall beneath it gets a wall down to the part's foot (following the roof edge, so a gable end is
// filled up to the ridge), set 3 cm inside the cut so it never fights a neighbour's own wall, wound to face out.
// Whether a wall stands beneath is sampled down the whole height under the edge (a ray from just outside, in toward the
// house, meets a wall within half a metre: walls set back under an eave count). One test at the edge's midpoint passed
// an edge whose only wall rose above it (the step up to a taller wing) and one walled only near the top (the side that
// stood clear above a neighbour that was taller in 1760's terms than today's): both stayed open below.
// A side that is partly walled gets its patch 10 cm inside instead, behind the measured wall it overlaps.
export function partyWalls(array,part,{inset=.03,step=.5}={}){
 const roof=[],walls=[];let lo=Infinity;
 for(let v=part.start;v+2<part.start+part.count;v+=3){const o=v*5;
  const t=[[array[o],array[o+1],array[o+2]],[array[o+5],array[o+6],array[o+7]],[array[o+10],array[o+11],array[o+12]]];
  for(const p of t)if(p[1]<lo)lo=p[1];
  const ux=t[1][0]-t[0][0],uy=t[1][1]-t[0][1],uz=t[1][2]-t[0][2],wx=t[2][0]-t[0][0],wy=t[2][1]-t[0][1],wz=t[2][2]-t[0][2],nx=uy*wz-uz*wy,ny=uz*wx-ux*wz,nz=ux*wy-uy*wx,l=Math.hypot(nx,ny,nz);if(l<1e-6)continue;
  if(Math.abs(ny)/l>.2)roof.push(t);else walls.push(t);
 }
 if(!roof.length||!Number.isFinite(lo))return null;
 // Roof outline: edges used by one roof triangle (with the triangle's third corner: the inside).
 const key=p=>`${Math.round(p[0]*20)},${Math.round(p[1]*20)},${Math.round(p[2]*20)}`,edges=new Map();
 for(const t of roof)for(let i=0;i<3;i++){const a=t[i],b=t[(i+1)%3],ka=key(a),kb=key(b);if(ka===kb)continue;const k=ka<kb?ka+'|'+kb:kb+'|'+ka;const e=edges.get(k);if(e)e.n++;else edges.set(k,{a,b,c:t[(i+2)%3],n:1});}
 // Wall triangles bucketed in 2 m cells.
 const C=2,grid=new Map(),roofGrid=new Map();roof.forEach((t,i)=>{for(let x=Math.floor(Math.min(t[0][0],t[1][0],t[2][0])/C);x<=Math.floor(Math.max(t[0][0],t[1][0],t[2][0])/C);x++)for(let z=Math.floor(Math.min(t[0][2],t[1][2],t[2][2])/C);z<=Math.floor(Math.max(t[0][2],t[1][2],t[2][2])/C);z++){const k=x*65536+z;let l=roofGrid.get(k);if(!l)roofGrid.set(k,l=[]);l.push(i);}});
 const wy0=walls.map(t=>Math.min(t[0][1],t[1][1],t[2][1])-.01),wy1=walls.map(t=>Math.max(t[0][1],t[1][1],t[2][1])+.01);
 walls.forEach((t,i)=>{for(let x=Math.floor((Math.min(t[0][0],t[1][0],t[2][0])-.6)/C);x<=Math.floor((Math.max(t[0][0],t[1][0],t[2][0])+.6)/C);x++)for(let z=Math.floor((Math.min(t[0][2],t[1][2],t[2][2])-.6)/C);z<=Math.floor((Math.max(t[0][2],t[1][2],t[2][2])+.6)/C);z++){const k=x*65536+z;let l=grid.get(k);if(!l)grid.set(k,l=[]);l.push(i);}});
 const walled=(x,y,z,ix,iz,l)=>{const ox=x-ix*.05,oz=z-iz*.05; // a horizontal ray from 5 cm outside, inward, meets a wall within 55 cm (l: the walls along this edge)
  for(const i of l){if(y<wy0[i]||y>wy1[i])continue;const [a,b,c]=walls[i],e1x=b[0]-a[0],e1y=b[1]-a[1],e1z=b[2]-a[2],e2x=c[0]-a[0],e2y=c[1]-a[1],e2z=c[2]-a[2],px=-iz*e2y,py=iz*e2x-ix*e2z,pz=ix*e2y,det=e1x*px+e1y*py+e1z*pz;if(Math.abs(det)<1e-9)continue;
   const inv=1/det,tx=ox-a[0],ty=y-a[1],tz=oz-a[2],u=(tx*px+ty*py+tz*pz)*inv;if(u<-1e-3||u>1+1e-3)continue;const qx=ty*e1z-tz*e1y,qy=tz*e1x-tx*e1z,qz=tx*e1y-ty*e1x,w=(ix*qx+iz*qz)*inv;if(w<-1e-3||u+w>1+1e-3)continue;
   const s=(e2x*qx+e2y*qy+e2z*qz)*inv;if(s>-.02&&s<.55)return true;}
  return false;};
 // Under this part's own roof just outside the edge (below the step up to a taller wing, or an edge inside the roof that only
 // looks like outline because the triangles meet it at a T-junction): inside the house, nothing to close.
 const roofed=(x,y,z,below)=>{const l=roofGrid.get(Math.floor(x/C)*65536+Math.floor(z/C));if(l)for(const i of l){const [a,b,c]=roof[i],ux=b[0]-a[0],uz=b[2]-a[2],vx=c[0]-a[0],vz=c[2]-a[2],d=ux*vz-uz*vx;if(Math.abs(d)<1e-9)continue;
   const px=x-a[0],pz=z-a[2],s=(px*vz-pz*vx)/d,t=(ux*pz-uz*px)/d;if(s<0||t<0||s+t>1)continue;const h=a[1]+s*(b[1]-a[1])+t*(c[1]-a[1]);if(h>y&&h<below)return true;}
  return false;};
 const out=[];
 for(const {a,b,c,n} of edges.values()){if(n!==1)continue;
  const dx=b[0]-a[0],dz=b[2]-a[2],L=Math.hypot(dx,dz);if(L<.05||Math.max(a[1],b[1])<lo+1)continue; // a vertical roof edge, or one at the foot
  let ix=-dz/L,iz=dx/L;if(ix*(c[0]-a[0])+iz*(c[2]-a[2])<0){ix=-ix;iz=-iz;} // toward the inside
  // Sample columns about a metre apart, every half metre from just under the edge down to the foot.
  // The walls that can stand under this edge: in its cells, within 60 cm of its line, alongside it.
  const near=new Set();for(let x=Math.floor((Math.min(a[0],b[0])-.6)/C);x<=Math.floor((Math.max(a[0],b[0])+.6)/C);x++)for(let z=Math.floor((Math.min(a[2],b[2])-.6)/C);z<=Math.floor((Math.max(a[2],b[2])+.6)/C);z++)for(const i of grid.get(x*65536+z)||[]){if(near.has(i))continue;
   let s0=Infinity,s1=-Infinity,d0=Infinity,d1=-Infinity;for(const q of walls[i]){const rx=q[0]-a[0],rz=q[2]-a[2],s=(rx*dx+rz*dz)/L,d=rx*ix+rz*iz;s0=Math.min(s0,s);s1=Math.max(s1,s);d0=Math.min(d0,d);d1=Math.max(d1,d);}
   if(s1>-.05&&s0<L+.05&&d1>-.1&&d0<.6)near.add(i);}
  const l=[...near];
  const m=Math.max(1,Math.ceil(L/1.2)),last=m-1;let open=false,shut=false,topOpen=false,high=-Infinity;
  for(let k=0;k<m;k++){const f=m===1?.5:.05+.9*k/last,x=a[0]+dx*f,z=a[2]+dz*f,top=a[1]+(b[1]-a[1])*f,dy=Math.max(step,(top-lo)/30);
   for(let y=top-.15,first=true;y>lo+.1;y-=dy,first=false){if(l.length&&walled(x,y,z,ix,iz,l)){shut=true;continue;}if(roofed(x-ix*.15,y,z-iz*.15,top+.3))break;open=true;if(first)topOpen=true;if(y>high)high=y;}}
  if(!open)continue;
  const foot=lo,d=shut?.1:inset,A=[a[0]+ix*d,a[2]+iz*d],B=[b[0]+ix*d,b[2]+iz*d],ya=topOpen?a[1]:Math.min(a[1],high+1),yb=topOpen?b[1]:Math.min(b[1],high+1);
  // Facing out (away from the inside): the quad A-foot, B-foot, B-top, A-top has the normal (-dz, 0, dx); when that
  // points inside, A and B swap.
  const [P,Q,yp,yq]=(-dz*ix+dx*iz)<0?[A,B,ya,yb]:[B,A,yb,ya];
  out.push(P[0],foot,P[1],Q[0],foot,Q[1],Q[0],yq,Q[1], P[0],foot,P[1],Q[0],yq,Q[1],P[0],yp,P[1]);
 }
 return out.length?new Float32Array(out):null;
}

// One tile's period shapes: hipped roofs (not for parts flagged noRoof) and the walls closing open cuts, as
// [{colour, positions}]. One odd footprint keeps its flat roof or its gap; the tile's job still answers.
export function periodShapes(array,parts){
 const out=[];for(const p of parts){
  if(!p.noRoof)try{const positions=periodRoof(array,p);if(positions)out.push({colour:p.roofColor,positions});}catch{}
  if(!p.noWalls)try{const positions=partyWalls(array,p);if(positions)out.push({colour:p.color||[.62,.57,.5],positions});}catch{}}
 return out;
}
// Roofs are computed in a worker (big blocks take 100+ ms): roofsInWorker(array, parts) → [{colour, positions}].
let worker=null,jobs=new Map(),nextJob=0;
export function roofsInWorker(array,parts){
 if(typeof Worker==='undefined')return Promise.resolve(periodShapes(array,parts));
 if(!worker){worker=new Worker(new URL('./period-roof-worker.js',import.meta.url),{type:'module'});worker.onmessage=({data})=>{const j=jobs.get(data.id);if(j){jobs.delete(data.id);j(data.roofs);}};worker.onerror=()=>{for(const j of jobs.values())j([]);jobs.clear();worker=null;};} // a dead worker: flat roofs, and the next tile starts a new one
 const id=nextJob++,copy=array.slice(),list=parts.map(p=>({start:p.start,count:p.count,roofColor:p.roofColor,color:p.color,noRoof:!!p.noRoof,noWalls:!!p.noWalls}));
 return new Promise(resolve=>{jobs.set(id,resolve);worker.postMessage({id,array:copy,parts:list},[copy.buffer]);});
}
const linear=c=>new THREE.Color(c[0],c[1],c[2]).convertSRGBToLinear();
// One merged mesh for a tile's roofs.
export function periodRoofMesh(roofs,material){
 let n=0;for(const r of roofs)n+=r.positions.length;if(!n)return null;
 const position=new Float32Array(n),colour=new Float32Array(n);let o=0;
 for(const r of roofs){const c=linear(r.colour||[.54,.23,.16]);position.set(r.positions,o);for(let i=0;i<r.positions.length;i+=3){colour[o+i]=c.r;colour[o+i+1]=c.g;colour[o+i+2]=c.b;}o+=r.positions.length;}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(position,3));g.setAttribute('color',new THREE.BufferAttribute(colour,3));g.computeVertexNormals();g.computeBoundingSphere();g.computeBoundingBox();
 const mesh=new THREE.Mesh(g,material);mesh.name='Period roofs';mesh.castShadow=true;mesh.receiveShadow=true;
 return mesh;
}

// Ramparts (Volden) come as flat-topped prisms with vertical sides: a green box. Earthworks slope, so the top
// outline is pulled inward (about 40 degrees from the ground), dragging the walls' top edges with it. No new
// vertices: done in place on the tile array before the shells are built.
export function slopeRampart(array,part,{maxRun=7}={}){
 let top=-Infinity,bottom=Infinity;
 for(let v=part.start;v<part.start+part.count;v++){const y=array[v*5+1];if(y>top)top=y;if(y<bottom)bottom=y;}
 const height=top-bottom;if(!(height>1.5))return 0;
 const key=(x,z)=>`${Math.round(x*20)},${Math.round(z*20)}`,isTop=y=>y>top-.3,edges=new Map();
 for(let v=part.start;v+2<part.start+part.count;v+=3){const o=[v*5,v*5+5,v*5+10];if(!o.every(i=>isTop(array[i+1])))continue;
  for(let i=0;i<3;i++){const A=o[i],B=o[(i+1)%3],C=o[(i+2)%3],ka=key(array[A],array[A+2]),kb=key(array[B],array[B+2]);if(ka===kb)continue;const k=ka<kb?ka+'|'+kb:kb+'|'+ka;
   const e=edges.get(k);if(e)e.n++;else edges.set(k,{n:1,ka,kb,a:[array[A],array[A+2]],b:[array[B],array[B+2]],c:[array[C],array[C+2]]});}}
 const normals=new Map(); // outline vertex → inward normals of its outline edges
 for(const e of edges.values()){if(e.n!==1)continue;const dx=e.b[0]-e.a[0],dz=e.b[1]-e.a[1],l=Math.hypot(dx,dz);if(l<1e-3)continue;let nx=-dz/l,nz=dx/l;
  if(nx*(e.c[0]-e.a[0])+nz*(e.c[1]-e.a[1])<0){nx=-nx;nz=-nz;}
  for(const k of [e.ka,e.kb]){let l2=normals.get(k);if(!l2)normals.set(k,l2=[]);l2.push([nx,nz,l]);}}
 const run=Math.min(maxRun,height*1.2),shift=new Map();
 for(const [k,ns] of normals){let x=0,z=0,minLen=Infinity;for(const [nx,nz,l] of ns){x+=nx;z+=nz;minLen=Math.min(minLen,l);}const l=Math.hypot(x,z);if(l<1e-3)continue;x/=l;z/=l;
  const c=Math.max(.4,x*ns[0][0]+z*ns[0][1]),d=Math.min(run/c,run*2.5,minLen*.45);shift.set(k,[x*d,z*d]);}
 let moved=0;
 for(let v=part.start;v<part.start+part.count;v++){const i=v*5;if(!isTop(array[i+1]))continue;const s=shift.get(key(array[i],array[i+2]));if(!s)continue;array[i]+=s[0];array[i+2]+=s[1];moved++;}
 return moved;
}
