import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {groundAt} from '../terrain.js';

// Parked cars along the kerbs (scripts/parked-cars.py → parked.json). Instanced meshes for the painted body
// (per-car colour) and the fixed parts (glass, tyres, lights): the detailed Blender bodies near the player, a
// simple low-poly car (~250 triangles instead of ~3,800) further out, nothing beyond view range. The batches are
// city-wide pools refilled with the cars in range (CHUNK is the lookup grid). Each car is a solid obstacle.
const CHUNK=150,NEAR=170,RANGE=420;
const paint=(g,hex)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();n.deleteAttribute('uv');const c=new THREE.Color(hex),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));return n;};
// A box whose top face is pulled in (cabin taper). Forward is -Z.
function taper(w,h,d,x,y,z,inX,inFront,inBack){
 const g=new THREE.BoxGeometry(w,h,d).translate(x,y,z),p=g.attributes.position;
 for(let i=0;i<p.count;i++)if(p.getY(i)>y){p.setX(i,p.getX(i)*(1-inX));p.setZ(i,p.getZ(i)<z?p.getZ(i)+inFront:p.getZ(i)-inBack);}
 g.computeVertexNormals();return g;
}
function bodyGeometry(){
 return mergeGeometries([paint(taper(1.76,.62,4.25,0,.62,0,.02,.12,.08),'#ffffff'),paint(taper(1.6,.1,2.2,0,1.52,.25,.04,.05,.05),'#ffffff'),
  paint(new THREE.BoxGeometry(1.8,.08,.9).translate(0,.95,-1.62),'#ffffff')]);
}
function fixedGeometry(){
 const parts=[paint(taper(1.62,.6,2.5,0,1.22,.22,.1,.42,.28),'#1a2229')];
 for(const [x,z] of [[-.78,-1.32],[.78,-1.32],[-.78,1.32],[.78,1.32]])parts.push(paint(new THREE.CylinderGeometry(.33,.33,.22,10).rotateZ(Math.PI/2).translate(x,.33,z),'#151617'));
 for(const x of [-.6,.6]){parts.push(paint(new THREE.BoxGeometry(.32,.12,.04).translate(x,.78,-2.13),'#f3f1e6'));parts.push(paint(new THREE.BoxGeometry(.34,.12,.04).translate(x,.82,2.13),'#9e1f1a'));}
 parts.push(paint(new THREE.BoxGeometry(.52,.11,.02).translate(0,.55,2.14),'#f2f2f2'),paint(new THREE.BoxGeometry(1.8,.18,4.3).translate(0,.3,0),'#2a2c2e'));
 return mergeGeometries(parts);
}

