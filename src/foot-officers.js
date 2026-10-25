import {Group} from 'three';
import {createPersonBatch,advanceGait} from './person-model.js';
import {officerLook} from './roadblock.js';

// The officer a stuck unit sends on foot (police.js ON_FOOT): the simulation only keeps how far the officer has walked
// from the car towards the player (`unit.foot`, the arrest range is measured from there). This draws that officer with the
// pedestrians' model and gait in the police uniform: out of the driver's door, walking along the simulated line, standing
// facing the player once in arrest range, and back to the door (gone there, or as soon as the car moves off) when the
// unit resumes or the chase ends. Units only send officers on today's map (no motor police in 1760).
export const FOOT_OFFICERS={max:4,door:1.3,blend:3,back:3.5};
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));

// Where the officer is drawn for `foot` metres walked: the driver's door (left of the car) eased onto the simulated
// point, unit + foot towards the player, over the first `blend` metres; exactly the simulated point after that.
export function footPosition(unit,player,foot,out={x:0,z:0}){
 const s=Math.sin(unit.heading||0),c=Math.cos(unit.heading||0),dx=player.x-unit.x,dz=player.z-unit.z,d=Math.hypot(dx,dz)||1;
 const w=Math.min(1,foot/FOOT_OFFICERS.blend),door=FOOT_OFFICERS.door*(1-w);
 out.x=unit.x+dx/d*foot-c*door;out.z=unit.z+dz/d*foot+s*door;return out;
}
const doorPoint=(u,out)=>{const s=Math.sin(u.heading||0),c=Math.cos(u.heading||0);out.x=u.x-c*FOOT_OFFICERS.door;out.z=u.z+s*FOOT_OFFICERS.door;return out;};

export function createFootOfficers(simulation,parent=null){
 const group=new Group(),officers=new Map(),P={x:0,z:0};group.name='Police officers on foot';
 let serial=0,time=0,drawn=0,batch=null; // the batch (uniform textures) is made, and put in the scene, when the first officer gets out
 function place(o,x,z,dt,face){
  const dx=x-o.x,dz=z-o.z,step=Math.hypot(dx,dz);o.x=x;o.z=z;o.speed=dt>0?Math.min(6,step/dt):0;
  const want=step>.01?Math.atan2(-dx,-dz):face;if(want!==undefined)o.heading+=wrap(want-o.heading)*Math.min(1,dt*10);
 }
 return {
  group,officers,get batch(){return batch;},
  update(dt){
   time+=dt;const player=simulation.player,units=simulation.units||[],ended=!player||simulation.busted||!simulation.level;
   if(!drawn&&!officers.size&&(ended||!units.some(u=>u.foot>0)))return; // nobody on foot: no per-frame batch upload
   for(const u of units){
    if(ended||!(u.foot>0)||officers.has(u))continue;
    if(officers.size>=FOOT_OFFICERS.max)break;
    doorPoint(u,P);officers.set(u,{x:P.x,z:P.z,heading:u.heading,speed:0,groundY:.13,look:officerLook(20+serial++%8,false),gait:{},id:`foot-${u.id}`,back:false});
   }
   for(const [u,o]of officers){
    const live=!ended&&units.includes(u);
    if(live&&u.foot>0){o.back=false;footPosition(u,player,u.foot,P);place(o,P.x,P.z,dt,Math.atan2(-(player.x-o.x),-(player.z-o.z)));}
    else{
     // Back to the car: gone once at the door, or at once if the car is moving off, gone or the chase is over (the arrest scene brings its own officers).
     if(!live||Math.abs(u.speed||0)>1.5){officers.delete(u);continue;}
     o.back=true;doorPoint(u,P);const dx=P.x-o.x,dz=P.z-o.z,d=Math.hypot(dx,dz);
     if(d<.4){officers.delete(u);continue;}
     const k=Math.min(1,FOOT_OFFICERS.back*dt/d);place(o,o.x+dx*k,o.z+dz*k,dt);
    }
    advanceGait(o,o.gait,dt,o.look);
   }
   if(!batch){batch=createPersonBatch(FOOT_OFFICERS.max,{name:'Police officers on foot',police:true});group.add(batch.group);parent?.add(group);}
   batch.begin(player);for(const o of officers.values())batch.draw(o,o.look,o.gait,time);batch.end();drawn=officers.size;
  },
  snapshot(){return [...officers.values()].map(o=>({id:o.id,x:+o.x.toFixed(2),z:+o.z.toFixed(2),speed:+o.speed.toFixed(2),back:o.back}));},
 };
}
