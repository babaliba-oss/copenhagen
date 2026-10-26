import * as THREE from 'three';
import {animateVehicle} from './vehicles.js';
import {createSiren,SURGE_SIREN} from './police-siren.js';
import {groundPose} from './terrain.js';
import {createFootOfficers} from './foot-officers.js';
const slope={y:0,pitch:0,roll:0};
import {createPoliceBody,unitNumber,unitNumberTexture,unitVariant,POLICE_BLUE,POLICE_YELLOW} from './police-model.js';

// Finnish Poliisi patrol units in the current national livery (white body,
// blue POLIISI/POLIS door band, yellow-green chevrons, blue LED bar). The
// bodies and the livery atlas live in police-model.js.
export {POLICE_BLUE,POLICE_YELLOW};

// Rapid alternating triple-flash strobe: side 0 flashes three times, then side 1.
export function strobe(time,side,offset=0){
 const c=(((time+offset)/.62)%1+1)%1;if((c<.5?0:1)!==side)return 0;
 const q=(c%.5)/.5;return q<.15||(q>.3&&q<.45)||(q>.6&&q<.75)?1:0;
}
// Slower headlamp wig-wag, opposite phase per side.
export const wigwag=(time,side,offset=0)=>((((time+offset)/.5)%1+1)%1<.5?0:1)===side?1:0;

