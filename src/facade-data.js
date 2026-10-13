import {ensurePartColours} from './shell-colors.js';
// Per-building façade descriptions for cities built from OpenStreetMap (cities/<id>/facades.json,
// copied next to the city's runtime data). Written by a person or a coding agent from open
// street-level photos; this module checks them and fills defaults for src/facade-renderer.js.
// Words and numbers only: never image pixels.

export const SHAPES=['rect','square','arch','ribbon','none'];
export const GROUND=['shops','arcade','solid','glass'];
export const MATERIALS=['render','brick','stone','glass','concrete','metal','timber'];
const HEX=/^#[0-9a-f]{6}$/i;

const num=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
function checkWindows(w,where,errors){
 if(w==null)return;
 if(typeof w!=='object'){errors.push(`${where}: must be an object`);return;}
 if(w.shape!=null&&!SHAPES.includes(w.shape))errors.push(`${where}.shape: one of ${SHAPES.join(', ')}`);
 for(const [k,min,max] of [['pitch',.6,12],['width',.2,10],['height',.2,6]])if(w[k]!=null&&!num(w[k],min,max))errors.push(`${where}.${k}: number ${min}–${max}`);
 for(const k of ['frame','glass'])if(w[k]!=null&&!HEX.test(w[k]))errors.push(`${where}.${k}: #rrggbb colour`);
}

// Returns a list of problems; empty when the file is usable.
export function validateFacades(data){
 const errors=[];
 if(!data||typeof data!=='object')return ['facades file must be a JSON object'];
 if(data.schemaVersion!==1)errors.push('schemaVersion must be 1');
 if(!data.buildings||typeof data.buildings!=='object')return [...errors,'buildings must map building ids to façades'];
 if(data.groups!=null&&!Array.isArray(data.groups))errors.push('groups must be a list of {ids, facade}');
 const entries=[...Object.entries(data.buildings).map(([id,b])=>[`buildings["${id}"]`,b]),...(data.groups||[]).map((g,i)=>[`groups[${i}].facade`,g?.facade])];
 (data.groups||[]).forEach((g,i)=>{if(!Array.isArray(g?.ids)||!g.ids.length)errors.push(`groups[${i}].ids: list of building ids`);});
 for(const [at,b] of entries){
  if(!b||typeof b!=='object'){errors.push(`${at}: must be an object`);continue;}
  if(!HEX.test(b.wall||''))errors.push(`${at}.wall: #rrggbb colour required`);
  for(const k of ['wallLower','roof','cornice','trim'])if(b[k]!=null&&!HEX.test(b[k]))errors.push(`${at}.${k}: #rrggbb colour`);
  if(b.material!=null&&!MATERIALS.includes(b.material))errors.push(`${at}.material: one of ${MATERIALS.join(', ')}`);
  if(b.storeys!=null&&!(Number.isInteger(b.storeys)&&b.storeys>=1&&b.storeys<=40))errors.push(`${at}.storeys: whole number 1–40`);
  if(b.height!=null&&!num(b.height,2,150))errors.push(`${at}.height: metres 2–150`);
  if(b.groundStorey!=null&&!num(b.groundStorey,2,9))errors.push(`${at}.groundStorey: metres 2–9`);
  if(b.lowerStoreys!=null&&!(Number.isInteger(b.lowerStoreys)&&b.lowerStoreys>=1))errors.push(`${at}.lowerStoreys: whole number ≥ 1`);
  checkWindows(b.windows,`${at}.windows`,errors);
  for(const [k,w] of Object.entries(b.storeyWindows||{})){if(!/^-?\d+$/.test(k))errors.push(`${at}.storeyWindows: keys are storey numbers (0 = ground, -1 = top)`);checkWindows(w,`${at}.storeyWindows["${k}"]`,errors);}
  const g=b.ground;
  if(g!=null){
   if(!GROUND.includes(g.type))errors.push(`${at}.ground.type: one of ${GROUND.join(', ')}`);
   for(const k of ['band','awning','frame','canopy'])if(g[k]!=null&&!HEX.test(g[k]))errors.push(`${at}.ground.${k}: #rrggbb colour`);
   if(g.pitch!=null&&!num(g.pitch,1,15))errors.push(`${at}.ground.pitch: metres 1–15`);
  }
  const e=b.evidence;
  if(!e||!Array.isArray(e.photos))errors.push(`${at}.evidence.photos: list the reference photos used`);
  else for(const p of e.photos)if(!p||!/^\w+$/.test(String(p.id||''))||!/^\d{4}-\d\d-\d\d$/.test(p.captured||''))errors.push(`${at}.evidence.photos: each needs an id and captured date (YYYY-MM-DD)`);
  if(e&&!num(e.confidence,0,1))errors.push(`${at}.evidence.confidence: 0–1`);
 }
 return errors;
}

