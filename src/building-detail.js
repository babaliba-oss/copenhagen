import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {isGovernmentFront,createGovernmentFront} from './government-palace.js';
import {isWaterfrontFront,createWaterfrontFront,createPalaceWingDetails,cleanWaterfrontShell} from './kauppatori-buildings.js';
import {isSugarCubeFront,createSugarCubeFront} from './sugar-cube.js';
import {provisionalWindows} from './provisional-facades.js';
import {isForumFront,createForumFront} from './forum-building.js';
import {isSokosFront,createSokosFace} from './sokos-building.js';
import {isLasipalatsiFront,createLasipalatsiFront} from './lasipalatsi-building.js';
import {isPalaceRestaurantFront,createPalaceRestaurantFront} from './palace-restaurant.js';
import {isMarketHallSide,createMarketHallSides} from './market-hall-sides.js';
import {corridorBuilding,corridorFront,createCorridorFacade,hexRGB} from './aleksanterinkatu-facades.js';
import {createFacade,facadeMaterials} from './facade-renderer.js';

 // Photo-assisted interpretation, not surveyed LOD3. Measured shells retain their
// photographic materials; physical reveals supplement them, never erase them.
export function findWindowRegions(values,width,height,step,threshold){
 const seen=new Uint8Array(values.length),regions=[];
 for(let k=0;k<values.length;k++){
  if(seen[k]||values[k]<0||values[k]>=threshold)continue;
  const queue=[k];seen[k]=1;let x0=width,y0=height,x1=0,y1=0;
  for(let n=0;n<queue.length;n++){const i=queue[n],x=i%width,y=Math.floor(i/width);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
   for(const j of [x>0?i-1:-1,x+1<width?i+1:-1,y>0?i-width:-1,y+1<height?i+width:-1])if(j>=0&&!seen[j]&&values[j]>=0&&values[j]<threshold){seen[j]=1;queue.push(j);}
  }
  const w=(x1-x0+1)*step,h=(y1-y0+1)*step,fill=queue.length/((x1-x0+1)*(y1-y0+1));
  if(w>=.45&&w<=2.7&&h>=.65&&h<=3.5&&h/w>.55&&h/w<3.7&&fill>.57&&x0>0&&y0>0&&x1<width-1&&y1<height-1)regions.push({x:x0*step,y:y0*step,w,h});
 }
 return regions;
}
export function imagePixels(image){
 const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
 const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
 return {data:ctx.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height};
}
function sample(pixels,u,v){
 if(!pixels)return [.70,.69,.64];
 const x=Math.max(0,Math.min(pixels.width-1,Math.floor(u*pixels.width))),y=Math.max(0,Math.min(pixels.height-1,Math.floor(v*pixels.height))),i=(y*pixels.width+x)*4;
 return [pixels.data[i]/255,pixels.data[i+1]/255,pixels.data[i+2]/255];
}
const luminance=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722;
function colour(samples,wall){
 if(!samples.length)return [.68,.67,.62];
 const sorted=[...samples].sort((a,b)=>luminance(a)-luminance(b));
 // Use the brighter masonry samples to avoid baking photographed shadows/windows.
 const c=sorted[Math.min(sorted.length-1,Math.floor(sorted.length*(wall?.78:.55)))];
 return c.map(v=>Math.min(.94,Math.max(wall?.23:.10,v*(wall?1.10:1.02))));
}
export function analyseBuilding(array,part,pixels){
 const faces=new Map(),roof=[],triangles=[];
 for(let i=part.start;i<part.start+part.count;i+=3){
  const v=[0,1,2].map(j=>Array.from(array.slice((i+j)*5,(i+j)*5+5))),a=new THREE.Vector3(...v[0]),b=new THREE.Vector3(...v[1]),c=new THREE.Vector3(...v[2]),n=b.clone().sub(a).cross(c.clone().sub(a));
  const area=n.length()/2;if(area<.005)continue;n.normalize();
  const triangle={v,n,area,samples:[sample(pixels,(v[0][3]+v[1][3]+v[2][3])/3,(v[0][4]+v[1][4]+v[2][4])/3)]};triangles.push(triangle);
  if(Math.abs(n.y)>.12){roof.push(triangle);continue;}
  const d=n.x*a.x+n.z*a.z,key=`${Math.round(n.x*40)},${Math.round(n.z*40)},${Math.round(d*5)}`;
  if(!faces.has(key))faces.set(key,{normal:n,triangles:[],samples:[],s0:Infinity,s1:-Infinity,y0:Infinity,y1:-Infinity,windows:[]});
  const face=faces.get(key);face.triangles.push(triangle);face.samples.push(...triangle.samples);
 }
 for(const face of faces.values()){
  const n=face.normal;face.d=n.x*face.triangles[0].v[0][0]+n.z*face.triangles[0].v[0][2];
  for(const t of face.triangles){t.local=t.v.map(v=>[v[0]*n.z-v[2]*n.x,v[1]]);for(const p of t.local){face.s0=Math.min(face.s0,p[0]);face.s1=Math.max(face.s1,p[0]);face.y0=Math.min(face.y0,p[1]);face.y1=Math.max(face.y1,p[1]);}}
  const width=face.s1-face.s0,height=face.y1-face.y0;
  // Never invent a generic window grid when the source doesn't provide evidence.
  if(pixels&&width>=2&&height>=3&&width<150&&height<85){
   const step=Math.max(.23,width/350,height/240),cols=Math.ceil(width/step),rows=Math.ceil(height/step),values=new Float32Array(cols*rows).fill(-1),colours=[];
   for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
    const s=face.s0+(x+.5)*step,h=face.y0+(y+.5)*step;
    for(const t of face.triangles){const [a,b,c]=t.local,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<.00001)continue;
     const p=((b[1]-c[1])*(s-c[0])+(c[0]-b[0])*(h-c[1]))/den,q=((c[1]-a[1])*(s-c[0])+(a[0]-c[0])*(h-c[1]))/den,r=1-p-q;
     if(p<-.001||q<-.001||r<-.001)continue;
     const rgb=sample(pixels,p*t.v[0][3]+q*t.v[1][3]+r*t.v[2][3],p*t.v[0][4]+q*t.v[1][4]+r*t.v[2][4]);values[y*cols+x]=luminance(rgb);colours.push(rgb);break;
    }
   }
   face.samples=colours.length?colours:face.samples;
   const bright=luminance(colour(face.samples,true));
   if(bright>.29)face.windows=findWindowRegions(values,cols,rows,step,Math.min(.38,bright*.57)).map(w=>({...w,x:w.x+face.s0,y:w.y+face.y0})).filter(w=>w.y>face.y0+1.6&&w.y+w.h<face.y1-.4);
  }
  face.color=colour(face.samples,true);
 }
 return {faces:[...faces.values()],roof,triangles};
}

