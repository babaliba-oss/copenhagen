import * as THREE from 'three';
import {SpatialIndex,segmentDistance,pointInRing} from './geo.js';
import {routePoint} from './mobility.js';
import {scooterGeometry,micromobilityMaterial,OPERATORS} from './parked-micromobility.js';
import {createPersonBatch,personLook,advanceGait} from './person-model.js';
import {PLAYER_SCOOTER} from './player-ride-models.js';
import {applyImpactPose} from './impact-pose.js';
import {groundAt} from './terrain.js';

export const SCOOTER_RIDER_LIMIT=12;
export const SCOOTER_RIDER_RANGE=240;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const hash=n=>((Math.imul(n+31,2654435761)>>>0)%10007)/10007;
const cycleKind=kind=>/pyör|cycle|yhdistetty|kevyt|\bpp\b/i.test(kind||'');
const forbiddenKind=kind=>/portaat|stair|steps|polku|unpaved/i.test(kind||'');
const BODY={halfWidth:.24,halfLength:.56,trees:false}; // they follow mapped paths under tree rows: trunks never strand them
// Coastal polygons can have thousands of vertices. Cache only the nearby rings
// we actually query, and test the edges crossing the point's horizontal band.
// This preserves the polygon/hole test without scanning the whole coast each frame.
const ringBands=new WeakMap(),BAND=32;
function inRing(x,z,ring){
 if(ring.length<32)return pointInRing(x,z,ring);
 let bands=ringBands.get(ring);
 if(!bands){
  bands=new Map();
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
   const a=ring[i],b=ring[j];if(a[1]===b[1])continue;
   const lo=Math.floor(Math.min(a[1],b[1])/BAND),hi=Math.floor(Math.max(a[1],b[1])/BAND);
   if(hi-lo>10000)return pointInRing(x,z,ring);
   for(let band=lo;band<=hi;band++){if(!bands.has(band))bands.set(band,[]);bands.get(band).push([a,b]);}
  }
  ringBands.set(ring,bands);
 }
 let inside=false;
 for(const [a,b] of bands.get(Math.floor(z/BAND))||[])if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 return inside;
}
function at(index,x,z){
 if(!index?.near)return index?.at(x,z);
 for(const p of index.near(x,z)){
  const b=p.bbox;if(p.disabled||x<b[0]||x>b[2]||z<b[1]||z>b[3]||!inRing(x,z,p.rings[0]))continue;
  if(p.rings.slice(1).every(ring=>!inRing(x,z,ring)))return p;
 }
}
const pathOf=edge=>{
 const points=edge.points,cumulative=[0];
 for(let i=1;i<points.length;i++)cumulative.push(cumulative.at(-1)+Math.hypot(points[i][0]-points[i-1][0],points[i][1]-points[i-1][1]));
 return {points,cumulative,length:cumulative.at(-1),lane:0};
};

// Use the active city's surveyed/OSM surfaces and walking-network polylines.
// A missing safe connection ends a route; riders never cut across a road to join it.
export function createScooterSafety(world){
 const water=Array.isArray(world.water)?new SpatialIndex(world.water):world.water;
 const buildings=world.collisionBuildings||world.buildings;
 const safe=(x,z)=>{
  const surface=at(world.pavement,x,z);
  if(!surface||forbiddenKind(surface.kind)||at(buildings,x,z)||at(world.roads,x,z))return false;
  return /silta|bridge/i.test(surface.kind||'')||!at(water,x,z);
 };
 const footprint=p=>{
  if(!safe(p.x,p.z)||world.objects?.overlap(p,BODY))return false;
  const x=Math.cos(p.heading)*.24,z=-Math.sin(p.heading)*.24;
  return safe(p.x+x,p.z+z)&&safe(p.x-x,p.z-z);
 };
 return {safe,footprint};
}

