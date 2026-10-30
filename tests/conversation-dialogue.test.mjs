import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {PeopleInteraction,nearestTalker} from '../src/people-interaction.js';
import {characterFor} from '../src/conversation-dialogue.js';
import {createConversationVoice} from '../src/conversation-voice.js';
import {MarketShop,STALL_KINDS} from '../src/market-shop.js';
import {createMarketShopRenderer} from '../src/market-shop-renderer.js';
import {SpatialIndex} from '../src/geo.js';
import {createCrowdReaction} from '../src/crowd-reaction.js';
import {connectCharacters} from '../src/copenhagen/characters.js';

test('Copenhagen characters: Ole is a retired fisherman today and still fishing in 1760',()=>{
 connectCharacters({era:'m'});assert.equal(characterFor({script:'ole'}).description,'Retired fisherman, Gammel Strand');
 connectCharacters({era:'h'});assert.equal(characterFor({script:'ole'}).description,'Fisherman, Gammel Strand');assert.equal(characterFor({script:'karen'}).description,'Walking tour guide, Nyhavn');
 connectCharacters(null);
});

test('Copenhagen 1760: the architect at Frederiksstaden is Jardin, not Thurah (dead in 1759); his id stays for saves',async()=>{
 const {CHARACTERS}=await import('../src/copenhagen/data.js'),{authoredBegin,authoredNext}=await import('../src/copenhagen/characters.js');
 assert.equal(CHARACTERS.find(c=>c.id==='thurah').name,'Monsieur Jardin');
 connectCharacters({era:'h'});assert.equal(characterFor({script:'thurah'}).name,'Monsieur Jardin');
 const p={script:'thurah'},m={},said=[authoredBegin(p,m).response];for(const id of ['church','statue','hall'])said.push(authoredNext(id,p,m).response);connectCharacters(null);
 const all=said.join(' ');assert.doesNotMatch(all,/Thurah|East India/);assert.match(all,/Saly/);assert.match(all,/Moltke/);
});

const world=()=>({buildings:new SpatialIndex([]),water:[],roads:new SpatialIndex([]),pavement:new SpatialIndex([])});
const walker=()=>({x:0,z:0,heading:0,speed:0,travelMode:'walk'});
const person=(extra={})=>({id:'test-neighbour',x:0,z:-2,heading:0,speed:1,walking:true,pose:'walk',edge:{},...extra});
const open=(chat,p,npc)=>{assert.equal(chat.interact(p,[npc],{enabled:true}).ok,true);return chat.snapshot();};
const choose=(chat,id)=>{assert.ok(chat.snapshot().choices.some(c=>c.id===id),`visible choice ${id}`);const r=chat.choose(id);assert.equal(r.ok,true);return r;};

test('a multi-turn conversation branches, remembers the encounter, and clears memory for a new visit',()=>{
 const p=walker(),npc=person(),chat=new PeopleInteraction(world(),{context:{cityName:'Example City'}});
 const first=open(chat,p,npc);assert.match(first.response,/Example City/);assert.ok(first.person.name);
 choose(chat,'hello');choose(chat,'day');choose(chat,'slow');choose(chat,'notice');choose(chat,'explore');choose(chat,'bike');
 assert.match(chat.snapshot().previousChoice,/bike/i);assert.ok(chat.snapshot().choices.some(c=>c.id==='notice'));
 assert.equal(chat.choose('product').ok,false,'unoffered seller actions cannot be selected');
 choose(chat,'bye');const next=open(chat,p,npc);assert.equal(next.person.name,first.person.name);assert.match(next.response,/hello again.*ride/is);
 chat.reset();const fresh=open(chat,p,npc);assert.equal(fresh.response,first.response,'reset starts a new visit');chat.dispose();
 const profiles=new Set(Array.from({length:20},(_,i)=>characterFor(person({id:`person-${i}`})).profile.id));assert.equal(profiles.size,4,'different stable personalities');
});

