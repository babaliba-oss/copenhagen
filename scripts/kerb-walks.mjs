#!/usr/bin/env node
// The walker simulation's cut of a city's walk graph to the pavement (src/mobility-pack.js kerbPieces, applied in the game
// by cutWalksAtKerbs; the player's on-foot GPS keeps the full graph): today's walkers keep to the pavement
// polygons and step on the carriageway only on a crossing, but the OSM walk graph also carries every street's centreline
// and the last metres of each footway out to it. Walkers walked up to the kerb there and turned back. Ground as the game
// reads it (Mobility.walkable): a drawn house is left to dropWalksThroughBuildings, a carriageway (traffic islands aside)
// is not walkable, a pavement polygon is. Run after the city's mobility.json is built. Not for 1760 (walkers use the street).
// Writes it into public/cities/<city>/mobility.json as walkerCut (the graph itself is left as it is).   node scripts/kerb-walks.mjs copenhagen
import fs from 'node:fs';import zlib from 'node:zlib';
import {expandCity} from '../src/city-pack.js';import {SpatialIndex} from '../src/geo.js';import {expandMobility,kerbPieces,cutWalksAtKerbs} from '../src/mobility-pack.js';
const city=process.argv[2]||'copenhagen',dir=`public/cities/${city}`;
let pack=fs.readFileSync(`${dir}/city.pack`);if(pack[0]===31&&pack[1]===139)pack=zlib.gunzipSync(pack);
const data=expandCity(JSON.parse(pack.toString()));
const houses=new SpatialIndex(data.buildings.filter(b=>!/^(roof|construction|carport|bridge)$/.test(b.kind||''))),roads=new SpatialIndex(data.roads.filter(r=>!/Koroke/.test(r.kind||''))),pavement=new SpatialIndex(data.pavement);
const m=expandMobility(JSON.parse(fs.readFileSync(`${dir}/mobility.json`,'utf8')));
delete m.walkerCut;m.walkerCut=kerbPieces(m.walks,(x,z)=>!!houses.at(x,z)||!roads.at(x,z)&&!!pavement.at(x,z));
fs.writeFileSync(`${dir}/mobility.json`,JSON.stringify(m));
const r=cutWalksAtKerbs(m.walks,m.walkerCut);
console.log(`${city}: walkers' graph: ${r.cut} footways cut at a kerb, ${r.dropped} on the carriageway dropped, ${r.pruned} spurs pruned; footway ${r.km[0]} km -> ${r.km[1]} km; ${m.walks.edges.length} -> ${r.walks.edges.length} edges`);
