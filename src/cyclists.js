import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {prepareGraph,routePoint} from './mobility.js';
import {SpatialIndex} from './geo.js';
import {surfaceId} from './harbour-layout.js';
import {applyImpactPose} from './impact-pose.js';
import {createPersonBatch,personLook} from './person-model.js';
import {drawRider} from './skinned-people.js';
import {groundAt} from './terrain.js';

// Centreline checked against dedicated municipal cycle polygons 41192/42153.
// No cyclist route is inferred from the car or pedestrian network.
export const HARBOUR_CYCLE_PATH=[[253.5,977.8],[249.3,968.7],[247.1,960.4],[245.6,953.7],[244.2,948],[242.2,941.6],[237.1,927.66],[231,914.47],[226.77,906.68],[215.44,889.57],[157.7,811.5],[73.7,698],[64.4,682.9],[56.95,668]];
export class Cyclists{
 constructor(data,count=8){
  this.path=prepareGraph({nodes:[HARBOUR_CYCLE_PATH[0],HARBOUR_CYCLE_PATH.at(-1)],edges:[{from:0,to:1,points:HARBOUR_CYCLE_PATH,lane:0}]}).edges[0];
  this.surfaces=new SpatialIndex(data.pavement.filter(p=>[41192,42153].includes(surfaceId(p))));
  this.riders=Array.from({length:count},(_,id)=>({id,travelMode:'bike',halfWidth:.34,halfLength:.9,s:22+id*(this.path.length-44)/count,direction:id%2?1:-1,speed:0,cruise:3.7+id%3*.45,phase:id,wait:0}));
  this.step(0,{x:-1e6,z:-1e6});
  this.rideSources=this.riders.map(actor=>({id:`cyclist-bike:${actor.id}`,mode:'bike',label:'Bicycle',actor,visual:{kind:'bicycle',color:'#caa72b',lift:.1},
   canClaim:()=>!actor.playerTaken&&!actor.knockdown&&Number.isFinite(actor.x)&&Number.isFinite(actor.z)&&Math.abs(actor.speed)<=1.2,
   claim(){if(!this.canClaim())return false;actor.playerTaken=true;actor.speed=0;return true;},
   release(){if(!actor.playerTaken)return false;delete actor.playerTaken;actor.speed=0;return true;},
  }));
 }
 point(r,s=r.s){const p=routePoint(this.path,s,.16*r.direction);if(r.direction<0)p.heading+=Math.PI;return p;}
 step(dt,player){
  for(const r of this.riders){
   if(r.playerTaken){r.speed=0;continue;}
   if(r.knockdown){r.speed=0;continue;}
   if(r.wait>0){r.wait=Math.max(0,r.wait-dt);r.speed=0;continue;}
   const p=this.point(r),ahead=this.point(r,Math.max(0,Math.min(this.path.length,r.s+r.direction*4)));
   const blocked=Math.hypot(ahead.x-player.x,ahead.z-player.z)<3.3||Math.hypot(p.x-player.x,p.z-player.z)<2;
   r.speed+=Math.max(-5*dt,Math.min(1.8*dt,(blocked?0:r.cruise)-r.speed));
   const s=Math.max(1,Math.min(this.path.length-1,r.s+r.direction*r.speed*dt)),q=this.point(r,s);
   if(this.surfaces.at(q.x,q.z)){r.s=s;Object.assign(r,q);}else r.speed=0;
   r.phase+=r.speed*dt*2.2;
   if(r.s<=1||r.s>=this.path.length-1){r.direction*=-1;r.wait=1.2;}
  }
 }
 snapshot(){return this.riders.filter(r=>!r.playerTaken).map(({id,x,z,heading,speed})=>({id,x,z,heading,speed,onCycleway:!!this.surfaces.at(x,z)}));}
}

