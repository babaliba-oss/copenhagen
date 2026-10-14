import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {installVehicleBodies,VEHICLE_TYPES} from './vehicle-models.js';

// Loads the Blender car bodies (public/models/vehicles/<type>.glb, scripts/blender/vehicles.py) and installs
// them for the traffic, parked and enterable cars. Each file becomes one merged geometry per material name
// (position and normal only); the game's own vehicle materials are used at build time. A type that fails to
// load keeps its procedural body, so this never blocks the game.
export async function loadVehicleBodies(base='/models/vehicles/',types=VEHICLE_TYPES){
 const loader=new GLTFLoader(),out={};
 await Promise.all(types.map(async type=>{
  try{
   const gltf=await loader.loadAsync(`${base}${type}.glb`);gltf.scene.updateMatrixWorld(true);const groups=new Map();
   gltf.scene.traverse(o=>{if(!o.isMesh)return;const name=(o.material?.name||'').replace(/\.\d+$/,'');if(!name)return;
    let g=o.geometry.clone().applyMatrix4(o.matrixWorld);for(const k of Object.keys(g.attributes))if(k!=='position'&&k!=='normal')g.deleteAttribute(k);
    if(g.index){const n=g.toNonIndexed();g.dispose();g=n;}if(!groups.has(name))groups.set(name,[]);groups.get(name).push(g);o.geometry.dispose();});
   const parts=new Map();for(const [name,gs] of groups){const merged=mergeGeometries(gs);gs.forEach(g=>g.dispose());if(merged)parts.set(name,merged);}
   out[type]=parts;
  }catch(e){console.warn(`Vehicle body ${type} not loaded, procedural kept`,e?.message||e);}
 }));
 return installVehicleBodies(out);
}
