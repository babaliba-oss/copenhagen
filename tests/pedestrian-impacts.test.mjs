import test from 'node:test';
import assert from 'node:assert/strict';
import {ImpactSystem,impactSeverity,HITTER_MASS,SEVERITY_REPORT} from '../src/impacts.js';
import {fallAmount} from '../src/impact-pose.js';
import {setTerrain,terrain,groundAt} from '../src/terrain.js';
import {createCrowdReaction,REACTION} from '../src/crowd-reaction.js';
import {Mobility} from '../src/mobility.js';
import {PoliceSimulation,incidentHeat} from '../src/police.js';
import {Finale} from '../src/finale.js';
import {createInstancedPeople} from '../src/market-life.js';

const run=(sim,a,seconds,dt=1/30,world=null)=>{const seen=new Set();for(let t=0;t<seconds&&a.knockdown;t+=dt){seen.add(a.knockdown.phase);sim.step(dt,world);}return seen;};
const person=(extra={})=>({id:1,x:0,z:0,heading:Math.PI/2,speed:1,edge:{},...extra});

test('severity follows the hitter\'s mass and speed: stumble, knocked down, thrown',()=>{
 const lv=(h,v)=>impactSeverity(h,v).level;
 assert.equal(lv('car',1.5),'stumble');assert.equal(lv('car',4),'down');assert.equal(lv('car',10),'thrown');
 assert.equal(lv('bus',4),'down');assert.equal(lv('bus',6),'thrown');assert.equal(lv('tram',6),'thrown');
 // Bikes, e-scooters and people on foot are light: at worst a knock-down, never a throw.
 for(const h of ['bicycle','scooter','walker'])for(const v of [1,3,6,9])assert.notEqual(lv(h,v),'thrown',`${h} at ${v} m/s`);
 assert.equal(lv('bicycle',2),'stumble');assert.equal(lv('bicycle',6),'down');assert.equal(lv('walker',1.4),'stumble');assert.equal(lv('walker',5),'down');
 // Energy rises with speed and mass; the heavier hitter throws further.
 assert.ok(impactSeverity('car',8).energy<impactSeverity('car',12).energy);assert.ok(impactSeverity('car',8).energy<impactSeverity('bus',8).energy);
 assert.ok(impactSeverity('car',8).out<impactSeverity('car',14).out&&impactSeverity('bicycle',6).out<impactSeverity('car',6).out);
 assert.ok(impactSeverity('car',4).lie<impactSeverity('car',12).lie,'a harder hit keeps them down longer');
 // Momentum: a car loses a few percent, a bike most of its speed; its rider falls too.
 const car=impactSeverity('car',10),bike=impactSeverity('bicycle',6);
 assert.ok(car.vehicleSpeed>9&&car.vehicleSpeed<10);assert.ok(bike.vehicleSpeed<6*.6);assert.equal(bike.riderFalls,true);assert.equal(car.riderFalls,false);
 assert.equal(impactSeverity('car',5,{mass:HITTER_MASS.car}).level,impactSeverity('car',5).level);
});

test('a stumble: pushed back a step, an angry gesture at the driver, back on the path in a few seconds',()=>{
 const sim=new ImpactSystem(),a=person(),sev=sim.hit(a,{x:0,z:3,heading:0,speed:1.6},{kind:'car'});
 assert.equal(sev.level,'stumble');assert.equal(a.knockdown.phase,'stagger');
 let maxPush=0,waved=false;for(let t=0;t<12&&a.knockdown;t+=1/30){sim.step(1/30);if(a.knockdown){const b=a.knockdown.body;maxPush=Math.max(maxPush,Math.hypot(b.x-a.x,b.z-a.z));waved||=a.pose==='wave';}}
 assert.ok(maxPush>.2&&maxPush<1.6,`pushed ${maxPush.toFixed(2)} m`);assert.ok(waved,'shakes a fist');assert.equal(a.knockdown,undefined);assert.equal(a.pose,undefined,'pose restored');
});

