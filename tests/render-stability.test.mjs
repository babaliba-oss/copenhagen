import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {advanceOcclusion,stableShadowTarget} from '../src/render-stability.js';
import {createSenateSquare} from '../src/cathedral.js';
import {HARBOUR_START} from '../src/demo-route.js';
import {SpatialIndex,pointInPolygon} from '../src/geo.js';
import {carSamples,makeCar} from '../src/physics.js';
import {createSourceShell} from '../src/building-loader.js';
const city=JSON.parse(gunzipSync(readFileSync('public/data/city.pack')));

test('building visibility fades gradually and holds through corner jitter',()=>{
 const s={opacity:1,clearTime:1};let previous=1;
 for(let i=0;i<80;i++){const value=advanceOcclusion(s,i%3!==0,1/60);assert.ok(value>=.18&&value<=1);assert.ok(Math.abs(value-previous)<.075);previous=value;}
 assert.ok(s.opacity<.3);for(let i=0;i<10;i++)advanceOcclusion(s,false,1/60);assert.ok(s.opacity<.3,'short clear interval must not flash opaque');
 for(let i=0;i<140;i++)advanceOcclusion(s,false,1/60);assert.equal(s.opacity,1);
});
test('shadow target is quantised to the light-space texel grid',()=>{
 const basis=new THREE.Matrix4().lookAt(new THREE.Vector3(-160,260,160),new THREE.Vector3(),new THREE.Vector3(0,1,0)).invert(),texel=460/2048;
 for(let i=0;i<20;i++){const p=stableShadowTarget({x:i*.023,z:i*.043}).applyMatrix4(basis);for(const v of [p.x,p.y])assert.ok(Math.abs(v/texel-Math.round(v/texel))<1e-10);}
});
test('Blender pavilions are valid bounded 3D GLB assets with physical detail',()=>{
 const b=readFileSync('public/models/senate-pavilions.glb');assert.equal(b.toString('utf8',0,4),'glTF');assert.equal(b.readUInt32LE(4),2);assert.equal(b.readUInt32LE(8),b.length);
 const gltf=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));assert.equal(gltf.meshes.length,14);assert.ok(!gltf.images?.length,'pavilion walls are modelled, not photo atlases');
 const roots=gltf.nodes.filter(n=>n.extras?.ratu);assert.deepEqual(roots.map(n=>n.extras.ratu).sort(),[212,213]);
 for(const n of roots){assert.ok(Math.abs(n.translation[0])<70);assert.ok(n.translation[2]>0&&n.translation[2]<30);}
 const triangles=gltf.meshes.flatMap(m=>m.primitives).reduce((s,p)=>s+gltf.accessors[p.indices].count/3,0);assert.ok(triangles>1000&&triangles<50000);
});
test('Senate paving preserves mapped section counts and monument enclosure collisions',()=>{
 const expected=city.pavement.filter(p=>p.name==='Senaatintori'&&p.kind==='Aukiot').length,square=createSenateSquare(city.pavement);
 assert.ok(expected>40);assert.equal(square.group.userData.mappedPavingSections,expected);const b=new SpatialIndex(square.obstacles);assert.ok(b.at(3,72.5));assert.ok(b.at(44,14));assert.equal(b.at(0,110),undefined);
});
test('harbour alternative starts on a public road with the full car clear of buildings and water',()=>{
 const b=new SpatialIndex(city.buildings),r=new SpatialIndex(city.roads.filter(p=>!/Koroke/.test(p.kind))),car=makeCar(HARBOUR_START.x,HARBOUR_START.z,HARBOUR_START.heading);
 assert.equal(r.at(car.x,car.z).name,'Laivasillankatu');for(const [x,z] of carSamples(car)){assert.ok(!b.at(x,z));assert.ok(!city.water.some(w=>pointInPolygon(x,z,w.rings)));}
});
test('cathedral site has asymmetric terraces and frees the east neighbouring courtyard',()=>{
 const square=createSenateSquare(),layout=square.group.userData.siteLayout,index=new SpatialIndex(square.obstacles);
 assert.ok(layout.lowerWest.height<8.4);assert.ok(layout.frontLanding>0);assert.ok(layout.westUpperSteps>0);assert.ok(index.at(-50,-35));assert.equal(index.at(50,-35),undefined,'do not cover east neighbouring buildings with a giant terrace');
});
test('source shell retains measured vertices and UVs independently of a transferred worker buffer',()=>{
 const a=new Float32Array([0,0,0,0,0,2,0,0,1,0,0,3,0,0,1]),texture=new THREE.Texture(),part={start:0,count:3,bbox:[0,0,2,1],height:3},mesh=createSourceShell(a,part,texture);
 assert.equal(mesh.geometry.attributes.position.count,3);assert.equal(mesh.geometry.attributes.uv.getX(1),1);assert.equal(mesh.material.map,texture);assert.equal(mesh.userData.shell,true);a.fill(99);assert.equal(mesh.geometry.attributes.position.getY(2),3);
});
