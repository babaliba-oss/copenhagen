import * as THREE from 'three';
import {litWindows} from './night-windows.js';
import {facadeGrain} from './facade-grain.js';
import {signMaterial} from './shop-signs.js';
import {shellColourAttribute,shellHeightAttribute} from './shell-colors.js';
let worker,id=0;const pending=new Map();
// Cheap, measured textured shells are visible before the worker infers details.
// Copy the part data: the original tile buffer is transferred to the worker.
export function createSourceShell(array,part,texture){
 const data=array.slice(part.start*5,(part.start+part.count)*5),buffer=new THREE.InterleavedBuffer(data,5),geometry=new THREE.BufferGeometry();
 geometry.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));geometry.setAttribute('uv',new THREE.InterleavedBufferAttribute(buffer,2,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();
 if(!texture){geometry.setAttribute('color',shellColourAttribute(array,[part],part.start,part.start+part.count));geometry.setAttribute('aRel',shellHeightAttribute(array,[part],part.start,part.start+part.count));}
 const material=texture?new THREE.MeshStandardMaterial({map:texture,roughness:.8,side:THREE.DoubleSide,forceSinglePass:true}):facadeGrain(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8,side:THREE.DoubleSide,forceSinglePass:true}),{windows:true});
 const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=true;mesh.receiveShadow=true;mesh.userData={shell:true,source:true,id:part.id,occlusion:{opacity:1,clearTime:1},box:new THREE.Box3(new THREE.Vector3(part.bbox[0]-.5,0,part.bbox[1]-.5),new THREE.Vector3(part.bbox[2]+.5,part.height+.5,part.bbox[3]+.5))};return mesh;
}
// `images` maps an atlas file to either its encoded bytes (ArrayBuffer, decoded in the worker) or
// already-read pixels {data,width,height}. Both are transferred, not copied.
export function buildTileInWorker(array,parts,images){
 if(!worker){worker=new Worker(new URL('./building-worker.js',import.meta.url),{type:'module'});worker.onmessage=({data})=>{const job=pending.get(data.id);if(!job)return;pending.delete(data.id);data.error?job.reject(Error(data.error)):job.resolve(data.buildings);};worker.onerror=event=>{for(const job of pending.values())job.reject(Error(event.message));pending.clear();worker.terminate();worker=null;};}
 const jobId=++id,pixels=Object.fromEntries(images),transfer=[array.buffer,...[...images.values()].map(p=>p instanceof ArrayBuffer?p:p.data.buffer)];
 return new Promise((resolve,reject)=>{pending.set(jobId,{resolve,reject});worker.postMessage({id:jobId,array,parts,pixels},[...new Set(transfer)]);});
}
export function materialiseBuilding(data,textures){
 const p=data.part,box=new THREE.Box3(new THREE.Vector3(p.bbox[0]-.5,0,p.bbox[1]-.5),new THREE.Vector3(p.bbox[2]+.5,p.height+.5,p.bbox[3]+.5)),occlusion={opacity:1,clearTime:1};
 return data.meshes.map(source=>{
  const geometry=new THREE.BufferGeometry();for(const [name,a] of Object.entries(source.attributes))geometry.setAttribute(name,new THREE.BufferAttribute(a.array,a.itemSize,a.normalized));if(source.index)geometry.setIndex(new THREE.BufferAttribute(source.index,1));geometry.computeBoundingSphere();
  const {textured,signs,combined,...values}=source.material,material=signs?signMaterial():new THREE.MeshStandardMaterial({...values,map:textured?textures.get(p.texture):null,forceSinglePass:true});if(signs){material.transparent=true;material.forceSinglePass=true;}
  if(source.shell&&!textured)facadeGrain(material);
  if(combined)litWindows(material,{attribute:'aGlass'});
  else if((values.roughness===.19&&values.metalness===.55)||(values.roughness===.3&&values.metalness===.1&&values.vertexColors))litWindows(material); // window glazing (building-detail.js) lights up at night
  const mesh=new THREE.Mesh(geometry,material);mesh.castShadow=source.shell;mesh.receiveShadow=true;mesh.userData={box,occlusion,shell:source.shell,ratu:p.ratu,role:source.role||'detail',provisional:!!source.provisional};return mesh;
 });
}
