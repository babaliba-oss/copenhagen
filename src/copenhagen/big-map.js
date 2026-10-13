// The whole-city map (M): full screen, drag to pan, wheel or +/- to zoom, your position, the current job,
// saga clues and the GPS route; click a named place to travel there.
export function createBigMap({base,view,landmarks,player,targets,route,onTravel,radius}){
 const dlg=document.createElement('dialog');dlg.id='big-map';
 dlg.innerHTML=`<div class="bm-top"><div><p class="eyebrow">THE CITY</p><h2 id="bm-title"></h2></div>
 <div class="bm-legend"><span><i class="bm-you"></i>You</span><span><i style="background:#f2b134"></i>Pick-up</span><span><i style="background:#46c2b0"></i>Drop-off</span><span><i style="background:#9b5de5"></i>Race</span><span><i style="background:#7b3fe4;border-radius:2px"></i>Route</span></div>
 <div class="bm-tools"><button data-z="1.4" aria-label="Zoom in">+</button><button data-z="0.714" aria-label="Zoom out">−</button><button data-fit aria-label="Whole city">Whole city</button><button class="close-btn" aria-label="Close map">×</button></div></div>
 <canvas id="bm-canvas"></canvas><p class="bm-hint">Drag to move · scroll to zoom · click a place to travel there · <kbd>M</kbd> / <kbd>ESC</kbd> to close</p>`;
 document.body.appendChild(dlg);
 const cv=dlg.querySelector('canvas'),ctx=cv.getContext('2d');
 let zoom=1,cx=0,cz=0,hover=null,drag=null,raf=0;
 const size=()=>{const r=cv.getBoundingClientRect(),d=Math.min(2,devicePixelRatio||1);cv.width=Math.max(10,r.width*d);cv.height=Math.max(10,r.height*d);};
 const fitScale=()=>Math.min(cv.width,cv.height)/(radius()*2.15); // px per metre with the whole playable city in view
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
   if(h){ctx.font=`600 ${11*dpr}px Manrope,sans-serif`;ctx.lineWidth=3*dpr;ctx.strokeText('click to travel here',x,y+22*dpr);ctx.fillStyle='#555';ctx.fillText('click to travel here',x,y+22*dpr);}}
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
 const clamp=()=>{const R=radius()*1.1;cx=Math.max(-R,Math.min(R,cx));cz=Math.max(-R,Math.min(R,cz));};
 cv.addEventListener('pointerdown',e=>{drag={at:local(e),cx,cz,moved:false};cv.setPointerCapture(e.pointerId);});
 cv.addEventListener('pointermove',e=>{const [px,py]=local(e);if(drag){const dx=px-drag.at[0],dy=py-drag.at[1];if(Math.hypot(dx,dy)>4)drag.moved=true;cx=drag.cx-dx/S();cz=drag.cz-dy/S();clamp();}else{hover=pick(px,py);cv.style.cursor=hover?'pointer':'grab';}});
 cv.addEventListener('pointerup',e=>{const d=drag;drag=null;if(d&&!d.moved){const l=pick(...local(e));if(l){close();onTravel(l);}}});
 cv.addEventListener('wheel',e=>{e.preventDefault();setZoom(zoom*(e.deltaY<0?1.2:1/1.2),local(e));},{passive:false});
 dlg.querySelectorAll('[data-z]').forEach(b=>b.addEventListener('click',()=>setZoom(zoom*+b.dataset.z)));
 dlg.querySelector('[data-fit]').addEventListener('click',()=>{zoom=1;cx=cz=0;});
 dlg.querySelector('.close-btn').addEventListener('click',()=>close());
 dlg.addEventListener('keydown',e=>{if(e.code==='KeyM'||e.code==='Escape'){e.preventDefault();e.stopPropagation();close();}else if(e.code==='Equal'||e.code==='NumpadAdd')setZoom(zoom*1.4);else if(e.code==='Minus'||e.code==='NumpadSubtract')setZoom(zoom/1.4);});
 dlg.addEventListener('cancel',e=>{e.preventDefault();close();});
 let onClose=null;
 function open(title,closed){onClose=closed;dlg.querySelector('#bm-title').textContent=title;dlg.showModal();size();const p=player();zoom=2.2;cx=p?.x||0;cz=p?.z||0;clamp();cancelAnimationFrame(raf);loop();}
 function close(){if(!dlg.open)return;dlg.close();cancelAnimationFrame(raf);onClose?.();}
 addEventListener('resize',()=>{if(dlg.open)size();});
 return {open,close,get open_(){return dlg.open;},element:dlg};
}
