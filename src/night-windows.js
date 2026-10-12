import {WEATHER_UNIFORMS} from './weather.js';
// Lit windows after dark: about half of all window glass glows warm when the night look is on
// (WEATHER_UNIFORMS.night). Which windows are lit is a hash of a ~2 x 3 m world cell, so a window stays lit
// or dark as you move, and neighbours differ like real flats do. Zero cost in daylight (uNight = 0).
export function litWindows(material){
 const prev=material.onBeforeCompile;
 material.onBeforeCompile=(shader,renderer)=>{prev?.(shader,renderer);
  shader.uniforms.uNight=WEATHER_UNIFORMS.night;
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vLitCell;').replace('#include <project_vertex>','#include <project_vertex>\nvLitCell=(modelMatrix*vec4(transformed,1.)).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+(shader.fragmentShader.includes('uniform float uNight')?'':'uniform float uNight;')+'varying vec3 vLitCell;')
   .replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n{vec3 cell=floor(vLitCell*vec3(.38,.33,.38));float h=fract(sin(mod(dot(cell,vec3(1.,57.,113.)),997.)*1.371)*4375.85);float on=step(.48,h)*uNight;vec3 warm=mix(vec3(1.,.66,.33),vec3(1.,.86,.62),fract(h*7.3));totalEmissiveRadiance+=warm*on*(.5+.35*fract(h*13.1));}');
 };
 const key=material.customProgramCacheKey?.bind(material);material.customProgramCacheKey=()=>(key?key():'')+'|lit-windows';
 return material;
}