function* scooterRouteBatches(graph,world,focus,{limit=32,radius=320}={}){
 const safety=createScooterSafety(world),seen=new Set(),candidates=[];
 for(const edge of graph?.edges||[]){
  if(edge.crossing||forbiddenKind(edge.kind)||!Array.isArray(edge.points)||edge.points.length<2)continue;
  const a=edge.points[0],b=edge.points.at(-1),mid=edge.points[Math.floor(edge.points.length/2)];
  if(![a,b,mid].every(p=>p.every(Number.isFinite)))continue;
  const key=[`${a[0]},${a[1]}`,`${b[0]},${b[1]}`].sort().join('|')+`|${edge.points.length}`;
  if(seen.has(key))continue;seen.add(key);
  const distance=Math.min(Math.hypot(a[0]-focus.x,a[1]-focus.z),Math.hypot(b[0]-focus.x,b[1]-focus.z),Math.hypot(mid[0]-focus.x,mid[1]-focus.z));
  if(distance>radius)continue;
  candidates.push({edge,distance,key});
 }
 candidates.sort((a,b)=>a.distance-b.distance);
 const routes=[];
 for(const {edge,key,distance} of candidates.slice(0,180)){
  const path=pathOf(edge);if(path.length<16||path.length>900)continue;
  let start=null;
  const finish=end=>{
   if(start!==null&&end-start>=16){
    const from=start+.6,to=end-.6,mid=routePoint(path,(from+to)/2,0),surface=world.pavement.at(mid.x,mid.z);
    routes.push({id:`${key}:${from.toFixed(1)}`,path,start:from,end:to,length:to-from,distance,
     cycleway:cycleKind(surface?.kind),sourceEdge:edge});
   }
   start=null;
  };
  const n=Math.ceil(path.length);
  for(let i=0;i<=n;i++){
   const s=path.length*i/n,p=routePoint(path,s,0);
   if(safety.footprint(p)){if(start===null)start=s;}else finish(path.length*(i-1)/n);
  }
  finish(path.length);
  yield;
  if(routes.length>=limit*2)break;
 }
 routes.sort((a,b)=>(a.distance+(a.cycleway?0:35)-Math.min(a.length,100)*.15)-(b.distance+(b.cycleway?0:35)-Math.min(b.length,100)*.15));
 return routes.slice(0,limit);
}

export function collectScooterRoutes(graph,world,focus,options){
 const batches=scooterRouteBatches(graph,world,focus,options);let result;
 do{result=batches.next();}while(!result.done);
 return result.value;
}