function glowTexture(){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d');
 const g=ctx.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.22,'rgba(110,160,255,.75)');g.addColorStop(1,'rgba(0,40,255,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
// Geometry shared by every unit (never disposed with a car).
function createKit(){
 const geometry={grille:new THREE.BoxGeometry(.13,.065,.025),head:new THREE.BoxGeometry(.3,.03,.02),pool:new THREE.PlaneGeometry(9,9).rotateX(-Math.PI/2)};
 for(const g of Object.values(geometry))g.userData.shared=true;
 return {glow:glowTexture(),geometry};
}
const unitIndex=id=>Number(String(id).replace(/\D/g,''))||0;

export function createPoliceRenderer(scene,simulation){
 const models=new Map(),kit=createKit(),siren=createSiren(),onFoot=createFootOfficers(simulation,scene); // the officers units send on foot (police.js ON_FOOT, FOOT_CHASE)
 // No real lights: a PointLight costs every lit fragment in the city even when
 // no police exist (measured ~2–4 FPS). The nearest two cars instead get an
 // additive blue light pool on the road that flashes with the active side.
 const nearest=[null,null],nearestD=[Infinity,Infinity];
 // The simulation clock stops at the arrest; strobes keep flashing through the
 // finale cinematic on this extra time, which only advances while busted.
 let arrestClock=0;
 function make(index){
  const m=createPoliceBody(unitVariant(index));m.name='Police pursuit car';
  const {mounts}=m.userData,g=kit.geometry,owned=[];
  const add=(geometry,material,x,y,z,rx=0,ry=0)=>{const mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);mesh.rotation.set(rx,ry,0,'YXZ');m.add(mesh);return mesh;};
  // Unit number decals (bonnet, rear glass, quarter windows): one tiny texture per car.
  const numberTexture=unitNumberTexture(unitNumber(index),m.userData.numberColour),numberMaterial=new THREE.MeshStandardMaterial({map:numberTexture,transparent:true,alphaTest:.3,roughness:.5,polygonOffset:true,polygonOffsetFactor:-2});
  owned.push(numberMaterial,numberTexture);
  for(const n of mounts.numbers)add(new THREE.PlaneGeometry(n.w,n.h),numberMaterial,n.x,n.y,n.z,n.rx,n.ry);
  // Tail lamps brighten when braking (per-car material).
  const tail=m.children.find(o=>o.name==='tail');tail.material=tail.material.clone();m.userData.tail=tail.material;owned.push(tail.material);
  // Light bar lenses (outer thirds of the slim bar) and bumper strobes share one
  // material per side so the whole side flashes together.
  const lights=[],halos=[],heads=[],lens=new THREE.BoxGeometry(mounts.bar.w,.07,.3);
  for(const [i,side]of [[0,-1],[1,1]]){
   const material=new THREE.MeshStandardMaterial({color:'#2a52b8',emissive:'#1f5cff',emissiveIntensity:.15,roughness:.2});
   lights.push(add(lens,material,side*mounts.bar.x,mounts.bar.y,mounts.bar.z));
   lights.push(add(g.grille,material,side*mounts.grille.x,mounts.grille.y,mounts.grille.z));
   const halo=new THREE.Sprite(new THREE.SpriteMaterial({map:kit.glow,color:'#3f86ff',blending:THREE.AdditiveBlending,depthWrite:false,transparent:true,opacity:0}));
   halo.position.set(side*mounts.bar.x,mounts.bar.y+.03,mounts.bar.z);halo.scale.setScalar(1.8);m.add(halo);halos[i]=halo;owned.push(material,halo.material);
   const head=add(g.head,new THREE.MeshBasicMaterial({color:'#ffffff'}),side*mounts.head.x,mounts.head.y,mounts.head.z);head.visible=false;heads[i]=head;owned.push(head.material);
  }
  const pool=new THREE.Mesh(g.pool,new THREE.MeshBasicMaterial({map:kit.glow,color:'#2a62ff',blending:THREE.AdditiveBlending,transparent:true,depthWrite:false,opacity:.55}));
  pool.position.y=.06;pool.visible=false;pool.renderOrder=2;m.add(pool);owned.push(pool.material);
  Object.assign(m.userData,{policeLights:lights,policeHalos:halos,policeHeads:heads,policePool:pool,ownedMaterials:owned,phase:index*.23%1});
  scene.add(m);return m;
 }
 function dispose(m){
  scene.remove(m);const owned=new Set(m.userData.ownedMaterials);owned.forEach(x=>x.dispose());
  // Body geometry and plain materials are per car; the livery atlas material is shared.
  m.traverse(o=>{if(!o.isMesh)return;if(!o.geometry.userData.shared)o.geometry.dispose();if(!owned.has(o.material)&&o.material.name!=='paint')o.material.dispose();});
 }
 return {
  update(dt){
   if(simulation.busted)arrestClock+=dt;else arrestClock=0;
   const player=simulation.player,t=simulation.time+arrestClock;nearest[0]=nearest[1]=null;nearestD[0]=nearestD[1]=Infinity;
   for(const u of simulation.units){
    let model=models.get(u.id);if(!model){model=make(unitIndex(u.id));model.rotation.y=u.heading;models.set(u.id,model);}
    const delta=Math.atan2(Math.sin(u.heading-model.rotation.y),Math.cos(u.heading-model.rotation.y));
    const steer=THREE.MathUtils.clamp(delta/Math.max(dt,.001)*.4,-1,1);
    groundPose(u.x,u.z,u.heading,2.2,.85,slope);model.position.set(u.x,.12+slope.y,u.z);model.rotation.set(slope.pitch,u.heading,slope.roll,'YXZ');animateVehicle(model,u.speed,steer,dt,u.braking);
    const {policeLights:lights,policeHalos:halos,policeHeads:heads,phase}=model.userData;
    for(let i=0;i<lights.length;i++)lights[i].material.emissiveIntensity=strobe(t,i>>1,phase)?3.2:.15;
    for(let i=0;i<2;i++){halos[i].material.opacity=strobe(t,i,phase)*.95;heads[i].visible=wigwag(t,i,phase)===1;}
    model.userData.policePool.visible=false;
    const d=player?Math.hypot(u.x-player.x,u.z-player.z):0;
    if(d<nearestD[0]){nearest[1]=nearest[0];nearestD[1]=nearestD[0];nearest[0]=model;nearestD[0]=d;}else if(d<nearestD[1]){nearest[1]=model;nearestD[1]=d;}
   }
   for(const [id,m]of models)if(!simulation.units.some(u=>u.id===id)){dispose(m);models.delete(id);}
   for(let i=0;i<2;i++){const m=nearest[i];if(!m||nearestD[i]>140)continue;
    const a=strobe(t,0,m.userData.phase),b=strobe(t,1,m.userData.phase),pool=m.userData.policePool;
    pool.visible=!!(a||b);pool.position.x=a?-1.1:1.1;
   }
   onFoot.update(dt);
  },
  // WebAudio siren; call every frame. `enabled` must reflect the sound toggle.
  // `enabled` must reflect the sound toggle; the arrest cinematic keeps the siren going after heat drops to zero.
  onFoot,
  audio(context,enabled){siren.update(context,enabled&&(simulation.level>0||!!simulation.busted),simulation.units,simulation.player,simulation.time+arrestClock,simulation.surging||simulation.busted?SURGE_SIREN:1);},
 };
}
