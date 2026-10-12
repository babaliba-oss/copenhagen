import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {groundAt} from '../terrain.js';

// S-trains on the longest mapped tracks (rails.json): red four-car sets running end to end and back,
// pausing at each end. Visual only (the tracks are fenced off).
const paint=(g,hex)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();for(const k of Object.keys(n.attributes))if(k!=='position'&&k!=='normal')n.deleteAttribute(k);const c=new THREE.Color(hex),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));return n;};
const box=(w,h,d,x,y,z,hex)=>paint(new THREE.BoxGeometry(w,h,d).translate(x,y,z),hex);
const CAR=20.5;
function carGeometry(){
 const p=[box(2.95,2.3,CAR-.4,0,1.95,0,'#b3141c'),box(2.97,.75,CAR-1.2,0,2.35,0,'#22272b'),box(2.9,.25,CAR-.6,0,3.2,0,'#d9d6cf'),box(2.6,.5,CAR-1,0,.55,0,'#2a2c2e'),box(.06,.06,2.4,0,4.6,0,'#3a3d40')];
 for(const z of [-CAR/2+3,CAR/2-3])for(const x of [-.75,.75])p.push(paint(new THREE.CylinderGeometry(.45,.45,.2,10).rotateZ(Math.PI/2).translate(x,.45,z),'#151617'));
 for(const z of [-5,0,5])p.push(box(2.99,1.9,1.3,0,1.6,z,'#7b0e14'));
 return mergeGeometries(p);
}
export function createTrains(rails,{count=6}={}){
 const group=new THREE.Group();group.name='S-trains';
 const lines=(rails?.tracks||[]).map(t=>{let len=0;const cum=[0];for(let i=1;i<t.p.length;i++){len+=Math.hypot(t.p[i][0]-t.p[i-1][0],t.p[i][1]-t.p[i-1][1]);cum.push(len);}return {p:t.p,cum,len};}).filter(l=>l.len>600).sort((a,b)=>b.len-a.len).slice(0,count);
 if(!lines.length)return {group,update(){}};
 const cars=4,mesh=new THREE.InstancedMesh(carGeometry(),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.4,metalness:.3}),lines.length*cars);mesh.castShadow=true;mesh.frustumCulled=false;mesh.userData.shadowLod=true;group.add(mesh);
 const trains=lines.map((l,i)=>({l,s:cars*CAR+((i*397)%Math.max(1,l.len-2*cars*CAR)),dir:1,wait:0}));
 const at=(l,s)=>{s=Math.max(0,Math.min(l.len,s));let k=1;while(k<l.cum.length-1&&l.cum[k]<s)k++;const a=l.p[k-1],b=l.p[k],f=(s-l.cum[k-1])/Math.max(.01,l.cum[k]-l.cum[k-1]);return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];};
 const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),UP=new THREE.Vector3(0,1,0),one=new THREE.Vector3(1,1,1),v=new THREE.Vector3();
 function place(){trains.forEach((t,i)=>{for(let c=0;c<cars;c++){const s0=t.s-t.dir*(c*CAR+CAR/2),f=at(t.l,s0-CAR*.4),b=at(t.l,s0+CAR*.4),x=(f[0]+b[0])/2,z=(f[1]+b[1])/2;
  mesh.setMatrixAt(i*cars+c,m4.compose(v.set(x,groundAt(x,z)+.22,z),q.setFromAxisAngle(UP,Math.atan2(b[0]-f[0],b[1]-f[1])),one));}});mesh.instanceMatrix.needsUpdate=true;}
 place();
 return {group,update(dt){for(const t of trains){if(t.wait>0){t.wait-=dt;continue;}t.s+=t.dir*14*dt;const tail=cars*CAR;if(t.dir>0&&t.s>t.l.len){t.s=t.l.len-tail;t.dir=-1;t.wait=8;}else if(t.dir<0&&t.s<0){t.s=tail;t.dir=1;t.wait=8;}}place();}};
}
