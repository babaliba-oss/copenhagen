import test from 'node:test';import assert from 'node:assert/strict';
import {SpatialIndex} from '../src/geo.js';
import {findRaisedDecks,buildRaisedDecks,RAISED} from '../src/quay.js';
import {setTerrain,setRaisedDecks,rideDeck,deckBlocks,surfaceAt,raisedDeckAt,isRaisedDeck} from '../src/terrain.js';
import {travelCollision} from '../src/player-travel.js';
// Cykelslangen in miniature: a 4 m cycle deck 240 m long on flat ground, crossing a 40 m wide strip of harbour in the middle.
setTerrain(null);
const water=[{rings:[[[-20,-100],[20,-100],[20,100],[-20,100]]]}];
const strip=(kind,x0=-120,x1=120,z=0,w=4)=>({kind,rings:[[[x0,z-w/2],[x1,z-w/2],[x1,z+w/2],[x0,z+w/2]]]});
const snake=strip('Erotettu pyörätie (Silta)');
test('a long cycle bridge over the land and the water stands clear of both, ramping down to the ground at its ends',()=>{
 const [d,...rest]=findRaisedDecks(water,{pavement:[snake]});assert.ok(d,'found');assert.equal(rest.length,0);assert.equal(d.deck,snake);
 assert.ok(Math.abs(d.heightAt(0,0)-RAISED.CLEAR)<.05,`high point ${d.heightAt(0,0)}`);
 assert.ok(d.heightAt(-120,0)<.1&&d.heightAt(120,0)<.1,'its ends meet the ground');
 for(let x=-120;x<120;x+=.5)assert.ok(Math.abs(d.heightAt(x+.5,0)-d.heightAt(x,0))<=RAISED.RAMP*.5+1e-6,`no step at x=${x}`);
 const g=buildRaisedDecks([d]),p=g.attributes.position.array;let top=-Infinity;for(let i=1;i<p.length;i+=3){assert.ok(Number.isFinite(p[i]));top=Math.max(top,p[i]);}
 assert.ok(top>RAISED.CLEAR+1&&top<RAISED.CLEAR+1.2,'railings stand on it');
});
test('carriageways, decks beside a carriageway, decks only over water and short ones stay at ground level',()=>{
 assert.equal(findRaisedDecks(water,{roads:[strip('Ajorata (Silta)')]}).length,0);
 assert.equal(findRaisedDecks(water,{pavement:[snake],roads:[strip('Ajorata (Silta)',-120,120,6,6)]}).length,0,'a cycle track alongside a road bridge');
 assert.equal(findRaisedDecks(water,{pavement:[strip('Erotettu pyörätie (Silta)',-40,40)]}).length,0,'short');
 assert.equal(findRaisedDecks(water,{pavement:[strip('Jalkakäytävä (Silta)',-100,100,0,4)]}).length,1,'a footbridge too');
 assert.equal(findRaisedDecks([],{pavement:[snake]}).length,0,'nothing to cross: an overpass over dry ground is left as it was');
});
test('riders come onto the deck at its ends and stay on it; under it the ground is the ground, and cars never get on',()=>{
 setRaisedDecks(findRaisedDecks(water,{pavement:[snake]}));assert.ok(isRaisedDeck(snake));
 try{
  const ride={x:-121,z:0,deckY:null};let last=0;
  for(let x=-120;x<=120;x+=.15){const to={x,z:0};assert.equal(deckBlocks(ride,to,'bike'),false,`stopped at ${x}`);ride.x=x;rideDeck(ride);assert.notEqual(ride.deckY,null,`off the deck at ${x}`);assert.ok(Math.abs(surfaceAt(ride)-last)<.05);last=surfaceAt(ride);}
  assert.ok(Math.max(...[-60,0,60].map(x=>raisedDeckAt(x,0)))>5);
  // the railing: sideways off it half-way along
  const mid={x:-60,z:0,deckY:raisedDeckAt(-60,0)};let z=0;for(;z<5&&!deckBlocks(mid,{x:-60,z:z+.15},'bike');z+=.15){mid.z=z+.15;rideDeck(mid);}assert.ok(z<2.2&&mid.deckY!==null,'held by the railing');
  // walking across under it where it is high: never on it, never stopped; where its ramp is low: stopped
  const walker={x:-60,z:-6,deckY:null};for(let s=-6;s<=6;s+=.15){assert.equal(deckBlocks(walker,{x:-60,z:s},'walk'),false);walker.z=s;rideDeck(walker);assert.equal(walker.deckY,null);assert.equal(surfaceAt(walker),0);}
  assert.equal(deckBlocks({x:-105,z:-4,deckY:null},{x:-105,z:-1},'walk'),true,'into the side of the ramp');
  assert.equal(deckBlocks({x:-123,z:0},{x:-119.9,z:0},'car'),true,'a car at its foot');assert.equal(deckBlocks({x:-60,z:-4},{x:-60,z:0},'car'),false,'a car under its high part');
  // over the harbour: on the deck the water is below; under it, it is water
  const w={buildings:new SpatialIndex([]),roads:new SpatialIndex([]),pavement:new SpatialIndex([]),water},on={x:0,z:0,heading:Math.PI/2,deckY:raisedDeckAt(0,0)};
  assert.equal(travelCollision({...on,x:-.5},'bike',w,[],[],on),null);assert.equal(travelCollision({x:0,z:-.5,heading:0},'walk',w,[],[],{x:0,z:0,deckY:null}),'water');
 }finally{setRaisedDecks([]);}
});
test('paving under the deck stays only where it stands high enough to be seen under; its low ramps cover the ground',async()=>{
 const {underRaisedDecks}=await import('../src/surface-tiles.js');
 const [d]=findRaisedDecks(water,{pavement:[snake]}),tri=(x,z,c)=>[x-1,.045,z-1,c,c,c,x+1,.045,z-1,c,c,c,x,.045,z+1,c,c,c];
 const floats=new Float32Array([...tri(-100,0,.2),...tri(-60,0,.3),...tri(-100,4,.9),...tri(-60,4,.8)]); // under the low ramp, under the high part, and the paving beside each
 const out=underRaisedDecks(floats,[{rings:d.rings,bbox:d.bbox,caps:d.caps,top:d.top,ramp:d.ramp}]),xs=[];for(let i=0;i<out.length;i+=18)xs.push([out[i]+1,out[i+2]+1,+out[i+3].toFixed(1)]);
 assert.ok(d.heightAt(-100,0)<2.4&&d.heightAt(-60,0)>2.4);
 assert.deepEqual(xs.map(([x,z])=>[x,z]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]),[[-100,4],[-60,0],[-60,4]],'the low one goes');
 assert.equal(xs.find(([x,z])=>x===-60&&z===0)[2],.8,'the high one takes the paving beside it');
});
