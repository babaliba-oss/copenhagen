import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {waterAt} from '../terrain.js';

// Boats (scripts/boats.py → boats.json): moored sailboats, motor boats and wooden boats along the quays,
// three-masted ships in 1760, and canal tour boats that go round the inner harbour. Procedural,
// vertex-coloured, one InstancedMesh per kind; they bob a little on the water.
const paint=(g,hex)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();for(const k of Object.keys(n.attributes))if(k!=='position'&&k!=='normal')n.deleteAttribute(k);const c=new THREE.Color(hex),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));return n;};
const box=(w,h,d,x,y,z,hex)=>paint(new THREE.BoxGeometry(w,h,d).translate(x,y,z),hex);
const cyl=(r0,r1,h,x,y,z,hex,seg=6)=>paint(new THREE.CylinderGeometry(r0,r1,h,seg).translate(x,y,z),hex);
// A hull: a box with the bow pinched to a point and the bottom narrowed. Length along Z, bow at -Z. The top
// `band` metres take a second colour (the painted strake under the gunwale on Nyhavn's wooden ships).
function hull(w,h,len,hex,deck='#c9b48a',sheer=.15,band=null,bandH=.32){
 const g=new THREE.BoxGeometry(w,h,len,2,3,12),p=g.attributes.position;
 for(let i=0;i<p.count;i++){let x=p.getX(i),y=p.getY(i),z=p.getZ(i);const t=(z+len/2)/len; // 0 bow, 1 stern
  const bow=t<.4?Math.sin(t/.4*Math.PI/2):1,stern=t>.85?1-(t-.85)/.15*.3:1;x*=Math.max(.02,bow)*stern;
  const keel=(y+h/2)/h;x*=.45+.55*keel;if(band&&y<h/2&&y>-h/2)y=h/2-bandH; // middle row at the strake line
  y+=sheer*Math.pow(1-t,3)*(y>-h/2?1:0);p.setXYZ(i,x,y,z);}
 g.computeVertexNormals();const n=paint(g.translate(0,h/2-.3,0),hex);
 if(band){const c=new THREE.Color(band),col=n.attributes.color,pos=n.attributes.position;
  // per triangle: any face whose lowest corner is at or above the strake line takes the band colour
  for(let i=0;i<pos.count;i+=3){const lo=Math.min(pos.getY(i),pos.getY(i+1),pos.getY(i+2));if(lo>h-.3-bandH-.05-1e-3)for(let k=0;k<3;k++)col.setXYZ(i+k,c.r,c.g,c.b);}}
 return [n,box(w*.84,.05,len*.62,0,h-.3,len*.16,deck)];
}
// A thin round spar between two points (masts, booms, stays, shrouds).
const _up=new THREE.Vector3(0,1,0),_d=new THREE.Vector3(),_q=new THREE.Quaternion(),_m=new THREE.Matrix4();
function rod(a,b,r,hex,seg=4){_d.set(b[0]-a[0],b[1]-a[1],b[2]-a[2]);const len=_d.length();_q.setFromUnitVectors(_up,_d.normalize());
 const g=new THREE.CylinderGeometry(r,r,len,seg);g.applyMatrix4(_m.compose(new THREE.Vector3((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2),_q,new THREE.Vector3(1,1,1)));return paint(g,hex);}
const sail=()=>{const top=[0,12,-.6],deck=1.05;return mergeGeometries([...hull(2.4,1.1,8,'#f4f4f0','#c9b48a',.15,'#1f3b5b',.16),box(1.3,.55,2.2,0,1.05,.9,'#e8e6de'),box(1.32,.2,1.2,0,1.25,.5,'#2b3a44'),
 rod([0,deck,-.6],top,.06,'#c9ccce',6),rod([0,2.1,-.5],[0,2.1,3],.05,'#c9ccce'),box(.32,.3,3,0,2.25,1.2,'#1f3b5b'), // mast, boom, sail cover
 rod(top,[0,deck,-3.9],.012,'#8a8f93'),rod(top,[1.1,deck,-.2],.012,'#8a8f93'),rod(top,[-1.1,deck,-.2],.012,'#8a8f93'),rod(top,[0,deck+.2,3.9],.012,'#8a8f93')]);}; // stays and shrouds
const motor=()=>mergeGeometries([...hull(2.2,1.0,6.5,'#e9e6dc','#c9b48a',.15,'#7b1f22',.12),box(1.5,.9,2.4,0,1.15,.6,'#f2f0ea'),box(1.52,.4,1.6,0,1.35,.3,'#2b3a44'),box(1.2,.05,1.6,0,1.62,.7,'#d9d6cc')]);
// Nyhavn's wooden ships: dark tarred hull with a painted strake, deckhouse aft, two masts with booms and furled
// sails, a bowsprit and the standing rigging.
const wooden=()=>{const d=1.62,main=[0,15.5,-2],miz=[0,11.5,3.4],bow=[0,2.3,-9.4];return mergeGeometries([...hull(3.6,1.9,13,'#24201c','#a08058',.45,'#7c2a22',.34),
 box(1.7,1.0,2.4,0,d+.5,4.2,'#6b4d32'),box(1.9,.12,2.6,0,d+1.05,4.2,'#3b2a1c'),box(.9,.5,1.1,0,d+.25,-3.6,'#6b4d32'), // deckhouse, roof, hatch
 rod([0,d,-2],main,.15,'#6b5238',8),rod([0,d,3.4],miz,.12,'#6b5238',8),rod([0,1.95,-6.2],bow,.1,'#6b5238',6), // masts and bowsprit
 rod([0,2.9,-2],[0,2.9,3],.08,'#6b5238',6),rod([0,2.9,3.4],[0,2.9,6.6],.07,'#6b5238',6), // booms
 box(.42,.4,4.6,0,3.15,.5,'#e3d8c2'),box(.38,.36,2.9,0,3.15,5,'#e3d8c2'), // furled sails
 rod(main,bow,.02,'#2a2622'),rod(main,miz,.02,'#2a2622'),rod(miz,[0,d,6.4],.02,'#2a2622'),
 ...[-1,1].flatMap(sd=>[rod(main,[sd*1.75,d,-2.4],.018,'#2a2622'),rod(main,[sd*1.75,d,-1],.018,'#2a2622'),rod(miz,[sd*1.6,d,3.6],.018,'#2a2622')])]);};
const ship=()=>mergeGeometries([...hull(7,3.6,30,'#3b2a1c','#a8875c',.9,'#c19a45',.5),box(6.8,2.2,4,0,4.3,12.5,'#4a3020'),
 ...[-9,0,8].flatMap((z,i)=>[cyl(.25,.32,[22,26,18][i],0,[11,13,9][i]+2,z,'#5b4630',8),box(9,4.5,.12,0,[11,14,9][i],z+.4,'#efe7d3'),box(7,3.5,.12,0,[16.5,20,13.5][i],z+.4,'#efe7d3')]),rod([0,4,-14],[0,6.5,-21],.2,'#5b4630',6),box(.6,1.4,1.6,0,4.3,-15,'#c8202a')]);
const tour=()=>mergeGeometries([...hull(4.6,1.2,17,'#1f3f63','#d9d6cc',.1),box(4.2,.12,13.5,0,1.9,.6,'#e9e7e0'),...[-5,-2.5,0,2.5,5].map(z=>box(4.25,.65,.06,0,1.55,z+.6,'#c9d6dd')),box(4.3,.06,14,0,1.25,.6,'#2b4a6e')]);
// Havnebussen: a long low harbour bus, yellow hull, glazed cabin with a blue band, flat roof.
const havnebus=()=>mergeGeometries([...hull(5.2,1.3,22,'#e2b33c','#5f6a70',.15),box(4.4,1.9,15,0,2.1,1.2,'#f2f0ea'),box(4.46,.9,14.4,0,2.35,1.2,'#25313a'),box(4.5,.22,15.2,0,1.32,1.2,'#1f4f8a'),box(4.6,.14,15.6,0,3.1,1.2,'#e9e7e0'),box(1.6,.9,2.2,0,3.6,4.8,'#f2f0ea')]);
const BUILD={sail,motor,wooden,ship,tour};

export function createBoats(data,{waterY=-1.2,era=null}={}){
 const group=new THREE.Group();group.name='Boats';
 // The sea surface is drawn at the terrain's water level (sea.js drapes it 10 cm under waterAt); a fixed level
 // left boats metres above the water. Each boat sits on the water under it.
 const level=(x,z)=>{const w=waterAt(x,z);return (w==null?waterY:w-.1);};
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
 // Harbour buses: along the ferry path end to end and back, 15 s at each stop.
 const ferries=[];
 if(era!==1760)for(const f of data?.ferries||[]){const pts=f.path,cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]));
  const stops=f.stops.map(i=>cum[i]);for(let k=0;k<2;k++)ferries.push({pts,cum,stops,s:k?cum.at(-1)*.55:0,dir:k?-1:1,wait:0,yaw:0});}
 let ferryMesh=null;if(ferries.length){ferryMesh=new THREE.InstancedMesh(havnebus(),mat,ferries.length);ferryMesh.castShadow=true;ferryMesh.frustumCulled=false;ferryMesh.name='Harbour buses';group.add(ferryMesh);}
 const ferryAt=(f,s)=>{let k=1;while(k<f.cum.length-1&&f.cum[k]<s)k++;const a=f.pts[k-1],b=f.pts[k],u=(s-f.cum[k-1])/Math.max(.01,f.cum[k]-f.cum[k-1]);return [a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u,Math.atan2(-(b[0]-a[0]),-(b[1]-a[1]))];};
 let t=0;
 function placeMesh(im,list){for(let i=0;i<list.length;i++){const b=list[i],x=b[0],z=b[1],sc=b[4],ph=x*.13+z*.07;e.set(Math.sin(t*.9+ph)*.025,b[2],Math.sin(t*.7+ph)*.035);b.wl??=level(x,z);m4.compose(v.set(x,b.wl-.35+Math.sin(t*1.1+ph)*.06,z),q.setFromEuler(e),s.set(sc,sc,sc));im.setMatrixAt(i,m4);}im.instanceMatrix.needsUpdate=true;}
 function place(player){for(const c of chunks.values()){const d=player?Math.hypot(c.x-player.x,c.z-player.z):0;const vis=d<650;for(const en of c.meshes){en.im.visible=vis;en.im.castShadow=d<350;if(vis&&d<400)placeMesh(en.im,en.list);}}}
 for(const {im,list} of meshes){placeMesh(im,list);im.computeBoundingSphere();}
 let acc=0;
 return {group,update(dt,player){
  t+=dt;acc+=dt;
  if(tourMesh){movers.forEach((m,i)=>{m.s=(m.s+dt*3.2)%m.len;let k=1;while(k<m.cum.length-1&&m.cum[k]<m.s)k++;const a=m.pts[k-1],b=m.pts[k],f=(m.s-m.cum[k-1])/Math.max(.01,m.cum[k]-m.cum[k-1]);
   const x=a[0]+(b[0]-a[0])*f,z=a[1]+(b[1]-a[1])*f,yaw=Math.atan2(-(b[0]-a[0]),-(b[1]-a[1]));e.set(0,yaw,Math.sin(t+i)*.02);m4.compose(v.set(x,level(x,z)-.25,z),q.setFromEuler(e),s.set(1,1,1));tourMesh.setMatrixAt(i,m4);});tourMesh.instanceMatrix.needsUpdate=true;}
  if(ferryMesh){ferries.forEach((f,i)=>{
    if(f.wait>0)f.wait-=dt;else{const before=f.s,L=f.cum.at(-1);f.s=Math.max(0,Math.min(L,f.s+f.dir*dt*5.5));
     const hit=f.stops.find(x=>(before-x)*(f.s-x)<0||Math.abs(f.s-x)<.01&&Math.abs(before-x)>.01);if(hit!=null){f.s=hit;f.wait=15;}
     if(f.s<=0||f.s>=L){f.dir*=-1;f.wait=Math.max(f.wait,20);}}
    const [x,z,yaw0]=ferryAt(f,f.s),yaw=yaw0+(f.dir<0?Math.PI:0);let dy=yaw-f.yaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));f.yaw+=dy*Math.min(1,dt*1.5);
    e.set(Math.sin(t*.8+i)*.012,f.yaw,Math.sin(t*.6+i)*.02);m4.compose(v.set(x,level(x,z)-.3,z),q.setFromEuler(e),s.set(1,1,1));ferryMesh.setMatrixAt(i,m4);});ferryMesh.instanceMatrix.needsUpdate=true;}
  if(acc>.12){acc=0;place(player);} // bobbing at ~8 Hz is plenty
 }};
}
