import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {groundPose} from './terrain.js';
import {BUS_DIMENSIONS} from './bus-simulation.js';
export {THREE}; // Also lets the isolated preview use the exact same engine instance.

// Original lightweight mesh, referencing the blue electric HSL fleet's proportions
// and fittings. Not an exact licensed Yutong/VDL body or a copied HSL logotype.
// A city can repaint its city buses (cities/<id>/city.json → liveries.bus), e.g. Tampere's Nysse.
let BUS_LIVERY={};
export function setBusLivery(livery={}){BUS_LIVERY=livery;}
// Blender bodies (scripts/blender/bus.py) per kind: Map of material name -> geometry. Doors, wheels, lamps,
// mirrors and the destination screen stay procedural.
const BUS_BODIES={};
export function setBusBodies(map){Object.assign(BUS_BODIES,map||{});}
// One material per bus kind for every finish but the paint: a texel per finish holds its colour, roughness, metalness
// and lamp glow; parts carry their texel in their UVs. Shared by every bus of the kind (never disposed with a bus).
const FINISH=['white','glass','black','alloy','roof','head','tail','amber'],PALETTES=new Map();
function busFinishes(kind,mats){
 const key=kind+JSON.stringify(BUS_LIVERY);if(PALETTES.has(key))return PALETTES.get(key);
 const W=8,col=new Uint8Array(W*4).fill(255),orm=new Uint8Array(W*4).fill(255),emi=new Uint8Array(W*4),rgb={},byte=v=>Math.max(0,Math.min(255,Math.round(v*255)));
 FINISH.forEach((name,i)=>{const m=mats[name];if(!m)return;m.color.getRGB(rgb,THREE.SRGBColorSpace);col.set([byte(rgb.r),byte(rgb.g),byte(rgb.b)],i*4);orm.set([255,byte(m.roughness),byte(m.metalness)],i*4);
  if(m.emissiveIntensity>0&&m.emissive.getHex()){m.emissive.clone().multiplyScalar(m.emissiveIntensity).getRGB(rgb,THREE.SRGBColorSpace);emi.set([byte(rgb.r),byte(rgb.g),byte(rgb.b),255],i*4);}});
 const texture=(data,srgb)=>{const t=new THREE.DataTexture(data,W,1,THREE.RGBAFormat,THREE.UnsignedByteType);t.magFilter=t.minFilter=THREE.NearestFilter;t.generateMipmaps=false;if(srgb)t.colorSpace=THREE.SRGBColorSpace;t.needsUpdate=true;return t;};
 const ormMap=texture(orm,false),material=new THREE.MeshStandardMaterial({color:'#ffffff',roughness:1,metalness:1,map:texture(col,true),roughnessMap:ormMap,metalnessMap:ormMap,emissive:'#ffffff',emissiveIntensity:1,emissiveMap:texture(emi,true)});
 material.name='bus finishes';material.userData.shared=true;PALETTES.set(key,material);return material;
}
function paletteTag(g,name){if(g.index){const n=g.toNonIndexed();g.dispose();g=n;}const f=FINISH.indexOf(name),u=((f<0?FINISH.indexOf('black'):f)+.5)/8;for(const k of Object.keys(g.attributes))if(k!=='position'&&k!=='normal')g.deleteAttribute(k);if(!g.attributes.normal)g.computeVertexNormals();
 const uv=new Float32Array(g.attributes.position.count*2);for(let i=0;i<uv.length;i+=2){uv[i]=u;uv[i+1]=.5;}g.setAttribute('uv',new THREE.BufferAttribute(uv,2));return g;}
