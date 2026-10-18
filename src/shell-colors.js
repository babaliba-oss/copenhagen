import * as THREE from 'three';
import {creasedNormalsArray} from './shell-normals.js';
export {creasedNormalsArray};

// Per-vertex colours for building shells that have no photo texture (far merged shells and the
// per-part shells shown while detail loads): walls take the part's wall colour, roofs its roof colour.
// Parts without colours (newer buildings kept from OpenStreetMap) get a stable colour from a
// contemporary Copenhagen palette, so nothing is left builder's grey.
const MODERN_WALLS=['#d9d4c7','#b9b2a5','#8f8b84','#c7b79a','#a5634c','#e6e1d6','#7d8790','#c9c2b4','#9b5a46','#d2c5ad'];
const MODERN_ROOFS=['#4a4d50','#5b5f63','#3e4144','#6a6e70'];
const hash=s=>{let h=2166136261;for(const c of String(s))h=Math.imul(h^c.charCodeAt(0),16777619)>>>0;return h;};
const lin=hex=>{const c=new THREE.Color(hex);return [c.r,c.g,c.b];}; // THREE.Color(hex) is already linear
const linArr=a=>{const c=new THREE.Color(a[0],a[1],a[2]).convertSRGBToLinear();return [c.r,c.g,c.b];};

export function partColours(part){
 if(part.color&&part.roofColor)return {wall:linArr(part.color),roof:linArr(part.roofColor)};
 const h=hash(part.id);
 return {wall:lin(MODERN_WALLS[h%MODERN_WALLS.length]),roof:lin(MODERN_ROOFS[(h>>>8)%MODERN_ROOFS.length])};
}
// Give untextured parts colours their own colour too (so estimated façades can apply to them as well).
// 1760: limewashed ochre, yellow, ox-blood, grey and white town houses under red tile (a few slate) roofs.
const PERIOD_WALLS=['#d8b56a','#e3cf9a','#9b4a36','#c9c1ae','#e8e1cf','#b7703f','#d9c08a','#a8a294'],PERIOD_ROOFS=['#8a3b2a','#93432e','#7c3526','#4a4f52'];
export function ensurePartColours(part,era=null){
 if(part.color&&part.roofColor)return part;
 const h=hash(part.id),hex=x=>{const o={};new THREE.Color(x).getRGB(o,THREE.SRGBColorSpace);return [o.r,o.g,o.b].map(v=>+v.toFixed(3));};
 if(era===1760){part.color=hex(PERIOD_WALLS[h%PERIOD_WALLS.length]);part.roofColor=hex(PERIOD_ROOFS[(h>>>8)%PERIOD_ROOFS.length]);return part;}
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
   const tint=Math.abs(ny/l)>.35?null:p.recolour?.get((v-p.start)/3); // block wall completing a named building (recolour.json)
   const c=Math.abs(ny/l)>.35?roof:tint?linArr(tint):wall; // same split as the shader's wall grain and window grid (facade-grain.js): a slightly twisted wall quad stays one colour
   for(let k=0;k<3;k++)out.set(c,(v-start+k)*3);
  }
 }
 return new THREE.BufferAttribute(out,3);
}

// Height above the part's own base and the part's height, per vertex (the far-shell window grid only
// paints storeys that exist: nothing on low walls, kerbs or the bottom 2 m).
export function shellHeightAttribute(array,parts,start,end){
 const out=new Float32Array((end-start)*2);
 for(const p of parts){
  const a=Math.max(start,p.start),b=Math.min(end,p.start+p.count);if(b<=a)continue;
  let lo=Infinity,hi=-Infinity;for(let v=p.start;v<p.start+p.count;v++){const y=array[v*5+1];if(y<lo)lo=y;if(y>hi)hi=y;}
  const total=p.noFacade?-(hi-lo):hi-lo; // churches, towers, domes: negative = tall church windows instead of the storey grid
  for(let v=a;v<b;v++){out[(v-start)*2]=array[v*5+1]-lo;out[(v-start)*2+1]=total;}
 }
 return new THREE.BufferAttribute(out,2);
}

// Normals for a non-indexed shell: each corner averages the face normals of the triangles meeting at that
// point whose faces are within `crease` radians of its own. The city model's walls are often slightly twisted
// quads; flat per-triangle normals light their two halves differently (light and dark triangles on one
// wall). Real corners (90°) and eaves stay sharp.
export function creasedShellNormals(geometry,crease=.6){
 const p=geometry.attributes.position;
 const normals=p.isInterleavedBufferAttribute?creasedNormalsArray(p.data.array,p.data.stride,p.offset,0,p.count,crease):creasedNormalsArray(p.array,p.itemSize,0,0,p.count,crease);
 geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));return geometry;
}
