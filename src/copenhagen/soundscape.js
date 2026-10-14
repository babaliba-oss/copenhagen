// Copenhagen soundscape (Web Audio, no files): an engine with gears, tyre roll, a low city bed, the odd
// bicycle bell, and a horn (B). In 1760 the engine becomes hooves on cobbles and the bells stay.
export function createSoundscape(ac,{era=null}={}){
 const out=ac.createGain();out.gain.value=0;out.connect(ac.destination);
 const noiseBuf=(()=>{const b=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate),d=b.getChannelData(0);let last=0;for(let i=0;i<d.length;i++){const w=Math.random()*2-1;last=(last+.02*w)/1.02;d[i]=last*3.5;}return b;})(); // brown noise
 const loop=(buf)=>{const s=ac.createBufferSource();s.buffer=buf;s.loop=true;s.start();return s;};
 // engine: two detuned saws -> low-pass -> gain
 const e1=ac.createOscillator(),e2=ac.createOscillator(),eLp=ac.createBiquadFilter(),eG=ac.createGain();
 e1.type='triangle';e2.type='sawtooth';e2.detune.value=-14;eLp.type='lowpass';eLp.Q.value=1.5; // soft hum under the city, not a buzzeG.gain.value=0;
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
 }
 return {update,horn,bell};
}
