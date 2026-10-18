import * as THREE from 'three';
import {createPersonBatch,advanceGait,personLook} from './person-model.js';
import {groundAt} from './terrain.js';
import {registerEnvMaterial,unregisterEnvMaterial} from './environment.js';

// After the player properly hits a car (not a slow shove), its driver opens the
// driver's door (front left, Finland), climbs out, turns to face the player and shakes
// a hand over their head, the other arm out in a "what are you doing" gesture. Purely cosmetic: no
// collision, no text: body language only. The driver gets back in after a while.
export const ANGRY={delay:.7,door:.45,climb:.9,stay:9,back:.8,close:.4,max:3};
const SEAT_FORWARD=.25,INSIDE=.45,OUTSIDE=1.5,GROUND=.13,DOOR_OPEN=1.1;
// Generic proportions when the renderer cannot tell us the model (tests, unknown actors).
const FALLBACK={spec:{l:4.4,w:1.8,h:1.5,belt:.95},paint:new THREE.Color('#9aa0a0')};
const ease=v=>{v=Math.min(1,Math.max(0,v));return v*v*(3-2*v);};
// The opening door: a shaped, bevelled door (painted skin, dark trim inside, framed window, handle) on a hinge at
// its front edge, plus a dark recess over the car's own (closed) door so the opening reads as a hole into the cabin.
const glassMaterial=new THREE.MeshStandardMaterial({color:'#1b252b',roughness:.1,metalness:.6,side:THREE.DoubleSide}),recessMaterial=new THREE.MeshStandardMaterial({color:'#15191b',roughness:.9}),trimMaterial=new THREE.MeshStandardMaterial({color:'#24272a',roughness:.85,side:THREE.DoubleSide}),handleMaterial=new THREE.MeshStandardMaterial({color:'#b9bcbf',roughness:.3,metalness:.8});
const rounded=(shape,pts,r)=>{const n=pts.length;for(let i=0;i<n;i++){const p=pts[i],a=pts[(i+n-1)%n],b=pts[(i+1)%n],da=Math.hypot(a[0]-p[0],a[1]-p[1]),db=Math.hypot(b[0]-p[0],b[1]-p[1]),k=Math.min(r,da/2,db/2);
 const p1=[p[0]+(a[0]-p[0])/da*k,p[1]+(a[1]-p[1])/da*k],p2=[p[0]+(b[0]-p[0])/db*k,p[1]+(b[1]-p[1])/db*k];if(i===0)shape.moveTo(...p1);else shape.lineTo(...p1);shape.quadraticCurveTo(p[0],p[1],...p2);}shape.closePath();return shape;};
