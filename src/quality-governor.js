// When the lowest render resolution is still too slow (a MacBook Air on a big display, say), give up the
// costly extras one at a time: ambient occlusion, then bloom and shadow-map size, then MSAA. Each step waits
// for the frame time to settle; nothing comes back during the session, so the picture never pumps.
// cpuBound (adaptive-quality.js): the CPU limits the frame (draw calls), so the resolution never reaches its minimum;
// slow CPU-bound frames step down too, starting with cpuStep (the one that saves draw calls; the others only GPU time).
export function createQualityGovernor(steps,{slowMs=24,holdSeconds=4,settleSeconds=3,cpuStep=-1}={}){
 let slowFor=0,settle=0;const done=new Set();
 return {
  get level(){return done.size;},
  has(i){return done.has(i);},
  update(dt,{atMin,smoothed,cpuBound=false}){
   if(done.size>=steps.length)return false;
   settle=Math.max(0,settle-dt);
   slowFor=(atMin||cpuBound)&&smoothed>slowMs&&settle===0?slowFor+dt:0;
   if(slowFor<holdSeconds)return false;
   // CPU-bound only the draw-call step helps; the GPU steps (AO, bloom, MSAA) would cost looks for nothing.
   if(cpuBound&&!atMin&&(cpuStep<0||done.has(cpuStep))){slowFor=0;return false;}
   let i=cpuBound&&!atMin?cpuStep:0;while(done.has(i))i++;
   steps[i]();done.add(i);slowFor=0;settle=settleSeconds;return true;
  }
 };
}
