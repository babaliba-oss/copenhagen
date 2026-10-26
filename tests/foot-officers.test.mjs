import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Vector3} from 'three';
import {createFootOfficers,FOOT_OFFICERS} from '../src/foot-officers.js';
import {PoliceSimulation,FOOT_CHASE} from '../src/police.js';
import {prepareGraph} from '../src/mobility.js';

const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const drawnHead=batch=>{const m=new Matrix4(),p=new Vector3(),t=batch.meshes.head;return t.count?(t.getMatrixAt(0,m),p.setFromMatrixPosition(m),{x:p.x,z:p.z}):null;};
// The batch the module draws into (its group holds the instanced meshes).
const heads=feet=>feet.batch?.meshes.head||{count:0};

test('the officer on foot is drawn exactly where the simulation has them, running after the player, and gone once back in the car',()=>{
 // A wedged unit 45 m from a stopped player (police.test.mjs ON_FOOT): the simulation sends its officer over.
 const graph=prepareGraph({nodes:[[0,100],[0,0],[0,-100]],edges:[{from:0,to:1,lane:0,points:[[0,100],[0,0]]},{from:1,to:2,lane:0,points:[[0,0],[0,-100]]}]});
 const p=new PoliceSimulation(graph,{roads:{at:(x,z)=>z>=20||z<-15},buildings:{at:()=>false}}),player={x:0,z:-25,heading:0,speed:0};p.report('pedestrian',1);p.dispatch=1e9;
 p.units=[p.newUnit({edge:graph.edges[0],s:80,x:0,z:20,heading:0},'chase',false)];const unit=p.units[0];
 const feet=createFootOfficers(p),dt=1/60;let first=null,ran=false;
 for(let i=0;i<60*20;i++){p.step(dt,player);if(p.busted)break;feet.update(dt);const s=unit.officer;
  if(!s){assert.equal(feet.officers.size,0,'nobody drawn before the unit sends one');continue;}
  const o=feet.officers.get(unit);first??={...o};assert.ok(o&&o.x===s.x&&o.z===s.z&&o.heading===s.heading,'drawn position and heading are the simulated ones');
  if(s.speed>4)ran=o.gait.gaitRun>.5;
  const t=drawnHead(feet.batch);assert.ok(t&&dist(t,o)<.5,'the head instance is drawn at the officer');}
 assert.ok(first&&Math.abs(first.x-(-FOOT_CHASE.door))<.1&&Math.abs(first.z-20)<.1,'gets out at the driver\'s door (left of a car heading -z)');
 assert.ok(ran,`runs (animated) at the simulated ${FOOT_CHASE.run} m/s`);assert.equal(p.busted,true,'and makes the arrest');
 assert.equal((feet.update(dt),feet.officers.size),0,'the arrest scene takes over');
});

test('officers come and go with the simulation: walking back, the chase ending, the unit retired; a few at most',()=>{
 const o={x:5,z:0,heading:0,speed:3.5,back:true},unit={id:'u2',x:0,z:0,heading:0,speed:0,officer:o},sim={units:[unit],player:{x:0,z:40},level:1,busted:false};
 const feet=createFootOfficers(sim),dt=1/60;feet.update(dt);assert.equal(feet.officers.size,1);assert.equal(feet.officers.get(unit).back,true);
 o.x=2;feet.update(dt);assert.equal(feet.officers.get(unit).x,2,'follows the simulated walk back');
 unit.officer=null;feet.update(dt);assert.equal(feet.officers.size,0,'gone when back in the car');assert.equal(heads(feet).count,0,'no longer drawn');
 unit.officer=o;feet.update(dt);assert.equal(feet.officers.size,1);sim.level=0;feet.update(dt);assert.equal(feet.officers.size,0,'chase over');
 sim.level=1;feet.update(dt);sim.units=[];feet.update(dt);assert.equal(feet.officers.size,0,'unit retired');
 const many=Array.from({length:7},(_,i)=>({id:`m${i}`,x:i*5,z:0,heading:0,speed:0,officer:{x:i*5,z:3,heading:0,speed:0,back:false}}));sim.units=many;feet.update(dt);assert.equal(feet.officers.size,FOOT_OFFICERS.max,'a few officers at most');
 assert.equal(FOOT_OFFICERS.max,FOOT_CHASE.max);
});
