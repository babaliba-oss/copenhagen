import {sweptContact} from './contact-geometry.js';
import {playerSpeedAfter} from './crash-physics.js';
import {PIVOT} from './impact-pose.js';

// Non-graphic reactions to hitting people, game-like but physically grounded:
// what happens depends on the collision energy between the hitter (its mass
// and speed) and a 75 kg person. A light touch is a stumble and an angry
// gesture; a medium hit knocks the person down to roll over and get up slowly;
// a fast car throws them over the bonnet and along the road, tumbling under
// gravity with ground friction until they lie still. Nobody is injured on
// screen: they get up, dust off and walk back to their path.
// Swept contact prevents tunnelling; one impact event is emitted per contact.
export const DAMAGE_RATE={building:.0015,transit:.0009,vehicle:.00035,pedestrian:.00045,cyclist:.00045};
export const PEDESTRIAN_MASS=75;
// Mass (kg) of whatever hits a person: cars, traffic, police, buses and trams;
// the light hitters are a bike or e-scooter with its rider and a person on foot.
export const HITTER_MASS={car:1500,traffic:1400,police:1800,bus:13000,tram:40000,bicycle:95,scooter:90,walker:75};
// Collision energy (J, in the centre-of-mass frame) where a stumble becomes a
// knock-down and a knock-down a throw. Light hitters push harder before anyone
// goes down and never throw anybody.
export const SEVERITY={stumble:160,thrown:1100,lightStumble:300};
export const GRAVITY=9.81,GROUND_FRICTION=7,BOUNCE=.22,GET_UP=1.6,WALK_BACK=1.5;
// Police heat equivalent of each outcome (police.js incidentHeat 'pedestrian').
export const SEVERITY_REPORT={stumble:2,down:6,thrown:12};

// `gentle`: a bump that never knocks anyone down (the player walking into someone).
export function impactSeverity(hitter='car',speed=0,{mass,gentle=false}={}){
 const M=mass??HITTER_MASS[hitter]??HITTER_MASS.car,m=PEDESTRIAN_MASS,v=Math.abs(speed),mu=M*m/(M+m),energy=.5*mu*v*v,light=M<200;
 const level=gentle||energy<(light?SEVERITY.lightStumble:SEVERITY.stumble)?'stumble':energy<SEVERITY.thrown||light?'down':'thrown';
 // The person leaves with part of the hitter's momentum; the hitter keeps the rest.
 const share=M/(M+m);
 const out=level==='stumble'?Math.min(1.5,.4+v*share*.35):level==='down'?Math.min(4.5,v*share*.55):Math.min(15,v*share*.68);
 const lift=level==='thrown'?Math.min(5.5,1.2+v*.22):level==='down'?Math.min(1.8,.5+v*.12):0;
 // Seconds lying still before getting up: longer after a harder hit.
 const lie=level==='stumble'?0:level==='down'?Math.min(7,2.5+energy/450):Math.min(18,7+energy/2200);
 const vehicleSpeed=Math.max(0,v*(M-m*.35)/(M+m));
 return {hitter,mass:M,speed:v,energy,level,out,lift,lie,vehicleSpeed,riderFalls:light&&hitter!=='walker'&&v>3};
}

