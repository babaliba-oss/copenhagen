import test from 'node:test';
import assert from 'node:assert/strict';
import {createRadio,stationPosition,storedStation,storeStation,RADIO_OFF,RADIO_KEY} from '../src/copenhagen/radio.js';

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
 radio.update(.1,{on:false});radio.update(.1,{on:true});assert.deepEqual(shown.at(-1),['Radio Folk','No signal'],'getting back in during the outage says so');
 t=50;radio.update(.1,{on:false});radio.update(.1,{on:true});assert.equal(audio.src,'a.mp3','after it, the station tunes in again');assert.deepEqual(shown.at(-1),['Radio Folk','A']);
});

test('the radio starts on the station it was left on and comes on with it, card and all, when you drive',()=>{
 let t=0;const audio=fakeAudio(),shown=[];
 const radio=createRadio({stations,audio,clock:()=>t,random:()=>0,initial:2,banner:(a,b)=>shown.push([a,b])});
 assert.equal(radio.station,2);assert.equal(shown.length,0,'nothing is announced on foot');assert.equal(audio.src,'','or loaded');
 radio.update(.1,{on:true});assert.equal(audio.src,'c.mp3');assert.deepEqual(shown.at(-1),['Jazz','C'],'getting in announces the station and the track');
 radio.update(.1,{on:true});assert.equal(shown.length,1,'once, not every frame');
 radio.update(.1,{on:false});radio.update(.1,{on:true});assert.equal(shown.length,2,'and again on the next drive');
 audio.fire('ended');assert.deepEqual(shown.at(-1),['Jazz','C'],'a one-track station loops');
 t=100;radio.update(.1,{on:false});radio.next(-1);assert.deepEqual(shown.at(-1),['Radio Folk','A'],'tuned on foot: where the broadcast is now');
 assert.equal(createRadio({stations,audio:fakeAudio()}).station,RADIO_OFF,'off unless told otherwise');
 assert.equal(createRadio({stations,audio:fakeAudio(),initial:9}).station,2,'a station past the end is clamped');
 const off=createRadio({stations,audio:fakeAudio(),initial:RADIO_OFF,banner:(a,b)=>shown.push([a,b])});
 off.update(.1,{on:true});assert.deepEqual(shown.at(-1),['Radio off',''],'Radio off still brings up the card');assert.equal(off.playing,false);
});

test('the chosen station is remembered (0 = off); nothing stored means station 1; blocked storage only forgets',()=>{
 const memory=()=>{const m=new Map();return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v))};};
 const s=memory();assert.equal(storedStation(s),1,'the first drive tunes in, GTA style');
 storeStation(0,s);assert.equal(storedStation(s),0,'switched off stays off');
 storeStation(3,s);assert.equal(storedStation(s),3);
 s.setItem(RADIO_KEY,'jazz');assert.equal(storedStation(s),1,'anything else is ignored');
 const blocked={getItem(){throw new Error('SecurityError');},setItem(){throw new Error('QuotaExceededError');}};
 assert.equal(storedStation(blocked),1);assert.doesNotThrow(()=>storeStation(2,blocked));
});

test('a short buffer mid-song does not skip the track; a host with no data for 20 s does',()=>{
 let t=0;const audio=fakeAudio(),shown=[];
 const radio=createRadio({stations,audio,clock:()=>t,random:()=>0,initial:1,banner:(a,b)=>shown.push([a,b])});
 radio.update(.1,{on:true});audio.fire('playing');const src=audio.src;
 for(let i=0;i<20;i++){t+=1;radio.update(1,{on:true});} // 20 s of a sounding song
 audio.readyState=2;for(let i=0;i<15;i++){t+=1;radio.update(1,{on:true});} // a 15 s buffer
 assert.equal(audio.src,src,'the track is kept');assert.ok(radio.playing,'the game music does not cut in');
 audio.readyState=4;radio.update(.1,{on:true});
 const dead=fakeAudio();dead.readyState=0;const r2=createRadio({stations,audio:dead,clock:()=>t,random:()=>0,initial:1,banner:()=>{}});
 r2.update(.1,{on:true});const s0=dead.src;for(let i=0;i<22;i++){t+=1;r2.update(1,{on:true});}
 assert.ok(!r2.playing);
});
