import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {SpatialIndex} from '../src/geo.js';
import {surfaceAt,surfaceDetailAt,settRoughness,rumbleFor,createRumbleState,rumbleAmplitude,rumbleFrequency,RUMBLE} from '../src/road-surface.js';
import {createDriveCameraState,stepDriveCamera,CAMERA_RUMBLE} from '../src/driving-camera.js';

const city=JSON.parse(gunzipSync(readFileSync('public/data/city.pack')));
const world={roads:new SpatialIndex(city.roads.filter(r=>!/Koroke/.test(r.kind))),pavement:new SpatialIndex(city.pavement)};

test('municipal material names map to sett roughness; slabs, concrete block and asphalt stay smooth',()=>{
 assert.equal(settRoughness('Nupukivi'),1);assert.equal(settRoughness('Mukulakivi'),1);assert.equal(settRoughness('Kenttäkivi'),1);
 assert.equal(settRoughness('Noppakivi'),.7);assert.equal(settRoughness('Graniittikivi - R22'),.8);assert.equal(settRoughness('Luonnonkivi'),.8);
 for(const smooth of ['Asfalttibetoni','Betonikivi','Luonnonkivilaatta','Graniittilaatta','Betoni - valettu','Kivituhka','Sora',undefined,null,''])assert.equal(settRoughness(smooth),0,String(smooth));
});

test('surface classification at known mapped points',()=>{
 // Kauppatori: the market square is one mapped 'Aukiot' Nupukivi polygon; the Market Hall strip is Mukulakivi.
 assert.equal(surfaceAt(world,100,280),'setts');assert.equal(surfaceDetailAt(world,100,280).material,'Nupukivi');
 assert.equal(surfaceAt(world,138,308.8),'setts');assert.equal(surfaceDetailAt(world,138,308.8).material,'Mukulakivi');
 // Senate Square: Nupukivi field with Noppakivi 10 m squares, ring road Nupukivi.
 assert.equal(surfaceAt(world,19,55.5),'setts');assert.equal(surfaceDetailAt(world,19,55.5).material,'Noppakivi');
 assert.equal(surfaceAt(world,-20,70),'setts');assert.equal(surfaceAt(world,4,105),'setts');
 assert.equal(surfaceDetailAt(world,-20,70).name,'Senaatintori');
 // Sofiankatu, Aleksanterinkatu, Pohjoisesplanadi and Eteläranta sett carriageways.
 assert.equal(surfaceAt(world,-5.3,156.8),'setts');assert.equal(surfaceAt(world,13.4,113.8),'setts');assert.equal(surfaceAt(world,66,243),'setts');assert.equal(surfaceAt(world,15.5,400.3),'setts');
 // Laivasillankatu: the register maps the Olympia terminal half as Nupukivi and the northern half as asphalt.
 assert.equal(surfaceAt(world,180.5,1131.8),'setts');assert.equal(surfaceDetailAt(world,180.5,1131.8).material,'Nupukivi');
 assert.equal(surfaceAt(world,223.8,970.2),'asphalt');
 // Mannerheimintie: asphalt carriageway, by Lasipalatsi and in Töölö.
 assert.equal(surfaceAt(world,-565.94,264.38),'asphalt');assert.equal(surfaceAt(world,-1154.6,-637.4),'asphalt');
 assert.equal(surfaceDetailAt(world,-1154.6,-637.4).name,'Mannerheimintie');
 // Asphalt pavement, water and nothing.
 assert.equal(surfaceAt(world,20.41,294.37),'pavement');assert.equal(surfaceDetailAt(world,20.41,294.37).material,'Asfalttibetoni');assert.equal(surfaceAt(world,100,330),'off');assert.equal(surfaceAt({},0,0),'off');
 for(const r of [surfaceDetailAt(world,100,280),surfaceDetailAt(world,-565.94,264.38)])assert.equal(r.source,'measured');
});

test('surface lookup honours an interpreted settAreas fallback only off mapped ground',()=>{
 const areas=new SpatialIndex([{rings:[[[0,0],[10,0],[10,10],[0,10]]],roughness:.5,name:'Test plaza'}]);
 const w={...world,settAreas:areas};
 assert.equal(surfaceDetailAt(w,5,5).source,'interpreted');assert.equal(surfaceDetailAt(w,5,5).roughness,.5);
 assert.equal(surfaceAt(w,100,280),'setts');assert.equal(surfaceDetailAt(w,100,280).source,'measured');
});