test('knocked down: falls, lies a few seconds, gets up and walks back; thrown: flies, slides, lies longer',()=>{
 const sim=new ImpactSystem(),a=person();sim.hit(a,{x:0,z:3,heading:0,speed:4},{kind:'car'});assert.equal(a.knockdown.level,'down');
 let t=0,lying=0,lowest=9;for(;t<30&&a.knockdown;t+=1/30){sim.step(1/30);if(a.knockdown){lowest=Math.min(lowest,a.knockdown.body.y);if(a.knockdown.phase==='rest')lying+=1/30;}}
 assert.ok(lying>2&&lying<7.5,`lay ${lying.toFixed(1)}s`);assert.ok(t<16,`back up and walking after ${t.toFixed(1)}s`);assert.ok(lowest>=.15,'never sinks into the ground');
 const b=person({id:2});sim.hit(b,{x:0,z:3,heading:0,speed:13},{kind:'car'});assert.equal(b.knockdown.level,'thrown');
 let air=0;for(let i=0;i<20;i++){sim.step(1/30);air=Math.max(air,b.knockdown.body.y);}assert.ok(air>1.2,'lifted off the ground');
 const phases=run(sim,b,60);for(const p of ['flight','rest','rise','return'])assert.ok(phases.has(p),p);assert.equal(b.knockdown,undefined);
});

test('a tumbling body stops at a wall instead of passing into a building',()=>{
 const world={buildings:{at:(x,z)=>z<-4}},sim=new ImpactSystem(),a=person();sim.hit(a,{x:0,z:3,heading:0,speed:14},{kind:'car'});
 for(let i=0;i<120;i++){sim.step(1/30,world);assert.ok(a.knockdown.body.z>=-4.0001,'outside the wall');}
});

test('thrown off a bridge into the water: falls past the ground raised beside the deck, sinks out of sight, comes back',()=>{
 // The field reads the deck's height (0) over the canal (raiseBridgeDecks); the water lies 3 m below it.
 const previous=terrain(),n=3;setTerrain({size:n,cell:40,extent:40,base:0,ground:new Float32Array(n*n),water:new Float32Array(n*n).fill(-3),lake:null});
 try{
  const canal={rings:[[[-40,-4],[40,-4],[40,-40],[-40,-40]]],bbox:[-40,-40,40,-4]},world={buildings:{at:()=>false},roads:{at:(x,z)=>z>-4},pavement:{at:()=>false},water:[canal]};
  const sim=new ImpactSystem(),a=person();sim.hit(a,{x:0,z:3,heading:0,speed:14},{kind:'car'});
  let lowest=Infinity;const seen=new Set();
  for(let t=0;t<40&&a.knockdown;t+=1/30){seen.add(a.knockdown.phase);const b=a.knockdown.body;if(b.z<-5)assert.ok(a.knockdown.phase!=='rest','never lies on the raised ground over the water');lowest=Math.min(lowest,b.y+groundAt(b.x,b.z));sim.step(1/30,world);}
  assert.ok(seen.has('sunk'),'into the water');assert.ok(lowest<-3-1,'under the surface');assert.equal(a.knockdown,undefined,'back on the path');
 }finally{setTerrain(previous);}
});

test('the car stops for someone lying in the road; traffic gets them as an obstacle to brake for',()=>{
 const sim=new ImpactSystem(),a=person();sim.hit(a,{x:0,z:3,heading:0,speed:4},{kind:'car'});
 for(let i=0;i<120&&a.knockdown.phase!=='rest';i++)sim.step(1/30);assert.equal(a.knockdown.phase,'rest');
 const b=a.knockdown.body,from={x:b.x,z:b.z+5,heading:0,speed:3},car={...from,z:b.z+2};sim.collide(from,car,[a],[],[]);assert.equal(car.speed,0);assert.equal(car.z,from.z);
 const obs=sim.obstacles();assert.equal(obs.length,1);assert.ok(Math.hypot(obs[0].x-b.x,obs[0].z-b.z)<1e-9);
});

test('police: every hit is still an offence, scaled by severity; the finale lists it',()=>{
 assert.ok(incidentHeat('pedestrian',SEVERITY_REPORT.stumble)<incidentHeat('pedestrian',SEVERITY_REPORT.down));
 assert.ok(incidentHeat('pedestrian',SEVERITY_REPORT.down)<incidentHeat('pedestrian',SEVERITY_REPORT.thrown));
 assert.equal(incidentHeat('pedestrian'),7,'unknown severity keeps the old heat');
 const graph={nodes:[{x:0,z:0},{x:100,z:0}],edges:[],outgoing:[[],[]]};
 const heat=v=>{const police=new PoliceSimulation(graph,{buildings:{at:()=>null}}),finale=new Finale();police.onIncident=(...i)=>finale.incident(...i);
  new ImpactSystem().hit(person(),{x:0,z:3,heading:0,speed:v},{kind:'car',police});return {heat:police.heat,offences:[...finale.offences.values()].map(o=>o.text)};};
 const soft=heat(1.6),hard=heat(14);assert.ok(soft.heat>0&&hard.heat>soft.heat);assert.deepEqual(hard.offences,['Hit a pedestrian']);
});

