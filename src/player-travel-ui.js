import './player-travel.css';

export function createTravelUI({interact,toggleRun,focusWorld=()=>{},doc=document,now=()=>performance.now()}){
 const root=doc.createElement('section');root.id='travel-controls';root.setAttribute('aria-label','Travel actions');root.hidden=true;
 const action=doc.createElement('button'),run=doc.createElement('button'),hint=doc.createElement('span');
 action.id='travel-action';action.type='button';run.id='travel-run';run.type='button';hint.id='travel-hint';
 action.addEventListener('click',()=>{interact(action.dataset.ride||null);focusWorld();});run.addEventListener('click',()=>{toggleRun?.();focusWorld();});root.append(action,run,hint);doc.querySelector('#app').append(root);
 let previous=null,hintUntil=0,startedBefore=false;const seen=new Set();
 return {update(travel,{started,paused,mapOpen,busted=false,hidden=false}){
  if(!travel)return;const coarse=doc.body.classList.contains('touch');doc.body.dataset.travel=travel.mode;
  if(started&&!startedBefore){hintUntil=now()+4500;seen.add(travel.mode);}startedBefore=started;
  if(previous!==travel.mode){if(started&&!seen.has(travel.mode)){hintUntil=now()+4000;seen.add(travel.mode);}previous=travel.mode;}
  const nearest=travel.mode==='walk'?travel.nearest():null,stopped=Math.abs(travel.actor.speed)<.35,showHint=now()<hintUntil;
  action.dataset.ride=nearest?.id||'';
  action.textContent=travel.mode==='walk'?nearest?`${coarse?'':'Enter · '}${nearest.mode==='car'?(doc.body.classList.contains('era-1760')?'Board the coach':'Enter car'):`Ride ${nearest.label.toLowerCase()}`}`:'':`${coarse?'':'F · '}${travel.mode==='car'?(doc.body.classList.contains('era-1760')?'Step down':'Get out'):'Get off'}`;
  action.hidden=travel.mode==='walk'?!nearest:!stopped||(!coarse&&!showHint);action.disabled=false;
  run.hidden=!coarse||travel.mode!=='walk';run.textContent=travel.sprint?'Running':'Run';run.setAttribute('aria-pressed',String(!!travel.sprint));
  hint.textContent=coarse?'':travel.mode==='walk'?'WASD · Shift to run':travel.mode==='car'?'F to get out when stopped':'W / ↑ to ride · Space to brake · F to get off';hint.hidden=!showHint||coarse;
  root.hidden=!started||paused||mapOpen||busted||hidden||(action.hidden&&run.hidden&&hint.hidden);
 }};
}
