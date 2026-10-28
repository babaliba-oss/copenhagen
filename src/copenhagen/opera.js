import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {groundAt} from '../terrain.js';

// Operaen (Henning Larsen Architects, 2004) on Dokøen, Holmen, across the harbour from Amalienborg. The municipal model
// has it as a plain block; drawn by hand instead: the flat roof (about 158 x 90 m) cantilevered 32 m over the arrival
// plaza at the quay, tapering to a thin edge, its underside silver-grey metal panels with downlights; the curved glass
// foyer front under it with its metal grid and the golden maple shell of the auditorium behind; the stone-clad body, the
// dark stage tower rising over the roof to ~38 m (archilovers.com "The Opera, Copenhagen"; en.wikipedia "Copenhagen Opera
// House"). Local frame: u runs from the roof's harbour edge (u=0) to its back (u=len), v across; footprint from the
// OpenStreetMap outline (osm-way-1088494374, a 153 x 88.5 m rectangle: the roof), the body under it inset from the edges.
export const OPERA={id:'osm-way-1088494374',part:'kk-osm-way-1088494374',x:1487,z:-254.35,rot:-Math.atan2(65.5,138.5),len:153.3,hw:44.25,front:42,back:149,side:40,apex:32,arcW:36,soffit:27.5,top:30.5,tower:38};
export const HIDE_TODAY=[OPERA.part]; // the model's block drawn in its place
const {len,hw,front,back,side,apex,arcW,soffit,top,tower}=OPERA;
export const operaWorld=(u,v)=>{const c=Math.cos(OPERA.rot),s=Math.sin(OPERA.rot);return [OPERA.x+u*c+v*s,OPERA.z-u*s+v*c];}; // as mesh.rotation.y=rot turns local (x=u, z=v)
const arcU=v=>apex+(front-apex)*(v/arcW)**2,ARC=24,arc=Array.from({length:ARC+1},(_,i)=>{const v=-arcW+2*arcW*i/ARC;return [arcU(v),v];}); // the foyer front bulges toward the harbour
// The body's outline (local u,v): the stage house's rectangle and the foyer's curve. Collision is this, not the roof: the plaza under the overhang is open.
export const OPERA_RING=[[back,-side],[front,-side],...arc,[front,side],[back,side]];

function builder(){const p=[],n=[],c=[],col=new THREE.Color();
 const tri=(a,b,d,hint,hex)=>{const e1=b.map((q,i)=>q-a[i]),e2=d.map((q,i)=>q-a[i]);let nx=e1[1]*e2[2]-e1[2]*e2[1],ny=e1[2]*e2[0]-e1[0]*e2[2],nz=e1[0]*e2[1]-e1[1]*e2[0];if(nx*hint[0]+ny*hint[1]+nz*hint[2]<0){[b,d]=[d,b];nx=-nx;ny=-ny;nz=-nz;}const l=Math.hypot(nx,ny,nz)||1;col.set(hex);for(const q of [a,b,d]){p.push(...q);n.push(nx/l,ny/l,nz/l);c.push(col.r,col.g,col.b);}};
 const quad=(a,b,d,e,hint,hex)=>{tri(a,b,d,hint,hex);tri(a,d,e,hint,hex);}; // a b d e round the edge
 const wall=([u0,v0],[u1,v1],y0,y1,hex,off=0)=>{const nu=v0-v1,nv=u1-u0,l=Math.hypot(nu,nv),ou=nu/l*off,ov=nv/l*off;quad([u0+ou,y0,v0+ov],[u1+ou,y0,v1+ov],[u1+ou,y1,v1+ov],[u0+ou,y1,v0+ov],[nu,0,nv],hex);}; // outward: left of the direction of travel (as OPERA_RING runs)
 const geo=()=>{const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(n,3));g.setAttribute('color',new THREE.Float32BufferAttribute(c,3));return g;};
 return {tri,quad,wall,geo};}

