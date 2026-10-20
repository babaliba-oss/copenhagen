// Phones: the job/saga cards (left) and the radio card (right) tuck behind the screen edge, leaving a 16 px tab. A swipe
// toward the edge tucks one, a tap on the tab brings it back; each comes out by itself when its content really changes
// (a new job, the pick-up done, a new station) and tucks again after a few seconds. Desktop is untouched.
export const TUCK_AFTER=6000;
export function createTouchTucks(doc=document,{after=TUCK_AFTER}={}){
 const touch=()=>doc.body.classList.contains('touch');
 // label(): the word written down the tab while tucked (JOB, SAGA, RADIO)
 // hold(): keep it out (a countdown on it) - it tucks once that ends.
 function add(el,side,key=()=>el.textContent,label=()=>'',hold=()=>false){
  if(!el)return null;
  const it={el,side,timer:0,key:key(),start:null,swiped:0};
  el.classList.add('tuckable',`tuck-${side}`);
  const later=()=>{it.timer=setTimeout(()=>{if(hold())later();else tuck(true);},after);};
  const tuck=on=>{if(on)el.dataset.tab=label();el.classList.toggle('tucked',on);clearTimeout(it.timer);if(!on)later();};
  it.tuck=tuck;
  el.addEventListener('pointerdown',e=>{if(touch())it.start={x:e.clientX,y:e.clientY};},{passive:true});
  el.addEventListener('pointerup',e=>{const s=it.start;it.start=null;if(!s||!touch())return;const dx=e.clientX-s.x,dy=e.clientY-s.y;
   if(Math.abs(dx)>30&&Math.abs(dx)>Math.abs(dy)*1.5&&Math.sign(dx)===(side==='left'?-1:1)){tuck(true);it.swiped=performance.now();}});
  el.addEventListener('pointercancel',()=>{it.start=null;});
  // Capture: a tap on a tucked card only brings it out (the radio card's own click changes the station).
  el.addEventListener('click',e=>{if(!touch())return;const swipe=performance.now()-it.swiped<500;
   if(swipe||el.classList.contains('tucked')){e.preventDefault();e.stopImmediatePropagation();if(!swipe)tuck(false);}},true);
  new MutationObserver(()=>{const k=key();if(k!==it.key){it.key=k;if(touch())tuck(false);}}).observe(el,{childList:true,subtree:true,characterData:true});
  new MutationObserver(()=>{if(!el.hidden&&touch())tuck(false);}).observe(el,{attributes:true,attributeFilter:['hidden']}); // shown again (radio on, a saga started): out for a look first
  if(touch())tuck(false);
  return it;
 }
 const items=[];
 return {add:(...a)=>{const it=add(...a);if(it)items.push(it);return it;},
  // the game starts: every card comes out for a first look, then tucks (their timers ran during loading)
  showAll(){if(touch())for(const it of items)it.tuck(false);}};
}
