import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {WEATHER_UNIFORMS} from '../src/weather.js';
import {setCarriageModels,createCarriage,lanternSpots} from '../src/copenhagen/carriage.js';

async function model(path){
 const bytes=gunzipSync(readFileSync(new URL('../public/models/'+path,import.meta.url)));
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 let geometry=null;gltf.scene.traverse(o=>{if(o.isMesh&&!geometry)geometry=o.geometry;});
 return {geometry,extras:gltf.parser.json.meshes[0].extras||{}};
}

test('the 1760 player coach carries two lanterns on the front corners of its cab, lit only at night',async()=>{
 const brougham=await model('carriage/brougham.glb.gz'),horse=await model('carriage/armored-horse.glb.gz');
 const spots=lanternSpots(brougham.geometry,brougham.extras.box),p=brougham.geometry.attributes.position,box=new THREE.Box3().setFromBufferAttribute(p);
 // the cab: what stands higher than the box seat by more than 45 cm behind it
 let cabFront=Infinity,cabSide=0;for(let i=0;i<p.count;i++)if(p.getY(i)>brougham.extras.box[1]+.45&&p.getZ(i)>brougham.extras.box[2])cabFront=Math.min(cabFront,p.getZ(i));
 for(let i=0;i<p.count;i++)if(p.getZ(i)>=cabFront&&p.getZ(i)<cabFront+.4&&p.getY(i)>1.1&&p.getY(i)<1.75)cabSide=Math.max(cabSide,Math.abs(p.getX(i)));
 assert.equal(spots.length,2);assert.ok(spots[0][0]<0&&spots[1][0]>0&&Math.abs(spots[0][0]+spots[1][0])<1e-9,'one each side');
 for(const [x,y,z] of spots){
  assert.ok(Math.abs(x)-.065>cabSide-.02&&Math.abs(x)-.065<cabSide+.04,`against the cab's side (lamp inner edge ${(Math.abs(x)-.065).toFixed(3)}, cab ${cabSide.toFixed(3)})`);
  assert.ok(Math.abs(x)+.065<box.max.x+.1,'not sticking out past the hubs');
  assert.ok(z>cabFront&&z<cabFront+.25,`at the cab's front (${z.toFixed(2)} by ${cabFront.toFixed(2)})`);
  assert.ok(y>brougham.extras.box[1]&&y<box.max.y-.35,`above the box seat (${brougham.extras.box[1].toFixed(2)}), under the roof (${box.max.y.toFixed(2)}): ${y.toFixed(2)}`);}
 setCarriageModels({armoured:{geometry:horse.geometry,pivots:horse.extras},brougham:{geometry:brougham.geometry,extras:brougham.extras,texture:new THREE.Texture()}});
 try{
  const coach=createCarriage(),lamps=coach.getObjectByName('Coach lanterns'),glass=coach.getObjectByName('Coach lantern glass'),pool=coach.getObjectByName('Coach lantern light');
  assert.ok(lamps&&glass&&pool,'lantern bodies, glass and light pool');
  const at=new THREE.Box3().setFromObject(glass);assert.ok(Math.abs(at.max.x-(spots[1][0]+.05))<1e-6&&Math.abs(at.min.z-(spots[0][2]-.05))<1e-6,'glass where the spots are');
  for(const [night,lit] of [[0,false],[.4,false],[1,true]]){WEATHER_UNIFORMS.night.value=night;coach.userData.update(0,1/60);
   assert.equal(pool.visible,lit,`pool at night ${night}`);assert.equal(glass.material.emissiveIntensity>0,lit,`glow at night ${night}`);}
  assert.ok(pool.material.opacity<.4,'dim: a faint pool');
  assert.equal(createCarriage({lanterns:false}).getObjectByName('Coach lanterns'),undefined,'traffic coaches carry none');
 }finally{WEATHER_UNIFORMS.night.value=0;setCarriageModels(null);}
});
