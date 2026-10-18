import * as THREE from 'three';

// Helsinki late-summer sky (reference: Kauppatori / Kanavakatu, August):
// deep blue zenith, pale milky haze on the horizon, scattered cumulus and faint cirrus,
// warm afternoon sun. Sky colours are sRGB hex. The dome itself is not tone mapped by its
// material, and the fog colour equals the dome's horizon colour, so distant buildings melt
// into the horizon whether the frame goes straight to the screen (fog mixed in output space)
// or through the post pipeline in src/post.js (dome, fog and scene share one ACES pass).
// Time-of-day/weather presets in src/weather.js retint these uniforms at runtime.

// Direction toward the sun. Must stay equal to the shadow-casting DirectionalLight offset
// used in main.js (sun.position = sun.target.position + SUN_OFFSET).
export const SUN_OFFSET = Object.freeze([-160, 260, 160]);
export const SUN_DIRECTION = new THREE.Vector3(...SUN_OFFSET).normalize();

export const SKY_PALETTE = Object.freeze({
 zenith: '#3f79c4',
 mid: '#7fa9d9',
 horizon: '#c9d8e2',
 sunGlow: '#fff1d6',
 cloudLit: '#fbfbf8',
 cloudShade: '#a8b4c6',
});
export const FOG_COLOR = SKY_PALETTE.horizon;
export const SKY_RADIUS = 1000; // well inside the camera far plane (1500)

// Lights tuned toward the reference photos: bright, slightly warm sun and a bluer sky fill.
export const LIGHTING = Object.freeze({
 hemiSky: '#dce8f6', hemiGround: '#6d7466', hemiIntensity: 1.3,
 sunColor: '#ffedd2', sunIntensity: 2.25,
});

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Weights of the three gradient stops for a view elevation (dir.y, -1..1). Mirrors the GLSL.
export function skyGradientWeights(elevation) {
 const h = Math.max(0, Math.min(1, Number.isFinite(elevation) ? elevation : 0));
 const toMid = smoothstep(0, .22, h), toZenith = smoothstep(.12, .9, h);
 const horizon = 1 - toMid, mid = toMid * (1 - toZenith), zenith = toMid * toZenith;
 return {horizon, mid, zenith};
}

// Sky colour for a view elevation, ignoring sun and clouds (working/linear THREE.Color;
// getHex()/getStyle() give the displayed sRGB value, as the dome is not tone mapped).
export function skyColorAt(elevation, target = new THREE.Color()) {
 const w = skyGradientWeights(elevation), c = SKY_COLORS;
 target.setRGB(
  c.horizon.r * w.horizon + c.mid.r * w.mid + c.zenith.r * w.zenith,
  c.horizon.g * w.horizon + c.mid.g * w.mid + c.zenith.g * w.zenith,
  c.horizon.b * w.horizon + c.mid.b * w.mid + c.zenith.b * w.zenith,
 );
 return target;
}

const SKY_COLORS = Object.fromEntries(Object.entries(SKY_PALETTE).map(([k, v]) => [k, new THREE.Color(v)]));

const vertexShader = /* glsl */`
varying vec3 vDir;
void main(){
 vDir=position;
 vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.0);
 gl_Position=p.xyww; // pin to the far plane: never clips geometry, never z-fights
}`;

const fragmentShader = /* glsl */`
uniform vec3 uZenith,uMid,uHorizon,uSunGlow,uCloudLit,uCloudShade,uSunDir;
uniform float uTime,uCoverage,uSunDisc;
uniform vec2 uDrift;
varying vec3 vDir;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);
 return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x),u.y);}
const mat2 ROT=mat2(1.6,1.2,-1.2,1.6);
float fbm5(vec2 p){float a=.5,s=0.0;for(int i=0;i<5;i++){s+=a*noise(p);p=ROT*p+vec2(3.1,1.7);a*=.5;}return s;}
float fbm3(vec2 p){float a=.5,s=0.0;for(int i=0;i<3;i++){s+=a*noise(p);p=ROT*p+vec2(3.1,1.7);a*=.5;}return s;}
void main(){
 vec3 dir=normalize(vDir);
 float h=clamp(dir.y,0.0,1.0);
 float toMid=smoothstep(0.0,.22,h),toZenith=smoothstep(.12,.9,h); // same weights as skyGradientWeights()
 vec3 col=uHorizon*(1.0-toMid)+uMid*(toMid*(1.0-toZenith))+uZenith*(toMid*toZenith);
 float mu=max(dot(dir,uSunDir),0.0);
 // Forward-scattering haze brightens the horizon under the sun, plus a soft corona and disc.
 col=mix(col,uSunGlow,pow(mu,4.0)*pow(1.0-h,5.0)*.28);
 col+=(uSunGlow*(pow(mu,24.0)*.16+pow(mu,300.0)*.45)+vec3(smoothstep(.99955,.9998,mu)))*uSunDisc;
 if(dir.y>0.0){
  // Project onto a flat cloud layer; the small bias keeps the horizon from aliasing.
  vec2 p=dir.xz/(dir.y+.1);
  vec2 cu=p*1.25+uDrift+vec2(uTime*.007,uTime*.0025);
  float n=fbm5(cu);
  float coverage=uCoverage; // noise threshold: .5 scattered cumulus, ~.05 solid overcast
  float d=smoothstep(coverage,coverage+.12,n+.07*noise(cu*9.0));
  // Lighting: sample a little toward the sun; denser there means this point is in shadow.
  vec2 toSun=normalize(uSunDir.xz+1e-4)*.09;
  float n2=fbm3(cu+toSun);
  float lit=clamp(.62+(n-n2)*4.0,0.0,1.0);
  vec3 cloud=mix(uCloudShade,uCloudLit,lit*mix(.8,1.0,mu));
  cloud=mix(cloud,uCloudShade,smoothstep(.62,.9,n)*.4); // thick cores read greyer
  cloud+=uSunGlow*pow(mu,10.0)*(1.0-d)*.5; // silver lining near the sun
  // Faint streaky cirrus higher up.
  vec2 ci=vec2(p.x*.18+p.y*.05,p.y*.7-p.x*.2)+uDrift*.6+vec2(uTime*.006,0.0);
  float c=smoothstep(.5,.85,fbm3(ci*vec2(1.0,3.5)))*.38;
  float fade=smoothstep(.015,.28,dir.y);
  // Distant clouds sink into the horizon haze.
  vec3 haze=mix(uHorizon,col,.35);
  cloud=mix(haze,cloud,smoothstep(.02,.35,h));
  col=mix(col,mix(col,uCloudLit,.85),c*fade*(1.0-d));
  col=mix(col,cloud,d*fade*.95);
 }
 col+=(hash(gl_FragCoord.xy)-.5)/255.0; // dither against banding
 gl_FragColor=vec4(col,1.0);
 #include <colorspace_fragment>
}`;

