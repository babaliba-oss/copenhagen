import * as THREE from 'three';
import {facadeGrain} from '../facade-grain.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {groundAt,waterAt,seaLevel} from '../terrain.js';

// Hand-built details the city's LOD2 model cannot carry, placed on its own geometry (positions are local
// metres in the shared Copenhagen projection; the spire axes are the model's top vertices):
//  Vor Frelsers Kirke  black spire with the gilded staircase winding four times round it, globe and figure
//  Børsen              the dragon spire: four copper dragon tails twisted together, three crowns
//  Little Mermaid      bronze figure on her rock at Langelinie (today only)
//  Equestrian statues  Frederik V at Amalienborg (unveiled 1771, so today only), Christian V on Kongens Nytorv,
//                      Absalon on Højbro Plads (1902, today only)
//  Gefion Fountain     the goddess and her four oxen (1908, today only)
//  Dannebrog           flags on Christiansborg and Amalienborg
//  Windmills           post mills on the 1760 bastions
const paint=(g,hex)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();for(const k of Object.keys(n.attributes))if(k!=='position'&&k!=='normal')n.deleteAttribute(k);const c=new THREE.Color(hex),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));return n;};
const at=(g,x,y,z)=>g.translate(x,y,z);
const GOLD='#d4a637',COPPER='#5f9a7f',BRONZE='#4f6f5a',STONE='#b9b2a3',DARK='#2a2725';

