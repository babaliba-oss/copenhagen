// npm run city:furniture -- <id> [--refresh]
// Street furniture from Mapillary map features (Mapillary Terms of Use): lamp posts, traffic lights, sign
// posts, bins, junction boxes, barriers and more, found by computer vision in street-level photos.
// Fetches every detection inside the playable circle (raw responses cached in
// data/raw/cities/<id>/mapillary/), drops weak or outdated detections, moves kerbside items that
// land on the carriageway to the pavement edge, removes doubles (within Mapillary and against
// objects the city already places) and writes public/cities/<id>/furniture.json.
// city:build runs this automatically when MAPILLARY_TOKEN is set (free token: mapillary.com/dashboard/developers).
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import proj4 from 'proj4';
import {SpatialIndex} from '../src/geo.js';
import {prepareGraph,routePoint} from '../src/mobility.js';
import {signalAnchor} from '../src/road-safety.js';
import {signFace} from '../src/sign-faces.js';
import {env} from './env.mjs';

// Extracted features are not covered merely by the imagery's CC BY-SA licence.
// Confirm downstream dataset redistribution rights before publishing these entries.
export const SOURCE='Mapillary map features',LICENCE='Mapillary Terms of Use (downstream redistribution rights unconfirmed)',ATTRIBUTION='Street furniture positions from Mapillary map features (mapillary.com), under Mapillary Terms of Use (mapillary.com/terms)';
const YEAR=365.25*864e5;

// ---------- Classification ----------
// Detection value → furniture kind. Flat things (manholes, road markings) are not hittable and are skipped;
// shop signs, adverts, banners and cameras hang on buildings and are ignored.
const RULES=[
 [/^object--street-light/,'lamp'],
 [/^object--traffic-light--(pedestrians|cyclists)/,'crossing-light'],
 [/^object--traffic-light/,'traffic-light'],
 [/^object--traffic-sign/,'sign'],
 [/^(regulatory|warning|information|complementary)--/,'sign'],
 [/^object--trash-can/,'bin'],
 [/^object--junction-box/,'junction-box'],
 [/^construction--barrier--temporary/,'barrier'],
 [/^object--traffic-cone/,'cone'],
 [/^object--bench/,'bench'],
 [/^object--bike-rack/,'bike-rack'],
 [/^object--support--(utility-pole|pole)$/,'pole'],
 [/^object--parking-meter/,'parking-meter'],
 [/^object--fire-hydrant/,'hydrant'],
];
const FLAT=/^marking--|^object--(manhole|catch-basin|water-valve)|^construction--flat--/;
// merge: radius (m) within which two detections of the same kind are one object (two detector pipelines
// often report the same lamp). temporary: dropped once newer photos exist.
export const KIND={
 lamp:{merge:3},'traffic-light':{merge:2.5},'crossing-light':{merge:2},sign:{merge:1.2},bin:{merge:1.5},'junction-box':{merge:1.5},
 pole:{merge:1.5},'parking-meter':{merge:1},hydrant:{merge:1},bench:{merge:2},'bike-rack':{merge:2},barrier:{merge:1.2,temporary:true},cone:{merge:.8,temporary:true},
};
export function classify(value=''){
 if(FLAT.test(value))return 'flat';
 for(const [re,kind] of RULES)if(re.test(value))return kind;
 return null;
}
const typedSign=v=>/^(regulatory|warning|information|complementary)--/.test(v);

