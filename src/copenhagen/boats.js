import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

// Boats (scripts/boats.py → boats.json): moored sailboats, motor boats and wooden boats along the quays,
// three-masted ships in 1760, and canal tour boats that go round the inner harbour. Procedural,
// vertex-coloured, one InstancedMesh per kind; they bob a little on the water.
const paint=(g,hex)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();for(const k of Object.keys(n.attributes))if(k!=='position'&&k!=='normal')n.deleteAttribute(k);const c=new THREE.Color(hex),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));return n;};
const box=(w,h,d,x,y,z,hex)=>paint(new THREE.BoxGeometry(w,h,d).translate(x,y,z),hex);
const cyl=(r0,r1,h,x,y,z,hex,seg=6)=>paint(new THREE.CylinderGeometry(r0,r1,h,seg).translate(x,y,z),hex);
// A hull: a box with the bow pinched to a point and the bottom narrowed. Length along Z, bow at -Z.
function hull(w,h,len,hex,deck='#c9b48a',sheer=.15){
 const g=new THREE.BoxGeometry(w,h,len,2,2,10),p=g.attributes.position;
 for(let i=0;i<p.count;i++){let x=p.getX(i),y=p.getY(i),z=p.getZ(i);const t=(z+len/2)/len; // 0 bow, 1 stern
  const bow=t<.4?Math.sin(t/.4*Math.PI/2):1,stern=t>.85?1-(t-.85)/.15*.3:1;x*=Math.max(.02,bow)*stern;
  const keel=(y+h/2)/h;x*=.45+.55*keel;y+=sheer*Math.pow(1-t,3)*(y>0?1:0);p.setXYZ(i,x,y,z);}
 g.computeVertexNormals();return [paint(g.translate(0,h/2-.3,0),hex),box(w*.84,.05,len*.62,0,h-.3,len*.16,deck)];
}
const sail=()=>mergeGeometries([...hull(2.4,1.1,8,'#f4f4f0'),box(1.3,.6,2.2,0,1.05,.8,'#e8e6de'),cyl(.06,.08,11,0,6.2,-.6,'#c9ccce'),box(.07,.07,3.6,0,2,1.2,'#c9ccce'),box(.9,.5,3.2,0,1.0,-.1,'#1f3b5b')]);
const motor=()=>mergeGeometries([...hull(2.2,1.0,6.5,'#e9e6dc'),box(1.5,.9,2.4,0,1.15,.6,'#f2f0ea'),box(1.52,.4,1.6,0,1.35,.3,'#2b3a44')]);
const wooden=()=>mergeGeometries([...hull(3.6,1.6,12.5,'#2a2420','#9b7a52',.4),box(4.1,.3,16*.85,0,1.55,.4,'#7a2a20'),cyl(.14,.18,15,0,9,-2.5,'#5b4630',8),cyl(.12,.15,12,0,7.5,3.5,'#5b4630',8),
 box(.08,.08,6,0,13,-2.5,'#5b4630'),box(.08,.08,5,0,10,3.5,'#5b4630'),box(1.6,1.2,2.6,0,2.2,5.2,'#6b4d32')]);
const ship=()=>mergeGeometries([...hull(7,3.6,30,'#3b2a1c','#a8875c',.9),box(7,.5,25,0,3.2,.8,'#c19a45'),box(6.8,2.2,4,0,4.3,12.5,'#4a3020'),
 ...[-9,0,8].flatMap((z,i)=>[cyl(.25,.32,[22,26,18][i],0,[11,13,9][i]+2,z,'#5b4630',8),box(9,4.5,.12,0,[11,14,9][i],z+.4,'#efe7d3'),box(7,3.5,.12,0,[16.5,20,13.5][i],z+.4,'#efe7d3')]),box(.2,.2,9,0,4,-17,'#5b4630'),box(.6,1.4,1.6,0,4.3,-15,'#c8202a')]);
const tour=()=>mergeGeometries([...hull(4.6,1.2,17,'#1f3f63','#d9d6cc',.1),box(4.2,.12,13.5,0,1.9,.6,'#e9e7e0'),...[-5,-2.5,0,2.5,5].map(z=>box(4.25,.65,.06,0,1.55,z+.6,'#c9d6dd')),box(4.3,.06,14,0,1.25,.6,'#2b4a6e')]);
const BUILD={sail,motor,wooden,ship,tour};