export class ScooterRiders{
 constructor(graph,world,{count=10}={}){
  this.graph=graph;this.world=world;this.safety=createScooterSafety(world);this.time=0;this.routes=[];this.dirty=true;this.collisions=0;
  this.capacity=clamp(Number.isFinite(count)?Math.floor(count):10,0,SCOOTER_RIDER_LIMIT);
  this.actors=Array.from({length:this.capacity},(_,i)=>({id:`scooter-rider-${i}`,index:i,edge:null,x:0,z:0,heading:0,speed:0,distance:0,direction:i%2?-1:1,wait:0,blocked:0,playerTaken:false,operator:OPERATORS[i%OPERATORS.length]}));
  this.rideSources=this.actors.map(actor=>({id:actor.id,mode:'scooter',label:'Electric scooter',actor,
   visual:{kind:'scooter',color:actor.operator.accent,accent:actor.operator.accent,operator:actor.operator.name},
   canClaim:()=>!!actor.edge&&!actor.playerTaken&&!actor.disabled&&!actor.knockdown&&Number.isFinite(actor.x)&&Number.isFinite(actor.z)&&Math.abs(actor.speed)<=1.2,
   claim(){
    if(!this.canClaim())return false;
    actor.playerTaken=true;actor.speed=0;return true;
   },
   release:()=>{actor.playerTaken=false;actor.disabled=false;actor.speed=0;actor.wait=1;actor.blocked=0;},
  }));
 }
 get riders(){return this.actors.filter(a=>a.edge&&!a.playerTaken&&!a.disabled);}
 refreshRoutes(graph=this.graph,world=this.world){this.graph=graph;this.world=world;this.safety=createScooterSafety(world);this.pending=null;this.dirty=true;}
 pool(player){this.pending=null;this.routes=collectScooterRoutes(this.graph,this.world,player);this.anchor={x:player.x,z:player.z};this.refreshed=this.time;this.dirty=false;}
 refreshPool(player){
  if(!this.pending){this.pendingFocus={x:player.x,z:player.z};this.pending=scooterRouteBatches(this.graph,this.world,this.pendingFocus);this.dirty=false;}
  // Discover the next neighbourhood over several frames; keep existing routes
  // and claimed vehicles alive while this bounded work is in progress.
  const until=performance.now()+2;
  for(let i=0;i<4&&performance.now()<until;i++){
   const result=this.pending.next();
   if(result.done){this.routes=result.value;this.anchor=this.pendingFocus;this.refreshed=this.time;this.pending=null;break;}
  }
 }
 point(actor,s=actor.s){const p=routePoint(actor.route.path,s,0);if(actor.direction<0)p.heading+=Math.PI;return p;}
 spawn(actor,player){
  actor.edge=null;actor.speed=0;
  for(let i=0;i<this.routes.length;i++){
   const route=this.routes[(i+actor.index)%this.routes.length];
   for(let j=0;j<5;j++){
    const s=route.start+route.length*(.12+.76*hash(actor.index*31+j*7+i*13)),p=routePoint(route.path,s,0),d=Math.hypot(p.x-player.x,p.z-player.z);
    if(d<8||d>SCOOTER_RIDER_RANGE-15||!this.safety.footprint(p)||this.actors.some(a=>a!==actor&&a.edge&&!a.playerTaken&&Math.hypot(a.x-p.x,a.z-p.z)<8))continue;
    actor.route=route;actor.edge=route.sourceEdge;actor.s=s;actor.cruise=route.cycleway?3.2+hash(actor.index)*.8:1.9+hash(actor.index)*.5;
    actor.wait=0;actor.blocked=0;Object.assign(actor,this.point(actor));return true;
   }
  }
  return false;
 }
 reset(player){
  if(!this.actors.length)return; // no riders (Copenhagen): no route discovery either
  this.pool(player);
  for(const actor of this.actors)if(!actor.playerTaken&&!actor.knockdown)actor.edge=null;
  for(const actor of this.actors)if(!actor.playerTaken&&!actor.knockdown)this.spawn(actor,player);
 }
 step(dt,player,{people=[],vehicles=[],impacts=null}={}){
  dt=clamp(dt,0,.1);this.time+=dt;if(!this.actors.length)return;
  if(!this.anchor)this.pool(player);
  else if(this.pending||this.dirty||(this.time-this.refreshed>2&&Math.hypot(player.x-this.anchor.x,player.z-this.anchor.z)>140))this.refreshPool(player);
  for(const actor of this.actors){
   if(actor.playerTaken||actor.disabled||actor.knockdown){actor.speed=0;continue;}
   if(!actor.edge||Math.hypot(actor.x-player.x,actor.z-player.z)>SCOOTER_RIDER_RANGE+90){this.spawn(actor,player);if(!actor.edge)continue;}
   if(actor.wait>0){actor.wait=Math.max(0,actor.wait-dt);actor.speed=0;continue;}
   const forwardX=-Math.sin(actor.heading),forwardZ=-Math.cos(actor.heading),stopping=1.6+actor.speed*actor.speed/7;
   const ahead=(other,radius=.9)=>{
    if(!other||other===actor||other.playerTaken||other.disabled||other.edge===null)return false;
    const body=other.knockdown?.body||other,dx=body.x-actor.x,dz=body.z-actor.z;
    const along=dx*forwardX+dz*forwardZ,lateral=Math.abs(dx*forwardZ-dz*forwardX);
    return along>-radius&&along<stopping+radius&&lateral<radius;
   };
   const approached=(player.walking||player.travelMode==='walk')&&Math.hypot(actor.x-player.x,actor.z-player.z)<3.4;
   const blocked=approached||ahead(player,1.4)||people.some(p=>ahead(p,1))||vehicles.some(v=>ahead(v,1.7))||this.actors.some(a=>ahead(a,.85));
   actor.blocked=blocked?actor.blocked+dt:0;
   const target=blocked?0:actor.cruise;
   actor.speed+=clamp(target-actor.speed,-5*dt,1.5*dt);
   const nextS=clamp(actor.s+actor.direction*actor.speed*dt,actor.route.start,actor.route.end),p=this.point(actor,nextS);
   const distance=Math.hypot(p.x-actor.x,p.z-actor.z),samples=Math.max(1,Math.ceil(distance/.2));
   let safe=true;
   for(let i=1;i<=samples;i++)if(!this.safety.footprint({x:actor.x+(p.x-actor.x)*i/samples,z:actor.z+(p.z-actor.z)*i/samples,heading:p.heading})){safe=false;break;}
   if(safe&&distance>.0001&&this.world.objects?.blocksStep(actor,p,BODY))safe=false;
   const contact=(other,radius)=>{
    if(!other||other===actor||other.playerTaken||other.disabled||other.edge===null)return false;
    const body=other.knockdown?.body||other,old=Math.hypot(body.x-actor.x,body.z-actor.z),next=Math.hypot(body.x-p.x,body.z-p.z);
    return (old>=radius||next<=old)&&segmentDistance(body.x,body.z,[actor.x,actor.z],[p.x,p.z])<radius;
   };
   const touched=distance>.0001&&people.find(person=>!person.knockdown&&contact(person,.68));
   if(touched){
    if(actor.speed>2){impacts?.hit(touched,actor,{kind:'scooter'});impacts?.hit(actor,{...actor,heading:actor.heading+Math.PI},{kind:'scooter'});this.collisions++;}
    actor.speed=0;actor.wait=.6;continue;
   }
   if(distance>.0001&&(contact(player,player.walking ? .75 : 1.35)||vehicles.some(v=>contact(v,1.4))||this.actors.some(a=>contact(a,.7)))){actor.speed=0;actor.wait=.4;continue;}
   if(!safe){actor.speed=0;actor.direction*=-1;actor.wait=.7;Object.assign(actor,this.point(actor));continue;}
   actor.distance+=distance;actor.s=nextS;Object.assign(actor,p);
   if(actor.s<=actor.route.start+.001||actor.s>=actor.route.end-.001){actor.direction*=-1;actor.speed=0;actor.wait=1;Object.assign(actor,this.point(actor));}
   else if(actor.blocked>7&&Math.hypot(actor.x-player.x,actor.z-player.z)>4){actor.direction*=-1;actor.blocked=0;actor.wait=.7;Object.assign(actor,this.point(actor));}
  }
 }
 snapshot(){return {active:this.riders.length,capacity:this.capacity,routes:this.routes.length,collisions:this.collisions,riders:this.riders.map(({id,x,z,heading,speed,route,knockdown})=>({id,x,z,heading,speed,cycleway:route.cycleway,knockedDown:!!knockdown,safe:this.safety.footprint({x,z,heading})}))};}
}

