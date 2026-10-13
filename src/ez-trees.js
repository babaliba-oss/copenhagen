import * as THREE from 'three';
import {template} from './route-trees.js';
// Detailed (EZ-Tree) crowns for the trees nearest the player in cities other than Helsinki: the same
// procedural trees as Helsinki's harbour and boulevards, picked by species family. One BatchedMesh
// per kind and part (bark, leaves), each holding every tree of that kind, hidden until it is near.
const KIND={spruce:2,fir:2,larch:2,pine:2,birch:1,lime:3,maple:4,elm:4,ash:4,chestnut:4,broadleaf:4,poplar:4,oak:0,willow:0,blossom:0,rowan:0,alder:0};
const SEED={0:1836,1:2918,2:4137,3:5021,4:6480};
export const ezKind=family=>KIND[family]??null;
export function createEzTrees(items){ // items: [{x,z,y,kind,width,height,yaw,tint}]
 const group=new THREE.Group();group.name='Detailed trees (near)';
 const byKind=new Map();items.forEach((it,i)=>{if(it.kind==null)return;if(!byKind.has(it.kind))byKind.set(it.kind,[]);byKind.get(it.kind).push(i);});
 const slot=new Array(items.length).fill(null),m=new THREE.Object3D(),c=new THREE.Color();let triangles=0;
 for(const [kind,list] of byKind){
  const parts=template(kind,SEED[kind],true),meshes=[];
  for(const [pi,{geometry,material}] of parts.entries()){
   const bm=new THREE.BatchedMesh(list.length,geometry.attributes.position.count,geometry.index?.count||0,material);
   const gid=bm.addGeometry(geometry);bm.name=`Detailed trees ${kind}/${pi}`;bm.perObjectFrustumCulled=true;bm.castShadow=true;bm.receiveShadow=true;bm.userData.shadowLod=true;
   for(const i of list){const it=items[i],id=bm.addInstance(gid);m.position.set(it.x,it.y,it.z);m.rotation.set(0,it.yaw,0);m.scale.set(it.width,it.height,it.width);m.updateMatrix();bm.setMatrixAt(id,m.matrix);
    bm.setColorAt(id,c.setHSL(pi?.24:.1,pi?.12:.05,.8+(it.tint-.92)*.9));bm.setVisibleAt(id,false);if(pi===0)slot[i]={meshes,id};}
   triangles+=(geometry.index?.count||0)/3;meshes.push(bm);group.add(bm);geometry.dispose();
  }
 }
 return {group,has:i=>!!slot[i],show(i,on){const s=slot[i];if(s)for(const bm of s.meshes)bm.setVisibleAt(s.id,on);},stats:{kinds:byKind.size,templateTriangles:triangles}};
}
