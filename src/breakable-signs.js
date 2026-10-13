import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {carContact} from './knockables.js';

// Free-standing sign posts the car can hit. A light post bends over at its base when struck at
// moderate speed, is pushed over slowly by a crawling car, and snaps off at speed: the sign part
// flies, tumbles and lies flat, leaving a short stump. Heavy structures (gantries, lattice masts,
// big framed boards) stay solid obstacles elsewhere and never come through here.
// Rendering keeps each module's merged static geometry: every vertex carries the index of its
// post and the vertex shader applies that post's pose from a small float texture, so a broken
// sign costs no extra draw calls. Separate meshes (canvas plaques, signal heads) are re-posed directly.
const GRAVITY=9.81,RESPAWN_AFTER=60,RESPAWN_CLEAR=70,MAX_BEND=1.42,UP=new THREE.Vector3(0,1,0);
export const SIGN_BEND_SPEED=2,SIGN_SNAP_SPEED=8;
// Every live sign set, so main.js can step them all through one combined knockables entry.
const SYSTEMS=new Set();

function randomFor(seed){let s=seed*7919+104729;return()=>{s=(s*9301+49297)%233280;return s/233280;};}

const HEADER='attribute float signIndex;\nuniform highp sampler2D signPoses;\nmat4 signPose(){int i=int(signIndex+.5);return mat4(texelFetch(signPoses,ivec2(0,i),0),texelFetch(signPoses,ivec2(1,i),0),texelFetch(signPoses,ivec2(2,i),0),texelFetch(signPoses,ivec2(3,i),0));}\n';
function patchShader(shader,texture,refs){
 shader.uniforms.signPoses={value:texture};refs.push(shader.uniforms.signPoses);
 shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+HEADER)
  .replace('#include <beginnormal_vertex>','#include <beginnormal_vertex>\nobjectNormal=mat3(signPose())*objectNormal;')
  .replace('#include <begin_vertex>','#include <begin_vertex>\ntransformed=(signPose()*vec4(transformed,1.)).xyz;');
}

