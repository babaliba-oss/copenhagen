import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {encodeTerrain,decodeTerrain,setTerrain,groundAt,waterAt,lakeAt,groundPose,footprintBase,liftBuildings,hasTerrain,raiseBridgeDecks} from '../src/terrain.js';
import {drapeGeometry,dropSunkenSurfaces,settleObject,subdivideGeometry,createLakeGeometry,lakeSurface} from '../src/terrain-mesh.js';
import {makeCar,driveStep} from '../src/physics.js';
import {drivingCameraPose} from '../src/driving-camera.js';
import {SpatialIndex} from '../src/geo.js';
import {blur,levelWater,findLakes,stampBridges,bridgeChains,conditionRoads,readPng,limitProfile,gradeSpikes,roadLines,roadLayers,junctionMask,streetLevel,lakeBed} from '../scripts/city-terrain.mjs';

// Synthetic fields: size×size samples, `cell` metres apart, centred on the origin.
function field(fn,{size=81,cell=2,water=null,lake=null}={}){
 const extent=(size-1)*cell/2,ground=new Float32Array(size*size);
 for(let j=0;j<size;j++)for(let i=0;i<size;i++)ground[j*size+i]=fn(i*cell-extent,j*cell-extent);
 return {size,cell,extent,base:0,ground,water,lake};
}
const flatWorld=()=>{const e=new SpatialIndex([]);return {buildings:e,roads:new SpatialIndex([{rings:[[[-500,-500],[500,-500],[500,500],[-500,500],[-500,-500]]],kind:'Ajorata'}]),pavement:e,water:[]};};

test('height field round-trips through the pack format within its 1 cm quantisation',()=>{
 const size=33,ground=new Float32Array(size*size),water=new Float32Array(size*size).fill(NaN),lake=new Float32Array(size*size).fill(NaN);
 for(let i=0;i<ground.length;i++){ground[i]=80+Math.sin(i*.37)*12+i*.003;if(i%7===0)water[i]=77.31;if(i>900)lake[i]=95.42;}
 const bytes=encodeTerrain({size,cell:3,extent:48,base:89,ground,water,lake,source:'test'}),t=decodeTerrain(bytes);
 assert.equal(t.size,size);assert.equal(t.cell,3);assert.equal(t.extent,48);assert.equal(t.source,'test');
 for(let i=0;i<ground.length;i++){
  assert.ok(Math.abs(t.ground[i]-(ground[i]-89))<=.0051,`ground ${i}`);
  assert.equal(Number.isNaN(t.water[i]),Number.isNaN(water[i]));if(!Number.isNaN(water[i]))assert.ok(Math.abs(t.water[i]-(77.31-89))<.006);
  assert.equal(Number.isNaN(t.lake[i]),Number.isNaN(lake[i]));
 }
 assert.throws(()=>decodeTerrain(new Uint8Array(16)),/terrain/);
});

test('ground lookup is bilinear, clamps at the edges and is flat (0) without terrain',()=>{
 setTerrain(null);assert.equal(hasTerrain(),false);assert.equal(groundAt(123,-45),0);assert.deepEqual(groundPose(5,5,1),{y:0,pitch:0,roll:0});
 setTerrain(field((x,z)=>.1*x-.05*z+3));
 for(const [x,z] of [[0,0],[1.3,-7.7],[33.1,20.9],[-79.9,79.9]])assert.ok(Math.abs(groundAt(x,z)-(.1*x-.05*z+3))<1e-4);
 assert.ok(Math.abs(groundAt(500,0)-groundAt(80,0))<1e-6,'clamped beyond the field');
 setTerrain(null);
});

