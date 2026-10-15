import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// public/cities/<city>/duplicates.json (scripts/building-duplicates.mjs) names copies by tile file and vertex
// start; a rebuilt building index shifts those, so the list must be regenerated with it.
for(const city of ['copenhagen','copenhagen-1760'])test(`${city}: every listed duplicate is a part of the building index`, () => {
 const dir=new URL(`../public/cities/${city}/`,import.meta.url);
 const index=JSON.parse(fs.readFileSync(new URL('buildings3d-index.json',dir))),dups=JSON.parse(fs.readFileSync(new URL('duplicates.json',dir)));
 const keys=new Set(index.tiles.flatMap(t=>t.parts.map(p=>t.file+':'+p.start)));
 assert.ok(dups.length>0);for(const d of dups)assert.ok(keys.has(d),d);
});