export function createBusModel(kind='city',{line='',destination='HELSINKI'}={}){
 const d=BUS_DIMENSIONS[kind],tourist=kind==='tourist',trunk=kind==='trunk',group=new THREE.Group(),parts=new Map();
 const mats={paint:new THREE.MeshStandardMaterial({color:tourist?'#b5242b':trunk?'#ed6b21':'#098bd0',roughness:.4,metalness:.18}),white:new THREE.MeshStandardMaterial({color:'#e5ebe7',roughness:.5}),glass:new THREE.MeshStandardMaterial({color:'#13272f',roughness:.17,metalness:.4}),black:new THREE.MeshStandardMaterial({color:'#151c20',roughness:.85}),alloy:new THREE.MeshStandardMaterial({color:'#aab2b4',roughness:.35,metalness:.75}),roof:new THREE.MeshStandardMaterial({color:'#c0c8c7',roughness:.7}),head:new THREE.MeshStandardMaterial({color:'#f9f4da',emissive:'#fff2c8',emissiveIntensity:.7}),tail:new THREE.MeshStandardMaterial({color:'#dc1832',emissive:'#cb1222',emissiveIntensity:.5}),amber:new THREE.MeshStandardMaterial({color:'#e7ac24',emissive:'#cd830b',emissiveIntensity:.35})};
 if(kind==='coach'){mats.paint.color.set('#d7c796');mats.white.color.set('#315c79');}
 if(kind==='city')for(const [k,v] of Object.entries(BUS_LIVERY))mats[k]?.color.set(v);
 const add=(g,m,x=0,y=0,z=0,rotZ=0)=>{g.rotateZ(rotZ);g.translate(x,y,z);if(g.index)g=g.toNonIndexed();g.deleteAttribute('uv');if(!parts.has(m))parts.set(m,[]);parts.get(m).push(g);};
 const box=(w,h,l,m,x,y,z)=>add(new THREE.BoxGeometry(w,h,l),m,x,y,z);
 const round=(w,h,l,r,m,x,y,z)=>add(new RoundedBoxGeometry(w,h,l,2,r),m,x,y,z);
 const blender=BUS_BODIES[kind];
 if(!blender){
 round(2.52,1.05,d.length,.12,'paint',0,.95,0);
 round(2.47,1.38,d.length-.14,.12,'glass',0,2.09,0);
 box(2.55,.12,d.length-.1,'paint',0,1.45,0);
 round(2.48,.27,d.length-.18,.12,'paint',0,2.88,0);
 box(2.50,.12,d.length-.16,'black',0,.41,0);
 // HSL-family white lower flank accent (not a pasted photo texture).
 for(const x of [-1.27,1.27]){box(.025,.2,d.length*.7,'white',x,.70,1.05);for(let z=-d.length/2+.5;z<d.length/2-.2;z+=1.25)box(.05,1.34,.065,'black',x,2.11,z);for(const z of [-4.5,0,4.8])box(.03,.10,.23,'amber',x,.91,z);}
 if(!tourist&&kind!=='coach')for(const side of [-1,1])for(const z of [-1.25,0,1.25]){const g=new THREE.TorusGeometry(.55,.032,5,32);g.scale(1,1.35,1);g.rotateY(Math.PI/2);add(g,'white',side*1.302,1.69,z+.25);}
 }
 // Right-side front/middle/rear double doors and step edge, lime grab poles.
 // The glazed door leaves are their own two batches (forward and rear leaf of each door) so they can open at stops.
 const doorZ=tourist||kind==='coach'?[-4.9,1.5]:trunk?[-6.3,.05,5.3]:[-4.8,.05,3.95],leaves=[[],[]];
 for(const z of doorZ){box(.04,2.27,1.17,'black',1.295,1.63,z);box(.06,.07,1.10,'white',1.36,.57,z);for(const [k,side] of [[0,-1],[1,1]]){const g=new THREE.BoxGeometry(.055,1.85,.5);g.translate(1.322,1.8,z+side*.255);leaves[k].push(g);const pole=new THREE.BoxGeometry(.06,1.9,.05);pole.translate(1.36,1.75,z+side*.03);leaves[k].push(pole);}}
 // Raked-looking split windscreen surround and wiper arms.
 if(!blender)box(2.18,1.18,.05,'glass',0,2.05,-d.length/2-.018);
 box(.055,1.05,.065,'black',0,2.0,-d.length/2-.055);
 for(const x of [-.57,.57]){add(new THREE.BoxGeometry(.035,.55,.03),'black',x,1.70,-d.length/2-.075,-.4);box(.52,.15,.08,'head',x,.91,-d.length/2-.06);box(.15,.12,.085,'amber',x*.95,.70,-d.length/2-.055);box(.13,.50,.09,'tail',x*1.9,1.02,d.length/2+.025);}
 box(.63,.15,.035,'white',0,.60,-d.length/2-.04);box(.63,.15,.035,'white',0,.59,d.length/2+.035);
 // Mirrors visibly wider than the body; collision uses body plus margin.
 for(const x of [-1.49,1.49]){box(.55,.055,.06,'black',x*.90,2.76,-d.length/2+.08);round(.17,.46,.27,.06,'black',x,2.56,-d.length/2-.02);}
 const axles=tourist?[-3.1,2.5]:trunk?[-4.85,3.05,4.65]:[-3.85,2.55];
 for(const x of [-1.20,1.20])for(const z of axles){add(new THREE.CylinderGeometry(.55,.55,.21,20),'black',x,.58,z,Math.PI/2);add(new THREE.CylinderGeometry(.34,.34,.225,16),'alloy',x,.58,z,Math.PI/2);add(new THREE.CylinderGeometry(.10,.10,.24,12),'black',x,.58,z,Math.PI/2);for(let j=0;j<8;j++){const a=j*Math.PI/4;add(new THREE.SphereGeometry(.04,6,4),'black',x*1.105,.58+Math.sin(a)*.24,z+Math.cos(a)*.24);}}
 if(tourist){
  // Genuine double-decker: upper floor slab and red deck skirt above the lower-deck glazing,
  // a glazed forward upper saloon, open-air seating toward the rear behind a glass windbreak,
  // rear staircase box. Plain red livery, generic "CITY TOUR" board, no operator branding.
  box(2.51,.52,d.length-.15,'paint',0,3.26,0);
  box(2.40,.14,d.length-.3,'black',0,3.56,0);
  for(const x of [-1.20,1.20])box(.10,.10,d.length-3.5,'white',x,4.18,1.72);
  box(2.44,.10,.10,'white',0,4.18,d.length/2-.1);
  box(2.40,.72,3.2,'glass',0,3.98,-d.length/2+1.72);round(2.48,.13,3.35,.06,'paint',0,4.26,-d.length/2+1.73);
  box(.08,.7,.06,'black',0,3.98,-d.length/2+.12);
  for(const x of [-1.20,1.20]){box(.06,.46,d.length-3.5,'glass',x,3.86,1.72);for(let z=-2.8;z<5.2;z+=1.2)box(.06,.6,.06,'alloy',x,3.9,z);}
  for(let z=-2.35;z<4.6;z+=.83)for(const x of [-.73,.73]){box(.72,.10,.5,'black',x,3.68,z);round(.72,.42,.13,.05,'paint',x,3.93,z+.21);}
  box(1.0,.9,1.1,'paint',-.7,4.05,d.length/2-.75);box(.9,.4,1.0,'glass',-.7,4.1,d.length/2-.75);
 }else if(!blender){
  round(2.04,.27,5.4,.09,'roof',0,3.12,.65);round(1.3,.23,1.6,.08,'roof',0,3.10,-3.5);for(let z=-1;z<3;z+=.27)box(1.61,.014,.035,'black',0,3.26,z);
 }
 if(blender)for(const [name,g] of blender){if(!parts.has(name))parts.set(name,[]);parts.get(name).push(g.clone());}
 // Paint keeps its own material; every other finish (glass, trim, alloy, roof, lamps) draws as one palette-textured
 // mesh (busFinishes): two draws for the body instead of nine.
 const palette=busFinishes(kind,mats),trim=[];
 for(const [name,gs]of parts){if(name==='paint'){const mesh=new THREE.Mesh(mergeGeometries(gs),mats.paint);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}else for(const g of gs)trim.push(paletteTag(g,name));gs.forEach(g=>{if(!trim.includes(g))g.dispose();});}
 if(trim.length){const mesh=new THREE.Mesh(mergeGeometries(trim),palette);mesh.name='Bus finishes';mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);trim.forEach(g=>g.dispose());}
 // Route text is drawn once. Defaults avoid inventing real line numbers.
 if(typeof document!=='undefined'){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=96;const ctx=canvas.getContext('2d');ctx.fillStyle='#101918';ctx.fillRect(0,0,512,96);ctx.fillStyle='#f8cd67';ctx.font='bold 55px sans-serif';ctx.fillText(tourist?(destination||'CITY TOUR'):`${line} ${destination}`,12,66,490);const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;const screen=new THREE.Mesh(new THREE.PlaneGeometry(2.1,.37),new THREE.MeshBasicMaterial({map:texture}));screen.rotation.y=Math.PI;screen.position.set(0,2.77,-d.length/2-.055);group.add(screen);
 }
 const doors=leaves.map((gs,k)=>{const mesh=new THREE.Mesh(mergeGeometries(gs.map(g=>paletteTag(g.toNonIndexed(),'glass'))),palette);mesh.name=`Door leaves ${k?'rear':'forward'}`;gs.forEach(g=>g.dispose());group.add(mesh);return mesh;});
 // Doors open outward and slide apart (0 closed … 1 open).
 const setDoors=open=>{doors[0].position.set(.14*open,0,-.45*open);doors[1].position.set(.14*open,0,.45*open);};
 group.name=tourist?'Original Helsinki sightseeing double decker':kind==='coach'?'Original harbour charter coach':trunk?'Original Helsinki orange trunk bus':'Original Helsinki blue electric city bus';group.userData={kind,dimensions:d,originalModel:true,doors:0,setDoors};return group;
}