// Geometry in the local frame, y from the floor of the foyer (the mesh stands at ground level there). Returns the opaque
// parts (vertex colours), the glass, the soffit and its lights and the y to stand the meshes at.
export function operaGeometry(){
 const y0=groundAt(...operaWorld(front,0)),gy=(u,v)=>groundAt(...operaWorld(u,v))-y0;
 const S=builder(),G=builder(),L=builder(),U=builder(),STONE='#bdb7aa',DARKGLASS='#7a868e',METAL='#5a5f64',SOFFIT='#cfd3d5',EDGE='#e4e5e3',ROOF='#8f9497',TOWER='#858a8f',GRID='#c5c9cb',GOLDEN='#c58a3c',PLAZA='#aaa59b',FLOOR='#5a5048',B=-5;
 // body: stone walls from below the ground to the roof, dark metal beside the foyer, window bands along the sides and back
 const ring=OPERA_RING;for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length];if(a[1]>-arcW-.01&&a[1]<arcW+.01&&b[1]>-arcW-.01&&b[1]<arcW+.01&&a[0]<front+.01&&b[0]<front+.01)continue; /* the curve is glass */
  const face=a[0]===front&&b[0]===front?METAL:STONE;S.wall(a,b,B,soffit,face);if(face===STONE)for(const [y,h] of [[4,1.8],[12,1.8],[20,1.8]])S.wall(a,b,y,y+h,DARKGLASS,.08);}
 // the roof: flat silver soffit, a thin bright edge, the top rising gently to the middle
 const R=[[0,-hw],[0,hw],[len,hw],[len,-hw]],E=soffit+.55;U.quad([0,soffit,-hw],[len,soffit,-hw],[len,soffit,hw],[0,soffit,hw],[0,-1,0],SOFFIT); /* lit by its own material: in the shade it was black */
 for(let i=0;i<4;i++)S.wall(R[i],R[(i+1)%4],soffit,E,EDGE);
 {const I=[[22,-hw+18],[22,hw-18],[len-22,hw-18],[len-22,-hw+18]];for(let i=0;i<4;i++){const a=R[i],b=R[(i+1)%4],c=I[(i+1)%4],d=I[i];S.quad([a[0],E,a[1]],[b[0],E,b[1]],[c[0],top,c[1]],[d[0],top,d[1]],[0,1,0],ROOF);}S.quad([I[0][0],top,I[0][1]],[I[1][0],top,I[1][1]],[I[2][0],top,I[2][1]],[I[3][0],top,I[3][1]],[0,1,0],ROOF);}
 // the stage tower over the roof and the lower backstage block behind it
 for(const [u0,u1,w,h,hex] of [[94,130,21,tower,TOWER],[130,146,30,top+2.5,METAL]]){const r=[[u1,-w],[u0,-w],[u0,w],[u1,w]];for(let i=0;i<4;i++)S.wall(r[i],r[(i+1)%4],top-1,h,hex);S.quad([u0,h,-w],[u1,h,-w],[u1,h,w],[u0,h,w],[0,1,0],'#7a7f84');}
 // the arrival plaza under the overhang, on the ground, and the foyer's floors and the auditorium's shell seen through the glass
 {const nu=6,nv=8;for(let i=0;i<nu;i++)for(let j=0;j<nv;j++){const u0=i*front/nu,u1=(i+1)*front/nu,v0=-hw+j*2*hw/nv,v1=-hw+(j+1)*2*hw/nv,y=(u,v)=>gy(u,v)+.12;S.quad([u0,y(u0,v0),v0],[u1,y(u1,v0),v0],[u1,y(u1,v1),v1],[u0,y(u0,v1),v1],[0,1,0],PLAZA);}}
 for(const fy of [7.5,13.5,19.5])for(let i=0;i<ARC;i++){const a=arc[i],b=arc[i+1],ia=[a[0]+1.2,a[1]],ib=[b[0]+1.2,b[1]];S.quad([ia[0],fy,ia[1]],[ib[0],fy,ib[1]],[front+4,fy,ib[1]],[front+4,fy,ia[1]],[0,1,0],FLOOR);S.wall(ia,ib,fy-.6,fy,'#e8e2d6');} // floors with white balcony fronts
 S.wall([front+15,-arcW],[front+15,arcW],-1,soffit,'#4a4038'); /* the foyer's back wall, behind the glass */
 const shell=new THREE.SphereGeometry(1,18,9,0,Math.PI*2,0,Math.PI/2);shell.scale(15,21,23).translate(front+15,-1,0); /* the maple shell, its front bulging into the foyer */
 const glass=(()=>{for(let i=0;i<ARC;i++)G.wall(arc[i],arc[i+1],-1,soffit,'#ffffff');return G.geo();})(); /* the glass, its colour from the material */
 for(let i=0;i<=ARC;i++){const [u,v]=arc[i],d=2*(front-apex)*v/arcW**2,l=Math.hypot(1,d),nu=-1/l,nv=d/l,tu=-nv*.2,tv=nu*.2;S.quad([u+nu*.15+tu,-1,v+nv*.15+tv],[u+nu*.15-tu,-1,v+nv*.15-tv],[u+nu*.15-tu,soffit,v+nv*.15-tv],[u+nu*.15+tu,soffit,v+nv*.15+tv],[nu,0,nv],GRID);} // mullions
 for(let y=3;y<soffit;y+=3)for(let i=0;i<ARC;i++)S.wall(arc[i],arc[i+1],y-.15,y+.15,GRID,.12); // transoms
 // downlights in the soffit over the plaza
 for(let u=3;u<front;u+=4)for(let v=-hw+2.2;v<hw-2;v+=4)L.quad([u-.35,soffit-.04,v-.35],[u+.35,soffit-.04,v-.35],[u+.35,soffit-.04,v+.35],[u-.35,soffit-.04,v+.35],[0,-1,0],'#ffffff');
 const sh=shell.toNonIndexed();shell.dispose();sh.deleteAttribute('uv');const gc=new THREE.Color(GOLDEN),ca=new Float32Array(sh.attributes.position.count*3);for(let i=0;i<ca.length;i+=3)ca.set([gc.r,gc.g,gc.b],i);sh.setAttribute('color',new THREE.BufferAttribute(ca,3));
 const opaque=mergeGeometries([S.geo(),sh]);sh.dispose();
 return {opaque,glass,lights:L.geo(),soffit:U.geo(),y:y0};
}
// The mapped footprint (the whole roof) becomes the body's outline: the collision, camera and walkers' indexes.
export function operaFootprint(buildings){const b=buildings.find(q=>q.id===OPERA.id);if(!b)return buildings;const r=OPERA_RING.map(([u,v])=>operaWorld(u,v)),xs=r.map(q=>q[0]),zs=r.map(q=>q[1]);b.rings=[r];b.bbox=[Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs)];b.height=tower;b.cover=1;return buildings;}