test('water levelling keeps lakes dead flat and keeps the step at a dam',()=>{
 const size=60,dem=new Float32Array(size*size),mask=new Uint8Array(size*size);
 // Two basins side by side, joined at x=30: 95 m above, 77 m below, lidar noise of ±4 cm on the water.
 for(let y=10;y<50;y++)for(let x=5;x<55;x++){const i=y*size+x;mask[i]=1;dem[i]=(x<30?95:77)+(Math.sin(i*12.9898)*.04);}
 const w=levelWater(dem,mask,size,4,2);
 const upper=[],lower=[];for(let y=14;y<46;y++)for(let x=9;x<51;x++){if(x<26)upper.push(w[y*size+x]);if(x>34)lower.push(w[y*size+x]);}
 const spread=a=>Math.max(...a)-Math.min(...a);
 assert.ok(spread(upper)<.08&&spread(lower)<.08,`flat within the noise: ${spread(upper)}, ${spread(lower)}`);
 assert.ok(Math.abs(upper[0]-95)<.05&&Math.abs(lower[0]-77)<.05,'levels kept');
 assert.ok(!Number.isNaN(w[30*size+4])&&Number.isNaN(w[30*size+1]),'levels spread just onto the banks');
 // Water surfaces in the elevation model are exactly level: they stay exactly level.
 for(let i=0;i<dem.length;i++)if(mask[i])dem[i]=i%size<30?95:77;const exact=levelWater(dem,mask,size,4,0);
 for(let i=0;i<dem.length;i++)if(mask[i])assert.equal(exact[i],dem[i]);
 // Smoothing the land never touches cells it is told to keep.
 const keep=new Uint8Array(size*size).fill(1),b=blur(dem,size,2,keep);assert.deepEqual([...b],[...dem]);
});

test('lakes come from large dead-flat areas only, away from mapped land',()=>{
 const size=80,dem=new Float32Array(size*size),none=new Uint8Array(size*size),land=new Uint8Array(size*size);
 for(let i=0;i<dem.length;i++)dem[i]=100+Math.sin(i*1.7)*.3; // rough ground
 for(let y=5;y<70;y++)for(let x=5;x<60;x++)dem[y*size+x]=95.4; // a lake
 for(let y=72;y<78;y++)for(let x=70;x<78;x++)dem[y*size+x]=90; // a small flat yard
 for(let y=30;y<40;y++)for(let x=30;x<40;x++)land[y*size+x]=1; // a mapped pier
 const lake=findLakes(dem,none,land,size,{minArea:500});
 assert.ok(Math.abs(lake[20*size+20]-95.4)<1e-4);assert.ok(Number.isNaN(lake[35*size+35]),'mapped land stays land');
 assert.ok(Number.isNaN(lake[75*size+75]),'small flat areas are not lakes');assert.ok(Number.isNaN(lake[2*size+2]));
});

test('a bridge is a straight deck between its banks, not dipped into the river',()=>{
 const size=101,cell=2,extent=100,ground=new Float32Array(size*size);
 // A 30 m deep gorge along z across x∈[-40,40]; banks at 10 m.
 for(let j=0;j<size;j++)for(let i=0;i<size;i++){const x=i*cell-extent;ground[j*size+i]=Math.abs(x)<40?-20:10;}
 const chains=bridgeChains([{nodes:[1,2],points:[[-50,0],[0,0]],half:5},{nodes:[2,3],points:[[0,0],[50,0]],half:5}]);
 assert.equal(chains.length,1,'split ways are chained');
 const out=stampBridges(ground,size,cell,extent,chains),at=(x,z)=>out[Math.round((z+extent)/cell)*size+Math.round((x+extent)/cell)];
 for(const x of [-30,0,30])assert.ok(Math.abs(at(x,0)-10)<1e-6,`deck at ${x}: ${at(x,0)}`);
 assert.equal(at(0,40),-20,'the river away from the bridge stays');
});

test('streets are smoothed along their own line: unmapped dips and kerb spikes vanish, slopes stay',()=>{
 const size=101,cell=2,extent=100,ground=new Float32Array(size*size);
 for(let j=0;j<size;j++)for(let i=0;i<size;i++){const x=i*cell-extent,z=j*cell-extent;ground[j*size+i]=.06*x+(Math.abs(x-20)<5?-6:0)+(Math.abs(x+30)<2&&Math.abs(z)<3?1.5:0);}
 const out=conditionRoads(ground,ground,size,cell,extent,[[[-90,0],[90,0]]]),at=(x,z)=>out[Math.round((z+extent)/cell)*size+Math.round((x+extent)/cell)];
 for(let x=-70;x<=70;x+=2)assert.ok(Math.abs(at(x,0)-.06*x)<.6,`road at ${x}: ${at(x,0).toFixed(2)} vs ${(.06*x).toFixed(2)}`);
 assert.ok(at(20,60)<-4,'the dip away from the street is untouched');
});

