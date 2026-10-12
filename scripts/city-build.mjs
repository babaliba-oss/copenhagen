import {surfaceRecord} from '../src/surface-streaming.js';
// npm run city:build -- <id> [--refresh]
// Builds a playable city from OpenStreetMap (ODbL) around cities/<id>/city.json:
// footprint-extruded 3D buildings, road and pavement polygons, water, parks,
// trees, a routable traffic graph with signals, and named start points.
// Output: public/cities/<id>/ in the same formats as Helsinki's public/data,
// plus a registry entry in public/cities/index.json. Raw downloads are cached
// in data/raw/cities/<id>/ (ignored by git).
import fs from 'node:fs';
import path from 'node:path';
import {gzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import proj4 from 'proj4';
import polygonClipping from 'polygon-clipping';
import earcut from 'earcut';
import {bounds,SpatialIndex,registerPlayableArea,setPlayableRadius} from '../src/geo.js';
import {nearestRoadPoint} from '../src/physics.js';
import {surfaceChunks} from './world-formats.mjs';
import {usableBusPaths} from '../src/bus-simulation.js';
import {addBusLanes} from './bus-lanes.mjs';
import {routePoint} from '../src/mobility.js';

const id=process.argv[2],refresh=process.argv.includes('--refresh');
if(!/^[a-z0-9-]+$/.test(id||''))throw Error('Usage: npm run city:build -- <id>');
const def=JSON.parse(fs.readFileSync(path.join('cities',id,'city.json')));
const RAW=path.join('data/raw/cities',id),OUT=path.join('public/cities',id),URL_DIR=`/cities/${id}`;
fs.mkdirSync(RAW,{recursive:true});fs.rmSync(OUT,{recursive:true,force:true});for(const d of ['buildings3d','surfaces'])fs.mkdirSync(path.join(OUT,d),{recursive:true});
const [lon0,lat0]=def.origin,R=def.radiusMetres,EXTENT=Math.round(R*1.25);
const projection=`+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs`;
const toLocal=proj4('EPSG:4326',projection),round=n=>Math.round(n*100)/100;
const local=(lon,lat)=>{const [x,y]=toLocal.forward([lon,lat]);return [round(x),round(-y)];};
const square=[[[-EXTENT,-EXTENT],[EXTENT,-EXTENT],[EXTENT,EXTENT],[-EXTENT,EXTENT],[-EXTENT,-EXTENT]]];

// ---------- Overpass (cached; falls back to a mirror when the main server is busy) ----------
const ENDPOINTS=['https://overpass-api.de/api/interpreter','https://overpass.private.coffee/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
function overpass(name,body){
 const file=path.join(RAW,name+'.json');if(fs.existsSync(file)&&!refresh)return JSON.parse(fs.readFileSync(file));
 const q=`[out:json][timeout:240];${body}`;
 for(let attempt=0;attempt<6;attempt++){
  const endpoint=ENDPOINTS[attempt%ENDPOINTS.length];
  try{const text=execFileSync('curl',['-sS','-f','--max-time','300','-A','worldhood/0.1 (city build)','--data-urlencode',`data=${q}`,endpoint],{encoding:'utf8',maxBuffer:1<<30});
   const json=JSON.parse(text);fs.writeFileSync(file,text);console.log(`  ${name}: ${json.elements.length} elements`);return json;}
  catch(error){console.log(`  ${name}: retry ${attempt+1} (${String(error.message).slice(0,80)})`);execFileSync('sleep',[String(10+attempt*10)]);}
 }
 throw Error(`Overpass failed for ${name}`);
}
const around=`(around:${Math.round(EXTENT*1.42)},${lat0},${lon0})`;
console.log(`Fetching OpenStreetMap around ${def.name}…`);
const areas=overpass('areas',`(way["building"]${around};relation["building"]["type"="multipolygon"]${around};way["natural"="water"]${around};relation["natural"="water"]${around};way["waterway"="riverbank"]${around};way["leisure"~"^(park|garden|playground|pitch)$"]${around};relation["leisure"="park"]${around};way["landuse"~"^(grass|forest|recreation_ground|meadow|cemetery|village_green)$"]${around};way["natural"~"^(wood|scrub|grassland)$"]${around};way["area:highway"]${around};way["highway"="pedestrian"]["area"="yes"]${around};);out geom tags;`);
const ways=overpass('highways',`(way["highway"]${around};);out body;>;out skel qt;`);
// Two light queries rather than one heavy one: public Overpass servers time out on large mixed requests.
const nodePoints=overpass('nodes',`(node["natural"="tree"]${around};node["highway"="traffic_signals"]${around};);out;`);
const places=overpass('places',`(nwr["name"]["tourism"~"^(attraction|museum|viewpoint|gallery)$"]${around};nwr["name"]["place"="square"]${around};nwr["name"]["amenity"~"^(townhall|theatre|concert_hall|library|place_of_worship)$"]${around};nwr["name"]["railway"="station"]${around};nwr["name"]["historic"~"^(monument|memorial|castle|building|church)$"]${around};);out center tags;`);
const points={elements:[...nodePoints.elements,...places.elements]};
// Public transport: route relations with geometry clipped to the city box, plus named stops.
const box=(()=>{const inv=proj4(projection,'EPSG:4326');const [w,sLat]=inv.forward([-EXTENT,-EXTENT]),[e,n]=inv.forward([EXTENT,EXTENT]);return [sLat,w,n,e].map(v=>+v.toFixed(5));})();
const transit=overpass('transit',`(relation["type"="route"]["route"~"^(tram|bus|trolleybus|light_rail)$"](${box.join(',')}););out geom(${box.join(',')});`);
const stopNodes=overpass('stops',`(node["railway"="tram_stop"]${around};node["public_transport"="stop_position"]${around};node["highway"="bus_stop"]${around};);out;`);

// ---------- Geometry helpers ----------
const key=p=>`${p[0].toFixed(2)},${p[1].toFixed(2)}`;
function joinRings(lines){ // stitch multipolygon member ways into closed rings
 const open=lines.map(l=>[...l]),rings=[];
 while(open.length){let ring=open.pop();let grew=true;
  while(grew&&key(ring[0])!==key(ring.at(-1))){grew=false;
   for(let i=0;i<open.length;i++){const l=open[i];
    if(key(l[0])===key(ring.at(-1))){ring=ring.concat(l.slice(1));}
    else if(key(l.at(-1))===key(ring.at(-1))){ring=ring.concat([...l].reverse().slice(1));}
    else if(key(l.at(-1))===key(ring[0])){ring=l.concat(ring.slice(1));}
    else if(key(l[0])===key(ring[0])){ring=[...l].reverse().concat(ring.slice(1));}
    else continue;
    open.splice(i,1);grew=true;break;}}
  if(ring.length>3&&key(ring[0])===key(ring.at(-1)))rings.push(ring);}
 return rings;
}
function polygonsOf(e){ // → MultiPolygon in local metres, clipped to the world square
 let multi=[];
 if(e.type==='way'&&e.geometry?.length>3){const ring=e.geometry.map(g=>local(g.lon,g.lat));if(key(ring[0])===key(ring.at(-1)))multi=[[ring]];}
 if(e.type==='relation'){const geo=m=>(m.geometry||[]).map(g=>local(g.lon,g.lat));
  const members=e.members||[];const outers=joinRings(members.filter(m=>m.role!=='inner'&&m.geometry).map(geo)),inners=joinRings(members.filter(m=>m.role==='inner'&&m.geometry).map(geo));
  try{multi=polygonClipping.difference(outers.map(r=>[r]),...inners.map(r=>[[r]]));}catch{multi=outers.map(r=>[r]);}}
 if(!multi.length)return [];
 try{return polygonClipping.intersection(multi,square);}catch{return [];}
}
const capRound=8;
function bufferLine(line,width){ // round-joined buffer as one polygon set
 const pieces=[],w=width/2;
 for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);if(l<.05)continue;const nx=-dz/l*w,nz=dx/l*w;pieces.push([[[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],[b[0]-nx,b[1]-nz],[a[0]-nx,a[1]-nz],[a[0]+nx,a[1]+nz]]]);}
 for(const p of line){const r=[];for(let k=0;k<=capRound;k++){const t=k/capRound*Math.PI*2;r.push([p[0]+Math.cos(t)*w,p[1]+Math.sin(t)*w]);}r[capRound]=r[0];pieces.push([r]);}
 try{return polygonClipping.intersection(polygonClipping.union(...pieces),square);}catch{return [];}
}

