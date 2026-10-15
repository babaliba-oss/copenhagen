// Ground surface classification and the cobblestone rumble it drives.
//
// Classification is DATA-SIDE: every road and pavement polygon in
// public/data/city.pack carries the municipal register's `material` field
// (Nupukivi = large granite setts, Noppakivi = small setts, Mukulakivi =
// rounded cobbles, Kenttäkivi = fieldstone, Graniittikivi/Luonnonkivi = granite
// / natural stone, Asfalttibetoni = asphalt, Betonikivi = concrete block,
// *laatta = slabs). The renderer paints the same `/Nupu|Noppa|kivi/` carriageways
// as setts (scripts/prepare-world.mjs, src/main.js ground shader, kauppatori.js,
// cathedral.js), so what you see rumbling is what the register maps.
//
// Measured areas (all from the register, nothing interpreted):
//  - Kauppatori: 'Aukiot' Nupukivi (main square), Noppakivi, Mukulakivi strip
//    by the Market Hall; Eteläranta/Pohjoisesplanadi/Kauppatori carriageways
//    Nupukivi.
//  - Senate Square: one 'Senaatintori' Aukiot Nupukivi field with Noppakivi
//    10 m squares (measured); the ring road 'Senaatintori' Ajorata Nupukivi;
//    the outer Betonikivi band stays smooth. The monument plinth is unmapped.
//  - Sofiankatu (Nupukivi + Kenttäkivi), Aleksanterinkatu, Unioninkatu,
//    Laivasillankatu at the Olympia terminal (Nupukivi; its northern half is
//    asphalt), southern Mannerheimintie (Erottaja–Aleksanterinkatu) etc.
// Not rumbled: Betonikivi (concrete block), slabs (*laatta), gravel
// (Sora/Kivituhka) and Koroke tram islands (excluded from world.roads).
// An optional `world.settAreas` SpatialIndex of {rings,roughness} polygons is
// honoured as an interpreted fallback should a mapped gap ever need one.

// material pattern -> roughness (1 = full rumble). Order matters: slabs
// (Luonnonkivilaatta, Graniittilaatta) are excluded before the stone families.
export const SETT_MATERIALS=[
 [/laatta/i,0],
 [/Mukulakivi/i,1],
 [/Kenttäkivi/i,1],
 [/Nupukivi/i,1],
 [/Graniittikivi/i,.8],
 [/Luonnonkivi/i,.8],
 [/Noppakivi/i,.7],
 [/Nurmikivi/i,.7],
];
export function settRoughness(material){
 if(!material)return 0;
 for(const [pattern,roughness] of SETT_MATERIALS)if(pattern.test(material))return roughness;
 return 0;
}
const describe=(p,surface,roughness,source)=>({surface,roughness,material:p?.material??null,name:p?.name??null,kind:p?.kind??null,source});
// Full record: {surface,roughness,material,name,kind,source}. Roads win over
// pavement where polygons overlap at kerbs; Koroke islands are not in world.roads.
export function surfaceDetailAt(world,x,z){
 const road=world?.roads?.at(x,z);
 if(road){const r=settRoughness(road.material);return describe(road,r?'setts':'asphalt',r,'measured');}
 const pavement=world?.pavement?.at(x,z);
 if(pavement){const r=settRoughness(pavement.material);return describe(pavement,r?'setts':'pavement',r,'measured');}
 const area=world?.settAreas?.at(x,z);
 if(area)return describe(area,'setts',area.roughness??1,'interpreted');
 return describe(null,'off',0,'measured');
}
export function surfaceAt(world,x,z){return surfaceDetailAt(world,x,z).surface;}

