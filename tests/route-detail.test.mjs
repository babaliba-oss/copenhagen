import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import * as THREE from 'three';
import {SpatialIndex} from '../src/geo.js';
import {createHarbourSigns,SIGN_SUPPORTS} from '../src/harbour-signs.js';
import {Cyclists} from '../src/cyclists.js';
import {createTramRenderer} from '../src/trams.js';
import {createWaterfrontFront,isWaterfrontFront} from '../src/kauppatori-buildings.js';
import {createStationStatues,LANTERN_PAIRS} from '../src/station-statues.js';
import {stopAdPlacements} from '../src/bind-ads.js';
import {drivingCameraPose} from '../src/driving-camera.js';
const city=JSON.parse(gunzipSync(readFileSync('public/data/city.pack')));
test('driving camera retracts before entering a roadside building',()=>{
 const pose=drivingCameraPose({x:0,z:0},0,240,0,{at:(x,z)=>z>=8});
 assert.ok(pose.position[2]<8);assert.ok(pose.position[2]>5);
 const buildings=new SpatialIndex(city.buildings),forum=drivingCameraPose({x:-724,z:43},1.95,240,0,buildings);
 assert.ok(!buildings.at(forum.position[0],forum.position[2]));
 // a house corner 0.6 m beside the boom: the drawn facade stands up to a metre outside its footprint, so the lens stops short of it
 let corner;for(let i=0;i<40;i++)corner=drivingCameraPose({x:0,z:0},0,240,0,{at:(x,z)=>x>=.6&&z>=6}); /* the boom may swing away (eased) */
 const [cx,,cz]=corner.position;assert.ok(Math.hypot(Math.max(0,.6-cx),Math.max(0,6-cz))>=.75,`lens at ${cx.toFixed(2)},${cz.toFixed(2)}`);
});
test('suspended signs reproduce left/right/right; supports stay off the road',()=>{
 const signs=createHarbourSigns(),roads=new SpatialIndex(city.roads),pavement=new SpatialIndex(city.pavement);
 assert.deepEqual(signs.userData.turns,['left','right','right']);assert.equal(signs.children.length,4);
 for(const p of SIGN_SUPPORTS){assert.ok(!roads.at(p.x,p.z));assert.ok(pavement.at(p.x,p.z));}
});
test('eight cyclists move and remain on dedicated cycleway polygons',()=>{
 const sim=new Cyclists(city),before=sim.snapshot();
 for(let i=0;i<1800;i++){sim.step(1/30,{x:1e4,z:1e4});assert.ok(sim.snapshot().every(p=>p.onCycleway));}
 assert.equal(sim.riders.length,8);assert.ok(sim.snapshot().every((p,i)=>Math.hypot(p.x-before[i].x,p.z-before[i].z)>10));
});
test('all rail heads exist at startup and camera movement does not rebuild or crop them',()=>{
 const scene=new THREE.Scene(),sim={paths:[{points:[[0,0],[0,400],[100,800]]}],trams:[]};
 const renderer=createTramRenderer(scene,sim),rail=scene.getObjectByName('Continuous full-route rail heads');
 assert.ok(rail);assert.equal(rail.geometry.attributes.instanceStart.count,4);assert.ok(rail.material.linewidth>=1);assert.equal(rail.material.worldUnits,false);
 const geometry=rail.geometry;renderer.update({x:0,z:750});assert.equal(rail.geometry,geometry);assert.equal(rail.geometry.attributes.instanceStart.count,4);
 assert.equal(rail.material.depthTest,true,'buildings must still hide rails behind them');
});
test('photo-guided Esplanadi fronts are physical meshes and do not erase courtyard faces',()=>{
 for(const ratu of [221,335]){const meshes=createWaterfrontFront(ratu);assert.ok(meshes.length>=4);for(const m of meshes){assert.equal(m.material.map,null);assert.ok(m.geometry.attributes.position.array.every(Number.isFinite));}}
 assert.ok(isWaterfrontFront(221,{normal:{x:.057,z:.998},d:233.61}));
 assert.ok(!isWaterfrontFront(221,{normal:{x:.056,z:.998},d:201.24}));
});
test('four station figures flank the actual Kaivokatu entrance and stay clear of the road',()=>{
 const statues=createStationStatues(),roads=new SpatialIndex(city.roads);
 assert.equal(statues.group.userData.figures,4);assert.equal(statues.obstacles.length,2);
 assert.ok(LANTERN_PAIRS[0].x<-600&&LANTERN_PAIRS[1].x>-590);
 for(const p of statues.obstacles)for(const [x,z]of p.rings[0])assert.ok(!roads.at(x,z));
 for(const m of statues.group.children)assert.ok(m.geometry.attributes.position.array.every(Number.isFinite));
});
test('fictional stop ads leave the road and cycleway clear',()=>{
 const stops=JSON.parse(readFileSync('public/data/trams.json')).stops,placements=stopAdPlacements(city,stops),roads=new SpatialIndex(city.roads.filter(r=>!/Koroke/.test(r.kind))),pavement=new SpatialIndex(city.pavement);
 assert.ok(placements.length>0);for(const p of placements){assert.ok(!roads.at(p.x,p.z));assert.ok(!/pyörä/i.test(pavement.at(p.x,p.z)?.kind||''));}
});
