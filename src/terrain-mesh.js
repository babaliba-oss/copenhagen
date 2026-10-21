import * as THREE from 'three';
import {groundAt,waterAt,hasTerrain,terrain,footprintBase,seaLevel} from './terrain.js';
import {pointInPolygon,bounds} from './geo.js';

// Geometry that follows the ground (src/terrain.js). Flat cities skip all of this.

// Splits triangles (and line segments) until no edge is longer than maxEdge metres across the ground, so
// draped vertices can follow the terrain between them. All attributes are interpolated; material groups kept.
// With `height` (x,z → metres) a triangle is only split while the ground under it bends away from a plane by
// more than `tolerance` (or an edge is longer than 6×maxEdge): flat streets keep their few big triangles.
export function subdivideGeometry(source,maxEdge=4,{height=null,tolerance=.03}={}){
 const g=source.index?source.toNonIndexed():source,names=Object.keys(g.attributes),pos=g.attributes.position;
 const sizes=names.map(n=>g.attributes[n].itemSize),stride=sizes.reduce((a,b)=>a+b,0),line=!!source.userData?.lines;
 const read=i=>{const v=new Float32Array(stride);let o=0;names.forEach((n,k)=>{const a=g.attributes[n];for(let c=0;c<sizes[k];c++)v[o++]=a.getComponent(i,c);});return v;};
 const mid=(a,b)=>{const v=new Float32Array(stride);for(let i=0;i<stride;i++)v[i]=(a[i]+b[i])/2;return v;};
 const len=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]),max2=maxEdge*maxEdge;
 const out=[],groups=[],ranges=g.groups.length?g.groups:[{start:0,count:pos.count,materialIndex:0}];
 for(const r of ranges){const start=out.length;
  if(line){for(let i=r.start;i+1<r.start+r.count;i+=2){const a=read(i),b=read(i+1),n=Math.max(1,Math.ceil(len(a,b)/maxEdge));
   for(let k=0;k<n;k++){const p=new Float32Array(stride),q=new Float32Array(stride);for(let c=0;c<stride;c++){p[c]=a[c]+(b[c]-a[c])*k/n;q[c]=a[c]+(b[c]-a[c])*(k+1)/n;}out.push(p,q);}}}
  else for(let i=r.start;i+2<r.start+r.count;i+=3){const stack=[[read(i),read(i+1),read(i+2)]];
   while(stack.length){const t=stack.pop(),e=[0,1,2].map(k=>{const a=t[k],b=t[(k+1)%3];return (a[0]-b[0])**2+(a[2]-b[2])**2;}),k=e.indexOf(Math.max(...e));
    if(e[k]<=max2||height&&e[k]<=36*max2&&flatUnder(t,height,tolerance)){out.push(...t);continue;}
    const a=t[k],b=t[(k+1)%3],c=t[(k+2)%3],m=mid(a,b);stack.push([a,m,c],[m,b,c]);}}
  groups.push({start,count:out.length-start,materialIndex:r.materialIndex??0});
 }
 const result=new THREE.BufferGeometry();let o=0;
 names.forEach((n,k)=>{const s=sizes[k],a=new Float32Array(out.length*s);for(let i=0;i<out.length;i++)for(let c=0;c<s;c++)a[i*s+c]=out[i][o+c];o+=s;result.setAttribute(n,new THREE.BufferAttribute(a,s,g.attributes[n].normalized));});
 if(g.groups.length)for(const x of groups)result.addGroup(x.start,x.count,x.materialIndex);
 if(g!==source)g.dispose();
 return result;
}

