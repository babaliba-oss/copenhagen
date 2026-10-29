import {createLoadingScreen} from './loading-screen.js';

// This lives outside main.js so failures while importing or creating the renderer
// can still show a usable recovery screen. Recovery is always the player's choice.
export function createGameResilience({win=window,doc=document,screen=createLoadingScreen(doc),reload=()=>win.location.reload(),log=console.error}={}){
 const canvas=doc.getElementById('world'),button=doc.getElementById('start-btn');
 const listeners=[],stopListeners=new Set();let stopped=false,kind=null,leaving=false,leaveTimer=null,held=null;
 const listen=(target,type,handler,capture=false)=>{target?.addEventListener(type,handler,capture);listeners.push(()=>target?.removeEventListener(type,handler,capture));};
 const fail=(error,source='runtime')=>{
  if(stopped)return false;
  if(leaving){held??=[error,source];return false;} // leaving the page (a link, Tab+Enter on the welcome card while it loads): the browser cancels the downloads, which is no failure to show or record
  stopped=true;kind=source;
  const detail=String(error?.message||error||'Unknown error');
  win.worldhoodFailure={kind,message:detail};
  doc.body.classList.add('game-failed');
  for(const dialog of doc.querySelectorAll('dialog[open]'))dialog.close();
  for(const stop of stopListeners){try{stop();}catch(e){log('Could not stop a game subsystem:',e);}}
  const where=[win.__bootStage&&!doc.body.classList.contains('driving')?`while loading: ${win.__bootStage}`:'while playing',win.__gpu].filter(Boolean).join(' · ');
  try{localStorage.setItem('gpu-lost-at',where);localStorage.setItem('last-failure',JSON.stringify({at:Date.now(),kind,where,detail:detail.slice(0,300),stack:String(error?.stack||'').slice(0,600)}));}catch{}
  if(source==='graphics-lost')screen.error(`The browser lost its graphics connection (usually out of graphics memory on a phone). Close other tabs, then reload: the game will restart without shadows, which some phone GPUs can't draw. (${where})`,{title:'Graphics connection lost'});
  else if(/webgl|graphics context/i.test(detail))screen.error('This browser could not start 3D graphics. On Android, Chrome and Brave block 3D for a site after a graphics crash: close the browser completely (swipe it away), open it again and reload. Otherwise enable hardware acceleration or try another browser.',{title:'3D graphics unavailable'});
  else if(source==='startup')screen.error('The game could not finish loading. Check your connection, then reload to try again.');
  else screen.error(`The game stopped unexpectedly. Reload to restart from your chosen city. (${where}: ${detail.slice(0,160)})`,{title:'The game stopped'}); /* the error itself on screen: a phone screenshot is the only report we get */
  log(`Worldhood ${source} failure:`,error);
  button?.focus();
  return true;
 };
 listen(canvas,'webglcontextlost',event=>{
  try{localStorage.setItem('gpu-lost',String(Date.now()));}catch{} // the next start begins at the lowest quality (main.js)
  event.preventDefault(); // Allow the browser to restore the context, without an automatic reload loop.
  fail(new Error('WebGL context lost'),'graphics-lost');
 });
 listen(canvas,'webglcontextrestored',()=>{
  if(kind==='graphics-lost')screen.error('Graphics is available again. Reload to restart the game.',{title:'Ready to restart'});
 });
 listen(win,'beforeunload',()=>{leaving=true;win.clearTimeout?.(leaveTimer);leaveTimer=win.setTimeout?.(()=>{leaving=false;if(held)fail(...held);held=null;},5000);}); // still here 5 s later (a download, a cancelled navigation): a failure held meanwhile shows after all
 listen(win,'pageshow',()=>{leaving=false;held=null;win.clearTimeout?.(leaveTimer);}); // back from the back/forward cache: the cancelled downloads were the navigation's
 listen(win,'error',event=>{if(event.error)fail(event.error);}); // Ignore optional image/font resource events.
 listen(win,'unhandledrejection',event=>fail(event.reason));
 // These capture listeners precede gameplay handlers, including the existing
 // start button handler. A failure cannot accidentally start the world again.
 listen(win,'click',event=>{
  if(!stopped||!button?.contains(event.target))return;
  event.preventDefault();event.stopImmediatePropagation();reload();
 },true);
 const blockKeys=event=>{
  if(!stopped||event.metaKey||event.ctrlKey||event.altKey)return;
  if(event.type==='keydown'&&event.code==='Enter'&&!event.repeat){event.preventDefault();reload();}
  // Preserve Tab navigation and the browser's button/link activation; stop only
  // delivery to gameplay listeners. Space on the focused reload button can click.
  event.stopImmediatePropagation();
 };
 listen(win,'keydown',blockKeys,true);listen(win,'keyup',blockKeys,true);
 return {
  fail,
  get stopped(){return stopped;},
  onStop(callback){stopListeners.add(callback);if(stopped)callback();return ()=>stopListeners.delete(callback);},
  dispose(){for(const remove of listeners)remove();stopListeners.clear();},
 };
}

let active;
export function installGameResilience(options){return active??=createGameResilience(options);}
export function gameIsStopped(){return active?.stopped||false;}
export function onGameStop(callback){return installGameResilience().onStop(callback);}
export function reportGameError(error,source='runtime'){return installGameResilience().fail(error,source);}
