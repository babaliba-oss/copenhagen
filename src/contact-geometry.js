// Shared conservative footprints for traffic, impacts and police.
const axes=p=>{const h=p.heading||0;return [[Math.cos(h),-Math.sin(h)],[Math.sin(h),Math.cos(h)]];};
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const size=p=>({w:p.halfWidth??.98,l:p.halfLength??2.36});
function depths(a,b,pedestrian=false,basis=axes(a).concat(pedestrian?[]:axes(b))){
 const aa=axes(a),bb=axes(b),delta=[b.x-a.x,b.z-a.z],sa=size(a),sb=size(b);
 return basis.map(axis=>(sa.w+(pedestrian?.27:0))*Math.abs(dot(axis,aa[0]))+(sa.l+(pedestrian?.29:0))*Math.abs(dot(axis,aa[1]))+
  (pedestrian?0:sb.w*Math.abs(dot(axis,bb[0]))+sb.l*Math.abs(dot(axis,bb[1])))-Math.abs(dot(delta,axis)));
}
export const trafficFootprintsOverlap=(a,b)=>Math.hypot(b.x-a.x,b.z-a.z)<size(a).l+size(b).l+.5&&depths(a,b).every(d=>d>0); // 5.2 m for two cars; longer for coaches
// Overlap measure for the escape rule. Car against car: the actual overlap
// area of the two footprints (convex clip). Car against a person: the point's
// depth product inside the enlarged car box. Both are zero without contact,
// grow as the car sinks in and shrink as it backs or slides out, which the
// per-axis depths alone cannot tell apart (two cars in line share one axis).
const corners=(p,hw,hl)=>{const [a,b]=axes(p);return [[p.x+a[0]*hw+b[0]*hl,p.z+a[1]*hw+b[1]*hl],[p.x-a[0]*hw+b[0]*hl,p.z-a[1]*hw+b[1]*hl],[p.x-a[0]*hw-b[0]*hl,p.z-a[1]*hw-b[1]*hl],[p.x+a[0]*hw-b[0]*hl,p.z+a[1]*hw-b[1]*hl]];};
function clipArea(subject,clip){
 let out=subject;
 for(let i=0;i<clip.length&&out.length;i++){
  const a=clip[i],b=clip[(i+1)%clip.length],ex=b[0]-a[0],ez=b[1]-a[1],inside=p=>ex*(p[1]-a[1])-ez*(p[0]-a[0])>=0,input=out;out=[];
  for(let j=0;j<input.length;j++){
   const p=input[j],q=input[(j+1)%input.length],pi=inside(p),qi=inside(q);
   if(pi)out.push(p);
   if(pi!==qi){const dp=ex*(p[1]-a[1])-ez*(p[0]-a[0]),dq=ex*(q[1]-a[1])-ez*(q[0]-a[0]),t=dp/(dp-dq);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
  }
 }
 let area=0;for(let i=0;i<out.length;i++){const p=out[i],q=out[(i+1)%out.length];area+=p[0]*q[1]-q[0]*p[1];}
 return Math.abs(area)/2;
}
const overlapMeasure=(p,actor,pedestrian)=>{
 if(pedestrian){const [d0,d1]=depths(p,actor,true);return d0>0&&d1>0?d0*d1:0;}
 const a=size(p),b=size(actor);return clipArea(corners(p,a.w,a.l),corners(actor,b.w,b.l));
};
export function sweptContact(from,to,actor,pedestrian=false){
 if(Math.hypot(actor.x-from.x,actor.z-from.z)>Math.hypot(to.x-from.x,to.z-from.z)+(pedestrian?3:5.2))return false;
 const turn=Math.atan2(Math.sin((to.heading||0)-(from.heading||0)),Math.cos((to.heading||0)-(from.heading||0)));
 const n=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.z-from.z)/.2),Math.ceil(Math.abs(turn)/.04));
 const initial=overlapMeasure(from,actor,pedestrian);
 for(let i=1;i<=n;i++){
  const t=i/n,current=overlapMeasure({...to,x:from.x+(to.x-from.x)*t,z:from.z+(to.z-from.z)*t,heading:(from.heading||0)+turn*t},actor,pedestrian);
  // Already overlapping (last frame's hit, a bus that shoved us, traffic that
  // drove into us): backing out, steering out or sliding along the body is
  // allowed as long as the overlap never grows beyond where it started.
  // Checked at every substep so reversing cannot tunnel through an actor.
  // Earlier this demanded that no single axis got deeper, which left a third
  // of real hits with no input that could move the car at all.
  if(initial>0?current>initial*1.0001+1e-5:current>0)return true;
 }
 return false;
}
// True when the player's next step moves out of (or along the edge of) a long
// body such as a bus or tram section, measured in the body's own frame.
export function leavingBody(player,dt,body){
 const c=Math.cos(body.heading),s=Math.sin(body.heading),at=(x,z)=>[Math.abs((x-body.x)*c-(z-body.z)*s),Math.abs((x-body.x)*s+(z-body.z)*c)];
 const speed=player.speed||0;if(!speed)return false;
 const [side,along]=at(player.x,player.z),[side2,along2]=at(player.x-Math.sin(player.heading)*speed*dt,player.z-Math.cos(player.heading)*speed*dt);
 return side2>side+1e-6||along2>along+1e-6;
}
// Sideways push out of a body (shift in the body's lateral frame). When the
// full shift lands in a building or off the mapped ground, take as much of it
// as fits instead of leaving the car wedged for good.
export function nudgeOut(player,heading,shift,world){
 const c=Math.cos(heading),s=Math.sin(heading);
 for(const f of [1,.5,.25]){const x=player.x+c*shift*f,z=player.z-s*shift*f;if(!world.buildings.at(x,z)&&(world.roads.at(x,z)||world.pavement?.at(x,z))){player.x=x;player.z=z;return true;}}
 return false;
}