// Older surface packs contain a second water plane at 1 cm. Its 4 mm gap
// from the animated sea collapses in the overhead camera's depth buffer.
// Remove those triangles, rather than lifting the sea over the quays.
export function removeLegacyWater(geometry){
 const p=geometry.attributes.position,source=geometry.index?.array,keep=[];
 for(let i=0,n=source?.length??p.count;i<n;i+=3){
  const ids=[source?.[i]??i,source?.[i+1]??i+1,source?.[i+2]??i+2];
  if(!ids.every(j=>Math.abs(p.getY(j)-.01)<.00001))keep.push(...ids);
 }
 geometry.setIndex(keep);geometry.computeBoundingSphere();return geometry;
}

// Drapes a geometry (world-space positions) over the ground. `mark` keeps the added height in a
// `terrainY` attribute, so shaders that read layer heights from position.y can subtract it again.
export function drapeGeometry(geometry,{maxEdge=4,lift=0,water=false,mark=false,lines=false,tolerance=.03}={}){
 if(!hasTerrain())return geometry;
 if(lines)geometry.userData.lines=true;
 const surface=(x,z)=>{if(water){const w=waterAt(x,z);if(w!==null)return w;const s=seaLevel(),g=groundAt(x,z);if(s!==null&&g<s)return s;return g;}return groundAt(x,z);};
 const g=maxEdge?subdivideGeometry(geometry,maxEdge,{height:lines?null:surface,tolerance}):geometry,p=g.attributes.position,added=mark?new Float32Array(p.count):null;
 const hs=new Float32Array(p.count);for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),h=surface(x,z)+lift;hs[i]=h-lift;p.setY(i,p.getY(i)+h);if(added)added[i]=h;}
 if(added)g.setAttribute('terrainY',new THREE.BufferAttribute(added,1));
 p.needsUpdate=true;
 if(g.attributes.normal&&!lines){
  // Flat surfaces (roads, pavements, parks): smooth normals from the terrain slope, not per-triangle
  // facets, which showed every 4 m triangle as a crease across open asphalt.
  g.computeVertexNormals();const n=g.attributes.normal,e=1;
  for(let i=0;i<p.count;i++){if(n.getY(i)<.8)continue;const x=p.getX(i),z=p.getZ(i),dx=(surface(x+e,z)-hs[i])/e,dz=(surface(x,z+e)-hs[i])/e,l=Math.hypot(dx,1,dz);n.setXYZ(i,-dx/l,1/l,-dz/l);}
  n.needsUpdate=true;
 }
 g.computeBoundingSphere();g.computeBoundingBox();
 return g;
}

// Paths mapped along a quay edge are buffered half over the water; draped on the sloping canal bed they show
// as a pale strip just above the water with a dark gap behind the quay. Drop draped surface triangles that lie
// entirely over water and less than `clear` metres above it (real quays stand ~1.5-2 m higher and are kept).
export function dropSunkenSurfaces(geometry,{clear=1.2,water=waterAt,mapped=null}={}){ // mapped(x,z): inside the mapped water polygons; such triangles go whatever their height (paving drawn out over a canal at quay height read as pale slabs floating on the water)
 const p=geometry.attributes.position,y=geometry.attributes.terrainY,src=geometry.index?.array;if(!y)return geometry;
 const n=src?src.length:p.count,keep=[];let dropped=0;
 // per vertex once (indexed vertices are shared by up to six triangles): 0 unknown, 1 no, 2 yes
 const wetV=new Uint8Array(p.count),mapV=new Uint8Array(p.count);
 const sunkAt=j=>{if(!wetV[j]){const w=water(p.getX(j),p.getZ(j));wetV[j]=w!==null&&y.getX(j)<w+clear?2:1;}return wetV[j]===2;};
 const mapAt=j=>{if(!mapV[j])mapV[j]=mapped(p.getX(j),p.getZ(j))?2:1;return mapV[j]===2;};
 for(let i=0;i<n;i+=3){
  const ids=[src?.[i]??i,src?.[i+1]??i+1,src?.[i+2]??i+2];
  const sunk=sunkAt(ids[0])&&sunkAt(ids[1])&&sunkAt(ids[2]);
  const over=!sunk&&mapped&&(mapAt(ids[0])+mapAt(ids[1])+mapAt(ids[2]))>=2&&mapped((p.getX(ids[0])+p.getX(ids[1])+p.getX(ids[2]))/3,(p.getZ(ids[0])+p.getZ(ids[1])+p.getZ(ids[2]))/3);
  if(over){dropped++;continue;}
  if(sunk)dropped++;else keep.push(...ids);
 }
 if(dropped){geometry.setIndex(keep);geometry.computeBoundingSphere();}
 geometry.userData.sunkenDropped=dropped;return geometry;
}

