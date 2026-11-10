// The basics, taught in play: one short line at the moment it is needed, the first time only (localStorage, as the
// 'wanted-hint'), shown as a toast. The help dialog keeps the full list.
const line=era=>`Follow the ${era===1760?'gold':'purple'} line to the beam: your first job.`;
const out=(mode,era)=>mode==='car'?(era===1760?'step down':'get out'):'get off';
const cap=s=>s[0].toUpperCase()+s.slice(1);
const TEXT={
 drive:{
  keys:({era})=>`${era===1760?'WASD or arrow keys to drive the coach':'WASD or arrow keys to drive'}. ${line(era)}`,
  touch:({era})=>`Hold Go and follow the ${era===1760?'gold':'purple'} line to the beam: your first job. Tap the arrows to steer.`,
  pad:({era})=>`RT to drive${era===1760?' the coach':''}, LT to brake, left stick to steer. ${line(era)}`,
 },
 exit:{
  keys:({mode,era})=>`Can't drive up to the beam? F to ${out(mode,era)} and walk.`,
  touch:({mode,era})=>`Can't drive up to the beam? Tap ${cap(out(mode,era))} and walk.`,
  pad:({mode,era})=>`Can't drive up to the beam? Y to ${out(mode,era)} and walk.`,
 },
 talk:{
  keys:()=>'G to say hello to someone nearby.',
  touch:()=>'Tap Say hello to talk to someone nearby.',
  pad:()=>'X to say hello to someone nearby.',
 },
 map:{
  keys:()=>'First delivery done. M opens the city map, J the journal of sagas.',
  touch:()=>'First delivery done. Menu has the city map and the journal of sagas.',
  pad:()=>'First delivery done. Back opens the city map, D-pad ← the journal of sagas.',
 },
 era:{
  keys:({era})=>era===1760?'Press Y to come back to today.':'Press Y to travel back to 1760.',
  touch:({era})=>era===1760?'Menu > Travel in time brings you back to today.':'Menu > Travel in time takes you back to 1760.',
  pad:({era})=>era===1760?'D-pad ↓ to come back to today.':'D-pad ↓ to travel back to 1760.',
 },
};
export const PROMPT_IDS=Object.keys(TEXT);
export const promptText=(id,{device='keys',era=0,mode='car'}={})=>TEXT[id][device]({era,mode});

// state: {started, busy (paused, a dialog, a race, a conversation…), toast (one is showing), device, era, mode, speed,
//  target (metres to the job or saga beam, or null), person (someone to talk to is in reach), delivered, canEra}
export function createPrompts({storage,show,eraAfter=240,gap=10}){
 const shown=new Set();let played=0,wait=0,still=0,delivered0=null,since=0;
 const seen=id=>{if(shown.has(id))return true;try{return !!storage?.getItem('hint-'+id);}catch{return false;}};
 const mark=id=>{shown.add(id);try{storage?.setItem('hint-'+id,'1');}catch{}};
 return {
  update(dt,s){
   if(!s.started||s.busy)return null;
   played+=dt;wait-=dt;
   still=s.mode!=='walk'&&Math.abs(s.speed||0)<.35?still+dt:0;
   if(delivered0===null)delivered0=s.delivered||0;
   since=(s.delivered||0)>delivered0?since+dt:0; // the "Delivered!" banner first
   if(wait>0||s.toast&&seen('drive'))return null; // one line at a time (the first one opens the game: nothing to wait for)
   const id=!seen('drive')?'drive'
    :!seen('talk')&&s.mode==='walk'&&s.person?'talk'
    :!seen('exit')&&still>1.5&&s.target!==null&&s.target>14&&s.target<45?'exit'
    :!seen('map')&&since>4?'map'
    :!seen('era')&&s.canEra&&played>eraAfter?'era':null;
   if(!id)return null;
   mark(id);wait=gap;show(promptText(id,s),{ms:id==='drive'?9000:7000});return id;
  },
 };
}
