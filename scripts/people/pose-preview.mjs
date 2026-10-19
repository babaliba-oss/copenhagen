// Dev check for the seated and cycling poses: poses a character model in Node and writes its posed vertices (plus small
// markers for the targets) as JSON for a software render. node scripts/people/pose-preview.mjs <name> <out.json> [pose]
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {rigOf,measure,pose,RIDE,SIT,POSE_HEIGHT,standSpecFrom} from '../../src/people-poses.js';
const [name,out,which='all']=process.argv.slice(2);
const base='public/models/people/';
const load=f=>new Promise((res,rej)=>{const b=gunzipSync(readFileSync(base+f));new GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',res,rej);});
const rig=name.startsWith('W_')?'_w':name.startsWith('R_')?'_r':'';
const [g,anims]=await Promise.all([load(name+'.glb.gz'),load(`anims${rig}.glb.gz`)]);
const clips=Object.fromEntries(anims.animations.map(a=>[a.name,a]));
const box=new THREE.Box3().setFromObject(g.scene),height=Math.min(1.87,box.max.y-box.min.y),s=height/POSE_HEIGHT;
const BIKE=RIDE,SEAT=SIT;
const poses={sit:SEAT,cycle0:{...BIKE,crank:{...BIKE.crank,a:0}},cycle1:{...BIKE,crank:{...BIKE.crank,a:Math.PI/2}},idle:null,stand:'stand'};
const result={};
for(const [k,spec] of Object.entries(poses)){
 if(which!=='all'&&which!==k)continue;
 const root=clone(g.scene);let mesh=null;root.traverse(o=>{if(o.isSkinnedMesh&&!mesh)mesh=o;});
 const mixer=new THREE.AnimationMixer(root);mixer.clipAction(clips.Idle).play();mixer.setTime(0);root.updateMatrixWorld(true);
 const bones=rigOf(root);if(!bones)throw Error('rig not found');
 const m=measure(bones);let off=new THREE.Vector3();
 if(spec)off=pose(root,bones,m,spec==='stand'?standSpecFrom(m,s):spec,s); // from the Idle pose (stopping the action would put the bind pose back)
 root.updateMatrixWorld(true);
 const n=mesh.geometry.attributes.position.count,P=[],v=new THREE.Vector3();
 for(let i=0;i<n;i++){mesh.getVertexPosition(i,v);v.applyMatrix4(mesh.matrixWorld).add(off);P.push(v.x,v.y,v.z);}
 const C=Array.from(mesh.geometry.attributes.color?.array||new Float32Array(n*3).fill(.7)).slice(0,n*(mesh.geometry.attributes.color?.itemSize||3));
 const I=Array.from(mesh.geometry.index.array);
 const marks=[];if(spec&&spec!=='stand'){const t=spec.crank?[[0,spec.crank.y*s,spec.crank.z*s]]:[];for(const h of spec.hands)t.push([h[0]*s,h[1]*s,h[2]*s],[-h[0]*s,h[1]*s,h[2]*s]);t.push([0,spec.hipY*s,spec.hipZ*s]);marks.push(...t);}
 result[k]={P,C,cs:mesh.geometry.attributes.color?.itemSize||3,I,marks,s,height,lens:{thigh:m.thighLenL,shin:m.shinLenL,upper:m.upperLenL,fore:m.foreLenL,hip:m.hip.toArray()}};
}
writeFileSync(out,JSON.stringify(result));
console.log(name,'height',height.toFixed(3),'s',s.toFixed(3),Object.fromEntries(Object.entries(result).map(([k,r])=>[k,r.lens])));
