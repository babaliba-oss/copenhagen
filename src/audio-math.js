// Pure soundscape maths: no WebAudio, no DOM. Everything here is unit tested
// (tests/audio.test.mjs); src/audio.js only turns these numbers into node
// parameters. Speeds are world m/s (PLAYER_MAX_SPEED is 140 km/h).
import {WORLD_EXTENT,clipLinesFor,onClipLine} from './geo.js';
export const MAX_SPEED=140/3.6;
export const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export const dbToGain=db=>Math.pow(10,db/20);
// Sane defaults: the master sits below unity so the limiter rarely works hard.
export const BUS_DEFAULTS=Object.freeze({master:.7,engine:.85,vehicles:.8,ambience:.75,fx:.9});
export const BUS_NAMES=Object.freeze(['engine','vehicles','ambience','fx']);

// Effective bus gains. Disabled or inactive (paused, map open, busted) ducks
// the master to silence; individual bus faders are preserved for the HUD.
export function mixerGains({master=BUS_DEFAULTS.master,buses={},enabled=true,active=true}={}){
 const out={master:enabled&&active?clamp(master,0,1):0};
 for(const name of BUS_NAMES)out[name]=clamp(buses[name]??BUS_DEFAULTS[name],0,1);
 return out;
}

// Municipal surface materials (Finnish register strings) to rolling classes.
// Setts follow scripts/prepare-world.mjs, which paints /Nupu|Noppa|kivi/ roads
// as stone carriageways, and market-street-surface.js (/Nupu|Noppa/).
export function surfaceKind(road,pavement){
 const p=road||pavement;if(!p)return 'grass';
 const m=p.material||'';
 if(/Nupu|Noppa|Mukula|Kenttä/.test(m))return 'setts';
 if(/kivi|laatta|Liuske/i.test(m))return 'stone';
 if(/Sora|Kivituhka|Murske|Hiekka|Makadam/.test(m))return 'gravel';
 if(/^Puu/.test(m))return 'wood';
 return 'asphalt';
}
export const SURFACE_PROFILES=Object.freeze({
 asphalt:{rumble:.22,hiss:1,pulse:0,cutoff:900,pitch:.3},
 setts:{rumble:1,hiss:.5,pulse:1,cutoff:380,pitch:.19},
 stone:{rumble:.6,hiss:.7,pulse:.5,cutoff:560,pitch:.45},
 gravel:{rumble:.7,hiss:1.35,pulse:.2,cutoff:1900,pitch:.08},
 wood:{rumble:.85,hiss:.45,pulse:.7,cutoff:460,pitch:.6},
 grass:{rumble:.55,hiss:.85,pulse:.2,cutoff:650,pitch:.25},
});
// Tyre/road bed for a surface at a speed. `pulseRate` is the sett-crossing
// rate (wheel speed / stone pitch); `pulseDepth` how much it modulates rumble.
export function rollingMix(kind,speed){
 const p=SURFACE_PROFILES[kind]||SURFACE_PROFILES.asphalt,v=Math.abs(speed),n=clamp(v/MAX_SPEED,0,1);
 const level=Math.pow(n,.6);
 return {
  rumble:p.rumble*level*.55,
  hiss:p.hiss*(n*n*.42+level*.07),
  pulseRate:p.pulse?clamp(v/p.pitch,0,70):0,
  pulseDepth:p.pulse*clamp(v/4,0,1)*.8,
  cutoff:p.cutoff+v*35,
 };
}

// Electric drivetrain: the player car is an EV, so instead of a combustion RPM we map wheel speed to motor hum
// and inverter/reduction-gear whine, and throttle/regen to load. Below ~30 km/h
// EVs emit a pedestrian warning tone (AVAS); we add a gentle one.
export function engineModel(speed,{throttle=false,reverse=false,brake=false}={},powered=true){
 const v=Math.abs(speed),n=clamp(v/MAX_SPEED,0,1);
 const driving=(throttle||reverse)&&powered&&!brake;
 const regen=!driving&&v>2&&(brake||!throttle);
 const load=driving?.6+.4*(1-n):regen?.35:0;
 return {
  hum:36+v*2.2,
  whine:260+v*92,
  load,
  avas:v>.25?clamp(1-(v-.25)/7.5,0,1):0,
  idle:powered?.05:0,
  volume:(powered?.05:0)+n*.55+load*.18,
 };
}

