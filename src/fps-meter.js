// Small FPS meter (P, or G when nobody is near to talk to): frames per second, frame time and draw calls.
export function createFpsMeter(renderer){
 const el=document.createElement('div');el.id='fps-meter';el.hidden=true;
 el.style.cssText='position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:60;padding:4px 10px;border-radius:6px;background:rgba(10,14,18,.72);color:#e9f3ea;font:600 12px/1.3 ui-monospace,Menlo,monospace;pointer-events:none;white-space:nowrap';
 document.body.appendChild(el);
 let frames=0,acc=0,worst=0;
 try{el.hidden=localStorage.getItem('fps-meter')!=='1';}catch{}
 return {
  toggle(){el.hidden=!el.hidden;try{localStorage.setItem('fps-meter',el.hidden?'0':'1');}catch{}return !el.hidden;},
  get visible(){return !el.hidden;},
  tick(ms){if(el.hidden||!ms)return;frames++;acc+=ms;worst=Math.max(worst,ms);if(acc<500)return;
   const i=renderer.info.render;el.textContent=`${Math.round(frames*1000/acc)} FPS · ${(acc/frames).toFixed(1)} ms (worst ${worst.toFixed(0)}) · ${i.calls} draws · ${(i.triangles/1e6).toFixed(2)}M tris`;frames=0;acc=0;worst=0;}
 };
}
