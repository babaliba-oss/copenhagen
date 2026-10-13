// Tile streaming without hitches: atlases decode off the main thread, tiles ahead of the car load
// first, the worker details only nearby tiles, and GPU uploads are rationed across frames.

export async function loadTileImages(files,url=f=>f){
 const entries=await Promise.allSettled(files.map(async file=>{
  const r=await fetch(url(file));if(!r.ok)throw Error(`Could not load ${url(file)} (${r.status})`);
  const blob=await r.blob();
  // The bitmap feeds the GPU texture; the encoded bytes go to the worker, which decodes its own copy.
  const [image,encoded]=await Promise.allSettled([createImageBitmap(blob,{premultiplyAlpha:'none',colorSpaceConversion:'none'}),blob.arrayBuffer()]);
  if(image.status==='rejected')throw image.reason;
  if(encoded.status==='rejected'){image.value.close();throw encoded.reason;}
  return [file,{bitmap:image.value,bytes:encoded.value}];
 }));
 const failed=entries.find(e=>e.status==='rejected');
 // Wait for every decode before cleanup: an early HTTP failure must not leave
 // a later successful bitmap alive after the entire tile has been abandoned.
 if(failed){for(const e of entries)if(e.status==='fulfilled')e.value[1].bitmap.close();throw failed.reason;}
 return new Map(entries.map(e=>e.value));
}

export function tileDistanceTo(t,p){const b=t.bbox;return Math.hypot(Math.max(b[0]-p.x,0,p.x-b[2]),Math.max(b[1]-p.z,0,p.z-b[3]));}

// Where the car will be in a few seconds; tiles there matter as much as tiles here.
export function aheadPoint(car,seconds=4,max=160){
 if(!car)return null;
 const d=Math.min(max,Math.max(0,car.speed)*seconds);
 return {x:car.x-Math.sin(car.heading)*d,z:car.z-Math.cos(car.heading)*d};
}
export function tilePriority(t,focus,ahead){const d=tileDistanceTo(t,focus);return ahead?Math.min(d,tileDistanceTo(t,ahead)):d;}

// Jobs that create GPU resources (texture init, a building's meshes) run a couple per frame.
export function createFrameQueue({maxJobs=2,budgetMs=2.5}={}){
 // Jobs may carry a priority function (lower runs first, e.g. distance to the player); others run in order.
 const jobs=[];let seq=0;
 const pick=()=>{let bi=0,bp=Infinity;for(let i=0;i<jobs.length;i++){const j=jobs[i],p=j.p?j.p():j.s*1e-9-1e9;if(p<bp){bp=p;bi=i;}}return jobs.splice(bi,1)[0];};
 return {
  push(job,priority=null){jobs.push({run:job,p:priority,s:seq++});},
  get size(){return jobs.length;},
  step(){const t=performance.now();let n=0;while(jobs.length&&n<maxJobs&&(n===0||performance.now()-t<budgetMs)){pick().run();n++;}return n;}
 };
}

// Detail work goes to the worker nearest-first, a bounded number of tiles in flight. A tile that
// drifts away before its turn is cancelled; one already in flight simply lands hidden.
export function createDetailScheduler(concurrency=2){
 const waiting=new Map();let inFlight=0;
 const pump=()=>{
  while(inFlight<concurrency&&waiting.size){
   let best=null;for(const e of waiting.values())if(!best||e.priority<best.priority)best=e;
   waiting.delete(best.key);inFlight++;
   Promise.resolve().then(best.start).catch(e=>best.onError?.(e)).finally(()=>{inFlight--;pump();});
  }
 };
 return {
  request(key,priority,start,onError){const e=waiting.get(key);if(e){e.priority=priority;return false;}waiting.set(key,{key,priority,start,onError});pump();return true;},
  cancel(key){return waiting.delete(key);},
  has(key){return waiting.has(key);},
  get waiting(){return waiting.size;},
  get inFlight(){return inFlight;}
 };
}
