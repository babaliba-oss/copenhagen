import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {storeyBands,storeyStyle} from './facade-data.js';
import {signCell,SHOP_NAMES} from './shop-sign-layout.js';

// Data-driven street fronts for buildings described in a city's facades.json (src/facade-data.js).
// Works on the measured or extruded wall faces found by analyseBuilding(): every element sits in
// a face's own frame (outward normal n, offset d = n·p, abscissa s = x·nz − z·nx, height y) and is
// kept on real wall. Output is two merged, vertex-coloured batches per building (glass, relief),
// so a whole street costs a few draw calls. No per-city code: everything comes from the data.

const linear=hex=>new THREE.Color(hex); // hex is sRGB; three converts it to the linear working space
export const hexRGB=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
const SKY=linear('#9fb4c4'),WARM=linear('#d9b47a');
const hash=(a,b)=>{const x=Math.sin(a*12.9898+b*78.233)*43758.5453;return x-Math.floor(x);};

class Batch{
 constructor(){this.parts=[];}
 add(g,color,gradient=null){
  if(g.index)g=g.toNonIndexed();for(const k of Object.keys(g.attributes))if(k!=='position')g.deleteAttribute(k);
  const p=g.attributes.position,c=new Float32Array(p.count*3),tmp=new THREE.Color();
  for(let i=0;i<p.count;i++){tmp.copy(color);if(gradient)gradient(tmp,p.getY(i));c[i*3]=tmp.r;c[i*3+1]=tmp.g;c[i*3+2]=tmp.b;}
  g.setAttribute('color',new THREE.BufferAttribute(c,3));this.parts.push(g);
 }
 get triangles(){return this.parts.reduce((n,g)=>n+g.attributes.position.count/3,0);}
 finish(){if(!this.parts.length)return null;const g=mergeGeometries(this.parts);this.parts.forEach(x=>x.dispose());g.computeVertexNormals();g.computeBoundingSphere();return g;}
}

// One wall face's frame: placement and the "is this point on real wall" test.
export class FaceFrame{
 constructor(face){Object.assign(this,{nx:face.normal.x,nz:face.normal.z,d:face.d,lean:face.lean||0,yRef:face.yRef||0,s0:face.s0,s1:face.s1,y0:face.y0,y1:face.y1,tris:face.triangles||[]});this.rot=Math.atan2(this.nx,this.nz);}
 covered(s,y){
  for(const {local:[a,b,c]} of this.tris){
   const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-8)continue;
   const p=((b[1]-c[1])*(s-c[0])+(c[0]-b[0])*(y-c[1]))/den,q=((c[1]-a[1])*(s-c[0])+(a[0]-c[0])*(y-c[1]))/den;
   if(p>=-1e-6&&q>=-1e-6&&p+q<=1+1e-6)return true;
  }
  return false;
 }
 rect(s0,s1,y0,y1){for(const u of [0,.5,1])for(const v of [0,.5,1])if(!this.covered(s0+u*(s1-s0),y0+v*(y1-y0)))return false;return true;}
 place(g,s,y,e){const d=this.d-this.lean*(y-this.yRef)+e;g.rotateY(this.rot);g.translate(this.nx*d+this.nz*s,y,this.nz*d-this.nx*s);return g;} // a leaning wall: at the wall's offset for this height (building-detail.js analyseBuilding)
}

// Glass reads as glass without an environment map: lighter toward the top (sky reflection),
// a few panes with warm light or a pale blind behind them.
function glassTone(s,y,h,base){
 const r=hash(s,y),tint=r<.12?WARM:r<.2?linear('#d8d2c4'):null;
 return (c,worldY)=>{const v=Math.min(1,Math.max(0,(worldY-y)/h+.5));c.lerp(SKY,.06+.26*v*v);if(tint)c.lerp(tint,.4*(1-v));};
}
// Shop windows: dark glass with the lit shop behind it (warm, brighter toward the display at the bottom),
// a sky reflection at the top, and every few bays a pale blind or a dark closed one.
const SHOP_LIGHT=[linear('#e2c08a'),linear('#d8d2c4'),linear('#c7a27e'),linear('#b9c6c9')];
function shopTone(s,y,h){const r=hash(s,y*1.7),light=SHOP_LIGHT[Math.floor(r*4)%4],lit=r<.82;
 return (c,worldY)=>{const v=Math.min(1,Math.max(0,(worldY-y)/h+.5));if(lit)c.lerp(light,.55*(1-v)*(1-v)+.08);c.lerp(SKY,.05+.3*v*v);};}
