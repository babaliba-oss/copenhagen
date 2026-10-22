import test from 'node:test';import assert from 'node:assert/strict';
import {Mobility} from '../src/mobility.js';
// 1760 (streetWalking): no pavements, people walk in the cobbled street. A footway running over the carriageway used to stop
// every walker at its "kerb" for good; walkers in the street give way to a coach coming along it, and the coach never drives into them.
const n=[[-60,0],[60,0]],e=(a,b,lane=0)=>({from:a,to:b,points:[n[a],n[b]],lane,signal:-1,crossing:false});
function street(streetWalking,{coach=false}={}){
 const sim=new Mobility({roads:{nodes:n,edges:[e(0,1),e(1,0)]},walks:{nodes:n,edges:[e(0,1),e(1,0)]},signals:[]},{roads:{at:()=>true},pavement:{at:()=>false},buildings:{at:()=>false},water:[]},{cars:coach?1:0,people:1,streetWalking});
 const a=sim.people[0];Object.assign(a,{edge:sim.walks.edges[0],s:40,cruise:1.2,side:.2});Object.assign(a,sim.position(a),{speed:0});
 if(coach){const c=sim.cars[0];Object.assign(c,{edge:sim.roads.edges[0],s:20,cruise:6,halfLength:3.4,halfWidth:.95});Object.assign(c,sim.position(c),{speed:6});}
 return [sim,a,sim.cars[0]];
}
const player={x:0,z:40,heading:0,speed:0,travelMode:'walk'};
test('1760 walkers walk along a footway over the carriageway; today they keep off it',()=>{
 for(const sw of [false,true]){const [sim,a]=street(sw),x0=a.x;for(let i=0;i<60*10;i++)sim.step(1/60,player);
  if(sw)assert.ok(a.x-x0>8,`walked ${(a.x-x0).toFixed(1)} m`);else assert.ok(Math.abs(a.x-x0)<.5,'stays at the kerb today');}
});
test('a walker in the street steps aside for a coach coming up behind, and the coach passes without driving into it',()=>{
 const [sim,a,c]=street(true,{coach:true});let inside=0;
 for(let i=0;i<60*12;i++){sim.step(1/60,player);const hx=-Math.sin(c.heading),hz=-Math.cos(c.heading),x=a.x-c.x,z=a.z-c.z;if(Math.abs(x*hx+z*hz)<c.halfLength&&Math.abs(-x*hz+z*hx)<c.halfWidth)inside++;}
 assert.equal(inside,0,'walker never inside the coach');assert.ok(c.x>a.x+5,`coach passed (coach ${c.x.toFixed(1)}, walker ${a.x.toFixed(1)})`);
});
