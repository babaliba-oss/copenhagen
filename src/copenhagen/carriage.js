import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {gaitMaterial,gaitDepthMaterial,horseGeometry,wheelGeometry,stepMotion,withAttributes} from './gait.js';
import {MeshoptSimplifier} from 'meshoptimizer';
import {WEATHER_UNIFORMS} from '../weather.js';
let simplifier=null;MeshoptSimplifier.ready.then(()=>{simplifier=MeshoptSimplifier;}).catch(()=>{});

// A two-horse town coach for Copenhagen 1760, swapped in for the player's car (same physics, forward is -Z).
// Procedural geometry, vertex-coloured: lacquered body with gilt trim, coachman's box, big rear wheels,
// a pair of horses in harness. The legs swing with speed (update).
const paint=(g,hex)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();n.deleteAttribute('uv');const c=new THREE.Color(hex),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));return n;};
const box=(w,h,d,x,y,z,hex,rx=0)=>paint(new THREE.BoxGeometry(w,h,d).rotateX(rx).translate(x,y,z),hex);
const cyl=(r0,r1,h,x,y,z,hex,seg=8,rz=0,rx=0)=>paint(new THREE.CylinderGeometry(r0,r1,h,seg).rotateZ(rz).rotateX(rx).translate(x,y,z),hex);

function wheel(r,x,z,hex='#3a2a1c'){
 const parts=[paint(new THREE.TorusGeometry(r,.035,5,22).rotateY(Math.PI/2).translate(x,r,z),'#1d1a17'),cyl(.07,.07,.14,x,r,z,'#b08a3c',8,Math.PI/2)];
 for(let i=0;i<10;i++)parts.push(paint(new THREE.CylinderGeometry(.014,.014,r*2-.04,4).rotateX(i*Math.PI/10).translate(x,r,z),hex));
 return parts;
}
// A horse from rounded parts (capsule body, chest and rump, tapered neck, long head with muzzle and ears,
// mane, tail, collar). Legs are separate so they can swing (see createCarriage).
const sph=(r,x,y,z,hex,sx=1,sy=1,sz=1)=>paint(new THREE.SphereGeometry(r,12,9).scale(sx,sy,sz).translate(x,y,z),hex);
const cap=(r,l,x,y,z,hex,rx=0,sx=1)=>paint(new THREE.CapsuleGeometry(r,l,5,10).rotateX(rx).scale(sx,1,1).translate(x,y,z),hex);
function horse(x,z,coat){
 const dark='#1e1712',muzzle='#2a221c';
 const body=[cap(.31,.95,x,1.33,z,coat,Math.PI/2,.88),sph(.34,x,1.37,z-.6,coat,.85,1,.95),sph(.35,x,1.39,z+.58,coat,.9,.95,1),
  paint(new THREE.CylinderGeometry(.15,.25,.9,10).rotateX(-.62).translate(x,1.8,z-.93),coat),
  cap(.12,.42,x,2.0,z-1.33,coat,1.15),sph(.11,x,1.86,z-1.55,muzzle,.9,.85,1.1),
  paint(new THREE.ConeGeometry(.045,.14,5).translate(x-.06,2.27,z-1.2),coat),paint(new THREE.ConeGeometry(.045,.14,5).translate(x+.06,2.27,z-1.2),coat),
  box(.05,.6,.1,x,1.95,z-.88,dark,-.62), // mane
  paint(new THREE.CylinderGeometry(.04,.11,.8,6).rotateX(.3).translate(x,1.12,z+1.02),dark), // tail
  paint(new THREE.TorusGeometry(.25,.055,6,14).rotateX(-.95).translate(x,1.64,z-.76),'#2b1d14'), // collar
  box(.56,.06,.5,x,1.68,z-.05,'#2b1d14'),box(.6,.05,.08,x,1.3,z-.05,'#2b1d14')]; // pad and girth
 return {body,legs:[[x-.15,z-.58],[x+.15,z-.58],[x-.15,z+.6],[x+.15,z+.6]]};
}
// One leg: forearm, cannon, fetlock and a dark hoof, hanging from a pivot 1.05 m up.
function legGeometry(coat){
 return mergeGeometries([paint(new THREE.CylinderGeometry(.075,.055,.52,8).translate(0,-.26,0),coat),paint(new THREE.CylinderGeometry(.045,.042,.42,7).translate(0,-.73,0),coat),
  sph(.055,0,-.95,0,coat),paint(new THREE.CylinderGeometry(.055,.065,.09,8).translate(0,-1.005,0),'#1b1714')]);
}

