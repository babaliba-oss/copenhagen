// Local conversations with pedestrians and explicitly talkable stationary vendors.
// No network requests or invented claims about real residents or local places.
import {pointInPolygon} from './geo.js';
import {stallLocal} from './market-shop.js';
import {beginDialogue,nextDialogue,characterFor} from './conversation-dialogue.js';
import {createConversationVoice} from './conversation-voice.js';

export const TALK_DISTANCE=2.8;
export const CONVERSATION_DISTANCE=4;
export const CONVERSATION_TIMEOUT=65;
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const finitePosition=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.z);
const SAVED_FIELDS=['pose','heading','expression','speaking','mouthOpen','conversation'];

function availablePerson(p,world){
 if(!finitePosition(p)||(p.walking===false&&!p.talkable)||(p.edge===null&&!p.talkable)||p.knocked||p.knockdown||p.reaction||p.running||p.hidden||p.playerTaken||p.visible===false)return false;
 if(p.pose==='cycle'||p.pose==='scooter'||Math.abs(p.speed||0)>2.2)return false;
 // Let people finish crossing the street instead of stopping them in traffic.
 if(p.edge?.crossing&&world?.roads?.at(p.x,p.z))return false;
 return true;
}
function atVendorFront(player,person){
 const stall=person.vendor?.stall;if(!stall)return true;
 const {out,across}=stallLocal(stall,player);
 return out>=-.15&&Math.abs(across)<=stall.w/2+.35;
}

export function clearConversationPath(from,to,world){
 if(!finitePosition(from)||!finitePosition(to))return false;
 const length=distance(from,to);if(length>CONVERSATION_DISTANCE)return false;
 const n=Math.max(1,Math.ceil(length/.2));
 for(let i=0;i<=n;i++){
  const x=from.x+(to.x-from.x)*i/n,z=from.z+(to.z-from.z)*i/n;
  // A seller can talk across their counter. Only mapped building walls occlude
  // this ray; thin street props and market counter collision boxes do not.
  if((world?.collisionBuildings||world?.buildings)?.at(x,z))return false;
  if(!world?.roads?.at(x,z)&&!world?.pavement?.at(x,z)&&world?.water?.some(w=>pointInPolygon(x,z,w.rings)))return false;
 }
 return true;
}

export function nearestTalker(player,people,world,radius=TALK_DISTANCE){
 if(!finitePosition(player)||player.travelMode!=='walk')return null;
 let best=null,bestDistance=Math.min(radius,TALK_DISTANCE),vendor=null,vendorDistance=bestDistance;
 for(const person of people||[]){
  if(!availablePerson(person,world)||person.conversation||!atVendorFront(player,person))continue;
  const d=distance(player,person);
  if(d>Math.min(radius,TALK_DISTANCE)||!clearConversationPath(player,person,world))continue;
  // At a counter the seller is the useful target, even with another customer
  // between us. Outside that front-facing context use ordinary nearest-person
  // selection, so a vendor behind the player does not steal a passing greeting.
  const facing=(-Math.sin(player.heading||0)*(person.x-player.x)-Math.cos(player.heading||0)*(person.z-player.z))/Math.max(.01,d);
  if(person.vendor?.stall&&facing>.35&&d<=vendorDistance){vendor=person;vendorDistance=d;}
  if(d<=bestDistance){best=person;bestDistance=d;}
 }
 return vendor||best;
}