// A tube following a helix around the y axis: from (r0,y0) to (r1,y1) in `turns` turns.
function helix(r0,r1,y0,y1,turns,thick,hex,phase=0,seg=160){
 const pts=[];for(let i=0;i<=seg;i++){const t=i/seg,a=phase+t*turns*Math.PI*2,r=r0+(r1-r0)*t;pts.push(new THREE.Vector3(Math.cos(a)*r,y0+(y1-y0)*t,Math.sin(a)*r));}
 return paint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),seg,thick,5,false),hex);
}
function vorFrelsers(){
 const p=[paint(new THREE.ConeGeometry(4.7,34,12,1,true).translate(0,52+17,0),DARK)];
 p.push(helix(5.1,.9,51,83,4,.32,GOLD),helix(5.5,1.1,52.2,84.2,4,.08,GOLD)); // the staircase and its handrail
 for(let i=0;i<=24;i++){const t=i/24,a=t*4*Math.PI*2,r=5.5+(1.1-5.5)*t,y=52.2+32*t;p.push(at(paint(new THREE.CylinderGeometry(.05,.05,1.1,4),GOLD),Math.cos(a)*r,y-.5,Math.sin(a)*r));}
 p.push(at(paint(new THREE.SphereGeometry(1.1,14,10),GOLD),0,86.5,0),at(paint(new THREE.CylinderGeometry(.08,.08,3,6),GOLD),0,88.6,0),at(paint(new THREE.BoxGeometry(1.2,.12,.12),GOLD),0,89.4,0));
 return mergeGeometries(p);
}
function borsen(){
 const p=[paint(new THREE.BoxGeometry(3.4,3.2,3.4).translate(0,22.6,0),COPPER),paint(new THREE.CylinderGeometry(1.9,2.3,1.2,8).translate(0,24.8,0),COPPER)];
 for(let k=0;k<4;k++)p.push(helix(1.6,.12,25,49,2.2,.42-.0,COPPER,k*Math.PI/2,90));
 for(const [y,r] of [[31,1.25],[37,.9],[43,.55]])p.push(paint(new THREE.TorusGeometry(r,.12,6,16).rotateX(Math.PI/2).translate(0,y,0),GOLD));
 for(let k=0;k<4;k++){const a=k*Math.PI/2+.4;p.push(at(paint(new THREE.ConeGeometry(.35,1.2,5).rotateZ(Math.PI/2).rotateY(-a),COPPER),Math.cos(a)*2,25.6,Math.sin(a)*2));} // dragon heads
 p.push(paint(new THREE.CylinderGeometry(.05,.1,5,6).translate(0,51.2,0),GOLD),at(paint(new THREE.SphereGeometry(.4,10,8),GOLD),0,50,0));
 return mergeGeometries(p);
}
function mermaid(){
 return mergeGeometries([paint(new THREE.DodecahedronGeometry(1.6,0).scale(1.4,.7,1.1).translate(0,.4,0),'#6d6a63'),paint(new THREE.DodecahedronGeometry(1,0).translate(.9,.9,.4),'#5f5c56'),
  paint(new THREE.CapsuleGeometry(.22,.55,4,8).rotateZ(.25).translate(0,1.65,0),BRONZE),paint(new THREE.SphereGeometry(.15,10,8).translate(.1,2.15,0),BRONZE),
  paint(new THREE.CapsuleGeometry(.16,.7,4,8).rotateZ(1.35).translate(-.45,1.25,.1),BRONZE),paint(new THREE.ConeGeometry(.2,.4,6).rotateZ(1.9).translate(-.95,1.05,.15),BRONZE),
  paint(new THREE.CapsuleGeometry(.06,.35,3,6).rotateZ(-.5).translate(.25,1.55,.18),BRONZE)]);
}
function rider(plinthH,hex=BRONZE){
 const y=plinthH,p=[paint(new THREE.BoxGeometry(2.2,plinthH,4).translate(0,plinthH/2,0),STONE),paint(new THREE.BoxGeometry(2.6,.4,4.4).translate(0,plinthH-.2,0),'#cfc8b8')];
 p.push(paint(new THREE.CapsuleGeometry(.55,1.5,4,8).rotateX(Math.PI/2).translate(0,y+1.8,0),hex),paint(new THREE.CapsuleGeometry(.28,.8,4,8).rotateX(-.7).translate(0,y+2.4,-1.2),hex),paint(new THREE.BoxGeometry(.38,.42,.75).translate(0,y+2.85,-1.65),hex));
 for(const [x,z,r] of [[-.3,-.7,.5],[.3,-.6,-.2],[-.3,.75,.15],[.3,.7,-.15]])p.push(paint(new THREE.CylinderGeometry(.09,.07,1.4,6).rotateX(r).translate(x,y+.75,z),hex));
 p.push(paint(new THREE.CapsuleGeometry(.12,.8,3,6).rotateX(.6).translate(0,y+1.6,1.3),hex),paint(new THREE.CapsuleGeometry(.3,.7,4,8).translate(0,y+2.85,.1),hex),paint(new THREE.SphereGeometry(.22,10,8).translate(0,y+3.55,.05),hex),paint(new THREE.CylinderGeometry(.06,.06,.9,5).rotateX(-1).translate(.35,y+3,-.3),hex));
 return mergeGeometries(p);
}
function gefion(){
 const p=[paint(new THREE.CylinderGeometry(9,9.5,.8,24).translate(0,.4,0),STONE),paint(new THREE.CylinderGeometry(8.4,8.4,.2,24).translate(0,.75,0),'#3f6f86'),paint(new THREE.BoxGeometry(5,2.4,3).translate(0,1.6,1.5),'#8a8578')];
 for(const [x,z] of [[-1.5,-1.5],[-.5,-2.5],[.5,-2.5],[1.5,-1.5]])p.push(paint(new THREE.CapsuleGeometry(.5,1.4,4,8).rotateX(Math.PI/2).rotateY(x*.2).translate(x,3.6,z-.5),BRONZE),paint(new THREE.SphereGeometry(.35,8,6).translate(x*1.1,4,z-1.6),BRONZE));
 p.push(paint(new THREE.CapsuleGeometry(.4,1.6,4,8).rotateX(-.3).translate(0,4.6,1.4),BRONZE),paint(new THREE.SphereGeometry(.3,10,8).translate(0,5.9,1.0),BRONZE),paint(new THREE.CylinderGeometry(.05,.05,2.6,5).rotateX(1.1).translate(.5,5.4,0),BRONZE));
 return mergeGeometries(p);
}
function flag(){
 const c=document.createElement('canvas');c.width=74;c.height=56;const g=c.getContext('2d');g.fillStyle='#c8102e';g.fillRect(0,0,74,56);g.fillStyle='#fff';g.fillRect(24,0,8,56);g.fillRect(0,24,74,8);
 const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;
 const geo=new THREE.PlaneGeometry(3.7,2.8,12,2);const m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({map:t,side:THREE.DoubleSide,roughness:.8}));m.position.set(1.85,0,0);
 const g2=new THREE.Group();g2.add(m);const base=geo.attributes.position.array.slice();
 g2.userData.wave=(time)=>{const p=geo.attributes.position;for(let i=0;i<p.count;i++){const x=base[i*3]+1.85;p.setZ(i,Math.sin(x*1.6-time*5)*.18*x/3.7);}p.needsUpdate=true;geo.computeVertexNormals();};
 return g2;
}
function windmill(){
 const p=[paint(new THREE.CylinderGeometry(.35,.5,6,8).translate(0,3,0),'#5b4630'),paint(new THREE.BoxGeometry(3.2,4.2,4.2).translate(0,7.6,0),'#7a5a3a'),paint(new THREE.ConeGeometry(2.9,2,4).rotateY(Math.PI/4).translate(0,10.7,0),'#5b3f2a'),paint(new THREE.BoxGeometry(.2,.2,6).rotateX(.25).translate(0,4.5,3),'#5b4630')];
 return mergeGeometries(p);
}
function sails(){
 const p=[];for(let k=0;k<4;k++){const a=k*Math.PI/2;p.push(paint(new THREE.BoxGeometry(.25,9.5,.15).translate(0,4.9,0).rotateZ(a),'#4a3a2a'),paint(new THREE.BoxGeometry(1.5,7,.05).translate(.85,5.6,.05).rotateZ(a),'#e8e0cc'));}
 return mergeGeometries(p);
}