// Blender coach and horse body (scripts/blender/carriage.py): {coach: geometry, horse: parts} once loaded.
let MODELS=null,ARMOURED=null,BROUGHAM=null,COACHMAN=null;
export function setCarriageModels(models){MODELS=models?.coach&&models?.horse?models:null;ARMOURED=models?.armoured?.geometry?models.armoured:null;BROUGHAM=models?.brougham?.geometry?models.brougham:null;COACHMAN=models?.coachman?.geometry?models.coachman:null;}
// With the armoured horse (gait.js) the coach and its pair are one geometry, all animated in the vertex shader from one
// per-instance `motion` (phase, swing, roll): the black town coach with a crown on the door (brougham.glb, textured; the
// Blender coach when it is missing) with its wheels marked to turn, a pole, the coachman on the box and two horses that trot.
const COACH_WHEELS=[{x:.82,y:.62,z:1.1,r:.62},{x:-.82,y:.62,z:1.1,r:.62},{x:.72,y:.44,z:-.945,r:.44},{x:-.72,y:.44,z:-.945,r:.44}];
const flat=g=>g.index?g.toNonIndexed():g.clone();
function coachman([x,y,z]){
 if(COACHMAN)return flat(COACHMAN.geometry).translate(x,y,z);
 return mergeGeometries([box(.42,.55,.3,0,.3,0,'#3a2c45'),box(.26,.26,.24,0,.72,0,'#d9b49a'),box(.36,.12,.36,0,.89,0,'#141414'),box(.42,.04,.42,0,.83,0,'#141414'),box(.36,.14,.5,0,.05,-.2,'#2a2433')]).translate(x,y,z);
}
function gaitCoach(){
 if(!ARMOURED||!(BROUGHAM||MODELS))return null;
 const near=horseGeometry(ARMOURED.geometry,ARMOURED.pivots,{x:-.62,z:-3.25}),off=horseGeometry(ARMOURED.geometry,ARMOURED.pivots,{x:.62,z:-3.25,coat:.55,offset:.9});
 const coloured=gaitMaterial(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.62,metalness:.05}));
 if(!BROUGHAM){const coach=wheelGeometry(flat(MODELS.coach),COACH_WHEELS),g=mergeGeometries([coach,near,off].map(x=>withAttributes(x,{uv:false})));[coach,near,off].forEach(x=>x.dispose());return {geometry:g,materials:coloured};}
 const e=BROUGHAM.extras,body=withAttributes(wheelGeometry(flat(BROUGHAM.geometry),e.wheels.map(w=>({...w,dx:.1}))));
 const tip=-4.05,from=(e.poleEnd??-2)+.25,pole=paint(new THREE.CylinderGeometry(.04,.055,from-tip,8).rotateX(Math.PI/2).translate(0,.96,(from+tip)/2),'#2a1d14');
 const seat=e.box||[0,1.34,-.35],parts=[body,...[near,off,pole,coachman(COACHMAN?[0,seat[1]-.2,seat[2]+.05]:seat)].map(x=>withAttributes(x))],g=mergeGeometries(parts,true);parts.forEach(x=>x.dispose()); /* the coachman model's origin is at his soles, under his hips; his thighs rest 0.2 m above it */
 for(const grp of g.groups)grp.materialIndex=grp.materialIndex===0?0:1;
 return {geometry:g,materials:[gaitMaterial(new THREE.MeshStandardMaterial({map:BROUGHAM.texture,roughness:.42,metalness:.15})),coloured]};
}
// The far coach: the same model at about a quarter of its 38,000 triangles (the coachman alone is 15,700), for the
// coaches beyond COACH_NEAR. Each material group is welded on position, uv, colour and gait data (normals are not
// compared, or the flat-shaded parts would have nothing to collapse) and simplified on its own; the kept vertices
// carry their gait attributes, so the horses still trot. Null until the simplifier is ready.
export const COACH_NEAR=50;
export function farCoachGeometry(g,ratio=.25){
 if(!simplifier||g.index)return null;
 const at=g.attributes,keys=['position','uv','color','anim','pivot'].filter(k=>at[k]),n=at.position.count,seen=new Map(),remap=new Uint32Array(n),rep=[];
 for(let i=0;i<n;i++){let k='';for(const a of keys){const A=at[a];for(let c=0;c<A.itemSize;c++)k+=A.array[i*A.itemSize+c].toFixed(4)+',';}let r=seen.get(k);if(r===undefined){seen.set(k,r=rep.length);rep.push(i);}remap[i]=r;}
 const pos=new Float32Array(rep.length*3);rep.forEach((v,j)=>{pos[j*3]=at.position.array[v*3];pos[j*3+1]=at.position.array[v*3+1];pos[j*3+2]=at.position.array[v*3+2];});
 const out=new THREE.BufferGeometry(),index=[];
 for(const [k,a] of Object.entries(at)){if(a.isInstancedBufferAttribute)continue;const s=a.itemSize,arr=new a.array.constructor(rep.length*s);rep.forEach((v,j)=>{for(let c=0;c<s;c++)arr[j*s+c]=a.array[v*s+c];});out.setAttribute(k,new THREE.BufferAttribute(arr,s,a.normalized));}
 for(const grp of (g.groups.length?g.groups:[{start:0,count:n,materialIndex:0}])){const idx=new Uint32Array(grp.count);for(let i=0;i<grp.count;i++)idx[i]=remap[grp.start+i];
  const [cut]=simplifier.simplify(idx,pos,3,Math.max(3,Math.floor(grp.count*ratio/3)*3),.02,[]);out.addGroup(index.length,cut.length,grp.materialIndex);for(const v of cut)index.push(v);}
 out.setIndex(index);out.computeBoundingSphere();return out;
}
// Coach lanterns: where the brougham's cab starts behind the box seat (extras.box), its vertices above the seat's height
// plus 0.45 m (the cab's front face, under the roof), and how wide the cab is there; a lantern on each front corner,
// 8 cm out from the side, at 74% of the coach's height. Without the brougham, the procedural coach's own lantern posts.
export function lanternSpots(geometry,box){
 const p=geometry?.attributes?.position;if(!p||!box)return [[-.78,1.95,-.25],[.78,1.95,-.25]];
 let top=-Infinity,front=Infinity,side=0;for(let i=0;i<p.count;i++)top=Math.max(top,p.getY(i));
 for(let i=0;i<p.count;i++)if(p.getY(i)>box[1]+.45&&p.getZ(i)>box[2])front=Math.min(front,p.getZ(i));
 for(let i=0;i<p.count;i++){const y=p.getY(i),z=p.getZ(i);if(y>top*.55&&y<top*.85&&z>=front&&z<front+.4)side=Math.max(side,Math.abs(p.getX(i)));}
 return [-1,1].map(k=>[k*(side+.08),top*.74,front+.1]);
}
// Two lanterns at `spots` (the coach's frame): a black lamp body with a brass cap and a glass that glows warm after dark
// (weather.js night, as the car's headlights), and a faint warm pool on the road around the front of the coach (vertex
// colours fading out, added: no texture, no scene light). update() lights them; a candle's flicker in the pool.
function coachLanterns(spots){
 const g=new THREE.Group();g.name='Coach lanterns';
 const body=mergeGeometries(spots.flatMap(([x,y,z])=>[box(.13,.03,.13,x,y-.075,z,'#1b1714'),paint(new THREE.ConeGeometry(.095,.08,4).rotateY(Math.PI/4).translate(x,y+.1,z),'#1b1714'),cyl(.02,.02,.05,x,y+.16,z,'#a8843e',6),box(.03,.03,.1,x-Math.sign(x)*.06,y,z,'#1b1714')]));
 const lamps=new THREE.Mesh(body,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.5,metalness:.4}));lamps.name='Coach lantern bodies';
 const glassMat=new THREE.MeshStandardMaterial({color:'#d9cfae',roughness:.15,metalness:0,emissive:'#ffb45a',emissiveIntensity:0});
 const glass=new THREE.Mesh(mergeGeometries(spots.map(([x,y,z])=>new THREE.BoxGeometry(.1,.12,.1).translate(x,y,z))),glassMat);glass.name='Coach lantern glass';
 const disc=new THREE.CircleGeometry(1,28).rotateX(-Math.PI/2),n=disc.attributes.position.count,col=new Float32Array(n*3),warm=new THREE.Color('#ffa04a');
 for(let i=0;i<n;i++){const r=Math.hypot(disc.attributes.position.getX(i),disc.attributes.position.getZ(i)),k=Math.max(0,1-r)**1.5;col.set([warm.r*k,warm.g*k,warm.b*k],i*3);}
 disc.setAttribute('color',new THREE.BufferAttribute(col,3));
 const front=Math.min(...spots.map(s=>s[2])),poolMat=new THREE.MeshBasicMaterial({vertexColors:true,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-4});
 const pool=new THREE.Mesh(disc,poolMat);pool.name='Coach lantern light';pool.scale.set(Math.abs(spots[0][0])+1.6,1,2.6);pool.position.set(0,.22,front-1.2);pool.renderOrder=2;
 for(const m of [lamps,glass,pool])m.castShadow=false;g.add(lamps,glass,pool);
 let t=0;
 g.userData.update=dt=>{const night=Math.max(0,Math.min(1,(WEATHER_UNIFORMS.night.value-.5)*4));pool.visible=night>0;t+=dt||0;
  const flicker=.92+.05*Math.sin(t*13.1)+.03*Math.sin(t*31.7+1.3);glassMat.emissiveIntensity=2.4*night*flicker;poolMat.opacity=.34*night*flicker;};
 g.userData.update(0);return g;
}
function gaitMesh({geometry,materials},count){
 const motion=new THREE.InstancedBufferAttribute(new Float32Array(count*3),3);motion.setUsage(THREE.DynamicDrawUsage);geometry.setAttribute('motion',motion);
 const mesh=new THREE.InstancedMesh(geometry,materials,count);
 mesh.customDepthMaterial=gaitDepthMaterial();mesh.castShadow=true;mesh.frustumCulled=false;return {mesh,motion};
}
export function createCarriage({lanterns=true}={}){ // lanterns: the player's coach lights two after dark (coachLanterns)
 const group=new THREE.Group();group.name='Coach and horses';
 const gait=gaitCoach(),lamps=lanterns?coachLanterns(gait&&BROUGHAM?lanternSpots(BROUGHAM.geometry,BROUGHAM.extras.box||[0,1.34,-.35]):lanternSpots(null)):null;if(lamps)group.add(lamps);
 if(gait){const {mesh,motion}=gaitMesh(gait,1),m={phase:0,amp:0,roll:0};mesh.setMatrixAt(0,new THREE.Matrix4());mesh.name='Coach and pair';group.add(mesh);
  group.userData.update=(speed,dt)=>{stepMotion(m,speed,dt);motion.setXYZ(0,m.phase,m.amp,m.roll);motion.needsUpdate=true;lamps?.userData.update(dt);};
  return group;}
 const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,metalness:.12});
 const lacquer='#1f3a2c',gilt='#c19a45',dark='#16120e';
 const parts=MODELS?[MODELS.coach.clone(),...[[-.62,'#5b3a24'],[.62,'#2e2520']].map(([x,c])=>MODELS.bake(MODELS.horse,{coat:c}).translate(x,0,-3.25))]:[
  box(1.42,1.15,2.0,0,1.38,.45,lacquer),box(1.5,.08,2.12,0,2.0,.45,dark),box(1.3,.06,1.9,0,2.06,.45,'#24201b'), // body, roof
  box(1.44,.05,2.02,0,1.84,.45,gilt),box(1.44,.05,2.02,0,.84,.45,gilt), // gilt bands
  box(1.46,.5,.7,0,1.5,.45,'#0e1418'), // windows
  box(.04,.95,.02,.73,1.33,.12,gilt),box(.04,.95,.02,-.73,1.33,.12,gilt),box(.04,.95,.02,.73,1.33,.78,gilt),box(.04,.95,.02,-.73,1.33,.78,gilt),
  box(1.0,.5,.55,0,1.25,-.95,lacquer),box(1.05,.08,.6,0,1.52,-.95,dark),box(1.0,.35,.06,0,1.72,-.7,dark), // coachman's box
  box(1.6,.06,.08,0,.62,1.1,dark),box(1.4,.06,.08,0,.5,-.95,dark), // axles' beds
  cyl(.06,.06,.18,.78,1.95,-.25,'#e9d7a0',6),cyl(.06,.06,.18,-.78,1.95,-.25,'#e9d7a0',6), // lanterns
  ...wheel(.62,.82,1.1),...wheel(.62,-.82,1.1),...wheel(.44,.72,-.95),...wheel(.44,-.72,-.95),
  box(.07,.07,3.2,0,.95,-2.6,dark), // pole between the horses
  ...[[-.62,'#5b3a24'],[.62,'#2e2520']].flatMap(([x,c])=>horse(x,-3.25,c).body),
 ];
 // Coachman
 if(!MODELS)parts.push(box(.42,.55,.3,0,1.85,-.98,'#3a2c45'),box(.26,.26,.24,0,2.27,-.98,'#d9b49a'),box(.36,.12,.36,0,2.44,-.98,'#141414'),box(.42,.04,.42,0,2.38,-.98,'#141414'));
 // The body as a one-instance gait mesh whose wheels turn in the vertex shader (wheelGeometry), as on the loaded models: they stood still
 let merged=mergeGeometries(parts);parts.forEach(g=>g.dispose());if(merged.index){const n=merged.toNonIndexed();merged.dispose();merged=n;}
 const body=gaitMesh({geometry:wheelGeometry(merged,COACH_WHEELS),materials:gaitMaterial(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,metalness:.12}))},1),roll={phase:0,amp:0,roll:0};
 body.mesh.setMatrixAt(0,new THREE.Matrix4());body.mesh.name='Coach body';group.add(body.mesh);
 // Legs swing about a pivot at the shoulder/hip, 1.05 m up: one instanced batch per horse (2 draws, not 8).
 const legs=[],batches=[],pose=new THREE.Matrix4();
 for(const [x,c] of [[-.62,'#5b3a24'],[.62,'#2e2520']]){const at=horse(x,-3.25,c).legs,batch=new THREE.InstancedMesh(legGeometry(c),mat,at.length);batch.name='Horse legs';batch.castShadow=true;batch.frustumCulled=false;batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(batch);batches.push(batch);
  at.forEach(([lx,lz],k)=>legs.push({batch,k,x:lx,z:lz}));}
 const swing=(phase,amp)=>{legs.forEach((l,i)=>l.batch.setMatrixAt(l.k,pose.makeRotationX(Math.sin(phase+(i%2?Math.PI:0)+(i>3?.6:0))*amp).setPosition(l.x,1.05,l.z)));for(const b of batches)b.instanceMatrix.needsUpdate=true;};
 swing(0,0);let phase=0;
 group.userData.update=(speed,dt)=>{const v=Math.min(Math.abs(speed),14);phase+=dt*v*1.4;swing(phase,Math.min(.55,v*.08));stepMotion(roll,speed,dt);body.motion.setXYZ(0,0,0,roll.roll);body.motion.needsUpdate=true;lamps?.userData.update(dt);}; // the wheels roll as the loaded coach's do, capped at ROLL_SPEED (gait.js)
 return group;
}

