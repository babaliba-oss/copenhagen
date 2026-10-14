import * as THREE from 'three';
import {groundAt} from './terrain.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {speciesFamily} from './place-data.js';
import {createEzTrees,ezKind} from './ez-trees.js';

// Species-shaped trees for cities with a tree register (any city whose trees carry a species name).
// Each family's silhouette, colours and proportions were read from current photos of Tampere's
// streets and parks (cities/tampere/keskustori-reference.json → trees):
//  lime    clear straight stem, dense upright ovoid crown, fresh mid green (park and street limes)
//  maple   short stem forking low into a broad, dense, round dome, deeper green (Old Church park)
//  oak     stout trunk, broad irregular crown of separate clumps with gaps, dark green
//  elm     tall trunk splitting into ascending limbs, wide vase-shaped high crown (theatre riverside)
//  ash     tall open oval crown, light airy foliage with the limbs showing through
//  birch   white stem with dark marks, narrow airy oval crown with drooping tips
//  spruce  dense dark blue-green cone from near the ground in drooping whorls
//  larch   lighter, open cone of soft green tiers
//  pine    tall bare orange-brown stem, flat irregular crown at the top
// and smaller families (rowan, alder, blossom trees, willow, poplar, columnar aspen, chestnut, fir).
// Geometry is original and procedural (no textures); crowns are clusters of lumps with normals bent
// towards the crown centre so they shade as one canopy. Three levels of detail swap by distance.

export const FAMILY={
 lime:     {width:.56,base:.3,shape:'ovoid',lumps:30,size:.2,leaf:'#537239',tip:'#86ad55',bark:'#5c544a',open:.15},
 maple:    {width:.82,base:.24,shape:'dome',lumps:30,size:.22,leaf:'#446130',tip:'#6f9944',bark:'#57514a',open:.1,fork:true},
 oak:      {width:.9,base:.28,shape:'clumps',lumps:26,size:.2,leaf:'#3d532b',tip:'#62813b',bark:'#4d463e',open:.35,fork:true},
 elm:      {width:.95,base:.38,shape:'vase',lumps:28,size:.2,leaf:'#455e31',tip:'#6d8f45',bark:'#5a5249',open:.3,fork:true},
 ash:      {width:.7,base:.4,shape:'ovoid',lumps:22,size:.17,leaf:'#536d3e',tip:'#83a55c',bark:'#77736a',open:.5,fork:true},
 birch:    {width:.48,base:.3,shape:'weeping',lumps:22,size:.15,leaf:'#617c43',tip:'#94b766',bark:'#e3e0d6',open:.45,birch:true},
 rowan:    {width:.65,base:.35,shape:'ovoid',lumps:16,size:.22,leaf:'#4f6b36',tip:'#7c9f4c',bark:'#6a6560',open:.25},
 alder:    {width:.5,base:.3,shape:'ovoid',lumps:20,size:.2,leaf:'#384e29',tip:'#56763a',bark:'#4b4642',open:.2},
 blossom:  {width:.95,base:.32,shape:'dome',lumps:16,size:.25,leaf:'#506938',tip:'#7d9e50',bark:'#4a3f38',open:.2},
 willow:   {width:.95,base:.25,shape:'weeping',lumps:24,size:.2,leaf:'#6d7d59',tip:'#a2b385',bark:'#5f584d',open:.2},
 poplar:   {width:.6,base:.3,shape:'ovoid',lumps:26,size:.19,leaf:'#466135',tip:'#6f9650',bark:'#6d6a62',open:.25},
 columnar: {width:.22,base:.12,shape:'column',lumps:18,size:.15,leaf:'#466434',tip:'#6f9a4c',bark:'#77746b',open:.1},
 chestnut: {width:.85,base:.25,shape:'dome',lumps:28,size:.22,leaf:'#385029',tip:'#577a39',bark:'#4e4740',open:.1,fork:true},
 broadleaf:{width:.7,base:.3,shape:'ovoid',lumps:24,size:.2,leaf:'#486434',tip:'#739c4a',bark:'#5a534a',open:.2},
 spruce:   {width:.36,base:.04,shape:'spruce',leaf:'#28392e',tip:'#3e5a45',bark:'#4a3d33'},
 fir:      {width:.26,base:.05,shape:'spruce',leaf:'#26362a',tip:'#3a5640',bark:'#4a3d33'},
 larch:    {width:.42,base:.12,shape:'larch',leaf:'#5e7749',tip:'#8fae6a',bark:'#5d4a3c'},
 pine:     {width:.45,base:.62,shape:'pine',lumps:12,size:.2,leaf:'#34482f',tip:'#52704a',bark:'#9a6c4a',open:.3}
};
export const FAMILIES=Object.keys(FAMILY);
const LEVELS=['near','mid','far'];

