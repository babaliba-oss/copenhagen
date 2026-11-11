import {mainSource} from './helpers/main-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {pointInPolygon} from '../src/geo.js';
import {createMarketStreetSurface} from '../src/market-street-surface.js';
test('market granite follows municipal carriageway and leaves island holes intact',()=>{
 const data=JSON.parse(gunzipSync(readFileSync('public/data/city.pack'))),group=createMarketStreetSurface(data);
 assert.equal(group.children.length,1);assert.ok(group.userData.sourceRoadIds.length>0);
 const roads=data.roads.filter(p=>group.userData.sourceRoadIds.includes(p.id));
 const p=group.children[0].geometry.attributes.position,n=group.children[0].geometry.attributes.normal;
 for(let i=0;i<p.count;i+=3){
  const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3;
  assert.ok(roads.some(r=>pointInPolygon(x,z,r.rings)),'triangle stays inside source road, outside holes');
  assert.ok(n.getY(i)>.99);assert.ok(p.getY(i)<.095&&p.getY(i)>.075);
 }
 assert.ok(!roads.some(r=>pointInPolygon(89,245,r.rings)),'refuge is not paved as a carriageway');
});
import * as THREE from 'three';
import {GRANITE_SETTS_GLSL,addGraniteSetts} from '../src/market-street-surface.js';
import {cleanWaterfrontShell,CLEAN_WATERFRONT_SHELLS,createWaterfrontFront} from '../src/kauppatori-buildings.js';
test('granite setts shader is anisotropically filtered and patched into every sett material',()=>{
 assert.match(GRANITE_SETTS_GLSL,/vec3 graniteSetts\(vec2 xz,vec2 fp,float scale,out float gloss\)/);
 assert.doesNotMatch(GRANITE_SETTS_GLSL,/\bsin\(/,'no sine hash: it degrades at city-scale indices');
 assert.doesNotMatch(GRANITE_SETTS_GLSL,/dFd|fwidth/,'derivatives are taken by the caller in uniform control flow');
 const material=addGraniteSetts(new THREE.MeshStandardMaterial(),'setts-test',.8),shader={vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>\n#include <roughnessmap_fragment>'};
 material.onBeforeCompile(shader);
 assert.match(shader.fragmentShader,/graniteSetts\(vStreetStone,settFp,0\.800,settGloss\)/);
 assert.match(shader.fragmentShader,/roughnessFactor\*=1\.-settGloss/);assert.match(shader.vertexShader,/modelMatrix/);
 assert.equal(material.customProgramCacheKey(),'setts-test');
 const main=mainSource;assert.match(main,/GRANITE_SETTS_GLSL\+shader\.fragmentShader/);
 assert.match(readFileSync('src/kauppatori.js','utf8'),/addGraniteSetts\(/);
});
test('smeared Allas shells map to flat photo-guided colours; City Hall keeps its batches',()=>{
 for(const id of Object.keys(CLEAN_WATERFRONT_SHELLS)){const c=cleanWaterfrontShell({id});assert.equal(c.wallRGB.length,3);assert.ok(c.wallRGB.every(v=>v>=0&&v<=1));}
 assert.equal(cleanWaterfrontShell({id:'unrelated'}),null);
 const meshes=createWaterfrontFront(216);
 assert.ok(meshes.length<=6,'awnings and rustication reuse existing material batches');
 for(const m of meshes){m.geometry.computeBoundingBox();assert.ok(Number.isFinite(m.geometry.boundingBox.max.y));}
});
