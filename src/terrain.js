// Ground elevation for cities with terrain (public/cities/<id>/terrain.pack, scripts/city-terrain.mjs).
// One shared bilinear height field: physics, traffic, people and every placed object ask groundAt(x,z).
// Without a terrain file (Helsinki) every lookup is 0 and the world stays flat.
//
// File format (little endian): 'TERR', uint32 header length, JSON header, padding to 4 bytes, then one
// Uint16 grid per layer (size×size, row-major, rows run +z). Each row stores its first value and then
// differences mod 65536, which gzip squeezes well. Ground: min+v*scale. Water (mapped water bodies) and lake
// (open water found in the elevation model only): 0 = none, else min+(v-1)*scale.

const MAGIC='TERR';
export function encodeTerrain({size,cell,extent,base=0,scale=.01,ground,water=null,lake=null,source=''}){
 const layers=[['ground',ground,false],['water',water,true],['lake',lake,true]].filter(l=>l[1]),meta=[];
 const grids=layers.map(([name,values,optional])=>{
  let min=Infinity;for(const v of values)if(Number.isFinite(v)&&v<min)min=v;if(!Number.isFinite(min))min=0;min=Math.floor(min/scale)*scale;
  const q=new Uint16Array(size*size);
  for(let i=0;i<q.length;i++){const v=values[i];q[i]=Number.isFinite(v)?Math.min(65535,Math.round((v-min)/scale)+(optional?1:0)):0;}
  for(let r=0;r<size;r++)for(let c=size-1;c>0;c--){const i=r*size+c;q[i]=(q[i]-q[i-1])&65535;}
  meta.push({name,min:+min.toFixed(4),optional});return q;
 });
 const header=new TextEncoder().encode(JSON.stringify({version:1,size,cell,extent,base,scale,layers:meta,source}));
 const start=Math.ceil((8+header.length)/4)*4,out=new Uint8Array(start+grids.length*size*size*2),view=new DataView(out.buffer);
 out.set(new TextEncoder().encode(MAGIC),0);view.setUint32(4,header.length,true);out.set(header,8);
 grids.forEach((q,k)=>{const o=start+k*size*size*2;for(let i=0;i<q.length;i++)view.setUint16(o+i*2,q[i],true);});
 return out;
}
// → {size,cell,extent,base,ground:Float32Array (relative to base), water:Float32Array|null (NaN = none), source}
export function decodeTerrain(buffer){
 const bytes=buffer instanceof Uint8Array?buffer:new Uint8Array(buffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(new TextDecoder().decode(bytes.subarray(0,4))!==MAGIC)throw Error('Not a terrain file');
 const length=view.getUint32(4,true),h=JSON.parse(new TextDecoder().decode(bytes.subarray(8,8+length))),start=Math.ceil((8+length)/4)*4,n=h.size*h.size,out={...h,water:null,lake:null};
 h.layers.forEach((layer,k)=>{
  const values=new Float32Array(n),o=start+k*n*2;
  for(let r=0;r<h.size;r++){let v=0;for(let c=0;c<h.size;c++){const i=r*h.size+c;v=(c?v+view.getUint16(o+i*2,true):view.getUint16(o+i*2,true))&65535;
   values[i]=layer.optional?(v?layer.min+(v-1)*h.scale-h.base:NaN):layer.min+v*h.scale-h.base;}}
  out[layer.name]=values;
 });
 return out;
}

let field=null;
export function setTerrain(f){field=f||null;return field;}
export const terrain=()=>field;
export const hasTerrain=()=>field!==null;

// Bilinear ground height in metres relative to the city's base level; 0 when the city is flat.
export function groundAt(x,z){
 const f=field;if(f===null)return 0;
 const n=f.size-1;let u=(x+f.extent)/f.cell,v=(z+f.extent)/f.cell;
 u=u<0?0:u>n?n:u;v=v<0?0:v>n?n:v;
 let i=Math.floor(u),j=Math.floor(v);if(i===n)i--;if(j===n)j--;
 const a=u-i,b=v-j,g=f.ground,k=j*f.size+i;
 return (g[k]*(1-a)+g[k+1]*a)*(1-b)+(g[k+f.size]*(1-a)+g[k+f.size+1]*a)*b;
}
// The common water level (median of every levelled water sample): the harbour. For mapped water the field
// gave no level (narrow slips, small basins), so it is not draped onto the sea bed and out of sight.
let seaCache=null;
export function seaLevel(f=field){
 if(!f?.water)return null;if(seaCache?.f===f)return seaCache.v;
 const v=[];for(let k=0;k<f.water.length;k+=7)if(!Number.isNaN(f.water[k]))v.push(f.water[k]);v.sort((a,b)=>a-b);
 seaCache={f,v:v.length?v[v.length>>1]:null};return seaCache.v;
}
// Water surface height (relative to base) where mapped water has a level, else null.
export function waterAt(x,z){
 const f=field;if(f===null||!f.water)return null;
 const n=f.size-1,u=Math.max(0,Math.min(n,(x+f.extent)/f.cell)),v=Math.max(0,Math.min(n,(z+f.extent)/f.cell));
 const i=Math.min(n-1,Math.floor(u)),j=Math.min(n-1,Math.floor(v)),a=u-i,b=v-j,w=f.water,k=j*f.size+i;
 let sum=0,weight=0;
 for(const [q,s] of [[k,(1-a)*(1-b)],[k+1,a*(1-b)],[k+f.size,(1-a)*b],[k+f.size+1,a*b]])if(!Number.isNaN(w[q])){sum+=w[q]*s;weight+=s;}
 return weight>1e-6?sum/weight:null;
}
// Ground gradient (dh/dx, dh/dz) by central differences over one metre.
export function slopeAt(x,z,out=[0,0]){
 if(field===null){out[0]=out[1]=0;return out;}
 out[0]=(groundAt(x+.5,z)-groundAt(x-.5,z));out[1]=(groundAt(x,z+.5)-groundAt(x,z-.5));return out;
}
// Lowest ground under a footprint (rings of [x,z]): buildings stand on it so no corner floats.
export function footprintBase(rings,step=4){
 if(field===null)return 0;let low=Infinity;
 for(const ring of rings||[])for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step));
  for(let k=0;k<n;k++){const h=groundAt(a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n);if(h<low)low=h;}}
 return Number.isFinite(low)?low:0;
}
// Adds the ground height under each vertex to its y (world-space positions; interleaved attributes work too).
export function drapePositions(position,{lift=0,water=false}={}){
 if(field===null||!position)return position;
 for(let i=0;i<position.count;i++){const x=position.getX(i),z=position.getZ(i),w=water?waterAt(x,z):null;position.setY(i,position.getY(i)+(w??groundAt(x,z))+lift);}
 position.needsUpdate=true;return position;
}
// Pose of a body resting on the ground at x,z facing heading (forward is -sin,-cos as everywhere in the game):
// height (never below the ground under its centre), pitch (nose up positive) and roll (right side up positive).
export function groundPose(x,z,heading,halfLength=2.2,halfWidth=.9,out={y:0,pitch:0,roll:0}){
 if(field===null){out.y=out.pitch=out.roll=0;return out;}
 const s=Math.sin(heading),c=Math.cos(heading);
 const front=groundAt(x-s*halfLength,z-c*halfLength),back=groundAt(x+s*halfLength,z+c*halfLength),right=groundAt(x+c*halfWidth,z-s*halfWidth),left=groundAt(x-c*halfWidth,z+s*halfWidth);
 out.y=Math.max(groundAt(x,z),(front+back)/2,(left+right)/2);out.pitch=Math.atan2(front-back,2*halfLength);out.roll=Math.atan2(right-left,2*halfWidth);
 return out;
}
// Building tiles ([x,y,z,u,v] per vertex, parts with start/count): each part stands on the lowest ground
// under its own vertices, so the downhill side never floats; the uphill side runs into the slope. Parts marked `abs`
// carry surveyed heights on this terrain and stay where they are.
export function liftBuildings(array,parts){
 if(field===null)return;
 for(const p of parts){
  if(p.abs){let lo=Infinity;for(let i=p.start;i<p.start+p.count;i++){const y=array[i*5+1];if(y<lo)lo=y;}p.base=lo;continue;} // surveyed heights on this terrain already (scripts/kk-buildings.py)
  let low=Infinity;for(let i=p.start;i<p.start+p.count;i++){const h=groundAt(array[i*5],array[i*5+2]);if(h<low)low=h;}
  if(!Number.isFinite(low))continue;p.base=low;for(let i=p.start;i<p.start+p.count;i++)array[i*5+1]+=low;}
}
// Open water found only in the elevation model (src/terrain.js `lake` layer): its level at x,z, else null.
export function lakeAt(x,z){
 const f=field;if(f===null||!f.lake)return null;
 const i=Math.round((x+f.extent)/f.cell),j=Math.round((z+f.extent)/f.cell);if(i<0||j<0||i>=f.size||j>=f.size)return null;
 const v=f.lake[j*f.size+i];return Number.isNaN(v)?null:v;
}