function rng(seed){let s=seed>>>0||1;return ()=>((s=Math.imul(s^s>>>15,1|s)+0x6d2b79f5|0,((s^s>>>14)>>>0)/4294967296));}
// Crown radius (in units of the crown's half width) at relative height t (0 = crown base, 1 = top).
export function crownProfile(shape,t){
 t=Math.max(0,Math.min(1,t));
 switch(shape){
  case 'dome':return Math.sqrt(Math.max(0,1-(t*1.15-.45)**2/0.3025))*.98+.02;
  case 'vase':return .35+.65*Math.sin(Math.min(1,t*1.25)*Math.PI*.62);
  case 'weeping':return Math.sin(Math.PI*Math.pow(t,.8))*.95+.05;
  case 'column':return .75+.25*Math.sin(Math.PI*t);
  case 'clumps':return Math.sin(Math.PI*Math.pow(t,.7));
  default:return Math.sin(Math.PI*Math.pow(t,.85)); // ovoid
 }
}
const color=hex=>new THREE.Color(hex);
// Colours a geometry by height inside the crown: darker and cooler low and inside, lighter at the top.
function paint(g,base,tip,y0,y1,shade=0,gain=1){
 const p=g.attributes.position,c=new Float32Array(p.count*3),a=color(base),b=color(tip),t=new THREE.Color();
 for(let i=0;i<p.count;i++){const k=Math.max(0,Math.min(1,(p.getY(i)-y0)/Math.max(.001,y1-y0)));t.copy(a).lerp(b,k*.85).multiplyScalar((1-shade*(1-k))*gain);c.set([t.r,t.g,t.b],i*3);}
 g.setAttribute('color',new THREE.BufferAttribute(c,3));return g;
}
function cylinder(r0,r1,y0,y1,seg,hex,x=0,z=0,tilt=null){
 const g=new THREE.CylinderGeometry(r1,r0,y1-y0,seg,1,true);g.translate(0,(y0+y1)/2,0);
 if(tilt){g.translate(0,-y0,0);g.rotateZ(tilt[0]);g.rotateX(tilt[1]);g.translate(0,y0,0);}
 g.translate(x,0,z);return paint(g.toNonIndexed(),hex,hex,0,1);
}
// aspect squashes a lump vertically (1 = round clumps).
function lump(cx,cy,cz,r,detail,centre,blend=.5,aspect=1){
 const g=new THREE.IcosahedronGeometry(1,detail);g.scale(r,r*.85*aspect,r);g.translate(cx,cy,cz);
 // Normals: half the lump's own sphere, half pointing out of the whole crown, so lumps read as one canopy.
 const p=g.attributes.position,n=new Float32Array(p.count*3),v=new THREE.Vector3(),w=new THREE.Vector3();
 for(let i=0;i<p.count;i++){v.set(p.getX(i)-cx,p.getY(i)-cy,p.getZ(i)-cz).normalize();w.set(p.getX(i)-centre.x,(p.getY(i)-centre.y)*.8,p.getZ(i)-centre.z).normalize();v.lerp(w,blend).normalize();n.set([v.x,v.y,v.z],i*3);}
 g.setAttribute('normal',new THREE.BufferAttribute(n,3));return g;
}
function finish(parts){
 for(const g of parts){for(const k of Object.keys(g.attributes))if(!['position','normal','color'].includes(k))g.deleteAttribute(k);if(!g.attributes.normal)g.computeVertexNormals();}
 const g=mergeGeometries(parts);parts.forEach(p=>p.dispose());g.computeBoundingSphere();g.computeBoundingBox();return g;
}