// True when the ground under a triangle is a plane through its corners (edge midpoints and centre checked).
function flatUnder(t,h,tol){
 const [a,b,c]=t,ha=h(a[0],a[2]),hb=h(b[0],b[2]),hc=h(c[0],c[2]),off=(x,z,e)=>Math.abs(h(x,z)-e)>tol;
 return !(off((a[0]+b[0])/2,(a[2]+b[2])/2,(ha+hb)/2)||off((b[0]+c[0])/2,(b[2]+c[2])/2,(hb+hc)/2)||off((c[0]+a[0])/2,(c[2]+a[2])/2,(hc+ha)/2)||off((a[0]+b[0]+c[0])/3,(a[2]+b[2]+c[2])/3,(ha+hb+hc)/3));
}
const identity=m=>{const e=m.elements;return Math.abs(e[12])<1e-6&&Math.abs(e[13])<1e-6&&Math.abs(e[14])<1e-6&&Math.abs(e[0]-1)<1e-6&&Math.abs(e[5]-1)<1e-6&&Math.abs(e[10]-1)<1e-6;};
const box=new THREE.Box3(),v=new THREE.Vector3(),m4=new THREE.Matrix4();
// Lowest ground under an object's footprint (its world bounding box sampled every 3 m).
export function groundUnder(object){
 box.setFromObject(object);if(box.isEmpty())return groundAt(object.position.x,object.position.z);
 return footprintBase([[[box.min.x,box.min.z],[box.max.x,box.min.z],[box.max.x,box.max.z],[box.min.x,box.max.z]]],3);
}
// Puts a built scene on the ground: world-space meshes are subdivided and draped, instanced meshes get
// each instance lifted, and positioned objects move as a whole (by the lowest ground under them when
// marked `userData.building`/`rigid`, else by the ground at their origin). Call once after building.
export function settleObject(root,{maxEdge=4,skip=null,tolerance=.03}={}){
 if(!hasTerrain()||!root)return root;
 root.updateMatrixWorld(true);const done=new WeakSet();
 const rigid=o=>{const h=o.userData.building||o.userData.rigid?groundUnder(o):groundAt(v.setFromMatrixPosition(o.matrixWorld).x,v.z);o.position.y+=h;o.updateMatrixWorld(true);};
 const visit=o=>{
  if(skip?.(o))return;
  if(o!==root&&(o.userData.building||o.userData.rigid)){rigid(o);return;}
  if(o.isInstancedMesh){if(!identity(o.matrixWorld)){rigid(o);return;}
   for(let i=0;i<o.count;i++){o.getMatrixAt(i,m4);const e=m4.elements;e[13]+=groundAt(e[12],e[14]);o.setMatrixAt(i,m4);}
   o.instanceMatrix.needsUpdate=true;o.computeBoundingSphere?.();o.computeBoundingBox?.();return;}
  if((o.isMesh||o.isLine||o.isPoints)&&o.geometry){
   if(!identity(o.matrixWorld)){rigid(o);return;}
   if(done.has(o.geometry))return;const old=o.geometry,lines=!!o.isLineSegments,g=drapeGeometry(old,{maxEdge:o.isPoints?0:maxEdge,lines,tolerance});
   if(g!==old){old.dispose();o.geometry=g;}done.add(g);return;}
  if(o!==root&&!identity(o.matrixWorld)){rigid(o);return;}
  for(const c of [...o.children])visit(c);
 };
 visit(root);return root;
}

