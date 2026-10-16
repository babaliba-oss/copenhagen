import * as THREE from 'three';
import {groundAt,waterAt,hasTerrain,terrain,footprintBase,seaLevel} from './terrain.js';

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
export function createTerrainGround(material,{cell=10,chunk=32,size=11000,depth=-.5,wet=null}={}){
 const f=terrain(),group=new THREE.Group();group.name='Terrain ground';if(!f)return group;
 const E=Math.floor(f.extent/cell)*cell,n=Math.round(2*E/cell);
 const grid=(xs,zs)=>{const pos=[],nor=[],idx=[],w=xs.length;
  // Under (or next to) water the ground drops 2 m below the water surface: the elevation model's ground is often
  // above the water layer in the harbour and canals, and drawing it there hid the water (the "muddy" harbour).
  const sink=(x,z)=>{let w=null;for(const [a,b] of [[0,0],[cell/2,0],[-cell/2,0],[0,cell/2],[0,-cell/2]]){const v=waterAt(x+a,z+b);if(v!=null)w=w==null?v:Math.min(w,v);}return w;};
  for(const z of zs)for(const x of xs){const g0=groundAt(x,z),w0=sink(x,z),w=w0!=null&&(g0<w0+1||wet?.(x,z))?w0:null; // banks well above the water (quays) keep their height: sinking every vertex near a canal dug pits beside the streets
   pos.push(x,w==null?g0+depth:Math.min(g0+depth,w-2),z);const dx=groundAt(x+1,z)-groundAt(x-1,z),dz=groundAt(x,z+1)-groundAt(x,z-1),l=Math.hypot(dx,2,dz);nor.push(-dx/l,2/l,-dz/l);}
  for(let j=0;j+1<zs.length;j++)for(let i=0;i+1<w;i++){const a=j*w+i,b=a+1,c=a+w,d=c+1;idx.push(a,c,b,b,c,d);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));g.setIndex(idx);g.computeBoundingSphere();g.computeBoundingBox();return g;};
 const range=(a,b,step)=>{const out=[];for(let x=a;x<b-1e-6;x+=step)out.push(x);out.push(b);return out;};
 for(let cz=0;cz<n;cz+=chunk)for(let cx=0;cx<n;cx+=chunk){
  const xs=range(-E+cx*cell,-E+Math.min(n,cx+chunk)*cell,cell),zs=range(-E+cz*cell,-E+Math.min(n,cz+chunk)*cell,cell);
  const m=new THREE.Mesh(grid(xs,zs),material);m.receiveShadow=true;m.name='Terrain chunk';group.add(m);}
 // Skirt: four coarse strips around the fine square, clamped to the edge heights.
 const H=size/2,coarse=125,side=range(-H,-E,coarse),far=range(E,H,coarse),mid=range(-E,E,coarse);
 for(const [xs,zs] of [[[...side,...mid.slice(1),...far.slice(1)],side],[[...side,...mid.slice(1),...far.slice(1)],far],[side,mid],[far,mid]]){const m=new THREE.Mesh(grid(xs,zs),material);m.receiveShadow=true;m.name='Terrain skirt';group.add(m);}
 group.userData={cell,chunks:group.children.length};
 return group;
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