// One tree template of unit height (x/z scaled by the family's width), for a level of detail.
export function treeTemplate(family,level='near',seed=1){
 const F=FAMILY[family]||FAMILY.broadleaf,R=rng(seed*7919+family.length*31),L=LEVELS.indexOf(level),parts=[];
 const W=F.width/2,trunkR=F.birch?.013:.017,seg=[7,5,3][L];
 const bark=F.bark;
 if(F.shape==='spruce'||F.shape==='larch'){
  parts.push(cylinder(trunkR*1.2,trunkR*.3,0,.9,seg,bark));
  const tiers=(F.shape==='larch'?[9,6,3]:[14,8,4])[L],sides=[12,8,5][L];
  for(let i=0;i<tiers;i++){
   const t0=i/tiers,t1=(i+1.6)/tiers,y0=F.base+(1-F.base)*t0,y1=Math.min(1,F.base+(1-F.base)*t1),r=W*(1-t0)*(F.shape==='larch'?.95:1)*(.9+.2*R());
   const g=new THREE.ConeGeometry(r,y1-y0,sides,1,true);g.translate(0,(y0+y1)/2,0);
   // Drooping, ragged whorl edges: pull every other rim vertex down and in.
   const p=g.attributes.position;for(let k=0;k<p.count;k++){if(p.getY(k)<(y0+y1)/2-.001){const odd=k%2;p.setY(k,p.getY(k)-(odd?.02:0));p.setX(k,p.getX(k)*(odd?.82:1));p.setZ(k,p.getZ(k)*(odd?.82:1));}}
   g.rotateY(R()*6.28);parts.push(paint(g.toNonIndexed(),F.leaf,F.tip,F.base,1,F.shape==='larch'?.1:.25));
   if(F.shape==='larch'&&L===0)i+=.0;
  }
  if(L===0&&F.shape==='spruce'){const g=new THREE.ConeGeometry(W*.12,.08,6,1,true);g.translate(0,.97,0);parts.push(paint(g.toNonIndexed(),F.tip,F.tip,0,1));}
  return finish(parts);
 }
 // Broadleaf and pine: trunk, limbs into the crown, then the lumps.
 const top=F.shape==='pine'?.92:F.base+(1-F.base)*.45;
 const trunk=cylinder(trunkR*1.25,trunkR*.75,0,top,seg,bark);
 if(F.birch){const p=trunk.attributes.position,c=trunk.attributes.color;for(let i=0;i<p.count;i++){const y=p.getY(i),mark=Math.sin(y*90+Math.cos(p.getX(i)*400)*2)>.7||y<.06;if(mark)c.setXYZ(i,.18,.17,.16);}}
 parts.push(trunk);
 if((F.fork||F.open>.3)&&L<2){const limbs=F.fork?4:3;for(let i=0;i<limbs;i++){const a=i/limbs*6.28+R(),lean=.35+R()*.35;parts.push(cylinder(trunkR*.7,trunkR*.25,F.base*.9,F.base+(1-F.base)*.6,L?3:5,bark,0,0,[Math.cos(a)*lean,Math.sin(a)*lean]));}}
 const yb=F.base,yt=1,cy=(yb+yt)/2,centre=new THREE.Vector3(0,cy,0),n=Math.max(4,Math.round(F.lumps*[3,.5,.14][L]));
 const size=F.size*[.52,1.0,1.25][L],detail=0,lumps=[];
 // Core lumps fill the middle so open crowns never show daylight straight through the centre.
 const cores=L===2?1:2;for(let i=0;i<cores;i++)lumps.push(lump(0,cy+(i-.5)*.12*(yt-yb),0,W*(L===2?.62:.5),L===2?1:0,centre,.75,1));
 for(let i=0;i<n;i++){
  let t=F.shape==='pine'?.25+.75*R():Math.pow(R(),F.shape==='vase'?.6:.9);
  if(F.shape==='clumps')t=Math.min(1,Math.floor(t*4)/4+R()*.18+.06);
  const a=R()*6.283+(F.shape==='clumps'?Math.floor(R()*5)*1.256:0),prof=crownProfile(F.shape==='pine'?'dome':F.shape,t),depth=.7+.3*Math.sqrt(R())*(1-F.open*.4);
  const r=W*prof*depth*[1,.85,.68][L],y=yb+(yt-yb)*t,sz=size*(.75+.5*R())*(F.shape==='pine'?1.2:1);
  lumps.push(lump(Math.cos(a)*r,y-(F.shape==='weeping'?sz*.25*Math.abs(Math.cos(a)):0),Math.sin(a)*r,sz,detail,centre,.5,1));
 }
 // Each leaf clump a little lighter or darker than its neighbours, as sunlit and shaded clumps are.
 for(const [i,g] of lumps.entries())paint(g,F.leaf,F.tip,yb,yt,.3,i<cores?.78:.86+.28*R());
 return finish([...parts,...lumps]);
}

// Which template, scale and tint a registered tree gets. Pure, so the tests can check every family.
export function treeInstance(t,i=0){
 const family=t.family||speciesFamily(t.species,t.conifer),F=FAMILY[family]||FAMILY.broadleaf;
 const h=Math.max(2.5,t.height||10),young=h<6.5&&!/spruce|fir|larch|pine/.test(family);
 const hash=Math.abs(Math.round(t.p[0]*13+t.p[1]*31+i));
 // Young street trees: narrower than their mature form, as in the photos (slim stems, upright crowns).
 const width=h*(young?.68:1)*(.9+(hash%23)/100); // the template already carries the family's width
 return {family,height:h*(.95+(hash%11)/100),width,variant:hash%2,yaw:(hash%628)/100,tint:.92+(hash%17)/100};
}

