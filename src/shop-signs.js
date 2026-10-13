import * as THREE from 'three';
import {WEATHER_UNIFORMS} from './weather.js';
// Shop signs for generated street fronts: one shared canvas atlas of Danish shop names (no brands), drawn
// once on the main thread; the building worker only needs the cell layout (signCell) to write UVs.
import {SHOP_NAMES,SIGN_COLS,SIGN_ROWS} from './shop-sign-layout.js';
export {SHOP_NAMES,signCell} from './shop-sign-layout.js';
let atlas=null;
export function signAtlasTexture(){
 if(atlas)return atlas;
 const W=256,H=64,cv=document.createElement('canvas');cv.width=W*SIGN_COLS;cv.height=H*SIGN_ROWS;const ctx=cv.getContext('2d');
 SHOP_NAMES.forEach(([name,bg,fg],k)=>{const x=(k%SIGN_COLS)*W,y=Math.floor(k/SIGN_COLS)*H;
  ctx.fillStyle=bg;ctx.fillRect(x,y,W,H);ctx.strokeStyle=fg;ctx.globalAlpha=.35;ctx.lineWidth=3;ctx.strokeRect(x+5,y+5,W-10,H-10);ctx.globalAlpha=1;
  ctx.fillStyle=fg;let size=34;ctx.font=`700 ${size}px Georgia,'Times New Roman',serif`;while(ctx.measureText(name).width>W-28&&size>14){size-=2;ctx.font=`700 ${size}px Georgia,'Times New Roman',serif`;}
  ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(name,x+W/2,y+H/2+2);});
 const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=4;tex.generateMipmaps=true;
 atlas=tex;return atlas;
}
// One material per building (the camera fade changes opacity per building); the texture is shared, and the
// signs glow softly after dark.
export function signMaterial(){
 const tex=signAtlasTexture(),m=new THREE.MeshStandardMaterial({map:tex,roughness:.6,emissive:'#ffffff',emissiveMap:tex,emissiveIntensity:.6});
 m.onBeforeCompile=sh=>{sh.uniforms.uNight=WEATHER_UNIFORMS.night;sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nuniform float uNight;').replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\ntotalEmissiveRadiance*=uNight;');};
 m.customProgramCacheKey=()=>'shop-sign';return m;
}
