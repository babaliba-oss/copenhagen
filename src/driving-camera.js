import {groundAt} from './terrain.js';
// Pure pose function: used by both the renderer and camera regression tests.
export function overviewCameraPose(car,heading,zoom=240,high=false){
 const span=Math.max(36,Math.min(240,zoom)),t=(span-36)/204;
 // Follow is only one storey above Drive, not a city-map camera. High retains
 // the distant survey view as a separate deliberate choice.
 const height=high?span*.85:8+t*5,behind=high?span*.40:13+t*9,ahead=high?10:5;
 const y=car.y??groundAt(car.x,car.z),px=car.x+Math.sin(heading)*behind,pz=car.z+Math.cos(heading)*behind;
 return {position:[px,Math.max(y+height,groundAt(px,pz)+1.5),pz],target:[car.x-Math.sin(heading)*ahead,y+1.15,car.z-Math.cos(heading)*ahead]};
}
let swing=0;
export const CAMERA_CLEARANCE={r:1};const CLEAR_RING=[0,1,2,3,4,5,6,7].map(k=>[Math.cos(k*Math.PI/4),Math.sin(k*Math.PI/4)]);
// camera-walls.json (scripts/road-walls.mjs): the drawn walls at lens height that stand clear of the footprints, as flat
// [x0,z0,x1,z1,...] segments. Each becomes a strip `half` either side, wide enough (1 m) that the ring above cannot slip
// past it: the boom then keeps its lens off the drawn wall, not just off the mapped footprint. Camera only, never collision.
export function cameraWallStrips(segs,half=.5){const out=[];for(let i=0;i+3<segs.length;i+=4){const ax=segs[i],az=segs[i+1],bx=segs[i+2],bz=segs[i+3],L=Math.hypot(bx-ax,bz-az)||1,px=-(bz-az)/L*half,pz=(bx-ax)/L*half;
 out.push({rings:[[[ax+px,az+pz],[bx+px,bz+pz],[bx-px,bz-pz],[ax-px,az-pz]]],bbox:[Math.min(ax,bx)-half,Math.min(az,bz)-half,Math.max(ax,bx)+half,Math.max(az,bz)+half]});}return out;}
