import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

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
let MODELS=null;
export function setCarriageModels(models){MODELS=models?.coach&&models?.horse?models:null;}
export function createCarriage(){
 const group=new THREE.Group();group.name='Coach and horses';
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
 // Legs: one pivot per leg at the shoulder/hip so they can swing.
 const legs=[];
 for(const [x,c] of [[-.62,'#5b3a24'],[.62,'#2e2520']]){const legGeo=legGeometry(c);for(const [lx,lz] of horse(x,-3.25,c).legs){const pivot=new THREE.Group();pivot.position.set(lx,1.05,lz);const m=new THREE.Mesh(legGeo,mat);m.castShadow=true;pivot.add(m);group.add(pivot);legs.push(pivot);}}
 let phase=0;
 group.userData.update=(speed,dt)=>{const v=Math.min(Math.abs(speed),14);phase+=dt*v*1.4;const amp=Math.min(.55,v*.08);
  legs.forEach((p,i)=>{p.rotation.x=Math.sin(phase+(i%2?Math.PI:0)+(i>3?.6:0))*amp;});};
 return group;
}

// NPC coaches for 1760 traffic: one static merged geometry (legs mid-stride), instanced over the mobility cars.
export function createCarriageTraffic(actors){
 const c=createCarriage();c.position.z=1.2;c.updateMatrixWorld(true);const gs=[];c.traverse(o=>{if(o.isMesh){const g=o.geometry.clone();g.applyMatrix4(o.matrixWorld);gs.push(g.index?g.toNonIndexed():g);}});const shared=new Set();c.traverse(o=>{if(o.isMesh){shared.add(o.geometry);shared.add(o.material);}});shared.forEach(x=>x.dispose());
 const mesh=new THREE.InstancedMesh(mergeGeometries(gs),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,metalness:.12}),Math.max(1,actors.length));mesh.castShadow=true;mesh.frustumCulled=false;mesh.name='Coaches';
 const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),one=new THREE.Vector3(1,1,1),zero=new THREE.Vector3(0,0,0),UP=new THREE.Vector3(0,1,0);
 return {group:mesh,update(groundAt){actors.forEach((a,i)=>{const on=!!a.edge&&!a.playerTaken;m4.compose(v.set(a.x||0,on?groundAt(a.x,a.z):-100,a.z||0),q.setFromAxisAngle(UP,a.heading||0),on?one:zero);mesh.setMatrixAt(i,m4);});mesh.instanceMatrix.needsUpdate=true;}};
}
