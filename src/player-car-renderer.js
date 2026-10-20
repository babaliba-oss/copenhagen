import * as THREE from 'three';
import {createVehicle,animateVehicle} from './vehicles.js';
import {createVehicleDamage} from './vehicle-damage.js';
import {groundPose} from './terrain.js';
import {WEATHER_UNIFORMS} from './weather.js';
const slope={y:0,pitch:0,roll:0};
import {unregisterEnvMaterial} from './environment.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {consolidateCar,finishMaterial,FINISHES} from './car-finishes.js';

// A stable scene root follows whichever car is in use. Abandoned cars stay put.
export function createPlayerCarRenderer(scene){
 const active=new THREE.Group(),parked=new THREE.Group();active.name='Current player car';parked.name='Player parked cars';scene.add(active,parked);
 // Terrain pitch/roll are measured in the car's frame, then turned by heading.
 active.rotation.order='YXZ';
 const starter=createVehicle(0,true),entries=new Map();let home=null,current=null;
 const build=(model,owned=false)=>{
  const shared=new Set();model.traverse(m=>{if(m.isMesh)shared.add(m.geometry);});
  consolidateCar(model); // 7 meshes instead of 20: glass, trim and lamps in one, each wheel in one (car-finishes.js)
  const damage=createVehicleDamage(model),privateGeometry=new Set(),materials=new Set();
  model.traverse(m=>{if(m.isMesh){if(!shared.has(m.geometry))privateGeometry.add(m.geometry);if(m.material.name==='paint')materials.add(m.material);}});
  return {model,damage,dispose(){model.removeFromParent();for(const g of privateGeometry)g.dispose();if(owned)for(const m of materials){unregisterEnvMaterial(m);m.dispose();}}};
 };
 const first=build(starter);active.add(starter);active.userData=starter.userData;
 // Headlights after dark: two warm lamp glows and a soft beam pool on the road ahead (no real light: a scene
 // light would recompile every material and cost every pixel). Forward is -Z in the car's frame.
 const lights=new THREE.Group();lights.name='Headlights';lights.visible=false;active.add(lights);
 {const c=typeof document!=='undefined'?document.createElement('canvas'):null;let tex=null;
  if(c){c.width=64;c.height=128;const g=c.getContext('2d'),img=g.createImageData(64,128);for(let y=0;y<128;y++)for(let x=0;x<64;x++){const t=1-y/127,w=.18+.82*t,u=(x-31.5)/31.5/w,v=Math.max(0,1-u*u)*(1-t*.5)*Math.min(1,t*4+.25),k=(y*64+x)*4,b=Math.round(255*v);img.data[k]=img.data[k+1]=img.data[k+2]=b;img.data[k+3]=255;}g.putImageData(img,0,0);tex=new THREE.CanvasTexture(c); /* a beam widening and fading away from the car (canvas top = far end) */}
  const pool=new THREE.Mesh(new THREE.PlaneGeometry(7,16).rotateX(-Math.PI/2).translate(0,.22,-10.5),new THREE.MeshBasicMaterial({color:'#fff1d6',alphaMap:tex,transparent:true,opacity:.7,depthWrite:false,blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-4}));pool.name='Headlight beam';
  const glowMat=new THREE.MeshBasicMaterial({color:'#fff6e4',toneMapped:false});
  for(const x of [-.62,.62]){const m=new THREE.Mesh(new THREE.SphereGeometry(.09,8,6),glowMat);m.position.set(x,.72,-2.18);lights.add(m);}
  lights.add(pool);}

 const api={headlights:true,group:active,sync(travel,dt=0){
  if(home!==travel.homeCar){for(const entry of entries.values())if(entry!==first)entry.dispose();entries.clear();home=travel.homeCar;entries.set(home,first);current=null;first.damage.update({damageVersion:-1});}
  for(const car of travel.cars)if(!entries.has(car)){const visual=car.visual||{},model=createVehicle(0,false,visual.type||'sedan');if(visual.paint)model.traverse(m=>{if(m.isMesh&&m.material.name==='paint')m.material.color.set(visual.paint);});entries.set(car,build(model,true));}
  for(const [car,entry]of entries)if(entry!==first&&!travel.cars.includes(car)){if(current===entry)current=null;entry.dispose();entries.delete(car);} // given back to traffic (PlayerTravel.forgetFar)
  const selected=entries.get(travel.car);
  if(current!==selected){if(current)parked.add(current.model);active.add(selected.model);active.children.splice(active.children.indexOf(selected.model),1);active.children.unshift(selected.model); /* the car model stays the first child (headlights after it) */selected.model.position.set(0,0,0);selected.model.rotation.set(0,0,0);active.userData=selected.model.userData;current=selected;}
  for(const [car,entry]of entries){entry.damage.update(car);if(entry===selected)continue;parked.add(entry.model);groundPose(car.x,car.z,car.heading,1.4,.8,slope);entry.model.position.set(car.x,.12+slope.y,car.z);entry.model.rotation.set(slope.pitch,car.heading,slope.roll,'YXZ');entry.model.visible=Math.hypot(car.x-travel.actor.x,car.z-travel.actor.z)<650;animateVehicle(entry.model,0,0,dt,false);}
  selected.model.visible=true;lights.visible=api.headlights&&WEATHER_UNIFORMS.night.value>.5&&travel.car===travel.homeCar;
 },setVisible(visible){active.visible=parked.visible=visible;},
 // Swap the starter's procedural body for a Blender-made one (scripts/blender/player-car.py). Meshes are merged
 // per material name and take the starter's own materials (paint colour, env reflections); wheels stay.
 async upgradeBody(url){
  const gltf=await new GLTFLoader().loadAsync(url),body=starter.userData.body;if(!body)return false;
  const byName=new Map();for(const m of body.children)if(m.isMesh)byName.set(m.material.name,m.material);
  for(const name of FINISHES)if(!byName.has(name))byName.set(name,finishMaterial()); // merged into the palette mesh below (consolidateCar)
  const groups=new Map();gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse(o=>{if(!o.isMesh)return;const name=(o.material?.name||'').replace(/\.\d+$/,'');const mat=byName.get(name);if(!mat)return;
   const g=o.geometry.clone().applyMatrix4(o.matrixWorld);for(const k of Object.keys(g.attributes))if(k!=='position'&&k!=='normal')g.deleteAttribute(k);
   if(!groups.has(name))groups.set(name,[]);groups.get(name).push(g.index?g.toNonIndexed():g);});
  if(!groups.has('paint'))return false;
  for(const m of [...body.children]){body.remove(m);m.geometry.dispose();}
  const merged=[];for(const [name,gs] of groups){const mesh=new THREE.Mesh(mergeGeometries(gs),byName.get(name));mesh.name=name;mesh.userData.finish=name;mesh.castShadow=mesh.receiveShadow=true;body.add(mesh);merged.push(mesh.geometry);gs.forEach(g=>g.dispose());}
  consolidateCar(starter);
  const before=[];starter.traverse(o=>{if(o.isMesh&&!merged.includes(o.geometry))before.push(o.geometry);});
  first.damage=createVehicleDamage(starter);const live=new Set();starter.traverse(o=>{if(o.isMesh)live.add(o.geometry);});[...merged,...before].forEach(g=>{if(!live.has(g))g.dispose();}); // damage replaced these with its own clones (the old damage's clones too)
  return true;
 }};
 return api;
}
