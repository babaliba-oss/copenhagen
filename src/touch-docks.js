// Touch screens: the HUD's popups each had their own fixed spot, and on a phone those spots coincide (the saga and job
// card, the talk prompt and the postcard hint all at top left; the wanted stars, the radio and the important toasts at
// top right). Here they are placed one after another instead: in priority order, each keeps its side of the screen
// (CSS anchors it left, right or centre) and drops below anything already placed that it would overlap. What does not
// fit above the touch controls waits, hidden, until there is room.
export const GAP=8;
// Pure: rects [{left,right,height}] in priority order → tops (null: does not fit). `fixed`: rects already on screen
// (top bar, controls); `top`/`bottom`: the free band.
// An item with `min` (a conversation: text to read, replies to tap) that does not fit whole takes the tallest free gap in
// its column instead, if that is at least `min` tall; `heights[i]` gets that gap (the item scrolls inside it).
export function stack(items,fixed,top,bottom,heights=[]){
 const placed=[...fixed],out=[];
 items.forEach((it,i)=>{
  heights[i]=null;
  let y=top,moved=true;
  while(moved){moved=false;for(const p of placed)if(it.left<p.right+GAP&&it.right>p.left-GAP&&y<p.bottom+GAP&&y+it.height>p.top-GAP){y=p.bottom+GAP;moved=true;}}
  let h=it.height;
  if(y+h>bottom){
   if(!it.min){out.push(null);return;}
   const column=placed.filter(p=>it.left<p.right+GAP&&it.right>p.left-GAP);let best=null;
   for(const y0 of [top,...column.map(p=>p.bottom+GAP)]){if(y0<top||column.some(p=>y0<p.bottom+GAP&&y0>p.top-GAP))continue;
    const end=Math.min(bottom,...column.filter(p=>p.top-GAP>=y0).map(p=>p.top-GAP));if(end-y0>=it.min&&(!best||end-y0>best[1]))best=[y0,end-y0];}
   if(!best){out.push(null);return;}
   [y,h]=best;heights[i]=h;
  }
  placed.push({left:it.left,right:it.right,top:y,bottom:y+h});out.push(y);
 });
 return out;
}
const SELECTORS=['#wanted','#toast.important.visible','#people-interaction','#cph-hud','#market-prompt','#market-card','#radio-now','.edge-invite'];
const SHRINK=['#people-interaction','#market-card']; // a conversation or a stall's card that does not fit (landscape, a long line) scrolls in the room there is, instead of waiting hidden while it is open
const OBSTACLES=['.topbar .wordmark','#touch-aux','#travel-controls','#touch-controls','.dashboard','#app>.minimap-card']; // the phone minimap has its own corner (under Menu upright, above the steering sideways): the stars and the radio card were drawn over it
export function createTouchDocks(doc=document,win=window){
 let last=0;const styled=new Set(); // elements this pass has moved: put back when they leave it (the toast turns ordinary, touch ends)
 const restore=el=>{el.style.top='';el.style.bottom='';el.style.maxHeight='';el.style.overflowY='';el.classList.remove('dock-wait');styled.delete(el);};
 const slide=el=>{const t=el.classList.contains('tuckable')&&win.getComputedStyle(el).transform;if(!t||t==='none')return 0;const m=/^matrix\(([^)]+)\)/.exec(t);return m?+m[1].split(',')[4]||0:0;}; // the x of a tuck's translateX
 const shown=el=>el&&!el.hidden&&el.getClientRects().length>0&&el.offsetHeight>0&&win.getComputedStyle(el).visibility!=='hidden'; // fixed elements have no offsetParent
 return {
  update(now=performance.now()){
   if(!doc.body.classList.contains('touch')){for(const el of [...styled])restore(el);return;}
   if(now-last<120)return;last=now;
   const els=SELECTORS.map(s=>doc.querySelector(s)).filter(shown);
   for(const el of [...styled])if(!els.includes(el))restore(el);for(const el of els)styled.add(el);
   for(const el of els){el.style.top='';el.style.bottom='auto';} // measure from the CSS anchor, not last frame's top
   // Measured without their sideways slide: a tucked card (touch-tuck.js) is mostly off screen, so it docked by its tab and then came out over the minimap (the radio card: 64 px tucked, over the map, then 276 px out; the next tap on its tab opened the map).
   // Full height even while capped (scrollHeight): taking the cap off to measure would scroll the conversation back to its top.
   const rects=els.map(el=>{const r=el.getBoundingClientRect(),dx=slide(el),full=el.style.maxHeight?Math.max(r.height,el.scrollHeight+r.height-el.clientHeight):r.height;return {left:r.left-dx,right:r.right-dx,height:full,min:SHRINK.some(s=>el.matches?.(s))?120:0};});
   const fixed=OBSTACLES.map(s=>doc.querySelector(s)).filter(shown).map(el=>el.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0);
   // The free band starts at the top row's top (the safe area), and the top-row buttons (Menu) are obstacles like the
   // controls: with no wordmark on phones, the left column rises to the top instead of starting under the Menu row.
   const row=fixed.filter(r=>r.top<80),top=row.length?Math.max(8,Math.min(...row.map(r=>r.top))):8;
   const heights=[],tops=stack(rects,fixed,top,win.innerHeight-8,heights);
   els.forEach((el,i)=>{const offset=win.getComputedStyle(el).position==='fixed'||!el.offsetParent?0:el.offsetParent.getBoundingClientRect().top;
    const cap=heights[i]?`${Math.floor(heights[i])}px`:'';if(el.style.maxHeight!==cap){el.style.maxHeight=cap;el.style.overflowY=cap?'auto':'';}
    if(tops[i]===null){el.classList.add('dock-wait');return;}
    el.classList.remove('dock-wait');el.style.top=`${Math.round(tops[i]-offset)}px`;});
  },
 };
}
