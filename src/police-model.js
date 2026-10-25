import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
// Door, tailgate and light-bar lettering: POLIISI in Finland, POLITI in Denmark (setPoliceLettering, set per city).
import {POLICE_UNIFORM} from './person-model.js';
let POLICE_TEXT='POLIISI';
export function setPoliceLettering(t){POLICE_TEXT=t;POLICE_UNIFORM.text=t;POLICE_UNIFORM.stripe=t==='POLITI'?POLICE_UNIFORM.vest:null;} // officers' uniforms follow: POLITI on the back, Danish hi-vis chest band

// Finnish Poliisi patrol vehicles, modelled from reference photography
// (no photo pixels are embedded):
//  • `estate` – Škoda Octavia Combi in the older livery: white body, the WHOLE
//    bonnet dark navy blue, blue lower half of the doors and rear quarter with
//    bold white POLIISI, "112" + phone glyph on the rear door, thin blue stripe
//    along the lower front wing, roof rails, blue bar lettered POLIISI, alloys.
//  • `van` – Mercedes-Benz Vito: tall boxy van, white bonnet, navy band along
//    the lower body side from the front door to the rear with POLIISI across
//    the front and sliding doors, blue rear-quarter panel with a white badge
//    and sword silhouette, fluorescent lime accents (rear-corner strip, strip
//    under the band, lime/white chevrons on the lower rear quarter), "112",
//    unit number on the front wings and roof front, steel wheels, full-width
//    blue LED bar lettered POLIISI.
// Lettering is drawn on a runtime canvas atlas in a heavy sans-serif; the
// renderer adds the strobing lenses at `mounts.bar` and the unit number decals
// at `mounts.numbers`.
export const POLICE_BLUE='#1d3a8a',POLICE_LIME='#d3e34c',POLICE_YELLOW=POLICE_LIME,POLICE_WHITE='#f4f5f2';
export const POLICE_VARIANTS=['estate','van'];

// l/w/h overall, wb wheelbase, ax axle z positions (front negative), belt
// window-sill height, r wheel radius, sill lower edge of the body, doors:
// shut-line z positions, band: blue band top edge and rear end.
export const POLICE_SPECS={
 estate:{l:4.67,w:1.81,h:1.47,wb:2.69,ax:[-1.4,1.29],belt:.96,r:.33,tyre:.215,sill:.28,
  doors:[-.72,.42,1.32],band:{top:.76,rear:2.1},text:{z:.08,y:.45,cap:.25,w:1.5},
  bar:{y:1.5,z:.35,w:1.34},bonnet:{z:-1.95,y:.845,slope:.1},rearGlass:{z:2.2,y:1.18,tilt:-.3},plateY:.58},
 van:{van:true,l:5.14,w:1.93,h:1.91,wb:3.2,ax:[-1.6,1.6],belt:1.08,r:.33,tyre:.215,sill:.3,
  doors:[-.95,.3,1.5],band:{top:.92,rear:2.57},text:{z:-.05,y:.52,cap:.4,w:2.3},
  bar:{y:1.95,z:-.75,w:1.4},bonnet:{z:-2.2,y:1.01,slope:.2},rearGlass:{z:2.585,y:1.8,tilt:0},roofNumber:{z:-1.05,y:1.895,slope:.5},wingNumber:{z:-1.75,y:.86},plateY:.62},
};

// Texture atlas layout (pixels in a 2048×1536 canvas, shared by every unit of
// a variant). Each body triangle is projected into the region matching its
// dominant normal; the car's length runs along the wide axis everywhere.
const ATLAS_W=2048,ATLAS_H=1536;
const REGION={right:[0,0,2048,480],left:[0,480,2048,480],top:[0,960,2048,300],front:[0,1260,896,276],rear:[896,1260,896,276],
 barFront:[1792,1360,256,56],barRear:[1792,1416,256,56],under:[1792,1472,256,64]};

