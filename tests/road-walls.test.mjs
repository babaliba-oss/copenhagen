import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGraph} from '../src/mobility.js';
import {markWalledLanes} from '../src/road-safety.js';

// A 0.6 m strip along a wall from (x0,z0) to (x1,z1), as scripts/road-walls.mjs writes them.
const strip=(x0,z0,x1,z1)=>{const l=Math.hypot(x1-x0,z1-z0),px=-(z1-z0)/l*.3,pz=(x1-x0)/l*.3;return {rings:[[[x0+px,z0+pz],[x1+px,z1+pz],[x1-px,z1-pz],[x0-px,z0-pz]]]};};
const road=()=>prepareGraph({nodes:[[0,0],[40,0]],edges:[{from:0,to:1,points:[[0,0],[40,0]],lane:1.5,signal:-1},{from:1,to:0,points:[[40,0],[0,0]],lane:1.5,signal:-1}]});

test('road walls: a lane through a drawn wall is not driven, one beside it is',()=>{
 const g=road();assert.equal(markWalledLanes(g.edges,[strip(20,-.2,20,.2)]),0,'a post between the lanes reaches neither (1.5 m off each)');
 const across=road();assert.equal(markWalledLanes(across.edges,[strip(20,-4,20,-1)]),1);assert.equal(across.edges.find(e=>e.from===1).fits,false,'the lane at z=-1.5 (heading -x) runs through it');assert.equal(across.edges.find(e=>e.from===0).fits,undefined);
 const along=road();assert.equal(markWalledLanes(along.edges,[strip(5,-2.5,35,-2.5)]),1,'a wall 1 m beside a lane: the car body scrapes it');
 const clear=road();assert.equal(markWalledLanes(clear.edges,[strip(5,-3.2,35,-3.2)]),0,'1.7 m off the lane: clear');
});
