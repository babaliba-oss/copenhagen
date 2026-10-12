import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {groundAt} from '../terrain.js';

// Hand-built details the city's LOD2 model cannot carry, placed on its own geometry (positions are local
// metres in the shared Copenhagen projection; the spire axes are the model's top vertices):
//  Vor Frelsers Kirke  black spire with the gilded staircase winding four times round it, globe and figure
//  Børsen              the dragon spire: four copper dragon tails twisted together, three crowns
//  Little Mermaid      bronze figure on her rock at Langelinie (today only)
//  Equestrian statues  Frederik V at Amalienborg (unveiled 1771, so today only), Christian V on Kongens Nytorv,
//                      Absalon on Højbro Plads (1902, today only)
//  Gefion Fountain     the goddess and her four oxen (1908, today only)
//  Dannebrog           flags on Christiansborg and Amalienborg
//  Windmills           post mills on the 1760 bastions
const paint=(g,hex)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();for(const k of Object.keys(n.attributes))if(k!=='position'&&k!=='normal')n.deleteAttribute(k);const c=new THREE.Color(hex),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));return n;};
const at=(g,x,y,z)=>g.translate(x,y,z);
const GOLD='#d4a637',COPPER='#5f9a7f',BRONZE='#4f6f5a',STONE='#b9b2a3',DARK='#2a2725';

