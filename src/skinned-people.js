import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {groundAt} from './terrain.js';
import {smoothHeading} from './person-model.js';

// Rigged people for the few pedestrians nearest the camera. Low-poly characters by Quaternius (CC0), one skinned mesh each
// with the material colours in its vertex colours (public/models/people/<name>.glb.gz, gzipped GLB, rebuilt in the
// scratch tools so the rest pose is the T-pose and the Root bone stands on the ground between the feet, facing +Z).
// The men (M_*) and the women (W_*) are two rigs: the same 62 bone names, but the women's bones are turned differently, so
// each rig has its own copy of the clips (anims.glb.gz for M_*, anims_w.glb.gz for W_*: Walk, Run, Idle, Wave, Interact,
// Death...). R_* are Daniel's cool-man and the 1760 costumes on the cool-man's own (Mixamo) skeleton, with the same clips
// retargeted onto it (anims_r.glb.gz; scripts/people/rpm_build.py and costume_build.py). Clips play in place (Root is never animated). Everyone further away, and anyone fallen, talking or out of the
// walking set, keeps the instanced procedural figure (person-model.js); the crowd skips whoever is drawn here (the
// returned set), so nobody is drawn twice.
const loader=new GLTFLoader();
async function glb(url){
 const r=await fetch(url);if(!r.ok)throw Error(`${url}: ${r.status}`);let bytes=await r.arrayBuffer();const m=new Uint8Array(bytes,0,2);
 if(m[0]===31&&m[1]===139)bytes=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); // served as stored (no Content-Encoding): unzip here
 return loader.parseAsync(bytes,url.replace(/[^/]*$/,''));
}
const HEAD=1.87; // body height of the characters (the King's crown and the Punk's mohawk stand above it)
export async function loadPeopleModels(base,names){
 try{
  const rig=n=>n.startsWith('W_')?'w':n.startsWith('R_')?'r':'m',has=r=>names.some(n=>rig(n)===r);
  const [animM,animW,animR,...chars]=await Promise.all([has('m')?glb(`${base}anims.glb.gz`):null,has('w')?glb(`${base}anims_w.glb.gz`):null,has('r')?glb(`${base}anims_r.glb.gz`):null,...names.map(n=>glb(`${base}${n}.glb.gz`).catch(e=>{console.warn('Rigged person not loaded',n,e?.message||e);return null;}))]);
  const clipSet=g=>{const c={};for(const a of g?.animations||[])c[a.name]=a;return c;},clips={m:clipSet(animM),w:clipSet(animW),r:clipSet(animR)};
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.82,metalness:0});
  const models=[];chars.forEach((g,i)=>{if(!g)return;let skinned=null;g.scene.traverse(o=>{if(o.isSkinnedMesh&&!skinned)skinned=o;});if(!skinned)return;
   const set=clips[rig(names[i])];if(!set.Walk||!set.Idle)return;const clipsOf=set;
   g.scene.traverse(o=>{if(o.isMesh){o.material=material;o.castShadow=true;o.receiveShadow=false;o.frustumCulled=false;}});
   const box=new THREE.Box3().setFromObject(g.scene);models.push({name:names[i],scene:g.scene,clips:clipsOf,height:Math.min(HEAD,Math.max(.5,box.max.y-box.min.y))});});
  return models.length?{models,material}:null;
 }catch(e){console.warn('Rigged people not loaded, the procedural crowd stays:',e?.message||e);return null;}
}
const RUN=2.6,IDLE=.15,FADE=.25;
// One rigged figure standing in for a single character (H.C. Andersen): its own scene (no clone), Idle when it stands,
// Walk or Run when it moves. update(dt, actor) follows the actor's position, heading and speed.
export function createRiggedFigure(model,{height=1.8}={}){
 const root=model.scene,mixer=new THREE.AnimationMixer(root),actions={},gait={};let state=null;
 for(const k of ['Walk','Run','Idle'])if(model.clips[k])actions[k]=mixer.clipAction(model.clips[k]);
 const k=height/model.height;root.scale.setScalar(k);root.name=`Rigged ${model.name}`;
 return {root,update(dt,a){
  if(!a||!Number.isFinite(a.x)){root.visible=false;return;}root.visible=true;
  root.position.set(a.x,(a.groundY??.13)+groundAt(a.x,a.z),a.z);root.rotation.set(0,smoothHeading(gait,(a.heading||0)+Math.PI,dt),0);
  const speed=Math.abs(a.speed||0),next=a.running||speed>RUN?'Run':speed>IDLE&&a.walking!==false?'Walk':'Idle';
  if(next!==state&&actions[next]){actions[next].reset().setEffectiveWeight(1).play();if(state&&actions[state])actions[state].crossFadeTo(actions[next],FADE,false);state=next;}
  const act=actions[state];if(act)act.timeScale=state==='Walk'?THREE.MathUtils.clamp(speed/(1.25*k),.55,1.7):state==='Run'?THREE.MathUtils.clamp(speed/(3.4*k),.7,1.6):1;
  mixer.update(dt);}};
}
// Baked crowd: the walkers beyond the rigged few, out to `range`, as the same characters without a skeleton. Each model's
// Walk cycle is baked once (lazily, one model per tick) into FRAMES morph targets of absolute positions plus one Idle frame;
// one InstancedMesh per model, whose per-instance morph weights blend the two frames either side of each walker's own
// phase. Flat shading (screen-space normals), so the frames need no normals. Who is drawn here is returned, so the
// procedural figure skips them; anyone posed, fallen, talking, running or pushing a pram keeps the procedural figure.
const FRAMES=12;
export function createBakedCrowd(lib,{range=130,capacity=40,pick=a=>a.id??0,onWalker=null}={}){
 const group=new THREE.Group();group.name='Baked walkers (crowd)';
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,metalness:0,flatShading:true});
 const kinds=lib.models.map(()=>null),phase=new Map(),drawn=new Set(),v=new THREE.Vector3(),m=new THREE.Matrix4(),q=new THREE.Quaternion(),sc=new THREE.Vector3(),UP=new THREE.Vector3(0,1,0);
 function bake(mi){
  const model=lib.models[mi],root=cloneSkinned(model.scene);let mesh=null;root.traverse(o=>{if(o.isSkinnedMesh&&!mesh)mesh=o;});
  if(!mesh||!model.clips.Walk||!model.clips.Idle)return;
  const mixer=new THREE.AnimationMixer(root),n=mesh.geometry.attributes.position.count,frames=[];
  const capture=()=>{root.updateMatrixWorld(true);const a=new Float32Array(n*3);for(let i=0;i<n;i++){mesh.getVertexPosition(i,v);v.applyMatrix4(mesh.matrixWorld);a[i*3]=v.x;a[i*3+1]=v.y;a[i*3+2]=v.z;}return new THREE.BufferAttribute(a,3);};
  const walk=mixer.clipAction(model.clips.Walk).play(),D=model.clips.Walk.duration;
  for(let f=0;f<FRAMES;f++){mixer.setTime(f/FRAMES*D);frames.push(capture());}
  walk.stop();mixer.clipAction(model.clips.Idle).play();mixer.setTime(0);frames.push(capture());mixer.stopAllAction();
  const g=new THREE.BufferGeometry();g.setAttribute('position',frames[0].clone());if(mesh.geometry.attributes.color)g.setAttribute('color',mesh.geometry.attributes.color);if(mesh.geometry.index)g.setIndex(mesh.geometry.index);
  g.morphAttributes.position=frames;g.morphTargetsRelative=false;g.computeBoundingSphere();
  const im=new THREE.InstancedMesh(g,material,capacity),len=frames.length+1;im.name=`Baked ${model.name}`;im.count=0;im.frustumCulled=false;im.castShadow=true;im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.morphTexture=new THREE.DataTexture(new Float32Array(len*capacity),len,capacity,THREE.RedFormat,THREE.FloatType);
  group.add(im);kinds[mi]={im,len,D,height:model.height};
 }
 let baking=0;const step=()=>{if(baking>=kinds.length)return;try{bake(baking);}catch(e){console.warn('Baked walker not made',lib.models[baking]?.name,e?.message||e);}baking++;setTimeout(step,30);};setTimeout(step,0);
 return {group,drawn,
  // as createSkinnedCrowd.update; near: the walkers drawn rigged (skipped here)
  update(dt,viewer,actors,looks=[],near=null){
   drawn.clear();for(const k of kinds)if(k)k.im.count=0;if(!viewer||!actors?.length)return drawn;
   for(let i=0;i<actors.length;i++){const a=actors[i],look=looks[i]||{};
    if(!a.edge||a.knockdown||a.conversation||a.playerTaken||a.pose||a.suitcase||a.running||look.accessory==='stroller'||near?.has(a))continue;
    if(Math.hypot(a.x-viewer.x,a.z-viewer.z)>=range)continue;
    const mi=Math.abs(pick(a)|0)%lib.models.length,k=kinds[mi];if(!k||k.im.count>=capacity)continue;
    const scale=(look.height||1.72)/k.height,speed=Math.abs(a.speed||0);let st=phase.get(a);if(!st){st={p:Math.random(),h:a.heading||0};phase.set(a,st);}
    const walking=speed>IDLE;if(walking)st.p=(st.p+dt*THREE.MathUtils.clamp(speed/(1.25*scale),.55,1.7)/k.D)%1;
    st.h=smoothHeading(st,a.heading||0,dt);
    const idx=k.im.count++,y=(a.groundY??.13)+groundAt(a.x,a.z);
    k.im.setMatrixAt(idx,m.compose(v.set(a.x,y,a.z),q.setFromAxisAngle(UP,st.h+Math.PI),sc.setScalar(scale)));
    const row=k.im.morphTexture.image.data,o=idx*k.len;row.fill(0,o,o+k.len);
    if(walking){const f=st.p*FRAMES,i0=Math.floor(f)%FRAMES,w=f-Math.floor(f);row[o+1+i0]=1-w;row[o+1+(i0+1)%FRAMES]=w;}else row[o+1+FRAMES]=1;
    onWalker?.(a,look,{x:a.x,z:a.z,y,heading:st.h,phase:st.p,walking});
    drawn.add(a);}
   for(const k of kinds)if(k&&k.im.count){k.im.instanceMatrix.needsUpdate=true;k.im.morphTexture.needsUpdate=true;}
   return drawn;
  },
  dispose(){for(const k of kinds)if(k){group.remove(k.im);k.im.geometry.dispose();k.im.morphTexture.dispose();}phase.clear();}};
}
export function createSkinnedCrowd(lib,{max=10,range=24,pick=a=>a.id??0,onWalker=null}={}){
 const group=new THREE.Group();group.name='Rigged pedestrians (nearest)';
 const pools=lib.models.map(()=>[]),slots=new Map(),drawn=new Set(),order=[];let total=0;
 function slotFor(m){const pool=pools[m];let s=pool.find(s=>!s.actor);if(s)return s;if(total>=max)return null;
  const model=lib.models[m],root=cloneSkinned(model.scene),mixer=new THREE.AnimationMixer(root),actions={};
  for(const k of ['Walk','Run','Idle'])if(model.clips[k])actions[k]=mixer.clipAction(model.clips[k]);
  s={m,root,mixer,actions,actor:null,state:null,height:model.height,gait:{}};root.visible=false;group.add(root);pool.push(s);total++;return s;}
 function play(s,state){if(s.state===state)return;const next=s.actions[state],prev=s.state&&s.actions[s.state];if(!next)return;
  next.reset().setEffectiveWeight(1).play();if(prev){prev.crossFadeTo(next,FADE,false);}s.state=state;}
 function release(a,s){s.root.visible=false;s.actor=null;s.state=null;s.gait={};s.mixer.stopAllAction();slots.delete(a);}
 return {group,drawn,
  // actors: the walkers; looks[i] their look (height); viewer: the camera's ground position. Returns the set drawn here.
  update(dt,viewer,actors,looks=[]){
   drawn.clear();if(!viewer||!actors?.length){for(const [a,s] of slots)release(a,s);return drawn;}
   order.length=0;
   for(let i=0;i<actors.length;i++){const a=actors[i];if(!a.edge||a.knockdown||a.conversation||a.playerTaken||a.pose||a.suitcase||looks[i]?.accessory==='stroller')continue; /* a pose (phone, chat, bike...), a suitcase or a pram: the procedural figure draws it */const d=Math.hypot(a.x-viewer.x,a.z-viewer.z);if(d<range)order.push([d,i]);}
   order.sort((p,q)=>p[0]-q[0]);if(order.length>max)order.length=max;
   const keep=new Set(order.map(([,i])=>actors[i]));
   for(const [a,s] of slots)if(!keep.has(a))release(a,s);
   for(const [,i] of order){const a=actors[i];let s=slots.get(a);
    if(!s){s=slotFor(Math.abs(pick(a)|0)%lib.models.length);if(!s)continue;s.actor=a;slots.set(a,s);}
    const look=looks[i]||{},k=(look.height||1.72)/s.height,speed=Math.abs(a.speed||0);
    s.root.visible=true;s.root.position.set(a.x,(a.groundY??.13)+groundAt(a.x,a.z),a.z);s.root.scale.setScalar(k);
    s.root.rotation.set(0,smoothHeading(s.gait,(a.heading||0)+Math.PI,dt),0); // the model faces +Z; a walker's heading 0 faces -Z
    const state=a.running||speed>RUN?'Run':speed>IDLE?'Walk':'Idle';play(s,state);
    const act=s.actions[state];if(act)act.timeScale=state==='Walk'?THREE.MathUtils.clamp(speed/(1.25*k),.55,1.7):state==='Run'?THREE.MathUtils.clamp(speed/(3.4*k),.7,1.6):1;
    s.mixer.update(dt);drawn.add(a);onWalker?.(a,look,{x:a.x,z:a.z,y:s.root.position.y,heading:s.root.rotation.y-Math.PI,phase:(act?act.time/(act.getClip().duration||1):0)%1,walking:state!=='Idle'});}
   return drawn;
  },
  dispose(){for(const pool of pools)for(const s of pool){s.mixer.stopAllAction();group.remove(s.root);}pools.forEach(p=>p.length=0);slots.clear();total=0;}};
}
