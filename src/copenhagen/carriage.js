import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {gaitMaterial,gaitDepthMaterial,horseGeometry,wheelGeometry,stepMotion,withAttributes} from './gait.js';

// A two-horse town coach for Copenhagen 1760, swapped in for the player's car (same physics, forward is -Z).
// Procedural geometry, vertex-coloured: lacquered body with gilt trim, coachman's box, big rear wheels,
// a pair of horses in harness. The legs swing with speed (update).
const paint=(g,hex)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();n.deleteAttribute('uv');const c=new THREE.Color(hex),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));return n;};
const box=(w,h,d,x,y,z,hex,rx=0)=>paint(new THREE.BoxGeometry(w,h,d).rotateX(rx).translate(x,y,z),hex);
const cyl=(r0,r1,h,x,y,z,hex,seg=8,rz=0,rx=0)=>paint(new THREE.CylinderGeometry(r0,r1,h,seg).rotateZ(rz).rotateX(rx).translate(x,y,z),hex);

function wheel(r,x,z,hex='#3a2a1c'){
 const parts=[paint(new THREE.TorusGeometry(r,.035,5,22).rotateY(Math.PI/2).translate(x,r,z),'#1d1a17'),cyl(.07,.07,.14,x,r,z,'#b08a3c',8,Math.PI/2)];
 for(let i=0;i<10;i++)parts.push(paint(new THREE.CylinderGeometry(.014,.014,r*2-.04,4).rotateX(i*Math.PI/10).translate(x,r,z),hex));
 return parts;
}
// A horse from rounded parts (capsule body, chest and rump, tapered neck, long head with muzzle and ears,
// mane, tail, collar). Legs are separate so they can swing (see createCarriage).
const sph=(r,x,y,z,hex,sx=1,sy=1,sz=1)=>paint(new THREE.SphereGeometry(r,12,9).scale(sx,sy,sz).translate(x,y,z),hex);
const cap=(r,l,x,y,z,hex,rx=0,sx=1)=>paint(new THREE.CapsuleGeometry(r,l,5,10).rotateX(rx).scale(sx,1,1).translate(x,y,z),hex);
function horse(x,z,coat){
 const dark='#1e1712',muzzle='#2a221c';
 const body=[cap(.31,.95,x,1.33,z,coat,Math.PI/2,.88),sph(.34,x,1.37,z-.6,coat,.85,1,.95),sph(.35,x,1.39,z+.58,coat,.9,.95,1),
  paint(new THREE.CylinderGeometry(.15,.25,.9,10).rotateX(-.62).translate(x,1.8,z-.93),coat),
  cap(.12,.42,x,2.0,z-1.33,coat,1.15),sph(.11,x,1.86,z-1.55,muzzle,.9,.85,1.1),
  paint(new THREE.ConeGeometry(.045,.14,5).translate(x-.06,2.27,z-1.2),coat),paint(new THREE.ConeGeometry(.045,.14,5).translate(x+.06,2.27,z-1.2),coat),
  box(.05,.6,.1,x,1.95,z-.88,dark,-.62), // mane
  paint(new THREE.CylinderGeometry(.04,.11,.8,6).rotateX(.3).translate(x,1.12,z+1.02),dark), // tail
  paint(new THREE.TorusGeometry(.25,.055,6,14).rotateX(-.95).translate(x,1.64,z-.76),'#2b1d14'), // collar
  box(.56,.06,.5,x,1.68,z-.05,'#2b1d14'),box(.6,.05,.08,x,1.3,z-.05,'#2b1d14')]; // pad and girth
 return {body,legs:[[x-.15,z-.58],[x+.15,z-.58],[x-.15,z+.6],[x+.15,z+.6]]};
}
// One leg: forearm, cannon, fetlock and a dark hoof, hanging from a pivot 1.05 m up.
function legGeometry(coat){
 return mergeGeometries([paint(new THREE.CylinderGeometry(.075,.055,.52,8).translate(0,-.26,0),coat),paint(new THREE.CylinderGeometry(.045,.042,.42,7).translate(0,-.73,0),coat),
  sph(.055,0,-.95,0,coat),paint(new THREE.CylinderGeometry(.055,.065,.09,8).translate(0,-1.005,0),'#1b1714')]);
}