export function scooterRiderLook(index){return personLook(17201+index*37,{height:1.70+index%4*.03,coat:0,skirt:false,accessory:null,phoneWalk:false,stoop:0,bagType:index%3===0?'backpack':null,hairStyle:index%3===0?'beanie':'short'});}
export function scooterRiderPose(actor,look={height:1.75}){return {...actor,pose:'scooter',scooter:{...PLAYER_SCOOTER,hipY:PLAYER_SCOOTER.hipY*(look.height||1.75)/1.75},groundY:PLAYER_SCOOTER.groundY,grip:true};}

export function createScooterRiderRenderer(scene,sim){
 const group=new THREE.Group();group.name='Scooter riders on mapped paths';scene.add(group);
 const geometry=scooterGeometry(),material=micromobilityMaterial(),scooters=new THREE.InstancedMesh(geometry,material,Math.max(1,sim.capacity));
 scooters.name='NPC electric scooters';scooters.castShadow=true;scooters.frustumCulled=false;scooters.count=0;group.add(scooters);
 const people=createPersonBatch(Math.max(1,sim.capacity),{name:'Scooter riders',lod:{hide:SCOOTER_RIDER_RANGE}});group.add(people.group);
 const looks=sim.actors.map(a=>scooterRiderLook(a.index)),gaits=sim.actors.map(()=>({})),tmp=new THREE.Object3D(),color=new THREE.Color();
 return {group,scooters,people,update(player,dt=0){
  let count=0;people.begin(player);
  for(const actor of sim.actors){
   const visible=actor.knockdown?.body||actor;
   if(!actor.edge||actor.playerTaken||actor.disabled||Math.hypot(visible.x-player.x,visible.z-player.z)>SCOOTER_RIDER_RANGE)continue;
   tmp.position.set(actor.x,.12+groundAt(actor.x,actor.z),actor.z);tmp.rotation.set(0,actor.heading,0);tmp.scale.setScalar(1);tmp.updateMatrix();
   scooters.setMatrixAt(count,tmp.matrix);scooters.setColorAt(count,color.set(actor.operator.accent));
   if(actor.knockdown)applyImpactPose(scooters,count,actor);count++;
   const look=looks[actor.index],pose=scooterRiderPose(actor,look),gait=gaits[actor.index];advanceGait(pose,gait,dt,look);people.draw(pose,look,gait);
  }
  scooters.count=count;scooters.instanceMatrix.needsUpdate=true;if(scooters.instanceColor)scooters.instanceColor.needsUpdate=true;people.end();
 },dispose(){group.removeFromParent();const gs=new Set(),ms=new Set();group.traverse(o=>{if(o.geometry)gs.add(o.geometry);if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])ms.add(m);});gs.forEach(g=>g.dispose());ms.forEach(m=>m.dispose());}};
}