// A tube following a helix around the y axis: from (r0,y0) to (r1,y1) in `turns` turns.
function helix(r0,r1,y0,y1,turns,thick,hex,phase=0,seg=160){
 const pts=[];for(let i=0;i<=seg;i++){const t=i/seg,a=phase+t*turns*Math.PI*2,r=r0+(r1-r0)*t;pts.push(new THREE.Vector3(Math.cos(a)*r,y0+(y1-y0)*t,Math.sin(a)*r));}
 return paint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),seg,thick,5,false),hex);
}
function vorFrelsers(){
 const p=[paint(new THREE.ConeGeometry(4.7,34,12,1,true).translate(0,52+17,0),DARK)];
 p.push(helix(5.1,.9,51,83,4,.32,GOLD),helix(5.5,1.1,52.2,84.2,4,.08,GOLD)); // the staircase and its handrail
 for(let i=0;i<=24;i++){const t=i/24,a=t*4*Math.PI*2,r=5.5+(1.1-5.5)*t,y=52.2+32*t;p.push(at(paint(new THREE.CylinderGeometry(.05,.05,1.1,4),GOLD),Math.cos(a)*r,y-.5,Math.sin(a)*r));}
 p.push(at(paint(new THREE.SphereGeometry(1.1,14,10),GOLD),0,86.5,0),at(paint(new THREE.CylinderGeometry(.08,.08,3,6),GOLD),0,88.6,0),at(paint(new THREE.BoxGeometry(1.2,.12,.12),GOLD),0,89.4,0));
 return mergeGeometries(p);
}
function borsen(){
 const p=[paint(new THREE.BoxGeometry(3.4,3.2,3.4).translate(0,22.6,0),COPPER),paint(new THREE.CylinderGeometry(1.9,2.3,1.2,8).translate(0,24.8,0),COPPER)];
 for(let k=0;k<4;k++)p.push(helix(1.6,.12,25,49,2.2,.42-.0,COPPER,k*Math.PI/2,90));
 for(const [y,r] of [[31,1.25],[37,.9],[43,.55]])p.push(paint(new THREE.TorusGeometry(r,.12,6,16).rotateX(Math.PI/2).translate(0,y,0),GOLD));
 for(let k=0;k<4;k++){const a=k*Math.PI/2+.4;p.push(at(paint(new THREE.ConeGeometry(.35,1.2,5).rotateZ(Math.PI/2).rotateY(-a),COPPER),Math.cos(a)*2,25.6,Math.sin(a)*2));} // dragon heads
 p.push(paint(new THREE.CylinderGeometry(.05,.1,5,6).translate(0,51.2,0),GOLD),at(paint(new THREE.SphereGeometry(.4,10,8),GOLD),0,50,0));
 return mergeGeometries(p);
}
function mermaid(){
 return mergeGeometries([paint(new THREE.DodecahedronGeometry(1.6,0).scale(1.4,.7,1.1).translate(0,.4,0),'#6d6a63'),paint(new THREE.DodecahedronGeometry(1,0).translate(.9,.9,.4),'#5f5c56'),
  paint(new THREE.CapsuleGeometry(.22,.55,4,8).rotateZ(.25).translate(0,1.65,0),BRONZE),paint(new THREE.SphereGeometry(.15,10,8).translate(.1,2.15,0),BRONZE),
  paint(new THREE.CapsuleGeometry(.16,.7,4,8).rotateZ(1.35).translate(-.45,1.25,.1),BRONZE),paint(new THREE.ConeGeometry(.2,.4,6).rotateZ(1.9).translate(-.95,1.05,.15),BRONZE),
  paint(new THREE.CapsuleGeometry(.06,.35,3,6).rotateZ(-.5).translate(.25,1.55,.18),BRONZE)]);
}
function rider(plinthH,hex=BRONZE){
 const y=plinthH,p=[paint(new THREE.BoxGeometry(2.2,plinthH,4).translate(0,plinthH/2,0),STONE),paint(new THREE.BoxGeometry(2.6,.4,4.4).translate(0,plinthH-.2,0),'#cfc8b8')];
 p.push(paint(new THREE.CapsuleGeometry(.55,1.5,4,8).rotateX(Math.PI/2).translate(0,y+1.8,0),hex),paint(new THREE.CapsuleGeometry(.28,.8,4,8).rotateX(-.7).translate(0,y+2.4,-1.2),hex),paint(new THREE.BoxGeometry(.38,.42,.75).translate(0,y+2.85,-1.65),hex));
 for(const [x,z,r] of [[-.3,-.7,.5],[.3,-.6,-.2],[-.3,.75,.15],[.3,.7,-.15]])p.push(paint(new THREE.CylinderGeometry(.09,.07,1.4,6).rotateX(r).translate(x,y+.75,z),hex));
 p.push(paint(new THREE.CapsuleGeometry(.12,.8,3,6).rotateX(.6).translate(0,y+1.6,1.3),hex),paint(new THREE.CapsuleGeometry(.3,.7,4,8).translate(0,y+2.85,.1),hex),paint(new THREE.SphereGeometry(.22,10,8).translate(0,y+3.55,.05),hex),paint(new THREE.CylinderGeometry(.06,.06,.9,5).rotateX(-1).translate(.35,y+3,-.3),hex));
 return mergeGeometries(p);
}
function gefion(){
 const p=[paint(new THREE.CylinderGeometry(9,9.5,.8,24).translate(0,.4,0),STONE),paint(new THREE.CylinderGeometry(8.4,8.4,.2,24).translate(0,.75,0),'#3f6f86'),paint(new THREE.BoxGeometry(5,2.4,3).translate(0,1.6,1.5),'#8a8578')];
 for(const [x,z] of [[-1.5,-1.5],[-.5,-2.5],[.5,-2.5],[1.5,-1.5]])p.push(paint(new THREE.CapsuleGeometry(.5,1.4,4,8).rotateX(Math.PI/2).rotateY(x*.2).translate(x,3.6,z-.5),BRONZE),paint(new THREE.SphereGeometry(.35,8,6).translate(x*1.1,4,z-1.6),BRONZE));
 p.push(paint(new THREE.CapsuleGeometry(.4,1.6,4,8).rotateX(-.3).translate(0,4.6,1.4),BRONZE),paint(new THREE.SphereGeometry(.3,10,8).translate(0,5.9,1.0),BRONZE),paint(new THREE.CylinderGeometry(.05,.05,2.6,5).rotateX(1.1).translate(.5,5.4,0),BRONZE));
 return mergeGeometries(p);
}
function flag(){
 const c=document.createElement('canvas');c.width=74;c.height=56;const g=c.getContext('2d');g.fillStyle='#c8102e';g.fillRect(0,0,74,56);g.fillStyle='#fff';g.fillRect(24,0,8,56);g.fillRect(0,24,74,8);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
 const geo=new THREE.PlaneGeometry(3.7,2.8,12,2);const m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({map:t,side:THREE.DoubleSide,roughness:.8}));m.position.set(1.85,0,0);
 const g2=new THREE.Group();g2.add(m);const base=geo.attributes.position.array.slice();
 g2.userData.wave=(time)=>{const p=geo.attributes.position;for(let i=0;i<p.count;i++){const x=base[i*3]+1.85;p.setZ(i,Math.sin(x*1.6-time*5)*.18*x/3.7);}p.needsUpdate=true;geo.computeVertexNormals();};
 return g2;
}
function windmill(){
 const p=[paint(new THREE.CylinderGeometry(.35,.5,6,8).translate(0,3,0),'#5b4630'),paint(new THREE.BoxGeometry(3.2,4.2,4.2).translate(0,7.6,0),'#7a5a3a'),paint(new THREE.ConeGeometry(2.9,2,4).rotateY(Math.PI/4).translate(0,10.7,0),'#5b3f2a'),paint(new THREE.BoxGeometry(.2,.2,6).rotateX(.25).translate(0,4.5,3),'#5b4630')];
 return mergeGeometries(p);
}
function sails(){
 const p=[];for(let k=0;k<4;k++){const a=k*Math.PI/2;p.push(paint(new THREE.BoxGeometry(.25,9.5,.15).translate(0,4.9,0).rotateZ(a),'#4a3a2a'),paint(new THREE.BoxGeometry(1.5,7,.05).translate(.85,5.6,.05).rotateZ(a),'#e8e0cc'));}
 return mergeGeometries(p);
}

