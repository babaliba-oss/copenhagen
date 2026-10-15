// Surface grain for untextured building shells (the City of Copenhagen 3D model gives shape and colour,
// not photos). Adds, in the shader and at no texture cost:
//  - brick coursing (stretcher bond, 228 x 75 mm with mortar) on reddish walls, each brick a little different,
//  - plaster: soft blotches and rain streaks below each storey line on rendered walls,
//  - roof grain: tile or slate courses on pitched roofs, faint patina on copper.
// Patterns fade out with distance (screen-space derivatives) so far walls do not shimmer.
import * as THREE from 'three';
import {WEATHER_UNIFORMS} from './weather.js';
// Scanned detail (ambientCG Bricks104, PaintedPlaster017, RoofingTiles014A; CC0), tinted by each building's own
// colour: brick walls get real bricks and mortar, rendered walls a plaster surface, tiled roofs real tiles.
let TEX=null;
function grainTextures(){
 if(TEX||typeof document==='undefined')return TEX;
 const L=new THREE.TextureLoader(),t=(f,srgb)=>{const x=L.load(`/materials/${f}`);x.wrapS=x.wrapT=THREE.RepeatWrapping;x.anisotropy=8;if(srgb)x.colorSpace=THREE.SRGBColorSpace;return x;};
 TEX={tBrickC:{value:t('brick-color.jpg',true)},tBrickN:{value:t('brick-normal.jpg',false)},tPlasterC:{value:t('slab-color.jpg',true)},tPlasterN:{value:t('slab-normal.jpg',false)},tRoofC:{value:t('rooftile-color.jpg',true)},tRoofN:{value:t('rooftile-normal.jpg',false)}};
 return TEX;
}
// options.windows: also paint a storey-and-bay window grid on walls (far shells and shells waiting for detail,
// which have no window geometry yet); windows glow at night like the real ones.
export function facadeGrain(material,{windows=false,stone=false}={}){
 const prev=material.onBeforeCompile;
 material.onBeforeCompile=(shader,renderer)=>{prev?.(shader,renderer);
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec3 vGrainPos;varying vec3 vGrainNormal;'+(windows?'attribute vec2 aRel;varying vec2 vRel;':''))
   .replace('#include <project_vertex>','#include <project_vertex>\nvGrainPos=(modelMatrix*vec4(transformed,1.)).xyz;vGrainNormal=normalize(mat3(modelMatrix)*objectNormal);'+(windows?'vRel=aRel;':''));
  shader.uniforms.uNight=WEATHER_UNIFORMS.night;const tex=grainTextures();if(tex)Object.assign(shader.uniforms,tex);
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>
#define GRAIN_WINDOWS ${windows?1:0}
#define GRAIN_STONE ${stone?1:0}
uniform float uNight;uniform sampler2D tBrickC,tBrickN,tPlasterC,tPlasterN,tRoofC,tRoofN;${windows?'varying vec2 vRel;':''}
varying vec3 vGrainPos;varying vec3 vGrainNormal;
float gHash(vec2 p){return fract(sin(mod(dot(p,vec2(1.,57.)),997.)*1.371)*4375.85);}
float gNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(gHash(i),gHash(i+vec2(1,0)),f.x),mix(gHash(i+vec2(0,1)),gHash(i+vec2(1,1)),f.x),f.y);}`)
   .replace('#include <color_fragment>',`#include <color_fragment>