// One building's description with every renderer default filled in.
export function normaliseFacade(b,partHeight){
 const height=b.height??partHeight,glassWalls=b.material==='glass';
 const storeys=b.storeys??Math.max(1,Math.round((height-.6)/3.3));
 const groundStorey=Math.min(b.groundStorey??(storeys>1?Math.min(4.2,height*.3):height-.3),height-.3);
 const windows={shape:'rect',pitch:2.6,width:1.2,height:1.55,frame:'#e8e4da',glass:'#35464f',...b.windows};
 return {...b,height,storeys,groundStorey,windows,material:b.material||'render',
  wallLower:b.wallLower||null,lowerStoreys:b.lowerStoreys??1,
  trim:b.trim||b.cornice||null,roof:b.roof||'#4c5154',
  ground:b.ground===null?null:{type:glassWalls?'glass':'shops',pitch:4,band:'#2e3134',frame:'#2b2d2f',...b.ground},
  storeyWindows:b.storeyWindows||{}};
}

// Floor bands of a wall of the given height: [{index,y0,y1}] from the ground up.
export function storeyBands(spec,wallHeight){
 const n=spec.storeys,parapet=n>1?Math.min(1,wallHeight*.04):0,g=Math.min(spec.groundStorey,wallHeight);
 if(n===1)return [{index:0,y0:0,y1:wallHeight-parapet}];
 const h=Math.max(1.8,(wallHeight-g-parapet)/(n-1)),out=[{index:0,y0:0,y1:g}];
 for(let i=1;i<n&&g+i*h<=wallHeight-parapet+.01;i++)out.push({index:i,y0:g+(i-1)*h,y1:g+i*h});
 return out;
}

// Window style for one storey: storey-specific overrides (top storey as -1) over the default.
export function storeyStyle(spec,index,count){
 const own=spec.storeyWindows[index]??(index===count-1?spec.storeyWindows[-1]:undefined);
 return own?{...spec.windows,...own}:spec.windows;
}

// Lookup used at load time: attach each description to its building parts and apply height fixes.
// Groups give many small similar structures (shelters, kiosks) one shared description.
export function facadeFor(data,id){
 return data?.buildings?.[id]||data?.groups?.find(g=>g.ids.includes(id))?.facade||null;
}
export function attachFacades(index,data){
 if(!data?.buildings)return 0;let n=0;
 for(const t of index.tiles)for(const p of t.parts){const f=facadeFor(data,p.id);if(f){p.facade=normaliseFacade(f,p.sourceHeight??p.height);n++;}}
 return n;
}
// Measured shells use OSM or estimated heights. When the photos (facade.height) or the city's 3D
// building parts (measuredHeight, set from a place file) give a different height, stretch the
// part's vertices (in place, before any mesh is built) so every level of detail agrees.
export function applyFacadeHeights(array,parts){
 for(const p of parts){
  const want=p.facade?.height??p.measuredHeight;if(!want)continue;
  p.sourceHeight??=p.height;if(Math.abs(want-p.sourceHeight)<.05)continue; // tiles reload from the original data
  const k=want/p.sourceHeight;for(let i=p.start;i<p.start+p.count;i++)array[i*5+1]*=k;
  p.height=want;
 }
}

