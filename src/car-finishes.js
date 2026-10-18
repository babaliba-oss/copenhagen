import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {registerEnvMaterial,unregisterEnvMaterial} from './environment.js';
import {createVehicleMaterials} from './vehicle-models.js';

// Every car finish except the paint in one material: a texel per finish holds its colour (map), roughness and
// metalness, how strongly it reflects the shared sky (an ORM texture: ambient occlusion scales the reflection down
// per finish) and its lamp glow (emissiveMap). Parts carry their texel in their UVs, so glass, trim, lamps, plates
// and wheels draw together: the traffic fleet needs three batches per body style instead of ten, the player car
// seven meshes instead of twenty (twice that with shadows).
export const FINISHES=['glass','rubber','black','chrome','head','tail','plate'];
const REFLECT={glass:1.5,chrome:1.1,black:.7,head:.6,tail:.6,rubber:.35,plate:.6},REFLECT_MAX=1.5,W=8;
let finishes=null;
export function finishMaterial(){
 if(finishes)return finishes;
 const source=createVehicleMaterials(),col=new Uint8Array(W*4).fill(255),orm=new Uint8Array(W*4).fill(255),emi=new Uint8Array(W*4),rgb={},byte=v=>Math.max(0,Math.min(255,Math.round(v*255)));
 FINISHES.forEach((name,i)=>{const m=source[name];if(!m)return;m.color.getRGB(rgb,THREE.SRGBColorSpace);col.set([byte(rgb.r),byte(rgb.g),byte(rgb.b)],i*4);
  orm.set([byte((REFLECT[name]??.5)/REFLECT_MAX),byte(m.roughness),byte(m.metalness)],i*4);
  if(m.emissive&&m.emissiveIntensity>0){m.emissive.clone().multiplyScalar(m.emissiveIntensity).getRGB(rgb,THREE.SRGBColorSpace);emi.set([byte(rgb.r),byte(rgb.g),byte(rgb.b),255],i*4);}});
 for(const m of Object.values(source)){unregisterEnvMaterial(m);m.dispose();}
 const texture=(data,srgb)=>{const t=new THREE.DataTexture(data,W,1,THREE.RGBAFormat,THREE.UnsignedByteType);t.magFilter=t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;if(srgb)t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;return t;};
 const ormMap=texture(orm,false);
 finishes=registerEnvMaterial(new THREE.MeshStandardMaterial({color:'#ffffff',roughness:1,metalness:1,map:texture(col,true),roughnessMap:ormMap,metalnessMap:ormMap,aoMap:ormMap,emissive:'#ffffff',emissiveIntensity:1,emissiveMap:texture(emi,true)}),REFLECT_MAX);
 finishes.name='finishes';return finishes;
}
// Meshes merged into the frame of `frame` (an Object3D; when it is one of the meshes its own geometry stays put),
// each vertex tagged with its finish's texel. Unknown finishes read as black trim.
const inverse=new THREE.Matrix4(),relative=new THREE.Matrix4();
export function finishGeometry(meshes,frame){
 inverse.copy(frame.matrixWorld).invert();
 const gs=meshes.map(m=>{const g=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();
  const tagged=m.material===finishes&&g.attributes.uv; // already palette-tagged (a merged mesh merged again)
  for(const k of Object.keys(g.attributes))if(k!=='position'&&k!=='normal'&&!(tagged&&k==='uv'))g.deleteAttribute(k);if(!g.attributes.normal)g.computeVertexNormals();
  if(m!==frame)g.applyMatrix4(relative.multiplyMatrices(inverse,m.matrixWorld));
  if(tagged)return g;
  const f=FINISHES.indexOf(m.userData.finish||m.material.name),u=((f<0?FINISHES.indexOf('black'):f)+.5)/W,uv=new Float32Array(g.attributes.position.count*2);
  for(let k=0;k<uv.length;k+=2){uv[k]=u;uv[k+1]=.5;}g.setAttribute('uv',new THREE.BufferAttribute(uv,2));return g;});
 const merged=mergeGeometries(gs);gs.forEach(g=>g.dispose());merged.computeBoundingSphere();return merged;
}
// A drawn car (player, parked player cars): body finishes other than `keep` become one mesh, each wheel one mesh.
// Removed meshes keep their geometry and material (template clones share them); the caller owns disposal.
export function consolidateCar(model,{keep=['paint','tail']}={}){
 model.updateMatrixWorld(true);const material=finishMaterial(),body=model.userData.body;
 if(body){const merge=body.children.filter(m=>m.isMesh&&!keep.includes(m.userData.finish||m.material.name)&&m.name!=='finishes');
  if(merge.length){const old=body.children.find(m=>m.name==='finishes');if(old)merge.push(old);
   const mesh=new THREE.Mesh(finishGeometry(merge,body),material);mesh.name='finishes';mesh.castShadow=mesh.receiveShadow=true;
   for(const m of merge)body.remove(m);body.add(mesh);}}
 for(const w of model.userData.wheels||[]){const ms=[];w.spin.traverse(o=>{if(o.isMesh)ms.push(o);});if(ms.length<2)continue;
  const lead=ms[0],mesh=new THREE.Mesh(finishGeometry(ms,lead),material);mesh.name='wheel';mesh.castShadow=true;mesh.receiveShadow=true;
  mesh.position.copy(lead.position);mesh.quaternion.copy(lead.quaternion);mesh.scale.copy(lead.scale);for(const m of ms)m.removeFromParent();w.spin.add(mesh);}
 return model;
}
