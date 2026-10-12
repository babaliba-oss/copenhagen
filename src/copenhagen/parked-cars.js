import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {groundAt} from '../terrain.js';

// Parked cars along the kerbs (scripts/parked-cars.py → parked.json). Two instanced meshes per 300 m chunk:
// the painted body (per-car colour) and the fixed parts (glass, tyres, lights). Chunks beyond view range
// are hidden. Each car is a solid obstacle for the player.
const CHUNK=300,RANGE=420;
const paint=(g,hex)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();n.deleteAttribute('uv');const c=new THREE.Color(hex),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));return n;};
// A box whose top face is pulled in (cabin taper). Forward is -Z.
function taper(w,h,d,x,y,z,inX,inFront,inBack){
 const g=new THREE.BoxGeometry(w,h,d).translate(x,y,z),p=g.attributes.position;
 for(let i=0;i<p.count;i++)if(p.getY(i)>y){p.setX(i,p.getX(i)*(1-inX));p.setZ(i,p.getZ(i)<z?p.getZ(i)+inFront:p.getZ(i)-inBack);}
 g.computeVertexNormals();return g;
}
function bodyGeometry(){
 return mergeGeometries([paint(taper(1.76,.62,4.25,0,.62,0,.02,.12,.08),'#ffffff'),paint(taper(1.6,.1,2.2,0,1.52,.25,.04,.05,.05),'#ffffff'),
  paint(new THREE.BoxGeometry(1.8,.08,.9).translate(0,.95,-1.62),'#ffffff')]);
}
function fixedGeometry(){
 const parts=[paint(taper(1.62,.6,2.5,0,1.22,.22,.1,.42,.28),'#1a2229')];
 for(const [x,z] of [[-.78,-1.32],[.78,-1.32],[-.78,1.32],[.78,1.32]])parts.push(paint(new THREE.CylinderGeometry(.33,.33,.22,10).rotateZ(Math.PI/2).translate(x,.33,z),'#151617'));
 for(const x of [-.6,.6]){parts.push(paint(new THREE.BoxGeometry(.32,.12,.04).translate(x,.78,-2.13),'#f3f1e6'));parts.push(paint(new THREE.BoxGeometry(.34,.12,.04).translate(x,.82,2.13),'#9e1f1a'));}
 parts.push(paint(new THREE.BoxGeometry(.52,.11,.02).translate(0,.55,2.14),'#f2f2f2'),paint(new THREE.BoxGeometry(1.8,.18,4.3).translate(0,.3,0),'#2a2c2e'));
 return mergeGeometries(parts);
}

export function createParkedCars(data){
 const group=new THREE.Group();group.name='Parked cars';
 const cars=data?.cars||[],paints=(data?.paints||['#ccc']).map(h=>new THREE.Color(h));
 if(!cars.length)return {group,obstacles:[],update(){}};
 const body=bodyGeometry(),fixed=fixedGeometry();
 const bodyMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.32,metalness:.45}),fixedMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.4,metalness:.2});
 const chunks=new Map();
 for(const c of cars){const k=`${Math.floor(c[0]/CHUNK)},${Math.floor(c[1]/CHUNK)}`;if(!chunks.has(k))chunks.set(k,[]);chunks.get(k).push(c);}
 const m=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),one=new THREE.Vector3(1,1,1),UP=new THREE.Vector3(0,1,0),list=[],obstacles=[];
 let id=0;
 for(const [k,cs] of chunks){
  const b=new THREE.InstancedMesh(body,bodyMat,cs.length),f=new THREE.InstancedMesh(fixed,fixedMat,cs.length);b.castShadow=f.castShadow=true;b.receiveShadow=true;
  let cx=0,cz=0;
  cs.forEach((c,i)=>{const [x,z,yaw,p]=c;m.compose(v.set(x,groundAt(x,z),z),q.setFromAxisAngle(UP,yaw),one);b.setMatrixAt(i,m);f.setMatrixAt(i,m);b.setColorAt(i,paints[p%paints.length]);cx+=x;cz+=z;
   const co=Math.cos(yaw),si=Math.sin(yaw),ring=[[-.9,-2.15],[.9,-2.15],[.9,2.15],[-.9,2.15]].map(([a,d])=>[x+a*co+d*si,z-a*si+d*co]);
   obstacles.push({id:`parked-car-${id++}`,name:'parked car',rings:[ring],bbox:[Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))]});});
  b.computeBoundingSphere();f.computeBoundingSphere();const g=new THREE.Group();g.add(b,f);group.add(g);list.push({g,x:cx/cs.length,z:cz/cs.length});
 }
 return {group,obstacles,update(p){if(!p)return;for(const c of list)c.g.visible=Math.hypot(c.x-p.x,c.z-p.z)<RANGE;}};
}
