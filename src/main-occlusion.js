// Split out of main.js: fading the buildings between the camera and the player (called once a frame).
import * as THREE from 'three';
import {groundAt} from './terrain.js';
import {advanceOcclusion} from './render-stability.js';
// Does the camera ray hit one waiting part's walls (its own triangles in the tile's merged shell) within `far`?
const _ra=new THREE.Vector3(),_rb=new THREE.Vector3(),_rc=new THREE.Vector3(),_rh=new THREE.Vector3(),_rl=new THREE.Ray(),_rm=new THREE.Matrix4();
function partOnRay(tile,w,ray,far){
 for(const m of tile.children){const r=m.userData.range;if(!r||w.start<r[0]||w.start>=r[1])continue;
  const p=m.geometry.attributes.position;_rl.copy(ray).applyMatrix4(_rm.copy(m.matrixWorld).invert());
  for(let v=w.start-r[0],e=Math.min(p.count,v+w.count);v+2<e;v+=3){_ra.fromBufferAttribute(p,v);_rb.fromBufferAttribute(p,v+1);_rc.fromBufferAttribute(p,v+2);
   if(_rl.intersectTriangle(_ra,_rb,_rc,false,_rh)&&_rh.applyMatrix4(m.matrixWorld).distanceTo(ray.origin)<far)return true;}
  return false;}
 return false;
}
export function fadeOccluders(dt,car,started,chaseCamera,city,camera,occlusionRay,loadedTiles){
 // Fade only the buildings between the chase camera and the player, preserving a readable road view.
 if(car&&started){const target=new THREE.Vector3(car.x,1+groundAt(car.x,car.z),car.z),ray=new THREE.Ray(camera.position.clone(),target.clone().sub(camera.position).normalize()),hit=new THREE.Vector3(),limit=camera.position.distanceTo(target);
  // Blocks from the city model are large and L-shaped: a box test alone fades a whole block the car is merely
  // next to, so shells that pass the box test are checked against their real walls.
  // Drive camera in Copenhagen: the boom already shortens before walls (drivingCameraPose), and a see-through
  // building read as broken (walls missing, windows floating), so nothing fades; Follow and High still fade.
  const noFade=chaseCamera&&city.id.startsWith('copenhagen');
  const updated=new Set(),decided=new Map();occlusionRay.ray.copy(ray);occlusionRay.far=Math.max(0,limit-3);
  for(const tile of loadedTiles.values())if(tile.visible)for(const mesh of tile.children){if(!mesh.visible||!mesh.userData.shell)continue;const state=mesh.userData.occlusion;if(!state||decided.get(state))continue;
   const near=!!ray.intersectBox(mesh.userData.box,hit)&&hit.distanceTo(camera.position)<limit-3;decided.set(state,!noFade&&near&&occlusionRay.intersectObject(mesh,false).length>0);}
  // Waiting parts: the box test alone faded whole L-shaped blocks the car was only beside (it read as a
  // building with a wall missing), so a part fades only if the camera ray really hits its walls in the merged shell.
  for(const tile of loadedTiles.values())if(tile.visible&&tile.userData.level==='near'&&tile.userData.mask?.shown){
   const boxed=new Set();for(const w of tile.userData.waiting)if(ray.intersectBox(w.box,hit)&&hit.distanceTo(camera.position)<limit-3)boxed.add(w);
   const walls=new Set();for(const w of boxed)if(partOnRay(tile,w,ray,limit-3))walls.add(w); // only the boxed parts' own triangles
   for(const w of tile.userData.waiting){const was=w.occlusion.opacity;const fade=!noFade&&walls.has(w);if(!fade&&was>.999)continue;advanceOcclusion(w.occlusion,fade,dt);tile.userData.mask.set(w.i,w.occlusion.opacity>.995?1:Math.max(.01,w.occlusion.opacity));}}
  // Detail batches: a part fades through its per-part value (and the tile's batches switch to the dithering variant).
  if(!noFade)for(const tile of loadedTiles.values()){const b=tile.userData.batches;if(!tile.visible||!b?.parts.length)continue;let fading=false;
   for(const p of b.parts){if(!p.occlusion.detailed)continue;const fade=!!ray.intersectBox(p.box,hit)&&hit.distanceTo(camera.position)<limit-3&&partOnRay(tile,p.w,ray,limit-3);
    if(!fade&&p.occlusion.opacity>.999)continue;advanceOcclusion(p.occlusion,fade,dt);b.set(p.i,p.occlusion.opacity>.995?1:Math.max(.01,p.occlusion.opacity));if(p.occlusion.opacity<.995)fading=true;}
   b.dither(fading);}
  for(const tile of loadedTiles.values())if(tile.visible)for(const mesh of tile.children){if(!mesh.visible||mesh.userData.batch)continue;const state=mesh.userData.occlusion;if(!updated.has(state)){let fade;if(decided.has(state))fade=decided.get(state);else{const intersects=!noFade&&ray.intersectBox(mesh.userData.box,hit);fade=!!intersects&&hit.distanceTo(camera.position)<limit-3;}advanceOcclusion(state,fade,dt);updated.add(state);}mesh.material.opacity=state.opacity;mesh.material.depthWrite=state.opacity>.999;const fading=state.opacity<.999;if(mesh.material.transparent!==fading){mesh.material.transparent=fading;mesh.material.needsUpdate=true;}}
 }
}
