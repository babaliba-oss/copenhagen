import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {LOOKS,LOOK_ORDER,FOG_REACH,WEATHER_UNIFORMS,createLook,createRain} from '../src/weather.js';
import {createSky,SUN_OFFSET} from '../src/sky.js';
import {GRADE_DEFAULTS} from '../src/post.js';

const hex=/^#[0-9a-f]{6}$/i;

test('every look is complete, with valid colours and a sun above the horizon',()=>{
 assert.deepEqual(LOOK_ORDER,['midday','golden','whitenight','night','overcast','rain']);
 for(const name of LOOK_ORDER){
  const l=LOOKS[name];assert.ok(l,name);assert.ok(l.label);
  for(const k of ['zenith','mid','horizon','sunGlow','cloudLit','cloudShade'])assert.match(l.sky[k],hex,`${name}.sky.${k}`);
  for(const k of ['sunColor','hemiSky','hemiGround'])assert.match(l[k],hex,`${name}.${k}`);
  for(const k of ['deep','shore','sunColor'])assert.match(l.sea[k],hex,`${name}.sea.${k}`);
  assert.equal(l.fog.color,l.sky.horizon,`${name}: fog colour must equal the horizon so distant buildings melt into the dome`);
  assert.ok(l.fog.near>0&&l.fog.far>l.fog.near&&l.fog.far<=1000,`${name}: fog inside the sky radius`);
  assert.ok(l.sunOffset[1]>0,`${name}: sun above the horizon`);
  assert.ok(l.sunIntensity>=0&&l.sunIntensity<=3&&l.hemiIntensity>0&&l.hemiIntensity<=2);
  assert.ok(l.sky.coverage>=0&&l.sky.coverage<=1&&l.sky.sunDisc>=0&&l.sky.sunDisc<=1);
  assert.ok(l.wetness>=0&&l.wetness<=1&&l.rain>=0&&l.rain<=1);
  for(const k of Object.keys(GRADE_DEFAULTS))assert.ok(k in l.grade,`${name}.grade.${k}`);
  assert.ok(l.grade.exposure>.5&&l.grade.exposure<1.5);
 }
 assert.deepEqual(LOOKS.midday.sunOffset,[...SUN_OFFSET],'midday keeps the shadow light direction');
 assert.ok(LOOKS.golden.sunOffset[1]/Math.hypot(...LOOKS.golden.sunOffset)<Math.sin(25*Math.PI/180),'golden evening sun is low');
 assert.equal(LOOKS.overcast.sky.sunDisc,0);assert.equal(LOOKS.rain.wetness,1);assert.equal(LOOKS.rain.rain,1);
});

test('look blends toward the target and drives sky, lights, fog and weather uniforms',()=>{
 const scene=new THREE.Scene();scene.fog=new THREE.Fog('#b9cbd4',330,850);scene.background=new THREE.Color('#b9cbd4');
 const sky=createSky({scene});const hemi=new THREE.HemisphereLight(),sun=new THREE.DirectionalLight();sun.target.position.set(10,0,20);
 const grades=[];const post={setGrade:g=>grades.push(g)};
 const surface=new THREE.MeshStandardMaterial({roughness:1});
 const look=createLook({scene,sky,hemi,sun,post,surfaces:[surface]});
 assert.equal(look.name,'midday');assert.ok(scene.children.includes(look.rain));assert.equal(look.rain.visible,false);
 assert.ok(sun.position.clone().sub(sun.target.position).distanceTo(new THREE.Vector3(...SUN_OFFSET))<1e-6);
 look.set('rain');
 for(let i=0;i<300;i++)look.update(1/60,i/60);
 assert.ok(Math.abs(WEATHER_UNIFORMS.wetness.value-1)<.01&&Math.abs(WEATHER_UNIFORMS.rain.value-1)<.01);
 assert.ok(look.rain.visible);assert.ok(surface.roughness<.4,'wet road is glossier');
 assert.equal(scene.fog.color.getHexString(),new THREE.Color(LOOKS.rain.fog.color).getHexString());
 assert.ok(Math.abs(scene.fog.near-LOOKS.rain.fog.near*FOG_REACH[0])<1&&Math.abs(scene.fog.far-LOOKS.rain.fog.far*FOG_REACH[1])<1);
 assert.ok(Math.abs(sun.intensity-LOOKS.rain.sunIntensity)<.01&&Math.abs(hemi.intensity-LOOKS.rain.hemiIntensity)<.01);
 assert.ok(sky.uniforms.uSunDisc.value<.01&&sky.uniforms.uCoverage.value<.05);
 assert.ok(grades.at(-1).wetness>.99);
 look.set('golden',{instant:true});
 const dir=sun.position.clone().sub(sun.target.position).normalize();
 assert.ok(dir.distanceTo(new THREE.Vector3(...LOOKS.golden.sunOffset).normalize())<1e-6,'light follows the preset sun');
 assert.ok(sky.uniforms.uSunDir.value.distanceTo(dir)<1e-6,'sky dome sun follows the light');
 assert.equal(look.cycle().name,'whitenight');
 let changed=null;look.onChange((n,label)=>{changed=[n,label];});look.cycle();assert.deepEqual(changed,['night','Night']);
 assert.throws(()=>look.set('snow'));
 look.dispose();assert.ok(!scene.children.includes(look.rain));
});

test('rain is a single transparent line batch that never writes depth',()=>{
 const rain=createRain();
 assert.ok(rain.isLineSegments);assert.equal(rain.material.transparent,true);assert.equal(rain.material.depthWrite,false);
 assert.equal(rain.frustumCulled,false);assert.ok(rain.geometry.attributes.position.count>=2000);
 assert.equal(rain.material.uniforms.uRain,WEATHER_UNIFORMS.rain,'opacity follows the shared weather uniform');
});

test('a look transition fires skychange while blending and once more when it settles, then stays quiet',()=>{
 // environment.js rebuilds the shared reflection map on this event; it must not fire every frame.
 const events=[];globalThis.window={dispatchEvent:e=>events.push(e.type)};
 try{
  const scene=new THREE.Scene();scene.fog=new THREE.Fog('#b9cbd4',330,850);scene.background=new THREE.Color('#b9cbd4');
  const sky=createSky({scene});const hemi=new THREE.HemisphereLight(),sun=new THREE.DirectionalLight();
  const look=createLook({scene,sky,hemi,sun,post:{setGrade(){}},surfaces:[]});
  let t=0;for(let i=0;i<120;i++){t+=1/60;look.update(1/60,t);}
  assert.equal(events.length,0,'no events while idle');
  look.set('golden');for(let i=0;i<600;i++){t+=1/60;look.update(1/60,t);}
  const during=events.length;assert.ok(during>=2&&during<=25,`throttled during the transition, got ${during}`);
  for(let i=0;i<600;i++){t+=1/60;look.update(1/60,t);}
  assert.equal(events.length,during,'quiet again once settled');
 }finally{delete globalThis.window;}
});
