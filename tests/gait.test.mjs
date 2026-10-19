import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {horseGeometry,wheelGeometry,stepMotion,withAttributes,ROLL_WRAP} from '../src/copenhagen/gait.js';

// The shipped one-mesh models (scripts/models/*.py), parsed the way the game does (gzipped GLB).
async function model(path){
 const bytes=gunzipSync(readFileSync(new URL('../public/models/'+path,import.meta.url)));
 const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
 let geometry=null;gltf.scene.traverse(o=>{if(o.isMesh&&!geometry)geometry=o.geometry;});
 return {geometry,extras:gltf.parser.json.meshes[0].extras||{}};
}

test('the armoured horse has its legs marked and its pivots, and becomes a trotting horse with a tinted coat',async()=>{
 const {geometry,extras}=await model('carriage/armored-horse.glb.gz');
 assert.ok(geometry.attributes._leg&&geometry.attributes.color,'leg weights and baked colours');
 assert.ok(extras.front.hip[0]>extras.front.knee[0]&&extras.hind.hip[0]>extras.hind.knee[0],'hips above knees');
 const box=new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
 assert.ok(Math.abs(box.min.y)<.02&&box.max.z-box.min.z>2.3&&box.max.z-box.min.z<2.7,'hooves on the ground, 2.5 m long');
 const plain=horseGeometry(geometry,extras,{x:-.62,z:-3.25}),dark=horseGeometry(geometry,extras,{x:.62,z:-3.25,coat:.55,offset:.9});
 const a=plain.attributes.anim,legs=new Set();let swing=0;
 for(let i=0;i<a.count;i++)if(a.getX(i)===1){swing++;legs.add(a.getY(i).toFixed(3));}
 assert.ok(swing>1000,`leg vertices ${swing}`);assert.equal(legs.size,2,'two phases: diagonal pairs trot together');
 let lighter=0,n=0;for(let i=0;i<plain.attributes.color.count;i+=97){n++;if(dark.attributes.color.getX(i)<plain.attributes.color.getX(i)-1e-6)lighter++;}
 assert.ok(lighter>n*.3&&lighter<n,'only the coat is darker on the off horse, not the tack');
});

test('the carriage marks its wheels per part, and they turn about their own axles',async()=>{
 const {geometry,extras}=await model('carriage/brougham.glb.gz');
 assert.equal(extras.wheels.length,4);assert.ok(geometry.attributes._wheel,'wheel parts marked');
 const g=wheelGeometry(geometry.toNonIndexed(),extras.wheels),a=g.attributes.anim,p=g.attributes.pivot,pos=g.attributes.position,count=[0,0,0,0];
 for(let i=0;i<a.count;i++)if(a.getX(i)===2){ // a wheel: the one on its side (x) whose axle and radius it turns about
  const k=extras.wheels.findIndex(w=>Math.sign(w.x)===Math.sign(pos.getX(i))&&Math.abs(w.y-p.getX(i))<1e-4&&Math.abs(w.z-p.getY(i))<1e-4&&Math.abs(1/w.r-a.getY(i))<1e-4);count[k]++;}
 assert.ok(count.every(c=>c>1000),`each wheel turns as a whole: ${count}`);assert.ok(!g.attributes._wheel,'the marker is dropped');
});

test('the coachman and the nisse carry their colours (the nisse may be textured), at their size',async()=>{
 const man=await model('carriage/coachman.glb.gz'),b=new THREE.Box3().setFromBufferAttribute(man.geometry.attributes.position);
 assert.ok(man.geometry.attributes.color&&b.max.y>1.2&&b.max.y<1.45&&b.min.z<-.4,'seated: 1.3 m to the hat, knees forward (-Z)');
 // the nisse may be textured (the pig-tails gnome): read its glTF JSON, as Node cannot decode the image
 const nb=gunzipSync(readFileSync(new URL('../public/models/nisse.glb.gz',import.meta.url))),nj=JSON.parse(nb.subarray(20,20+nb.readUInt32LE(12)).toString());
 const prim=nj.meshes[0].primitives[0],pos=nj.accessors[prim.attributes.POSITION],mat=nj.materials?.[prim.material];
 assert.ok(prim.attributes.COLOR_0!=null||prim.attributes.TEXCOORD_0!=null&&mat?.pbrMetallicRoughness?.baseColorTexture,'vertex-coloured or textured');
 assert.ok(Math.abs(pos.max[1]-1)<.02&&Math.abs(pos.min[1])<.02,'a 1 m nisse standing on y=0 (the game scales it)');
});

test('gait motion: the trot quickens and grows with speed, the wheels roll the distance, angles stay small',()=>{
 const m={phase:0,amp:0,roll:0};
 for(let i=0;i<60;i++)stepMotion(m,7,1/30);
 assert.ok(m.phase>18&&m.phase<22,`about 1.6 strides a second at 7 m/s: ${m.phase.toFixed(1)}`);assert.ok(m.amp>.3&&m.amp<=.38);assert.ok(Math.abs(m.roll-14)<1e-6);
 const still={phase:3,amp:.38,roll:5};for(let i=0;i<120;i++)stepMotion(still,0,1/30);assert.equal(still.phase,3,'standing: no gait');assert.ok(still.amp<.01,'legs come to rest');
 const far={phase:0,amp:0,roll:ROLL_WRAP-.5};stepMotion(far,15,1/30);assert.ok(far.roll<1,'distance wraps at a whole number of turns of both wheels');
 assert.ok(Math.abs(ROLL_WRAP/.62/(2*Math.PI)-Math.round(ROLL_WRAP/.62/(2*Math.PI)))<1e-9&&Math.abs(ROLL_WRAP/.44/(2*Math.PI)-Math.round(ROLL_WRAP/.44/(2*Math.PI)))<1e-9);
});

test('parts of a coach get the same attributes so they merge',()=>{
 const g=withAttributes(new THREE.BoxGeometry(1,1,1).toNonIndexed());
 assert.deepEqual(Object.keys(g.attributes).sort(),['anim','color','normal','pivot','position','uv']);
 assert.equal(g.attributes.color.getX(0),1,'white where a texture colours it');
});