test('bystanders who can see it react: most run from the car, some stare or film, the closest help; then they calm down',()=>{
 const scared=[],held=[],victim=person({id:0});
 const crowd=createCrowdReaction({scare:(a,from,s)=>scared.push({a,from,s}),hold:(a,s)=>held.push({a,s}),sight:{at:(x,z)=>x>20&&x<22}});
 const people=Array.from({length:60},(_,i)=>({id:i+1,x:Math.cos(i)*(2+i*.4),z:Math.sin(i)*(2+i*.4),heading:0,speed:1,edge:{}}));
 const hidden={id:99,x:30,z:0,heading:0,speed:1,edge:{}};people.push(hidden);
 const sim=new ImpactSystem();sim.onHit=e=>crowd.alarm(e,[people]);sim.hit(victim,{x:0,z:5,heading:0,speed:12},{kind:'car'});
 const kinds=crowd.snapshot().kinds;assert.ok(kinds.flee>kinds.film,JSON.stringify(kinds));assert.ok(kinds.film>0||kinds.shout>0||kinds.stare>0);assert.ok(kinds.help>0,'someone close helps');
 assert.equal(hidden.reaction,undefined,'nobody reacts to what they cannot see');
 assert.ok(people.filter(p=>Math.hypot(p.x,p.z)>REACTION.radius.thrown).every(p=>!p.reaction),'far away people do not notice');
 for(const s of scared)assert.deepEqual(s.from,{x:0,z:5},'they run from the car');
 crowd.step(.1);assert.ok(people.some(p=>p.pose==='flinch'),'first a flinch');
 crowd.step(3);assert.ok(people.some(p=>p.pose==='phone'||p.pose==='wave'),'then phones and shouting');
 for(let i=0;i<30;i++)crowd.step(1);assert.equal(crowd.snapshot().reacting,0);assert.ok(people.every(p=>p.pose===undefined),'calm again, poses restored');
});

test('graph walkers flee along their path away from the impact; free crowds run directly away',()=>{
 const clear={at:()=>undefined},graph={nodes:[[3,-100],[3,100]],edges:[{from:0,to:1,points:[[3,-100],[3,100]],length:200,lane:0,signal:-1,crossing:false},{from:1,to:0,points:[[3,100],[3,-100]],length:200,lane:0,signal:-1,crossing:false}]};
 const sim=new Mobility({roads:{nodes:[],edges:[]},walks:graph,signals:[]},{roads:{at:x=>Math.abs(x)<2},pavement:{at:x=>x>=2&&x<=5},buildings:clear},{cars:0,people:1});
 const p=sim.people[0];Object.assign(p,{edge:sim.walks.edges[0],s:100,x:3,z:0,heading:Math.PI,speed:1});
 // Walking towards +z, the crash is ahead of them at z=+12: they turn round and run.
 sim.scare(p,{x:3,z:12},6);const far={x:60,z:0,heading:0,speed:0};
 for(let i=0;i<90;i++)sim.step(1/60,far);assert.ok(p.running&&p.speed>3);assert.ok(p.z<-.5,`ran away to z=${p.z.toFixed(2)}`);
 sim.hold(p,2);for(let i=0;i<30;i++)sim.step(1/60,far);assert.equal(p.speed,0,'stopped to watch');
 const crowd=createInstancedPeople([{x:0,z:0},{x:0,z:5}],{safe:()=>true});const q=crowd.people[0];q.scared={x:-3,z:0,left:2};
 for(let i=0;i<30;i++)crowd.update(1/30,{x:60,z:30,speed:0});assert.ok(q.x>.5,'free crowds run straight away from it');
 for(let i=0;i<90;i++)crowd.update(1/30,{x:60,z:30,speed:0});assert.equal(q.scared,null,'and calm down');
});
