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
// A street along a sloping quay that the water reaches into (Børskaj over 1760's Børsgraven): its plate follows the
// nearest dry ground, not the street's highest corner 1.4 m up (a pale slab standing on the quay).
test('an untagged deck reaching into the water keeps its plate at the local quay height',()=>{
 const g=buildBridgeRailings(water,{roads:[{kind:'Ajorata',rings:[[[-10,-5],[60,-5],[60,5],[-10,5]]]}]},{ground:x=>x*.02});assert.ok(g?.userData.deck);
 const p=g.userData.deck.attributes.position.array;for(let i=0;i<p.length;i+=3)if(p[i]<0)assert.ok(p[i+1]<.5,`plate at x=${p[i]} is ${p[i+1]}`);
 const b=g.userData.bridges[0];assert.ok(b.heightAt(-10,0)<.5&&b.y>1.2,'the ground under it is raised to the local height, not the flat one');
 const t=buildBridgeRailings(water,{roads:[deck]},{ground:x=>x*.02});assert.equal(t.userData.bridges[0].heightAt,undefined,'tagged bridges stay flat');
});
test('a tagged deck with paving along both sides (no railing of its own) still gets its plate over the water',()=>{
 const road={kind:'Ajorata (Silta)',rings:[[[-30,-3],[30,-3],[30,3],[-30,3]]]},walks=[-1,1].map(s=>({kind:'Jalkakäytävä (Silta)',rings:[[[-30,3*s],[30,3*s],[30,6*s],[-30,6*s]]]}));
 const g=buildBridgeRailings(water,{roads:[road],pavement:walks});assert.equal(g.userData.runs,2,'the railings stand on the footways');
 assert.ok(g.userData.bridges.some(b=>b.rings===road.rings),'the carriageway has a plate: no hole down to the water');
});

