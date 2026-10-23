import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createBreakableSigns,breakableSigns,SIGN_SNAP_SPEED,SIGN_BEND_SPEED} from '../src/breakable-signs.js';
import {makeCar} from '../src/physics.js';
import {createKaivokatuDetails} from '../src/kaivokatu-details.js';
import {createSofiankatuSigns} from '../src/sofiankatu-signs.js';

// One crossing-style sign: pole plus a plate facing +Z, built in world space like the sign modules do.
function sign(x=0,z=-4,options={}){
 const set=createBreakableSigns('test',{register:false}),i=set.post({x,z,height:3.35,radius:.04,...options}),metal=new THREE.MeshStandardMaterial();
 const pole=new THREE.CylinderGeometry(.03,.03,3.35,6).translate(x,1.675,z),plate=new THREE.BoxGeometry(.69,.69,.045).translate(x,3.02,z+.035);
 set.add(pole,metal,i);set.add(plate,metal,i);set.finish();return set;
}
const drive=(set,car,seconds,{throttle=null,world=null}={},dt=1/60)=>{for(let t=0;t<seconds;t+=dt){if(throttle!==null)car.speed=Math.max(car.speed,throttle);car.x-=Math.sin(car.heading)*car.speed*dt;car.z-=Math.cos(car.heading)*car.speed*dt;set.step(dt,car,world);}set.update();};
const up=s=>new THREE.Vector3(0,1,0).applyQuaternion(s.q);

test('a fast hit snaps the sign off: it flies ahead, tumbles, lies flat, leaves a stump and barely slows the car',()=>{
 const set=sign(),car=makeCar(0,0,0),s=set.bodies[0];car.speed=16;
 let peak=0;for(let t=0;t<.8;t+=1/60){car.z-=car.speed/60;set.step(1/60,car,null);peak=Math.max(peak,s.c.y);}
 assert.ok(s.knocked&&s.state==='flying');assert.ok(peak>2.2,'centre of mass rose: it flew');
 assert.ok(car.speed>13&&car.speed<16,`light post costs a little speed (${car.speed})`);
 car.speed=0;drive(set,car,8);
 assert.equal(s.state,'down');assert.ok(s.c.z<-10,'landed well ahead of the impact point');
 assert.ok(Math.abs(up(s).y)<.02,'pole lies horizontal');
 const plate=new THREE.Vector3(0,0,1).applyQuaternion(s.q);assert.ok(Math.abs(Math.abs(plate.y)-1)<.02,'plate lies face down or up');
 const pose=set.group.children.find(m=>m.isMesh&&!m.isInstancedMesh);assert.ok(pose.geometry.attributes.signIndex);
 const stumps=set.group.children.find(m=>m.isInstancedMesh),m=new THREE.Matrix4();stumps.getMatrixAt(0,m);assert.ok(m.determinant()>0,'stump shown at the base');
 assert.deepEqual(set.snapshot(),{count:1,knocked:1,hits:1,bent:0,broken:1});
});

test('a moderate hit folds the post over at its base towards the travel direction and the car drives on',()=>{
 const set=sign(),car=makeCar(0,0,0),s=set.bodies[0];car.speed=5;
 drive(set,car,2);
 assert.equal(s.state,'bent');assert.ok(s.theta>.9&&s.theta<=1.42,`bent ${s.theta}`);
 assert.ok(up(s).z<-.6,'leans away from the car, along its travel');assert.ok(car.speed>3.5,`car keeps going (${car.speed})`);
 assert.ok(s.c.y>0,'still standing on its base');
});

test('a crawling car leans the post first and pushes it over without ever being trapped',()=>{
 const set=sign(0,-2.4),car=makeCar(0,0,0),s=set.bodies[0];car.speed=1.2;
 drive(set,car,.35);const early=s.theta;assert.ok(early>0&&early<.7,`gentle lean (${early})`);assert.ok(car.speed<1.2,'the post resists');
 drive(set,car,5,{throttle:1.2});
 assert.ok(s.theta>1,'pushed over');assert.notEqual(s.state,'flying');assert.ok(car.z<-6,'car got past the sign');
});

