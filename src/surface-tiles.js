import * as THREE from 'three';
import {terrain,waterAt,raisedDecks} from './terrain.js';
import {drapeGeometry,dropSunkenSurfaces,removeLegacyWater} from './terrain-mesh.js';
import {inWaterPolygons,SpatialIndex,pointInPolygon} from './geo.js';

// Ground surface tiles (roads, pavements, parks: interleaved position+colour, stride 6) are subdivided,
// draped over the terrain and trimmed at the water. That took 20-70 ms per tile on the main thread, a hitch
// whenever a tile streamed in while driving; it now runs in a worker with its own copy of the terrain field and
// water polygons. buildSurfaceTile is the same work in-thread (tests, no Worker).
// Bridge decks (quay.js buildBridgeRailings: the paving mapped across the water with railings) keep their paving: it was
// dropped as paving over the mapped water, and the deck plate drawn in its place met the street's own surface in a
// saw-tooth seam at each end of the bridge (Knippelsbro from above looked patched together).
let bridgeDecks=[];const bridgeIndexes=new WeakMap();
export function setSurfaceBridges(decks){bridgeDecks=(decks||[]).filter(d=>d.rings?.[0]?.length>2).map(d=>({rings:d.rings}));}
function onBridge(decks,x,z){if(!decks?.length)return false;let index=bridgeIndexes.get(decks);if(!index){index=new SpatialIndex(decks);bridgeIndexes.set(decks,index);}return !!index.at(x,z);}
// Under a raised deck (terrain.js, quay.js findRaisedDecks: Cykelslangen) the tiles carry the deck's own paving on the ground,
// cut out of the footway it crosses (the dissolve puts cycle tracks over footways): the ground there takes the paving
// beside it, the nearest outside the deck within 12 m (none: left bare). Over the water it is dropped like other paving.
export function underRaisedDecks(floats,raised){
 if(!raised?.length)return floats;const R=raised.map(d=>({rings:d.rings,b:d.bbox||d.rings[0].reduce((b,[x,z])=>[Math.min(b[0],x),Math.min(b[1],z),Math.max(b[2],x),Math.max(b[3],z)],[Infinity,Infinity,-Infinity,-Infinity])}));
 const inside=(x,z)=>R.some(({rings,b})=>x>=b[0]&&x<=b[2]&&z>=b[1]&&z<=b[3]&&pointInPolygon(x,z,rings)),under=[];
 for(let i=0;i<floats.length;i+=18){const x=(floats[i]+floats[i+6]+floats[i+12])/3,z=(floats[i+2]+floats[i+8]+floats[i+14])/3;if(inside(x,z))under.push(i);}
 if(!under.length)return floats;const set=new Set(under),out=[];for(let i=0;i<floats.length;i+=18)if(!set.has(i))out.push(i);
 const keep=[];for(const i of under){const x=(floats[i]+floats[i+6]+floats[i+12])/3,z=(floats[i+2]+floats[i+8]+floats[i+14])/3;let best=144,src=-1;
  for(const j of out)for(let k=0;k<18;k+=6){const q=(floats[j+k]-x)**2+(floats[j+k+2]-z)**2;if(q<best){best=q;src=j+k;}}
  if(src<0)continue;keep.push(i);for(let k=0;k<18;k+=6){floats[i+k+3]=floats[src+3];floats[i+k+4]=floats[src+4];floats[i+k+5]=floats[src+5];}}
 if(keep.length===under.length)return floats;const kept=new Set(keep),res=new Float32Array(floats.length-(under.length-keep.length)*18);let o=0;for(let i=0;i<floats.length;i+=18)if(!set.has(i)||kept.has(i)){res.set(floats.subarray(i,i+18),o);o+=18;}return res;
}
const raisedRings=()=>raisedDecks().map(d=>({rings:d.rings,bbox:d.bbox}));
export function buildSurfaceTile(floats,water,bridges=bridgeDecks,raised=raisedRings()){
 floats=underRaisedDecks(floats,raised);
 const g=new THREE.BufferGeometry(),buffer=new THREE.InterleavedBuffer(floats,6);
 g.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));g.setAttribute('color',new THREE.InterleavedBufferAttribute(buffer,3,3));g.computeVertexNormals();
 const wet=(x,z)=>inWaterPolygons(water,x,z)&&!onBridge(bridges,x,z); // the mapped water, not the level spread onto the banks; a bridge deck is not water
 return dropSunkenSurfaces(drapeGeometry(removeLegacyWater(g),{maxEdge:4,mark:true}),{water:(x,z)=>wet(x,z)?waterAt(x,z):null,mapped:wet});
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

let worker=null,failed=false,next=0,sentTerrain=null,sentWater=null,sentWaterCount=-1,sentBridges=null,sentRaised=null;const jobs=new Map();
export function surfaceTile(floats,water){
 if(typeof Worker==='undefined'||failed)return Promise.resolve(buildSurfaceTile(floats,water));
 if(!worker){
  try{worker=new Worker(new URL('./surface-worker.js',import.meta.url),{type:'module'});}catch{failed=true;return Promise.resolve(buildSurfaceTile(floats,water));}
  worker.onmessage=({data})=>{const j=jobs.get(data.id);if(!j)return;jobs.delete(data.id);if(data.error)j.reject(Error(data.error));else j.resolve(deserialiseGeometry(data));};
  worker.onerror=e=>{failed=true;const pending=[...jobs.values()];jobs.clear();for(const j of pending)j.fallback();e.preventDefault?.();};
 }
 const f=terrain();if(f!==sentTerrain){worker.postMessage({terrain:f});sentTerrain=f;}
 if(water!==sentWater||water.length!==sentWaterCount){worker.postMessage({water:water.map(w=>({rings:w.rings,bbox:w.bbox}))});sentWater=water;sentWaterCount=water.length;}
 if(bridgeDecks!==sentBridges){worker.postMessage({bridges:bridgeDecks});sentBridges=bridgeDecks;}
 if(raisedDecks()!==sentRaised){sentRaised=raisedDecks();worker.postMessage({raised:raisedRings()});}
 const id=next++,copy=floats.slice();
 return new Promise((resolve,reject)=>{jobs.set(id,{resolve,reject,fallback:()=>resolve(buildSurfaceTile(floats,water))});worker.postMessage({id,floats:copy},[copy.buffer]);});
}
