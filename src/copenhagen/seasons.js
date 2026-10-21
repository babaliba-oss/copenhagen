import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {groundAt} from '../terrain.js';
import {inWaterPolygons} from '../geo.js';

// Seasonal dressing for today's Copenhagen, chosen by the date (or ?season=halloween|christmas|none):
//  - Halloween (10 Oct - 2 Nov): carved pumpkins glowing on doorsteps along the pavements and by café tables,
//    and orange string lights over Nyhavn's quay. The pumpkins are Daniel's three models where they load (pumpkinPools).
//  - Christmas (20 Nov - 6 Jan): big lit trees on the main squares, warm bulb strings across the shopping
//    streets, wreaths of light on the pavements, and gently falling snow around the player.
// Everything is instanced (a handful of draw calls) and placed from the map data at load.
export function currentSeason(date=new Date(),search=globalThis.location?.search||''){
 const forced=new URLSearchParams(search).get('season');if(forced)return forced==='none'?null:forced;
 const m=date.getMonth()+1,d=date.getDate();
 if((m===10&&d>=10)||(m===11&&d<=2))return 'halloween';
 if((m===11&&d>=20)||m===12||(m===1&&d<=6))return 'christmas';
 return null;
}

const rnd=seed=>{let s=seed>>>0||1;return ()=>((s=Math.imul(s^s>>>15,1|s)+0x6d2b79f5|0,((s^s>>>14)>>>0)/4294967296));};
const colour=(g,hex)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();for(const k of Object.keys(n.attributes))if(k!=='position'&&k!=='normal')n.deleteAttribute(k);const c=new THREE.Color(hex),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));return n;};

