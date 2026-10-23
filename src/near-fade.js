// Things right in front of the drive camera's lens dissolve: their pixels are discarded on an ordered dither between
// `to` and `from` metres from the camera (view-space distance), all of them inside `from`. Used in onBeforeCompile on
// lit materials (they carry vViewPosition); the shadow pass uses its own depth material, so shadows stay whole.
export function nearFade(shader,from,to){
 if(!shader.fragmentShader.includes('vViewPosition'))return shader;
 shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
 {float nearD=length(vViewPosition);if(nearD<${to.toFixed(2)}&&(nearD-${from.toFixed(2)})/${(to-from).toFixed(2)}<fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715)))))discard;}`);
 return shader;
}
