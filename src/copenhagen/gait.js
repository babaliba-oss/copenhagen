import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

// Vertex-shader animation for the 1760 coaches: the horses trot and the wheels turn on the GPU, so the player's coach and
// every coach in traffic share one merged geometry (one draw per batch) instead of separate swinging parts.
//   anim   (per vertex): type (0 still, 1 leg, 2 wheel); leg: phase offset, swing weight, knee weight (signed: + hoof
//          forward, - hoof back); wheel: 1/radius
//   pivot  (per vertex): leg: shoulder/hip y,z and knee/hock y,z; wheel: axle y,z
//   motion (per instance): gait phase (rad), swing amplitude (rad), distance rolled (m)
// A leg swings about its shoulder or hip by amplitude*sin(phase) (times its weight, so it blends into the body), and
// while it swings forward the knee folds the hoof back (the hock brings a hind hoof forward).
const GLSL=`
attribute vec4 anim;attribute vec4 pivot;attribute vec3 motion;
mat3 gaitRotX(float a){float c=cos(a),s=sin(a);return mat3(1.,0.,0.,0.,c,s,0.,-s,c);}
void gaitPose(out mat3 A,out vec3 a0,out mat3 B,out vec3 b0){
 A=mat3(1.);B=mat3(1.);a0=vec3(0.);b0=vec3(0.);
 if(anim.x>1.5){A=gaitRotX(-motion.z*anim.y);a0=vec3(0.,pivot.x,pivot.y);}
 else if(anim.x>.5){float ph=motion.x+anim.y;A=gaitRotX(motion.y*sin(ph)*anim.z);a0=vec3(0.,pivot.x,pivot.y);
  B=gaitRotX(motion.y*1.6*max(0.,cos(ph))*anim.w);b0=vec3(0.,pivot.z,pivot.w);}
}
vec3 gaitPosition(vec3 p){mat3 A,B;vec3 a0,b0;gaitPose(A,a0,B,b0);return A*(B*(p-b0)+b0-a0)+a0;}
vec3 gaitNormal(vec3 n){mat3 A,B;vec3 a0,b0;gaitPose(A,a0,B,b0);return A*(B*n);}
`;
export function gaitMaterial(material){
 material.onBeforeCompile=s=>{s.vertexShader=GLSL+s.vertexShader
  .replace('#include <beginnormal_vertex>','vec3 objectNormal=gaitNormal(normal);\n#ifdef USE_TANGENT\nvec3 objectTangent=vec3(tangent.xyz);\n#endif')
  .replace('#include <begin_vertex>','vec3 transformed=gaitPosition(position);\n#ifdef USE_ALPHAHASH\nvPosition=vec3(position);\n#endif');};
 material.customProgramCacheKey=()=>'coach-gait';
 return material;
}
// The depth material for the shadow map, so the shadows trot too.
export function gaitDepthMaterial(){return gaitMaterial(new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking}));}

// Leg phase offsets: a trot moves diagonal pairs together (near fore with off hind).
const TROT=[0,Math.PI,Math.PI,0];
// One horse from the armored-horse.glb geometry (non-indexed copy, `_leg` = leg, swing weight, knee weight, coat), placed at
// (x, 0, z) in the coach's frame; `coat` scales the coat colour (the pair differ), `offset` shifts its gait phase.
export function horseGeometry(src,pivots,{x=0,z=0,coat=1,offset=0}={}){
 const g=(src.index?src.toNonIndexed():src.clone()),n=g.attributes.position.count,leg=g.attributes._leg,col=g.attributes.color;
 const anim=new Float32Array(n*4),piv=new Float32Array(n*4);
 for(let i=0;i<n;i++){const l=leg?Math.round(leg.getX(i)):-1;
  if(l>=0){const p=l<2?pivots.front:pivots.hind;anim.set([1,TROT[l]+offset,leg.getY(i),leg.getZ(i)*(l<2?-1:1)],i*4);piv.set([p.hip[0],p.hip[1]+z,p.knee[0],p.knee[1]+z],i*4);}
  if(col&&leg&&coat!==1&&leg.getW(i)>.5)col.setXYZ(i,col.getX(i)*coat,col.getY(i)*coat,col.getZ(i)*coat);}
 if(leg)g.deleteAttribute('_leg');
 g.setAttribute('anim',new THREE.BufferAttribute(anim,4));g.setAttribute('pivot',new THREE.BufferAttribute(piv,4));g.translate(x,0,z);
 if(!g.attributes.color){const c=new Float32Array(n*3).fill(.4);g.setAttribute('color',new THREE.BufferAttribute(c,3));}
 return g;
}
// Mark a coach geometry's wheels (non-indexed): every triangle inside one of `wheels` [{x, y, z, r}] (y, z: the axle;
// x: the wheel's plane) turns about that axle. Everything else stands still.
export function wheelGeometry(g,wheels){
 const p=g.attributes.position,n=p.count,anim=new Float32Array(n*4),piv=new Float32Array(n*4),marked=g.attributes._wheel;
 if(marked){for(let i=0;i<n;i++){const w=wheels[Math.round(marked.getX(i))];if(w){anim.set([2,1/w.r,0,0],i*4);piv.set([w.y,w.z,0,0],i*4);}} // the model marks its wheels (brougham.py)
  g.deleteAttribute('_wheel');g.setAttribute('anim',new THREE.BufferAttribute(anim,4));g.setAttribute('pivot',new THREE.BufferAttribute(piv,4));return g;}
 for(let t=0;t<n;t+=3){let cx=0,cy=0,cz=0;for(let k=0;k<3;k++){cx+=p.getX(t+k)/3;cy+=p.getY(t+k)/3;cz+=p.getZ(t+k)/3;}
  const w=wheels.find(w=>Math.abs(cx-w.x)<(w.dx??.065)&&Math.hypot(cy-w.y,cz-w.z)<w.r+.06);if(!w)continue;
  for(let k=0;k<3;k++){anim.set([2,1/w.r,0,0],(t+k)*4);piv.set([w.y,w.z,0,0],(t+k)*4);}}
 g.setAttribute('anim',new THREE.BufferAttribute(anim,4));g.setAttribute('pivot',new THREE.BufferAttribute(piv,4));return g;
}
// Per-instance motion: phase advances with speed (a walk when slow, a brisk trot at 7 m/s), the swing grows with speed
// and the wheels roll the distance covered, up to ROLL_SPEED: the coach's wheels have about twenty spokes (18 degrees
// apart), so from 4.6 m/s (front, 0.49 m) and 6.6 m/s (rear, 0.7 m) a frame turned them half a spoke or more and they
// read as standing still or turning backwards (the wagon-wheel effect): at driving speeds the wheels looked static.
// Capped, they turn visibly forwards at any speed (under a third of a spoke a frame at 60 fps). Wrapped so the angles keep
// float precision, at a whole number of turns of the brougham's wheels (0.7 and 0.4875 m: 171.5 m).
export const ROLL_WRAP=2*Math.PI*.7*.4875*80,ROLL_SPEED=3;
export function stepMotion(m,speed,dt){const v=Math.min(Math.abs(speed),14);m.phase=(m.phase+dt*v*1.45)%(Math.PI*2000);m.amp+=(Math.min(.38,v*.065)-m.amp)*Math.min(1,dt*4);m.roll=(m.roll+Math.max(-ROLL_SPEED,Math.min(ROLL_SPEED,speed))*dt)%ROLL_WRAP;return m;}

