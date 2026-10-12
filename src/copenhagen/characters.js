// Authored Copenhagen characters for the shared conversation system (src/conversation-dialogue.js).
// A person with `script` set is handled here instead of the generic passer-by profiles. Turns have the
// same shape as conversation-dialogue.js: {response, choices:[{id,label}], expression}. Choice ids that
// start with "saga:" or "accept:" are routed to the game layer (game.js) to offer and start sagas.
import {CHARACTERS} from './data.js';

const choice=(id,label)=>({id,label}),BYE=choice('bye','Bye'),turn=(response,choices=[BYE],expression='friendly')=>({response,choices,expression});
let game=null;
export function connectCharacters(g){game=g;}
const sagaChoice=id=>game?.sagaChoice(id)||[];

const SCRIPTS={
 karen:{
  hello:()=>turn('Welcome to Nyhavn! It was dug in the 1670s so ships could sail right into the city. Today it mostly carries beer.',[...sagaChoice('hca'),choice('colours','Why all the colours?'),BYE]),
  colours:()=>turn('Honestly? In the old days most of these houses were much greyer. The bright colours are mostly modern. It is dark here half the year. You would paint your house yellow too.',[...sagaChoice('hca'),BYE]),
 },
 aksel:{
  hello:()=>turn('See her? Gefion. A goddess. Those four oxen she is whipping are her own sons.',[...sagaChoice('gefion'),choice('sons','Her sons?'),BYE]),
  sons:()=>turn('Old story. The Swedish king promised her as much land as she could plough in a day and a night. She ploughed so deep she dragged the land into the sea. That is Zealand. We are standing on it.',[...sagaChoice('gefion'),BYE]),
 },
 nisse:{
  hello:()=>turn('Psst. Down here. Yes, I am a nisse. No, you may not take a photo.',[...sagaChoice('nisse'),choice('job','What does a nisse do?'),BYE]),
  job:()=>turn('We look after the house, the farm, the animals. Treat us well and things go well. Forget us and the milk goes sour. Fair deal.',[...sagaChoice('nisse'),BYE]),
 },
 ole:{
  hello:()=>turn('Fifty years I fished out of here. Now I sit on the bench and tell tourists the fish was bigger in my day. It was.',[...sagaChoice('holger'),choice('strand','What was Gammel Strand?'),BYE]),
  strand:()=>turn('The old beach. Fishing boats tied up right here, and the fishwives sold the catch on the quay. There is a statue of one of them along the canal. Fierce women.',[...sagaChoice('holger'),BYE]),
 },
 bent:{
  hello:()=>turn('Hej hej! Rød pølse? Ristet? You look like someone who rides on an empty stomach.',[choice('buy','One rød pølse, everything on it (40 kr)'),choice('fransk','What’s a fransk hotdog?'),BYE]),
  fransk:()=>turn('A baguette with a hole down the middle. Sauce goes in the hole, sausage slides in after. Engineering.',[choice('buy','One rød pølse then (40 kr)'),BYE]),
  buy:()=>game?.spend(40)?turn('Remoulade, ketchup, sennep, ristede løg, agurkesalat. Velbekomme.',[BYE]):turn(`40 kr. You have ${game?.money()??0}. Run a delivery and come back.`,[BYE]),
 },
 astrid:{
  hello:()=>turn('Rundetårn was built as an observatory in the 1640s. No stairs inside, just a spiral ramp.',[choice('ramp','Why a ramp?'),BYE]),
  ramp:()=>turn('So instruments could go up by horse and cart. A Russian tsar is said to have ridden up on horseback in 1716.',[BYE]),
 },
 mette:{
  hello:()=>turn('Welcome. Three rules here: no running, no photos, no cars.',[choice('run','Why no running?'),choice('cars','Why no cars?'),BYE]),
  run:()=>turn('Running makes people think the police are coming. Then everybody runs. Then the police actually come.',[choice('cars','And no cars?'),BYE]),
  cars:()=>turn('Car-free since we started in 1971. The Christiania bike was invented right here. Basically our national vehicle.',[BYE]),
 },
};

export const isAuthored=person=>!!(person?.script&&SCRIPTS[person.script]);
export function authoredCharacter(person){
 const c=CHARACTERS.find(c=>c.id===person.script)||{name:'Someone',label:''};
 let n=0;for(const ch of c.id||'')n=(n*31+ch.charCodeAt(0))>>>0;
 return {name:c.name,profile:{id:'authored'},label:c.name,description:c.label,voiceSeed:n};
}
export function authoredBegin(person,memory){memory.visits=(memory.visits||0)+1;memory.topics??=[];return SCRIPTS[person.script].hello(memory);}
export function authoredNext(id,person,memory){
 if(id.startsWith('saga:'))return game?.sagaIntro(id.slice(5))||null;
 if(id.startsWith('accept:'))return game?.sagaAccept(id.slice(7))||null;
 if(id.startsWith('wait:'))return game?.sagaIntro(id.slice(5))||null;
 const node=SCRIPTS[person.script][id];return node?node(memory):null;
}
