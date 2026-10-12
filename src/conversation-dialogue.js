// Authored, fictional characters. Place names and bearings come only from the
// active city's supplied map; sellers describe the game's existing stall menu.
import {STALL_KINDS,formatEuro} from './market-shop.js';
import {isAuthored,authoredCharacter,authoredBegin,authoredNext} from './copenhagen/characters.js';

const hash=value=>{let n=2166136261;for(const c of String(value??''))n=Math.imul(n^c.charCodeAt(0),16777619)>>>0;return n;};
const NAMES=['Robin','Ari','Alex','Sam','Kai','Mika','Noor','Jules','Sasha','Charlie','Elli','Lee'];
const PROFILES=[
 {id:'observer',description:'Notices the little things',about:'I like drawing buildings. I go out meaning to sketch one doorway, then come back with a page full of windows.',notice:'Start with the upper floors. Everyone looks at the shop windows, but the rooflines give a street its own rhythm.',favourite:'A corner that looks different when you turn around. I sometimes sketch the same spot from both sides; it never feels like the same drawing.'},
 {id:'wanderer',description:'Always trying another route',about:'I collect walks, if that makes sense. No scores or record times — just a different way home whenever I can.',notice:'Look down a side street before you pass it. I like finding a little stretch I have not walked before.',favourite:'The moment I recognise a street from the other end. Suddenly two little pieces of the city join up in my head.'},
 {id:'maker',description:'Curious about how things work',about:'I fix old bikes for fun. A short ride to test a repair has a habit of becoming my whole afternoon.',notice:'Look at how a street fits together: a crossing, a bike rack, a bench. Small things can make a place easy to spend time in.',favourite:'Somewhere I can stop, put the bike aside and watch people go about their day. The ride there is only half of it.'},
 {id:'social',description:'Happy to stop for a chat',about:'Honestly? A walk and a conversation like this. I usually leave without much of a plan and see who I run into.',notice:'Slow down for a moment. I like watching the city carry on around me instead of always hurrying through it.',favourite:'A place I can return to and notice something new. Sometimes it is the same corner, just a different sort of day.'},
];
export function characterFor(person){
 if(isAuthored(person))return authoredCharacter(person); // a city's named characters (src/copenhagen/characters.js)
 const n=hash(person?.id??person?.stall??`${person?.x}:${person?.z}`),profile=PROFILES[n%PROFILES.length];
 const menu=menuFor(person);
 return {name:NAMES[Math.floor(n/7)%NAMES.length],profile,label:menu?menu.name:'Passerby',description:menu?'Market seller':profile.description,voiceSeed:n};
}
const choice=(id,label)=>({id,label});
const BYE=choice('bye','See you around');
const mainChoices=()=>[choice('day',"How’s your day going?"),choice('explore','Where should I head next?'),choice('about','What do you like doing here?'),BYE];
const endChoices=()=>[choice('explore','Help me pick a place'),choice('about','Tell me more about you'),BYE];
const turn=(response,choices,expression='friendly')=>({response,choices,expression});
const hasPosition=p=>Number.isFinite(p?.x)&&Number.isFinite(p?.z);
function placesNear(person,context){
 const seen=new Set();
 return (context?.landmarks||[]).filter(l=>{
  if(!hasPosition(l)||typeof l.name!=='string'||!l.name.trim()||seen.has(l.name))return false;
  seen.add(l.name);return true;
 }).map(l=>({...l,distance:Math.hypot(l.x-person.x,l.z-person.z)})).sort((a,b)=>a.distance-b.distance);
}
function describePlace(place,person){
 if(!place)return 'I would pick a marked place on the map, then explore the streets around it. Which way do you like getting around?';
 if(place.distance<65)return `You’re already close to ${place.name}. We could make that the starting point, then choose somewhere else on the map. Do you prefer walking or riding?`;
 const angle=Math.atan2(place.x-person.x,-(place.z-person.z)),directions=['north','northeast','east','southeast','south','southwest','west','northwest'];
 const bearing=directions[(Math.round(angle/(Math.PI/4))+8)%8];
 const d=place.distance<1000?`about ${Math.max(50,Math.round(place.distance/50)*50)} metres`:`about ${(place.distance/1000).toFixed(1)} kilometres`;
 return `${place.name} is ${d} ${bearing} of us in a straight line. You can find it on the map; the streets may take you a longer way. How would you like to get there?`;
}
const transportChoices=()=>[choice('walk','I’d like to walk'),choice('bike','I’ll take a bike'),choice('another','Somewhere else?'),BYE];
const vendorChoices=person=>person?.vendor?.kind==='icecream'?[choice('pehmis','What is pehmis?'),choice('flavours','Which flavours do you have?'),choice('gulls','Are the gulls after ice cream?'),choice('shop','Let me see your menu'),BYE]:[choice('recommend','What would you recommend?'),choice('budget','Something small or inexpensive?'),choice('seller-day','How’s the stall going?'),choice('shop','Let me see your menu'),BYE];
const menuFor=person=>Object.hasOwn(STALL_KINDS,person?.vendor?.kind)?STALL_KINDS[person.vendor.kind]:null;
const namedItem=it=>`That’s ${formatEuro(it.price)}`;
const DETAILS={
 'salmon-soup':'It’s creamy salmon soup with dill and rye bread.',vendace:'They’re small fried fish, served with garlic mayonnaise.',coffee:'It’s a cup of filter coffee.',munkki:'It’s a cardamom doughnut rolled in sugar.',korvapuusti:'It’s a cinnamon bun with cardamom.',
 'meat-pie':'It’s a fried meat pie — a filling snack.',strawberries:'The strawberries come in a paper cone, so they’re easy to carry on a walk.',blueberries:'They’re wild blueberries, served in a paper cone. You might end up with purple fingers!',peas:'Open the pods and eat the sweet peas raw.',
 tulips:'It’s a mix of coloured tulips wrapped in paper.',sunflowers:'Three tall stems, wrapped for you to carry.',rose:'One rose, wrapped with a ribbon.',reindeer:'It’s a small carved, hand-painted wooden reindeer.','wool-socks':'They’re hand-knitted wool socks — a warm choice.','butter-knife':'It’s a butter knife turned from Finnish birch.',
 'soft-serve':'Pehmis is soft-serve ice cream. This one is a vanilla swirl in a waffle cone.','berry-cone':'It’s a berry-flavoured scoop in a waffle cone.','chocolate-cone':'It’s a chocolate scoop in a waffle cone.',
};
const itemDetail=item=>Object.hasOwn(DETAILS,item.id)?DETAILS[item.id]:`${item.note}.`;

