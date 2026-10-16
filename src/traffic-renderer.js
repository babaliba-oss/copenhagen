import {WEATHER_UNIFORMS} from './weather.js';
import * as THREE from 'three';
import {createVehicle,animateVehicle,VEHICLE_TYPES} from './vehicles.js';
import {registerEnvMaterial} from './environment.js';
import {groundPose} from './terrain.js';

// Keep independent animation transforms, but draw all NPCs together: fourteen
// material/part batches instead of fourteen draw submissions for every vehicle.
// Beyond `detail` a vehicle is two instance-coloured boxes (body + cabin) in two extra
// batches per family, and past `hide` it is skipped: cars near the player keep full detail.
// Moving cars keep their full model until they are small on screen; a shape swap at 150 m was a visible pop.
export const TRAFFIC_LOD={detail:260,hide:650};
export function createTrafficRenderer(actors,{types=VEHICLE_TYPES,paintColors=null,lod=TRAFFIC_LOD}={}){
 const families=types.map(type=>({type,entries:[],batches:[],low:[]}));
 actors.forEach((actor,i)=>{const family=families[i%families.length],model=createVehicle(1+(i*5)%8,false,family.type),parts=[];model.traverse(m=>{if(m.isMesh){if(m.material.name==='paint'){if(paintColors?.length)m.material.color.set(paintColors[i%paintColors.length]);
  // Subtle per-car variety within each palette colour: hue drift, saturation and lightness.
  m.material.color.offsetHSL(((i*37)%7-3)*.006,((i*53)%5-2)*.035,((i*71)%9-4)*.018);}parts.push(m);}});model.rotation.order='YXZ';family.entries.push({actor,model,parts});});
 // Model size and paint per actor, for overlays that must match the car (angry-drivers.js door).
 const byActor=new Map();for(const family of families)for(const {actor,model,parts}of family.entries){const m=parts.find(p=>p.material.name==='paint')?.material;byActor.set(actor,{type:family.type,spec:model.userData.spec,paint:m?.color||new THREE.Color('#9aa0a0'),material:m||null});}
 const group=new THREE.Group();group.name='Instanced traffic fleet';
 const bodyMaterial=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.45,metalness:.25}),cabinMaterial=new THREE.MeshStandardMaterial({color:'#182328',roughness:.25,metalness:.5});
 const tmp=new THREE.Matrix4(),slope={y:0,pitch:0,roll:0};
 for(const family of families)if(family.entries.length){
  // Parts sharing geometry and material (the wheels, say) share one batch: instances = cars x parts.
  const groups=new Map();family.entries[0].parts.forEach((source,part)=>{const g=source.geometry,key=(g.parameters?g.type+JSON.stringify(g.parameters):g.uuid)+'|'+source.material.name+'|'+source.material.color?.getHex();if(!groups.has(key))groups.set(key,[]);groups.get(key).push(part);});
  family.batches=[...groups.values()].map(partIdx=>{const source=family.entries[0].parts[partIdx[0]];
   const material=registerEnvMaterial(source.material.clone());const colored=source.material.name==='paint';if(colored)material.color.set('#ffffff');
   const mesh=new THREE.InstancedMesh(source.geometry,material,family.entries.length*partIdx.length);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.castShadow=true;mesh.receiveShadow=true;mesh.count=0;
   if(colored)family.entries.forEach((p,i)=>partIdx.forEach((part,k)=>mesh.setColorAt(i*partIdx.length+k,p.parts[part].material.color)));mesh.userData={colored,type:family.type,parts:partIdx};group.add(mesh);return mesh;
  });
  // Far level from the family's measured spec: a body box up to the belt line and a cabin box above it.
  const s=family.entries[0].model.userData.spec,paint=family.entries[0].parts.findIndex(p=>p.material.name==='paint');
  const low=(w,h,d,y,z,material,colored)=>{const mesh=new THREE.InstancedMesh(new THREE.BoxGeometry(w,h,d),material,family.entries.length);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;mesh.count=0;mesh.userData={lod:'far',type:family.type,offset:new THREE.Matrix4().makeTranslation(0,y,z),paint:colored?paint:-1};
   if(colored)family.entries.forEach((p,i)=>mesh.setColorAt(i,p.parts[paint].material.color));group.add(mesh);return mesh;};
  family.low=[low(s.w,s.belt-.3,s.l,(s.belt+.3)/2,0,bodyMaterial,paint>=0),low(s.w*.84,s.h-s.belt,s.rr-s.rf,(s.h+s.belt)/2,(s.rr+s.rf)/2,cabinMaterial,false)];
 }
 // Lamps after dark: head and tail lamp glows for every car in range (one instanced batch, four per car).
 const lampGeo=new THREE.SphereGeometry(.11,6,4),lamps=new THREE.InstancedMesh(lampGeo,new THREE.MeshBasicMaterial({color:'#ffffff',toneMapped:false}),actors.length*4);
 lamps.name='Traffic lamps';lamps.userData.lod='lamps';lamps.frustumCulled=false;lamps.count=0;lamps.visible=false;lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(lamps);
 const HEAD=new THREE.Color('#fff4dc'),TAIL=new THREE.Color('#ff2a1a'),lampLocal=new THREE.Matrix4(),lampOut=new THREE.Matrix4();
 for(let i=0;i<actors.length*4;i++)lamps.setColorAt(i,i%4<2?HEAD:TAIL);
 return {group,vehicleOf:actor=>byActor.get(actor)||null,batchCount:group.children.length,types:families.filter(f=>f.entries.length).map(f=>f.type),lod,update(dt,player){
  let lampN=0;
  for(const {entries,batches,low}of families){let visible=0,far=0;
  for(const {actor:a,model,parts}of entries){if(!a.edge)continue;const night=WEATHER_UNIFORMS.night.value>.5;
   const d=player?Math.hypot(a.x-player.x,a.z-player.z):0;if(d>lod.hide)continue;
   groundPose(a.x,a.z,a.heading,2.1,.85,slope);model.position.set(a.x,.12+slope.y,a.z);const delta=Math.atan2(Math.sin(a.heading-model.rotation.y),Math.cos(a.heading-model.rotation.y));model.rotation.set(slope.pitch,a.heading,slope.roll);
   if(d>lod.detail){model.updateMatrixWorld(true);for(const m of low){m.setMatrixAt(far,tmp.multiplyMatrices(model.matrixWorld,m.userData.offset));if(m.userData.paint>=0)m.setColorAt(far,parts[m.userData.paint].material.color);}far++;continue;}
   animateVehicle(model,a.speed,Math.max(-1,Math.min(1,delta*3)),dt,a.braking);model.updateMatrixWorld(true);
   if(night&&d<lod.detail){const sp=model.userData.spec||{w:1.8,l:4.4,belt:.9};const l=sp.l||4.4,w=sp.w||1.8,y=(sp.belt||.9)-.15;
    for(let q=0;q<4;q++){lampLocal.makeTranslation((q%2?1:-1)*(w/2-.28),y,q<2?-l/2:l/2);lamps.setMatrixAt(lampN++,lampOut.multiplyMatrices(model.matrixWorld,lampLocal));}}
   for(const m of batches){const ps=m.userData.parts,n=ps.length;for(let k=0;k<n;k++){m.setMatrixAt(visible*n+k,parts[ps[k]].matrixWorld);if(m.userData.colored)m.setColorAt(visible*n+k,parts[ps[k]].material.color);}}visible++;
  }batches.forEach(m=>{m.count=visible*m.userData.parts.length;m.visible=m.count>0;m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;});
  low.forEach(m=>{m.count=far;m.visible=far>0;m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;});}
  lamps.count=lampN;lamps.visible=lampN>0;lamps.instanceMatrix.needsUpdate=true;
 }};
}