// ---------- Areas: buildings, water, parks ----------
const city={origin:def.origin,projection,extent:EXTENT,radius:R,fetchedAt:new Date().toISOString().slice(0,10),source:'OpenStreetMap contributors, ODbL',buildings:[],roads:[],pavement:[],parks:[],water:[],trees:[],landmarks:[]};
const footprints=[];
const levelsHeight=t=>{const h=parseFloat(t.height);if(h>0)return h;const l=parseFloat(t['building:levels']);if(l>0)return l*3.2+(parseFloat(t['roof:levels'])||0)*2.5+1;
 return {house:7,detached:7,garage:3,garages:3,shed:3,hut:3,kiosk:3,roof:5,church:20,cathedral:30,apartments:16,commercial:14,retail:10,office:18,industrial:10,school:12,university:16,hospital:20,train_station:12}[t.building]||10;};
for(const e of areas.elements){
 const t=e.tags||{},multi=polygonsOf(e);if(!multi.length)continue;
 const base={id:`osm-${e.type}-${e.id}`,name:t.name||'',address:[t['addr:street'],t['addr:housenumber']].filter(Boolean).join(' ')};
 if(t.building&&!['roof','no'].includes(t.building)){
  const height=Math.min(levelsHeight(t),120);
  for(const rings of multi){const item={...base,rings,bbox:bounds(rings),kind:t.building,material:t['building:material']||'',height};city.buildings.push(item);footprints.push(item);}
 }else if(t.natural==='water'||t.waterway==='riverbank')for(const rings of multi)city.water.push({...base,rings,bbox:bounds(rings),kind:t.water||'water'});
 else if(t['area:highway']||t.highway==='pedestrian')for(const rings of multi)(/footway|pedestrian|cycleway/.test(t['area:highway']||t.highway)?city.pavement:city.roads).push({...base,rings,bbox:bounds(rings),kind:t['area:highway']||'Jalankulkualue',material:surfaceMaterial(t.surface)});
 else{const kind=/forest|wood|scrub/.test(t.landuse||t.natural||'')?'Metsä':t.leisure==='playground'?'Leikkipaikka':t.leisure==='pitch'?'Kenttä':'Nurmikko';for(const rings of multi)city.parks.push({...base,rings,bbox:bounds(rings),kind});}
}
// Finnish material names drive the existing surface shading and cobblestone rumble.
function surfaceMaterial(surface=''){
 if(/sett|cobblestone/.test(surface))return 'Nupukivi';
 if(/paving_stones|paved_stones/.test(surface))return 'Betonikivi';
 if(/gravel|fine_gravel|compacted|dirt|ground/.test(surface))return 'Kivituhka';
 if(/wood/.test(surface))return 'Puu';
 return 'Asfaltti';
}

