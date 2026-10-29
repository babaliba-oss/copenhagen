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

// A browser makes a click only from a one-finger tap: with a thumb holding Go, a tap on Run, Get out or Say hello by the
// other thumb did nothing. A second finger's tap on a button (down and up on it, barely moved) clicks it here; the
// browser's own click, if one comes anyway, is dropped so it cannot count twice. `skip`: buttons that act on pointerdown (the pedals).
export function secondFingerTaps(doc,{enabled=()=>true,skip=()=>false,signal,now=()=>performance.now()}={}){
 const down=new Map();let made=null;
 const opts={capture:true,signal};
 doc.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch'||e.isPrimary||!enabled())return;const b=e.target?.closest?.('button');if(b&&!b.disabled&&!skip(b))down.set(e.pointerId,{b,x:e.clientX,y:e.clientY});},opts);
 doc.addEventListener('pointercancel',e=>down.delete(e.pointerId),opts);
 doc.addEventListener('pointerup',e=>{const s=down.get(e.pointerId);down.delete(e.pointerId);if(!s||Math.hypot(e.clientX-s.x,e.clientY-s.y)>12)return;
  const at=doc.elementFromPoint?.(e.clientX,e.clientY)?.closest?.('button');if(at!==s.b||s.b.disabled)return;made={b:s.b,t:now()};s.b.click();},opts);
 doc.addEventListener('click',e=>{if(!made||!e.isTrusted)return;if(now()-made.t>600){made=null;return;}if(e.target?.closest?.('button')===made.b){e.preventDefault();e.stopImmediatePropagation();made=null;}},opts);
}