// ---------- Projection ----------
// Same local frame as city-build: transverse Mercator at the origin, x east, z south, centimetre rounding.
export function localFrame(origin,projection){
 const [lon0,lat0]=origin,p=projection||`+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} +k=1 +x_0=0 +y_0=0 +ellps=GRS80 +units=m +no_defs`;
 const t=proj4('EPSG:4326',p),round=n=>Math.round(n*100)/100;
 return {local:(lon,lat)=>{const [x,y]=t.forward([lon,lat]);return [round(x)+0,round(-y)+0];},lonLat:(x,z)=>proj4(p,'EPSG:4326').forward([x,-z])};
}
const time=s=>s?Date.parse(String(s).replace(/([+-]\d\d)(\d\d)$/,'$1:$2'))||0:0;
// aligned_direction is the compass bearing the detected face looks towards (towards the cameras that saw it).
export const yawFromBearing=deg=>{const t=deg*Math.PI/180;return Math.atan2(Math.sin(t),-Math.cos(t));};
export function projectFeatures(features,local){
 return features.filter(f=>f.geometry?.type==='Point').map(f=>{
  const [x,z]=local(...f.geometry.coordinates),imgs=f.images?.data||[];
  let cam=null;if(imgs.length){const ps=imgs.map(i=>local(...i.geometry.coordinates));cam=[ps.reduce((n,p)=>n+p[0],0)/ps.length,ps.reduce((n,p)=>n+p[1],0)/ps.length];}
  return {id:String(f.id),value:f.object_value||'',kind:classify(f.object_value),x,z,first:time(f.first_seen_at),last:time(f.last_seen_at),images:f.images?imgs.length:null,dir:Number.isFinite(f.aligned_direction)?f.aligned_direction:null,cam};
 });
}

// ---------- Quality ----------
// Drops: seen in fewer than minImages photos (untyped signs: genericImages); last seen before minYear; "stale" (the spot was photographed
// again recaptureYears later — at least `evidence` newer detections within `radius` — but this object was not
// seen again, so it is probably gone); temporary items (barriers, cones, roadworks signs) not seen within temporaryYears of the newest photos.
function grid(items,size){const g=new Map();for(const it of items){const k=`${Math.floor(it.x/size)},${Math.floor(it.z/size)}`;if(!g.has(k))g.set(k,[]);g.get(k).push(it);}
 return {near(x,z,r){const out=[];for(let i=Math.floor((x-r)/size);i<=Math.floor((x+r)/size);i++)for(let j=Math.floor((z-r)/size);j<=Math.floor((z+r)/size);j++)for(const it of g.get(`${i},${j}`)||[])if(Math.hypot(it.x-x,it.z-z)<=r)out.push(it);return out;}};}
export const TEMPORARY=/roadworks|temporary|detour/;
export function qualityFilter(items,all=items,{minImages=2,minYear=2014,recaptureYears=3,evidence=5,radius=8,temporaryYears=1,genericImages=3}={}){
 const newest=all.reduce((m,f)=>f.last>m?f.last:m,0),index=grid(all,radius),kept=[],dropped={fewImages:0,old:0,stale:0,temporary:0};
 for(const it of items){
  if(it.images!==null&&it.images<minImages){dropped.fewImages++;continue;}
  if(it.last&&new Date(it.last).getUTCFullYear()<minYear){dropped.old++;continue;}
  if(it.kind==='sign'&&!typedSign(it.value)&&it.images!==null&&it.images<genericImages){dropped.fewImages++;continue;}
  if((KIND[it.kind]?.temporary||TEMPORARY.test(it.value))&&it.last<newest-temporaryYears*YEAR){dropped.temporary++;continue;}
  if(index.near(it.x,it.z,radius).filter(f=>f.last>=it.last+recaptureYears*YEAR).length>=evidence){dropped.stale++;continue;}
  kept.push(it);
 }
 return {kept,dropped};
}

// ---------- Duplicates within Mapillary ----------
// Best-evidenced detection first; anything of the same kind (and same sign code) within the kind's merge radius joins it.
export function mergeDuplicates(items){
 const order=[...items].sort((a,b)=>(b.images??0)-(a.images??0)||b.last-a.last),kept=[],index=new Map();let merged=0;
 for(const it of order){
  const r=KIND[it.kind]?.merge??1,key=it.kind==='sign'?`sign:${typedSign(it.value)?signFace(it.value).code:'generic'}`:it.kind;
  if(!index.has(key))index.set(key,[]);
  const twin=index.get(key).find(k=>Math.hypot(k.x-it.x,k.z-it.z)<r);
  if(twin){twin.mly.push(it.id);twin.last=Math.max(twin.last,it.last);merged++;continue;}
  const keep={...it,mly:[it.id]};kept.push(keep);index.get(key).push(keep);
 }
 return {kept,merged};
}

