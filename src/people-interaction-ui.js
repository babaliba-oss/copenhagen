import './people-interaction.css';
import {padInUse} from './gamepad.js';

export function createPeopleInteractionUI({interact,choose,toggleVoice=()=>{},focusWorld=()=>{},doc=document}){
 const root=doc.createElement('section');root.id='people-interaction';root.hidden=true;root.setAttribute('aria-label','Conversation');
 const talk=doc.createElement('button');talk.id='people-talk-button';talk.type='button';talk.textContent='G · Say hello';
 const panel=doc.createElement('div');panel.id='people-chat';panel.hidden=true;
 const title=doc.createElement('strong');title.id='people-chat-title';title.textContent='Passerby';panel.setAttribute('aria-labelledby',title.id);
 const heading=doc.createElement('div');heading.className='people-chat-heading';
 const voice=doc.createElement('button');voice.id='people-chat-voice';voice.type='button';voice.addEventListener('click',()=>{toggleVoice();focusWorld();});
 const description=doc.createElement('p');description.className='people-chat-description';
 const previous=doc.createElement('p');previous.className='people-chat-previous';previous.hidden=true;
 const response=doc.createElement('p');response.id='people-chat-response';response.setAttribute('role','status');response.setAttribute('aria-live','polite');response.setAttribute('aria-atomic','true');
 const options=doc.createElement('div');options.className='people-chat-options';
 const status=doc.createElement('p');status.id='people-chat-voice-status';
 talk.addEventListener('click',()=>{interact();focusWorld();});
 heading.append(title,voice);panel.append(heading,description,previous,response,options,status);root.append(talk,panel);doc.querySelector('#app').append(root);
 let optionsKey='',lastResponse='',lastTurn=-1;
 return {
  root,
  update(state,{hidden=false}={}){
   root.hidden=hidden||!state||!(state.active||state.nearby);
   if(root.hidden)return;
   const invitation=state.person?.vendor?'Talk to seller':'Say hello';
   talk.textContent=padInUse(doc)?`X · ${invitation}`:doc.body.classList.contains('touch')?invitation:`G · ${invitation}`;
   talk.hidden=!!state.active;panel.hidden=!state.active;
   if(state.active){
    title.textContent=state.person?.name||state.person?.label||'Passerby';
    description.textContent=state.person?.vendor?state.person.label:state.person?.description||'Passerby';
    previous.hidden=!state.previousChoice;previous.textContent=state.previousChoice?`You: ${state.previousChoice}`:'';
    const audio=state.voice||{};voice.textContent=audio.enabled?'Sound on':'Sound off';
    voice.setAttribute('aria-pressed',String(!!audio.enabled));voice.setAttribute('aria-label',audio.enabled?'Mute game sound and voices':'Enable game sound and voices');
    voice.title=audio.enabled?'Mute game sound and voices':'Enable game sound and voices';
    status.textContent=!audio.enabled?'Captions on':audio.status==='text'?(audio.supported&&!audio.available?'No installed voice available · captions on':'Voice unavailable · captions on'):audio.speaking?'Speaking · captions on':'Installed voice · captions on';
    if(lastResponse!==state.response){response.textContent=state.response;lastResponse=state.response;}
    const key=state.choices.map(c=>`${c.id}:${c.label}`).join('|');
    if(optionsKey!==key){
     options.replaceChildren();optionsKey=key;
     for(const c of state.choices){const button=doc.createElement('button');button.type='button';button.textContent=c.label;button.dataset.reply=c.id;button.addEventListener('click',()=>{choose(c.id);focusWorld();});options.append(button);}
    }
    // Reply buttons may be below the fold on a phone. Every new turn starts
    // with the new caption visible; ordinary HUD refreshes preserve scrolling.
    if(lastTurn!==state.turn){panel.scrollTop=0;lastTurn=state.turn;}
   }else{lastResponse='';lastTurn=-1;}
  },
  dispose(){root.remove();},
 };
}
