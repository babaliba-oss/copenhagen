import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {groundAt} from './terrain.js';

// Rigged people for the few pedestrians nearest the camera. Low-poly characters by Quaternius (CC0), one skinned mesh each
// with the material colours in its vertex colours (public/models/people/*.glb, prepared in Blender), and one shared set of
// clips (anims.glb: Walk, Run, Idle, Wave, Interact...) played by bone name on any of them. Everyone further away, and
// anyone fallen, talking or out of the walking set, keeps the instanced procedural figure (person-model.js); the crowd skips
// whoever is drawn here (the returned set), so nobody is drawn twice.
const loader=new GLTFLoader();
export async function loadPeopleModels(base,names){
 try{
  const [anim,...chars]=await Promise.all([loader.loadAsync(`${base}anims.glb`),...names.map(n=>loader.loadAsync(`${base}${n}.glb`).catch(()=>null))]);
  const clips={};for(const c of anim.animations)clips[c.name]=c;
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.82,metalness:0});
  const models=[];chars.forEach((g,i)=>{if(!g)return;let skinned=null;g.scene.traverse(o=>{if(o.isSkinnedMesh&&!skinned)skinned=o;});if(!skinned)return;
   g.scene.traverse(o=>{if(o.isMesh){o.material=material;o.castShadow=true;o.receiveShadow=false;o.frustumCulled=false;}});
   const box=new THREE.Box3().setFromObject(g.scene);models.push({name:names[i],scene:g.scene,height:Math.max(.5,box.max.y-box.min.y)});});
  return models.length&&clips.Walk&&clips.Idle?{models,clips,material}:null;
 }catch(e){console.warn('Rigged people not loaded, the procedural crowd stays:',e?.message||e);return null;}
}
const RUN=2.6,IDLE=.15,FADE=.25;
export function createSkinnedCrowd(lib,{max=10,range=24,pick=a=>a.id??0}={}){
 const group=new THREE.Group();group.name='Rigged pedestrians (nearest)';
 const pools=lib.models.map(()=>[]),slots=new Map(),drawn=new Set(),order=[];let total=0;
 function slotFor(m){const pool=pools[m];let s=pool.find(s=>!s.actor);if(s)return s;if(total>=max)return null;
  const root=cloneSkinned(lib.models[m].scene),mixer=new THREE.AnimationMixer(root),actions={};
  for(const k of ['Walk','Run','Idle'])if(lib.clips[k])actions[k]=mixer.clipAction(lib.clips[k]);
  s={m,root,mixer,actions,actor:null,state:null,height:lib.models[m].height};root.visible=false;group.add(root);pool.push(s);total++;return s;}
 function play(s,state){if(s.state===state)return;const next=s.actions[state],prev=s.state&&s.actions[s.state];if(!next)return;
  next.reset().setEffectiveWeight(1).play();if(prev){prev.crossFadeTo(next,FADE,false);}s.state=state;}
 return {group,drawn,
  // actors: the walkers; looks[i] their look (height); viewer: the camera's ground position. Returns the set drawn here.
  update(dt,viewer,actors,looks=[]){
   drawn.clear();if(!viewer||!actors?.length){for(const s of slots.values()){s.root.visible=false;s.actor=null;}slots.clear();return drawn;}
   order.length=0;
   for(let i=0;i<actors.length;i++){const a=actors[i];if(!a.edge||a.knockdown||a.conversation||a.playerTaken)continue;const d=Math.hypot(a.x-viewer.x,a.z-viewer.z);if(d<range)order.push([d,i]);}
   order.sort((p,q)=>p[0]-q[0]);if(order.length>max)order.length=max;
   const keep=new Set(order.map(([,i])=>actors[i]));
   for(const [a,s] of slots)if(!keep.has(a)){s.root.visible=false;s.actor=null;s.state=null;s.mixer.stopAllAction();slots.delete(a);}
   for(const [,i] of order){const a=actors[i];let s=slots.get(a);
    if(!s){s=slotFor(Math.abs(pick(a)|0)%lib.models.length);if(!s)continue;s.actor=a;slots.set(a,s);}
    const look=looks[i]||{},k=(look.height||1.72)/s.height,speed=Math.abs(a.speed||0);
    s.root.visible=true;s.root.position.set(a.x,groundAt(a.x,a.z)+.13,a.z);s.root.rotation.set(0,(a.heading||0)+Math.PI,0);s.root.scale.setScalar(k); // the model faces +Z; a walker's heading 0 faces -Z
    const state=a.running||speed>RUN?'Run':speed>IDLE?'Walk':'Idle';play(s,state);
    const act=s.actions[state];if(act)act.timeScale=state==='Walk'?THREE.MathUtils.clamp(speed/1.25,.55,1.7):state==='Run'?THREE.MathUtils.clamp(speed/3.4,.7,1.6):1;
    s.mixer.update(dt);drawn.add(a);}
   return drawn;
  },
  dispose(){for(const pool of pools)for(const s of pool){s.mixer.stopAllAction();group.remove(s.root);}pools.forEach(p=>p.length=0);slots.clear();total=0;}};
}