// ---------- Sign posts ----------
// Typed signs (exact sign code) within `share` metres are plates on one post, each keeping its own facing
// (back-to-back plates are common); complementary plates hang under their main sign. Untyped "there is a
// sign" detections near a typed one are the same sign; the rest become a generic plate.
// Facing comes from aligned_direction (checked against the camera positions: they agree for 97% of
// Tampere's signs), else from where the cameras stood.
export function facingOf(it){
 if(it.dir!==null&&it.dir!==undefined){const yaw=yawFromBearing(it.dir);return /-back$/.test(it.value)?yaw+Math.PI:yaw;}
 if(it.cam)return Math.atan2(it.cam[0]-it.x,it.cam[1]-it.z);
 return null;
}
export function signPosts(signs,{share=1.5,absorb=2.5,maxPlates=4}={}){
 const typed=signs.filter(s=>typedSign(s.value)),generic=signs.filter(s=>!typedSign(s.value)),posts=[];let absorbed=0;
 for(const s of typed){
  const plate={...signFace(s.value),yaw:facingOf(s)},post=posts.find(p=>Math.hypot(p.x-s.x,p.z-s.z)<share);
  if(post){post.plates.push(plate);post.mly.push(...s.mly);post.last=Math.max(post.last,s.last);continue;}
  posts.push({kind:'sign',x:s.x,z:s.z,plates:[plate],mly:[...s.mly],last:s.last,images:s.images});
 }
 for(const s of generic){
  const near=posts.find(p=>Math.hypot(p.x-s.x,p.z-s.z)<(p.generic?share:absorb));
  if(near){near.mly.push(...s.mly);absorbed++;continue;}
  const face=/direction/.test(s.value)?signFace('information--general-directions'):/information-parking/.test(s.value)?signFace('information--parking'):signFace('generic');
  posts.push({kind:'sign',x:s.x,z:s.z,plates:[{...face,yaw:facingOf(s)}],mly:[...s.mly],last:s.last,images:s.images,generic:true});
 }
 for(const p of posts){
  // One plate per sign face and direction; main signs first so complementary plates end up underneath.
  const seen=new Set();
  p.plates=p.plates.sort((a,b)=>(a.shape==='small')-(b.shape==='small')).filter(f=>{const k=`${f.face}:${Math.round((f.yaw??0)/1.05)}`;return !seen.has(k)&&seen.add(k);}).slice(0,maxPlates);
  p.yaw=p.plates[0].yaw;delete p.generic;
 }
 return {posts,absorbed};
}

