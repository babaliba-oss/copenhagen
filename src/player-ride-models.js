import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {bicycleGeometry,cityBikeGeometry,scooterGeometry} from './parked-micromobility.js';

// These anchors are shared by the visible bicycle and the player's foot IK.
export const PLAYER_BIKE={hipY:1.01,hipZ:.23,crankY:.33,crankZ:.05,crankR:.17,crankPerMetre:1.15,pedalX:.14,pedalTop:.0175,barX:.24,barY:1.05,barZ:-.48};
export const PLAYER_CITY_BIKE={...PLAYER_BIKE,hipY:1.02,hipZ:.2,crankY:.36,crankZ:.08,barY:1,barZ:-.47,wheelHalfBase:.56};
export const PLAYER_SCOOTER={hipY:.90,footX:.025,frontZ:-.09,backZ:.155,groundY:.324,barX:.22,barY:.946,barZ:-.455};

export function addBicycleMotion(root,anchors=PLAYER_BIKE){
 const metal=new THREE.MeshStandardMaterial({color:'#939c98',roughness:.4,metalness:.5}),dark=new THREE.MeshStandardMaterial({color:'#202a27',roughness:.8});
 const wheels=[],wheelMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.65,metalness:.25});
 const tint=(geometry,hex)=>{
  const g=geometry.index?geometry.toNonIndexed():geometry;if(g!==geometry)geometry.dispose();g.deleteAttribute('uv');
  const color=new THREE.Color(hex),colors=new Float32Array(g.attributes.position.count*3);
  for(let i=0;i<colors.length;i+=3){colors[i]=color.r;colors[i+1]=color.g;colors[i+2]=color.b;}
  g.setAttribute('color',new THREE.BufferAttribute(colors,3));return g;
 };
 const parts=[tint(new THREE.TorusGeometry(.32,.032,6,32).rotateY(Math.PI/2),'#202724'),tint(new THREE.TorusGeometry(.295,.008,4,32).rotateY(Math.PI/2),'#9ca7a1'),tint(new THREE.CylinderGeometry(.04,.04,.09,8).rotateZ(Math.PI/2),'#aab3ad')];
 for(let i=0;i<8;i++)parts.push(tint(new THREE.CylinderGeometry(.004,.004,.59,3).rotateX(i*Math.PI/8),'#9ca7a1'));
 const wheelGeometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());
 const halfBase=anchors.wheelHalfBase??.58;
 for(const z of [-halfBase,halfBase]){const mesh=new THREE.Mesh(wheelGeometry,wheelMaterial);mesh.position.set(0,.33,z);mesh.castShadow=true;root.add(mesh);wheels.push(mesh);}
 const cranks=[],pedals=[],crankGeometry=new THREE.CylinderGeometry(.013,.013,anchors.crankR,7),pedalGeometry=new THREE.BoxGeometry(.13,.035,.10);
 for(let side=0;side<2;side++){
  const sign=side?1:-1,crank=new THREE.Group();crank.position.set(sign*anchors.pedalX,anchors.crankY,anchors.crankZ);root.add(crank);
  const arm=new THREE.Mesh(crankGeometry,metal);arm.position.y=anchors.crankR/2;arm.castShadow=true;crank.add(arm);
  const pedal=new THREE.Mesh(pedalGeometry,dark);pedal.position.y=anchors.crankR;pedal.castShadow=true;crank.add(pedal);cranks.push(crank);pedals.push(pedal);
 }
 const axle=new THREE.Mesh(new THREE.CylinderGeometry(.027,.027,anchors.pedalX*2,8).rotateZ(Math.PI/2),metal);axle.position.set(0,anchors.crankY,anchors.crankZ);root.add(axle);
 return {wheels,cranks,pedals,update(distance=0){
  const phase=distance*anchors.crankPerMetre;
  for(const wheel of wheels)wheel.rotation.x=-distance/.352;
  for(let side=0;side<2;side++){const angle=phase+(side?Math.PI:0);cranks[side].rotation.x=angle;pedals[side].rotation.x=-angle;}
 }};
}

