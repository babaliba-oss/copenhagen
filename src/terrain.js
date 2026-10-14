// Ground elevation for cities with terrain (public/cities/<id>/terrain.pack, scripts/city-terrain.mjs).
// One shared bilinear height field: physics, traffic, people and every placed object ask groundAt(x,z).
// Without a terrain file (Helsinki) every lookup is 0 and the world stays flat.
//
// File format (little endian): 'TERR', uint32 header length, JSON header, padding to 4 bytes, then one
// Uint16 grid per layer (size×size, row-major, rows run +z). Each row stores its first value and then
// differences mod 65536, which gzip squeezes well. Ground: min+v*scale. Water (mapped water bodies) and lake
// (open water found in the elevation model only): 0 = none, else min+(v-1)*scale.

const MAGIC='TERR';
export function encodeTerrain({size,cell,extent,base=0,scale=.01,ground,water=null,lake=null,source=''}){
 const layers=[['ground',ground,false],['water',water,true],['lake',lake,true]].filter(l=>l[1]),meta=[];
 const grids=layers.map(([name,values,optional])=>{
  let min=Infinity;for(const v of values)if(Number.isFinite(v)&&v<min)min=v;if(!Number.isFinite(min))min=0;min=Math.floor(min/scale)*scale;
  const q=new Uint16Array(size*size);
  for(let i=0;i<q.length;i++){const v=values[i];q[i]=Number.isFinite(v)?Math.min(65535,Math.round((v-min)/scale)+(optional?1:0)):0;}
  for(let r=0;r<size;r++)for(let c=size-1;c>0;c--){const i=r*size+c;q[i]=(q[i]-q[i-1])&65535;}
  meta.push({name,min:+min.toFixed(4),optional});return q;
 });
 const header=new TextEncoder().encode(JSON.stringify({version:1,size,cell,extent,base,scale,layers:meta,source}));
 const start=Math.ceil((8+header.length)/4)*4,out=new Uint8Array(start+grids.length*size*size*2),view=new DataView(out.buffer);
 out.set(new TextEncoder().encode(MAGIC),0);view.setUint32(4,header.length,true);out.set(header,8);
 grids.forEach((q,k)=>{const o=start+k*size*size*2;for(let i=0;i<q.length;i++)view.setUint16(o+i*2,q[i],true);});
 return out;
}
// → {size,cell,extent,base,ground:Float32Array (relative to base), water:Float32Array|null (NaN = none), source}
export function decodeTerrain(buffer){
 const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(new TextDecoder().decode(bytes.subarray(0,4))!==MAGIC)throw Error('Not a terrain file');
 const length=view.getUint32(4,true),h=JSON.parse(new TextDecoder().decode(bytes.subarray(8,8+length))),start=Math.ceil((8+length)/4)*4,n=h.size*h.size,out={...h,water:null,lake:null};
 h.layers.forEach((layer,k)=>{
  const values=new Float32Array(n),o=start+k*n*2;
  for(let r=0;r<h.size;r++){let v=0;for(let c=0;c<h.size;c++){const i=r*h.size+c;v=(c?v+view.getUint16(o+i*2,true):view.getUint16(o+i*2,true))&65535;
   values[i]=layer.optional?(v?layer.min+(v-1)*h.scale-h.base:NaN):layer.min+v*h.scale-h.base;}}
  out[layer.name]=values;
 });
 return out;
}

let field=null;
export function setTerrain(f){field=f||null;return field;}
export const terrain=()=>field;
export const hasTerrain=()=>field!==null;

