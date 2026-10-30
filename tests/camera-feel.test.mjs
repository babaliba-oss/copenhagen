import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {driveFov,DRIVE_FOV,createDriveCameraState,stepDriveCamera,drivingCameraPose} from '../src/driving-camera.js';
import {createVehicle,animateVehicle} from '../src/vehicles.js';
import {bodyPoseTargets} from '../src/vehicles.js';
import {createVehicleMaterials} from '../src/vehicle-models.js';
import {registerEnvMaterial,setEnvironment,currentEnvironment,unregisterEnvMaterial} from '../src/environment.js';
import {createTramRenderer} from '../src/trams.js';
import {personLook,advanceGait,posePerson,createJoints,JOINT,PROPORTIONS} from '../src/person-model.js';
import {createSeaMaterial,applySkyUniforms} from '../src/sea.js';

const run=(state,car,seconds,dt,opts)=>{for(let t=0;t<seconds;t+=dt)stepDriveCamera(state,car,dt,opts);};

test('drive FOV widens from 58 to 68 degrees with speed and settles frame-rate independently',()=>{
 assert.equal(driveFov(0),DRIVE_FOV.min);assert.equal(driveFov(140/3.6),DRIVE_FOV.max);assert.ok(driveFov(10)>DRIVE_FOV.min&&driveFov(10)<driveFov(25));
 const fast={x:0,z:0,heading:0,speed:140/3.6,steer:0};
 const a=createDriveCameraState(),b=createDriveCameraState();run(a,fast,3,1/30);run(b,fast,3,1/120);
 assert.ok(Math.abs(a.fov-DRIVE_FOV.max)<.2&&Math.abs(b.fov-DRIVE_FOV.max)<.2);assert.ok(Math.abs(a.fov-b.fov)<.3,'30 Hz and 120 Hz agree');
 // Follow/High stay at the base FOV.
 const c=createDriveCameraState();run(c,fast,3,1/60,{drive:false});assert.equal(c.fov,DRIVE_FOV.min);
});

test('camera heading lags into a turn, settles on the car heading and snaps on teleport',()=>{
 const car={x:0,z:0,heading:0,speed:12,steer:1},s=createDriveCameraState();
 stepDriveCamera(s,car,1/60);car.heading=.6;stepDriveCamera(s,car,1/60);
 assert.ok(s.heading<.2,'lags on turn-in');
 let overshoot=0;for(let i=0;i<180;i++){stepDriveCamera(s,car,1/60);overshoot=Math.max(overshoot,s.heading-.6);}
 assert.ok(Math.abs(s.heading-.6)<.005,'settled');assert.ok(overshoot<.08,'no visible wobble');
 const s30=createDriveCameraState(),s120=createDriveCameraState();const c2={...car,heading:0};stepDriveCamera(s30,c2,1/30);stepDriveCamera(s120,c2,1/120);c2.heading=.6;
 run(s30,c2,1,1/30);run(s120,c2,1,1/120);assert.ok(Math.abs(s30.heading-s120.heading)<.03,'frame-rate independent');
 car.x=200;stepDriveCamera(s,car,1/60);assert.equal(s.heading,car.heading);assert.equal(s.headingVel,0);
 // Roll leans with the steering and speed, capped small; none in Follow.
 assert.ok(Math.abs(s.roll)>.005&&Math.abs(s.roll)<=.036);
 const f=createDriveCameraState();run(f,car,2,1/60,{drive:false});assert.equal(f.roll,0);
});

test('Q/E look eases out and back; impacts shake briefly and decay',()=>{
 const car={x:0,z:0,heading:0,speed:10,steer:0},s=createDriveCameraState();
 run(s,car,.05,1/60,{lookTarget:1.4});assert.ok(s.look>0&&s.look<.5,'eases in rather than jumping');
 run(s,car,1.5,1/60,{lookTarget:1.4});assert.ok(Math.abs(s.look-1.4)<.01);
 run(s,car,1.5,1/60,{lookTarget:0});assert.ok(Math.abs(s.look)<.01);
 // A damage event with a sudden stop produces a shake offset that fades within a second.
 car.speed=14;stepDriveCamera(s,car,1/60);car.speed=0;car.damageVersion=1;const hit=stepDriveCamera(s,car,1/60);
 assert.ok(s.shake>=.2&&s.shake<=1);assert.ok(hit.offset.some(v=>Math.abs(v)>0));
 run(s,car,1.5,1/60);assert.equal(s.shake,0);assert.ok(stepDriveCamera(s,car,1/60).offset.every(v=>Math.abs(v)===0));
 // Slowing to a stop without damage never shakes.
 const q=createDriveCameraState();car.speed=14;stepDriveCamera(q,car,1/60);car.speed=0;stepDriveCamera(q,car,1/60);assert.equal(q.shake,0);
 // Driving pose is unchanged by the new state (regression guard for existing camera tests).
 // Chase distance: 4.5 m + zoom/40 behind, 2.4 m + 11% of that up (tightened arcade-style so the car fills the frame).
 assert.deepEqual(drivingCameraPose({x:0,z:0},0,240,0).position,[0,2.4+10.5*.11,10.5]);
});

