// Plays the Copenhagen game layer (src/copenhagen/game.js) on the real city data, without a page: a few HTML stand-ins
// for the HUD, the player moved from spot to spot, update() stepped by hand.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {gunzipSync} from 'node:zlib';import {register} from 'node:module';
register('data:text/javascript,'+encodeURIComponent("export async function load(u,c,n){return u.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:n(u,c);}"));
class El{constructor(){this.hidden=false;this.innerHTML='';this.style={};this.dataset={};this.classList={add(){},remove(){},contains:()=>false,toggle(){}};}append(){}replaceChildren(){}remove(){}querySelector(){return null;}querySelectorAll(){return [];}getContext(){return new Proxy({},{get:()=>()=>({addColorStop(){}})});}get offsetWidth(){return 0;}}
const ids=new Map(),body=new El(),store=new Map();
globalThis.document={body,createElement:()=>{const e=new El();body.last=e;return e;},getElementById:id=>{if(!ids.has(id))ids.set(id,new El());return ids.get(id);},querySelector:()=>null,querySelectorAll:()=>[]};
Object.defineProperty(body,'append',{value:(...els)=>{for(const e of els)if(e.id)ids.set(e.id,e);}});
globalThis.localStorage={getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};globalThis.sessionStorage={getItem:()=>null,setItem(){},removeItem(){}};
globalThis.addEventListener=globalThis.removeEventListener=()=>{};globalThis.fetch=async()=>{throw Error('offline');};
const THREE=await import('three'),{expandCity}=await import('../src/city-pack.js'),{expandMobility}=await import('../src/mobility-pack.js'),{SpatialIndex,inWaterPolygons}=await import('../src/geo.js');
const {createCopenhagenGame}=await import('../src/copenhagen/game.js'),{JOBS,SAGAS}=await import('../src/copenhagen/data.js');
const cities=JSON.parse(fs.readFileSync('public/cities/index.json','utf8')).cities;
function play(id){
 let c=fs.readFileSync(`public/cities/${id}/city.pack`);if(c[0]===0x1f)c=gunzipSync(c);const data=expandCity(JSON.parse(c)),houses=new SpatialIndex(data.buildings);
 const g=createCopenhagenGame({scene:new THREE.Scene(),city:cities.find(x=>x.id===id),mobilityData:expandMobility(JSON.parse(fs.readFileSync(`public/cities/${id}/mobility.json`,'utf8'))),cityData:data,toast(){},soundOn:()=>false,blocked:(x,z)=>!!houses.at(x,z)});
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
 assert.match(banner(),/Delivered!/);at(job(),'car',30);assert.match(banner(),/Delivered!/,'"Delivered!" stays up');assert.equal(g.debug().state,'a');
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
 store.delete('cph-game-v1'); /* the first test's deliveries moved the save on */const {g,at,job,data}=play('copenhagen'),roads=new SpatialIndex(data.roads),pave=new SpatialIndex(data.pavement||[]);assert.equal(JOBS[0].b[2],'Operaen');
 const wet=P=>{let w=0;for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.ceil(L);for(let j=0;j<n;j++){const x=a[0]+(b[0]-a[0])*(j+.5)/n,z=a[1]+(b[1]-a[1])*(j+.5)/n;if(inWaterPolygons(data.water,x,z)&&!roads.at(x,z)&&!pave.at(x,z))w+=L/n;}}return w;};
 at([5000,5000],'car',90);const A=job();at(A);assert.equal(g.debug().state,'b');
 for(const m of ['car','walk']){at(A,m,1,.001);const w=wet(g.route());assert.ok(w<3,`${m}: ${w|0} m of the line over open water`);} /* was 67 m straight over the canal from Papirøen */
});
