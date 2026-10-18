import {leavingBody,nudgeOut} from './contact-geometry.js';
import {prepareGraph,routePoint} from './mobility.js';
import {SpatialIndex,segmentDistance} from './geo.js';
import {BUS_DIMENSIONS} from './bus-simulation.js';
import {boxesOverlap,carBox,oncomingPasses,signalGreen,untilGreen} from './lane-model.js';
export const TRAM_DIMENSIONS={length:27.6,width:2.4,height:3.83,gauge:1,sections:[9.7,7.6,9.7],centres:[0,-8.95,-17.9],front:4.85,rear:22.75};
// Raide-Jokeri (line 15): Škoda ForCity Smart Artic X54, five modules, 34 m, cabs at both ends.
export const JOKERI_DIMENSIONS={length:34.3,width:2.4,height:3.7,gauge:1,sections:[7.9,5.5,6.3,5.5,7.9],centres:[0,-7,-13.2,-19.4,-26.4],front:3.95,rear:30.35,stopAhead:13};
export const tramDims=path=>path?.vehicle==='jokeri'?JOKERI_DIMENSIONS:TRAM_DIMENSIONS;
// Instanced renderer capacity; the base fleet stays small, hotspot feeders add to it.
// Two hotspots feeding four directions at 40–90 s headways keep roughly 10–14
// trams in play around the station (measured).
export const TRAM_FLEET_CAPACITY=24;
// Stretches where several HSL lines overlap. GTFS 2026-09-16 (weekday) gives
// Lasipalatsi 289 departures per platform between 07 and 19 h, a mean gap of
// 2.5 min per direction with lines 1, 2, 4 and 10. The demo feeds the dated
// line 1/2/4 shapes through the stretch a little tighter than that so trams are
// almost always present in both directions, as they are in practice.
// Rautatieasema: the station stops on Kaivokatu (H0201 −621,−28 eastbound and
// H0202 −631,−39 westbound in public/data/trams.json), served by the dated
// line 3/6/7/9 shapes in both directions between Simonkatu and Mikonkatu.
// Other districts keep the small camera-local fleet. Each hotspot's groups
// are one feeder set per travel direction (see the constructor).
// Spawn rules: a feeder enters 420–440 m before its stop and never within
// 120 m of the player; a guaranteed dweller is never placed within `clear`
// metres of the player nor in front of a player within 120 m.
export const TRAM_HOTSPOTS=[
 {name:'Lasipalatsi',x:-800,z:-28,radius:300,approach:440,headway:[50,80],dwell:[12,20],active:700},
 {name:'Rautatieasema',x:-626,z:-34,radius:300,approach:420,headway:[40,70],dwell:[10,18],active:700},
];
// Spawns closer than this and in front of the player would pop into view.
export const SPAWN_VIEW_DISTANCE=120;
// Along-track offsets (m) of the solid footprint published as obstacles.
const BODY_OFFSETS=[3,0,-4,-8.95,-13,-17.9,-21.5],JOKERI_OFFSETS=[2.5,0,-4,-8,-12,-16,-20,-24,-28.6],bodyOffsets=path=>path?.vehicle==='jokeri'?JOKERI_OFFSETS:BODY_OFFSETS;
// True when the player's velocity points clearly away from `point` (more than 120 degrees off the line to it).
export function playerLeaving(player,point){
 const speed=player.speed||0;if(!speed)return false;
 const vx=-Math.sin(player.heading)*Math.sign(speed),vz=-Math.cos(player.heading)*Math.sign(speed),tx=point.x-player.x,tz=point.z-player.z,l=Math.hypot(tx,tz)||1;
 return (vx*tx+vz*tz)/l<-.5;
}
export class TramSimulation{
 constructor(data,world,random=Math.random){
  this.world=world;this.time=0;this.random=random;this.capacity=TRAM_FLEET_CAPACITY;this.nextId=0;this.paths=[];this.stops=[];
  this.addPaths(data);
  this.hotspots=TRAM_HOTSPOTS.map(h=>{
   const groups=new Map();
   for(const path of this.paths){let best=Infinity,s=0;path.points.forEach((q,i)=>{const d=Math.hypot(q[0]-h.x,q[1]-h.z);if(d<best){best=d;s=path.cumulative[i];}});if(best>45||s<h.approach*.5||path.length-s<h.approach*.5)continue;
    const stop=path.stops.find(st=>Math.hypot(st.x-h.x,st.z-h.z)<60)||null;if(stop)s=stop.s-9;
    const dir=((Math.round(routePoint(path,s,0).heading*2/Math.PI)%4)+4)%4,feeder={path,s,entry:Math.max(10,s-h.approach),exit:Math.min(path.length-10,s+h.approach),stop};
    if(feeder.stop)feeder.stop.hotspot=h;if(!groups.has(dir))groups.set(dir,{feeders:[],next:0,index:0});groups.get(dir).feeders.push(feeder);}
   return {...h,groups:[...groups.values()]};
  });
  this.trams=[];this.obstacles=[];this.bodies=[];
 }

