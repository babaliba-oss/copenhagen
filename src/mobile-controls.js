import './mobile-controls.css';
import {createTouchInput,thumbSteering} from './mobile-input.js';

const arrow=(direction)=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${direction==='up'?'M12 19V5m-6 6 6-6 6 6':direction==='down'?'M12 5v14m-6-6 6 6 6-6':direction==='left'?'M19 12H5m6-6-6 6 6 6':'M5 12h14m-6-6 6 6-6 6'}"/></svg>`;
const menuIcon='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h16M4 16h16"/></svg>';

export function createMobileControls({keys,canPlay=()=>true,onMenuChange=()=>{},actions={},notify=()=>{},doc=document,win=window}){
 const controls=doc.getElementById('touch-controls'),aux=doc.getElementById('touch-aux');
 const input=createTouchInput(keys),captures=new Map(),listeners=new win.AbortController();
 let state={started:false,paused:false,mapOpen:false,busted:false,mode:'car',speed:0},steering='thumb',afterClose=null,backdropPointer=null,neutral=null,motionSeen=false,motionTimer=null,disposed=false;
 const on=(target,type,handler,options={})=>target.addEventListener(type,handler,{...options,signal:listeners.signal});
 const touch=()=>doc.body.classList.contains('touch'),allowed=()=>touch()&&state.started&&!state.paused&&!state.mapOpen&&!state.busted&&!menu.open&&canPlay();
 controls.innerHTML=`<div class="mobile-steering"><div id="touch-steer" class="mobile-steer" role="slider" tabindex="0" aria-label="Steer. Drag left or right; release to straighten." aria-valuemin="-100" aria-valuemax="100" aria-valuenow="0" aria-orientation="horizontal"><span class="mobile-steer-track"></span><span class="mobile-steer-arrow left">${arrow('left')}</span><span class="mobile-steer-arrow right">${arrow('right')}</span><span class="mobile-steer-thumb"><i></i><i></i><i></i></span><span class="mobile-steer-label">Steer</span></div><div class="mobile-steer-buttons" hidden><button type="button" data-key="ArrowLeft" aria-label="Steer left">${arrow('left')}</button><button type="button" data-key="ArrowRight" aria-label="Steer right">${arrow('right')}</button></div><span class="mobile-tilt-hint" hidden>Tilt to steer</span></div><div class="mobile-pedals"><button id="touch-brake" class="mobile-pedal" type="button" data-key="ArrowDown" aria-label="Brake, then reverse">${arrow('down')}<span>Brake<small>Reverse</small></span></button><button id="touch-go" class="mobile-pedal mobile-go" type="button" data-key="ArrowUp" aria-label="Accelerate">${arrow('up')}<span>Go</span></button></div>`;
 aux.innerHTML=`<button id="touch-unstuck" type="button" hidden aria-label="Get unstuck: back onto the road here">Get unstuck</button><button id="touch-menu" type="button" aria-label="Open game menu" aria-haspopup="dialog" aria-controls="mobile-menu" aria-expanded="false">${menuIcon}<span>Menu</span></button>`;
 const pad=doc.getElementById('touch-steer'),menuButton=doc.getElementById('touch-menu'),pedals=[...controls.querySelectorAll('[data-key]')],steerButtons=controls.querySelector('.mobile-steer-buttons'),tiltHint=controls.querySelector('.mobile-tilt-hint');
 const menu=doc.createElement('dialog');menu.id='mobile-menu';menu.setAttribute('aria-labelledby','mobile-menu-title');
 menu.innerHTML=`<div class="mobile-menu-head"><h2 id="mobile-menu-title">Menu</h2><button class="mobile-menu-close" type="button" aria-label="Resume game">×</button></div><p id="mobile-menu-status" class="mobile-menu-status"></p><div class="mobile-menu-actions"><button type="button" data-action="map"><span>City map</span><small>Find a place</small></button><button type="button" data-action="camera"><span>Camera</span><small id="mobile-camera-value">Drive</small></button><button type="button" data-action="weather"><span>Time &amp; weather</span><small id="mobile-weather-value">Midday</small></button><button type="button" data-action="sound"><span>Sound</span><small id="mobile-sound-value">Off</small></button><button type="button" data-action="era" hidden><span>Travel in time</span><small id="mobile-era-value">1760</small></button></div><fieldset class="mobile-steering-options"><legend>Steering</legend><div><button type="button" data-steering="thumb" aria-pressed="true">Thumb</button><button type="button" data-steering="buttons" aria-pressed="false">Buttons</button><button type="button" data-steering="tilt" aria-pressed="false">Tilt</button></div></fieldset><p id="mobile-steering-note" role="status">Slide left or right for gentle turns. Release to straighten.</p><div class="mobile-menu-secondary"><button type="button" data-action="help">How to play</button><button type="button" data-action="reset">Reset position</button><button type="button" data-action="sources">About this city</button></div><button class="mobile-menu-resume" type="button">Back to the city <span aria-hidden="true">→</span></button>`;
 doc.getElementById('app').append(menu);
 doc.body.classList.add('mobile-controls-ready');
 const note=doc.getElementById('mobile-steering-note');
 function paintSteering(value=keys.tilt||0){
  pad.style.setProperty('--steer-offset',`${-value*Math.max(1,(pad.clientWidth-52)/2)}px`);
  pad.setAttribute('aria-valuenow',String(Math.round(-value*100)));
  pad.setAttribute('aria-valuetext',value===0?'Straight':`${Math.round(Math.abs(value)*100)}% ${value>0?'left':'right'}`);
 }
 function refreshPressed(){for(const b of pedals)b.classList.toggle('pressed',input.held(b.dataset.key));pad.classList.toggle('pressed',input.steering!==null&&steering==='thumb');paintSteering();}
 function release(){
  const changed=input.size>0||keys.tilt||captures.size;
  input.clear();keys.tilt=0;neutral=null;
  const held=[...captures];captures.clear();for(const [id,element] of held){try{if(element.hasPointerCapture(id))element.releasePointerCapture(id);}catch{/* A cancelled OS gesture may have already released it. */}}
  if(changed)refreshPressed();
 }
 function capture(e,element){captures.set(e.pointerId,element);try{element.setPointerCapture(e.pointerId);}catch{/* Synthetic events and interrupted native contacts can have no capture. */}}
 function end(e){input.release(e.pointerId);captures.delete(e.pointerId);refreshPressed();}
 for(const b of pedals){
  on(b,'pointerdown',e=>{if(!allowed()||e.button>0)return;e.preventDefault();if(input.press(e.pointerId,b.dataset.key)){capture(e,b);refreshPressed();}});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])on(b,type,end);
  on(b,'keydown',e=>{if(!['Space','Enter'].includes(e.code)||!allowed())return;e.preventDefault();e.stopPropagation();input.press(`key:${b.dataset.key}`,b.dataset.key);refreshPressed();});
  on(b,'keyup',e=>{if(!['Space','Enter'].includes(e.code))return;e.preventDefault();input.release(`key:${b.dataset.key}`);refreshPressed();});
  on(b,'blur',()=>{input.release(`key:${b.dataset.key}`);refreshPressed();});
  on(b,'contextmenu',e=>e.preventDefault());
 }
 function steerAt(e){const box=pad.getBoundingClientRect();if(input.steer(e.pointerId,thumbSteering(e.clientX,box.left,box.width)))refreshPressed();}
 on(pad,'pointerdown',e=>{if(!allowed()||e.button>0||steering!=='thumb')return;e.preventDefault();if(input.steering!==null)return;steerAt(e);capture(e,pad);});
 on(pad,'pointermove',e=>{if(input.steering!==e.pointerId)return;if(!allowed()){release();return;}e.preventDefault();steerAt(e);});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])on(pad,type,end);
 on(pad,'keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.code)||!allowed())return;e.preventDefault();e.stopPropagation();input.steer('keyboard',e.code==='ArrowLeft'?.65:-.65);refreshPressed();});
 on(pad,'keyup',e=>{if(['ArrowLeft','ArrowRight'].includes(e.code)){e.preventDefault();e.stopPropagation();input.release('keyboard');refreshPressed();}});
 on(pad,'blur',()=>{input.release('keyboard');refreshPressed();});on(pad,'contextmenu',e=>e.preventDefault());
 on(win,'pointerup',end);on(win,'pointercancel',end);
 for(const event of ['blur','pagehide','orientationchange'])on(win,event,release);
 // iOS shows and hides its toolbar on taps near the bottom edge (a height-only resize): a held pedal stays held then.
 let width=win.innerWidth;on(win,'resize',()=>{if(win.innerWidth!==width){width=win.innerWidth;release();}});
 on(doc,'visibilitychange',()=>{if(doc.hidden)release();});

 function refreshMenu(){
  doc.getElementById('mobile-menu-status').textContent=state.mode==='car'?'Exploring by car':state.mode==='walk'?'Exploring on foot':state.mode==='bike'?'Exploring by bike':'Exploring by scooter';
  doc.getElementById('mobile-camera-value').textContent=doc.getElementById('view-label')?.textContent||'Drive';
  doc.getElementById('mobile-weather-value').textContent=doc.getElementById('look-label')?.textContent||'Midday';
  doc.getElementById('mobile-sound-value').textContent=doc.getElementById('sound-btn')?.getAttribute('aria-label')==='Mute sound'?'On':'Off';
 }
 function openMenu(){
  if(!touch()||!state.started||state.busted||state.paused||state.mapOpen||disposed)return;
  release();backdropPointer=null;refreshMenu();menu.showModal();menuButton.setAttribute('aria-expanded','true');onMenuChange(true);
 }
 function closeMenu(next=null){afterClose=next;release();if(menu.open)menu.close();else{afterClose=null;next?.();}}
 on(menuButton,'click',openMenu);
 on(doc.getElementById('touch-unstuck'),'click',e=>{e.currentTarget.hidden=true;release();actions.reset?.();});
 on(menu.querySelector('.mobile-menu-close'),'click',()=>closeMenu());on(menu.querySelector('.mobile-menu-resume'),'click',()=>closeMenu());
 on(menu,'close',()=>{
  menuButton.setAttribute('aria-expanded','false');onMenuChange(false);
  const next=afterClose;afterClose=null;next?.();if(!next)doc.getElementById('world')?.focus();
 });
 const outsideMenu=e=>{const r=menu.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom;};
 // A finger already holding Go may be lifted after the modal opens. Its
 // retargeted click did not begin on this backdrop and must not dismiss it.
 on(menu,'pointerdown',e=>{backdropPointer=e.target===menu&&outsideMenu(e)?e.pointerId:null;});
 on(menu,'click',e=>{if(e.target===menu&&backdropPointer===e.pointerId&&outsideMenu(e))closeMenu();backdropPointer=null;});
 for(const button of menu.querySelectorAll('[data-action]'))on(button,'click',()=>{
  const name=button.dataset.action,action=actions[name];if(!action)return;
  if(['camera','weather','sound'].includes(name)){action();refreshMenu();}
  else closeMenu(action);
 });
 function applySteering(mode){
  release();steering=mode;controls.dataset.steering=mode;pad.hidden=mode!=='thumb';steerButtons.hidden=mode!=='buttons';tiltHint.hidden=mode!=='tilt';
  for(const b of menu.querySelectorAll('[data-steering]'))b.setAttribute('aria-pressed',String(b.dataset.steering===mode));
  note.textContent=mode==='thumb'?'Slide left or right for gentle turns. Release to straighten.':mode==='buttons'?'Hold left or right to steer. Release to straighten.':'Hold your phone comfortably when you resume. Tilt gently left or right to steer.';
 }
 async function chooseSteering(mode){
  if(mode==='tilt'){
   const motion=win.DeviceMotionEvent;
   if(!motion){note.textContent='This browser does not provide motion steering. Thumb and buttons are available.';return;}
   try{if(motion.requestPermission&&await motion.requestPermission()!=='granted'){note.textContent='Motion access was not allowed. Thumb and buttons are available.';return;}}
   catch{note.textContent='Motion steering is unavailable here. Try thumb or buttons.';return;}
   if(disposed)return;
   motionSeen=false;win.clearTimeout(motionTimer);motionTimer=win.setTimeout(()=>{if(steering==='tilt'&&!motionSeen){applySteering('thumb');note.textContent='No motion data received. Thumb steering is on.';notify('Motion data is unavailable. Thumb steering is on.');}},3500);
  }
  applySteering(mode);
 }
 for(const b of menu.querySelectorAll('[data-steering]'))on(b,'click',()=>chooseSteering(b.dataset.steering));
 const ios=/iP(hone|ad|od)/.test(win.navigator.userAgent)||win.navigator.platform==='MacIntel'&&win.navigator.maxTouchPoints>1;
 on(win,'devicemotion',e=>{
  const g=e.accelerationIncludingGravity;if(steering!=='tilt'||!g||g.x==null)return;motionSeen=true;if(!allowed())return;
  const a=(win.screen.orientation?.angle??win.orientation??0)*Math.PI/180,across=(ios?-1:1)*(g.x*Math.cos(a)-g.y*Math.sin(a));
  const roll=Math.asin(Math.max(-1,Math.min(1,across/9.81)))*180/Math.PI;neutral??=roll;
  const value=roll-neutral,dead=3;input.steer('tilt',Math.abs(value)<dead?0:(value-Math.sign(value)*dead)/25);
 });
 applySteering('thumb');
 return {
  release,openMenu,closeMenu,
  update(next){
   const previousMode=state.mode;state={...state,...next};
   if(previousMode!==state.mode||!allowed())release();
   const visible=touch()&&state.started&&!state.paused&&!state.mapOpen&&!state.busted;
   controls.hidden=!visible;aux.hidden=!visible;
   if(menu.open)refreshMenu();
   if(previousMode!==state.mode){
    const walk=state.mode==='walk',brake=doc.getElementById('touch-brake'),go=doc.getElementById('touch-go');
    brake.setAttribute('aria-label',walk?'Walk backwards':'Brake, then reverse');brake.querySelector('span').firstChild.textContent=walk?'Back':'Brake';brake.querySelector('small').textContent=walk?'':'Reverse';
    go.setAttribute('aria-label',walk?'Walk forward':state.mode==='bike'?'Pedal forward':state.mode==='scooter'?'Ride forward':'Accelerate');
    controls.setAttribute('aria-label',walk?'Touch walking controls':'Touch driving controls');
   }
   if((state.busted||!state.started)&&menu.open)closeMenu();
  },
  // wedged against something (main.js, stuck.js): a button beside Menu puts the car back on the road right here
  setStuck(on){const b=doc.getElementById('touch-unstuck');if(b&&b.hidden===!!on)b.hidden=!on;},
  snapshot(){return {steering,contacts:input.size,turn:keys.tilt||0,menuOpen:menu.open};},
  dispose(){disposed=true;release();win.clearTimeout(motionTimer);if(menu.open)menu.close();listeners.abort();menu.remove();doc.body.classList.remove('mobile-controls-ready');},
 };
}