export function createModelledBuilding(array,part,pixels,texture=null,includeHero=true){
 const analysis=analyseBuilding(array,part,pixels),walls=[],roofs=[],wallColours=[],roofColours=[],wallUV=[],roofUV=[],trim=[],glazing=[],ridges=[];
 function triangles(items,rgb,positions,colours){const color=new THREE.Color(...rgb).convertSRGBToLinear();for(const t of items)for(const v of t.v){positions.push(v[0],v[1],v[2]);colours.push(color.r,color.g,color.b);(positions===walls?wallUV:roofUV).push(v[3],v[4]);}}
 function box(face,s,y,w,h,depth,offset,target){const n=face.normal,g=new THREE.BoxGeometry(w,h,depth);g.rotateY(Math.atan2(n.x,n.z));g.translate(n.z*s+n.x*(face.d+offset),y,-n.x*s+n.z*(face.d+offset));target.push(g);}
 let windows=0,provisional=false;const authoredFaces=[];
 // Listed smeared-atlas shells: flat photo-guided colours, no pixel-inferred windows.
 const clean=cleanWaterfrontShell(part);
 // Senate Square → Mikonkatu corridor: measured shells recoloured, authored fronts.
 const corridor=corridorBuilding(part.ratu);
 // Cities built from OSM: façades described from street-level photos (facades.json).
 const described=part.facade;
 for(const f of analysis.faces){
  const front=corridor&&corridorFront(corridor,f);
  if(isSokosFront(part.ratu,f)){authoredFaces.push(...createSokosFace(f).meshes);continue;}
  if(isLasipalatsiFront(part.ratu,f))continue;
  if(isPalaceRestaurantFront(part.ratu,f))continue;
  if(isMarketHallSide(part.ratu,f))continue;
  if(part.ratu===5&&isGovernmentFront(f))continue;
  if(isWaterfrontFront(part.ratu,f))continue;
  if(isSugarCubeFront(part.ratu,f))continue;
  if(isForumFront(part.ratu,f))continue;
  if(corridor){f.windows=[];f.color=hexRGB(front?.wall||corridor.wall);}
  else if(described){f.windows=[];f.color=hexRGB(described.wall);}
  else if(clean)f.windows=[];
  else if(!pixels&&!f.windows.length&&![23,1707,324].includes(part.ratu)){
   f.windows=provisionalWindows(f);if(f.windows.length){provisional=true;f.color=[.73,.72,.67];}
  }
  // Untextured meshes from a city's official model can carry their own wall and roof colours.
  if(!pixels&&!described&&!corridor&&!clean&&part.roofColor&&part.color)f.color=part.color;
  triangles(f.triangles,clean?clean.wallRGB:part.ratu===324?[.65,.55,.47]:part.ratu===23?[.83,.8,.71]:f.color,walls,wallColours);
  for(const w of f.windows){const s=w.x+w.w/2,y=w.y+w.h/2,frame=.085;windows++;
   // Opaque glazing sits behind the raised reveal and frame, producing real depth.
   box(f,s,y,w.w,w.h,.045,.04,glazing);
   for(const x of [w.x,w.x+w.w])box(f,x,y,frame,w.h+.13,.19,.105,trim);
   for(const y of [w.y,w.y+w.h])box(f,s,y,w.w+.16,frame,.19,.105,trim);
   box(f,s,w.y-.055,w.w+.31,.12,.36,.17,trim);
   if(w.w>.8)box(f,s,y,.055,w.h,.075,.11,trim);
   if(w.h>1.5)box(f,s,w.y+w.h*.65,w.w,.055,.075,.11,trim);
  }
  // Horizontal eaves are derived from actual mesh boundary edges, not bbox spans.
  const edges=new Map();
  for(const t of f.triangles)for(let i=0;i<3;i++){const a=t.local[i],b=t.local[(i+1)%3];if(Math.abs(a[1]-b[1])>.03||Math.abs(a[0]-b[0])<1)continue;const key=[a[0],b[0]].sort((a,b)=>a-b).map(x=>x.toFixed(2)).join(':')+':'+a[1].toFixed(2);if(edges.has(key))edges.delete(key);else edges.set(key,[a,b]);}
  for(const [a,b] of edges.values())if(a[1]>f.y0+3&&!front&&!described){box(f,(a[0]+b[0])/2,a[1]-.10,Math.abs(a[0]-b[0]),.20,.28,.08,trim);}
 }
 for(const t of analysis.roof)triangles([t],!pixels&&!described&&!corridor&&!clean&&part.roofColor?(t.n.y>.25?part.roofColor:part.color):described?hexRGB(Math.abs(t.n.y)>.25?described.roof:described.wall):corridor?(t.n.y>.25?hexRGB(corridor.roof):hexRGB(corridor.wall)):clean?(t.n.y>.25?clean.roofRGB:clean.wallRGB):part.ratu===405?(t.n.y>.25?[.35,.34,.30]:[.64,.63,.59]):part.ratu===324?(t.n.y>.25?[.28,.39,.35]:[.65,.55,.47]):part.ratu===23?(t.n.y>.12&&t.v.every(v=>v[1]>6)?[.29,.34,.33]:[.83,.8,.71]):provisional&&t.n.y>.12?[.30,.34,.35]:colour(t.samples,false),roofs,roofColours);
 // Mesh-space roof seams accent the genuine pitches and ridgelines.
 const edgeMap=new Map();
 for(const t of analysis.roof)for(let i=0;i<3;i++){const a=t.v[i].slice(0,3),b=t.v[(i+1)%3].slice(0,3),key=[a.map(v=>v.toFixed(2)).join(','),b.map(v=>v.toFixed(2)).join(',')].sort().join('|');const prev=edgeMap.get(key);if(prev){if(Math.abs(prev.normal.dot(t.n))<.92)prev.ridge=true;}else edgeMap.set(key,{a,b,normal:t.n,ridge:false});}
 for(const e of edgeMap.values())if(e.ridge){const a=new THREE.Vector3(...e.a),b=new THREE.Vector3(...e.b),length=a.distanceTo(b);if(length<1||length>100)continue;const g=new THREE.CylinderGeometry(.055,.055,length,5);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),b.clone().sub(a).normalize()));g.translate(...a.add(b).multiplyScalar(.5).toArray());ridges.push(g);}
 // Chimney stacks on the ridges of the city model's pitched roofs (houses up to ~30 m): two or three per house.
 const chimneys=[];
 if(part.roofColor&&part.height<30&&part.height>6){
  const ridgesFlat=[...edgeMap.values()].filter(e=>e.ridge&&Math.abs(e.a[1]-e.b[1])<.3).map(e=>({e,l:Math.hypot(e.a[0]-e.b[0],e.a[2]-e.b[2])})).filter(r=>r.l>4).sort((a,b)=>b.l-a.l).slice(0,2);
  let k=0;for(const {e,l} of ridgesFlat)for(const f of l>14?[.22,.78]:[.5]){if(k++>=3)break;const x=e.a[0]+(e.b[0]-e.a[0])*f,y=e.a[1]+(e.b[1]-e.a[1])*f,z=e.a[2]+(e.b[2]-e.a[2])*f,yaw=Math.atan2(e.b[0]-e.a[0],e.b[2]-e.a[2]);
   const g=new THREE.BoxGeometry(.75,1.5,1.1);g.rotateY(yaw);g.translate(x,y+.45,z);chimneys.push(g);const c=new THREE.BoxGeometry(.95,.14,1.3);c.rotateY(yaw);c.translate(x,y+1.25,z);chimneys.push(c);}
 }
 const meshes=[];
 const occlusion={opacity:1,clearTime:1};
 function mesh(g,material){if(!g)return;material.transparent=true;material.forceSinglePass=true;const m=new THREE.Mesh(g,material);m.castShadow=true;m.receiveShadow=true;m.userData.occlusion=occlusion;m.userData.box=new THREE.Box3(new THREE.Vector3(part.bbox[0]-.5,0,part.bbox[1]-.5),new THREE.Vector3(part.bbox[2]+.5,part.height+.5,part.bbox[3]+.5));meshes.push(m);}
 function shell(p,c,roughness,metalness,map=texture){if(!p.length)return;const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(p===walls?wallUV:roofUV,2));g.computeVertexNormals();g.computeBoundingSphere();mesh(g,new THREE.MeshStandardMaterial({map,vertexColors:!map,roughness,metalness,side:THREE.DoubleSide}));meshes.at(-1).userData.shell=true;}
 if(part.ratu===324||clean||corridor||described)texture=null; // clean granite/copper on the measured whole station; no baked trees/shadows
 if(!texture&&walls.length&&roofs.length){ // untextured: walls and roofs in one shell mesh
  walls.push(...roofs);wallColours.push(...roofColours);wallUV.push(...roofUV);roofs.length=0;roofColours.length=0;roofUV.length=0;
  shell(walls,wallColours,.78,.06);meshes.at(-1).userData.role='facade';if(provisional)meshes.at(-1).userData.provisional=true;
 }else{
 shell(walls,wallColours,.86,.02);if(walls.length)meshes.at(-1).userData.role='facade';
 if(walls.length&&provisional)meshes.at(-1).userData.provisional=true;
 shell(roofs,roofColours,.49,.28,part.ratu===405?null:texture);if(roofs.length)meshes.at(-1).userData.role='roof';
 }
 if(includeHero)for(const m of part.ratu===410?[...createWaterfrontFront(410),...createMarketHallSides()]:part.ratu===488?createPalaceRestaurantFront():part.ratu===944?createLasipalatsiFront():part.ratu===588?createForumFront():part.ratu===1707?createSugarCubeFront():part.ratu===5?createGovernmentFront():createWaterfrontFront(part.ratu)){mesh(m.geometry,m.material);meshes.at(-1).userData.shell=true;}
 // Batch the individual Sokos elevations by material, not one draw per face.
 const authoredBatches=new Map();
 for(const m of authoredFaces){const key=[m.material.color.getHex(),m.material.roughness,m.material.metalness].join(':');
  if(!authoredBatches.has(key))authoredBatches.set(key,{material:m.material,geometries:[]});
  else m.material.dispose();
  authoredBatches.get(key).geometries.push(m.geometry);
 }
 for(const {material,geometries} of authoredBatches.values()){
  mesh(mergeGeometries(geometries),material);meshes.at(-1).userData.shell=true;meshes.at(-1).userData.sokos=true;
  geometries.forEach(g=>g.dispose());
 }
 if(part.ratu===23)for(const f of analysis.faces)for(const m of createPalaceWingDetails(f)){mesh(m.geometry,m.material);meshes.at(-1).userData.shell=true;}
 if(corridor){const r=createCorridorFacade(part,analysis.faces,corridor);for(const m of r.meshes){mesh(m.geometry,m.material);meshes.at(-1).userData.shell=true;meshes.at(-1).userData.corridor=true;}windows+=r.windows;}
 // Trim, ridge seams and chimneys share one vertex-coloured mesh; with a described front they join its relief,
 // and the generated window glazing joins its glass (three draw calls per building instead of six).
 const tint=(list,hex)=>{const c=new THREE.Color(hex);return list.map(g0=>{const g=g0.index?g0.toNonIndexed():g0;if(g!==g0)g0.dispose();const n=g.attributes.position.count,a=new Float32Array(n*3);for(let i=0;i<n;i++)a.set([c.r,c.g,c.b],i*3);g.setAttribute('color',new THREE.BufferAttribute(a,3));if(g.attributes.uv)g.deleteAttribute('uv');return g;});};
 let plain=[...tint(trim,part.ratu===324?'#927e60':'#d6d1c4'),...tint(ridges,'#606869'),...tint(chimneys,'#8b4b3c')];
 let glass=tint(glazing,'#263e4d');
 if(described){const r=createFacade(analysis.faces,described),m=facadeMaterials();windows+=r.windows;
  const relief=r.relief?mergeGeometries([r.relief,...plain]):(plain.length?mergeGeometries(plain):null);if(r.relief)r.relief.dispose();plain.forEach(g=>g.dispose());plain=[];
  const glassAll=r.glass?mergeGeometries([r.glass,...glass]):(glass.length?mergeGeometries(glass):null);if(r.glass)r.glass.dispose();glass.forEach(g=>g.dispose());glass=[];
  for(const [g,mat] of [[glassAll,m.glass],[relief,m.relief]])if(g){g.computeBoundingSphere();mesh(g,mat);meshes.at(-1).userData.provisional=true;meshes.at(-1).userData.role='facade-detail';}else mat.dispose();
 }
 if(plain.length){mesh(mergeGeometries(plain),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.72,metalness:.12}));plain.forEach(g=>g.dispose());}
 if(glass.length){mesh(mergeGeometries(glass),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.19,metalness:.55}));glass.forEach(g=>g.dispose());}
 // Keep the inexpensive interim window batches at follow-camera distance;
 // otherwise a building becomes a blank block again beyond the detail radius.
 if(provisional)for(const m of meshes)if(!m.userData.shell)m.userData.provisional=true;
 return {meshes,windows,walls:analysis.faces.length};
}
