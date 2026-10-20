// Contact ownership matters: two fingers on one pedal must not release each
// other, and a cancelled steering gesture must not leave an analog turn held.
export function createTouchInput(keys){
 const contacts=new Map();let steering=null;
 const held=key=>[...contacts.values()].includes(key);
 return {
  press(id,key){if(contacts.has(id)||steering===id)return false;contacts.set(id,key);keys.add(key);return true;},
  steer(id,value){if(contacts.has(id)||steering!==null&&steering!==id)return false;steering=id;keys.tilt=Math.max(-1,Math.min(1,Number.isFinite(value)?value:0));return true;},
  release(id){
   const key=contacts.get(id);contacts.delete(id);if(key&&!held(key))keys.delete(key);
   if(steering===id){steering=null;keys.tilt=0;}
  },
  clear(){for(const id of [...contacts.keys()])this.release(id);if(steering!==null)this.release(steering);},
  held,get steering(){return steering;},get size(){return contacts.size+(steering===null?0:1);},
 };
}

export function thumbSteering(x,left,width){
 const half=Math.max(1,(width-52)/2),value=Math.max(-1,Math.min(1,(left+width/2-x)/half));
 // Full lock is only ~45 px of slide: a squared curve keeps the first part for small corrections (it was linear, and twitchy).
 const dead=.1,v=Math.abs(value)<=dead?0:(Math.abs(value)-dead)/(1-dead);return v&&Math.sign(value)*v*v;
}