test('the PNG reader decodes filtered RGB rows',async()=>{
 const zlib=await import('node:zlib'),w=3,h=2,raw=Buffer.from([1,10,20,30,11,21,31,12,22,32, 2,1,1,1,1,1,1,1,1,1]); // Sub, then Up filter
 const chunk=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);return Buffer.concat([l,Buffer.from(t),d,Buffer.alloc(4)]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;
 const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
 const {rgb}=readPng(png);assert.deepEqual([...rgb],[10,20,30,21,41,61,33,63,93,11,21,31,22,42,62,34,64,94]);
});

test('draped surfaces follow the ground between their original corners; shaders can recover the layer height',()=>{
 setTerrain(field((x,z)=>Math.sin(x/9)*3+z*.05));
 const g=new THREE.PlaneGeometry(60,60);g.rotateX(-Math.PI/2);g.translate(0,.07,0);
 const d=drapeGeometry(g.toNonIndexed(),{maxEdge:3,mark:true}),p=d.attributes.position,lift=d.attributes.terrainY;
 assert.ok(p.count>100,'large triangles are split');
 for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);assert.ok(Math.abs(p.getY(i)-(groundAt(x,z)+.07))<1e-5);assert.ok(Math.abs(p.getY(i)-lift.getX(i)-.07)<1e-5);}
 // Midpoint of every final triangle stays within 5 cm of the ground (no road sinking into the hill).
 for(let i=0;i<p.count;i+=3){const x=(p.getX(i)+p.getX(i+1)+p.getX(i+2))/3,z=(p.getZ(i)+p.getZ(i+1)+p.getZ(i+2))/3,y=(p.getY(i)+p.getY(i+1)+p.getY(i+2))/3;assert.ok(Math.abs(y-.07-groundAt(x,z))<.05);}
 const sub=subdivideGeometry(new THREE.BoxGeometry(1,1,20).toNonIndexed(),4);assert.ok(sub.attributes.position.count>36&&sub.attributes.normal);
 setTerrain(null);assert.equal(drapeGeometry(g),g,'flat cities keep their geometry');
});

test('objects sit on the ground: buildings on their lowest corner, furniture, instances and placed groups',()=>{
 setTerrain(field((x,z)=>x*.2));
 // A 10×10 m building from x=10 to 20: the downhill corner (x=10, ground 2) carries it.
 const ring=[[10,0],[20,0],[20,10],[10,10]],array=[],part={start:0,count:0};
 for(const [x,z] of ring)for(const y of [0,12])array.push(x,y,z,0,0);part.count=array.length/5;
 liftBuildings(array,[part]);assert.ok(Math.abs(part.base-2)<1e-5);assert.ok(Math.abs(Math.min(...array.filter((_,i)=>i%5===1))-2)<1e-5);
 assert.ok(Math.abs(footprintBase([ring])-2)<1e-5);
 const root=new THREE.Group(),post=new THREE.Mesh(new THREE.CylinderGeometry(.1,.1,3).translate(30,1.5,0)),inst=new THREE.InstancedMesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial(),1),placed=new THREE.Group();
 inst.setMatrixAt(0,new THREE.Matrix4().makeTranslation(-20,0,5));placed.position.set(40,0,0);placed.add(new THREE.Mesh(new THREE.BoxGeometry()));
 const landmark=new THREE.Group();landmark.userData.building=true;landmark.add(new THREE.Mesh(new THREE.BoxGeometry(10,8,10).translate(-5,4,0)));
 root.add(post,inst,placed,landmark);settleObject(root);
 post.geometry.computeBoundingBox();assert.ok(Math.abs(post.geometry.boundingBox.min.y-6)<.03,'post foot on the ground');
 const m=new THREE.Matrix4();inst.getMatrixAt(0,m);assert.ok(Math.abs(m.elements[13]+4)<1e-5,'instance lifted');
 assert.ok(Math.abs(placed.position.y-8)<1e-5,'placed group moved as a whole');
 assert.ok(Math.abs(landmark.position.y+2)<1e-4,'landmark stands on its lowest ground');
 setTerrain(null);
});

