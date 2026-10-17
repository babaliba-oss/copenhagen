import {expandMobility} from './mobility-pack.js';
import {expandCity} from './city-pack.js';
import {dataUrl} from './cities.js';
import {registerPlayableArea,registerWaterClip,WORLD_EXTENT} from './geo.js';
import {createSpatialStreamer} from './spatial-streaming.js';
import {mergeGraph} from './graph-extension.js';
export {mergeGraph} from './graph-extension.js';

// Map extensions: extra areas built by scripts/build-extension.mjs into
// public/data/extensions/<id>/ and listed in public/data/extensions/index.json.
// Each carries the main snapshot's formats, so merging is concatenation plus
// re-indexing the mobility graph across the seam.
export async function loadExtensionIndex(json){
 let index;
 // Revalidate the catalog across releases, including a previously cached SPA
 // fallback from a host that served HTML for a missing city catalog.
 try{index=await json(dataUrl('extensions/index.json'),{cache:'no-cache'});}catch(error){if(error?.status===404)return [];throw error;}
 if(!Array.isArray(index?.extensions))throw Error('Invalid map extension catalog');
 return index.extensions;
}
export async function loadExtension(e,json,unpack){
  const [city,buildings,surfaces,mobility]=await Promise.all([
   unpack(dataUrl(`${e.dir}/city.pack`)).then(b=>expandCity(JSON.parse(new TextDecoder().decode(b)))),
   json(dataUrl(`${e.dir}/buildings3d-index.json`)),json(dataUrl(`${e.dir}/surface-index.json`)),json(dataUrl(`${e.dir}/mobility.json`)).then(expandMobility)]);
  // Water and land cover from OpenStreetMap (ODbL) ship in their own files, apart from the municipal data.
  const [water,land]=await Promise.all([e.osmWater&&json(dataUrl(`${e.dir}/${e.osmWater}`)),e.osmLandcover&&json(dataUrl(`${e.dir}/${e.osmLandcover}`))]);
  if(water)city.water.push(...water.water);
  if(land){city.parks.push(...land.parks);city.trees.push(...land.trees);}
  // HSL buses and light rail of the area (scripts/build-extension-transit.mjs), when it has them.
  const transitLines=e.transit?await json(dataUrl(`${e.dir}/${e.transit}`)):null;
  return {...e,city,buildings,surfaces,mobility,transitLines};
}
// Compatibility for import/build tools. Runtime startup uses the catalog alone.
export async function loadExtensions(json,unpack){
 return Promise.all((await loadExtensionIndex(json)).map(e=>loadExtension(e,json,unpack)));
}

// Metadata can frame the map and list every start without making unloaded
// regions playable. Installation explicitly opens the region when it is safe.
export function mapViewFor(entries){
 const view=[-WORLD_EXTENT,-WORLD_EXTENT,WORLD_EXTENT,WORLD_EXTENT];
 for(const e of entries)for(const [i,v] of (e.mapBounds||[]).entries())view[i]=i<2?Math.min(view[i],v):Math.max(view[i],v);
 return {cx:(view[0]+view[2])/2,cz:(view[1]+view[3])/2,size:Math.max(view[2]-view[0],view[3]-view[1])+200,playable:entries.map(e=>e.playable).filter(Boolean)};
}
export function activateExtension(entry){
 if(entry.playable)registerPlayableArea(entry.playable);
 if(entry.waterClip)registerWaterClip(entry.waterClip);
}

export function createExtensionStreamer({entries=[],load,install=async()=>{},concurrency=1,...options}){
 const payloads=new Map();
 const stream=createSpatialStreamer({...options,concurrency,keyOf:e=>e.id,boundsOf:e=>e.mapBounds,
  load:async(entry,{signal})=>{
   let region=payloads.get(entry.id);if(!region){region=await load(entry,{signal});if(signal.aborted)throw signal.reason;payloads.set(entry.id,region);}
   if(signal.aborted)throw signal.reason;await install(region,{signal});return region;
  }});
 stream.add(entries);
 return {...stream,
  // A direct jump must finish its destination before actors are moved there.
  ensureStart(start){return start?.extension?stream.require([start.extension]):Promise.resolve([]);},
  update(player,options={}){stream.update(player,{radius:1200,aheadSeconds:20,...options});},
  prefetchAll(){return stream.require(entries.map(e=>e.id),{background:true});},
 };
}


const applied=new WeakMap();
export function applyExtensions(extensions,{data,roofIndex,surfaceIndex,mobility,world,police,activate=true}){
 let installed=applied.get(data);if(!installed){installed=new Map();applied.set(data,installed);}
 for(const e of extensions){
  if(installed.has(e.id))continue;
  for(const key of ['buildings','roads','pavement','parks','water','trees'])data[key].push(...e.city[key]);
  roofIndex.tiles.push(...e.buildings.tiles);roofIndex.buildings+=e.buildings.buildings;
  surfaceIndex.push(...e.surfaces);
  if(world){
   for(const index of new Set([world.buildings,world.cameraBuildings,world.sightBuildings].filter(Boolean)))index.add(e.city.buildings);
   world.roads.add(e.city.roads.filter(r=>!/Koroke/.test(r.kind)));world.pavement.add(e.city.pavement);
   world.trafficForbidden?.add(e.city.roads.filter(r=>/Koroke/.test(r.kind)));
   if(world.water!==data.water)world.water.push(...e.city.water);
  }
  if(mobility.appendRegion)mobility.appendRegion(e.mobility);
  else{const offset=mobility.signals.length;mobility.signals.push(...e.mobility.signals);mergeGraph(mobility.roads,e.mobility.roads,offset);mergeGraph(mobility.walks,e.mobility.walks,offset);}
  police?.refreshGraph();installed.set(e.id,e);
  if(e.waterClip)registerWaterClip(e.waterClip);
  if(activate)activateExtension(e);
 }
 return mapViewFor([...installed.values()]);
}