// ---------- Highways: polygons + routable graphs ----------
const nodes=new Map(),highwayWays=[];
for(const e of ways.elements){if(e.type==='node')nodes.set(e.id,local(e.lon,e.lat));else if(e.type==='way')highwayWays.push(e);}
const CAR={motorway:16,trunk:14,primary:12,secondary:10,tertiary:8.5,unclassified:6.5,residential:6.5,living_street:5.5,service:4.5,motorway_link:7,trunk_link:7,primary_link:7,secondary_link:7,tertiary_link:6.5};
const WALK={footway:3,pedestrian:6,path:2.2,cycleway:2.8,steps:2.5,track:3};
const use=new Map();for(const w of highwayWays)for(const n of w.nodes)use.set(n,(use.get(n)||0)+1);
for(const w of highwayWays){
 const t=w.tags||{};if(t.tunnel&&t.tunnel!=='no'||t.area==='yes'||t.highway==='proposed'||t.highway==='construction')continue;
 const line=w.nodes.map(n=>nodes.get(n)).filter(Boolean);if(line.length<2)continue;
 const width=parseFloat(t.width)||CAR[t.highway]||WALK[t.highway];if(!width)continue;
 const bridge=t.bridge&&t.bridge!=='no'?' (Silta)':'';
 const item={id:`osm-way-${w.id}`,name:t.name||'',kind:(CAR[t.highway]?(t.highway==='service'?'Ajorata, muu':'Ajorata'):(t.highway==='cycleway'?'Erotettu pyörätie':'Jalkakäytävä'))+bridge,material:surfaceMaterial(t.surface)};
 for(const rings of bufferLine(line,width))(CAR[t.highway]?city.roads:city.pavement).push({...item,rings,bbox:bounds(rings)});
}
const signals=points.elements.filter(e=>e.type==='node'&&e.tags?.highway==='traffic_signals').map(e=>({p:local(e.lon,e.lat),name:e.tags.name||''}));
function graph(walking){
 const ids=new Map(),out={nodes:[],edges:[]};const nodeId=n=>{if(!ids.has(n)){ids.set(n,out.nodes.length);out.nodes.push(nodes.get(n));}return ids.get(n);};
 for(const w of highwayWays){
  const t=w.tags||{};if(t.tunnel&&t.tunnel!=='no'||t.area==='yes')continue;
  const ok=walking?(WALK[t.highway]||t.sidewalk&&t.sidewalk!=='no'||['residential','living_street','tertiary','secondary','primary','unclassified'].includes(t.highway)):(CAR[t.highway]&&t.access!=='private'&&t.service!=='parking_aisle'&&t.motor_vehicle!=='no');
  if(!ok)continue;
  const oneway=!walking&&(t.oneway==='yes'||t.oneway==='1'||t.oneway==='-1'||t.junction==='roundabout'||t.highway==='motorway'),reverse=t.oneway==='-1';
  const crossing=walking&&(t.footway==='crossing'||t.highway==='crossing');
  let run=[w.nodes[0]];
  const flush=()=>{const pts=run.map(n=>nodes.get(n)).filter(Boolean);if(pts.length<2)return;let length=0;for(let i=1;i<pts.length;i++)length+=Math.hypot(pts[i][0]-pts[i-1][0],pts[i][1]-pts[i-1][1]);if(length<.5)return;
   const add=(from,to,p)=>{const end=p.at(-1);let signal=-1,best=27;signals.forEach((s,i)=>{const d=Math.hypot(s.p[0]-end[0],s.p[1]-end[1]);if(d<best){best=d;signal=i;}});out.edges.push({from,to,points:p,length:+length.toFixed(2),lane:walking?0:oneway?.35:Math.max(1.45,(CAR[t.highway]||6.5)/4),crossing,signal});};
   const a=nodeId(run[0]),b=nodeId(run.at(-1));if(a===b)return;
   if(walking||!oneway||!reverse)add(a,b,pts);if(walking||!oneway||reverse)add(b,a,[...pts].reverse());};
  for(let i=1;i<w.nodes.length;i++){run.push(w.nodes[i]);if(use.get(w.nodes[i])>1&&i<w.nodes.length-1){flush();run=[w.nodes[i]];}}
  flush();
 }
 return out;
}
const mobility={source:'OpenStreetMap contributors, ODbL',note:'Routable graph split at shared OSM nodes; signals from highway=traffic_signals.',signals,roads:graph(false),walks:graph(true)};

