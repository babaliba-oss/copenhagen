import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createTrafficRenderer} from './traffic-renderer.js';
import {routePoint,signalGreen} from './mobility.js';
import {signalAnchor,authoredOlympiaMarkings} from './road-safety.js';
import {crossingPolygons,kerbSegments} from './crossing-markings.js';
import {createGraniteKerbs} from './street-furniture.js';
import earcut,{flatten} from 'earcut';
import {createPersonBatch,advanceGait,personLook,smoothHeading} from './person-model.js';
import {createBreakableSigns} from './breakable-signs.js';
import {groundAt} from './terrain.js';
import {drapeGeometry,settleObject} from './terrain-mesh.js';

export function createStreetLife(scene,mobility,{paintedMarkings=true,mappedSignalNear=null}={}){ // paintedMarkings:false for 1760 (no zebra stripes or centre lines)
 const group=new THREE.Group();scene.add(group);
 const traffic=createTrafficRenderer(mobility.cars);group.add(traffic.group);
 // Walking pedestrians share the articulated person model used by every crowd.
 // Appearance and gait state live beside (not on) the mobility actors.
 const count=mobility.people.length,looks=mobility.people.map((a,i)=>personLook(5003+(a.id??i)*11)),gaits=mobility.people.map(()=>({}));
 const people=createPersonBatch(count,{name:'Mobility pedestrians'});group.add(people.group);
 // Render proxies: the drawn heading turns smoothly; the walkers themselves are untouched.
 const views=mobility.people.map(()=>({x:0,z:0,heading:0,speed:0}));
 const kerbGroups=[],signalObjects=[],used=new Set(),seenRoads=new WeakSet(),seenWalks=new WeakSet(),seenPavements=new WeakSet();
 const counts={roads:0,walks:0,pavement:0};
 let initial=true;
 const poleGeometry=new THREE.CylinderGeometry(.065,.085,3.4,6),poleMaterial=new THREE.MeshStandardMaterial({color:'#566166',metalness:.6,roughness:.5}),housingGeometry=new THREE.BoxGeometry(.27,.8,.23),housingMaterial=new THREE.MeshStandardMaterial({color:'#18232a'});
 // Signal heads in three batches for the whole street set, not five draws per post: poles and housings are merged
 // into the breakable-post meshes (they fold with the post), the lamps are one instanced batch coloured per phase.
 const lampGeometry=new THREE.SphereGeometry(.083,8,6),lampMaterial=new THREE.MeshBasicMaterial({color:'#ffffff'}),lampLocal=[0,1,2].map(i=>new THREE.Matrix4().makeTranslation(0,3.35-i*.25,.18));
 const LAMP={redOn:new THREE.Color('#ff392b'),redOff:new THREE.Color('#382927'),amberOff:new THREE.Color('#263633'),greenOn:new THREE.Color('#47ec9b'),greenOff:new THREE.Color('#233a32')};
 const lamps=new THREE.InstancedMesh(lampGeometry,lampMaterial,3);lamps.name='Traffic signal lamps';lamps.frustumCulled=false;lamps.count=0;lamps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
 lamps.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(9),3).setUsage(THREE.DynamicDrawUsage);group.add(lamps);
 const growLamps=n=>{if(lamps.instanceMatrix.count>=n)return;const cap=Math.max(n,lamps.instanceMatrix.count*2); // capacity grows in place: the batch object stays the same
  lamps.instanceMatrix=new THREE.InstancedBufferAttribute(new Float32Array(cap*16),16).setUsage(THREE.DynamicDrawUsage);lamps.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(cap*3),3).setUsage(THREE.DynamicDrawUsage);};
 const m4=new THREE.Matrix4(),place=new THREE.Matrix4();
 // Append only static detail; traffic and person renderers retain their actors.
 // References make a retry safe without duplicating markings, kerbs or posts.
 function append({roads=mobility.roads.edges,walks=mobility.walks.edges,pavement=[...new Set([...mobility.world.pavement?.cells.values()||[]].flat())]}={}){
  const fresh=(items,seen,key)=>items.filter(item=>{if(seen.has(item))return false;seen.add(item);counts[key]++;return true;});
  roads=fresh(roads,seenRoads,'roads');walks=fresh(walks,seenWalks,'walks');const pavements=fresh(pavement,seenPavements,'pavement');
  if(!roads.length&&!walks.length&&!pavements.length)return;
 const markings=[];
 const crossingData=crossingPolygons(walks,mobility.world,{excluded:authoredOlympiaMarkings,...(initial?{}:{reviewed:[]})});
 for(const polygon of crossingData.polygons){
  const flat=flatten(polygon),indices=earcut(flat.vertices,flat.holes,2),positions=[];
  // Earcut is counterclockwise in XY. Mapping its second axis to world Z
  // reverses the face normal: reverse winding so the road's top is front-facing.
  // Merely overriding normals leaves DoubleSide shading flipped underneath.
  for(let j=0;j<indices.length;j+=3)for(const i of [indices[j],indices[j+2],indices[j+1]])positions.push(flat.vertices[i*2],.115,flat.vertices[i*2+1]);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();
  // Match plane attribute layout for the shared markings batch.
  g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(indices.length*2),2));
  markings.push(g);
 }
 // Road centrelines only where the municipal graph indicates a two-way carriageway.
 for(const edge of roads){if(edge.separateCarriageway||edge.lane<1||edge.from>edge.to||edge.length<18)continue;
  // dashes run the whole edge (short blocks too), stopping 7 m short of each junction box
  for(let s=7+((edge.length-14)%6)/2;s<=edge.length-7;s+=6){const p=routePoint(edge,s,0);if(!mobility.world.roads.at(p.x,p.z)||mobility.world.buildings.at(p.x,p.z))continue;const g=new THREE.PlaneGeometry(.10,2.7);g.rotateX(-Math.PI/2);g.rotateY(p.heading);g.translate(p.x,.092,p.z);markings.push(g);}
 }
 if(!paintedMarkings){markings.forEach(g=>g.dispose());markings.length=0;}
 if(markings.length){const geometries=markings.map(g=>g.index?g.toNonIndexed():g);const m=new THREE.Mesh(drapeGeometry(mergeGeometries(geometries)),new THREE.MeshStandardMaterial({color:'#e7e3d4',roughness:1,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1}));m.receiveShadow=true;group.add(m);new Set([...geometries,...markings]).forEach(g=>g.dispose());}
 const kerbs=[];
 // Raised granite kerbstones (not in 1760: they are 19th-century) follow surveyed pavement boundaries adjacent to a carriageway,
 // dropped across crossings; geometry and shader live in street-furniture.js (createGraniteKerbs).
 if(paintedMarkings)for(const pavement of pavements)for(const ring of pavement.rings)for(let i=1;i<ring.length;i++){
  const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.4||length>30)continue;
  // Road on exactly one side, tested every ~1.5 m (a midpoint test let pavement edges that cut across a
  // carriageway lay a kerb right over the road); each qualifying run becomes kerbstones.
  const nx=-dz/length*.38,nz=dx/length*.38,n=Math.max(1,Math.round(length/1.5)),roads=mobility.world.roads;let run=-1;
  for(let k=0;k<=n;k++){
   let ok=false;if(k<n){const x=a[0]+dx*(k+.5)/n,z=a[1]+dz*(k+.5)/n;ok=!roads.at(x+nx,z+nz)!==!roads.at(x-nx,z-nz);}
   if(ok&&run<0)run=k;
   else if(!ok&&run>=0){const p=t=>[a[0]+dx*t/n,a[1]+dz*t/n];if(k-run>=1)kerbs.push(...kerbSegments(p(run),p(k),crossingData.chains));run=-1;}
  }
 }
 const kerbGroup=kerbs.length&&paintedMarkings?settleObject(createGraniteKerbs(kerbs)):null;if(kerbGroup){group.add(kerbGroup);kerbGroups.push(kerbGroup);}
 const signalPosts=createBreakableSigns('Traffic signal posts');
 // One post per approach that stops at the signal (lane-model.js), showing that approach's own phase.
 for(const e of mobility.roads.edges){if(e.signal<0||e.length<4)continue;const key=`${e.signal}:${Math.round(routePoint(e,e.length-3).heading/1.6)}`;if(used.has(key))continue;
  const p=signalAnchor(e,mobility.world);if(!p)continue;used.add(key);
  if(mappedSignalNear?.(p.x,p.z))continue; // a surveyed signal head (photo-mapped) already stands here: no second post
  const root=new THREE.Group(),y=groundAt(p.x,p.z);root.position.set(p.x,y,p.z);root.rotation.y=p.heading;root.updateMatrix();
  // Signal posts are sturdier than plain signs (strength 1.8): they fold over and only snap off in a fast hit.
  const post=signalPosts.post({id:`signal-${e.signal}-${signalObjects.length}`,x:p.x,z:p.z,y,yaw:p.heading,height:3.45,radius:.085,strength:1.8});
  signalPosts.add(poleGeometry.clone().applyMatrix4(m4.multiplyMatrices(root.matrix,place.makeTranslation(0,1.7,0))),poleMaterial,post);
  signalPosts.add(housingGeometry.clone().applyMatrix4(m4.multiplyMatrices(root.matrix,place.makeTranslation(0,3.1,.05))),housingMaterial,post);
  group.add(root);signalPosts.attach(root,post);signalObjects.push({root,edge:e}); // the (empty) root carries the post's fold for the lamps
 }
 group.add(signalPosts.finish());growLamps(signalObjects.length*3);
 initial=false;
 }
 append();
 let skinned=null; // the nearest walkers as rigged characters (skinned-people.js), once their models load
 return {group,traffic,append,staticCounts:()=>({...counts,signals:signalObjects.length}),setSkinned(crowd){if(skinned){group.remove(skinned.group);skinned.dispose();}skinned=crowd;if(crowd)group.add(crowd.group);},update(dt,player){
  traffic.update(dt,player);for(const kerbs of kerbGroups)kerbs.userData.update(player);
  const near=skinned?skinned.update(dt,player,mobility.people,looks):null;
  people.begin(player); // distance levels: full body near the player, simplified beyond, none past the batch's hide range
  for(let i=0;i<count;i++){const a=mobility.people[i],v=views[i];advanceGait(a,gaits[i],dt,looks[i]);if(near?.has(a))continue; // drawn rigged
   if(!a.edge||Math.hypot(a.x-player.x,a.z-player.z)>=300){gaits[i].yaw=undefined;continue;}
   v.x=a.x;v.z=a.z;v.speed=a.speed;v.running=a.running;v.knockdown=a.knockdown;v.groundY=a.groundY;v.pose=a.pose;v.suitcase=a.suitcase;
   v.expression=a.expression;v.speaking=a.speaking;v.mouthOpen=a.mouthOpen;
   v.heading=a.knockdown?(gaits[i].yaw=a.heading):smoothHeading(gaits[i],a.heading,dt);people.draw(v,looks[i],gaits[i]);}
  people.end();
  let lit=0;
  for(const s of signalObjects){if(s.edge.signal<0||Math.hypot(s.root.position.x-player.x,s.root.position.z-player.z)>=350)continue;const green=signalGreen(s.edge,mobility.time);
   for(let q=0;q<3;q++){lamps.setMatrixAt(lit,m4.multiplyMatrices(s.root.matrix,lampLocal[q]));lamps.setColorAt(lit++,q===0?(green?LAMP.redOff:LAMP.redOn):q===2?(green?LAMP.greenOn:LAMP.greenOff):LAMP.amberOff);}}
  lamps.count=lit;lamps.instanceMatrix.clearUpdateRanges();lamps.instanceColor.clearUpdateRanges();if(lit){lamps.instanceMatrix.addUpdateRange(0,lit*16);lamps.instanceColor.addUpdateRange(0,lit*3);}
  lamps.instanceMatrix.needsUpdate=true;lamps.instanceColor.needsUpdate=true;
 }};
}
