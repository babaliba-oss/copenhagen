// Dynamic resolution: trade a little sharpness for a steady frame rate.
// Drops quickly under sustained load, but climbs back slowly and never straight back into a level
// that just proved too slow — otherwise it oscillates, and every change is a visible resolution pop.
// Callers must apply a new scale BEFORE rendering: resizing the canvas clears it.
export function createAdaptiveResolution({max=1.5,min=.75,target=18,relax=13,step=.125,downCooldown=1.5,upAfter=6,retryAfter=30}={}){
  let scale=max,smoothed=16.7,wait=0,fastFor=0,clock=0,slowRun=0,cpu=0;
  const failedAt=new Map(); // scale level -> time it was abandoned for being too slow
  const key=s=>s.toFixed(3);
  let locked=null; // capture mode: hold one fixed scale (no adaptive steps at all)
  return {
    get scale(){return locked??scale;},
    get locked(){return locked!==null;},
    get smoothed(){return smoothed;},
    get atMin(){return (locked??scale)<=min+1e-6;},
    // Lock to a fixed pixel ratio (video capture: no resolution steps mid-take). Returns true when the
    // renderer must be resized now; unlock() resumes adaptation from the max level.
    lock(value){const was=this.scale;locked=value;return value!==was;},
    unlock(){if(locked===null)return false;const was=locked;locked=null;scale=max;smoothed=(target+relax)/2;wait=downCooldown;fastFor=0;return scale!==was;},
    // cpuMs (optional): main-thread time of the frame (game code plus handing it to the GPU). When that is most of
    // the frame the CPU is the limit (draw calls on Windows): fewer pixels would only blur the picture, and each step
    // resizes the canvas (a hitch), so the resolution holds.
    get cpuBound(){return cpu>smoothed*.85;},
    update(frameMs,dt,cpuMs=0){
      if(locked!==null)return false;
      if(cpuMs>0&&cpuMs<1000)cpu=cpu?cpu+(cpuMs-cpu)*.08:cpuMs;
      // Tab switches, tile uploads and GC pauses are one-off spikes, not sustained load. But a run of slow
      // frames (a GPU that only manages 8-15 fps at this resolution) is load, and must count.
      if(!(frameMs>0)||frameMs>1000){slowRun=0;return false;}
      if(frameMs>Math.max(50,smoothed*3)){if(++slowRun<6)return false;smoothed=Math.max(smoothed,frameMs*.5);}else slowRun=0;
      clock+=dt;smoothed+=(frameMs-smoothed)*.08;wait=Math.max(0,wait-dt);
      fastFor=smoothed<relax?fastFor+dt:0;
      if(wait>0)return false;
      if(smoothed>target&&scale>min&&!(cpu>smoothed*.85)){
        failedAt.set(key(scale),clock);scale=Math.max(min,scale-step);
      }else if(fastFor>=upAfter&&scale<max){
        const next=Math.min(max,scale+step),failed=failedAt.get(key(next));
        if(failed!==undefined&&clock-failed<retryAfter)return false;
        scale=next;
      }else return false;
      wait=downCooldown;fastFor=0;smoothed=(target+relax)/2;return true;
    }
  };
}
