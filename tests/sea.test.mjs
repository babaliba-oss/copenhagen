import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createSea,removeLegacyWater,createSeaMaterial,createRippleTexture,WATER_LEVEL} from '../src/sea.js';
import {clearPlayableAreas,registerPlayableArea,insidePlayable} from '../src/geo.js';
test('legacy water triangles are removed without lifting the sea or deleting quays',()=>{
 const g=new THREE.BufferGeometry(),vertices=[];
 for(const y of [.01,.035,.07,.01])vertices.push(0,y,0,1,y,0,0,y,1);
 g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));removeLegacyWater(g);
 assert.deepEqual([...g.index.array],[3,4,5,6,7,8]);
 removeLegacyWater(g);assert.deepEqual([...g.index.array],[3,4,5,6,7,8]);
});

test('sea sits below street level, preserves boundaries and island holes with upward faces',()=>{
 const sea=createSea([{rings:[[[0,0],[10,0],[10,10],[0,10]],[[4,4],[6,4],[6,6],[4,6]]]}]);
 const mesh=sea.group.getObjectByName('Sea surface');assert.ok(mesh);
 assert.ok(WATER_LEVEL<=-1&&WATER_LEVEL>=-1.5,'Kauppatori water is roughly 1.2 m below the quay');
 const g=mesh.geometry,p=g.attributes.position;let area=0;
 for(let i=0;i<p.count;i+=3){
  const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);
  const cross=b.clone().sub(a).cross(c.clone().sub(a));assert.ok(cross.y>0);area+=cross.length()/2;
  const x=(a.x+b.x+c.x)/3,z=(a.z+b.z+c.z)/3;assert.ok(!(x>4&&x<6&&z>4&&z<6));
 }
 assert.ok(Math.abs(area-96)<1e-5);
 for(let i=0;i<p.count;i++)assert.ok(Math.abs(p.getY(i)-WATER_LEVEL)<1e-6);
 assert.equal(sea.group.userData.surfaceHeight,WATER_LEVEL);
 assert.ok(sea.group.children.filter(m=>m.name!=='Granite quay walls').length<=3,'water stays within three draw calls (plus quay culling cells)');
});

test('sea animates only a shader uniform, without changing mesh or uploading vertices',()=>{
 const sea=createSea([{rings:[[[0,0],[10,0],[0,10]]]}]),mesh=sea.group.getObjectByName('Sea surface');
 const version=mesh.geometry.attributes.position.version;
 sea.update(123);assert.equal(mesh.material.uniforms.uSeaTime.value,123);sea.update(NaN);assert.equal(mesh.material.uniforms.uSeaTime.value,123);
 assert.equal(mesh.geometry.attributes.position.version,version);
});

test('water shader: Fresnel sky reflection, multi-scale ripples, sun glint and fog',()=>{
 const m=createSeaMaterial();
 assert.ok(m.isShaderMaterial);assert.equal(m.fog,true);
 for(const u of ['uRipples','uSeaTime','uDeep','uSkyHorizon','uSkyZenith','uSunDir','uSunColor','fogColor','fogNear','fogFar'])assert.ok(u in m.uniforms,u);
 const f=m.fragmentShader;
 assert.match(f,/fresnel=.*pow\(1\.-NdV,5\.\)/);
 assert.match(f,/vec3 deep=uDeep/);assert.match(f,/mix\(deep,sky\*[\d.]+,fresnel\*uReflect/);
 assert.equal((f.match(/texture2D\(uRipples/g)||[]).length,5,'three ripple scales and two wind-gust samples');
 assert.match(f,/dot\(R,uSunDir\)/);
 assert.match(f,/#include <fog_fragment>/);assert.match(f,/#include <tonemapping_fragment>/);
 assert.doesNotMatch(f,/sin\(dot\(/,'no analytic sine stripes');
 // Dark Baltic water, clearly darker than the hazy sky.
 const deep=m.uniforms.uDeep.value,sky=m.uniforms.uSkyHorizon.value;
 assert.ok(deep.r+deep.g+deep.b<(sky.r+sky.g+sky.b)*.2);assert.ok(deep.g>=deep.r);
 const sun=m.uniforms.uSunDir.value;assert.ok(Math.abs(sun.length()-1)<1e-6&&sun.y>0);
});

test('sea follows scene fog colour and sun light, or an explicit sky',()=>{
 const sea=createSea([{rings:[[[0,0],[10,0],[0,10]]]}]),mesh=sea.group.getObjectByName('Sea surface'),u=mesh.material.uniforms;
 const scene=new THREE.Scene();scene.fog=new THREE.Fog('#ff8800',10,100);
 const sun=new THREE.DirectionalLight();sun.position.set(10,20,0);scene.add(sun,sun.target,sea.group);
 mesh.onBeforeRender(null,scene);
 assert.ok(u.uSkyHorizon.value.equals(scene.fog.color));
 assert.ok(u.uSunDir.value.distanceTo(new THREE.Vector3(10,20,0).normalize())<1e-6);
 sea.setSky('#223344');assert.equal(u.uSkyHorizon.value.getHexString(),'223344');mesh.onBeforeRender(null,scene);assert.equal(u.uSkyHorizon.value.getHexString(),'223344');
});

test('ripple texture is tileable, mipmapped and centred around a flat normal',()=>{
 const t=createRippleTexture(32);
 assert.equal(t.wrapS,THREE.RepeatWrapping);assert.equal(t.generateMipmaps,true);
 const d=t.image.data;let sx=0,sz=0;for(let i=0;i<d.length;i+=4){sx+=d[i]-127.5;sz+=d[i+1]-127.5;}
 assert.ok(Math.abs(sx/(d.length/4))<3&&Math.abs(sz/(d.length/4))<3);
 const vals=new Set();for(let i=0;i<d.length;i+=4)vals.add(d[i]);assert.ok(vals.size>40,'not a flat or banded texture');
});

test('sea ground can cover a pending region without opening its playable boundary',()=>{
 clearPlayableAreas();
 const sea=createSea([],{},{helsinkiHarbour:false,groundExtent:8500});sea.groundGeometry.computeBoundingBox();
 assert.equal(sea.groundGeometry.boundingBox.max.x,10000);
 assert.equal(sea.groundGeometry.boundingBox.min.x,-10000);
 assert.equal(insidePlayable(8000,0),false,'geometry creation never registers a playable area');
 sea.groundGeometry.dispose();sea.material.uniforms.uRipples.value.dispose();sea.material.dispose();
});

test('a subsequent smaller region never shrinks ground beneath an activated outer region',()=>{
 clearPlayableAreas();registerPlayableArea([[[[8000,0],[9000,0],[9000,100],[8000,100],[8000,0]]]]);
 try{
  const sea=createSea([],{},{helsinkiHarbour:false,groundExtent:3000});sea.groundGeometry.computeBoundingBox();
  assert.equal(sea.groundGeometry.boundingBox.max.x,10500);assert.equal(insidePlayable(8500,50),true);
  sea.groundGeometry.dispose();sea.material.uniforms.uRipples.value.dispose();sea.material.dispose();
 }finally{clearPlayableAreas();}
});
