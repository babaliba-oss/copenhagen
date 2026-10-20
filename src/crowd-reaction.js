// How people around a pedestrian hit react, in every city. Whoever can see it
// (distance and a clear line past buildings) flinches first; then most run away
// from the car, some stop and stare (a few film it on their phone or shout),
// and the closest ones go to help the person up. Fear spreads a little through
// the crowd; everyone calms down after a while and carries on walking.
// People are moved through small adapters, so graph walkers (mobility.js) and
// free crowds (market-life.js) both work: `scare(person, from, seconds)` makes
// them run away from a point, `hold(person, seconds)` keeps them standing.
export const REACTION={radius:{stumble:9,down:24,thrown:34},flinch:.55,help:4.5,spread:4,spreadChance:.35,calm:[7,13],chance:{flee:.6,film:.18,shout:.12}};

function rng(seed=97){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}

export function createCrowdReaction({sight=null,scare=null,hold=null,random=rng(),phones=true}={}){ // phones: false in 1760 (filmers just stare)
 const reacting=new Set();let time=0;
 // Line of sight: sample the segment every metre against mapped buildings.
 function sees(a,p){
  if(!sight)return true;const d=Math.hypot(p.x-a.x,p.z-a.z),n=Math.max(1,Math.ceil(d));
  for(let i=1;i<n;i++){const t=i/n;if(sight.at(a.x+(p.x-a.x)*t,a.z+(p.z-a.z)*t))return false;}
  return true;
 }
 function react(a,kind,event,seconds){
  if(a.reaction)return;
  const at={x:event.at.x,z:event.at.z},from={x:event.hitter.x,z:event.hitter.z};
  a.reaction={kind,at,from,start:time,until:time+seconds,prevPose:a.pose,victim:event.actor};
  reacting.add(a);
  if(kind==='flee')scare?.(a,from,seconds);else hold?.(a,seconds);
 }
 // An impact (ImpactSystem.onHit event); `groups` are the arrays of people to consider.
 function alarm(event,groups){
  const level=event.severity.level,r=REACTION.radius[level]??20,victim=event.actor,at=victim.knockdown?.body??victim;
  const e={...event,at:{x:at.x,z:at.z}},fled=[];
  for(const list of groups)for(const a of list){
   if(a===victim||a.knockdown||a.reaction||a.edge===null||!Number.isFinite(a.x))continue;
   const d=Math.hypot(a.x-at.x,a.z-at.z);if(d>r||!sees(a,at))continue;
   const [lo,hi]=REACTION.calm,seconds=lo+random()*(hi-lo),c=REACTION.chance,roll=random();
   // A stumble only gets looks; a knock-down or a throw scatters the crowd.
   const kind=level==='stumble'?(roll<.5?'stare':'shout'):d<REACTION.help&&roll<.5?'help':roll<c.flee*(1-d/(r*2))+.25?'flee':roll<.85?'film':'shout';
   react(a,kind,e,kind==='help'?Math.max(seconds,(victim.knockdown?.lie||4)+3):seconds);if(kind==='flee')fled.push(a);
  }
  // Panic spreads: someone running past makes a few more people run.
  for(const f of fled)for(const list of groups)for(const a of list){
   if(a.reaction||a===victim||a.knockdown||a.edge===null||Math.hypot(a.x-f.x,a.z-f.z)>REACTION.spread||random()>REACTION.spreadChance)continue;
   react(a,'flee',e,REACTION.calm[0]);
  }
 }
 // Pose and facing for a reacting person this frame (null: no override).
 function view(a){
  const r=a.reaction;if(!r)return null;const t=time-r.start,face=Math.atan2(-(r.at.x-a.x),-(r.at.z-a.z));
  if(t<REACTION.flinch&&r.kind!=='flee')return {pose:'flinch',heading:face};
  if(r.kind==='flee')return t<REACTION.flinch*.6?{pose:'flinch',heading:null}:null;
  if(r.kind==='film')return {pose:phones?'phone':null,heading:face};
  if(r.kind==='shout')return {pose:t%3<1.6?'wave':null,heading:face};
  if(r.kind==='help'){const down=r.victim.knockdown?.body;return {pose:down&&Math.hypot(down.x-a.x,down.z-a.z)<2.2?'grabLow':null,heading:down?Math.atan2(-(down.x-a.x),-(down.z-a.z)):face};}
  return {pose:null,heading:face};
 }
 function step(dt){
  time+=dt;
  for(const a of reacting){const v=view(a);
   if(time>=a.reaction.until){a.pose=a.reaction.prevPose;delete a.reaction;reacting.delete(a);continue;}
   // Free crowds draw their own pose; graph walkers get it through street-life's view (same field).
   a.pose=v?.pose??a.reaction.prevPose;if(v?.heading!=null&&!(a.speed>.3))a.heading=v.heading;
  }
 }
 function reset(){for(const a of reacting){a.pose=a.reaction.prevPose;delete a.reaction;}reacting.clear();}
 return {alarm,step,view,reset,get reacting(){return reacting.size;},snapshot(){const kinds={};for(const a of reacting)kinds[a.reaction.kind]=(kinds[a.reaction.kind]||0)+1;return {reacting:reacting.size,kinds};}};
}
