import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// scripts/landmark-colours.py must run after every building-index rebuild: the city model's own colours are
// wrong for these (a cream City Hall, a red-brick glass hotel).
test('landmarks carry their real colours in the Copenhagen building index', () => {
 const index=JSON.parse(fs.readFileSync(new URL('../public/cities/copenhagen/buildings3d-index.json',import.meta.url)));
 const byName=new Map();for(const t of index.tiles)for(const p of t.parts)if(p.name)byName.set(p.name,p);
 const red=c=>c[0]>c[1]*1.6&&c[0]>c[2]*1.6;
 for(const n of ['Københavns Rådhus','Ny Carlsberg Glyptotek','Københavns Hovedbanegård','Rundetårn'])assert.ok(red(byName.get(n).color),n);
 assert.ok(byName.get('Den Sorte Diamant').color.every(v=>v<.2));
});
