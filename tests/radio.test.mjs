import test from 'node:test';
import assert from 'node:assert/strict';
import {createRadio,stationPosition,RADIO_OFF} from '../src/copenhagen/radio.js';

const fakeAudio=()=>{const l={};return {src:'',volume:0,paused:true,readyState:4,duration:300,currentTime:0,
 addEventListener(k,f){(l[k]||=[]).push(f);},fire(k){(l[k]||[]).forEach(f=>f());},load(){},play(){this.paused=false;return Promise.resolve();},pause(){this.paused=true;}};};
const stations=[{id:'folk',name:'Radio Folk',tracks:[{title:'A',url:'a.mp3',seconds:200},{title:'B',url:'b.mp3',seconds:100}]},{id:'jazz',name:'Jazz',tracks:[{title:'C',url:'c.mp3'}]},{id:'empty',name:'Empty',tracks:[]}];

test('a station is a broadcast: its playlist loops on the clock',()=>{
 const s={tracks:stations[0].tracks,offset:0};
 assert.deepEqual(stationPosition(s,50),{index:0,offset:50});
 assert.deepEqual(stationPosition(s,250),{index:1,offset:50});
 assert.deepEqual(stationPosition(s,310),{index:0,offset:10}); // 300 s loop
 assert.equal(stationPosition({tracks:[]},10),null);
 assert.deepEqual(stationPosition({tracks:stations[1].tracks,offset:0},30),{index:0,offset:0}); // unknown length: from the start
});

test('L cycles the stations and Radio off; it only plays while driving with the sound on',()=>{
 let t=0;const audio=fakeAudio(),shown=[];
 const radio=createRadio({stations,audio,clock:()=>t,random:()=>0,banner:(a,b)=>shown.push([a,b])});
 assert.equal(radio.stations.length,2,'a station without tracks is left out');
 assert.equal(radio.station,RADIO_OFF);
 radio.next();assert.equal(radio.station,1);assert.equal(shown.at(-1)[0],'Radio Folk');
 radio.update(.1,{on:false});assert.equal(audio.src,'','nothing loads before you drive');
 radio.update(.1,{on:true});assert.equal(audio.src,'a.mp3');assert.ok(radio.playing);
 for(let i=0;i<60;i++)radio.update(1/30,{on:true});assert.ok(audio.volume>.3,'fades in');
 t=250;radio.next();radio.next();assert.equal(radio.station,RADIO_OFF);assert.equal(shown.at(-1)[0],'Radio off');
 radio.next(-1);assert.equal(radio.station,2);assert.equal(audio.src,'c.mp3');
 radio.update(.1,{on:false});for(let i=0;i<90;i++)radio.update(1/30,{on:false});assert.ok(audio.volume<.05,'fades out when you leave the car');
});

test('a track that ends hands over to the next one; three failures in a row mean no signal',()=>{
 let t=0;const audio=fakeAudio(),shown=[];
 const radio=createRadio({stations,audio,clock:()=>t,random:()=>0,banner:(a,b)=>shown.push([a,b])});
 radio.next();radio.update(.1,{on:true});assert.equal(audio.src,'a.mp3');
 audio.fire('ended');assert.equal(audio.src,'b.mp3');
 audio.fire('error');audio.fire('error');audio.fire('error');
 assert.equal(shown.at(-1)[1],'No signal');assert.equal(radio.playing,false);
});
