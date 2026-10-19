import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {groundAt} from './terrain.js';
import {smoothHeading} from './person-model.js';
import {rigOf,measure,pose,RIDE,SIT,POSE_HEIGHT} from './people-poses.js';
import {MeshoptSimplifier} from 'meshoptimizer';
let simplifier=null;MeshoptSimplifier.ready.then(()=>{simplifier=MeshoptSimplifier;}).catch(()=>{});
import {safeFlatShading} from './safe-flat.js';

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
// Baked people: the characters without a skeleton, for everyone beyond the rigged few. A model is baked once per set
// (lazily, from a shared queue run a few milliseconds a tick) into morph targets of absolute vertex positions: `walk`, its Walk cycle
// at FRAMES frames plus one Idle frame; `ride`, CRANK frames of pedalling a bike; `sit`, sitting on a café chair (the
// last two posed from Idle in people-poses.js). Each renderer has one InstancedMesh per model, whose per-instance morph
// weights blend two frames (or show one). Flat shading (screen-space normals), so the frames need no normals.
const FRAMES=12,CRANK=8,SETS={walk:FRAMES+1,ride:CRANK,sit:1};
export const WALK_FRAMES=FRAMES; // the Idle frame follows them
const baked=new WeakMap(),queue=[];let ticking=false;
const tick=()=>{const t0=performance.now();while(queue.length&&performance.now()-t0<8){const job=queue.shift();try{job();}catch(e){console.warn('Baked person not made:',e?.message||e);}}if(!queue.length){ticking=false;return;}setTimeout(tick,30);}; // jobs back to back for up to 8 ms a tick (a crowd's renderer only makes meshes from bakes already done)
const later=job=>{queue.push(job);if(!ticking){ticking=true;MeshoptSimplifier.ready.catch(()=>{}).finally(()=>setTimeout(tick,0));}}; // after the simplifier, so every bake has its far version
// The far version of a baked model: about a third of its triangles (meshoptimizer keeps the vertices it uses, so the
// frames and colours are shared), for the baked people beyond LOD_NEAR metres, where a 6,000-triangle character is a
// few dozen pixels tall. null until the simplifier is ready, or where it saves little.
const LOD_NEAR=32;
function farVersion(g){
 if(!simplifier||!g.index)return null;
 // weld first: the Quaternius characters come with every triangle's corners apart (flat shaded), which leaves the
 // simplifier nothing to collapse; vertices with the same place and colour become one (colour edges stay seams)
 // (and on a compact copy: a vertex with an unused twin at its place would count as a seam and never move)
 const pos=g.morphAttributes.position[0].array,col=g.attributes.color?.array,n=pos.length/3,seen=new Map(),remap=new Uint32Array(n),rep=[];
 for(let i=0;i<n;i++){const k=pos[i*3]+','+pos[i*3+1]+','+pos[i*3+2]+(col?','+col[i*3]+','+col[i*3+1]+','+col[i*3+2]:'');let r=seen.get(k);if(r===undefined){seen.set(k,r=rep.length);rep.push(i);}remap[i]=r;}
 const src=g.index.array,idx=new Uint32Array(src.length);for(let i=0;i<src.length;i++)idx[i]=remap[src[i]];
 const cpos=new Float32Array(rep.length*3);rep.forEach((v,j)=>{cpos[j*3]=pos[v*3];cpos[j*3+1]=pos[v*3+1];cpos[j*3+2]=pos[v*3+2];});
 const [cut]=simplifier.simplify(idx,cpos,3,Math.floor(idx.length*.3/3)*3,.05,[]),out=cut.map(j=>rep[j]);
 if(out.length>idx.length*.75)return null;
 const lod=new THREE.BufferGeometry();for(const [k,a] of Object.entries(g.attributes))lod.setAttribute(k,a);
 lod.setIndex(new THREE.BufferAttribute(g.attributes.position.count<65536?new Uint16Array(out):out,1));lod.morphAttributes.position=g.morphAttributes.position;lod.morphTargetsRelative=false;
 lod.boundingSphere=g.boundingSphere;lod.userData=g.userData;return lod;
}
export function bakeModel(model,set){
 let cache=baked.get(model);if(!cache)baked.set(model,cache={});
 if(set in cache)return cache[set];cache[set]=null;
 const root=cloneSkinned(model.scene);let mesh=null;root.traverse(o=>{if(o.isSkinnedMesh&&!mesh)mesh=o;});
 if(!mesh||!model.clips.Walk||!model.clips.Idle)return null;
 const mixer=new THREE.AnimationMixer(root),n=mesh.geometry.attributes.position.count,frames=[],v=new THREE.Vector3();
 const capture=(off=null)=>{root.updateMatrixWorld(true);const a=new Float32Array(n*3);for(let i=0;i<n;i++){mesh.getVertexPosition(i,v);v.applyMatrix4(mesh.matrixWorld);if(off)v.add(off);a[i*3]=v.x;a[i*3+1]=v.y;a[i*3+2]=v.z;}return new THREE.BufferAttribute(a,3);};
 if(set==='walk'){
  const walk=mixer.clipAction(model.clips.Walk).play(),D=model.clips.Walk.duration;
  for(let f=0;f<FRAMES;f++){mixer.setTime(f/FRAMES*D);frames.push(capture());}
  walk.stop();mixer.clipAction(model.clips.Idle).play();mixer.setTime(0);frames.push(capture());
 }else{
  mixer.clipAction(model.clips.Idle).play();mixer.setTime(0);root.updateMatrixWorld(true);
  const bones=rigOf(root);if(!bones){mixer.stopAllAction();return null;}
  const m=measure(bones),s=model.height/POSE_HEIGHT,saved=[];root.traverse(o=>{if(o.isBone)saved.push([o,o.position.clone(),o.quaternion.clone()]);});
  const specs=set==='ride'?Array.from({length:CRANK},(_,k)=>({...RIDE,crank:{...RIDE.crank,a:k/CRANK*Math.PI*2}})):[SIT];
  for(const spec of specs){for(const [o,p,q] of saved){o.position.copy(p);o.quaternion.copy(q);}root.updateMatrixWorld(true);frames.push(capture(pose(root,bones,m,spec,s)));}
 }
 mixer.stopAllAction();
 const g=new THREE.BufferGeometry();g.setAttribute('position',frames[0].clone());if(mesh.geometry.attributes.color)g.setAttribute('color',mesh.geometry.attributes.color);if(mesh.geometry.index)g.setIndex(mesh.geometry.index);
 g.morphAttributes.position=frames;g.morphTargetsRelative=false;g.computeBoundingSphere();g.userData.walkDuration=model.clips.Walk.duration;
 g.userData.far=farVersion(g);
 return cache[set]=g;
}
// A renderer for one set: begin(viewer), draw(actor, look, f0, w0, f1, w1) for each person (frames and weights; returns
// false when it cannot: out of range, its model not baked yet or full), end(). `pick` chooses the model for an actor.
export function createBakedPeople(lib,{set='walk',capacity=32,range=140,pick=a=>a.id??0,name=`Baked people (${set})`,shadows=true}={}){
 const group=new THREE.Group();group.name=name;
 const material=safeFlatShading(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85,metalness:0,flatShading:true}));
 const kinds=lib.models.map(()=>null),len=SETS[set]+1,m=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),sc=new THREE.Vector3(),UP=new THREE.Vector3(0,1,0);
 const mesh=(g,label)=>{const im=new THREE.InstancedMesh(g,material,capacity);im.name=label;im.count=0;im.visible=false;im.frustumCulled=false;im.castShadow=shadows;im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  im.morphTexture=new THREE.DataTexture(new Float32Array(len*capacity),len,capacity,THREE.RedFormat,THREE.FloatType);group.add(im);return im;};
 lib.models.forEach((model,mi)=>later(()=>{if(disposed)return;const g=bakeModel(model,set);if(!g)return;const label=`Baked ${model.name}${set==='walk'?'':' '+set}`;
  const im=mesh(g,label),ims=g.userData.far?[im,mesh(g.userData.far,label+' (far)')]:[im];
  kinds[mi]={im,ims,height:model.height,D:g.userData.walkDuration||1};}));
 let viewer=null,disposed=false;
 return {group,set,
  begin(v){viewer=v||null;for(const k of kinds)if(k)for(const im of k.ims)im.count=0;},
  kindOf:a=>kinds[Math.abs(pick(a)|0)%kinds.length],
  draw(a,look,f0,w0=1,f1=0,w1=0,{y=null,heading=a.heading||0}={}){
   const d=viewer?Math.hypot(a.x-viewer.x,a.z-viewer.z):0;
   if(!Number.isFinite(a.x)||!Number.isFinite(a.z)||d>=range)return false;
   const k=kinds[Math.abs(pick(a)|0)%kinds.length];if(!k)return false;const im=k.ims[d>LOD_NEAR&&k.ims.length>1?1:0];if(im.count>=capacity)return false;
   const idx=im.count++,scale=(look?.height||1.72)/k.height;
   im.setMatrixAt(idx,m.compose(v.set(a.x,y??(a.groundY??.13)+groundAt(a.x,a.z),a.z),q.setFromAxisAngle(UP,heading+Math.PI),sc.setScalar(scale)));
   const row=im.morphTexture.image.data,o=idx*len;row.fill(0,o,o+len);row[o+1+f0]+=w0;if(w1)row[o+1+f1]+=w1;
   return true;},
  end(){for(const k of kinds)if(k)for(const im of k.ims){im.visible=im.count>0;if(im.count){im.instanceMatrix.needsUpdate=true;im.morphTexture.needsUpdate=true;}}},
  dispose(){disposed=true;for(const k of kinds)if(k)for(const im of k.ims){group.remove(im);im.dispose();}}};
}
// The baked crowd of walkers (street-life.js): everyone beyond the rigged few out to `range`, walking (two Walk frames
// either side of each walker's own phase) or standing (Idle). Anyone posed, fallen, talking, running or pushing a pram
// keeps the procedural figure; who is drawn here is returned, so the procedural figure skips them.
export function createBakedCrowd(lib,{range=130,capacity=40,pick=a=>a.id??0,onWalker=null}={}){
 const people=createBakedPeople(lib,{set:'walk',capacity,range,pick,name:'Baked walkers (crowd)'}),phase=new Map(),drawn=new Set();
 return {group:people.group,drawn,
  // as createSkinnedCrowd.update; near: the walkers drawn rigged (skipped here)
  update(dt,viewer,actors,looks=[],near=null){
   drawn.clear();people.begin(viewer);if(!viewer||!actors?.length){people.end();return drawn;}
   for(let i=0;i<actors.length;i++){const a=actors[i],look=looks[i]||{};
    if(!a.edge||a.knockdown||a.conversation||a.playerTaken||a.pose||a.suitcase||a.running||look.accessory==='stroller'||near?.has(a))continue;
    const k=people.kindOf(a);if(!k)continue;
    const scale=(look.height||1.72)/k.height,speed=Math.abs(a.speed||0);let st=phase.get(a);if(!st){st={p:Math.random(),h:a.heading||0};phase.set(a,st);}
    const walking=speed>IDLE;if(walking)st.p=(st.p+dt*THREE.MathUtils.clamp(speed/(1.25*scale),.55,1.7)/k.D)%1;
    st.h=smoothHeading(st,a.heading||0,dt);
    const y=(a.groundY??.13)+groundAt(a.x,a.z),f=st.p*FRAMES,i0=Math.floor(f)%FRAMES,w=f-Math.floor(f);
    if(!(walking?people.draw(a,look,i0,1-w,(i0+1)%FRAMES,w,{y,heading:st.h}):people.draw(a,look,FRAMES,1,0,0,{y,heading:st.h})))continue;
    onWalker?.(a,look,{x:a.x,z:a.z,y,heading:st.h,phase:st.p,walking});
    drawn.add(a);}
   people.end();return drawn;
  },
  dispose(){people.dispose();phase.clear();}};
}
// Cyclists as the characters on their bikes (cyclists.js): the pose at the rider's crank angle, two of CRANK frames blended.
export function drawRider(people,a,look,crank,opts){
 const f=((crank/(Math.PI*2))%1+1)%1*CRANK,i0=Math.floor(f)%CRANK,w=f-Math.floor(f);
 return people.draw(a,look,i0,1-w,(i0+1)%CRANK,w,opts);
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
