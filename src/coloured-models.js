import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Blender models made of plain coloured materials (scripts/blender/*.py) become one merged, non-indexed
// geometry with the material colours baked into a `color` attribute, ready for the game's vertex-coloured,
// instanced meshes. Resolves to null when the file cannot be loaded, so callers keep their procedural model.
const loader=new GLTFLoader();
// The parts of a model: one geometry (position, normal) and colour per material, in the model's frame.
export async function loadColouredParts(url){
 try{
  const gltf=await loader.loadAsync(url);gltf.scene.updateMatrixWorld(true);const parts=[];
  gltf.scene.traverse(o=>{if(!o.isMesh)return;let g=o.geometry.clone().applyMatrix4(o.matrixWorld);for(const k of Object.keys(g.attributes))if(k!=='position'&&k!=='normal')g.deleteAttribute(k);
   if(g.index){const n=g.toNonIndexed();g.dispose();g=n;}parts.push({name:(o.material?.name||'').replace(/\.\d+$/,''),geometry:g,color:(o.material?.color||new THREE.Color(1,1,1)).clone()});o.geometry.dispose();});
  return parts.length?parts:null;
 }catch(e){console.warn('Model not loaded, procedural kept:',url,e?.message||e);return null;}
}
// Bake parts into one geometry with a `color` attribute; `recolour` maps a material name to a hex colour.
// `paint` names a material whose vertices get paint = 1 (others 0) in a `paint` attribute, for models the game tints.
export function bakeColoured(parts,recolour={},{paint=null}={}){
 const gs=parts.map(({name,geometry,color})=>{const g=geometry.clone(),c=recolour[name]!=null?new THREE.Color(recolour[name]):color,n=g.attributes.position.count,a=new Float32Array(n*3);for(let i=0;i<a.length;i+=3){a[i]=c.r;a[i+1]=c.g;a[i+2]=c.b;}g.setAttribute('color',new THREE.BufferAttribute(a,3));if(paint)g.setAttribute('paint',new THREE.BufferAttribute(new Float32Array(n).fill(name===paint?1:0),1));return g;});
 const merged=mergeGeometries(gs);gs.forEach(g=>g.dispose());merged?.computeBoundingSphere();return merged;
}
export async function loadColouredModel(url,recolour){const parts=await loadColouredParts(url);if(!parts)return null;const g=bakeColoured(parts,recolour);parts.forEach(p=>p.geometry.dispose());return g;}
export async function loadColouredModels(base,names){
 const out={};await Promise.all(names.map(async n=>{const g=await loadColouredModel(`${base}${n}.glb`);if(g)out[n]=g;}));return out;
}
// The Halloween pumpkins (scripts/models/pumpkins.py): meshes named <model><level>_<part> with their own vertex colours
// (COLOR_0, linear), e.g. A0_body, A0_glow, A1_body. Resolves to {A:{0:{body,glow},1:{body,glow}},...} or null.
export async function loadPumpkins(url){
 try{
  const gltf=await loader.loadAsync(url),out={};
  gltf.scene.traverse(o=>{const m=o.isMesh&&/^([A-Z])([01])_(body|glow)$/.exec(o.name);if(!m)return;const g=o.geometry;for(const k of Object.keys(g.attributes))if(!['position','normal','color'].includes(k))g.deleteAttribute(k);
   g.computeBoundingSphere();((out[m[1]]??={})[m[2]]??={})[m[3]]=g;});
  return Object.keys(out).length?out:null;
 }catch(e){console.warn('Pumpkins not loaded, procedural kept:',e?.message||e);return null;}
}
