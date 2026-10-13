import * as THREE from 'three';
import {Tree} from '@dgreenheck/ez-tree';
import {mannerheimintieTree,treeVariant,treeHeight,crownWidthRatio,STREET_VARIANTS,detailedTreeArea,detailedTreeCell} from './street-trees.js';

export {detailedTreeArea,detailedTreeCell} from './street-trees.js';
// Two detail levels share one silhouette: the near template keeps every branch level with
// slightly fewer, larger leaf cards (about a third fewer triangles than before, invisible from
// the driving camera); the far template drops twigs and uses a few big cards for the canopy.
// Kinds 3 and 4 are lean street trees (~3.8k triangles, because sixty stand in view at Lasipalatsi):
// 3 the boulevard lime (Tilia) — straight trunk, ascending limbs under a dense ovoid crown; 4 the
// corridor's maples and elms with a broader rounded crown. Both use the fullest leaf card (oak).
export function template(kind,seed,far=false){
 const tree=new Tree();tree.loadPreset(kind===2?'Pine Medium':kind===1?'Aspen Medium':'Oak Medium');
 const o=tree.options;o.seed=seed;
 if(kind>=3){
  const lime=kind===3;
  // Limes carry a closed dome of foliage (the rows by the Lasipalatsi stops show no
  // daylight through the crown): more and larger cards on more second-level limbs than the maples.
  if(far){o.branch.children={0:4,1:2,2:1};o.branch.sections={0:5,1:3,2:2,3:1};o.branch.segments={0:5,1:3,2:3,3:3};o.leaves.count=lime?12:8;o.leaves.size*=lime?3.6:3.3;}
  else{o.branch.children=lime?{0:5,1:4,2:2}:{0:4,1:3,2:2};o.branch.sections={0:7,1:4,2:3,3:2};o.branch.segments={0:6,1:4,2:3,3:3};o.leaves.count=lime?26:16;o.leaves.size*=lime?2.7:2.4;}
  o.branch.angle=lime?{1:44,2:42,3:36}:{1:56,2:50,3:40};o.branch.gnarliness={0:0,1:.04,2:.08,3:.06};o.branch.twist={0:0,1:.2,2:0,3:0};
  o.branch.force={direction:{x:0,y:1,z:0},strength:lime?.035:.01};o.branch.start[1]=lime?.26:.34;o.branch.start[2]=.1;
  o.branch.length=lime?{0:37,1:14,2:11,3:7}:{0:30,1:14,2:12,3:7};o.branch.radius={0:1.25,1:.8,2:.65,3:1};o.branch.taper={0:.78,1:.5,2:.65,3:.75};
  o.leaves.type='oak';o.leaves.billboard='single';o.leaves.start=.06;o.leaves.sizeVariance=.4;o.bark.type='oak';
 }else{
  if(far){o.branch.children={0:4,1:2,2:1};o.branch.sections={0:5,1:3,2:2,3:1};o.branch.segments={0:5,1:4,2:3,3:3};o.leaves.count=7;o.leaves.size*=2.6;}
  else{o.branch.children={0:6,1:3,2:3};o.branch.sections={0:9,1:5,2:3,3:2};o.branch.segments={0:7,1:5,2:3,3:3};o.leaves.count=13;o.leaves.size*=1.65;}
  o.branch.start[1]=kind===2?.35:.47;
  // Aspen-like rounded broadleaf cards are a linden/birch proxy, not a species scan.
  if(kind!==2)o.leaves.type='aspen';
  if(kind===1)o.bark.type='birch';
 }
 tree.generate();tree.updateMatrixWorld(true);
 const box=new THREE.Box3().setFromObject(tree),size=box.getSize(new THREE.Vector3());
 const parts=[tree.branchesMesh,tree.leavesMesh].map((source,index)=>{
  const geometry=source.geometry;geometry.translate(0,-box.min.y,0);geometry.scale(1/size.x,1/size.y,1/size.z);
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const old=source.material;
  // Street trees: grey-brown fissured bark; the green oak card is tinted fresh for limes, deeper for maples.
  const street=kind>=3;
  const material=new THREE.MeshStandardMaterial({map:old.map,normalMap:index?null:old.normalMap,
   color:index?(kind===3?'#a9cf7c':kind===4?'#a8c98c':'#72bf85'):(street?'#8f8372':'#aaa495'),roughness:1,side:index?THREE.DoubleSide:THREE.FrontSide,
   alphaTest:index?.45:0,alphaToCoverage:!!index,
   // Backlit street canopies read as black cut-outs without a touch of leaf translucency.
   emissive:index&&street?'#35521f':'#000000',emissiveIntensity:index&&street?.42:0});
  material.forceSinglePass=true;old.dispose();
  return {geometry,material};
 });
 return parts;
}
export function createRouteTrees(trees){
 const group=new THREE.Group();group.name='Detailed registered harbour, Esplanadi and Mannerheimintie trees';
 const seeds=[[0,1836],[0,7153],[1,2918],[2,4137],[3,5021],[4,6480]];
 const templates=seeds.map(([kind,seed])=>template(kind,seed)),farTemplates=seeds.map(([kind,seed])=>template(kind,seed,true));
 const buckets=new Map(),transform=new THREE.Object3D();
 let triangles=0,farTriangles=0,limes=0;
 for(const tree of trees){
  const [x,z]=tree.p,hash=Math.abs(Math.round(x*13+z*31));
  const variant=treeVariant(tree.species,hash,mannerheimintieTree(x,z));if(variant===4)limes++;
  const cell=detailedTreeCell(x,z),key=`${cell},${variant}`;
  if(!buckets.has(key))buckets.set(key,{cell,variant,trees:[]});buckets.get(key).trees.push({tree,hash});
 }
 for(const {cell,variant,trees:items} of buckets.values()){
  for(const [level,set] of [['near',templates],['far',farTemplates]])for(const [part,{geometry,material}] of set[variant].entries()){
   const mesh=new THREE.InstancedMesh(geometry,material,items.length);
   items.forEach(({tree,hash},i)=>{
    const [x,z]=tree.p,variation=.87+(hash%29)/100,street=STREET_VARIANTS.has(variant);
    const height=treeHeight(tree.size,{harbour:z>580,variant})*variation;
    const width=height*crownWidthRatio(variant);
    transform.position.set(x,.03,z);transform.rotation.set(0,(hash%628)/100,0);
    transform.scale.set(width,height,width*(.9+(hash%19)/100));transform.updateMatrix();mesh.setMatrixAt(i,transform.matrix);
    mesh.setColorAt(i,new THREE.Color().setHSL(part?(street?.22:.24):.10,part?.12:.05,.83+(hash%12)/100));
   });
   // The far set starts hidden; applyTreeLod (tile-lod.js) swaps the two by distance.
   mesh.castShadow=level==='near';mesh.receiveShadow=true;mesh.visible=level==='near';mesh.userData.lod=level;mesh.userData.cell=cell;mesh.computeBoundingSphere();mesh.computeBoundingBox();
   group.add(mesh);if(level==='near')triangles+=geometry.index.count/3*items.length;else farTriangles+=geometry.index.count/3*items.length;
  }
 }
 const limeTriangles=templates[4].reduce((n,p)=>n+p.geometry.index.count/3,0),limeFarTriangles=farTemplates[4].reduce((n,p)=>n+p.geometry.index.count/3,0);
 group.userData={count:trees.length,limes,templates:seeds.length,batches:group.children.length,triangles,farTriangles,limeTriangles,limeFarTriangles,
  accuracy:'Municipal positions; approximate crowns and broadleaf/conifer/lime family proxies, not surveyed individual trees',
  source:'EZ-Tree 1.1.0 / Daniel Greenheck, MIT; bundled bark sources credited in tree-credits.txt'};
 return group;
}
