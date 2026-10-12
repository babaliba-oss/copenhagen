import * as THREE from 'three';
import {SUN_OFFSET,SKY_PALETTE,LIGHTING,FOG_COLOR} from './sky.js';
import {GRADE_DEFAULTS} from './post.js';

// Time-of-day and weather "looks". Every preset describes the whole image at once: sky dome
// palette and cloud cover, sun/hemisphere light, fog, water tint, post exposure and grade,
// rain and road wetness. Switching looks blends every value over a couple of seconds.
//
// Shared weather uniforms for other shaders (the street-surface owner can hook wet asphalt):
//   import {WEATHER_UNIFORMS} from './weather.js';
//   material.onBeforeCompile = s => { s.uniforms.uWetness = WEATHER_UNIFORMS.wetness; ... }
// wetness and rain are 0..1 and already smoothed; they never need per-frame copying.
export const WEATHER_UNIFORMS=Object.freeze({wetness:{value:0},rain:{value:0},night:{value:0}}); // night: 0..1, street lamps and lit windows

const midday={
 label:'Midday',
 sky:{zenith:'#2b64bd',mid:'#6d9dd6',horizon:SKY_PALETTE.horizon,sunGlow:SKY_PALETTE.sunGlow,cloudLit:SKY_PALETTE.cloudLit,cloudShade:SKY_PALETTE.cloudShade,coverage:.5,sunDisc:1},
 sunOffset:[...SUN_OFFSET],sunColor:LIGHTING.sunColor,sunIntensity:LIGHTING.sunIntensity,
 hemiSky:LIGHTING.hemiSky,hemiGround:LIGHTING.hemiGround,hemiIntensity:LIGHTING.hemiIntensity,
 fog:{color:FOG_COLOR,near:330,far:850},
 sea:{deep:'#28332f',shore:'#434a42',sunColor:'#fff1d6'},
 grade:{...GRADE_DEFAULTS},
 wetness:0,rain:0,
};
// Low north-western sun (~16 deg), long shadows, warm light against a cool shaded side.
const golden={
 label:'Golden evening',
 sky:{zenith:'#4d7cb7',mid:'#9ab2cf',horizon:'#f0cfae',sunGlow:'#ffd9a0',cloudLit:'#ffe3c4',cloudShade:'#9a8fa0',coverage:.56,sunDisc:1},
 sunOffset:[-208,118,-250],sunColor:'#ffc37a',sunIntensity:2.0,
 hemiSky:'#c4d2e6',hemiGround:'#746a5e',hemiIntensity:1.7,
 fog:{color:'#f0cfae',near:280,far:800},
 sea:{deep:'#2c3230',shore:'#4a4640',sunColor:'#ffd9a0'},
 grade:{...GRADE_DEFAULTS,exposure:1.0,tint:[1.03,1,.96],lift:[.02,.014,.02],saturation:1.04,bloomStrength:.3,vignette:.26},
 wetness:0,rain:0,
};
// June white night: the sun skims the northern horizon; dim blue-pink dusk, nothing is dark.
const whitenight={
 label:'White night',
 sky:{zenith:'#223a62',mid:'#4f6a99',horizon:'#e3b7b0',sunGlow:'#ffc9b0',cloudLit:'#d7b4b8',cloudShade:'#5e5d7c',coverage:.6,sunDisc:.6},
 sunOffset:[-59,42,-338],sunColor:'#ffb48c',sunIntensity:1.3,
 hemiSky:'#a9bbda',hemiGround:'#55575f',hemiIntensity:1.7,
 fog:{color:'#e3b7b0',near:260,far:780},
 sea:{deep:'#1f2630',shore:'#3b3a44',sunColor:'#ffc9b0'},
 grade:{...GRADE_DEFAULTS,exposure:.9,tint:[.98,.97,1.06],lift:[.02,.02,.05],saturation:.9,contrast:1.0,bloomStrength:.3,vignette:.3},
 wetness:0,rain:0,
};
const overcast={
 label:'Overcast',
 sky:{zenith:'#8d979f',mid:'#aab3ba',horizon:'#c7cdd2',sunGlow:'#d8dde1',cloudLit:'#d7dcdf',cloudShade:'#8d969d',coverage:.05,sunDisc:0},
 sunOffset:[-120,300,120],sunColor:'#e9edf1',sunIntensity:.55,
 hemiSky:'#cfd6dc',hemiGround:'#747873',hemiIntensity:1.55,
 fog:{color:'#c7cdd2',near:230,far:760},
 sea:{deep:'#2b3233',shore:'#454a48',sunColor:'#d8dde1'},
 grade:{...GRADE_DEFAULTS,exposure:1.0,tint:[.99,1,1.02],lift:[.02,.022,.03],saturation:.9,contrast:1.0,bloomStrength:.12,bloomThreshold:1.2,vignette:.2,aoStrength:.85},
 wetness:0,rain:0,
};
const rain={
 label:'Rain',
 sky:{zenith:'#6a737a',mid:'#8c949a',horizon:'#aab1b6',sunGlow:'#b6bcc0',cloudLit:'#b8bfc4',cloudShade:'#6c747b',coverage:.02,sunDisc:0},
 sunOffset:[-120,300,120],sunColor:'#dfe4e8',sunIntensity:.4,
 hemiSky:'#b7bfc6',hemiGround:'#5f6361',hemiIntensity:1.35,
 fog:{color:'#aab1b6',near:110,far:560},
 sea:{deep:'#262c2e',shore:'#3d4241',sunColor:'#b6bcc0'},
 grade:{...GRADE_DEFAULTS,exposure:.95,tint:[.98,1,1.03],lift:[.025,.028,.035],saturation:.84,contrast:1.0,bloomStrength:.1,bloomThreshold:1.2,vignette:.24,haze:.05,hazeColor:[.66,.7,.74],aoStrength:.85},
 wetness:1,rain:1,
};
// Copenhagen winter evening: deep blue sky, moonlit roofs, sodium and LED street lamps on wires and masts.
// Kept readable on purpose: the hemisphere stays high enough that streets and facades are never black.
const night={
 label:'Night',
 sky:{zenith:'#070d1c',mid:'#14213b',horizon:'#3a3f55',sunGlow:'#6a7290',cloudLit:'#3d4560',cloudShade:'#121828',coverage:.45,sunDisc:.15},
 sunOffset:[160,260,-120],sunColor:'#9fb3db',sunIntensity:.32,
 hemiSky:'#5b6d99',hemiGround:'#3a342e',hemiIntensity:.95,
 fog:{color:'#1d2438',near:170,far:700},
 sea:{deep:'#0b1018',shore:'#1d2128',sunColor:'#ffcf8a'},
 grade:{...GRADE_DEFAULTS,exposure:1.15,tint:[.97,.98,1.06],lift:[.02,.024,.045],saturation:.92,contrast:1.04,bloomStrength:.55,bloomThreshold:.85,vignette:.32},
 wetness:.25,rain:0,night:1,
};
export const LOOKS=Object.freeze({midday,golden,whitenight,overcast,rain,night});
export const LOOK_ORDER=Object.freeze(['midday','golden','whitenight','night','overcast','rain']);

