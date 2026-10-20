// Touch screens: the HUD's popups each had their own fixed spot, and on a phone those spots coincide (the saga and job
// card, the talk prompt and the postcard hint all at top left; the wanted stars, the radio and the important toasts at
// top right). Here they are placed one after another instead: in priority order, each keeps its side of the screen
// (CSS anchors it left, right or centre) and drops below anything already placed that it would overlap. What does not
// fit above the touch controls waits, hidden, until there is room.
export const GAP=8;
// Pure: rects [{left,right,height}] in priority order → tops (null: does not fit). `fixed`: rects already on screen
// (top bar, controls); `top`/`bottom`: the free band.
export function stack(items,fixed,top,bottom){
 const placed=[...fixed],out=[];
 for(const it of items){
  let y=top,moved=true;
  while(moved){moved=false;for(const p of placed)if(it.left<p.right+GAP&&it.right>p.left-GAP&&y<p.bottom+GAP&&y+it.height>p.top-GAP){y=p.bottom+GAP;moved=true;}}
  if(y+it.height>bottom){out.push(null);continue;}
  placed.push({left:it.left,right:it.right,top:y,bottom:y+it.height});out.push(y);
 }
 return out;
}
const SELECTORS=['#wanted','#toast.important.visible','#people-interaction','#cph-hud','#market-prompt','#market-card','#radio-now','.edge-invite'];
const OBSTACLES=['.topbar .wordmark','#touch-aux','#travel-controls','#touch-controls','.dashboard'];
export function createTouchDocks(doc=document,win=window){
 let last=0;
 const shown=el=>el&&!el.hidden&&el.getClientRects().length>0&&el.offsetHeight>0&&win.getComputedStyle(el).visibility!=='hidden'; // fixed elements have no offsetParent
 return {
  update(now=performance.now()){
   if(!doc.body.classList.contains('touch')||now-last<120)return;last=now;
   const els=SELECTORS.map(s=>doc.querySelector(s)).filter(shown);
   for(const el of els){el.style.top='';el.style.bottom='auto';} // measure from the CSS anchor, not last frame's top
   const rects=els.map(el=>el.getBoundingClientRect());
   const fixed=OBSTACLES.map(s=>doc.querySelector(s)).filter(shown).map(el=>el.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0);
   const top=Math.max(8,...fixed.filter(r=>r.top<80).map(r=>r.bottom+GAP));
   const tops=stack(rects.map(r=>({left:r.left,right:r.right,height:r.height})),fixed.filter(r=>r.top>=80),top,win.innerHeight-8);
   els.forEach((el,i)=>{const offset=win.getComputedStyle(el).position==='fixed'||!el.offsetParent?0:el.offsetParent.getBoundingClientRect().top;
    if(tops[i]===null){el.classList.add('dock-wait');return;}
    el.classList.remove('dock-wait');el.style.top=`${Math.round(tops[i]-offset)}px`;});
  },
 };
}