function pumpkinGeometry(){
 // ribbed, squashed sphere; a short green stem
 const g=new THREE.SphereGeometry(.22,12,7),p=g.attributes.position;
 for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),a=Math.atan2(z,x),rib=1-.07*Math.pow(Math.abs(Math.cos(a*4)),.6);p.setXYZ(i,x*rib*1.15,y*.78,z*rib*1.15);}
 g.computeVertexNormals();g.translate(0,.17,0);
 return mergeGeometries([colour(g,'#e0701c'),colour(new THREE.CylinderGeometry(.025,.035,.09,6).translate(0,.37,0),'#4a5a26')]);
}
function faceGeometry(){
 // the carved face: two triangle eyes and a jagged mouth, just proud of the front (+Z)
 const shape=(pts)=>{const s=new THREE.Shape();s.moveTo(...pts[0]);for(const q of pts.slice(1))s.lineTo(...q);return new THREE.ShapeGeometry(s);};
 const parts=[shape([[-.11,.21],[-.04,.21],[-.075,.27]]),shape([[.04,.21],[.11,.21],[.075,.27]]),shape([[-.12,.13],[.12,.13],[.09,.08],[.05,.11],[0,.07],[-.05,.11],[-.09,.08]])];
 const g=mergeGeometries(parts.map(q=>{const n=q.toNonIndexed();n.deleteAttribute('uv');return n;}));g.translate(0,.02,.245);return g;
}
// Daniel's pumpkins (public/models/props/pumpkins.glb, scripts/models/pumpkins.py: A by monsieurmo, B by Nick Kotik,
// C by Charlie Tinley, all CC BY 4.0), each in two levels and two parts: the detailed one (1,500-1,900 triangles) for
// the pumpkins within NEAR of the player, a shrink-wrapped one (about 200) for the rest out to FAR. One instanced pool
// per model, level and part, refilled four times a second from the matrices worked out at load; the lit `body` keeps
// a faint glow of its own, the `glow` part (the painted face of A, the candle-lit insides of B and C) is unlit.
export const PUMPKIN_NEAR=40,PUMPKIN_FAR=260;
const PUMPKIN_SHARE={A:.45,B:.35,C:.2};
export function pumpkinPools(models,spots,scale,glowMaterial,far=PUMPKIN_FAR,hidden=null){ /* far: phones draw them to 140 m (~180k triangles at 260); hidden[i]: spot i is left out (a drawn wall stands there) */
 const group=new THREE.Group();group.name='Halloween pumpkins (models)';
 const kinds=Object.keys(models).filter(k=>models[k]?.[0]?.body&&models[k]?.[1]?.body);if(!kinds.length||!spots.length)return null;
 const total=kinds.reduce((a,k)=>a+(PUMPKIN_SHARE[k]??.2),0);
 const kindOf=i=>{let u=(Math.imul(i+1,2654435761)>>>0)/4294967296*total;for(const k of kinds){u-=PUMPKIN_SHARE[k]??.2;if(u<0)return k;}return kinds[kinds.length-1];};
 const body=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7,emissive:'#6a2a08',emissiveIntensity:.55});
 const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),sv=new THREE.Vector3(),UP=new THREE.Vector3(0,1,0);
 const by={};kinds.forEach(k=>by[k]={x:[],z:[],m:[],id:[]});
 spots.forEach((p,i)=>{const b=by[kindOf(i)],sc=scale(i);b.x.push(p[0]);b.z.push(p[1]);b.id.push(i);b.m.push(m4.compose(v.set(p[0],groundAt(p[0],p[1])+(p[3]??0),p[1]),q.setFromAxisAngle(UP,p[2]||0),sv.set(sc,sc,sc)).toArray());});
 const sets=kinds.filter(k=>by[k].x.length).map(k=>{const b=by[k],n=b.x.length,mats=new Float32Array(n*16);b.m.forEach((e,i)=>mats.set(e,i*16));
  const lv=[0,1].map(l=>['body','glow'].map(part=>{const g=models[k][l][part];if(!g)return null;const im=new THREE.InstancedMesh(g,part==='body'?body:glowMaterial,l?n:Math.min(n,400));im.name=`Halloween pumpkins (${k}${l} ${part})`;im.count=0;im.visible=false;im.frustumCulled=false;group.add(im);return im;}).filter(Boolean));
  return {x:b.x,z:b.z,id:b.id,mats,lv,cap:Math.min(n,400)};});
 let wait=0;
 function update(dt,player){
  if(!player||(wait-=dt)>0)return;wait=.25;
  for(const st of sets){const n=[0,0];
   for(let i=0;i<st.x.length;i++){if(hidden?.[st.id[i]])continue;const d=Math.hypot(st.x[i]-player.x,st.z[i]-player.z);let l=d<PUMPKIN_NEAR?0:d<far?1:-1;if(l<0)continue;if(!l&&n[0]>=st.cap)l=1; // a full near pool: the far model
    for(const im of st.lv[l])im.instanceMatrix.array.set(st.mats.subarray(i*16,i*16+16),n[l]*16);n[l]++;}
   st.lv.forEach((ims,l)=>{for(const im of ims){im.count=n[l];im.visible=n[l]>0;if(n[l])im.instanceMatrix.needsUpdate=true;}});}
 }
 return {group,update,counts:()=>Object.fromEntries(sets.flatMap(st=>st.lv.flat().map(im=>[im.name,im.count])))};
}
// Christmas trees at set spots where a square needs one ([x, z], open paving clear of the lanes); elsewhere a seeded
// spot within 18 m of the square's landmark. Either way the spot is kept in `anchors` (the cinematic circles it).
const TREE_SPOTS={};
function treeGeometry(){
 const parts=[colour(new THREE.CylinderGeometry(.35,.45,2.2,8).translate(0,1.1,0),'#4a3524')];
 for(let k=0;k<5;k++){const r=4.2-k*.75,h=3.4;parts.push(colour(new THREE.ConeGeometry(r,h,14).translate(0,2+k*2.1+h/2,0),k%2?'#1f4a2a':'#24522e'));}
 return mergeGeometries(parts);
}