// ---------- Placement on the city's surfaces ----------
// Inside a mapped building: dropped (wall-mounted lamps and signs are not free-standing posts).
// On the carriageway (a mapped carriageway polygon, or within `laneClear` metres of a traffic lane, which
// catches streets whose polygons are missing or narrower than the lanes): items move to the nearest point
// off it within `snap` metres (plus a small margin onto the pavement); further out they are lamps hung
// over the street on wires, or bad fixes: dropped.
export const CARRIAGEWAY=/^(Ajorata|Raitiotie)/;
export function laneIndex(mobility,{cell=20}={}){
 const g=new Map();
 for(const e of mobility?.roads?.edges||[]){const p=e.points,l=e.lane||0;
  for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!L)continue;
   // Lanes sit `lane` metres to the right of the centreline (x east, z south).
   const nx=(b[1]-a[1])/L*l,nz=-(b[0]-a[0])/L*l,s=[a[0]+nx,a[1]+nz,b[0]+nx,b[1]+nz];
   for(let x=Math.floor(Math.min(s[0],s[2])/cell);x<=Math.floor(Math.max(s[0],s[2])/cell);x++)for(let z=Math.floor(Math.min(s[1],s[3])/cell);z<=Math.floor(Math.max(s[1],s[3])/cell);z++){const k=`${x},${z}`;if(!g.has(k))g.set(k,[]);g.get(k).push(s);}}}
 return {distance(x,z){let d=Infinity;const i0=Math.floor(x/cell),j0=Math.floor(z/cell);
  for(let i=i0-1;i<=i0+1;i++)for(let j=j0-1;j<=j0+1;j++)for(const s of g.get(`${i},${j}`)||[]){const dx=s[2]-s[0],dz=s[3]-s[1],t=Math.max(0,Math.min(1,((x-s[0])*dx+(z-s[1])*dz)/(dx*dx+dz*dz)));d=Math.min(d,Math.hypot(s[0]+dx*t-x,s[1]+dz*t-z));}
  return d;}};
}
export function surfaceIndex(city,mobility=null,{laneClear=1.4}={}){
 const polygons=new SpatialIndex((city.roads||[]).filter(r=>CARRIAGEWAY.test(r.kind)&&!/Koroke/.test(r.kind))),lanes=laneIndex(mobility);
 return {buildings:new SpatialIndex(city.buildings||[]),carriageway:{at:(x,z)=>!!polygons.at(x,z)||lanes.distance(x,z)<laneClear}};
}
const DIRS=Array.from({length:32},(_,i)=>[Math.cos(i*Math.PI/16),Math.sin(i*Math.PI/16)]);
export function snapOffCarriageway(x,z,{buildings,carriageway},{snap=3.5,margin=.4}={}){
 const clear=(px,pz)=>!carriageway.at(px,pz)&&!buildings.at(px,pz);
 for(let r=.2;r<=snap+1e-9;r+=.2)for(const [dx,dz] of DIRS){
  const px=x+dx*r,pz=z+dz*r;
  if(clear(px,pz)&&clear(px+dx*margin,pz+dz*margin)&&clear(px+dx*margin*2,pz+dz*margin*2))return {x:+(px+dx*margin).toFixed(2),z:+(pz+dz*margin).toFixed(2),moved:+(r+margin).toFixed(2)};
 }
 return null;
}
// Heading from a point to the nearest carriageway (lamp arms reach over the road; boxes turn their backs to it).
export function towardRoad(x,z,{carriageway},reach=14){
 for(let r=.5;r<=reach;r+=.5)for(const [dx,dz] of DIRS)if(carriageway.at(x+dx*r,z+dz*r))return Math.atan2(dx,dz);
 return null;
}
export function placeItems(items,surfaces,{radius=Infinity,snap=3.5}={}){
 const placed=[],dropped={outside:0,building:0,carriageway:0};let snapped=0;
 for(const it of items){
  if(Math.hypot(it.x,it.z)>radius){dropped.outside++;continue;}
  if(surfaces.buildings.at(it.x,it.z)){dropped.building++;continue;}
  let {x,z}=it,moved=0;
  if(surfaces.carriageway.at(x,z)){const p=snapOffCarriageway(x,z,surfaces,{snap});if(!p){dropped.carriageway++;continue;}({x,z,moved}=p);snapped++;}
  placed.push({...it,x,z,moved});
 }
 return {placed,dropped,snapped};
}

// ---------- Doubles against objects the city already places ----------
// existing: [{kind,x,z}] (generated traffic-signal posts, register trees, OSM objects). A detection of the
// same kind within `radius[kind]` is that object (the existing one stays: signal posts are tied to their
// approach lane, so the detection only confirms it); anything within `clash` of an existing trunk or post
// would stand inside it and is dropped too.
const SAME={'crossing-light':'traffic-light'};
export function dedupeExisting(items,existing,{radius={'traffic-light':8,lamp:2.5,sign:1.5,bin:1.2},clash=.6}={}){
 const index=grid(existing,8),kept=[],dropped={duplicate:0,clash:0};
 for(const it of items){
  const kind=SAME[it.kind]||it.kind,r=radius[kind]||0;
  const near=index.near(it.x,it.z,Math.max(r,clash));
  if(r&&near.some(e=>(SAME[e.kind]||e.kind)===kind&&Math.hypot(e.x-it.x,e.z-it.z)<r)){dropped.duplicate++;continue;}
  if(near.some(e=>Math.hypot(e.x-it.x,e.z-it.z)<clash)){dropped.clash++;continue;}
  kept.push(it);
 }
 return {kept,dropped};
}
// The traffic-signal posts every city gets (street-life.js): one per signalled approach, anchored on the pavement.
export function generatedSignalPosts(mobility,city){
 if(!mobility?.roads?.edges)return [];
 const roads=prepareGraph(structuredClone(mobility.roads)),world={pavement:new SpatialIndex(city.pavement||[]),roads:new SpatialIndex((city.roads||[]).filter(r=>!/Koroke/.test(r.kind))),buildings:new SpatialIndex(city.buildings||[])};
 const used=new Set(),out=[];
 for(const e of roads.edges){if(e.signal<0||e.length<10)continue;const key=`${e.signal}:${Math.round(routePoint(e,e.length-3).heading/1.6)}`;if(used.has(key))continue;used.add(key);
  const p=signalAnchor(e,world);if(p)out.push({kind:'traffic-light',x:p.x,z:p.z,source:'osm-signal'});}
 return out;
}

