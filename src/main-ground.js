// Split out of main.js: the ground and street-surface materials (water mask, perched pools, ground patches,
// the scanned ground textures and the surface shader) and 1760's pavements off the cobbles.
import * as THREE from 'three';
import {bounds,pointInPolygon} from './geo.js';
import {groundAt,waterAt,seaLevel,hasTerrain} from './terrain.js';
import {drapeGeometry} from './terrain-mesh.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {WEATHER_UNIFORMS} from './weather.js';
import {GRANITE_SETTS_GLSL} from './market-street-surface.js';
import earcut from 'earcut';
import {splitByCell} from './sea.js';
// Mapped water, rasterised (2 m texels): the drawn ground is cut away inside it. With 10 m ground cells a
// triangle from a quay vertex to a sunk canal vertex rose above the water as a pale ramp beside every quay.
const WATER_MASK={uWaterMask:{value:null},uWaterRect:{value:new THREE.Vector4(0,0,1,0)},uSeaY:{value:-1e9}};
// Fountains and ponds standing above the water level the terrain gives them (Gefionspringvandet on its slope
// sat 2-5 m above the harbour level it inherited): as water polygons they cut a pit into the ground lined with
// quay walls. Taken out of the water list and drawn as a water sheet laid on the ground instead.
function extractPerchedPools(data){
 const pools=[];
 data.water=data.water.filter(w=>{const b=w.bbox||(w.bbox=bounds(w.rings));if(!w.rings?.[0]?.length||(b[2]-b[0])*(b[3]-b[1])>30000)return true;
  let mn=Infinity;for(const p of w.rings[0])mn=Math.min(mn,groundAt(p[0],p[1]));const lvl=waterAt((b[0]+b[2])/2,(b[1]+b[3])/2)??seaLevel();
  if(lvl!==null&&mn>lvl+1.2){pools.push(w);return false;}return true;});
 return pools;
}
function createPoolSheets(pools){
 const geoms=[];
 for(const w of pools){const shape=new THREE.Shape(w.rings[0].map(p=>new THREE.Vector2(p[0],-p[1])));for(const r of w.rings.slice(1))shape.holes.push(new THREE.Path(r.map(p=>new THREE.Vector2(p[0],-p[1]))));
  const g=new THREE.ShapeGeometry(shape);g.rotateX(-Math.PI/2);geoms.push(g);}
 const merged=drapeGeometry(mergeGeometries(geoms),{maxEdge:2,lift:.12});geoms.forEach(g=>g.dispose());
 const m=new THREE.Mesh(merged,new THREE.MeshStandardMaterial({color:'#3f6f80',roughness:.08,metalness:.1,transparent:true,opacity:.92}));m.name='Fountain and pond water';m.receiveShadow=true;return m;
}
function buildWaterMask(water,extent,res=2){
 if(typeof document==='undefined'||!water?.length||!extent)return;const n=Math.ceil(2*extent/res),c=document.createElement('canvas');c.width=c.height=n;
 const ctx=c.getContext('2d');ctx.fillStyle='#fff';
 // each polygon on its own (even-odd within it keeps island holes): overlapping polygons (a canal drawn over the harbour) cancelled out as one path
 // a grey 8 m band round every shore first: low ground there is the terrain ramping down into the water
 ctx.strokeStyle='rgb(60,60,60)';ctx.lineWidth=8/res;ctx.lineJoin='round';for(const w of water){ctx.beginPath();for(const ring of w.rings||[]){ring.forEach(([x,z],i)=>{const px=(x+extent)/res,pz=(z+extent)/res;i?ctx.lineTo(px,pz):ctx.moveTo(px,pz);});ctx.closePath();}ctx.stroke();}
 for(const w of water){ctx.beginPath();for(const ring of w.rings||[]){ring.forEach(([x,z],i)=>{const px=(x+extent)/res,pz=(z+extent)/res;i?ctx.lineTo(px,pz):ctx.moveTo(px,pz);});ctx.closePath();}ctx.fill('evenodd');}
 const t=new THREE.CanvasTexture(c);t.flipY=false;t.generateMipmaps=false;t.minFilter=t.magFilter=THREE.LinearFilter;t.colorSpace=THREE.NoColorSpace;
 WATER_MASK.uWaterMask.value=t;WATER_MASK.uWaterRect.value.set(-extent,-extent,n*res,1);WATER_MASK.uSeaY.value=seaLevel()??-1e9;
}
function groundPatches(material){
 material.onBeforeCompile=shader=>{Object.assign(shader.uniforms,WATER_MASK);
  shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\n if(uWaterRect.w>0.){vec2 wuv=(vGp.xz-uWaterRect.xy)/uWaterRect.z;if(all(greaterThan(wuv,vec2(0.)))&&all(lessThan(wuv,vec2(1.)))){float wm=texture2D(uWaterMask,wuv).r;if(wm>.6)discard;}} /* .6: the cut falls a few cm inside the shoreline, under the coping; at .72 the ground (level with the quay up to the water since createTerrainGround keeps shore vertices up) stuck out past the wall face as a pale ledge */');
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vGp;').replace('#include <project_vertex>','#include <project_vertex>\nvGp=(modelMatrix*vec4(transformed,1.)).xyz;');
  Object.assign(shader.uniforms,GROUND_TEX);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vGp;uniform sampler2D tSlabC,tSlabN,tSettsC,uWaterMask;uniform vec4 uWaterRect;uniform float uSeaY;vec3 gpNrm=vec3(0.,0.,1.);float gpNw=0.;float gpH(vec2 p){return fract(sin(dot(p,vec2(41.7,113.1)))*4371.3);}float gpN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(gpH(i),gpH(i+vec2(1,0)),f.x),mix(gpH(i+vec2(0,1)),gpH(i+vec2(1,1)),f.x),f.y);}')
   .replace('#include <color_fragment>','#include <color_fragment>\n{float n=gpN(vGp.xz/23.)*.6+gpN(vGp.xz/7.)*.3+gpN(vGp.xz/2.1)*.1;float fp=length(fwidth(vGp.xz));float g=(gpH(floor(vGp.xz*9.))-.5)*(1.-smoothstep(.05,.3,fp));\nvec3 grass=vec3(.29,.36,.2),gravel=vec3(.42,.4,.35);\n#ifdef DIRT_GROUND\n grass=vec3(.25,.28,.15);gravel=vec3(.27,.22,.16); // 1760: unpaved yards and verges are packed brown earth\n#endif\n#ifdef URBAN_GROUND\n vec2 tp=vGp.xz/1.4,ti=floor(tp),tf=fract(tp);float joint=(1.-step(.05,tf.x)*step(.05,tf.y))*(1.-smoothstep(.04,.2,fp));float tone=gpH(ti)*.1-.05;vec2 sl=vGp.xz/.625,slc=floor(sl),g2=abs(fract(sl)-.5);float seam=smoothstep(.478,.5,max(g2.x,g2.y))*(1.-smoothstep(.04,.2,fp));float pl=dot(texture2D(tSlabC,vGp.xz/1.9).rgb,vec3(.3333));float stain=step(.93,gpH(slc+8.3))*(.6+.4*gpN(vGp.xz*1.7));vec3 pave=vec3(.40,.395,.375)*(.97+.06*gpH(slc+3.1))*(.82+.25*pl/.75)*(1.-stain*.06)*(1.-seam*.16)*(1.+(n-.5)*.08);gpNrm=texture2D(tSlabN,vGp.xz/1.9).xyz*2.-1.;gpNw=.6*(1.-smoothstep(.08,.45,fp));float moss=smoothstep(.8,.92,gpN(vGp.xz/31.));diffuseColor.rgb=mix(pave,mix(gravel,grass,.6),moss*.3); /* concrete slabs like the mapped pavements */\n#elif defined(DIRT_GROUND)\n {vec3 st=texture2D(tSettsC,vGp.xz/vec2(2.2,1.1)).rgb;diffuseColor.rgb=mix(mix(st*vec3(1.,.9,.76)*.62,gravel,.35),grass,smoothstep(.6,.85,gpN(vGp.xz/41.))*.3)*(1.-smoothstep(.5,.8,n)*.12);} // 1760: unmapped ground in town reads as the same worn cobbles and earth as the streets\n#else\n diffuseColor.rgb=mix(gravel,grass,smoothstep(.38,.62,n))*(1.+g*.18);\n#endif\n}')
   .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n if(gpNw>0.){vec3 nW=normalize(vec3(gpNrm.x,gpNrm.z,gpNrm.y));normal=normalize(mix(normal,normalize((viewMatrix*vec4(nW,0.)).xyz),gpNw));}');
 };
 return material;
}
// Photo-scanned ground (ambientCG, CC0; scripts/textures/prepare.py): asphalt cut from Road007 between its lane
// markings (mirrored so the cut tiles), PavingStones150 cobbles for stone carriageways and squares, Grass005 for lawns.
const GROUND_TEX=(()=>{const L=new THREE.TextureLoader(),t=(f,srgb,wrap=THREE.RepeatWrapping)=>{const x=L.load(`/materials/${f}`);x.wrapS=x.wrapT=wrap;x.anisotropy=8;if(srgb)x.colorSpace=THREE.SRGBColorSpace;return x;};
 const M=THREE.MirroredRepeatWrapping;
 return {tAsphaltC:{value:t('asphalt-color.jpg',true,M)},tAsphaltN:{value:t('asphalt-normal.jpg',false,M)},tAsphaltR:{value:t('asphalt-rough.jpg',false,M)},
  tSettsC:{value:t('setts-color.jpg',true)},tSettsN:{value:t('setts-normal.jpg',false)},tSettsR:{value:t('setts-rough.jpg',false)},
  tSlabC:{value:t('slab-color.jpg',true)},tSlabN:{value:t('slab-normal.jpg',false)},
  tGrassC:{value:t('grass-color.jpg',true)},tGrassN:{value:t('grass-normal.jpg',false)}};})();