// The same city-bike frame, rental accent and attached parts remain visible
// after a parked or NPC ride is taken over. Only owned rides need these meshes.
export function createRideVehicle(visual={},mode='bike'){
 const kind=visual.kind||(mode==='scooter'?'scooter':'bicycle'),color=visual.color??visual.accent??(mode==='scooter'?'#399d91':'#edb844');
 const geometry=kind==='scooter'?scooterGeometry():kind==='citybike'?cityBikeGeometry({animated:true}):bicycleGeometry({animated:true});
 const paint=geometry.getAttribute('paint'),colors=geometry.getAttribute('color'),tint=new THREE.Color(color);
 for(let i=0;i<paint.count;i++)if(paint.getX(i)>0)colors.setXYZ(i,tint.r,tint.g,tint.b);
 const root=new THREE.Group();root.name=`Player ${kind}`;root.rotation.order='YXZ';root.userData={kind,color};
 const frame=new THREE.Mesh(geometry,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,metalness:.25}));frame.castShadow=true;root.add(frame);
 if(kind==='ladcykel')root.add(ladcykelBox());
 for(const part of visual.parts||[]){const mesh=new THREE.Mesh(part.geometry.clone(),part.material.clone());mesh.castShadow=true;root.add(mesh);}
 const anchors=kind==='citybike'?PLAYER_CITY_BIKE:PLAYER_BIKE,motion=mode==='bike'?addBicycleMotion(root,anchors):null;
 const geometries=new Set(),materials=new Set();root.traverse(o=>{if(o.geometry)geometries.add(o.geometry);if(o.material)materials.add(o.material);});
 return {root,frame,anchors,motion,lift:visual.lift??.12,dispose(){for(const g of geometries)g.dispose();for(const m of materials)m.dispose();root.removeFromParent();}};
}

// Christiania-style cargo trike front: a plywood box on two small front wheels, ahead of the handlebars
// (the bicycle's own front wheel sits under the box's back edge). Local frame: forward is -Z.
export function ladcykelBox(){
 const parts=[],paint=(g,hex)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();n.deleteAttribute('uv');const c=new THREE.Color(hex),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));return n;};
 const box=(w,h,d,x,y,z,hex)=>parts.push(paint(new THREE.BoxGeometry(w,h,d).translate(x,y,z),hex));
 const W=.86,D=.78,Z=-1.08,B=.42,H=.5,T=.018,ply='#c89a62',edge='#a87a45';
 box(W,T,D,0,B,Z,edge); // floor
 box(W,H,T,0,B+H/2,Z-D/2,ply);box(W,H*.85,T,0,B+H*.42,Z+D/2,ply); // front, back
 box(T,H,D,-W/2,B+H/2,Z,ply);box(T,H,D,W/2,B+H/2,Z,ply); // sides
 box(W+.02,.03,.03,0,B+H,Z-D/2,edge);box(.03,.03,D,-W/2,B+H,Z,edge);box(.03,.03,D,W/2,B+H,Z,edge); // rims
 box(W-.06,.04,.22,0,B+.3,Z+D/2-.14,'#8a6236'); // bench inside
 box(.05,.05,.7,0,.36,-.62,'#1f2522'); // frame tube to the box
 box(1.0,.04,.04,0,.36,Z,'#1f2522'); // axle
 for(const x of [-.5,.5]){parts.push(paint(new THREE.TorusGeometry(.24,.03,6,24).rotateY(Math.PI/2).translate(x,.24,Z),'#1c211f'));parts.push(paint(new THREE.CylinderGeometry(.035,.035,.06,8).rotateZ(Math.PI/2).translate(x,.24,Z),'#a9b2ad'));}
 const mesh=new THREE.Mesh(mergeGeometries(parts),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7,metalness:.08}));parts.forEach(g=>g.dispose());mesh.castShadow=true;mesh.name='Ladcykel box';return mesh;
}