function pane(F,G,s,y,w,h,glass,arch=false,tone=null){
 let g;
 if(arch){const r=w/2,sh=new THREE.Shape();sh.moveTo(-r,-h/2);sh.lineTo(r,-h/2);sh.lineTo(r,h/2-r);sh.absarc(0,h/2-r,r,0,Math.PI,false);sh.lineTo(-r,-h/2);g=new THREE.ShapeGeometry(sh,5);}
 else g=new THREE.PlaneGeometry(w,h);
 G.add(F.place(g,s,y,.08),glass,(tone||glassTone)(s,y,h,glass)); // 8 cm proud: overlapping LOD2 walls a few cm in front must not swallow it
}
const flat=(F,B,s,y,e,w,h,color)=>B.add(F.place(new THREE.PlaneGeometry(w,h),s,y,e),color);
const slab=(F,B,s,y,e,w,h,depth,color)=>{const g=new THREE.BoxGeometry(w,h,depth),i=g.index.array;g.setIndex([...i.slice(0,30)]);B.add(F.place(g,s,y,e+depth/2),color);}; // no back face (it lies on the wall)
const ledge=(F,B,s,y,e,w,h,depth,color)=>{const g=new THREE.BoxGeometry(w,h,depth),i=g.index.array;g.setIndex([...i.slice(0,12),...i.slice(18,30)]);B.add(F.place(g,s,y,e+depth/2),color);}; // nor a top: a plinth's 8 cm top, lit from above, drew a white line along the street at knee height

// Evenly spaced bay centres across [a,b] with at least `margin` at each end.
export function bays(a,b,pitch,margin=.6){
 const n=Math.floor((b-a-2*margin)/pitch+.25);if(n<1)return (b-a)>=pitch*.6?[(a+b)/2]:[];
 return Array.from({length:n},(_,i)=>(a+b)/2+(i-(n-1)/2)*pitch);
}

function upperStorey(F,G,B,band,st,c,avoid=null){
 const span=[F.s0,F.s1],h=band.y1-band.y0;if(st.shape==='none'||h<1.6)return 0;
 const wh=Math.min(st.height,h-.7),ww=st.width,y=band.y0+Math.max(.55,(h-wh)/2-.1)+wh/2;let n=0;
 if(st.shape==='ribbon'){
  // A continuous glazed band with mullions at the bay pitch (penthouses, curtain walls).
  for(const [a,b] of runs(F,y,span)){const w=b-a-.3;if(w<1)continue;pane(F,G,(a+b)/2,y,w,wh,c.glass);
   for(const s of bays(a,b,st.pitch,.15))slab(F,B,s+st.pitch/2,y,.03,.08,wh,.06,c.frame);
   slab(F,B,(a+b)/2,y-wh/2-.06,.02,w,.12,.12,c.frame);n+=Math.max(1,Math.round(w/st.pitch));}
  return n;
 }
 const deep=st.surround!==false&&st.shape!=='square';
 for(const s of bays(...span,st.pitch)){
  const arch=st.shape==='arch',w=st.shape==='square'?Math.min(ww,wh):ww,hh=st.shape==='square'?w:wh;
  if(!F.rect(s-w/2-.2,s+w/2+.2,y-hh/2-.25,y+hh/2+.2))continue;
  if(avoid&&Math.abs(s-avoid)<w/2+.21+1.0)continue; // the street door takes this bay (its sill would cross the door)
  pane(F,G,s,y,w,hh,c.glass,arch);
  const sideH=hh-(arch?w/2:0),sideY=y-(arch?w/4:0);
  if(deep){
   // A real reveal: the surround stands 16 cm proud of the wall, so the glass sits back in a recess that
   // catches light and shadow; plus the sash frame and the Danish cross bar (post and transom).
   for(const dx of [-1,1])slab(F,B,s+dx*(w/2+.07),sideY,0,.14,sideH+.14,.16,c.surround);
   if(!arch)slab(F,B,s,y+hh/2+.07,0,w+.28,.14,.16,c.surround);
   else for(let k=0;k<5;k++){const a=Math.PI*(k+.5)/5,r=w/2+.07;B.add(F.place(new THREE.BoxGeometry(.14,w*.34,.16).rotateZ(a),s+Math.cos(a)*r,y+hh/2-w/2+Math.sin(a)*r,.08),c.surround);}
   for(const dx of [-w/2+.04,w/2-.04])flat(F,B,s+dx,sideY,.09,.08,sideH,c.frame);
   if(!arch){flat(F,B,s,y+hh/2-.04,.09,w,.08,c.frame);flat(F,B,s,y-hh/2+.04,.09,w,.08,c.frame);}
   if(st.shape!=='ribbon'&&w>.7){flat(F,B,s,y,.095,.07,hh-.1,c.frame);if(!arch&&hh>1.2)flat(F,B,s,y+hh*.2,.095,w-.08,.07,c.frame);}
   // Wooden shutters folded back beside the window (1760 houses).
   if(c.shutter&&!arch)for(const dx of [-1,1])slab(F,B,s+dx*(w/2+.16+w*.25),y,0,w*.48,hh,.05,c.shutter);
   // Sill: projecting stone ledge; a hood moulding over the main-floor windows of older fronts.
   slab(F,B,s,y-hh/2-.1,0,w+.42,.1,.24,c.trim);
   if(st.hood&&!arch)slab(F,B,s,y+hh/2+.26,0,w+.5,.12,.22,c.cornice);
  }else{
   for(const dx of [-w/2,w/2])flat(F,B,s+dx,sideY,.1,.1,sideH,c.frame);
   if(!arch)flat(F,B,s,y+hh/2,.1,w+.1,.1,c.frame);
   if(w>1.1&&!arch)flat(F,B,s,y,.1,.06,hh,c.frame);
   flat(F,B,s,y-hh/2-.05,.2,w+.3,.1,c.trim);B.add(F.place(new THREE.PlaneGeometry(w+.3,.18).rotateX(-Math.PI/2),s,y-hh/2,.11),c.trim);
  }
  n++;
 }
 return n;
}

