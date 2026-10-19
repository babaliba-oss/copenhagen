import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {template} from './route-trees.js';
// Detailed crowns for the trees nearest the player in cities other than Helsinki, picked by species family. Broadleaf
// trees get Daniel's tree models where they load (public/models/trees/, scripts/models/tree_build.py): 'linden', a dense
// rounded tree, for limes, maples, ash, chestnuts and the smaller street trees; 'oak', an old spreading tree, for oaks,
// elms and willows. Birches and conifers, and every family when the models do not load, keep the procedural EZ-Tree
// crowns (as in Helsinki's harbour and boulevards). One BatchedMesh per kind and part (bark, leaves), each holding every
// tree of that kind, hidden until it is near.
const KIND={spruce:2,fir:2,larch:2,pine:2,birch:1,lime:3,maple:4,elm:4,ash:4,chestnut:4,broadleaf:4,poplar:4,oak:0,willow:0,blossom:0,rowan:0,alder:0};
const SEED={0:1836,1:2918,2:4137,3:5021,4:6480};
const MODEL={lime:'linden',maple:'linden',ash:'linden',chestnut:'linden',broadleaf:'linden',poplar:'linden',blossom:'linden',rowan:'linden',alder:'linden',oak:'oak',elm:'oak',willow:'oak'};
const MODEL_KIND={linden:5,oak:6};
// Both models are sculpted with their roots: the linden's flare is 1.7 m wide over its lowest 0.9 m (trunk 1 m), the oak's
// 4 m wide over its lowest 0.8 m and still 2.6 m at 2 m up (trunk 1.6 m). Standing on the pavement they read as a tree
// pulled out of the ground and set down on its root ball, so this much of each model (metres, model scale) goes below
// the ground: the trunk comes out of the pavement with a little of the flare, as a street tree does.
export const ROOT={linden:.9,oak:1.6};
export const ezKind=(family,models=null)=>{const m=MODEL[family];return m&&models?.[MODEL_KIND[m]]?MODEL_KIND[m]:KIND[family]??null;};
// The tree models as template parts ({geometry, material} for the bark, then the leaves), each scaled into a unit box
// standing on y = 0 like route-trees.js's template(), so one instance matrix (width, height, width) fits either; the
// roots (ROOT) hang below y = 0.
export async function loadTreeModels(base='/models/trees/'){
 const loader=new GLTFLoader(),out={};
 await Promise.all(Object.entries(MODEL_KIND).map(async ([name,kind])=>{try{out[kind]=modelParts(await loader.loadAsync(`${base}${name}.glb`),ROOT[name]);}catch(e){console.warn('Tree model not loaded, the EZ crowns stay:',name,e?.message||e);}}));
 return out;
}
// Scales a model's parts into the unit box with `root` metres of it below y = 0 (see ROOT). Exported for the tests.
export function unitParts(parts,box,root=0){
 const size=box.getSize(new THREE.Vector3());
 for(const {geometry} of parts){geometry.translate(0,-box.min.y-root,0);geometry.scale(1/size.x,1/size.y,1/size.z);geometry.computeBoundingBox();geometry.computeBoundingSphere();}
 return parts;
}
function modelParts(gltf,root=0){
 gltf.scene.updateMatrixWorld(true);const parts=[],box=new THREE.Box3();
 gltf.scene.traverse(o=>{if(!o.isMesh)return;const g=o.geometry.clone().applyMatrix4(o.matrixWorld);for(const k of Object.keys(g.attributes))if(!['position','normal','uv'].includes(k))g.deleteAttribute(k);
  g.computeBoundingBox();box.union(g.boundingBox);parts.push({leaves:/leaves/i.test(`${o.name} ${o.material?.name||''}`),geometry:g,map:o.material?.map||null});o.geometry.dispose();});
 if(parts.length!==2||parts[0].leaves===parts[1].leaves)throw Error('a tree model needs one bark and one leaves mesh');
 return unitParts(parts.sort((a,b)=>a.leaves-b.leaves),box,root).map(({leaves,geometry,map})=>{
  if(map)map.anisotropy=4;
  // Leaves: cut-out cards seen from both sides, with a little translucency so backlit crowns are not black.
  const material=new THREE.MeshStandardMaterial({map,roughness:1,metalness:0,side:leaves?THREE.DoubleSide:THREE.FrontSide,alphaTest:leaves?.45:0,alphaToCoverage:leaves,
   emissive:leaves?'#2b4119':'#000000',emissiveIntensity:leaves?.4:0});
  material.forceSinglePass=true;return {geometry,material,model:true};
 });
}
export function createEzTrees(items,models=null){ // items: [{x,z,y,kind,width,height,yaw,tint}]
 const group=new THREE.Group();group.name='Detailed trees (near)';
 const byKind=new Map();items.forEach((it,i)=>{if(it.kind==null)return;if(!byKind.has(it.kind))byKind.set(it.kind,[]);byKind.get(it.kind).push(i);});
 const slot=new Array(items.length).fill(null),m=new THREE.Object3D(),c=new THREE.Color();let triangles=0;
 for(const [kind,list] of byKind){
  const parts=models?.[kind]||template(kind,SEED[kind],false),meshes=[]; // the full EZ crowns: the reduced 'far' cards read as bare, wintry trees up close
  for(const [pi,{geometry,material,model}] of parts.entries()){
   const bm=new THREE.BatchedMesh(list.length,geometry.attributes.position.count,geometry.index?.count||0,material);
   const gid=bm.addGeometry(geometry);bm.name=`Detailed trees ${kind}/${pi}`;bm.perObjectFrustumCulled=true;bm.castShadow=true;bm.receiveShadow=true;bm.userData.shadowLod=true;
   for(const i of list){const it=items[i],id=bm.addInstance(gid);m.position.set(it.x,it.y,it.z);m.rotation.set(0,it.yaw,0);m.scale.set(it.width,it.height,it.width);m.updateMatrix();bm.setMatrixAt(id,m.matrix);
    // a tint per tree: the models' own textures carry the colour, so only a light one there (their bark a third lighter: the texture is dark)
    bm.setColorAt(id,model?(pi?c.setHSL(.22,.14,.86+(it.tint-.92)*.8):c.setRGB(1.3,1.24,1.16).multiplyScalar(.92+(it.tint-.92)*.8)):c.setHSL(pi?.24:.1,pi?.12:.05,.8+(it.tint-.92)*.9));bm.setVisibleAt(id,false);if(pi===0)slot[i]={meshes,id};}
   triangles+=(geometry.index?.count||geometry.attributes.position.count)/3;meshes.push(bm);group.add(bm);if(!model)geometry.dispose(); // model parts are kept: an era switch builds these again
  }
 }
 return {group,has:i=>!!slot[i],show(i,on){const s=slot[i];if(s)for(const bm of s.meshes)bm.setVisibleAt(s.id,on);},stats:{kinds:byKind.size,templateTriangles:triangles}};
}