// Rain: one draw call of short line segments falling through a box that wraps around the camera.
const RAIN_COUNT=2600,RAIN_BOX=new THREE.Vector3(44,26,44);
const RAIN_VERTEX=/* glsl */`
attribute vec3 aSeed;
uniform float uTime;
uniform vec3 uBox;
varying float vAlpha;
void main(){
 vec3 origin=cameraPosition-uBox*.5;
 vec3 p=aSeed*uBox;
 p.y-=uTime*(8.5+4.5*aSeed.x);p.x+=uTime*1.1;
 p=origin+mod(p-origin,uBox);
 float len=.45+.5*aSeed.y;
 vec3 q=p+vec3(-.1*len,len,0.0)*position.x; // tail above the drop head
 float d=distance(p,cameraPosition);
 vAlpha=smoothstep(.6,2.5,d)*(1.0-smoothstep(uBox.x*.3,uBox.x*.5,d))*mix(.14,.38,aSeed.z);
 gl_Position=projectionMatrix*viewMatrix*vec4(q,1.0);
}`;
const RAIN_FRAGMENT=/* glsl */`
uniform float uRain;
uniform vec3 uColor;
varying float vAlpha;
void main(){gl_FragColor=vec4(uColor,vAlpha*uRain);}`;
export function createRain(){
 const geometry=new THREE.BufferGeometry();
 const position=new Float32Array(RAIN_COUNT*2*3),seed=new Float32Array(RAIN_COUNT*2*3);
 let s=12345;const rnd=()=>((s=(s*1664525+1013904223)>>>0)/4294967296);
 for(let i=0;i<RAIN_COUNT;i++){const a=rnd(),b=rnd(),c=rnd();for(let k=0;k<2;k++){const j=(i*2+k)*3;position[j]=k;seed[j]=a;seed[j+1]=b;seed[j+2]=c;}}
 geometry.setAttribute('position',new THREE.BufferAttribute(position,3));
 geometry.setAttribute('aSeed',new THREE.BufferAttribute(seed,3));
 geometry.boundingSphere=new THREE.Sphere(new THREE.Vector3(),1e6);
 const material=new THREE.ShaderMaterial({name:'Rain streaks',vertexShader:RAIN_VERTEX,fragmentShader:RAIN_FRAGMENT,
  uniforms:{uTime:{value:0},uRain:WEATHER_UNIFORMS.rain,uBox:{value:RAIN_BOX.clone()},uColor:{value:new THREE.Color('#b4bcc4')}},
  transparent:true,depthWrite:false,fog:false,toneMapped:false});
 const lines=new THREE.LineSegments(geometry,material);lines.name='rain';lines.frustumCulled=false;lines.renderOrder=50;lines.visible=false;
 lines.raycast=()=>{};lines.castShadow=lines.receiveShadow=false;
 return lines;
}