// Blender coach and horse body (scripts/blender/carriage.py): {coach: geometry, horse: parts} once loaded.
let MODELS=null,ARMOURED=null,BROUGHAM=null,COACHMAN=null;
export function setCarriageModels(models){MODELS=models?.coach&&models?.horse?models:null;ARMOURED=models?.armoured?.geometry?models.armoured:null;BROUGHAM=models?.brougham?.geometry?models.brougham:null;COACHMAN=models?.coachman?.geometry?models.coachman:null;}
// With the armoured horse (gait.js) the coach and its pair are one geometry, all animated in the vertex shader from one
// per-instance `motion` (phase, swing, roll): the black town coach with a crown on the door (brougham.glb, textured; the
// Blender coach when it is missing) with its wheels marked to turn, a pole, the coachman on the box and two horses that trot.
const COACH_WHEELS=[{x:.82,y:.62,z:1.1,r:.62},{x:-.82,y:.62,z:1.1,r:.62},{x:.72,y:.44,z:-.945,r:.44},{x:-.72,y:.44,z:-.945,r:.44}];
const flat=g=>g.index?g.toNonIndexed():g.clone();
function coachman([x,y,z]){
 if(COACHMAN)return flat(COACHMAN.geometry).translate(x,y,z);
 return mergeGeometries([box(.42,.55,.3,0,.3,0,'#3a2c45'),box(.26,.26,.24,0,.72,0,'#d9b49a'),box(.36,.12,.36,0,.89,0,'#141414'),box(.42,.04,.42,0,.83,0,'#141414'),box(.36,.14,.5,0,.05,-.2,'#2a2433')]).translate(x,y,z);
}
function gaitCoach(){
 if(!ARMOURED||!(BROUGHAM||MODELS))return null;
 const near=horseGeometry(ARMOURED.geometry,ARMOURED.pivots,{x:-.62,z:-3.25}),off=horseGeometry(ARMOURED.geometry,ARMOURED.pivots,{x:.62,z:-3.25,coat:.55,offset:.9});
 const coloured=gaitMaterial(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.62,metalness:.05}));
 if(!BROUGHAM){const coach=wheelGeometry(flat(MODELS.coach),COACH_WHEELS),g=mergeGeometries([coach,near,off].map(x=>withAttributes(x,{uv:false})));[coach,near,off].forEach(x=>x.dispose());return {geometry:g,materials:coloured};}
 const e=BROUGHAM.extras,body=withAttributes(wheelGeometry(flat(BROUGHAM.geometry),e.wheels.map(w=>({...w,dx:.1}))));
 const tip=-4.05,from=(e.poleEnd??-2)+.25,pole=paint(new THREE.CylinderGeometry(.04,.055,from-tip,8).rotateX(Math.PI/2).translate(0,.96,(from+tip)/2),'#2a1d14');
 const seat=e.box||[0,1.34,-.35],parts=[body,...[near,off,pole,coachman(COACHMAN?[0,seat[1]-.2,seat[2]+.05]:seat)].map(x=>withAttributes(x))],g=mergeGeometries(parts,true);parts.forEach(x=>x.dispose()); /* the coachman model's origin is at his soles, under his hips; his thighs rest 0.2 m above it */
 for(const grp of g.groups)grp.materialIndex=grp.materialIndex===0?0:1;
 return {geometry:g,materials:[gaitMaterial(new THREE.MeshStandardMaterial({map:BROUGHAM.texture,roughness:.42,metalness:.15})),coloured]};
}
function gaitMesh({geometry,materials},count){
 const motion=new THREE.InstancedBufferAttribute(new Float32Array(count*3),3);motion.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute('motion',motion);
 const mesh=new THREE.InstancedMesh(geometry,materials,count);
 mesh.customDepthMaterial=gaitDepthMaterial();mesh.castShadow=true;mesh.frustumCulled=false;return {mesh,motion};
}
export function createCarriage(){
 const group=new THREE.Group();group.name='Coach and horses';
 const gait=gaitCoach();
 if(gait){const {mesh,motion}=gaitMesh(gait,1),m={phase:0,amp:0,roll:0};mesh.setMatrixAt(0,new THREE.Matrix4());mesh.name='Coach and pair';group.add(mesh);
  group.userData.update=(speed,dt)=>{stepMotion(m,speed,dt);motion.setXYZ(0,m.phase,m.amp,m.roll);motion.needsUpdate=true;};
  return group;}
 const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,metalness:.12});
 const lacquer='#1f3a2c',gilt='#c19a45',dark='#16120e';
 const parts=MODELS?[MODELS.coach.clone(),...[[-.62,'#5b3a24'],[.62,'#2e2520']].map(([x,c])=>MODELS.bake(MODELS.horse,{coat:c}).translate(x,0,-3.25))]:[
  box(1.42,1.15,2.0,0,1.38,.45,lacquer),box(1.5,.08,2.12,0,2.0,.45,dark),box(1.3,.06,1.9,0,2.06,.45,'#24201b'), // body, roof
  box(1.44,.05,2.02,0,1.84,.45,gilt),box(1.44,.05,2.02,0,.84,.45,gilt), // gilt bands
  box(1.46,.5,.7,0,1.5,.45,'#0e1418'), // windows
  box(.04,.95,.02,.73,1.33,.12,gilt),box(.04,.95,.02,-.73,1.33,.12,gilt),box(.04,.95,.02,.73,1.33,.78,gilt),box(.04,.95,.02,-.73,1.33,.78,gilt),
  box(1.0,.5,.55,0,1.25,-.95,lacquer),box(1.05,.08,.6,0,1.52,-.95,dark),box(1.0,.35,.06,0,1.72,-.7,dark), // coachman's box
  box(1.6,.06,.08,0,.62,1.1,dark),box(1.4,.06,.08,0,.5,-.95,dark), // axles' beds
  cyl(.06,.06,.18,.78,1.95,-.25,'#e9d7a0',6),cyl(.06,.06,.18,-.78,1.95,-.25,'#e9d7a0',6), // lanterns
  ...wheel(.62,.82,1.1),...wheel(.62,-.82,1.1),...wheel(.44,.72,-.95),...wheel(.44,-.72,-.95),
  box(.07,.07,3.2,0,.95,-2.6,dark), // pole between the horses
  ...[[-.62,'#5b3a24'],[.62,'#2e2520']].flatMap(([x,c])=>horse(x,-3.25,c).body),
 ];
 // Coachman
 if(!MODELS)parts.push(box(.42,.55,.3,0,1.85,-.98,'#3a2c45'),box(.26,.26,.24,0,2.27,-.98,'#d9b49a'),box(.36,.12,.36,0,2.44,-.98,'#141414'),box(.42,.04,.42,0,2.38,-.98,'#141414'));
 const mesh=new THREE.Mesh(mergeGeometries(parts),mat);parts.forEach(g=>g.dispose());mesh.castShadow=true;group.add(mesh);
 // Legs swing about a pivot at the shoulder/hip, 1.05 m up: one instanced batch per horse (2 draws, not 8).
 const legs=[],batches=[],pose=new THREE.Matrix4();
 for(const [x,c] of [[-.62,'#5b3a24'],[.62,'#2e2520']]){const at=horse(x,-3.25,c).legs,batch=new THREE.InstancedMesh(legGeometry(c),mat,at.length);batch.name='Horse legs';batch.castShadow=true;batch.frustumCulled=false;batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(batch);batches.push(batch);
  at.forEach(([lx,lz],k)=>legs.push({batch,k,x:lx,z:lz}));}
 const swing=(phase,amp)=>{legs.forEach((l,i)=>l.batch.setMatrixAt(l.k,pose.makeRotationX(Math.sin(phase+(i%2?Math.PI:0)+(i>3?.6:0))*amp).setPosition(l.x,1.05,l.z)));for(const b of batches)b.instanceMatrix.needsUpdate=true;};
 swing(0,0);let phase=0;
 group.userData.update=(speed,dt)=>{const v=Math.min(Math.abs(speed),14);phase+=dt*v*1.4;swing(phase,Math.min(.55,v*.08));};
 return group;
}

