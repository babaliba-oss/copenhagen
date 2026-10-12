// Photo-estimated 2.4 m retaining-wall drop, not surveyed terrain heights.
// This strip is on the port side of the measured public railing.
export const YARD_DEPTH=2.4;
export const yardWest=z=>110+(z-742)*.738+.5;
export const YARD_RING=[[yardWest(720),720],[yardWest(900),900],[yardWest(900)+35,900],[yardWest(720)+35,720]];
export const inLowerYard=(x,z)=>z>720&&z<900&&x>yardWest(z)&&x<yardWest(z)+35;
export function cutLowerYard(material){
 const original=material.onBeforeCompile.bind(material),cache=material.customProgramCacheKey.bind(material);
 material.onBeforeCompile=shader=>{original(shader);shader.vertexShader='varying vec3 vYardWorld;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvYardWorld=(modelMatrix*vec4(position,1.0)).xyz;');shader.fragmentShader='varying vec3 vYardWorld;\n'+shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
 float yardWest=110.0+(vYardWorld.z-742.0)*0.738+0.5;
#ifndef NO_PORT_YARD
 if(vYardWorld.y > -1.0 && vYardWorld.y < 0.15 && vYardWorld.z>720.0 && vYardWorld.z<900.0 && vYardWorld.x>yardWest && vYardWorld.x<yardWest+35.0)discard;
#endif
 `);};material.customProgramCacheKey=()=>cache()+'-lower-port-yard';material.needsUpdate=true;
}