const color=hex=>new THREE.Color(hex);
function materialise(p){
 return {
  sky:{zenith:color(p.sky.zenith),mid:color(p.sky.mid),horizon:color(p.sky.horizon),sunGlow:color(p.sky.sunGlow),cloudLit:color(p.sky.cloudLit),cloudShade:color(p.sky.cloudShade),coverage:p.sky.coverage,sunDisc:p.sky.sunDisc},
  sunOffset:new THREE.Vector3(...p.sunOffset),sunColor:color(p.sunColor),sunIntensity:p.sunIntensity,
  hemiSky:color(p.hemiSky),hemiGround:color(p.hemiGround),hemiIntensity:p.hemiIntensity,
  fog:{color:color(p.fog.color),near:p.fog.near,far:p.fog.far},
  sea:{deep:color(p.sea.deep),shore:color(p.sea.shore),sunColor:color(p.sea.sunColor)},
  grade:{...p.grade,tint:[...p.grade.tint],lift:[...p.grade.lift],hazeColor:[...p.grade.hazeColor]},
  wetness:p.wetness,rain:p.rain,night:p.night||0,
 };
}
// Blend every field of `a` toward `b` in place (colours in linear light, offsets as vectors).
function blend(a,b,k){
 for(const key of Object.keys(a)){
  const x=a[key],y=b[key];
  if(x instanceof THREE.Color)x.lerp(y,k);
  else if(x instanceof THREE.Vector3)x.lerp(y,k);
  else if(Array.isArray(x))for(let i=0;i<x.length;i++)x[i]+=(y[i]-x[i])*k;
  else if(typeof x==='number')a[key]=x+(y-x)*k;
  else if(x&&typeof x==='object')blend(x,y,k);
 }
}

