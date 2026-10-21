import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
const {bounds,pointInPolygon,segmentDistance}=await import('../src/geo.js');
const nearEdge=(x,z,rings)=>rings.some(r=>r.some((v,i)=>segmentDistance(x,z,v,r[(i+1)%r.length])<.3));

const trim=JSON.parse(fs.readFileSync('public/cities/copenhagen/collision-trim.json','utf8'));
const raw=fs.readFileSync('public/cities/copenhagen/city.pack'),city=JSON.parse(raw[0]===31&&raw[1]===139?zlib.gunzipSync(raw):raw);
const byId=new Map(),seen=new Map();for(const b of city.buildings){const k=seen.get(b.id)||0;seen.set(b.id,k+1);byId.set(k?`${b.id}#${k}`:b.id,b);} // the keying main.js uses (a few ids repeat)

// scripts/collision-trim.py: mapped footprints of modelled houses cut back to the drawn house where they ran into the street.
test('trimmed footprints only lose the undrawn part in the street: same house, inside its old outline, never bigger', () => {
 const ids=Object.keys(trim);assert.ok(ids.length>100,`${ids.length} trimmed`);
 for(const id of ids){const b=byId.get(id),r=trim[id];assert.ok(b,`${id} is a mapped footprint`);assert.ok(b.cover>=.5,`${id} is drawn by the model, not from its footprint`);
  if(!r)continue;const a=bounds([r.flat()]),o=bounds([b.rings.flat()]);assert.ok(a[0]>=o[0]-.3&&a[1]>=o[1]-.3&&a[2]<=o[2]+.3&&a[3]<=o[3]+.3,`${id} stays inside its old box`);
  let inside=0,n=0;for(const ring of r)for(const [x,z] of ring){n++;if(pointInPolygon(x,z,b.rings)||nearEdge(x,z,b.rings))inside++;}assert.ok(inside===n,`${id}: ${inside}/${n} corners inside the old outline`);}
});
