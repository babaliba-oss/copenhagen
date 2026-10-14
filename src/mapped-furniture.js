import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {createBreakableSigns} from './breakable-signs.js';
import {createKnockables} from './knockables.js';
import {signalGreen} from './mobility.js';
import {groundAt} from './terrain.js';
import {WEATHER_UNIFORMS} from './weather.js';
import {signFace,drawSignFace,PLATE_SIZE} from './sign-faces.js';

// Street furniture placed from a city's furniture.json (built by scripts/mapillary-features.mjs from
// detections in street-level photos, merged with official sign, signal and stop registers by
// scripts/digiroad-signs.mjs): lamp posts, traffic lights, sign posts and utility poles bend or snap
// when hit (breakable-signs.js); bins, barriers and cones are knocked over (knockables.js); junction
// boxes, benches, bike racks, hydrants and stop shelters are solid. Works for any city that ships the file.
// Posts are merged per 250 m chunk (two draw calls each: painted parts and sign plates) and chunks beyond
// view range are not drawn; everything else is one InstancedMesh per kind.
export const CHUNK=250,VIEW_RANGE=380,SIGNAL_RANGE=350;
export const POSTS={
 lamp:{height:8.4,radius:.09,strength:2.6},
 'traffic-light':{height:3.45,radius:.085,strength:1.8},
 'crossing-light':{height:2.9,radius:.075,strength:1.6},
 sign:{height:3,radius:.04,strength:1},
 pole:{height:8.5,radius:.14,strength:3.2},
 'steel-pole':{height:4.2,radius:.06,strength:2}, // Copenhagen: a plain galvanised post (photo 'poles' there are not timber utility poles)
 'parking-meter':{height:1.55,radius:.1,strength:1.3},
 'mast-lamp':{height:5.6,radius:.075,strength:2.2}, // Copenhagen conical graphite mast with a top lantern (register: 5–6 m)
 'park-lamp':{height:3.2,radius:.06,strength:1.4}, // short park lantern with stacked shades
 lantern:{height:3.1,radius:.07,strength:1.2}, // 1760 oil lantern on a wooden post
};
export const SOLIDS={bollard:[.22,.22,.95],'junction-box':[.85,.42,1.3],bench:[1.8,.6,.85],'bike-rack':[2.4,.55,.4],hydrant:[.36,.36,.8],shelter:[3.6,1.5,2.5]}; // width, depth, height
// A stable id per object: Mapillary feature id, else its source and place in the file.
const itemId=(it,i)=>`mapped-${it.k}-${it.mly?.[0]??`${it.src||'item'}-${i}`}`;
export const KNOCKABLE={bin:{radius:.26},barrier:{radius:.35},cone:{radius:.2}};

// Plates on one sign post: grouped by facing, each group stacked down from the top, complementary plates last.
export function plateLayout(faces,yaws,top=2.95,gap=.07){
 const groups=[],out=[];
 faces.forEach((face,i)=>{const yaw=yaws?.[i]??0,g=groups.find(g=>Math.abs(Math.atan2(Math.sin(g.yaw-yaw),Math.cos(g.yaw-yaw)))<1.05);if(g)g.faces.push(face);else groups.push({yaw,faces:[face]});});
 for(const g of groups){let y=top;for(const face of g.faces){const [w,h]=PLATE_SIZE[signFace(face.code??face).shape]||[.64,.64];out.push({face:face.face??face,yaw:g.yaw,y:y-h/2,width:w,height:h});y-=h+gap;}}
 return out;
}

// Vertex-coloured, non-indexed geometry so every painted part merges into one mesh.
function paint(g,hex){
 if(g.index){const o=g;g=o.toNonIndexed();o.dispose();}g.deleteAttribute('uv');
 const c=new THREE.Color(hex),n=g.attributes.position.count,a=new Float32Array(n*3);for(let i=0;i<n;i++)a.set([c.r,c.g,c.b],i*3);
 g.setAttribute('color',new THREE.BufferAttribute(a,3));return g;
}
const cyl=(r0,r1,h,y,hex,seg=7)=>paint(new THREE.CylinderGeometry(r0,r1,h,seg).translate(0,y,0),hex);
const box=(w,h,d,x,y,z,hex)=>paint(new THREE.BoxGeometry(w,h,d).translate(x,y,z),hex);
const METAL='#7d8689',DARK='#1d2629',WOOD='#5c4a3a';

