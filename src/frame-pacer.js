// Phones that cannot hold 60 fps ran at an uneven 35-50 fps, which reads as stutter. Such a device is held at an even
// 30 (a frame on every second vsync) instead; every 45 s it tries 60 again for a few seconds and keeps it if it holds.
export function createFramePacer({enabled=true,slowMs=21,holdFor=3,retryEvery=45,trialFor=4}={}){
 let half=false,avg=16.7,slowFor=0,since=0,trial=0,last=0,prev=0,vsync=16.7;
 return {
  get half(){return half;},
  // true: skip this vsync (nothing is simulated or drawn). A 30 fps frame is due 33 ms after the last; vsync jitter allowed.
  // The display's vsync is the shortest interval seen (slowly forgotten): due at 33 ms less half a vsync, so 60, 90 and 120 Hz
  // screens all land on an even 30 (a fixed 25 ms cut alternated 25 and 33 ms frames at 120 Hz).
  skip(now){const d=now-prev;prev=now;if(d>3&&d<40)vsync=Math.min(vsync*1.002,d);if(!half)return false;if(last&&now-last<33.3-vsync/2)return true;last=now;return false;},
  // frameMs: time since the last drawn frame; dt in seconds.
  record(frameMs,dt){
   if(!enabled||!(frameMs>0)||frameMs>250)return;
   const per=half?frameMs/2:frameMs;avg+=(per-avg)*.05;
   if(!half){
    if(trial>0){trial-=dt;if(avg>slowMs){half=true;since=0;trial=0;return;}if(trial<=0)trial=0;} // the 60 fps trial failed: back to 30
    slowFor=avg>slowMs?slowFor+dt:0;if(slowFor>holdFor){half=true;since=0;slowFor=0;}
   }else if((since+=dt)>retryEvery){half=false;trial=trialFor;avg=16.7;slowFor=0;last=0;}
  },
  // For the resolution governor: the frame time it would see at 60 fps (a steady 30 is not a slow GPU).
  effective(frameMs){return half?frameMs/2:frameMs;}
 };
}
