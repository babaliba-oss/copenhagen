import {inWaterPolygons} from './geo.js';
import {carSamples} from './physics.js';
import {groundAt,lakeAt} from './terrain.js';

// Pursuit settings, in seconds and metres. Nothing here identifies a city.
export const ROADBLOCK={
 minLevel:5,chance:.75,delay:[8,14],warningLead:4,retry:7,maxAttempts:5,sliceMs:2, // sliceMs: the site search runs a slice of at most this many ms a frame (roadblock.js)
 minAhead:165,maxAhead:650,minMovingSpeed:3,minDeployDistance:65,
 lineSetback:13,minWidth:4.5,maxWidth:23,maxCrossSlope:.12,
 arrestCrawl:{speed:1.2,time:1,limit:7},
};
export const headingAlong=(x,z)=>Math.atan2(-x,-z);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const flagged=value=>value===true||value===1||value==='yes'||value==='true';
const unsafeEdge=e=>flagged(e.bridge)||flagged(e.tunnel)||Number(e.layer)||e.roundabout||e.crossing||['footway','cycleway','path','steps','pedestrian'].includes(e.highway);
const waterAt=(world,x,z)=>inWaterPolygons(world.water,x,z)||lakeAt(x,z)!==null; // indexed (a scan of every harbour polygon per sample was most of a site's layout)
const clearGround=(world,x,z)=>!world.buildings?.at(x,z)&&!world.trafficForbidden?.at(x,z)&&!waterAt(world,x,z);
const roadAt=(world,x,z)=>clearGround(world,x,z)&&!!world.roads?.at(x,z);
const walkAt=(world,x,z)=>clearGround(world,x,z)&&!!(world.roads?.at(x,z)||world.pavement?.at(x,z));

// Stay on one continuous carriageway: a median, water or any mapped building
// ends the strip. OSM buildings do not need a Helsinki RATU identifier.
export function spanAcross(world,centre,perp,maxHalf=ROADBLOCK.maxWidth,step=.35){
 const reach=sign=>{let d=0;while(d+step<=maxHalf&&roadAt(world,centre.x+perp.x*sign*(d+step),centre.z+perp.z*sign*(d+step)))d+=step;return d;};
 const left=reach(-1),right=reach(1);
 return {a:{x:centre.x-perp.x*left,z:centre.z-perp.z*left},b:{x:centre.x+perp.x*right,z:centre.z+perp.z*right}};
}
const stripPoints=strip=>{
 const length=distance(strip.a,strip.b),n=Math.max(1,Math.ceil(length/.4));
 return Array.from({length:n+1},(_,i)=>({x:strip.a.x+(strip.b.x-strip.a.x)*i/n,z:strip.a.z+(strip.b.z-strip.a.z)*i/n}));
};
// Broad conservative clearance includes buses/tram bodies, whose footprints
// may be given as hw/hl rather than halfWidth/halfLength.
function occupied(p,obstacles,margin=3){
 return obstacles.some(b=>{
  if(!Number.isFinite(b.x)||!Number.isFinite(b.z)||b.playerTaken)return false;
  const h=b.heading||0,dx=p.x-b.x,dz=p.z-b.z;
  return Math.abs(dx*Math.cos(h)-dz*Math.sin(h))<(b.halfWidth??b.hw??1)+margin&&Math.abs(dx*Math.sin(h)+dz*Math.cos(h))<(b.halfLength??b.hl??2.4)+margin;
 });
}
// The camera's sight line to a point 2 m above the site's ground (an officer's head, a patrol car's roof) is cut where a
// mapped building stands taller than the line there, sampled every 2 m. Footprints without a height (road walls) never
// hide anything, and a high camera looks over the roofs, so the check only ever lets a low chase camera lose sight.
function hiddenByBuildings(world,eye,p,heightAt){
 const index=world.sightBuildings||world.cameraBuildings||world.buildings;if(!index)return false;
 const top=heightAt(p.x,p.z)+2,dx=p.x-eye.x,dz=p.z-eye.z,n=Math.ceil(Math.hypot(dx,dz)/2);
 for(let i=1;i<n;i++){const t=i/n,x=eye.x+dx*t,z=eye.z+dz*t,b=index.at(x,z);if(b&&b.height>0&&heightAt(x,z)+b.height>eye.y+(top-eye.y)*t)return true;}
 return false;
}
function visibleFrom(world,viewer,p,isVisible,eye=null,heightAt=groundAt){
 // A supplied frustum check alone is conservative: it counts a site behind a block of houses as in view. Given the
 // camera's position (eye), a site the houses hide from it is out of view too.
 if(isVisible)return !!isVisible(p)&&!(eye&&Number.isFinite(eye.y)&&hiddenByBuildings(world,eye,p,heightAt));
 // Without a camera callback, conservatively treat the whole unobstructed
 // area as visible. We can still deploy around a building, never in clear view.
 const n=Math.ceil(distance(viewer,p)/1.5);
 for(let i=2;i<n;i++)if((world.cameraBuildings||world.buildings)?.at(viewer.x+(p.x-viewer.x)*i/n,viewer.z+(p.z-viewer.z)*i/n))return false;
 return true;
}
export function roadblockVisible(plan,world,viewer,isVisible,eye=null,heightAt=groundAt){
 return [plan.strip.a,plan.strip.b,...plan.cars,...plan.officers].some(p=>visibleFrom(world,viewer,p,isVisible,eye,heightAt));
}
export function roadblockClear(plan,world,{obstacles=[],heightAt=groundAt}={}){
 const points=stripPoints(plan.strip);
 if(points.some(p=>!roadAt(world,p.x,p.z)))return false;
 const heights=points.map(p=>heightAt(p.x,p.z)),width=distance(plan.strip.a,plan.strip.b);
 if(Math.max(...heights)-Math.min(...heights)>width*ROADBLOCK.maxCrossSlope)return false;
 return plan.cars.every(p=>!occupied(p,obstacles)&&carSamples(p).every(([x,z])=>roadAt(world,x,z)&&Math.abs(heightAt(x,z)-heightAt(p.x,p.z))<.65))&&
  plan.officers.every(p=>walkAt(world,p.x,p.z)&&!occupied(p,obstacles,1));
}