// Tivoli (1843): Himmelskibet's 80 m swing tower, the Golden Tower, a small wheel and carousels, all turning.
function tivoli(add,mat,spinners){
 const T=[];
 // Himmelskibet
 add(mergeGeometries([paint(new THREE.CylinderGeometry(.9,1.3,80,10).translate(0,40,0),'#e9e4d6'),paint(new THREE.CylinderGeometry(3,3,1.2,16).translate(0,1,0),'#8a2f35')]),-510,813);
 const sky=new THREE.Mesh(mergeGeometries([paint(new THREE.CylinderGeometry(6,6.5,1.5,16).translate(0,0,0),'#c8202a'),...Array.from({length:12},(_,i)=>{const a=i/12*Math.PI*2;return paint(new THREE.BoxGeometry(.6,.9,.6).translate(Math.cos(a)*9,-6,Math.sin(a)*9),'#d4a637');}),...Array.from({length:12},(_,i)=>{const a=i/12*Math.PI*2;return paint(new THREE.CylinderGeometry(.03,.03,8,3).rotateX(Math.cos(a)*.35).rotateZ(-Math.sin(a)*.35).translate(Math.cos(a)*7.5,-3,Math.sin(a)*7.5),'#9aa0a6');})]),mat);
 sky.position.set(-510,groundAt(-510,813)+72,813);spinners.push({m:sky,rate:.9,bob:true});T.push(sky);
 // Det Gyldne Tårn
 add(mergeGeometries([paint(new THREE.CylinderGeometry(1.2,1.8,58,8).translate(0,29,0),'#3a3d42'),paint(new THREE.ConeGeometry(2.6,6,8).translate(0,61,0),GOLD),paint(new THREE.TorusGeometry(2.4,.4,6,16).rotateX(Math.PI/2).translate(0,20,0),GOLD)]),-332,745);
 // Ballongyngen (small wheel)
 const wheel=new THREE.Mesh(mergeGeometries([paint(new THREE.TorusGeometry(7,.18,6,28),'#e9e4d6'),...Array.from({length:10},(_,i)=>paint(new THREE.CylinderGeometry(.07,.07,14,4).rotateZ(i/10*Math.PI),'#e9e4d6')),...Array.from({length:10},(_,i)=>{const a=i/10*Math.PI*2;return paint(new THREE.SphereGeometry(.9,10,8).translate(Math.cos(a)*7,Math.sin(a)*7,0),['#c8202a','#2d4f7a','#d4a637','#3f5d45'][i%4]);})]),mat);
 wheel.position.set(-531,groundAt(-531,786)+9,786);spinners.push({m:wheel,rate:.25,axis:'z'});T.push(wheel);
 add(mergeGeometries([paint(new THREE.CylinderGeometry(.25,.4,9,6).translate(-1.5,4.5,0).rotateZ(.15),'#8a8f94'),paint(new THREE.CylinderGeometry(.25,.4,9,6).translate(1.5,4.5,0).rotateZ(-.15),'#8a8f94')]),-531,786);
 // carousels
 for(const [x,z,c] of [[-499,760,'#c8202a'],[-437,733,'#2d4f7a'],[-308,744,'#3f5d45']]){
  const top=new THREE.Mesh(mergeGeometries([paint(new THREE.ConeGeometry(7,3,16).translate(0,6.5,0),c),paint(new THREE.CylinderGeometry(7,7,.6,16).translate(0,4.8,0),'#e9e3d4'),paint(new THREE.CylinderGeometry(6.5,6.5,.4,16).translate(0,.4,0),'#7a5a3a'),...Array.from({length:10},(_,i)=>{const a=i/10*Math.PI*2;return paint(new THREE.CylinderGeometry(.05,.05,4.4,4).translate(Math.cos(a)*5,2.6,Math.sin(a)*5),GOLD);}),...Array.from({length:10},(_,i)=>{const a=i/10*Math.PI*2;return paint(new THREE.BoxGeometry(.5,1,1.4).translate(Math.cos(a)*5,1.6,Math.sin(a)*5),['#efe7d3','#5b3a24','#2a2420'][i%3]);})]),mat);
  top.position.set(x,groundAt(x,z),z);spinners.push({m:top,rate:.5});T.push(top);
 }
 return T;
}
// ---- 1760 only: the churches and building site the city model cannot know ----
const BRICK='#8e4a38',TILE='#6b3428',PITCH='#2f2c2a';
const prism=(len,w,h,x,y,z,hex)=>{const sh=new THREE.Shape();sh.moveTo(-w/2,0);sh.lineTo(0,h);sh.lineTo(w/2,0);sh.closePath();const g=new THREE.ExtrudeGeometry(sh,{depth:len,bevelEnabled:false});g.translate(0,0,-len/2);g.rotateY(Math.PI/2);return paint(g.translate(x,y,z),hex);};
const bx=(w,h,d,x,y,z,hex)=>paint(new THREE.BoxGeometry(w,h,d).translate(x,y,z),hex);
// Gothic hall church with a west tower and a tall copper spire (Vor Frue before 1807). Local x = nave axis, tower at -x.
function gothicChurch({len=64,width=27,eave=19,tower=13,towerH=50,spire=110}={}){
 const WALL='#b0664c',ROOF='#4f5a55'; // sunlit brick and a lead-grey roof: in one red the nave read as a windowless dark box
 const p=[bx(len,eave,width,0,eave/2,0,WALL),prism(len,width+1,15,0,eave,0,ROOF),bx(16,eave-3,width*.62,len/2+8,(eave-3)/2,0,WALL),prism(16,width*.62+1,11,len/2+8,eave-3,0,ROOF)];
 // buttresses between the window bays
 for(let k=-2.5;k<=2.5;k+=1)for(const sz of [-1,1])p.push(bx(1.4,eave-2,1.6,k*11,(eave-2)/2,sz*(width/2+.7),WALL));
 const tx=-len/2-tower/2+1;p.push(bx(tower,towerH,tower,tx,towerH/2,0,WALL),bx(tower+.8,1.2,tower+.8,tx,towerH-.6,0,STONE));
 p.push(paint(new THREE.ConeGeometry(tower*.48,spire-towerH,8).translate(tx,towerH+(spire-towerH)/2,0),COPPER));
 for(const [dx,dz] of [[-1,-1],[1,-1],[-1,1],[1,1]])p.push(paint(new THREE.ConeGeometry(.9,7,6).translate(tx+dx*(tower/2-.6),towerH+3.5,dz*(tower/2-.6)),COPPER));
 p.push(at(paint(new THREE.SphereGeometry(.7,10,8),GOLD),tx,spire+.4,0),bx(.12,3,.12,tx,spire+2.2,0,GOLD));
 // tall pointed windows along the nave (dark recesses)
 for(let k=-2;k<=2;k++)for(const sz of [-1,1]){p.push(bx(3,10,.3,k*11,9.5,sz*(width/2+.1),'#2a2a2c'));p.push(paint(new THREE.ConeGeometry(1.5,2.4,4).rotateY(Math.PI/4).translate(k*11,15.7,sz*(width/2+.1)),'#2a2a2c'));} // pointed heads
 return mergeGeometries(p);
}
// A free-standing church tower with spire (Nikolaj before the fire of 1795).
function spireTower({w=11,h=42,spire=92}={}){
 return mergeGeometries([bx(w,h,w,0,h/2,0,BRICK),bx(w+.8,1,w+.8,0,h-.5,0,STONE),bx(w*.62,8,w*.62,0,h+4,0,COPPER),paint(new THREE.ConeGeometry(w*.36,spire-h-8,8).translate(0,h+8+(spire-h-8)/2,0),COPPER),at(paint(new THREE.SphereGeometry(.55,10,8),GOLD),0,spire+.3,0)]);
}
// Frederik's Church as a building site (begun 1749, stopped 1770): scaffold ring, treadwheel crane, stone stacks.
function buildingSite(r=17,h=13){
 const p=[];const wood='#7a5a3a';
 for(let k=0;k<28;k++){const a=k/28*Math.PI*2;for(const rr of [r,r+1.6])p.push(bx(.18,h,.18,Math.cos(a)*rr,h/2,Math.sin(a)*rr,wood));}
 for(const y of [3.5,7,10.5,h-.2])for(let k=0;k<28;k++){const a=(k+.5)/28*Math.PI*2,c=2*Math.PI*(r+.8)/28;const g=new THREE.BoxGeometry(c+.2,.12,1.8);g.rotateY(-a+Math.PI/2);p.push(paint(g.translate(Math.cos(a)*(r+.8),y,Math.sin(a)*(r+.8)),wood));}
 // the rotunda's marble walls, about half built (work stopped in 1770): outer face, inner face (mirrored so it faces in), top course
 {const wh=6.5,o=new THREE.CylinderGeometry(r-.3,r-.3,wh,56,1,true).translate(0,wh/2,0),i=new THREE.CylinderGeometry(r-1.7,r-1.7,wh,56,1,true).translate(0,wh/2,0).scale(-1,1,1);i.computeVertexNormals();
  const top=new THREE.RingGeometry(r-1.7,r-.3,56,1);top.rotateX(-Math.PI/2);top.translate(0,wh,0);p.push(paint(o,'#d8d2c3'),paint(i,'#cfc8b8'),paint(top,'#c9c2b2'));}
 // treadwheel crane outside the ring
 const cx=r+9;p.push(paint(new THREE.TorusGeometry(3,.18,6,20).translate(cx,3.4,0),wood),paint(new THREE.TorusGeometry(3,.18,6,20).translate(cx,3.4,1.4),wood));
 for(let k=0;k<8;k++){const a=k/8*Math.PI*2;p.push(paint(new THREE.BoxGeometry(.12,.12,1.4).translate(cx+Math.cos(a)*3,3.4+Math.sin(a)*3,.7),wood));}
 p.push(bx(.4,9,.4,cx,4.5,.7,wood));const jib=new THREE.BoxGeometry(.35,.35,12);jib.rotateX(-.55);p.push(paint(jib.translate(cx-3,10,.7),wood));
 for(let k=0;k<5;k++)p.push(bx(2.2,.9,1.2,-r-7+(k%3)*2.4,.45+Math.floor(k/3)*.9,8+(k%2)*.4,STONE));
 for(let k=0;k<4;k++)p.push(bx(2.2,.9,1.2,r+3+(k%2)*2.4,.45+Math.floor(k/2)*.9,-10,STONE));
 return mergeGeometries(p);
}
// Buildings that did not exist in 1760: today's Vor Frue (1829, the Gothic church is drawn instead), Jerusalemskirken
// (1896), the English Church (1887), Sankt Pauls (1877), Kong Haakons Kirke (1958), Alexander Nevsky (1883),
// Sankt Ansgar (1842) and Ny Christiansborg (modern).
export const HIDE_1760=['kk-osm-relation-19856927','kk-osm-way-25451190','kk-osm-way-134471983','kk-osm-way-36790389','kk-osm-way-26604470','kk-osm-way-89752515','kk-osm-way-55601707','kk-osm-way-133986381','kk-osm-relation-8833442'];
export function createLandmarks({era=null,mills=[],anchors={},statues={}}={}){ // statues: scanned models where loaded (frederikV), else the hand-built riders
 const group=new THREE.Group();group.name='Hand-built landmarks';
 const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.45,metalness:.35}),built=facadeGrain(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.6,metalness:.2})); // built: brick, plaster and roof courses like the city's own buildings (statues and rides keep the plain finish)
 const add=(geo,x,z,{y=null,rot=0,material=mat}={})=>{const m=new THREE.Mesh(geo,material);m.position.set(x,y??groundAt(x,z),z);m.rotation.y=rot;m.castShadow=true;m.receiveShadow=true;group.add(m);return m;};
 const today=era!==1760,flags=[],rotors=[];
 const scaled=(geo,a,design)=>{const m=add(geo,a[0],a[2],{material:built});m.scale.y=a[1]/design;return m;};
 if(anchors.vorFrelsers?.[3]>60)scaled(vorFrelsers(),anchors.vorFrelsers,86);
 if(anchors.borsen?.[3]>35)scaled(borsen(),anchors.borsen,53);
 const flagTops=[];if(anchors.christiansborg?.[3]>80)flagTops.push([anchors.christiansborg[0],anchors.christiansborg[2],anchors.christiansborg[1]]);
 const spinners=[];
 if(today){
  for(const m of tivoli(add,mat,spinners)){m.castShadow=true;group.add(m);}
  {const x=1465.3,z=-1438.7,w=waterAt(x,z)??seaLevel();add(mermaid(),x,z,{y:(w??groundAt(x,z))-.35,rot:2.2});} // her rock sits in the water (a fixed height left it floating over the harbour)
  if(statues.frederikV)add(statues.frederikV,1076.2,-438.8,{rot:-2.049});else add(rider(4.5),1076.2,-438.8,{rot:.12}); // the scan faces +Z: turned to face the palace square's centre
  add(rider(3.6,'#4d6a59'),191.9,194.8,{rot:-1.2});add(gefion(),1371.2,-729.5,{rot:-.6});
  if(statues.hca)add(statues.hca,-427.1,520.1,{rot:-.725}); // Luckow-Nielsen's seated Andersen at City Hall's west corner, looking out over H.C. Andersens Boulevard
 }
 add(rider(3.2,era===1760?'#b8a46a':'#55715f'),624.6,-57.9,{rot:.6}); // in the middle of Krinsen (the mapped lawn's centroid) // Christian V (1688; gilded lead until 1940s)
 for(const [x,z,h] of flagTops){const pole=add(mergeGeometries([paint(new THREE.CylinderGeometry(.08,.1,8,6).translate(0,4,0),'#e9e6dc')]),x,z,{y:groundAt(x,z)+h});const f=flag();f.position.set(x,groundAt(x,z)+h+7.2,z);group.add(f);flags.push(f);}
 if(era===1760){
  add(gothicChurch(),-205,66.3,{rot:.318,material:built}); // Vor Frue (old church, spire to ~110 m; lost in 1807)
  add(spireTower(),336,158,{material:built}); // Sankt Nikolaj tower and spire (lost in 1795)
  if(anchors.marmorkirken)add(buildingSite(),anchors.marmorkirken[0],anchors.marmorkirken[2]); // Frederik's Church, building site
 }
 if(era===1760)for(const [x,z] of mills){add(windmill(),x,z,{y:groundAt(x,z)+7,material:built});const r=new THREE.Mesh(sails(),mat);r.position.set(x,groundAt(x,z)+14.6,z+2.3);group.add(r);rotors.push(r);}
 // Static landmarks merge into one mesh per material (1760's windmills, churches, statues and flagpoles were ~20
 // draws) and the windmill sails turn as one instanced batch. Tivoli's rides and the flags keep their own meshes.
 const moving=new Set([...rotors,...flags,...spinners.map(sp=>sp.m)]),byMaterial=new Map();group.updateMatrixWorld(true);
 for(const m of group.children)if(m.isMesh&&!moving.has(m)){let l=byMaterial.get(m.material);if(!l)byMaterial.set(m.material,l=[]);l.push(m);}
 for(const [material,list] of byMaterial){if(list.length<2)continue;
  const gs=list.map(m=>{const g=m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone();for(const k of Object.keys(g.attributes))if(!['position','normal','color'].includes(k))g.deleteAttribute(k);return g.applyMatrix4(m.matrix);});
  if(new Set(gs.map(g=>Object.keys(g.attributes).sort().join())).size>1){gs.forEach(g=>g.dispose());continue;}
  const merged=new THREE.Mesh(mergeGeometries(gs),material);gs.forEach(g=>g.dispose());merged.name='Landmarks merged';merged.castShadow=merged.receiveShadow=true;
  for(const m of list){group.remove(m);m.geometry.dispose();}group.add(merged);}
 let sailBatch=null,turn=0;const spin=new THREE.Matrix4();
 if(rotors.length){sailBatch=new THREE.InstancedMesh(rotors[0].geometry,mat,rotors.length);sailBatch.name='Windmill sails';sailBatch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);sailBatch.frustumCulled=false;
  for(const r of rotors){group.remove(r);if(r.geometry!==sailBatch.geometry)r.geometry.dispose();}group.add(sailBatch);}
 let t=0,acc=0;
 return {group,update(dt){t+=dt;acc+=dt;if(sailBatch){turn-=dt*.6;rotors.forEach((r,i)=>sailBatch.setMatrixAt(i,spin.makeRotationZ(turn).setPosition(r.position)));sailBatch.instanceMatrix.needsUpdate=true;}for(const sp of spinners){if(sp.axis==='z')sp.m.rotation.z+=dt*sp.rate;else sp.m.rotation.y+=dt*sp.rate;}if(acc>.05){acc=0;for(const f of flags)f.userData.wave?.(t);}}};
}
