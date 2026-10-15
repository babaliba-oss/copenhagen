import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {creasedShellNormals} from '../src/shell-colors.js';

test('twisted wall quads get one smooth normal; real corners stay sharp', () => {
 const g=new THREE.BufferGeometry();
 // a slightly twisted quad (two triangles ~3.4° apart) and a wall at 90° sharing an edge
 g.setAttribute('position',new THREE.BufferAttribute(new Float32Array([0,0,0, 10,0,0, 0,10,.6, 10,0,0, 10,10,0, 0,10,.6, 0,0,0, 0,10,.6, 0,0,-10]),3));
 creasedShellNormals(g);const n=g.attributes.normal;
 // the shared corner (10,0,0) has the same normal in both quad triangles
 assert.ok(Math.abs(n.getX(1)-n.getX(3))<1e-6&&Math.abs(n.getY(1)-n.getY(3))<1e-6&&Math.abs(n.getZ(1)-n.getZ(3))<1e-6);
 // the perpendicular wall keeps its own flat normal (-x)
 for(const i of [6,7,8])assert.ok(n.getX(i)<-.99);
});
