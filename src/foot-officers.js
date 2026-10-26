import {Group} from 'three';
import {createPersonBatch,advanceGait} from './person-model.js';
import {officerLook} from './roadblock.js';
import {FOOT_CHASE} from './police.js';

// The officers units send on foot (police.js ON_FOOT and FOOT_CHASE): the simulation keeps each one's position, heading and
// speed on its unit (`unit.officer`: out of the driver's door, after the player along the footways, standing in reach, and
// back to the car), and arrests are measured from there. This draws them exactly there with the pedestrians' model and gait
// in the police uniform, running or walking at the simulated speed. Gone when the simulation takes them back into the car,
// when the unit goes, or when the chase ends (the arrest scene brings its own officers). Today's map only (1760 has no police).
export const FOOT_OFFICERS={max:FOOT_CHASE.max};

export function createFootOfficers(simulation,parent=null){
 const group=new Group(),officers=new Map();group.name='Police officers on foot';
 let serial=0,time=0,drawn=0,batch=null; // the batch (uniform textures) is made, and put in the scene, when the first officer gets out
 return {
  group,officers,get batch(){return batch;},
  update(dt){
   time+=dt;const player=simulation.player,units=simulation.units||[],ended=!player||simulation.busted||!simulation.level;
   if(!drawn&&!officers.size&&(ended||!units.some(u=>u.officer)))return; // nobody on foot: no per-frame batch upload
   for(const u of units){
    if(ended||!u.officer||officers.has(u))continue;
    if(officers.size>=FOOT_OFFICERS.max)break;
    officers.set(u,{x:u.officer.x,z:u.officer.z,heading:u.officer.heading,speed:0,running:false,groundY:.13,look:officerLook(20+serial++%8,false),gait:{},id:`foot-${u.id}`,back:false});
   }
   for(const [u,o]of officers){
    const s=u.officer;if(ended||!s||!units.includes(u)){officers.delete(u);continue;}
    o.x=s.x;o.z=s.z;o.heading=s.heading;o.speed=s.speed;o.running=s.speed>2.5;o.back=s.back;
    advanceGait(o,o.gait,dt,o.look);
   }
   if(!batch){batch=createPersonBatch(Math.max(1,FOOT_OFFICERS.max),{name:'Police officers on foot',police:true});group.add(batch.group);parent?.add(group);}
   batch.begin(player);for(const o of officers.values())batch.draw(o,o.look,o.gait,time);batch.end();drawn=officers.size;
  },
  snapshot(){return [...officers.values()].map(o=>({id:o.id,x:+o.x.toFixed(2),z:+o.z.toFixed(2),speed:+o.speed.toFixed(2),back:o.back}));},
 };
}