const liveryCache=new Map();
export function policeLiveryTexture(variant){
 if(liveryCache.has(variant))return liveryCache.get(variant);
 const canvas=document.createElement('canvas');canvas.width=ATLAS_W;canvas.height=ATLAS_H;
 drawLivery(canvas.getContext('2d'),POLICE_SPECS[variant]);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=8;
 liveryCache.set(variant,texture);return texture;
}
// Metres on the car → atlas pixels, per region. Sides are drawn as seen from
// outside (front of the car to the right on the right side), the top with the
// front of the car at the top of the image.
function mapper(spec){
 const Lz=spec.l/2+.03,Hb=spec.h+.05,Wz=spec.w/2+.03,R=REGION;
 return {Lz,Hb,Wz,
  right:(z,y)=>[R.right[0]+R.right[2]*(Lz-z)/(2*Lz),R.right[1]+R.right[3]*(1-y/Hb)],
  left:(z,y)=>[R.left[0]+R.left[2]*(z+Lz)/(2*Lz),R.left[1]+R.left[3]*(1-y/Hb)],
  top:(x,z)=>[R.top[0]+R.top[2]*(z+Lz)/(2*Lz),R.top[1]+R.top[3]*(Wz-x)/(2*Wz)],
  topAspect:(R.top[3]/(2*Wz))/(R.top[2]/(2*Lz)),sideAspect:(R.right[2]/(2*Lz))/(R.right[3]/Hb),rearAspect:(R.rear[2]/(2*Wz))/(R.rear[3]/Hb),
  front:(x,y)=>[R.front[0]+R.front[2]*(Wz-x)/(2*Wz),R.front[1]+R.front[3]*(1-y/Hb)],
  rear:(x,y)=>[R.rear[0]+R.rear[2]*(x+Wz)/(2*Wz),R.rear[1]+R.rear[3]*(1-y/Hb)],
 };
}
const FONT=size=>`900 ${size}px "Arial Black","Helvetica Neue",Arial,sans-serif`;
function poly(ctx,points,fill){ctx.fillStyle=fill;ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fill();}
// Fit `text` into a box: cap height and width in pixels, centred at (cx, baseline).
// `aspect` is the region's horizontal/vertical pixels-per-metre ratio, so the
// letterforms stay upright on anisotropic regions; they may stretch up to 45 %.
function fitText(ctx,text,cx,baseline,capPx,widthPx,fill,aspect=1){
 const size=capPx/.72;ctx.font=FONT(size);ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillStyle=fill;
 const measured=(ctx.measureText(text)?.width||widthPx/aspect)*aspect,sx=Math.min(1.45,widthPx/measured)*aspect;
 ctx.save();ctx.translate(cx,baseline);ctx.scale(sx,1);ctx.fillText(text,0,0);ctx.restore();
}
// Stylised police badge: white rounded rectangle carrying a plain blue sword
// silhouette with a crown-shaped pommel. Original artwork, not the official emblem.
export function drawEmblem(ctx,cx,cy,height,colour=POLICE_BLUE,field=POLICE_WHITE){
 const s=height/100,w=72;ctx.save();ctx.translate(cx,cy-height/2);ctx.scale(s,s);
 ctx.fillStyle=field;ctx.beginPath();ctx.roundRect(-w/2,0,w,100,10);ctx.fill();
 poly(ctx,[[-14,16],[-9,8],[-4,14],[0,6],[4,14],[9,8],[14,16],[14,22],[-14,22]],colour);
 ctx.fillStyle=colour;ctx.fillRect(-5,22,10,10);ctx.fillRect(-18,32,36,6);
 poly(ctx,[[-6,38],[6,38],[2,92],[-2,92]],colour);
 ctx.globalCompositeOperation='destination-out';ctx.fillRect(-.8,41,1.6,46);ctx.globalCompositeOperation='source-over';
 ctx.restore();
}
// Phone-handset glyph and "112" (white on the blue band) centred at (cx, baseline).
function draw112(ctx,cx,baseline,cap,aspect){
 fitText(ctx,'112',cx+cap*.45,baseline,cap,cap*2.2,POLICE_WHITE,aspect);
 ctx.strokeStyle=POLICE_WHITE;ctx.lineWidth=cap*.2;ctx.lineCap='round';ctx.beginPath();ctx.arc(cx-cap*1.05*aspect,baseline-cap*.45,cap*.45,Math.PI*.6,Math.PI*1.4);ctx.stroke();
}
function drawSide(ctx,spec,P,aspect){
 const {band,doors}=spec,low=spec.sill-.12,h=y=>Math.abs(P(0,y)[1]-P(0,0)[1]),w=z=>Math.abs(P(z,0)[0]-P(0,0)[0]),rect=(z0,z1,y0,y1,fill)=>poly(ctx,[P(z0,y0),P(z1,y0),P(z1,y1),P(z0,y1)],fill);
 if(!spec.van){
  // Octavia livery: blue lower half of both doors and the rear quarter, thin blue stripe on the lower front wing.
  rect(doors[0],band.rear,low,band.top,POLICE_BLUE);
  rect(-spec.l/2+.45,doors[0]-.02,.36,.46,POLICE_BLUE);
  draw112(ctx,...P((doors[2]+band.rear)/2+.05,band.top-.16),h(.1),aspect);
 }else{
  // Vito livery: blue band along the lower body from the front door to the rear.
  rect(doors[0],spec.l/2+.05,low,band.top,POLICE_BLUE);
  // Lime strip under the band and a vertical lime strip on the rear corner.
  rect(doors[0],spec.l/2+.05,low-.02,low+.07,POLICE_LIME);
  rect(spec.l/2-.1,spec.l/2+.05,low+.07,spec.belt+.02,POLICE_LIME);
  // Lime / white battenburg chevrons over the lower rear quarter and bumper area.
  for(let i=0;i<5;i++){const z=1.45+i*.22;rect(z,z+.11,low+.07,low+.34,i%2?POLICE_WHITE:POLICE_LIME);}
  draw112(ctx,...P(2.05,band.top-.14),h(.12),aspect);
  // Blue rear side-window panel with the badge.
  rect(1.55,2.3,spec.belt+.03,spec.h-.14,POLICE_BLUE);const [ex,ey]=P(1.92,(spec.belt+spec.h-.11)/2);ctx.save();ctx.translate(ex,ey);ctx.scale(aspect,1);drawEmblem(ctx,0,0,h(.46));ctx.restore();
 }
 // Lettering across the doors (POLIISI on both sides, as in the reference photos).
 const [tx,ty]=P(spec.text.z,spec.text.y);fitText(ctx,POLICE_TEXT,tx,ty,h(spec.text.cap),w(spec.text.w),POLICE_WHITE,aspect);
 // Door shut lines and wheel-well shadows.
 ctx.strokeStyle='rgba(20,24,30,.55)';ctx.lineWidth=2;
 for(const z of doors){ctx.beginPath();ctx.moveTo(...P(z,spec.sill+.02));ctx.lineTo(...P(z,spec.belt-.02));ctx.stroke();}
 for(const z of spec.ax){const [cx,cy]=P(z,spec.r),rz=w(spec.r+.09),ry=h(spec.r+.09);
  for(const [k,fill]of [[1,'#1d2126'],[.86,'#0d0f12']]){ctx.fillStyle=fill;ctx.beginPath();ctx.ellipse(cx,cy,rz*k,ry*k,0,Math.PI,2*Math.PI);ctx.closePath();ctx.fill();}}
}
function drawLivery(ctx,spec){
 const m=mapper(spec);
 ctx.fillStyle=POLICE_WHITE;ctx.fillRect(0,0,ATLAS_W,ATLAS_H);
 const [ux,uy,uw,uh]=REGION.under;ctx.fillStyle='#2b2e33';ctx.fillRect(ux,uy,uw,uh);
 drawSide(ctx,spec,m.right,m.sideAspect);drawSide(ctx,spec,m.left,m.sideAspect);
 if(!spec.van){
  // Whole bonnet navy blue (top of the nose and its front lip above the grille).
  poly(ctx,[m.top(-m.Wz,-m.Lz),m.top(m.Wz,-m.Lz),m.top(m.Wz,-.6),m.top(-m.Wz,-.6)],POLICE_BLUE);
  poly(ctx,[m.front(-m.Wz,.7),m.front(m.Wz,.7),m.front(m.Wz,m.Hb),m.front(-m.Wz,m.Hb)],POLICE_BLUE);
  // Tailgate: blue POLIISI under the rear glass, lime chevrons wrapping the bumper corners.
  fitText(ctx,POLICE_TEXT,...m.rear(0,.745),Math.abs(m.rear(0,.085)[1]-m.rear(0,0)[1]),Math.abs(m.rear(.42,0)[0]-m.rear(-.42,0)[0]),POLICE_BLUE,m.rearAspect);
  for(const side of [-1,1])for(const x0 of [.94,.78])poly(ctx,[m.rear(side*x0,.3),m.rear(side*(x0-.08),.3),m.rear(side*(x0-.16),.54),m.rear(side*(x0-.08),.54)],POLICE_LIME);
 }else{
  // Rear barn doors (white): dark tinted window in the upper half of each door carrying the
  // badge, blue POLIISI split across the seam at bumper-top height with small www.poliisi.fi
  // under it, lime/white chevrons across the bumper and lower doors, lime strip at each corner.
  const rr=(x0,x1,y0,y1,fill)=>poly(ctx,[m.rear(x0,y0),m.rear(x1,y0),m.rear(x1,y1),m.rear(x0,y1)],fill),rh=y=>Math.abs(m.rear(0,y)[1]-m.rear(0,0)[1]),rw=x=>Math.abs(m.rear(x,0)[0]-m.rear(0,0)[0]);
  const B=spec.belt,H=spec.h;
  for(const side of [-1,1]){rr(side*.08,side*(m.Wz-.14),B+.1,H-.2,'#1c2733');const [ex,ey]=m.rear(side*(m.Wz-.14+.08)/2,(B+.1+H-.2)/2);ctx.save();ctx.translate(ex,ey);ctx.scale(m.rearAspect,1);drawEmblem(ctx,0,0,rh(.42));ctx.restore();}
  for(let x=-m.Wz;x<m.Wz;x+=.2)poly(ctx,[m.rear(x,.3),m.rear(x+.1,.3),m.rear(x+.18,.56),m.rear(x+.08,.56)],Math.round((x+m.Wz)/.2)%2?POLICE_WHITE:POLICE_LIME);
  for(const side of [-1,1])rr(side*(m.Wz-.09),side*m.Wz,.56,B+.03,POLICE_LIME);
  ctx.strokeStyle='rgba(20,24,30,.5)';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(...m.rear(0,.58));ctx.lineTo(...m.rear(0,H-.05));ctx.stroke();
  fitText(ctx,POLICE_TEXT,...m.rear(0,.74),rh(.2),rw(.65)*2,POLICE_BLUE,m.rearAspect);
  fitText(ctx,'www.poliisi.fi',...m.rear(0,.65),rh(.055),rw(.4)*2,POLICE_BLUE,m.rearAspect);
 }
 // Light bar text tiles (front and rear) – white POLIISI on blue.
 for(const name of ['barFront','barRear']){const [x,y,w,h]=REGION[name];ctx.fillStyle=POLICE_BLUE;ctx.fillRect(x,y,w,h);fitText(ctx,POLICE_TEXT,x+w/2,y+h*.8,h*.56,w*.82,POLICE_WHITE);}
}
// Per-car decal sheet: the unit number (bonnet, rear glass, wings, roof).
export function unitNumberTexture(number,colour=POLICE_BLUE){
 const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;const ctx=canvas.getContext('2d');
 ctx.clearRect(0,0,256,128);fitText(ctx,number,128,104,80,220,colour);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;return texture;
}
// Helsinki units carry plain three-digit numbers (1xx–5xx seen in photos: 206, 512).
export const unitNumber=index=>String(101+(index*137)%499);
export const unitVariant=index=>POLICE_VARIANTS[index%2];

