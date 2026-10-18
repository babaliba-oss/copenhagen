import * as THREE from 'three';
import {groundAt} from './terrain.js';

// White bicycle pictograms painted on Copenhagen's cycle tracks, so a track reads as a bike path at a glance
// (scripts/surface-dissolve.mjs adds the tracks OpenStreetMap only tags on the road and places a mark every 40 m,
// turned to be read by the cyclists riding toward it). One instanced quad with a canvas-drawn sign.
export function pictogramCanvas(size=256,canvas=globalThis.document?.createElement('canvas')){
 if(!canvas)return null;canvas.width=canvas.height=size;const g=canvas.getContext('2d'),u=size/100;
 g.clearRect(0,0,size,size);g.strokeStyle='#f4f4ee';g.fillStyle='#f4f4ee';g.lineCap='round';g.lineJoin='round';g.lineWidth=5.5*u;
 const wheel=(x,y)=>{g.beginPath();g.arc(x*u,y*u,17*u,0,Math.PI*2);g.stroke();};
 wheel(25,62);wheel(75,62); // side view, wheels across the track: "up" points the way the cyclists ride
 g.beginPath();g.moveTo(25*u,62*u);g.lineTo(44*u,38*u);g.lineTo(66*u,38*u);g.lineTo(52*u,62*u);g.closePath();g.stroke(); // frame
 g.beginPath();g.moveTo(52*u,62*u);g.lineTo(41*u,30*u);g.moveTo(66*u,38*u);g.lineTo(75*u,62*u);g.moveTo(66*u,38*u);g.lineTo(63*u,26*u);g.lineTo(71*u,26*u);g.stroke(); // seat tube, fork, bars
 g.beginPath();g.moveTo(34*u,29*u);g.lineTo(47*u,29*u);g.stroke(); // saddle
 return canvas;
}
export function createCycleMarks(marks,{size=1.25}={}){
 const canvas=pictogramCanvas();
 const texture=canvas?new THREE.CanvasTexture(canvas):null;if(texture){texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;}
 const geometry=new THREE.PlaneGeometry(size,size);geometry.rotateX(-Math.PI/2);
 // worn road paint: not pure white, a little rough; drawn just over the track (the draped surface sits 5 cm up)
 const material=new THREE.MeshStandardMaterial({map:texture,color:'#e9e8e0',transparent:true,alphaTest:.3,depthWrite:false,roughness:.75,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});
 const mesh=new THREE.InstancedMesh(geometry,material,Math.max(1,marks.length));mesh.name='Cycle track bicycles';mesh.receiveShadow=true;mesh.count=marks.length;
 const m=new THREE.Matrix4(),q=new THREE.Quaternion(),p=new THREE.Vector3(),one=new THREE.Vector3(1,1,1),UP=new THREE.Vector3(0,1,0);
 marks.forEach(([x,z,yaw],i)=>{p.set(x,groundAt(x,z)+.07,z);q.setFromAxisAngle(UP,yaw);m.compose(p,q,one);mesh.setMatrixAt(i,m);});
 mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();
 return mesh;
}
