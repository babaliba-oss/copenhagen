import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {groundAt} from '../terrain.js';

// Café tables on Nyhavn's north quay (scripts/cafes.py → cafes.json): round table, four chairs and a
// square parasol; parasol colours vary per table. Two instanced meshes.
const paint=(g,hex)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();for(const k of Object.keys(n.attributes))if(k!=='position'&&k!=='normal')n.deleteAttribute(k);const c=new THREE.Color(hex),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));return n;};
export function createCafes(data){
 const group=new THREE.Group();group.name='Café tables';const tables=data?.tables||[];if(!tables.length)return {group};
 const parts=[paint(new THREE.CylinderGeometry(.42,.42,.04,14).translate(0,.74,0),'#e9e6dc'),paint(new THREE.CylinderGeometry(.04,.05,.72,6).translate(0,.37,0),'#2b2d2f'),paint(new THREE.CylinderGeometry(.03,.03,2.3,5).translate(0,1.15,0),'#d9d6cc')];
 for(let k=0;k<4;k++){const a=k*Math.PI/2+.4,x=Math.cos(a)*.75,z=Math.sin(a)*.75;parts.push(paint(new THREE.BoxGeometry(.42,.04,.42).rotateY(-a).translate(x,.46,z),'#3b2e22'),paint(new THREE.BoxGeometry(.42,.45,.04).translate(0,.7,.2).rotateY(-a+Math.PI/2).translate(x,0,z),'#3b2e22'));}
 const furniture=mergeGeometries(parts),shade=paint(new THREE.ConeGeometry(1.55,.55,4,1,true).rotateY(Math.PI/4).translate(0,2.2,0),'#ffffff');
 const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7,side:THREE.DoubleSide});
 const a=new THREE.InstancedMesh(furniture,mat,tables.length),b=new THREE.InstancedMesh(shade,mat,tables.length);a.castShadow=b.castShadow=true;
 const m=new THREE.Matrix4(),q=new THREE.Quaternion(),UP=new THREE.Vector3(0,1,0),one=new THREE.Vector3(1,1,1),v=new THREE.Vector3(),col=new THREE.Color(),COLS=['#e9e3d4','#7a2a20','#1f3a2c','#c8202a'];
 tables.forEach(([x,z,yaw,c],i)=>{m.compose(v.set(x,groundAt(x,z),z),q.setFromAxisAngle(UP,yaw),one);a.setMatrixAt(i,m);b.setMatrixAt(i,m);b.setColorAt(i,col.set(COLS[c%COLS.length]));});
 a.computeBoundingSphere();b.computeBoundingSphere();group.add(a,b);
 return {group,obstacles:tables.map(([x,z],i)=>({id:`cafe-${i}`,name:'café table',rings:[[[x-.9,z-.9],[x+.9,z-.9],[x+.9,z+.9],[x-.9,z+.9]]],bbox:[x-.9,z-.9,x+.9,z+.9]}))};
}
