import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {groundAt} from '../terrain.js';

// Railway tracks (scripts/rails.py → rails.json): a ballast bed with sleepers (one tiling canvas texture),
// two steel rails, and catenary masts every 55 m on electrified lines. One merged mesh per part.
function sleeperTexture(){
 const c=document.createElement('canvas');c.width=64;c.height=64;const g=c.getContext('2d');
 g.fillStyle='#6f6a62';g.fillRect(0,0,64,64);
 for(let i=0;i<900;i++){const v=90+Math.random()*70|0;g.fillStyle=`rgb(${v},${v-6},${v-14})`;g.fillRect(Math.random()*64,Math.random()*64,2,2);}
 g.fillStyle='#4a3c30';g.fillRect(6,20,52,22);g.fillStyle='#3b3027';g.fillRect(6,38,52,4);
 const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}
export function createRails(data){
 const group=new THREE.Group();group.name='Railway tracks';
 const tracks=data?.tracks||[];if(!tracks.length)return {group};
 const bed=[],uv=[],steel=[],masts=[];
 for(const t of tracks){
  let run=0,since=40;
  for(let i=1;i<t.p.length;i++){
   const [ax,az]=t.p[i-1],[bx,bz]=t.p[i],dx=bx-ax,dz=bz-az,L=Math.hypot(dx,dz);if(L<.05)continue;
   const nx=-dz/L,nz=dx/L,ya=groundAt(ax,az)+.07,yb=groundAt(bx,bz)+.07,W=1.7;
   bed.push(ax+nx*W,ya,az+nz*W, bx+nx*W,yb,bz+nz*W, bx-nx*W,yb,bz-nz*W, ax+nx*W,ya,az+nz*W, bx-nx*W,yb,bz-nz*W, ax-nx*W,ya,az-nz*W);
   const v0=run/.65,v1=(run+L)/.65;uv.push(1,v0,1,v1,0,v1,1,v0,0,v1,0,v0);
   for(const o of [-.72,.72]){const g=new THREE.BoxGeometry(.08,.14,L+.02);g.rotateY(Math.atan2(dx,dz));g.translate((ax+bx)/2+nx*o,(ya+yb)/2+.1,(az+bz)/2+nz*o);steel.push(g);}
   if(t.electrified){since+=L;if(since>55){since=0;masts.push([ax+nx*2.6,az+nz*2.6,Math.atan2(dx,dz)]);}}
   run+=L;
  }
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(bed,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.computeVertexNormals();
 const bedMesh=new THREE.Mesh(g,new THREE.MeshStandardMaterial({map:sleeperTexture(),roughness:.95,polygonOffset:true,polygonOffsetFactor:-2}));bedMesh.receiveShadow=true;bedMesh.name='Track bed';group.add(bedMesh);
 // merge rails in batches (thousands of boxes)
 for(let i=0;i<steel.length;i+=4000){const m=new THREE.Mesh(mergeGeometries(steel.slice(i,i+4000).map(b=>b.toNonIndexed())),new THREE.MeshStandardMaterial({color:'#8d9294',metalness:.7,roughness:.35}));m.name='Rails';group.add(m);}
 steel.forEach(b=>b.dispose());
 if(masts.length){
  const mg=mergeGeometries([new THREE.CylinderGeometry(.09,.12,7,6).translate(0,3.5,0),new THREE.BoxGeometry(.08,.08,2.8).translate(0,6.6,1.3).rotateY(Math.PI/2)].map(x=>x.toNonIndexed()));
  const im=new THREE.InstancedMesh(mg,new THREE.MeshStandardMaterial({color:'#6d7477',metalness:.5,roughness:.5}),masts.length),m4=new THREE.Matrix4(),q=new THREE.Quaternion(),UP=new THREE.Vector3(0,1,0),one=new THREE.Vector3(1,1,1),v=new THREE.Vector3();
  masts.forEach(([x,z,yaw],i)=>im.setMatrixAt(i,m4.compose(v.set(x,groundAt(x,z),z),q.setFromAxisAngle(UP,yaw),one)));im.computeBoundingSphere();im.castShadow=true;im.name='Catenary masts';group.add(im);
 }
 return {group};
}
