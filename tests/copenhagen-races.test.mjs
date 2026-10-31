// Races and timed sagas: plays the Copenhagen game layer (src/copenhagen/game.js) on the real city data, without a page: a few HTML stand-ins
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
function play(id,prep=()=>{},extra={},scene=new THREE.Scene()){
 let c=fs.readFileSync(`public/cities/${id}/city.pack`);if(c[0]===0x1f)c=gunzipSync(c);const data=expandCity(JSON.parse(c)),houses=new SpatialIndex(data.buildings);prep(data);
 const g=createCopenhagenGame({scene,city:cities.find(x=>x.id===id),mobilityData:expandMobility(JSON.parse(fs.readFileSync(`public/cities/${id}/mobility.json`,'utf8'))),cityData:data,toast(){},soundOn:()=>false,blocked:(x,z)=>!!houses.at(x,z),routeSlice:Infinity,...extra}); // routeSlice: each new line at once (in the game a new line's groundwork is spread over frames)
 const me={x:0,z:0,speed:0,heading:0},banner=()=>ids.get('cph-banner')?.innerHTML.replace(/<[^>]+>/g,'')||'';
 const at=([x,z],mode='car',steps=2,dt=1/30)=>{me.x=x;me.z=z;for(let i=0;i<steps;i++)g.update(dt,me,mode,{running:true});};
 const line=()=>(g.route()||[]).reduce((s,p,i,a)=>i?s+Math.hypot(p[0]-a[i-1][0],p[1]-a[i-1][1]):0,0);
 return {g,at,banner,line,job:()=>g.minimapTargets().at(-1).p,data};
}
test('in a race the big map frames the player and the next checkpoint, in both eras',()=>{
 for(const id of ['copenhagen','copenhagen-1760']){const {g,at}=play(id);
  const start=g.raceStarts()[0];at([start[0]+60,start[1]],'car',2);at(start,'car',2);assert.ok(g.debug().race,'race started');
  const t=g.minimapTargets().filter(t=>t.job);assert.equal(t.length,1);assert.deepEqual(t[0].p,g.minimapTargets()[0].p,'the next checkpoint is what the big map frames');g.key('KeyX');}
});
test('today: Gefion\'s Plough can be done in its time by car or by bike along its GPS lines',()=>{
 const {g,at,line}=play('copenhagen'),q=SAGAS.find(s=>s.id==='gefion');assert.match(q.intro,/Six and a half minutes/);
 for(const [mode,most] of [['car',11],['walk',6.5]]){ /* the bike's top speed is 7 m/s; walk: the bike's line */
  g.api.sagaAccept('gefion');let from=g.people.find(x=>x.script==='aksel'),here=[from.x,from.z],total=0;
  for(let n=0;n<q.steps.length;n++){at(here,mode==='car'?'walk':'car',1,.001);at(here,mode,1,.001);total+=line();here=g.minimapTargets().filter(m=>m.color==='#e0313e')[0].p;at(here,mode,2,.001);for(let i=0;i<3;i++)g.key('Enter');}
  assert.ok(total/q.limit<most,`${mode}: ${total|0} m in ${q.limit} s`);store.delete('cph-game-v1');}
});
test('sagas pay half in 1760, where jobs pay about half as much',()=>{
 for(const [id,pay] of [['copenhagen',700],['copenhagen-1760',350]]){const {g}=play(id);
  assert.match(g.api.sagaIntro('holger').choices[0].label,new RegExp(`Accept · ${pay} `));store.delete('cph-game-v1');}
});
test('1760: Fire Watch turns the sky to night while it runs, and back when it ends',()=>{
 const calls=[],{g,at}=play('copenhagen-1760',()=>{},{night:on=>calls.push(on)}),w=g.people.find(x=>x.script==='watchman');
 at([w.x,w.z],'walk',1,.001);assert.deepEqual(calls,[]);
 g.api.sagaAccept('fire');at([w.x,w.z],'walk',1,.001);assert.deepEqual(calls,[true]);
 at([w.x,w.z],'walk',3,200);assert.equal(g.timed(),null);assert.match(g.api.sagaIntro('fire').response,/lantern/i,'the saga can be asked again: it failed');assert.deepEqual(calls,[true,false]);store.delete('cph-game-v1');
});
test('today: the bike\'s GPS line over Cykelslangen is drawn on the deck, not under it in the harbour',async()=>{
 const {findRaisedDecks}=await import('../src/quay.js'),{setRaisedDecks,raisedDeckAt}=await import('../src/terrain.js'),{default:proj4}=await import('proj4');
 const city=cities.find(x=>x.id==='copenhagen'),proj=proj4('EPSG:4326',city.projection),job=JOBS[0],scene=new THREE.Scene();let deck;
 try{
  const {g,at}=play('copenhagen',data=>{[deck]=findRaisedDecks(data.water,{roads:data.roads,pavement:data.pavement});setRaisedDecks([deck]);
   const [x,z]=deck.centre.at(-1),[lon,lat]=proj.inverse([x+60,-(z+40)]);JOBS[0]={...job,a:[lat,lon,'Kalvebod Brygge']};},{},scene); /* the pick-up past the deck's far end */
  assert.equal(deck?.name,'Cykelslangen');const [x0,z0]=deck.centre[0];at([x0-80,z0-30],'bike',3);
  const mesh=scene.children.find(m=>m.geometry?.attributes?.rd),p=mesh.geometry.attributes.position;let on=0,low=0;
  for(let i=0;i<p.count;i++){const c=deck.centre.reduce((b,q)=>Math.min(b,Math.hypot(q[0]-p.getX(i),q[1]-p.getZ(i))),Infinity),h=c<1.5?raisedDeckAt(p.getX(i),p.getZ(i)):null;if(h===null||h<1)continue;on++;if(Math.abs(p.getY(i)-h-.22)>.05)low++;}
  assert.ok(on>40,`${on} vertices along the raised deck`);assert.equal(low,0,`${low} of ${on} below the deck`);
 }finally{JOBS[0]=job;setRaisedDecks([]);store.delete('cph-game-v1');}
});
