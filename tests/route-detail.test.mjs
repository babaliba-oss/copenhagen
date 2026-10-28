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
import {drivingCameraPose,cameraWallStrips} from '../src/driving-camera.js';
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
test('driving camera keeps off drawn walls that stand clear of the footprints (camera-walls.json)',()=>{
 const segDist=(x,z,s)=>{let best=Infinity;for(let i=0;i+3<s.length;i+=4){const [ax,az,bx,bz]=s.slice(i,i+4),dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz||1)));best=Math.min(best,Math.hypot(x-ax-t*dx,z-az-t*dz));}return best;};
 // a wall across the boom 6 m behind the car, no footprint under it: the 1 m strip stops the ring short of it
 const wall=[-5,6,5,6];let p;for(let i=0;i<40;i++)p=drivingCameraPose({x:0,z:0},0,240,0,new SpatialIndex(cameraWallStrips(wall)));
 assert.ok(segDist(p.position[0],p.position[2],wall)>=.9,`lens ${segDist(p.position[0],p.position[2],wall).toFixed(2)} m from the wall`);
 // Amagertorv's side street (113.5,103.7 heading 0): kk-osm-way-28719500's front stands ~0.9 m past its footprint, and the
 // lens stood 0.27 m from it (a dark wedge). The data has that front; the boom keeps the lens off it.
 const segs=JSON.parse(readFileSync('public/cities/copenhagen/camera-walls.json')),near=[];
 for(let i=0;i+3<segs.length;i+=4)if(Math.abs(segs[i]-113)<30&&Math.abs(segs[i+1]-108)<30)near.push(...segs.slice(i,i+4));
 assert.ok(segDist(113.26,111.57,near)<.4,'the front at lens height is a camera wall');
 for(let i=0;i<40;i++)p=drivingCameraPose({x:113.5,z:103.7},0,150,0,new SpatialIndex(cameraWallStrips(near)));
 assert.ok(segDist(p.position[0],p.position[2],near)>=.9,`lens ${segDist(p.position[0],p.position[2],near).toFixed(2)} m from a drawn wall`);
});
test('an obstacle the car itself stands in does not collapse the boom',()=>{
 /* a camera-wall strip lying along the road under the car (Papirøen's road node 1447.5,170.4 stood in one): the boom collapsed to 0.5 m */
 const along=new SpatialIndex(cameraWallStrips([0,-5,0,20]));let p;for(let i=0;i<40;i++)p=drivingCameraPose({x:0,z:0},0,150,0,along);
 assert.ok(p.position[2]>8,`boom ${p.position[2].toFixed(2)} m`);
 /* a wall across the boom that the car is not in still stops it */
 const both=new SpatialIndex(cameraWallStrips([0,-5,0,20,-5,6,5,6]));for(let i=0;i<40;i++)p=drivingCameraPose({x:0,z:0},0,150,0,both);
 assert.ok(p.position[2]<5,`boom ${p.position[2].toFixed(2)} m`);
 /* the same through a plain at(x,z) predicate (a footprint over the car and the boom) */
 for(let i=0;i<40;i++)p=drivingCameraPose({x:0,z:0},0,150,0,{at:(x,z)=>Math.abs(x)<2&&z>-3&&z<30});
 assert.ok(p.position[2]>8);
});
test('a swung boom keeps the car near the middle of a portrait phone view',()=>{
 const wall={at:(x,z)=>z>=3&&x>-1}; /* wall right behind, open to the left: the boom swings */
 const off=p=>{const a=Math.atan2(-p.position[0],-p.position[2])-Math.atan2(p.target[0]-p.position[0],p.target[2]-p.position[2]);return Math.abs(Math.atan2(Math.sin(a),Math.cos(a)));};
 let wide,narrow;for(let i=0;i<40;i++)wide=drivingCameraPose({x:0,z:0},0,150,0,wall);for(let i=0;i<40;i++)narrow=drivingCameraPose({x:0,z:0},0,150,0,wall,.49);
 assert.ok(Math.abs(wide.position[0])>1,'boom swung');assert.ok(off(narrow)<=Math.atan(Math.tan(29*Math.PI/180)*.49)*.36,`car ${(off(narrow)*180/Math.PI).toFixed(1)} deg off the view axis`);
 assert.ok(Math.hypot(narrow.position[0]-wide.position[0],narrow.position[2]-wide.position[2])<.05,'the lens stays where it was; only the aim turns');
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
