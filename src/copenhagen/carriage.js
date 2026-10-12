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
function horse(x,z,coat){
 const body=[box(.5,.62,1.55,x,1.32,z,coat),box(.34,.62,.38,x,1.72,z-.88,coat,-.75),box(.24,.26,.55,x,1.98,z-1.18,coat,-.35),box(.06,.1,.08,x-.08,2.2,z-1.02,coat),box(.06,.1,.08,x+.08,2.2,z-1.02,coat),
  box(.08,.5,.5,x,1.85,z-.75,'#1e1712',-.75),cyl(.05,.11,.7,x,1.25,z+.85,'#1e1712',6,0,.5), // mane, tail
  box(.54,.1,.4,x,1.68,z-.05,'#2b1d14'),box(.56,.06,1.2,x,1.34,z,'#2b1d14')]; // harness
 return {body,legs:[[x-.16,z-.55],[x+.16,z-.55],[x-.16,z+.55],[x+.16,z+.55]]};
}

export function createCarriage(){
 const group=new THREE.Group();group.name='Coach and horses';
 const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,metalness:.12});
 const lacquer='#1f3a2c',gilt='#c19a45',dark='#16120e';
 const parts=[
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
 parts.push(box(.42,.55,.3,0,1.85,-.98,'#3a2c45'),box(.26,.26,.24,0,2.27,-.98,'#d9b49a'),box(.36,.12,.36,0,2.44,-.98,'#141414'),box(.42,.04,.42,0,2.38,-.98,'#141414'));
 const mesh=new THREE.Mesh(mergeGeometries(parts),mat);parts.forEach(g=>g.dispose());mesh.castShadow=true;group.add(mesh);
 // Legs: one pivot per leg at the shoulder/hip so they can swing.
 const legGeo=paint(new THREE.CylinderGeometry(.055,.045,1.02,6).translate(0,-.51,0),'#3b2618'),legs=[];
 for(const [x,c] of [[-.62,'#4b2f1d'],[.62,'#26201b']])for(const [lx,lz] of horse(x,-3.25,c).legs){const pivot=new THREE.Group();pivot.position.set(lx,1.05,lz);const m=new THREE.Mesh(legGeo,mat);m.castShadow=true;pivot.add(m);group.add(pivot);legs.push(pivot);}
 let phase=0;
 group.userData.update=(speed,dt)=>{const v=Math.min(Math.abs(speed),14);phase+=dt*v*1.4;const amp=Math.min(.55,v*.08);
  legs.forEach((p,i)=>{p.rotation.x=Math.sin(phase+(i%2?Math.PI:0)+(i>3?.6:0))*amp;});};
 return group;
}
