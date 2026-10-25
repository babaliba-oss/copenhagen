import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {clone} from 'three/addons/utils/SkeletonUtils.js';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
const {bakeModel,createBakedPeople,drawRider}=await import('../src/skinned-people.js');
await (await import('meshoptimizer')).MeshoptSimplifier.ready;
const {rigOf,measure,pose,RIDE,SIT,POSE_HEIGHT}=await import('../src/people-poses.js');

const load=f=>new Promise((res,rej)=>{const b=gunzipSync(readFileSync('public/models/people/'+f));new GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',res,rej);});
async function model(name){
 const rig=name.startsWith('W_')?'_w':name.startsWith('R_')?'_r':'',[g,a]=await Promise.all([load(name+'.glb.gz'),load(`anims${rig}.glb.gz`)]);
 const box=new THREE.Box3().setFromObject(g.scene);return {name,scene:g.scene,clips:Object.fromEntries(a.animations.map(c=>[c.name,c])),height:Math.min(1.87,box.max.y-box.min.y)};
}
const models=await Promise.all(['M_Suit','W_Dress','R_CoolMan'].map(model));
const idle=m=>{const root=clone(m.scene),mixer=new THREE.AnimationMixer(root);mixer.clipAction(m.clips.Idle).play();mixer.setTime(0);root.updateMatrixWorld(true);return root;};
const at=b=>b.getWorldPosition(new THREE.Vector3());

test('on the bike, both rigs sit on the saddle with their feet on the pedals all the way round', () => {
 for(const m of models){
  const s=m.height/POSE_HEIGHT;
  for(const a of [0,1.3,Math.PI,4.4]){
   const root=idle(m),bones=rigOf(root);assert.ok(bones,`${m.name}: the rig is recognised`);
   const off=pose(root,bones,measure(bones),{...RIDE,crank:{...RIDE.crank,a}},s);
   const hips=at(bones.thighL).add(at(bones.thighR)).multiplyScalar(.5).add(off);
   assert.ok(hips.distanceTo(new THREE.Vector3(0,RIDE.hipY*s,RIDE.hipZ*s))<.01,`${m.name}: hips on the saddle`);
   [0,1].forEach(i=>{const c=RIDE.crank,ang=a+i*Math.PI,want=new THREE.Vector3((i?-1:1)*c.x*s,(c.y+Math.cos(ang)*c.r+.08)*s,(c.z+Math.sin(ang)*c.r-.05)*s);
    const foot=at(i?bones.footR:bones.footL).add(off);assert.ok(foot.distanceTo(want)<.03,`${m.name} crank ${a}: ${i?'right':'left'} ankle ${foot.toArray().map(v=>v.toFixed(2))} by its pedal ${want.toArray().map(v=>v.toFixed(2))}`);});
   const reach=[bones.handL,bones.handR].map((h,i)=>at(h).add(off).distanceTo(new THREE.Vector3((i?-1:1)*RIDE.hands[i][0]*s,RIDE.hands[i][1]*s,RIDE.hands[i][2]*s)));
   assert.ok(Math.max(...reach)<.09,`${m.name}: hands at the grips (${reach.map(v=>v.toFixed(3))})`);
  }
 }
});

test('at the café table the feet rest on the ground under it', () => {
 for(const m of models){
  const s=m.height/POSE_HEIGHT,root=idle(m),bones=rigOf(root),off=pose(root,bones,measure(bones),SIT,s);
  for(const [b,f] of [[bones.footL,SIT.feet[0]],[bones.footR,SIT.feet[1]]])assert.ok(at(b).add(off).y<(f[1]+.03)*s,`${m.name}: foot down`);
  assert.ok(Math.abs(at(bones.thighL).add(off).y-SIT.hipY*s)<.01);
 }
});

test('a model is baked once per set: 13 walking frames (Idle last), 8 round the crank, 1 seated', () => {
 const m=models[0],walk=bakeModel(m,'walk'),ride=bakeModel(m,'ride'),sit=bakeModel(m,'sit');
 assert.equal(walk.morphAttributes.position.length,13);assert.equal(ride.morphAttributes.position.length,8);assert.equal(sit.morphAttributes.position.length,1);
 assert.equal(bakeModel(m,'ride'),ride,'cached');
 const far=walk.userData.far;assert.ok(far,'a far version');assert.ok(far.index.count<walk.index.count*.45,`${far.index.count/3} of ${walk.index.count/3} triangles far off`);
 assert.equal(far.attributes.position,walk.attributes.position,'sharing the vertices');assert.equal(far.morphAttributes.position,walk.morphAttributes.position,'and the frames');
 const n=ride.attributes.position.count;assert.ok(ride.morphAttributes.position.every(f=>f.count===n));
 // the frames differ round the crank (the legs move) but not above the waist
 const a=ride.morphAttributes.position[0].array,b=ride.morphAttributes.position[4].array;let moved=0,top=0;
 for(let i=0;i<n;i++){const d=Math.hypot(a[i*3]-b[i*3],a[i*3+1]-b[i*3+1],a[i*3+2]-b[i*3+2]);if(d>.05)moved++;if(a[i*3+1]>1.35&&d>.01)top++;}
 assert.ok(moved>50,`${moved} vertices move with the pedals`);assert.equal(top,0,'the upper body stays put');
});

test('a renderer draws within its range, one instance per person, and says so when it cannot', async () => {
 const lib={models};
 const people=createBakedPeople(lib,{set:'ride',capacity:2,range:50,pick:a=>a.m});
 await new Promise(r=>setTimeout(r,400)); // baked from the shared queue, one model per tick
 people.begin({x:0,z:0});
 assert.equal(drawRider(people,{x:3,z:4,m:0},{height:1.74},1.2),true);
 assert.equal(drawRider(people,{x:60,z:0,m:0},{height:1.74},1.2),false,'beyond the range');
 assert.equal(drawRider(people,{x:NaN,z:0,m:0},{height:1.74},1.2),false,'nowhere');
 assert.equal(drawRider(people,{x:1,z:1,m:0},{height:1.74},2),true);
 assert.equal(drawRider(people,{x:2,z:1,m:0},{height:1.74},2),false,'full');
 people.end();
 const im=people.group.children.find(o=>o.name==='Baked M_Suit ride');assert.equal(im.count,2,'both near: the full model');assert.ok(im.visible);
 const row=im.morphTexture.image.data.slice(0,9);assert.ok(Math.abs(row.reduce((s,v)=>s+v,0)-1)<1e-6,'two frames blended to one');
 people.dispose();
});

test("the player's own bike: the feet go round on its pedals, which turn forward with the wheels", async () => {
 const {addBicycleMotion,PLAYER_BIKE}=await import('../src/player-ride-models.js');
 const {rideSpec}=await import('../src/people-poses.js');
 const bike=new THREE.Group(),motion=addBicycleMotion(bike,PLAYER_BIKE),m=models[0],k=1.75/m.height;
 for(const distance of [0,.4,1.1,2.3]){
  motion.update(distance);bike.updateMatrixWorld(true);
  const root=idle(m),bones=rigOf(root),off=pose(root,bones,measure(bones),rideSpec(PLAYER_BIKE,distance*PLAYER_BIKE.crankPerMetre),m.height/POSE_HEIGHT);
  motion.pedals.forEach((pedal,side)=>{const p=pedal.getWorldPosition(new THREE.Vector3()),inModel=new THREE.Vector3(-p.x,p.y,-p.z); // the bike faces -Z, the model +Z
   const ankle=at(side?bones.footR:bones.footL).add(off).multiplyScalar(k); // the bike's side 0 (x < 0 facing -Z) is the left foot
   assert.ok(ankle.distanceTo(inModel)<.13,`distance ${distance}: ankle ${ankle.toArray().map(v=>v.toFixed(2))} over pedal ${inModel.toArray().map(v=>v.toFixed(2))}`);});
 }
 // forward: as the bike rolls on, the top of the crank circle moves ahead (-Z), like the tops of the wheels
 motion.update(0);const z0=motion.pedals[0].getWorldPosition(new THREE.Vector3()).z;motion.update(.05);const z1=motion.pedals[0].getWorldPosition(new THREE.Vector3()).z;
 const top=motion.pedals[0].getWorldPosition(new THREE.Vector3()).y>PLAYER_BIKE.crankY;assert.ok(top&&z1<z0,'the top pedal moves forward'); // side 0 starts at the top
});

test('the instanced crowds draw their people as the characters once the models are set: standing, seated, walking', async () => {
 const {createInstancedPeople,setBakedPeople}=await import('../src/market-life.js');
 setBakedPeople({models},{range:90});
 const crowd=createInstancedPeople([{x:1,z:1,heading:0,pose:'chat',walking:false},{x:3,z:2,seated:true,heading:1,pose:'cycle',walking:false},{x:5,z:-2,heading:2,pose:'walk'},{x:200,z:0,heading:0,pose:'chat',walking:false}],{name:'Test crowd',safe:()=>true});
 crowd.update(.1,{x:0,z:0});
 await new Promise(r=>setTimeout(r,900)); // baked from the shared queue, one model per tick
 for(let i=0;i<5;i++)crowd.update(.1,{x:0,z:0});
 const drawn=[];crowd.group.traverse(o=>{if(o.isInstancedMesh&&/^Baked /.test(o.name)&&o.count)drawn.push(`${o.name} ${o.count}`);});
 assert.equal(drawn.reduce((s,d)=>s+ +d.split(' ').pop(),0),3,`three near people as models (${drawn}), the far one procedural`);
 assert.ok(drawn.some(d=>/ sit \d/.test(d)),'the seated guest on its chair');
 const baked=()=>{const l=[];crowd.group.traverse(o=>{if(o.isInstancedMesh&&/^Baked /.test(o.name))l.push(o);});return l;},kept=baked();
 crowd.update(.1,{x:700,z:0});assert.equal(baked().length,kept.length,'just out of sight (650 m): the models stay');
 crowd.update(.1,{x:900,z:0});assert.equal(baked().length,0,'far away: the models go (a long drive passed dozens of crowds, each kept ~30 meshes)');assert.ok(kept.every(o=>o.morphTexture===null),'their GPU data freed');
 crowd.update(.1,{x:0,z:0});await new Promise(r=>setTimeout(r,100));crowd.update(.1,{x:0,z:0});assert.equal(baked().length,kept.length,'back again: rebuilt from the shared bakes');
 setBakedPeople(null);crowd.update(.1,{x:0,z:0});
 const left=[];crowd.group.traverse(o=>{if(o.isInstancedMesh&&/^Baked /.test(o.name))left.push(o.name);});assert.equal(left.length,0,'models dropped when unset');
});

test('a standing figure (H.C. Andersen) keeps his feet under him, wherever he stands and faces', async () => {
 const {createRiggedFigure}=await import('../src/skinned-people.js');
 const hca=await model('R_HCA'),fig=createRiggedFigure(hca,{height:1.85,stand:true});
 for(const [x,z,heading] of [[0,0,0],[892.8,38.5,2.1]]){
  for(let i=0;i<20;i++)fig.update(1/30,{x,z,heading,speed:0});
  fig.root.updateMatrixWorld(true);const bones=rigOf(fig.root),feet=[bones.footL,bones.footR].map(at),hips=at(bones.thighL).add(at(bones.thighR)).multiplyScalar(.5);
  for(const f of feet)assert.ok(Math.hypot(f.x-hips.x,f.z-hips.z)<.22,`foot ${f.x.toFixed(2)},${f.z.toFixed(2)} under the hips ${hips.x.toFixed(2)},${hips.z.toFixed(2)}`);
  assert.ok(Math.hypot(hips.x-x,hips.z-z)<.15,'standing where he is');assert.ok(feet.every(f=>f.y<fig.root.position.y+.22),'ankles just above the ground');
 }
});