export function createLook({scene,sky,hemi,sun,post,surfaces=[],getSea=()=>null,initial='midday',transition=.7}={}){
 let name=initial,target=materialise(LOOKS[name]);
 let settled=target,lastSkyEvent=0;
 // A transition has settled when every numeric channel of the blended state is within 1% of its target.
 const settledEnough=(a,b)=>Object.keys(a).every(key=>{const x=a[key],y=b[key];
  if(x instanceof THREE.Color||x instanceof THREE.Vector3){const p=x.toArray(),q=y.toArray();return p.every((v,i)=>Math.abs(v-q[i])<.01);}
  if(Array.isArray(x))return x.every((v,i)=>Math.abs(v-y[i])<.01);
  if(typeof x==='number')return Math.abs(x-y)<.01;
  return x&&typeof x==='object'?settledEnough(x,y):true;});
 const current=materialise(LOOKS[name]);
 const rainLines=createRain();if(scene)scene.add(rainLines);
 const baseColors=new Map(surfaces.map(m=>[m,m.color.clone()]));
 const listeners=new Set();
 function apply(){
  const c=current;
  if(sky){const u=sky.uniforms;u.uZenith.value.copy(c.sky.zenith);u.uMid.value.copy(c.sky.mid);u.uHorizon.value.copy(c.sky.horizon);u.uSunGlow.value.copy(c.sky.sunGlow);u.uCloudLit.value.copy(c.sky.cloudLit);u.uCloudShade.value.copy(c.sky.cloudShade);u.uCoverage.value=c.sky.coverage;u.uSunDisc.value=c.sky.sunDisc;sky.setSun(c.sunOffset);}
  if(sun){sun.color.copy(c.sunColor);sun.intensity=c.sunIntensity;sun.position.copy(sun.target.position).add(c.sunOffset);}
  if(hemi){hemi.color.copy(c.hemiSky);hemi.groundColor.copy(c.hemiGround);hemi.intensity=c.hemiIntensity;}
  if(scene){if(scene.fog){scene.fog.color.copy(c.fog.color);scene.fog.near=c.fog.near;scene.fog.far=c.fog.far;}if(scene.background?.isColor)scene.background.copy(c.fog.color);}
  const sea=getSea();if(sea?.material?.uniforms){const u=sea.material.uniforms;u.uDeep.value.copy(c.sea.deep);u.uShore.value.copy(c.sea.shore);u.uSunColor.value.copy(c.sea.sunColor);}
  if(post){post.setGrade(c.grade);post.setGrade({wetness:c.wetness,wetSky:[c.fog.color.r*.9,c.fog.color.g*.9,c.fog.color.b*.9]});}
  WEATHER_UNIFORMS.wetness.value=c.wetness;WEATHER_UNIFORMS.rain.value=c.rain;WEATHER_UNIFORMS.night.value=c.night;
  rainLines.visible=c.rain>.01;
  for(const [m,base] of baseColors){m.roughness=1-c.wetness*.72;m.color.copy(base).multiplyScalar(1-c.wetness*.3);}
 }
 apply();
 const api={
  get name(){return name;},
  get label(){return LOOKS[name].label;},
  get current(){return current;},
  uniforms:WEATHER_UNIFORMS,
  rain:rainLines,
  set(next,{instant=false}={}){
   if(!LOOKS[next])throw Error(`Unknown look "${next}"`);
   name=next;target=materialise(LOOKS[next]);
   if(instant){blend(current,target,1);apply();}
   for(const fn of listeners)fn(name,LOOKS[name].label);
   return api;
  },
  cycle(){const i=LOOK_ORDER.indexOf(name);return api.set(LOOK_ORDER[(i+1)%LOOK_ORDER.length]);},
  onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  update(dt,seconds){
   const k=Number.isFinite(dt)&&dt>0?1-Math.exp(-dt/transition):0;
   if(k>0)blend(current,target,k);
   if(Number.isFinite(seconds))rainLines.material.uniforms.uTime.value=seconds%1000;
   apply();
   // Reflective materials share one sky environment map (environment.js); refresh it while a look transition
   // is running, at most every 0.5 s, and once more when it settles — never every frame.
   if(typeof window!=='undefined'&&target!==settled){const now=Number.isFinite(seconds)?seconds:0;const done=k>0&&settledEnough(current,target);
    if(done||now-lastSkyEvent>.5){lastSkyEvent=now;window.dispatchEvent(new Event('skychange'));if(done)settled=target;}}
  },
  dispose(){rainLines.removeFromParent();rainLines.geometry.dispose();rainLines.material.dispose();},
 };
 return api;
}