test('local directions use only supplied names, current coordinates and honest straight-line bearings',()=>{
 const p=walker(),npc=person(),chat=new PeopleInteraction(world(),{context:()=>({cityName:'Testville',landmarks:[{name:'North Gate',x:0,z:-502},{name:'East Quay',x:800,z:-2},{name:'Bad Place',x:NaN,z:1}]})});
 open(chat,p,npc);choose(chat,'explore');assert.match(chat.snapshot().response,/North Gate.*500 metres north.*straight line/);
 choose(chat,'another');assert.match(chat.snapshot().response,/East Quay.*800 metres east/);assert.doesNotMatch(chat.snapshot().response,/Bad Place|Helsinki|Tampere/);
 choose(chat,'walk');assert.match(chat.snapshot().previousChoice,/walk/);chat.close();
 chat.context={landmarks:[]};open(chat,p,npc);choose(chat,'explore');assert.match(chat.snapshot().response,/marked place on the map/);assert.equal(chat.snapshot().choices.some(c=>c.id==='another'),false);chat.dispose();
});

test('market sellers can talk across a counter, retain their pose, describe actual goods, and open exactly their stall',()=>{
 const stalls=[{id:'berries-A',kind:'berries',x:0,z:0,w:5.2,d:4.4},{id:'flowers-B',kind:'flowers',x:1,z:0,w:5.2,d:4.4}];
 const shop=new MarketShop({stalls}),scene=new THREE.Scene(),render=createMarketShopRenderer(scene,shop.stalls),seller=render.vendors[0];
 const p={...walker(),x:.8,z:3.3},w=world(),chat=new PeopleInteraction(w);
 // Legacy prop collision index can contain a stall; mapped walls remain authoritative.
 w.buildings=new SpatialIndex([{rings:[[[-3,-1],[3,-1],[3,2.5],[-3,2.5]]]}]);w.collisionBuildings=new SpatialIndex([]);
 assert.equal(nearestTalker(p,[seller],w),seller,'stationary, explicitly talkable vendor is eligible');
 const shopper=person({id:'customer',x:p.x,z:p.z-.4});
 assert.equal(nearestTalker(p,[seller,shopper],w),seller,'facing the counter chooses its seller over a customer standing in front');
 assert.equal(nearestTalker({...p,heading:Math.PI},[seller,shopper],w),shopper,'turning away returns to ordinary nearest-person selection');
 assert.equal(nearestTalker({...p,z:-1},[seller],w),null,'cannot address the back of a closed counter');
 const first=open(chat,p,seller);assert.equal(first.person.vendor,true);assert.equal(first.person.label,STALL_KINDS.berries.name);
 chat.update(.1,p,[seller]);const heading=seller.heading;render.update(.25,{viewer:p,shop});assert.equal(seller.heading,heading,'vendor renderer does not overwrite conversation heading');
 choose(chat,'recommend');assert.match(chat.snapshot().response,/strawberries/i);assert.match(chat.snapshot().response,/€5/);
 choose(chat,'alternative');assert.match(chat.snapshot().response,/blueberries/i);assert.match(chat.snapshot().response,/€6/);
 choose(chat,'budget');assert.match(chat.snapshot().response,/peas.*€4/i);choose(chat,'product');assert.match(chat.snapshot().response,/sweet peas raw/);
 const handoff=choose(chat,'shop');assert.deepEqual(handoff.action,{type:'shop',stallId:'berries-A'});assert.equal(chat.snapshot().active,false);assert.equal(seller.conversation,undefined);
 shop.update(0,p);assert.equal(shop.openAt(p).stall.id,'flowers-B','another stall is closer by the normal proximity score');
 assert.equal(shop.openStall(handoff.action.stallId,p).stall.id,'berries-A','does not substitute the adjacent seller');
 assert.equal(shop.money,4000,'menu handoff never purchases an item');shop.close();assert.equal(shop.openStall('berries-A').ok,true,'stored player retains walking mode');
 assert.equal(shop.openStall('missing',p).ok,false);assert.equal(shop.openStall('berries-A',{...p,z:9}).ok,false);
 assert.equal(shop.openStall('berries-A',{...p,travelMode:'bike'}).ok,false);assert.equal(shop.openStall('berries-A',{...p,z:-2}).ok,false);
 shop.update(0,p,{enabled:false});assert.equal(shop.openStall('berries-A',p).ok,false,'paused shop stays closed');
 const returning=open(chat,p,seller);assert.match(returning.response,/hello again.*peas/is);chat.dispose();render.dispose();
});