// Blender bodies (scripts/blender/vehicles.py) when installed: the painted panels per instance colour, the rest
// (glass, trim, lamps, plates) baked to vertex colours, wheels added. Four types, cycled along the kerb.
const PART_COLOURS={glass:'#121c22',black:'#1b1f22',rubber:'#202326',chrome:'#c9ced0',head:'#e9eee6',tail:'#9e1f1a',plate:'#eff2e8'};
function blenderCar(parts,spec){
 const body=parts.get('paint');if(!body)return null;
 const fixed=[];for(const [name,g] of parts)if(name!=='paint')fixed.push(paint(g.clone(),PART_COLOURS[name]||'#222'));
 for(const sx of [-1,1])for(const sz of [-1,1]){const r=spec.r;fixed.push(paint(new THREE.CylinderGeometry(r,r,.21,14).rotateZ(Math.PI/2).translate(sx*(spec.w/2-.06),r,sz*spec.wb/2),'#151617'));fixed.push(paint(new THREE.CylinderGeometry(r*.62,r*.62,.215,12).rotateZ(Math.PI/2).translate(sx*(spec.w/2-.06),r,sz*spec.wb/2),'#9aa1a4'));}
 return {body:paint(body.clone(),'#ffffff'),fixed:mergeGeometries(fixed)};
}
export function createParkedCars(data,{bodies=[]}={}){
 const group=new THREE.Group();group.name='Parked cars';
 const cars=data?.cars||[],paints=(data?.paints||['#ccc']).map(h=>{const c=new THREE.Color(h),l=c.r*.3+c.g*.55+c.b*.15;return l<.035?c.lerp(new THREE.Color('#4a4e55'),.55):c;}); // black and navy read as holes in shadow
 if(!cars.length)return {group,obstacles:[],update(){}};
 const models=bodies.map(({parts,spec})=>blenderCar(parts,spec)).filter(Boolean),simple={body:bodyGeometry(),fixed:fixedGeometry()};
 const bodyMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.35,metalness:.15}),fixedMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.4,metalness:.2});
 // Every car's pose, paint and body style, once; the drawn batches are pools refilled with the cars in range as the
 // player moves: two batches per body style near, two for the low-poly cars further out (it was that many per
 // 150 m chunk, 20-40 draw calls along a street of parked cars).
 const n=cars.length,poses=new Float32Array(n*16),style=new Uint8Array(n),cells=new Map(),obstacles=[];
 const m=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),one=new THREE.Vector3(1,1,1),UP=new THREE.Vector3(0,1,0);
 cars.forEach((c,i)=>{const [x,z,yaw]=c;m.compose(v.set(x,groundAt(x,z),z),q.setFromAxisAngle(UP,yaw),one).toArray(poses,i*16);
  style[i]=models.length?Math.abs(Math.round(x*7+z*13))%models.length:0;
  const k=Math.floor(x/CHUNK)*100000+Math.floor(z/CHUNK);let l=cells.get(k);if(!l)cells.set(k,l=[]);l.push(i);
  const co=Math.cos(yaw),si=Math.sin(yaw),ring=[[-.9,-2.15],[.9,-2.15],[.9,2.15],[-.9,2.15]].map(([a,d])=>[x+a*co+d*si,z-a*si+d*co]);
  obstacles.push({id:`parked-car-${i}`,name:'parked car',rings:[ring],bbox:[Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))]});});
 const pool=(geometry,material,name,coloured)=>{const mesh=new THREE.InstancedMesh(geometry,material,n);mesh.name=name;mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if(coloured)mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(n*3),3).setUsage(THREE.DynamicDrawUsage);group.add(mesh);return mesh;};
 const near=(models.length?models:[simple]).map(model=>[pool(model.body,bodyMat,'Parked cars (detailed)',true),pool(model.fixed,fixedMat,'Parked cars (detailed)',false)]);
 const far=[pool(simple.body,bodyMat,'Parked cars (far)',true),pool(simple.fixed,fixedMat,'Parked cars (far)',false)];
 const batches=[...near.flat(),...far];let at=null;const hidden=new Set(); // ?cinematic hides the few parked where the trailer car's lane runs (hideAlong)
 function put(mesh,i,colour){const k=mesh.count++;mesh.instanceMatrix.array.set(poses.subarray(i*16,i*16+16),k*16);if(colour)colour.toArray(mesh.instanceColor.array,k*3);}
 // points: [[x,z],...] along a route; every car within r of one is hidden (and no longer an obstacle). Without points, all come back.
 const hideAlong=(points=[],r=1.7)=>{for(const c of hidden)obstacles[c].disabled=false;hidden.clear();
  for(const [x,z] of points){const i=Math.floor(x/CHUNK),j=Math.floor(z/CHUNK);for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++)for(const c of cells.get((i+di)*100000+j+dj)||[])if(!hidden.has(c)&&Math.hypot(poses[c*16+12]-x,poses[c*16+14]-z)<r+1.2){hidden.add(c);obstacles[c].disabled=true;}}
  at=null;return hidden.size;};
 return {group,obstacles,hideAlong,update(p){if(!p)return;if(at&&Math.hypot(at[0]-p.x,at[1]-p.z)<12)return;at=[p.x,p.z];
  for(const b of batches)b.count=0;
  const i0=Math.floor((p.x-RANGE)/CHUNK),i1=Math.floor((p.x+RANGE)/CHUNK),j0=Math.floor((p.z-RANGE)/CHUNK),j1=Math.floor((p.z+RANGE)/CHUNK);
  for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++)for(const c of cells.get(i*100000+j)||[]){const dx=poses[c*16+12]-p.x,dz=poses[c*16+14]-p.z,d=Math.hypot(dx,dz);if(d>=RANGE)continue;
   if(hidden.has(c))continue;const paint=paints[cars[c][3]%paints.length],[body,fixed]=d<NEAR?near[style[c]]:far;put(body,c,paint);put(fixed,c,null);}
  for(const b of batches){b.instanceMatrix.clearUpdateRanges();b.instanceMatrix.addUpdateRange(0,b.count*16);b.instanceMatrix.needsUpdate=true;if(b.instanceColor){b.instanceColor.clearUpdateRanges();b.instanceColor.addUpdateRange(0,b.count*3);b.instanceColor.needsUpdate=true;}}
 }};
}