// ---------- Public transport ----------
// Chain each relation's member ways in order (flipping where needed), split at gaps,
// keep runs inside the city. Line, destination and colour come from the relation tags.
function chainMembers(members){
 const runs=[];let run=[];
 for(const m of members){
  if(m.type!=='way'||!m.geometry?.length||/platform|stop/.test(m.role||''))continue;
  let line=m.geometry.filter(Boolean).map(g=>local(g.lon,g.lat));if(line.length<2)continue;
  if(run.length){const end=run.at(-1),gap=p=>Math.hypot(p[0]-end[0],p[1]-end[1]);
   if(gap(line.at(-1))<gap(line[0]))line=line.reverse();
   if(gap(line[0])>5){runs.push(run);run=[];}}
  else if(members.length>1){/* orientation fixed by the next way */}
  run=run.length?run.concat(line.slice(1)):line;
 }
 if(run.length)runs.push(run);
 return runs.map(r=>r.filter(p=>Math.abs(p[0])<EXTENT&&Math.abs(p[1])<EXTENT)).filter(r=>r.length>1);
}
const lengthOf=pts=>pts.reduce((n,p,i)=>i?n+Math.hypot(p[0]-pts[i-1][0],p[1]-pts[i-1][1]):0,0);
const tramPaths=[],busPaths=[];
for(const r of transit.elements.filter(e=>e.type==='relation')){
 const t=r.tags||{},rail=/tram|light_rail/.test(t.route);
 for(const [i,points] of chainMembers(r.members||[]).entries()){
  const length=lengthOf(points);if(length<(rail?200:300))continue;
  const path={id:`osm-${r.id}-${i}`,line:t.ref||'',destination:t.to||'',routeName:t.name||'',colour:t.colour||null,points,length:+length.toFixed(1)};
  (rail?tramPaths:busPaths).push(rail?path:{...path,kind:'city'});
 }
}
const transitStops=stopNodes.elements.filter(e=>e.type==='node').map(e=>{const [x,z]=local(e.lon,e.lat);return {id:`osm-${e.id}`,name:e.tags?.name||'',x,z,tram:e.tags?.railway==='tram_stop'||e.tags?.tram==='yes'||e.tags?.light_rail==='yes',bus:e.tags?.highway==='bus_stop'||e.tags?.public_transport==='stop_position'&&e.tags?.bus==='yes'};}).filter(s=>Math.abs(s.x)<EXTENT&&Math.abs(s.z)<EXTENT);

