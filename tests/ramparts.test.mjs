import test from 'node:test';
import assert from 'node:assert/strict';
import {setTerrain,groundAt,settleSurveyed} from '../src/terrain.js';
import {raiseRamparts,drapeRampart,rampartStretches,onRampartTop,RAMPART_DRAPE} from '../src/ramparts.js';
import {inWaterPolygons} from '../src/geo.js';

const flat=(size=101,cell=1)=>({size,cell,extent:(size-1)*cell/2,base:0,ground:new Float32Array(size*size),water:null,lake:null});
const rect=(x0,z0,x1,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];

test('1760 ramparts: the earthwork is raised into the ground, sloping down to a house beside it',()=>{
 const f=setTerrain(flat());
 try{
  // a 40 m by 20 m stretch with a 2.6 m terrace nested in it (the terraces share its outline), and a house at its east end
  const outer={kind:'rampart',name:'Volden',height:7.2,rings:[rect(-20,-10,20,10)]},inner={kind:'rampart',name:'Volden',height:2.6,rings:[rect(-20,-10,20,6)]};
  assert.equal(rampartStretches([outer,inner]).length,1,'nested terraces make one stretch');
  const house={kind:'house',rings:[rect(14,-4,24,4)]};
  assert.ok(raiseRamparts([outer,inner],{houses:[house]})>0);
  assert.ok(Math.abs(groundAt(-5,0)-(.12+7))<.05,`the top, 7 m in from the edge: ${groundAt(-5,0)}`);
  assert.ok(Math.abs(groundAt(-5,-8)-(.12+2*.7))<.05,'the slope rises 0.7 m per metre');
  assert.ok(groundAt(-30,0)===0&&groundAt(0,15)===0,'nothing raised outside it');
  assert.ok(groundAt(14.5,0)<.2,'flat along the house wall');
  assert.ok(groundAt(10,0)<.12+.7*3+.05,'and down towards it, not into it');
  // the drawn bank lies on the raised ground, never under it
  const a=new Float32Array([-6,0,-1,0,0, -4,0,-1,0,0, -5,0,1,0,0]),part={start:0,count:3};drapeRampart(a,part);
  for(let v=0;v<3;v++)assert.ok(a[v*5+1]>=groundAt(a[v*5],a[v*5+2])+RAMPART_DRAPE-1e-5);
  // a windmill mapped beside the bank goes up onto its top
  const [mx,mz]=onRampartTop(-5,13);assert.ok(groundAt(mx,mz)>6,'the mill stands on the bastion');
 }finally{setTerrain(null);}
});

test('a bastion standing in a mapped lake is dry land where the water list says so',()=>{
 const water=[{rings:[rect(0,0,10,10)]}];
 assert.ok(inWaterPolygons(water,5,5));
 water.dry=(x,z)=>x<5;assert.ok(!inWaterPolygons(water,2,5)&&inWaterPolygons(water,7,5));
});

test('surveyed parts meet the ground: a buried part comes up, a wall foot over the street goes down',()=>{
 setTerrain(flat(21,1));
 try{
  // a wall 4 m long, foot at y (two triangles), the ground at 0
  const wall=y=>new Float32Array([0,y,0,0,0, 4,y,0,0,0, 4,y+6,0,0,0,  0,y,0,0,0, 4,y+6,0,0,0, 0,y+6,0,0,0]);
  let a=wall(-2);settleSurveyed(a,{start:0,count:6,height:6});assert.ok(Math.abs(a[1]+.5)<1e-6,`buried 2 m: raised to half a metre under (${a[1]})`);assert.ok(Math.abs(a[11]-5.5)<1e-6,'the whole part moves');
  a=wall(.4);settleSurveyed(a,{start:0,count:6,height:6});assert.ok(Math.abs(a[1]+.3)<1e-6&&Math.abs(a[6]+.3)<1e-6,'a gap under the foot: the foot goes under the ground');assert.ok(Math.abs(a[11]-6.4)<1e-6,'the top stays');
  a=wall(-.6);settleSurveyed(a,{start:0,count:6,height:6});assert.ok(Math.abs(a[1]+.6)<1e-6,'the usual half metre under: untouched');
  a=wall(3);settleSurveyed(a,{start:0,count:6,height:6});assert.ok(Math.abs(a[1]-3)<1e-6,'a wall rising from a roof 3 m up: untouched');
 }finally{setTerrain(null);}
});

test('1760 earthworks get no roof seams: the dark ridge strips ran along the banks\' crests (Vesterport, Volden)',async()=>{
 const {readFileSync}=await import('node:fs'),{gunzipSync}=await import('node:zlib'),{createModelledBuilding}=await import('../src/building-detail.js');
 const idx=JSON.parse(readFileSync('public/cities/copenhagen-1760/buildings3d-index.json')),t=idx.tiles.find(t=>t.parts.some(p=>p.id==='osm-way--520300')),part=t.parts.find(p=>p.id==='osm-way--520300');
 let b=readFileSync(`public/cities/copenhagen-1760/${t.file}`);if(b[0]===0x1f)b=gunzipSync(b);const a=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
 const d=createModelledBuilding(a,part,undefined,null,true);
 assert.ok(d.meshes.some(m=>m.userData.role==='roof'),'the bank is still drawn');
 assert.equal(d.meshes.filter(m=>!m.userData.role).length,0,'no seam/trim mesh on an earthwork');
});
