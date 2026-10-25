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
 const t=buildBridgeRailings(water,{roads:[deck]},{ground:()=>0});assert.equal(t.userData.bridges[0].heightAt,undefined,'a tagged bridge between ends at one height stays flat');
});
// The Papirøen footbridge: its east end lands on ground 1.5 m below the west quay. The plate stood level with the west end
// to the last metre over the water and dropped to the east ground in one triangle (and the ground raised under it with it).
test('a tagged bridge ramps down to a lower end instead of dropping off it',()=>{
 const g=buildBridgeRailings(water,{roads:[deck]},{ground:x=>x<0?0:-1.5}),b=g.userData.bridges[0];assert.ok(b.heightAt,'the plate follows its ends');
 assert.ok(Math.abs(b.heightAt(-10,0)-b.y)<1e-6&&Math.abs(b.heightAt(-20,0)-b.y)<1e-6,'flat from the higher end');
 assert.ok(Math.abs(b.heightAt(20,0)-(-1.5+.035))<.15&&Math.abs(b.heightAt(30,0)-(-1.5+.035))<.01,'meets the lower end\'s ground at the shore, mid-deck too: '+b.heightAt(20,0));
 const p=g.userData.deck.attributes.position.array;let steep=0;
 for(let t=0;t<p.length;t+=9)for(let k=0;k<3;k++){const i=t+k*3,j=t+(k+1)%3*3,h=Math.hypot(p[i]-p[j],p[i+2]-p[j+2]),dy=Math.abs(p[i+1]-p[j+1]);if(p[i]>-20&&p[j]>-20&&dy>.09*Math.max(h,.1))steep++;}
 assert.equal(steep,0,'no plate edge steeper than the 8% ramp');
 const short={kind:'Jalkakäytävä (Silta)',rings:[[[-25,-2],[25,-2],[25,2],[-25,2]]]},s=buildBridgeRailings([{rings:[[[-3,-100],[3,-100],[3,100],[-3,100]]]}],{pavement:[short]},{ground:x=>x<0?0:-1.5}).userData.bridges[0];
 assert.ok(Math.abs(s.heightAt(-3,0)-.035)<.2&&Math.abs(s.heightAt(3,0)-(-1.465))<.2,'a short span still meets the ground at both ends: '+s.heightAt(-3,0)+' '+s.heightAt(3,0));
});
test('a tagged deck with paving along both sides (no railing of its own) still gets its plate over the water',()=>{
 const road={kind:'Ajorata (Silta)',rings:[[[-30,-3],[30,-3],[30,3],[-30,3]]]},walks=[-1,1].map(s=>({kind:'Jalkakäytävä (Silta)',rings:[[[-30,3*s],[30,3*s],[30,6*s],[-30,6*s]]]}));
 const g=buildBridgeRailings(water,{roads:[road],pavement:walks});assert.equal(g.userData.runs,2,'the railings stand on the footways');
 assert.ok(g.userData.bridges.some(b=>b.rings===road.rings),'the carriageway has a plate: no hole down to the water');
});
// Two carriageways mapped 2 m apart across the canal (Langebro at Islands Brygge): no railings along the slot between
// them and a plate over it, instead of an open trench down to the water in the middle of the road.
test('a narrow slot of water between two decks is decked over, without railings along it',()=>{
 const north={kind:'Ajorata (Silta)',rings:[[[-30,-9],[30,-9],[30,-1],[-30,-1]]]},south={kind:'Ajorata (Silta)',rings:[[[-30,1],[30,1],[30,9],[-30,9]]]};
 const g=buildBridgeRailings(water,{roads:[north,south]});assert.equal(g.userData.runs,2,'railings on the outer edges only');
 const slot=g.userData.bridges.filter(b=>b.rings!==north.rings&&b.rings!==south.rings);assert.ok(slot.length>0,'plates over the slot');
 for(const z of [-.9,0,.9]){const covered=slot.some(b=>{const r=b.rings[0],xs=r.map(p=>p[0]),zs=r.map(p=>p[1]);return Math.min(...xs)<=0&&Math.max(...xs)>=0&&Math.min(...zs)<=z&&Math.max(...zs)>=z;});assert.ok(covered,`slot covered at z=${z}`);}
 const wide=buildBridgeRailings(water,{roads:[north,{...south,rings:[[[-30,6],[30,6],[30,14],[-30,14]]]}]});assert.equal(wide.userData.runs,4,'a real gap keeps its railings');
});

