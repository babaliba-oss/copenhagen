// Plays the Copenhagen game layer (src/copenhagen/game.js) on the real city data, without a page: a few HTML stand-ins
// for the HUD, the player moved from spot to spot, update() stepped by hand.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {gunzipSync} from 'node:zlib';import {register} from 'node:module';
register('data:text/javascript,'+encodeURIComponent("export async function load(u,c,n){return u.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:n(u,c);}"));
class El{constructor(){this.hidden=false;this.innerHTML='';this.style={};this.dataset={};this.attrs={};this.classList={add(){},remove(){},contains:()=>false,toggle(){}};}setAttribute(k,v){this.attrs[k]=v;}append(){}replaceChildren(){}remove(){}querySelector(){return null;}querySelectorAll(){return [];}getContext(){return new Proxy({},{get:()=>()=>({addColorStop(){}})});}get offsetWidth(){return 0;}}
const ids=new Map(),body=new El(),store=new Map();
globalThis.document={body,createElement:()=>{const e=new El();body.last=e;return e;},getElementById:id=>{if(!ids.has(id))ids.set(id,new El());return ids.get(id);},querySelector:()=>null,querySelectorAll:()=>[]};
Object.defineProperty(body,'append',{value:(...els)=>{for(const e of els)if(e.id)ids.set(e.id,e);}});
globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
globalThis.addEventListener=globalThis.removeEventListener=()=>{};globalThis.fetch=async()=>{throw Error('offline');};
const THREE=await import('three'),{expandCity}=await import('../src/city-pack.js'),{expandMobility}=await import('../src/mobility-pack.js'),{SpatialIndex,inWaterPolygons}=await import('../src/geo.js');
const {createCopenhagenGame}=await import('../src/copenhagen/game.js'),{JOBS,JOBS_1760,SAGAS}=await import('../src/copenhagen/data.js');
const cities=JSON.parse(fs.readFileSync('public/cities/index.json','utf8')).cities;
function play(id,prep=()=>{}){
 let c=fs.readFileSync(`public/cities/${id}/city.pack`);if(c[0]===0x1f)c=gunzipSync(c);const data=expandCity(JSON.parse(c)),houses=new SpatialIndex(data.buildings);prep(data);
 const g=createCopenhagenGame({scene:new THREE.Scene(),city:cities.find(x=>x.id===id),mobilityData:expandMobility(JSON.parse(fs.readFileSync(`public/cities/${id}/mobility.json`,'utf8'))),cityData:data,toast(){},soundOn:()=>false,blocked:(x,z)=>!!houses.at(x,z),routeSlice:Infinity}); // routeSlice: each new line at once (in the game a new line's groundwork is spread over frames)
 const me={x:0,z:0,speed:0,heading:0},banner=()=>ids.get('cph-banner')?.innerHTML.replace(/<[^>]+>/g,'')||'';
 const at=([x,z],mode='car',steps=2,dt=1/30)=>{me.x=x;me.z=z;for(let i=0;i<steps;i++)g.update(dt,me,mode,{running:true});};
 const line=()=>(g.route()||[]).reduce((s,p,i,a)=>i?s+Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1]):0,0);
 return {g,at,banner,line,job:()=>g.minimapTargets().at(-1).p,data};
}
test('today: a job picked up where the last was delivered waits, and each delivery clock follows the way round the houses',()=>{
 const {g,at,banner,line,job}=play('copenhagen'),k=JOBS.findIndex(j=>j.b[2]==='Den Sorte Diamant');assert.equal(JOBS[k+1].a[2],'Den Sorte Diamant');
 for(let i=0;i<=k+1;i++){
  at([5000,5000],'car',90);const A=job();at(A);assert.equal(g.debug().state,'b',`job ${i} picked up`);
  const B=job();at(A,'car',1,.001);at(A,'walk',1,.25); /* the GPS line on foot from the pick-up (a change of mode draws it again) */
  const clock=Number(ids.get('cph-job').innerHTML.match(/(\d+) s</)[1]);assert.ok(line()/clock<7,`job ${i}: ${line()|0} m in ${clock} s is beyond a bike`);
  at(B,'car',1);assert.equal(g.debug().state,'a',`job ${i} delivered`);}
 assert.match(banner(),/Delivered!|Promoted:/);at(job(),'car',30);assert.match(banner(),/Delivered!|Promoted:/,'"Delivered!" stays up'); /* the 9th delivery is also a promotion */assert.equal(g.debug().state,'a');
 at(job(),'car',60);assert.equal(g.debug().state,'b','the next job is picked up after the pause');
});
test('1760: Fire Watch can be done by coach, and the coach line ignores today\'s one-way streets',()=>{
 const {g,at,line}=play('copenhagen-1760'),q=SAGAS.find(s=>s.id==='fire');
 g.api.sagaAccept('fire');let total=0,from=g.people.find(x=>x.script==='watchman'),here=[from.x,from.z];
 for(let n=0;n<q.steps.length;n++){at(here,'walk',1,.001);at(here,'car',1,.001);total+=line(); /* the coach's line from here to the nearest lantern (the line's own choice) */
  const t=g.minimapTargets().filter(m=>m.color==='#e0313e').map(m=>m.p).sort((a,b)=>Math.hypot(a[0]-here[0],a[1]-here[1])-Math.hypot(b[0]-here[0],b[1]-here[1]));here=t[0];at(here,'car',2,.001);}
 assert.equal(g.debug().started,true);assert.equal(store.has('cph-game-v1-1760')&&JSON.parse(store.get('cph-game-v1-1760')).done.fire,1,'saga complete');
 assert.ok(total/q.limit<11,`${total|0} m in ${q.limit} s`);
});
test('a map saga (Holger Danske) starts with "find the X", not a red beam it does not have',()=>{
 const {g,banner}=play('copenhagen-1760');g.api.sagaAccept('holger');assert.match(banner(),/find the X on the map/);assert.doesNotMatch(banner(),/red beam/);
});
test('arriving on a race start by the map or a reset does not start the race; driving off and back does',()=>{
 const {g,at}=play('copenhagen-1760'),start=g.minimapTargets().find(t=>t.small).p;
 at([start[0]+60,start[1]],'car',2);g.teleported();at(start,'car',3);assert.equal(g.debug().race,null,'not started on arrival');
 at([start[0]+60,start[1]],'car',2);at(start,'car',2);assert.ok(g.debug().race,'started after driving off and back');
});
test('today: the Opera\'s GPS line ends on its own side of the canal, by car and on foot',()=>{
 store.set('cph-game-v1',JSON.stringify({job:JOBS.findIndex(j=>j.b[2]==='Operaen')})); /* straight to the Opera job */const {g,at,job,data}=play('copenhagen'),roads=new SpatialIndex(data.roads),pave=new SpatialIndex(data.pavement||[]);
 const wet=P=>{let w=0;for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(L);for(let j=0;j<n;j++){const x=a[0]+(b[0]-a[0])*(j+.5)/n,z=a[1]+(b[1]-a[1])*(j+.5)/n;if(inWaterPolygons(data.water,x,z)&&!roads.at(x,z)&&!pave.at(x,z))w+=L/n;}}return w;};
 at([5000,5000],'car',90);const A=job();at(A);assert.equal(g.debug().state,'b');
 for(const m of ['car','walk']){at(A,m,1,.001);const w=wet(g.route());assert.ok(w<3,`${m}: ${w|0} m of the line over open water`);} /* was 67 m straight over the canal from Papirøen */
});
test('today: near a job\'s end with nothing in the way, the line goes straight there, not round the block',()=>{
 store.delete('cph-game-v1');const {g,at,line,job,data}=play('copenhagen'),houses=new SpatialIndex(data.buildings),roads=new SpatialIndex(data.roads),pave=new SpatialIndex(data.pavement||[]);
 const clear=(a,b)=>{const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])*2);for(let i=1;i<n;i++){const x=a[0]+(b[0]-a[0])*i/n,z=a[1]+(b[1]-a[1])*i/n;if(houses.at(x,z)||inWaterPolygons(data.water,x,z))return false;}return true;};
 at([5000,5000],'car',90);at(job());at(job());at([5000,5000],'car',90);at(job());assert.equal(JOBS[1].b[2],'Amalienborg');const B=job();let checked=0;
 for(let k=0;k<8;k++){const P=[B[0]+25*Math.cos(k*Math.PI/4),B[1]+25*Math.sin(k*Math.PI/4)];if(!(roads.at(...P)||pave.at(...P))||!clear(P,B))continue;
  for(const m of ['car','walk']){at(P,m==='car'?'walk':'car',1,.001);at(P,m,1,.001);assert.ok(line()<40,`${m} 25 m from Amalienborg: a ${line()|0} m line`);checked++;}} /* was 2352 m by car */
 assert.ok(checked>=2,'some spots checked');
});
test('no job or saga line, in either era, by car or on foot, runs over open water off the bridges; by car none over a lawn off the roads and paths, and a job\'s ends are reached',()=>{
 for(const id of ['copenhagen','copenhagen-1760']){
  store.clear();let {g,at,job,data}=play(id);const roads=new SpatialIndex(data.roads),pave=new SpatialIndex(data.pavement||[]),parks=new SpatialIndex(data.parks||[]),era=id==='copenhagen'?'m':'h',bad=[];
  const M=expandMobility(JSON.parse(fs.readFileSync(`public/cities/${id}/mobility.json`,'utf8'))),segs=new Map(),C=10;for(const G of [M.walks,M.roads])for(const e of G.edges)for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/5);for(let k=0;k<=n;k++){const key=Math.floor((a[0]+(b[0]-a[0])*k/n)/C)+','+Math.floor((a[1]+(b[1]-a[1])*k/n)/C);if(!segs.has(key))segs.set(key,new Set());segs.get(key).add(e.points.slice(i-1,i+1));}}
  const onPath=(x,z)=>{const gx=Math.floor(x/C),gz=Math.floor(z/C);for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const [a,b] of segs.get((gx+i)+','+(gz+j))||[]){const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));if(Math.hypot(a[0]+dx*t-x,a[1]+dz*t-z)<2.5)return true;}return false;}; /* a footway over the grass: the car can take it */
  const rough=P=>{let run=0,worst=0;for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(L);for(let j=0;j<n;j++){const x=a[0]+(b[0]-a[0])*(j+.5)/n,z=a[1]+(b[1]-a[1])*(j+.5)/n;if(Math.hypot(x-P[0][0],z-P[0][1])>10&&parks.at(x,z)&&!roads.at(x,z)&&!pave.at(x,z)&&!onPath(x,z))worst=Math.max(worst,run+=L/n);else run=0;}}return worst;}; /* from 10 m on: where the car stands may be on the grass */
  const wet=P=>{let w=0;for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(L);for(let j=0;j<n;j++){const x=a[0]+(b[0]-a[0])*(j+.5)/n,z=a[1]+(b[1]-a[1])*(j+.5)/n;if(inWaterPolygons(data.water,x,z)&&!roads.at(x,z)&&!pave.at(x,z))w+=L/n;}}return w;};
  const check=(label,here,spot)=>{for(const m of ['car','walk']){at(here,m==='car'?'walk':'car',1,.001);at(here,m,1,.001);const P=g.route()||[],w=wet(P);if(w>=3)bad.push(`${label} ${m}: ${w|0} m`);if(m!=='car')continue;const r=rough(P);if(r>=5)bad.push(`${label} car: ${r|0} m over a lawn`);if(spot&&P.length&&Math.hypot(P.at(-1)[0]-spot[0],P.at(-1)[1]-spot[1])>9)bad.push(`${label} car: ends ${Math.hypot(P.at(-1)[0]-spot[0],P.at(-1)[1]-spot[1])|0} m short`);}};
  let here=[5000,5000];at(here,'car',90);
  for(let i=0;i<(era==='m'?JOBS:JOBS_1760).length;i++){const A=job();check(`job ${i} pick-up`,here,A);at(A);const B=job();check(`job ${i} delivery`,A,B);at(B);here=B;at(here,'car',90);}
  for(const q of SAGAS.filter(s=>s.era===era||s.era==='b')){store.clear();({g,at}=play(id));const giver=g.people.find(p=>p.script===q.giver);g.api.sagaAccept(q.id);here=[giver.x,giver.z];
   for(let k=0;k<q.steps.length;k++){at(here,'walk',1,.001);const P=g.route(),red=g.minimapTargets().filter(t=>t.color==='#e0313e').map(t=>t.p);if(!P||!red.some(p=>Math.hypot(p[0]-P.at(-1)[0],p[1]-P.at(-1)[1])<1))break; /* a map step: no line */
    check(`${q.id} step ${k}`,here);here=P.at(-1);at(here,'car',3,.001);for(let n=0;n<4;n++)g.key('Escape');}}
  assert.deepEqual(bad,[],id);} /* was: Tobacco to the Kastel and the nisse at Kastellet 43 m over the moat (no footway inside), Gefion's furrow 57 m by car from Kastellet's gate, the walk from the Opera 26 m over the canal; by car to the Opera 77 m straight over Holmen's lawns into the trees, from Rundetårn 100 m through Trinitatis churchyard, to Havnebadet 32 m short over the lawn */
});
test('1760: no market stall stands where a coach coming in to a race\'s start meets it first',async()=>{
 const {stallSkip,RACE_CLEAR}=await import('../src/copenhagen/stalls.js'),{g}=play('copenhagen-1760',d=>{for(const l of d.landmarks)if(l.name==='Højbro Plads')l.name='Højbro';}); /* main.js renames the 1760 starts */
 const starts=g.raceStarts(),mob=expandMobility(JSON.parse(fs.readFileSync('public/cities/copenhagen-1760/mobility.json','utf8'))),stalls=JSON.parse(fs.readFileSync('public/cities/copenhagen-1760/stalls.json','utf8')).stalls;
 assert.equal(starts.length,3,'all three races planned');
 const skip=stallSkip(mob.roads.edges,starts),near=s=>starts.some(p=>Math.hypot(p[0]-s[0],p[1]-s[1])<RACE_CLEAR);
 assert.ok(stalls.filter(s=>!stallSkip(mob.roads.edges)(s[0],s[1])).some(near),'a stall stood by a start (the Coachman\'s Dash, Kongens Nytorv: 10 m south-east)');
 assert.deepEqual(stalls.filter(s=>!skip(s[0],s[1])&&near(s)),[]);
 const kept=stalls.filter(s=>!skip(s[0],s[1])).length,before=stalls.filter(s=>!stallSkip(mob.roads.edges)(s[0],s[1])).length;assert.ok(kept>=before-3&&kept>30,`the markets keep their stalls (${kept} of ${before})`);
});
test('touch: a Postcard button shows while an album view not yet taken is in frame, and does what N does',()=>{
 store.clear();const was=body.classList.contains;body.classList.contains=c=>c==='touch';let p;try{p=play('copenhagen');}finally{body.classList.contains=was;}
 const {g}=p,btn=ids.get('cph-postcard'),me={x:902,z:37,speed:0,heading:0},card=[949.6,11.4]; /* Nyhavn's view (55.6799, 12.5911) */
 const look=(dx,dz)=>({getWorldDirection:v=>v.set(dx,0,dz)}),step=view=>{for(let i=0;i<8;i++)g.update(1/30,me,'car',{running:true,view});};
 step(look(card[0]-me.x,card[1]-me.z));assert.equal(btn.hidden,false,'faced from 54 m');assert.match(btn.attrs['aria-label'],/Nyhavn/);
 step(look(me.x-card[0],me.z-card[1]));assert.equal(btn.hidden,true,'turned away');
 step(look(card[0]-me.x,card[1]-me.z));assert.equal(btn.hidden,false);
 g.photo({dir:[card[0]-me.x,card[1]-me.z],snap:()=>null});step(look(card[0]-me.x,card[1]-me.z));assert.equal(btn.hidden,true,'taken: no button for it');
 const css=fs.readFileSync('src/copenhagen/copenhagen.css','utf8');assert.match(css,/#cph-postcard\{display:none\}\nbody\.touch\.driving:not\(\.busted\) #cph-postcard:not\(\[hidden\]\)\{[^}]*min-height:44px[^}]*right:var\(--mobile-right|#cph-postcard\{display:none\}\nbody\.touch\.driving:not\(\.busted\) #cph-postcard:not\(\[hidden\]\)\{[^}]*right:var\(--mobile-right[^}]*min-height:44px/,'touch only, 44 px, inside the safe area');
 assert.match(fs.readFileSync('src/main.js','utf8'),/closest\?\.\('#cph-card-hint,#cph-postcard'\)/,'its click takes the photo');
});
test('desktop: no Postcard button',()=>{store.clear();const {g}=play('copenhagen'),me={x:902,z:37,speed:0,heading:0};for(let i=0;i<8;i++)g.update(1/30,me,'car',{running:true,view:{getWorldDirection:v=>v.set(47,0,-26)}});assert.equal(ids.get('cph-postcard').hidden,true);});
test('keyboard: the postcard hint says which way to turn, and N facing away says where the view is',()=>{
 store.clear();const {g}=play('copenhagen'),hint=ids.get('cph-card-hint'),me={x:902,z:37,speed:0,heading:0},card=[949.6,11.4]; /* the Nyhavn start: the view is 54 m behind the car */
 const look=(dx,dz)=>({getWorldDirection:v=>v.set(dx,0,dz)}),step=view=>{for(let i=0;i<8;i++)g.update(1/30,me,'car',{running:true,view});};
 step(look(me.x-card[0],me.z-card[1]));assert.equal(hint.hidden,false);assert.match(hint.innerHTML,/^Turn around for <b>Nyhavn<\/b>, then <kbd>N<\/kbd>/);
 g.photo({dir:[me.x-card[0],me.z-card[1]],snap:()=>null});assert.match(ids.get('cph-banner').innerHTML,/Nyhavn is behind you/);
 step(look(-(card[1]-me.z),card[0]-me.x));assert.match(hint.innerHTML,/^Turn (left|right) for/);
 step(look(card[0]-me.x,card[1]-me.z));assert.match(hint.innerHTML,/^Press <kbd>N<\/kbd> for a postcard of <b>Nyhavn<\/b>/);
});
test('desktop: job 1\'s story shows for 10 s from the start of play, not from the welcome card',async()=>{
 const {mock}=await import('node:test');mock.timers.enable({apis:['setTimeout']});
 try{store.clear();const {g}=play('copenhagen'),el=document.getElementById('cph-job'),cls=new Set();el.classList={add:c=>cls.add(c),remove:c=>cls.delete(c),contains:c=>cls.has(c),toggle(){}};el.__t=null;
  const me={x:5000,z:5000,speed:0,heading:0},step=running=>g.update(1/30,me,'car',{running});
  step(false);mock.timers.tick(60000);step(false);assert.equal(cls.has('settled'),true,'a minute on the welcome card: settled');
  step(true);assert.equal(cls.has('settled'),false,'play starts: the story is back');mock.timers.tick(9000);step(true);assert.equal(cls.has('settled'),false);mock.timers.tick(1500);assert.equal(cls.has('settled'),true,'and settles 10 s later');
 }finally{mock.timers.reset();}
});
test('every delivery clock covers the GPS line the player follows, by car (or coach) and on foot, at a city pace',()=>{
 for(const id of ['copenhagen','copenhagen-1760']){store.clear();const {g,at,line,job,banner}=play(id),n=(id==='copenhagen'?JOBS:JOBS_1760).length,v=id==='copenhagen'?7:6;
  for(let i=0;i<n;i++){at([5000,5000],'car',90);const A=job();at(A);assert.equal(g.debug().state,'b',`${id} job ${i+1} picked up`);
   const clock=Number(banner().match(/in (\d+) s/)[1]),B=job();at(A,'car',1,.001);const car=line();at(A,'walk',1,.001);const foot=line();
   assert.ok(clock>=car/v+24,`${id} job ${i+1}: ${car|0} m GPS line by ${v===7?'car':'coach'} in ${clock} s`);assert.ok(clock>=foot/6+24,`${id} job ${i+1}: ${foot|0} m on foot in ${clock} s`);
   assert.ok(car/clock*3.6<26,`${id} job ${i+1}: ${(car/clock*3.6).toFixed(0)} km/h average through the city`);
   at(B,'car',1);assert.equal(g.debug().state,'a',`${id} job ${i+1} delivered`);}}
 // Wienerbrød (job 2): a 3.6 km line round the one-way streets had 311 s from a shorter road route (42 km/h).
});
test('job 1 is a short first delivery in both eras, and its clock leaves time for the car\'s own line',()=>{
 for(const id of ['copenhagen','copenhagen-1760']){store.clear();const {g,at,line,job}=play(id);
  at([5000,5000],'car',90);assert.equal(g.timed(),null,'nothing on the clock yet');const A=job();at(A);assert.equal(g.debug().state,'b',`${id}: picked up`);assert.equal(g.timed(),'delivery','the era switch warns about this one');at(A,'car',1,.001);
  const clock=Number(ids.get('cph-job').innerHTML.match(/(\d+) s</)[1]),m=line();
  assert.ok(m>200&&m<1200,`${id}: job 1 is ${m|0} m by car`);assert.ok(m/clock<6,`${id}: ${m|0} m in ${clock} s`);}
 assert.doesNotMatch(JOBS.map(j=>j.d).join(' '),/Inderhavnsbroen is the fast way/,'a footbridge: the car\'s line goes round');
});