// Horizontal stretches of real wall at height y (skips courtyard gaps and stepped corners).
function runs(F,y,[a,b]){
 const out=[];let start=null;
 for(let s=a+.25;s<=b;s+=.5){const on=F.covered(s,y);if(on&&start===null)start=s-.25;else if(!on&&start!==null){out.push([start,s-.25]);start=null;}}
 if(start!==null)out.push([start,b]);
 return out.filter(([p,q])=>q-p>.8);
}

function groundStorey(F,G,B,band,g,c){
 if(!g)return 0;const top=band.y1;let n=0;
 const fascia=g.type==='glass'?0:Math.min(.8,(top-band.y0)*.18),glassTop=top-fascia-.25,base=band.y0+(g.type==='glass'?.1:.45);
 if(glassTop-base<1.2)return 0;
 for(const [a,b] of runs(F,band.y0+1.2,[F.s0,F.s1])){
  if(g.type!=='solid'&&fascia)slab(F,B,(a+b)/2,top-fascia/2-.15,.02,b-a,fascia,.14,c.band);
  // A shop sign on the fascia: one per run, a name from the shared atlas.
  if(g.type==='shops'&&fascia>.35&&b-a>2.6&&c.signs&&!F.signed&&c.signs.length<3&&F.s1-F.s0>8&&hash(F.d,a)<.75){F.signed=true;const k=Math.floor(hash(F.s0+a,F.d)*SHOP_NAMES.length),sw=Math.min(b-a-.5,2.4+hash(a,b)*1.4),sh=Math.min(fascia*.78,sw/4),[u0,v0,u1,v1]=signCell(k);
   const pg=new THREE.PlaneGeometry(sw,sh),uv=pg.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,u0+uv.getX(i)*(u1-u0),v0+uv.getY(i)*(v1-v0));
   c.signs.push(F.place(pg,(a+b)/2,top-fascia/2-.15,.17));}
  if(g.canopy)slab(F,B,(a+b)/2,top-.12,.05,b-a,.28,2.2,c.canopy);
  if(g.type==='solid')continue;
  for(const s of bays(a,b,g.pitch,.4)){
   const w=g.pitch-(g.type==='glass'?.12:.7),h=glassTop-base,y=base+h/2;
   if(!F.rect(s-w/2,s+w/2,base-(g.type==='glass'?0:.2),glassTop))continue; // the whole shop front on wall: the run is tested at one height, and a bay wider than a short run (or one at a stepped corner) hung past the wall's end
   pane(F,G,s,y,w,h,c.shop,g.type==='arcade',shopTone);
   if(g.type!=='arcade'&&w>1.4)slab(F,B,s,base+h*.62,.03,w,.06,.06,c.groundFrame); // transom bar
   for(const dx of [-w/2,w/2])slab(F,B,s+dx,y-(g.type==='arcade'?w/4:0),.03,.12,h-(g.type==='arcade'?w/2:0),.09,c.groundFrame);
   if(g.type!=='glass')slab(F,B,s,base-.2,.02,w,.4,.1,c.groundFrame);
   if(g.awning)B.add(F.place(new THREE.BoxGeometry(w*.92,.05,1.0).rotateX(-.3),s,glassTop+.05,.55),c.awning);
   n++;
  }
 }
 return n;
}