export function surfaceShader(surfaceMaterial){
surfaceMaterial.onBeforeCompile=shader=>{
 Object.assign(shader.uniforms,GROUND_TEX);
 shader.vertexShader='varying vec3 vGround;\n#ifdef TERRAIN\nattribute float terrainY;\n#endif\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGround=position;\n#ifdef TERRAIN\nvGround.y-=terrainY;\n#endif');
 // uWetness comes from weather.js (WEATHER_UNIFORMS.wetness): rain darkens and smooths the asphalt bays.
 shader.uniforms.uWetness=WEATHER_UNIFORMS.wetness;
 shader.fragmentShader='varying vec3 vGround;uniform float uWetness;uniform sampler2D tAsphaltC,tAsphaltN,tAsphaltR,tSettsC,tSettsN,tSettsR,tSlabC,tSlabN,tGrassC,tGrassN;\nfloat groundHash(vec2 p){return fract(sin(dot(p,vec2(41.7,113.1)))*4371.3);}\nfloat groundNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(groundHash(i),groundHash(i+vec2(1,0)),f.x),mix(groundHash(i+vec2(0,1)),groundHash(i+vec2(1,1)),f.x),f.y);}\n'+GRANITE_SETTS_GLSL+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 // Filter sub-pixel masonry and grain; unfiltered fract() patterns sparkle in motion.
 vec2 GDX=dFdx(vGround.xz),GDY=dFdy(vGround.xz); // derivatives taken before any branch: textures inside branches use textureGrad (no mip seams at surface borders)
 float footprint=max(length(dFdx(vGround.xz)),length(dFdy(vGround.xz)));
 vec2 settFp=vec2(length(vec2(dFdx(vGround.x),dFdy(vGround.x))),length(vec2(dFdx(vGround.z),dFdy(vGround.z))));
 float detail=1.0-smoothstep(0.07,0.40,footprint);
 float grain=(fract(sin(dot(floor(vGround.xz*18.0),vec2(12.9898,78.233)))*43758.5453)-0.5)*(1.0-smoothstep(0.02,0.08,footprint));
 float wetRough=0.0;vec3 gN=vec3(0.,0.,1.);float gNw=0.,gRough=-1.;
 float texFade=1.0-smoothstep(0.08,0.45,footprint); // photo normals fade out where a texel is smaller than a pixel
 if(vGround.y>0.065&&vGround.y<0.075){
  if(diffuseColor.r<0.35){
   // Asphalt: the scanned surface at two scales (breaks up the repeat), a slow tone drift, no painted patches.
   vec2 au=vGround.xz/2.6,au2=mat2(.8,-.6,.6,.8)*vGround.xz/7.3;
   vec3 asp=mix(textureGrad(tAsphaltC,au,GDX/2.6,GDY/2.6).rgb,textureGrad(tAsphaltC,au2,mat2(.8,-.6,.6,.8)*GDX/7.3,mat2(.8,-.6,.6,.8)*GDY/7.3).rgb,.35);
   float tone=groundNoise(vGround.xz/11.0)-0.5;
   diffuseColor.rgb=asp*vec3(1.0,0.97,0.92)*1.6*(1.0+tone*0.10); // weathered asphalt (albedo about 0.12): the fresh-black scan read purple-black under the evening sky
   gN=textureGrad(tAsphaltN,au,GDX/2.6,GDY/2.6).xyz*2.0-1.0;gNw=.8*texFade;gRough=textureGrad(tAsphaltR,au,GDX/2.6,GDY/2.6).r;grain=0.0;
   // Wet asphalt: darker, puddles in the low spots of the tone field, far less grain.
   float puddle=smoothstep(0.62,0.75,groundNoise(vGround.xz/3.5+7.0))*uWetness;
   diffuseColor.rgb*=1.0-uWetness*0.22-puddle*0.25;grain*=1.0-uWetness*0.7;wetRough=max(uWetness*0.5,puddle);
   #ifdef DIRT_ROADS
   // 1760: no asphalt anywhere; unpaved roads are packed earth with wheel ruts and gravel.
   gNw=0.;gRough=-1.;{float n=groundNoise(vGround.xz/4.0),rut=groundNoise(vGround.xz*vec2(.35,.35)+3.0);diffuseColor.rgb=vec3(0.20,0.16,0.11)*(0.82+n*0.32)*(1.0-smoothstep(0.55,0.75,rut)*0.18);diffuseColor.rgb*=1.0-puddle*0.35;}
   #endif
  }
  // Stone carriageways (aaa99e) get the shared photo-guided granite setts; light islands keep slabs.
  else if(diffuseColor.r<0.55){vec2 su=vGround.xz/vec2(2.2,1.1);{vec3 st=textureGrad(tSettsC,su,GDX/vec2(2.2,1.1),GDY/vec2(2.2,1.1)).rgb;diffuseColor.rgb=mix(st,vec3(dot(st,vec3(.3,.59,.11))),.55)*vec3(0.95,0.95,0.98)*(1.0+(groundNoise(vGround.xz/9.0)-0.5)*0.12);
   #ifdef DIRT_ROADS
   diffuseColor.rgb=mix(diffuseColor.rgb,st*vec3(1.0,.9,.76)*.92,.65)*(1.0-smoothstep(.5,.8,groundNoise(vGround.xz/5.0+11.0))*.22); // 1760 brosten: rounded field stones, brown-grey, dirt and dung in the joints
   #endif
  } /* granite grey: the scan alone read as orange dirt in low sun */gN=textureGrad(tSettsN,su,GDX/vec2(2.2,1.1),GDY/vec2(2.2,1.1)).xyz*2.0-1.0;gNw=texFade;gRough=textureGrad(tSettsR,su,GDX/vec2(2.2,1.1),GDY/vec2(2.2,1.1)).r;grain=0.0;} // scanned cobbles
  else {vec2 cell=abs(fract(vGround.xz/vec2(0.28,0.2))-0.5);float seam=smoothstep(0.42,0.49,max(cell.x,cell.y));diffuseColor.rgb*=1.0-mix(0.2,seam,detail)*0.22;
   #ifdef DIRT_ROADS
   // 1760: today's pale traffic islands and plazas are the same worn field-stone cobbles as the walks.
   {vec2 su=vGround.xz/vec2(1.5,.75);diffuseColor.rgb=textureGrad(tSettsC,su,GDX/vec2(1.5,.75),GDY/vec2(1.5,.75)).rgb*vec3(1.0,.93,.82)*.9*(1.0+(groundNoise(vGround.xz/7.0)-0.5)*0.16);gN=textureGrad(tSettsN,su,GDX/vec2(1.5,.75),GDY/vec2(1.5,.75)).xyz*2.0-1.0;gNw=texFade*.8;}
   #endif
  }
  diffuseColor.rgb*=1.0+grain*0.13;
 }else if(vGround.y>0.059&&vGround.y<0.065){
  // Gravel paths and pea gravel (6.2 cm: Københavns Kommune's surface register, scripts/kk-surfaces.py): small stones a shade
  // darker or paler each, faded out where a stone is smaller than a pixel, and a slow drift where feet and bikes wear it.
  float s1=groundHash(floor(vGround.xz*26.0)),s2=groundHash(floor(vGround.xz*61.0)+5.3),fine=mix(0.5,s1*0.6+s2*0.4,1.0-smoothstep(0.02,0.09,footprint));
  diffuseColor.rgb*=(0.86+0.28*fine)*(1.0+(groundNoise(vGround.xz/5.0)-0.5)*0.16);grain=0.0;gRough=0.95;
 }else if(vGround.y>0.04&&vGround.y<0.06){
  #ifdef ASPHALT_CYCLE_TRACKS
  // Copenhagen's cycle tracks are asphalt, a shade lighter than the carriageway (the data paints them red-beige).
  if(diffuseColor.r-diffuseColor.b>0.15){vec2 cu=vGround.xz/2.1;diffuseColor.rgb=textureGrad(tAsphaltC,cu,GDX/2.1,GDY/2.1).rgb*vec3(1.0,0.97,0.93)*1.9*(1.0+(groundNoise(vGround.xz/7.0)-0.5)*0.1);gN=textureGrad(tAsphaltN,cu,GDX/2.1,GDY/2.1).xyz*2.0-1.0;gNw=.7*texFade;gRough=textureGrad(tAsphaltR,cu,GDX/2.1,GDY/2.1).r;grain=0.0;} // cycle track: the same scanned asphalt, a shade lighter
  else
  #endif
  { // Pavement: 62.5 cm concrete slabs (Copenhagen fortovsfliser), each its own shade, scanned surface, sunk joints.
   vec2 sl=vGround.xz/0.625,slc=floor(sl),g2=abs(fract(sl)-0.5);float seam=smoothstep(0.478,0.5,max(g2.x,g2.y))*detail;
   vec3 plaster=textureGrad(tSlabC,vGround.xz/1.9,GDX/1.9,GDY/1.9).rgb;float pl=dot(plaster,vec3(.3333));
   float sh=groundHash(slc+3.1),stain=step(0.92,groundHash(slc+8.3))*(0.6+0.4*groundNoise(vGround.xz*1.7));
   vec3 slab=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(.3333))),.85)*vec3(1.04,1.0,.93); // grey concrete, not the data's blue tint
   diffuseColor.rgb=slab*0.66*(0.97+0.06*sh)*(0.82+0.25*pl/0.75)*(1.0-stain*0.06)*(1.0-seam*0.16)*(1.0+(groundNoise(vGround.xz/6.0)-0.5)*0.08); // even, quiet slabs: strong per-slab tones read as holes
   gN=textureGrad(tSlabN,vGround.xz/1.9,GDX/1.9,GDY/1.9).xyz*2.0-1.0;gNw=0.35*texFade;grain=0.0;
   #ifdef DIRT_ROADS
   // 1760: no concrete pavements. Walkways are small field-stone cobbles, worn pale and dusty.
   {vec2 su=vGround.xz/vec2(1.5,.75);diffuseColor.rgb=textureGrad(tSettsC,su,GDX/vec2(1.5,.75),GDY/vec2(1.5,.75)).rgb*vec3(1.0,.96,.88)*.98*(1.0+(groundNoise(vGround.xz/7.0)-0.5)*0.16);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.2,.24,.12),smoothstep(.62,.85,groundNoise(vGround.xz/37.0+5.0))*.22); /* weeds and grass on the open ground */gN=textureGrad(tSettsN,su,GDX/vec2(1.5,.75),GDY/vec2(1.5,.75)).xyz*2.0-1.0;gNw=texFade*.8;}
   #endif
  }
 }else if(diffuseColor.g>diffuseColor.r*1.06&&diffuseColor.g>diffuseColor.b*1.04){
  // lawns in the surface data (pale green): scanned grass at two scales, a deeper summer green
  vec2 gu=vGround.xz/2.2;vec3 gr=mix(textureGrad(tGrassC,gu,GDX/2.2,GDY/2.2).rgb,textureGrad(tGrassC,mat2(.8,-.6,.6,.8)*vGround.xz/6.1,mat2(.8,-.6,.6,.8)*GDX/6.1,mat2(.8,-.6,.6,.8)*GDY/6.1).rgb,.4);
  gr=mix(gr,vec3(dot(gr,vec3(.3,.59,.11))),.3)*vec3(1.,1.,1.3);diffuseColor.rgb=gr*vec3(.62,.66,.5)*(1.0+(groundNoise(vGround.xz/9.0)-0.5)*0.22);gN=textureGrad(tGrassN,gu,GDX/2.2,GDY/2.2).xyz*2.0-1.0;gNw=.5*texFade;
 }else{diffuseColor.rgb*=1.0+grain*0.04;
  #ifdef DIRT_ROADS
  // 1760: other pale surfaces (plazas, building plots of today's data) are worn cobbles too.
  if(dot(diffuseColor.rgb,vec3(.3333))>.45){vec2 su=vGround.xz/vec2(1.5,.75);diffuseColor.rgb=textureGrad(tSettsC,su,GDX/vec2(1.5,.75),GDY/vec2(1.5,.75)).rgb*vec3(1.0,.93,.82)*.9*(1.0+(groundNoise(vGround.xz/7.0)-0.5)*0.16);}
  #endif
 }
 `).replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\n if(gRough>=0.0)roughnessFactor=mix(roughnessFactor,clamp(gRough*1.1,0.35,1.0),0.85);\n roughnessFactor*=1.0-wetRough*0.6;')
  .replace('#include <normal_fragment_maps>','#include <normal_fragment_maps>\n if(gNw>0.0){vec3 nW=normalize(vec3(gN.x,gN.z,gN.y));normal=normalize(mix(normal,normalize((viewMatrix*vec4(nW,0.0)).xyz)*(gl_FrontFacing?1.0:-1.0),gNw));}');
};
}
export function pavements1760(city,data,touchScreen,ground,cityModel){
   if(city.era===1760&&hasTerrain()){ // today's pavements outside the cobbled town (Slotsholmen, Holmen) had no surface of their own: the bare ground lay half a metre down beside the drawn roads, and the walkers on it stood 60 cm in the air. They get the bare ground's own material, laid on the ground just under the cobbles.
    const cobbles=data.pavement.filter(p=>p.name==='Brosten'&&p.rings?.length),pos=[];
    for(const p of data.pavement){if(p.name==='Brosten'||/silta/i.test(p.kind||'')||!(p.rings?.[0]?.length>2))continue;const r=p.rings[0];let cx=0,cz=0;for(const q of r){cx+=q[0];cz+=q[1];}cx/=r.length;cz/=r.length;if(cobbles.some(c=>pointInPolygon(cx,cz,c.rings)))continue;
     const flat=[],holes=[];p.rings.forEach((ring,k)=>{if(k)holes.push(flat.length/2);for(const q of ring)flat.push(q[0],q[1]);});const ids=earcut(flat,holes,2);for(let t=0;t<ids.length;t+=3){const [a,b,c]=[ids[t],ids[t+1],ids[t+2]],up=(flat[b*2]-flat[a*2])*(flat[c*2+1]-flat[a*2+1])-(flat[b*2+1]-flat[a*2+1])*(flat[c*2]-flat[a*2])<0;for(const i of up?[a,b,c]:[a,c,b])pos.push(flat[i*2],0,flat[i*2+1]);}} /* wound to face up (earcut's x,y winding faces down once y is the map's z) */
    if(pos.length){let g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();g=drapeGeometry(g,{maxEdge:touchScreen?8:4});for(const part of splitByCell(g,500)){const m=new THREE.Mesh(part,ground.material);m.name='1760 pavements off the cobbles';m.receiveShadow=true;cityModel.add(m);}g.dispose(); /* 500 m cells: one city-wide mesh was never culled */console.info('1760 pavements off the cobbles',pos.length/9,'triangles before draping');}}
}
export {WATER_MASK,extractPerchedPools,createPoolSheets,buildWaterMask,groundPatches};
