import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {validateFacades,normaliseFacade,storeyBands,storeyStyle,attachFacades,applyFacadeHeights,facadeFor} from '../src/facade-data.js';
import {createFacade,bays} from '../src/facade-renderer.js';
import {analyseBuilding,createModelledBuilding} from '../src/building-detail.js';
import {streetLine,alongStreet,frontingBuildings,photosShowing,pickPhotos} from '../src/facade-photos.js';

// A footprint extruded the way scripts/city-build.mjs does it: x east, z south, 5 floats per vertex.
function extrude(ring,h){
 const v=[],top=h+.12;
 for(let i=1;i<ring.length;i++){const [x0,z0]=ring[i-1],[x1,z1]=ring[i];v.push(x0,.12,z0,0,0, x1,.12,z1,1,0, x1,top,z1,1,1, x0,.12,z0,0,0, x1,top,z1,1,1, x0,top,z0,0,1);}
 const [a,b,c,d]=ring;for(const p of [a,c,b,a,d,c])v.push(p[0],top,p[1],0,0);
 return new Float32Array(v);
}
const RING=[[0,0],[0,10],[24,10],[24,0],[0,0]]; // clockwise in x/z: walls face outwards
const part=(extra={})=>({id:'osm-way-1',bbox:[0,0,24,10],height:16,start:0,count:RING.length*6-6+6,ratu:undefined,texture:null,...extra});
const SPEC={schemaVersion:1,buildings:{'osm-way-1':{storeys:5,wall:'#c86432',roof:'#203040',windows:{pitch:2.5},ground:{type:'shops',band:'#101010'},evidence:{photos:[{id:'123',captured:'2020-06-15'}],confidence:.5}}}};

test('the committed façade files are valid and only describe real buildings',()=>{
 const data=JSON.parse(readFileSync(new URL('../cities/tampere/facades.json',import.meta.url)));
 assert.deepEqual(validateFacades(data),[]);
 const ids=new Set(JSON.parse(readFileSync(new URL('../public/cities/tampere/buildings3d-index.json',import.meta.url))).tiles.flatMap(t=>t.parts.map(p=>p.id)));
 for(const id of [...Object.keys(data.buildings),...data.groups.flatMap(g=>g.ids)])assert.ok(ids.has(id),`${id} is not a Tampere building`);
 // Words and numbers only: no embedded images.
 assert.doesNotMatch(JSON.stringify(data),/data:image|base64/);
 for(const v of data.views)assert.ok(Number.isFinite(v.x)&&Number.isFinite(v.z)&&v.heading>=0&&v.heading<360);
});

test('validation catches bad colours, shapes, storeys and missing evidence',()=>{
 assert.deepEqual(validateFacades(SPEC),[]);
 const bad={schemaVersion:1,buildings:{a:{wall:'beige',storeys:2.5,windows:{shape:'round'},ground:{type:'mall'}}},groups:[{ids:[],facade:{wall:'#ffffff',evidence:{photos:[],confidence:2}}}]};
 const errors=validateFacades(bad).join('\n');
 for(const want of ['wall','storeys','shape','ground.type','evidence.photos','groups[0].ids','confidence'])assert.match(errors,new RegExp(want.replace(/[[\]]/g,'\\$&')));
 assert.ok(validateFacades(null).length&&validateFacades({schemaVersion:2,buildings:{}}).length);
});

test('defaults, storey bands and per-storey styles',()=>{
 const s=normaliseFacade({wall:'#ffffff',storeys:4,groundStorey:4,storeyWindows:{'-1':{shape:'ribbon'},2:{shape:'arch'}}},16);
 assert.equal(s.height,16);assert.equal(s.windows.shape,'rect');assert.equal(s.ground.type,'shops');
 const bands=storeyBands(s,16);assert.equal(bands.length,4);assert.deepEqual([bands[0].y0,bands[0].y1],[0,4]);
 assert.ok(bands.at(-1).y1<=16);for(let i=1;i<bands.length;i++)assert.equal(bands[i].y0,bands[i-1].y1);
 assert.equal(storeyStyle(s,2,4).shape,'arch');assert.equal(storeyStyle(s,3,4).shape,'ribbon');assert.equal(storeyStyle(s,1,4).shape,'rect');
 assert.equal(normaliseFacade({wall:'#ffffff'},10).storeys,3);
 assert.equal(bays(0,10,2.5).length,3);assert.deepEqual(bays(0,1,2.5),[]);
});

test('groups and height fixes attach to building parts and survive tile reloads',()=>{
 const index={tiles:[{parts:[part(),{...part(),id:'osm-way-2',height:10}]}]};
 const data={...SPEC,groups:[{ids:['osm-way-2'],facade:{height:3,storeys:1,material:'glass',wall:'#808080',evidence:{photos:[],confidence:.3}}}]};
 assert.equal(facadeFor(data,'osm-way-2').height,3);
 assert.equal(attachFacades(index,data),2);
 const shelter=index.tiles[0].parts[1];shelter.start=0;shelter.count=RING.length*6;
 for(let reload=0;reload<2;reload++){
  const a=extrude(RING,10),foot=Math.min(...a.filter((_,i)=>i%5===1)),top=Math.max(...a.filter((_,i)=>i%5===1));applyFacadeHeights(a,[shelter]);
  assert.ok(Math.abs(Math.max(...a.filter((_,i)=>i%5===1))-(foot+(top-foot)*.3))<.01,'roof lowered to the described height (stretched from its foot)');
  assert.ok(Math.abs(Math.min(...a.filter((_,i)=>i%5===1))-foot)<1e-6,'the foot stays on the ground');
 }
 assert.equal(shelter.height,3);
});