export function createCyclistRenderer(scene,sim){
 const group=new THREE.Group();group.name='Cyclists on dedicated harbour cycleway';scene.add(group);
 const mats={frame:new THREE.MeshStandardMaterial({color:'#ffffff',roughness:.5,metalness:.3}),dark:new THREE.MeshStandardMaterial({color:'#25312f',roughness:.9}),metal:new THREE.MeshStandardMaterial({color:'#9aa9aa',roughness:.38,metalness:.6})};
 const parts=new Map();
 function tube(a,b,r,mat){const av=new THREE.Vector3(...a),bv=new THREE.Vector3(...b),d=bv.clone().sub(av),g=new THREE.CylinderGeometry(r,r,d.length(),6);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()));g.translate(...av.add(bv).multiplyScalar(.5).toArray());if(!parts.has(mat))parts.set(mat,[]);parts.get(mat).push(g.toNonIndexed());}
 // Saddle height fits a ~1.75 m rider whose foot reaches the pedal at the bottom of the stroke.
 const front=[0,.37,-.61],rear=[0,.37,.61],crank=[0,.36,.08],seat=[0,.86,.25],head=[0,.94,-.43];
 for(const [a,b] of [[rear,seat],[rear,crank],[seat,crank],[crank,head],[head,seat],[head,front]])tube(a,b,.027,'frame');
 tube(head,[0,1.17,-.46],.024,'metal');tube([-.13,1.17,-.46],[.13,1.17,-.46],.027,'dark');for(const sx of [-1,1])tube([sx*.13,1.17,-.46],[sx*.27,1.15,-.31],.027,'dark'); /* a city bike's swept-back bar */tube([0,.85,.25],[0,.93,.26],.022,'metal');tube([0,.96,.14],[0,.96,.36],.05,'dark');
 const count=sim.riders.length,tmp=new THREE.Object3D(),specs=[];
 function batch(geometry,mat,pose){const mesh=new THREE.InstancedMesh(geometry,mats[mat],count);mesh.castShadow=true;mesh.frustumCulled=false;group.add(mesh);specs.push({mesh,pose});return mesh;}
 const FRAMES=['#caa72b','#1d1f22','#e8e6df','#2d4f7a','#7a2a20','#3f5d45','#9aa0a6','#c8202a','#e0b4c0','#1f6f6a'];
 for(const [mat,gs] of parts){const m=batch(mergeGeometries(gs),mat,()=>[0,0,0,0,0]);if(mat==='frame'){const c=new THREE.Color();for(let i=0;i<count;i++)m.setColorAt(i,c.set(FRAMES[(i*7+3)%FRAMES.length]));}gs.forEach(g=>g.dispose());}
 const tire=new THREE.TorusGeometry(.335,.032,6,20);tire.rotateY(Math.PI/2);
 const rim=new THREE.TorusGeometry(.293,.011,4,20);rim.rotateY(Math.PI/2);
 for(const z of [-.61,.61]){batch(tire,'dark',r=>[0,.37,z,r.phase,0]);batch(rim,'metal',r=>[0,.37,z,r.phase,0]);}
 // Riders use the shared articulated person: hips on the saddle, feet on the pedals, hands on the bar.
 const riders=createPersonBatch(count,{name:'Cyclist riders'});group.add(riders.group);
 const looks=sim.riders.map(r=>personLook(9001+r.id*17,{height:1.72+r.id%4*.04,coat:0,skirt:false,bagType:r.id%3===0?'backpack':null,hairStyle:r.id%4===3?'short':'beanie',hat:['#e8e6df','#2a2d33','#c23b33','#3a5a6a'][r.id%4]}));
 let baked=null;
 const actors=sim.riders.map((r,i)=>({rider:i,x:0,z:0,heading:0,speed:0,pose:'cycle',groundY:.10,bike:{hipY:1.06,hipZ:.2,crankY:.36,crankZ:.08,crankR:.17,crank:0,barX:.27,barY:1.15,barZ:-.32}}));
 return {group,update(player){
  const level=r=>r.deckY??groundAt(r.x,r.z); // up on a raised deck (city-cyclists.js deckY: the deck's surface under the rider) or on the ground
  sim.riders.forEach((r,i)=>{const y0=level(r);for(const {mesh,pose} of specs){const [x,y,z,rx]=pose(r),c=Math.cos(r.heading),s=Math.sin(r.heading);tmp.position.set(r.x+x*c+z*s,y+.10+y0,r.z-x*s+z*c);tmp.rotation.set(rx,r.heading,0,'YXZ');tmp.scale.setScalar(!r.playerTaken&&Math.hypot(r.x-player.x,r.z-player.z)<420?1:0);tmp.updateMatrix();mesh.setMatrixAt(i,tmp.matrix);if(r.knockdown&&!r.playerTaken)applyImpactPose(mesh,i,r);}});
  specs.forEach(({mesh})=>mesh.instanceMatrix.needsUpdate=true);
  riders.begin();baked?.begin(player);
  sim.riders.forEach((r,i)=>{if(r.playerTaken||Math.hypot(r.x-player.x,r.z-player.z)>=420)return;const a=actors[i];a.x=r.x;a.z=r.z;a.heading=r.heading;a.speed=r.speed;a.knockdown=r.knockdown;a.bike.crank=r.phase*.42;const y0=level(r);a.groundY=.10+y0-groundAt(a.x,a.z);
   if(!a.knockdown&&baked&&drawRider(baked,a,looks[i],a.bike.crank,{y:.10+y0,heading:a.heading}))return; // the character model on the bike
   riders.draw(a,looks[i],a);});
  riders.end();baked?.end();
 },
 // the characters on the bikes (skinned-people.js createBakedPeople, set 'ride'); the procedural rider where they cannot be
 setBaked(people){if(baked)group.remove(baked.group);baked=people;if(people)group.add(people.group);}};
}
