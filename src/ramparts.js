import {terrain,groundAt} from './terrain.js';
import {pointInPolygon,segmentDistance,bounds} from './geo.js';

// 1760's ramparts in the height field. The earthworks were drawn as building parts (kk-buildings.py: each stretch's
// outline at its foot, rising 0.7 m per metre inland to its highest terrace, lifted onto the lowest ground under it)
// over a height field that knew nothing of them, and their footprints were collision walls: the coach stuck at every
// rampart, windmills stood at a guessed 7 m above the field (floating beside the bastions), trees and walkers stood
// at the foot inside the bank. Here the same surface is raised into the field, so whatever stands on the ground stands
// on the rampart and the coach drives over it; the drawn earthwork is draped back onto the field (main.js), and it
// slopes down to every house beside it instead of running into the walls.
export const isRampart=b=>b.kind==='rampart'||/^volden$|skanse/i.test(b.name||'');
export const RAMPART_DRAPE=.1; // the drawn bank lies this far over the field (its flat triangles span the field's bilinear cells)
const RISE=.7,FOOT=.12,CLEAR=1; // m per m inland (kk-buildings.py); foot over the ground; flat strip kept along a house wall

// The stretches kk-buildings.py builds: the biggest outline takes in the terraces nested in it (90%) and their height.
export function rampartStretches(footprints){
 const area=r=>{let a=0;for(let i=0;i<r.length;i++){const p=r[i],q=r[(i+1)%r.length];a+=p[0]*q[1]-q[0]*p[1];}return Math.abs(a/2);};
 const list=footprints.filter(b=>b.rings?.[0]?.length>2&&area(b.rings[0])>4).sort((a,b)=>area(b.rings[0])-area(a.rings[0])),used=new Set(),out=[];
 for(const b of list){if(used.has(b))continue;used.add(b);let H=b.height||0;
  for(const c of list){if(used.has(c))continue;const r=c.rings[0];if(r.filter(([x,z])=>pointInPolygon(x,z,b.rings)||edgeDistance(b.rings,x,z)<.5).length>=.9*r.length) /* terraces share stretches of the outer outline */{used.add(c);H=Math.max(H,c.height||0);}}
  let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;for(const [x,z] of b.rings[0]){x0=Math.min(x0,x);z0=Math.min(z0,z);x1=Math.max(x1,x);z1=Math.max(z1,z);}
  out.push({rings:b.rings,H,bbox:[x0,z0,x1,z1]});}
 return out;
}
const edgeDistance=(rings,x,z)=>{let d=Infinity;for(const r of rings)for(let i=0;i<r.length;i++){const e=segmentDistance(x,z,r[i],r[(i+1)%r.length]);if(e<d)d=e;}return d;};
// The stretch's foot: the lowest ground under the points its mesh is built from (outline every ~2 m, inner 3 m grid), as liftBuildings does.
function footLevel(s){let lo=Infinity;
 for(const r of s.rings)for(let i=0;i<r.length;i++){const p=r[i],q=r[(i+1)%r.length],n=Math.max(1,Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1])/2));for(let k=0;k<n;k++)lo=Math.min(lo,groundAt(p[0]+(q[0]-p[0])*k/n,p[1]+(q[1]-p[1])*k/n));}
 const [x0,z0,x1,z1]=s.bbox;for(let x=x0+1.5;x<x1;x+=3)for(let z=z0+1.5;z<z1;z+=3)if(pointInPolygon(x,z,s.rings)&&edgeDistance(s.rings,x,z)>.8)lo=Math.min(lo,groundAt(x,z));
 return lo;
}
// Raises the field's samples inside each stretch to the earthwork's surface (never lowers them). Four bastions lie in
// today's lakes (the moat's remains): raised there too, their tops stand out of the water (see rampartDryLand).
// houses: footprints the bank must not climb into. Returns the number of samples raised.
export function raiseRamparts(footprints,{houses=[]}={},f=terrain()){
 if(!f)return 0;const stretches=rampartStretches(footprints.filter(isRampart));let raised=0;
 const reach=s=>s.H/RISE+CLEAR+1;
 for(const s of stretches){const base=footLevel(s);if(!Number.isFinite(base))continue;const [x0,z0,x1,z1]=s.bbox,R=reach(s);
  const near=houses.filter(h=>{const b=h.bbox??=bounds(h.rings);return b[0]<x1+R&&b[2]>x0-R&&b[1]<z1+R&&b[3]>z0-R;});
  const i0=Math.max(0,Math.ceil((x0+f.extent)/f.cell)),i1=Math.min(f.size-1,Math.floor((x1+f.extent)/f.cell)),j0=Math.max(0,Math.ceil((z0+f.extent)/f.cell)),j1=Math.min(f.size-1,Math.floor((z1+f.extent)/f.cell));
  const top=[];
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const x=-f.extent+i*f.cell,z=-f.extent+j*f.cell;if(!pointInPolygon(x,z,s.rings))continue;
   let h=Math.min(s.H,edgeDistance(s.rings,x,z)*RISE);
   for(const b of near){if(h<=0)break;const bb=b.bbox,gap=Math.max(bb[0]-x,x-bb[2],bb[1]-z,z-bb[3]);if(gap>R)continue;
    const d=pointInPolygon(x,z,b.rings)?0:edgeDistance(b.rings,x,z);h=Math.min(h,Math.max(0,d-CLEAR)*RISE);}
   const y=base+FOOT+h,k=j*f.size+i;if(y>f.ground[k])top.push(k,y);}
  for(let n=0;n<top.length;n+=2){f.ground[top[n]]=top[n+1];raised++;}}
 return raised;
}
// The drawn earthwork (a tile's part, [x,y,z,u,v] per vertex, three per triangle) laid on the raised field. Its flat
// triangles (2-3 m) and the field's bilinear 3 m cells bend differently where the bank meets the ground or a house:
// a triangle the field rose through (lawns and paths are draped on the field) lifts its corners, shared corners
// moving together so the surface stays closed.
const INSIDE=[[1/3,1/3],[.5,.25],[.25,.5],[.6,.2],[.2,.6],[.5,.5],[.5,0],[0,.5]];
export function drapeRampart(array,part){
 const end=part.start+part.count;for(let v=part.start;v<end;v++){const i=v*5;array[i+1]=groundAt(array[i],array[i+2])+RAMPART_DRAPE;}
 const key=i=>Math.round(array[i]*20)+','+Math.round(array[i+2]*20);
 for(let pass=0;pass<2;pass++){const lift=new Map();
  for(let v=part.start;v+2<end;v+=3){const o=v*5;let m=0;
   for(const [u,w] of INSIDE){const x=array[o]+(array[o+5]-array[o])*u+(array[o+10]-array[o])*w,z=array[o+2]+(array[o+7]-array[o+2])*u+(array[o+12]-array[o+2])*w,y=array[o+1]+(array[o+6]-array[o+1])*u+(array[o+11]-array[o+1])*w;m=Math.max(m,groundAt(x,z)+.05-y);}
   if(m>0)for(const i of [o,o+5,o+10]){const k=key(i);if(!(lift.get(k)>=m))lift.set(k,m);}}
  if(!lift.size)break;for(let v=part.start;v<end;v++){const i=v*5,m=lift.get(key(i));if(m)array[i+1]+=m;}}
 let lo=Infinity;for(let v=part.start;v<end;v++)lo=Math.min(lo,array[v*5+1]);part.base=lo;
}
// A windmill's mapped spot beside a bastion (the post mills stood on them): moved onto the nearest level top within
// reach when there is one at least 2 m above the spot; else it stays.
export function onRampartTop(x,z,reach=25){
 const here=groundAt(x,z);let best=-Infinity;const pts=[];
 for(let dx=-reach;dx<=reach;dx+=2)for(let dz=-reach;dz<=reach;dz+=2){if(dx*dx+dz*dz>reach*reach)continue;const g=groundAt(x+dx,z+dz);pts.push([dx,dz,g]);if(g>best)best=g;}
 if(!(best>here+2))return [x,z];
 let q=null,d=Infinity;for(const [dx,dz,g] of pts)if(g>best-.3){const e=Math.hypot(dx,dz);if(e<d){d=e;q=[x+dx,z+dz];}}
 return q;
}