test('lakes and mapped water keep their own flat levels',()=>{
 const size=41,lake=new Float32Array(size*size).fill(NaN),water=new Float32Array(size*size).fill(NaN);
 for(let j=0;j<20;j++)for(let i=0;i<size;i++)lake[j*size+i]=6.2;for(let j=30;j<size;j++)for(let i=0;i<10;i++)water[j*size+i]=-7.7;
 setTerrain(field(()=>0,{size,water,lake}));
 assert.equal(lakeAt(0,-30),6.199999809265137);assert.equal(lakeAt(0,30),null);assert.ok(Math.abs(waterAt(-35,35)+7.7)<1e-5);assert.equal(waterAt(30,-30),null);
 const g=createLakeGeometry({spread:1}),p=g.attributes.position;for(let i=0;i<p.count;i++)assert.ok(Math.abs(p.getY(i)-6.15)<1e-4);
 const car=makeCar(0,-10);car.heading=0;car.speed=10;const e=new SpatialIndex([]),r=driveStep(car,new Set(['KeyW']),.1,{buildings:e,roads:e,pavement:e,water:[]});assert.equal(r.collision,'water','no driving into a lake');
 setTerrain(null);
});

test('car on a slope: wheels on the ground, nose up uphill, gravity slows the climb and pulls downhill',()=>{
 const grade=.08;setTerrain(field((x,z)=>-grade*z,{size:401,cell:2})); // rises towards -z, the way a car with heading 0 faces
 const up=makeCar(0,300),flat=makeCar(0,300),down=makeCar(0,-300,Math.PI);
 assert.ok(Math.abs(up.y-groundAt(0,300))<.02);assert.ok(up.pitch>.07&&up.pitch<.09,'nose up');assert.ok(down.pitch<-.07,'nose down');assert.ok(Math.abs(up.roll)<1e-6);
 const keys=new Set(['KeyW']);for(let i=0;i<240;i++)driveStep(up,keys,1/60,flatWorld());
 setTerrain(null);for(let i=0;i<240;i++)driveStep(flat,keys,1/60,flatWorld());
 setTerrain(field((x,z)=>-grade*z,{size:401,cell:2}));
 assert.ok(up.speed<flat.speed-1,`uphill ${up.speed.toFixed(2)} < flat ${flat.speed.toFixed(2)}`);
 assert.ok(Math.abs(up.y-groundAt(up.x,up.z))<.05&&up.y>=groundAt(up.x,up.z)-1e-6,'on the ground, not clipping');
 // Coasting: downhill keeps speed longer than uphill.
 const a=makeCar(0,0),b=makeCar(0,0,Math.PI);a.speed=b.speed=12;
 for(let i=0;i<120;i++){driveStep(a,new Set(),1/60,flatWorld());driveStep(b,new Set(),1/60,flatWorld());}
 assert.ok(b.speed>a.speed+1,`downhill ${b.speed.toFixed(2)} > uphill ${a.speed.toFixed(2)}`);
 // Side slope: rolls, camera stays above the ground behind the car.
 setTerrain(field((x,z)=>.1*x,{size:201,cell:2}));const side=makeCar(0,0);assert.ok(side.roll>.09,'right side up');
 const cam=drivingCameraPose(side,0,150);assert.ok(cam.position[1]>groundAt(cam.position[0],cam.position[2])+1);assert.ok(cam.target[1]>side.y);
 setTerrain(null);
});

const grid=(size,cell,fn)=>{const extent=(size-1)*cell/2,g=new Float32Array(size*size);for(let j=0;j<size;j++)for(let i=0;i<size;i++)g[j*size+i]=fn(i*cell-extent,j*cell-extent);return g;};
const sample=(g,size,cell)=>{const extent=(size-1)*cell/2;setTerrain({size,cell,extent,base:0,ground:g,water:null,lake:null});return (x,z)=>groundAt(x,z);};

