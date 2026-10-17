// ?perf: a small overlay for finding stalls on real machines. Frame time, JS heap, GPU-side counts
// (shader programs, textures, geometries) and the last slow frames with what changed in them, so a
// screenshot taken during a stall says whether it was a shader compile, texture uploads, new
// geometry, or neither (then garbage collection is the usual suspect: the heap drops across it).
export function createPerfOverlay(renderer,{doc=document,extra=()=>({})}={}){
 const el=doc.createElement('pre');el.id='perf-overlay';
 el.style.cssText='position:fixed;left:8px;top:8px;z-index:200;margin:0;padding:8px 10px;background:rgba(10,12,14,.82);color:#cfe8d0;font:11px/1.35 ui-monospace,Menlo,monospace;pointer-events:none;white-space:pre;border-radius:6px;max-width:46vw';
 doc.body.append(el);
 // F9 copies the report as text (paste it into the chat instead of a screenshot)
 addEventListener('keydown',e=>{if(e.code==='F9'){e.preventDefault();navigator.clipboard?.writeText(el.textContent+'\n'+navigator.userAgent).then(()=>{el.style.outline='2px solid #8f8';setTimeout(()=>el.style.outline='',600);});}});
 const slow=[];let last=null,acc=0,frames=0,worst=0,shown=0,jsAcc=0,drawAcc=0,splits=0,jsShown=0,drawShown=0;
 const heap=()=>performance.memory?Math.round(performance.memory.usedJSHeapSize/1e6):0;
 const snap=()=>({p:renderer.info.programs?.length||0,t:renderer.info.memory.textures,g:renderer.info.memory.geometries,h:heap(),c:renderer.info.render.calls,tr:renderer.info.render.triangles,...extra()});
 return {
  // CPU time of the game code and of handing the frame to the GPU (three.js + WebGL calls), averaged: when both
  // together are far below the frame time, the GPU (fill rate, shadows, post) is what limits the frame rate.
  split(js,draw){jsAcc+=js;drawAcc+=draw;splits++;},
  tick(frameMs,now){
   const s=snap();
   if(last&&frameMs>70){slow.unshift(`${new Date().toTimeString().slice(0,8)} ${String(Math.round(frameMs)).padStart(4)}ms  prog${d(s.p-last.p)} tex${d(s.t-last.t)} geo${d(s.g-last.g)} heap${d(s.h-last.h)}MB${s.note?' '+s.note:''}`);if(slow.length>12)slow.pop();}
   last=s;acc+=frameMs;frames++;worst=Math.max(worst,frameMs);
   if(now-shown>500){
    const fps=frames?1000/(acc/frames):0;
    if(splits){jsShown=jsAcc/splits;drawShown=drawAcc/splits;jsAcc=drawAcc=splits=0;}
    el.textContent=`${fps.toFixed(0)} fps  avg ${(acc/Math.max(1,frames)).toFixed(1)}ms  worst ${worst.toFixed(0)}ms\ncpu: game ${jsShown.toFixed(1)}ms  draw ${drawShown.toFixed(1)}ms\nheap ${s.h} MB  programs ${s.p}  textures ${s.t}  geometries ${s.g}\ndraw calls ${s.c}  triangles ${(s.tr/1e6).toFixed(2)}M  ${s.q||''}\n— slow frames (>70 ms) — press F9 to copy —\n${slow.join('\n')}`;
    acc=0;frames=0;worst=0;shown=now;}
  }
 };
}
const d=v=>v>0?`+${v}`:v<0?`${v}`:'·';