export function createBoats(data,{waterY=-1.2,era=null}={}){
 const group=new THREE.Group();group.name='Boats';
 const boats=data?.boats||[],mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.6,metalness:.05});
 // Chunked by 300 m and kind: chunks frustum-cull, hide past 1 km, and only those near the player bob.
 const chunks=new Map(),geos={};
 for(const bt of boats){if(!BUILD[bt[3]])continue;const k=`${Math.floor(bt[0]/300)},${Math.floor(bt[1]/300)}`;if(!chunks.has(k))chunks.set(k,{list:{},x:0,z:0,n:0});const c=chunks.get(k);(c.list[bt[3]]??=[]).push(bt);c.x+=bt[0];c.z+=bt[1];c.n++;}
 const meshes=[],m4=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),v=new THREE.Vector3(),s=new THREE.Vector3();
 for(const c of chunks.values()){c.x/=c.n;c.z/=c.n;c.meshes=[];
  for(const [kind,list] of Object.entries(c.list)){const im=new THREE.InstancedMesh(geos[kind]??=BUILD[kind](),mat,list.length);im.name=`Moored ${kind} boats`;im.userData.shadowLod=true;group.add(im);const entry={im,list,chunk:c};meshes.push(entry);c.meshes.push(entry);}}
 // Tour boats: two per loop (modern only), spaced along the route.
 const movers=[];
 if(era!==1760)for(const r of data?.routes||[]){const pts=[...r,r[0]];let len=0;const cum=[0];for(let i=1;i<pts.length;i++){len+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);cum.push(len);}
  for(let k=0;k<2;k++)movers.push({pts,cum,len,s:len*k/2});}
 let tourMesh=null;if(movers.length){tourMesh=new THREE.InstancedMesh(tour(),mat,movers.length);tourMesh.castShadow=true;tourMesh.frustumCulled=false;tourMesh.userData.shadowLod=true;tourMesh.name='Canal tour boats';group.add(tourMesh);}
 let t=0;
 function placeMesh(im,list){for(let i=0;i<list.length;i++){const b=list[i],x=b[0],z=b[1],sc=b[4],ph=x*.13+z*.07;e.set(Math.sin(t*.9+ph)*.025,b[2],Math.sin(t*.7+ph)*.035);m4.compose(v.set(x,waterY+Math.sin(t*1.1+ph)*.06,z),q.setFromEuler(e),s.set(sc,sc,sc));im.setMatrixAt(i,m4);}im.instanceMatrix.needsUpdate=true;}
 function place(player){for(const c of chunks.values()){const d=player?Math.hypot(c.x-player.x,c.z-player.z):0;const vis=d<1000;for(const en of c.meshes){en.im.visible=vis;en.im.castShadow=d<350;if(vis&&d<400)placeMesh(en.im,en.list);}}}
 for(const {im,list} of meshes){placeMesh(im,list);im.computeBoundingSphere();}
 let acc=0;
 return {group,update(dt,player){
  t+=dt;acc+=dt;
  if(tourMesh){movers.forEach((m,i)=>{m.s=(m.s+dt*3.2)%m.len;let k=1;while(k<m.cum.length-1&&m.cum[k]<m.s)k++;const a=m.pts[k-1],b=m.pts[k],f=(m.s-m.cum[k-1])/Math.max(.01,m.cum[k]-m.cum[k-1]);
   const x=a[0]+(b[0]-a[0])*f,z=a[1]+(b[1]-a[1])*f,yaw=Math.atan2(-(b[0]-a[0]),-(b[1]-a[1]));e.set(0,yaw,Math.sin(t+i)*.02);m4.compose(v.set(x,waterY+.05,z),q.setFromEuler(e),s.set(1,1,1));tourMesh.setMatrixAt(i,m4);});tourMesh.instanceMatrix.needsUpdate=true;}
  if(acc>.12){acc=0;place(player);} // bobbing at ~8 Hz is plenty
 }};
}
