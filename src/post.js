import * as THREE from 'three';
import {FullScreenQuad} from 'three/addons/postprocessing/Pass.js';

// Cheap post pipeline: one multisampled HalfFloat scene target (colour + resolved depth),
// a half-resolution depth-only ambient occlusion (8 taps + 3x3 depth-aware blur),
// a quarter-resolution bloom (bright pass + separable blur), then one composite pass:
// AO, bloom, exposure, ACES, colour grade, vignette, dither, sRGB. No history buffers,
// so nothing can ghost or flicker between frames; AO noise is a fixed screen pattern.
// Every pass clamps what it reads, so a NaN or infinite pixel (a flat-shaded sliver on some GPUs) stays one dark
// pixel instead of spreading through the blurs into black squares.
// The scene is drawn into a render target, so three.js skips its own tone mapping and
// colour-space conversion for every material (fog is mixed in linear light instead of
// output space); the composite pass reproduces ACES + sRGB with its own exposure.
// Resizes itself whenever the drawing buffer changes (window resize, adaptive pixel ratio).

const QUAD_VERTEX=/* glsl */`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,1.0,1.0);}`;

const AO_FRAGMENT=/* glsl */`
precision highp float;
uniform sampler2D uDepth;
uniform vec2 uTexel;      // half-res texel size
uniform vec2 uProjScale;  // 1/P[0][0], 1/P[1][1]
uniform vec3 uUpView;     // world up in view space
uniform float uPixelsPerMetre; // height*P11/2
uniform float uNear,uFar,uRadius,uIntensity,uFadeStart,uFadeEnd,uWetness,uBias,uMaxRadiusPx,uNormalStep,uMinTap;
varying vec2 vUv;
float viewZ(vec2 uv){float d=texture2D(uDepth,uv).x;return (uNear*uFar)/((uFar-uNear)*d-uFar);} // negative view z
vec3 viewPos(vec2 uv,float z){return vec3((uv*2.0-1.0)*uProjScale*-z,z);}
void main(){
 float d=texture2D(uDepth,vUv).x;
 if(d>=0.99999){gl_FragColor=vec4(1.0,0.0,0.0,1.0);return;}
 float z=(uNear*uFar)/((uFar-uNear)*d-uFar);
 vec3 P=viewPos(vUv,z);
 // Normal from depth: pick the smaller difference on each axis so edges do not smear.
 vec2 ts=uTexel*uNormalStep;
 vec3 px1=viewPos(vUv+vec2(ts.x,0.0),viewZ(vUv+vec2(ts.x,0.0)))-P,px0=P-viewPos(vUv-vec2(ts.x,0.0),viewZ(vUv-vec2(ts.x,0.0)));
 vec3 py1=viewPos(vUv+vec2(0.0,ts.y),viewZ(vUv+vec2(0.0,ts.y)))-P,py0=P-viewPos(vUv-vec2(0.0,ts.y),viewZ(vUv-vec2(0.0,ts.y)));
 vec3 dx=abs(px1.z)<abs(px0.z)?px1:px0,dy=abs(py1.z)<abs(py0.z)?py1:py0;
 vec3 cr=cross(dx,dy);vec3 N=dot(cr,cr)>1e-30?normalize(cr):vec3(0.0,0.0,1.0); // degenerate depth (a sliver, the far plane): no NaN
 // Wet ground: upward faces mirror the sky at grazing angles (Schlick, F0 = .02).
 vec3 V=normalize(-P);
 float up=smoothstep(0.55,0.95,dot(N,uUpView));
 float f=pow(1.0-max(dot(N,V),0.0),5.0);
 float wet=uWetness*up*f*0.32*(1.0-smoothstep(uFadeEnd,uFadeEnd*2.5,-z));
 float fade=1.0-smoothstep(uFadeStart,uFadeEnd,-z);
 float ao=1.0;
 if(fade>0.0){
  float radiusPx=clamp(uRadius*uPixelsPerMetre/-z,2.0,uMaxRadiusPx);
  vec2 radiusUv=radiusPx*uTexel;
  // 4x4 ordered rotation pattern; the matching 4x4 blur pass removes it entirely.
  vec2 pix=floor(vUv/uTexel);
  float noise=(mod(pix.x,4.0)*4.0+mod(pix.y,4.0))/16.0;
  float angle=noise*6.2831853;
  float occlusion=0.0;
  const int TAPS=8;
  for(int i=0;i<TAPS;i++){
   float t=(float(i)+0.5)/float(TAPS);
   float a=angle+t*6.2831853*2.0; // two turns of spiral
   float r=sqrt(t);
   vec2 uv=vUv+vec2(cos(a),sin(a))*r*radiusUv;
   if(uv.x<0.0||uv.y<0.0||uv.x>1.0||uv.y>1.0)continue;
   vec3 S=viewPos(uv,viewZ(uv));
   vec3 v=S-P;float vv=dot(v,v);
   if(vv<uMinTap*uMinTap)continue; // inside depth noise: no information
   float w=clamp(1.0-vv/(uRadius*uRadius),0.0,1.0);
   occlusion+=max(0.0,dot(v,N)*inversesqrt(vv+1e-4)-uBias)*w;
  }
  ao=clamp(1.0-uIntensity*occlusion/float(TAPS),0.0,1.0);
  ao=mix(1.0,ao*ao,fade);
 }
 gl_FragColor=vec4(clamp(ao,0.0,1.0),clamp(wet,0.0,1.0),0.0,1.0);
}`;

