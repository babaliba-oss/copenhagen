import test from 'node:test';
import assert from 'node:assert/strict';
import {createSoundscape} from '../src/copenhagen/soundscape.js';

// A Web Audio stand-in that throws like Chrome on a negative or non-finite time.
function fakeContext(){
 const ac={currentTime:0,sampleRate:8000,destination:{},scheduled:0};
 const check=t=>{if(!Number.isFinite(t)||t<0)throw new RangeError('Time must be a finite non-negative number: '+t);ac.scheduled++;};
 const param=(value=0)=>({value,setValueAtTime(v,t){check(t);},linearRampToValueAtTime(v,t){check(t);},exponentialRampToValueAtTime(v,t){check(t);},setTargetAtTime(v,t){check(t);}});
 const node=extra=>({connect(n){return n;},disconnect(){},...extra});
 Object.assign(ac,{
  createGain:()=>node({gain:param(1)}),
  createOscillator:()=>node({type:'',frequency:param(440),detune:param(0),start(t=0){check(t);},stop(t=0){check(t);}}),
  createBiquadFilter:()=>node({type:'',frequency:param(350),Q:param(1)}),
  createBuffer:(channels,length)=>({getChannelData:()=>new Float32Array(length)}),
  createBufferSource:()=>node({buffer:null,loop:false,start(t=0){check(t);},stop(t=0){check(t);}}),
  createDelay:()=>node({delayTime:param(0)}),
 });
 return ac;
}

for(const era of [null,1760])test(`music and bells never schedule before now while the audio clock still reads 0 (${era||'today'})`,()=>{
 const random=Math.random;Math.random=()=>0; // the most negative melody jitter, and every melody step plays
 try{
  const ac=fakeContext(),sound=createSoundscape(ac,{era});
  for(let i=0;i<5;i++)assert.doesNotThrow(()=>sound.update(1/60,{enabled:true,speed:8,mode:'car',throttle:1}));
  assert.doesNotThrow(()=>sound.bell());
  for(let i=0;i<120;i++){ac.currentTime+=1/60;assert.doesNotThrow(()=>sound.update(1/60,{enabled:true,speed:8,mode:'car',throttle:1}));}
  assert.ok(ac.scheduled>50,'notes were scheduled');
 }finally{Math.random=random;}
});

test('the horn (B) is the car\'s: none on a coach in 1760, on foot or on a bike, and getting out lets it go',()=>{
 const horns=(era,mode)=>{const ac=fakeContext(),sound=createSoundscape(ac,{era});sound.update(1/60,{enabled:true,mode}); // the music's notes are scheduled here, before counting
  let made=0;const make=ac.createOscillator;ac.createOscillator=()=>{made++;return make();};sound.horn(true);sound.horn(false);return made;};
 assert.equal(horns(null,'car'),2);
 for(const [era,mode] of [[1760,'car'],[null,'walk'],[null,'bike'],[null,'scooter']])assert.equal(horns(era,mode),0,`${era||'today'} ${mode}`);
 const ac=fakeContext(),sound=createSoundscape(ac,{era:null});let released=0;const make=ac.createGain;
 sound.update(1/60,{enabled:true,mode:'car'});ac.createGain=()=>{const g=make();g.gain.setTargetAtTime=()=>{released++;};return g;};sound.horn(true);ac.createGain=make;
 sound.update(1/60,{enabled:true,mode:'walk'});assert.equal(released,1,'stepping out with B held fades the horn');
});