const slope={y:0,pitch:0,roll:0};
export function createBusRenderer(sim){
 const group=new THREE.Group();group.name='Helsinki bus fleet';const models=new Map();
 const key=b=>`${b.kind}:${b.path.segmentId}:${b.path.line}:${b.path.destination}`;
 return {group,update(player){
  const wanted=new Set(sim.buses.map(key));
  for(const [id,m]of models)if(!wanted.has(id)){group.remove(m);m.traverse(o=>{if(o.isMesh){o.geometry.dispose();if(!o.material.userData.shared){o.material.map?.dispose();o.material.dispose();}}});models.delete(id);}
  for(const b of sim.buses){const id=key(b);let m=models.get(id);if(!m){m=createBusModel(b.kind,b.path);models.set(id,m);group.add(m);}
   m.visible=Math.hypot(b.x-player.x,b.z-player.z)<500;const u=m.userData,open=Math.max(0,Math.min(1,u.doors+(b.doorsOpen?.06:-.06)));if(open!==u.doors){u.doors=open;u.setDoors(open);}groundPose(b.x,b.z,b.heading,5,1.2,slope);m.position.set(b.x,.12+slope.y,b.z);m.rotation.set(slope.pitch,b.heading,slope.roll,'YXZ');
  }
 }};
}
