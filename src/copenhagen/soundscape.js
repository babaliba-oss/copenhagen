// Copenhagen soundscape (Web Audio, no files): an engine with gears, tyre roll, a low city bed, the odd
// bicycle bell, a horn (B) and soft generative background music (U toggles it). In 1760 the engine becomes hooves on cobbles and the bells stay.
export function createSoundscape(ac,{era=null}={}){
 const out=ac.createGain();out.gain.value=0;out.connect(ac.destination);
 const noiseBuf=(()=>{const b=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate),d=b.getChannelData(0);let last=0;for(let i=0;i<d.length;i++){const w=Math.random()*2-1;last=(last+.02*w)/1.02;d[i]=last*3.5;}return b;})(); // brown noise
 const loop=(buf)=>{const s=ac.createBufferSource();s.buffer=buf;s.loop=true;s.start();return s;};
 // engine: two detuned saws -> low-pass -> gain
 const e1=ac.createOscillator(),e2=ac.createOscillator(),eLp=ac.createBiquadFilter(),eG=ac.createGain();
 e1.type='triangle';e2.type='sawtooth';e2.detune.value=-14;eLp.type='lowpass';eLp.Q.value=1.5;eG.gain.value=0; // soft hum under the city, not a buzz
 e1.connect(eLp);e2.connect(eLp);eLp.connect(eG);eG.connect(out);e1.start();e2.start();
 // tyres: band-passed noise
 const tyre=loop(noiseBuf),tBp=ac.createBiquadFilter(),tG=ac.createGain();tBp.type='bandpass';tBp.frequency.value=700;tBp.Q.value=.6;tG.gain.value=0;tyre.connect(tBp);tBp.connect(tG);tG.connect(out);
 // city bed
 const bed=loop(noiseBuf),bLp=ac.createBiquadFilter(),bG=ac.createGain();bLp.type='lowpass';bLp.frequency.value=era===1760?260:380;bG.gain.value=era===1760?.05:.07;bed.connect(bLp);bLp.connect(bG);bG.connect(out);
 const ping=(f,t0,dur,vol,type='sine')=>{const o=ac.createOscillator(),g=ac.createGain();o.type=type;o.frequency.value=f;g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(vol,t0+.005);g.gain.exponentialRampToValueAtTime(.0001,t0+dur);o.connect(g);g.connect(out);o.start(t0);o.stop(t0+dur+.05);};
 const bell=()=>{const t=ac.currentTime,f=2400+Math.random()*500;ping(f,t,.9,.05);ping(f*2.76,t,.5,.02);ping(f,t+.16,.9,.045);ping(f*2.76,t+.16,.5,.018);};
 const hoof=(v)=>{const t=ac.currentTime,s=ac.createBufferSource(),bp=ac.createBiquadFilter(),g=ac.createGain();s.buffer=noiseBuf;bp.type='bandpass';bp.frequency.value=900+Math.random()*500;bp.Q.value=3;g.gain.setValueAtTime(v,t);g.gain.exponentialRampToValueAtTime(.0001,t+.09);s.connect(bp);bp.connect(g);g.connect(out);s.start(t,Math.random());s.stop(t+.12);};
 let hornG=null;
 function horn(on){if(on&&!hornG){const t=ac.currentTime;hornG=ac.createGain();hornG.gain.setValueAtTime(0,t);hornG.gain.linearRampToValueAtTime(.035,t+.02);const lp=ac.createBiquadFilter();lp.type='lowpass';lp.frequency.value=1800;
   for(const f of era===1760?[330]:[392,494]){const o=ac.createOscillator();o.type=era===1760?'triangle':'square';o.frequency.value=f;o.connect(lp);o.start();hornG._o=[...(hornG._o||[]),o];}lp.connect(hornG);hornG.connect(out);}
  else if(!on&&hornG){const g=hornG;hornG=null;g.gain.setTargetAtTime(0,ac.currentTime,.03);setTimeout(()=>{for(const o of g._o||[])o.stop();g.disconnect();},300);}}
 // Background music (generative, no files): slow jazzy pad chords with a soft plucked melody through a tape-like
 // echo. Today: Fmaj7, Am7, Dm9, Bbmaj7 at a walking pace; 1760: a gentle D-major minuet on a harpsichord-ish pluck.
 const mus=ac.createGain();mus.gain.value=.0;mus.connect(out);
 const echo=ac.createDelay(1.5),fb=ac.createGain(),wet=ac.createGain(),echoLp=ac.createBiquadFilter();echo.delayTime.value=era===1760?.42:.55;fb.gain.value=.32;wet.gain.value=.35;echoLp.type='lowpass';echoLp.frequency.value=2200;
 echo.connect(echoLp);echoLp.connect(fb);fb.connect(echo);echoLp.connect(wet);wet.connect(mus);
 const mtof=m=>440*Math.pow(2,(m-69)/12);
 const CHORDS=era===1760?[[50,57,62,66],[55,59,62,67],[57,61,64,69],[50,57,62,66],[52,55,59,64],[57,61,64,67],[50,54,57,62],[57,61,64,69]]:[[41,52,57,60,64],[45,52,55,60,64],[38,50,53,57,64],[46,50,53,57,62]];
 const SCALE=era===1760?[62,64,66,67,69,71,73,74,76,78]:[65,67,69,72,74,76,77,79,81,84];
 const BAR=era===1760?2.4:3.2;
 function padNote(f,t0,dur,vol){const o1=ac.createOscillator(),o2=ac.createOscillator(),lp=ac.createBiquadFilter(),g=ac.createGain();o1.type='triangle';o2.type='sine';o1.frequency.value=f;o2.frequency.value=f*1.003;lp.type='lowpass';lp.frequency.value=900;
  g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(vol,t0+dur*.35);g.gain.setValueAtTime(vol,t0+dur*.7);g.gain.linearRampToValueAtTime(0,t0+dur*1.05);o1.connect(lp);o2.connect(lp);lp.connect(g);g.connect(mus);o1.start(t0);o2.start(t0);o1.stop(t0+dur*1.1);o2.stop(t0+dur*1.1);o1.onended=()=>{o1.disconnect();o2.disconnect();lp.disconnect();g.disconnect();};}
 function pluck(f,t0,vol){const o=ac.createOscillator(),g=ac.createGain(),lp=ac.createBiquadFilter();o.type=era===1760?'sawtooth':'triangle';o.frequency.value=f;lp.type='lowpass';lp.frequency.setValueAtTime(era===1760?3200:2400,t0);lp.frequency.exponentialRampToValueAtTime(500,t0+.6);
  g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(vol,t0+.006);g.gain.exponentialRampToValueAtTime(.0001,t0+(era===1760?.7:1.1));o.connect(lp);lp.connect(g);g.connect(mus);g.connect(echo);o.start(t0);o.stop(t0+1.2);o.onended=()=>{o.disconnect();lp.disconnect();g.disconnect();};}
 let musT=0,bar=0,musicOn=(()=>{try{return localStorage.getItem('cph-music')!=='0';}catch{return true;}})(),lastNote=4;
 function scheduleMusic(){const t=ac.currentTime;if(musT<t)musT=t+.1;
  while(musT<t+1.5){const ch=CHORDS[bar%CHORDS.length];
   if(era!==1760)ch.forEach((m,i)=>padNote(mtof(m),musT,BAR,i===0?.03:.016));else{padNote(mtof(ch[0]-12),musT,BAR,.03);ch.slice(1).forEach((m,i)=>pluck(mtof(m),musT+i*.12,.012));}
   const steps=era===1760?6:8;for(let k=0;k<steps;k++){if(Math.random()<(era===1760?.62:.42)){lastNote=Math.max(0,Math.min(SCALE.length-1,lastNote+Math.round((Math.random()-.5)*4)));pluck(mtof(SCALE[lastNote]),musT+k*BAR/steps+(Math.random()-.5)*.02,era===1760?.018:.022);}}
   musT+=BAR;bar++;}
 }
 let gear=1,bellT=8+Math.random()*15,stepT=0,lastSpeed=0;
 const GEARS=[0,9,17,25,34,99]; // m/s top of each gear
 function update(dt,{enabled,speed=0,mode='car',throttle=0}){
  const t=ac.currentTime,v=Math.abs(speed);out.gain.setTargetAtTime(enabled?.65:0,t,.15);if(!enabled)return;
  const car=mode==='car'&&era!==1760,coach=mode==='car'&&era===1760;
  if(car){while(gear<5&&v>GEARS[gear])gear++;while(gear>1&&v<GEARS[gear-1]-2)gear--;
   const lo=GEARS[gear-1],hi=GEARS[gear],rpm=.25+.75*Math.min(1,(v-lo)/Math.max(1,hi-lo)),f=38+rpm*70;
   e1.frequency.setTargetAtTime(f,t,.06);e2.frequency.setTargetAtTime(f*1.01,t,.06);eLp.frequency.setTargetAtTime(150+rpm*300+throttle*260,t,.08);eG.gain.setTargetAtTime(.0035+throttle*.0045+rpm*.003,t,.12);}
  else eG.gain.setTargetAtTime(0,t,.1);
  tG.gain.setTargetAtTime(mode==='car'?Math.min(.016,v*.001):mode==='bike'?Math.min(.012,v*.002):0,t,.1);tBp.frequency.setTargetAtTime(500+v*30,t,.2);
  if(coach&&v>.6){stepT-=dt*Math.min(4.5,v*.8);if(stepT<=0){stepT=1;hoof(.12);setTimeout(()=>hoof(.09),110);}}
  bellT-=dt;if(bellT<=0){bellT=10+Math.random()*25;bell();}
  lastSpeed=v;
  mus.gain.setTargetAtTime(musicOn?.6:0,t,.8);if(musicOn)scheduleMusic();
 }
 return {update,horn,bell,music(on){musicOn=on===undefined?!musicOn:!!on;return musicOn;}};
}
