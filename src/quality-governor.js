// When the lowest render resolution is still too slow (a MacBook Air on a big display, say), give up the
// costly extras one at a time: ambient occlusion, then bloom and shadow-map size, then MSAA. Each step waits
// for the frame time to settle; nothing comes back during the session, so the picture never pumps.
export function createQualityGovernor(steps,{slowMs=24,holdSeconds=4,settleSeconds=3}={}){
 let level=0,slowFor=0,settle=0;
 return {
  get level(){return level;},
  update(dt,{atMin,smoothed}){
   if(level>=steps.length)return false;
   settle=Math.max(0,settle-dt);
   slowFor=atMin&&smoothed>slowMs&&settle===0?slowFor+dt:0;
   if(slowFor<holdSeconds)return false;
   steps[level++]();slowFor=0;settle=settleSeconds;return true;
  }
 };
}
