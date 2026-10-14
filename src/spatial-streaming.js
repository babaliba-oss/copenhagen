// Bounded, nearest-first loading shared by ground tiles and map regions.
// Loaded records stay installed: moving away never resets gameplay state.
export function distanceToBounds(bounds,p){
 if(!p||!bounds||bounds.length!==4||!bounds.every(Number.isFinite))return 0;
 return Math.hypot(Math.max(bounds[0]-p.x,0,p.x-bounds[2]),Math.max(bounds[1]-p.z,0,p.z-bounds[3]));
}
export function streamingAhead(p,seconds=12){
 const d=Math.max(-500,Math.min(500,(p?.speed||0)*seconds));
 return p?{x:p.x-Math.sin(p.heading||0)*d,z:p.z-Math.cos(p.heading||0)*d}:null;
}
export function createSpatialStreamer({load,keyOf=r=>r.id??r.file,boundsOf=r=>r.bbox,concurrency=3,retryDelay=1000,maxAttempts=3,onError=null,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout}={}){
 if(typeof load!=='function')throw Error('A spatial streamer needs a load function');
 if(!Number.isInteger(concurrency)||concurrency<1)throw Error('Streaming concurrency must be a positive integer');
 const jobs=new Map(),controller=new AbortController();let active=0,timer=null,disposed=false,view=null,range=0,ahead=null;
 const priority=job=>Math.min(distanceToBounds(boundsOf(job.record),view),ahead?distanceToBounds(boundsOf(job.record),ahead):Infinity);
 const wanted=job=>job.waiters.length>0||job.near;
 const urgent=job=>job.waiters.some(w=>!w.background);
 function wake(){
  if(disposed)return;
  if(timer!==null){clearTimer(timer);timer=null;}
  if(active>=concurrency)return;
  const retry=[...jobs.values()].filter(j=>wanted(j)&&j.status==='error'&&j.waiters.length&&j.attempts<maxAttempts).map(j=>j.retryAt);
  if(retry.length)timer=setTimer(()=>{timer=null;pump();},Math.max(0,Math.min(...retry)-now()));
 }
 function pump(){
  if(disposed)return;
  while(active<concurrency){
   const next=[...jobs.values()].filter(j=>wanted(j)&&(j.status==='idle'||j.status==='error'&&j.retryAt<=now())).sort((a,b)=>(urgent(a)?0:1)-(urgent(b)?0:1)||a.priority-b.priority||a.order-b.order)[0];
   if(!next)break;
   next.status='loading';next.attempts++;active++;
   Promise.resolve().then(()=>{if(disposed)throw controller.signal.reason;return load(next.record,{signal:controller.signal});}).then(value=>{
    if(disposed)return;
    next.status='ready';next.value=value;next.error=null;
    for(const w of next.waiters.splice(0))w.resolve(value);
   }).catch(error=>{
    if(disposed)return;
    next.status='error';next.error=error;next.retryAt=now()+Math.max(1,Math.min(30000,retryDelay*2**(next.attempts-1)));
    if(next.attempts>=maxAttempts)for(const w of next.waiters.splice(0))w.reject(error);
    onError?.(error,next.record);
   }).finally(()=>{active--;pump();wake();});
  }
  wake();
 }
 function add(records){
  for(const record of records||[]){const key=keyOf(record);if(key===undefined||key===null)throw Error('A streamed record needs a stable key');
   const old=jobs.get(key);if(old){old.record=record;continue;}
   const job={record,key,status:'idle',attempts:0,retryAt:0,waiters:[],priority:Infinity,near:false,order:jobs.size};
   if(view){job.priority=priority(job);job.near=job.priority<=range;}jobs.set(key,job);
  }
  return api;
 }
 function update(position,{radius=800,aheadSeconds=12}={}){
  if(disposed)return;view=position?{...position}:null;range=radius;ahead=streamingAhead(position,aheadSeconds);
  for(const job of jobs.values()){job.priority=priority(job);job.near=!!view&&job.priority<=range;}
  pump();
 }
 function requireKeys(keys,{background=false}={}){
  if(disposed)return Promise.reject(controller.signal.reason);
  const requests=keys.map(key=>{const job=jobs.get(key);if(!job)throw Error(`Unknown streamed record: ${key}`);
   if(job.status==='ready')return Promise.resolve(job.value);
   if(job.status==='error'&&job.attempts>=maxAttempts){job.attempts=0;job.retryAt=now();}
   return new Promise((resolve,reject)=>job.waiters.push({resolve,reject,background}));
  });
  pump();return Promise.all(requests);
 }
 const api={add,update,require:requireKeys,
  ensure(position,options={}){update(position,options);return requireKeys([...jobs.values()].filter(j=>j.near).map(j=>j.key));},
  get(key){return jobs.get(key)?.value;},
  // Unload what is far away (beyond `distance` of position): the value goes to onEvict and the record
  // returns to idle, so it loads again when the player comes back. Only for purely visual records.
  evictFar(position,distance,onEvict){if(disposed||!position)return 0;let n=0;
   for(const j of jobs.values())if(j.status==='ready'&&!j.waiters.length&&distanceToBounds(boundsOf(j.record),position)>distance){const v=j.value;j.value=undefined;j.status='idle';j.attempts=0;j.near=false;n++;onEvict?.(v,j.record);}
   return n;},
  state(key){return jobs.get(key)?.status??null;},
  snapshot(){const counts={total:jobs.size,ready:0,loading:0,queued:0,failed:0};for(const j of jobs.values()){if(j.status==='ready')counts.ready++;else if(j.status==='loading')counts.loading++;else if(j.status==='error')counts.failed++;else if(wanted(j))counts.queued++;}return counts;},
  dispose(){disposed=true;controller.abort(Error('The streamer was disposed'));if(timer!==null)clearTimer(timer);timer=null;for(const j of jobs.values()){j.near=false;if(j.status==='loading')j.status='cancelled';for(const w of j.waiters.splice(0))w.reject(controller.signal.reason);}},
 };
 return api;
}