// The city model's drawn walls at street level (buildings3d tiles, noted by main.js as each tile loads): the doorsteps
// come from the map's footprints, and the model's walls stand up to 2 m off them, so a quarter of the pumpkins stood in
// or against a shopfront. A pumpkin within PUMPKIN_CLEAR of a drawn wall is left out, on placement or when the tile
// arrives later. Segments are kept in 8 m cells: [x0,z0,x1,z1,...].
export const PUMPKIN_CLEAR=.5;const WALL_CELL=8,drawnWalls=new Map(),wallListeners=new Set(),notedTiles=new Set();
export function noteDrawnWalls(array,parts,key=null){ /* key: the tile, noted once (tiles stream out and back in) */
 if(key!=null){if(notedTiles.has(key))return 0;notedTiles.add(key);}
 let added=0;
 for(const p of parts)for(let v=p.start;v+2<p.start+p.count;v+=3){const o=v*5,ax=array[o],az=array[o+2],bx=array[o+5],bz=array[o+7],cx=array[o+10],cz=array[o+12];
  if(Math.abs((bx-ax)*(cz-az)-(bz-az)*(cx-ax))>.05||Math.min(array[o+1],array[o+6],array[o+11])>groundAt(ax,az)+1.5)continue; // walls only (upright: no area seen from above), reaching the street
  let s=[ax,az,bx,bz],l=Math.hypot(bx-ax,bz-az);for(const q of [[bx,bz,cx,cz],[cx,cz,ax,az]]){const m=Math.hypot(q[2]-q[0],q[3]-q[1]);if(m>l){l=m;s=q;}}if(l<.3)continue;
  for(let gx=Math.floor(Math.min(s[0],s[2])/WALL_CELL);gx<=Math.floor(Math.max(s[0],s[2])/WALL_CELL);gx++)for(let gz=Math.floor(Math.min(s[1],s[3])/WALL_CELL);gz<=Math.floor(Math.max(s[1],s[3])/WALL_CELL);gz++){const k=gx+','+gz;if(!drawnWalls.has(k))drawnWalls.set(k,[]);drawnWalls.get(k).push(...s);}
  added++;}
 if(added)for(const f of wallListeners)f();
 return added;
}
export function nearDrawnWall(x,z,r=PUMPKIN_CLEAR){
 for(let gx=Math.floor((x-r)/WALL_CELL);gx<=Math.floor((x+r)/WALL_CELL);gx++)for(let gz=Math.floor((z-r)/WALL_CELL);gz<=Math.floor((z+r)/WALL_CELL);gz++){const w=drawnWalls.get(gx+','+gz);if(!w)continue;
  for(let i=0;i<w.length;i+=4){const ax=w[i],az=w[i+1],dx=w[i+2]-ax,dz=w[i+3]-az,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l)):0;if(Math.hypot(x-ax-dx*t,z-az-dz*t)<r)return true;}}
 return false;
}
export function clearDrawnWalls(){drawnWalls.clear();notedTiles.clear();}
// Doorsteps: points just outside long building walls that face a pavement → [x, z, facing].
export function pumpkinDoorsteps(buildings,world,places,r,{open=(x,z)=>!world.roads.at(x,z)&&!world.buildings.at(x,z),out=.8}={}){
 const doorsteps=[],nearPlace=(x,z)=>places.some(q=>Math.abs(q.x-x)<260&&Math.abs(q.z-z)<260);
 for(const b of buildings){const ring=b.rings?.[0];if(!ring)continue;const bb=b.bbox;if(bb&&!nearPlace((bb[0]+bb[2])/2,(bb[1]+bb[3])/2))continue;
  for(let i=1;i<ring.length;i++){const [ax,az]=ring[i-1],[bx,bz]=ring[i],L=Math.hypot(bx-ax,bz-az);if(L<5)continue;
   for(let o=2+r()*4;o<L-1.5;o+=7+r()*9){const t=o/L,mx=ax+(bx-ax)*t,mz=az+(bz-az)*t,nx=(bz-az)/L,nz=-(bx-ax)/L;
    for(const sg of [1,-1]){const x=mx+nx*out*sg,z=mz+nz*out*sg;if(open(x,z)&&!world.buildings.at(x+nx*sg*1.2,z+nz*sg*1.2)){doorsteps.push([x,z,Math.atan2(nx*sg,nz*sg)]);break;}}}}}
 return doorsteps;
}
export function createSeasonalDecor(season,{buildings=[],world,places=[],cafes=[],walks=[],seed=1031,pumpkins=null,phone=false}={}){
 const group=new THREE.Group();group.name=`Seasonal decorations (${season})`;
 if(!season||!world)return {group,update(){},season:null};
 const r=rnd(seed),m4=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),s=new THREE.Vector3(1,1,1),UP=new THREE.Vector3(0,1,0);
 const solid=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7});
 const glow=hex=>new THREE.MeshBasicMaterial({color:hex,toneMapped:false,fog:true});
 const onPavement=(x,z)=>!!world.pavement?.at(x,z)&&!world.roads.at(x,z)&&!world.buildings.at(x,z),open=(x,z)=>!world.roads.at(x,z)&&!world.buildings.at(x,z); // pavement or unmapped quay/square
 const doorsteps=season==='halloween'?pumpkinDoorsteps(buildings,world,places,r,{open}):[];
 // Instanced in 200 m chunks, each hidden beyond `range` (small things far away are sub-pixel and cost the same).
 const chunks=[];
 const instanced=(geometry,material,list,name,{scale=()=>1,y=0,range=260}={})=>{if(!list.length)return null;const by=new Map();list.forEach((p,i)=>{const k=Math.floor(p[0]/200)+','+Math.floor(p[1]/200);if(!by.has(k))by.set(k,[]);by.get(k).push([p,i]);});
  for(const items of by.values()){const im=new THREE.InstancedMesh(geometry,material,items.length);im.name=name;let cx=0,cz=0;
   items.forEach(([p,i],j)=>{const sc=scale(i);im.setMatrixAt(j,m4.compose(v.set(p[0],groundAt(p[0],p[1])+(p[3]??y),p[1]),q.setFromAxisAngle(UP,p[2]||0),s.set(sc,sc,sc)));cx+=p[0];cz+=p[1];});
   im.computeBoundingSphere();group.add(im);chunks.push({im,items,x:cx/items.length,z:cz/items.length,range});}
  return true;};
 const flakes=[];let snow=null,pools=null,dispose=()=>{};const anchors={}; // where the square's tree stands (the cinematic circles Kongens Nytorv's)
 if(season==='halloween'){
  const keep=Math.min(1,2600/Math.max(1,doorsteps.length)),nyhavn=places.find(p=>p.name==='Nyhavn'),busy=(x,z)=>nyhavn&&Math.hypot(x-nyhavn.x,z-nyhavn.z)<160; // every doorstep along Nyhavn (the cinematic's Halloween drive), a share elsewhere
  const spots=[...doorsteps.filter(([x,z])=>busy(x,z)||r()<keep),...cafes.map(c=>[c[0]+(r()-.5)*.6,c[1]+(r()-.5)*.6,r()*6.28,.78])];
  const hidden=new Uint8Array(spots.length),hideWalled=()=>{let n=0;spots.forEach((p,i)=>{if(!hidden[i]&&p[3]===undefined&&nearDrawnWall(p[0],p[1])){hidden[i]=1;n++;const at=slots[i]||[];for(let k=0;k<at.length;k+=2){at[k].setMatrixAt(at[k+1],zero);at[k].instanceMatrix.needsUpdate=true;}}});return n;},slots=[],zero=new THREE.Matrix4().makeScale(0,0,0); /* slots[i]: the procedural pumpkin's [mesh, instance, ...] (shell and face) */
  // most pumpkins face the street (away from the wall); a few are turned
  for(const p of spots)if(p[3]===undefined)p[2]+=r()<.8?0:(r()-.5)*2;
  const sc=i=>(.8+((i*7919)%13)/13*.7)*(spots[i][3]===undefined?1:.6); // smaller on the café tables
  pools=pumpkins?pumpkinPools(pumpkins,spots,sc,new THREE.MeshBasicMaterial({vertexColors:true,toneMapped:false,fog:true}),phone?140:PUMPKIN_FAR,hidden):null;
  if(pools)group.add(pools.group);
  else{ // the procedural pumpkin, lit from inside: a warm glow through the shell reads from any side at night (the face alone only shows head-on)
   instanced(pumpkinGeometry(),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7,emissive:'#6a2a08',emissiveIntensity:.9}),spots,'Halloween pumpkins',{scale:sc});
   instanced(faceGeometry(),glow('#ffb238'),spots,'Pumpkin faces',{scale:sc});
   for(const c of chunks)if(c.items&&/Pumpkin|pumpkins/.test(c.im.name))c.items.forEach(([,i],j)=>(slots[i]??=[]).push(c.im,j));}
  hideWalled();wallListeners.add(hideWalled);dispose=()=>wallListeners.delete(hideWalled);
  // orange string lights over Nyhavn and the café streets: bulbs along a catenary between pavement points
  const bulbs=[];
  // strings span a street from facade to facade: both ends open ground with a wall just beyond, no house in between
  for(const pl of places.filter(p=>/Nyhavn|Gråbrødre|Kongens|Strøget|Amagertorv|Rundetårn/.test(p.name||''))){let made=0;
   for(let k=0;k<400&&made<10;k++){const a=r()*6.28,d=r()*120,x0=pl.x+Math.cos(a)*d,z0=pl.z+Math.sin(a)*d,dir=r()*6.28,dx=Math.cos(dir),dz=Math.sin(dir);
    if(!open(x0,z0)||!world.buildings.at(x0-dx*1.2,z0-dz*1.2))continue;let L=0;for(let t=1;t<22;t+=.5){const x=x0+dx*t,z=z0+dz*t;if(!open(x,z)||inWaterPolygons(world.water,x,z)){L=t;break;}}if(L<6||L>20)continue;L-=.6; // facade to facade, or facade to the quay edge (Nyhavn's promenade)
    for(let j=0;j<=14;j++){const t=j/14;bulbs.push([x0+dx*L*t,z0+dz*L*t,0,5.2-Math.sin(t*Math.PI)*.9]);}made++;}}
  instanced(new THREE.SphereGeometry(.07,6,4),glow('#ff8a1c'),bulbs,'Halloween string lights');
 }
 if(season==='christmas'){
  const squares=places.filter(p=>/Kongens Nytorv|Rådhuspladsen|Nyhavn|Amagertorv|Gråbrødre|Torvehallerne/.test(p.name||''));
  const trees=[];for(const p of squares){const set=TREE_SPOTS[p.name];if(set&&!world.buildings.at(...set)&&!world.roads.at(...set)){trees.push([set[0],set[1],r()*6.28]);anchors[p.name]=set;continue;}
   for(let k=0;k<40;k++){const a=r()*6.28,d=r()*18,x=p.x+Math.cos(a)*d,z=p.z+Math.sin(a)*d;if(onPavement(x,z)||(!world.roads.at(x,z)&&!world.buildings.at(x,z))){trees.push([x,z,r()*6.28]);anchors[p.name]=[x,z];break;}}}
  // a faint green glow keeps the cone from reading as a black silhouette at night
  instanced(treeGeometry(),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.8,emissive:'#123d20',emissiveIntensity:.35}),trees,'Christmas trees',{range:900});
  instanced(new THREE.OctahedronGeometry(.62),glow('#ffd76a'),trees.map(t=>[t[0],t[1],t[2],15.4]),'Christmas tree stars',{range:900});
  const lights=[];for(const t of trees)for(let k=0;k<200;k++){const h=2.2+r()*12.4,rad=(4.2*(1-(h-2)/13.5))*.99,a=r()*6.28;lights.push([t[0]+Math.cos(a)*rad,t[1]+Math.sin(a)*rad,0,h]);}
  instanced(new THREE.SphereGeometry(.1,6,4),glow('#ffe1a0'),lights,'Christmas tree lights',{range:900});
  // warm bulb strings across the walking streets (named pedestrian polygons), every 14 m along each street
  const strings=[],pointIn=(x,z,ring)=>{let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,zi]=ring[i],[xj,zj]=ring[j];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)c=!c;}return c;};
  for(const poly of walks){if(!/Strøget|Frederiksberggade|Nygade|Vimmelskaftet|Amagertorv|Østergade|Købmagergade|Strædet|Kronprinsensgade|Pilestræde/.test(poly.name||''))continue;const ring=poly.rings?.[0];if(!ring||ring.length<4)continue;
   let mx=0,mz=0;for(const q of ring){mx+=q[0];mz+=q[1];}mx/=ring.length;mz/=ring.length;let a=0,b=0,c=0;for(const q of ring){const x=q[0]-mx,z=q[1]-mz;a+=x*x;b+=x*z;c+=z*z;}
   const th=.5*Math.atan2(2*b,a-c),ax=Math.cos(th),az=Math.sin(th);let lo=1e9,hi=-1e9;for(const q of ring){const t=(q[0]-mx)*ax+(q[1]-mz)*az;lo=Math.min(lo,t);hi=Math.max(hi,t);}
   for(let t=lo+5;t<hi-3;t+=14){const x=mx+ax*t,z=mz+az*t;if(!pointIn(x,z,ring))continue;for(let j=-8;j<=8;j++){const u=j/8;strings.push([x-az*u*5,z+ax*u*5,0,5.6-(1-u*u)*.8]);}}}
  instanced(new THREE.SphereGeometry(.06,6,4),glow('#ffd28a'),strings.slice(0,9000),'Christmas street lights');
  // snow: a cloud of flakes that follows the player
  const N=2500,pos=new Float32Array(N*3);for(let i=0;i<N;i++){pos[i*3]=(r()-.5)*90;pos[i*3+1]=r()*30;pos[i*3+2]=(r()-.5)*90;flakes.push(.6+r()*.8);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));
  snow=new THREE.Points(g,new THREE.PointsMaterial({color:'#ffffff',size:.09,transparent:true,opacity:.85,depthWrite:false}));snow.name='Snow';snow.frustumCulled=false;group.add(snow);
 }
 let t=0;
 let cull=0;
 return {group,season,dispose,update(dt,player){t+=dt;pools?.update(dt,player);if(player&&(cull-=dt)<=0){cull=.5;for(const c of chunks)c.im.visible=Math.hypot(c.x-player.x,c.z-player.z)<c.range;}if(!snow||!player)return;const p=snow.geometry.attributes.position;snow.position.set(player.x,groundAt(player.x,player.z),player.z);
  for(let i=0;i<flakes.length;i++){let y=p.getY(i)-dt*flakes[i];if(y<0)y+=30;p.setY(i,y);p.setX(i,p.getX(i)+Math.sin(t*.7+i)*dt*.15);}p.needsUpdate=true;},anchors,pumpkins:pools,stats:{doorsteps:doorsteps.length,pumpkinModels:!!pools}};
}