// The bare ground: chunked grids following the terrain half a metre below street level (as the flat
// ground plane was), with a coarse skirt out to the horizon. Normals give the hills their shading.
// `shallow` ({margin, deep(x0,z0,x1,z1)}): dry ground sits only `margin` below the height field plus what its coarse
// triangles bulge above it (groundSag), not half a metre: unmapped strips between the mapped surfaces and the houses
// (pavement nobody drew, Christianshavn's back lots) were a 57 cm step down from the street, so the carriageway stood
// on a plinth, the car looked raised beside them and furniture placed on the height field hung in the air. Vertices
// whose cells touch something drawn under street level keep `depth`: deep(x0,z0,x1,z1) (main.js: the mapped lawns,
// sunk 22 cm) and the lakes' banks (lakeSurface traces their shore against the half-metre drop).
export function createTerrainGround(material,{cell=10,chunk=32,size=11000,depth=-.5,wet=null,shallow=null}={}){
 const f=terrain(),group=new THREE.Group();group.name='Terrain ground';if(!f)return group;
 const E=Math.floor(f.extent/cell)*cell,n=Math.round(2*E/cell);
 const shore=wet?shoreVertices(f,wet,cell,E,n):null;
 const lift=shallow?shallowDepth(f,cell,E,n,depth,shallow,wet):null;
 const grid=(xs,zs,fine=false)=>{const pos=[],nor=[],idx=[],w=xs.length;
  // Under (or next to) water the ground drops 2 m below the water surface: the elevation model's ground is often
  // above the water layer in the harbour and canals, and drawing it there hid the water (the "muddy" harbour).
  const sink=(x,z)=>{let w=null;for(const [a,b] of [[0,0],[cell/2,0],[-cell/2,0],[0,cell/2],[0,-cell/2]]){const v=waterAt(x+a,z+b);if(v!=null)w=w==null?v:Math.min(w,v);}return w;};
  for(const z of zs)for(const x of xs){const g0=groundAt(x,z),s=shore?.(x,z);
   if(s!==undefined){if(s===null)pos.push(x,g0+(fine&&lift?lift(x,z):depth),z);else pos.push(x,s+depth,z);} /* masked ground (see shoreVertices) */
   else{const w0=sink(x,z),w=w0!=null&&(g0<w0+1||wet?.(x,z))?w0:null,d=fine&&lift&&w==null?lift(x,z):depth; /* banks well above the water (quays) keep their height: sinking every vertex near a canal dug pits beside the streets */
    pos.push(x,w==null?g0+d:Math.min(g0+depth,w-2),z);}
   if(typeof s==='number'){nor.push(0,1,0);continue;} /* a shore vertex lies level with the land beside it */
   const dx=groundAt(x+1,z)-groundAt(x-1,z),dz=groundAt(x,z+1)-groundAt(x,z-1),l=Math.hypot(dx,2,dz);nor.push(-dx/l,2/l,-dz/l);}
  for(let j=0;j+1<zs.length;j++)for(let i=0;i+1<w;i++){const a=j*w+i,b=a+1,c=a+w,d=c+1;idx.push(a,c,b,b,c,d);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));g.setIndex(idx);g.computeBoundingSphere();g.computeBoundingBox();return g;};
 const range=(a,b,step)=>{const out=[];for(let x=a;x<b-1e-6;x+=step)out.push(x);out.push(b);return out;};
 for(let cz=0;cz<n;cz+=chunk)for(let cx=0;cx<n;cx+=chunk){
  const xs=range(-E+cx*cell,-E+Math.min(n,cx+chunk)*cell,cell),zs=range(-E+cz*cell,-E+Math.min(n,cz+chunk)*cell,cell);
  const m=new THREE.Mesh(grid(xs,zs,true),material);m.receiveShadow=true;m.name='Terrain chunk';group.add(m);}
 const fine=group.children.slice(),per=Math.ceil(n/chunk);
 // Skirt: four coarse strips around the fine square, clamped to the edge heights.
 const H=size/2,coarse=125,side=range(-H,-E,coarse),far=range(E,H,coarse),mid=range(-E,E,coarse);
 for(const [xs,zs] of [[[...side,...mid.slice(1),...far.slice(1)],side],[[...side,...mid.slice(1),...far.slice(1)],far],[side,mid],[far,mid]]){const m=new THREE.Mesh(grid(xs,zs),material);m.receiveShadow=true;m.name='Terrain skirt';group.add(m);}
 // The drawn height of the fine grid (its own triangles), for things standing on the bare ground: on the field they
 // stood over it by its margin and sag (trees beside the quays hung in the air).
 const heightAt=(x,z)=>{const gi=(x+E)/cell,gj=(z+E)/cell;if(!(gi>=0&&gj>=0&&gi<n&&gj<n))return null;const ci=Math.floor(gi/chunk),cj=Math.floor(gj/chunk),p=fine[cj*per+ci]?.geometry.attributes.position?.array;if(!p)return null;
  const w=Math.min(n,(ci+1)*chunk)-ci*chunk+1,i=Math.floor(gi)-ci*chunk,j=Math.floor(gj)-cj*chunk,u=gi%1,v=gj%1,Y=(a,b)=>p[((j+b)*w+i+a)*3+1],A=Y(0,0),B=Y(1,0),C=Y(0,1),D=Y(1,1);
  return u+v<=1?A+u*(B-A)+v*(C-A):D+(1-u)*(C-D)+(1-v)*(B-D);};
 group.userData={cell,chunks:group.children.length,heightAt};
 return group;
}

