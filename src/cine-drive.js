import {routePoint} from './mobility.js';

// The trailer's hero drive (?cinematic, cinematic.js): the player's car (a coach in 1760) drives itself along the road
// graph, the way traffic does, so a camera can track it through the real streets. It starts on the lane nearest `from`
// heading towards `toward`, and at each junction takes the road that best keeps it going towards `toward` (straight on
// once it is there), slowing for sharp turns. Kinematic: the car is placed, not simulated, so nothing it meets slows it.
const unit=(x,z)=>{const l=Math.hypot(x,z)||1;return [x/l,z/l];};
const startDir=e=>unit(e.points[1][0]-e.points[0][0],e.points[1][1]-e.points[0][1]);
const endDir=e=>{const n=e.points.length;return unit(e.points[n-1][0]-e.points[n-2][0],e.points[n-1][1]-e.points[n-2][1]);};
const angle=(a,b)=>Math.acos(Math.max(-1,Math.min(1,a[0]*b[0]+a[1]*b[1])));

// The lane point nearest (x,z) whose direction heads towards `toward` (any direction when there is none).
export function placeOnRoads(roads,[x,z],toward=null){
 let best=null;
 for(const e of roads.edges){const p=e.points;
  for(let i=1;i<p.length;i++){const [ax,az]=p[i-1],[bx,bz]=p[i],dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz;if(l2<1e-6)continue;
   const t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l2)),px=ax+dx*t,pz=az+dz*t,d=Math.hypot(x-px,z-pz);
   let cost=d;if(toward){const want=unit(toward[0]-px,toward[1]-pz),dir=unit(dx,dz);cost+=angle(want,dir)*12;} // a lane the wrong way costs as much as ~38 m
   if(!best||cost<best.cost)best={edge:e,s:e.cumulative[i-1]+Math.sqrt(l2)*t,cost};}}
 return best;
}

// The car ahead in the hero's lane (within 2.2 m sideways, heading the same way, up to 60 m): {gap, speed} or null.
export function leadCar(p,cars){
 let best=null;const fx=-Math.sin(p.heading),fz=-Math.cos(p.heading);
 for(const c of cars||[]){if(!c||c.edge===null||!Number.isFinite(c.x))continue;const dx=c.x-p.x,dz=c.z-p.z,along=dx*fx+dz*fz;if(along<=0||along>60)continue;
  if(Math.abs(dx*fz-dz*fx)>2.2||Math.cos((c.heading||0)-p.heading)<.7)continue;if(!best||along<best.gap)best={gap:along,speed:Math.abs(c.speed||0)};}
 return best;
}
export function createCineDrive(roads,{from,toward=null,speed=12,turnSpeed=.45}={}){
 const start=placeOnRoads(roads,from,toward);if(!start)return null;
 let edge=start.edge,s=start.s,v=speed,distance=0;const visited=new Set([edge.id]);
 const choose=e=>{
  let options=roads.outgoing[e.to].filter(o=>o.to!==e.from&&o.length>.3);if(!options.length)options=roads.outgoing[e.to];if(!options.length)return null;
  const end=e.points.at(-1),there=toward&&Math.hypot(toward[0]-end[0],toward[1]-end[1])<25,want=toward&&!there?unit(toward[0]-end[0],toward[1]-end[1]):endDir(e),ahead=endDir(e);
  let best=null,score=Infinity;for(const o of options){const d=startDir(o);const sc=angle(want,d)+.35*angle(ahead,d)+(visited.has(o.id)?2:0);if(sc<score){score=sc;best=o;}}
  return best;};
 let next=choose(edge);
 const pose=()=>routePoint(edge,s,edge.lane??0,next?startDir(next):undefined);
 return {
  get edge(){return edge;},get distance(){return distance;},get speed(){return v;},pose,
  step(dt,cars=null){
   // ease towards the speed the next turn allows (sharp corners at walking pace, straight on at full speed), and
   // never into the car ahead: follow it at a 12 m gap (the hero is placed, not simulated, and would drive through it)
   const toEnd=edge.length-s,turn=next?angle(endDir(edge),startDir(next)):0;
   let target=toEnd<18&&turn>.5?Math.max(speed*turnSpeed,speed*(1-turn/Math.PI)):speed;
   const lead=cars?leadCar(pose(),cars):null;if(lead)target=Math.min(target,Math.max(0,lead.speed+(lead.gap-12)*.6));
   v+=(target-v)*Math.min(1,dt*2.2);
   s+=v*dt;distance+=v*dt;
   while(s>edge.length){const n=next||choose(edge);if(!n){s=edge.length;v=0;break;}s-=edge.length;edge=n;visited.add(edge.id);next=choose(edge);}
   return pose();
  }};
}

// Camera rigs around a moving vehicle at p {x,z,heading} (heading 0 drives towards -z). Heights are above the ground;
// cinematic.js adds the ground. u: 0..1 through the shot (for moves that drift). Returns eye and target [x,height,z].
export function rigPose(kind,p,u=0,o={}){
 const fx=-Math.sin(p.heading),fz=-Math.cos(p.heading),rx=Math.cos(p.heading),rz=-Math.sin(p.heading),side=o.side??1;
 const at=(f,r,h)=>[p.x+fx*f+rx*r*side,h,p.z+fz*f+rz*r*side];
 switch(kind){
  case 'low':return {eye:at(-4.6,.7,.55),target:at(12,0,.9)}; // bumper-height chase: the street rushes past
  case 'front':return {eye:at(11-4*u,-1.2,1.25),target:at(0,0,.9)}; // ahead of the car, which closes in on the camera
  case 'side':return {eye:at(1.5,6.5,1.1),target:at(1.2,0,.9)}; // tracking beside it
  case 'wheel':return {eye:at(-1.2,2.1,.35),target:at(1.8,.9,.45)}; // down at the front wheel
  case 'heli':return {eye:at(-26+6*u,9,20-4*u),target:at(8,0,1)}; // helicopter, easing in
  case 'top':return {eye:at(-4,0,46-8*u),target:at(5,0,0)}; // straight down from above, sinking
  case 'pass':return {eye:at(16-30*u,5.5,1.4),target:at(0,0,1)}; // camera holds roughly still while the car passes it
  default:return {eye:at(-7.5,0,2.5),target:at(7,0,1.1)}; // chase
 }
}
