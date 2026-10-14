import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {cutLowerYard} from './port-yard.js';
export function createLandcover(data){
 const g=new THREE.Group(),geometries=[];
 const polygons=data.polygons||data.runs.map(([x,z,w,d])=>[[[x,z],[x+w,z],[x+w,z+d],[x,z+d],[x,z]]]);
 for(const rings of polygons){const shape=new THREE.Shape(rings[0].map(([x,z])=>new THREE.Vector2(x,-z)));for(const ring of rings.slice(1))shape.holes.push(new THREE.Path(ring.map(([x,z])=>new THREE.Vector2(x,-z))));const p=new THREE.ShapeGeometry(shape).toNonIndexed();p.rotateX(-Math.PI/2);p.translate(0,.019,0);geometries.push(p);}
 // Scanned lawn (ambientCG Grass005, CC0): ShapeGeometry UVs are metres, so a 2.5 m repeat.
 const L=typeof document!=='undefined'?new THREE.TextureLoader():null,tex=(f,srgb)=>{if(!L)return null;const t=L.load(`/materials/${f}`);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(.4,.4);t.anisotropy=8;if(srgb)t.colorSpace=THREE.SRGBColorSpace;return t;};
 const map=tex('grass-color.jpg',true),normalMap=tex('grass-normal.jpg',false);
 const mat=new THREE.MeshStandardMaterial({color:map?'#9fa98a':'#718164',map,normalMap,normalScale:new THREE.Vector2(.6,.6),roughness:1});
 mat.onBeforeCompile=shader=>{shader.vertexShader='varying vec3 vPlanting;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPlanting=position;');shader.fragmentShader='varying vec3 vPlanting;\n'+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 diffuseColor.rgb*=0.93+0.055*sin(vPlanting.x*0.37)+0.035*cos(vPlanting.z*0.53);
 `);};
 cutLowerYard(mat);
 if(geometries.length){const m=new THREE.Mesh(mergeGeometries(geometries),mat);m.receiveShadow=true;g.add(m);geometries.forEach(p=>p.dispose());}
 g.name='Photo-inferred planting ground — rendered geometry, not image tiles';g.userData.polygons=polygons.length;return g;
}
