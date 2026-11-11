import {mainSource} from './helpers/main-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {cycleIndex,cycleStart,pickerStep,swipeStep,startPosition,createStartPicker} from '../src/start-picker.js';
import {startUrl,pickStart,CITIES} from '../src/cities.js';

const starts=['Senate Square','Market Square','Kamppi','Olympia Terminal','Seurasaari bridge','Tapiola centre'].map(name=>({name,district:name,x:0,z:0}));

test('cycling wraps around in both directions',()=>{
 assert.equal(cycleIndex(6,0,-1),5);
 assert.equal(cycleIndex(6,5,1),0);
 assert.equal(cycleIndex(6,2,1),3);
 assert.equal(cycleIndex(6,2,-7),1);
 assert.equal(cycleIndex(0,0,1),-1);
 assert.equal(cycleIndex(3,-1,1),1,'an unknown position counts as the first');
 assert.equal(cycleStart(starts,starts[0],-1).name,'Tapiola centre');
 assert.equal(cycleStart(starts,starts[5],1).name,'Senate Square');
 assert.equal(cycleStart(starts,{...starts[3]},1).name,'Seurasaari bridge','a copy of a start is matched by name');
 assert.equal(cycleStart([],starts[0],1),null);
 assert.equal(startPosition(3,15),'4 / 15');
});

test('a picked start is written to ?start= and found again on reload',()=>{
 const location={href:'https://worldhood.org/?city=helsinki&start=olympia-terminal#x'};
 const next=cycleStart(starts,starts[3],1);
 const url=startUrl(location,CITIES.helsinki,next);
 assert.equal(url,'/?city=helsinki&start=seurasaari-bridge#x');
 assert.equal(pickStart(starts,new URLSearchParams(url.split('?')[1].split('#')[0]).get('start')),next);
});

test('arrow keys pick a start only while the welcome card is up',()=>{
 const card={ready:true,started:false};
 assert.equal(pickerStep('ArrowLeft',card),-1);
 assert.equal(pickerStep('ArrowRight',card),1);
 for(const code of ['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','Enter','Space'])assert.equal(pickerStep(code,card),0,`${code} still starts the game`);
 assert.equal(pickerStep('ArrowLeft',{ready:false,started:false}),0,'nothing to pick while loading');
 assert.equal(pickerStep('ArrowLeft',{ready:true,started:false,blocked:true}),0,'dialogs keep their keys');
});

test('after the start, arrows and WASD are left to driving',()=>{
 for(const code of ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD'])assert.equal(pickerStep(code,{ready:true,started:true}),0);
});

test('only a quick, mostly horizontal swipe changes the start',()=>{
 assert.equal(swipeStep(-80,10),1,'swipe left: next');
 assert.equal(swipeStep(80,-12),-1,'swipe right: previous');
 assert.equal(swipeStep(20,0),0,'too short');
 assert.equal(swipeStep(-60,70),0,'vertical scroll');
 assert.equal(swipeStep(-90,0,{ms:1500}),0,'slow drag');
});

class El{
 constructor(id){this.id=id;this.textContent='';this.hidden=false;this.attrs={};this.listeners={};this.offsetWidth=0;
  const set=new Set();this.classList={add:(...c)=>c.forEach(x=>set.add(x)),remove:(...c)=>c.forEach(x=>set.delete(x)),toggle:(c,on)=>on?set.add(c):set.delete(c),contains:c=>set.has(c)};}
 addEventListener(type,fn){this.listeners[type]=fn;}
 setAttribute(k,v){this.attrs[k]=v;}
 blur(){this.blurred=(this.blurred||0)+1;}
}
function fakeDoc(){const els=new Map(['intro','boot-title','start-count','start-status','start-prev','start-next'].map(id=>[id,new El(id)]));return {els,getElementById:id=>els.get(id)};}

test('the card shows the name and position and announces each change',()=>{
 const doc=fakeDoc(),picked=[];
 const picker=createStartPicker({doc,starts,current:starts[3],onChange:s=>picked.push(s.name)});
 const t=id=>doc.els.get(id);
 assert.equal(t('boot-title').textContent,'Olympia Terminal');assert.equal(t('start-count').textContent,'4 / 6');
 assert.equal(t('start-prev').hidden,false);
 t('start-next').listeners.click();t('start-next').listeners.click();t('start-next').listeners.click();
 assert.deepEqual(picked,['Seurasaari bridge','Tapiola centre','Senate Square']);
 assert.equal(t('start-count').textContent,'1 / 6');
 assert.equal(t('start-status').textContent,'Senate Square, starting point 1 of 6');
 t('start-prev').listeners.click();assert.equal(picker.selected.name,'Tapiola centre');
 picker.set(starts[3]);assert.equal(t('boot-title').textContent,'Olympia Terminal');
 picker.busy(true);assert.equal(t('intro').classList.contains('switching'),true);assert.equal(t('boot-title').attrs['aria-busy'],'true');
});

test('a city with one start shows no arrows',()=>{
 const doc=fakeDoc();createStartPicker({doc,starts:starts.slice(0,1),current:starts[0],onChange:()=>assert.fail()});
 assert.equal(doc.els.get('start-prev').hidden,true);assert.equal(doc.els.get('start-next').hidden,true);assert.equal(doc.els.get('start-count').hidden,true);
});

test('a mouse or touch click hands focus back, a keyboard press keeps it on the arrow',()=>{
 const doc=fakeDoc(),picked=[];
 createStartPicker({doc,starts,current:starts[0],onChange:s=>picked.push(s.name)});
 const next=doc.els.get('start-next'),prev=doc.els.get('start-prev');
 next.listeners.click({detail:0});
 assert.equal(next.blurred,undefined,'Enter or Space on a focused arrow: focus stays, so Enter picks again rather than starting the game');
 next.listeners.click({detail:0});
 next.listeners.click({detail:1});
 assert.equal(next.blurred,1,'a click returns focus to the page, so “or press Enter” starts the game');
 prev.listeners.click({detail:2});assert.equal(prev.blurred,1);
 assert.deepEqual(picked,['Market Square','Kamppi','Olympia Terminal','Kamppi'],'every press changes the start');
});

test('Enter on a focused arrow is left to the button, not taken over by the game keys',async()=>{
 const {readFile}=await import('node:fs/promises');
 const main=mainSource;
 assert.doesNotMatch(main,/closest\?\.\('\.start-arrow'\)/,'no Enter special case for the arrows');
 assert.match(main,/e\.code!=='Escape'&&e\.target\.closest\?\.\('button,/,'keys on a focused button stay with the button');
});
