import {routePoint} from '../mobility.js';

// Copenhagen's cyclists: riders on the cycle tracks along the car streets (the strip right of the traffic
// lane, outside the parked cars where there is room). Each rider follows a random ~700 m route through the
// street graph near the player and is re-spawned ahead when done or left behind. Rendered with the shared
// cyclist renderer (src/cyclists.js), which only needs `riders`.
const RANGE=420;
export class CityCyclists{
 constructor(roads,world,count=36,random=Math.random){
  this.roads=roads;this.world=world;this.random=random;this.offsets=new Map();
  this.riders=Array.from({length:count},(_,id)=>({id,travelMode:'bike',halfWidth:.34,halfLength:.9,x:1e6,z:1e6,heading:0,speed:0,cruise:4.2+random()*1.8,phase:random()*6,route:null,leg:0,s:0}));
 }
 offset(e){
  if(this.offsets.has(e.id))return this.offsets.get(e.id);
  const w=this.world;let best=null;
  for(const o of [e.lane+3.9,e.lane+3.2,e.lane+1.7]){
   let ok=0;for(const f of [.25,.5,.75]){const p=routePoint(e,e.length*f,o);if(!w.buildings.at(p.x,p.z)&&(w.roads.at(p.x,p.z)||w.pavement?.at(p.x,p.z)))ok++;}
   if(ok>=2){best=o;break;}
  }
  this.offsets.set(e.id,best);return best;
 }
 spawn(r,player){
  const E=this.roads.edges;
  for(let tries=0;tries<40;tries++){
   const e=E[Math.floor(this.random()*E.length)];if(e.length<15||e.crossing)continue;
   const m=e.points[Math.floor(e.points.length/2)],d=Math.hypot(m[0]-player.x,m[1]-player.z);if(d<40||d>340)continue;
   if(d<160&&player.heading!==undefined){const fx=-Math.sin(player.heading),fz=-Math.cos(player.heading);if(((m[0]-player.x)*fx+(m[1]-player.z)*fz)/d>.2)continue;} // not popping up ahead
   if(this.offset(e)===null)continue;
   const route=[e];let total=e.length,cur=e;
   while(total<700){const next=(this.roads.outgoing[cur.to]||[]).map(i=>typeof i==='number'?E[i]:i).filter(n=>n.to!==cur.from&&n.length>4&&!n.crossing&&this.offset(n)!==null);if(!next.length)break;cur=next[Math.floor(this.random()*next.length)];route.push(cur);total+=cur.length;}
   r.route=route;r.leg=0;r.s=this.random()*e.length*.5;r.speed=r.cruise*.8;return true;
  }
  r.route=null;return false;
 }
 snapshot(){return this.riders.filter(r=>!r.playerTaken&&r.route).map(({id,x,z,heading,speed})=>({id,x,z,heading,speed}));}
 step(dt,player){
  if(!player)return;
  for(const r of this.riders){
   if(r.knockdown||r.playerTaken){r.speed=0;continue;}
   if(!r.route||Math.hypot(r.x-player.x,r.z-player.z)>RANGE){if(!this.spawn(r,player)){r.x=r.z=1e6;continue;}}
   const e=r.route[r.leg],o=this.offset(e)??e.lane+1.7;
   const ahead=routePoint(e,Math.min(e.length,r.s+4),o),blocked=Math.hypot(ahead.x-player.x,ahead.z-player.z)<3;
   r.speed+=Math.max(-5*dt,Math.min(1.5*dt,(blocked?0:r.cruise)-r.speed));
   r.s+=r.speed*dt;
   if(r.s>=e.length){r.s-=e.length;r.leg++;if(r.leg>=r.route.length){r.route=null;continue;}}
   const cur=r.route[r.leg],p=routePoint(cur,r.s,this.offset(cur)??cur.lane+1.7);r.x=p.x;r.z=p.z;r.heading=p.heading;r.phase+=r.speed*dt*2.2;
  }
 }
}