// ---------- Official city open data (optional: cities/<id>/city.json → "official") ----------
// Many cities publish their street register and tree register over WFS. When configured, those
// replace OpenStreetMap's guesses: real street-part shapes and surfaces instead of widened
// centrelines, and every registered tree with its species and height instead of map points.
const official=def.official;let officialTrees=null,officialCount={};
if(official){
 // Projected y points north (local z = −y): south-west is (−E, −E). WFS 2.0 EPSG:4326 order is lat,lon.
 const toWgs=proj4(projection,'EPSG:4326'),[w,south]=toWgs.forward([-EXTENT,-EXTENT]),[e,north]=toWgs.forward([EXTENT,EXTENT]);
 const bbox=[south,w,north,e].map(v=>+v.toFixed(5)).join(',');
 // Servers cap features per request: page with startIndex until everything has arrived.
 const wfs=(name,layer)=>{const file=path.join(RAW,`official-${name}.json`);
  if(!fs.existsSync(file)||refresh){const features=[],page=5000;let total=Infinity;
   for(let start=0;start<total;start+=page){const url=`${official.wfs}?service=WFS&version=2.0.0&request=GetFeature&typeNames=${layer}&count=${page}&startIndex=${start}&outputFormat=application/json&srsName=EPSG:4326&bbox=${bbox},urn:ogc:def:crs:EPSG::4326`;
    const d=JSON.parse(execFileSync('curl',['-sS','-f','--max-time','300','-A','worldhood/0.1 (city build)',url],{encoding:'utf8',maxBuffer:1<<30}));
    total=d.numberMatched??d.totalFeatures??d.features.length;features.push(...d.features);if(!d.features.length)break;}
   // numberMatched is an estimate on some servers; a gap under 1% is logged, a larger one stops the build.
   if(features.length<total*.99)throw Error(`Incomplete official ${name}: ${features.length}/${total}`);if(features.length<total)console.log(`  official ${name}: ${features.length}/${total} returned by the server`);
   fs.writeFileSync(file,JSON.stringify({type:'FeatureCollection',numberMatched:total,features}));}
  return JSON.parse(fs.readFileSync(file)).features;};
 const polys=f=>{const g=f.geometry;if(!g)return [];const list=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
  return list.map(poly=>poly.map(r=>r.map(([lon,lat])=>local(lon,lat)))).filter(rs=>rs[0].length>3);};
 const surface=v=>{v=String(v||'').toUpperCase();
  if(/LUONNONKIVI|NUPU|NOPPA|GRANIITTI/.test(v))return 'Nupukivi';if(/KIVEYS|BETONI/.test(v))return 'Betonikivi';
  if(/SORA|KIVITUHKA|MURSKE|SEPELI/.test(v))return 'Kivituhka';if(/PUU/.test(v))return 'Puu';return 'Asfaltti';};
 const clean=n=>String(n||'').replace(/^\d+/,'').trim().toLowerCase().replace(/(^|[\s-])\p{L}/gu,m=>m.toUpperCase());
 const officialRoads=[],officialPaths=[],officialGreen=[];
 if(official.streets)for(const f of wfs('streets',official.streets.layer)){const p=f.properties,t=String(p[official.streets.type]||'');
  const kind=/PYSÄKÖINTI/.test(t)?'Pysäköintialue':/TONTTILIITTYMÄ/.test(t)?'Tonttiliittymä':/^RAITIOTIE/.test(t)?'Raitiotie':'Ajorata';
  for(const rings of polys(f))officialRoads.push({id:`official-${f.id}`,name:clean(p[official.streets.name]),kind,material:surface(p[official.streets.surface]),rings,bbox:bounds(rings)});}
 if(official.paths)for(const f of wfs('paths',official.paths.layer)){const p=f.properties,t=String(p[official.paths.type]||'');
  const kind=/PYÖRÄ/.test(t)?'Erotettu pyörätie':/PORTAAT/.test(t)?'Portaat':/TORI|AUKIO/.test(t)?'Aukiot':'Jalkakäytävä';
  for(const rings of polys(f))officialPaths.push({id:`official-${f.id}`,name:clean(p[official.paths.name]),kind,material:surface(p[official.paths.surface]),rings,bbox:bounds(rings)});}
 if(official.green)for(const f of wfs('green',official.green.layer)){const p=f.properties,t=String(p[official.green.type]||'');
  const kind=/PENSAS|PERENNA|KUKKA|KESÄKUKKA/.test(t)?'Pensasryhmät':/LEIKKI/.test(t)?'Leikkipaikka':'Nurmikko';
  for(const rings of polys(f))officialGreen.push({id:`official-${f.id}`,name:clean(p[official.green.name]),kind,rings,bbox:bounds(rings)});}
 // OSM surfaces stay only where the official register has nothing nearby (40 m cells).
 const C=40,covered=new Set();
 for(const it of [...officialRoads,...officialPaths])for(let x=Math.floor(it.bbox[0]/C);x<=Math.floor(it.bbox[2]/C);x++)for(let z=Math.floor(it.bbox[1]/C);z<=Math.floor(it.bbox[3]/C);z++)covered.add(`${x},${z}`);
 const outside=it=>{const pts=it.rings[0],hit=pts.filter(([x,z])=>covered.has(`${Math.floor(x/C)},${Math.floor(z/C)}`)).length;return hit/pts.length<.3;};
 const before={roads:city.roads.length,pavement:city.pavement.length};
 city.roads=[...officialRoads,...city.roads.filter(outside)];city.pavement=[...officialPaths,...city.pavement.filter(outside)];city.parks=[...officialGreen,...city.parks];
 officialCount={streets:officialRoads.length,paths:officialPaths.length,green:officialGreen.length,osmRoadsKept:city.roads.length-officialRoads.length,osmRoadsReplaced:before.roads-(city.roads.length-officialRoads.length)};
 if(official.trees){
  const heightOf=(cls,girth)=>{const m=/(\d+)\s*-\s*(\d+)/.exec(cls||'');if(m)return(+m[1]+ +m[2])/2;if(/30m/.test(cls||''))return 32;return girth>0?Math.min(24,4+girth*.09):9;};
  officialTrees=[];
  for(const f of wfs('trees',official.trees.layer)){const p=f.properties,g=String(p[official.trees.group]||'');if(!/puu/i.test(g)||!f.geometry)continue;
   const [x,z]=local(...f.geometry.coordinates);if(Math.abs(x)>EXTENT||Math.abs(z)>EXTENT)continue;
   const girth=+p[official.trees.girth]||0,diameter=girth/Math.PI;
   officialTrees.push({p:[x,z],species:String(p[official.trees.species]||''),size:diameter>50?'50 - 70 cm':diameter>30?'30 - 50 cm':diameter>0?'10 - 20 cm':'20 - 30 cm',height:+heightOf(p[official.trees.height],girth).toFixed(1),conifer:/havu/i.test(g)});}
  officialCount.trees=officialTrees.length;
 }
}

