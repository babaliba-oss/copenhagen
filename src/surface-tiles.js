import * as THREE from 'three';
import {terrain,waterAt} from './terrain.js';
import {drapeGeometry,dropSunkenSurfaces,removeLegacyWater} from './terrain-mesh.js';
import {inWaterPolygons} from './geo.js';

// Ground surface tiles (roads, pavements, parks: interleaved position+colour, stride 6) are subdivided,
// draped over the terrain and trimmed at the water. That took 20-70 ms per tile on the main thread, a hitch
// whenever a tile streamed in while driving; it now runs in a worker with its own copy of the terrain field and
// water polygons. buildSurfaceTile is the same work in-thread (tests, no Worker).
export function buildSurfaceTile(floats,water){
 const g=new THREE.BufferGeometry(),buffer=new THREE.InterleavedBuffer(floats,6);
 g.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));g.setAttribute('color',new THREE.InterleavedBufferAttribute(buffer,3,3));g.computeVertexNormals();
 return dropSunkenSurfaces(drapeGeometry(removeLegacyWater(g),{maxEdge:4,mark:true}),{water:(x,z)=>inWaterPolygons(water,x,z)?waterAt(x,z):null,mapped:(x,z)=>inWaterPolygons(water,x,z)}); // the mapped water, not the level spread onto the banks
}
export function serialiseGeometry(g){
 const attrs=[],transfer=[];
 for(const [name,a] of Object.entries(g.attributes)){let array;
  if(a.isInterleavedBufferAttribute){array=new Float32Array(a.count*a.itemSize);for(let i=0;i<a.count;i++)for(let c=0;c<a.itemSize;c++)array[i*a.itemSize+c]=a.getComponent(i,c);}
  else array=a.array;
  attrs.push({name,array,itemSize:a.itemSize,normalized:a.normalized});transfer.push(array.buffer);}
 let index=null;if(g.index){index=g.index.array instanceof Uint32Array||g.index.array instanceof Uint16Array?g.index.array:Uint32Array.from(g.index.array);transfer.push(index.buffer);}
 return {message:{attrs,index,groups:g.groups.map(x=>({...x}))},transfer:[...new Set(transfer)]};
}
export function deserialiseGeometry({attrs,index,groups}){
 const g=new THREE.BufferGeometry();
 for(const a of attrs)g.setAttribute(a.name,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));
 if(index)g.setIndex(new THREE.BufferAttribute(index,1));for(const x of groups)g.addGroup(x.start,x.count,x.materialIndex);
 g.computeBoundingSphere();g.computeBoundingBox();return g;
}

let worker=null,failed=false,next=0,sentTerrain=null,sentWater=null,sentWaterCount=-1;const jobs=new Map();
export function surfaceTile(floats,water){
 if(typeof Worker==='undefined'||failed)return Promise.resolve(buildSurfaceTile(floats,water));
 if(!worker){
  try{worker=new Worker(new URL('./surface-worker.js',import.meta.url),{type:'module'});}catch{failed=true;return Promise.resolve(buildSurfaceTile(floats,water));}
  worker.onmessage=({data})=>{const j=jobs.get(data.id);if(!j)return;jobs.delete(data.id);if(data.error)j.reject(Error(data.error));else j.resolve(deserialiseGeometry(data));};
  worker.onerror=e=>{failed=true;const pending=[...jobs.values()];jobs.clear();for(const j of pending)j.fallback();e.preventDefault?.();};
 }
 const f=terrain();if(f!==sentTerrain){worker.postMessage({terrain:f});sentTerrain=f;}
 if(water!==sentWater||water.length!==sentWaterCount){worker.postMessage({water:water.map(w=>({rings:w.rings,bbox:w.bbox}))});sentWater=water;sentWaterCount=water.length;}
 const id=next++,copy=floats.slice();
 return new Promise((resolve,reject)=>{jobs.set(id,{resolve,reject,fallback:()=>resolve(buildSurfaceTile(floats,water))});worker.postMessage({id,floats:copy},[copy.buffer]);});
}