// ---- Rumble ---------------------------------------------------------------
// Two signals, deterministic for a given seed and step sequence:
//  - BODY (bob/roll/pitch): the visible car jiggle that sells the cobbles. A
//    pseudo-random bump train at 8 Hz crawling to 12 Hz at 50 km/h plus a
//    slower 0.37 f lurch, low-passed at 24 Hz so there is no per-frame edge.
//    Standard deviation of the bob at 30 km/h on Nupukivi ~16-18 mm.
//  - CAMERA (cameraBob/cameraRoll): what the player's eye rides on. User
//    feedback (Oct 2026): the vibrating camera "hurts the eyes", so the camera
//    gets its own gentle sway built only from the lurch components (0.37 f and
//    0.21 f, i.e. 1.7-4.4 Hz) and low-passed at 5 Hz: no content above ~6 Hz,
//    standard deviation ~5-7 mm at 30 km/h (about a third of the body's).
// Intensity eases in/out over ~0.1 s at surface boundaries so entering or
// leaving setts never pops; everything is exactly zero on asphalt.
export const RUMBLE={maxAmplitude:.04,minHz:8,maxHz:12,tilt:.3*Math.PI/180,easeRate:9,bodyLowpassHz:24,cameraLowpassHz:5,camera:.42,cameraTilt:.3};
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const hash=(k,seed)=>{const s=Math.sin(k*12.9898+seed*78.233)*43758.5453;return s-Math.floor(s);};
const smooth=t=>t*t*(3-2*t);
// Per-half-cycle random height, smoothstep-blended between neighbours: each
// stone edge hits with its own force, but nothing steps.
function envelope(phase,seed,lo=.6){const k=Math.floor(phase/Math.PI),t=smooth(phase/Math.PI-k);return lo+(1-lo)*(hash(k,seed)*(1-t)+hash(k+1,seed)*t);}
// Raw (pre-filter) body bump amplitude in metres: 3 cm at 20 km/h, ~4.1 cm at 30, ~6.4 cm at 50, capped 6.6 cm.
export function rumbleAmplitude(speed){
 const kmh=Math.abs(speed)*3.6;
 return Math.min(RUMBLE.maxAmplitude,kmh<20?.018*(kmh/20):.018+(kmh-20)*(.02/30)); // gentler: the full rumble read as the car shaking
}
export function rumbleFrequency(speed){return RUMBLE.minHz+(RUMBLE.maxHz-RUMBLE.minHz)*clamp(Math.abs(speed)*3.6/50,0,1);}
export function createRumbleState(seed=1){return {seed,intensity:0,phase:0,bob:0,roll:0,pitch:0,cameraBob:0,cameraRoll:0,bobVel:0,rollVel:0,pitchVel:0,cameraBobVel:0,cameraRollVel:0,surface:'off'};}
// Critically damped second-order low-pass, sub-stepped so 30 Hz and 120 Hz
// frames filter identically; snaps to exactly zero once the rumble is over.
function lowpass(state,key,target,dt,hz){
 const w=2*Math.PI*hz,steps=Math.max(1,Math.ceil(dt/(1/240))),h=dt/steps,vel=key+'Vel';
 let y=state[key],v=state[vel];
 for(let i=0;i<steps;i++){v+=(w*w*(target-y)-2*w*v)*h;y+=v*h;}
 if(target===0&&Math.abs(y)<1e-5&&Math.abs(v)<1e-3){y=0;v=0;}
 state[key]=y;state[vel]=v;return y;
}
// surface: result of surfaceAt(); roughness scales the target intensity (small
// Noppakivi setts rumble less than Nupukivi or cobbles).
export function rumbleFor(surface,speed,dt,state,roughness=1){
 dt=clamp(Number.isFinite(dt)?dt:0,0,.1);
 const target=surface==='setts'?clamp(roughness,0,1):0;
 state.intensity+=(target-state.intensity)*(1-Math.exp(-dt*RUMBLE.easeRate));
 if(state.intensity<1e-4&&target===0)state.intensity=0;
 state.surface=surface;
 const amplitude=rumbleAmplitude(speed),frequency=rumbleFrequency(speed);
 if(state.intensity>0&&amplitude>0)state.phase+=2*Math.PI*frequency*dt;
 const I=state.intensity*amplitude,p=state.phase,seed=state.seed;
 // Body: main bump train plus a slower lurch (0.37 f) so the bob never reads as a pure sine.
 const lurch=envelope(p*.37,seed+1)*Math.sin(p*.37+1.3),sway=envelope(p*.21,seed+4)*Math.sin(p*.21+.4);
 const rawBob=I*(.8*envelope(p,seed)*Math.sin(p)+.25*lurch);
 const tilt=state.intensity*RUMBLE.tilt*clamp(amplitude/.04,0,1);
 const rawRoll=tilt*envelope(p*.53,seed+2,.4)*Math.sin(p*.53+.7),rawPitch=tilt*envelope(p*.71,seed+3,.4)*Math.sin(p*.71+2.1);
 const bob=lowpass(state,'bob',rawBob,dt,RUMBLE.bodyLowpassHz),roll=lowpass(state,'roll',rawRoll,dt,RUMBLE.bodyLowpassHz),pitch=lowpass(state,'pitch',rawPitch,dt,RUMBLE.bodyLowpassHz);
 // Camera: lurch and sway only (1.7-4.4 Hz), then a 5 Hz low-pass. Never the bump train.
 const cameraBob=lowpass(state,'cameraBob',I*RUMBLE.camera*(.7*lurch+.5*sway),dt,RUMBLE.cameraLowpassHz);
 const cameraRoll=lowpass(state,'cameraRoll',tilt*RUMBLE.cameraTilt*envelope(p*.29,seed+5,.4)*Math.sin(p*.29+2.6),dt,RUMBLE.cameraLowpassHz);
 return {bob,roll,pitch,cameraBob,cameraRoll,intensity:state.intensity,amplitude,frequency};
}
