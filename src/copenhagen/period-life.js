import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {groundAt} from '../terrain.js';
import {pointInPolygon} from '../geo.js';
import {createInstancedPeople} from '../market-life.js';

// Copenhagen 1760 street life the traffic simulation does not give: crowds on the squares, sailors and
// dock hands on the quays among barrels, crates and sacks, soldiers at the city gates, handcarts and hay
// wagons, and geese, hens and pigs. Everything is placed from the city's own data (squares = start points,
// quays = edges of navigable water), kept off buildings and water, instanced, and culled by distance.
const paint=(g,hex)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();for(const k of Object.keys(n.attributes))if(k!=='position'&&k!=='normal')n.deleteAttribute(k);const c=new THREE.Color(hex),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));return n;};
const box=(w,h,d,x,y,z,hex)=>paint(new THREE.BoxGeometry(w,h,d).translate(x,y,z),hex);
const cyl=(r0,r1,h,x,y,z,hex,seg=8)=>paint(new THREE.CylinderGeometry(r0,r1,h,seg).translate(x,y,z),hex);
const WOOD='#6b4a2e',DARKW='#4a3220',IRON='#2a2826',CANVAS='#cbbb98';
const PROPS={
 barrel:()=>mergeGeometries([cyl(.3,.27,.85,0,.43,0,'#7a5634',10),cyl(.31,.31,.05,0,.18,0,IRON,10),cyl(.31,.31,.05,0,.68,0,IRON,10)]),
 crate:()=>mergeGeometries([box(.8,.6,.6,0,.3,0,'#8a6a42'),box(.82,.06,.62,0,.58,0,DARKW),box(.06,.6,.62,-.38,.3,0,DARKW),box(.06,.6,.62,.38,.3,0,DARKW)]),
 sack:()=>mergeGeometries([paint(new THREE.SphereGeometry(.32,8,6).scale(1,.75,.8).translate(0,.24,0),CANVAS),cyl(.08,.12,.14,0,.5,0,CANVAS,6)]),
 handcart:()=>{const p=[box(1.3,.08,.8,0,.62,0,WOOD),box(1.3,.3,.05,0,.78,.4,WOOD),box(1.3,.3,.05,0,.78,-.4,WOOD),box(.05,.3,.8,.65,.78,0,WOOD),box(1.6,.06,.06,-1.1,.6,.3,DARKW),box(1.6,.06,.06,-1.1,.6,-.3,DARKW)];
  for(const z of [-.45,.45])p.push(paint(new THREE.TorusGeometry(.5,.04,4,12).translate(.2,.5,z),DARKW));p.push(box(.9,.35,.6,.1,.85,0,CANVAS));return mergeGeometries(p);},
 haywagon:()=>{const p=[box(3,.1,1.6,0,.9,0,WOOD),box(2.8,1,1.5,0,1.45,0,'#c9b25e'),paint(new THREE.SphereGeometry(.85,8,5).scale(1.6,.6,.95).translate(0,1.95,0),'#d4bf6a'),box(1.4,.06,.06,-2.2,.85,0,DARKW)];
  for(const x of [-1,1])for(const z of [-.85,.85])p.push(paint(new THREE.TorusGeometry(.55,.05,4,12).translate(x,.55,z),DARKW));return mergeGeometries(p);},
 tree_stump:null};
const ANIMALS={
 goose:()=>mergeGeometries([paint(new THREE.SphereGeometry(.18,8,6).scale(1.4,1,1).translate(0,.25,0),'#efece4'),cyl(.04,.05,.28,.2,.42,0,'#efece4',6),box(.1,.05,.05,.27,.56,0,'#e08a2a')]),
 hen:()=>mergeGeometries([paint(new THREE.SphereGeometry(.14,8,6).scale(1.3,1,1).translate(0,.2,0),'#8a5a32'),paint(new THREE.SphereGeometry(.07,6,5).translate(.15,.34,0),'#8a5a32'),box(.04,.06,.02,.17,.42,0,'#c8202a')]),
 pig:()=>mergeGeometries([paint(new THREE.SphereGeometry(.35,10,8).scale(1.5,.9,.9).translate(0,.45,0),'#e2a99a'),paint(new THREE.SphereGeometry(.18,8,6).translate(.55,.5,0),'#e2a99a'),cyl(.08,.08,.08,.72,.5,0,'#c98a80',8).rotateZ(Math.PI/2)])};