// Today's street running out along a bridge over a wider (1760) canal: its edge lies half a metre inside the bridge's.
// One railing, the bridge's; the street keeps its plate. No quay wall round the street's end under the bridge.
test('an untagged deck along a bridge adds no second railing beside the bridge\'s, and no wall in the water',async()=>{
 const street={id:'street',kind:'Ajorata',rings:[[[-25,-4.5],[25,-4.5],[25,4.5],[-25,4.5]]]};
 const g=buildBridgeRailings(water,{roads:[street,deck]});
 assert.equal(g.userData.rails.filter(r=>r[4]==='street').length,0,'the street\'s railing would stand 0.5 m inside the bridge\'s');
 assert.equal(g.userData.rails.length,2);assert.equal(g.userData.bridges.length,2,'both still have their plates');
 const {extractQuayEdges}=await import('../src/quay.js'),inBridge=e=>[e.a,e.b].some(([x,z])=>Math.abs(z)<5.5&&Math.abs(x)<20);
 assert.equal(extractQuayEdges(water,{roads:[street,deck]}).filter(inBridge).length,0,'no wall round the street end inside the bridge');
 const pier={kind:'Ajorata',rings:[[[-25,-40],[0,-40],[0,-30],[-25,-30]]]};assert.ok(extractQuayEdges(water,{roads:[pier,deck]}).some(e=>e.a[1]<-29&&e.a[0]>-20),'a pier away from bridges keeps its walls');
});
test('a span\'s rounded end lying on the next span gets no railing across the road',()=>{
 // Langebro: each carriageway span is mapped with round end caps; where the line bends at the joint, the cap pokes from
 // inside the next span to within a metre of its side, the water beyond, and a railing stood across the carriageway.
 const a={id:'a',kind:'Ajorata (Silta)',rings:[[[-30,-5],[0,-5],[2,-4],[3,0],[2,4.2],[0,5],[-30,5]]]},b={id:'b',kind:'Ajorata (Silta)',rings:[[[-1,-5],[30,-5],[30,5],[-1,5]]]};
 const g=buildBridgeRailings(water,{roads:[a,b]}),onB=([x0,z0,x1,z1])=>{const x=(x0+x1)/2,z=(z0+z1)/2;return x>-.5&&x<30&&Math.abs(z)<4.7;};
 assert.equal(g.userData.rails.filter(onB).length,0,JSON.stringify(g.userData.rails));assert.equal(g.userData.bridges.length,2,'both keep their plates');
});
// A footway and a cycle track mapped side by side across the canal, 1.5 m apart, their quay ends on ground 0.8 m apart
// (the Papirøen bridge): one height for both, not a kerb-high step along the bridge. Spans end to end keep their own.
test('decks alongside each other share the higher one\'s height',()=>{
 const walk={kind:'Jalkakäytävä (Silta)',rings:[[[-30,1],[30,1],[30,4],[-30,4]]]},cycle={kind:'Erotettu pyörätie (Silta)',rings:[[[-30,-3.5],[30,-3.5],[30,-.5],[-30,-.5]]]};
 const g=buildBridgeRailings(water,{pavement:[walk,cycle]},{ground:(x,z)=>z>0?0:-.8}),y=r=>g.userData.bridges.find(b=>b.rings===r.rings).y;
 assert.ok(Math.abs(y(walk)-y(cycle))<1e-6,`${y(walk)} vs ${y(cycle)}`);assert.ok(y(walk)>-.1);
 const west={kind:'Jalkakäytävä (Silta)',rings:[[[-30,-2],[0,-2],[0,2],[-30,2]]]},east={kind:'Jalkakäytävä (Silta)',rings:[[[0,-2],[30,-2],[30,2],[0,2]]]};
 const s=buildBridgeRailings(water,{pavement:[west,east]},{ground:x=>x<0?0:-.6}),ys=s.userData.bridges.filter(b=>b.rings===west.rings||b.rings===east.rings).map(b=>b.y);
 assert.ok(Math.abs(ys[0]-ys[1])>.5,'spans in a row keep their own heights: '+ys);
});