test('stationary contact or a car beside the sign never knocks it',()=>{
 const set=sign(1.5,0),car=makeCar(0,0,0);car.speed=10;drive(set,car,.5);assert.equal(set.bodies[0].knocked,false);
 const still=sign(0,-2.3),parked=makeCar(0,0,0);drive(still,parked,1);assert.equal(still.bodies[0].knocked,false);
});

test('signal posts are sturdier: a hit that snaps a sign only folds them',()=>{
 const set=sign(0,-4,{strength:1.8}),car=makeCar(0,0,0);car.speed=SIGN_SNAP_SPEED+3;drive(set,car,2);
 assert.equal(set.bodies[0].state,'bent');assert.ok(SIGN_BEND_SPEED<SIGN_SNAP_SPEED);
});

test('broken and bent signs respawn upright once the car is far away for a minute',()=>{
 const set=sign(),car=makeCar(0,0,0),s=set.bodies[0];car.speed=18;drive(set,car,.6);car.speed=0;drive(set,car,6);
 assert.equal(s.state,'down');car.x=500;drive(set,car,61);
 assert.equal(s.state,'upright');assert.equal(s.knocked,false);assert.ok(s.q.angleTo(new THREE.Quaternion())<1e-9);
 const stumps=set.group.children.find(m=>m.isInstancedMesh),m=new THREE.Matrix4();stumps.getMatrixAt(0,m);assert.equal(m.determinant(),0,'stump hidden again');
});

test('flying signs bounce off buildings instead of passing through',()=>{
 const set=sign(),car=makeCar(0,0,0),wall={at:(x,z)=>z<-9?{}:undefined};car.speed=20;drive(set,car,.4,{world:{buildings:wall}});car.speed=0;drive(set,car,8,{world:{buildings:wall}});
 assert.ok(set.bodies[0].c.z>-9.5);
});

test('pose texture and attached meshes follow the post; an upright post renders exactly as before',()=>{
 const set=createBreakableSigns('attach',{register:false}),i=set.post({x:0,z:-4,height:3}),plaque=new THREE.Mesh(new THREE.PlaneGeometry(1,.5));plaque.position.set(0,3,-4);
 set.attach(plaque,i);set.finish();const rest=plaque.matrix.clone();assert.ok(plaque.matrix.equals(rest));
 const car=makeCar(0,0,0);car.speed=6;drive(set,car,1);assert.ok(!plaque.matrix.equals(rest),'plaque moved with the bent post');
 set.resetAll();assert.ok(plaque.matrix.equals(rest));
});

const city=JSON.parse(gunzipSync(readFileSync(new URL('../public/data/city.pack',import.meta.url))));
test('converted sign modules register breakable posts and keep their footprints out of car collision',()=>{
 const before=breakableSigns.snapshot().count;
 const kit=createSofiankatuSigns(city),{group,obstacles}=createKaivokatuDetails(city);
 assert.equal(kit.breakable.bodies.length,2);assert.equal(group.breakable.bodies.length,3);
 assert.ok(obstacles.length===3&&obstacles.every(o=>o.breakable),'Kaivokatu posts guide placement only');
 assert.equal(breakableSigns.snapshot().count,before+5,'both sets join the combined knockables entry');
 for(const mesh of [...kit.children,...group.children].filter(m=>m.isMesh&&m.geometry.attributes.signIndex))assert.ok(mesh.customDepthMaterial,'broken signs cast correct shadows');
});

test('sign posts dissolve right in front of the camera, only in lit materials', async () => {
 const {nearFade}=await import('../src/near-fade.js');const {SIGN_NEAR}=await import('../src/breakable-signs.js');
 const lit=nearFade({fragmentShader:THREE.ShaderLib.physical.fragmentShader},SIGN_NEAR.from,SIGN_NEAR.to).fragmentShader;
 assert.match(lit,/length\(vViewPosition\)/);assert.match(lit,/discard/);
 const basic=THREE.ShaderLib.basic.fragmentShader;assert.equal(nearFade({fragmentShader:basic},1,2).fragmentShader,basic,'no vViewPosition there: left alone');
 assert.ok(SIGN_NEAR.to<4,'the car, 8 m ahead of the lens, never dissolves the signs beside it');
});