const AO_BLUR_FRAGMENT=/* glsl */`
precision highp float;
uniform sampler2D uAO,uDepth;
uniform vec2 uTexel;
uniform float uNear,uFar;
varying vec2 vUv;
float viewZ(vec2 uv){float d=texture2D(uDepth,uv).x;return (uNear*uFar)/((uFar-uNear)*d-uFar);}
void main(){
 float zc=viewZ(vUv);vec2 sum=vec2(0.0);float wsum=0.0;
 for(int y=-2;y<=1;y++)for(int x=-2;x<=1;x++){
  vec2 uv=vUv+(vec2(float(x),float(y))+0.5)*uTexel;
  float z=viewZ(uv);
  float w=1.0/(1.0+abs(z-zc)*0.6);
  sum+=texture2D(uAO,uv).xy*w;wsum+=w;
 }
 gl_FragColor=vec4(sum/wsum,0.0,1.0);
}`;

const BRIGHT_FRAGMENT=/* glsl */`
precision highp float;
uniform sampler2D uScene;
uniform vec2 uTexel; // scene texel
uniform float uThreshold,uKnee;
varying vec2 vUv;
vec3 tap(vec2 o){return clamp(texture2D(uScene,vUv+o*uTexel).rgb,0.0,64.0);} // a NaN or infinite pixel would spread through the blur into a black square
void main(){
 vec3 c=(tap(vec2(-1.0,-1.0))+tap(vec2(1.0,-1.0))+tap(vec2(-1.0,1.0))+tap(vec2(1.0,1.0)))*0.25;
 float l=dot(c,vec3(0.2126,0.7152,0.0722));
 float soft=clamp(l-uThreshold+uKnee,0.0,2.0*uKnee);soft=soft*soft/(4.0*uKnee+1e-4);
 float contribution=max(soft,l-uThreshold)/max(l,1e-4);
 gl_FragColor=vec4(c*contribution,1.0);
}`;

const BLUR_FRAGMENT=/* glsl */`
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDir; // texel-sized step
varying vec2 vUv;
void main(){
 vec3 c=texture2D(uTex,vUv).rgb*0.2270270270;
 c+=texture2D(uTex,vUv+uDir*1.3846153846).rgb*0.3162162162;
 c+=texture2D(uTex,vUv-uDir*1.3846153846).rgb*0.3162162162;
 c+=texture2D(uTex,vUv+uDir*3.2307692308).rgb*0.0702702703;
 c+=texture2D(uTex,vUv-uDir*3.2307692308).rgb*0.0702702703;
 gl_FragColor=vec4(c,1.0);
}`;

