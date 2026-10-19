import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
const {SpatialIndex}=await import('../src/geo.js');
const {driveStep,makeCar}=await import('../src/physics.js');

const list=JSON.parse(fs.readFileSync('public/cities/copenhagen/kk-footprints.json','utf8'));
const raw=fs.readFileSync('public/cities/copenhagen/city.pack'),city=JSON.parse(raw[0]===31&&raw[1]===139?zlib.gunzipSync(raw):raw);

test("the city model's own houses have footprints, and none of them lies on a mapped road", () => {
 assert.ok(list.length>3000,`${list.length} footprints`);
 const roads=new SpatialIndex(city.roads);let onRoad=0;
 for(const f of list){assert.ok(f.rings[0].length>=3&&f.bbox.length===4&&f.height>=2.2);
  const [x0,z0,x1,z1]=f.bbox,cx=(x0+x1)/2,cz=(z0+z1)/2;if(new SpatialIndex([f]).at(cx,cz)&&roads.at(cx,cz))onRoad++;}
 assert.ok(onRoad<list.length*.01,`${onRoad} footprints centred on a road`);
});

test('the car stops at one instead of driving in', () => {
 // a good-sized one near the middle of town: drive at it from 12 m out
 const area=f=>(f.bbox[2]-f.bbox[0])*(f.bbox[3]-f.bbox[1]),f=list.filter(f=>area(f)>150).reduce((a,b)=>Math.hypot(b.bbox[0]-300,b.bbox[1]-200)<Math.hypot(a.bbox[0]-300,a.bbox[1]-200)?b:a);
 const index=new SpatialIndex([f]),inside=(x,z)=>!!index.at(x,z);
 let [cx,cz]=f.rings[0][0];for(let k=0;k<200&&!inside(cx,cz);k++){const [x0,z0,x1,z1]=f.bbox;cx=x0+Math.random()*(x1-x0);cz=z0+Math.random()*(z1-z0);}
 assert.ok(inside(cx,cz));
 let sx=cx+12,sz=cz;for(let k=0;k<40&&inside(sx,sz);k++)sx+=3; // outside it, on its east side
 const car=makeCar(sx,sz);car.heading=Math.PI/2; // heading pi/2 drives towards -x
 const everywhere={at:()=>({})},world={roads:everywhere,pavement:everywhere,water:[],buildings:index,collisionBuildings:index};
 let hit=null;for(let i=0;i<600&&!hit;i++){const r=driveStep(car,new Set(['KeyW']),1/60,world);if(r.collision)hit=r.collision;}
 assert.equal(hit,'building');assert.equal(inside(car.x,car.z),false,'the car stays outside');
});