// Cities whose mapped water is level within each body (Copenhagen's harbour, canals and moats are all at sea
// level): the elevation model still put bumps of a few metres into the water layer along narrow canals and
// under bridges, which drew the water surface as a ramp over the quay. Each 4-connected water region of the
// grid takes its median level.
// The water level is spread a few cells onto the banks, and the elevation model sometimes reads a pier or a
// quay edge at sea-bed height. Where that happens outside the mapped water (isWet false) the ground showed as
// a dark pit beside the promenade that the car and people could drop into: raise those samples to quay
// height (lift metres above the water). Returns the number of samples raised.
// A raised sample never ends up above the dry ground around it (the median of the samples within `reach` cells that
// are not hollows themselves): a pond or a canal whose level the model put above the street beside it (Højbro Plads
// and a pond in the 1760 town lie below the level spread from their water) had single samples lifted 1.6-2 m out of
// a flat square, and the pavement draped over them showed crumpled spikes.
export function raiseDryHollows(isWet,{lift=1.6,below=1.2,shelf=true,reach=3}={},f=field){
 if(!f?.water)return 0;const n=f.size,w=f.water,g=f.ground,sea=seaLevel(f);let raised=0;
 // wet: 1 = inside the mapped water, 2 = dry land. Deep samples are water without asking the polygons.
 const wet=new Uint8Array(n*n),at=k=>{if(!wet[k]){const wl=w[k];wet[k]=!Number.isNaN(wl)&&(g[k]<wl-2.5||isWet(-f.extent+(k%n)*f.cell,-f.extent+((k/n)|0)*f.cell))?1:2;}return wet[k];};
 const hollow=new Uint8Array(n*n),target=new Float32Array(n*n);
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){const k=j*n+i,wl=Number.isNaN(w[k])?sea:w[k];if(wl===null||g[k]>=wl+below)continue; // away from water: pits below the harbour level (light wells, survey noise)
  if(at(k)===1)continue;hollow[k]=1;target[k]=wl+lift;}
 const vals=[],set=[];
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){const k=j*n+i;if(!hollow[k])continue;vals.length=0;
  for(let r=Math.max(0,j-reach);r<=Math.min(n-1,j+reach);r++)for(let c=Math.max(0,i-reach);c<=Math.min(n-1,i+reach);c++){const q=r*n+c;if(hollow[q]||Number.isNaN(g[q]))continue;if(!Number.isNaN(w[q])&&at(q)===1)continue;vals.push(g[q]);}
  let to=target[k];if(vals.length>=3){vals.sort((a,b)=>a-b);to=Math.min(to,vals[vals.length>>1]);}
  if(to>g[k]+.02)set.push(k,to);}
 for(let x=0;x<set.length;x+=2)g[set[x]]=set[x+1];raised+=set.length/2;
 // Quay shelf: the first water sample beside dry land takes the land's height, so the bilinear ground under
 // a pavement running to the quay edge stays level instead of sloping down into the water over the last 3 m.
 // (Drawn ground under water is sunk below the surface anyway; the quay wall hides the step.)
 if(shelf){const set=[];
  for(let j=1;j<n-1;j++)for(let i=1;i<n-1;i++){const k=j*n+i;if(Number.isNaN(w[k])||at(k)!==1||g[k]>=w[k]+below)continue;let top=-Infinity;
   for(const q of [k-1,k+1,k-n,k+n])if(at(q)===2&&g[q]>top)top=g[q];if(top>g[k])set.push(k,top);}
  for(let x=0;x<set.length;x+=2)g[set[x]]=set[x+1];raised+=set.length/2;}
 return raised;
}
// Banks: the elevation model is blurred over a few metres, so a quay or lake edge (a stone wall in the city)
// became a slope running 10-15 m inland, and the pavements and paths along the water were draped over it tilted
// and creased. Dry ground within `reach` metres of the mapped water is raised to the level of the land just behind
// it (the median of dry samples just beyond `reach`, never more than `maxRaise` up); the quay wall then takes the
// drop at the water's edge. Returns the number of samples raised.
// The quay shelf: afterwards every water sample beside dry land (8 neighbours) takes the height of that land, so each
// grid cell the shoreline crosses is level and groundAt along the water's edge is the quay's height. The blurred
// bank used to start inside those cells: the walls' coping and the paving and ground running up to the edge sagged
// and wobbled towards the water (the drop now happens a cell further out, under the water).
export function levelBanks(isWet,{reach=12,maxRaise=1.4,shelf=true}={},f=field){
 if(!f?.water)return 0;const n=f.size,g=f.ground,w=f.water,cell=f.cell,R=Math.max(1,Math.round(reach/cell));
 const wet=new Uint8Array(n*n);for(let k=0;k<n*n;k++)if(!Number.isNaN(w[k]))wet[k]=isWet(-f.extent+(k%n)*cell,-f.extent+((k/n)|0)*cell)?1:2;
 // distance (in cells, Chebyshev) from the mapped water, up to R+3
 const D=R+3,dist=new Uint8Array(n*n).fill(255),queue=[];for(let k=0;k<n*n;k++)if(wet[k]===1){dist[k]=0;queue.push(k);}
 for(let h=0;h<queue.length;h++){const k=queue[h],d=dist[k];if(d>=D)continue;const r=(k/n)|0,c=k-r*n;
  for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){const rr=r+dr,cc=c+dc;if(rr<0||cc<0||rr>=n||cc>=n)continue;const q=rr*n+cc;if(dist[q]>d+1){dist[q]=d+1;queue.push(q);}}}
 const target=new Float32Array(n*n).fill(NaN),vals=[],ring=Array.from({length:R+1},()=>[]);
 for(let j=0;j<n;j++)for(let i=0;i<n;i++){const k=j*n+i,d=dist[k];if(d===0||d>R)continue;ring[d].push(k);
  vals.length=0;const r0=Math.max(0,j-D),r1=Math.min(n-1,j+D),c0=Math.max(0,i-D),c1=Math.min(n-1,i+D);
  for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++){const q=r*n+c,dq=dist[q];if(dq>R&&dq<=R+3)vals.push(g[q]);}
  if(vals.length<3)continue;vals.sort((a,b)=>a-b);const behind=vals[vals.length>>1];
  if(behind>g[k]+.08)target[k]=Math.min(behind,g[k]+maxRaise);}
 // A deep sample is raised by maxRaise rather than skipped (skipping it left a 1.4 m cliff across the bank where the
 // raise stopped: creases in the pavements along the 1760 quays), and no sample ends up above the samples one step
 // farther from the water (on a long slope such as a rampart the raised band stood as a ridge in front of the
 // unraised ground behind it). Inland first, so each ring sees the final heights of the ring behind it.
 let raised=0;
 for(let d=R;d>=1;d--)for(const k of ring[d]){const r=(k/n)|0,c=k-r*n;let behind=Infinity;
  for(let dr=-1;dr<=1;dr++)for(let dc=-1;dc<=1;dc++){const rr=r+dr,cc=c+dc;if(rr<0||cc<0||rr>=n||cc>=n)continue;const q=rr*n+cc;if(dist[q]===d+1&&g[q]<behind)behind=g[q];}
  const t=Number.isNaN(target[k])?g[k]:target[k],v=Math.max(g[k],Math.min(t,behind));if(v>g[k]){g[k]=v;raised++;}}
 if(shelf){const up=[];
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){const k=j*n+i;if(wet[k]!==1)continue;let top=-Infinity;
   for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){const ii=i+di,jj=j+dj;if((di||dj)&&ii>=0&&jj>=0&&ii<n&&jj<n&&wet[jj*n+ii]!==1&&g[jj*n+ii]>top)top=g[jj*n+ii];}
   if(top>g[k])up.push(k,top);}
  for(let x=0;x<up.length;x+=2)g[up[x]]=up[x+1];raised+=up.length/2;}
 return raised;
}
// Water the elevation model never saw (1760's moat, dug where today's city stands on flat ground): its level came out
// at street height, so the causeways and the moat were one surface and the waves showed through the road. A water
// body whose level is within `clearance` of the dry ground around it is sunk `depth` below that ground, with its bed
// below the water; the quay walls then stand at its edges. Returns the number of water bodies sunk.
export function sinkShallowWater(isWet,{depth=1.8,bed=1.3,clearance=1}={},f=field){
 if(!f?.water)return 0;const n=f.size,w=f.water,g=f.ground,cell=f.cell,label=new Int32Array(n*n).fill(-1),stack=[];let sunk=0;
 const wet=new Uint8Array(n*n);for(let k=0;k<n*n;k++)if(!Number.isNaN(w[k]))wet[k]=isWet(-f.extent+(k%n)*cell,-f.extent+((k/n)|0)*cell)?1:2;
 for(let s=0;s<n*n;s++){if(wet[s]!==1||label[s]>=0)continue;
  const cells=[];label[s]=s;stack.push(s);
  while(stack.length){const k=stack.pop();cells.push(k);const r=(k/n)|0,c=k-r*n;
   const visit=q=>{if(label[q]<0&&wet[q]===1){label[q]=s;stack.push(q);}};if(c>0)visit(k-1);if(c<n-1)visit(k+1);if(r>0)visit(k-n);if(r<n-1)visit(k+n);}
  const shore=[];for(const k of cells){const r=(k/n)|0,c=k-r*n;for(const q of [c>0?k-1:-1,c<n-1?k+1:-1,r>0?k-n:-1,r<n-1?k+n:-1])if(q>=0&&wet[q]!==1)shore.push(g[q]);}
  if(shore.length<4)continue;shore.sort((a,b)=>a-b);const land=shore[shore.length>>1];
  const level=cells.reduce((m,k)=>Math.max(m,w[k]),-Infinity);
  if(level<land-clearance)continue; // a real basin: its level sits well below the banks already
  const to=land-depth;for(const k of cells){w[k]=Math.min(w[k],to);g[k]=Math.min(g[k],to-bed);}
  // the level spread onto the banks around it comes down too (the water surface is drawn from it near the edge)
  for(const k of cells){const r=(k/n)|0,c=k-r*n;for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++){const rr=r+dr,cc=c+dc;if(rr<0||cc<0||rr>=n||cc>=n)continue;const q=rr*n+cc;if(wet[q]===2&&w[q]>to)w[q]=to;}}
  sunk++;}
 return sunk;
}
// Bridges the elevation model never saw (the 1760 moat and canal crossings, footbridges mapped across a canal): the
// railing builder (quay.js) draws a deck plate over the water, but groundAt read the canal bed under it, so whatever
// drove onto the bridge dropped into the water beneath the deck. Water samples inside a drawn deck, or close enough
// that the bilinear ground at its edge would slope down off it, are raised to 12 cm under the deck's surface (decks:
// [{rings, y}], y the plate's height as drawn): a car's ride height puts its wheels on the plate, and the street surfaces
// draped on the ground stay under the plate (level with it they showed through as odd two-tone patches). Returns the
// number of samples raised.
export function raiseBridgeDecks(decks,isWet,f=field){
 if(!f||!decks?.length)return 0;const n=f.size,g=f.ground,cell=f.cell,E=f.extent;let raised=0;
 const segDist=(x,z,r)=>{let best=Infinity;for(let i=0,m=r.length;i<m;i++){const [ax,az]=r[i],[bx,bz]=r[(i+1)%m],dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l)):0;best=Math.min(best,Math.hypot(x-ax-dx*t,z-az-dz*t));}return best;};
 for(const d of decks){const r=d.rings[0];if(!(r?.length>2)||!Number.isFinite(d.y))continue;let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;for(const [x,z] of r){x0=Math.min(x0,x);z0=Math.min(z0,z);x1=Math.max(x1,x);z1=Math.max(z1,z);}
  const top=d.y-.12,i0=Math.max(0,Math.floor((x0+E)/cell)-1),i1=Math.min(n-1,Math.ceil((x1+E)/cell)+1),j0=Math.max(0,Math.floor((z0+E)/cell)-1),j1=Math.min(n-1,Math.ceil((z1+E)/cell)+1);
  for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){const k=j*n+i;if(g[k]>=top-1e-3)continue;const x=-E+i*cell,z=-E+j*cell; // (float32 samples: a raised one reads a hair under top)
   if(!isWet(x,z))continue;let c=false;for(let a=0,m=r.length,b=m-1;a<m;b=a++){const [xa,za]=r[a],[xb,zb]=r[b];if((za>z)!==(zb>z)&&x<(xb-xa)*(z-za)/(zb-za)+xa)c=!c;}
   if(!c&&segDist(x,z,r)>cell*.9)continue;g[k]=top;raised++;}}
 return raised;
}
export function flattenWaterBodies(f=field){
 if(!f?.water)return 0;const w=f.water,n=f.size,label=new Int32Array(n*n).fill(-1),stack=[];let regions=0;
 for(let s=0;s<n*n;s++){if(Number.isNaN(w[s])||label[s]>=0)continue;
  const cells=[];label[s]=regions;stack.push(s);
  while(stack.length){const k=stack.pop();cells.push(k);const r=(k/n)|0,c=k-r*n;
   const visit=q=>{if(label[q]<0&&!Number.isNaN(w[q])){label[q]=regions;stack.push(q);}};if(c>0)visit(k-1);if(c<n-1)visit(k+1);if(r>0)visit(k-n);if(r<n-1)visit(k+n);}
  const vals=Float32Array.from(cells,k=>w[k]).sort(),mid=vals[vals.length>>1];for(const k of cells)if(w[k]>mid)w[k]=mid;regions++;} // only bumps come down; nothing is raised
 return regions;
}
