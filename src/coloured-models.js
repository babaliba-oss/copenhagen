import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Blender models made of plain coloured materials (scripts/blender/*.py) become one merged, non-indexed
// geometry with the material colours baked into a `color` attribute, ready for the game's vertex-coloured,
// instanced meshes. Resolves to null when the file cannot be loaded, so callers keep their procedural model.
const loader=new GLTFLoader();
export async function loadColouredModel(url){
 try{
  const gltf=await loader.loadAsync(url);gltf.scene.updateMatrixWorld(true);const parts=[];
  gltf.scene.traverse(o=>{if(!o.isMesh)return;let g=o.geometry.clone().applyMatrix4(o.matrixWorld);for(const k of Object.keys(g.attributes))if(k!=='position'&&k!=='normal')g.deleteAttribute(k);
   if(g.index){const n=g.toNonIndexed();g.dispose();g=n;}const c=o.material?.color||new THREE.Color(1,1,1),a=new Float32Array(g.attributes.position.count*3);for(let i=0;i<a.length;i+=3){a[i]=c.r;a[i+1]=c.g;a[i+2]=c.b;}
   g.setAttribute('color',new THREE.BufferAttribute(a,3));parts.push(g);o.geometry.dispose();});
  const merged=parts.length?mergeGeometries(parts):null;parts.forEach(g=>g.dispose());merged?.computeBoundingSphere();return merged;
 }catch(e){console.warn('Model not loaded, procedural kept:',url,e?.message||e);return null;}
}
export async function loadColouredModels(base,names){
 const out={};await Promise.all(names.map(async n=>{const g=await loadColouredModel(`${base}${n}.glb`);if(g)out[n]=g;}));return out;
}