const COMPOSITE_FRAGMENT=/* glsl */`
precision highp float;
uniform sampler2D uScene,uAO,uBloom;
uniform float uExposure,uAOStrength,uBloomStrength,uSaturation,uContrast,uVignette,uHaze,uDebug;
uniform vec3 uTint,uLift,uHazeColor,uWetSky;
uniform vec2 uAspect;
varying vec2 vUv;
// ACES filmic fit (Stephen Hill), the same curve three.js uses for ACESFilmicToneMapping.
vec3 RRTAndODTFit(vec3 v){vec3 a=v*(v+0.0245786)-0.000090537;vec3 b=v*(0.983729*v+0.4329510)+0.238081;return a/b;}
vec3 aces(vec3 c){
 const mat3 IN=mat3(0.59719,0.07600,0.02840,0.35458,0.90834,0.13383,0.04823,0.01566,0.83777);
 const mat3 OUT=mat3(1.60475,-0.10208,-0.00327,-0.53108,1.10813,-0.07276,-0.07367,-0.00605,1.07602);
 c=IN*(c/0.6);c=RRTAndODTFit(c);return clamp(OUT*c,0.0,1.0);
}
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
void main(){
 vec3 c=clamp(texture2D(uScene,vUv).rgb,0.0,64.0);
 vec2 occ=clamp(texture2D(uAO,vUv).xy,0.0,1.0);float ao=occ.x;
 if(uDebug>0.5){gl_FragColor=vec4(vec3(mix(1.0,ao,uAOStrength)),1.0);return;}
 c*=mix(1.0,ao,uAOStrength);
 c+=uWetSky*occ.y*ao; // wet ground mirrors the sky where nothing stands in the way
 c+=clamp(texture2D(uBloom,vUv).rgb,0.0,64.0)*uBloomStrength;
 c=aces(c*uExposure);
 // Grade in display-linear light: tint, lifted cool shadows (atmospheric haze), saturation, contrast.
 c*=uTint;
 c=c*(1.0-uLift)+uLift;
 c=mix(c,uHazeColor,uHaze);
 float l=dot(c,vec3(0.2126,0.7152,0.0722));
 c=mix(vec3(l),c,uSaturation);
 c=(c-0.5)*uContrast+0.5;
 vec2 q=(vUv-0.5)*uAspect;
 c*=1.0-uVignette*smoothstep(0.35,1.25,length(q));
 c+=(hash(gl_FragCoord.xy)-0.5)/255.0;
 gl_FragColor=vec4(clamp(c,0.0,1.0),1.0);
 #include <colorspace_fragment>
}`;

export const GRADE_DEFAULTS=Object.freeze({
 exposure:.9,aoStrength:.8,bloomStrength:.22,bloomThreshold:1.05,saturation:1,contrast:1.04,vignette:.22,
 tint:[.985,1,1.03],lift:[.008,.012,.024],haze:0,hazeColor:[.78,.82,.86],aoRadius:2.2,aoIntensity:3.0,
});

