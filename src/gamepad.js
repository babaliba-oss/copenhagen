// Gamepad (standard mapping) -> the input state the keyboard and the touch controls already feed: held key codes in
// the `keys` set, analog steering in keys.tilt (left positive, as the thumb slider), one-shot buttons by name.
// Nothing is polled until a pad connects.
export const BUTTONS=['A','B','X','Y','LB','RB','LT','RT','Back','Start','L3','R3','Up','Down','Left','Right'];
export const DEAD=.18;
// A worn stick rests a little off centre: nothing inside the dead zone, then 0…1 over the rest of the travel.
export function axis(value,dead=DEAD){const v=Number.isFinite(value)?Math.max(-1,Math.min(1,value)):0,a=Math.abs(v);return a<=dead?0:Math.sign(v)*(a-dead)/(1-dead);}
const amount=(pad,i)=>{const b=pad.buttons?.[i];return b?Math.max(b.value||0,b.pressed?1:0):0;};

// pad state -> {held: key codes, tilt: steering -1…1, pressed: button names down now, active: anything touched}
export function padInput(pad,{walk=false,dead=DEAD}={}){
 const x=axis(pad.axes?.[0],dead),y=axis(pad.axes?.[1],dead),rx=axis(pad.axes?.[2],dead),held=[];
 const pressed=BUTTONS.filter((_,i)=>amount(pad,i)>.5);
 if(amount(pad,7)>.12||walk&&y<-.35)held.push('KeyW'); // the engine's throttle is on or off: the trigger past its first travel
 if(amount(pad,6)>.12||walk&&y>.35)held.push('KeyS');
 if(pressed.includes('A'))held.push(walk?'ShiftLeft':'Space'); // A: handbrake in a vehicle, run on foot
 if(pressed.includes('LB')||rx<-.4)held.push('KeyQ');
 if(pressed.includes('RB')||rx>.4)held.push('KeyE');
 return {held,tilt:x?-x:0,pressed,active:held.length>0||x!==0||y!==0||pressed.length>0};
}

// What a pad button does in play, as the key it stands for (main.js handles A, B and Start by where the game is).
export const PAD_KEYS={Y:'KeyF',X:'KeyG',Up:'KeyC',Left:'KeyJ',Right:'KeyL',Down:'KeyY',Back:'KeyM',R3:'KeyR'};
// Key name in a hint -> the pad button to show for it.
const LABELS={F:'Y',Enter:'Y',G:'X',N:'B',J:'D-pad ←',L:'D-pad →',Y:'D-pad ↓',C:'D-pad ↑',M:'Back',R:'R3',Esc:'B',Shift:'A',Space:'A',W:'RT',S:'LT'};
export const padInUse=(doc=globalThis.document)=>!!doc?.body?.classList?.contains('gamepad');
export const keyLabel=(key,doc=globalThis.document)=>padInUse(doc)&&LABELS[key]||key;

// Static hints: an element with data-pad shows that instead of its keys while a pad is in use ("RT / LT", "Left_stick").
export function swapPadLabels(root,on){
 for(const el of root.querySelectorAll('[data-pad]')){
  if(on===(el.dataset.keys!==undefined))continue;
  if(on){el.dataset.keys=el.innerHTML;if(el.tagName==='KBD')el.textContent=el.dataset.pad.replace(/_/g,' ');else el.innerHTML=el.dataset.pad.replace(/[^\s/]+/g,m=>m==='or'?m:`<kbd>${m.replace(/_/g,' ')}</kbd>`);}
  else{el.innerHTML=el.dataset.keys;delete el.dataset.keys;}
 }
}

export function createGamepad({keys,nav=navigator,win=window,active=()=>true,walk=()=>false,tap=()=>{},use=()=>{}}){
 let on=false,down=new Set(),steering=false;const mine=new Set();
 const pads=()=>{try{return [...(nav.getGamepads?.()||[])].filter(p=>p&&p.connected!==false);}catch{return [];}};
 const release=()=>{for(const k of mine)keys.delete(k);mine.clear();if(steering){keys.tilt=0;steering=false;}};
 win.addEventListener('gamepadconnected',()=>{on=true;});
 win.addEventListener('gamepaddisconnected',()=>{on=pads().length>0;if(!on){release();down=new Set();use(false);}});
 return {
  get connected(){return on;},
  poll(){
   if(!on)return;const list=pads(),pad=list.find(p=>p.mapping==='standard')||list[0];if(!pad){release();return;}
   const s=padInput(pad,{walk:walk()});if(s.active)use(true);
   for(const name of s.pressed)if(!down.has(name))tap(name);down=new Set(s.pressed);
   if(!active()){release();return;}
   for(const k of mine)if(!s.held.includes(k)){keys.delete(k);mine.delete(k);}
   for(const k of s.held){keys.add(k);mine.add(k);}
   if(s.tilt||steering){keys.tilt=s.tilt;steering=!!s.tilt;}
  },
 };
}
