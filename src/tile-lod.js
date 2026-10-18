import * as THREE from 'three';
import {shellColourAttribute,shellHeightAttribute,creasedShellNormals} from './shell-colors.js';
import {facadeGrain} from './facade-grain.js';

// Distance levels for measured building tiles, with hysteresis so a tile parked on a threshold
// never flickers between representations:
//  near   — worker-detailed meshes (photo shells, reveals, windows); per-part measured shells until they land
//  far    — one merged measured shell per texture atlas: same walls and roofs, no windows, no shadows
//  hidden — beyond the fogged distance
// Authored landmark fronts inside tiles (shell meshes with the 'detail' role) stay visible at every level.
export const LOD={near:240,far:290,visible:550,detail:180,shadow:95}; // shadow 130 -> 95 m: building shells beyond cast no shadow (draw calls)

export function tileLevel(previous,distance,bands=LOD){
 if(distance>bands.visible)return 'hidden';
 if(distance>bands.far)return 'far';
 if(distance<bands.near)return 'near';
 return previous==='near'?'near':'far';
}

// Parts are stored in start order and each atlas's parts are contiguous, so a tile merges into
// one draw per atlas without copying vertices around. Gaps (landmarks rendered elsewhere) split a run.
export function mergedShellRanges(parts){
 const ranges=[];
 for(const p of parts){const last=ranges.at(-1);if(last&&last.texture===(p.texture||null)&&last.end===p.start)last.end=p.start+p.count;else ranges.push({texture:p.texture||null,start:p.start,end:p.start+p.count});}
 return ranges;
}

// Near tiles show the same merged shells until the worker's detailed buildings land: a per-tile mask
// (one texel per part) hides each part as its detailed building arrives, and dithers it while the chase
// camera fades it. One draw per atlas instead of one per waiting building (500+ draws at Nyhavn).
export function createShellMask(count){
 if(count>256)console.warn(`Tile with ${count} parts: only the first 256 can hand over to detail cleanly`);
 // One float per part in a vec4[64] uniform (a tile holds at most 255 parts): no texture uploads, and the
 // uniform only re-sends when a value changes.
 const data=new Float32Array(256).fill(1);let shown=count;
 return {data,get shown(){return shown;},
  set(i,v){v=Math.max(0,Math.min(1,v));if(i>255||data[i]===v)return;if(data[i]>0&&v===0)shown--;else if(data[i]===0&&v>0)shown++;data[i]=v;},
  get(i){return data[i];}};
}
const MASK_VERTEX='\nvMask=1.;if(uMaskOn>.5&&aBid<255.5){int b=int(aBid+.5);vMask=uMask[b>>2][b&3];}if(vMask<.002)gl_Position=vec4(0.,0.,2.,1.);';
function maskShader(material,uniforms,{fragment=true}={}){
 const prev=material.onBeforeCompile,prevKey=material.customProgramCacheKey;
 material.onBeforeCompile=(shader,renderer)=>{prev?.call(material,shader,renderer);Object.assign(shader.uniforms,uniforms);
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aBid;uniform vec4 uMask[64];uniform float uMaskOn;varying float vMask;').replace('#include <project_vertex>','#include <project_vertex>'+MASK_VERTEX);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vMask;').replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\n'+(fragment?'if(vMask<.996&&fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))))>vMask)discard;':'if(vMask<.5)discard;'));};
 material.customProgramCacheKey=()=>(prevKey?prevKey.call(material):'')+'|shell-mask';
 return material;
}
export function createMergedShells(array,parts,textures,mask=null){
 const index=new Map(parts.map((p,i)=>[p,i]));
 return mergedShellRanges(parts).map(r=>{
  const data=array.slice(r.start*5,r.end*5),buffer=new THREE.InterleavedBuffer(data,5),geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));geometry.setAttribute('uv',new THREE.InterleavedBufferAttribute(buffer,2,3));creasedShellNormals(geometry);geometry.computeBoundingSphere();
  const texture=r.texture?textures.get(r.texture)||null:null;
  if(!texture){geometry.setAttribute('color',shellColourAttribute(array,parts,r.start,r.end));geometry.setAttribute('aRel',shellHeightAttribute(array,parts,r.start,r.end));}
  const material=texture?new THREE.MeshStandardMaterial({map:texture,roughness:.86,side:THREE.DoubleSide}):facadeGrain(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.86,side:THREE.DoubleSide}),{windows:true});
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=false;mesh.receiveShadow=true;mesh.userData.range=[r.start,r.end]; // source vertex range (occlusion tests per part)
  if(mask){const bid=new Float32Array(r.end-r.start);for(const p of parts)if(p.start>=r.start&&p.start<r.end)bid.fill(index.get(p),p.start-r.start,p.start-r.start+p.count);geometry.setAttribute('aBid',new THREE.BufferAttribute(bid,1));
   const uniforms={uMask:{value:mask.data},uMaskOn:{value:0}};maskShader(material,uniforms);mesh.customDepthMaterial=maskShader(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}),uniforms,{fragment:false});mesh.userData.maskOn=uniforms.uMaskOn;mesh.userData.mask=mask;}
  geometry.computeBoundingBox();
  // An empty box keeps the chase-camera occlusion fade from ever grabbing a whole tile; tileBox is for distance.
  Object.assign(mesh.userData,{lod:true,occlusion:{opacity:1,clearTime:1},box:new THREE.Box3(),tileBox:geometry.boundingBox.clone(),triangles:(r.end-r.start)/3});
  return mesh;
 });
}

