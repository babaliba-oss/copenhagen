import * as THREE from 'three';
import {createPersonBatch,personLook,advanceGait,JOINT} from './person-model.js';
import {createRideVehicle,PLAYER_BIKE,PLAYER_SCOOTER} from './player-ride-models.js';
import {groundAt} from './terrain.js';
import {clone as cloneSkinned} from 'three/addons/utils/SkeletonUtils.js';
import {rigOf,measure,pose as poseRig,rideSpec,standSpec,POSE_HEIGHT} from './people-poses.js';

// Footfalls (soundscape.js footsteps): the fractions of a gait cycle at which a foot comes down. footStrikes takes each
// foot's height sampled evenly over one cycle and gives the points where it drops to within `touch` of its lowest;
// strikesCrossed counts those passed going from fraction `from` by `advance` (negative walking backwards).
export function footStrikes(feet,touch=.015){
 const out=[];for(const y of feet){const n=y.length,low=Math.min(...y)+touch;
  for(let i=0;i<n;i++){const a=y[(i+n-1)%n],b=y[i];if(a>low&&b<=low)out.push((((i-1+(a-low)/(a-b))/n)%1+1)%1);}}
 return out.sort((a,b)=>a-b);
}
export function strikesCrossed(from,advance,strikes){
 if(!(Math.abs(advance)>0)||!Number.isFinite(from))return 0;const lo=advance>0?from:from+advance,hi=advance>0?from+advance:from;let n=0;
 for(const s of strikes)for(let k=Math.floor(lo)-1;k<=Math.ceil(hi);k++){const v=s+k;if(advance>0?v>lo&&v<=hi:v>=lo&&v<hi)n++;}
 return n;
}
const TAU=Math.PI*2,PROCEDURAL_STRIKES=[.25,.75]; // person-model.js: a foot's stance starts at gaitPhase pi/2 (left) and 3pi/2 (right)
export function createPlayerTravelRenderer(scene){
 const group=new THREE.Group();group.name='Player and rideable vehicles';scene.add(group);
 const person=createPersonBatch(1,{name:'Player'});group.add(person.group);
 const look=personLook(2026,{height:1.75,coat:0,skirt:false,shirt:'#d65f39',trousers:'#273b4a',age:'adult',accessory:null,phoneWalk:false,stoop:0,outer:'jacket',scarf:null,hairStyle:'short',bagType:'backpack'}),gait={};
 const models=new Map(),ringGeometry=new THREE.RingGeometry(.7,.75,32),ringMaterial=new THREE.MeshBasicMaterial({color:'#eeaa55',transparent:true,opacity:.7,depthWrite:false,side:THREE.DoubleSide});
 const step={key:null,at:0,count:0,running:false}; // footfalls since the soundscape last took them (steps())
 const footfall=(key,at,strikes,running)=>{if(step.key===key)step.count+=strikesCrossed(step.at,((at-step.at+1.5)%1)-.5,strikes);step.key=key;step.at=at;step.running=running;};
 let hand=null; // world position of the right hand, for a carried item (market-shop-renderer.js)
 let rig=null; // the player as a rigged character (skinned-people.js library) once it loads: walking, and riding (posed each frame,
 // people-poses.js); the procedural figure falls and carries
 // paint: [{from:'#47375b',to:'#d65f39',above:.2}] recolours the character's own copy, so the player is not one of the
 // walkers (the crowd uses the same characters): vertex colours equal to `from` (sRGB), above/below a height in the rest pose
 function setRigged(lib,name,paint=[]){
  step.key=null;if(rig){rig.mixer.stopAllAction();rig.root.traverse(o=>{if(o.isMesh&&o.userData.ownGeometry)o.geometry.dispose();});group.remove(rig.root);rig=null;}
  const model=lib?.models.find(m=>m.name===name)||lib?.models[0];if(!model)return;
  const root=cloneSkinned(model.scene),mixer=new THREE.AnimationMixer(root),actions={};
  if(paint.length)root.traverse(o=>{if(!o.isMesh||!o.geometry.attributes.color)return;o.geometry=o.geometry.clone();o.userData.ownGeometry=true;
   const c=o.geometry.attributes.color,y=o.geometry.attributes.position,tmp=new THREE.Color(),rules=paint.map(r=>({...r,f:new THREE.Color(r.from),t:new THREE.Color(r.to)}));
   for(let i=0;i<c.count;i++){tmp.setRGB(c.getX(i),c.getY(i),c.getZ(i));const h=y.getY(i);
    for(const r of rules)if(Math.abs(tmp.r-r.f.r)+Math.abs(tmp.g-r.f.g)+Math.abs(tmp.b-r.f.b)<.01&&(r.above===undefined||h>r.above)&&(r.below===undefined||h<r.below)){c.setXYZ(i,r.t.r,r.t.g,r.t.b);break;}}
   c.needsUpdate=true;});
  for(const k of ['Walk','Run','Idle'])if(model.clips[k])actions[k]=mixer.clipAction(model.clips[k]);
  root.name='Player (rigged)';root.visible=false;group.add(root);rig={root,mixer,actions,state:null,height:model.height,name:model.name,strikes:{}};
  // where the Walk and Run clips put a foot down: each ankle's height over one cycle, 48 samples
  {const bones=rigOf(root),v=new THREE.Vector3();if(bones)for(const k of ['Walk','Run'])if(actions[k]){mixer.stopAllAction();actions[k].play();const d=actions[k].getClip().duration,feet=[[],[]];
   for(let i=0;i<48;i++){mixer.setTime(d*i/48);root.updateMatrixWorld(true);feet[0].push(bones.footL.getWorldPosition(v).y);feet[1].push(bones.footR.getWorldPosition(v).y);}
   rig.strikes[k]=footStrikes(feet);}mixer.stopAllAction();}
  // riding: the Idle pose and the rig's measurements, from which each frame's pose is made
  if(actions.Idle){actions.Idle.play();mixer.setTime(0);root.updateMatrixWorld(true);const bones=rigOf(root);
   if(bones){rig.bones=bones;rig.measure=measure(bones);rig.idle=[];root.traverse(o=>{if(o.isBone)rig.idle.push([o,o.position.clone(),o.quaternion.clone()]);});}mixer.stopAllAction();}
 }
 // the rig on the bike or scooter: the Idle pose put back, the riding pose made at the model's origin, then the whole
 // figure placed with the hip offset turned with it
 function ride(p,actor,mode,bike){
  const r=rig.root;if(rig.state){rig.mixer.stopAllAction();rig.state=null;}
  r.position.set(0,0,0);r.rotation.set(0,0,0);r.scale.setScalar(1);for(const [o,ps,q] of rig.idle){o.position.copy(ps);o.quaternion.copy(q);}r.updateMatrixWorld(true);
  const off=poseRig(r,rig.bones,rig.measure,mode==='cycle'?rideSpec(bike,actor.bike.crank):standSpec(PLAYER_SCOOTER),rig.height/POSE_HEIGHT);
  const k=(look.height||1.75)/rig.height,h=p.heading+Math.PI,c=Math.cos(h),s=Math.sin(h),ox=off.x*k,oz=off.z*k;
  r.position.set(p.x+ox*c+oz*s,actor.groundY+groundAt(p.x,p.z)+off.y*k,p.z-ox*s+oz*c);r.rotation.set(0,h,0);r.scale.setScalar(k);r.updateMatrixWorld(true);
 }
 function play(state){if(rig.state===state)return;const next=rig.actions[state],prev=rig.state&&rig.actions[rig.state];if(!next)return;next.reset().setEffectiveWeight(1).play();if(prev)prev.crossFadeTo(next,.2,false);rig.state=state;}
 return {group,look,hand:()=>hand,steps(){const n=step.count;step.count=0;return {count:n,running:step.running};},setRigged,rigged:()=>rig?.name||null,update(travel,dt,{visible=true,actorVisible=true,hold=null}={}){
  group.visible=visible;if(!travel)return;
  const p=travel.viewActor();
  const current=new Set(travel.rides);
  for(const [id,m] of models)if(!current.has(m.ride)){m.dispose();models.delete(id);}
  for(const ride of travel.rides)if(!models.has(ride.id)){
   const model=createRideVehicle(ride.visual,ride.mode),ring=new THREE.Mesh(ringGeometry,ringMaterial);ring.rotation.x=-Math.PI/2;ring.position.y=.02;model.root.add(ring);group.add(model.root);models.set(ride.id,{...model,ring,ride});
  }
  for(const {root,ring,motion,ride,lift} of models.values()){
   root.visible=Math.hypot(ride.x-p.x,ride.z-p.z)<220;if(!root.visible)continue;
   const q=travel.riding===ride?p:ride;
   root.position.set(q.x,lift+(q.deckY??groundAt(q.x,q.z)),q.z);root.rotation.y=q.heading; // deckY: on a raised deck (terrain.js rideDeck)
   const f=ride.fallen;if(f)f.elapsed=Math.min(1,(f.elapsed||0)+dt*3);root.rotation.z=f?f.side*(Math.PI/2-.12)*f.elapsed*f.elapsed:0; // tipped onto its side after a crash
   motion?.update(ride.distance||0);
   ring.visible=actorVisible&&travel.mode==='walk'&&travel.riding!==ride&&Math.hypot(ride.x-p.x,ride.z-p.z)<3.2;
  }
  person.begin();hand=null;
  if(actorVisible&&travel.mode!=='car'){
   const pose=travel.mode==='walk'?'walk':travel.mode==='bike'?'cycle':'scooter';
   const model=models.get(travel.riding?.id),bike=model?.anchors||PLAYER_BIKE,lift=model?.lift??.12;
   const actor={...p,speed:Math.abs(p.speed),pose,gaitDirection:pose==='walk'&&p.speed<0?-1:1,groundY:(pose==='scooter'?PLAYER_SCOOTER.groundY+lift-.12:pose==='cycle'?lift:.12)+(p.deckY!=null?p.deckY-groundAt(p.x,p.z):0) /* riding a raised deck: its height over the ground beneath */,running:Math.abs(p.speed)>2.5,grip:true,
    bike:{...bike,crank:p.distance*bike.crankPerMetre},scooter:PLAYER_SCOOTER};
   if(pose==='walk'&&hold!==null&&!p.knockdown)actor.hold=hold;
   const rigged=rig&&pose==='walk'&&!p.knockdown&&hold===null,riding=rig?.bones&&pose!=='walk'&&!p.knockdown&&hold===null;if(rig)rig.root.visible=!!(rigged||riding);
   if(riding){ride(p,actor,pose,bike);gait.yaw=undefined;}
   else if(rigged){const k=(look.height||1.75)/rig.height,speed=Math.abs(p.speed||0),state=speed>2.5?'Run':speed>.15?'Walk':'Idle';
    rig.root.position.set(p.x,actor.groundY+groundAt(p.x,p.z),p.z);rig.root.rotation.set(0,p.heading+Math.PI,0);rig.root.scale.setScalar(k); // the model faces +Z, the player's heading 0 faces -Z
    play(state);const act=rig.actions[state];if(act)act.timeScale=state==='Walk'?(p.speed<0?-1:1)*Math.min(1.7,Math.max(.55,speed/(1.25*k))):state==='Run'?Math.min(1.6,Math.max(.7,speed/(3.4*k))):1;
    rig.mixer.update(dt);gait.yaw=undefined;if(act&&state!=='Idle'&&dt>0)footfall(state,act.time/act.getClip().duration,rig.strikes[state]||[],state==='Run');else step.key=null;}
   else{advanceGait(actor,gait,dt,look),person.draw(actor,look,gait);if(pose==='walk'&&!p.knockdown&&dt>0&&actor.speed>.15)footfall('procedural',((gait.gaitPhase/TAU)%1+1)%1,PROCEDURAL_STRIKES,actor.running);else step.key=null;}
   if(pose==='walk'&&!p.knockdown&&!rigged){const J=person.joints,j=JOINT.handR,c=Math.cos(p.heading),s=Math.sin(p.heading),y=actor.groundY+groundAt(p.x,p.z);
    hand={x:p.x+J[j]*c+J[j+2]*s,y:y+J[j+1],z:p.z-J[j]*s+J[j+2]*c,heading:p.heading};}
  }else if(rig)rig.root.visible=false;
  if(!actorVisible||travel.mode!=='walk')step.key=null;
  person.end();
 }};
}