 // Lines arriving later (a map extension's transit.json) join the network: rails, stops, crossings.
 // They roam: a few trams are kept near the player (roam()), as the camera-local fleet does at a reset.
 addPaths(data){
  const added=(data.paths||[]).map(p=>prepareGraph({nodes:[p.points[0],p.points.at(-1)],edges:[{...p,shapeId:p.id,from:0,to:1,lane:0}]}).edges[0]),world=this.world;
  this.paths.push(...added);this.stops.push(...(data.stops||[]));if(this.hotspots)for(const p of added)p.roam=true;
  const segments=[];for(const path of this.paths)for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i];segments.push({a,b,heading:Math.atan2(a[0]-b[0],a[1]-b[1]),bbox:[Math.min(a[0],b[0])-2.5,Math.min(a[1],b[1])-2.5,Math.max(a[0],b[0])+2.5,Math.max(a[1],b[1])+2.5]});}
  // Rails in the car's own direction may be shared (cars then follow trams); an oncoming track must be
  // cleared by a whole tram half-width plus the car's, or the two meet head-on.
  // clear(p): no parallel track within a tram's half width plus a car's. onTrack(p): the sideways offset
  // that would centre a car on the nearest same-direction track (a shared lane).
  const index=new SpatialIndex(segments,32),parallel=(p,s)=>Math.abs(Math.cos(s.heading-p.heading))>.88;
  world.railAvoidance={clear:p=>!index.near(p.x,p.z).some(s=>parallel(p,s)&&segmentDistance(p.x,p.z,s.a,s.b)<2.3),
   onTrack:p=>{let best=null,d=2.6;for(const s of index.near(p.x,p.z)){if(Math.cos(s.heading-p.heading)<.88)continue;const dd=segmentDistance(p.x,p.z,s.a,s.b);if(dd<d){d=dd;const ux=s.b[0]-s.a[0],uz=s.b[1]-s.a[1],l=Math.hypot(ux,uz)||1,t=Math.max(0,Math.min(1,((p.x-s.a[0])*ux+(p.z-s.a[1])*uz)/(l*l))),qx=s.a[0]+ux*t-p.x,qz=s.a[1]+uz*t-p.z;best=qx*Math.cos(p.heading)-qz*Math.sin(p.heading);}}return best;}};
  // Stops are genuine HSL points. Project only close stops onto a path, and
  // only stops on the right-hand (door) side of travel (or on the track itself:
  // an OpenStreetMap stop position), so a southbound tram
  // does not also halt at the northbound platform. Stop assignment is spatial
  // rather than a complete timetable/stop-sequence import.
  for(const path of added){path.stops=[];for(const stop of data.stops||[]){let best=7,at=null;for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i],dx=b[0]-a[0],dz=b[1]-a[1],l2=dx*dx+dz*dz,t=Math.max(0,Math.min(1,((stop.x-a[0])*dx+(stop.z-a[1])*dz)/l2)),ox=stop.x-a[0]-dx*t,oz=stop.z-a[1]-dz*t,distance=Math.hypot(ox,oz);if(distance<best&&(ox*-dz+oz*dx>0||distance<1)){best=distance;at=path.cumulative[i-1]+Math.sqrt(l2)*t;}}if(at!==null)path.stops.push({s:at+(tramDims(path).stopAhead||9),name:stop.name,id:stop.id,x:stop.x,z:stop.z});}path.stops.sort((a,b)=>a.s-b.s);}
  // Where another line's track crosses this one or joins it (within a tram's width), sampled every 2 m:
  // a tram gives way at the start of that stretch to a tram already on it or nearer to it. Afterwards
  // trams on a shared track simply follow each other; oncoming tracks are passed.
  const tracks=[];for(const path of this.paths)for(let i=1;i<path.points.length;i++){const a=path.points[i-1],b=path.points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(l>.01)tracks.push({a,b,l,dx:(b[0]-a[0])/l,dz:(b[1]-a[1])/l,path,s0:path.cumulative[i-1],bbox:[Math.min(a[0],b[0])-3,Math.min(a[1],b[1])-3,Math.max(a[0],b[0])+3,Math.max(a[1],b[1])+3]});}
  const trackIndex=new SpatialIndex(tracks,24),nearest=new Map();
  for(const path of this.paths){path.crossTracks=[];const open=new Map();
   for(let s=0;s<=path.length;s+=2){const p=routePoint(path,s,0),ux=-Math.sin(p.heading),uz=-Math.cos(p.heading);nearest.clear();
    for(const g of trackIndex.near(p.x,p.z)){if(g.path===path)continue;const along=Math.max(0,Math.min(g.l,(p.x-g.a[0])*g.dx+(p.z-g.a[1])*g.dz)),d=Math.hypot(p.x-g.a[0]-g.dx*along,p.z-g.a[1]-g.dz*along);if(d>2.6)continue;const o=nearest.get(g.path);if(!o||d<o.d)nearest.set(g.path,{d,dot:ux*g.dx+uz*g.dz,s:g.s0+along});}
    for(const [other,o] of nearest){if(o.dot<-.87&&o.d>1)continue;const run=open.get(other);if(run){run.to=s;run.otherTo=o.s;run.seen=s;}else open.set(other,{from:s,to:s,other,otherS:o.s,otherTo:o.s,merge:o.dot>.87,seen:s});}
    for(const [other,run] of open)if(run.seen!==s){open.delete(other);path.crossTracks.push(run);}
   }
   for(const run of open.values())path.crossTracks.push(run);
   // A joining track conflicts over its first 10 m only; a crossing over its whole width.
   path.crossTracks=path.crossTracks.filter(r=>r.from>0).map(r=>({s:r.from,end:r.merge||r.to-r.from>15?Math.min(r.to,r.from+10):r.to,other:r.other,otherS:Math.min(r.otherS,r.otherTo),otherEnd:Math.min(Math.max(r.otherS,r.otherTo),Math.min(r.otherS,r.otherTo)+12)})).sort((a,b)=>a.s-b.s);
  }
  return added;
 }
 range(a,b){return a+(b-a)*this.random();}
 lastStopIndex(path,s){let i=-1;path.stops.forEach((st,j)=>{if(st.s<=s)i=j;});return i;}
 add(path,s,extra={}){const t={id:this.nextId++,path,s,speed:7,wait:0,lastStop:this.lastStopIndex(path,s),...routePoint(path,s,0),...extra};this.trams.push(t);return t;}
 // True when any part of a tram body at `s` on `path` comes within `radius` of the player.
 bodyNear(path,s,player,radius){return bodyOffsets(path).some(o=>{const p=routePoint(path,s+o,0);return Math.hypot(p.x-player.x,p.z-player.z)<radius;});}
 activeHotspots(player){return this.hotspots.filter(h=>Math.hypot(h.x-player.x,h.z-player.z)<h.active);}
 nearestHotspot(player){let best=null,bestD=Infinity;for(const h of this.hotspots){const d=Math.hypot(h.x-player.x,h.z-player.z);if(d<bestD){bestD=d;best=h;}}return best;}
 // True when a spawn at `p` would appear in front of a nearby player (within SPAWN_VIEW_DISTANCE, ahead of the car).
 inView(player,p,distance=SPAWN_VIEW_DISTANCE){const dx=p.x-player.x,dz=p.z-player.z;if(Math.hypot(dx,dz)>=distance)return false;return -dx*Math.sin(player.heading||0)-dz*Math.cos(player.heading||0)>-8;}
 reset(player){
  // A small fleet near the camera, never random street driving. Each car stays
  // on one of the dated HSL paths, including curves and road crossings.
  this.trams=[];this.nextId=0;
  const hot=this.activeHotspots(player),hotPaths=new Set(hot.flatMap(h=>h.groups.flatMap(g=>g.feeders.map(f=>f.path))));
  const candidates=this.paths.filter(path=>!hotPaths.has(path)).map(path=>{let s=0,best=Infinity;path.points.forEach((p,i)=>{const d=Math.hypot(p[0]-player.x,p[1]-player.z);if(d<best){best=d;s=path.cumulative[i];}});return {path,s,best};}).filter(p=>p.best<650).sort((a,b)=>a.best-b.best);
  for(const candidate of candidates){if(this.trams.length>=6)break;let s=Math.max(28,Math.min(candidate.path.length-40,candidate.s+80+this.trams.length*37)),p=routePoint(candidate.path,s,0);
   for(let i=0;i<12&&this.trams.some(t=>Math.hypot(t.x-p.x,t.z-p.z)<65);i++){s=Math.min(candidate.path.length-40,s+80);p=routePoint(candidate.path,s,0);}
   this.add(candidate.path,s);
  }
  // Busy stretch: start with a tram dwelling at each platform and one
  // approaching per direction, then keep feeding at the hotspot headway.
  // Nothing is seeded on top of a player who starts beside a platform.
  for(const h of hot)for(const g of h.groups){
   const pick=()=>g.feeders[g.index++%g.feeders.length];
   // Lines sharing a platform must not both get a tram seeded on it (they would stand inside each other).
   const free=(path,s)=>{const p=routePoint(path,s,0);return !this.trams.some(t=>Math.hypot(t.x-p.x,t.z-p.z)<34&&Math.cos(t.heading-p.heading)>.3&&Math.abs((t.x-p.x)*Math.cos(p.heading)-(t.z-p.z)*Math.sin(p.heading))<2.6);};
   const atStop=pick();if(atStop.stop&&this.trams.length<this.capacity&&!this.bodyNear(atStop.path,atStop.stop.s,player,10)){
    if(free(atStop.path,atStop.stop.s))this.add(atStop.path,atStop.stop.s,{wait:this.range(4,10),lastStop:atStop.path.stops.indexOf(atStop.stop),hotspot:h,exit:atStop.exit,stop:atStop.stop.name});
    else if(free(atStop.path,atStop.stop.s-36))this.add(atStop.path,atStop.stop.s-36,{speed:0,hotspot:h,exit:atStop.exit});} // next in line behind the tram at the platform
   const f=pick();if(this.trams.length<this.capacity&&free(f.path,f.s-170)&&!this.bodyNear(f.path,f.s-170,player,10))this.add(f.path,f.s-170,{hotspot:h,exit:f.exit});
   g.next=this.time+this.range(20,45);
  }
  this.refreshObstacles();
 }
 // Respawn on the spot after an arrest: trams whose body is within `radius` of
 // the player are removed so the repaired car is not boxed in; the feeders
 // refill the stretch at their headway.
 clearAround(player,radius=32){
  const before=this.trams.length;
  this.trams=this.trams.filter(t=>!this.bodyNear(t.path,t.s,player,radius));
  this.refreshObstacles();return before-this.trams.length;
 }
 // Roaming lines (added paths, e.g. the Raide-Jokeri): keep two to four trams within sight of the player,
 // entering behind the player or over 320 m ahead, and let those left far behind go.
 roam(player){
  if(this.time<(this.roamAt||0))return;this.roamAt=this.time+4;const lines=this.paths.filter(p=>p.roam);if(!lines.length)return;
  const before=this.trams.length;this.trams=this.trams.filter(t=>!t.path.roam||Math.hypot(t.x-player.x,t.z-player.z)<900);
  if(this.trams.filter(t=>t.path.roam&&Math.hypot(t.x-player.x,t.z-player.z)<650).length<4&&this.trams.length<this.capacity){
   const options=[];for(const path of lines)for(let s=40;s<path.length-40;s+=30){const p=routePoint(path,s,0),d=Math.hypot(p.x-player.x,p.z-player.z);if(d>150&&d<600&&!this.inView(player,p,320)&&!this.trams.some(t=>Math.hypot(t.x-p.x,t.z-p.z)<90))options.push({path,s,d});}
   if(options.length){const o=options[Math.floor(this.random()*options.length)];this.add(o.path,o.s);}}
  if(this.trams.length!==before)this.refreshObstacles();
 }
 feed(player){
  for(const h of this.activeHotspots(player))for(const g of h.groups){
   if(this.time<g.next)continue;
   const f=g.feeders[g.index%g.feeders.length],p=routePoint(f.path,f.entry,0);
   const clear=this.trams.length<this.capacity&&Math.hypot(p.x-player.x,p.z-player.z)>SPAWN_VIEW_DISTANCE&&!this.trams.some(t=>Math.hypot(t.x-p.x,t.z-p.z)<70||t.path===f.path&&Math.abs(t.s-f.entry)<70);
   if(!clear){g.next=this.time+3;continue;}
   this.add(f.path,f.entry,{hotspot:h,exit:f.exit});g.index++;g.next=this.time+this.range(...h.headway);
  }
 }
 // Hot zone (finale.js): the stretch around the player must never look empty.
 // Counts trams within `radius` of the hotspot nearest the player; when short,
 // fires the feeders early and places a dwelling tram at an empty platform
 // (never near the player, never in front of a player within view distance).
 guarantee(player,{min=3,radius=150,hotspot=this.nearestHotspot(player),clear=45}={}){
  if(!hotspot)return 0;
  const near=()=>this.trams.filter(t=>Math.hypot(t.x-hotspot.x,t.z-hotspot.z)<radius);
  let count=near().length;if(count>=min)return count;
  for(const g of hotspot.groups){
   const f=g.feeders[g.index%g.feeders.length],stop=f.stop;
   g.next=Math.min(g.next,this.time);
   if(this.trams.length>=this.capacity)continue;
   if(stop){
    const occupied=this.trams.some(t=>Math.hypot(t.x-stop.x,t.z-stop.z)<40||t.path===f.path&&t.s<stop.s&&stop.s-t.s<90);
    if(!occupied&&Math.hypot(player.x-stop.x,player.z-stop.z)>=clear&&!this.inView(player,stop)){this.add(f.path,stop.s,{wait:this.range(8,16),lastStop:f.path.stops.indexOf(stop),hotspot,exit:f.exit,stop:stop.name});g.index++;count++;continue;}
   }
   // The platform is in view (or taken): stage one approaching tram per
   // direction instead, as close to the stretch as the view rule allows, so
   // it rolls in within ~15–30 s rather than the full approach length.
   if(g.feeders.some(o=>this.trams.some(t=>t.path===o.path&&t.s>=o.entry-1&&t.s<o.s)))continue;
   for(let s=(stop?stop.s:f.s)-110;s>=f.entry;s-=25){
    const p=routePoint(f.path,s,0);
    if(this.inView(player,p)||this.bodyNear(f.path,s,player,SPAWN_VIEW_DISTANCE/2)||this.trams.some(t=>Math.hypot(t.x-p.x,t.z-p.z)<70||t.path===f.path&&Math.abs(t.s-s)<70))continue;
    this.add(f.path,s,{hotspot,exit:f.exit});g.index++;count++;break;
   }
  }
  if(count!==near().length)this.refreshObstacles();
  return near().length;
 }
 // Points along each tram for look-ahead checks, and its three section boxes for contact checks.
 // A car or bus the tram body would move into (on a curve the sections sweep outside the look-ahead).
 // actors[0] is the player, which has its own push-out below.
 contact(t,s,actors){
  const D=tramDims(t.path),boxes=D.centres.map((c,i)=>({...routePoint(t.path,s+c,0),hl:D.sections[i]/2,hw:D.width/2}));
  const before=D.centres.map((c,i)=>({...routePoint(t.path,t.s+c,0),hl:D.sections[i]/2,hw:D.width/2}));
  for(let i=1;i<actors.length;i++){const c=actors[i];if(c.edge===null||c.tram||c.walking||c.heading===undefined||Math.abs(c.x-t.x)>40||Math.abs(c.z-t.z)>40)continue;
   const d=c.bus?BUS_DIMENSIONS[c.ref?.kind]:null,box=c.bus?{x:c.ref.x,z:c.ref.z,heading:c.ref.heading,hl:(d?.length||12)/2,hw:(d?.width||2.55)/2}:carBox(c);
   if(!oncomingPasses(t,box)&&boxes.some(b=>boxesOverlap(b,box))&&!before.some(b=>boxesOverlap(b,box)))return c.ref||c;}
  return null;
 }
 refreshObstacles(){this.obstacles=[];this.bodies=[];for(const t of this.trams){const D=tramDims(t.path);for(const offset of bodyOffsets(t.path))this.obstacles.push({...routePoint(t.path,t.s+offset,0),speed:t.speed,edge:true,tram:true,tramId:t.id,ref:t});
  D.centres.forEach((c,i)=>this.bodies.push({...routePoint(t.path,t.s+c,0),hl:D.sections[i]/2,hw:D.width/2,speed:t.speed,ref:t}));}}
 step(dt,player,cars=[]){
  this.time+=dt;this.feed(player);this.roam(player);
  let retire=false;const actors=[player,...cars];
  for(const t of this.trams){t.holdBy=null;
   if(t.wait>0){t.wait=Math.max(0,t.wait-dt);t.speed=0;continue;}
   const p=routePoint(t.path,t.s+5,0),ahead=routePoint(t.path,t.s+16,0);let desired=8.3;
   if(Math.abs(Math.atan2(Math.sin(ahead.heading-p.heading),Math.cos(ahead.heading-p.heading)))>.25)desired=4;
   const next=t.path.stops.find((s,i)=>i>t.lastStop&&s.s>=t.s-.2&&s.s-t.s<30);
   if(next){const remaining=next.s-t.s;if(remaining<.7){t.wait=next.hotspot?this.range(...next.hotspot.dwell):7;t.stop=next.name;t.lastStop=t.path.stops.indexOf(next);t.speed=0;continue;}desired=Math.min(desired,Math.sqrt(Math.max(0,remaining)*1.8));}
   t.stop=null;
   const dx=-Math.sin(p.heading),dz=-Math.cos(p.heading);
   for(const c of actors){if(c.edge===null)continue;const x=c.x-p.x,z=c.z-p.z,along=x*dx+z*dz,side=Math.abs(x*dz-z*dx);if(along>0&&along<20&&side<2.2&&!oncomingPasses(t,c)){const v=Math.max(0,(along-4)*.7);if(v<desired){desired=v;t.holdBy=c.ref||c;}}}
   const D=tramDims(t.path),front=t.s+D.front+.05;t.redFor=0;
   // Junction signals (mobility.attachTrams adds the stop lines): stop at red when there is room to.
   for(const g of t.path.signalStops||[]){const gap=g.s-front;if(gap<0)continue;if(gap>40)break;
    if(!signalGreen(g.signal,g.group,this.time)&&gap>t.speed*t.speed/4-.5){t.redFor=untilGreen(g.signal,g.group,this.time);const v=Math.sqrt(3*Math.max(0,gap-1));if(v<desired){desired=v;t.holdBy=null;}}break;}
   for(const x of t.path.crossTracks){const gap=x.s-1.5-front;if(gap<0)continue;if(gap>30)break;
    for(const o of this.trams){if(o===t||o.path!==x.other)continue;const oD=tramDims(o.path),oFront=o.s+oD.front+.05,oGap=x.otherS-1.5-oFront;
     if((oGap<0&&o.s-oD.rear-.05<x.otherEnd+1.5)||(oGap>=0&&oGap<30&&(oGap<gap-2||Math.abs(oGap-gap)<=2&&o.id<t.id))){const v=Math.max(0,(gap-1)*.7);if(v<desired){desired=v;t.holdBy=o;}}}}
   // Follow only trams running the same way: the opposite track is sometimes
   // under 2.3 m away in the GTFS shapes and would otherwise deadlock both platforms.
   for(const other of this.trams){if(other===t||Math.cos(other.heading-t.heading)<.3)continue;const x=other.x-t.x,z=other.z-t.z,along=x*dx+z*dz,side=Math.abs(x*dz-z*dx);if(along>0&&along<45+D.length-27.6&&side<2.3){const v=Math.max(0,(along-tramDims(other.path).rear-D.front-4.4)*.5);if(v<desired){desired=v;t.holdBy=other;}}}
   t.speed+=Math.max(-2.2*dt,Math.min(1.1*dt,desired-t.speed));
   const ns=Math.min(t.path.length,t.s+t.speed*dt),by=t.speed>0&&this.contact(t,ns,actors);
   if(by){t.speed=0;t.holdBy=by;}else{t.s=ns;Object.assign(t,routePoint(t.path,t.s,0));}
   const far=Math.hypot(t.x-player.x,t.z-player.z)>450;
   if(t.hotspot&&far&&(t.s>t.exit||Math.hypot(t.x-t.hotspot.x,t.z-t.hotspot.z)>t.hotspot.active)){t.retired=true;retire=true;continue;}
   if(t.s>=t.path.length-1){t.speed=0;if(t.hotspot){t.retired=true;retire=true;}else if(far){t.s=28;t.lastStop=-1;}}
  }
  if(retire)this.trams=this.trams.filter(t=>!t.retired);
  this.refreshObstacles();
  // Solid articulated footprint; do not let the player pass through a tram.
  // A player backing clearly away from the section keeps that speed: nose-on
  // against a tram with the platform on the free side, the sideways nudge
  // below has nowhere to go and the car would otherwise be stuck for good.
  for(const t of this.trams){const D=tramDims(t.path);for(let i=0;i<D.centres.length;i++){const p=routePoint(t.path,t.s+D.centres[i],0),c=Math.cos(p.heading),s=Math.sin(p.heading),dx=player.x-p.x,dz=player.z-p.z,side=dx*c-dz*s,along=dx*s+dz*c;
   const sideClear=D.width/2+(player.halfWidth??.95),endClear=player.halfLength??2.2;
   if(!player.cinematic&&Math.abs(side)<sideClear&&Math.abs(along)<D.sections[i]/2+endClear){ /* the trailer's car is placed, not pushed (cinematic.js keeps it out of the way) */
    // A real knock (not resting against it) jolts the passengers; trams.js animates them from hitAt/hitSide.
    if(Math.abs(player.speed)>1.2&&!(this.time-(t.hitAt??-1e9)<3)){t.hitAt=this.time;t.hitSide=side<0?-1:1;}
    if(!leavingBody(player,dt,p))player.speed=0;t.speed=0;nudgeOut(player,p.heading,(sideClear+.05-Math.abs(side))*(side<0?-1:1),this.world);}
  }}
 }
 snapshot(){return this.trams.map(t=>({id:t.id,vehicle:t.path.vehicle||'artic',line:t.path.line,destination:t.path.destination,x:t.x,z:t.z,heading:t.heading,speed:t.speed,waiting:t.wait>0,stop:t.wait>0?t.stop||null:null,hotspot:t.hotspot?.name||null}));}
}