// Per vertex of the (n+1)² ground grid: how far below the height field it goes. The coarse grid's triangles bulge above
// the bilinear field wherever it is concave; each grid cell's bulge (groundSag, at the field's own samples) plus
// `margin` keeps every triangle under the streets draped on the field. `deep` ([x0,z0,x1,z1] boxes) and lake banks keep
// the full `depth`. → (x,z) at a grid vertex → offset (negative).
export function groundSag(f,cell,E,n,wet=null){ // wet(x,z): samples in the mapped water do not count (the material cuts the ground away there; counted, the drop into a canal pulled the quay's vertices metres under the street and trees and benches stood over a hole)
 const N=n+1,hv=new Float32Array(N*N),sag=new Float32Array(n*n);
 const F=f.size,fc=f.cell,fe=f.extent,g=f.ground,at=(x,z)=>{const m=F-1,u=Math.max(0,Math.min(m,(x+fe)/fc)),v=Math.max(0,Math.min(m,(z+fe)/fc)),i=Math.min(m-1,Math.floor(u)),j=Math.min(m-1,Math.floor(v)),a=u-i,b=v-j,k=j*F+i;return (g[k]*(1-a)+g[k+1]*a)*(1-b)+(g[k+F]*(1-a)+g[k+F+1]*a)*b;}; /* groundAt on f */
 for(let j=0;j<N;j++)for(let i=0;i<N;i++)hv[j*N+i]=at(-E+i*cell,-E+j*cell);
 const col=new Int32Array(F),cu=new Float32Array(F);
 for(let fi=0;fi<F;fi++){const vx=(-fe+fi*fc+E)/cell;col[fi]=vx<0||vx>n?-1:Math.min(n-1,Math.floor(vx));cu[fi]=vx-col[fi];}
 // A sample on a cell edge reads the same on both sides (the edge is linear between its two vertices, and both take the
 // larger of their cells' sag), so each sample goes to one cell.
 for(let fj=0;fj<F;fj++){const vz=(-fe+fj*fc+E)/cell;if(vz<0||vz>n)continue;const cj=Math.min(n-1,Math.floor(vz)),v=vz-cj,row=fj*F;
  for(let fi=0;fi<F;fi++){const ci=col[fi];if(ci<0)continue;
   const u=cu[fi],a=hv[cj*N+ci],b=hv[cj*N+ci+1],c=hv[(cj+1)*N+ci],d=hv[(cj+1)*N+ci+1]; /* triangles (a,c,b) and (b,c,d), as grid() indexes them */
   const y=u+v<=1?a+u*(b-a)+v*(c-a):d+(1-u)*(c-d)+(1-v)*(b-d),s=y-g[row+fi],k=cj*n+ci;if(s>sag[k]&&!(s>.05&&wet?.(-fe+fi*fc,-fe+fj*fc)))sag[k]=s;}}
 return sag;
}
function shallowDepth(f,cell,E,n,depth,{margin=.08,deep=[]}={},wet=null){
 const N=n+1,sag=groundSag(f,cell,E,n,wet),hold=new Uint8Array(n*n),out=new Float32Array(N*N);
 const mark=(x0,z0,x1,z1)=>{const i0=Math.max(0,Math.floor((x0+E)/cell)),i1=Math.min(n-1,Math.floor((x1+E)/cell)),j0=Math.max(0,Math.floor((z0+E)/cell)),j1=Math.min(n-1,Math.floor((z1+E)/cell));for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)hold[j*n+i]=1;};
 // deep: boxes [x0,z0,x1,z1], or polygons ({rings}) marking only the cells they touch (a lawn's bounding box held the
 // bare ground half a metre down across the paths and quays around it: trees and benches there stood over a step)
 for(const b of deep||[]){if(!b.rings){mark(b[0],b[1],b[2],b[3]);continue;}const bb=b.bbox||bounds(b.rings),i0=Math.max(0,Math.floor((bb[0]+E)/cell)),i1=Math.min(n-1,Math.floor((bb[2]+E)/cell)),j0=Math.max(0,Math.floor((bb[1]+E)/cell)),j1=Math.min(n-1,Math.floor((bb[3]+E)/cell));
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const x=-E+i*cell,z=-E+j*cell;if([[0,0],[1,0],[0,1],[1,1],[.5,.5]].some(([a,c])=>pointInPolygon(x+a*cell,z+c*cell,b.rings)))hold[j*n+i]=1;}
  for(const r of b.rings)for(let k=0;k<r.length;k++){const p=r[k],q=r[(k+1)%r.length],m=Math.max(1,Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1])/2));for(let t=0;t<=m;t++){const x=p[0]+(q[0]-p[0])*t/m,z=p[1]+(q[1]-p[1])*t/m;mark(x,z,x,z);}}}
 const lake=lakeSurface();if(lake){const F=f.size,fc=f.cell,fe=f.extent;for(let k=0;k<F*F;k++)if(!Number.isNaN(lake.level[k])){const x=-fe+(k%F)*fc,z=-fe+((k/F)|0)*fc;mark(x-fc,z-fc,x+fc,z+fc);}}
 for(let j=0;j<N;j++)for(let i=0;i<N;i++){let s=0,keep=false;
  for(let cj=j-1;cj<=j;cj++)for(let ci=i-1;ci<=i;ci++){if(ci<0||cj<0||ci>=n||cj>=n)continue;const k=cj*n+ci;if(hold[k])keep=true;if(sag[k]>s)s=sag[k];}
  out[j*N+i]=keep?Math.min(depth,-(margin+s)):-(margin+s);}
 return (x,z)=>{const i=Math.round((x+E)/cell),j=Math.round((z+E)/cell);return i>=0&&j>=0&&i<N&&j<N?out[j*N+i]:depth;};
}

