import * as THREE from 'three';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {registerEnvMaterial} from './environment.js';

// Original geometry, not manufacturer CAD. Crossover dimensions are based on
// Toyota Finland MY26 Yaris Cross: 4.172 x 1.765 x 1.595 m, wheelbase 2.560 m.
export const VEHICLE_TYPES=['crossover','hatchback','sedan','estate','suv','van','taxi'];
const specs={
 crossover:{l:4.172,w:1.765,h:1.595,wb:2.56,rf:-.46,rr:1.18,rg:1.76,belt:1.02,r:.335,clad:true,blackRoof:true},
 hatchback:{l:3.82,w:1.70,h:1.46,wb:2.43,rf:-.43,rr:.90,rg:1.55,belt:.90,r:.30},
 sedan:{l:4.60,w:1.81,h:1.44,wb:2.70,rf:-.48,rr:.68,rg:1.43,belt:.92,r:.32},
 estate:{l:4.60,w:1.81,h:1.49,wb:2.70,rf:-.46,rr:1.60,rg:2.05,belt:.96,r:.32,rails:true},
 suv:{l:4.43,w:1.85,h:1.76,wb:2.65,rf:-.55,rr:1.30,rg:1.94,belt:1.09,r:.36,clad:true,rails:true},
 van:{l:4.47,w:1.84,h:1.91,wb:2.78,rf:-.80,rr:1.91,rg:2.04,belt:1.07,r:.33,van:true},
 taxi:{l:4.60,w:1.81,h:1.49,wb:2.70,rf:-.46,rr:1.60,rg:2.05,belt:.96,r:.32,rails:true,taxi:true},
};
const palette=['#b8bcb8','#e5e7e1','#284c65','#be3529','#344a3e','#393b41','#a29b8b','#577383','#794537'];
const templates=new Map();
// Blender-modelled bodies (scripts/blender/vehicles.py), per type a Map of material name -> geometry in the
// model's frame. Installed before traffic is built; a type without one keeps the procedural body below.
const bodies=new Map();
export const VEHICLE_SPECS=specs;
export function vehicleBodyParts(type){return bodies.get(type)||null;} // Blender body (material name -> geometry), if installed
export function installVehicleBodies(map){for(const [type,parts] of Object.entries(map||{}))if(specs[type]&&parts?.get?.('paint')){bodies.set(type,parts);templates.delete(type);}return bodies.size;}
// Showroom finishes: clearcoated paint, dark reflective glazing, polished
// trim and satin rubber. Every reflective material shares the one sky PMREM
// (see environment.js), so instanced traffic batches reflect the same sky as
// the player car at no per-frame cost.
export function createVehicleMaterials(){
 const paint=new THREE.MeshPhysicalMaterial({color:'#ffffff',metalness:.28,roughness:.34,clearcoat:1,clearcoatRoughness:.1});
 const glass=new THREE.MeshPhysicalMaterial({color:'#101d24',metalness:.62,roughness:.06});
 const rubber=new THREE.MeshStandardMaterial({color:'#1b1e22',metalness:0,roughness:.74});
 const black=new THREE.MeshStandardMaterial({color:'#15191c',metalness:.35,roughness:.42});
 const chrome=new THREE.MeshStandardMaterial({color:'#dfe4e6',metalness:1,roughness:.16});
 const head=new THREE.MeshStandardMaterial({color:'#edf3ec',metalness:.2,roughness:.3,emissive:'#dceafa',emissiveIntensity:.35});
 const tail=new THREE.MeshStandardMaterial({color:'#ae1522',metalness:.2,roughness:.3,emissive:'#ff2817',emissiveIntensity:.35});
 const plate=new THREE.MeshStandardMaterial({color:'#eff2e8',metalness:0,roughness:.6});
 const mats={paint,glass,rubber,black,chrome,head,tail,plate};
 for(const [name,m] of Object.entries(mats))m.name=name;
 registerEnvMaterial(paint,1);registerEnvMaterial(glass,1.5);registerEnvMaterial(chrome,1.1);registerEnvMaterial(black,.7);registerEnvMaterial(rubber,.35);registerEnvMaterial(head,.6);registerEnvMaterial(tail,.6);
 return mats;
}
function loft(sections){
 const vertices=[],indices=[],n=8;
 for(const [z,w,lo,hi]of sections){const b=Math.min(.10,(hi-lo)*.2);for(const [x,y]of[[-w+b,lo],[w-b,lo],[w,lo+b],[w,hi-b],[w-b,hi],[-w+b,hi],[-w,hi-b],[-w,lo+b]])vertices.push(x,y,z);}
 for(let i=0;i<sections.length-1;i++)for(let j=0;j<n;j++){const a=i*n+j,b=i*n+(j+1)%n;indices.push(a,b,a+n,b,b+n,a+n);}
 for(let j=1;j<n-1;j++){indices.push(0,j+1,j);const k=(sections.length-1)*n;indices.push(k,k+j,k+j+1);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return g.toNonIndexed();
}
function build(type,detailed){
 const s=specs[type],L=s.l/2,W=s.w/2,B=s.belt,H=s.h,group=new THREE.Group(),batches=new Map();
 const mats=createVehicleMaterials();
 function add(g,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0){g.rotateX(rx);g.rotateY(ry);g.rotateZ(rz);g.translate(x,y,z);if(g.index)g=g.toNonIndexed();g.deleteAttribute('uv');if(!batches.has(mat))batches.set(mat,[]);batches.get(mat).push(g);}
 function box(w,h,d,mat,x,y,z,rx=0,ry=0,rz=0){add(new RoundedBoxGeometry(w,h,d,detailed?2:1,Math.min(.06,w/4,h/4,d/4)),mat,x,y,z,rx,ry,rz);}
 function strut(a,b,width,mat){const v=new THREE.Vector3(...b).sub(new THREE.Vector3(...a)),g=new THREE.BoxGeometry(width,v.length(),width);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),v.clone().normalize()));g.translate(...new THREE.Vector3(...a).addScaledVector(v,.5).toArray());add(g,mat);}
 add(loft([[-L,W*.78,.45,B*.82],[-L+.22,W*.95,.36,B*.93],[-L+.67,W,.37,B],[-.50,W,.37,B+.035],[L-.47,W,.40,B+.025],[L-.08,W*.94,.46,B],[L,W*.82,.50,B-.09]]),'paint');
 const fg=-L+.93,rw=W*.80;
 add(loft([[fg,W*.88,B-.01,B+.055],[s.rf,rw,B,H-.065],[s.rr,rw,B,H-.065],[s.rg,W*.88,B,B+.035]]),'glass');
 box(rw*2+.045,.085,s.rr-s.rf+.14,s.blackRoof?'black':'paint',0,H-.043,(s.rr+s.rf)/2);
 for(const side of [-1,1]){
  strut([side*W*.88,B,fg],[side*rw,H-.07,s.rf],.075,s.blackRoof?'black':'paint');
  strut([side*rw,H-.07,s.rr],[side*W*.89,B,s.rg],s.van?.16:.12,s.blackRoof?'black':'paint');
  strut([side*W*.91,B,.20],[side*rw,H-.07,.20],.075,'black');
  box(.05,.065,s.rg-fg,'chrome',side*W*.90,B+.012,(s.rg+fg)/2);
  box(.085,.18,L*1.23,s.clad?'rubber':'paint',side*(W-.035),.46,0);
  for(const z of [-.13,s.van?1.08:.95]){box(.035,.05,.19,'chrome',side*(W+.008),B-.11,z);box(.012,.45,.013,'black',side*(W+.009),B-.37,z+.20);}
  box(.18,.12,.25,s.blackRoof?'black':'paint',side*(W+.07),B+.08,fg+.11);
  box(.14,.075,.015,'glass',side*(W+.075),B+.085,fg+.245);
  if(s.clad)for(const z of [-s.wb/2,s.wb/2])add(new THREE.TorusGeometry(s.r+.035,.052,6,detailed?28:14,Math.PI),'rubber',side*(W-.02),s.r,z,0,Math.PI/2);
  if(s.rails)box(.045,.065,s.rr-s.rf-.15,'chrome',side*rw*.87,H+.03,(s.rf+s.rr)/2);
  box(.43,.105,.09,'black',side*W*.64,B-.13,-L+.045);
  box(.35,.035,.10,'head',side*W*.66,B-.11,-L+.015,0,side*.11);
  box(.36,.11,.10,'tail',side*W*.67,B-.10,L-.045);
  if(s.clad)box(.075,.18,.085,'tail',side*W*.84,B-.19,L-.10);
  if(s.van||type==='estate'||s.taxi)box(.095,.40,.075,'tail',side*W*.9,B+.03,L-.09);
  box(.14,.04,.035,'plate',side*W*.55,.66,L+.01);
 }
 box(W*1.80,.19,.16,'black',0,.46,-L+.11);box(W*1.86,.21,.15,'rubber',0,.48,L-.10);box(W*1.30,.09,.12,'chrome',0,.37,L-.09);
 box(W*1.35,.21,.085,'black',0,.71,-L+.025);for(let i=0;i<3;i++)box(W*1.20,.015,.09,'chrome',0,.65+i*.057,-L+.015);
 box(W*1.16,.085,.035,'black',0,B-.07,L-.014);
 for(const z of [-L-.006,L+.017]){box(.48,.13,.025,'plate',0,.74,z);box(.043,.12,.029,'glass',-.21,.74,z);if(detailed)for(let i=0;i<7;i++)box(.022,.063,.032,'black',-.145+i*.048,.743,z);}
 if(type==='crossover'){
  box(rw*2+.10,.055,.27,'black',0,H-.015,s.rr+.055);box(.30,.025,.045,'tail',0,H-.055,s.rr+.20);
  strut([-.26,B+.20,s.rg-.12],[.12,B+.24,s.rg-.14],.022,'black');
  const badge=new THREE.TorusGeometry(.047,.009,5,20);badge.scale(1.5,1,1);add(badge,'chrome',0,B-.19,L+.025);
 }
 if(s.van){box(W*1.91,H-B-.075,L-.25,'paint',0,(H+B)/2-.02,(L+.25)/2-.08);box(.024,H-.55,.025,'black',0,(H+.55)/2,L+.018);for(const side of [-1,1])box(.055,.07,.21,'black',side*W,.99,.90);}
 if(s.taxi){box(.46,.18,.18,'plate',0,H+.09,.15);for(let i=0;i<5;i++)box(.037,.075,.19,'black',-.13+i*.065,H+.10,.15);}
 for(const side of [-1,1])for(const z of [-s.wb/2,s.wb/2]){
  const pivot=new THREE.Group();pivot.position.set(side*(W-.055),s.r,z);group.add(pivot);const spin=new THREE.Group();pivot.add(spin);
  const tire=new THREE.Mesh(new THREE.CylinderGeometry(s.r,s.r,.205,detailed?32:16),mats.rubber);tire.rotation.z=Math.PI/2;spin.add(tire);
  const hub=new THREE.Mesh(new THREE.CylinderGeometry(s.r*.65,s.r*.65,.214,detailed?24:12),mats.chrome);hub.rotation.z=Math.PI/2;spin.add(hub);
  if(detailed){const gs=[];for(let i=0;i<5;i++){const g=new THREE.BoxGeometry(.22,.034,s.r*1.22).toNonIndexed();g.rotateX(i*Math.PI/5);gs.push(g);}spin.add(new THREE.Mesh(mergeGeometries(gs),mats.black));gs.forEach(g=>g.dispose());} // five spokes, one draw
  spin.children.forEach(m=>m.castShadow=true);
 }
 // Body panels hang under one pivot (after the four wheel pivots) so braking
 // dive, acceleration squat and roll can tilt the shell without the wheels.
 const body=new THREE.Group();body.name='body';group.add(body);
 if(!detailed&&bodies.has(type)){for(const gs of batches.values())gs.forEach(g=>g.dispose());batches.clear();
  for(const [name,g] of bodies.get(type)){const mesh=new THREE.Mesh(g,mats[name]||mats.black);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;body.add(mesh);}
  return group;}
 for(const [name,gs]of batches){const mesh=new THREE.Mesh(mergeGeometries(gs),mats[name]);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;body.add(mesh);gs.forEach(g=>g.dispose());}
 return group;
}
export function createDetailedVehicle(colour=0,detailed=false,type=detailed?'crossover':'sedan'){
 if(!specs[type])throw Error(`Unknown vehicle type: ${type}`);
 if(!templates.has(type))templates.set(type,build(type,false));
 const model=detailed?build(type,true):templates.get(type).clone(true);
 model.traverse(m=>{if(m.isMesh&&m.material.name==='paint'){m.material=registerEnvMaterial(m.material.clone());m.material.color.set(palette[colour%palette.length]);}});
 model.name=type==='crossover'?'Yaris Cross-inspired crossover':`${type} vehicle`;
 model.userData={type,spec:{...specs[type]},wheels:model.children.slice(0,4).map((pivot,i)=>({pivot,spin:pivot.children[0],front:i%2===0,radius:specs[type].r})),body:model.getObjectByName('body'),tail:detailed?model.getObjectByName('tail').material:null};
 return model;
}
export const PAINT_PALETTE=palette;