// All species trees of a city in three BatchedMeshes (near, mid, far): one draw call per level, with
// per-tree visibility by distance and per-tree frustum culling. Returns {group, update(focus), stats}.
export const SPECIES_LOD={near:95,mid:460,far:850}; // near: full EZ crowns (about 2-9k triangles each)
export function treeLevel(d,b=SPECIES_LOD){return d<b.near?'near':d<b.mid?'mid':d<b.far?'far':null;}
export function createSpeciesTrees(trees,{detailed=false}={}){
 const group=new THREE.Group();group.name='Species trees';
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,metalness:0,emissive:'#3a4a28',emissiveIntensity:.45});
 const items=trees.map((t,i)=>({t,inst:treeInstance(t,i)})),used=new Set(items.map(o=>`${o.inst.family}|${o.inst.variant}`));
 const meshes={},ids={},triangles={};const m=new THREE.Object3D(),tint=new THREE.Color();
 // Near trees: the detailed EZ-Tree crowns (as in Helsinki) where the family has one; the procedural near shape otherwise.
 const ez=detailed?createEzTrees(items.map(({t,inst})=>{const F=FAMILY[inst.family]||FAMILY.broadleaf;return {x:t.p[0],z:t.p[1],y:groundAt(t.p[0],t.p[1]),kind:ezKind(inst.family),width:inst.width*F.width*1.05,height:inst.height,yaw:inst.yaw,tint:inst.tint};})):null;
 if(ez)group.add(ez.group);
 for(const level of LEVELS){
  const geos=new Map([...used].map(k=>{const [f,v]=k.split('|');return [k,treeTemplate(f,level,+v+1)];}));
  const verts=[...geos.values()].reduce((n,g)=>n+g.attributes.position.count,0);
  const bm=new THREE.BatchedMesh(Math.max(1,items.length),Math.max(3,verts),0,material);bm.name=`Species trees (${level})`;
  const gid=new Map([...geos].map(([k,g])=>[k,bm.addGeometry(g)]));ids[level]=[];triangles[level]=0;
  for(const {t,inst} of items){const id=bm.addInstance(gid.get(`${inst.family}|${inst.variant}`));m.position.set(t.p[0],groundAt(t.p[0],t.p[1]),t.p[1]);m.rotation.set(0,inst.yaw,0);m.scale.set(inst.width,inst.height,inst.width);m.updateMatrix();
   bm.setMatrixAt(id,m.matrix);bm.setColorAt(id,tint.setScalar(inst.tint));bm.setVisibleAt(id,false);ids[level].push(id);triangles[level]+=geos.get(`${inst.family}|${inst.variant}`).attributes.position.count/3;}
  geos.forEach(g=>g.dispose());
  bm.perObjectFrustumCulled=true;bm.castShadow=level==='near';bm.receiveShadow=level!=='far';bm.userData.shadowLod=true;meshes[level]=bm;group.add(bm);
 }
 let last=null;const shown=new Array(items.length).fill(null);
 const update=focus=>{
  if(last&&Math.hypot(focus.x-last.x,focus.z-last.z)<8)return;last={x:focus.x,z:focus.z};
  items.forEach(({t},i)=>{const l=treeLevel(Math.hypot(t.p[0]-focus.x,t.p[1]-focus.z));if(l===shown[i])return;
   const vis=(lv,on)=>{if(lv==='near'&&ez?.has(i))ez.show(i,on);else meshes[lv].setVisibleAt(ids[lv][i],on);};
   if(shown[i])vis(shown[i],false);if(l)vis(l,true);shown[i]=l;});
 };
 const families={};for(const {inst} of items)families[inst.family]=(families[inst.family]||0)+1;
 group.userData={count:trees.length,families,templates:used.size*LEVELS.length,drawCalls:LEVELS.length,trianglesIfAllNear:triangles.near,trianglesIfAllMid:triangles.mid,trianglesIfAllFar:triangles.far,
  accuracy:'Register positions, species and height classes; crown shapes per species family from current photos',source:'Procedural geometry (src/tree-species.js)'};
 return {group,update,stats:group.userData,levels:()=>{const c={near:0,mid:0,far:0};for(const l of shown)if(l)c[l]++;return c;}};
}
