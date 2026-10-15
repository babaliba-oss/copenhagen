import * as THREE from 'three';

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
export function ensurePartColours(part){
 if(part.color&&part.roofColor)return part;
 const h=hash(part.id),hex=x=>{const o={};new THREE.Color(x).getRGB(o,THREE.SRGBColorSpace);return [o.r,o.g,o.b].map(v=>+v.toFixed(3));};
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
 const p=geometry.attributes.position,n=p.count,out=new Float32Array(n*3),limit=Math.cos(crease);
 const tri=new Float32Array((n/3|0)*3);
 for(let t=0;t<n/3-.5;t++){const a=t*3;
  const ax=p.getX(a),ay=p.getY(a),az=p.getZ(a),ux=p.getX(a+1)-ax,uy=p.getY(a+1)-ay,uz=p.getZ(a+1)-az,vx=p.getX(a+2)-ax,vy=p.getY(a+2)-ay,vz=p.getZ(a+2)-az;
  let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const l=Math.hypot(nx,ny,nz)||1;tri[t*3]=nx/l;tri[t*3+1]=ny/l;tri[t*3+2]=nz/l;}
 // Group corners by position (5 cm grid) with hash chains: linear time. A point where very many triangles meet
 // (a fan, a degenerate spike) keeps its flat normals rather than an O(k²) average.
 let cap=1;while(cap<n*2)cap<<=1;const tk=new Float64Array(cap),th=new Int32Array(cap).fill(-1),ts=new Int32Array(cap),next=new Int32Array(n).fill(-1),slot=new Int32Array(n);
 for(let i=0;i<n;i++){const k=((Math.round(p.getX(i)*20)+200000)*400000+(Math.round(p.getZ(i)*20)+200000))*20000+(Math.round(p.getY(i)*20)+10000);
  let q=(Math.imul((k%2147483647)|0,0x9e3779b1)>>>0)&(cap-1);while(th[q]>=0&&tk[q]!==k)q=(q+1)&(cap-1); // open addressing
  tk[q]=k;next[i]=th[q];th[q]=i;ts[q]++;slot[i]=q;}
 for(let i=0;i<n;i++){const q=slot[i],h=th[q],t=i/3|0,ox=tri[t*3],oy=tri[t*3+1],oz=tri[t*3+2];let sx=ox,sy=oy,sz=oz;
  if(ts[q]<=48)for(let o=h;o>=0;o=next[o]){if(o===i)continue;const u=o/3|0,x=tri[u*3],y=tri[u*3+1],z=tri[u*3+2];if(x*ox+y*oy+z*oz>=limit){sx+=x;sy+=y;sz+=z;}}
  const l=Math.hypot(sx,sy,sz)||1;out[i*3]=sx/l;out[i*3+1]=sy/l;out[i*3+2]=sz/l;}
 geometry.setAttribute('normal',new THREE.BufferAttribute(out,3));return geometry;
}