// ---------- The whole pipeline (pure: features in, furniture out) ----------
export function buildFurnitureLayer(features,{local,city,mobility=null,existing=[],radius=Infinity,quality={}}){
 const all=projectFeatures(features,local),counts={fetched:all.length,flat:0,ignored:0,byKind:{}};
 const count=(kind,key,n=1)=>{const k=counts.byKind[kind]??={detections:0,kept:0,placed:0};k[key]=(k[key]||0)+n;};
 const candidates=[];
 for(const f of all){if(f.kind==='flat')counts.flat++;else if(!f.kind)counts.ignored++;else{candidates.push(f);count(f.kind,'detections');}}
 const q=qualityFilter(candidates,all,quality);counts.quality=q.dropped;
 const m=mergeDuplicates(q.kept);counts.mergedDetections=m.merged;
 const signs=signPosts(m.kept.filter(i=>i.kind==='sign'));counts.signDetectionsAbsorbed=signs.absorbed;
 const objects=[...m.kept.filter(i=>i.kind!=='sign'),...signs.posts];
 for(const o of objects)count(o.kind,'kept');
 const surfaces=surfaceIndex(city,mobility),p=placeItems(objects,surfaces,{radius});counts.placement={...p.dropped,snappedToPavement:p.snapped};
 const d=dedupeExisting(p.placed,existing);counts.existing={...d.dropped,compared:existing.length};
 const r2=v=>+v.toFixed(2),r3=v=>v===null||v===undefined?undefined:+(+v).toFixed(3);
 const items=d.kept.map(o=>{
  // Signs and signal heads face where the cameras saw them from; lamp arms reach over the road; boxes and benches turn their backs to it.
  const road=towardRoad(o.x,o.z,surfaces);
  let yaw=o.kind==='sign'?o.yaw:/light/.test(o.kind)?facingOf(o):null;
  if(yaw===null||yaw===undefined)yaw=o.kind==='sign'||/lamp|light/.test(o.kind)?road:road===null?null:road+Math.PI;
  const out={k:o.kind,x:r2(o.x),z:r2(o.z),yaw:r3(yaw??0)};
  if(o.kind==='sign'){out.faces=o.plates.map(f=>f.face);out.yaws=o.plates.map(f=>r3(f.yaw??yaw));}
  if(o.moved)out.moved=o.moved;
  out.src='mapillary';out.mly=o.mly;out.seen=new Date(o.last).toISOString().slice(0,10);
  count(o.kind,'placed');return out;
 }).sort((a,b)=>a.k.localeCompare(b.k)||a.x-b.x);
 counts.placed=items.length;
 // Each face once with a sign code the runtime turns back into its drawing (signFace).
 const codes=new Map();for(const o of d.kept)for(const f of o.plates||[])codes.set(f.face,f.code);
 const faces=[...codes].sort((a,b)=>a[0].localeCompare(b[0])).map(([face,code])=>({face,code}));
 return {items,faces,counts};
}

