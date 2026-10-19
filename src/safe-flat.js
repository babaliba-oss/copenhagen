import * as THREE from 'three';

// Flat shading takes each pixel's normal from the screen-space derivatives of its position. On a sliver of a triangle
// (a far person's finger, a distant gable seen edge-on) those can be parallel, and normalize(0) is NaN on some GPUs
// (Apple's among them): one NaN pixel, spread by the bloom and AO blurs, shows as a black square. This keeps the
// normal finite: where the derivatives give none it faces the camera.
const SAFE=THREE.ShaderChunk.normal_fragment_begin.replace('vec3 normal = normalize( cross( fdx, fdy ) );','vec3 flatN = cross( fdx, fdy );\n\tvec3 normal = dot( flatN, flatN ) > 1e-24 ? normalize( flatN ) : vec3( 0.0, 0.0, 1.0 );');
export function safeFlatShading(material){
 const before=material.onBeforeCompile,key=material.customProgramCacheKey;
 material.onBeforeCompile=function(shader,renderer){before.call(this,shader,renderer);shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_begin>',SAFE);};
 material.customProgramCacheKey=function(){return key.call(this)+'|safe-flat';};
 return material;
}
