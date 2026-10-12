import {WEATHER_UNIFORMS} from './weather.js';
// Lit windows after dark: about half of all window glass glows warm when the night look is on
// (WEATHER_UNIFORMS.night). Which windows are lit is a hash of a ~2 x 3 m world cell, so a window stays lit
// or dark as you move, and neighbours differ like real flats do. Zero cost in daylight (uNight = 0).
export function litWindows(material){
 const prev=material.onBeforeCompile;
 material.onBeforeCompile=(shader,renderer)=>{prev?.(shader,renderer);
  shader.uniforms.uNight=WEATHER_UNIFORMS.night;
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vLitCell;').replace('#include <project_vertex>','#include <project_vertex>\nvLitCell=floor((modelMatrix*vec4(transformed,1.)).xyz*vec3(.45,.34,.45));');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nuniform float uNight;varying vec3 vLitCell;')
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n{float h=fract(sin(dot(vLitCell,vec3(12.9898,78.233,37.719)))*43758.5453);float on=step(.48,h)*uNight;vec3 warm=mix(vec3(1.,.66,.33),vec3(1.,.86,.62),fract(h*7.3));totalEmissiveRadiance+=warm*on*(.9+.6*fract(h*13.1));}');
 };
 material.customProgramCacheKey=()=>'lit-windows';
 return material;
}
