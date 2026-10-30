// The travel prompt under the car (src/player-travel-ui.js) with a stand-in document.
import test from 'node:test';import assert from 'node:assert/strict';import {register} from 'node:module';
register('data:text/javascript,'+encodeURIComponent("export async function load(u,c,n){return u.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:n(u,c);}"));
const {createTravelUI}=await import('../src/player-travel-ui.js');
const el=()=>({hidden:false,dataset:{},textContent:'',setAttribute(){},addEventListener(){},append(){}});
const doc={body:{dataset:{},classList:{contains:()=>false}},createElement:el,querySelector:()=>({append(){}})};
test('parked at the start: one F prompt, not the button and the line both; moving: the line',()=>{
 let t=0;const travel={mode:'car',actor:{speed:0},nearest:()=>null},els=[];doc.createElement=()=>{const e=el();els.push(e);return e;};
 const ui=createTravelUI({interact(){},doc,now:()=>t}),[sec,action,,hint]=els;
 ui.update(travel,{started:true});assert.equal(action.hidden,false);assert.match(action.textContent,/F · Get out/);assert.equal(hint.hidden,true,'no second F line');
 travel.actor.speed=5;t=1000;ui.update(travel,{started:true});assert.equal(action.hidden,true);assert.equal(hint.hidden,false);assert.match(hint.textContent,/F to get out when stopped/);
 travel.mode='walk';travel.actor.speed=0;travel.nearest=()=>({id:'c',mode:'car'});t=2000;ui.update(travel,{started:true});assert.equal(hint.hidden,false,'on foot: WASD · Shift to run stays');assert.equal(sec.hidden,false);
});
