import * as THREE from 'three';
import {facadeGrain} from './facade-grain.js';
import {litWindows} from './night-windows.js';
import {signMaterial} from './shop-signs.js';

// A near tile's detailed buildings as a few merged batches, one per material look (atlas, colours, finish, shader
// variant), instead of one to three meshes per building: 50-70 draw calls at Nyhavn became a handful. The worker's
// meshes for the whole tile are known up front, so every batch is allocated at its final size and each building's
// vertices are copied in when it lands (a partial upload). A per-part visibility uniform (uDetail, one float per part,
// like the merged shells' mask) shows a part once it has landed, hides it when it hands back to the merged shell
// beyond LOD.building, and dithers it while the chase camera fades it (a separate shader variant, so the usual
// opaque one keeps early depth testing). Shop signs batch too (one shared atlas); authored hero fronts stay their own meshes.
export function batched(source){return !!source.role&&source.role!=='detail';}
// Mesh look: everything materialiseBuilding (building-loader.js) derives a material from, plus the attribute set.
export function batchKey(part,source){
 const m=source.material,attrs=Object.keys(source.attributes).sort().join(',');
 return JSON.stringify([m.signs?'signs':m.color,m.roughness,m.metalness,m.side,!!m.vertexColors,m.textured?part.texture:null,m.combined,source.shell&&!m.textured?(part.noFacade?'stone':'grain'):'',attrs]);
}
function batchMaterial(part,source,textures,uniforms){
 const {textured,signs,combined,...values}=source.material;let material;
 if(signs){material=typeof document!=='undefined'?signMaterial():new THREE.MeshStandardMaterial({roughness:.6});material.transparent=true;material.forceSinglePass=true;} // shop signs: the shared sign atlas (drawn on a canvas), lit after dark
 else{material=new THREE.MeshStandardMaterial({...values,map:textured?textures.get(part.texture)||null:null});
  if(source.shell&&!textured)facadeGrain(material,{stone:!!part.noFacade});
  if(combined)litWindows(material,{attribute:'aGlass'});
  else if((values.roughness===.19&&values.metalness===.55)||(values.roughness===.3&&values.metalness===.1&&values.vertexColors))litWindows(material);}
 const prev=material.onBeforeCompile,prevKey=material.customProgramCacheKey?.bind(material);
 material.onBeforeCompile=(shader,renderer)=>{prev?.call(material,shader,renderer);Object.assign(shader.uniforms,uniforms);
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float aBid;uniform vec4 uDetail[64];varying float vDetail;')
   .replace('#include <project_vertex>','#include <project_vertex>\nvDetail=1.;if(aBid<255.5){int bi=int(aBid+.5);vDetail=uDetail[bi>>2][bi&3];}if(vDetail<.002)gl_Position=vec4(0.,0.,2.,1.);');
  if(material.userData.dither)shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vDetail;')
   .replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif(vDetail<.996&&fract(52.9829189*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))))>vDetail)discard;');
 };
 material.customProgramCacheKey=()=>(prevKey?prevKey():'')+'|detail-mask'+(material.userData.dither?'-dither':'');
 return material;
}
const vertexCount=s=>s.index?s.index.length:s.attributes.position.array.length/s.attributes.position.itemSize;
// Batches are also split into 64 m cells: a batch draws every vertex it holds (hidden parts are only collapsed in the
// vertex shader), so a cell keeps the work to what is near and in view, and a cell with nothing shown is not drawn.
export const CELL=64;
// buildings: the worker's output for one tile; partOf(building) -> part index in the tile mask (or -1).
export function createBuildingBatches(buildings,textures,partOf){
 const data=new Float32Array(256),uniforms={uDetail:{value:data}},groups=new Map(),placed=new Map(); // placed: source mesh -> [batch, first vertex]
 for(const b of buildings)for(const s of b.meshes){if(!batched(s))continue;const q=b.part.bbox,cell=Math.floor((q[0]+q[2])/2/CELL)+','+Math.floor((q[1]+q[3])/2/CELL);
  const key=batchKey(b.part,s)+cell;let g=groups.get(key);if(!g)groups.set(key,g={part:b.part,source:s,count:0,list:[],parts:new Set()});
  placed.set(s,[g,g.count]);g.list.push([b,s]);g.count+=vertexCount(s);const i=partOf(b);g.parts.add(i>=0&&i<256?i:-1);}
 const meshes=[],box=new THREE.Box3(),corner=new THREE.Vector3();
 for(const g of groups.values()){
  const geometry=new THREE.BufferGeometry();
  for(const [name,a] of Object.entries(g.source.attributes))geometry.setAttribute(name,new THREE.BufferAttribute(new a.array.constructor(g.count*a.itemSize),a.itemSize,a.normalized));
  const bid=new Float32Array(g.count).fill(300);for(const [b,s] of g.list){const i=partOf(b),[,first]=placed.get(s);if(i>=0&&i<256)bid.fill(i,first,first+vertexCount(s));}
  geometry.setAttribute('aBid',new THREE.BufferAttribute(bid,1));
  // Bounds from the parts (the vertices arrive later): culling must not see an empty batch at the origin.
  box.makeEmpty();for(const [b] of g.list){const p=b.part;box.expandByPoint(corner.set(p.bbox[0],-5,p.bbox[1]));box.expandByPoint(corner.set(p.bbox[2],(p.height||20)+40,p.bbox[3]));}
  geometry.boundingBox=box.clone();geometry.boundingSphere=box.getBoundingSphere(new THREE.Sphere());
  for(const a of Object.values(geometry.attributes))a.setUsage(THREE.StaticDrawUsage);
  const mesh=new THREE.Mesh(geometry,batchMaterial(g.part,g.source,textures,uniforms));mesh.name='Detailed buildings';mesh.castShadow=false;mesh.receiveShadow=true;mesh.userData.batch=true;
  g.mesh=mesh;g.shown=0;g.always=g.parts.has(-1);meshes.push(mesh);
 }
 // Which batches hold each part, and how many of a batch's parts are shown: a batch draws only while one is.
 const list=[...groups.values()],ofPart=new Map();for(const g of list)for(const i of g.parts)if(i>=0){let l=ofPart.get(i);if(!l)ofPart.set(i,l=[]);l.push(g);}
 let near=true;const show=g=>{g.mesh.visible=near&&(g.shown>0||g.always&&g.landedAlways);};
 for(const g of list)show(g);
 // Copy one building's batched meshes into place (vertices and part ids), marking just those ranges for upload.
 function land(b){
  if(!(partOf(b)>=0&&partOf(b)<256))for(const s of b.meshes){const at=placed.get(s);if(at){at[0].landedAlways=true;show(at[0]);}} // a part the mask cannot address shows once landed
  for(const s of b.meshes){const at=placed.get(s);if(!at)continue;const [g,first]=at,geometry=g.mesh.geometry,n=vertexCount(s);
   for(const [name,a] of Object.entries(s.attributes)){const dst=geometry.attributes[name];if(!dst)continue;const k=a.itemSize;
    if(s.index){const idx=s.index;for(let v=0;v<n;v++){const from=idx[v]*k,to=(first+v)*k;for(let c=0;c<k;c++)dst.array[to+c]=a.array[from+c];}}
    else dst.array.set(a.array.subarray(0,n*k),first*k);
    dst.addUpdateRange(first*k,n*k);dst.needsUpdate=true;}}
 }
 return {meshes,data,land,batched:s=>placed.has(s),
  set(i,v){if(!(i>=0&&i<256))return;const was=data[i]>0;data[i]=v;if(was!==(v>0))for(const g of ofPart.get(i)||[]){g.shown+=v>0?1:-1;show(g);}},get(i){return data[i];},
  setNear(on){near=on;for(const g of list)show(g);},
  // Camera fade: switch every batch of the tile to the dithering variant while any part fades.
  dither(on){for(const m of meshes)if(!!m.material.userData.dither!==on){m.material.userData.dither=on;m.material.needsUpdate=true;}}};
}