// Post templates in local space: base at the origin, facing +Z (lamp arms reach towards +Z, over the road).
function postParts(kind){
 if(kind==='lamp')return [cyl(.055,.1,8.4,4.2,METAL),box(.07,.07,1.5,0,8.3,.72,METAL),box(.26,.1,.6,0,8.27,1.5,'#3a4245'),box(.2,.02,.5,0,8.21,1.5,'#f2efe0')];
 if(kind==='traffic-light')return [cyl(.065,.085,3.4,1.7,'#566166',6),box(.27,.8,.23,0,3.1,.05,DARK)];
 if(kind==='crossing-light')return [cyl(.06,.075,2.85,1.42,'#566166',6),box(.25,.56,.2,0,2.5,.05,DARK)];
 if(kind==='steel-pole')return [cyl(.05,.06,4.2,2.1,'#8b9496',7),cyl(.06,.06,.05,4.22,'#5d6567',7)];
 if(kind==='pole')return [cyl(.11,.14,8.5,4.25,WOOD),box(1.4,.08,.08,0,7.9,0,WOOD)];
 if(kind==='mast-lamp')return [cyl(.04,.075,5.4,2.7,'#3b3f42',8),cyl(.05,.05,.12,5.42,'#2c3033',8),cyl(.12,.24,.34,5.62,'#2c3033',10),cyl(.2,.2,.04,5.44,'#fff3d6',10)];
 if(kind==='park-lamp')return [cyl(.045,.06,2.8,1.4,'#3b3f42',8),cyl(.08,.22,.12,2.9,'#e9e6dc',12),cyl(.1,.28,.12,3.02,'#e9e6dc',12),cyl(.04,.12,.1,3.14,'#e9e6dc',12),cyl(.16,.16,.03,2.86,'#fff3d6',10)];
 if(kind==='lantern')return [cyl(.06,.08,2.6,1.3,'#3b2e22',6),box(.08,.08,.5,0,2.5,.22,'#2a221a'),box(.32,.42,.32,0,2.62,.42,'#1d1a17'),box(.26,.32,.26,0,2.62,.42,'#f6dca0'),cyl(.02,.22,.16,0,2.91,.42,'#1d1a17',4)];
 if(kind==='parking-meter')return [cyl(.04,.045,1.1,.55,'#4a5255'),box(.24,.38,.2,0,1.3,0,'#2b5d8f')];
 return [];
}
// One wire lamp: wire points (pairs for LineSegments) rising from the shade to anchors a and b metres either
// side, plus pole positions where no wall was in reach. The shade itself is instanced.
const WIRE_LOW=7.1;
function wireLines(it,out,poles,{poleAllowed=()=>true,wallAt=null}={}){
 const yaw=it.yaw||0,gy=groundAt(it.x,it.z),c=Math.cos(yaw),s=Math.sin(yaw);let drawn=0;
 for(let [len,dir,pole] of [[it.a||7,1,it.pa],[it.b||7,-1,it.pb]]){
  // Every wire must end on something: a wall (searched a few metres either side of the mapped anchor) or a
  // pole that is allowed where it stands (moved back toward the lamp if the mapped spot is in a lane).
  // Wires that ended in mid-air, where a pole was dropped from a lane or no wall stood, read as cut lines.
  const at=d=>[it.x+s*dir*d,it.z+c*dir*d];
  if(!pole&&wallAt){let hit=0;for(let d=Math.max(1.5,len-3);d<=len+6;d+=.5)if(wallAt(...at(d))){hit=d;break;}if(hit)len=hit;else pole=true;}
  if(pole&&!poleAllowed(...at(len))){let ok=0;for(let d=len-.5;d>=2;d-=.5)if(poleAllowed(...at(d))){ok=d;break;}if(!ok)continue;len=ok;}
  // several wires ending together share one pole: snap to a pole already standing within 3 m
  let [ex,ez]=at(len);if(pole){const g=poles.grid??=new Map(),gx=Math.floor(ex/3),gz=Math.floor(ez/3);let near=null;for(let i=-1;i<=1&&!near;i++)for(let j=-1;j<=1&&!near;j++)near=(g.get((gx+i)+','+(gz+j))||[]).find(p=>Math.hypot(p[0]-ex,p[1]-ez)<3)||null;
   if(near)[ex,ez]=near;else{const p=[ex,ez];poles.push(p);const k=gx+','+gz;if(!g.has(k))g.set(k,[]);g.get(k).push(p);}}
  const top=pole?8.2:8.9,steps=4;let px=it.x,pz=it.z,py=gy+WIRE_LOW+.55;
  for(let k=1;k<=steps;k++){const t=k/steps,x=it.x+(ex-it.x)*t,z=it.z+(ez-it.z)*t,y=gy+WIRE_LOW+.55+(top-WIRE_LOW-.55)*Math.pow(t,1.6);out.push(px,py,pz,x,y,z);px=x;py=y;pz=z;}
  drawn++;
 }
 return drawn;
}
const LENSES={'traffic-light':[[3.35,'red'],[3.1,'amber'],[2.85,'green']],'crossing-light':[[2.62,'red'],[2.38,'green']]};
const LENS_ON={red:'#ff392b',amber:'#ffb43a',green:'#47ec9b'},LENS_OFF={red:'#382927',amber:'#3a3322',green:'#233a32'};

