#!/usr/bin/env node
// Re-dissolves a city's rendered ground (surfaces/*.bin.pack + surface-index.json) from the pieces in city.pack.
// city-build.mjs layers carriageways by material with setts first, so a cobbled side street's polygon (buffered past
// the junction) was drawn straight across the asphalt main road it meets. Here carriageways are layered by road class
// (primary over residential over service; asphalt before setts within a class), so a side street stops at the main
// road's edge. Ground also stops at mapped water (bridges excepted): a quay pavement buffered half over a canal was
// draped down the canal bank as a crumpled strip. Cycle tracks tagged on a road get their own strip beside it.
// Physics and street names keep the original pieces in city.pack.
//   node scripts/surface-dissolve.mjs copenhagen
import fs from 'node:fs';import path from 'node:path';import {gzipSync,gunzipSync} from 'node:zlib';
import polygonClipping from 'polygon-clipping';
import proj4 from 'proj4';
import {bounds,pointInPolygon} from '../src/geo.js';
import {surfaceRecord} from '../src/surface-streaming.js';
import {surfaceChunks} from './world-formats.mjs';

const id=process.argv[2];if(!/^[a-z0-9-]+$/.test(id||''))throw Error('Usage: node scripts/surface-dissolve.mjs <city>');
const reg=JSON.parse(fs.readFileSync('public/cities/index.json')).cities.find(c=>c.id===id),OUT=path.join('public',reg.dataRoot.replace(/^\//,''));
const city=JSON.parse(gunzipSync(fs.readFileSync(path.join(OUT,'city.pack'))));
// highway class of each OSM way (the 1760 build was made from today's raw cache)
const rawDir=['data/raw/cities/'+id,'data/raw/cities/'+id.replace(/-\d+$/,'')].find(d=>fs.existsSync(path.join(d,'highways.json')));
const highway=new Map();if(rawDir)for(const e of JSON.parse(fs.readFileSync(path.join(rawDir,'highways.json'))).elements)if(e.type==='way'&&e.tags?.highway)highway.set('osm-way-'+e.id,e.tags.highway);
const CLASS={motorway:0,trunk:0,primary:1,motorway_link:1,trunk_link:1,primary_link:1,secondary:2,secondary_link:2,tertiary:3,tertiary_link:3,unclassified:4,residential:4,living_street:5,road:5,service:6,pedestrian:6,track:7};
const MATERIAL=['Asfaltti','Betonikivi','Kivituhka','Puu','Nupukivi'];
const roadClass=r=>CLASS[highway.get(r.id)]??(/muu/.test(r.kind)?6:4);
const roadMaterial=r=>MATERIAL.includes(r.material)?r.material:'Asfaltti';
const bridge=p=>/Silta/.test(p.kind||'');
const T=200,safe=f=>{try{return f();}catch{return null;}};
const grid=items=>{const m=new Map();for(const it of items){const b=it.bbox||bounds(it.rings);for(let x=Math.floor(b[0]/T);x<=Math.floor(b[2]/T);x++)for(let z=Math.floor(b[1]/T);z<=Math.floor(b[3]/T);z++){const k=`${x},${z}`;if(!m.has(k))m.set(k,[]);m.get(k).push(it);}}return m;};
// Cycle tracks: OpenStreetMap maps most of Copenhagen's raised cycle tracks as a tag on the road (cycleway=track,
// cycleway:right=track, ...), not as a way of their own, so the ground between the carriageway and the pavement was an
// unmapped strip nobody could read as a bike path. Each tagged side gets a 2.2 m track outside the carriageway (the road
// polygon is the way buffered by its width), drawn in the cycle-track asphalt. Today only: 1760 had none.
const CAR_WIDTH={motorway:16,trunk:14,primary:12,secondary:10,tertiary:8.5,unclassified:6.5,residential:6.5,living_street:5.5,service:4.5,motorway_link:7,trunk_link:7,primary_link:7,secondary_link:7,tertiary_link:6.5};
const tracks=[],marks=[]; // marks: a painted bicycle every 40 m along each track, facing the way its traffic rides
if(rawDir&&reg.era!==1760){
 const toLocal=proj4('EPSG:4326',city.projection),raw=JSON.parse(fs.readFileSync(path.join(rawDir,'highways.json'))).elements,nodes=new Map();
 for(const e of raw)if(e.type==='node'){const [x,y]=toLocal.forward([e.lon,e.lat]);nodes.set(e.id,[x,-y]);}
 const blds=city.buildings.filter(b=>b.rings?.[0]?.length>2),bgrid=new Map();for(const b of blds){const bb=b.bbox||bounds(b.rings);for(let x=Math.floor(bb[0]/50);x<=Math.floor(bb[2]/50);x++)for(let z=Math.floor(bb[1]/50);z<=Math.floor(bb[3]/50);z++){const k=x+','+z;if(!bgrid.has(k))bgrid.set(k,[]);bgrid.get(k).push(b);}}
 for(const w of raw){if(w.type!=='way')continue;const t=w.tags||{};if(!CAR_WIDTH[t.highway]||(t.tunnel&&t.tunnel!=='no')||t.area==='yes')continue;
  const has=s=>/^(track|opposite_track)$/.test(t['cycleway:'+s]??t['cycleway:both']??t.cycleway??'');const sides=[has('left')?1:0,has('right')?-1:0].filter(Boolean);if(!sides.length)continue;
  const line=w.nodes.map(n=>nodes.get(n)).filter(Boolean);if(line.length<2)continue;
  const hw=(parseFloat(t.width)||CAR_WIDTH[t.highway])/2,a=hw-.05,b=hw+2.2,quads=[];
  for(const sd of sides){let prev=null;for(let i=1;i<line.length;i++){const [x0,z0]=line[i-1],[x1,z1]=line[i],l=Math.hypot(x1-x0,z1-z0);if(l<.05)continue;
   const nx=(z1-z0)/l*sd,nz=-(x1-x0)/l*sd; // left of the way's direction (x east, z south), right for sd=-1
   quads.push([[[x0+nx*a,z0+nz*a],[x1+nx*a,z1+nz*a],[x1+nx*b,z1+nz*b],[x0+nx*b,z0+nz*b],[x0+nx*a,z0+nz*a]]]);
   if(prev)quads.push([[[x0+prev[0]*a,z0+prev[1]*a],[x0+prev[0]*b,z0+prev[1]*b],[x0+nx*b,z0+nz*b],[x0+nx*a,z0+nz*a],[x0+prev[0]*a,z0+prev[1]*a]]]); // the bend's wedge
   prev=[nx,nz];}}
  let u=quads.length?safe(()=>polygonClipping.union(...quads)):null;if(!u?.length)continue;
  const ub=bounds(u.flat()),near=new Set();for(let x=Math.floor(ub[0]/50);x<=Math.floor(ub[2]/50);x++)for(let z=Math.floor(ub[1]/50);z<=Math.floor(ub[3]/50);z++)for(const bl of bgrid.get(x+','+z)||[])near.add(bl);
  if(near.size)u=safe(()=>polygonClipping.difference(u,...[...near].map(bl=>bl.rings)))||u; // never under a house
  const bridgeWay=t.bridge&&t.bridge!=='no';for(const rings of u)tracks.push({id:'track-'+w.id,kind:'Erotettu pyörätie'+(bridgeWay?' (Silta)':''),material:'Asfaltti',rings,bbox:bounds(rings)});
  for(const sd of sides){let run=20; // right-hand traffic: the right track rides with the way, the left one against it
   for(let i=1;i<line.length;i++){const [x0,z0]=line[i-1],[x1,z1]=line[i],l=Math.hypot(x1-x0,z1-z0);if(l<.05)continue;const dx=(x1-x0)/l,dz=(z1-z0)/l,nx=dz*sd,nz=-dx*sd,m=(a+b)/2;
    for(;run<=l;run+=40){const x=x0+dx*run+nx*m,z=z0+dz*run+nz*m;if(u.some(r=>pointInPolygon(x,z,r)))marks.push([x,z,sd<0?Math.atan2(-dx,-dz):Math.atan2(dx,dz)]);}
    run-=l;}}}
}
const water=city.water.filter(w=>w.rings?.[0]?.length>2);
const G={roads:grid(city.roads),pavement:grid([...city.pavement,...tracks]),parks:grid(city.parks),water:grid(water)};
const keys=new Set([...G.roads.keys(),...G.pavement.keys(),...G.parks.keys()]);
const paveClass=p=>/Silta/.test(p.kind)&&p.material==='Puu'?'wood':/pyör|Pyör/.test(p.kind)?'cycle':'walk';
const parkClass=p=>/Mets/.test(p.kind)?'Metsä':/Leikki/.test(p.kind)?'Leikkipaikka':/Kenttä/.test(p.kind)?'Kenttä':'Nurmikko';
const out={roads:[],pavement:[],parks:[],buildings:city.buildings};let clippedByWater=0;
for(const k of keys){
 const [x,z]=k.split(',').map(Number),cell=[[[x*T,z*T],[(x+1)*T,z*T],[(x+1)*T,(z+1)*T],[x*T,(z+1)*T],[x*T,z*T]]];
 const wet=(G.water.get(k)||[]).map(w=>w.rings);const wetU=wet.length?safe(()=>polygonClipping.intersection(polygonClipping.union(...wet),cell)):null;
 let placed=[];
 const layer=(items,groups,target,make)=>{
  for(const [cls,list] of groups){
   const dry=list.filter(i=>!bridge(i)).map(i=>i.rings),over=list.filter(bridge).map(i=>i.rings);
   let u=[];
   if(dry.length){u=safe(()=>polygonClipping.intersection(polygonClipping.union(...dry),cell))||[];if(wetU?.length&&u.length){const d=safe(()=>polygonClipping.difference(u,wetU));if(d){if(d.length!==u.length)clippedByWater++;u=d;}}}
   if(over.length){const b=safe(()=>polygonClipping.intersection(polygonClipping.union(...over),cell))||[];u=u.length&&b.length?(safe(()=>polygonClipping.union(u,b))||u):(u.length?u:b);}
   if(placed.length&&u.length)u=safe(()=>polygonClipping.difference(u,placed))||[];
   if(!u.length)continue;placed=safe(()=>polygonClipping.union(placed,u))||placed;
   for(const rings of u)target.push({...make(cls,list[0]),rings,bbox:bounds(rings)});
  }
 };
 const roads=G.roads.get(k)||[],byClass=new Map();
 for(const r of roads){const key=roadClass(r)*10+MATERIAL.indexOf(roadMaterial(r));if(!byClass.has(key))byClass.set(key,[]);byClass.get(key).push(r);}
 layer(roads,[...byClass.entries()].sort((a,b)=>a[0]-b[0]),out.roads,(cls,r)=>({kind:/Koroke/.test(r.kind)?r.kind:'Ajorata',material:roadMaterial(r)}));
 const pave=G.pavement.get(k)||[];layer(pave,['wood','cycle','walk'].map(c=>[c,pave.filter(p=>paveClass(p)===c)]).filter(e=>e[1].length),out.pavement,c=>c==='wood'?{kind:'Kevyt liikenne (Silta)',material:'Puu'}:c==='cycle'?{kind:'Erotettu pyörätie'}:{kind:'Jalkakäytävä'});
 const parks=G.parks.get(k)||[];layer(parks,['Metsä','Kenttä','Leikkipaikka','Nurmikko'].map(c=>[c,parks.filter(p=>parkClass(p)===c)]).filter(e=>e[1].length),out.parks,c=>({kind:c}));
}
// a bicycle painted where a crossing road took the track over is left out
const marksKept=marks.filter(([x,z])=>!(G.roads.get(`${Math.floor(x/T)},${Math.floor(z/T)}`)||[]).some(r=>!bridge(r)&&pointInPolygon(x,z,r.rings)));
if(reg.era!==1760)fs.writeFileSync(path.join(OUT,'cycle-marks.json'),JSON.stringify({source:'OpenStreetMap contributors, ODbL (cycleway=track on roads)',note:'x, z, yaw of a bicycle pictogram on a cycle track (scripts/surface-dissolve.mjs)',marks:marksKept.map(m=>m.map(v=>+v.toFixed(2)))}));
const dir=path.join(OUT,'surfaces');for(const f of fs.readdirSync(dir))fs.rmSync(path.join(dir,f));
const index=[];
for(const [k,values] of surfaceChunks(out)){const file=`surfaces/${k.replace(',','_')}.bin`;fs.writeFileSync(path.join(OUT,file+'.pack'),gzipSync(Buffer.from(new Float32Array(values).buffer),{level:9}));index.push(surfaceRecord(file,values));}
fs.writeFileSync(path.join(OUT,'surface-index.json'),JSON.stringify(index));
console.log(id,'surfaces:',out.roads.length,'road,',out.pavement.length,'pavement,',out.parks.length,'park pieces in',index.length,'chunks;',clippedByWater,'layers trimmed at the water;',highway.size,'highway tags;',tracks.length,'cycle track pieces,',marksKept.length,'bicycle marks');
