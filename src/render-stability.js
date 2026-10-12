import * as THREE from 'three';

// Hold a building clear for a quarter second before restoring it. A camera ray
// grazing a corner must not alternate between solid and see-through each frame.
export function advanceOcclusion(state, blocked, dt) {
 state.clearTime=blocked?0:(state.clearTime||0)+dt;
 const target=blocked||state.clearTime<.25?.28:1;
 state.opacity=(state.opacity??1)+(target-(state.opacity??1))*(1-Math.exp(-dt*5));
 if(Math.abs(state.opacity-target)<.001)state.opacity=target;
 return state.opacity;
}

// Snap in LIGHT space, not world x/z: texels stay fixed on stationary geometry
// while the chase camera and its shadow coverage travel through the city.
// The basis follows the sun: time-of-day looks move it, and a basis built for
// midday would let shadows swim under a low evening sun.
const DEFAULT_OFFSET=new THREE.Vector3(-160,260,160);
const bases=new Map();
function basisFor(offset){
 const o=offset||DEFAULT_OFFSET,key=`${o.x.toFixed(3)},${o.y.toFixed(3)},${o.z.toFixed(3)}`;
 let basis=bases.get(key);
 if(!basis){const matrix=new THREE.Matrix4().lookAt(new THREE.Vector3(o.x,o.y,o.z),new THREE.Vector3(),new THREE.Vector3(0,1,0));basis={matrix,inverse:matrix.clone().invert()};if(bases.size>64)bases.clear();bases.set(key,basis);}
 return basis;
}
// `size` is the shadow box side in metres, or {width,height} when the box is not square.
export function stableShadowTarget(focus, size=460, resolution=2048, out=new THREE.Vector3(), offset=null) {
 const {matrix,inverse}=basisFor(offset);
 const width=typeof size==='number'?size:size.width,height=typeof size==='number'?size:size.height;
 const tx=width/resolution,ty=height/resolution;
 out.set(focus.x,focus.y||0,focus.z).applyMatrix4(inverse); // y: ground level on hilly terrain
 out.x=Math.round(out.x/tx)*tx;out.y=Math.round(out.y/ty)*ty;
 return out.applyMatrix4(matrix);
}

// Ortho shadow box per sun elevation. Light-space height covers `halfWidth` of ground along the
// sun's azimuth plus casters up to `casterHeight`; a low sun would otherwise stretch the same
// 2048 texels over kilometres of ground. Normal bias grows as the light grazes surfaces.
export function shadowFrame(offset,{halfWidth=200,casterHeight=45,minHalfHeight=110}={}){
 const o=offset||DEFAULT_OFFSET,elevation=Math.atan2(o.y,Math.hypot(o.x,o.z)||1e-6),sinE=Math.sin(elevation),cosE=Math.cos(elevation);
 const halfHeight=Math.min(halfWidth,Math.max(minHalfHeight,halfWidth*sinE+casterHeight*cosE));
 return {elevation,halfWidth,halfHeight,normalBias:.25+.5*(1-sinE),groundTexel:{across:halfWidth*2/2048,along:halfHeight*2/2048/Math.max(sinE,.05)}};
}
