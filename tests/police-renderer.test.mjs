import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene} from 'three';
import {createPoliceRenderer,strobe,wigwag} from '../src/police-renderer.js';
import {createPoliceBody,unitNumber,unitVariant,POLICE_SPECS} from '../src/police-model.js';
import {sirenMix} from '../src/police-siren.js';
import {createVehicle} from '../src/vehicles.js';

// Minimal canvas stand-in: every 2D context call is a no-op.
const ctx=new Proxy({},{get:(t,k)=>k==='createRadialGradient'?()=>({addColorStop(){}}):k==='measureText'?()=>({width:1}):()=>{},set:()=>true}); // measureText: the officers' uniform lettering (person-model.js), made with the renderer
function withDocument(run){
 const original=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>ctx})};
 try{run();}finally{if(original===undefined)delete globalThis.document;else globalThis.document=original;}
}

test('light bar strobes alternate sides in rapid triple flashes; headlamps wig-wag',()=>{
 let flashes=[0,0],both=0,lastA=0,edgesA=0;
 for(let t=0;t<.62;t+=.001){const a=strobe(t,0),b=strobe(t,1);flashes[0]+=a;flashes[1]+=b;if(a&&b)both++;if(a&&!lastA)edgesA++;lastA=a;}
 assert.equal(both,0,'never both sides at once');assert.ok(flashes[0]>0&&flashes[1]>0);assert.equal(edgesA,3,'triple flash per cycle');
 assert.notEqual(wigwag(.1,0),wigwag(.1,1));
});

test('police steering, brake lamps, strobes and beacon update without altering civilian materials',()=>withDocument(()=>{
 const scene=new Scene(),civilian=createVehicle(1,false,'estate');
 const civilianTail=civilian.getObjectByName('tail').material,civilianPaint=civilian.getObjectByName('paint').material;
 const unit={id:'test',x:0,z:0,heading:0,speed:8,braking:false};
 const sim={units:[unit],time:0,serial:0,player:{x:0,z:20}},renderer=createPoliceRenderer(scene,sim);
 renderer.update(1/60);const car=scene.children.find(o=>o.name==='Police pursuit car');
 assert.equal(car.userData.policeLights.length,4);
 assert.notEqual(car.userData.policeLights[0].material.emissiveIntensity,car.userData.policeLights[2].material.emissiveIntensity);
 assert.equal(car.userData.policePool.visible,true,'nearest car washes the road in flashing blue');
 assert.notEqual(car.userData.tail,civilianTail);assert.equal(civilianPaint.color.getHexString(),civilian.getObjectByName('paint').material.color.getHexString());
 unit.heading=.1;unit.braking=true;renderer.update(1/60);
 assert.ok(car.userData.wheels.filter(w=>w.front).every(w=>w.pivot.rotation.y>0));
 assert.equal(car.userData.tail.emissiveIntensity,1.6);assert.equal(civilianTail.emissiveIntensity,.35);
 sim.time=.34;renderer.update(1/60);
 assert.equal(car.userData.policeLights[0].material.emissiveIntensity,.15);
 assert.equal(car.userData.policeLights[2].material.emissiveIntensity,3.2);
 sim.player={x:500,z:0};renderer.update(1/60);assert.equal(car.userData.policePool.visible,false,'no light pool for distant cars');
 let disposed=0;car.userData.ownedMaterials.forEach(m=>m.addEventListener('dispose',()=>disposed++));
 sim.units=[];renderer.update(1/60);
 assert.equal(scene.children.length,0,'car removed; no scene lights are ever added');
 assert.equal(disposed,car.userData.ownedMaterials.length);
}));

test('siren is silent without police, louder when closer, and yelps up close',()=>{
 const player={x:0,z:0};
 assert.equal(sirenMix([],player,0).volume,0);assert.equal(sirenMix([{x:400,z:0}],player,0).volume,0);
 const far=sirenMix([{x:150,z:0}],player,1),near=sirenMix([{x:20,z:0}],player,1);
 assert.ok(near.volume>far.volume&&far.volume>0);
 const pitches=new Set();for(let t=0;t<.32;t+=.04)pitches.add(Math.round(sirenMix([{x:20,z:0}],player,t).frequency));
 assert.ok(pitches.size>4,'pitch sweeps');
});

test('patrol bodies: Octavia-size estate and Vito-size van in the Poliisi livery, under 6k triangles each',()=>withDocument(()=>{
 assert.equal(unitVariant(0),'estate');assert.equal(unitVariant(1),'van');
 for(const i of [0,1,2,7])assert.match(unitNumber(i),/^[1-5]\d\d$/,'Helsinki units carry three-digit numbers (e.g. 206, 512)');
 assert.notEqual(unitNumber(0),unitNumber(1));
 const estate=createPoliceBody('estate'),van=createPoliceBody('van');
 assert.ok(POLICE_SPECS.estate.l>4.5&&POLICE_SPECS.estate.l<4.8&&POLICE_SPECS.van.l>5&&POLICE_SPECS.van.h>1.85);
 const tris=o=>{let n=0;o.traverse(m=>{if(m.isMesh)n+=m.geometry.attributes.position.count/3;});return n;};
 for(const body of [estate,van])assert.ok(tris(body)<6000,`${body.userData.type} has ${tris(body)} triangles`);
 assert.equal(estate.userData.numberColour,'#f4f5f2','white unit number on the blue bonnet');assert.ok(van.userData.mounts.numbers.length>=5,'van numbers on bonnet, rear, both front wings and roof');
 for(const body of [estate,van]){
  const paint=body.getObjectByName('paint');
  assert.ok(paint.material.map,'livery is a texture atlas on the body');
  assert.ok(paint.geometry.attributes.uv,'body is projected into the atlas');
  assert.equal(body.userData.wheels.length,4);assert.ok(body.userData.wheels.every(w=>w.radius>.3));
  assert.ok(body.userData.mounts.numbers.length>=2,'unit number decals on the bonnet and rear glass');
  assert.ok(body.userData.mounts.bar.w>.3,'light bar lenses are the outer thirds of the bar');
 }
 assert.equal(estate.getObjectByName('paint').material.map,createPoliceBody('estate').getObjectByName('paint').material.map,'atlas shared between units');
 assert.notEqual(estate.getObjectByName('paint').material.map,van.getObjectByName('paint').material.map);
 assert.equal(estate.getObjectByName('paint').material.map.image.width,2048);
}));

test('per-unit variant, number decals and geometry are released when the unit leaves',()=>withDocument(()=>{
 const scene=new Scene(),sim={units:[{id:'police-0',x:0,z:0,heading:0,speed:0},{id:'police-1',x:30,z:0,heading:0,speed:0}],time:0,player:{x:0,z:5}};
 const renderer=createPoliceRenderer(scene,sim);renderer.update(1/60);
 const [a,b]=scene.children;assert.equal(a.userData.type,'estate');assert.equal(b.userData.type,'van');
 assert.notEqual(a.userData.phase,b.userData.phase,'convoys do not flash in sync');
 const geometries=new Set(),disposed=new Set();a.traverse(o=>{if(o.isMesh&&!o.geometry.userData.shared)geometries.add(o.geometry);});
 geometries.forEach(g=>g.addEventListener('dispose',()=>disposed.add(g)));
 sim.units=[sim.units[1]];renderer.update(1/60);
 assert.equal(scene.children.length,1);assert.ok(geometries.size>10);assert.equal(disposed.size,geometries.size,'per-car geometry disposed');
 assert.ok(b.getObjectByName('paint').material.map.image,'shared atlas survives the other unit leaving');
}));
