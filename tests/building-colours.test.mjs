import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBuildingColours,BUILDING_COLOURS} from '../src/copenhagen/building-colours.js';
import fs from 'node:fs';

test('landmark colour overrides apply by part id and every id exists in the Copenhagen index', () => {
 const index=JSON.parse(fs.readFileSync(new URL('../public/cities/copenhagen/buildings3d-index.json',import.meta.url)));
 const ids=new Set(index.tiles.flatMap(t=>t.parts.map(p=>p.id)));
 for(const id of Object.keys(BUILDING_COLOURS))assert.ok(ids.has(id),id);
 const tiny={tiles:[{parts:[{id:'kk-osm-relation-52142',color:[.9,.85,.7],roofColor:[0,0,0]},{id:'x',color:[1,1,1]}]}]};
 assert.equal(applyBuildingColours(tiny),1);
 assert.deepEqual(tiny.tiles[0].parts[0].color,[.6,.27,.2]);
 assert.deepEqual(tiny.tiles[0].parts[1].color,[1,1,1]);
});