// Ground the material cuts away over the mapped water (wet(x,z): inside the water polygons; main.js masks them):
// it no longer has to sink under the water, which made every 10 m triangle from a quay vertex to a vertex out in
// the canal a ramp across the quay, ending in a jagged cut at the water. Per vertex of the (n+1)² grid at `cell`
// spacing from -E: null on dry land (keeps its height); for a vertex in the water with dry land among its eight
// neighbours, the raw height of the nearest dry sample of the height field (the quay or bank it continues, so its
// triangles stay level to the water's edge); undefined for vertices well out in the water and off the grid (they sink).
export function shoreVertices(f,wet,cell,E,n){
 const N=n+1,inside=new Uint8Array(N*N);
 for(let j=0;j<N;j++)for(let i=0;i<N;i++)inside[j*N+i]=wet(-E+i*cell,-E+j*cell)?1:0;
 const F=f.size,fc=f.cell,fe=f.extent,seen=new Uint8Array(F*F); // field samples: 0 unknown, 1 water, 2 dry
 const dry=k=>{if(!seen[k])seen[k]=wet(-fe+(k%F)*fc,-fe+((k/F)|0)*fc)?1:2;return seen[k]===2;};
 const land=(x,z)=>{const ci=Math.round((x+fe)/fc),cj=Math.round((z+fe)/fc);let best=Infinity,h=null;
  for(let r=0;r<=6&&best>(r-.5)*fc;r++)for(let j=cj-r;j<=cj+r;j++)for(let i=ci-r;i<=ci+r;i++){
   if(Math.max(Math.abs(i-ci),Math.abs(j-cj))!==r||i<0||j<0||i>=F||j>=F)continue;const k=j*F+i;if(!dry(k))continue;
   const d=Math.hypot(-fe+i*fc-x,-fe+j*fc-z);if(d<best){best=d;h=f.ground[k];}}
  return h;};
 return (x,z)=>{
  const i=Math.round((x+E)/cell),j=Math.round((z+E)/cell);
  if(i<0||j<0||i>=N||j>=N||Math.abs(-E+i*cell-x)>1e-6||Math.abs(-E+j*cell-z)>1e-6)return undefined;
  if(!inside[j*N+i])return null;
  let edge=false;for(let dj=-1;dj<=1&&!edge;dj++)for(let di=-1;di<=1;di++){const ii=i+di,jj=j+dj;if(ii>=0&&jj>=0&&ii<N&&jj<N&&!inside[jj*N+ii]){edge=true;break;}}
  if(!edge)return undefined;
  const h=land(x,z);return h===null?undefined:h;
 };
}