test('car body dives under braking, squats on launch and rolls into turns without moving the wheels',()=>{
 assert.ok(bodyPoseTargets(10,14,0,1/30,true).pitch<-.02,'brake dive nose down');
 assert.ok(bodyPoseTargets(14,10,0,1/30).pitch>.02,'launch squat nose up');
 assert.ok(bodyPoseTargets(10,10,1,1/30).roll<0&&bodyPoseTargets(10,10,-1,1/30).roll>0);
 assert.equal(bodyPoseTargets(10,10,0,0).pitch,0);
 const car=createVehicle(0,true),body=car.userData.body;assert.ok(body&&body.name==='body');
 assert.ok(car.children.slice(0,4).every(p=>p.children[0]),'wheel pivots remain the first four children');
 animateVehicle(car,14,0,1/30);animateVehicle(car,14,0,1/30);assert.ok(Math.abs(body.rotation.x)<1e-3);
 animateVehicle(car,0,0,1/30,true);assert.ok(body.rotation.x<-.01);
 for(let i=0;i<60;i++)animateVehicle(car,0,0,1/30,false);assert.ok(Math.abs(body.rotation.x)<.002,'settles');
 assert.equal(car.userData.wheels[0].pivot.rotation.x,0);
 // A model without a body (police) still animates.
 animateVehicle({userData:{wheels:[],tail:null}},5,0,.1);
});

test('vehicle finishes: clearcoat paint, reflective glass and chrome share one environment map',()=>{
 const m=createVehicleMaterials();
 assert.ok(m.paint.isMeshPhysicalMaterial&&m.paint.clearcoat>=.8);assert.ok(m.glass.roughness<.1&&m.glass.metalness>.4);assert.equal(m.chrome.metalness,1);assert.ok(m.rubber.roughness>.6&&m.rubber.metalness===0);
 for(const [name,mat] of Object.entries(m))assert.equal(mat.name,name);
 const env=new THREE.Texture();env.mapping=THREE.CubeUVReflectionMapping;setEnvironment(env);
 assert.equal(m.paint.envMap,env);assert.equal(m.glass.envMap,env);assert.equal(m.chrome.envMap,env);
 const late=registerEnvMaterial(new THREE.MeshStandardMaterial(),.5);assert.equal(late.envMap,env);assert.equal(late.envMapIntensity,.5);
 const car=createVehicle(3,false,'sedan');assert.equal(car.getObjectByName('paint').material.envMap,env,'cloned paint registered too');
 setEnvironment(null);assert.equal(m.paint.envMap,null);assert.equal(currentEnvironment(),null);unregisterEnvMaterial(late);
});

test('tram glazing is reflective but still see-through and the nose loft is smooth',async()=>{
 const {readFileSync}=await import('node:fs');const {TramSimulation}=await import('../src/tram-simulation.js');
 const data=JSON.parse(readFileSync('public/data/trams.json')),sim=new TramSimulation(data,{buildings:{at:()=>undefined},roads:{at:()=>true},pavement:{at:()=>true}});sim.reset({x:0,z:117.7});
 const r=createTramRenderer(new THREE.Scene(),sim),glass=r.kinds.flat().find(m=>/glass/.test(m.name)),paint=r.kinds.flat().find(m=>/module 0 paint/.test(m.name));
 assert.ok(glass.material.transparent&&glass.material.opacity<.6&&glass.material.roughness<.1);assert.ok(paint.material.clearcoat>0);
 // Averaged normals: the front paint loft carries normals that are not all axis-aligned flat facets.
 const n=paint.geometry.attributes.normal;let offAxis=0;for(let i=0;i<n.count;i++){const x=Math.abs(n.getX(i)),y=Math.abs(n.getY(i)),z=Math.abs(n.getZ(i));if(Math.max(x,y,z)<.98)offAxis++;}
 assert.ok(offAxis/n.count>.1,'smooth-shaded nose');
});