// Cities whose official 3D model has no photographs (registry flag `estimatedFacades`) get a plausible
// street front per building instead of flat walls: storeys from the measured height, window rhythm and
// ground floor varied per building, wall and roof colours from the build. Never used where a building
// has a photo-described front in facades.json.
const hexOf=c=>'#'+c.map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');
// Window style by construction year (SAVE register, scripts/save-years.py), else by the part's look.
function periodWindows(p,r,storeys){
 const y=p.year||0;
 if(y&&y<1800)return {shape:'rect',pitch:2.15+r(3)*.3,width:.92+r(4)*.15,height:1.4+r(5)*.2,frame:'#f0ece2',glass:'#2c3a42'};
 if(y&&y<1915)return {shape:r(2)<.15&&storeys<7?'arch':'rect',pitch:2.3+r(3)*.35,width:1.0+r(4)*.2,height:1.75+r(5)*.25,frame:r(6)<.9?'#efebe1':'#3b3f3c',glass:'#2c3a42'};
 if(y&&y<1950)return {shape:'rect',pitch:2.5+r(3)*.4,width:1.25+r(4)*.2,height:1.35+r(5)*.2,frame:r(6)<.6?'#efebe1':'#2f4a3c',glass:'#2a3840'};
 if(y&&y<1995)return r(9)<.4?{shape:'ribbon',pitch:1.8,width:1.8,height:1.4,frame:'#3f4448',glass:'#2a3b46'}:{shape:'rect',pitch:3.0,width:1.8,height:1.3,frame:'#3f4448',glass:'#2a3b46'};
 if(y)return r(9)<.65?{shape:'ribbon',pitch:1.5,width:1.5,height:2.1,frame:'#2f3438',glass:'#24333d'}:{shape:'rect',pitch:2.4,width:1.6,height:2.0,frame:'#2f3438',glass:'#24333d'};
 return p.modern&&r(9)<.45?{shape:'ribbon',pitch:1.6,width:1.6,height:1.9,frame:'#4a4f52',glass:'#2a3b46'}:{shape:r(2)<.12&&storeys<6?'arch':'rect',pitch:[2.4,2.6,2.8,3.1][Math.floor(r(3)*4)],width:1.0+r(4)*.35,height:1.45+r(5)*.45,frame:r(6)<.8?'#ece8de':'#3b3f3c',glass:'#2c3a42'};
}
export function estimatedFacade(p,{era=null}={}){
 let seed=0;for(const ch of String(p.id))seed=(seed*31+ch.charCodeAt(0))>>>0;
 const r=k=>{const x=Math.sin(seed*.0001+k*12.9898)*43758.5453;return x-Math.floor(x);};
 const wallH=p.height*(p.height>14?.8:.86),storeys=Math.max(1,Math.min(18,Math.round((wallH-.4)/3.15)));
 const brick=p.color[0]>.5&&p.color[1]<.42&&p.color[2]<.36,lighter=p.color.map(v=>v+(1-v)*.45);
 return normaliseFacade({
  wall:hexOf(p.color),roof:hexOf(p.roofColor||[.3,.32,.34]),material:brick?'brick':'render',storeys,estimated:true,door:['#3a2a20','#1f3a2c','#2d3550','#5a2a22','#2b2b2b'][Math.floor(r(13)*5)],
  groundStorey:storeys>1?3.3+r(1)*.7:undefined,cornice:hexOf(lighter),surround:brick?['#d8ccb4','#e6dfd0','#cbbfa6'][Math.floor(r(14)*3)]:hexOf(p.color.map(v=>v+(1-v)*.6)),plinth:['#5d5a55','#6b6660','#4f4d4a','#7a7068'][Math.floor(r(15)*4)],modern:!!p.modern,balconies:era!==1760&&(!!p.modern||(p.year||0)>=1950)&&storeys>=4&&r(16)<.6,balconyGlass:r(17)<.4,
  windows:era===1760?{shape:'rect',pitch:2.1+r(3)*.3,width:.9+r(4)*.12,height:1.45+r(5)*.2,frame:'#efe9dc',glass:'#27343c',shutters:r(18)<.45?['#2f4a3c','#5a2a22','#3a4a5a','#6b4a2a'][Math.floor(r(19)*4)]:null}:periodWindows(p,r,storeys),
  ground:era===1760?{type:'solid'}:storeys>=3&&r(7)<.68?{type:r(10)<.2?'glass':'shops',band:['#2e3134','#5a2a22','#1f3a2c','#2a3550','#3d2b1f'][Math.floor(r(8)*5)],...(r(11)<.35?{awning:['#7a2a20','#1f3a2c','#2d3550','#c8a24a','#e9e3d4'][Math.floor(r(12)*5)]}:{})}:{type:'solid'}
 },p.height);
}
export function estimateFacades(index,{era=null}={}){
 let n=0;for(const t of index.tiles)for(const p of t.parts){if(p.texture||p.noFacade)continue;if(!p.roofColor)ensurePartColours(p);if(!p.facade&&p.height>=4&&p.height<=60){p.facade=estimatedFacade(p,{era});n++;}}
 return n;
}