const run=(surface,speed,seconds,dt,state=createRumbleState(7),roughness=1)=>{const out=[];for(let t=0;t<seconds;t+=dt)out.push(rumbleFor(surface,speed,dt,state,roughness));return out;};
const peak=samples=>Math.max(...samples.map(s=>Math.abs(s.bob)));
const std=values=>{const m=values.reduce((a,b)=>a+b,0)/values.length;return Math.sqrt(values.reduce((a,v)=>a+(v-m)**2,0)/values.length);};
const crossingsPerSecond=(samples,dt)=>{let n=0;for(let i=1;i<samples.length;i++)if((samples[i].bob>=0)!==(samples[i-1].bob>=0))n++;return n/2/(samples.length*dt);};

test('body bob scales with speed: ~1.5 cm peak at 20 km/h, ~3 cm at 50 km/h, 9-12 mm standard deviation at 30 km/h, nothing at rest',()=>{
 assert.equal(rumbleAmplitude(0),0);
 assert.ok(rumbleAmplitude(20/3.6)>=.015&&rumbleAmplitude(20/3.6)<=.021);
 assert.ok(rumbleAmplitude(50/3.6)>=.034&&rumbleAmplitude(50/3.6)<=.04);
 assert.equal(rumbleAmplitude(140/3.6),RUMBLE.maxAmplitude);
 const slow=run('setts',20/3.6,3,1/120).slice(60),fast=run('setts',50/3.6,3,1/120).slice(60),mid=run('setts',30/3.6,4,1/120).slice(120);
 assert.ok(peak(slow)>=.01&&peak(slow)<=.02,`20 km/h peak ${peak(slow)}`);
 assert.ok(peak(fast)>=.022&&peak(fast)<=.038,`50 km/h peak ${peak(fast)}`);
 const bodyStd=std(mid.map(s=>s.bob));
 assert.ok(bodyStd>=.008&&bodyStd<=.013,`body std at 30 km/h ${bodyStd}`);
 const rest=run('setts',0,2,1/60);assert.ok(rest.every(s=>s.bob===0&&s.roll===0&&s.cameraBob===0),'parked on setts: still');
});

test('camera sway is a gentle third of the body: 3-5 mm standard deviation at 30 km/h, nothing above ~6 Hz',()=>{
 const mid=run('setts',30/3.6,6,1/240).slice(240),fast=run('setts',50/3.6,6,1/240).slice(240);
 const camStd=std(mid.map(s=>s.cameraBob)),bodyStd=std(mid.map(s=>s.bob));
 assert.ok(camStd>=.0028&&camStd<=.0052,`camera std at 30 km/h ${camStd}`);
 assert.ok(camStd<bodyStd*.45,`camera ${camStd} vs body ${bodyStd}`);
 for(const [label,samples] of [['30',mid],['50',fast]]){
  const f=crossingsPerSecond(samples.map(s=>s.cameraBob),1/240);
  assert.ok(f<6,`${label} km/h camera crossings ~${f} Hz`);
  // Kink bound of a 6 Hz sinusoid at the camera's own peak: no higher harmonics ride on the sway.
  const a=Math.max(...samples.map(s=>Math.abs(s.cameraBob))),kink=a*(2*Math.PI*6/240)**2*1.2;
  let worst=0;for(let i=2;i<samples.length;i++)worst=Math.max(worst,Math.abs(samples[i].cameraBob-2*samples[i-1].cameraBob+samples[i-2].cameraBob));
  assert.ok(worst<=kink,`${label} km/h camera second difference ${worst} > ${kink}`);
  const rollPeak=Math.max(...samples.map(s=>Math.abs(s.cameraRoll)));
  assert.ok(rollPeak>0&&rollPeak<=.1*Math.PI/180,`camera roll ${rollPeak*180/Math.PI} deg`);
 }
 assert.ok(run('asphalt',30/3.6,2,1/60).every(s=>s.cameraBob===0&&s.cameraRoll===0));
});

test('body frequency rises from ~8 Hz to ~12 Hz with speed and the tilt jitter stays within ±0.3°',()=>{
 assert.equal(rumbleFrequency(0),8);assert.equal(rumbleFrequency(50/3.6),12);assert.equal(rumbleFrequency(100/3.6),12);
 const slow=run('setts',10/3.6,6,1/240).slice(240),fast=run('setts',50/3.6,6,1/240).slice(240);
 const fs=crossingsPerSecond(slow,1/240),ff=crossingsPerSecond(fast,1/240);
 assert.ok(fs>7&&fs<10.5,`10 km/h ~${fs} Hz`);assert.ok(ff>10&&ff<14,`50 km/h ~${ff} Hz`);assert.ok(ff>fs+1.5,'faster is busier');
 const tilt=.3*Math.PI/180;
 for(const s of fast){assert.ok(Math.abs(s.roll)<=tilt+1e-9&&Math.abs(s.pitch)<=tilt+1e-9);}
 assert.ok(Math.max(...fast.map(s=>Math.abs(s.roll)))>tilt*.4,'roll jitter is used');
});