// ---------- Trees ----------
if(officialTrees)city.trees=officialTrees;else for(const e of points.elements)if(e.tags?.natural==='tree'){const p=local(e.lon,e.lat);if(Math.abs(p[0])<EXTENT&&Math.abs(p[1])<EXTENT)city.trees.push({p,species:e.tags.species||e.tags.genus||'',size:'30 - 50 cm'});}

// ---------- 3D buildings: footprint extrusions in the shared tile format ----------
const TILE=200,tiles=new Map();let registry=0;
const signedArea=r=>{let a=0;for(let i=1;i<r.length;i++)a+=r[i-1][0]*r[i][1]-r[i][0]*r[i-1][1];return a/2;};
for(const b of footprints){
 const verts=[],h=b.height,top=h+.12;
 // Outer rings clockwise-negative and holes positive, so every wall's normal points out of the building.
 const rings=b.rings.map((r,i)=>(i===0)===(signedArea(r)>0)?[...r].reverse():r);
 for(const ring of rings){let s=0;for(let i=1;i<ring.length;i++){const [x0,z0]=ring[i-1],[x1,z1]=ring[i],len=Math.hypot(x1-x0,z1-z0);if(len<.01)continue;
  verts.push(x0,.12,z0,s/4,0, x1,.12,z1,(s+len)/4,0, x1,top,z1,(s+len)/4,h/4, x0,.12,z0,s/4,0, x1,top,z1,(s+len)/4,h/4, x0,top,z0,s/4,h/4);s+=len;}}
 const flat=[],holes=[];rings.forEach((r,i)=>{if(i)holes.push(flat.length/2);for(const p of r.slice(0,-1))flat.push(p[0],p[1]);});
 const tri=earcut(flat,holes,2);
 for(let i=0;i<tri.length;i+=3){
  let [a,b2,c]=[tri[i],tri[i+1],tri[i+2]].map(j=>[flat[j*2],flat[j*2+1]]);
  // Roof faces up (+Y): with X east / Z south that means a negative x-z cross product.
  if((b2[0]-a[0])*(c[1]-a[1])-(b2[1]-a[1])*(c[0]-a[0])>0)[b2,c]=[c,b2];
  for(const p of [a,b2,c])verts.push(p[0],top,p[1],p[0]/8,p[1]/8);
 }
 if(!verts.length)continue;
 const cx=(b.bbox[0]+b.bbox[2])/2,cz=(b.bbox[1]+b.bbox[3])/2,tk=`${Math.floor(cx/TILE)},${Math.floor(cz/TILE)}`;
 if(!tiles.has(tk))tiles.set(tk,{data:[],parts:[]});const t=tiles.get(tk);
 t.parts.push({id:b.id,bbox:b.bbox,height:h,ratu:undefined,texture:null,color:[.78,.76,.71],start:t.data.length/5,count:verts.length/5,address:b.address,name:b.name});
 for(const v of verts)t.data.push(v);registry++;
}
const index={source:'OpenStreetMap building footprints with height / building:levels (ODbL); untagged heights estimated by building type',tiles:[],buildings:registry};
let ti=0;for(const t of tiles.values()){const file=`buildings3d/${ti++}.pack`;fs.writeFileSync(path.join(OUT,file),gzipSync(Buffer.from(new Float32Array(t.data).buffer),{level:9}));
 const b=t.parts.reduce((b,p)=>[Math.min(b[0],p.bbox[0]),Math.min(b[1],p.bbox[1]),Math.max(b[2],p.bbox[2]),Math.max(b[3],p.bbox[3])],[Infinity,Infinity,-Infinity,-Infinity]);
 index.tiles.push({file,bbox:b,parts:t.parts});}

// ---------- Start points: named, well-known places near a drivable road ----------
setPlayableRadius(R);
const buildingIndex=new SpatialIndex(city.buildings);
const fame=t=>(t.wikidata?3:0)+(t.wikipedia?2:0)+(t.tourism?2:0)+(t.place==='square'?3:0)+(t.amenity==='townhall'||t.railway==='station'?3:0)+(t.historic?1:0);
const seen=new Set(),candidates=points.elements.filter(e=>e.tags?.name&&(e.lat||e.center)).map(e=>{const c=e.center||e;return {name:e.tags.name,p:local(c.lon,c.lat),score:fame(e.tags)};})
 .filter(c=>Math.hypot(...c.p)<R-60).sort((a,b)=>b.score-a.score||Math.hypot(...a.p)-Math.hypot(...b.p));
