import * as THREE from 'three';
// City-wide instanced props (1760 stalls, rampart cannons) drew every instance in every frame wherever the player
// was. This keeps only those within `range` of the player in the mesh, repacked when the player has moved 20 m.
// points: [[x,z],…] in the mesh's instance order as built.
export function rangeInstances(mesh,points,range){
 const n=points.length,mats=[],cols=mesh.instanceColor?[]:null,m=new THREE.Matrix4(),c=new THREE.Color();
 for(let i=0;i<n;i++){mesh.getMatrixAt(i,m);mats.push(m.clone());if(cols){mesh.getColorAt(i,c);cols.push(c.clone());}}
 if(!mesh.boundingSphere)mesh.computeBoundingSphere(); // city-wide sphere, kept: conservative for culling
 let last=null;
 return {update(p){
  if(!p||last&&Math.hypot(p.x-last.x,p.z-last.z)<20)return;last={x:p.x,z:p.z};
  let k=0;for(let i=0;i<n;i++){const [x,z]=points[i];if(Math.abs(x-p.x)>range||Math.abs(z-p.z)>range||Math.hypot(x-p.x,z-p.z)>range)continue;mesh.setMatrixAt(k,mats[i]);if(cols)mesh.setColorAt(k,cols[i]);k++;}
  mesh.count=k;mesh.visible=k>0;mesh.instanceMatrix.needsUpdate=true;if(cols)mesh.instanceColor.needsUpdate=true;}};
}