export function createBreakableSigns(name='Breakable signs',{register=true}={}){
 const group=new THREE.Group();group.name=name;
 const posts=[],attached=[],materials=new Map(),uniforms=[],pending=new Map();
 group.worldObjects=posts;
 let texture=null,data=null,stumps=null,dirty=true,hits=0;
 const m4=new THREE.Matrix4(),t1=new THREE.Matrix4(),v1=new THREE.Vector3(),v2=new THREE.Vector3(),q1=new THREE.Quaternion(),q2=new THREE.Quaternion(),box=new THREE.Box3();

 // Register a post. x/z are world coordinates for contact; pivot is the base in the meshes' frame
 // (same as world unless the caller's group is offset). yaw is the plate's facing (+Z rotated by yaw).
 function post({id,x,z,y=0,pivot=[x,y,z],yaw=0,height=3.3,radius=.05,strength=1}){
  const i=posts.length,p=new THREE.Vector3(...pivot);
  posts.push({id:id??i,index:i,x,z,collisionMode:'breakable',pivot:p,yaw,height,radius,strength,com:new THREE.Vector3(0,height*.6,0),box:new THREE.Box3(new THREE.Vector3(p.x-radius,p.y,p.z-radius),new THREE.Vector3(p.x+radius,p.y+height,p.z+radius)),corners:null,
   state:'upright',q:new THREE.Quaternion(),c:new THREE.Vector3(),v:new THREE.Vector3(),w:new THREE.Vector3(),axis:new THREE.Vector3(1,0,0),theta:0,rate:0,target:0,
   touching:false,knocked:false,settled:true,restTime:0,qRest:null,rand:randomFor(i+1)});
  restPose(posts[i]);dirty=true;return i;
 }
 // Mark a geometry (already placed in the meshes' frame) as belonging to post i.
 function tag(geometry,i){
  const n=geometry.attributes.position.count;geometry.setAttribute('signIndex',new THREE.Float32BufferAttribute(new Float32Array(n).fill(i),1));
  geometry.computeBoundingBox();posts[i].box.union(geometry.boundingBox);posts[i].corners=null;return geometry;
 }
 // Queue post geometry for batching: finish() merges everything per material into one mesh each.
 function add(geometry,base,i){
  if(geometry.index){const old=geometry;geometry=old.toNonIndexed();old.dispose();}
  for(const k of Object.keys(geometry.attributes))if(k!=='position'&&k!=='normal'&&!(k==='uv'&&base.map))geometry.deleteAttribute(k);
  tag(geometry,i);if(!pending.has(base))pending.set(base,[]);pending.get(base).push(geometry);return geometry;
 }
 // Separate objects (canvas plaques, whole signal heads) whose parent shares the meshes' frame.
 function attach(object,i){
  object.updateMatrix();object.updateMatrixWorld(true);posts[i].box.union(box.setFromObject(object));posts[i].corners=null;
  object.matrixAutoUpdate=false;attached.push({object,rest:object.matrix.clone(),post:posts[i]});return object;
 }
 function ensureTexture(){
  if(texture&&data.length>=Math.max(1,posts.length)*16)return;
  // Textures are immutable once uploaded: a set that grows gets a fresh one and its shaders are repointed.
  texture?.dispose();data=new Float32Array(Math.max(1,posts.length)*16);
  texture=new THREE.DataTexture(data,4,Math.max(1,posts.length),THREE.RGBAFormat,THREE.FloatType);
  texture.minFilter=texture.magFilter=THREE.NearestFilter;texture.generateMipmaps=false;for(const u of uniforms)u.value=texture;dirty=true;
 }
 // Patched clone of a material for sign geometry (cached; shared by all meshes of this set).
 function material(base){
  if(!materials.has(base)){const m=base.clone();m.onBeforeCompile=s=>{ensureTexture();patchShader(s,texture,uniforms);};m.customProgramCacheKey=()=>'breakable-sign';materials.set(base,m);}
  return materials.get(base);
 }
 // A merged sign mesh: patched material plus a matching shadow depth material.
 function mesh(geometry,base,{castShadow=true,receiveShadow=true}={}){
  const m=new THREE.Mesh(geometry,material(base));m.castShadow=castShadow;m.receiveShadow=receiveShadow;
  const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});depth.onBeforeCompile=s=>{ensureTexture();patchShader(s,texture,uniforms);};depth.customProgramCacheKey=()=>'breakable-sign-depth';m.customDepthMaterial=depth;
  // Broken signs fly a few metres beyond their rest bounds.
  geometry.computeBoundingSphere();geometry.boundingSphere.radius+=12;return m;
 }
 function finish(){
  ensureTexture();
  for(const [base,gs]of pending){group.add(mesh(mergeGeometries(gs),base));gs.forEach(g=>g.dispose());}pending.clear();
  if(posts.length&&!stumps){
   const g=new THREE.CylinderGeometry(.03,.036,.34,7);g.translate(0,.17,0);
   stumps=new THREE.InstancedMesh(g,new THREE.MeshStandardMaterial({color:'#9aa2a0',metalness:.3,roughness:.55}),posts.length);stumps.name=`${name} stumps`;stumps.frustumCulled=false;stumps.castShadow=true;group.add(stumps);
  }
  dirty=true;update();return group;
 }

 function restPose(s){s.q.identity();s.c.copy(s.pivot).add(s.com);}
 function corners(s){
  if(!s.corners){const {min,max}=s.box,o=v1.copy(s.pivot).add(s.com);s.corners=[];for(const x of [min.x,max.x])for(const y of [min.y,max.y])for(const z of [min.z,max.z])s.corners.push(new THREE.Vector3(x-o.x,y-o.y,z-o.z));}
  return s.corners;
 }
 function lowest(s){let low=Infinity;for(const c of corners(s)){v2.copy(c).applyQuaternion(s.q);low=Math.min(low,s.c.y+v2.y);}return low;}
 function bendPose(s){s.q.setFromAxisAngle(s.axis,s.theta);s.c.copy(s.com).applyQuaternion(s.q).add(s.pivot);}

 // Fall direction: where the car is going, plus a sideways component for glancing blows.
 function aimFrom(s,car,contact){
  const dir=Math.sign(car.speed)||1,fx=-Math.sin(car.heading)*dir,fz=-Math.cos(car.heading)*dir;
  const side=Math.sign(contact.lateral)*Math.min(.6,Math.abs(contact.lateral)/1.2),sx=Math.cos(car.heading)*side,sz=-Math.sin(car.heading)*side;
  const dx=fx+sx,dz=fz+sz,l=Math.hypot(dx,dz)||1;s.axis.set(dz/l,0,-dx/l);return [dx/l,dz/l];
 }
 function snap(s,car,contact,speed){
  const [dx,dz]=aimFrom(s,car,contact),boost=.9+s.rand()*.25;
  s.state='flying';s.settled=false;s.qRest=null;
  s.v.set(dx*speed*boost,Math.min(8,2+speed*.2*(.7+s.rand()*.6)),dz*speed*boost);
  s.w.copy(s.axis).multiplyScalar(2.5+speed*.3+s.rand()*2).addScaledVector(UP,(s.rand()-.5)*speed*.4);
  car.speed*=1-Math.min(.2,.07*s.strength);
 }
 function hit(s,car,contact,dt){
  const speed=Math.abs(car.speed),snapSpeed=SIGN_SNAP_SPEED*s.strength;
  if(!s.knocked){s.knocked=true;hits++;}s.restTime=0;
  if(speed>=snapSpeed){snap(s,car,contact,speed);return;}
  if(!s.touching){
   aimFrom(s,car,contact);s.state='bent';s.settled=false;
   // A real bump at bending speed folds the post over at once; a crawl just leans it.
   if(speed>=SIGN_BEND_SPEED){s.target=Math.max(s.target,Math.min(MAX_BEND,.5+(speed-SIGN_BEND_SPEED)/(snapSpeed-SIGN_BEND_SPEED)*.9));s.rate+=speed*.8;car.speed*=1-Math.min(.15,.05*s.strength);}
  }
  // While the car keeps pushing, the post leans further with the bumper (≈ .6 m lever) and drags a little.
  s.target=Math.min(MAX_BEND,Math.max(s.target,s.theta+speed*dt/.6));car.speed*=Math.exp(-dt*(speed<SIGN_BEND_SPEED?1.2:.3)*s.strength);
 }

 // Thousands of posts stand still almost all the time: each frame only steps the posts near the car (an 8 m
 // grid) and the ones still moving, waiting to respawn or touching the car.
 let grid=null,gridSize=-1;const active=new Set(),near=[];
 const cellKey=(x,z)=>Math.floor(x/8)*100003+Math.floor(z/8);
 function nearCar(car){
  if(gridSize!==posts.length){grid=new Map();for(const s of posts){const k=cellKey(s.x,s.z);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(s);}gridSize=posts.length;}
  near.length=0;const cx=Math.floor(car.x/8),cz=Math.floor(car.z/8);
  for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const c=grid.get((cx+i)*100003+cz+j);if(c)for(const s of c)near.push(s);}
  return near;
 }
 function step(dt,car,world){
  if(car)for(const s of nearCar(car))active.add(s);
  for(const s of active){
   if(car&&s.state!=='flying'&&s.state!=='down'&&s.theta<1.05&&Math.abs(car.speed)>.15&&Math.abs(car.x-s.x)<6&&Math.abs(car.z-s.z)<6){
    const contact=carContact(car,s.x,s.z,s.radius);if(contact)hit(s,car,contact,dt);s.touching=!!contact;
   }else s.touching=false;
   if(s.state==='bent'&&!s.settled){
    // Under-damped spring: the folded post overshoots and wobbles once before it stays bent.
    s.rate+=(90*(s.target-s.theta)-11*s.rate)*dt;s.theta=Math.min(MAX_BEND,Math.max(0,s.theta+s.rate*dt));bendPose(s);dirty=true;
    if(Math.abs(s.rate)<.01&&Math.abs(s.target-s.theta)<.004&&!s.touching)s.settled=true;
   }else if(s.state==='flying')fly(s,dt,world);
   if(s.knocked&&s.settled&&car&&(s.restTime+=dt)>RESPAWN_AFTER&&Math.hypot(car.x-s.x,car.z-s.z)>RESPAWN_CLEAR)reset(s);
   if(!s.knocked&&!s.touching&&s.settled&&s.state!=='flying'&&!(car&&Math.abs(car.x-s.x)<8&&Math.abs(car.z-s.z)<8))active.delete(s);
  }
 }
 function fly(s,dt,world){
  dirty=true;const ground=s.pivot.y;
  if(!s.qRest)s.v.y-=GRAVITY*dt;
  const nx=s.c.x+s.v.x*dt,nz=s.c.z+s.v.z*dt;
  if(world?.buildings?.at(nx,nz)){s.v.x*=-.35;s.v.z*=-.35;}else{s.c.x=nx;s.c.z=nz;}
  s.c.y+=s.v.y*dt;
  if(!s.qRest){const a=s.w.length();if(a>1e-6){q1.setFromAxisAngle(v1.copy(s.w).divideScalar(a),a*dt);s.q.premultiply(q1).normalize();}}
  const low=lowest(s);
  if(low<ground){
   s.c.y+=ground-low;
   // Still rising (a bent post snapping free starts partly below its base): just lift clear.
   if(s.v.y<=0||s.qRest){
    if(s.v.y<-1.5&&!s.qRest){s.v.y*=-.25;s.w.multiplyScalar(.5);}
    else{s.v.y=0;if(!s.qRest)s.qRest=restingOrientation(s);}
    const f=Math.exp(-dt*3.5);s.v.x*=f;s.v.z*=f;
   }
  }
  if(s.qRest){
   // Settle flat: pole horizontal, plate face down or up, resting on its lowest corner.
   s.w.set(0,0,0);s.v.y=0;s.q.slerp(s.qRest,1-Math.exp(-dt*6));s.c.y+=ground-lowest(s);
   const f=Math.exp(-dt*3.5);s.v.x*=f;s.v.z*=f;
   if(s.q.angleTo(s.qRest)<.01&&Math.hypot(s.v.x,s.v.z)<.05){s.q.copy(s.qRest);s.c.y+=ground-lowest(s);s.v.set(0,0,0);s.state='down';s.settled=true;}
  }
 }
 function restingOrientation(s){
  const u=v1.copy(UP).applyQuaternion(s.q),h=v2.set(u.x,0,u.z);
  if(h.lengthSq()<1e-6)h.set(s.v.x,0,s.v.z);if(h.lengthSq()<1e-6)h.set(1,0,0);h.normalize();
  const tip=new THREE.Quaternion().setFromUnitVectors(u.normalize(),h).multiply(s.q);
  const n=new THREE.Vector3(Math.sin(s.yaw),0,Math.cos(s.yaw)).applyQuaternion(tip);
  return q2.setFromUnitVectors(n.normalize(),n.y>=0?UP:new THREE.Vector3(0,-1,0)).clone().multiply(tip);
 }
 function reset(s){restPose(s);Object.assign(s,{state:'upright',theta:0,rate:0,target:0,touching:false,knocked:false,settled:true,restTime:0,qRest:null});s.v.set(0,0,0);s.w.set(0,0,0);dirty=true;}

 function poseMatrix(s,out){return out.makeRotationFromQuaternion(s.q).setPosition(s.c).multiply(t1.makeTranslation(-s.pivot.x-s.com.x,-s.pivot.y-s.com.y,-s.pivot.z-s.com.z));}
 function update(){
  if(!dirty)return;dirty=false;ensureTexture();let broken=0;
  for(const s of posts){poseMatrix(s,m4);data.set(m4.elements,s.index*16);
   if(stumps){if(s.state==='flying'||s.state==='down'){const k=Math.max(1,s.radius/.035);m4.makeRotationY(s.yaw).scale(v1.set(k,1,k)).setPosition(s.pivot);broken++;}else m4.makeScale(0,0,0);stumps.setMatrixAt(s.index,m4);}
  }
  if(stumps)stumps.visible=broken>0; // no stump draw call until a post has actually snapped off
  for(const a of attached){a.object.matrix.multiplyMatrices(poseMatrix(a.post,m4),a.rest);a.object.matrixWorldNeedsUpdate=true;}
  if(stumps)stumps.instanceMatrix.needsUpdate=true;texture.needsUpdate=true;
 }
 const system={group,bodies:posts,post,tag,add,attach,material,mesh,finish,step,update,
  resetAll(){posts.forEach(reset);update();},
  snapshot:()=>{const live=[...active];return {count:posts.length,knocked:live.filter(s=>s.knocked).length,hits,bent:live.filter(s=>s.state==='bent').length,broken:live.filter(s=>s.state==='flying'||s.state==='down').length};}, // only stepped posts can be anything but upright
  dispose(){SYSTEMS.delete(system);}};
 if(register)SYSTEMS.add(system);
 return system;
}

// Every registered sign set as one knockables-compatible entry (sets created later, e.g. bus stops, join automatically).
export const breakableSigns={
 get bodies(){return [...SYSTEMS].flatMap(s=>s.bodies);},
 step(dt,car,world){for(const s of SYSTEMS)s.step(dt,car,world);},
 update(){for(const s of SYSTEMS)s.update();},
 resetAll(){for(const s of SYSTEMS)s.resetAll();},
 snapshot(){const all=[...SYSTEMS].map(s=>s.snapshot());const sum=k=>all.reduce((n,x)=>n+x[k],0);return {count:sum('count'),knocked:sum('knocked'),hits:sum('hits'),bent:sum('bent'),broken:sum('broken'),sets:all.length};},
};