test('a profile keeps its slopes but a spike becomes a ramp no steeper than allowed',()=>{
 const h=[...Array(200)].map((_,i)=>i*2*.05+(i>=98&&i<102?6:0)),out=limitProfile(h,h.map(()=>.12),2);
 for(let i=1;i<out.length;i++)assert.ok(Math.abs(out[i]-out[i-1])<=.24+1e-9,`step ${i}`);
 for(const i of [0,40,140,199])assert.ok(Math.abs(out[i]-h[i])<1e-9,'slope away from the spike untouched');
 assert.ok(out[100]-h[100]<-2.5&&out[100]>h[100]-6+2.5,'met halfway');
});

test('grade-separated crossing: neither road jumps; a footbridge never lifts the street below',()=>{
 const size=201,cell=2,extent=200,bare=grid(size,cell,()=>0);
 // A bridge (layer 1) runs north-south 6 m up on its embankment across a street (layer 0) on flat ground.
 const ways=[{nodes:[1,2],tags:{highway:'secondary',bridge:'yes',layer:'1',name:'Silta'}},{nodes:[3,4],tags:{highway:'primary',name:'Katu'}},{nodes:[5,6],tags:{highway:'primary',tunnel:'yes'}},{nodes:[7,8],tags:{highway:'footway'}}];
 const at={1:[0,-150],2:[0,150],3:[-150,0],4:[150,0],5:[0,0],6:[9,9],7:[0,-30],8:[0,30]},roads=roadLines(ways,id=>at[id]);
 assert.deepEqual(roads.map(r=>[r.name,r.layer]),[['Silta',1],['Katu',0]],'tunnels and footways are not carriageways');
 const low=roadLayers(roads,size,cell,extent),over=new Int8Array(size*size).fill(-128);
 const decks=stampBridges(bare,size,cell,extent,[{points:[[0,-150],[0,150]],half:5,car:true,layer:1}],low,over);
 for(let j=0;j<size;j++)for(let i=0;i<size;i++)if(Math.abs(i*cell-extent)<5)decks[j*size+i]=6; // the embankment
 const before=conditionRoads(bare,decks,size,cell,extent,roads,{bare,over});
 assert.ok(gradeSpikes(sample(before,size,cell),roads).some(p=>p.grade>.3),'plain averaging makes a wall');
 const junctions=junctionMask(over,low,size,cell),out=conditionRoads(bare,decks,size,cell,extent,roads,{bare,over,junctions,max:.12}),h=sample(out,size,cell);
 assert.deepEqual(gradeSpikes(h,roads,{slack:.02}),[],'every carriageway within 12 %');
 assert.ok(Math.abs(h(-140,0))<.2&&Math.abs(h(0,140)-6)<.2,'away from the junction both keep their levels');
 // A footbridge over the street: its deck stops at the carriageway, which stays where it was.
 const cut=grid(size,cell,(x,z)=>Math.abs(z)<20?3:9),fb=[{points:[[0,-20],[0,20]],half:2,car:false,layer:1}],q=(x,z)=>Math.round((z+extent)/cell)*size+Math.round((x+extent)/cell);
 const foot=stampBridges(cut,size,cell,extent,fb,low);
 assert.equal(foot[q(0,0)],3,'street under the footbridge untouched');assert.equal(foot[q(0,-14)],9,'the rest of the deck spans the cutting');
 assert.equal(stampBridges(cut,size,cell,extent,fb)[q(0,0)],9,'(without layers the deck would bury the street)');
 setTerrain(null);
});

test('a genuinely steep street keeps its grade away from junctions',()=>{
 const size=201,cell=2,extent=200,bare=grid(size,cell,x=>.16*x),line=[{points:[[-150,0],[150,0]],layer:0,name:'Jyrkkä'}];
 const out=conditionRoads(bare,bare,size,cell,extent,line,{bare,max:.12}),h=sample(out,size,cell);
 assert.ok(Math.abs((h(20,0)-h(-20,0))/40-.16)<.01,'16 % stays 16 %');
 assert.deepEqual(gradeSpikes(h,line,{level:streetLevel(bare,bare,null,size,cell,extent)}),[]);
 setTerrain(null);
});