// Sign atlas: every face used by the city, front and a grey back silhouette, drawn once on a canvas.
function signAtlas(faces,cell=128){
 const cols=16,rows=Math.max(1,Math.ceil(faces.length*2/cols)),canvas=document.createElement('canvas');canvas.width=cols*cell;canvas.height=rows*cell;
 const c=canvas.getContext('2d'),uv=new Map();
 faces.forEach(({face,code},i)=>{
  const spec=signFace(code||face);
  for(const back of [0,1]){const k=i*2+back,x=(k%cols)*cell,y=Math.floor(k/cols)*cell;
   c.save();c.beginPath();c.rect(x,y,cell,cell);c.clip();drawSignFace(c,spec,x+2,y+2,cell-4,cell-4);
   if(back){c.globalCompositeOperation='source-atop';c.fillStyle='#8f989b';c.fillRect(x,y,cell,cell);}c.restore();
   uv.set(`${face}:${back}`,[x/canvas.width,1-(y+cell)/canvas.height,cell/canvas.width,cell/canvas.height]);}
 });
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
 return {texture,uv};
}
function plateGeometry(size,rect){
 const g=new THREE.PlaneGeometry(size,size),uv=g.attributes.uv;
 for(let i=0;i<uv.count;i++)uv.setXY(i,rect[0]+uv.getX(i)*rect[2],rect[1]+uv.getY(i)*rect[3]);
 g.deleteAttribute('normal');g.computeVertexNormals();return g.toNonIndexed();
}