float vWinLit=0.;vec3 fN=vec3(0.,0.,1.),fT=vec3(1.,0.,0.),fB=vec3(0.,1.,0.);float fNw=0.;
{
 vec3 n=normalize(vGrainNormal);vec3 p=vGrainPos;vec3 PDX=dFdx(vGrainPos),PDY=dFdy(vGrainPos); // derivatives before any branch: the textures below use textureGrad
 vec2 tg=normalize(vec2(-n.z,n.x)+vec2(1e-5,0.));float along=dot(p.xz,tg);
 vec3 c=diffuseColor.rgb;
 if(abs(n.y)<.35){
  float brick=smoothstep(.04,.16,c.r-max(c.g,c.b)*1.1);
  // brick: scanned Bricks104 (2.04 x 1.02 m per tile), recoloured to this wall's colour
  vec2 bu=vec2(along/2.04,p.y/1.02);
  vec3 brickCol=textureGrad(tBrickC,bu,vec2(dot(PDX.xz,tg)/2.04,PDX.y/1.02),vec2(dot(PDY.xz,tg)/2.04,PDY.y/1.02)).rgb/vec3(.406,.2535,.2)*c;
  c=mix(c,brickCol,brick);
  fT=vec3(tg.x,0.,tg.y);fB=vec3(0.,1.,0.);
  vec3 nb=textureGrad(tBrickN,bu,vec2(dot(PDX.xz,tg)/2.04,PDX.y/1.02),vec2(dot(PDY.xz,tg)/2.04,PDY.y/1.02)).xyz*2.-1.,np=textureGrad(tPlasterN,vec2(along,p.y)/2.3,vec2(dot(PDX.xz,tg),PDX.y)/2.3,vec2(dot(PDY.xz,tg),PDY.y)/2.3).xyz*2.-1.;
  fN=normalize(mix(np,nb,brick));fNw=mix(.35,.8,brick)*(1.-smoothstep(.06,.3,max(fwidth(bu.x),fwidth(bu.y))*2.));
  // plaster: blotches and streaks
  float blot=gNoise(vec2(along,p.y)*.35)*.6+gNoise(vec2(along,p.y)*1.7)*.4;
  float streak=gNoise(vec2(along*2.3,p.y*.08))*(1.-smoothstep(0.,1.,fract(p.y/3.1)))*.5;
  float plaster=1.-brick;
  c*=1.+plaster*((blot-.5)*.12-streak*.06);
  c*=mix(1.,dot(textureGrad(tPlasterC,vec2(along,p.y)/2.3,vec2(dot(PDX.xz,tg),PDX.y)/2.3,vec2(dot(PDY.xz,tg),PDY.y)/2.3).rgb,vec3(.3333))/.51,.55*plaster); // scanned render
#if GRAIN_STONE
  // churches and towers: dressed stone (ashlar) courses instead of render, each block its own shade
  {vec2 sb=vec2(along/.9,p.y/.42);float sr=floor(sb.y);sb.x+=mod(sr,2.)*.5;vec2 sf=fract(sb),sc=floor(sb);
   float sfw=1.-smoothstep(.2,.8,max(fwidth(sb.x),fwidth(sb.y)));float joint=(1.-step(.035,sf.y)*step(.02,sf.x))*sfw;
   c=mix(c,c*(.9+.2*gHash(sc+7.)),plaster*sfw);c=mix(c,c*.72,joint*plaster*.8);fNw=max(fNw,.0);}
#endif
#if GRAIN_WINDOWS
  // window grid: 2.7 m bays, 3.1 m storeys, a 1.15 x 1.65 m opening with a light frame
  vec2 w=vec2(along/2.7,(vRel.x-.25)/3.1);vec2 wc=floor(w),wf=fract(w);
  float fw=max(fwidth(w.x),fwidth(w.y));
  float exists=step(5.5,vRel.y)*step(2.4,vRel.x)*step(vRel.x,vRel.y-1.2);
  exists=max(exists,step(3.2,vRel.y)*(1.-step(5.5,vRel.y))*(1.-step(3.35,vRel.x))); // one-storey kiosks, pavilions, low wings: a single row
  float open=step(.29,wf.x)*step(wf.x,.71)*step(.3,wf.y)*step(wf.y,.83)*exists;
  float frame=(step(.25,wf.x)*step(wf.x,.75)*step(.26,wf.y)*step(wf.y,.87))*exists-open;
  if(vRel.y<-8.){ // churches and towers (shell-colors.js stores their height negative): tall round-headed windows in 5.5 m bays
   float H=-vRel.y,cx=(fract(along/5.5)-.5)*5.5,hw=.62,top=min(H*.72,17.),y=vRel.x,arch=top-hw+sqrt(max(0.,hw*hw-cx*cx));
   open=step(abs(cx),hw)*step(3.4,y)*step(y,arch);frame=step(abs(cx),hw+.16)*step(3.25,y)*step(y,arch+.16)-open;
   exists=step(3.,y)*step(y,top+.3);wc=vec2(floor(along/5.5),7.);
  }
  float sharp=1.-smoothstep(.12,.45,fw);
  float h=fract(sin(mod(dot(wc,vec2(1.,57.)),997.)*1.371)*4375.85);
  vec3 glass=vec3(.05,.07,.09)+vec3(.04,.05,.06)*h;
  vec3 withWin=mix(mix(c,c*1.18+.05,frame),glass,open);
  c=mix(mix(c,c*.8,.35*(1.-sharp)*exists),withWin,sharp);
  vWinLit=open*sharp*step(.5,h)*uNight+(1.-sharp)*.18*uNight*exists;
#endif
 } else if(n.y>.35){
  // roofs: courses running across the slope
  vec2 hz=normalize(n.xz+vec2(1e-4));float down=dot(p.xz,hz);float side=dot(p.xz,vec2(-hz.y,hz.x));
  vec2 t=vec2(side/.3,down/.19);float r=floor(t.y);t.x+=mod(r,2.)*.5;
  float fadeR=(1.-smoothstep(.25,.9,max(fwidth(t.x),fwidth(t.y))))*(1.-smoothstep(.85,.97,n.y));
  float seam=(1.-smoothstep(.0,.12,fract(t.y)))*.18+(1.-step(.05,fract(t.x)))*.08;
  float tone=gHash(floor(t))*.14-.07;
  float copper=smoothstep(.03,.1,c.g-c.r);
  float tiled=smoothstep(.05,.15,c.r-c.g*1.25)*(1.-copper); // red/brown pitched roofs: scanned clay tiles
  vec2 ru=vec2(side,down)/2.0;
  c=mix(c,textureGrad(tRoofC,ru,vec2(dot(PDX.xz,vec2(-hz.y,hz.x)),dot(PDX.xz,hz))/2.,vec2(dot(PDY.xz,vec2(-hz.y,hz.x)),dot(PDY.xz,hz))/2.).rgb/vec3(.2761,.106,.0573)*c,tiled*(1.-smoothstep(.85,.97,n.y)));
  fT=vec3(-hz.y,0.,hz.x);fB=normalize(cross(n,fT));fN=textureGrad(tRoofN,ru,vec2(dot(PDX.xz,vec2(-hz.y,hz.x)),dot(PDX.xz,hz))/2.,vec2(dot(PDY.xz,vec2(-hz.y,hz.x)),dot(PDY.xz,hz))/2.).xyz*2.-1.;fNw=tiled*.8*(1.-smoothstep(.06,.3,max(fwidth(ru.x),fwidth(ru.y))*2.));
  c*=1.+fadeR*(tone-seam)*(1.-copper*.7)*(1.-tiled);
  c=mix(c,c*(.85+.3*gNoise(p.xz*.6)),copper);
 }
 diffuseColor.rgb=c;
}`)
   .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n if(fNw>0.){vec3 nW=normalize(fT*fN.x+fB*fN.y+normalize(vGrainNormal)*fN.z);normal=normalize(mix(normal,normalize((viewMatrix*vec4(nW,0.)).xyz)*(gl_FrontFacing?1.:-1.),fNw));}')
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.62,.28)*vWinLit*.65;');
 };
 const key=material.customProgramCacheKey?.bind(material);
 material.customProgramCacheKey=()=>(key?key():'')+'|facade-grain2'+(windows?'-w':'')+(stone?'-s':'');
 return material;
}