export function beginDialogue(person,memory,context={}){
 if(isAuthored(person))return authoredBegin(person,memory,context);
 const c=characterFor(person),menu=menuFor(person);memory.visits=(memory.visits||0)+1;memory.topics??=[];
 if(menu){
  const remembered=memory.item&&menu.items.find(it=>it.id===memory.item);
  const first=menu.id==='icecream'?`Hi! I’m ${c.name}. Fancy a pehmis? That’s soft-serve ice cream. Keep an eye on your cone — nearby gulls can get very interested.`:`Hi! I’m ${c.name}. Have a look at the ${menu.name.toLowerCase()}. Looking for anything in particular, or just having a wander?`;
  return turn(memory.visits>1?`Hello again! ${remembered?`Still thinking about the ${remembered.name.toLowerCase()}?`:'Good to see you back at the stall.'} Take your time; I’m happy to talk you through the choices.`:first,vendorChoices(person));
 }
 const revisit=memory.preference==='walk'?'How did your walk go?':memory.preference==='bike'?'How was the ride?':memory.preference==='slow'?'Still taking it easy?':'Found any interesting corners since we last spoke?';
 return turn(memory.visits>1?`Oh, hello again! ${revisit}`:`Hi! I’m ${c.name}. ${context.cityName?`Taking a look around ${context.cityName}?`:'Out exploring?'}`,[choice('hello',memory.visits>1?'Nice to see you again':'Hi! Yes, I’m exploring'),...mainChoices()]);
}