// On a portrait phone (aspect under 1) the view is about 28 degrees across, and at 4.4 m behind the walker their body
// filled the lower middle of the screen over the street ahead (Pixel 7 upright: a quarter of the width, from just under
// the horizon to three quarters down). There the camera stands further back and higher and looks further ahead, up to
// 40% further, 0.6 m higher and 4 m ahead at aspect 0.5 and below; landscape and desktop are unchanged.
export function travelCameraPose(actor,heading,zoom=150,look=0,buildings=null,aspect=0){
 const tall=aspect>0&&aspect<1?Math.min(1,(1-aspect)/.5):0;
 let distance=(2.7+Math.max(36,Math.min(240,zoom))/90)*(1+.4*tall);
 for(let d=.4;buildings&&d<=distance;d+=.2){if(buildings.at(actor.x+Math.sin(heading)*d,actor.z+Math.cos(heading)*d)){distance=Math.max(.35,d-.3);break;}}
 const y=actor.deckY??groundAt(actor.x,actor.z),px=actor.x+Math.sin(heading)*distance,pz=actor.z+Math.cos(heading)*distance;
 const ahead=2+2*tall;return {position:[px,Math.max(y,groundAt(px,pz))+2.5+.6*tall,pz],target:[actor.x-Math.sin(heading+look)*ahead,y+1.2,actor.z-Math.cos(heading+look)*ahead]};
}