export function createPostPipeline(renderer,{samples=4,ao=true,bloom=true}={}){
 const size=new THREE.Vector2();
 const makeTarget=(w,h,opts)=>new THREE.WebGLRenderTarget(w,h,{depthBuffer:false,stencilBuffer:false,...opts});
 let depthTexture=new THREE.DepthTexture(2,2);depthTexture.type=THREE.UnsignedIntType;
 const scene=new THREE.WebGLRenderTarget(2,2,{type:THREE.HalfFloatType,samples,depthTexture,stencilBuffer:false,generateMipmaps:false});
 scene.texture.minFilter=THREE.LinearFilter;scene.texture.magFilter=THREE.LinearFilter;scene.texture.name='post.scene';
 const aoRaw=makeTarget(2,2,{}),aoBlurred=makeTarget(2,2,{});
 const bright=makeTarget(2,2,{type:THREE.HalfFloatType}),blurA=makeTarget(2,2,{type:THREE.HalfFloatType});
 for(const t of [aoRaw,aoBlurred,bright,blurA]){t.texture.minFilter=t.texture.magFilter=THREE.LinearFilter;}
 const material=(fragmentShader,uniforms)=>new THREE.ShaderMaterial({vertexShader:QUAD_VERTEX,fragmentShader,uniforms,depthTest:false,depthWrite:false,toneMapped:false});
 const aoMaterial=material(AO_FRAGMENT,{uDepth:{value:depthTexture},uTexel:{value:new THREE.Vector2()},uProjScale:{value:new THREE.Vector2()},uUpView:{value:new THREE.Vector3(0,1,0)},uPixelsPerMetre:{value:1},uWetness:{value:0},uBias:{value:.12},uMaxRadiusPx:{value:40},uNormalStep:{value:2},uMinTap:{value:0},uNear:{value:.25},uFar:{value:1500},uRadius:{value:GRADE_DEFAULTS.aoRadius},uIntensity:{value:GRADE_DEFAULTS.aoIntensity},uFadeStart:{value:120},uFadeEnd:{value:320}});
 const aoBlurMaterial=material(AO_BLUR_FRAGMENT,{uAO:{value:aoRaw.texture},uDepth:{value:depthTexture},uTexel:{value:new THREE.Vector2()},uNear:{value:.25},uFar:{value:1500}});
 const brightMaterial=material(BRIGHT_FRAGMENT,{uScene:{value:scene.texture},uTexel:{value:new THREE.Vector2()},uThreshold:{value:GRADE_DEFAULTS.bloomThreshold},uKnee:{value:.35}});
 const blurMaterial=material(BLUR_FRAGMENT,{uTex:{value:null},uDir:{value:new THREE.Vector2()}});
 const white=new THREE.DataTexture(new Uint8Array([255,255,255,255]),1,1);white.needsUpdate=true;
 // AO off: full light (x=1) and no wet-sky mirror (y=0; a white texture would wash the whole frame with sky)
 const noAO=new THREE.DataTexture(new Uint8Array([255,0,0,255]),1,1);noAO.needsUpdate=true;
 const black=new THREE.DataTexture(new Uint8Array([0,0,0,255]),1,1);black.needsUpdate=true;
 const compositeMaterial=material(COMPOSITE_FRAGMENT,{
  uScene:{value:scene.texture},uAO:{value:aoBlurred.texture},uBloom:{value:blurA.texture},
  uExposure:{value:GRADE_DEFAULTS.exposure},uAOStrength:{value:GRADE_DEFAULTS.aoStrength},uBloomStrength:{value:GRADE_DEFAULTS.bloomStrength},
  uSaturation:{value:GRADE_DEFAULTS.saturation},uContrast:{value:GRADE_DEFAULTS.contrast},uVignette:{value:GRADE_DEFAULTS.vignette},
  uTint:{value:new THREE.Vector3(...GRADE_DEFAULTS.tint)},uLift:{value:new THREE.Vector3(...GRADE_DEFAULTS.lift)},
  uHaze:{value:0},uDebug:{value:0},uHazeColor:{value:new THREE.Vector3(...GRADE_DEFAULTS.hazeColor)},uWetSky:{value:new THREE.Vector3()},uAspect:{value:new THREE.Vector2(1,1)},
 });
 const quad=new FullScreenQuad(compositeMaterial);
 const options={ao,bloom,samples,bypass:false,debug:''};
 const grade=compositeMaterial.uniforms,aoUniforms=aoMaterial.uniforms;
 const previousAutoReset=renderer.info.autoReset;renderer.info.autoReset=false;
 function resize(){
  renderer.getDrawingBufferSize(size);
  const w=Math.max(2,Math.floor(size.x)),h=Math.max(2,Math.floor(size.y));
  if(scene.width===w&&scene.height===h)return;
  scene.setSize(w,h);
  const hw=Math.max(1,Math.ceil(w/2)),hh=Math.max(1,Math.ceil(h/2)),qw=Math.max(1,Math.ceil(w/4)),qh=Math.max(1,Math.ceil(h/4));
  aoRaw.setSize(hw,hh);aoBlurred.setSize(hw,hh);bright.setSize(qw,qh);blurA.setSize(qw,qh);
  aoMaterial.uniforms.uTexel.value.set(1/hw,1/hh);aoBlurMaterial.uniforms.uTexel.value.set(1/hw,1/hh);
  // Normal-from-depth step in texels grows with the buffer height: at Retina pixel ratios a one-texel
  // step on near, grazing ground is below depth precision and the whole road read as occluded
  // (a dark "shadow" travelling with the car once the drive camera sat lower).
  aoMaterial.uniforms.uNormalStep.value=Math.min(4,Math.max(1.5,hh/300));
  brightMaterial.uniforms.uTexel.value.set(1/w,1/h);
  grade.uAspect.value.set(w/h,1);
 }
 function pass(target,mat){renderer.setRenderTarget(target);quad.material=mat;quad.render(renderer);}
 function render(sceneGraph,camera){
  renderer.info.reset();
  if(options.bypass){renderer.setRenderTarget(null);renderer.render(sceneGraph,camera);return;}
  resize();
  const w=scene.width,h=scene.height;
  renderer.setRenderTarget(scene);
  renderer.render(sceneGraph,camera);
  const autoClear=renderer.autoClear;renderer.autoClear=false; // full-screen quads cover every pixel
  if(options.ao){
   const p=camera.projectionMatrix.elements;
   aoUniforms.uProjScale.value.set(1/p[0],1/p[5]);aoUniforms.uPixelsPerMetre.value=Math.ceil(h/2)*p[5]/2;
   aoUniforms.uNear.value=camera.near;aoUniforms.uFar.value=camera.far;
   aoUniforms.uUpView.value.set(0,1,0).transformDirection(camera.matrixWorldInverse);
   aoBlurMaterial.uniforms.uNear.value=camera.near;aoBlurMaterial.uniforms.uFar.value=camera.far;
   pass(aoRaw,aoMaterial);pass(aoBlurred,aoBlurMaterial);
   grade.uAO.value=aoBlurred.texture;
  }else grade.uAO.value=noAO;
  if(options.bloom){
   pass(bright,brightMaterial);
   blurMaterial.uniforms.uTex.value=bright.texture;blurMaterial.uniforms.uDir.value.set(1/bright.width,0);pass(blurA,blurMaterial);
   blurMaterial.uniforms.uTex.value=blurA.texture;blurMaterial.uniforms.uDir.value.set(0,1/bright.height);pass(bright,blurMaterial);
   grade.uBloom.value=bright.texture;
  }else grade.uBloom.value=black;
  renderer.setRenderTarget(null);
  grade.uDebug.value=options.debug==='ao'?1:0;
  quad.material=compositeMaterial;quad.render(renderer);
  renderer.autoClear=autoClear;
  void w;
 }
 function setGrade(g){
  if(g.exposure!==undefined)grade.uExposure.value=g.exposure;
  if(g.aoStrength!==undefined)grade.uAOStrength.value=g.aoStrength;
  if(g.bloomStrength!==undefined)grade.uBloomStrength.value=g.bloomStrength;
  if(g.bloomThreshold!==undefined)brightMaterial.uniforms.uThreshold.value=g.bloomThreshold;
  if(g.saturation!==undefined)grade.uSaturation.value=g.saturation;
  if(g.contrast!==undefined)grade.uContrast.value=g.contrast;
  if(g.vignette!==undefined)grade.uVignette.value=g.vignette;
  if(g.haze!==undefined)grade.uHaze.value=g.haze;
  if(g.tint)grade.uTint.value.set(g.tint[0],g.tint[1],g.tint[2]);
  if(g.lift)grade.uLift.value.set(g.lift[0],g.lift[1],g.lift[2]);
  if(g.hazeColor)grade.uHazeColor.value.set(g.hazeColor[0],g.hazeColor[1],g.hazeColor[2]);
  if(g.aoRadius!==undefined)aoUniforms.uRadius.value=g.aoRadius;
  if(g.wetness!==undefined)aoUniforms.uWetness.value=g.wetness;
  if(g.wetSky)grade.uWetSky.value.set(g.wetSky[0],g.wetSky[1],g.wetSky[2]);
  if(g.aoIntensity!==undefined)aoUniforms.uIntensity.value=g.aoIntensity;
 }
 function dispose(){
  renderer.info.autoReset=previousAutoReset;
  for(const t of [scene,aoRaw,aoBlurred,bright,blurA])t.dispose();
  for(const m of [aoMaterial,aoBlurMaterial,brightMaterial,blurMaterial,compositeMaterial])m.dispose();
  quad.dispose();white.dispose();black.dispose();noAO.dispose();
 }
 return {render,resize,setGrade,options,dispose,targets:{scene,aoRaw,aoBlurred,bright,blurA},materials:{aoMaterial,aoBlurMaterial,brightMaterial,blurMaterial,compositeMaterial}};
}