// NPC coaches for 1760 traffic: the coach and horse bodies as one merged geometry instanced over the mobility cars,
// and the horses' legs as two instanced batches (one per coat) that swing with each coach's own pace, so a coach
// at rest stands still and a moving one walks or trots instead of sliding along with frozen legs.
export const COACH_HALF_LENGTH=3.4,COACH_HALF_WIDTH=.95; // horses' noses to the rear wheels, about 6.6 m (traffic spacing)
export function createCarriageTraffic(actors){
 const gait=gaitCoach();
 if(gait){const count=Math.max(1,actors.length),{mesh,motion}=gaitMesh(gait,count);mesh.name='Coaches';const group=new THREE.Group();group.name='Coach traffic';group.add(mesh);
  const m4=new THREE.Matrix4(),ahead=new THREE.Matrix4().makeTranslation(0,0,1.2),q=new THREE.Quaternion(),v=new THREE.Vector3(),one=new THREE.Vector3(1,1,1),zero=new THREE.Vector3(0,0,0),UP=new THREE.Vector3(0,1,0);
  const states=Array.from({length:count},(_,i)=>({phase:i*1.7,amp:0,roll:i*3.3}));
  return {group,update(groundAt,dt=1/60){actors.forEach((a,i)=>{if(i>=count)return;const on=!!a.edge&&!a.playerTaken;m4.compose(v.set(a.x||0,on?groundAt(a.x,a.z):-100,a.z||0),q.setFromAxisAngle(UP,a.heading||0),on?one:zero).multiply(ahead);mesh.setMatrixAt(i,m4);
    const s=stepMotion(states[i],on?a.speed||0:0,dt);motion.setXYZ(i,s.phase,s.amp,s.roll);});mesh.instanceMatrix.needsUpdate=true;motion.needsUpdate=true;}};}
 const c=createCarriage();c.position.z=1.2;c.updateMatrixWorld(true);const gs=[],im=new THREE.Matrix4();
 c.traverse(o=>{if(!o.isMesh||o.name==='Horse legs')return;const n=o.isInstancedMesh?o.count:1;for(let i=0;i<n;i++){const g=o.geometry.clone();if(o.isInstancedMesh){o.getMatrixAt(i,im);g.applyMatrix4(im.premultiply(o.matrixWorld));}else g.applyMatrix4(o.matrixWorld);gs.push(g.index?g.toNonIndexed():g);}});
 const shared=new Set();c.traverse(o=>{if(o.isMesh){shared.add(o.geometry);shared.add(o.material);}});shared.forEach(x=>x.dispose());
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,metalness:.12}),count=Math.max(1,actors.length);
 const mesh=new THREE.InstancedMesh(mergeGeometries(gs),material,count);mesh.castShadow=true;mesh.frustumCulled=false;mesh.name='Coaches';
 const group=new THREE.Group();group.name='Coach traffic';group.add(mesh);
 const horses=[[-.62,'#5b3a24'],[.62,'#2e2520']].map(([x,coat])=>{const legs=horse(x,-3.25,coat).legs.map(([lx,lz])=>[lx,lz+1.2]),batch=new THREE.InstancedMesh(legGeometry(coat),material,count*legs.length);
  batch.name='Coach horse legs';batch.castShadow=true;batch.frustumCulled=false;batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(batch);return {legs,batch};});
 const m4=new THREE.Matrix4(),leg=new THREE.Matrix4(),swing=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),one=new THREE.Vector3(1,1,1),zero=new THREE.Vector3(0,0,0),UP=new THREE.Vector3(0,1,0);
 const phase=new Float32Array(count);
 return {group,update(groundAt,dt=1/60){actors.forEach((a,i)=>{const on=!!a.edge&&!a.playerTaken;m4.compose(v.set(a.x||0,on?groundAt(a.x,a.z):-100,a.z||0),q.setFromAxisAngle(UP,a.heading||0),on?one:zero);mesh.setMatrixAt(i,m4);
   const speed=Math.min(Math.abs(a.speed||0),14);phase[i]+=dt*speed*1.4;const amp=Math.min(.55,speed*.08);
   for(const {legs,batch} of horses)legs.forEach(([lx,lz],k)=>{swing.makeRotationX(Math.sin(phase[i]+(k%2?Math.PI:0)+(k>1?.6:0))*amp).setPosition(lx,1.05,lz);batch.setMatrixAt(i*legs.length+k,leg.multiplyMatrices(m4,swing));});});
  mesh.instanceMatrix.needsUpdate=true;for(const {batch} of horses)batch.instanceMatrix.needsUpdate=true;}};
}
