// The whole-city map (M): full screen, drag to pan, wheel or +/- to zoom, your position, the current job,
// saga clues and the GPS route; click a named place to travel there, or pick one with the arrow keys or Tab (Shift+Tab
// back) and press Enter.
export function createBigMap({base,view,landmarks,player,targets,route,onTravel,radius}){
 const dlg=document.createElement('dialog');dlg.id='big-map';
 dlg.innerHTML=`<div class="bm-top"><div><p class="eyebrow">THE CITY</p><h2 id="bm-title"></h2></div>
 <div class="bm-legend"><span><i class="bm-you"></i>You</span><span><i style="background:#f2b134"></i>Pick-up</span><span><i style="background:#46c2b0"></i>Drop-off</span><span><i class="bm-race-key" style="background:#9b5de5"></i>Race</span><span><i class="bm-route-key" style="background:#7b3fe4;border-radius:2px"></i>Route</span></div>
 <div class="bm-tools"><button data-z="1.4" aria-label="Zoom in">+</button><button data-z="0.714" aria-label="Zoom out">−</button><button data-fit aria-label="Whole city">Whole city</button><button class="close-btn" aria-label="Close map">×</button></div></div>
 <canvas id="bm-canvas"></canvas><p class="bm-hint">${matchMedia('(pointer:coarse)').matches?'Drag to move · pinch to zoom · tap a place to travel there':'Drag to move · scroll to zoom · click a place to travel there · <kbd>←↑↓→</kbd> / <kbd>Tab</kbd> pick one, <kbd>Enter</kbd> to go · <kbd>M</kbd> / <kbd>ESC</kbd> to close'}</p>`;
 document.body.appendChild(dlg);
 const cv=dlg.querySelector('canvas'),ctx=cv.getContext('2d');
 cv.tabIndex=-1;cv.addEventListener('pointerdown',()=>cv.focus({preventScroll:true})); // a click kept focus on the body, outside the dialog, so M and +/- stopped reaching its key handler
 let zoom=1,cx=0,cz=0,hover=null,drag=null,raf=0,byKey=false; // hover: the place highlighted, under the pointer or picked with the keys (byKey)
 const size=()=>{const r=cv.getBoundingClientRect(),d=Math.min(2,devicePixelRatio||1);cv.width=Math.max(10,r.width*d);cv.height=Math.max(10,r.height*d);};
 // px per metre with the whole playable city in view, but never so far out that the view is wider or taller than the drawn
 // base map (a wide window showed blank strips beside it)
 const fitScale=()=>Math.max(Math.min(cv.width,cv.height)/(radius()*2.15),Math.max(cv.width,cv.height)/view().size);
 const S=()=>fitScale()*zoom;
 const toScreen=(x,z)=>[cv.width/2+(x-cx)*S(),cv.height/2+(z-cz)*S()];
 const toWorld=(px,py)=>[cx+(px-cv.width/2)/S(),cz+(py-cv.height/2)/S()];
 function draw(){
  const v=view(),img=base(),s=S(),k=img.width/v.size;
  ctx.fillStyle='#b3ced0';ctx.fillRect(0,0,cv.width,cv.height);
  // the cached base map covers v.size metres centred on (v.cx, v.cz)
  const [x0,y0]=toScreen(v.cx-v.size/2,v.cz-v.size/2);ctx.imageSmoothingQuality='high';ctx.drawImage(img,x0,y0,v.size*s,v.size*s);
  const dpr=Math.min(2,devicePixelRatio||1);
  const r=route();if(r?.length>1){ctx.strokeStyle=document.body.classList.contains('era-1760')?'#c08a2a':'#7b3fe4';ctx.lineWidth=5*dpr;ctx.lineJoin=ctx.lineCap='round';ctx.beginPath();r.forEach((p,i)=>{const [x,y]=toScreen(...(Array.isArray(p)?p:[p.x,p.z]));i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
  ctx.textAlign='center';
  const taken=[];
  for(const l of [...landmarks()].sort((a,b)=>(a===hover)-(b===hover))){const [x,y]=toScreen(l.x,l.z),h=hover===l;
   ctx.font=`${h?700:600} ${(h?15:12.5)*dpr}px Manrope,sans-serif`;const tw=ctx.measureText(l.name).width,box=[x-tw/2-4,y-26*dpr,x+tw/2+4,y-4*dpr];
   const clash=taken.some(b=>box[0]<b[2]&&box[2]>b[0]&&box[1]<b[3]&&box[3]>b[1]);taken.push(box);
   ctx.fillStyle=h?'#d95e3b':'#2b2d2f';ctx.strokeStyle='#fff';ctx.lineWidth=2*dpr;ctx.beginPath();ctx.arc(x,y,(h?7:5)*dpr,0,Math.PI*2);ctx.fill();ctx.stroke();
   if(clash&&!h)continue;ctx.lineWidth=4*dpr;ctx.strokeStyle='rgba(248,245,238,.95)';ctx.strokeText(l.name,x,y-10*dpr);ctx.fillStyle=h?'#b2401f':'#222';ctx.fillText(l.name,x,y-10*dpr);
   if(h){ctx.font=`600 ${11*dpr}px Manrope,sans-serif`;ctx.lineWidth=3*dpr;const t=byKey?'Enter to travel here':'click to travel here';ctx.strokeText(t,x,y+22*dpr);ctx.fillStyle='#555';ctx.fillText(t,x,y+22*dpr);}}
  for(const t of targets()){const [x,y]=toScreen(...t.p);ctx.fillStyle=t.color;ctx.strokeStyle='#fff';ctx.lineWidth=3*dpr;ctx.beginPath();ctx.arc(x,y,9*dpr,0,Math.PI*2);ctx.fill();ctx.stroke();}
  const p=player();if(p){const [x,y]=toScreen(p.x,p.z);ctx.save();ctx.translate(x,y);ctx.rotate(-p.heading);ctx.fillStyle='#dc5b36';ctx.strokeStyle='#fff9ee';ctx.lineWidth=2.5*dpr;ctx.beginPath();const q=1.6*dpr;ctx.moveTo(0,-8*q);ctx.lineTo(5*q,6*q);ctx.lineTo(0,3*q);ctx.lineTo(-5*q,6*q);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();}
  ctx.fillStyle='#34483d';ctx.font=`700 ${16*dpr}px Manrope,sans-serif`;ctx.fillText('N ↑',cv.width-30*dpr,30*dpr);
  // scale bar
  const m=[100,200,500,1000].find(v=>v*s>80*dpr)||1000;ctx.fillStyle='#2b2d2f';ctx.fillRect(20*dpr,cv.height-24*dpr,m*s,4*dpr);ctx.textAlign='left';ctx.font=`600 ${11*dpr}px Manrope,sans-serif`;ctx.fillText(m>=1000?`${m/1000} km`:`${m} m`,20*dpr,cv.height-30*dpr);
 }
 const loop=()=>{if(!dlg.open)return;draw();raf=requestAnimationFrame(loop);};
 const pick=(px,py)=>{let best=null,d=18*Math.min(2,devicePixelRatio||1);for(const l of landmarks()){const [x,y]=toScreen(l.x,l.z),e=Math.hypot(x-px,y-py);if(e<d){d=e;best=l;}}return best;};
 const local=e=>{const r=cv.getBoundingClientRect(),d=cv.width/r.width;return [(e.clientX-r.left)*d,(e.clientY-r.top)*d];};
 const setZoom=(z,at)=>{const [wx,wz]=at?toWorld(...at):[cx,cz];zoom=Math.max(1,Math.min(10,z));if(at){const [nx,nz]=toWorld(...at);cx+=wx-nx;cz+=wz-nz;}clamp();};
 // Keep the view on the base map: opened at Nyhavn (1 km east of the middle) its right side ran 700 m past the base's edge, blank.
 const clamp=()=>{const v=view(),s=S(),hx=Math.max(0,v.size/2-cv.width/2/s),hz=Math.max(0,v.size/2-cv.height/2/s);cx=Math.max(v.cx-hx,Math.min(v.cx+hx,cx));cz=Math.max(v.cz-hz,Math.min(v.cz+hz,cz));};
 // Two fingers: pinch to zoom about their midpoint (and pan with it); the drag below is for one.
 const fingers=new Map();let pinch=null;
 const spread=()=>{const [a,b]=[...fingers.values()];return {d:Math.hypot(a[0]-b[0],a[1]-b[1]),mid:[(a[0]+b[0])/2,(a[1]+b[1])/2]};};
 cv.addEventListener('pointerdown',e=>{fingers.set(e.pointerId,local(e));try{cv.setPointerCapture(e.pointerId);}catch{/* a pointer already lifted or cancelled by the OS has nothing to capture */}
  if(fingers.size===2){const s0=spread();pinch={d:s0.d,zoom,mid:s0.mid};drag=null;return;}
  if(fingers.size===1)drag={at:local(e),cx,cz,moved:false};});
 const lift=e=>{fingers.delete(e.pointerId);if(fingers.size<2)pinch=null;};
 cv.addEventListener('pointercancel',e=>{lift(e);drag=null;});
 cv.addEventListener('lostpointercapture',e=>{lift(e);if(!fingers.size)drag=null;});
 const resetPointers=()=>{fingers.clear();pinch=null;drag=null;}; // a finger still down when the map closed never lifts here
 cv.addEventListener('pointermove',e=>{const [px,py]=local(e);if(fingers.has(e.pointerId))fingers.set(e.pointerId,[px,py]);
  if(pinch&&fingers.size===2){const s1=spread();const [wx,wz]=toWorld(...pinch.mid);setZoom(pinch.zoom*s1.d/Math.max(1,pinch.d));const [nx,nz]=toWorld(...s1.mid);cx+=wx-nx;cz+=wz-nz;clamp();pinch.mid=s1.mid;return;}
  if(drag){const dx=px-drag.at[0],dy=py-drag.at[1];if(Math.hypot(dx,dy)>6*(cv.width/(cv.clientWidth||cv.width)))drag.moved=true; /* 6 CSS px: a tap that wobbles is still a tap */cx=drag.cx-dx/S();cz=drag.cz-dy/S();clamp();}else{hover=pick(px,py);byKey=false;cv.style.cursor=hover?'pointer':'grab';}});
 cv.addEventListener('pointerup',e=>{const wasPinch=fingers.size>1||pinch;lift(e);const d=drag;drag=null;if(wasPinch)return;if(d&&!d.moved){const l=pick(...local(e));if(l){close();onTravel(l);}}});
 cv.addEventListener('wheel',e=>{e.preventDefault();setZoom(zoom*(e.deltaY<0?1.2:1/1.2),local(e));},{passive:false});
 dlg.querySelectorAll('[data-z]').forEach(b=>b.addEventListener('click',()=>setZoom(zoom*+b.dataset.z)));
 dlg.querySelector('[data-fit]').addEventListener('click',()=>{zoom=1;cx=cz=0;clamp();});
 dlg.querySelector('.close-btn').addEventListener('click',()=>close());
 // Keys: an arrow picks the nearest place that way from the highlighted one (the one nearest the middle of the view first),
 // Tab the next by name (Shift+Tab back; on a button Tab moves between the buttons as usual), Enter travels there. The
 // view follows a pick that lies off it.
 const nearest=()=>{let best=null,d=Infinity;for(const l of landmarks()){const e=Math.hypot(l.x-cx,l.z-cz);if(e<d){d=e;best=l;}}return best;};
 const toward=(dx,dz)=>{const from=hover;if(!from)return nearest();let best=null,score=Infinity;for(const l of landmarks()){const ex=l.x-from.x,ez=l.z-from.z,along=ex*dx+ez*dz,side=Math.abs(ex*dz-ez*dx);if(l===from||along<=0)continue;if(along+side*2<score){score=along+side*2;best=l;}}return best||from;}; // across the line costs double: the one ahead, not the one beside
 const byName=back=>{const list=[...landmarks()].sort((a,b)=>a.name.localeCompare(b.name)),i=list.indexOf(hover);return i<0?nearest():list[(i+(back?-1:1)+list.length)%list.length];};
 const choose=l=>{if(!l)return;hover=l;byKey=true;const [x,y]=toScreen(l.x,l.z),m=60*Math.min(2,devicePixelRatio||1);if(x<m||y<m||x>cv.width-m||y>cv.height-m){cx=l.x;cz=l.z;clamp();}};
 const ARROWS={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]},onButton=e=>e.target?.tagName==='BUTTON';
 dlg.addEventListener('keydown',e=>{const arrow=ARROWS[e.code];
  if(arrow||e.code==='Tab'&&!onButton(e)||(e.code==='Enter'||e.code==='NumpadEnter')&&!onButton(e)&&hover){e.preventDefault();e.stopPropagation();if(arrow)choose(toward(...arrow));else if(e.code==='Tab')choose(byName(e.shiftKey));else{const l=hover;close();onTravel(l);}return;}
  if(e.code==='KeyM'||e.code==='Escape'){e.preventDefault();e.stopPropagation();close();}else if(e.code==='Equal'||e.code==='NumpadAdd')setZoom(zoom*1.4);else if(e.code==='Minus'||e.code==='NumpadSubtract')setZoom(zoom/1.4);});
 dlg.addEventListener('cancel',e=>{e.preventDefault();close();});
 let onClose=null;
 function open(title,closed){resetPointers();hover=null;byKey=false;onClose=closed;dlg.querySelector('#bm-title').textContent=title;dlg.showModal();cv.focus({preventScroll:true});size();const p=player();zoom=2.2;cx=p?.x||0;cz=p?.z||0;frameJob(p);clamp();cancelAnimationFrame(raf);loop();} // focus on the map: the keys pick places from the start
 // With a job on, open on the player and the job's target together, 60 px in from the edges (centred on the player
 // alone, the drop-off at Marmorkirken sat half off the top edge from Nyhavn); zoom out only as far as that needs.
 function frameJob(p){const t=targets().find(t=>t.job);if(!p||!t)return;const [tx,tz]=t.p,m=60*Math.min(2,devicePixelRatio||1),f=fitScale();
  cx=(p.x+tx)/2;cz=(p.z+tz)/2;const dx=Math.abs(tx-p.x)/2,dz=Math.abs(tz-p.z)/2;
  zoom=Math.max(1,Math.min(zoom,dx?(cv.width/2-m)/dx/f:Infinity,dz?(cv.height/2-m)/dz/f:Infinity));}
 function close(){if(!dlg.open)return;resetPointers();dlg.close();cancelAnimationFrame(raf);onClose?.();}
 addEventListener('resize',()=>{if(dlg.open){size();clamp();}});
 return {open,close,get open_(){return dlg.open;},get selected(){return hover;},get centre(){return [cx,cz];},get scale(){return S();},element:dlg};
}
