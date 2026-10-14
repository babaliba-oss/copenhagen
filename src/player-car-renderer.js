import * as THREE from 'three';
import {createVehicle,animateVehicle} from './vehicles.js';
import {createVehicleDamage} from './vehicle-damage.js';
import {groundPose} from './terrain.js';
const slope={y:0,pitch:0,roll:0};
import {unregisterEnvMaterial} from './environment.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// A stable scene root follows whichever car is in use. Abandoned cars stay put.
export function createPlayerCarRenderer(scene){
 const active=new THREE.Group(),parked=new THREE.Group();active.name='Current player car';parked.name='Player parked cars';scene.add(active,parked);
 // Terrain pitch/roll are measured in the car's frame, then turned by heading.
 active.rotation.order='YXZ';
 const starter=createVehicle(0,true),entries=new Map();let home=null,current=null;
 const build=(model,owned=false)=>{
  const shared=new Set();model.traverse(m=>{if(m.isMesh)shared.add(m.geometry);});
  const damage=createVehicleDamage(model),privateGeometry=new Set(),materials=new Set();
  model.traverse(m=>{if(m.isMesh){if(!shared.has(m.geometry))privateGeometry.add(m.geometry);if(m.material.name==='paint')materials.add(m.material);}});
  return {model,damage,dispose(){model.removeFromParent();for(const g of privateGeometry)g.dispose();if(owned)for(const m of materials){unregisterEnvMaterial(m);m.dispose();}}};
 };
 const first=build(starter);active.add(starter);active.userData=starter.userData;
 return {group:active,sync(travel,dt=0){
  if(home!==travel.homeCar){for(const entry of entries.values())if(entry!==first)entry.dispose();entries.clear();home=travel.homeCar;entries.set(home,first);current=null;first.damage.update({damageVersion:-1});}
  for(const car of travel.cars)if(!entries.has(car)){const visual=car.visual||{},model=createVehicle(0,false,visual.type||'sedan');if(visual.paint)model.traverse(m=>{if(m.isMesh&&m.material.name==='paint')m.material.color.set(visual.paint);});entries.set(car,build(model,true));}
  const selected=entries.get(travel.car);
  if(current!==selected){if(current)parked.add(current.model);active.add(selected.model);selected.model.position.set(0,0,0);selected.model.rotation.set(0,0,0);active.userData=selected.model.userData;current=selected;}
  for(const [car,entry]of entries){entry.damage.update(car);if(entry===selected)continue;parked.add(entry.model);groundPose(car.x,car.z,car.heading,1.4,.8,slope);entry.model.position.set(car.x,.12+slope.y,car.z);entry.model.rotation.set(slope.pitch,car.heading,slope.roll,'YXZ');entry.model.visible=Math.hypot(car.x-travel.actor.x,car.z-travel.actor.z)<650;animateVehicle(entry.model,0,0,dt,false);}
  selected.model.visible=true;
 },setVisible(visible){active.visible=parked.visible=visible;},
 // Swap the starter's procedural body for a Blender-made one (scripts/blender/player-car.py). Meshes are merged
 // per material name and take the starter's own materials (paint colour, env reflections); wheels stay.
 async upgradeBody(url){
  const gltf=await new GLTFLoader().loadAsync(url),body=starter.userData.body;if(!body)return false;
  const byName=new Map();for(const m of body.children)if(m.isMesh)byName.set(m.material.name,m.material);
  const groups=new Map();gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o=>{if(!o.isMesh)return;const name=(o.material?.name||'').replace(/\.\d+$/,'');const mat=byName.get(name);if(!mat)return;
   const g=o.geometry.clone().applyMatrix4(o.matrixWorld);for(const k of Object.keys(g.attributes))if(k!=='position'&&k!=='normal')g.deleteAttribute(k);
   if(!groups.has(name))groups.set(name,[]);groups.get(name).push(g.index?g.toNonIndexed():g);});
  if(!groups.has('paint'))return false;
  for(const m of [...body.children]){body.remove(m);m.geometry.dispose();}
  for(const [name,gs] of groups){const mesh=new THREE.Mesh(mergeGeometries(gs),byName.get(name));mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;body.add(mesh);gs.forEach(g=>g.dispose());}
  first.damage=createVehicleDamage(starter);first.damage.update({damageVersion:-1});return true;
 }};
}
