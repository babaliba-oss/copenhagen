import test from 'node:test';import assert from 'node:assert/strict';
import {buildBridgeRailings} from '../src/quay.js';
// A 40 m wide canal running north-south, a 10 m wide bridge deck crossing it east-west.
const water=[{rings:[[[-20,-100],[20,-100],[20,100],[-20,100]]]}];
const deck={kind:'Ajorata (Silta)',rings:[[[-30,-5],[30,-5],[30,5],[-30,5]]]};
test('a bridge over the water gets railings on both long edges and a deck plate',()=>{
 const g=buildBridgeRailings(water,{roads:[deck]});assert.ok(g);assert.equal(g.userData.runs,2);assert.ok(g.userData.deck);
 const p=g.attributes.position.array;let minX=Infinity,maxX=-Infinity;for(let i=0;i<p.length;i+=3){minX=Math.min(minX,p[i]);maxX=Math.max(maxX,p[i]);}
 assert.ok(minX>-21&&maxX<21,'railings only where the deck is over the water');
 assert.ok([...g.userData.deck.attributes.position.array].every(Number.isFinite),'deck plate has real heights');
});
test('a road on dry land gets none',()=>{assert.equal(buildBridgeRailings(water,{roads:[{kind:'Ajorata',rings:[[[30,-5],[60,-5],[60,5],[30,5]]]}]}),null);});
