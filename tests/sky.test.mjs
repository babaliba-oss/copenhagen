import {mainSource} from './helpers/main-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {createSky,skyGradientWeights,skyColorAt,SUN_OFFSET,SUN_DIRECTION,SKY_PALETTE,FOG_COLOR,SKY_RADIUS,LIGHTING} from '../src/sky.js';

test('sky gradient weights are finite, normalised and run horizon -> zenith',()=>{
 for(const e of [-1,-.2,0,.01,.1,.22,.5,.9,1,2,NaN,Infinity]){
  const w=skyGradientWeights(e),sum=w.horizon+w.mid+w.zenith;
  for(const v of Object.values(w)){assert.ok(Number.isFinite(v)&&v>=0&&v<=1,`${e}: ${v}`);}
  assert.ok(Math.abs(sum-1)<1e-9);
 }
 assert.equal(skyGradientWeights(0).horizon,1);assert.equal(skyGradientWeights(-.5).horizon,1);
 assert.ok(skyGradientWeights(1).zenith>.99);
});

test('horizon pixel equals the fog colour and the zenith is a deeper blue',()=>{
 const horizon=skyColorAt(0),zenith=skyColorAt(1),fog=new THREE.Color(FOG_COLOR);
 assert.equal(horizon.getHexString(),fog.getHexString());
 assert.ok(zenith.b>zenith.r+.25&&zenith.b>zenith.g,'zenith should be clearly blue');
 const lum=c=>.2126*c.r+.7152*c.g+.0722*c.b;
 assert.ok(lum(horizon)>lum(zenith),'horizon haze is brighter than the zenith');
 let prev=Infinity;for(let e=0;e<=1;e+=.05){const l=lum(skyColorAt(e));assert.ok(Number.isFinite(l));assert.ok(l<=prev+1e-6,'brightness falls monotonically with elevation');prev=l;}
});

test('sun direction is the shadow light offset used in main.js',()=>{
 assert.deepEqual([...SUN_OFFSET],[-160,260,160]);
 assert.ok(Math.abs(SUN_DIRECTION.length()-1)<1e-9&&SUN_DIRECTION.y>0);
 const main=mainSource;
 // The light sits at target + the active look's sun offset (weather.js; midday = SUN_OFFSET); the shadow box is snapped in that basis.
 assert.match(main,/sun\.position\.copy\(sun\.target\.position\)\.add\(sunOffset\)/);assert.match(main,/new THREE\.Vector3\(-160,260,160\)/);
 assert.match(main,/createSky\(/);
});

test('sky dome is one unlit draw that follows any camera and sets matching fog',()=>{
 const scene=new THREE.Scene();scene.fog=new THREE.Fog('#b9cbd4',330,850);
 const camera=new THREE.PerspectiveCamera(58,1.5,.25,1500);
 const sky=createSky({scene,camera});
 assert.equal(scene.children.filter(o=>o.isMesh).length,1);
 const {mesh,material}=sky;
 assert.equal(material.depthWrite,false);assert.equal(material.fog,false);assert.equal(material.toneMapped,false);assert.equal(material.side,THREE.BackSide);
 assert.equal(mesh.frustumCulled,false);assert.equal(mesh.castShadow,false);assert.ok(mesh.renderOrder<-1000);
 assert.ok(SKY_RADIUS<camera.far*.9,'dome must sit inside the far plane');
 assert.equal(scene.fog.color.getHex(),new THREE.Color(FOG_COLOR).getHex());assert.equal(scene.fog.near,330);assert.equal(scene.fog.far,850);
 for(const pos of [[0,3,0],[812.5,140,-640.25],[-1200,40,900]]){
  camera.position.set(...pos);camera.updateMatrixWorld();
  mesh.onBeforeRender(null,scene,camera);
  const p=new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
  assert.ok(p.distanceTo(camera.position)<1e-6);
  for(const u of Object.values(sky.uniforms)){const v=u.value;const nums=typeof v==='number'?[v]:v.toArray();assert.ok(nums.every(Number.isFinite));}
 }
 assert.ok(sky.uniforms.uSunDir.value.equals(SUN_DIRECTION));
 for(const hex of Object.values(SKY_PALETTE))assert.match(hex,/^#[0-9a-f]{6}$/i);
});

test('lighting retune stays modest and bright but not blown out',()=>{
 const hemi=new THREE.HemisphereLight(),sun=new THREE.DirectionalLight();
 createSky({}).applyLighting(hemi,sun);
 assert.ok(hemi.intensity>=1.1&&hemi.intensity<=1.6);assert.ok(sun.intensity>=1.8&&sun.intensity<=2.6);
 assert.ok(sun.color.r>=sun.color.b,'sun is warm');assert.ok(hemi.color.b>=hemi.color.r,'sky fill is cool');
 assert.equal(hemi.color.getHex(),new THREE.Color(LIGHTING.hemiSky).getHex());
});