function layout(world,centre,forward,config,options){
 if(!roadAt(world,centre.x,centre.z))return null;
 const perp={x:forward.z,z:-forward.x},strip=spanAcross(world,centre,perp,config.maxWidth),width=distance(strip.a,strip.b);
 if(width<config.minWidth||width>config.maxWidth)return null;
 const face=headingAlong(-forward.x,-forward.z),middle={x:(strip.a.x+strip.b.x)/2,z:(strip.a.z+strip.b.z)/2};
 const line={x:middle.x+forward.x*config.lineSetback,z:middle.z+forward.z*config.lineSetback};
 const cars=[],officers=[],count=Math.min(4,Math.max(1,Math.floor(width/4.1)));
 for(let i=0;i<count;i++){
  const s=(i-(count-1)/2)*4.5,p={x:line.x+perp.x*s,z:line.z+perp.z*s,heading:face+(i%2?.58:-.58)};
  if(!carSamples(p).every(([x,z])=>roadAt(world,x,z)))p.heading=face;
  if(!carSamples(p).every(([x,z])=>roadAt(world,x,z)))return null;
  if(world.railAvoidance&&!world.railAvoidance.clear(p))return null;
  cars.push(p);
  for(const side of [-1,1]){
   const o={x:p.x+forward.x*3.4+perp.x*side*1.15,z:p.z+forward.z*3.4+perp.z*side*1.15,heading:face};
   if(walkAt(world,o.x,o.z))officers.push(o);
  }
 }
 if(officers.length<2)return null;
 const plan={centre:middle,strip,cars,officers,forward,perp,face};
 return roadblockClear(plan,world,options)?plan:null;
}
// Work with both prepared simulation graphs and raw imported graphs, without modifying the caller's data. Kept per graph
// (its edges array; rebuilt when an extension adds or replaces edges): the edges with their lengths, the edges leaving each
// node (a prepared graph's own `outgoing`), and a 32 m grid of the segments a car can be found on, in typed arrays (a small
// array per cell kept the young-generation collector copying them: 5-15 ms pauses mid-chase). Scanning every segment in the
// city and rebuilding all this on each attempt took ~80 ms in today's Copenhagen (44k edges); the grid is built a slice at a
// time (yield) the first time it is needed.
const PLAN_CELL=32,planIndexes=new WeakMap();
function* planIndex(graph){
 const list=graph?.edges||[],had=planIndexes.get(list);if(had&&had.raw.length===list.length&&had.raw.every((e,i)=>e===list[i]))return had; // the same edge objects (an edge replaced in place is noticed: ~0.1 ms)
 const edges=[],prepared=Array.isArray(graph?.outgoing)&&list.every(e=>e.cumulative&&Number.isFinite(e.length));let id=0,x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
 const byNode=prepared?null:new Map(),outgoing=prepared?node=>graph.outgoing[node]||[]:node=>byNode.get(node)||[];
 for(const raw of list){
  if(!(raw.points?.length>1))continue;let e=raw;
  if(!prepared){const cumulative=[0];for(let i=1;i<e.points.length;i++)cumulative.push(cumulative.at(-1)+Math.hypot(e.points[i][0]-e.points[i-1][0],e.points[i][1]-e.points[i-1][1]));e={...e,id:e.id??id,cumulative,length:cumulative.at(-1)};if(!byNode.has(e.from))byNode.set(e.from,[]);byNode.get(e.from).push(e);}
  edges.push(e);id++;for(const q of e.points){if(q[0]<x0)x0=q[0];if(q[0]>x1)x1=q[0];if(q[1]<z0)z0=q[1];if(q[1]>z1)z1=q[1];}
  if(id%500===0)yield;
 }
 const gx=Math.floor(x0/PLAN_CELL),gz=Math.floor(z0/PLAN_CELL),W=Math.max(1,Math.floor(x1/PLAN_CELL)-gx+1),H=Math.max(1,Math.floor(z1/PLAN_CELL)-gz+1),start=new Int32Array(W*H+1);
 // Two passes over the safe segments: count per cell, then file (edge, segment) pairs at each cell's offset.
 const each=function*(fill){for(let k=0;k<edges.length;k++){const e=edges[k];if(!unsafeEdge(e))for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i];
  for(let x=Math.floor(Math.min(a[0],b[0])/PLAN_CELL)-gx;x<=Math.floor(Math.max(a[0],b[0])/PLAN_CELL)-gx;x++)for(let z=Math.floor(Math.min(a[1],b[1])/PLAN_CELL)-gz;z<=Math.floor(Math.max(a[1],b[1])/PLAN_CELL)-gz;z++)fill(z*W+x,k,i);}
  if(k%200===199)yield;}};
 yield* each(c=>start[c+1]++);for(let c=0;c<W*H;c++)start[c+1]+=start[c];
 const at=start.slice(0,W*H),pairs=new Int32Array(start[W*H]*2);yield* each((c,k,i)=>{const j=at[c]++;pairs[j*2]=k;pairs[j*2+1]=i;});
 const index={raw:[...list],edges,outgoing,gx,gz,W,H,start,pairs};planIndexes.set(list,index);return index;
}
function pointOn(e,s,offset=0){
 let i=1;while(i<e.points.length-1&&e.cumulative[i]<s)i++;
 const a=e.points[i-1],b=e.points[i],l=e.cumulative[i]-e.cumulative[i-1]||1,t=Math.max(0,Math.min(1,(s-e.cumulative[i-1])/l));
 const dx=(b[0]-a[0])/l,dz=(b[1]-a[1])/l;
 return {x:a[0]+(b[0]-a[0])*t-dz*offset,z:a[1]+(b[1]-a[1])*t+dx*offset,forward:{x:dx,z:dz}};
}
// The road can turn around a corner. Recheck progress on that connected route,
// rather than mistaking an off-screen bend for the player turning away.
export function roadblockDistanceAhead(plan,car){
 const sign=car.speed<0?-1:1,fx=-Math.sin(car.heading)*sign,fz=-Math.cos(car.heading)*sign;
 let best=Infinity,remaining=null;
 for(const {edge,start,distance:travelled} of plan.route||[])for(let i=1;i<edge.points.length;i++){
  const a=edge.points[i-1],b=edge.points[i],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);if(l<.1)continue;
  const alignment=(dx*fx+dz*fz)/l;if(alignment<.4)continue;
  const t=Math.max(0,Math.min(1,((car.x-a[0])*dx+(car.z-a[1])*dz)/(l*l))),d=Math.hypot(car.x-a[0]-dx*t,car.z-a[1]-dz*t),score=d+8*(1-alignment);
  if(d<14&&score<best){best=score;remaining=plan.distanceAhead-(travelled+edge.cumulative[i-1]+l*t-start);}
 }
 return remaining;
}
// The search, as a generator: it yields between pieces of work of well under a millisecond (a slice of the index, a site's
// layout, one point's sight line), so roadblock.js can spread it over frames. planRoadblock runs it through at once.
export function* roadblockSearch(world,graph,car,{config=ROADBLOCK,isVisible=null,eye=null,obstacles=[],heightAt=groundAt}={}){
 if(!car)return null;
 const {edges,outgoing,gx,gz,W,H,start:cellStart,pairs}=yield* planIndex(graph),sign=car.speed<0?-1:1,fx=-Math.sin(car.heading)*sign,fz=-Math.cos(car.heading)*sign;
 car={x:car.x,z:car.z,speed:car.speed,heading:car.heading}; // where the search began: the car drives on while it runs
 let nearest=null,best=Infinity,order=Infinity;
 // The segments within 14 m: the cells around the car (ties go to the earlier edge and segment, as the full scan did).
 for(let x=Math.max(0,Math.floor((car.x-14)/PLAN_CELL)-gx);x<=Math.min(W-1,Math.floor((car.x+14)/PLAN_CELL)-gx);x++)for(let z=Math.max(0,Math.floor((car.z-14)/PLAN_CELL)-gz);z<=Math.min(H-1,Math.floor((car.z+14)/PLAN_CELL)-gz);z++){
  for(let j=cellStart[z*W+x];j<cellStart[z*W+x+1];j++){
   const e=edges[pairs[j*2]],i=pairs[j*2+1],a=e.points[i-1],b=e.points[i],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);if(l<.1)continue;
   const alignment=(dx*fx+dz*fz)/l;if(alignment<.4)continue;
   const t=Math.max(0,Math.min(1,((car.x-a[0])*dx+(car.z-a[1])*dz)/(l*l))),d=Math.hypot(car.x-a[0]-dx*t,car.z-a[1]-dz*t);
   const score=d+8*(1-alignment),o=pairs[j*2]*65536+i;if(d<14&&(score<best||score===best&&o<order)){best=score;order=o;nearest={edge:e,s:e.cumulative[i-1]+l*t};}
  }
 }
 if(!nearest)return null;
 const minAhead=Math.max(config.minAhead,Math.abs(car.speed||0)*(config.warningLead+3.5)),maxAhead=Math.max(config.maxAhead,minAhead+110);
 let edge=nearest.edge,start=nearest.s,travelled=0;const seen=new Set(),route=[];
 while(edge&&travelled<maxAhead&&seen.size<30){
  if(seen.has(edge.id))break;seen.add(edge.id);
  route.push({edge,start,distance:travelled});
  if(!unsafeEdge(edge))for(let s=Math.max(9,start+minAhead-travelled);s<edge.length-config.lineSetback-7&&travelled+s-start<=maxAhead;s+=14){
   const p=pointOn(edge,s,edge.lane||0),further=pointOn(edge,s+config.lineSetback+4,edge.lane||0);
   // Do not span a junction or put the patrol line around a tight bend.
   if(p.forward.x*further.forward.x+p.forward.z*further.forward.z<.97)continue;
   const plan=layout(world,p,p.forward,config,{obstacles,heightAt});yield;
   if(!plan)continue;
   let seenFrom=false;for(const q of [plan.strip.a,plan.strip.b,...plan.cars,...plan.officers]){if(visibleFrom(world,car,q,isVisible,eye,heightAt)){seenFrom=true;break;}yield;} // roadblockVisible, a point at a time
   if(seenFrom)continue;
   const road=world.roads.at(p.x,p.z);
   return {...plan,edgeId:edge.id,roadName:road?.name||edge.name||null,distanceAhead:travelled+s-start,route};
  }
  travelled+=edge.length-start;
  const previous=edge,end=pointOn(edge,edge.length).forward;
  const options=outgoing(edge.to).filter(e=>e.points?.length>1&&e.to!==previous.from&&!seen.has(e.id)&&!unsafeEdge(e)).map(e=>({edge:e,alignment:end.x*pointOn(e,0).forward.x+end.z*pointOn(e,0).forward.z})).filter(o=>o.alignment>-.2).sort((a,b)=>b.alignment-a.alignment);
  edge=options[0]?.edge;start=0;
 }
 return null;
}
export function planRoadblock(world,graph,car,options){const search=roadblockSearch(world,graph,car,options);let r;do r=search.next();while(!r.done);return r.value;}

// A swept segment against the strip's padded footprint also catches a fast
// diagonal crossing whose end position has already passed the end of the strip.
export function crossesStrip(from,to,strip,halfDepth=2.3){
 const ex=strip.b.x-strip.a.x,ez=strip.b.z-strip.a.z,L=Math.hypot(ex,ez);if(L<1)return false;
 const point=p=>[(p.x-strip.a.x)*ex/L+(p.z-strip.a.z)*ez/L,(p.x-strip.a.x)*ez/L-(p.z-strip.a.z)*ex/L];
 const a=point(from),b=point(to);let lo=0,hi=1;
 for(const [i,min,max] of [[0,-1,L+1],[1,-halfDepth,halfDepth]]){
  const delta=b[i]-a[i];if(Math.abs(delta)<1e-9){if(a[i]<min||a[i]>max)return false;continue;}
  const t0=(min-a[i])/delta,t1=(max-a[i])/delta;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));if(lo>hi)return false;
 }
 return true;
}
