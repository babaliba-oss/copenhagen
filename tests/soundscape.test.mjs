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

// Rain: a context that keeps every gain's last target and counts the sources still playing (a looped bed, or a one-shot
// not yet past its stop time), firing onended as its clock passes the stop.
function rainContext(){
 const ac=fakeContext(),gains=[],playing=new Set(),ending=[];
 const make={gain:ac.createGain,src:ac.createBufferSource,osc:ac.createOscillator};
 ac.createGain=()=>{const g=make.gain();const p=g.gain,set=p.setTargetAtTime;p.setTargetAtTime=(v,t,k)=>{set(v,t,k);p.target=v;};gains.push(g);return g;};
 const source=s=>{const start=s.start,stop=s.stop;s.start=(t=0,...a)=>{start(t,...a);playing.add(s);};s.stop=(t=0)=>{stop(t);ending.push([t,s]);};return s;};
 ac.createBufferSource=()=>source(make.src());ac.createOscillator=()=>source(make.osc());
 ac.tick=(dt,sound,opts)=>{ac.currentTime+=dt;for(let i=ending.length-1;i>=0;i--)if(ending[i][0]<=ac.currentTime){const s=ending[i][1];ending.splice(i,1);playing.delete(s);s.onended?.();}sound.update(dt,opts);};
 ac.playing=()=>playing.size;ac.targets=()=>gains.map(g=>g.gain.target??g.gain.value);
 return ac;
}

for(const era of [null,1760])test(`rain follows the weather's rain amount, is quieter inside, and switching it on and off leaves nothing playing (${era||'today'})`,()=>{
 // the city's random one-off sounds (bells, drops) are timed by Math.random: a fixed sequence keeps the source counts comparable
 const random=Math.random;let seed=7;Math.random=()=>((seed=(seed*16807)%2147483647)-1)/2147483646;try{
 const level=(mode,rain)=>{const ac=rainContext(),sound=createSoundscape(ac,{era});sound.music(false);for(let i=0;i<60;i++)ac.tick(1/60,sound,{enabled:true,mode,rain});return ac.targets();};
 const dry=level('walk',0),wet=level('walk',1),half=level('walk',.5),inCar=level('car',1);
 const ix=dry.findIndex((v,i)=>wet[i]>v+.01&&half[i]>v);assert.ok(ix>=0,'a gain rises with the rain');
 assert.equal(dry[ix],0,'silent when dry');assert.ok(Math.abs(half[ix]-wet[ix]/2)<1e-9,'in proportion to the rain amount (weather.js smooths the transition)');
 assert.ok(inCar[ix]<wet[ix]*.6&&inCar[ix]>0,`quieter inside (${inCar[ix].toFixed(3)} vs ${wet[ix].toFixed(3)})`);
 const ac=rainContext(),sound=createSoundscape(ac,{era});sound.music(false);
 const made=()=>ac.playing();for(let i=0;i<120;i++)ac.tick(1/60,sound,{enabled:true,mode:'walk',rain:0});const before=made();
 for(let k=0;k<200;k++)for(let i=0;i<30;i++)ac.tick(1/60,sound,{enabled:true,mode:k%3?'walk':'car',rain:k%2});
 for(let i=0;i<120;i++)ac.tick(1/60,sound,{enabled:true,mode:'walk',rain:0});
 assert.equal(made(),before,`sources playing after 200 weather changes: ${made()} (before ${before})`);
 const off=rainContext(),quiet=createSoundscape(off,{era});quiet.music(false);for(let i=0;i<60;i++)off.tick(1/60,quiet,{enabled:true,mode:'walk',rain:0});const n=off.playing();
 for(let i=0;i<600;i++)off.tick(1/60,quiet,{enabled:false,mode:'walk',rain:1});assert.equal(off.playing(),n,'no drops while the sound is off or paused');
 }finally{Math.random=random;}
});

test('footsteps: one per footfall on foot only, softer on grass, louder running, none with the sound off; each ends and lets go',()=>{
 for(const era of [null,1760]){
  const step=(opts)=>{const ac=rainContext(),sound=createSoundscape(ac,{era});sound.music(false);ac.tick(1/60,sound,{enabled:true,mode:'walk'});
   let made=0,peak=0;const mk=ac.createBufferSource,mg=ac.createGain;ac.createBufferSource=()=>{made++;return mk();};
   ac.createGain=()=>{const g=mg();const set=g.gain.setValueAtTime;g.gain.setValueAtTime=(v,t)=>{set(v,t);peak=Math.max(peak,v);};return g;};
   const random=Math.random;Math.random=()=>.5;try{ac.tick(1/60,sound,{enabled:true,steps:1,...opts});}finally{Math.random=random;}
   ac.createBufferSource=mk;ac.createGain=mg;const playing=ac.playing();for(let i=0;i<30;i++)ac.tick(1/60,sound,{enabled:true,mode:opts.mode});return {made,peak,ended:playing-ac.playing()};};
  const hard=step({mode:'walk'}),grass=step({mode:'walk',grass:true}),run=step({mode:'walk',running:true});
  assert.equal(hard.made,2,'a click and a thud');assert.equal(hard.ended,2,'both stop within half a second');
  assert.ok(grass.peak<hard.peak*.6,`grass ${grass.peak} vs ${hard.peak}`);assert.ok(run.peak>hard.peak*1.3,`running ${run.peak} vs ${hard.peak}`);
  for(const mode of ['car','bike','scooter'])assert.equal(step({mode}).made,0,mode);
  assert.equal(step({mode:'walk',enabled:false}).made,0,'sound off or paused');
 }
});