const sideways=g=>g.rotateY(-Math.PI/2); // shape (along the car, up) extruded outward -> hinge frame (x out to the left, y up, z back)
export function createDoor(vehicle){
 const {spec:s,paint}=vehicle,L=s.l/2,W=s.w/2,front=-L+.93,rear=.2,len=rear-front,low=.3,belt=s.belt,top=s.h-.1,T=.05;
 const root=new THREE.Group(),hinge=new THREE.Group(),paintMaterial=vehicle.material?registerEnvMaterial(vehicle.material.clone()):new THREE.MeshStandardMaterial({color:paint,roughness:.35,metalness:.3}); // same clearcoat/reflections as the body
 hinge.position.set(-W-.005,0,front);root.add(hinge);
 // the skin: lower panel and window frame in one outline (the A-pillar leans back), the window cut out of it
 const lean=Math.min(.32,len*.28),outline=[[0,low+.04],[len,low+.04],[len,top-.02],[lean,top-.02],[.02,belt+.02],[0,belt]];
 const win=[[lean+.05,top-.07],[len-.07,top-.07],[len-.07,belt+.04],[.12,belt+.04]];
 const skinShape=rounded(new THREE.Shape(),outline,.07);skinShape.holes.push(rounded(new THREE.Path(),win,.03));
 const skin=new THREE.Mesh(sideways(new THREE.ExtrudeGeometry(skinShape,{depth:T,bevelEnabled:true,bevelThickness:.012,bevelSize:.012,bevelSegments:2,curveSegments:4})).translate(0,0,0),paintMaterial);
 const trimShape=rounded(new THREE.Shape(),[[.05,low+.09],[len-.05,low+.09],[len-.05,belt-.03],[.05,belt-.03]],.05);
 const trim=new THREE.Mesh(sideways(new THREE.ShapeGeometry(trimShape,4)).translate(.008,0,0),trimMaterial); // inside face of the door (dark), just inboard of the skin
 const glass=new THREE.Mesh(sideways(new THREE.ShapeGeometry(rounded(new THREE.Shape(),win,.03),4)).translate(-T*.5,0,0),glassMaterial);
 const handle=new THREE.Mesh(new THREE.BoxGeometry(.03,.035,.16),handleMaterial);handle.position.set(-T-.02,belt-.13,len-.22);
 hinge.add(skin,trim,glass,handle);
 const recess=new THREE.Mesh(new THREE.BoxGeometry(.04,top-low-.04,len-.06),recessMaterial);recess.position.set(-W+.01,(top+low)/2,(front+rear)/2);root.add(recess);
 for(const m of [skin,glass,handle])m.castShadow=true;
 return {root,hinge,recess,dispose(){unregisterEnvMaterial(paintMaterial);paintMaterial.dispose();for(const m of [skin,trim,glass,handle,recess])m.geometry.dispose();}};
}
export function createAngryDrivers({vehicleOf=null}={}){
 const group=new THREE.Group();group.name='Angry drivers';
 const batch=createPersonBatch(ANGRY.max,{name:'Angry drivers'});group.add(batch.group);
 const drivers=[];let count=0;
 // Called when the player's car really hits `car` (an NPC from mobility).
 function trigger(car,time){
  const old=drivers.find(d=>d.car===car);if(old){old.angry=Math.max(old.angry,time);return old;} // hit again: stays out longer
  if(drivers.length>=ANGRY.max)remove(drivers.reduce((a,b)=>a.hit<b.hit?a:b));
  const seed=count++,d={car,hit:time,angry:time,start:null,look:personLook(car.id*31+seed*7),gait:{},actor:{x:car.x,z:car.z,heading:car.heading,speed:0,pose:'wave',groundY:GROUND},seed};
  drivers.push(d);return d;
 }
 function remove(d){drivers.splice(drivers.indexOf(d),1);if(d.door){group.remove(d.door.root);d.door.dispose();}}
 function update(dt,time,player){
  batch.begin(player);
  for(const d of [...drivers]){
   const k=d.car.knocked;
   // Recycled or claimed cars no longer own this old roadside animation.
   if(!k||d.car.playerTaken||d.car.edge===null){remove(d);continue;}
   // Climb out once the car has stopped (or shortly after the hit if it keeps creeping).
   if(d.start===null){if(k.rest===null&&time-d.hit<ANGRY.delay+1.5)continue;if(time-d.hit<ANGRY.delay)continue;
    const h=d.car.heading,lx=-Math.cos(h),lz=Math.sin(h),fx=-Math.sin(h),fz=-Math.cos(h);
    d.start=time;d.seat={x:d.car.x+fx*SEAT_FORWARD,z:d.car.z+fz*SEAT_FORWARD,lx,lz,out:Math.atan2(-lx,-lz)};
    d.door=createDoor(vehicleOf?.(d.car)||FALLBACK);d.door.root.position.set(d.car.x,.12+groundAt(d.car.x,d.car.z),d.car.z);d.door.root.rotation.y=h;group.add(d.door.root);}
   // Timeline: door swings open, driver climbs out, gestures; later climbs back in and pulls the door shut.
   const t=time-d.start,leave=Math.max(d.angry-d.hit,0)+ANGRY.stay+ANGRY.door+ANGRY.climb,back=t>leave?(t-leave)/ANGRY.back:0;
   if(back>=1+ANGRY.close/ANGRY.back){remove(d);continue;}
   const open=back>1?1-ease((back-1)*ANGRY.back/ANGRY.close):ease(t/ANGRY.door);
   d.door.hinge.rotation.y=-DOOR_OPEN*open*(1-.04*Math.sin(Math.min(1,t/ANGRY.door)*Math.PI*3)*(1-Math.min(1,t/ANGRY.door)));d.door.recess.visible=open>.02;
   const e=ease((t-ANGRY.door*.6)/ANGRY.climb)*(1-ease(back)),r=INSIDE+(OUTSIDE-INSIDE)*e,a=d.actor;
   if(back>=1){continue;} // back in the seat, door closing
   const px=a.x,pz=a.z;a.x=d.seat.x+d.seat.lx*r;a.z=d.seat.z+d.seat.lz*r;a.speed=dt>0?Math.min(1.4,Math.hypot(a.x-px,a.z-pz)/dt*1.5):0;
   // Sits low in the seat, ducks under the roof line and stands up as they step out.
   a.groundY=GROUND-.75*(1-e);
   // Swing the legs out first (face the door), then turn to the player once standing.
   const want=e<.75?d.seat.out:Math.atan2(-(player.x-a.x),-(player.z-a.z));let dh=want-a.heading;dh=Math.atan2(Math.sin(dh),Math.cos(dh));a.heading+=dh*Math.min(1,dt*(e<.75?10:6));
   a.pose=e>.8&&back===0?'wave':'chat';
   advanceGait(a,d.gait,dt,d.look);batch.draw(a,d.look,d.gait,time);
  }
  batch.end();group.visible=drivers.length>0;
 }
 return {group,trigger,update,snapshot:()=>drivers.map(d=>({x:d.actor.x,z:d.actor.z,out:d.start!==null,pose:d.actor.pose,door:d.door?+(-d.door.hinge.rotation.y/DOOR_OPEN).toFixed(2):0}))};
}
