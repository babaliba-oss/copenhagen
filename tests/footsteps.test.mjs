import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createPlayerTravelRenderer,footStrikes,strikesCrossed} from '../src/player-travel-renderer.js';

test('footStrikes finds where each foot comes down; strikesCrossed counts them either way round the cycle',()=>{
 const n=40,foot=o=>Array.from({length:n},(_,i)=>{const u=((i/n-o)%1+1)%1;return u<.6?.02:.02+.2*Math.sin(Math.PI*(u-.6)/.4);});
 const s=footStrikes([foot(0),foot(.5)]),near=(a,b)=>Math.abs(((a-b)%1+1.5)%1-.5)<.03;assert.equal(s.length,2);assert.ok(s.some(v=>near(v,0))&&s.some(v=>near(v,.5)),`down at 0 and 0.5 (${s})`);
 assert.equal(strikesCrossed(.9,.2,[0,.5]),1);assert.equal(strikesCrossed(.1,-.2,[0,.5]),1);assert.equal(strikesCrossed(.2,.1,[0,.5]),0);assert.equal(strikesCrossed(.4,1,[0,.5]),2);
});

const load=f=>new Promise((res,rej)=>{const b=gunzipSync(readFileSync('public/models/people/'+f));new GLTFLoader().parse(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'',res,rej);});
for(const name of ['M_Casual_Hoodie','R_Coat_Blue',null])test(`the player's footfalls follow the ${name?name+' rig\'s walk and run':'procedural figure\'s gait'}, on foot only`,async()=>{
 const r=createPlayerTravelRenderer(new THREE.Scene());
 if(name){const [g,a]=await Promise.all([load(name+'.glb.gz'),load(`anims${name.startsWith('R_')?'_r':''}.glb.gz`)]);r.setRigged({models:[{name,scene:g.scene,clips:Object.fromEntries(a.animations.map(c=>[c.name,c])),height:1.8}]},name);}
 const run=(mode,speed,dt=1/60,T=10)=>{const p={x:0,z:0,heading:0,speed,distance:0},travel={mode,rides:[],riding:null,viewActor:()=>p};let n=0,running=false;
  for(let i=0;i<T*60;i++){p.z-=speed*dt;r.update(travel,dt);const s=r.steps();n+=s.count;running||=s.running&&s.count>0;}return {rate:n/T,running};};
 const walk=run('walk',1.4),back=run('walk',-1.2),sprint=run('walk',5.5);
 assert.ok(walk.rate>1.5&&walk.rate<2.2&&!walk.running,`walking 1.4 m/s: ${walk.rate} steps a second`);
 assert.ok(back.rate>1.2&&back.rate<2.2,`walking backwards: ${back.rate}`);
 assert.ok(sprint.rate>3&&sprint.rate<4.5&&sprint.running,`running 5.5 m/s: ${sprint.rate}`);
 for(const mode of ['car','bike','scooter'])assert.equal(run(mode,5).rate,0,mode);
 assert.equal(run('walk',1.4,0).rate,0,'paused (dt 0)');assert.equal(run('walk',0).rate,0,'standing');
});
