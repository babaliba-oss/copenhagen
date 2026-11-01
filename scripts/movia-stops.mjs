#!/usr/bin/env node
// Copenhagen's bus stop poles (bus-corridors.json `stops`, OpenStreetMap, scripts/bus-stops.mjs) named and placed from
// Movia's stop register as Københavns Kommune publishes it (WFS k101 stoppesteder_movia, GeoJSON EPSG:4326, CC BY 4.0;
// Copenhagen municipality only, so Frederiksberg's stops keep their OSM names).
//   node scripts/movia-stops.mjs <wfs dir> copenhagen      (after scripts/bus-stops.mjs)
// Each OSM stop within 30 m of a Movia stop takes the name of the nearest one (of the same name, if one is; the
// sightseeing operators' hop-on hop-off stops keep theirs) (`movia`: its stop number). Of the OSM
// stops nearest each Movia stop, the one more than 10 m from it moves to Movia's pole, but only when every bus path
// that pulled in at it (assignBusStops: beside its right-hand kerb within 12 m) still does from there. Rerunning
// changes nothing more.
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import proj4 from 'proj4';
import {prepareGraph} from '../src/mobility.js';
import {assignBusStops} from '../src/bus-simulation.js';
const [src,id='copenhagen']=process.argv.slice(2),dir=`public/cities/${id}`,file=`${dir}/bus-corridors.json`;
const city=JSON.parse(gunzipSync(readFileSync(`${dir}/city.pack`))),to=proj4('EPSG:4326',city.projection);
const data=JSON.parse(readFileSync(file)),stops=data.stops;
const movia=JSON.parse(readFileSync(`${src}/stoppesteder_movia.json`)).features.map(f=>{const [x,y]=to.forward(f.geometry.coordinates[0].slice(0,2));return {x,z:-y,name:f.properties.stopnavn.trim(),nr:f.properties.stopnr};});
const paths=data.paths.map(p=>({...prepareGraph({nodes:[0,1],edges:[{...p,from:0,to:1,lane:0}]}).edges[0],id:p.id}));
const takers=stop=>new Set(paths.filter(p=>assignBusStops(p,[stop]).length).map(p=>p.id));
const d=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
let named=0,moved=0,kept=0,far=0;
const norm=n=>(n||'').toLowerCase().replace(/\(.*?\)|\bst(ation)?\b\.?|sankt|skt\./g,'').replace(/[^a-z0-9æøå]/g,'');
for(const s of stops){if(/hop-on|sightseeing/i.test(s.name))continue; // another operator's tour stops
 let best=null;for(const m of movia)if(d(s,m)<30&&(!best||norm(m.name)===norm(s.name)&&norm(best.name)!==norm(s.name)||(norm(m.name)===norm(s.name))===(norm(best.name)===norm(s.name))&&d(s,m)<d(s,best)))best=m;if(!best)continue;
 if(s.name!==best.name)named++;s.name=best.name;s.movia=best.nr;}
for(const m of movia){let best=null;for(const s of stops)if(s.movia===m.nr&&(!best||d(s,m)<d(best,m)))best=s;if(!best)continue;
 if(d(best,m)<=10)continue;far++;
 const before=takers(best),after=takers({...best,x:m.x,z:m.z});
 if([...before].every(p=>after.has(p))){best.x=+m.x.toFixed(2);best.z=+m.z.toFixed(2);moved++;}else kept++;}
data.stopsSource='OpenStreetMap bus stops, ODbL; names and positions from Movia\'s stop register, Københavns Kommune, CC BY 4.0 (wfs-kbhkort.kk.dk k101 stoppesteder_movia)';
writeFileSync(file,JSON.stringify(data));
console.log(`${stops.length} stops: ${stops.filter(s=>s.movia).length} matched to ${movia.length} Movia stops (${named} renamed); ${far} more than 10 m off: ${moved} moved to Movia's pole, ${kept} left (a bus would no longer stop there)`);
