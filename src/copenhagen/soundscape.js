// Copenhagen soundscape (Web Audio, no files): an engine with gears, tyre roll, a low city bed, the odd
// bicycle bell, a horn (B) and generative Danish folk tunes for background music (U toggles it; the car radio, L,
// takes over while it plays). In 1760 the engine becomes hooves on cobbles and the bells stay.
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
 // Web Audio throws on a negative or non-finite time, and that error stopped the game: every scheduled note starts
 // no earlier than now (currentTime still reads 0 for the first frames while the audio device starts up).
 const when=t=>Number.isFinite(t)?Math.max(t,ac.currentTime):ac.currentTime;
 const ping=(f,t0,dur,vol,type='sine')=>{t0=when(t0);const o=ac.createOscillator(),g=ac.createGain();o.type=type;o.frequency.value=f;g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(vol,t0+.005);g.gain.exponentialRampToValueAtTime(.0001,t0+dur);o.connect(g);g.connect(out);o.start(t0);o.stop(t0+dur+.05);};
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
 function padNote(f,t0,dur,vol){t0=when(t0);const o1=ac.createOscillator(),o2=ac.createOscillator(),lp=ac.createBiquadFilter(),g=ac.createGain();o1.type='triangle';o2.type='sine';o1.frequency.value=f;o2.frequency.value=f*1.003;lp.type='lowpass';lp.frequency.value=900;
  g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(vol,t0+dur*.35);g.gain.setValueAtTime(vol,t0+dur*.7);g.gain.linearRampToValueAtTime(0,t0+dur*1.05);o1.connect(lp);o2.connect(lp);lp.connect(g);g.connect(mus);o1.start(t0);o2.start(t0);o1.stop(t0+dur*1.1);o2.stop(t0+dur*1.1);o1.onended=()=>{o1.disconnect();o2.disconnect();lp.disconnect();g.disconnect();};}
 function pluck(f,t0,vol){t0=when(t0);const o=ac.createOscillator(),g=ac.createGain(),lp=ac.createBiquadFilter();o.type=era===1760?'sawtooth':'triangle';o.frequency.value=f;lp.type='lowpass';lp.frequency.setValueAtTime(era===1760?3200:2400,t0);lp.frequency.exponentialRampToValueAtTime(500,t0+.6);
  g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(vol,t0+.006);g.gain.exponentialRampToValueAtTime(.0001,t0+(era===1760?.7:1.1));o.connect(lp);lp.connect(g);g.connect(mus);g.connect(echo);o.start(t0);o.stop(t0+1.2);o.onended=()=>{o.disconnect();lp.disconnect();g.disconnect();};}
 // Danish folk (spillemandsmusik): a fiddle tune over oom-pah-pah (bass on one, chord on two and three) in 3/4, an
 // eight-bar A part played twice and a B part played twice, then a new tune in another key. Today the accompaniment
 // is an accordion; in 1760 a plucked cittern with the fiddle's drone.
 const MAJ=[0,2,4,5,7,9,11],MIN=[0,2,3,5,7,8,10],FOLK_KEYS=[[62,MAJ],[57,MAJ],[55,MAJ],[64,MIN],[62,MAJ],[60,MAJ],[57,MIN]];
 const RHYTHMS=[[2,2,2],[1,1,2,2],[2,1,1,2],[3,1,2],[1,1,1,1,2],[2,2,1,1],[4,2]]; // eighths in a 3/4 bar (6)
 let tune=null,tuneBar=0,keyIx=0;
 function makeTune(){const [root,scale]=FOLK_KEYS[keyIx++%FOLK_KEYS.length],deg=d=>root+12*Math.floor(d/7)+scale[((d%7)+7)%7];
  // chords as scale degrees: I IV V I | I V IV V (A), and vi/IV variants (B); minor keys use i iv v i
  const A=[0,3,4,0,0,4,3,4,0,3,4,0,3,0,4,0],B=[3,3,0,4,5,3,4,0,3,0,5,4,3,0,4,0];
  const part=prog=>{const bars=[];let d=7+Math.floor(Math.random()*3);
   for(let b=0;b<8;b++){const ch=prog[b],tones=[ch,ch+2,ch+4],rh=RHYTHMS[b%4===3?6:Math.floor(Math.random()*6)],notes=[];let at=0;
    for(let k=0;k<rh.length;k++){if(k===0||Math.random()<.35){let best=d,bd=99;for(const tn of tones)for(const o of [7,14]){const c=tn+o;if(Math.abs(c-d)<bd){bd=Math.abs(c-d);best=c;}}d=best;} // chord tone on the beat
     else d+=Math.random()<.5?1:-1;d=Math.max(5,Math.min(16,d));
     if(b%4===3&&k===rh.length-1)d=b===3?(ch===4?11:7):7; // phrase ends: half cadence on the fifth, full on the tonic
     notes.push({at,len:rh[k],m:deg(d)});at+=rh[k];}
    bars.push({chord:[deg(ch),deg(ch+2),deg(ch+4)],bass:deg(ch)-24,notes});}
   return bars;};
  return [...part(A.slice(0,8)),...part(A.slice(8))].slice(0,8).concat(part(B.slice(0,8)));} // 8 bars A, 8 bars B
 function fiddle(f,t0,dur,vol){t0=when(t0);const o=ac.createOscillator(),lfo=ac.createOscillator(),ld=ac.createGain(),lp=ac.createBiquadFilter(),g=ac.createGain();
  o.type='sawtooth';o.frequency.setValueAtTime(f*.985,t0);o.frequency.linearRampToValueAtTime(f,t0+.05);lfo.frequency.value=5.6;ld.gain.setValueAtTime(0,t0);ld.gain.linearRampToValueAtTime(f*.006,t0+Math.min(.25,dur*.6));lfo.connect(ld);ld.connect(o.frequency);
  lp.type='lowpass';lp.frequency.value=era===1760?2300:2800;lp.Q.value=.8;g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(vol,t0+.05);g.gain.setValueAtTime(vol*.85,t0+dur*.8);g.gain.linearRampToValueAtTime(0,t0+dur+.06);
  o.connect(lp);lp.connect(g);g.connect(mus);g.connect(echo);o.start(t0);lfo.start(t0);o.stop(t0+dur+.1);lfo.stop(t0+dur+.1);o.onended=()=>{o.disconnect();lfo.disconnect();ld.disconnect();lp.disconnect();g.disconnect();};}
 function squeeze(f,t0,dur,vol){t0=when(t0);const a=ac.createOscillator(),b=ac.createOscillator(),lp=ac.createBiquadFilter(),g=ac.createGain(); // accordion reeds: two squares a few cents apart
  a.type=b.type='square';a.frequency.value=f;b.frequency.value=f;b.detune.value=7;lp.type='lowpass';lp.frequency.value=1500;g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(vol,t0+.02);g.gain.setValueAtTime(vol,t0+dur*.7);g.gain.linearRampToValueAtTime(0,t0+dur);
  a.connect(lp);b.connect(lp);lp.connect(g);g.connect(mus);a.start(t0);b.start(t0);a.stop(t0+dur+.05);b.stop(t0+dur+.05);a.onended=()=>{a.disconnect();b.disconnect();lp.disconnect();g.disconnect();};}
 function bassNote(f,t0,dur,vol){t0=when(t0);const o=ac.createOscillator(),g=ac.createGain();o.type='triangle';o.frequency.value=f;g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(vol,t0+.01);g.gain.exponentialRampToValueAtTime(.0001,t0+dur);o.connect(g);g.connect(mus);o.start(t0);o.stop(t0+dur+.05);o.onended=()=>{o.disconnect();g.disconnect();};}
 const FOLK_BAR=1.5; // 3/4 at 120 beats a minute
 function scheduleFolk(){const t=ac.currentTime;if(!(musT>t+.05))musT=t+.1;
  while(musT<t+1.6){if(!tune||tuneBar>=32){tune=makeTune();tuneBar=0;}
   const b=tune[[0,1,2,3,4,5,6,7,0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,8,9,10,11,12,13,14,15][tuneBar]],beat=FOLK_BAR/3,e=beat/2,sw=()=>(Math.random()-.5)*.012;
   bassNote(mtof(b.bass),musT,beat*.9,.05);
   for(const k of [1,2]){if(era===1760)b.chord.forEach((m,i)=>pluck(mtof(m-12),musT+k*beat+i*.015,.008));else b.chord.forEach(m=>squeeze(mtof(m-12),musT+k*beat+sw(),beat*.55,.0065));}
   if(era===1760)padNote(mtof(b.bass+12),musT,FOLK_BAR,.008); // the fiddle's drone string
   for(const n of b.notes)fiddle(mtof(n.m),musT+n.at*e+sw(),n.len*e*.92,.02);
   musT+=FOLK_BAR;tuneBar++;}
 }
 let musT=0,bar=0,musicOn=(()=>{try{return localStorage.getItem('cph-music')!=='0';}catch{return true;}})(),lastNote=4;
 function scheduleMusic(){const t=ac.currentTime;if(!(musT>t+.05))musT=t+.1; // also at t=0 (musT starts at 0, and the first melody note's jitter went below zero)
  while(musT<t+1.5){const ch=CHORDS[bar%CHORDS.length];
   if(era!==1760)ch.forEach((m,i)=>padNote(mtof(m),musT,BAR,i===0?.03:.016));else{padNote(mtof(ch[0]-12),musT,BAR,.03);ch.slice(1).forEach((m,i)=>pluck(mtof(m),musT+i*.12,.012));}
   const steps=era===1760?6:8;for(let k=0;k<steps;k++){if(Math.random()<(era===1760?.62:.42)){lastNote=Math.max(0,Math.min(SCALE.length-1,lastNote+Math.round((Math.random()-.5)*4)));pluck(mtof(SCALE[lastNote]),musT+k*BAR/steps+(Math.random()-.5)*.02,era===1760?.018:.022);}}
   musT+=BAR;bar++;}
 }
 let gear=1,bellT=8+Math.random()*15,stepT=0,lastSpeed=0;
 const GEARS=[0,9,17,25,34,99]; // m/s top of each gear
 function update(dt,{enabled,speed=0,mode='car',throttle=0,musicOff=false}){ // musicOff: the car radio is playing
  const t=ac.currentTime,v=Math.abs(speed);out.gain.setTargetAtTime(enabled?.65:0,t,.15);if(!enabled)return;
  const car=mode==='car'&&era!==1760,coach=mode==='car'&&era===1760;
  if(car){while(gear<5&&v>GEARS[gear])gear++;while(gear>1&&v<GEARS[gear-1]-2)gear--;
   const lo=GEARS[gear-1],hi=GEARS[gear],rpm=.25+.75*Math.min(1,(v-lo)/Math.max(1,hi-lo)),f=38+rpm*70;
   e1.frequency.setTargetAtTime(f,t,.06);e2.frequency.setTargetAtTime(f*1.01,t,.06);eLp.frequency.setTargetAtTime(220+rpm*480+throttle*380,t,.08);eG.gain.setTargetAtTime(.014+throttle*.022+rpm*.012,t,.12);} // engine: audible under the music, still a hum rather than a buzz
  else eG.gain.setTargetAtTime(0,t,.1);
  tG.gain.setTargetAtTime(mode==='car'?Math.min(.03,v*.0018):mode==='bike'?Math.min(.012,v*.002):0,t,.1);tBp.frequency.setTargetAtTime(500+v*30,t,.2);
  if(coach&&v>.6){stepT-=dt*Math.min(4.5,v*.8);if(stepT<=0){stepT=1;hoof(.12);setTimeout(()=>hoof(.09),110);}}
  bellT-=dt;if(bellT<=0){bellT=10+Math.random()*25;bell();}
  lastSpeed=v;
  mus.gain.setTargetAtTime(musicOn&&!musicOff?.42:0,t,.8);if(musicOn&&!musicOff)scheduleFolk();
 }
 return {update,horn,bell,music(on){musicOn=on===undefined?!musicOn:!!on;return musicOn;}};
}