// ---------- Fetching (tiled, cached, retried) ----------
const API='https://graph.mapillary.com/map_features',FIELDS='id,object_value,object_type,geometry,first_seen_at,last_seen_at,aligned_direction,images';
// The endpoint silently returns fewer features for large boxes: ask for small cells and split any cell that looks full.
export function cellsFor(bbox,{lon=.003,lat=.0015}={}){
 const [w,s,e,n]=bbox,out=[];
 for(let x=w;x<e-1e-9;x+=lon)for(let y=s;y<n-1e-9;y+=lat)out.push([x,y,Math.min(e,x+lon),Math.min(n,y+lat)].map(v=>+v.toFixed(6)));
 return out;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getJson(url,tries=7){
 let status=0;
 for(let attempt=0;attempt<tries;attempt++){
  try{const r=await fetch(url,{signal:AbortSignal.timeout(90000)});
   if(r.ok)return await r.json();
   if(r.status===401||r.status===403)throw Object.assign(Error(`Mapillary refused the token (HTTP ${r.status}); check MAPILLARY_TOKEN`),{fatal:true});
   status=r.status;console.log(`  mapillary: HTTP ${r.status}, retry ${attempt+1}`);}
  catch(error){if(error.fatal)throw error;console.log(`  mapillary: ${String(error.message).slice(0,60)}, retry ${attempt+1}`);}
  await sleep(Math.min(60000,2000*2**attempt));
 }
 throw Object.assign(Error('Mapillary request kept failing; run again later (finished cells are cached)'),{status});
}
export async function fetchFeatures(bbox,{token,dir,refresh=false,split=250,depth=3,concurrency=6}={}){
 fs.mkdirSync(dir,{recursive:true});
 const byId=new Map();let requests=0,cached=0;
 async function cell(b,level){
  const file=path.join(dir,`${b.join('_')}.json`);let data;
  if(fs.existsSync(file)&&!refresh){data=JSON.parse(fs.readFileSync(file));cached++;}
  else{
   // Very dense cells (city centres) make the API answer HTTP 500: split those into quarters instead of giving up.
   try{data=await getJson(`${API}?access_token=${token}&fields=${FIELDS}&bbox=${b.join(',')}&limit=2000`,level<5?3:7);}
   catch(error){if(error.fatal||error.status!==500||level>=5)throw error;const [w,s,e,n]=b,mx=+((w+e)/2).toFixed(6),my=+((s+n)/2).toFixed(6);
    console.log(`  mapillary: splitting a dense cell (level ${level+1})`);for(const q of [[w,s,mx,my],[mx,s,e,my],[w,my,mx,n],[mx,my,e,n]])await cell(q,level+1);return;}
   requests++;fs.writeFileSync(file,JSON.stringify(data));}
  for(const f of data.data||[])byId.set(String(f.id),f);
  if((data.data||[]).length>=split&&level<depth){const [w,s,e,n]=b,mx=+((w+e)/2).toFixed(6),my=+((s+n)/2).toFixed(6);
   for(const q of [[w,s,mx,my],[mx,s,e,my],[w,my,mx,n],[mx,my,e,n]])await cell(q,level+1);}
 }
 const queue=Array.isArray(bbox[0])?[...bbox]:cellsFor(bbox);const total=queue.length;
 await Promise.all(Array.from({length:concurrency},async()=>{while(queue.length){await cell(queue.shift(),0);if((total-queue.length)%50===0)console.log(`  mapillary: ${total-queue.length}/${total} cells`);}}));
 return {features:[...byId.values()],requests,cached};
}

// ---------- City build step ----------
export async function buildFurniture(id,{refresh=false}={}){
 const token=env('MAPILLARY_TOKEN');
 if(!token)throw Error('MAPILLARY_TOKEN is not set. Get a free client token at mapillary.com/dashboard/developers and put MAPILLARY_TOKEN=... in .env.local');
 const regFile='public/cities/index.json',registry=JSON.parse(fs.readFileSync(regFile)),entry=registry.cities.find(c=>c.id===id);
 if(!entry)throw Error(`Build the city first: npm run city:build -- ${id}`);
 const OUT=path.join('public/cities',id),RAW=path.join('data/raw/cities',id,'mapillary');
 const city=JSON.parse(gunzipSync(fs.readFileSync(path.join(OUT,'city.pack')))),mobility=JSON.parse(fs.readFileSync(path.join(OUT,'mobility.json')));
 const frame=localFrame(entry.origin,entry.projection),R=entry.radius||1500;
 // Cells covering the playable circle (plus a margin), in WGS84.
 const [w,s]=frame.lonLat(-R-100,R+100),[e,n]=frame.lonLat(R+100,-R-100);
 const cells=cellsFor([w,s,e,n]).filter(([a,b,c,d])=>{const [x0,z0]=frame.local(a,d),[x1,z1]=frame.local(c,b),cx=Math.max(x0,Math.min(0,x1)),cz=Math.max(z0,Math.min(0,z1));return Math.hypot(cx,cz)<R+100;});
 console.log(`Fetching Mapillary map features around ${entry.name} (${cells.length} cells)…`);
 const fetched=await fetchFeatures(cells,{token,dir:RAW,refresh});
 const existing=[...generatedSignalPosts(mobility,city),...(city.trees||[]).map(t=>({kind:'tree',x:t.p[0],z:t.p[1]}))];
 const layer=buildFurnitureLayer(fetched.features,{local:frame.local,city,mobility,existing,radius:R});
 // Official signs, signals, crossings and stops (Digiroad for Finnish cities, the city's own registers).
 const {addOfficialFurniture}=await import('./digiroad-signs.mjs');
 const official=addOfficialFurniture({id,entry,frame,city,mobility,layer,existing,lightsNow:[...existing.filter(e=>e.kind==='traffic-light'),...layer.items.filter(i=>/light/.test(i.k))],refresh});
 if(official){layer.items=official.items;layer.faces=official.faces;layer.counts.official=official.counts;}
 const out={source:official?`${SOURCE} + official registers`:SOURCE,licence:official?`${LICENCE}; CC BY 4.0; ODbL`:LICENCE,attribution:[ATTRIBUTION,...(official?[...official.credits,'Sign nodes from OpenStreetMap contributors, ODbL']:[])].join('. '),fetchedAt:new Date().toISOString().slice(0,10),
  note:'Positions of street furniture, filtered and snapped off the carriageway at build time. src names the source of each object (mapillary, digiroad, city, osm; a+b when both saw it); mly lists the Mapillary map feature ids and ref the official record ids behind it.',
  counts:layer.counts,faces:layer.faces,items:layer.items};
 fs.writeFileSync(path.join(OUT,'furniture.json'),JSON.stringify(out));
 const kinds={};for(const i of layer.items)kinds[i.k]=(kinds[i.k]||0)+1;
 entry.furniture='furniture.json';
 entry.attribution=entry.attribution.replace('Street furniture positions from Mapillary map features (mapillary.com), CC BY-SA 4.0',ATTRIBUTION);
 if(!entry.attribution.includes(ATTRIBUTION))entry.attribution=entry.attribution.replace(/ Building heights/,` ${ATTRIBUTION}. Building heights`);
 if(!entry.attribution.includes(ATTRIBUTION))entry.attribution+=` ${ATTRIBUTION}.`;
 for(const credit of official?.credits||[])if(!entry.attribution.includes(credit.split(',')[0]))entry.attribution+=` ${credit}.`;
 entry.counts={...entry.counts,furniture:{placed:layer.items.length,...kinds}};
 fs.writeFileSync(regFile,JSON.stringify(registry,null,1));
 console.log(JSON.stringify({city:entry.name,requests:fetched.requests,cachedCells:fetched.cached,...layer.counts},null,1));
 return layer;
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
 const id=process.argv[2];
 if(!/^[a-z0-9-]+$/.test(id||''))throw Error('Usage: npm run city:furniture -- <id> [--refresh]');
 // Not awaited at the top level: the official-data step imports this module back.
 buildFurniture(id,{refresh:process.argv.includes('--refresh')}).catch(error=>{console.error(error);process.exit(1);});
}