test('described buildings get coloured walls, real window bays, shop glazing and roof colour',()=>{
 const p=part();attachFacades({tiles:[{parts:[p]}]},SPEC);
 const array=extrude(RING,16),result=createModelledBuilding(array,p,null,null);
 // Untextured: shell, glass and relief are one combined mesh (one draw call per building).
 const detail=result.meshes.filter(m=>m.userData.role==='facade');
 assert.equal(detail.length,1,'one combined facade mesh');assert.equal(result.meshes.filter(m=>m.userData.role==='facade-detail').length,0);
 assert.ok(result.meshes.find(m=>m.userData.role==='facade').geometry.attributes.aGlass.array.some(v=>v===1),'glass flagged in the facade mesh');
 assert.ok(result.meshes.every(m=>m.userData.role==='facade-detail'||!m.userData.provisional),'no provisional placeholder bays');
 // 4 upper storeys × bays on two 24 m and two 10 m walls, plus shop bays at street level.
 const upper=4*(2*bays(0,24,2.5).length+2*bays(0,10,2.5).length);
 assert.ok(result.windows>=upper&&result.windows<=upper+40,`windows ${result.windows}`);
 const wall=new THREE.Color('#c86432'),facade=result.meshes.find(m=>m.userData.role==='facade').geometry.attributes.color;
 const hasColour=(c,arr=facade.array)=>{for(let i=0;i<arr.length;i+=3)if(Math.abs(arr[i]-c.r)<1e-6&&Math.abs(arr[i+1]-c.g)<1e-6&&Math.abs(arr[i+2]-c.b)<1e-6)return true;return false;};
 assert.ok(hasColour(wall),'wall colour applied');
 const roof=new THREE.Color('#203040'),cols=facade.array;let roofed=false;for(let i=0;i<cols.length;i+=3)if(Math.abs(cols[i]-roof.r)<1e-6&&Math.abs(cols[i+1]-roof.g)<1e-6&&Math.abs(cols[i+2]-roof.b)<1e-6){roofed=true;break;}
 assert.ok(roofed,'roof colour applied (roof is part of the combined shell)');
 for(const m of detail){const pos=m.geometry.attributes.position.array;assert.ok(pos.every(Number.isFinite));m.geometry.computeBoundingBox();const b=m.geometry.boundingBox;
  assert.ok(b.min.y>=-.01&&b.max.y<=16.6&&b.min.x>-2.5&&b.max.x<26.5,'details stay on the building');
  assert.ok(b.min.x<-.01&&b.max.x>24.01&&b.min.z<-.01&&b.max.z>10.01,'details sit on the outside of the walls');}
 const tris=detail.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0);assert.ok(tris<result.windows*70,`cheap: ${tris} triangles (shell, deep surrounds, sills and hoods included)`);
});

test('missing data keeps the provisional look; glass and ribbon styles render',()=>{
 const plain=createModelledBuilding(extrude(RING,16),part(),null,null);
 assert.ok(!plain.meshes.some(m=>m.userData.role==='facade-detail'));
 assert.ok(plain.meshes.some(m=>m.userData.provisional),'provisional bays as before');
 const faces=analyseBuilding(extrude(RING,16),part(),null).faces;
 const ribbon=createFacade(faces,normaliseFacade({wall:'#ffffff',storeys:5,windows:{shape:'ribbon'}},16));
 const glass=createFacade(faces,normaliseFacade({wall:'#ffffff',storeys:1,material:'glass',windows:{shape:'none'},height:3},3));
 assert.ok(ribbon.glass&&ribbon.windows>0&&glass.glass&&glass.windows>0);
 assert.equal(createFacade([],normaliseFacade({wall:'#ffffff'},10)).glass,null);
});

test('photo matching: street line, views, buildings shown and spacing',()=>{
 const road=(x0,x1)=>({rings:[[[x0,-5],[x1,-5],[x1,5],[x0,5],[x0,-5]]]});
 const line=streetLine([road(0,50),road(100,150),road(50,100)]);
 assert.deepEqual(line.map(p=>p[0]),[25,75,125]);
 const at=alongStreet(line,60,8,90);assert.equal(at.offset,8);assert.equal(at.view,'forward');
 assert.equal(alongStreet(line,60,0,270).view,'backward');assert.equal(alongStreet(line,60,0,0).view,'left');
 // A building south of the street (larger z) with its front wall facing north.
 const fronting=frontingBuildings([{id:'b',rings:[[[40,12],[80,12],[80,30],[40,30],[40,12]]],height:12},{id:'far',rings:[[[40,80],[80,80],[80,90],[40,90],[40,80]]],height:12}],line);
 assert.deepEqual(fronting.map(b=>b.id),['b']);assert.equal(fronting[0].front.facing,0);
 const photos=[{id:'sees',x:60,z:-4,heading:180,captured:'2020-06-01'},{id:'away',x:60,z:-4,heading:0,captured:'2020-06-01'},{id:'behind',x:60,z:40,heading:0,captured:'2020-06-01'}];
 assert.deepEqual(photosShowing(fronting[0],photos).map(p=>p.id),['sees']);
 const many=[0,10,20,40].map((s,i)=>({id:String(i),s,view:'forward',captured:i===1?'2024-07-01':'2015-07-01',hourUtc:10}));
 assert.deepEqual(pickPhotos(many,{spacing:35}).map(p=>p.id),['1','3']);
});
