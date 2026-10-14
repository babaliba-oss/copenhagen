// How car lanes relate to junctions and tram tracks. Computed once per city from the road graph and the
// tram paths; mobility.js uses it every frame to decide where a car may stop and when it may go.
//  - Junctions: a node where three or more streets meet. A car stops before the lanes that cross it
//    (stopGap), never inside them, and does not enter unless it can also leave (exit space).
//  - Signals: one signal controls the cluster of junction nodes around it. Only the edges that enter the
//    cluster stop at red; edges inside it are already committed. Approaches are grouped along the
//    junction's own axes, so crossing approaches never share a green.
//  - Tram tracks: where a lane crosses a track the car keeps the track clear (does not cross in front of a
//    tram and never stops on the rails); where a lane runs along a track the car shares it and follows
//    trams; where a lane joins a track it gives way to a tram coming along it.
import {SpatialIndex} from './geo.js';
export const CAR_HALF_LENGTH=2.36,CAR_HALF_WIDTH=.98,TRACK_HALF_WIDTH=1.35;
// Oncoming vehicles more than this apart sideways are on parallel tracks or lanes and pass each other. The
// mapped opposite tracks are sometimes closer than a tram's width, and trams on them already pass.
export const ONCOMING_PASS=1;
// A shared lane: lane centre within this of a same-direction track. Crossings: angle over ~30 degrees.
const CROSSING_COS=.87,CONFLICT=TRACK_HALF_WIDTH+.98+.1;
const headingOf=(dx,dz)=>Math.atan2(-dx,-dz);
export function signalGroup(heading,axis){return Math.abs(Math.cos(heading-axis))>.707;}
// The fixed 32 s cycle: group A green 0–13 s, all red, group B green 16–29 s, all red. Each signal is offset.
export function signalGreen(id,group,time){const phase=(time+id*2.13)%32;return group?phase<13:phase>=16&&phase<29;}
export function untilGreen(id,group,time){const phase=(time+id*2.13)%32;return group?(phase<13?0:32-phase):(phase>=16&&phase<29?0:(phase<16?16-phase:48-phase));}
// Junction geometry and signal control on a prepared road graph (edges carry id, length, cumulative).
export function annotateJunctions(graph,signals=[]){
 const {nodes,edges}=graph,n=nodes.length,neighbours=Array.from({length:n},()=>new Set());
 for(const e of edges){neighbours[e.from].add(e.to);neighbours[e.to].add(e.from);}
 const junction=graph.junctionNode=neighbours.map(s=>s.size>=3),reach=new Float64Array(n);
 for(const e of edges)for(const k of [e.from,e.to])reach[k]=Math.max(reach[k],Math.abs(e.lane||0)+CAR_HALF_WIDTH+.5);
 // Signals within 35 m of each other run as one junction (one phase plan), so a car is not stopped
 // again a few metres after the first stop line by an unsynchronised neighbour.
 const canon=signals.map((_,i)=>i);
 for(let i=0;i<signals.length;i++)if(canon[i]===i)for(let j=i+1;j<signals.length;j++)if(canon[j]===j&&Math.hypot(signals[i].p[0]-signals[j].p[0],signals[i].p[1]-signals[j].p[1])<35)canon[j]=i;
 for(const e of edges){e.mappedSignal=e.signal;if(e.signal>=0&&signals[e.signal])e.signal=canon[e.signal];}
 // Each junction node belongs to the nearest signal whose mapped edges end around it.
 const owner=new Int32Array(n).fill(-1),best=new Float64Array(n).fill(Infinity),used=new Set();
 for(const e of edges){const p=signals[e.signal]?.p;if(!p)continue;used.add(e.signal);
  for(const k of [e.from,e.to]){if(!junction[k])continue;const d=Math.hypot(nodes[k][0]-p[0],nodes[k][1]-p[1]);if(d<30&&d<best[k]){best[k]=d;owner[k]=e.signal;}}}
 // A signal with no junction around it (a mid-block crossing) controls the mapped node nearest to it.
 const owned=new Set(owner);
 for(const i of used){if(owned.has(i))continue;const p=signals[i].p;let k=-1,d=30;
  for(const e of edges)if(e.signal===i){const q=nodes[e.to],dd=Math.hypot(q[0]-p[0],q[1]-p[1]);if(dd<d&&owner[e.to]<0){d=dd;k=e.to;}}
  if(k>=0)owner[k]=i;}
 const sums=new Map();
 for(const e of edges){
  e.junction=junction[e.to]||owner[e.to]>=0;e.stopGap=CAR_HALF_LENGTH+Math.max(2.2,reach[e.to]);e.startGap=Math.max(2.2,reach[e.from])+CAR_HALF_LENGTH;
  e.signal=owner[e.to]>=0&&owner[e.from]!==owner[e.to]?owner[e.to]:-1;
  e.inside=owner[e.to]>=0&&owner[e.from]===owner[e.to];
  if(e.signal>=0){const a=e.points.at(-2),b=e.points.at(-1),h=headingOf(b[0]-a[0],b[1]-a[1]);e.endHeading=h;const s=sums.get(e.signal)||[0,0];s[0]+=Math.sin(4*h);s[1]+=Math.cos(4*h);sums.set(e.signal,s);}
 }
 placeStopLines(graph,reach,junction,owner);
 const axes=[],radius=[];for(const [i,[s,c]] of sums)axes[i]=Math.atan2(s,c)/4;
 for(const e of edges)if(e.signal>=0){e.signalAxis=axes[e.signal];e.signalGroup=signalGroup(e.endHeading,e.signalAxis);}
 // The controlled area: every node of the cluster plus the width of a junction box and its tracks.
 for(let k=0;k<n;k++){const id=owner[k];if(id<0||axes[id]===undefined)continue;const p=signals[id].p;radius[id]=Math.max(radius[id]||12,Math.hypot(nodes[k][0]-p[0],nodes[k][1]-p[1])+12);}
 return {axes,radius,canon};
}
// Signalled pedestrian crossings walk with the parallel car flow of the same junction, never across a green.
export function annotateCrossings(walks,{axes,canon}){
 for(const e of walks.edges){if(!(e.signal>=0)||!e.crossing)continue;const id=canon[e.signal]??e.signal,axis=axes[id];if(axis===undefined)continue;
  const a=e.points[0],b=e.points.at(-1);e.signal=id;e.signalGroup=signalGroup(Math.atan2(a[0]-b[0],a[1]-b[1]),axis);}
}
// Trams obey the same signals: a tram path gets a stop line where it enters a signal's controlled area
// (around the cluster's nodes, wide enough to hold every lane and track conflict), in the signal group of
// the heading it leaves the area with.
export function annotateTramSignals(paths,signals,{axes,radius}){
 for(const path of paths){path.signalStops=[];let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;for(const q of path.points){if(q[0]<x0)x0=q[0];if(q[0]>x1)x1=q[0];if(q[1]<z0)z0=q[1];if(q[1]>z1)z1=q[1];}
  for(const [id,axis] of axes.entries()){if(axis===undefined)continue;const [px,pz]=signals[id].p,r=radius[id];if(px+r<x0||px-r>x1||pz+r<z0||pz-r>z1)continue;let inside=false,stop=null; // signal nowhere near this path
   for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i];if(Math.min(a[0],b[0])>px+r||Math.max(a[0],b[0])<px-r||Math.min(a[1],b[1])>pz+r||Math.max(a[1],b[1])<pz-r){inside=false;continue;}
    const l=path.cumulative[i]-path.cumulative[i-1];for(let t=0;t<=l;t+=1){const x=a[0]+(b[0]-a[0])*t/(l||1),z=a[1]+(b[1]-a[1])*t/(l||1),now=Math.hypot(x-px,z-pz)<r;
     const heading=Math.atan2(a[0]-b[0],a[1]-b[1]);
     if(now&&!inside)path.signalStops.push(stop={s:path.cumulative[i-1]+t,signal:id,group:signalGroup(heading,axis)});
     else if(now&&stop)stop.group=signalGroup(heading,axis); // the heading it leaves with: a turning tram runs with the street it turns into
     inside=now;}}
  }
  path.signalStops.sort((a,b)=>a.s-b.s);
 }
}
// A point `s` metres along an edge, on its lane (no corner blending).
function lanePoint(e,s){const pts=e.points,cum=e.cumulative;let i=1;while(i<pts.length-1&&cum[i]<s)i++;const a=pts[i-1],b=pts[i],l=cum[i]-cum[i-1]||1,t=Math.max(0,Math.min(1,(s-cum[i-1])/l)),dx=(b[0]-a[0])/l,dz=(b[1]-a[1])/l,lane=e.lane||0;return {x:a[0]+(b[0]-a[0])*t-dz*lane,z:a[1]+(b[1]-a[1])*t+dx*lane,dx,dz};}
// Stop lines where a waiting car clears every lane through the junction, not only the straight cross lanes:
// on a skewed or multi-node junction the turning lanes cut across an approach well before its node.
function placeStopLines(graph,reach,junction,owner){
 const {edges,nodes}=graph,lanes=new Map();
 const add=(k,e,from,to)=>{let list=lanes.get(k);if(!list)lanes.set(k,list=[]);for(let s=Math.max(0,from);s<=Math.min(e.length,to);s+=1)list.push({...lanePoint(e,s),e});};
 for(const e of edges){
  if(junction[e.to])add(e.to,e,e.length-reach[e.to]-1,e.length);
  if(junction[e.from])add(e.from,e,0,reach[e.from]+CAR_HALF_LENGTH+2);
  if(owner[e.to]>=0&&owner[e.from]===owner[e.to]){add(e.to,e,0,e.length);add(e.from,e,0,e.length);}
 }
 for(const e of edges){if(!e.junction||e.inside)continue;const near=lanes.get(e.to);if(!near)continue;
  const hw=CAR_HALF_WIDTH+.15,hl=CAR_HALF_LENGTH+.3;
  for(let s=e.length-e.stopGap;s>=Math.max(0,e.length-25);s-=.5){const p=lanePoint(e,s);
   const clear=!near.some(q=>{if(q.e===e)return false;const x=q.x-p.x,z=q.z-p.z;return Math.abs(x*p.dx+z*p.dz)<hl&&Math.abs(-x*p.dz+z*p.dx)<hw+CAR_HALF_WIDTH;});
   if(clear){e.stopGap=e.length-s;break;}}}
}
// Tram relations for every road edge, sampled along the lane every metre:
//  tramShared: runs where the lane lies on or beside a same-direction track ({from,to,path,trackFrom});
//    cars there follow trams and trams follow them.
//  tramConflicts: runs where a car body in the lane would touch a tram on a track it does not share
//    ({from,to,path,trackLo,trackHi,afterShared}): crossings, tracks swinging across the lane, a car leaving
//    or joining a track. A car enters such a run only when no tram is on or about to reach that stretch.
// Oncoming tracks further than ONCOMING_PASS from the lane are passed, like trams pass each other.
export function annotateTramRelations(edges,paths){
 const segments=[];
 for(const path of paths)for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(l<.01)continue;
  segments.push({a,b,l,dx:(b[0]-a[0])/l,dz:(b[1]-a[1])/l,path,s0:path.cumulative[i-1],bbox:[Math.min(a[0],b[0])-3,Math.min(a[1],b[1])-3,Math.max(a[0],b[0])+3,Math.max(a[1],b[1])+3]});}
 const index=new SpatialIndex(segments,24),found=new Set(),best=new Map();
 const near=(x,z)=>{for(const s of index.near(x,z))found.add(s);};
 for(const e of edges){
  e.tramConflicts=null;e.tramShared=null;e.zones=null;if(!segments.length)continue;
  const lane=e.lane||0,pts=e.points,line=[];
  for(let i=0;i<pts.length;i++){const a=pts[Math.max(0,i-1)],b=pts[Math.min(pts.length-1,i+1)],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1,dx=(b[0]-a[0])/l,dz=(b[1]-a[1])/l;line.push([pts[i][0]-dz*lane,pts[i][1]+dx*lane]);}
  found.clear();
  for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let t=0;t<=l;t+=8)near(a[0]+(b[0]-a[0])*t/l,a[1]+(b[1]-a[1])*t/l);near(b[0],b[1]);}
  if(!found.size)continue;
  const shared=[],conflicts=[],open=new Map();
  const close=(path,kind)=>{const k=kind+path.shapeId,run=open.get(k);if(run){(kind==='s'?shared:conflicts).push(run);open.delete(k);}};
  for(let i=1;i<line.length;i++){const p=line[i-1],q=line[i],l=Math.hypot(q[0]-p[0],q[1]-p[1]);if(l<.01)continue;const ux=(q[0]-p[0])/l,uz=(q[1]-p[1])/l,s0=e.cumulative[i-1],k=(e.cumulative[i]-s0)/l;
   for(let t=0;t<=l;t+=1){const x=p[0]+ux*t,z=p[1]+uz*t,s=s0+t*k;best.clear();
    for(const g of found){const along=Math.max(0,Math.min(g.l,(x-g.a[0])*g.dx+(z-g.a[1])*g.dz)),d=Math.hypot(x-g.a[0]-g.dx*along,z-g.a[1]-g.dz*along);if(d>=CONFLICT)continue;const o=best.get(g.path);if(!o||d<o.d)best.set(g.path,{d,dot:ux*g.dx+uz*g.dz,trackS:g.s0+along});}
    for(const [path,o] of best){
     // A same-direction track close beside the lane counts as shared: mobility.js puts the car either clear
     // of it or on it, never straddling its edge.
     const kind=o.dot>CROSSING_COS?'s':o.dot<-CROSSING_COS&&o.d>ONCOMING_PASS?null:'c';
     for(const other of ['s','c'])if(other!==kind)close(path,other);
     if(!kind)continue;const key=kind+path.shapeId,run=open.get(key);
     if(run){run.to=s;run.trackLo=Math.min(run.trackLo,o.trackS);run.trackHi=Math.max(run.trackHi,o.trackS);}
     else open.set(key,{from:s,to:s,path,trackFrom:o.trackS,trackLo:o.trackS,trackHi:o.trackS,afterShared:kind==='c'&&shared.some(r=>r.path===path&&s-r.to<2.5)});
    }
    for(const [key,run] of open)if(!best.has(run.path))close(run.path,key[0]);
   }
  }
  for(const [key,run] of [...open])close(run.path,key[0]);
  const keep=shared.filter(r=>r.to-r.from>=3||r.from<1||r.to>e.length-1);
  if(keep.length)e.tramShared=keep;
  if(conflicts.length)e.tramConflicts=conflicts.sort((a,b)=>a.from-b.from);
 }
}
// A tram on `path` that makes the track stretch [lo,hi] unsafe to enter within `window` seconds: one
// already over it, or one arriving before a car could clear it.
const TRAM_FRONT=4.9,TRAM_REAR=22.8;
export function tramThreat(trams,path,lo,hi,window){
 for(const t of trams){if(t.path!==path)continue;const front=t.s+TRAM_FRONT,rear=t.s-TRAM_REAR;
  if(rear<hi+TRACK_HALF_WIDTH&&front>lo-TRACK_HALF_WIDTH)return t;
  if(front<lo){const gap=lo-front;if(gap>90)continue;const speed=Math.max(t.speed,t.wait>0||t.redFor>0?0:3),eta=(t.wait||0)+(t.redFor||0)+gap/Math.max(speed,3);if(eta<window||gap<6&&!(t.redFor>0))return t;}}
 return null;
}
// Separating-axis test for two oriented boxes {x,z,heading,hl,hw} (hl along the heading).
export function boxesOverlap(a,b){
 const dx=b.x-a.x,dz=b.z-a.z,r=a.hl+a.hw+b.hl+b.hw;if(dx*dx+dz*dz>r*r)return false;
 const ac=Math.cos(a.heading),as=Math.sin(a.heading),bc=Math.cos(b.heading),bs=Math.sin(b.heading);
 // Axes: side (cos,-sin) and along (sin,cos) of each box.
 const test=(vx,vz)=>{const proj=(c,s,hw,hl)=>hw*Math.abs(vx*c-vz*s)+hl*Math.abs(vx*s+vz*c);return Math.abs(dx*vx+dz*vz)<proj(ac,as,a.hw,a.hl)+proj(bc,bs,b.hw,b.hl);};
 return test(ac,-as)&&test(as,ac)&&test(bc,-bs)&&test(bs,bc);
}
export function oncomingPasses(a,b){if(Math.cos((a.heading||0)-(b.heading||0))>-.7)return false;const dx=-Math.sin(a.heading),dz=-Math.cos(a.heading);return Math.abs((b.x-a.x)*dz-(b.z-a.z)*dx)>ONCOMING_PASS;}
export const carBox=(p,grow=0)=>({x:p.x,z:p.z,heading:p.heading,hl:(p.halfLength??CAR_HALF_LENGTH)+grow,hw:(p.halfWidth??CAR_HALF_WIDTH)+grow});