test('lake shores follow the bank smoothly instead of 3 m steps',()=>{
 const size=61,cell=3,extent=90,lake=new Float32Array(size*size).fill(NaN);
 const ground=grid(size,cell,(x,z)=>Math.max(0,Math.hypot(x,z)-40)*.08); // a round lake 40 m across, gently rising banks
 for(let j=0;j<size;j++)for(let i=0;i<size;i++)if(Math.hypot(i*cell-extent,j*cell-extent)<36)lake[j*size+i]=0;
 setTerrain({size,cell,extent,base:0,ground,water:null,lake});
 const g=createLakeGeometry(),p=g.attributes.position,radii=[],shore=40+.75/.08;
 for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),r=Math.hypot(x,z),off=v=>Math.abs(v/cell-Math.round(v/cell))>.01;if(off(x)||off(z))radii.push(r);assert.ok(r<shore+1.5);assert.ok(Math.abs(p.getY(i)+.05)<1e-6);}
 // The shoreline is where the drawn ground (0.5 m below the field) rises 0.3 m above the water: r = 40 + 0.75/0.08.
 assert.ok(radii.length>40,'shore vertices between the grid points');
 for(const r of radii)assert.ok(Math.abs(r-shore)<1.5,`shore point at ${r.toFixed(2)} m, expected ${shore.toFixed(2)}`);
 const w=lakeSurface();assert.ok(w.depth[30*size+30]>0&&w.depth[30*size+1]<0,'the map shows the lake, not the land');
 // Shallows a few decimetres above the level (lidar noise on the water, reeds) sink below it; the bank stays.
 const shallow=ground.map((v,k)=>v+(k%7===0&&!Number.isNaN(lake[k])?.3:0)),bed=lakeBed(shallow,lake,new Uint8Array(size*size),size);
 for(let k=0;k<bed.length;k++){if(!Number.isNaN(lake[k]))assert.ok(bed[k]<=-.8+1e-6);if(ground[k]>1)assert.equal(bed[k],shallow[k]);}
 setTerrain(null);
});

test('Tampere: no drivable street jumps at its interchanges (Rantatunneli, Sorinsilta, Lapintie)',async()=>{
 const fs=await import('node:fs'),{gunzipSync}=await import('node:zlib');
 setTerrain(decodeTerrain(gunzipSync(fs.readFileSync('public/cities/tampere/terrain.pack'))));
 const roads=JSON.parse(fs.readFileSync('public/cities/tampere/mobility.json')).roads.edges.map(e=>({points:e.points,layer:0}));
 const spikes=gradeSpikes(groundAt,roads,{max:.12,radius:1500});
 assert.ok(spikes.every(p=>p.grade<=.22),`steepest ${JSON.stringify(spikes[0])}`);
 assert.ok(spikes.length<=12,`${spikes.length} spots above 12 %`);
 for(const [x,z] of [[757,-1062],[603,-1037],[624,-882],[684,308],[-227,757]])assert.ok(!spikes.some(p=>Math.hypot(p.x-x,p.z-z)<30),`interchange at ${x},${z}`);
 setTerrain(null);
});

test('surface triangles draped just above water are dropped, quay-level ones kept', () => {
 const tri=(x,h)=>[x,0,0, x+1,0,0, x,0,1].map((v,i)=>i%3===1?h:v);
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array([...tri(0,0),...tri(10,0),...tri(20,0)]),3));
 g.setAttribute('terrainY',new THREE.BufferAttribute(new Float32Array([-5.2,-5.2,-5.2, -4,-4,-4, -5.2,-5.2,-5.2]),1));
 const water=(x)=>x<15?-6.1:null; // first two triangles over water, the third on land
 dropSunkenSurfaces(g,{water});
 assert.equal(g.userData.sunkenDropped,1);
 assert.deepEqual([...g.index.array],[3,4,5,6,7,8]);
});

test('dry samples at sea-bed height outside the mapped water are raised to quay height', async () => {
 const {raiseDryHollows}=await import('../src/terrain.js');
 const size=5,ground=new Float32Array(size*size).fill(-8),water=new Float32Array(size*size).fill(-6);
 const f={size,cell:2,extent:4,ground,water};
 const n=raiseDryHollows((x,z)=>x<0,{shelf:false},f); // the west half is mapped water
 assert.equal(n,15);                             // x = 0, 2, 4 are dry
 assert.equal(ground[0],-8);                      // x=-4: water, untouched
 assert.ok(Math.abs(ground[4]-(-4.4))<1e-6);      // x=+4: dry, raised to water+1.6
});