test('actors with repeated crowd IDs keep separate memories and reactions recover their original pose',()=>{
 const a=person({id:'crowd-0'}),b=person({id:'crowd-0'}),p=walker(),chat=new PeopleInteraction(world());
 open(chat,p,a);choose(chat,'explore');choose(chat,'bike');chat.close();
 assert.doesNotMatch(open(chat,p,b).response,/again|How was the ride/);chat.close();
 assert.match(open(chat,p,a).response,/again.*ride/is);
 const reaction=createCrowdReaction({random:()=>.2}),victim=person({id:'victim',x:1,z:-2});
 reaction.alarm({actor:victim,hitter:{x:2,z:-2},severity:{level:'stumble'}},[[a]]);assert.equal(a.reaction.prevPose,'chat');
 chat.update(.1,p,[a]);assert.equal(chat.snapshot().active,false,'a crash reaction interrupts the chat');assert.equal(a.reaction.prevPose,'walk');
 assert.equal(chat.interact(p,[a],{enabled:true}).ok,false,'do not start a fresh chat during a reaction');
 reaction.step(20);assert.equal(a.pose,'walk','crowd recovery does not strand a walker in chat');
 open(chat,p,a);a.knockdown={prevPose:'chat'};chat.update(.1,p,[a]);assert.equal(a.knockdown.prevPose,'walk','impact recovery restores the underlying pose too');chat.dispose();
});

class Utterance {constructor(text){this.text=text;}}
function fakeEngine(voices=[{name:'Installed English',lang:'en-GB',localService:true}]){
 const events=new Map(),utterances=[];return {voices,utterances,cancels:0,
  getVoices(){return this.voices;},speak(u){utterances.push(u);},cancel(){this.cancels++;},
  addEventListener(name,fn){events.set(name,fn);},removeEventListener(name,fn){if(events.get(name)===fn)events.delete(name);},
  changed(){events.get('voiceschanged')?.();},get listeners(){return events.size;},
 };
}

test('speech uses installed voices only, starts after an explicit line, and cancels replaced or muted speech',()=>{
 const remote={name:'Remote voice',lang:'en-US',localService:false},local={name:'Local voice',lang:'en-GB',localService:true},engine=fakeEngine([remote,local]);
 const voice=createConversationVoice({synthesis:engine,Utterance,enabled:true});assert.equal(engine.utterances.length,0);
 let firstStarts=0,firstEnds=0,secondStarts=0;
 assert.equal(voice.speak('First line',{onStart:()=>firstStarts++,onEnd:()=>firstEnds++}),true);
 const a=engine.utterances[0];assert.equal(a.voice,local);a.onstart();assert.equal(firstStarts,1);assert.equal(voice.snapshot().speaking,true);
 voice.speak('Second line',{onStart:()=>secondStarts++});const b=engine.utterances[1];assert.equal(engine.cancels,1);
 a.onend();a.onstart();assert.equal(firstEnds,0);assert.equal(firstStarts,1,'late callbacks from canceled line are ignored');
 b.onstart();assert.equal(secondStarts,1);voice.setEnabled(false);b.onstart();assert.equal(secondStarts,1);assert.equal(voice.snapshot().status,'muted');
 assert.equal(voice.speak('Must stay silent'),false);assert.equal(engine.utterances.length,2);voice.dispose();assert.equal(engine.listeners,0);
});

