import * as THREE from 'three';

// One small PMREM environment map, prefiltered from the procedural sky dome,
// shared by every reflective material (car paint and glass, chrome, tram
// glazing). It is rendered once at startup and again only when the sky
// changes (a `skychange` event on window), never per frame.

const materials=new Set();
let current=null;

// Materials register here so a later sky change reaches clones and instanced
// batches alike. Returns the material for chaining.
export function registerEnvMaterial(material,intensity=null){
 if(!material)return material;
 if(intensity!==null)material.envMapIntensity=intensity;
 materials.add(material);
 if(current){material.envMap=current;material.needsUpdate=true;}
 return material;
}
export function unregisterEnvMaterial(material){materials.delete(material);}
export function currentEnvironment(){return current;}
export function setEnvironment(texture){
 if(texture===current)return;
 current=texture;
 for(const m of materials){m.envMap=texture;m.needsUpdate=true;}
}

// Build (or rebuild) the environment from the sky mesh. The sky shader pins
// itself to the rendering camera, so a scene holding only the dome gives the
// prefiltered cubemap the exact gradient, sun glow and clouds the player sees.
export function createSkyEnvironment(renderer,skyMesh,{listen=true}={}){
 const pmrem=new THREE.PMREMGenerator(renderer),stage=new THREE.Scene(),SKY_FAR=5000;
 let texture=null,target=null,pending=false;
 function regenerate(){
  pending=false;
  if(!skyMesh)return texture;
  const parentBefore=skyMesh.parent;
  stage.add(skyMesh);
  const rt=pmrem.fromScene(stage,0,.1,SKY_FAR),next=rt.texture;
  if(parentBefore)parentBefore.add(skyMesh);else stage.remove(skyMesh);
  const old=target;texture=next;target=rt;setEnvironment(texture);old?.dispose(); // the whole render target: disposing only its texture left the framebuffer and depth buffer (~3 MB a rebuild, several a weather change)
  return texture;
 }
 regenerate();
 // Coalesce bursts of sky changes into one rebuild on the next frame.
 const onSkyChange=()=>{if(pending)return;pending=true;if(typeof requestAnimationFrame==='function')requestAnimationFrame(regenerate);else regenerate();};
 if(listen&&typeof window!=='undefined')window.addEventListener('skychange',onSkyChange);
 // Fallback for sky changes that are not announced: twice a second compare a
 // coarse signature of the dome's colour/sun uniforms and rebuild on drift.
 const signature=()=>{const u=skyMesh?.material?.uniforms;if(!u)return '';let s='';
  for(const k of ['uHorizon','uMid','uZenith','uSunGlow','uSunDir','uCloudLit','uCloudShade']){const v=u[k]?.value;if(!v)continue;s+=v.isColor?`${(v.r*24)|0},${(v.g*24)|0},${(v.b*24)|0};`:v.isVector3?`${(v.x*12)|0},${(v.y*12)|0},${(v.z*12)|0};`:'';}return s;};
 let lastPoll=-Infinity,lastSignature=signature();
 return {get texture(){return texture;},regenerate,
  update(seconds){if(!(seconds-lastPoll>=.5))return;lastPoll=seconds;const s=signature();if(s!==lastSignature){lastSignature=s;onSkyChange();}},
  dispose(){if(listen&&typeof window!=='undefined')window.removeEventListener('skychange',onSkyChange);pmrem.dispose();target?.dispose();setEnvironment(null);}};
}