// Bilinear ground height in metres relative to the city's base level; 0 when the city is flat.
export function groundAt(x,z){
 const f=field;if(f===null)return 0;
 const n=f.size-1;let u=(x+f.extent)/f.cell,v=(z+f.extent)/f.cell;
 u=u<0?0:u>n?n:u;v=v<0?0:v>n?n:v;
 let i=Math.floor(u),j=Math.floor(v);if(i===n)i--;if(j===n)j--;
 const a=u-i,b=v-j,g=f.ground,k=j*f.size+i;
 return (g[k]*(1-a)+g[k+1]*a)*(1-b)+(g[k+f.size]*(1-a)+g[k+f.size+1]*a)*b;
}
// Water surface height (relative to base) where mapped water has a level, else null.
export function waterAt(x,z){
 const f=field;if(f===null||!f.water)return null;
 const n=f.size-1,u=Math.max(0,Math.min(n,(x+f.extent)/f.cell)),v=Math.max(0,Math.min(n,(z+f.extent)/f.cell));
 const i=Math.min(n-1,Math.floor(u)),j=Math.min(n-1,Math.floor(v)),a=u-i,b=v-j,w=f.water,k=j*f.size+i;
 let sum=0,weight=0;
 for(const [q,s] of [[k,(1-a)*(1-b)],[k+1,a*(1-b)],[k+f.size,(1-a)*b],[k+f.size+1,a*b]])if(!Number.isNaN(w[q])){sum+=w[q]*s;weight+=s;}
 return weight>1e-6?sum/weight:null;
}
// Ground gradient (dh/dx, dh/dz) by central differences over one metre.
export function slopeAt(x,z,out=[0,0]){
 if(field===null){out[0]=out[1]=0;return out;}
 out[0]=(groundAt(x+.5,z)-groundAt(x-.5,z));out[1]=(groundAt(x,z+.5)-groundAt(x,z-.5));return out;
}
// Lowest ground under a footprint (rings of [x,z]): buildings stand on it so no corner floats.
export function footprintBase(rings,step=4){
 if(field===null)return 0;let low=Infinity;
 for(const ring of rings||[])for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step));
  for(let k=0;k<n;k++){const h=groundAt(a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n);if(h<low)low=h;}}
 return Number.isFinite(low)?low:0;
}
// Adds the ground height under each vertex to its y (world-space positions; interleaved attributes work too).
export function drapePositions(position,{lift=0,water=false}={}){
 if(field===null||!position)return position;
 for(let i=0;i<position.count;i++){const x=position.getX(i),z=position.getZ(i),w=water?waterAt(x,z):null;position.setY(i,position.getY(i)+(w??groundAt(x,z))+lift);}
 position.needsUpdate=true;return position;
}
// Pose of a body resting on the ground at x,z facing heading (forward is -sin,-cos as everywhere in the game):
// height (never below the ground under its centre), pitch (nose up positive) and roll (right side up positive).
export function groundPose(x,z,heading,halfLength=2.2,halfWidth=.9,out={y:0,pitch:0,roll:0}){
 if(field===null){out.y=out.pitch=out.roll=0;return out;}
 const s=Math.sin(heading),c=Math.cos(heading);
 const front=groundAt(x-s*halfLength,z-c*halfLength),back=groundAt(x+s*halfLength,z+c*halfLength),right=groundAt(x+c*halfWidth,z-s*halfWidth),left=groundAt(x-c*halfWidth,z+s*halfWidth);
 out.y=Math.max(groundAt(x,z),(front+back)/2,(left+right)/2);out.pitch=Math.atan2(front-back,2*halfLength);out.roll=Math.atan2(right-left,2*halfWidth);
 return out;
}
// Building tiles ([x,y,z,u,v] per vertex, parts with start/count): each part stands on the lowest ground
// under its own vertices, so the downhill side never floats; the uphill side runs into the slope.
export function liftBuildings(array,parts){
 if(field===null)return;
 for(const p of parts){let low=Infinity;for(let i=p.start;i<p.start+p.count;i++){const h=groundAt(array[i*5],array[i*5+2]);if(h<low)low=h;}
  if(!Number.isFinite(low))continue;p.base=low;for(let i=p.start;i<p.start+p.count;i++)array[i*5+1]+=low;}
}
// Open water found only in the elevation model (src/terrain.js `lake` layer): its level at x,z, else null.
export function lakeAt(x,z){
 const f=field;if(f===null||!f.lake)return null;
 const i=Math.round((x+f.extent)/f.cell),j=Math.round((z+f.extent)/f.cell);if(i<0||j<0||i>=f.size||j>=f.size)return null;
 const v=f.lake[j*f.size+i];return Number.isNaN(v)?null:v;
}

// Cities whose mapped water is level within each body (Copenhagen's harbour, canals and moats are all at sea
// level): the elevation model still put bumps of a few metres into the water layer along narrow canals and
// under bridges, which drew the water surface as a ramp over the quay. Each 4-connected water region of the
// grid takes its median level.
export function flattenWaterBodies(f=field){
 if(!f?.water)return 0;const w=f.water,n=f.size,label=new Int32Array(n*n).fill(-1),stack=[];let regions=0;
 for(let s=0;s<n*n;s++){if(Number.isNaN(w[s])||label[s]>=0)continue;
  const cells=[];label[s]=regions;stack.push(s);
  while(stack.length){const k=stack.pop();cells.push(k);const r=(k/n)|0,c=k-r*n;
   for(const q of [c>0?k-1:-1,c<n-1?k+1:-1,r>0?k-n:-1,r<n-1?k+n:-1])if(q>=0&&label[q]<0&&!Number.isNaN(w[q])){label[q]=regions;stack.push(q);}}
  const vals=Float32Array.from(cells,k=>w[k]).sort(),mid=vals[vals.length>>1];for(const k of cells)if(w[k]>mid)w[k]=mid;regions++;} // only bumps come down; nothing is raised
 return regions;
}
