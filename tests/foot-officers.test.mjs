import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix4,Vector3} from 'three';
import {createFootOfficers,footPosition,FOOT_OFFICERS} from '../src/foot-officers.js';
import {ON_FOOT} from '../src/police.js';

const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const drawnHead=batch=>{const m=new Matrix4(),p=new Vector3(),t=batch.meshes.head;return t.count?(t.getMatrixAt(0,m),p.setFromMatrixPosition(m),{x:p.x,z:p.z}):null;};
// The batch the module draws into (its group holds the instanced meshes).
const heads=feet=>feet.batch?.meshes.head||{count:0};

test('the officer on foot is drawn where the simulation has them, from the door to arrest range',()=>{
 const unit={id:'u1',x:0,z:0,heading:0,speed:0,foot:0},player={x:30,z:-20},sim={units:[unit],player,level:2,busted:false};
 const feet=createFootOfficers(sim),dt=1/60;
 feet.update(dt);assert.equal(feet.officers.size,0,'nobody out before the unit sends one');assert.equal(heads(feet).count,0);
 const d=dist(unit,player);let first=null;
 while(unit.foot<d-10){unit.foot=Math.min(d-10,unit.foot+ON_FOOT.speed*dt);feet.update(dt);const o=feet.officers.get(unit);first??={...o};if(unit.foot>d/2&&unit.foot<d/2+.1)assert.ok(o.speed>3.4&&o.speed<3.6&&o.gait.gaitWalk>.5,'walks (animated) at the simulated 3.5 m/s');
  const want=footPosition(unit,player,unit.foot);assert.ok(dist(o,want)<1e-9,'drawn position is the simulated one');
  if(unit.foot>=FOOT_OFFICERS.blend){const sim={x:unit.x+(player.x-unit.x)/d*unit.foot,z:unit.z+(player.z-unit.z)/d*unit.foot};assert.ok(dist(o,sim)<1e-9,'past the door: exactly unit + foot towards the player');assert.ok(Math.abs(dist(o,player)-(d-unit.foot))<1e-9,'arrest range is measured from where it is drawn');}
 }
 assert.ok(Math.abs(first.x-(-FOOT_OFFICERS.door))<.1&&Math.abs(first.z)<.1,'gets out at the driver\'s door (left of a car heading -z)');
 const o=feet.officers.get(unit);
 const t=drawnHead(feet.batch);assert.ok(t&&dist(t,o)<.5,'the head instance is drawn at the officer');
 for(let i=0;i<60;i++)feet.update(dt);
 assert.ok(feet.officers.get(unit).speed<.01,'stands once in arrest range');
 const facing=feet.officers.get(unit).heading,want=Math.atan2(-(player.x-o.x),-(player.z-o.z));assert.ok(Math.abs(Math.atan2(Math.sin(facing-want),Math.cos(facing-want)))<.05,'faces the player');
 // The player drives off: the unit resumes and the officer is gone.
 unit.foot=0;unit.speed=4;feet.update(dt);assert.equal(feet.officers.size,0,'removed when the unit resumes');assert.equal(heads(feet).count,0,'no longer drawn');
});

test('a unit that stays put calls its officer back to the door; the chase ending or an arrest clears them',()=>{
 const unit={id:'u2',x:0,z:0,heading:Math.PI/2,speed:0,foot:12},player={x:0,z:40},sim={units:[unit],player,level:1,busted:false};
 const feet=createFootOfficers(sim),dt=1/60;feet.update(dt);assert.equal(feet.officers.size,1);
 unit.foot=0;let steps=0;while(feet.officers.size&&steps<600){feet.update(dt);steps++;}
 assert.equal(feet.officers.size,0,'walked back and got in');assert.ok(steps*dt>2.5&&steps*dt<5,`walked back at about 3.5 m/s (${(steps*dt).toFixed(2)} s for ~12 m)`);
 unit.foot=8;feet.update(dt);assert.equal(feet.officers.size,1);sim.busted=true;feet.update(dt);assert.equal(feet.officers.size,0,'the arrest scene takes over');
 sim.busted=false;feet.update(dt);assert.equal(feet.officers.size,1);sim.level=0;feet.update(dt);assert.equal(feet.officers.size,0,'chase over');
 sim.level=1;feet.update(dt);sim.units=[];feet.update(dt);assert.equal(feet.officers.size,0,'unit retired');
 const many=Array.from({length:7},(_,i)=>({id:`m${i}`,x:i*5,z:0,heading:0,speed:0,foot:4}));sim.units=many;feet.update(dt);assert.equal(feet.officers.size,FOOT_OFFICERS.max,'a few officers at most');
});