// Per-mesh visibility and shadow casting for one tile at a level. Only shells near the car cast.
export function applyTileLod(group,level,focus,bands=LOD){
 group.userData.level=level;group.visible=level!=='hidden';
 if(!group.visible)return level;
 for(const mesh of group.children)applyMeshLod(mesh,level,focus,bands);
 return level;
}
// One mesh at its tile's level (newly landed detail does not need the whole tile walked again).
// castByTile: the tile's shadow casters (merged measured shells drawn only into the shadow map, main.js) cast for
// this mesh, so it never casts itself. shadowCaster: one of those casters; main.js shows it during the shadow pass.
export function applyMeshLod(mesh,level,focus,bands=LOD){
 const u=mesh.userData;
 if(u.shadowCaster)return;
 if(u.lod){
  // Masked shells also stand in at the near level for buildings whose detail has not landed yet.
  const waiting=!!u.maskOn&&level==='near'&&(u.mask?.shown??1)>0;
  mesh.visible=level==='far'||waiting;if(u.maskOn)u.maskOn.value=level==='near'?1:0;
  mesh.castShadow=waiting&&!u.castByTile&&u.tileBox.distanceToPoint(focus)<bands.shadow;return;}
 const d=u.box.distanceToPoint(focus);
 if(u.source){mesh.visible=level==='near';mesh.castShadow=mesh.visible&&!u.castByTile&&d<bands.shadow;return;}
 const hero=!!u.shell&&u.role==='detail';
 mesh.visible=level==='near'?!!(u.shell||u.provisional||d<bands.detail):hero;
 mesh.castShadow=!!u.shell&&!u.castByTile&&level==='near'&&mesh.visible&&d<bands.shadow;
}

// Buildings never move: skip them in the renderer's per-frame matrix walk. New children must call
// updateMatrixWorld(true) themselves once (see freezeMesh).
export function freezeTileGroup(group){
 group.updateMatrixWorld(true);group.traverse(o=>{o.matrixAutoUpdate=false;});
 group.updateMatrixWorld=()=>{};
}
export function freezeMesh(mesh){mesh.updateMatrixWorld(true);mesh.matrixAutoUpdate=false;}

// Street trees: 16k instanced canopies were 320 triangles each at any distance, and every
// chunk cast shadows. Canopy detail steps down with distance; chunks past the fog are hidden.
// Authored EZ-Tree buckets (~35k triangles per tree) stand in close; past the hysteresis band the
// chunk's blob proxies take over, so the harbour and Esplanadi no longer cost millions of triangles.
// Authored buckets carry two EZ-Tree sets ({near,far} instanced meshes sharing one silhouette):
// full canopy inside detailNear/detailFar, the reduced set out to midFar, blob proxies beyond.
// detailShadow: authored canopies render a second time into the shadow map, so only those whose
// shadow the driving camera can read cast (the band is measured to the whole cell, so trees up to
// ~120 m away still cast); the Mannerheimintie rows would otherwise double their triangle cost.
export const TREE_LOD={full:160,medium:450,visible:850,shadow:200,detailShadow:150,detailNear:150,detailFar:180,midNear:430,midFar:470};
export function treeLeafDetail(distance,bands=TREE_LOD){return distance<bands.full?2:distance<bands.medium?1:0;}
export function detailedTreeLevel(previous,distance,bands=TREE_LOD){
 if(distance<bands.detailNear)return 'near';
 if(distance>bands.midFar)return 'far';
 if(distance>bands.detailFar&&distance<bands.midNear)return 'mid';
 if(distance<=bands.detailFar)return previous==='near'?'near':'mid';
 return previous==='far'?'far':'mid';
}
export function applyTreeLod(chunks,focus,leafGeometries,bands=TREE_LOD){
 for(const c of chunks){
  const d=c.box.distanceToPoint(focus);
  let proxy=d<bands.visible;
  if(c.detailed){
   c.level=detailedTreeLevel(c.level,d,bands);
   const near=c.level==='near',mid=c.level==='mid';
   for(const m of c.detailed.near||[]){m.visible=near;m.castShadow=near&&d<bands.detailShadow;}
   for(const m of c.detailed.far||[]){m.visible=mid;m.castShadow=false;}
   proxy=proxy&&!near&&!mid;
  }
  c.trunk.visible=c.leaf.visible=proxy;
  const geometry=leafGeometries[treeLeafDetail(d,bands)];if(c.leaf.geometry!==geometry)c.leaf.geometry=geometry;
  c.trunk.castShadow=c.leaf.castShadow=proxy&&d<bands.shadow;
 }
}

// Static scenery (parked fleets, kerbs, props) casts shadows only near the car. Objects are matched
// by world bounding box; collect() runs again periodically so later additions join. Tile groups and
// anything flagged userData.shadowLod manage their own casting.
export function createStaticShadowCuller(root,{range=140,every=8}={}){
 let entries=[],tick=0;
 function collect(){
  entries=[];
  const walk=o=>{
   if(o.userData?.textures||o.userData?.shadowLod)return;
   if((o.isMesh||o.isInstancedMesh)&&o.geometry){
    if(o.userData.castShadowWanted===undefined){if(!o.castShadow)return;o.userData.castShadowWanted=true;}
    let box;if(o.isInstancedMesh){if(!o.boundingBox)o.computeBoundingBox();box=o.boundingBox.clone();}else{if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();box=o.geometry.boundingBox.clone();}
    if(!box.isEmpty())entries.push({object:o,box:box.applyMatrix4(o.matrixWorld)});
   }
   for(const c of o.children)walk(c);
  };
  walk(root);
 }
 return {
  collect,
  update(focus){if(tick++%every===0)collect();for(const e of entries)e.object.castShadow=e.box.distanceToPoint(focus)<range;},
  get size(){return entries.length;}
 };
}