// Open water from the elevation model's `lake` layer. Each lake's level spreads up to `reach` cells onto the
// shore; the water ends on the contour where the drawn ground (half a metre below the height field, see
// createTerrainGround) rises `rise` above the surface, traced by marching squares between the grid points,
// so the shoreline follows the bank instead of stepping in 3 m squares. → {n,level,depth} per grid point
// (depth > 0 under water) or null.
let lastLake=null;
export function lakeSurface({reach=8,rise=.3,below=.05}={}){
 const f=terrain();if(!f?.lake)return null;
 const key=`${reach},${rise},${below}`;if(lastLake?.f===f&&lastLake.key===key)return lastLake.w;
 const n=f.size,level=f.lake.slice();
 // Grown pass by pass from a frontier (dry cells beside water), not by rescanning the whole grid each pass;
 // the same result: a dry cell takes the first wet neighbour's level (E, W, S, N) whose bank is low enough.
 const D=[[1,0],[-1,0],[0,1],[0,-1]],wet=k=>!Number.isNaN(level[k]),seen=new Uint8Array(n*n);
 let front=[];const queue=k=>{if(!seen[k]&&!wet(k)){seen[k]=1;front.push(k);}};
 const around=(k,fn)=>{const i=k%n,j=(k-i)/n;for(const [di,dj] of D){const ii=i+di,jj=j+dj;if(ii>=0&&jj>=0&&ii<n&&jj<n)fn(jj*n+ii);}};
 for(let k=0;k<n*n;k++)if(wet(k))around(k,queue);
 for(let pass=0;pass<reach&&front.length;pass++){const filled=[];
  for(const k of front){seen[k]=0;let v=NaN;around(k,q=>{if(Number.isNaN(v)&&wet(q)&&f.ground[q]<level[q]+.5+rise)v=level[q];});if(!Number.isNaN(v))filled.push(k,v);}
  for(let t=0;t<filled.length;t+=2)level[filled[t]]=filled[t+1];
  front=[];for(let t=0;t<filled.length;t+=2)around(filled[t],queue);}
 const depth=new Float32Array(n*n);
 for(let k=0;k<n*n;k++)depth[k]=Number.isNaN(level[k])?-1:level[k]-below+.5+rise-f.ground[k];
 const w={n,level,depth};lastLake={f,key,w};return w;
}
export function createLakeGeometry(options={}){
 const f=terrain(),w=lakeSurface(options);if(!w)return null;
 const {n,level,depth}=w,c=f.cell,E=f.extent,below=options.below??.05,pos=[];
 const X=i=>i*c-E,cut=(a,b)=>depth[a]/(depth[a]-depth[b]);
 for(let j=0;j+1<n;j++){let i=0;
  while(i+1<n){const a=j*n+i,corners=[a,a+n,a+n+1,a+1];
   if(corners.every(k=>depth[k]>0)){let e=i+1;const v=level[a];// whole cells: one quad per run at one level
    while(e+1<n&&[j*n+e,j*n+e+n,j*n+e+n+1,j*n+e+1].every(k=>depth[k]>0&&Math.abs(level[k]-v)<.005))e++;
    const y=v-below;pos.push(X(i),y,X(j),X(i),y,X(j+1),X(e),y,X(j+1),X(i),y,X(j),X(e),y,X(j+1),X(e),y,X(j));i=e;continue;}
   if(corners.some(k=>depth[k]>0)){// shore cell: the wet corners and the interpolated crossings, in order
    const xz=[[X(i),X(j)],[X(i),X(j+1)],[X(i+1),X(j+1)],[X(i+1),X(j)]],poly=[];let sum=0,wet=0;
    for(let q=0;q<4;q++){const k=corners[q],k2=corners[(q+1)%4],p=xz[q],p2=xz[(q+1)%4];
     if(depth[k]>0){poly.push(p);sum+=level[k];wet++;}
     if((depth[k]>0)!==(depth[k2]>0)){const t=cut(k,k2);poly.push([p[0]+(p2[0]-p[0])*t,p[1]+(p2[1]-p[1])*t]);}}
    const y=sum/wet-below;for(let q=1;q+1<poly.length;q++)pos.push(poly[0][0],y,poly[0][1],poly[q][0],y,poly[q][1],poly[q+1][0],y,poly[q+1][1]);}
   i++;}}
 if(!pos.length)return null;
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();g.computeBoundingSphere();return g;
}
// Paints the lakes onto a map canvas whose context is already in world metres (the minimap).
export function drawLakeMap(ctx,color){
 const f=terrain(),w=lakeSurface();if(!w||typeof document==='undefined')return false;
 const {n,depth}=w,canvas=document.createElement('canvas');canvas.width=canvas.height=n;
 const x=canvas.getContext('2d'),img=x.createImageData(n,n),rgb=parseInt(color.slice(1),16);
 for(let k=0;k<n*n;k++)if(depth[k]>0){img.data[k*4]=rgb>>16;img.data[k*4+1]=rgb>>8&255;img.data[k*4+2]=rgb&255;img.data[k*4+3]=255;}
 x.putImageData(img,0,0);ctx.imageSmoothingEnabled=true;ctx.drawImage(canvas,-f.extent-f.cell/2,-f.extent-f.cell/2,n*f.cell,n*f.cell);
 return true;
}