test('body rumble is smooth: no frame-to-frame jump or kink beyond an 8-12 Hz sinusoid at 60 and 120 Hz',()=>{
 for(const dt of [1/60,1/120]){
  const samples=run('setts',30/3.6,4,dt),a=rumbleAmplitude(30/3.6),w=2*Math.PI*rumbleFrequency(30/3.6);
  const bound=a*w*dt*1.3+1e-6,kink=a*(w*dt)**2*1.6+1e-6;
  let worst=0,worstKink=0;
  for(let i=1;i<samples.length;i++)worst=Math.max(worst,Math.abs(samples[i].bob-samples[i-1].bob));
  for(let i=2;i<samples.length;i++)worstKink=Math.max(worstKink,Math.abs(samples[i].bob-2*samples[i-1].bob+samples[i-2].bob));
  assert.ok(worst<=bound,`${Math.round(1/dt)} Hz: worst step ${worst} > ${bound}`);
  assert.ok(worstKink<=kink,`${Math.round(1/dt)} Hz: worst second difference ${worstKink} > ${kink} (higher harmonics)`);
 }
 // The low-pass is frame-rate independent: 30 Hz and 120 Hz runs agree on the envelope.
 const coarse=run('setts',30/3.6,3,1/30).slice(30),fine=run('setts',30/3.6,3,1/120).slice(120);
 assert.ok(Math.abs(peak(coarse)-peak(fine))<peak(fine)*.25,`peaks ${peak(coarse)} vs ${peak(fine)}`);
});

test('rumble is deterministic for a seed and zero on asphalt, pavement and off-road',()=>{
 const a=run('setts',30/3.6,2,1/60,createRumbleState(3)),b=run('setts',30/3.6,2,1/60,createRumbleState(3)),c=run('setts',30/3.6,2,1/60,createRumbleState(4));
 assert.deepEqual(a.map(s=>s.bob),b.map(s=>s.bob));assert.notDeepEqual(a.map(s=>s.bob),c.map(s=>s.bob));
 for(const surface of ['asphalt','pavement','off']){const s=run(surface,40/3.6,2,1/60);assert.ok(s.every(v=>v.bob===0&&v.roll===0&&v.pitch===0&&v.intensity===0),surface);}
});

test('entering and leaving setts eases without a pop, and Noppakivi rumbles less than Nupukivi',()=>{
 const state=createRumbleState(11),dt=1/60,trace=[];
 for(let t=0;t<1;t+=dt)trace.push(rumbleFor('asphalt',30/3.6,dt,state));
 for(let t=0;t<1.5;t+=dt)trace.push(rumbleFor('setts',30/3.6,dt,state));
 for(let t=0;t<1.5;t+=dt)trace.push(rumbleFor('asphalt',30/3.6,dt,state));
 // A boundary crossing may not step harder than the rumble's own steepest frame at this speed.
 const bound=rumbleAmplitude(30/3.6)*2*Math.PI*rumbleFrequency(30/3.6)*dt*1.3;
 let worst=0;for(let i=1;i<trace.length;i++)worst=Math.max(worst,Math.abs(trace[i].bob-trace[i-1].bob));
 assert.ok(worst<=bound,`boundary step ${worst} > ${bound}`);
 assert.ok(trace[60].intensity<.2&&trace[90].intensity>.95,'eases in within half a second');
 assert.ok(trace[150+90].intensity<.05&&trace.at(-1).bob===0,'eases out and settles to exactly zero');
 const fine=run('setts',30/3.6,3,1/60,createRumbleState(5),.7).slice(60),coarse=run('setts',30/3.6,3,1/60,createRumbleState(5),1).slice(60);
 assert.ok(peak(fine)<peak(coarse)*.75&&peak(fine)>peak(coarse)*.6);
});

test('drive camera returns the cobble sway as a separate rumble field, leaving impact shake alone',()=>{
 const car={x:0,z:0,heading:0,speed:30/3.6,steer:0};
 const still=stepDriveCamera(createDriveCameraState(),car,1/60);
 assert.deepEqual(still.rumble,[0,0,0]);assert.deepEqual(still.offset,[0,0,0]);
 const cam=stepDriveCamera(createDriveCameraState(),car,1/60,{rumble:{bob:.04,roll:.006}});
 assert.deepEqual(cam.offset,[0,0,0],'no impact shake from rumble');
 assert.equal(cam.rumble[0],0);assert.equal(cam.rumble[2],0);assert.ok(Math.abs(cam.rumble[1]-.04*CAMERA_RUMBLE.bob)<1e-9);
 assert.ok(Math.abs(cam.roll-still.roll-.006*CAMERA_RUMBLE.roll)<1e-9);
 const follow=stepDriveCamera(createDriveCameraState(),car,1/60,{drive:false,rumble:{bob:.04,roll:.006}});
 assert.deepEqual(follow.rumble,[0,0,0],'overview cameras do not rumble');
});