// One-mesh models made by scripts/models/*.py: the geometry and the mesh's extras. Stored gzipped (Cloudflare serves .glb
// uncompressed), unzipped here. Null on failure (the caller keeps what it had).
export async function loadOneMesh(url){
 try{const r=await fetch(url);if(!r.ok)throw Error(`${url}: ${r.status}`);let bytes=await r.arrayBuffer();const m=new Uint8Array(bytes,0,2);
  if(m[0]===31&&m[1]===139)bytes=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const gltf=await new GLTFLoader().parseAsync(bytes,'');let geometry=null,map=null;gltf.scene.traverse(o=>{if(o.isMesh&&!geometry){geometry=o.geometry;map=o.material?.map||null;}});
  const json=gltf.parser.json;return geometry?{geometry,map,extras:json.meshes?.[0]?.extras||json.nodes?.[0]?.extras||{}}:null; // map: the mesh's base-colour texture, if it has one
 }catch(e){console.warn('Model not loaded, the old one kept:',url,e?.message||e);return null;}
}
// The armoured horse (armored-horse.glb.gz, scripts/models/armored_horse.py): colour and `_leg` per vertex, leg pivots in extras.
export async function loadArmouredHorse(url){const m=await loadOneMesh(url);return m?.extras?.front&&m.extras.hind?{geometry:m.geometry,pivots:m.extras}:null;}
// The coach body (brougham.glb.gz + its texture, scripts/models/brougham.py): wheels and the box seat in extras.
export async function loadBrougham(url,textureUrl){
 const [m,texture]=await Promise.all([loadOneMesh(url),new THREE.TextureLoader().loadAsync(textureUrl).catch(()=>null)]);
 if(!m?.extras?.wheels||!texture)return null;texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 return {geometry:m.geometry,extras:m.extras,texture};
}
// The coachman (coachman.glb.gz): a seated figure with vertex colours, origin where he sits, facing -Z.
export async function loadCoachman(url){const m=await loadOneMesh(url);return m?.geometry?.attributes?.color?{geometry:m.geometry,extras:m.extras}:null;}

// Give a geometry the attributes every part of a merged coach has: uv (the textured body's) and color (white where
// the texture does the colouring), so mergeGeometries accepts them together.
export function withAttributes(g,{uv=true,color=[1,1,1]}={}){
 const n=g.attributes.position.count;
 if(uv&&!g.attributes.uv)g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(n*2),2));
 if(!g.attributes.color){const c=new Float32Array(n*3);for(let i=0;i<c.length;i+=3)c.set(color,i);g.setAttribute('color',new THREE.BufferAttribute(c,3));}
 if(!g.attributes.anim){g.setAttribute('anim',new THREE.BufferAttribute(new Float32Array(n*4),4));g.setAttribute('pivot',new THREE.BufferAttribute(new Float32Array(n*4),4));}
 for(const k of Object.keys(g.attributes))if(!['position','normal','uv','color','anim','pivot'].includes(k))g.deleteAttribute(k);
 return g;
}
