// Surface grain for untextured building shells (the City of Copenhagen 3D model gives shape and colour,
// not photos). Adds, in the shader and at no texture cost:
//  - brick coursing (stretcher bond, 228 x 75 mm with mortar) on reddish walls, each brick a little different,
//  - plaster: soft blotches and rain streaks below each storey line on rendered walls,
//  - roof grain: tile or slate courses on pitched roofs, faint patina on copper.
// Patterns fade out with distance (screen-space derivatives) so far walls do not shimmer.
import {WEATHER_UNIFORMS} from './weather.js';
// options.windows: also paint a storey-and-bay window grid on walls (far shells and shells waiting for detail,
// which have no window geometry yet); windows glow at night like the real ones.
export function facadeGrain(material,{windows=false}={}){
 const prev=material.onBeforeCompile;
 material.onBeforeCompile=(shader,renderer)=>{prev?.(shader,renderer);
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec3 vGrainPos;varying vec3 vGrainNormal;')
   .replace('#include <project_vertex>','#include <project_vertex>\nvGrainPos=(modelMatrix*vec4(transformed,1.)).xyz;vGrainNormal=normalize(mat3(modelMatrix)*objectNormal);');
  shader.uniforms.uNight=WEATHER_UNIFORMS.night;
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>
#define GRAIN_WINDOWS ${windows?1:0}
uniform float uNight;
varying vec3 vGrainPos;varying vec3 vGrainNormal;
float gHash(vec2 p){return fract(sin(mod(dot(p,vec2(1.,57.)),997.)*1.371)*4375.85);}
float gNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(gHash(i),gHash(i+vec2(1,0)),f.x),mix(gHash(i+vec2(0,1)),gHash(i+vec2(1,1)),f.x),f.y);}`)
   .replace('#include <color_fragment>',`#include <color_fragment>
float vWinLit=0.;
{
 vec3 n=normalize(vGrainNormal);vec3 p=vGrainPos;
 vec2 tg=normalize(vec2(-n.z,n.x)+vec2(1e-5,0.));float along=dot(p.xz,tg);
 vec3 c=diffuseColor.rgb;
 if(abs(n.y)<.35){
  float brick=smoothstep(.04,.16,c.r-max(c.g,c.b)*1.1);
  // brick courses
  vec2 b=vec2(along/.24,p.y/.0775);float row=floor(b.y);b.x+=mod(row,2.)*.5;vec2 cell=floor(b),f=fract(b);
  float fadeB=1.-smoothstep(.25,.9,max(fwidth(b.x),fwidth(b.y)));
  float mortar=1.-step(.07,f.y)*step(.04,f.x);
  float tone=gHash(cell)*.22-.11;
  vec3 brickCol=c*(1.+tone)+vec3(.02,0.,-.01)*tone*4.;
  brickCol=mix(brickCol,vec3(.62,.6,.56)*dot(c,vec3(.6)),mortar*.65);
  c=mix(c,mix(c*(1.+tone*.4),brickCol,fadeB),brick);
  // plaster: blotches and streaks
  float blot=gNoise(vec2(along,p.y)*.35)*.6+gNoise(vec2(along,p.y)*1.7)*.4;
  float streak=gNoise(vec2(along*2.3,p.y*.08))*(1.-smoothstep(0.,1.,fract(p.y/3.1)))*.5;
  float plaster=1.-brick;
  c*=1.+plaster*((blot-.5)*.12-streak*.06);
#if GRAIN_WINDOWS
  // window grid: 2.7 m bays, 3.1 m storeys, a 1.15 x 1.65 m opening with a light frame
  vec2 w=vec2(along/2.7,(p.y-.6)/3.1);vec2 wc=floor(w),wf=fract(w);
  float fw=max(fwidth(w.x),fwidth(w.y));
  float open=step(.29,wf.x)*step(wf.x,.71)*step(.3,wf.y)*step(wf.y,.83);
  float frame=step(.25,wf.x)*step(wf.x,.75)*step(.26,wf.y)*step(wf.y,.87)-open;
  float sharp=1.-smoothstep(.12,.45,fw);
  float h=fract(sin(mod(dot(wc,vec2(1.,57.)),997.)*1.371)*4375.85);
  vec3 glass=vec3(.05,.07,.09)+vec3(.04,.05,.06)*h;
  vec3 withWin=mix(mix(c,c*1.18+.05,frame),glass,open);
  c=mix(mix(c,c*.8,.0+.35*(1.-sharp)),withWin,sharp);
  vWinLit=open*sharp*step(.5,h)*uNight+(1.-sharp)*.18*uNight;
#endif
 } else if(n.y>.35){
  // roofs: courses running across the slope
  vec2 hz=normalize(n.xz+vec2(1e-4));float down=dot(p.xz,hz);float side=dot(p.xz,vec2(-hz.y,hz.x));
  vec2 t=vec2(side/.3,down/.19);float r=floor(t.y);t.x+=mod(r,2.)*.5;
  float fadeR=(1.-smoothstep(.25,.9,max(fwidth(t.x),fwidth(t.y))))*(1.-smoothstep(.85,.97,n.y));
  float seam=(1.-smoothstep(.0,.12,fract(t.y)))*.18+(1.-step(.05,fract(t.x)))*.08;
  float tone=gHash(floor(t))*.14-.07;
  float copper=smoothstep(.03,.1,c.g-c.r);
  c*=1.+fadeR*(tone-seam)*(1.-copper*.7);
  c=mix(c,c*(.85+.3*gNoise(p.xz*.6)),copper);
 }
 diffuseColor.rgb=c;
}`)
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.62,.28)*vWinLit*.65;');
 };
 const key=material.customProgramCacheKey?.bind(material);
 material.customProgramCacheKey=()=>(key?key():'')+'|facade-grain'+(windows?'-w':'');
 return material;
}
