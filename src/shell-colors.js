import * as THREE from 'three';

// Per-vertex colours for building shells that have no photo texture (far merged shells and the
// per-part shells shown while detail loads): walls take the part's wall colour, roofs its roof colour.
// Parts without colours (newer buildings kept from OpenStreetMap) get a stable colour from a
// contemporary Copenhagen palette, so nothing is left builder's grey.
const MODERN_WALLS=['#d9d4c7','#b9b2a5','#8f8b84','#c7b79a','#a5634c','#e6e1d6','#7d8790','#c9c2b4','#9b5a46','#d2c5ad'];
const MODERN_ROOFS=['#4a4d50','#5b5f63','#3e4144','#6a6e70'];
const hash=s=>{let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h;};
const lin=hex=>{const c=new THREE.Color(hex).convertSRGBToLinear();return [c.r,c.g,c.b];};
const linArr=a=>{const c=new THREE.Color(a[0],a[1],a[2]).convertSRGBToLinear();return [c.r,c.g,c.b];};

export function partColours(part){
 if(part.color&&part.roofColor)return {wall:linArr(part.color),roof:linArr(part.roofColor)};
 const h=hash(part.id);
 return {wall:lin(MODERN_WALLS[h%MODERN_WALLS.length]),roof:lin(MODERN_ROOFS[(h>>>8)%MODERN_ROOFS.length])};
}
// Give untextured parts colours their own colour too (so estimated façades can apply to them as well).
export function ensurePartColours(part){
 if(part.color&&part.roofColor)return part;
 const h=hash(part.id),hex=x=>{const c=new THREE.Color(x);return [c.r,c.g,c.b].map(v=>+v.toFixed(3));};
 part.color=hex(MODERN_WALLS[h%MODERN_WALLS.length]);part.roofColor=hex(MODERN_ROOFS[(h>>>8)%MODERN_ROOFS.length]);part.modern=true;return part;
}

// array: tile Float32Array (stride 5); parts: the parts covering vertices [start, end).
export function shellColourAttribute(array,parts,start,end){
 const n=end-start,out=new Float32Array(n*3);
 for(const p of parts){
  const a=Math.max(start,p.start),b=Math.min(end,p.start+p.count);if(b<=a)continue;
  const {wall,roof}=partColours(p);
  for(let v=a;v+2<b;v+=3){
   const i=v*5,ax=array[i],ay=array[i+1],az=array[i+2],bx=array[i+5],by=array[i+6],bz=array[i+7],cx=array[i+10],cy=array[i+11],cz=array[i+12];
   const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az,nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz)||1;
   const c=Math.abs(ny/l)>.25?roof:wall;
   for(let k=0;k<3;k++)out.set(c,(v-start+k)*3);
  }
 }
 return new THREE.BufferAttribute(out,3);
}