// Large camera-centred dome drawn first (depth test/write off). One draw call, no textures.
export function createSky({scene, camera} = {}) {
 const uniforms = {
  uZenith: {value: SKY_COLORS.zenith.clone()}, uMid: {value: SKY_COLORS.mid.clone()}, uHorizon: {value: SKY_COLORS.horizon.clone()},
  uSunGlow: {value: SKY_COLORS.sunGlow.clone()}, uCloudLit: {value: SKY_COLORS.cloudLit.clone()}, uCloudShade: {value: SKY_COLORS.cloudShade.clone()},
  uSunDir: {value: SUN_DIRECTION.clone()}, uTime: {value: 0}, uDrift: {value: new THREE.Vector2()},
  uCoverage: {value: .5}, uSunDisc: {value: 1},
 };
 const material = new THREE.ShaderMaterial({
  name: 'HelsinkiSky', uniforms, vertexShader, fragmentShader,
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
 });
 const mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 32, 16), material);
 mesh.name = 'sky';
 mesh.renderOrder = -1e6;
 mesh.frustumCulled = false;
 mesh.castShadow = mesh.receiveShadow = false;
 mesh.matrixAutoUpdate = false;
 mesh.raycast = () => {};
 const start = typeof performance !== 'undefined' ? performance.now() : 0;
 // Follow whichever camera is rendering (drive/follow/high/inspection), without allocations.
 mesh.onBeforeRender = (_renderer, _scene, cam) => {
  const e = cam.matrixWorld.elements;
  mesh.position.set(e[12], e[13], e[14]);
  mesh.updateMatrix(); mesh.matrixWorld.copy(mesh.matrix);
  // Slight parallax so the cloud layer is not glued to the camera when driving.
  uniforms.uDrift.value.set(e[12] * 1.2e-4, e[14] * 1.2e-4);
  uniforms.uTime.value = ((globalThis.__skyClock ? globalThis.__skyClock() : typeof performance !== 'undefined' ? performance.now() : 0) - start) / 1000 % 100000; // __skyClock: the trailer capture's clock (main.js ?fixed)
 };
 if (scene) {
  scene.add(mesh);
  const fogColor = new THREE.Color(FOG_COLOR);
  scene.background = fogColor.clone();
  if (scene.fog) scene.fog.color.copy(fogColor);
  else scene.fog = new THREE.Fog(fogColor, 330, 850);
 }
 // Current sun offset (metres, same scale as SUN_OFFSET). Time-of-day presets move it via setSun();
 // main.js keeps the shadow light at target + SUN_OFFSET and the look module re-applies this one after.
 const sunOffset = new THREE.Vector3(...SUN_OFFSET);
 return {mesh, material, uniforms, sunDirection: SUN_DIRECTION, sunOffset,
  setSun(offset) { sunOffset.copy(offset); uniforms.uSunDir.value.copy(offset).normalize(); return sunOffset; },
  applyLighting(hemi, sun) {
   if (hemi) { hemi.color.set(LIGHTING.hemiSky); hemi.groundColor.set(LIGHTING.hemiGround); hemi.intensity = LIGHTING.hemiIntensity; }
   if (sun) { sun.color.set(LIGHTING.sunColor); sun.intensity = LIGHTING.sunIntensity; }
  },
  dispose() { mesh.removeFromParent(); mesh.geometry.dispose(); material.dispose(); }};
}