test('a pond level spread above a flat square does not lift single samples out of the square', async () => {
 const {raiseDryHollows}=await import('../src/terrain.js');
 // flat square at 0.4 above a harbour (sea level -6, the south rows); a pond in the middle column whose level (0.5)
 // the model spread over the samples beside it
 const size=15,ground=new Float32Array(size*size).fill(.4),water=new Float32Array(size*size).fill(NaN);
 for(let j=0;j<=8;j++)for(let i=6;i<=8;i++)water[j*size+i]=.5;
 for(let j=10;j<size;j++)for(let i=0;i<size;i++){water[j*size+i]=-6;ground[j*size+i]=-8;}
 const n=raiseDryHollows((x,z)=>z>=9||Math.abs(x)<1&&z<=3,{shelf:false},{size,cell:3,extent:21,ground,water});
 assert.equal(n,0);
 for(let j=0;j<10;j++)for(let i=0;i<size;i++)assert.ok(Math.abs(ground[j*size+i]-.4)<1e-6,`the square stays flat (${i},${j}: ${ground[j*size+i]})`);
});

test('a bank deeper than maxRaise is raised by maxRaise, not left as a cliff, and never above the ground behind it', async () => {
 const {levelBanks}=await import('../src/terrain.js');
 const size=24,cell=3,extent=36,ground=new Float32Array(size*size),water=new Float32Array(size*size).fill(NaN);
 // water west of x=0; a long even slope rising 0.7 m per cell inland (a rampart), no flat land within reach
 for(let j=0;j<size;j++)for(let i=0;i<size;i++){const x=-extent+i*cell,k=j*size+i;water[k]=x<15?-1:NaN;ground[k]=x<0?-3:x/cell*.7;}
 levelBanks((x,z)=>x<0,{shelf:false},{size,cell,extent,ground,water});
 const row=[];for(let i=0;i<size;i++){const x=-extent+i*cell;if(x>=0)row.push(ground[12*size+i]);}
 for(let i=1;i<row.length;i++)assert.ok(row[i]>=row[i-1]-1e-6,`no ridge: ${row.map(v=>v.toFixed(2)).join(' ')}`);
 for(let i=1;i<row.length;i++)assert.ok(row[i]-row[i-1]<=.7+1e-6,`no cliff steeper than the slope: ${row.map(v=>v.toFixed(2)).join(' ')}`);
});

test('the first water sample beside a quay takes the quay height (no slope into the canal)', async () => {
 const {raiseDryHollows}=await import('../src/terrain.js');
 const size=5,ground=new Float32Array(size*size),water=new Float32Array(size*size).fill(-6);
 for(let j=0;j<size;j++)for(let i=0;i<size;i++)ground[j*size+i]=i<2?-8:-4;   // canal west, quay at -4 east
 raiseDryHollows((x,z)=>x<0,{},{size,cell:2,extent:4,ground,water});
 assert.equal(ground[2*size+1],-4);   // x=-2, beside the quay: shelf
 assert.equal(ground[2*size+0],-8);   // x=-4: canal bed
});

test('a bank blurred into a slope is levelled to the land behind it; land farther out and higher ground stay', async () => {
 const {levelBanks}=await import('../src/terrain.js');
 const size=20,cell=3,extent=30,ground=new Float32Array(size*size),water=new Float32Array(size*size).fill(NaN);
 // lake west of x=0 at 0.8; the bank rises 1.0 -> 1.8 over four cells, then flat land at 1.8; a 6 m hill far east
 for(let j=0;j<size;j++)for(let i=0;i<size;i++){const x=-extent+i*cell,k=j*size+i;water[k]=x<12?.8:NaN;ground[k]=x<0?-.5:x<12?1+x/12*.8:x<45?1.8:6;}
 const plain=ground.slice(),n=levelBanks((x,z)=>x<0,{},{size,cell,extent,ground,water});
 assert.ok(n>0);
 const at=x=>ground[10*size+Math.round((x+extent)/cell)];
 for(const x of [0,3,6,9])assert.ok(Math.abs(at(x)-1.8)<1e-6,`bank at x=${x} is level with the land (${at(x)})`);
 assert.ok(Math.abs(at(-3)-1.8)<1e-6,'the quay shelf: the water cell the shoreline crosses is level with the quay');
 assert.equal(at(-6),-.5);   // the lake bed further out is untouched
 assert.ok(Math.abs(at(27)-1.8)<1e-6);   // land behind stays where it was
 levelBanks((x,z)=>x<0,{shelf:false},{size,cell,extent,ground:plain,water});
 assert.equal(plain[10*size+Math.round((-3+extent)/cell)],-.5,'without the shelf the bed stays');
});

