import { insidePlayable, pointInPolygon, segmentDistance, inWaterPolygons } from './geo.js';
import {groundPose,lakeAt} from './terrain.js';
export const GRAVITY=9.81;
export const PLAYER_MAX_SPEED=140/3.6;
// Intentionally stylised HUD speed. Physics, collisions
// and distance tracking continue to use true world metres / second.
export const displayedSpeedKmh=speed=>Math.round(Math.abs(speed)*3.6*.7);
// Preserve elapsed time at ordinary low frame rates, while bounding recovery
// after a suspended tab. Call simulation with small collision-safe substeps.
export function simulationSteps(elapsed){
 const duration=Number.isFinite(elapsed)?Math.max(0,Math.min(elapsed,.25)):0;
 const count=Math.max(1,Math.ceil(duration/(1/30)));
 return Array(count).fill(duration/count);
}
// After a spike strip (src/roadblock.js): `car.flat` 1 = shredded tyres. The
// car sheds speed hard down to a rim-scraping crawl, has little drive and wobbles.
export const FLAT_TYRES={speed:3.2,drag:11,power:.3,wobble:.35};
// No battery: the car never runs out (the city is for exploring, not for range anxiety).
export function makeCar(x,z,heading=0){return settleOnGround({x,z,heading,speed:0,steer:0,distance:0});}
// Height, pitch and roll from the ground under the wheels (all 0 in a flat city).
export function settleOnGround(car){const p=groundPose(car.x,car.z,car.heading,1.4,.8);car.y=p.y;car.pitch=p.pitch;car.roll=p.roll;return car;}
export function carSamples(car,x=car.x,z=car.z) {
 const s=Math.sin(car.heading),c=Math.cos(car.heading),f=(car.front??2.3)/2.3,b=(car.back??2.3)/2.3; // front/back: a longer vehicle (the 1760 coach and horses)
 return [[0,0],[-.9,-2.15],[.9,-2.15],[-.9,2.15],[.9,2.15],[0,-2.3],[0,2.3],[-1,0],[1,0]].map(([lx,lz])=>{lz*=lz<0?f:b;return [x+lx*c+lz*s,z-lx*s+lz*c];});
}
// Existing contact with a thin railing must allow retreat or sliding along it.
// Each footprint sample may only retain/reduce its penetration, never enter a
// new obstacle. This is recovery from overlap, not disabling wall collisions.
export function canExitBuildings(from,to,buildings){
 const a=carSamples(from),b=carSamples(to);
 const depth=(x,z,p)=>Math.min(...p.rings.flatMap(r=>r.map((v,i)=>segmentDistance(x,z,v,r[(i+1)%r.length]))));
 let contact=false;
 for(let i=0;i<b.length;i++){
  const [x,z]=b[i],p=buildings.at(x,z);if(!p)continue;
  if(!p.rings||!pointInPolygon(...a[i],p.rings)||depth(x,z,p)>depth(...a[i],p)+1e-8)return false;
  if(!pointInPolygon(from.x,from.z,p.rings)){
   let nearest=null,best=Infinity;
   for(const ring of p.rings)for(let j=0;j<ring.length;j++){
    const v=ring[j],w=ring[(j+1)%ring.length],dx=w[0]-v[0],dz=w[1]-v[1],t=Math.max(0,Math.min(1,((from.x-v[0])*dx+(from.z-v[1])*dz)/(dx*dx+dz*dz||1))),q=[v[0]+t*dx,v[1]+t*dz],d=Math.hypot(from.x-q[0],from.z-q[1]);
    if(d<best){best=d;nearest=q;}
   }
   if((to.x-from.x)*(from.x-nearest[0])+(to.z-from.z)*(from.z-nearest[1])< -1e-9)return false;
  }
  contact=true;
 }
 return contact&&Math.hypot(to.x-from.x,to.z-from.z)>1e-9;
}
export const SLIDE_MAX=.6; // radians: the steepest angle of incidence the car slides off (about 35 degrees); squarer is a crash
// The direction of whatever the car ran into, at the contact: a round object's tangent, or the nearest edge of the
// building, footprint or water polygon one of the car's sample points went into. Null when there is no edge to slide
// along (a lake from the elevation model).
function contactTangent(world,buildings,car,item,kind){
 const samples=carSamples(car),edge=rings=>{let best=null,d=Infinity;for(const [x,z] of samples)for(const r of rings)for(let i=1;i<r.length;i++){const e=segmentDistance(x,z,r[i-1],r[i]);if(e<d){d=e;best=[r[i-1],r[i]];}}
  if(!best)return null;const ex=best[1][0]-best[0][0],ez=best[1][1]-best[0][1],l=Math.hypot(ex,ez)||1;return [ex/l,ez/l];};
 if(item){if(item.radius>0&&!item.rings){let s=samples[0],d=Infinity;for(const p of samples){const e=Math.hypot(p[0]-item.x,p[1]-item.z);if(e<d){d=e;s=p;}}const nx=s[0]-item.x,nz=s[1]-item.z,l=Math.hypot(nx,nz)||1;return [-nz/l,nx/l];}
  return item.rings?edge(item.rings):null;}
 if(kind==='building'){for(const [x,z] of samples){const b=buildings.at(x,z);if(b?.rings)return edge(b.rings);}return null;}
 const wet=(world.water||[]).filter(w=>w?.rings&&samples.some(([x,z])=>pointInPolygon(x,z,w.rings)));
 return wet.length?edge(wet.flatMap(w=>w.rings)):null;
}
export function driveStep(car,keys,dt,world) {
 const collisionBuildings=world.collisionBuildings||world.buildings;
 const distanceBefore=car.distance;
 const throttle=keys.has('KeyW')||keys.has('ArrowUp');
 const reverse=keys.has('KeyS')||keys.has('ArrowDown');
 const left=keys.has('KeyA')||keys.has('ArrowLeft'),right=keys.has('KeyD')||keys.has('ArrowRight'),brake=keys.has('Space');
 const onRoad=Boolean(world.roads.at(car.x,car.z));
 const targetSteer=left||right?(left?1:0)-(right?1:0):keys.tilt||0; /* keys.tilt: analog steering from a tilted phone, -1…1, left positive */car.steer+=(targetSteer-car.steer)*Math.min(1,dt*10);
 const launchAcceleration=8.4+1.8*Math.max(0,1-Math.max(0,car.speed)/(50/3.6));
 const roadDrag=.25+car.speed*car.speed*.002+(onRoad?0:2);
 const headroom=Math.max(0,Math.min(1,(PLAYER_MAX_SPEED-car.speed)/(PLAYER_MAX_SPEED-80/3.6)));
 const acceleration=roadDrag+Math.max(0,launchAcceleration-roadDrag)*headroom;
 const flat=car.flat||0,power=flat?FLAT_TYRES.power:1;
 if(!brake&&throttle)car.speed+=(car.speed<-.5?24:acceleration*power)*dt;
 if(!brake&&reverse)car.speed-=(car.speed>.5?26:4.2*power)*dt;
 const resistance=(brake?34:roadDrag+(!throttle&&!reverse?1.55:0))+(flat&&Math.abs(car.speed)>FLAT_TYRES.speed?FLAT_TYRES.drag*flat:0);
 car.speed=Math.sign(car.speed)*Math.max(0,Math.abs(car.speed)-resistance*dt);
 // Slopes: gravity along the car's pitch slows it uphill and pulls it on downhill (or back, when stopped and let go).
 if(car.pitch)car.speed-=GRAVITY*Math.sin(car.pitch)*dt;
 // Arcade top-speed governor. Posted limits govern NPCs separately.
 car.speed=Math.max(-9,Math.min(PLAYER_MAX_SPEED,car.speed));
 // Preserve the first small powered step, especially reverse on pavement at
 // 60/120 Hz. The standstill dead zone is for coasting, not active throttle.
 if(Math.abs(car.speed)<.04&&!throttle&&!reverse)car.speed=0;
 const oldHeading=car.heading;
 car.heading+=car.steer*car.speed/2.8*(.43/(1+Math.abs(car.speed)*.055))*dt*(brake?1.5:1);
 if(flat)car.heading+=flat*FLAT_TYRES.wobble*Math.sin(car.distance*1.3)*Math.min(1,Math.abs(car.speed)/4)*dt;
 const travel=car.speed*dt, steps=Math.max(1,Math.ceil(Math.abs(travel)/.1)); // 10 cm: a 0.4 m step let a corner sample hop the thinnest footprints (about 10 cm)
 let collision=null,scrape=0;
 for(let i=0;i<steps;i++){
   const nx=car.x-Math.sin(car.heading)*travel/steps,nz=car.z-Math.cos(car.heading)*travel/steps;
   if(!insidePlayable(nx,nz,3)){collision='boundary';break;}
   const from={...car,heading:i?car.heading:oldHeading};let item=null;
   const hit=next=>{const samples=carSamples(next);item=world.objects?.blocksStep(from,next)||null;
    if(item||samples.some(([x,z])=>collisionBuildings.at(x,z))&&!canExitBuildings(from,next,collisionBuildings))return 'building';
    if(samples.some(([x,z])=>!world.roads.at(x,z)&&!world.pavement.at(x,z)&&(inWaterPolygons(world.water,x,z)||lakeAt(x,z)!==null)))return 'water';
    return null;};
   const next={...car,x:nx,z:nz};collision=hit(next);
   if(collision){
    // Glancing contact slides along what was hit instead of pinning the car (a wall, a quay edge, a bollard): the wall's
    // own direction there (contactTangent) gives the angle of incidence; up to SLIDE_MAX the car carries on along it
    // with the part of its speed that was parallel to it, turning into it a little. Squarer than that it stops (a
    // crash, as before). The slide path is checked every 10 cm, and against the map edge, so it cannot hop a thin wall.
    const tan=contactTangent(world,collisionBuildings,next,item,collision);if(!tan)break;
    const sign=Math.sign(travel)||1,dx=-Math.sin(car.heading)*sign,dz=-Math.cos(car.heading)*sign;
    let [tx,tz]=tan;if(tx*dx+tz*dz<0){tx=-tx;tz=-tz;}
    const along=tx*dx+tz*dz,incidence=Math.acos(Math.min(1,along));if(incidence>SLIDE_MAX)break;
    const len=Math.abs(travel/steps)*along,target=sign>0?Math.atan2(-tx,-tz):Math.atan2(tx,tz),turn=Math.atan2(Math.sin(target-car.heading),Math.cos(target-car.heading))*.35;
    const n=Math.max(1,Math.ceil(len/.1)),path=t=>k=>({...car,heading:car.heading+t*k/n,x:car.x+tx*len*k/n,z:car.z+tz*len*k/n});
    const free=pose=>{for(let k=1;k<=n;k++){const q=pose(k);if(!insidePlayable(q.x,q.z,3)||hit(q))return false;}return true;};
    const pose=[path(turn),path(0)].find(free); // turning into the wall swings the tail towards it: else slide straight
    if(!pose)break;
    const q=pose(n);car.distance+=len;car.x=q.x;car.z=q.z;car.heading=q.heading;
    scrape=Math.max(scrape,Math.abs(car.speed)*Math.sin(incidence));car.speed*=along;collision=null;continue;
   }
   car.distance+=Math.hypot(nx-car.x,nz-car.z);car.x=nx;car.z=nz;
 }
 if(collision){if(car.distance===distanceBefore)car.heading=oldHeading;car.speed=0;}
 settleOnGround(car);
 return {collision,onRoad,scrape}; // scrape: speed (m/s) that went into what the car slid along, for damage
}
export function nearestRoadPoint(x,z,roads,buildings) {
 let best=null,d=Infinity;
 const candidates=roads.filter(r=>!/Koroke/.test(r.kind));
 for(const r of candidates){
   const b=r.bbox;if(x<b[0]-300||x>b[2]+300||z<b[1]-300||z>b[3]+300)continue;
   // Search actual road interiors, accounting for irregular junctions and islands.
   const minX=Math.max(b[0],x-150), maxX=Math.min(b[2],x+150), minZ=Math.max(b[1],z-150), maxZ=Math.min(b[3],z+150);
   for(let px=minX+2;px<maxX;px+=3)for(let pz=minZ+2;pz<maxZ;pz+=3){
     const dist=Math.hypot(px-x,pz-z);if(dist>=d||!insidePlayable(px,pz,10))continue;
     if(!pointInPolygon(px,pz,r.rings)||buildings.at(px,pz))continue;
     let clearance=Infinity;for(const ring of r.rings)for(let i=1;i<ring.length;i++)clearance=Math.min(clearance,segmentDistance(px,pz,ring[i-1],ring[i]));
     if(clearance<2.6)continue;
     if(carSamples(makeCar(px,pz)).some(([a,b])=>buildings.at(a,b)))continue;
     best={x:px,z:pz,name:r.name};d=dist;
   }
 }
 if(!best)throw new Error('Could not find a clear starting point on the road.');
 return best;
}