// Start the tumble: velocity along the hitter's motion, deflected to the side
// the person was struck on (a glancing hit sends them off sideways).
export function startKnockdown(actor,hitter,severity,time=0){
 const hv=[-Math.sin(hitter.heading||0),-Math.cos(hitter.heading||0)],sign=Math.sign(hitter.speed||1),dx=actor.x-hitter.x,dz=actor.z-hitter.z;
 const side=dx*-hv[1]+dz*hv[0],aside=severity.level==='thrown'?.35:severity.level==='down'?.75:1.1,s=Math.sign(side)||1;
 let ux=hv[0]*sign+(-hv[1])*s*aside,uz=hv[1]*sign+hv[0]*s*aside;const l=Math.hypot(ux,uz)||1;ux/=l;uz/=l;
 const level=severity.level;
 const body={x:actor.x,y:PIVOT,z:actor.z,vx:ux*severity.out,vy:severity.lift,vz:uz*severity.out,heading:Math.atan2(-ux,-uz),pitch:0,roll:0,
  // Thrown: legs swept, the body rotates back over the bonnet and keeps rolling; knocked down: falls the way it is pushed.
  wp:level==='thrown'?2+severity.speed*.35:level==='down'?-3.2:-.6,wr:level==='thrown'?s*(.8+severity.speed*.08):level==='down'?s*.9:0};
 actor.knockdown={elapsed:.001,duration:Infinity,level,phase:level==='stumble'?'stagger':'flight',phaseTime:0,body,lie:severity.lie,anchor:{x:actor.x,z:actor.z},
  side:s,prone:level!=='stumble',severity:{level,energy:Math.round(severity.energy),hitter:severity.hitter},walk:0,start:time,prevPose:actor.pose};
 actor.speed=0;actor.running=false;
 return actor.knockdown;
}
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const toward=(v,target,rate,dt)=>v+(target-v)*(1-Math.exp(-rate*dt));
// Nearest lying orientation (face down, on the back or on a side) to the current tumble.
function lyingTarget(b){
 const p=wrap(b.pitch),r=wrap(b.roll),q=Math.PI/2;
 if(Math.abs(Math.sin(p))>=Math.abs(Math.sin(r)))return {pitch:Math.sign(p||1)*q,roll:0};
 return {pitch:0,roll:Math.sign(r||1)*q};
}
// One physics step of a knocked actor. Returns false when the knock-down is over.
export function stepKnockdown(actor,dt,world=null){
 const k=actor.knockdown,b=k.body;k.elapsed+=dt;k.phaseTime+=dt;actor.speed=0;actor.running=false;
 const blocked=(x,z)=>!!world?.buildings?.at(x,z);
 const move=()=>{const nx=b.x+b.vx*dt,nz=b.z+b.vz*dt;if(blocked(nx,nz)){b.vx*=-.25;b.vz*=-.25;b.wp*=.5;b.wr*=.5;}else{b.x=nx;b.z=nz;}};
 if(k.phase==='stagger'){
  // Pushed back a step or two, leaning back, then an angry gesture at the driver.
  move();const f=Math.exp(-dt*2.5);b.vx*=f;b.vz*=f;b.pitch=toward(b.pitch,k.phaseTime<.35?.22:0,9,dt);
  if(k.phaseTime>.7){k.phase='gesture';k.phaseTime=0;actor.pose='wave';}
  return true;
 }
 if(k.phase==='gesture'){b.pitch=toward(b.pitch,0,6,dt);if(k.phaseTime>2.2){actor.pose=k.prevPose;k.phase='return';k.phaseTime=0;}return true;}
 if(k.phase==='flight'){
  b.vy-=GRAVITY*dt;b.y+=b.vy*dt;move();b.pitch+=b.wp*dt;b.roll+=b.wr*dt;
  const lying=1-Math.abs(Math.cos(b.pitch)*Math.cos(b.roll)),floor=.16+(PIVOT-.16)*(1-lying);
  if(b.y<=floor){
   b.y=floor;if(b.vy<0)b.vy=-b.vy*BOUNCE;if(b.vy<.6)b.vy=0;
   // Sliding and rolling on the ground: friction takes the speed off, the tumble settles flat.
   const h=Math.hypot(b.vx,b.vz),d=Math.min(h,GROUND_FRICTION*dt*(1+lying));if(h>1e-6){b.vx-=b.vx/h*d;b.vz-=b.vz/h*d;}
   b.wp*=Math.exp(-dt*3);b.wr*=Math.exp(-dt*3);
   if(lying>.25||k.phaseTime>.5){const t=lyingTarget(b);b.pitch=wrap(b.pitch);b.roll=wrap(b.roll);b.pitch=toward(b.pitch,t.pitch,5,dt);b.roll=toward(b.roll,t.roll,5,dt);}
   if(h<.12&&b.vy===0&&lying>.9){k.phase='rest';k.phaseTime=0;b.vx=b.vz=0;}
  }
  if(k.phaseTime>12){k.phase='rest';k.phaseTime=0;b.vx=b.vz=b.vy=0;b.y=.16;}
  return true;
 }
 if(k.phase==='rest'){const t=lyingTarget(b);b.pitch=toward(b.pitch,t.pitch,4,dt);b.roll=toward(b.roll,t.roll,4,dt);b.y=toward(b.y,.16,6,dt);if(k.phaseTime>=k.lie){k.phase='rise';k.phaseTime=0;k.from={pitch:b.pitch,roll:b.roll,y:b.y};}return true;}
 if(k.phase==='rise'){
  // Roll over, push up, stand: orientation back to upright, pelvis back up.
  const t=Math.min(1,k.phaseTime/GET_UP),e=t*t*(3-2*t);
  b.pitch=k.from.pitch*(1-e);b.roll=k.from.roll*(1-e);b.y=k.from.y+(PIVOT-k.from.y)*Math.min(1,e*1.15);
  if(t>=1){k.phase='return';k.phaseTime=0;b.pitch=b.roll=0;b.y=PIVOT;}
  return true;
 }
 if(k.phase==='return'){
  // Walk back to the path (the spot the walker was taken from), then carry on.
  const dx=k.anchor.x-b.x,dz=k.anchor.z-b.z,d=Math.hypot(dx,dz);
  if(d<.12){k.walk=0;b.x=k.anchor.x;b.z=k.anchor.z;b.heading+=wrap((actor.heading||0)-b.heading)*Math.min(1,dt*8);
   return Math.abs(wrap((actor.heading||0)-b.heading))>.05&&k.phaseTime<6;}
  b.heading+=wrap(Math.atan2(-dx,-dz)-b.heading)*Math.min(1,dt*6);
  const step=Math.min(d,WALK_BACK*dt*Math.min(1,k.phaseTime*2));b.x+=dx/d*step;b.z+=dz/d*step;k.walk=step/Math.max(dt,1e-6);
  return true;
 }
 return false;
}