const rnd=seed=>()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646;};

export function createPeriodLife({city,world,water=[],squares=[],gates=[]}){
 const group=new THREE.Group();group.name='1760 street life';const r=rnd(1760);
 const wet=(x,z)=>water.some(w=>{const b=w.bbox;return (!b||x>=b[0]&&x<=b[2]&&z>=b[1]&&z<=b[3])&&pointInPolygon(x,z,w.rings);});
 const free=(x,z,rad=.6)=>!world.buildings.at(x,z)&&!wet(x,z)&&!world.buildings.at(x+rad,z)&&!world.buildings.at(x-rad,z)&&!world.buildings.at(x,z+rad)&&!world.buildings.at(x,z-rad);
 const crowds=new Map(),props={},animals=[];
 const cellOf=(x,z)=>`${Math.floor(x/350)},${Math.floor(z/350)}`;
 const person=(x,z,extra={})=>{if(!free(x,z))return false;const k=cellOf(x,z);if(!crowds.has(k))crowds.set(k,[]);crowds.get(k).push({x,z,heading:r()*Math.PI*2,pose:r()<.6?'chat':'browse',walking:false,...extra});return true;};
 const prop=(kind,x,z,yaw=r()*6.28)=>{if(!free(x,z,.5))return;(props[kind]??=[]).push([x,z,yaw]);};
 // squares: market crowd in small groups facing each other, a cart or two, hens about
 for(const sq of squares){
  const groups=5+Math.floor(r()*4);
  for(let g=0;g<groups;g++){const a=r()*6.28,d=4+r()*16,cx=sq.x+Math.cos(a)*d,cz=sq.z+Math.sin(a)*d,n=2+Math.floor(r()*3);
   for(let i=0;i<n;i++){const b=i/n*6.28+r()*.4,px=cx+Math.cos(b)*.8,pz=cz+Math.sin(b)*.8;person(px,pz,{heading:Math.atan2(px-cx,pz-cz)});}}
  for(let i=0;i<3;i++){const a=r()*6.28,d=8+r()*14;prop(r()<.7?'handcart':'haywagon',sq.x+Math.cos(a)*d,sq.z+Math.sin(a)*d);}
  if(r()<.7)animals.push({kind:r()<.5?'hen':'goose',x:sq.x+(r()-.5)*20,z:sq.z+(r()-.5)*20,n:5+Math.floor(r()*5)});
 }
 // quays: along navigable water, a sailor or dock hand every ~25 m, cargo stacked beside them
 const NO=/lake|moat|pond|basin|reflect|fountain/,NONAME=/grav|sø|spring|dam/i;
 let quayN=0;
 for(const w of water){if(NO.test(w.kind||'')||NONAME.test(w.name||''))continue;
  for(const ring of w.rings)for(let i=1;i<ring.length&&quayN<420;i++){const a=ring[i-1],b=ring[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(L<6)continue;
   const ux=(b[0]-a[0])/L,uz=(b[1]-a[1])/L;
   for(let s=r()*20;s<L;s+=22+r()*10){const x=a[0]+ux*s,z=a[1]+uz*s;if(Math.hypot(x,z)>2100)continue;
    for(const side of [1,-1]){const px=x-uz*3.2*side,pz=z+ux*3.2*side;if(!free(px,pz))continue;
     if(r()<.55){person(px,pz,{heading:Math.atan2(uz*side,-ux*side),pose:r()<.5?'chat':'browse',shirt:['#2a3a5a','#3a2f25','#5a2a22','#e6dcc4'][Math.floor(r()*4)]});quayN++;}
     const ox=px+ux*1.6,oz=pz+uz*1.6;const k=r();prop(k<.45?'barrel':k<.75?'crate':'sack',ox,oz);if(r()<.5)prop('barrel',ox+ux*.7,oz+uz*.7);if(r()<.3)prop('sack',ox-ux*.6,oz-uz*.6);
     break;}}}}
 // city gates: two to four soldiers in the King's blue
 for(const g of gates)for(let i=0;i<4;i++){const a=i*Math.PI/2+.3;person(g.x+Math.cos(a)*3.5,g.z+Math.sin(a)*3.5,{pose:null,heading:a+Math.PI,shirt:'#23325e',trousers:'#e8e0cc',hat:'#151515',coat:.9,talkable:false});}
 // build crowds (one instanced batch per 350 m cell: far cells are culled whole)
 const batches=[];let seed=1;
 for(const [k,list] of crowds){const cx=list.reduce((s,p)=>s+p.x,0)/list.length,cz=list.reduce((s,p)=>s+p.z,0)/list.length;
  const b=createInstancedPeople(list,{name:'1760 crowd',center:{x:cx,z:cz},seed:seed++*97});group.add(b.group);batches.push(b);}
 // props (one instanced mesh per kind per 400 m chunk)
 const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85});const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),one=new THREE.Vector3(1,1,1),UP=new THREE.Vector3(0,1,0);
 const chunks=[];
 for(const [kind,list] of Object.entries(props)){if(!PROPS[kind])continue;const geo=PROPS[kind]();const by=new Map();
  for(const it of list){const k=`${Math.floor(it[0]/400)},${Math.floor(it[1]/400)}`;if(!by.has(k))by.set(k,[]);by.get(k).push(it);}
  for(const its of by.values()){const im=new THREE.InstancedMesh(geo,mat,its.length);im.name=`1760 ${kind}`;im.castShadow=true;im.receiveShadow=true;
   its.forEach(([x,z,yaw],i)=>im.setMatrixAt(i,m4.compose(v.set(x,groundAt(x,z),z),q.setFromAxisAngle(UP,yaw),one)));im.computeBoundingSphere();group.add(im);
   chunks.push({im,x:its.reduce((s,p)=>s+p[0],0)/its.length,z:its.reduce((s,p)=>s+p[1],0)/its.length});}}
 // animals: flocks pecking about an anchor
 const flocks=[];
 for(const kind of Object.keys(ANIMALS)){const fl=animals.filter(a=>a.kind===kind);if(kind==='pig')for(const sq of squares.slice(0,6))fl.push({kind:'pig',x:sq.x+(r()-.5)*24,z:sq.z+(r()-.5)*24,n:1+Math.floor(r()*2)});
  const members=[];for(const f of fl)for(let i=0;i<f.n;i++){const x=f.x+(r()-.5)*4,z=f.z+(r()-.5)*4;if(free(x,z,.3))members.push({hx:x,hz:z,x,z,a:r()*6.28,ph:r()*10});}
  if(!members.length)continue;const im=new THREE.InstancedMesh(ANIMALS[kind](),mat,members.length);im.name=`1760 ${kind}`;im.castShadow=true;im.frustumCulled=false;group.add(im);flocks.push({im,members,kind});}
 let t=0,acc=0;
 function update(dt,player){
  t+=dt;acc+=dt;for(const b of batches)b.update(dt,player);
  if(acc<.05)return;acc=0;
  for(const c of chunks)c.im.visible=!player||Math.hypot(c.x-player.x,c.z-player.z)<520;
  for(const f of flocks){const sp=f.kind==='pig'?.25:.45;let any=false;
   f.members.forEach((m,i)=>{const near=!player||Math.hypot(m.x-player.x,m.z-player.z)<160;if(near){any=true;
     // wander: a slow circle around home, a peck now and then
     m.a+=(Math.sin(t*.3+m.ph)*.6)*.05;const nx=m.x+Math.cos(m.a)*sp*.05,nz=m.z+Math.sin(m.a)*sp*.05;
     if(Math.hypot(nx-m.hx,nz-m.hz)>3.5||!free(nx,nz,.2))m.a+=Math.PI*.7;else{m.x=nx;m.z=nz;}}
    const peck=f.kind==='pig'?0:Math.max(0,Math.sin(t*3+m.ph))*.35;
    f.im.setMatrixAt(i,m4.compose(v.set(m.x,groundAt(m.x,m.z),m.z),q.setFromEuler(new THREE.Euler(0,-m.a,-peck)),one));});
   f.im.visible=any;if(any)f.im.instanceMatrix.needsUpdate=true;}
 }
 const people=[...crowds.values()].reduce((n,l)=>n+l.length,0);
 group.userData={people,props:Object.fromEntries(Object.entries(props).map(([k,l])=>[k,l.length])),animals:flocks.reduce((n,f)=>n+f.members.length,0),batches:batches.length};
 return {group,update};
}
