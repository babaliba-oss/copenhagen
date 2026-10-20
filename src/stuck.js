// Noticing that the player is wedged: the pedal held for STUCK_AFTER seconds while the car has moved less than
// STUCK_RANGE metres from where the holding began. Letting go (or driving away) clears it.
export const STUCK_AFTER=2,STUCK_RANGE=.6;
export function createStuckWatch(){
 let held=0,from=null,stuck=false;
 return {
  update(pressing,x,z,dt){
   if(!pressing){held=0;from=null;stuck=false;return false;}
   if(!from||Math.hypot(x-from.x,z-from.z)>STUCK_RANGE){from={x,z};held=0;stuck=false;return false;}
   held+=dt;stuck=held>=STUCK_AFTER;return stuck;
  },
  clear(){held=0;from=null;stuck=false;},
  get stuck(){return stuck;},
 };
}