export function drivingCameraPose(car,heading,zoom=240,look=0,buildings=null,aspect=0){
 // Close and low, more behind the car than above it, so the street ahead reads
 // on a phone screen (arcade-style: ~8.3 m back, 3.3 m up at the default zoom 150). Zoom (36–240) still pulls it back.
 let distance=4.5+Math.max(36,Math.min(240,zoom))/40;
 // A turn near Forum can put a fixed-length camera boom inside the building
 // across the road. Shorten it before the wall, retaining the driving target.
 // The lens keeps CAMERA_CLEARANCE from the footprints all round: the city model's facades stand up to a metre
 // outside them (cornices, bays, a footprint mapped short), and a lens 0.25 m off the footprint sat inside the drawn wall.
 // An obstacle the car itself stands in (or the first metre of the boom crosses) does not block it: the car is evidently not
 // inside a wall there (a camera-wall strip over a mapped road, a footprint over a passage), and it collapsed the boom to 0.5 m
 // every frame, the screen solid grey. buildings.at(x,z,skip) passes over those (SpatialIndex); a plain at(x,z) predicate has
 // its own-position answer ignored instead.
 const own=h=>{const s=new Set();for(let d=0;d<=1;d+=.5){const x=car.x+Math.sin(h)*d,z=car.z+Math.cos(h)*d;for(let p;(p=buildings.at(x,z,s))&&!s.has(p);)s.add(p);}return s;};
 const clear=(h,max)=>{const s=own(h),hit=(x,z)=>{const p=buildings.at(x,z,s);return p&&!s.has(p);};for(let d=1;d<=max;d+=.25){const x=car.x+Math.sin(h)*d,z=car.z+Math.cos(h)*d;
  if(hit(x,z)||CLEAR_RING.some(([dx,dz])=>hit(x+dx*CAMERA_CLEARANCE.r,z+dz*CAMERA_CLEARANCE.r)))return Math.max(.5,d-.5);}return max;};
 const aim=heading; // the target stays straight ahead of the car even when the boom swings
 if(buildings){const full=distance;distance=clear(heading,full);
  // Backed up against a wall: swing the boom up to 40 degrees to whichever side is open, rather than a lens
  // half a metre behind the roof.
  let want=0;if(distance<full*.6)for(const off of [.35,-.35,.7,-.7]){const d=clear(heading+off,full);if(d>distance+1.5){want=off;break;}}
  // eased, so the boom swings round instead of jumping a frame
  swing+=(want-swing)*.18;if(Math.abs(swing)<.01&&want===0)swing=0;if(swing){heading+=swing;distance=clear(heading,full);}}
 // Turn the view, not the camera's orbit: orbiting sideways puts the lens
 // inside the roadside trees precisely when the player looks at the harbour.
 const ahead=3+Math.abs(look)*15;
 // Hills: the camera rides at the car's ground height, never below the slope behind it.
 const y=car.y??groundAt(car.x,car.z),px=car.x+Math.sin(heading)*distance,pz=car.z+Math.cos(heading)*distance;
 // A wall right behind: the short boom rises instead, looking down over the vehicle (at 0.5 m back and 2.5 m up
 // the lens sat inside the 1760 coach's body).
 const short=Math.max(0,3.6-distance),lift=short*1.05,ly=Math.max(y+2.4+distance*.11+lift,groundAt(px,pz)+1.4);let far=ahead+short*2.2; // and aims further ahead, so it never looks straight down on the roof
 // ...but not so far ahead that the car leaves the frame: a 0.5-1 m boom, lifted, aiming ~10 m ahead looked 25 degrees down
 // while the car sat 80 degrees down, under the bottom edge. The aim comes back toward the car until its body is within 60%
 // of the (narrowest) vertical half-view below the view's centre; a normal boom (car ~17 degrees down) is unchanged.
 const dip=Math.atan2(ly-y-.8,distance)-DRIVE_FOV.min*Math.PI/360*.6;if(dip>0)far=Math.min(far,Math.max(0,(ly-y-1.15)/Math.tan(dip)-distance));
 // A swung boom on a narrow (portrait phone) screen: straight ahead put the car 12 degrees off a 15 degree half-view, half
 // off the edge. The aim turns toward the boom's line just far enough that the car's centre stays within 35% of the half-view.
 let to=aim;if(swing&&aspect){const half=Math.atan(Math.tan(DRIVE_FOV.min*Math.PI/360)*aspect)*.35;for(let t=0;t<=1.001;t+=.1){to=aim+swing*t;const a=Math.atan2(car.x-px,car.z-pz)-Math.atan2(-Math.sin(to)*far-px+car.x,-Math.cos(to)*far-pz+car.z);if(Math.abs(Math.atan2(Math.sin(a),Math.cos(a)))<=half)break;}}
 return {position:[px,ly,pz],target:[car.x-Math.sin(to+look)*far,y+1.15,car.z-Math.cos(to+look)*far]};
}