test('missing, delayed and failing speech engines preserve text fallback without ever choosing a remote voice',()=>{
 const engine=fakeEngine([{name:'Cloud voice',lang:'en',localService:false}]),voice=createConversationVoice({synthesis:engine,Utterance,enabled:true});
 assert.equal(voice.speak('A caption stays visible'),false);assert.equal(voice.snapshot().status,'text');assert.equal(engine.utterances.length,0);
 engine.voices.push({name:'Installed',lang:'en-US',localService:true});engine.changed();assert.equal(engine.utterances.length,1,'a pending user-requested line can use a late installed voice');
 voice.stop();engine.voices=[];voice.speak('Canceled before voices arrive');voice.stop();engine.voices.push({name:'Installed',lang:'en',localService:true});engine.changed();assert.equal(engine.utterances.length,1);
 let ended;engine.speak=()=>{throw Error('Audio unavailable');};assert.equal(voice.speak('Still a caption',{onEnd:reason=>ended=reason}),false);assert.equal(ended,'error');assert.equal(voice.snapshot().status,'text');voice.dispose();
 const absent=createConversationVoice({synthesis:null,Utterance:null,enabled:true});assert.equal(absent.speak('Readable text'),false);assert.equal(absent.snapshot().supported,false);absent.dispose();
});

test('speaking face lifecycle follows audio and safely restores all actor fields after every close path',()=>{
 for(const stop of ['close','pause','walkaway','reset','dispose']){
  const engine=fakeEngine(),voice=createConversationVoice({synthesis:engine,Utterance,enabled:true});
  const npc=person({expression:'concerned',speaking:false,mouthOpen:.2,conversation:false}),p=walker(),chat=new PeopleInteraction(world(),{voice});
  open(chat,p,npc);assert.equal(npc.expression,'friendly');assert.equal(Object.hasOwn(npc,'mouthOpen'),false);
  const u=engine.utterances[0];u.onstart();assert.equal(npc.speaking,true);chat.update(1,p,[npc]);
  if(stop==='pause')chat.update(.1,p,[npc],{enabled:false});else if(stop==='walkaway'){p.x=10;chat.update(.1,p,[npc]);}else chat[stop]();
  assert.equal(npc.expression,'concerned',stop);assert.equal(npc.speaking,false,stop);assert.equal(npc.mouthOpen,.2,stop);assert.equal(npc.conversation,false,stop);assert.equal(engine.cancels,1,stop);
  u.onstart();u.onend();assert.equal(npc.speaking,false,'late browser callbacks cannot animate an ended conversation');chat.dispose();
 }
 const npc=person(),p=walker(),chat=new PeopleInteraction(world());open(chat,p,npc);assert.equal(npc.speaking,true,'caption delivery animates in muted mode');
 chat.update(17,p,[npc]);assert.equal(npc.speaking,false,'text-only speaking does not continue forever');assert.equal(chat.snapshot().active,true);chat.close();
 assert.equal(Object.hasOwn(npc,'expression'),false);assert.equal(Object.hasOwn(npc,'speaking'),false);assert.equal(Object.hasOwn(npc,'mouthOpen'),false);chat.dispose();
});

test('Copenhagen 1760: a passer-by does not ask if you are looking around "Copenhagen 1760"',async()=>{
 const {beginDialogue}=await import('../src/conversation-dialogue.js'),p={id:'passer-1760',x:0,z:0};
 assert.match(beginDialogue(p,{},{cityName:'Copenhagen 1760',era:1760}).response,/Taking a look around town\?/);
 assert.match(beginDialogue(p,{},{cityName:'Copenhagen',era:2026}).response,/Taking a look around Copenhagen\?/);
});