// NPC coaches for 1760 traffic: the coach and horse bodies as one merged geometry instanced over the mobility cars,
// and the horses' legs as two instanced batches (one per coat) that swing with each coach's own pace, so a coach
// at rest stands still and a moving one walks or trots instead of sliding along with frozen legs.
export const COACH_RANGE=350; // metres from the camera: farther coaches are a few pixels
export const COACH_HALF_LENGTH=3.4,COACH_HALF_WIDTH=.95; // horses' noses to the rear wheels, about 6.6 m (traffic spacing)
export function createCarriageTraffic(actors){
 const gait=gaitCoach();
 if(gait){const count=Math.max(1,actors.length),{mesh,motion}=gaitMesh(gait,count);mesh.name='Coaches';const group=new THREE.Group();group.name='Coach traffic';group.add(mesh);
  const m4=new THREE.Matrix4(),ahead=new THREE.Matrix4().makeTranslation(0,0,1.2),q=new THREE.Quaternion(),v=new THREE.Vector3(),one=new THREE.Vector3(1,1,1),zero=new THREE.Vector3(0,0,0),UP=new THREE.Vector3(0,1,0);
  const states=Array.from({length:count},(_,i)=>({phase:i*1.7,amp:0,roll:i*3.3}));
  const EU=new THREE.Euler(0,0,0,'YXZ'),PITCH_REACH=2.2; // heading, then pitch (as the player's coach)
  // Only the coaches within RANGE of the camera are drawn, packed to the front of the batch: every coach (a full
  // horse-and-carriage model) used to go through the main and shadow passes, the ones a kilometre off and the ones
  // parked out of play at scale 0 included: 1.6M of the 5.4M triangles of a 1760 frame.
  // Beyond COACH_NEAR, the simplified coach (farCoachGeometry), made once the simplifier is ready.
  let far=null;const lod=()=>{if(far!==null||!simplifier)return far;const g=farCoachGeometry(gait.geometry);if(!g){far=false;return far;}
   const f=gaitMesh({geometry:g,materials:gait.materials},count);f.mesh.name='Coaches (far)';f.mesh.count=0;group.add(f.mesh);far=f;return far;};
  return {group,update(groundAt,dt=1/60,focus=null){let n=0,nf=0;const f=lod();actors.forEach((a,i)=>{if(i>=count)return;const on=!!a.edge&&!a.playerTaken;
    const s=stepMotion(states[i],on?a.speed||0:0,dt),d=focus?Math.hypot((a.x||0)-focus.x,(a.z||0)-focus.z):0;if(!on||d>COACH_RANGE)return;
    const x=a.x||0,z=a.z||0,h=a.heading||0,fx=Math.sin(h)*PITCH_REACH,fz=Math.cos(h)*PITCH_REACH,fr=groundAt(x-fx,z-fz),bk=groundAt(x+fx,z+fz); /* pitched to the ground under the horses and the rear wheels: level, a coach on a rampart slope or a bridge ramp had its horses in the bank (up to 2.3 m) */
    m4.compose(v.set(x,Math.max(groundAt(x,z),(fr+bk)/2),z),q.setFromEuler(EU.set(Math.atan2(fr-bk,2*PITCH_REACH),h,0)),one).multiply(ahead);
    if(f&&d>COACH_NEAR){f.mesh.setMatrixAt(nf,m4);f.motion.setXYZ(nf,s.phase,s.amp,s.roll);nf++;}else{mesh.setMatrixAt(n,m4);motion.setXYZ(n,s.phase,s.amp,s.roll);n++;}});
   mesh.count=n;mesh.instanceMatrix.needsUpdate=true;motion.needsUpdate=true;if(f){f.mesh.count=nf;f.mesh.instanceMatrix.needsUpdate=true;f.motion.needsUpdate=true;}}};}
 const c=createCarriage({lanterns:false}),bodyGeo=c.getObjectByName('Coach body').geometry.clone();bodyGeo.deleteAttribute('motion'); // the coach body with its turning wheels (createCarriage); placed 1.2 m ahead per coach, as the gait coaches are
 const shared=new Set();c.traverse(o=>{if(o.isMesh){shared.add(o.geometry);shared.add(o.material);}});shared.forEach(x=>x.dispose());
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,metalness:.12}),count=Math.max(1,actors.length);
 const {mesh,motion}=gaitMesh({geometry:bodyGeo,materials:gaitMaterial(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.55,metalness:.12}))},count);mesh.name='Coaches';const ahead=new THREE.Matrix4().makeTranslation(0,0,1.2),body=new THREE.Matrix4(),rolls=Array.from({length:count},(_,i)=>({phase:0,amp:0,roll:i*3.3}));
 const group=new THREE.Group();group.name='Coach traffic';group.add(mesh);
 const horses=[[-.62,'#5b3a24'],[.62,'#2e2520']].map(([x,coat])=>{const legs=horse(x,-3.25,coat).legs.map(([lx,lz])=>[lx,lz+1.2]),batch=new THREE.InstancedMesh(legGeometry(coat),material,count*legs.length);
  batch.name='Coach horse legs';batch.castShadow=true;batch.frustumCulled=false;batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);group.add(batch);return {legs,batch};});
 const m4=new THREE.Matrix4(),leg=new THREE.Matrix4(),swing=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),one=new THREE.Vector3(1,1,1),zero=new THREE.Vector3(0,0,0),UP=new THREE.Vector3(0,1,0);
 const phase=new Float32Array(count);
 return {group,update(groundAt,dt=1/60){actors.forEach((a,i)=>{const on=!!a.edge&&!a.playerTaken;m4.compose(v.set(a.x||0,on?groundAt(a.x,a.z):-100,a.z||0),q.setFromAxisAngle(UP,a.heading||0),on?one:zero);mesh.setMatrixAt(i,body.multiplyMatrices(m4,ahead));motion.setXYZ(i,0,0,stepMotion(rolls[i],on?a.speed||0:0,dt).roll);
   const speed=Math.min(Math.abs(a.speed||0),14);phase[i]+=dt*speed*1.4;const amp=Math.min(.55,speed*.08);
   for(const {legs,batch} of horses)legs.forEach(([lx,lz],k)=>{swing.makeRotationX(Math.sin(phase[i]+(k%2?Math.PI:0)+(k>1?.6:0))*amp).setPosition(lx,1.05,lz);batch.setMatrixAt(i*legs.length+k,leg.multiplyMatrices(m4,swing));});});
  mesh.instanceMatrix.needsUpdate=true;motion.needsUpdate=true;for(const {batch} of horses)batch.instanceMatrix.needsUpdate=true;}};
}