export function nextDialogue(id,person,memory,context={}){
 if(isAuthored(person))return authoredNext(id,person,memory,context);
 const c=characterFor(person),menu=menuFor(person),repeat=memory.topics.includes(id);
 if(!repeat)memory.topics.push(id);
 if(menu){
  const preferred=menu.items.find(it=>it.id===memory.item)||menu.items[0];
  if(menu.id==='icecream'){
   if(id==='pehmis'){
    const item=menu.items.find(it=>it.id==='soft-serve');memory.item=item.id;
    return turn(`Pehmis is soft-serve ice cream, the swirly kind on the sign. Ours is vanilla in a waffle cone for ${formatEuro(item.price)}. Would you like that, or a scoop instead?`,[choice('flavours','Tell me about the scoops'),choice('gulls','What about those gulls?'),choice('shop','I’d like to choose a cone'),BYE]);
   }
   if(id==='flavours')return turn(`We have ${menu.items.map(it=>`${it.name.toLowerCase()} for ${formatEuro(it.price)}`).join(', ')}. The pehmis has a soft spiral; the other two are scoops.`,[choice('recommend','Which would you pick?'),choice('gulls','Will the gulls try to take it?'),choice('shop','Show me the choices'),BYE]);
   if(id==='gulls')return turn('They may gather when they spot a cone. If they crowd you, run clear of the flock, or let the cone go and move away while they go after it. While they’re just watching, you can carry on eating.',[choice('pehmis','I’ll hear about the pehmis first'),choice('shop','I’ll take my chances — show me'),BYE]);
  }
  if(id==='recommend'){
   memory.item=preferred.id;
   return turn(`${repeat?'We were looking at':'I’d suggest'} the ${preferred.name.toLowerCase()}. ${namedItem(preferred)}. Would you like another idea, or a closer look at that?`,[choice('product','Tell me a bit more'),choice('alternative','What else would you pick?'),choice('shop','Show me the menu'),BYE]);
  }
  if(id==='alternative'){
   const item=menu.items[(menu.items.indexOf(preferred)+1)%menu.items.length];memory.item=item.id;
   return turn(`Then how about the ${item.name.toLowerCase()}? ${namedItem(item)}. I can tell you a bit about it, or we can compare the smaller choices.`,[choice('product','Tell me more about that'),choice('budget','What costs a little less?'),choice('shop','Show me the menu'),BYE]);
  }
  if(id==='product')return turn(`${itemDetail(preferred)} ${preferred.encounter==='gulls'?'Enjoy it while you walk, but keep an eye on any gulls gathering nearby.':preferred.use==='keep'?'You can carry it for a while, then put it away to free your hands.':'Take it with you if you like. No need to finish it at the counter.'}`,[choice('alternative','Another idea?'),preferred.encounter==='gulls'?choice('gulls','What should I do about the gulls?'):choice('seller-day','Do you enjoy running the stall?'),choice('shop','I’d like to choose something'),BYE]);
  if(id==='budget'){
   const item=menu.items.reduce((a,b)=>a.price<=b.price?a:b);memory.item=item.id;
   return turn(`The least expensive choice is ${item.name.toLowerCase()} at ${formatEuro(item.price)}. You can check every price on the menu before deciding.`,[choice('product','That sounds good — tell me more'),choice('recommend','What’s your own pick?'),choice('shop','Let me compare the menu'),BYE]);
  }
  if(id==='seller-day')return turn(repeat?'Still happy to have someone stop and chat. Have you decided whether you’re browsing or buying today?':`I like helping someone find the thing they actually want. Sometimes that means chatting for a bit; sometimes it’s pointing out the smallest choice on the counter. What brings you over?`,[choice('browsing','Just exploring and saying hello'),choice('recommend','I’m looking for a recommendation'),choice('shop','I’d like to buy something'),BYE]);
  if(id==='browsing')return turn('That’s welcome too. A market would be a dull place if everyone only looked at a price and left. Enjoy your wander, and stop by again if something catches your eye.',[choice('recommend','Actually, what would you pick?'),choice('shop','I’ll take a look at the menu'),BYE]);
  return null;
 }
 if(id==='hello')return turn(memory.visits>1?'It’s nice running into the same face again. How is your exploring going?':`You’ve caught me at a good moment. ${c.profile.id==='maker'?'I’m taking a break from tinkering with a bike.':'I’m in no particular hurry.'} What would you like to talk about?`,mainChoices());
 if(id==='day')return turn(repeat?'Still going well. I’m sticking with a slower sort of day. How about you?':[
  'Pretty good. I stopped to look at one building and lost track of the time. Are you taking it slowly today, or trying to fit a lot in?',
  'Good! I came out for a short walk, then kept taking one more turn. Is this a wandering sort of day for you too?',
  'Not bad. I finally fixed an annoying rattle, so I’m calling that a small victory. Got a plan for the day, or taking it as it comes?',
  'Better for getting outside. A bit of fresh air and a chat usually do the trick. Are you having a quiet day or a busy one?',
 ][PROFILES.indexOf(c.profile)],[choice('slow','I’m taking my time'),choice('busy','I want to see a lot'),choice('explore','Could you help me pick a place?'),BYE]);
 if(id==='slow'){memory.preference='slow';return turn('Then give yourself permission to stop. I like choosing one small thing to notice on each street — a doorway, a tree, a shape above the windows. What usually catches your eye?',[choice('notice','Buildings and little details'),choice('favourite','Places I’d like to come back to'),choice('explore','A good place to start?'),BYE]);}
 if(id==='busy')return turn('I know that feeling. I’d pick one place first, enjoy getting there, then decide on the next. Otherwise I spend the whole walk planning a different walk.',[choice('explore','All right — help me choose'),choice('bike','Maybe I should ride instead'),choice('about','What do you do on a free day?'),BYE]);
 if(id==='about')return turn(`${repeat?'As I was saying, ':''}${c.profile.about}`,[choice('notice','What should I look out for?'),choice('favourite','What makes a place special to you?'),choice('explore','Where could I explore next?'),BYE]);
 if(id==='notice')return turn(c.profile.notice,[choice('favourite','And your favourite kind of place?'),choice('explore','Help me find a place on the map'),BYE]);
 if(id==='favourite')return turn(c.profile.favourite,[choice('notice','What would you notice first?'),choice('explore','Where shall I head next?'),BYE]);
 if(id==='explore'||id==='another'){
  const places=placesNear(person,context);memory.placeIndex=id==='another'?(memory.placeIndex||0)+1:0;
  const place=places.length?places[memory.placeIndex%places.length]:null;
  const choices=transportChoices().filter(ch=>ch.id!=='another'||places.length>1);
  return turn(describePlace(place,person),choices);
 }
 if(id==='walk'){memory.preference='walk';return turn('Walking would be my choice when I want to look closely. Keep the map handy, and take a different street back if you feel like it. No need to turn a stroll into a deadline.',endChoices());}
 if(id==='bike'){memory.preference='bike';return turn('That gives you more room to wander. Walk up to a parked bike or scooter and use the ride action. You can get off again whenever a corner deserves a closer look.',[choice('notice','What should I keep an eye out for?'),choice('explore','Remind me where to head'),BYE]);}
 return null;
}