// ---- Drive-camera feel: speed FOV, heading lag/settle, roll, look, shake ----
// Everything below is frame-rate independent: exponential eases and a damped
// spring integrated in sub-steps, so 30 Hz and 120 Hz settle identically.
export const DRIVE_FOV={min:58,max:68};
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const ease=(from,to,dt,rate)=>from+(to-from)*(1-Math.exp(-Math.max(0,dt)*rate));
// 58 degrees at rest widening to 68 at top speed (smoothstep so the first few km/h barely move it).
export function driveFov(speed,maxSpeed=140/3.6){const t=clamp(Math.abs(speed)/maxSpeed,0,1);return DRIVE_FOV.min+(DRIVE_FOV.max-DRIVE_FOV.min)*t*t*(3-2*t);}
export function createDriveCameraState(heading=0){return {heading,headingVel:0,look:0,lookVel:0,roll:0,fov:DRIVE_FOV.min,shake:0,shakePhase:0,lastX:null,lastZ:null,lastSpeed:0,lastDamage:0};}
// Second-order spring with light under-damping: the camera hangs back a
// little on turn-in, then settles without a visible wobble.
function spring(value,vel,target,dt,omega,zeta){
 const steps=Math.max(1,Math.ceil(dt/(1/90))),h=dt/steps;let v=value,u=vel;
 for(let i=0;i<steps;i++){const err=wrap(target-v);u+=(omega*omega*err-2*zeta*omega*u)*h;v=wrap(v+u*h);}
 return [v,u];
}
// rumble: {bob,roll} for the CAMERA, i.e. rumbleFor()'s cameraBob/cameraRoll
// (its own gentle <6 Hz sway, about a third of the body's bob), returned
// separately as `rumble` so capture mode can keep it while zeroing impact
// shake; the roll is folded into `roll`. CAMERA_RUMBLE is a final scale.
export const CAMERA_RUMBLE={bob:1,roll:1};
export function stepDriveCamera(state,car,dt,{lookTarget=0,drive=true,maxSpeed=140/3.6,rumble=null}={}){
 dt=Math.max(0,Math.min(dt,.25));
 const speed=car.speed||0,teleported=state.lastX!==null&&Math.hypot(car.x-state.lastX,car.z-state.lastZ)>25;
 if(teleported){state.heading=car.heading;state.headingVel=0;state.shake=0;}
 state.lastX=car.x;state.lastZ=car.z;
 // Heading: springy in Drive, plain lag in Follow/High.
 if(drive){[state.heading,state.headingVel]=spring(state.heading,state.headingVel,car.heading,dt,5.2,.78);}
 else{state.heading=wrap(ease(state.heading,state.heading+wrap(car.heading-state.heading),dt,2.5));state.headingVel=0;}
 // Q/E look: critically damped so it eases out and eases back.
 [state.look,state.lookVel]=spring(state.look,state.lookVel,lookTarget,dt,7.5,1);
 // Roll: lean into the turn, more with speed; capped at ~2 degrees.
 const rollTarget=drive?clamp((car.steer||0)*Math.min(1,Math.abs(speed)/14)*.035*Math.sign(speed||1),-.035,.035):0;
 state.roll=ease(state.roll,rollTarget,dt,6);
 // FOV follows speed with a short lag so launches read as a surge.
 state.fov=ease(state.fov,drive?driveFov(speed,maxSpeed):DRIVE_FOV.min,dt,4);
 // Shake on hard impacts: a damage event with a sudden speed loss.
 const damage=car.damageVersion||0;
 if(damage!==state.lastDamage){const lost=Math.abs(state.lastSpeed)-Math.abs(speed);if(lost>2.5)state.shake=Math.max(state.shake,clamp(lost/16,.2,1));state.lastDamage=damage;}
 state.lastSpeed=speed;
 state.shake*=Math.exp(-dt*5.5);if(state.shake<.004)state.shake=0;
 state.shakePhase+=dt*31;
 const s=state.shake,rumbleBob=drive&&rumble?(rumble.bob||0)*CAMERA_RUMBLE.bob:0,rumbleRoll=drive&&rumble?(rumble.roll||0)*CAMERA_RUMBLE.roll:0;
 return {heading:state.heading,look:state.look,roll:state.roll+s*.03*Math.sin(state.shakePhase*1.7)+rumbleRoll,fov:state.fov,
  offset:[s*.11*Math.sin(state.shakePhase),s*.07*Math.sin(state.shakePhase*1.31+.9),s*.05*Math.cos(state.shakePhase*.83)],
  rumble:[0,rumbleBob,0]};
}