export function createLandmarks({era=null,mills=[],anchors={}}={}){
 const group=new THREE.Group();group.name='Hand-built landmarks';
 const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.45,metalness:.35});
 const add=(geo,x,z,{y=null,rot=0}={})=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y??groundAt(x,z),z);m.rotation.y=rot;m.castShadow=true;m.receiveShadow=true;group.add(m);return m;};
 const today=era!==1760,flags=[],rotors=[];
 const scaled=(geo,a,design)=>{const m=add(geo,a[0],a[2]);m.scale.y=a[1]/design;return m;};
 if(anchors.vorFrelsers?.[3]>60)scaled(vorFrelsers(),anchors.vorFrelsers,86);
 if(anchors.borsen?.[3]>35)scaled(borsen(),anchors.borsen,53);
 const flagTops=[];if(anchors.christiansborg?.[3]>80)flagTops.push([anchors.christiansborg[0],anchors.christiansborg[2],anchors.christiansborg[1]]);
 if(today){
  add(mermaid(),1465.3,-1438.7,{y:-1.2,rot:2.2});
  add(rider(4.5),1076.2,-438.8,{rot:.12});add(rider(3.6,'#4d6a59'),191.9,194.8,{rot:-1.2});add(gefion(),1371.2,-729.5,{rot:-.6});
 }
 add(rider(3.2,era===1760?'#b8a46a':'#55715f'),603.9,16.7,{rot:.6}); // Christian V (1688; gilded lead until 1940s)
 for(const [x,z,h] of flagTops){const pole=add(mergeGeometries([paint(new THREE.CylinderGeometry(.08,.1,8,6).translate(0,4,0),'#e9e6dc')]),x,z,{y:groundAt(x,z)+h});const f=flag();f.position.set(x,groundAt(x,z)+h+7.2,z);group.add(f);flags.push(f);}
 if(era===1760)for(const [x,z] of mills){add(windmill(),x,z,{y:groundAt(x,z)+7});const r=new THREE.Mesh(sails(),mat);r.position.set(x,groundAt(x,z)+14.6,z+2.3);group.add(r);rotors.push(r);}
 let t=0,acc=0;
 return {group,update(dt){t+=dt;acc+=dt;for(const r of rotors)r.rotation.z-=dt*.6;if(acc>.05){acc=0;for(const f of flags)f.userData.wave?.(t);}}};
}
