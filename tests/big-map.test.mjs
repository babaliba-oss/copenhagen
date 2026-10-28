import test from 'node:test';import assert from 'node:assert/strict';
// A stub DOM: just what the city map touches (a dialog with a canvas, its buttons and title, a 2D context that draws nothing).
function stubDom(){
 const listeners=el=>{el.on={};el.addEventListener=(t,f)=>{(el.on[t]||=[]).push(f);};return el;};
 const ctx=new Proxy({},{get:(o,k)=>k==='measureText'?()=>({width:40}):k in o?o[k]:()=>{},set:(o,k,v)=>{o[k]=v;return true;}});
 const canvas=listeners({tagName:'CANVAS',width:800,height:600,clientWidth:800,style:{},getContext:()=>ctx,getBoundingClientRect:()=>({left:0,top:0,width:800,height:600}),focus(){focused=canvas;},setPointerCapture(){}});
 const button=()=>listeners({tagName:'BUTTON',dataset:{}}),title={textContent:''},tools={'[data-fit]':button(),'.close-btn':button()};
 const dlg=listeners({open:false,showModal(){dlg.open=true;},close(){dlg.open=false;},querySelector:q=>q==='canvas'?canvas:q==='#bm-title'?title:tools[q],querySelectorAll:()=>[]});
 let focused=null;
 Object.assign(globalThis,{document:{createElement:()=>dlg,body:{appendChild(){},classList:{contains:()=>false}}},matchMedia:()=>({matches:false}),devicePixelRatio:1,requestAnimationFrame:()=>0,cancelAnimationFrame(){},addEventListener(){}});
 const key=(code,o={})=>{let stopped=false;const e={code,shiftKey:false,target:focused||dlg,...o,preventDefault(){},stopPropagation(){stopped=true;}};for(const f of dlg.on.keydown)f(e);return stopped;};
 return {dlg,canvas,key,focused:()=>focused};
}
test('city map: the arrow keys and Tab pick a named place, Enter travels there, Esc closes; a click still travels',async()=>{
 const {dlg,canvas,key,focused}=stubDom(),{createBigMap}=await import('../src/copenhagen/big-map.js');
 const places=[{name:'Kongens Nytorv',x:0,z:0},{name:'Nyhavn',x:300,z:0},{name:'Amalienborg',x:300,z:-400},{name:'Christianshavn',x:0,z:500}],went=[];
 const map=createBigMap({base:()=>({width:10}),view:()=>({cx:0,cz:0,size:3000}),landmarks:()=>places,player:()=>({x:10,z:10,heading:0}),targets:()=>[],route:()=>null,onTravel:l=>went.push(l.name),radius:()=>1500});
 map.open('Copenhagen',()=>{});assert.equal(focused(),canvas,'the map takes the focus, so the keys reach it');assert.equal(map.selected,null);
 assert.ok(key('ArrowRight'),'the key is the map\'s');assert.equal(map.selected.name,'Kongens Nytorv','the first key picks the place nearest the middle');
 key('ArrowRight');assert.equal(map.selected.name,'Nyhavn');key('ArrowUp');assert.equal(map.selected.name,'Amalienborg','up is north');
 key('ArrowLeft');assert.equal(map.selected.name,'Kongens Nytorv');key('ArrowDown');assert.equal(map.selected.name,'Christianshavn');
 key('ArrowDown');assert.equal(map.selected.name,'Christianshavn','nothing further that way: the pick stays');
 key('Tab');assert.equal(map.selected.name,'Kongens Nytorv','Tab: the next by name');key('Tab');assert.equal(map.selected.name,'Nyhavn');key('Tab');assert.equal(map.selected.name,'Amalienborg','and round');
 key('Tab',{shiftKey:true});assert.equal(map.selected.name,'Nyhavn','Shift+Tab: back');
 assert.equal(key('Tab',{target:{tagName:'BUTTON'}}),false,'on a button Tab moves between the buttons');
 key('Enter');assert.deepEqual(went,['Nyhavn']);assert.equal(dlg.open,false,'Enter travels and closes the map');
 map.open('Copenhagen',()=>{});assert.equal(map.selected,null,'a fresh pick each time it opens');key('Enter');assert.deepEqual(went,['Nyhavn'],'Enter with nothing picked does nothing');
 key('Escape');assert.equal(dlg.open,false,'Esc closes');
 map.open('Copenhagen',()=>{});/* Nyhavn on screen: fit scale min(800,600)/(1500*2.15) px a metre, zoom 2.2, centred on the player */
 const s=600/(1500*2.15)*2.2,px=400+(300-10)*s,py=300+(0-10)*s,ev={pointerId:1,clientX:px,clientY:py};
 for(const t of ['pointerdown','pointerup'])for(const f of canvas.on[t])f(ev);
 assert.deepEqual(went,['Nyhavn','Nyhavn'],'a click on a place still travels there');
});