test('water at street height (a moat the elevation model never saw) is sunk below its banks; a real basin is left alone', async () => {
 const {sinkShallowWater}=await import('../src/terrain.js');
 const size=12,cell=3,extent=18,ground=new Float32Array(size*size).fill(2.6),water=new Float32Array(size*size).fill(NaN);
 // a moat strip (x in [-6,3]) at 2.5 on 2.6 m ground; a harbour basin (x > 9) at 0 below 2.6 m quays
 for(let j=0;j<size;j++)for(let i=0;i<size;i++){const x=-extent+i*cell,k=j*size+i;if(x>=-6&&x<=3){water[k]=2.5;}if(x>9){water[k]=0;ground[k]=-4;}}
 const wet=(x)=>(x>=-6&&x<=3)||x>9;
 const n=sinkShallowWater(wet,{},{size,cell,extent,ground,water});
 assert.equal(n,1);
 const k=6*size+Math.round((0+extent)/cell);
 assert.ok(Math.abs(water[k]-(2.6-1.8))<1e-5,`moat level ${water[k]}`);
 assert.ok(ground[k]<water[k]-1);
 assert.equal(water[6*size+size-1],0); // the harbour keeps its level
});

test('surveyed building parts (abs) keep their heights; other parts stand on the lowest ground under them', async () => {
 const {liftBuildings,setTerrain,terrain}=await import('../src/terrain.js');
 const before=terrain(),size=3,ground=new Float32Array(size*size).fill(2);
 setTerrain({size,cell:10,extent:10,ground,water:null});
 try{
  const a=new Float32Array([0,5,0,0,0, 1,9,0,0,0, 0,9,1,0,0,  0,.12,0,0,0, 1,4,0,0,0, 0,4,1,0,0]);
  const parts=[{start:0,count:3,abs:1},{start:3,count:3}];
  liftBuildings(a,parts);
  assert.equal(a[1],5);assert.equal(parts[0].base,5);          // surveyed: untouched, base = its foot
  assert.ok(Math.abs(a[16]-2.12)<1e-6);assert.equal(parts[1].base,2); // relative: lifted onto the ground
 }finally{setTerrain(before);}
});

test('a bridge deck drawn over the water carries whatever drives onto it',()=>{
 // a canal 20 m wide (bed 4 m down, water at -3) the elevation model saw no bridge over; a deck drawn at street level crosses it
 const size=41,water=new Float32Array(size*size).fill(NaN),f=field((x)=>Math.abs(x)<10?-4:0,{size,water});
 for(let j=0;j<size;j++)for(let i=0;i<size;i++)if(Math.abs(i*2-40)<10)water[j*size+i]=-3;
 setTerrain(f);const wet=(x,z)=>Math.abs(x)<10;
 assert.ok(groundAt(0,0)<-3.9,'before: the canal bed under the deck');
 const raised=raiseBridgeDecks([{rings:[[[-14,-3],[14,-3],[14,3],[-14,3]]],y:.035}],wet);
 assert.ok(raised>0);assert.ok(Math.abs(groundAt(0,0)+.085)<.02,`12 cm under the deck plate (a car's ride height puts its wheels on the plate; street surfaces draped on the ground stay under it), got ${groundAt(0,0)}`);assert.ok(Math.abs(groundAt(-6,2)+.085)<.02,'to its edges');
 assert.ok(groundAt(0,12)<-3.9,'open water beside the bridge stays water');assert.equal(groundAt(12,0),0,'the banks are left alone');
 assert.equal(raiseBridgeDecks([{rings:[[[-14,-3],[14,-3],[14,3],[-14,3]]],y:.035}],wet),0,'raising twice changes nothing');
 setTerrain(null);
});