export function createMappedFurniture(layer,{player=()=>null,mobility=()=>null,canvas=globalThis.document,poleAllowed=()=>true,wallAt=null,rackBikes=null}={}){
 const group=new THREE.Group();group.name='Mapped street furniture';
 const items=layer?.items||[],obstacles=[],chunks=new Map(),lights=[];
 const painted=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.6,metalness:.2});
 const atlas=canvas&&layer.faces?.length?signAtlas(layer.faces):null;layer.faces??=[];
 const plates=new THREE.MeshStandardMaterial({map:atlas?.texture||null,alphaTest:.5,roughness:.55,side:THREE.FrontSide});
 const templates=new Map(),m4=new THREE.Matrix4(),q=new THREE.Quaternion(),UP=new THREE.Vector3(0,1,0),one=new THREE.Vector3(1,1,1),zero=new THREE.Vector3(),v=new THREE.Vector3();
 const chunkOf=(x,z)=>{const key=`${Math.floor(x/CHUNK)},${Math.floor(z/CHUNK)}`;
  if(!chunks.has(key)){const signs=createBreakableSigns(`Mapped furniture posts ${key}`),g=new THREE.Group();g.name='Mapped furniture chunk';group.add(g);
   chunks.set(key,{key,group:g,signs,painted:[],plates:[],centre:[(Math.floor(x/CHUNK)+.5)*CHUNK,(Math.floor(z/CHUNK)+.5)*CHUNK]});}
  return chunks.get(key);};
 const place=(geometry,x,z,yaw,chunk,i,list)=>{geometry.applyMatrix4(m4.compose(v.set(x,groundAt(x,z),z),q.setFromAxisAngle(UP,yaw),one));chunk.signs.tag(geometry,i);list.push(geometry);};

 // Instanced items split into the post chunks, so they are hidden with them beyond view range.
 function chunkedInstances(list,geometry,material,name,pose,{shadow=true}={}){
  const by=new Map();for(const it of list){const [x,z]=pose(it);const c=chunkOf(x,z);if(!by.has(c))by.set(c,[]);by.get(c).push(it);}
  for(const [c,its] of by){const mesh=new THREE.InstancedMesh(geometry,material,its.length);mesh.name=name;mesh.castShadow=shadow;mesh.receiveShadow=true;
   its.forEach((it,i)=>{const [x,z,yaw]=pose(it);mesh.setMatrixAt(i,m4.compose(v.set(x,groundAt(x,z),z),q.setFromAxisAngle(UP,yaw||0),one));});mesh.computeBoundingSphere();c.group.add(mesh);}
 }
 // Breakable posts.
 items.forEach((it,index)=>{const spec=POSTS[it.k];if(!spec)return;
  const chunk=chunkOf(it.x,it.z),yaw=it.yaw||0;let height=spec.height;
  const layout=it.k==='sign'?plateLayout((it.faces||[]).map(face=>({face,code:layer.faces.find(f=>f.face===face)?.code})),it.yaws):[];
  if(layout.length)height=Math.max(...layout.map(p=>p.y+p.height/2))+.05;
  const i=chunk.signs.post({id:itemId(it,index),x:it.x,z:it.z,y:groundAt(it.x,it.z),yaw,height,radius:spec.radius,strength:spec.strength});
  if(it.k==='sign')place(cyl(.031,.031,height,height/2,'#929b9d',6),it.x,it.z,0,chunk,i,chunk.painted);
  else{if(!templates.has(it.k))templates.set(it.k,mergeGeometries(postParts(it.k)));place(templates.get(it.k).clone(),it.x,it.z,yaw,chunk,i,chunk.painted);}
  for(const p of layout){const rect=atlas?.uv.get(`${p.face}:0`),back=atlas?.uv.get(`${p.face}:1`);if(!rect)continue;const size=Math.max(p.width,p.height);
   const front=plateGeometry(size,rect);front.translate(0,p.y,.045);place(front,it.x,it.z,p.yaw,chunk,i,chunk.plates);
   const rear=plateGeometry(size,back);rear.rotateY(Math.PI);rear.translate(0,p.y,.035);place(rear,it.x,it.z,p.yaw,chunk,i,chunk.plates);}
  if(LENSES[it.k])lights.push({x:it.x,z:it.z,yaw,kind:it.k,post:chunk.signs.bodies[i],edge:undefined});
 });
 // Wire-hung lamps: the Copenhagen street light, a dark shade on a steel wire strung between facades
 // (register span to the nearest wall on each side; a slim pole where no wall is in reach).
 const wireLamps=items.filter(it=>it.k==='wire-lamp'),wirePoles=[];
 if(wireLamps.length){
  {const hung=[];for(const it of wireLamps){const chunk=chunkOf(it.x,it.z);if(wireLines(it,chunk.wires??=[],wirePoles,{poleAllowed,wallAt}))hung.push(it);}wireLamps.length=0;wireLamps.push(...hung);} // a shade with no wire is left out
  const shade=mergeGeometries([cyl(.012,.012,.5,WIRE_LOW+.3,'#24282a',4),cyl(.06,.06,.1,WIRE_LOW+.5,'#2c3033',8),cyl(.09,.42,.24,WIRE_LOW+.32,'#2c3033',8),cyl(.3,.3,.03,WIRE_LOW+.19,'#fff3d6',8)]);
  chunkedInstances(wireLamps,shade,painted,'Wire lamp shades',it=>[it.x,it.z,it.yaw],{shadow:false});
  // Poles are already allowed where they stand and shared by wires ending within 3 m (wireLines snaps them).
  if(wirePoles.length){chunkedInstances(wirePoles,mergeGeometries([cyl(.06,.09,8.2,4.1,'#3b3f42',7)]),painted,'Wire poles',p=>[p[0],p[1],0]);
   wirePoles.forEach(([x,z],i)=>obstacles.push({id:`wire-pole-${i}`,name:'pole',rings:[[[x-.1,z-.1],[x+.1,z-.1],[x+.1,z+.1],[x-.1,z+.1]]],bbox:[x-.1,z-.1,x+.1,z+.1]}));}
 }
 const wireMaterial=new THREE.LineBasicMaterial({color:'#1f2325'});
 for(const chunk of chunks.values()){
  if(chunk.wires?.length){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(chunk.wires,3));const m=new THREE.LineSegments(g,wireMaterial);m.name='Lamp wires';chunk.group.add(m);chunk.wires=null;}
  if(chunk.painted.length){const m=chunk.signs.mesh(mergeGeometries(chunk.painted),painted);m.name='Mapped furniture posts';chunk.group.add(m);}
  if(chunk.plates.length){const m=chunk.signs.mesh(mergeGeometries(chunk.plates),plates,{castShadow:false});m.name='Mapped sign plates';chunk.group.add(m);}
  [...chunk.painted,...chunk.plates].forEach(g=>g.dispose());chunk.painted=chunk.plates=null;
  chunk.group.add(chunk.signs.finish());
 }
 for(const g of templates.values())g.dispose();

 // Signal lenses: one instanced disc per lens, lit from the nearest signalled approach the head faces.
 const lensCount=lights.reduce((n,l)=>n+LENSES[l.kind].length,0);let lenses=null;
 if(lensCount){
  const g=new THREE.CircleGeometry(.08,10);lenses=new THREE.InstancedMesh(g,new THREE.MeshBasicMaterial(),lensCount);lenses.name='Mapped signal lenses';lenses.frustumCulled=false;group.add(lenses);
  let k=0;for(const l of lights){l.lens=k;l.shown=false;k+=LENSES[l.kind].length;}
  m4.makeScale(0,0,0);for(let i=0;i<lensCount;i++)lenses.setMatrixAt(i,m4);
 }
 let signalGrid=null;
 function signalEdge(l,roads){
  // The head faces oncoming traffic: the approach that ends near it and travels towards its face.
  const fx=Math.sin(l.yaw),fz=Math.cos(l.yaw);let best=null,score=Infinity;
  // approaches indexed by their end point (40 m cells), rebuilt when streaming adds edges: scanning every
  // edge in the city per light made a long frame whenever a district's lights came into range together
  if(!signalGrid||signalGrid.count!==roads.edges.length){const g=new Map();roads.edges.forEach((e,i)=>{if(e.signal<0||e.points.length<2)return;const b=e.points.at(-1),k=Math.floor(b[0]/40)+','+Math.floor(b[1]/40);let list=g.get(k);if(!list)g.set(k,list=[]);list.push([i,e]);});signalGrid={count:roads.edges.length,g};}
  const near=[],gx=Math.floor(l.x/40),gz=Math.floor(l.z/40);for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const item of signalGrid.g.get((gx+i)+','+(gz+j))||[])near.push(item);
  near.sort((a,b)=>a[0]-b[0]); // edge order, so ties resolve as in a full scan
  for(const [,e] of near){if(e.signal<0||e.points.length<2)continue;const a=e.points.at(-2),b=e.points.at(-1),d=Math.hypot(b[0]-l.x,b[1]-l.z);if(d>35)continue;
   const len=Math.hypot(b[0]-a[0],b[1]-a[1])||1,facing=((b[0]-a[0])*fx+(b[1]-a[1])*fz)/len,s=d+12*(1+facing);if(s<score){score=s;best=e;}}
  return best;
 }
 const colour=new THREE.Color();
 function updateLenses(p){
  if(!lenses)return;const sim=mobility();let moved=false,coloured=false;
  for(const l of lights){
   const show=!!p&&l.post.state==='upright'&&Math.abs(l.x-p.x)<SIGNAL_RANGE&&Math.abs(l.z-p.z)<SIGNAL_RANGE;
   if(show!==l.shown){l.shown=show;moved=true;
    LENSES[l.kind].forEach(([y],j)=>{m4.compose(v.set(l.x+Math.sin(l.yaw)*.18,y+groundAt(l.x,l.z),l.z+Math.cos(l.yaw)*.18),q.setFromAxisAngle(UP,l.yaw),show?one:zero);lenses.setMatrixAt(l.lens+j,m4);});}
   if(!show)continue;
   if(l.edge===undefined&&sim?.roads)l.edge=signalEdge(l,sim.roads);
   // Vehicle heads show the approach's phase; pedestrian heads show the opposite.
   const green=l.edge&&sim?signalGreen(l.edge,sim.time):null,go=l.kind==='crossing-light'&&green!==null?!green:green;
   LENSES[l.kind].forEach(([,c],j)=>{lenses.setColorAt(l.lens+j,colour.set((c==='red'&&go===false)||(c==='green'&&go===true)||(c==='amber'&&go===null)?LENS_ON[c]:LENS_OFF[c]));});coloured=true;
  }
  if(moved)lenses.instanceMatrix.needsUpdate=true;if(coloured&&lenses.instanceColor)lenses.instanceColor.needsUpdate=true;
 }

 // Knockable light items and solid boxes.
 const knock=[];
 const binParts=()=>[cyl(.028,.028,.55,.275,'#5b615f',6),cyl(.215,.2,.68,.86,'#3a4541',10),cyl(.23,.215,.06,1.22,'#2f3836',10)];
 const barrierParts=()=>[box(1.2,.05,.4,0,.03,0,'#2b2f30'),box(.05,1,.05,-.55,.5,0,'#c9ccc8'),box(.05,1,.05,.55,.5,0,'#c9ccc8'),box(1.2,.2,.03,0,.85,0,'#df4732'),box(1.2,.2,.03,0,.55,0,'#f5f5ef')];
 const coneParts=()=>[box(.34,.04,.34,0,.02,0,'#1d2022'),cyl(.03,.15,.68,.36,'#f06a2a',10),cyl(.075,.105,.12,.42,'#f5f5ef',10)];
 for(const [kind,parts] of [['bin',binParts],['barrier',barrierParts],['cone',coneParts]]){
  const list=items.filter(i=>i.k===kind);if(!list.length)continue;
  const g=mergeGeometries(parts());g.computeVertexNormals();
  const k=createKnockables(list.map((it,i)=>({id:itemId(it,i),x:it.x,z:it.z,yaw:it.yaw||0})),[{geometry:g,material:painted}],KNOCKABLE[kind]);
  k.group.name=`Mapped ${kind}s`;group.add(k.group);knock.push(k);
 }
 const solidParts={bollard:([w,,h])=>[cyl(w*.45,w*.5,h,h/2,'#2f3436',8),cyl(w*.5,w*.5,.08,h*.82,'#c9a64a',8),cyl(w*.38,w*.45,.06,h+.03,'#2f3436',8)],'junction-box':([w,d,h])=>[box(w,h,d,0,h/2,0,'#8a9086'),box(w+.04,.05,d+.04,0,h+.02,0,'#6d736a')],
  bench:([w,d,h])=>[box(w,.06,.42,0,.45,.05,'#7a5a3e'),box(w,.4,.05,0,.75,-.18,'#7a5a3e'),box(.06,.45,.45,-w/2+.12,.22,0,'#2d3133'),box(.06,.45,.45,w/2-.12,.22,0,'#2d3133')],
  'bike-rack':([w,d,h])=>[box(w,.025,.025,0,.07,-.12,'#4c5356'),box(w,.025,.025,0,.07,.12,'#4c5356'),box(w-.3,.022,.022,0,.33,0,'#4c5356'),...[-.9,-.3,.3,.9].map(x=>box(.025,.3,.26,x,.2,0,'#4c5356'))], // Copenhagen ground rack: low wheel-slot rail (it reads as a fence when tall and empty)
  hydrant:([w,,h])=>[cyl(w*.4,w*.45,h,h/2,'#b8322a',8),cyl(w*.5,w*.5,.08,h,'#b8322a',8)],
  // Stop shelter, open towards the road (+Z): steel frame, roof, back and side glass, a bench and an advert panel at one end.
  shelter:([w,d,h])=>[...[-w/2+.05,w/2-.05].flatMap(x=>[box(.08,h,.08,x,h/2,-d/2+.06,'#3e4a4f'),box(.08,h,.08,x,h/2,d/2-.12,'#3e4a4f')]),box(w+.2,.12,d+.25,0,h+.06,0,'#4a565b'),
   box(w-.1,h-.35,.03,0,h/2+.1,-d/2+.06,'#a9c4cb'),box(.03,h-.35,d*.55,-w/2+.05,h/2+.1,-d*.2,'#a9c4cb'),box(.05,1.75,d*.62,w/2-.05,1.15,-d*.18,'#d8d3c4'),box(1.5,.06,.38,-.3,.47,-d/2+.3,'#5c4a3a'),box(.06,.45,.3,-.95,.23,-d/2+.3,'#2d3133'),box(.06,.45,.3,.35,.23,-d/2+.3,'#2d3133')]};
 // Bicycles standing in the racks (Copenhagen racks are rarely empty): a low-poly bike, two per occupied rack.
 {const racks=items.filter(i=>i.k==='bike-rack');if(racks.length){
  const T=(r,x,z,c)=>{const g=new THREE.TorusGeometry(r,.025,3,8);g.rotateY(Math.PI/2);g.translate(x,r,z);return paint(g,c);};
  const bar=(a,b,c,r=.02)=>{const A=new THREE.Vector3(...a),B=new THREE.Vector3(...b),d=B.clone().sub(A),g=new THREE.CylinderGeometry(r,r,d.length(),4);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize()));g.translate((A.x+B.x)/2,(A.y+B.y)/2,(A.z+B.z)/2);return paint(g,c);};
  const bikes=rackBikes?.length?rackBikes:['#1d1f22','#2d4f7a','#7a2a20','#3f5d45','#c9c4b8'].map(c=>mergeGeometries([T(.33,0,-.55,'#1a1a1a'),T(.33,0,.55,'#1a1a1a'),bar([0,.36,.55],[0,.82,.22],c),bar([0,.36,.55],[0,.38,.05],c),bar([0,.82,.22],[0,.38,.05],c),bar([0,.38,.05],[0,.92,-.42],c),bar([0,.82,.22],[0,.92,-.42],c),bar([0,.92,-.42],[0,.36,-.55],c),bar([-.26,1.05,-.45],[.26,1.05,-.45],'#2a2a2a'),bar([0,.92,-.42],[0,1.05,-.45],'#555'),paint(new THREE.BoxGeometry(.12,.05,.26).translate(0,.92,.24),'#222')]));
  const lists=bikes.map(()=>[]);let n=0;
  racks.forEach((it,i)=>{if((i*7919)%10<1)return;const c=Math.cos(it.yaw||0),sn=Math.sin(it.yaw||0);const slots=[-.9,-.3,.3,.9].filter((_,j)=>((i*13+j*7)%9)>2||j===1);for(const off of slots){const k=(i*31+n++)%bikes.length;lists[k].push([it.x+c*off,it.z-sn*off,(it.yaw||0)+(off>0?Math.PI:0)+((i%3)-1)*.06]);}});
  lists.forEach((l,k)=>{if(l.length)chunkedInstances(l,bikes[k],painted,'Parked bicycles',b=>b,{shadow:false});});
 }}
 for(const [kind,size] of Object.entries(SOLIDS)){
  const list=items.filter(i=>i.k===kind);if(!list.length)continue;
  const g=mergeGeometries(solidParts[kind](size));g.computeVertexNormals();
  chunkedInstances(list,g,painted,`Mapped ${kind}`,it=>[it.x,it.z,it.yaw]);
  list.forEach((it,i)=>{const yaw=it.yaw||0;
   const [w,d]=size,c=Math.cos(yaw),s=Math.sin(yaw),ring=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([a,b])=>[it.x+a*c+b*s,it.z-a*s+b*c]);
   obstacles.push({id:itemId(it,i),name:kind,rings:[ring],bbox:[Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))]});});
 }

 // Lamp light after dark (weather.js night look): a bright head that blooms and a warm pool on the ground.
 const HEAD={lantern:[0,2.62,.42],lamp:[0,8.2,1.5],'mast-lamp':[0,5.42,0],'park-lamp':[0,2.85,0],'wire-lamp':[0,7.28,0]};
 const hungLamps=new Set(wireLamps),heads=items.filter(it=>HEAD[it.k]&&(it.k!=='wire-lamp'||hungLamps.has(it))).map(it=>{const [hx,hy,hz]=HEAD[it.k],yaw=it.yaw||0,x=it.x+Math.sin(yaw)*hz,z=it.z+Math.cos(yaw)*hz;return {x,z,y:groundAt(it.x,it.z)+hy,k:it.k};});
 // Chunked (300 m) so only lights near the player are drawn after dark.
 const lightChunks=[];let glowMat=null,poolMat=null;
 if(heads.length){
  glowMat=new THREE.MeshBasicMaterial({color:'#ffd9a3',toneMapped:false,fog:false});
  const c=typeof document!=='undefined'?document.createElement('canvas'):null,g=c?.getContext('2d');if(c){c.width=c.height=64;}const grad=g&&g.createRadialGradient(32,32,0,32,32,32);
  if(grad){grad.addColorStop(0,'rgba(255,255,255,1)');grad.addColorStop(.25,'rgba(255,255,255,.6)');grad.addColorStop(.6,'rgba(255,255,255,.18)');grad.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=grad;g.fillRect(0,0,64,64);}
  poolMat=new THREE.MeshBasicMaterial({color:'#ffc98a',fog:true,alphaMap:c?new THREE.CanvasTexture(c):null,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,polygonOffset:true,polygonOffsetFactor:-4,opacity:0});
  const sphere=new THREE.SphereGeometry(.2,8,6),plane=new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2);
  const R={lantern:4,lamp:12,'mast-lamp':9,'park-lamp':5.5,'wire-lamp':10},sc=new THREE.Vector3(),by=new Map();
  for(const h of heads){const k=`${Math.floor(h.x/300)},${Math.floor(h.z/300)}`;if(!by.has(k))by.set(k,[]);by.get(k).push(h);}
  for(const list of by.values()){
   const glow=new THREE.InstancedMesh(sphere,glowMat,list.length),pools=new THREE.InstancedMesh(plane,poolMat,list.length);glow.name='Lamp heads lit';pools.name='Lamp light pools';pools.renderOrder=2;
   let cx=0,cz=0;list.forEach((h,i)=>{glow.setMatrixAt(i,m4.compose(v.set(h.x,h.y,h.z),q.identity(),h.k==='park-lamp'?sc.set(.8,.8,.8):one));const r=R[h.k];pools.setMatrixAt(i,m4.compose(v.set(h.x,groundAt(h.x,h.z)+.32,h.z),q.identity(),sc.set(r,1,r)));cx+=h.x;cz+=h.z;});
   glow.computeBoundingSphere();pools.computeBoundingSphere();glow.visible=pools.visible=false;group.add(glow,pools);lightChunks.push({glow,pools,x:cx/list.length,z:cz/list.length});
  }
 }
 let litShown=-1,litOn=false;
 function updateLights(p){
  const n=WEATHER_UNIFORMS.night.value;if(!glowMat)return;
  if(Math.abs(n-litShown)>=.01){litShown=n;litOn=n>.03;glowMat.color.setRGB(2.6*n+.2,2.0*n+.17,1.25*n+.12);poolMat.opacity=.2*n;}
  for(const c of lightChunks){const on=litOn&&(!p||Math.hypot(c.x-p.x,c.z-p.z)<650);c.glow.visible=c.pools.visible=on;}
 }
 // Distance culling for post chunks; lenses follow the player.
 function update(){
  const p=player();updateLights(p);if(!p)return;
  for(const c of chunks.values()){const d=Math.hypot(c.centre[0]-p.x,c.centre[1]-p.z);c.group.visible=d<VIEW_RANGE+CHUNK*.71;
   if(c.group.visible)for(const m of c.group.children)if(m.name==='Parked bicycles')m.visible=d<100+CHUNK*.71;} // small and many: bikes stop at a shorter range
  updateLenses(p);
 }
 const counts={};for(const it of items)counts[it.k]=(counts[it.k]||0)+1;
 group.userData={source:layer?.source,licence:layer?.licence,counts,chunks:chunks.size,lights:lights.length};
 // Knockables-compatible: main.js steps and updates it with the rest (posts step through breakableSigns).
 const knockables={get bodies(){return knock.flatMap(k=>k.bodies);},step(dt,car,world){for(const k of knock)k.step(dt,car,world);},update(){for(const k of knock)k.update();update();},
  resetAll(){for(const k of knock)k.resetAll();}, // posts reset with every other breakable sign set
  snapshot(){const s=knock.map(k=>k.snapshot()),posts=[...chunks.values()].map(c=>c.signs.snapshot()),sum=(l,k)=>l.reduce((n,x)=>n+x[k],0);
   return {count:sum(s,'count'),knocked:sum(s,'knocked'),hits:sum(s,'hits'),posts:{count:sum(posts,'count'),knocked:sum(posts,'knocked'),bent:sum(posts,'bent'),broken:sum(posts,'broken')}};}};
 return {group,obstacles,knockables,update,lights,chunks,wireLamps};
}