export class PeopleInteraction {
 constructor(world,{context={},voiceEnabled=false,voice=null}={}){
  this.world=world;this.context=context;this.voice=voice||createConversationVoice({enabled:voiceEnabled});
  this.session=null;this.nearby=null;this.enabled=false;this.memories=new Map();this.turn=0;
 }
 reset(world=this.world){this.close();this.world=world;this.nearby=null;this.enabled=false;this.memories.clear();}
 cityContext(){return (typeof this.context==='function'?this.context():this.context)||{};}
 setVoiceEnabled(value){
  const changed=this.voice.enabled!==!!value;this.voice.setEnabled(value);
  if(this.session&&changed){if(value)this.deliver(this.session);else{this.session.person.speaking=false;this.session.lineDone=true;}}
  return this.voice.enabled;
 }
 toggleVoice(){return this.setVoiceEnabled(!this.voice.enabled);}
 deliver(session){
  const token=++this.turn;session.lineAge=0;session.lineDone=false;session.audioStarted=false;
  session.captionDuration=Math.max(2.5,Math.min(16,session.response.length/16));
  session.person.speaking=true;session.person.expression=session.expression||'friendly';delete session.person.mouthOpen;
  this.voice.speak(session.response,{seed:session.character.voiceSeed,
   onStart:()=>{if(this.session===session&&this.turn===token){session.audioStarted=true;session.lineAge=0;session.person.speaking=true;}},
   onEnd:reason=>{if(this.session===session&&this.turn===token){session.audioStarted=false;if(reason==='error'||reason==='unavailable'){session.lineAge=0;}else{session.lineDone=true;session.person.speaking=false;}}},
  });
 }
 update(dt,player,people,{enabled=true}={}){
  this.enabled=!!enabled&&player?.travelMode==='walk';
  if(!this.enabled){this.close();this.nearby=null;return;}
  const session=this.session;
  if(session){
   const p=session.person;
   session.idle+=Math.max(0,Number.isFinite(dt)?dt:0);
   if(!people?.includes(p)||!availablePerson(p,this.world)||!atVendorFront(player,p)||distance(player,p)>CONVERSATION_DISTANCE||!clearConversationPath(player,p,this.world)||session.idle>=CONVERSATION_TIMEOUT){
    this.close();
   }else{
    p.speed=0;
    // All shared person models face down their local negative Z axis.
    p.heading=Math.atan2(p.x-player.x,p.z-player.z);
    session.lineAge+=Math.max(0,Number.isFinite(dt)?dt:0);
    if(!session.lineDone&&session.lineAge>=(session.audioStarted?Math.max(20,session.captionDuration*2):session.captionDuration)){
     this.voice.stop();session.lineDone=true;p.speaking=false;
    }
   }
  }
  this.nearby=this.session?null:nearestTalker(player,people,this.world);
 }
 interact(player,people,{enabled=this.enabled}={}){
  if(!enabled||player?.travelMode!=='walk')return {ok:false,message:'Step out and walk over to someone to say hello.'};
  if(this.session){this.close();return {ok:true,closed:true,message:'See you around!'};}
  // Validate at the moment of the input, even if the UI's previous target moved.
  const person=nearestTalker(player,people,this.world);
  if(!person)return {ok:false,message:'Walk a little closer to a passerby to talk.'};
  this.enabled=true;
  // Authored crowd groups can reuse display IDs; the live actor is the identity.
  const memory=this.memories.get(person)||{visits:0,topics:[]};this.memories.set(person,memory);
  const character=characterFor(person),dialogue=beginDialogue(person,memory,this.cityContext());
  const saved=SAVED_FIELDS.map(key=>({key,owned:Object.hasOwn(person,key),value:person[key]}));
  this.session={person,saved,memory,character,idle:0,history:[],...dialogue};
  person.conversation=true;person.pose='chat';person.speed=0;
  person.heading=Math.atan2(person.x-player.x,person.z-player.z);
  this.nearby=null;
  this.deliver(this.session);
  return {ok:true,message:this.session.response};
 }
 choose(id){
  if(!this.enabled||!this.session)return {ok:false};
  const option=this.session.choices.find(c=>c.id===id);if(!option)return {ok:false};
  if(id==='bye'){this.close();return {ok:true,closed:true,message:'See you around!'};}
  if(id==='shop'&&this.session.person.vendor?.stallId){const stallId=this.session.person.vendor.stallId;this.close();return {ok:true,closed:true,action:{type:'shop',stallId}};}
  const dialogue=nextDialogue(id,this.session.person,this.session.memory,this.cityContext());if(!dialogue)return {ok:false};
  if(dialogue.close){this.close();return {ok:true,closed:true,message:dialogue.message||''};} // an authored line that ends the talk (and maybe starts something)
  this.session.history.push({you:option.label,response:this.session.response});if(this.session.history.length>6)this.session.history.shift();
  Object.assign(this.session,dialogue,{idle:0});this.deliver(this.session);
  return {ok:true,message:this.session.response};
 }
 close(){
  const session=this.session;if(!session)return false;
  const p=session.person;
  this.turn++;this.voice.stop();
  // An impact/reaction can begin between conversation updates and remember our
  // temporary chat pose. Its eventual recovery must restore the underlying pose.
  const originalPose=session.saved.find(field=>field.key==='pose')?.value;
  for(const effect of [p.reaction,p.knockdown])if(effect?.prevPose==='chat')effect.prevPose=originalPose;
  for(const {key,owned,value} of session.saved){if(owned)p[key]=value;else delete p[key];}
  // Resume with the normal acceleration; route / distance / waiting state is untouched.
  p.speed=0;this.session=null;
  return true;
 }
 snapshot(){
  const p=this.session?.person||this.nearby,c=p?this.session?.character||characterFor(p):null;
  return {active:!!this.session,nearby:!!this.nearby,person:p?{id:p.id,label:c.label,name:c.name,description:c.description,vendor:!!p.vendor,x:p.x,z:p.z}:null,
   response:this.session?.response||'',choices:this.session?.choices||[],previousChoice:this.session?.history.at(-1)?.you||'',turn:this.turn,
   voice:this.voice.snapshot(),timeLeft:this.session?Math.max(0,CONVERSATION_TIMEOUT-this.session.idle):0};
 }
 dispose(){this.close();this.voice.dispose();this.memories.clear();}
}