// Meshes for every wall face of one described building part. Returns {glass,relief,windows,triangles}.
export function createFacade(faces,spec){
 const c={glass:linear(spec.windows.glass),frame:linear(spec.windows.frame),trim:linear(spec.trim||spec.windows.frame),
  shop:linear('#30363a'),band:linear(spec.ground?.band||'#2e3134'),groundFrame:linear(spec.ground?.frame||'#2b2d2f'),
  awning:linear(spec.ground?.awning||'#2b2d2f'),canopy:linear(spec.ground?.canopy||'#2b2d2f'),door:linear(spec.door||'#3a2a20'),lower:spec.wallLower&&linear(spec.wallLower),cornice:linear(spec.cornice||spec.trim||spec.wall)};
 c.plinth=linear(spec.plinth||'#5d5a55');c.rail=linear(spec.rail||'#3a3f42');c.shutter=spec.windows.shutters?linear(spec.windows.shutters):null;c.surround=linear(spec.surround||spec.cornice||spec.trim||spec.windows.frame);
 const G=new Batch(),B=new Batch();let windows=0;c.signs=[];
 for(const face of faces){
  const F=new FaceFrame(face),width=F.s1-F.s0,height=F.y1-F.y0;
  if(width<2.5||height<2.4||Math.abs(face.normal.y)>.12)continue;
  const bands=storeyBands(spec,height).map(b=>({...b,y0:b.y0+F.y0,y1:b.y1+F.y0}));
  let doorAt=null; // this face's street door: the plinth stops either side of it (it ran across the door, 1 cm in front of the leaves)
  // A differently clad base (granite, brick) over the lower storeys.
  if(c.lower){const top=bands[Math.min(bands.length-1,spec.lowerStoreys-1)].y1;for(const [a,b] of runs(F,F.y0+1,[F.s0,F.s1]))slab(F,B,(a+b)/2,(F.y0+top)/2,.0,b-a,top-F.y0,.02,c.lower);}
  for(const band of bands){
   if(band.index===0&&spec.storeys>1&&spec.ground?.type==='solid'&&spec.estimated){
    // Estimated fronts: windows on the ground floor too, and a street door in the widest run.
    let best=null;for(const [a,b] of runs(F,band.y0+1.2,[F.s0,F.s1]))if(!best||b-a>best[1]-best[0])best=[a,b];
    // Off the middle by up to a fifth of the run, but its surround kept 0.6 m off either end: on a narrow front (a
    // one-bay house by Højbro Plads) the door stood against the corner, its frame on the edge of the wall.
    const half=best?(best[1]-best[0])/2:0;let door=best&&half>1.5?(best[0]+best[1])/2+((F.s0*7.3)%1-.5)*2*Math.min(half*.4,Math.max(0,half-1.55)):null;
    // the whole doorway (surround, cornice, step) on this wall: one tested at a single height hung off a corner or a bend
    // in the front, and the door stood turned against the wall beside it
    if(door!==null&&!F.rect(door-.95,door+.95,band.y0+.1,band.y0+2.95))door=null;
    windows+=upperStorey(F,G,B,band,storeyStyle(spec,1,spec.storeys),c,door);
    if(door!==null){const s=door,y0=band.y0;doorAt=s;
     // Street door: stone surround, two panelled leaves set back in it, a glazed fanlight and a step.
     for(const dx of [-.74,.74])slab(F,B,s+dx,y0+1.4,0,.18,2.8,.14,c.surround);slab(F,B,s,y0+2.86,0,1.66,.16,.18,c.cornice);
     flat(F,B,s,y0+1.12,.07,1.3,2.24,c.door);flat(F,B,s,y0+1.12,.08,.04,2.2,linear('#1c1410')); // 7 cm proud: the model's walls are not perfectly flat, and a leaf at 2 cm vanished into the brick
     for(const dx of [-.33,.33])for(const [py,ph] of [[.62,.8],[1.62,.9]])flat(F,B,s+dx,y0+py,.085,.42,ph,c.door.clone().multiplyScalar(1.25));
     pane(F,G,s,y0+2.5,1.3,.42,c.glass);flat(F,B,s,y0+2.27,.04,1.32,.06,c.surround);
     slab(F,B,s,y0+.07,0,1.8,.14,.42,c.plinth);}
    continue;}
   if(band.index===0&&spec.storeys>1){windows+=groundStorey(F,G,B,band,spec.ground,c);continue;}
   // Balconies on newer blocks: a slab and a front rail on every other bay.
   if(spec.balconies&&band.index>=1&&width>6)bays(F.s0,F.s1,spec.windows.pitch*2,1).forEach((s,i)=>{if(!F.rect(s-1.3,s+1.3,band.y0+.1,band.y0+1.2))return;
    slab(F,B,s,band.y0+.05,0,2.6,.16,1.35,c.trim);slab(F,B,s,band.y0+.62,1.3,2.6,.95,.05,spec.balconyGlass?c.glass:c.rail);});
   windows+=upperStorey(F,G,B,band,{...storeyStyle(spec,band.index,spec.storeys),hood:band.index===1&&spec.material!=='glass'&&spec.windows.shape!=='ribbon'&&!spec.modern},c);
   // String course between storeys of masonry fronts.
   if(band.index===1&&spec.material!=='glass')for(const [a,b] of runs(F,band.y0+.1,[F.s0,F.s1]))slab(F,B,(a+b)/2,band.y0,.0,b-a,.22,.12,c.cornice);
  }
  if(spec.storeys===1&&spec.ground?.type==='glass')windows+=groundStorey(F,G,B,{y0:F.y0,y1:F.y1-.3},spec.ground,c);
  // Cornice along the top edge: frieze, a projecting crown and a shadow line under it.
  if(spec.cornice||spec.material!=='glass')for(const [a,b] of runs(F,F.y1-.4,[F.s0,F.s1])){if(!F.rect(a,b,F.y1-(height>6?.8:.44),F.y1-.1))continue; // along a level top only: under a gable's sloping edge the crown hung in the air past the wall
   slab(F,B,(a+b)/2,F.y1-.22,.0,b-a+.1,.44,spec.cornice?.42:.18,c.cornice);
   if(spec.material!=='glass'&&height>6){slab(F,B,(a+b)/2,F.y1-.62,0,b-a,.36,.1,c.cornice);slab(F,B,(a+b)/2,F.y1-.03,.0,b-a+.2,.08,spec.cornice?.58:.3,c.cornice);}}
  // Plinth: a darker stone base along the street.
  // The plinth stops under the shop windows' sills (0.45 m): at 0.7 m its front, 8 cm out, lay in the panes' own plane and the
  // bottom of every shop front flickered as a dark jagged bar.
  if(spec.material!=='glass'&&height>4){const ph=spec.ground?.type==='glass'?0:spec.ground&&spec.ground.type!=='solid'?.44:.7;if(ph)for(const [a0,b0] of runs(F,F.y0+.4,[F.s0,F.s1]))for(const [a,b] of doorAt===null?[[a0,b0]]:[[a0,Math.min(b0,doorAt-.9)],[Math.max(a0,doorAt+.9),b0]])if(b-a>.3)ledge(F,B,(a+b)/2,F.y0+ph/2,0,b-a,ph,.08,c.plinth);}
 }
 const signs=c.signs.length?mergeGeometries(c.signs.map(g=>g.index?g.toNonIndexed():g)):null;c.signs.forEach(g=>g.dispose());if(signs){signs.computeVertexNormals();signs.computeBoundingSphere();}
 return {triangles:G.triangles+B.triangles,glass:G.finish(),relief:B.finish(),signs,windows};
}

// Materials for the two batches; the shell itself keeps the building's own material.
export function facadeMaterials(){
 // Depth offsets: the model's LOD2 walls are not flat, and where one stood the 8 cm a pane is set proud of its face, glass and
 // wall fought over the same depth and the shop fronts flickered as you drove past (brick showing through the glass in bands).
 return {glass:new THREE.MeshStandardMaterial({vertexColors:true,roughness:.3,metalness:.1,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-4}),relief:new THREE.MeshStandardMaterial({vertexColors:true,roughness:.78,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2})};
}
