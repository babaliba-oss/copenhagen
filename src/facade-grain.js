// Surface grain for untextured building shells (the City of Copenhagen 3D model gives shape and colour,
// not photos). Adds, in the shader and at no texture cost:
//  - brick coursing (stretcher bond, 228 x 75 mm with mortar) on reddish walls, each brick a little different,
//  - plaster: soft blotches and rain streaks below each storey line on rendered walls,
//  - roof grain: tile or slate courses on pitched roofs, faint patina on copper.
// Patterns fade out with distance (screen-space derivatives) so far walls do not shimmer.
export function facadeGrain(material){
 const prev=material.onBeforeCompile;
 material.onBeforeCompile=(shader,renderer)=>{prev?.(shader,renderer);
  shader.vertexShader=shader.vertexShader
   .replace('#include <common>','#include <common>\nvarying vec3 vGrainPos;varying vec3 vGrainNormal;')
   .replace('#include <project_vertex>','#include <project_vertex>\nvGrainPos=(modelMatrix*vec4(transformed,1.)).xyz;vGrainNormal=normalize(mat3(modelMatrix)*objectNormal);');
  shader.fragmentShader=shader.fragmentShader
   .replace('#include <common>',`#include <common>
varying vec3 vGrainPos;varying vec3 vGrainNormal;
float gHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float gNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(gHash(i),gHash(i+vec2(1,0)),f.x),mix(gHash(i+vec2(0,1)),gHash(i+vec2(1,1)),f.x),f.y);}`)
   .replace('#include <color_fragment>',`#include <color_fragment>
{
 vec3 n=normalize(vGrainNormal);vec3 p=vGrainPos;
 float along=abs(n.x)>abs(n.z)?p.z:p.x;
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
}`);
 };
 const key=material.customProgramCacheKey?.bind(material);
 material.customProgramCacheKey=()=>(key?key():'')+'|facade-grain';
 return material;
}
