// Arcade two-body crash response for NPC cars (same spirit as the knockable
// bollards): the car that gets hit is shoved and spun, then slides to a stop.
// Equal masses, partly inelastic. Not a tyre model; it only has to look like
// metal moving instead of a wall.
import {carSamples} from './physics.js';
import {inWaterPolygons} from './geo.js';
import {trafficFootprintsOverlap} from './contact-geometry.js';

export const RESTITUTION=.3,FRICTION=6.5,SPIN_FRICTION=2.5,REST_SPEED=.15,REST_RECYCLE_AFTER=30,MIN_KNOCK_SPEED=.05,HALF_WIDTH=.98,HALF_LENGTH=2.36,PUSH_SPEED=2,PUSH_MAX=3,PUSH_HOLD=.15;
const unit=(x,z)=>{const l=Math.hypot(x,z)||1;return [x/l,z/l];};
// A knocked car slides, so its velocity is not along its heading; poses may carry an explicit vx/vz.
const velocity=a=>{if(a.vx!==undefined)return [a.vx,a.vz];const s=a.speed||0;return [-Math.sin(a.heading||0)*s,-Math.cos(a.heading||0)*s];};
// Impulse the player's car gives `npc` when its sweep from `from` to `car`
// contacted it. Returns null when they are moving apart (no real impact).
export function crashImpulse(from,car,npc){
 const [pvx,pvz]=velocity(from),[nvx,nvz]=velocity(npc);
 // Contact normal: from the player towards the other car, pulled towards the
 // player's travel direction so a glancing scrape still pushes it forward.
 const [tx,tz]=unit(pvx,pvz),[cx,cz]=unit(npc.x-car.x,npc.z-car.z),[nx,nz]=unit(cx+tx*.6,cz+tz*.6);
 const closing=(pvx-nvx)*nx+(pvz-nvz)*nz;
 if(closing<MIN_KNOCK_SPEED)return null;
 // Below PUSH_SPEED it is a shove, not a crash: the other car is rolled along at
 // the player's pace (per-frame impulses would never beat its friction and the
 // player would sit against it at a crawl, unable to nudge it out of the way).
 const push=closing<PUSH_SPEED,dv=push?closing:(1+RESTITUTION)/2*closing;
 // The contact point is where the player's centre lands on the other car's
 // footprint (clamped into its box): a corner hit spins it, a square one barely.
 const c=Math.cos(npc.heading||0),s=Math.sin(npc.heading||0),dx=car.x-npc.x,dz=car.z-npc.z;
 const side=Math.max(-HALF_WIDTH,Math.min(HALF_WIDTH,dx*c-dz*s)),along=Math.max(-HALF_LENGTH,Math.min(HALF_LENGTH,dx*s+dz*c));
 const rx=side*c+along*s,rz=-side*s+along*c,lever=rx*nz-rz*nx;
 const spin=Math.max(-3,Math.min(3,-lever*dv*(push?.08:.25)));
 return {nx,nz,dv,spin,closing,push};
}
// Apply the impulse: the NPC leaves its rail and coasts; the player keeps the
// share of speed the impact leaves (not a dead stop against a wall).
export function knockCar(npc,impulse,time){
 const [vx,vz]=velocity(npc);
 const k=npc.knocked={vx:vx+impulse.nx*impulse.dv,vz:vz+impulse.nz*impulse.dv,spin:impulse.spin,at:time,rest:null,pushedAt:impulse.push?time:-Infinity};
 npc.speed=Math.hypot(k.vx,k.vz);npc.braking=!impulse.push;if(!impulse.push)npc.damage=Math.min(1,(npc.damage||0)+impulse.closing/40);
}
export function playerSpeedAfter(from,impulse){
 const [tx,tz]=unit(...velocity(from)),share=Math.max(0,tx*impulse.nx+tz*impulse.nz);
 // Shoving: walking pace at most, and the load costs a little speed.
 const after=impulse.push?Math.min(PUSH_MAX,Math.abs(from.speed)-impulse.dv*share*.1):Math.abs(from.speed)-impulse.dv*share;
 return Math.sign(from.speed||1)*Math.max(0,after);
}
// Integrate a knocked car: slide with friction, turn with the spin, stop at
// buildings and the water's edge. A sliding car that runs into another car
// passes its momentum on through `knock(other,pose)` (a chain of shunts, not a
// ghost through traffic); trams, buses and police cars are solid and bounce it.
// Returns true while it is still moving.
export function stepKnocked(a,dt,world,time,{cars=[],obstacles=[],knock=null}={}){
 const k=a.knocked;if(!k||k.rest!==null)return false;
 const speed=Math.hypot(k.vx,k.vz),pushed=time-k.pushedAt<PUSH_HOLD;
 if(speed<REST_SPEED&&!pushed){k.vx=k.vz=0;k.spin=0;k.rest=time;a.speed=0;a.braking=false;return false;}
 if(!pushed){const decay=Math.max(0,speed-FRICTION*dt)/speed;k.vx*=decay;k.vz*=decay;}
 k.spin=Math.sign(k.spin)*Math.max(0,Math.abs(k.spin)-SPIN_FRICTION*dt);
 const nx=a.x+k.vx*dt,nz=a.z+k.vz*dt,heading=a.heading+k.spin*dt;
 const samples=carSamples({heading},nx,nz);
 const blocked=samples.some(([x,z])=>world.buildings.at(x,z))||samples.some(([x,z])=>!world.roads.at(x,z)&&!world.pavement.at(x,z)&&inWaterPolygons(world.water,x,z));
 if(blocked){k.vx*=-.15;k.vz*=-.15;k.spin*=.3;a.speed=Math.hypot(k.vx,k.vz);return true;}
 const pose={x:nx,z:nz,heading,vx:k.vx,vz:k.vz,speed:Math.hypot(k.vx,k.vz)};
 for(const b of cars){
  if(b===a||!b.edge||b.walking||!trafficFootprintsOverlap(pose,b))continue;
  const impulse=crashImpulse(pose,pose,b);
  if(!impulse)continue; // already separating
  if(knock)knock(b,pose,impulse);
  // Equal masses: what the other car gains, this one loses along the contact normal.
  k.vx-=impulse.nx*impulse.dv;k.vz-=impulse.nz*impulse.dv;k.spin*=.5;a.speed=Math.hypot(k.vx,k.vz);
  return true; // hold position this step; next step the shunted car has moved on
 }
 for(const o of obstacles){
  if(o.edge===null||!trafficFootprintsOverlap(pose,o))continue;
  const [ux,uz]=unit(o.x-nx,o.z-nz);if(k.vx*ux+k.vz*uz<=0)continue; // moving away from it
  k.vx*=-.2;k.vz*=-.2;k.spin*=.3;a.speed=Math.hypot(k.vx,k.vz);return true;
 }
 a.x=nx;a.z=nz;a.heading=heading;a.speed=Math.hypot(k.vx,k.vz);
 return true;
}