export class ImpactSystem{
 constructor(){this.time=0;this.contacts=new Map();this.actors=new Set();this.events=0;this.world=null;this.hits=[];}
 reset(){for(const a of this.actors){if(a.knockdown?.phase==='gesture')a.pose=a.knockdown.prevPose;a.knockdown=undefined;a.impactCooldown=undefined;}this.actors.clear();this.contacts.clear();this.events=0;this.time=0;this.hits=[];}
 step(dt,world=this.world){
  this.time+=dt;
  for(const a of this.actors){
   if(a.knockdown){
    if(a.knockdown.body){if(!stepKnockdown(a,dt,world)){a.knockdown=undefined;a.impactCooldown=this.time+2;}continue;}
    a.knockdown.elapsed+=dt;a.speed=0;a.running=false;
    if(a.knockdown.elapsed>=a.knockdown.duration){a.knockdown=undefined;a.impactCooldown=this.time+2;}
   }else if(this.time>=a.impactCooldown){
    a.impactCooldown=undefined;this.actors.delete(a);
   }
  }
  for(const [id,t]of this.contacts)if(this.time-t>3)this.contacts.delete(id);
 }
 damage(car,speed,kind='vehicle',target=null){
  if(speed<2)return;
  const key=kind==='building'?'building':`${kind}:${target?.id??'static'}`;
  const last=this.contacts.get(key)??-Infinity;this.contacts.set(key,this.time);if(this.time-last<1)return;
  // Per (m/s)^2. Traffic crashes crumple panels but are softer than hitting a
  // wall; hitting a person is still punished by police rather than by damage.
  const rate=DAMAGE_RATE[kind]??DAMAGE_RATE.building;if(kind==='vehicle'&&speed<3)return;
  const amount=Math.min(kind==='vehicle'?.25:.38,speed*speed*rate);
  car.damage=Math.min(1,(car.damage||0)+amount);car.damageVersion=(car.damageVersion||0)+1;
  let side=car.speed<0?'rear':'front';
  if(target){const dx=target.x-car.x,dz=target.z-car.z,c=Math.cos(car.heading),s=Math.sin(car.heading),x=dx*c-dz*s,z=dx*s+dz*c;side=Math.abs(x)>Math.abs(z)*.7?(x>0?'right':'left'):z>0?'rear':'front';}
  car.damageZones??={front:0,rear:0,left:0,right:0};car.damageZones[side]=Math.min(1,car.damageZones[side]+amount*2);this.events++;
 }
 // Any hitter knocking a person: `hitter` {x,z,heading,speed} with `kind`
 // (a HITTER_MASS key) or an explicit `mass`. Reports to the police scaled by
 // severity and tells listeners (crowd reactions). Returns the severity or null.
 hit(actor,hitter,{kind='car',mass,gentle,police=null,label='pedestrian'}={}){
  if(actor.knockdown||this.time<(actor.impactCooldown||0))return null;
  const severity=impactSeverity(kind,hitter.speed,{mass,gentle});if(severity.speed<.6)return null;
  startKnockdown(actor,hitter,severity,this.time);this.actors.add(actor);
  police?.report('pedestrian',`${label}:${actor.id}`,SEVERITY_REPORT[severity.level]);
  const event={actor,severity,hitter:{x:hitter.x,z:hitter.z,heading:hitter.heading,speed:hitter.speed},kind,time:this.time};
  this.hits.push(event);if(this.hits.length>20)this.hits.shift();this.onHit?.(event);
  return severity;
 }
 collide(from,car,people,cyclists,vehicles,police,{kind='car',mass}={}){
  const impactSpeed=Math.max(Math.abs(from.speed),Math.abs(car.speed));
  if(Math.hypot(car.x-from.x,car.z-from.z)<1e-9&&Math.abs(car.heading-from.heading)<1e-9)return;
  const stop=()=>{car.x=from.x;car.z=from.z;car.heading=from.heading;car.speed=0;};
  for(const [label,actors]of [['pedestrian',people],['cyclist',cyclists]])for(const a of actors){
   if(a.edge===null)continue;
   const k=a.knockdown;
   // Someone lying on the road (or getting up) is solid: the car stops instead of driving over them.
   if(k?.body){if(k.phase==='flight'||k.phase==='stagger')continue;const b=k.body,p={x:b.x,z:b.z,heading:b.heading};
    if(Math.hypot(p.x-car.x,p.z-car.z)<=Math.hypot(car.x-from.x,car.z-from.z)+6&&sweptContact(from,car,p,true))stop();continue;}
   if(Math.hypot(a.x-car.x,a.z-car.z)>Math.hypot(car.x-from.x,car.z-from.z)+6||!sweptContact(from,car,a,true))continue;
   if(!k&&this.time>=(a.impactCooldown||0)&&impactSpeed>=1.2){
    const severity=this.hit(a,{x:from.x,z:from.z,heading:from.heading,speed:from.speed||car.speed},{kind,mass,police,label});
    this.damage(car,impactSpeed,label,a);
    // Momentum: a car loses a little speed and drives on past a person it knocked down or threw; a touch stops it.
    if(severity&&severity.level!=='stumble'){car.speed=Math.sign(car.speed||from.speed)*Math.min(Math.abs(car.speed),severity.vehicleSpeed);continue;}
   }
   stop();
  }
  for(const a of vehicles){
   if(a.edge===null||Math.hypot(a.x-car.x,a.z-car.z)>Math.hypot(car.x-from.x,car.z-from.z)+9||!sweptContact(from,car,a))continue;
   this.damage(car,impactSpeed,'vehicle',a);car.x=from.x;car.z=from.z;car.heading=from.heading;
   // Both cars take the hit: the other one is shoved off its rail (crash-physics.js) and the player keeps
   // whatever speed the impact leaves, instead of stopping dead as against a wall.
   const impulse=this.onVehicleHit?.(from,car,a);
   if(impulse)car.speed=playerSpeedAfter(from,impulse);else{car.speed=0;a.speed=0;}
  }
 }
 // People down or getting up, as obstacles that traffic brakes for (mobility externalObstacles).
 obstacles(){const out=[];for(const a of this.actors){const k=a.knockdown;if(k?.body&&k.phase!=='return'&&k.phase!=='gesture')out.push({id:`down-${a.id}`,x:k.body.x,z:k.body.z,heading:k.body.heading,halfWidth:.55,halfLength:1,speed:0});}return out;}
 snapshot(){return {events:this.events,fallen:[...this.actors].filter(a=>a.knockdown).map(a=>({id:a.id,x:a.x,z:a.z,elapsed:a.knockdown.elapsed,level:a.knockdown.level,phase:a.knockdown.phase,body:a.knockdown.body&&{x:+a.knockdown.body.x.toFixed(2),y:+a.knockdown.body.y.toFixed(2),z:+a.knockdown.body.z.toFixed(2)}})),
  hits:this.hits.slice(-5).map(h=>({id:h.actor.id,level:h.severity.level,energy:Math.round(h.severity.energy),kind:h.kind}))};}
}