test('people blend between poses over ~0.3 s with bone lengths preserved; coats clear the knees',()=>{
 const look=personLook(5),p={...look,x:0,z:0,heading:0,speed:0,pose:'walk'},g={};
 advanceGait(p,g,0);assert.equal(g.poseBlend.phone,0);
 p.pose='phone';advanceGait(p,g,.15);assert.ok(g.poseBlend.phone>.5&&g.poseBlend.phone<.95,'mid-transition');
 const J=createJoints(),H=look.height,P=PROPORTIONS;posePerson(p,look,g,J);
 const d=(a,b)=>Math.hypot(J[a]-J[b],J[a+1]-J[b+1],J[a+2]-J[b+2]);
 assert.ok(Math.abs(d(JOINT.shoulderR,JOINT.elbowR)-P.upperArm*H)<1e-6);assert.ok(Math.abs(d(JOINT.elbowR,JOINT.wristR)-P.forearm*H)<1e-6);
 const mid=J[JOINT.handR+1];advanceGait(p,g,1);posePerson(p,look,g,J);assert.ok(g.poseBlend.phone>.99);assert.ok(J[JOINT.handR+1]>mid,'hand keeps rising to the phone pose');
 // Walk cycle and knockdown unaffected: a runner's knee stays inside a long coat's half-depth.
 const runner={...personLook(7),coat:1,x:0,z:0,heading:0,speed:4.2,running:true,pose:'walk'},rg={};for(let i=0;i<120;i++)advanceGait(runner,rg,1/60);
 let maxKnee=0;for(let i=0;i<24;i++){rg.gaitPhase=i/24*Math.PI*2;posePerson(runner,runner,rg,J);maxKnee=Math.max(maxKnee,-J[JOINT.kneeL+2],-J[JOINT.kneeR+2]);}
 const Hr=runner.height,cd=(.074+.07*rg.gaitWalk+.09*rg.gaitRun)*Hr,forward=.035*Hr;
 assert.ok(maxKnee+.08<cd*1.08+forward,`knee ${maxKnee.toFixed(2)} within coat ${(cd*1.08+forward).toFixed(2)}`);
});

test('sea mirrors the sky dome uniforms (horizon, mid, zenith, sun) when present',()=>{
 const m=createSeaMaterial(),u=m.uniforms;assert.ok('uSkyMid' in u);
 const dome={material:{uniforms:{uHorizon:{value:new THREE.Color('#aabbcc')},uMid:{value:new THREE.Color('#5577aa')},uZenith:{value:new THREE.Color('#224488')},uSunGlow:{value:new THREE.Color('#ffeedd')},uSunDir:{value:new THREE.Vector3(1,2,3)}}}};
 assert.equal(applySkyUniforms(u,dome),true);
 assert.equal(u.uSkyHorizon.value.getHexString(),'aabbcc');assert.equal(u.uSkyMid.value.getHexString(),'5577aa');assert.equal(u.uSkyZenith.value.getHexString(),'224488');assert.equal(u.uSunColor.value.getHexString(),'ffeedd');
 assert.ok(Math.abs(u.uSunDir.value.length()-1)<1e-6);assert.equal(applySkyUniforms(u,{material:{uniforms:{}}}),false);
 assert.match(m.fragmentShader,/uSkyMid/);assert.match(m.fragmentShader,/pow\(sun,80\.\)/);
});

test('on foot on a portrait phone the camera stands back and higher, so the walker no longer fills the middle of the view; landscape is unchanged',async()=>{
 const {travelCameraPose}=await import('../src/player-travel-renderer.js');
 const actor={x:0,z:0,heading:0},shape=aspect=>{const p=travelCameraPose(actor,0,150,0,null,aspect),cam=new THREE.PerspectiveCamera(DRIVE_FOV.min,aspect||16/9,.1,1000);cam.position.set(...p.position);cam.lookAt(...p.target);cam.updateMatrixWorld();
  const ndc=(x,y)=>new THREE.Vector3(x,y,0).project(cam),head=ndc(0,1.75),feet=ndc(0,0),side=ndc(.3,1);return {top:(1-head.y)/2,bottom:(1-feet.y)/2,width:side.x,pose:p};};
 assert.deepEqual(shape(16/9).pose,shape(0).pose,'landscape: the same pose as before');assert.deepEqual(shape(1).pose,shape(0).pose);
 const before=shape(16/9),wide=(()=>{const p=travelCameraPose(actor,0,150,0,null,0),cam=new THREE.PerspectiveCamera(DRIVE_FOV.min,412/915,.1,1000);cam.position.set(...p.position);cam.lookAt(...p.target);cam.updateMatrixWorld();return new THREE.Vector3(.3,1,0).project(cam).x;})(),phone=shape(412/915);
 assert.ok(wide>.22,`Pixel 7 upright with the old pose: the walker ${(wide*100).toFixed(0)}% of the screen's width`);
 assert.ok(phone.width<wide*.8,`now ${(phone.width*100).toFixed(0)}% of the width`);
 assert.ok(phone.top-before.top>.05,`head lower on the screen (${(phone.top*100).toFixed(0)}% down, landscape ${(before.top*100).toFixed(0)}%)`);
 assert.ok(phone.bottom<.85,`feet above the touch controls (${(phone.bottom*100).toFixed(0)}% down)`);
});