const drivable=city.roads.filter(r=>!/muu/.test(r.kind)),manual=(def.starts||[]).map(s=>({name:s.name,p:local(...s.at),score:99}));
for(const c of [...manual,...candidates]){
 if(city.landmarks.length>=(def.maxStarts||8))break;if(seen.has(c.name))continue;
 try{const p=nearestRoadPoint(c.p[0],c.p[1],drivable,buildingIndex);
  // Face along the nearest car edge.
  let best=null;for(const e of mobility.roads.edges)for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz;if(!l)continue;const t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.z-a[1])*dz)/l)),d=Math.hypot(a[0]+dx*t-p.x,a[1]+dz*t-p.z);if(!best||d<best.d)best={d,dx,dz};}
  city.landmarks.push({name:c.name,district:def.name,street:p.name||'',x:p.x,z:p.z,heading:best?+Math.atan2(-best.dx,-best.dz).toFixed(4):0});seen.add(c.name);
 }catch{}
}
if(!city.landmarks.length)throw Error('No drivable start point found; add one under "starts" in city.json');

// ---------- Write ----------
fs.writeFileSync(path.join(OUT,'city.pack'),gzipSync(Buffer.from(JSON.stringify(city)),{level:9}));
fs.writeFileSync(path.join(OUT,'buildings3d-index.json'),JSON.stringify(index));
// Buffered OSM streets overlap each other and the pavements; coplanar overlaps flicker
// (z-fighting). Physics and street names keep the original pieces; the rendered ground is
// dissolved per 200 m tile into non-overlapping layers with a fixed priority.
function dissolve(){
 const T=200,out={roads:[],pavement:[],parks:[],buildings:city.buildings};
 const roadRank=['Nupukivi','Betonikivi','Puu','Kivituhka','Asfaltti'],paveClass=p=>/Silta/.test(p.kind)&&p.material==='Puu'?'wood':/pyör|Pyör/.test(p.kind)?'cycle':'walk';
 const parkClass=p=>/Mets/.test(p.kind)?'Metsä':/Leikki/.test(p.kind)?'Leikkipaikka':/Kenttä/.test(p.kind)?'Kenttä':'Nurmikko';
 const grid=items=>{const m=new Map();for(const it of items){const b=it.bbox;for(let x=Math.floor(b[0]/T);x<=Math.floor(b[2]/T);x++)for(let z=Math.floor(b[1]/T);z<=Math.floor(b[3]/T);z++){const k=`${x},${z}`;if(!m.has(k))m.set(k,[]);m.get(k).push(it);}}return m;};
 const G={roads:grid(city.roads),pavement:grid(city.pavement),parks:grid(city.parks)},keys=new Set([...G.roads.keys(),...G.pavement.keys(),...G.parks.keys()]);
 const safe=f=>{try{return f();}catch{return [];}};
 for(const k of keys){
  const [x,z]=k.split(',').map(Number),cell=[[[x*T,z*T],[(x+1)*T,z*T],[(x+1)*T,(z+1)*T],[x*T,(z+1)*T],[x*T,z*T]]];
  let placed=[];
  const layer=(items,classOf,order,target,make)=>{
   for(const cls of order){
    const polys=items.filter(i=>classOf(i)===cls).map(i=>i.rings);if(!polys.length)continue;
    let u=safe(()=>polygonClipping.intersection(polygonClipping.union(...polys),cell));
    if(placed.length)u=safe(()=>polygonClipping.difference(u,placed));
    if(!u.length)continue;placed=safe(()=>polygonClipping.union(placed,u));
    for(const rings of u)target.push({...make(cls),rings,bbox:bounds(rings)});
   }
  };
  layer(G.roads.get(k)||[],r=>roadRank.includes(r.material)?r.material:'Asfaltti',roadRank,out.roads,m=>({kind:'Ajorata',material:m}));
  layer(G.pavement.get(k)||[],paveClass,['wood','cycle','walk'],out.pavement,c=>c==='wood'?{kind:'Kevyt liikenne (Silta)',material:'Puu'}:c==='cycle'?{kind:'Erotettu pyörätie'}:{kind:'Jalkakäytävä'});
  layer(G.parks.get(k)||[],parkClass,['Metsä','Kenttä','Leikkipaikka','Nurmikko'],out.parks,c=>({kind:c}));
 }
 return out;
}
const rendered=dissolve();
const chunks=surfaceChunks(rendered);const surfaceIndex=[];
for(const [k,values] of chunks){const file=`surfaces/${k}.bin`;fs.writeFileSync(path.join(OUT,file+'.pack'),gzipSync(Buffer.from(new Float32Array(values).buffer),{level:9}));surfaceIndex.push(surfaceRecord(file,values));}
fs.writeFileSync(path.join(OUT,'surface-index.json'),JSON.stringify(surfaceIndex));
fs.writeFileSync(path.join(OUT,'mobility.json'),JSON.stringify(mobility));
fs.writeFileSync(path.join(OUT,'trams.json'),JSON.stringify({source:'OpenStreetMap route=tram relations, ODbL',limitations:['Route geometry as mapped in OSM; timetables and frequencies are simulated.'],paths:tramPaths,stops:transitStops.filter(s=>s.tram).map(({bus,...s})=>s)}));
// Check bus routes against the street geometry once here, not in every player's browser
// (same clearance test and compaction as Helsinki's scripts/prepare-bus-corridors.mjs).
const busWorld={buildings:new SpatialIndex(city.buildings),roads:new SpatialIndex(city.roads.filter(r=>!/Koroke/.test(r.kind))),trafficForbidden:new SpatialIndex(city.roads.filter(r=>/Koroke/.test(r.kind)))};
const usableBuses=usableBusPaths({paths:busPaths},busWorld).map(p=>{const from=Math.max(0,p.start-8),to=Math.min(p.length,p.end+8),a=routePoint(p,from,0),b=routePoint(p,to,0),points=[[a.x,a.z],...p.points.filter((_,i)=>p.cumulative[i]>from&&p.cumulative[i]<to),[b.x,b.z]].map(q=>q.map(v=>+v.toFixed(3)));const {cumulative,...rest}=p;return {...rest,points,start:p.start-from,end:p.end-from,length:to-from};});
// Lanes for buses: the car lane of their own direction, else keep right (scripts/bus-lanes.mjs).
addBusLanes(usableBuses,busWorld,mobility.roads);
fs.writeFileSync(path.join(OUT,'bus-corridors.json'),JSON.stringify({source:'OpenStreetMap route=bus relations, ODbL',limitations:['Route geometry as mapped in OSM; timetables simulated.'],signals,paths:usableBuses,stops:transitStops.filter(s=>s.bus).map(({id,name,x,z})=>({id,name,x,z})),stopsSource:'OpenStreetMap bus stops, ODbL',stationStops:[],stationBays:[],clearancePrecomputed:true,clearanceNote:'Road, building and island clearance checked at build time.'}));
fs.writeFileSync(path.join(OUT,'landcover.json'),JSON.stringify({polygons:[]}));
// Emit an empty catalog too: static hosts may serve the homepage for missing
// JSON paths, so a city without extensions must not rely on a 404 response.
fs.mkdirSync(path.join(OUT,'extensions'),{recursive:true});
const extensionCatalog=path.join(OUT,'extensions/index.json');
if(!fs.existsSync(extensionCatalog))fs.writeFileSync(extensionCatalog,JSON.stringify({schemaVersion:1,extensions:[]}));
const counts={official:officialCount,buildings:registry,roads:city.roads.length,pavement:city.pavement.length,parks:city.parks.length,water:city.water.length,trees:city.trees.length,roadEdges:mobility.roads.edges.length,walkEdges:mobility.walks.edges.length,signals:signals.length,starts:city.landmarks.length,tramRoutes:tramPaths.length,tramLines:[...new Set(tramPaths.map(p=>p.line))].join(' '),busRoutes:busPaths.length,busCorridors:usableBuses.length,stops:transitStops.length};
const regFile='public/cities/index.json',registryFile=fs.existsSync(regFile)?JSON.parse(fs.readFileSync(regFile)):{schemaVersion:1,cities:[]};
registryFile.cities=[...registryFile.cities.filter(c=>c.id!==id),{id,name:def.name,country:def.country,dataRoot:URL_DIR,origin:def.origin,radius:R,projection,defaultStart:city.landmarks[0].name,status:def.status,maintainers:def.maintainers,liveries:def.liveries||undefined,era:def.era||undefined,
 attribution:'Map data © OpenStreetMap contributors, ODbL 1.0 (openstreetmap.org/copyright).'+(def.official?` ${def.official.attribution}.`:'')+' Building heights from OSM tags or estimated by building type.',fetchedAt:city.fetchedAt,counts}];