function loft(sections){
 const vertices=[],indices=[],n=8;
 for(const [z,w,lo,hi]of sections){const b=Math.min(.10,(hi-lo)*.2);for(const [x,y]of[[-w+b,lo],[w-b,lo],[w,lo+b],[w,hi-b],[w-b,hi],[-w+b,hi],[-w,hi-b],[-w,lo+b]])vertices.push(x,y,z);}
 for(let i=0;i<sections.length-1;i++)for(let j=0;j<n;j++){const a=i*n+j,b=i*n+(j+1)%n;indices.push(a,b,a+n,b,b+n,a+n);}
 for(let j=1;j<n-1;j++){indices.push(0,j+1,j);const k=(sections.length-1)*n;indices.push(k,k+j,k+j+1);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return g.toNonIndexed();
}
// Planar projection of every triangle into the atlas region of its dominant normal.
function projectLivery(g,spec){
 const m=mapper(spec),p=g.attributes.position,uv=new Float32Array(p.count*2),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
 for(let i=0;i<p.count;i+=3){
  a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
  b.sub(a);c.sub(a);const n=b.cross(c),ax=Math.abs(n.x),ay=Math.abs(n.y),az=Math.abs(n.z);
  for(let k=0;k<3;k++){const x=p.getX(i+k),y=p.getY(i+k),z=p.getZ(i+k);let px,py;
   if(ax>=ay&&ax>=az)[px,py]=n.x>0?m.right(z,y):m.left(z,y);
   else if(ay>=az){if(n.y>0)[px,py]=m.top(x,z);else{const [rx,ry,rw,rh]=REGION.under;px=rx+rw*(x/spec.w+.5);py=ry+rh*(z/spec.l+.5);}}
   else [px,py]=n.z<0?m.front(x,y):m.rear(x,y);
   uv[(i+k)*2]=px/ATLAS_W;uv[(i+k)*2+1]=1-py/ATLAS_H;}
 }
 g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
}
function tileGeometry(w,h,region){const g=new THREE.PlaneGeometry(w,h),[x,y,rw,rh]=region,uv=g.attributes.uv;for(let i=0;i<uv.count;i++)uv.setXY(i,(x+uv.getX(i)*rw)/ATLAS_W,1-(y+(1-uv.getY(i))*rh)/ATLAS_H);return g;}

export function createPoliceBody(variant='estate'){
 const s=POLICE_SPECS[variant],L=s.l/2,W=s.w/2,B=s.belt,H=s.h,group=new THREE.Group(),batches=new Map(),van=!!s.van;
 const settings={blue:['#2448a6',.2,.3],glass:['#2d4150',.35,.18],rubber:['#202329',0,.88],black:['#171d23',.25,.3],grey:['#4a5057',.3,.5],chrome:['#b5bfc5',.72,.27],head:['#edf3ec',0,.4],tail:['#ae1522',0,.4],plate:['#eff2e8',0,.6]};
 const mats=Object.fromEntries(Object.entries(settings).map(([name,[color,metalness,roughness]])=>{const m=new THREE.MeshStandardMaterial({color,metalness,roughness});m.name=name;return[name,m];}));
 mats.paint=new THREE.MeshStandardMaterial({map:policeLiveryTexture(variant),metalness:.3,roughness:.32});mats.paint.name='paint';
 mats.blue.transparent=true;mats.blue.opacity=.82;mats.blue.emissive.set('#0c2a7a');mats.blue.emissiveIntensity=.25; // translucent LED bar housing
 mats.head.emissive.set('#dceafa');mats.head.emissiveIntensity=.35;mats.tail.emissive.set('#ff2817');mats.tail.emissiveIntensity=.35;
 function add(g,mat,x=0,y=0,z=0,rx=0,ry=0,rz=0){g.rotateX(rx);g.rotateY(ry);g.rotateZ(rz);g.translate(x,y,z);if(g.index)g=g.toNonIndexed();g.deleteAttribute('uv');if(!batches.has(mat))batches.set(mat,[]);batches.get(mat).push(g);}
 // Plain boxes keep a unit well under 6k triangles (the previous rounded boxes cost ~17k).
 function box(w,h,d,mat,x,y,z,rx=0,ry=0,rz=0){add(new THREE.BoxGeometry(w,h,d),mat,x,y,z,rx,ry,rz);}
 function strut(a,b,width,mat){const v=new THREE.Vector3(...b).sub(new THREE.Vector3(...a)),g=new THREE.BoxGeometry(width,v.length(),width);g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),v.clone().normalize()));g.translate(...new THREE.Vector3(...a).addScaledVector(v,.5).toArray());add(g,mat);}
 let fg,rf,rr,rg,rw;
 if(!van){
  // Octavia Combi-like: long bonnet, fast windscreen, long flat roof, raked tailgate.
  add(loft([[-L,W*.8,.34,.74],[-L+.2,W*.95,.27,.8],[-L+.65,W,.25,.86],[-.6,W,.25,B],[.5,W,.25,B+.02],[1.8,W,.27,B+.02],[2.15,W*.97,.3,B+.02],[L,W*.86,.36,B-.03]]),'paint');
  fg=-.56;rf=.2;rr=1.72;rg=2.26;rw=W*.84;
  add(loft([[fg,W*.9,B-.01,B+.05],[rf,rw,B,H-.065],[rr,rw,B,H-.065],[2.15,rw*1.02,B,H-.12],[rg,W*.9,B-.01,B+.04]]),'glass');
  box(rw*2+.045,.08,rr-rf+.12,'paint',0,H-.045,(rr+rf)/2);
  for(const side of [-1,1]){
   strut([side*W*.9,B,fg],[side*rw,H-.07,rf],.075,'paint');
   strut([side*W*.9,B,rg],[side*rw,H-.08,rr],.13,'paint');
   strut([side*W*.93,B,s.doors[1]],[side*rw,H-.07,s.doors[1]],.07,'black');
   strut([side*W*.93,B,s.doors[2]],[side*rw*1.01,H-.07,s.doors[2]+.05],.05,'black');
   box(.05,.05,rg-fg,'chrome',side*W*.91,B+.012,(rg+fg)/2);
   box(.05,.07,rr-rf+.3,'black',side*rw*.84,H+.03,(rf+rr)/2); // roof rails
   for(const z of [-.2,s.doors[1]+.55])box(.03,.045,.2,'paint',side*(W+.008),B-.12,z);
   box(.2,.12,.26,'paint',side*(W+.08),B+.09,fg+.1);box(.16,.08,.015,'glass',side*(W+.08),B+.09,fg+.24);
   box(.44,.1,.09,'black',side*W*.63,B-.19,-L+.05);box(.42,.07,.1,'head',side*W*.64,B-.17,-L+.02,0,side*.14);
   box(.1,.28,.1,'tail',side*W*.88,B-.1,L-.07);box(.36,.1,.1,'tail',side*W*.64,B-.12,L-.045);
   box(.12,.04,.03,'plate',side*W*.55,.66,L+.01);
  }
  box(W*1.86,.2,.17,'black',0,.4,-L+.1);box(W*1.9,.22,.14,'rubber',0,.44,L-.08);box(W*1.3,.09,.12,'chrome',0,.37,L-.09);
  box(W*1.2,.19,.09,'grey',0,.62,-L+.03);for(let i=0;i<4;i++)box(.02,.17,.1,'chrome',-.33+i*.22,.62,-L+.02);box(W*1.2,.02,.1,'chrome',0,.72,-L+.02);
  box(W*1.14,.085,.035,'black',0,B-.07,L-.012);
  for(const z of [-L-.006,L+.017]){box(.5,.12,.025,'plate',0,s.plateY,z);box(.045,.11,.029,'glass',-.215,s.plateY,z);}
 }else{
  // Vito-like van: short sloping nose, tall slab sides, flat roof, flat rear doors.
  add(loft([[-L,W*.8,.36,.78],[-L+.3,W*.95,.3,.98],[-L+.9,W,.3,B],[0,W,.3,B+.03],[2.0,W,.3,B+.03],[L-.05,W*.98,.33,B+.02],[L,W*.92,.4,B-.04]]),'paint');
  fg=-1.6;rf=-.9;rr=L-.08;rg=L-.02;rw=W*.95;
  add(loft([[fg,W*.95,B-.01,B+.05],[rf,rw,B,H-.065],[rr,rw,B,H-.065],[rg,rw*.98,B-.01,B+.04]]),'glass');
  box(rw*2+.045,.08,rr-rf+.12,'paint',0,H-.045,(rr+rf)/2);
  box(rw*2+.03,H-B-.07,.05,'paint',0,(H+B)/2-.02,rg);
  for(const side of [-1,1]){
   strut([side*W*.95,B,fg],[side*rw,H-.07,rf],.09,'paint');
   strut([side*rw*1.01,B,rg-.02],[side*rw*1.01,H-.07,rg-.02],.1,'paint');
   for(const z of [s.doors[1],s.doors[2]])strut([side*W*.96,B,z],[side*rw*1.01,H-.07,z],.07,'black');
   box(.02,.66,.78,'paint',side*(rw+.006),(B+H-.11)/2,1.92); // blue badge panel over the rear side window
   box(.05,.05,rg-fg,'chrome',side*W*.96,B+.012,(rg+fg)/2);
   box(.09,.07,rr-rf-.3,'black',side*rw*.8,H+.03,(rf+rr)/2);
   for(const z of [-.5,s.doors[1]+.5])box(.03,.045,.2,'black',side*(W+.008),B-.14,z);
   box(.22,.16,.28,'black',side*(W+.1),B+.12,fg+.25);box(.17,.11,.015,'glass',side*(W+.1),B+.12,fg+.4);
   box(.42,.14,.1,'black',side*W*.63,B-.26,-L+.05);box(.36,.06,.1,'head',side*W*.64,B-.24,-L+.02,0,side*.12);
   box(.11,.42,.08,'tail',side*W*.92,B+.05,L-.06);
   box(.12,.04,.03,'plate',side*W*.55,.68,L+.01);
   box(.09,.09,.26,'black',side*W,1.2,.95);
  }
  box(W*1.9,.22,.18,'black',0,.42,-L+.1);box(W*1.92,.24,.14,'rubber',0,.46,L-.08);
  box(W*1.3,.22,.09,'grey',0,.72,-L+.03);for(let i=0;i<3;i++)box(W*1.22,.015,.1,'chrome',0,.66+i*.06,-L+.02);
  box(.024,H-B-.3,.025,'black',0,(H+B)/2,L+.018);
  // Front plate centred; the rear plate sits low on the left barn door.
  for(const [z,x]of [[-L-.006,0],[L+.017,-W*.5]]){box(.5,.12,.025,'plate',x,s.plateY,z);box(.045,.11,.029,'glass',x-.215,s.plateY,z);}
 }
 // Full-width LED light bar: translucent blue housing lettered POLIISI front and
 // rear; the outer thirds are the strobing lenses, added per car by the renderer
 // at `mounts.bar`.
 const bar=s.bar,lensW=(bar.w-.5)/2;box(.5,.08,.3,'blue',0,bar.y,bar.z);
 const tiles=[];for(const [z,region]of [[bar.z-.152,REGION.barFront],[bar.z+.152,REGION.barRear]]){const g=tileGeometry(.48,.07,region);if(z>bar.z)g.rotateY(Math.PI);g.translate(0,bar.y,z);tiles.push(g.toNonIndexed());}
 for(const side of [-1,1])box(.05,.04,.1,'black',side*(bar.w/2-.12),bar.y-.05,bar.z);
 // Wheels: silver multi-spoke alloys on the estate, plainer steel wheels with small hubcaps on the van.
 for(const side of [-1,1])for(const z of s.ax){
  const pivot=new THREE.Group();pivot.position.set(side*(W-.1),s.r,z);group.add(pivot);const spin=new THREE.Group();pivot.add(spin);
  const tire=new THREE.Mesh(new THREE.CylinderGeometry(s.r,s.r,s.tyre,18),mats.rubber);tire.rotation.z=Math.PI/2;spin.add(tire);
  const hub=new THREE.Mesh(new THREE.CylinderGeometry(s.r*(van?.45:.7),s.r*(van?.45:.7),s.tyre+.01,14),van?mats.grey:mats.chrome);hub.rotation.z=Math.PI/2;spin.add(hub);
  if(!van)for(let i=0;i<5;i++){const spoke=new THREE.Mesh(new THREE.BoxGeometry(s.tyre+.02,.03,s.r*1.3),mats.black);spoke.rotation.x=i*Math.PI/5;spin.add(spoke);}
  else{const steel=new THREE.Mesh(new THREE.CylinderGeometry(s.r*.68,s.r*.68,s.tyre+.004,14),mats.black);steel.rotation.z=Math.PI/2;spin.add(steel);}
  spin.children.forEach(m=>m.castShadow=true);
 }
 for(const [name,gs]of batches){
  let merged=mergeGeometries(gs);
  if(name==='paint'){projectLivery(merged,s);merged=mergeGeometries([merged,...tiles]);}
  const mesh=new THREE.Mesh(merged,mats[name]);mesh.name=name;mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);gs.forEach(g=>g.dispose());
 }
 group.name=`Police ${variant}`;
 const numbers=[{w:.3,h:.14,x:0,y:s.bonnet.y,z:s.bonnet.z,rx:-Math.PI/2+s.bonnet.slope,ry:Math.PI},{w:.26,h:.12,x:0,y:s.rearGlass.y,z:s.rearGlass.z,rx:s.rearGlass.tilt,ry:0}];
 if(s.wingNumber)for(const side of [-1,1])numbers.push({w:.24,h:.11,x:side*(W*.97+.012),y:s.wingNumber.y,z:s.wingNumber.z,rx:0,ry:side*Math.PI/2});
 if(s.roofNumber)numbers.push({w:.3,h:.14,x:0,y:s.roofNumber.y,z:s.roofNumber.z,rx:-Math.PI/2+s.roofNumber.slope,ry:Math.PI});
 group.userData={type:variant,spec:{...s},numberColour:van?POLICE_BLUE:POLICE_WHITE,wheels:group.children.slice(0,4).map((pivot,i)=>({pivot,spin:pivot.children[0],front:i%2===0,radius:s.r})),tail:mats.tail,
  mounts:{bar:{y:bar.y,z:bar.z,x:.25+lensW/2,w:lensW},grille:{y:van?.6:.5,z:-L+.03,x:W*.7},head:{y:van?B-.24:B-.17,z:-L-.03,x:W*.6},numbers}};
 return group;
}
