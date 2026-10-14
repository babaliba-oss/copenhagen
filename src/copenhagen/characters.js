// Authored Copenhagen characters for the shared conversation system (src/conversation-dialogue.js).
// A person with `script` set is handled here instead of the generic passer-by profiles. Turns have the
// same shape as conversation-dialogue.js: {response, choices:[{id,label}], expression}. Choice ids that
// start with "saga:" or "accept:" are routed to the game layer (game.js) to offer and start sagas.
import {CHARACTERS} from './data.js';

const choice=(id,label)=>({id,label}),BYE=choice('bye','Bye'),turn=(response,choices=[BYE],expression='friendly')=>({response,choices,expression});
let game=null;
export function connectCharacters(g){game=g;}
const y1760=()=>game?.era==='h';
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
 ghost:{
  hello:()=>turn('You can see me? Good. Christian, by the grace of God King of Denmark and Norway. Dead since 1648, but I like to look in on my tower. Frederik the Fifth sits on the throne now. Builds pretty palaces. I built a city.',[...sagaChoice('eye'),choice('tower','Why a ramp, not stairs?'),choice('city','What did you build?'),BYE],'proud'),
  tower:()=>turn('So a coach could go up to the observatory. Or a king on a horse. Seven and a half turns, two hundred and nine metres of ramp. Tycho Brahe\'s pupils read the stars up there.',[...sagaChoice('eye'),BYE]),
  city:()=>turn('Børsen. Rosenborg. Holmens church. Nyboder for my sailors. A whole new town across the water, Christianshavn, canals and all, like Amsterdam. The ramparts you walked through. And debts. Mostly debts.',[...sagaChoice('eye'),BYE]),
 },
 watchman:{
  hello:()=>turn('Hear, ye goodmen, the clock struck ten! Ah, a stranger. I walk this district all night with my morning star and lantern. A city of wood and straw roofs, and one candle can take half of it.',[...sagaChoice('fire'),choice('fire1728','Has it burned before?'),BYE]),
  fire1728:()=>turn('October 1728. Started in a candlemaker\'s on Vestervold and burned three days. Vor Frue, the university, the town hall, near a third of the city. That is why we rebuild in brick now, and why I sing every hour.',[...sagaChoice('fire'),BYE]),
 },
 maren:{
  hello:()=>turn('Fresh herring! Cod! Plaice from the Sound this morning! You buying or looking, my pretty?',[choice('buy','A herring, please (4 sk.)'),choice('strand','Where do the boats come in?'),BYE]),
  strand:()=>turn('Right here on Gammel Strand, the old beach, across from the Palace. The men fish, we sell. And we say what we like, the King\'s cook knows it.',[choice('buy','A herring then (4 sk.)'),BYE]),
  buy:()=>game?.spend(4)?turn('There. Salted, not too much. Eat it before the gulls do.',[BYE]):turn('No coin, no fish. Run errands, the merchants pay.',[BYE]),
 },
 thurah:{
  hello:()=>turn('Careful of the stones! This is Frederiksstaden, the King\'s new town. Four palaces around one square, built for four noblemen. Eigtved drew them, God rest him. I finish the work.',[choice('church','What is that building site?'),choice('statue','What goes in the middle?'),BYE]),
  church:()=>turn('Frederiks Kirke. A marble church with a dome to rival Rome. The King laid the foundation stone in 1749. It costs a fortune in Norwegian marble. Between you and me, I wonder if anyone alive will see it finished.',[BYE]),
  statue:()=>turn('King Frederik on horseback, by the Frenchman Saly. He has been working on the model for years. The East India Company is paying, so it will be very large and very expensive.',[BYE]),
 },
 nisse:{
  hello:()=>turn(y1760()?'Psst. Down here. Yes, a nisse. Every good house in this city has one, and you lot have stopped leaving porridge out.':'Psst. Down here. Yes, I am a nisse. No, you may not take a photo.',[...sagaChoice('nisse'),choice('job','What does a nisse do?'),BYE]),
  job:()=>turn('We look after the house, the farm, the animals. Treat us well and things go well. Forget us and the milk goes sour. Fair deal.',[...sagaChoice('nisse'),BYE]),
 },
 ole:{
  hello:()=>turn(y1760()?'Ole. I fish from here, like my father. If you are looking for my wife, she is the loud one selling it.':'Fifty years I fished out of here. Now I sit on the bench and tell tourists the fish was bigger in my day. It was.',[...sagaChoice('holger'),choice('strand','What was Gammel Strand?'),BYE]),
  strand:()=>turn(y1760()?'The old beach. We tie up right here and the women sell the catch on the quay, across from the palace. Fierce women. Mine is the fiercest.':'The old beach. Fishing boats tied up right here, and the fishwives sold the catch on the quay. There is a statue of one of them along the canal. Fierce women.',[...sagaChoice('holger'),BYE]),
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
 hca:{ // easter egg: the tall gentleman in the black coat on the Nyhavn quay
  hello:m=>turn(m.visits>1?'You again! Have you come to apologise for the review?':'Ah, a reader! Hans Christian Andersen, at your service. I wrote my first fairy tales right here, at number 20. Later I lived at 67, and at 18. I move a lot. Landladies.',[choice('mermaid','The Little Mermaid?'),choice('duckling','Was the ugly duckling you?'),choice('autograph','Can I have an autograph?'),BYE]),
  mermaid:()=>turn('She sits out at Langelinie. Tourists say she is small. She is life-size. Mermaids are not tall. Also, in my version nobody is happy at the end. Remember that.',[choice('autograph','Can I have an autograph?'),BYE]),
  duckling:()=>turn('A poor boy from Odense with big feet and a big nose, laughed at by the whole yard, who turns out to be a swan? I cannot imagine where I got the idea.',[choice('autograph','Can I have an autograph?'),BYE]),
  autograph:()=>turn('An autograph! Of course, of course. Just tell me first: you are not by any chance a critic? You have the look. That little notebook. That face.',[choice('critic','Well... I did write one review'),choice('fan','No, a big fan!'),BYE]),
  fan:()=>turn('Then here. H.C. Andersen, with a little paper cut-out of a swan. I cut them out at dinner parties. People find it charming. Mostly.',[BYE]),
  critic:()=>turn('A CRITIC! The one who called The Little Mermaid "too sad for children"?! Stand still. I have a FAIRY TALE for you. It is very long and nobody is happy at the end.',[choice('run','Run!')],'angry'),
  run:(m,person)=>{if(person){person.chaseLeft=25;person.chaseUntil=1;person.caught=false;person.gaveUp=false;}return {close:true,message:'Run!'};},
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
 if(id==='run'&&person?.script==='hca'){SCRIPTS.hca.run(memory,person);return {close:true,message:'Run!'};} // he gives chase (market-life.js moves him)
 if(id.startsWith('saga:'))return game?.sagaIntro(id.slice(5))||null;
 if(id.startsWith('accept:'))return game?.sagaAccept(id.slice(7))||null;
 if(id.startsWith('wait:'))return game?.sagaIntro(id.slice(5))||null;
 const node=SCRIPTS[person.script][id];return node?node(memory):null;
}