fs.writeFileSync(regFile,JSON.stringify(registryFile,null,1));
(await import('./facades.mjs')).shipFacades(id); // façades described from street-level photos, if any (cities/<id>/facades.json)
// Photo-matched places (cities/<id>/<place>-reference.json): square paving, tram stops, species trees, landmarks.
{const places=await import('./place-build.mjs');for(const p of places.placesOf(id))console.log(`place ${p}:`,JSON.stringify(places.buildPlace(id,p,{refresh})));}
// Hills: ground elevation from open terrain tiles (scripts/city-terrain.mjs); "terrain": false in city.json keeps the city flat.
if(def.terrain!==false)try{await (await import('./city-terrain.mjs')).buildTerrain(id,{refresh});}catch(error){console.log(`terrain skipped, the city stays flat: ${error.message}`);}
console.log(JSON.stringify({city:def.name,counts,starts:city.landmarks.map(l=>`${l.name} (${l.street})`)},null,1));

// ---------- Street furniture from Mapillary detections (optional: runs when MAPILLARY_TOKEN is set) ----------
// Lamps, signals, signs, bins and boxes at their photographed positions; see scripts/mapillary-features.mjs.
if(!def.era&&(await import('./env.mjs')).env('MAPILLARY_TOKEN'))await (await import('./mapillary-features.mjs')).buildFurniture(id,{refresh});