// Tyre squeal from the physics model's actual lateral acceleration (physics.js
// heading rate times speed), handbrake slides and hard braking lock-ups.
export function tyreSqueal({speed,steer=0,brake=false,decel=0}){
 const v=Math.abs(speed);
 const lateral=Math.abs(steer)*v*v/2.8*.43/(1+v*.055)*(brake?1.5:1);
 const slide=clamp((lateral-(brake?4:7))/7,0,1);
 const lockup=brake&&v>3?clamp((v-3)/10,0,1)*.8:0;
 const skid=decel>14&&v>3?clamp((decel-14)/20,0,1)*.5:0;
 const amount=clamp(Math.max(slide,lockup,skid),0,1);
 return {amount,frequency:980+v*32+amount*260};
}

// Inverse-distance attenuation with a soft outer edge so sources never pop.
export function attenuation(distance,{ref=12,max=220,rolloff=1.6}={}){
 if(!(distance<max))return 0;
 const g=ref/(ref+rolloff*Math.max(0,distance-ref)),edge=clamp((max-distance)/(max*.25),0,1);
 return g*edge;
}
// Stereo pan relative to the car. rotation.y=heading: forward is (-sin h,-cos h),
// right is (cos h,-sin h). Sources straight ahead/behind are centred.
export function stereoPan(listener,heading,x,z){
 const dx=x-listener.x,dz=z-listener.z,d=Math.hypot(dx,dz);if(d<1e-6)return 0;
 return clamp((dx*Math.cos(heading)-dz*Math.sin(heading))/d*.85,-1,1);
}

// Shoreline segments as a flat [ax,az,bx,bz,...] array, dropping edges that
// lie on the clipped world square (those are data boundaries, not shores).
export function shoreSegments(water,extent=WORLD_EXTENT){
 const out=[],lines=clipLinesFor(extent);
 for(const w of water||[])for(const ring of w.rings||[])for(let i=0;i<ring.length;i++){
  const a=ring[i],b=ring[(i+1)%ring.length];if(onClipLine(a,b,lines,1))continue;out.push(a[0],a[1],b[0],b[1]);
 }
 return Float32Array.from(out);
}
export function nearestSegmentDistance(x,z,segments){
 let best=Infinity;
 for(let i=0;i<segments.length;i+=4){
  const ax=segments[i],az=segments[i+1],dx=segments[i+2]-ax,dz=segments[i+3]-az,l=dx*dx+dz*dz;
  const t=l?clamp(((x-ax)*dx+(z-az)*dz)/l,0,1):0,ex=x-ax-t*dx,ez=z-az-t*dz,d=ex*ex+ez*ez;
  if(d<best)best=d;
 }
 return Math.sqrt(best);
}

// Ambience levels by proximity: sea wash and gulls by shore distance, market
// chatter by distance to the stall field, city hum everywhere (quieter at sea).
export function ambienceMix({seaDistance=Infinity,marketDistance=Infinity,speed=0,rain=0}={}){
 const sea=clamp(1-seaDistance/260,0,1),market=clamp(1-(marketDistance-18)/70,0,1),n=clamp(Math.abs(speed)/MAX_SPEED,0,1);
 return {
  sea:Math.pow(sea,1.4)*.9,
  wind:.18+sea*.25+n*.5,
  gulls:sea,
  market:market*(1-n*.6),
  city:.5+(1-sea)*.3-rain*.15,
  rain:clamp(rain,0,1),
 };
}
// Gull cries happen at random when near water; chance per second.
export function gullRatePerSecond(seaLevel){return seaLevel>.05?.08+seaLevel*.45:0;}

// Positional voice assignment: nearest `slots` entities keep a voice; the
// returned list is sorted by distance and limited to audible range.
export function nearestSources(entities,listener,slots,range){
 return entities.map(e=>({entity:e,distance:Math.hypot(e.x-listener.x,e.z-listener.z)})).filter(s=>s.distance<range).sort((a,b)=>a.distance-b.distance).slice(0,slots);
}
// Trams ring their bell when leaving a stop: `wait` was positive and is now 0.
export function tramDepartures(trams,previousWaiting){
 const departed=[],now=new Map();
 for(const t of trams){const waiting=t.wait>0;now.set(t.id,waiting);if(previousWaiting.get(t.id)&&!waiting)departed.push(t);}
 return {departed,waiting:now};
}
// Impact loudness from the damage the ImpactSystem applied (amount ∝ speed²).
export function impactLevel(damageDelta){return damageDelta>0?clamp(.35+damageDelta*6,0,1):0;}
