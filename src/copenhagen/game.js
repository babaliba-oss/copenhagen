// Copenhagen game layer (ported from Grand Theft Ladcykel): delivery jobs with a GPS line that is eaten
// as you ride it, money, and sagas from Danish history and folklore given by named characters, with lore
// cards, a journal (J) and a hand-drawn treasure map (K). Runs on top of the shared engine: it only reads
// the player's position and travel mode, draws its own markers and HUD, and plugs its characters into the
// shared conversation system (characters.js).
import * as THREE from 'three';
import {loadOneMesh} from './gait.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import proj4 from 'proj4';
import {groundAt} from '../terrain.js';
import {SpatialIndex,bounds,inWaterPolygons} from '../geo.js';
import {JOBS,JOBS_1760,SAGAS,CHARACTERS} from './data.js';
import {connectCharacters} from './characters.js';
import {createPant,PANT_KR} from './pant.js';
import './copenhagen.css';

const SAVE_KEY='cph-game-v1';
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtKr=n=>Math.round(n).toLocaleString('en-GB'); /* English UI: 1,500 kr (da-DK wrote 1.500, read as 1.5) */let UNIT='kr'; // 1760: skilling (96 to the rigsdaler)
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
// ---------- routing (shortest paths over the city's walk or road graph) ----------
// ---------- routing (A* over the city's walk or road graph) ----------
function makeGraph(g,undirected){
 const n=g.nodes.length,adj=Array.from({length:n},()=>[]);
 for(const e of g.edges){const len=e.length||e.points.reduce((s,p,i)=>i?s+dist(p,e.points[i-1]):0,0);adj[e.from].push({to:e.to,len,points:e.points});if(undirected)adj[e.to].push({to:e.from,len,points:[...e.points].reverse()});}
 const cell=new Map(),C=60;g.nodes.forEach((p,i)=>{if(!adj[i].length)return;const k=Math.floor(p[0]/C)+','+Math.floor(p[1]/C);if(!cell.has(k))cell.set(k,[]);cell.get(k).push(i);});
 function nearest(x,z){let best=-1,bd=1e18;for(let r=0;r<6&&best<0;r++)for(let i=-r;i<=r;i++)for(let j=-r;j<=r;j++){if(Math.max(Math.abs(i),Math.abs(j))!==r)continue;for(const k of cell.get((Math.floor(x/C)+i)+','+(Math.floor(z/C)+j))||[]){const d=(g.nodes[k][0]-x)**2+(g.nodes[k][1]-z)**2;if(d<bd){bd=d;best=k;}}}return best;}
 // Routes come from a shortest-path tree grown back from the target (Dijkstra over the reversed edges, a binary heap in
 // typed arrays), kept for the last few targets: a rebuild then only walks the tree from the player's node. A* from the
 // player ran on every rebuild (every few seconds off the line) and, to a target behind water such as the Opera, it
 // searched most of the city: 30-90 ms each time, a hitch while driving the first job. A tree is grown only as far as the
 // player's node (Dijkstra settles the nodes nearest the target first) and picks up where it stopped next time; warm()
 // grows the next target's tree a slice at a time in idle time, so a pick-up or delivery does not build one in a frame.
 const radj=Array.from({length:n},()=>[]);adj.forEach((l,v)=>{for(const e of l)radj[e.to].push(v,e);});
 const trees=new Map();
 function tree(b,avoid){
  const key=b*2+(avoid?1:0),had=trees.get(key);if(had){trees.delete(key);trees.set(key,had);return had;}
  const t={key,avoid,d:new Float64Array(n).fill(Infinity),next:new Array(n).fill(null),done:new Uint8Array(n),hf:new Float64Array(1024),hv:new Int32Array(1024),hn:0,finished:false};t.d[b]=0;push(t,0,b);
  trees.set(key,t);if(trees.size>6)trees.delete(trees.keys().next().value);return t;
 }
 function push(t,f,v){if(t.hn===t.hf.length){const F=new Float64Array(t.hn*2),V=new Int32Array(t.hn*2);F.set(t.hf);V.set(t.hv);t.hf=F;t.hv=V;}const hf=t.hf,hv=t.hv;let i=t.hn++;while(i>0){const p=(i-1)>>1;if(hf[p]<=f)break;hf[i]=hf[p];hv[i]=hv[p];i=p;}hf[i]=f;hv[i]=v;}
 // Settle nodes until `until` is settled (-1: none), the tree is complete or `pops` nodes have come off the heap.
 function grow(t,until,pops){const {d,next,done,avoid}=t;
  while(t.hn>0&&pops-->0){const hf=t.hf,hv=t.hv,f=hf[0],u=hv[0];let hn=--t.hn;if(hn>0){const lf=hf[hn],lv=hv[hn];let i=0;for(;;){const L=i*2+1,R=L+1;let m=-1,mf=lf;if(L<hn&&hf[L]<mf){m=L;mf=hf[L];}if(R<hn&&hf[R]<mf)m=R;if(m<0)break;hf[i]=hf[m];hv[i]=hv[m];i=m;}hf[i]=lf;hv[i]=lv;}
   if(done[u])continue;done[u]=1;const into=radj[u];for(let k=0;k<into.length;k+=2){const v=into[k],e=into[k+1];if(avoid&&e.walled)continue;const nd=f+e.len;if(nd<d[v]){d[v]=nd;next[v]=e;push(t,nd,v);}}
   if(u===until)return;}
  if(t.hn===0){t.finished=true;t.d=t.done=t.hf=t.hv=null;}} /* complete: only next[] is needed from here on */
 // Grow the tree to b (as route(..., blocked) uses it) for about `ms`; true once it is complete.
 function warm(b,ms,avoid=true){if(b<0)return true;const t=tree(b,avoid),end=performance.now()+ms;while(!t.finished&&performance.now()<end)grow(t,-1,512);return t.finished;}
 // blocked(x,z): what the player's car runs into. An edge whose line runs through it (over 0.3 m: the model's road walls
 // are 0.6 m thick; a passage the model draws shut, a courtyard gate, a footway main.js drops as running through a house)
 // is left out: the route found is checked edge by edge (each judged once, then remembered) and, when it uses a walled one,
 // found again from a fresh tree that leaves those out, up to 6 times. The GPS line and the races led straight into the
 // wall (Christians Brygge under the Black Diamond).
 const walled=(P,blocked)=>{let run=0;for(let i=1;i<P.length;i++){const L=dist(P[i],P[i-1]),k=Math.ceil(L/.5);for(let j=0;j<k;j++){if(blocked(P[i-1][0]+(P[i][0]-P[i-1][0])*(j+.5)/k,P[i-1][1]+(P[i][1]-P[i-1][1])*(j+.5)/k)){run+=L/k;if(run>.3)return true;}else run=0;}}return false;};
 function route(a,b,blocked){
  if(a<0||b<0)return null;let edges=null;
  for(let t=0;t<6;t++){const T=tree(b,!!blocked);if(!T.finished&&!T.done[a])grow(T,a,Infinity);const next=T.next;edges=[];for(let v=a,k=0;v!==b;k++){const e=next[v];if(!e||k>n){edges=null;break;}edges.push(e);v=e.to;}
   if(!edges||!blocked)break;let hit=false;for(const e of edges){if(e.walled===undefined)e.walled=walled(e.points,blocked);if(e.walled)hit=true;}if(!hit)break;trees.delete(T.key);if(t===5)edges=null;}
  if(!edges)return null;const pts=[g.nodes[a]];for(const e of edges)for(let i=1;i<e.points.length;i++)pts.push(e.points[i]);return pts;
 }
 // The node nearest a target is often across a block (the road graph misses the pedestrian streets): the line then
 // ran its last stretch straight through the houses. Take the nearest node within 180 m with a clear straight run to the target.
 // Remembered per spot (every rebuild asks again for the same target; up to 13 ms where no node is in clear sight).
 const opened=new Map();let openedFor=null;
 function nearestOpen(x,z,blocked){if(!blocked)return nearest(x,z);if(openedFor!==blocked){opened.clear();openedFor=blocked;}const key=x+','+z;let k=opened.get(key);if(k===undefined){k=findOpen(x,z,blocked);if(opened.size>64)opened.clear();opened.set(key,k);}return k;}
 function findOpen(x,z,blocked){const gx=Math.floor(x/C),gz=Math.floor(z/C),c=[];
  for(let i=-3;i<=3;i++)for(let j=-3;j<=3;j++)for(const k of cell.get((gx+i)+','+(gz+j))||[])c.push([Math.hypot(g.nodes[k][0]-x,g.nodes[k][1]-z),k]);
  c.sort((a,b)=>a[0]-b[0]);
  for(let q=0;q<c.length&&q<24;q++)if(clear(c[q][1],x,z,blocked))return c[q][1];
  return nearest(x,z);}
 // A straight run from node k to (x,z) with nothing solid on it (every 25 cm: the model's road walls are 0.6 m thick).
 function clear(k,x,z,blocked){if(k<0)return false;const [nx,nz]=g.nodes[k],m=Math.ceil(Math.hypot(x-nx,z-nz)*4);for(let s=1;s<m;s++)if(blocked(nx+(x-nx)*s/m,nz+(z-nz)*s/m))return false;return true;}
 return {nearest,nearestOpen,clear,route,warm,nodes:g.nodes};
}

// ---------- the line on the street (eaten from behind as you ride it) ----------
// 1760: a warm lantern-gold trail instead of the modern sat-nav purple.
function createRouteLine(scene,{historic=false}={}){
 const u={uProg:{value:0}},mat=new THREE.MeshBasicMaterial({color:historic?0xf0c060:0xb46bff,transparent:true,opacity:historic?.5:.62,depthWrite:false,fog:false});
 mat.onBeforeCompile=sh=>{sh.uniforms.uProg=u.uProg;
  sh.vertexShader=sh.vertexShader.replace('void main() {','attribute float rd; varying float vRd;\nvoid main() { vRd = rd;');
  sh.fragmentShader=sh.fragmentShader.replace('void main() {','uniform float uProg; varying float vRd;\nvoid main() { if (vRd < uProg) discard;').replace('vec4 diffuseColor = vec4( diffuse, opacity );','vec4 diffuseColor = vec4( diffuse, opacity * clamp((vRd - uProg) / 6.0, 0.0, 1.0) );');};
 let mesh=null,pts=null,cum=null,seg=0;const out={points:null,off:0};
 out.set=points=>{if(mesh){scene.remove(mesh);mesh.geometry.dispose();mesh=null;}pts=points;out.points=points;seg=0;u.uProg.value=0;if(!points||points.length<2)return;
  cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+dist(pts[i],pts[i-1]));
  // One continuous strip with mitred joins: separate quads per segment overlapped at every bend, and the
  // overlaps showed as darker wedges through the transparent ribbon.
  const P=[],C=[];for(let i=0;i<pts.length;i++){if(P.length&&dist(pts[i],P.at(-1))<.4){if(i===pts.length-1&&P.length>1){P[P.length-1]=pts[i];C[C.length-1]=cum[i];}continue;}P.push(pts[i]);C.push(cum[i]);}
  if(P.length<2){pts=null;out.points=null;return;}
  const pos=[],rd=[],side=[];
  for(let i=0;i<P.length;i++){const a=P[Math.max(0,i-1)],b=P[i],c=P[Math.min(P.length-1,i+1)];
   const n1=i>0?[-(b[1]-a[1]),b[0]-a[0]]:null,n2=i<P.length-1?[-(c[1]-b[1]),c[0]-b[0]]:null,norm=v=>{const l=Math.hypot(v[0],v[1])||1;return [v[0]/l,v[1]/l];};
   const u1=n1&&norm(n1),u2=n2&&norm(n2),sharp=u1&&u2&&u1[0]*u2[0]+u1[1]*u2[1]<-.2,m=sharp?u2:norm(u1&&u2?[u1[0]+u2[0],u1[1]+u2[1]]:(u1||u2)),k=u1&&u2&&!sharp?Math.min(2,1/Math.max(.5,m[0]*u1[0]+m[1]*u1[1])):1;
   side.push([m[0]*.5*k,m[1]*.5*k]);} // a hairpin (over ~100 degrees) gets a plain butt joint, not a mitre that folds the strip
  for(let i=0;i<P.length-1;i++){const [ax,az]=P[i],[bx,bz]=P[i+1],[nax,naz]=side[i],[nbx,nbz]=side[i+1],ya=groundAt(ax,az)+.22,yb=groundAt(bx,bz)+.22;
   pos.push(ax+nax,ya,az+naz,bx+nbx,yb,bz+nbz,bx-nbx,yb,bz-nbz,ax+nax,ya,az+naz,bx-nbx,yb,bz-nbz,ax-nax,ya,az-naz);rd.push(C[i],C[i+1],C[i+1],C[i],C[i+1],C[i]);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('rd',new THREE.Float32BufferAttribute(rd,1));
  mesh=new THREE.Mesh(g,mat);mesh.renderOrder=3;mesh.frustumCulled=false;mesh.layers.set(1);scene.add(mesh);};
 // Progress: project the player onto the next few segments; returns the distance off the line.
 out.progress=(x,z)=>{if(!pts||pts.length<2)return Infinity;let best=1e9,bi=seg,bt=0;
  for(let i=Math.max(0,seg-2);i<Math.min(pts.length-1,seg+40);i++){const [ax,az]=pts[i],[bx,bz]=pts[i+1],dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz||1,t=clamp(((x-ax)*dx+(z-az)*dz)/l2,0,1),d=Math.hypot(ax+dx*t-x,az+dz*t-z);if(d<best){best=d;bi=i;bt=t;}}
  out.off=best;if(best<30){seg=bi;u.uProg.value=cum[bi]+(cum[bi+1]-cum[bi])*bt-1.5;}return best;};
 out.remaining=()=>pts?Math.max(0,cum.at(-1)-u.uProg.value):0;
 out.ahead=()=>pts?pts.slice(seg):null;
 return out;
}

// ---------- beams over targets ----------
function beam(scene,color,h=80){
 const g=new THREE.Group();
 const col=new THREE.Mesh(new THREE.CylinderGeometry(2.4,2.4,h,20,1,true),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.18,side:THREE.DoubleSide,depthWrite:false,fog:false}));col.position.y=h/2;
 const ring=new THREE.Mesh(new THREE.TorusGeometry(4.2,.16,6,36),new THREE.MeshBasicMaterial({color,fog:false,transparent:true,opacity:.75,depthWrite:false}));ring.rotation.x=Math.PI/2;ring.position.y=.3; // a slim ground ring, not a wall around the player
 col.layers.set(1);ring.layers.set(1); // layer 1: guides (beams, route), hidden by the trailer camera (cinematic.js)
 g.add(col,ring);g.visible=false;scene.add(g);return g;
}

export function createCopenhagenGame({scene,city,mobilityData,cityData,toast,soundOn=()=>true,audio=null,blocked=null}){ // blocked(x,z): a solid house there (the GPS line's last stretch)
 const proj=proj4('EPSG:4326',city.projection);
 const ll=([lat,lon])=>{const [x,y]=proj.forward([lon,lat]);return [x,-y];};
 const ERA=city.era===1760?'h':'m';
 const walk=makeGraph(mobilityData.walks,true),road=makeGraph(mobilityData.roads,ERA==='h'); // 1760: the coach's line and the races ignore one-way streets (the 1760 roads keep today's oneway tags: the line took the coach 1.9 km round Kongens Nytorv's one-way system for 1.1 km of street)
 UNIT=ERA==='h'?'sk.':'kr';const inEra=e=>(e||'m')===ERA||e==='b',cast=CHARACTERS.filter(c=>inEra(c.era));
 const jobs=(ERA==='h'?JOBS_1760:JOBS).map(j=>({...j,A:ll(j.a),B:ll(j.b),aName:j.a[2],bName:j.b[2]}));
 // Sagas told in both eras: in 1760 nothing from later (GPS, Andersen's 1845 tale, the war).
 const period=t=>ERA!=='h'||typeof t!=='string'?t:t.replace('No beams, no GPS. Just the map.','No signposts. Just the map.').replace(' Andersen wrote a tale about him in 1845.','').replace(' In the Second World War a resistance group took his name.','');
 const sagas=SAGAS.filter(s=>inEra(s.era)).map(s=>({...s,intro:period(s.intro),steps:s.steps.map(st=>({...st,card:st.card?.map(period),p:ll(st.at)}))}));
 const byId=Object.fromEntries(sagas.map(s=>[s.id,s]));
 const people=cast.map(c=>{const [x,z]=c.local||ll(c.at); /* local: a hand-placed spot in game metres */return {id:`cph-${c.id}`,script:c.id,x,z,heading:0,pose:'chat',walking:false,talkable:true,shirt:c.look.coat,coat:.7,...(c.look.height?{height:c.look.height}:{})};});

 const TOUCH=typeof document!=='undefined'&&document.body.classList.contains('touch'); // phones: card hints without keys (Menu has Journal and Quit race)
 // ---- save ----
 let save={money:0,job:0,done:{},lore:[],active:null,nisser:[]};
 const KEY=SAVE_KEY+(ERA==='h'?'-1760':'');try{save={...save,...JSON.parse(localStorage.getItem(KEY)||'{}')};}catch{}
 { // an old or hand-edited save: wrong types here threw inside update() on every frame
  const obj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
  for(const k of ['money','job','delivered','streak','pant'])if(save[k]!==undefined&&!Number.isFinite(save[k]))save[k]=0;save.job=Math.max(0,Math.floor(save.job||0)); // a fractional or negative job index threw every frame
  for(const k of ['done','cards','best'])if(k in save&&!obj(save[k]))save[k]=k==='done'?{}:undefined;
  for(const k of ['lore','nisser'])if(!Array.isArray(save[k]))save[k]=[];
  if(save.active&&(!obj(save.active)||!Array.isArray(save.active.done)))save.active=null;
 }
 if(save.active&&(!byId[save.active.id]||byId[save.active.id].limit))save.active=null; // timed sagas restart after a reload
 let trailer=false; // ?cinematic shows a saga for a few seconds (api.trailer below) and must not touch the player's save
 let filming=false; // ?cinematic: the self-driving trailer car passes jobs and races; none of it is saved
 const persist=()=>{if(trailer||filming)return;try{localStorage.setItem(KEY,JSON.stringify(save));}catch{}};

 // ---- HUD ----
 const hud=document.createElement('div');hud.id='cph-hud';hud.innerHTML=`<div class="cph-money" id="cph-money"></div><div class="cph-card-hint" id="cph-card-hint" hidden></div><div class="cph-card" id="cph-job"></div><div class="cph-card cph-saga" id="cph-saga" hidden></div>`;
 const lore=document.createElement('div');lore.id='cph-lore';lore.hidden=true;lore.innerHTML=`<div class="cph-lore-card" role="dialog"><div class="cph-kick" id="cph-lore-kick"></div><h2 id="cph-lore-title"></h2><p id="cph-lore-text"></p><button id="cph-lore-go">Continue <kbd>Enter</kbd></button></div>`;
 const journal=document.createElement('div');journal.id='cph-journal';journal.hidden=true;
 const tmap=document.createElement('div');tmap.id='cph-tmap';tmap.hidden=true;tmap.innerHTML=`<div class="cph-tmap-wrap"><div id="cph-tmap-canvas"></div><p>Just the map. The saga card tells you if you’re getting warmer.</p><button id="cph-tmap-close">Put the map away <kbd>K</kbd></button></div>`;
 document.body.append(hud,lore,journal,tmap);
 const $=id=>document.getElementById(id);

 // ---- pant: empty cans by benches, bins, shelters and hot-dog stands, 1 kr each (pant.js); today only ----
 let pant=null;
 const PANT_TITLES=[[10,'Pantsamler'],[50,'Pantjæger'],[150,'Pantkonge'],[400,'Pantlegende']];
 // where people sit with a beer: the Nyhavn quays, Dronning Louises Bro, Islands Brygge, Ofelia Plads, Kongens Have
 const PANT_HOTSPOTS=[[55.68003,12.58930],[55.67998,12.59130],[55.67955,12.59010],[55.68628,12.56400],[55.66505,12.57600],[55.68100,12.59600],[55.68545,12.57960]];
 function setFurniture(items,{clear,geometry}={}){if(ERA==='h'||pant||!items?.length)return;
  pant=createPant({items:[...items,...PANT_HOTSPOTS.map(p=>{const [x,z]=ll(p);return {k:'hotspot',x,z};})],clear,geometry});scene.add(pant.group);}
 function clink(){if(!soundOn())return;try{const ac=audioContext();const t0=ac.currentTime; // an aluminium can: a short bright clink
  for(const [f,v] of [[2350,.05],[3520,.03],[5180,.018]]){const o=ac.createOscillator(),g=ac.createGain();o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(v,t0);g.gain.exponentialRampToValueAtTime(.0001,t0+.2);o.connect(g).connect(ac.destination);o.start(t0);o.stop(t0+.22);}}catch{}}
 // ---- big moments: GTA-style banner with a short chime ----
 const ban=document.createElement('div');ban.id='cph-banner';ban.hidden=true;document.body.append(ban);let banT=0;
 let ownContext=null;const audioContext=()=>audio?.()||(ownContext??=new (window.AudioContext||window.webkitAudioContext)()); /* the game's own context (main.js): a second one made without a tap (the era switch starts by itself) stayed suspended, and nothing resumed it */
 function chime(kind){if(!soundOn())return;try{const ac=audioContext();const t0=ac.currentTime,notes=kind==='fail'?[392,330,262]:kind==='rank'?[523,659,784,1047]:[523,659,784];
  notes.forEach((f,i)=>{const o=ac.createOscillator(),g=ac.createGain();o.type='triangle';o.frequency.value=f;g.gain.setValueAtTime(0,t0+i*.11);g.gain.linearRampToValueAtTime(.09,t0+i*.11+.02);g.gain.exponentialRampToValueAtTime(.001,t0+i*.11+.5);o.connect(g).connect(ac.destination);o.start(t0+i*.11);o.stop(t0+i*.11+.55);});}catch{}}
 function banner(title,sub='',kind='pass'){ban.className='cph-banner-'+kind;ban.innerHTML=`<h2>${esc(title)}</h2>${sub?`<p>${sub}</p>`:''}`;ban.hidden=false;ban.style.animation='none';void ban.offsetWidth;ban.style.animation='';clearTimeout(banT);banT=setTimeout(()=>{ban.hidden=true;},kind==='rank'?4600:3400);chime(kind);}
 // ---- courier ranks: deliveries move you up; every rank pays 10% more ----
 const RANKS=ERA==='h'?[['Errand boy',0],['Runner',2],['Messenger',5],['Trusted courier',9],['Merchant’s man',14],['Court messenger',20],['Legend of the town',30]]
  :[['Newcomer',0],['Bike courier',2],['Cargo rider',5],['Street regular',9],['Harbour hand',14],['City fixer',20],['Copenhagen legend',30]];
 const rankOf=n=>{let r=0;RANKS.forEach(([,at],i)=>{if(n>=at)r=i;});return r;};
 const payBonus=()=>1+.1*rankOf(save.delivered||0);

 // ---- world markers ----
 // ---- hidden nisser: 22 small house-nisse figures tucked away around the city (GTA hidden packages) ----
 const NISSE_SPOTS=[[55.6797,12.5935],[55.6855,12.5805],[55.6857,12.5772],[55.6871,12.5731],[55.6918,12.5945],[55.6925,12.5988],[55.6866,12.5985],[55.6840,12.5926],[55.6851,12.5893],[55.6765,12.5785],[55.6776,12.5786],[55.6813,12.5760],[55.6837,12.5700],[55.6810,12.5665],[55.6760,12.5690],[55.6738,12.5985],[55.6728,12.5947],[55.6705,12.5760],[55.6880,12.5640],[55.6735,12.5820],[55.6818,12.6000],[55.6770,12.5885]];
 // Each stands by the footpath node nearest its spot whose corner is on a pavement, clear of roads, houses and water: the
 // nearest node was often a crossing, which stood 8 of the 22 in the road (one in a house, two in the 1760 water).
 // Roads, pavements and houses are indexed within 70 m of the spots, or within 410 m for a spot whose search has to reach
 // further (1760's nisse 4 at Nyboder stood inside a house 300 m from its spot: the house was not in the 70 m index).
 const nisser=(()=>{const spots=NISSE_SPOTS.map(ll),near=(list,m)=>new SpatialIndex((list||[]).filter(q=>q.rings?.length&&(q.bbox??=bounds(q.rings))&&spots.some(([x,z])=>x>q.bbox[0]-m&&x<q.bbox[2]+m&&z>q.bbox[1]-m&&z<q.bbox[3]+m)));
  const ix=m=>({road:near(cityData?.roads,m),pave:near(cityData?.pavement,m),house:near(cityData?.buildings,m)}),small=ix(70);let big=null,road,pave,house;
  const use=reach=>{const t=reach>60?(big=big||ix(410)):small;road=t.road;pave=t.pave;house=t.house;},clear=(x,z)=>!road.at(x,z)&&!house.at(x,z)&&!inWaterPolygons(cityData?.water,x,z);
  const OFF=[[.9,.6],[-.9,-.6],[1.5,0],[-1.5,0],[0,1.5],[0,-1.5],[1.1,-1.1],[-1.1,1.1]];
  return spots.map((p,i)=>{let best=null,score=Infinity;for(const reach of [60,150,400]){use(reach);for(const q of walk.nodes){const d=dist(q,p);if(d>reach)continue;
    for(let k=0;k<OFF.length;k++){const x=q[0]+OFF[k][0],z=q[1]+OFF[k][1];if(!clear(x,z))continue;const sc=d+(pave.at(x,z)?0:25)+k*.2;if(sc<score){score=sc;best=[x,z];}break;}}if(best)break;}
   if(!best){use(400);for(let r=0;r<=80&&!best;r++)for(let k=0;k<16;k++){const x=p[0]+r*Math.cos(k*Math.PI/8),z=p[1]+r*Math.sin(k*Math.PI/8);if(clear(x,z)){best=[x,z];break;}}} /* no footpath within 400 m (1760: the spot by the lakes, far outside the ramparts, stood in Sankt Jørgens Sø): the nearest clear ground */
   if(!best){const n=walk.nearest(p[0],p[1]),q=n>=0&&dist(walk.nodes[n],p)<60?walk.nodes[n]:p;best=[q[0]+.9,q[1]+.6];}return {i,p:best};});})();
 const nisseGeo=(()=>{const parts=[new THREE.ConeGeometry(.17,.42,10).translate(0,.62,0),new THREE.SphereGeometry(.13,10,8).translate(0,.4,0),new THREE.CylinderGeometry(.14,.18,.34,10).translate(0,.17,0),new THREE.SphereGeometry(.035,6,5).translate(0,.84,0)];
  const cols=['#c8202a','#e9e3d4','#5a6b8a','#f2f2f2'],out=[];parts.forEach((g,k)=>{const n=g.toNonIndexed();const c=new THREE.Color(cols[k]),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));n.deleteAttribute('uv');out.push(n);});return mergeGeometries(out).scale(1.6,1.6,1.6);})();
 const nisseMesh=new THREE.InstancedMesh(nisseGeo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.6,emissive:'#3a1210'}),nisser.length);nisseMesh.castShadow=true;nisseMesh.frustumCulled=false;nisseMesh.name='Hidden nisser';scene.add(nisseMesh);
 // Daniel's pick of nisse (public/models/nisse.glb.gz: the pig-tails gnome, scripts/models/nisse.py) replaces the cone-and-ball figure once loaded.
 loadOneMesh('/models/nisse.glb.gz').then(m=>{if(!m?.geometry||!m.geometry.attributes.color&&!m.map)return;const g=m.geometry.scale(.85,.85,.85);for(const k of Object.keys(g.attributes))if(!['position','normal','color','uv'].includes(k))g.deleteAttribute(k);nisseMesh.geometry.dispose();nisseMesh.geometry=g;
  if(m.map){nisseMesh.material.vertexColors=false;nisseMesh.material.map=m.map;nisseMesh.material.roughness=.75;nisseMesh.material.needsUpdate=true;}nisseMesh.material.emissive.set('#1a0808');}); // textured (the gnome) or vertex-coloured
 const NT={m:new THREE.Matrix4(),q:new THREE.Quaternion(),v:new THREE.Vector3(),one:new THREE.Vector3(1,1,1),zero:new THREE.Vector3()};
 const mkA=beam(scene,0xf2b134),mkB=beam(scene,0x46c2b0),mkQ=[0,1,2,3,4].map(()=>beam(scene,0xe0313e,100));
 const line=createRouteLine(scene,{historic:ERA==='h'});
 let state='a',timer=0,routeFor=null,routeT=0,player=null,mode='car',started=false;
 const job=()=>jobs[save.job%jobs.length];

 // ---- checkpoint races: routes follow the road graph between named places; medals by time ----
 const RACE_DEFS=ERA==='h'?[
   {id:'coach-dash',title:'The Coachman’s Dash',via:['Kongens Nytorv','Højbro','Gammeltorv','Vesterport']},
   {id:'harbour-run',title:'Harbour Run',via:['Nyhavn','Amalienborg','Kongens Nytorv']},
   {id:'rampart-ride',title:'Rampart Ride',via:['Nørreport','Kultorvet','Rundetårn','Christiansborg']}]
  :[{id:'harbour-sprint',title:'Harbour Sprint',via:['Kongens Nytorv','Christiansborg','Christianshavn']},
   {id:'lakes-loop',title:'Lakes Loop',via:['Torvehallerne','Dronning Louises Bro','The Lakes','Rådhuspladsen']},
   {id:'mermaid-run',title:'Tivoli to the Mermaid',via:['Tivoli','Rådhuspladsen','Kongens Nytorv','Amalienborg','Little Mermaid']},
   {id:'brygge-blast',title:'Brygge Blast',via:['Islands Brygge','Christiansborg','Nyhavn']}];
 const lms=cityData?.landmarks||[],lm=n=>lms.find(l=>l.name===n);
 // Planned once here and again, round the walls (blocked: the world exists by then), when the race starts.
 const planRace=(d,bl)=>{const pts=d.via.map(lm);if(pts.some(p=>!p))return null;
  let path=[];for(let i=1;i<pts.length;i++){const a=road.nearest(pts[i-1].x,pts[i-1].z),b=road.nearest(pts[i].x,pts[i].z),leg=bl&&road.route(a,b,bl)||road.route(a,b);if(!leg)return null;path.push(...(path.length?leg.slice(1):leg));}
  let len=0;const cps=[];let acc=0;for(let i=1;i<path.length;i++){const l=dist(path[i],path[i-1]);len+=l;acc+=l;if(acc>330&&len<9e9){cps.push(path[i]);acc=0;}}
  if(cps.length&&dist(cps.at(-1),path.at(-1))<150)cps.pop();cps.push(path.at(-1));
  const speed=ERA==='h'?7:11.5,gold=Math.round(len/speed+8);
  return {...d,start:path[0],cps,len,par:[gold,Math.round(gold*1.25),Math.round(gold*1.6)],pay:Math.round((ERA==='h'?60:500)*len/1500)};};
 const races=RACE_DEFS.map(d=>planRace(d)).filter(Boolean);
 save.best??={};
 // ---- postcards: photograph the famous views (N); each subject pays once and goes into the album (J) ----
 const POSTCARD_DEFS=ERA==='h'?[
   ['borsen','Børsen',55.6758,12.5833,'The exchange and its dragon spire, a century old already.'],['christiansborg','Christiansborg',55.6761,12.5800,'The new palace, finished only fifteen years ago.'],
   ['rundetaarn','Rundetårn',55.6813,12.5757,'Christian IV’s round tower: a coach can drive up its ramp.'],['vorfrelsers','Vor Frelsers Kirke',55.6727,12.5940,'The spiral spire, finished in 1752.'],
   ['amalienborg','Amalienborg',55.6840,12.5930,'Four noble palaces, still smelling of fresh mortar.'],['vorfrue','Vor Frue Kirke',55.6796,12.5729,'The cathedral and its tall copper spire.'],
   ['nikolaj','Sankt Nikolaj',55.6785,12.5810,'The spire sailors steer by.'],['frederiks','Frederiks Kirke',55.6849,12.5893,'A marble church that may never be finished.'],
   ['christian5','Christian V',55.6797,12.5856,'The gilded king on Kongens Nytorv.'],['holmens','Holmens Kirke',55.6762,12.5823,'The navy’s church by the canal.']]
  :[['nyhavn','Nyhavn',55.6799,12.5911,'The painted houses on the canal.'],['mermaid','The Little Mermaid',55.6929,12.5993,'Smaller than you expected. Everyone says so.'],
   ['rundetaarn','Rundetårn',55.6813,12.5757,'The round tower with a ramp instead of stairs.'],['amalienborg','Amalienborg',55.6840,12.5930,'The royal square; the guard changes at noon.'],
   ['marmorkirken','Marmorkirken',55.6849,12.5893,'The dome they finished 145 years late.'],['christiansborg','Christiansborg',55.6761,12.5800,'Parliament, court and royal halls in one palace.'],
   ['borsen','Børsen',55.6758,12.5833,'Four dragons twist their tails into the spire.'],['vorfrelsers','Vor Frelsers Kirke',55.6727,12.5940,'400 steps, the last ones outside.'],
   ['tivoli','Tivoli',55.6737,12.5681,'The garden that inspired a certain theme park.'],['operaen','Operaen',55.6818,12.6008,'The opera house across the harbour.'],
   ['raadhuset','Rådhuset',55.6757,12.5700,'The city hall and its clock tower.'],['gefion','Gefion Fountain',55.6870,12.5990,'The goddess ploughing Zealand out of Sweden.'],
   ['havnebadet','Havnebadet',55.6648,12.5727,'A swim in the harbour, right in the middle of the city.']];
 const postcards=POSTCARD_DEFS.map(([id,title,lat,lon,text])=>({id,title,text,p:ll([lat,lon])}));
 save.cards??={};
 let cardHint=null;
 // Called by main.js on N: dir = camera forward (x,z); snap() returns a small JPEG data URL of the view.
 function photo({dir,snap}){
  if(!player)return false;let best=null,bd=Infinity;
  for(const c of postcards){const dx=c.p[0]-player.x,dz=c.p[1]-player.z,d=Math.hypot(dx,dz);if(d<20||d>280)continue;
   const cos=(dx*dir[0]+dz*dir[1])/(d*Math.hypot(dir[0],dir[1])||1);if(cos<Math.cos(38*Math.PI/180))continue; /* in frame: about the camera's horizontal half-view */if(d<bd){bd=d;best=c;}}
  flash();
  if(!best){banner('Nice photo','No postcard view here · face a landmark nearby','pick');return true;}
  if(save.cards[best.id]){banner(best.title,'Already in your album','pick');return true;}
  let img=null;try{img=snap();}catch{}
  save.cards[best.id]={img,t:Date.now()};const pay=ERA==='h'?18:150;save.money+=pay;persist();
  const n=Object.keys(save.cards).length;banner(`Postcard: ${best.title}`,`${esc(best.text)} · +${fmtKr(pay)} ${UNIT} · ${n}/${postcards.length} in your album`,n===postcards.length?'rank':'pass');
  return true;
 }
 const flashEl=document.createElement('div');flashEl.id='cph-flash';document.body.append(flashEl);
 function flash(){flashEl.classList.remove('on');void flashEl.offsetWidth;flashEl.classList.add('on');}

 let race=null,hopped=false,chainHold=0; // race: {r, k (next checkpoint), t, countdown}; hopped: the job's delivery leg crossed a map jump or reset (no speed bonus)
 const H=ERA==='h',mkStart=races.map(()=>beam(scene,H?0xb5462e:0x9b5de5,60)),mkCp=beam(scene,H?0xe0a040:0xff4fd8,90),mkCp2=beam(scene,H?0xe0a040:0xff4fd8,40); // 1760: sealing-wax red and lantern gold, not neon
 const fmtT=t=>`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}.${Math.floor(t%1*10)}`;
 function startRace(r){if(blocked&&!r.walls){r.walls=true;const q=planRace(r,blocked);if(q)Object.assign(r,{cps:q.cps,len:q.len,par:q.par,pay:q.pay});}race={r,k:0,t:0,countdown:3.4};routeFor=null;banner(r.title,`${r.cps.length} checkpoints · ${(r.len/1000).toFixed(1)} km · gold ${fmtT(r.par[0])}`,'pick');}
 function finishRace(){const r=race.r,t=race.t,medal=t<=r.par[0]?0:t<=r.par[1]?1:t<=r.par[2]?2:3;const names=['Gold','Silver','Bronze'];
  const prev=save.best[r.id],best=medal<3&&(prev==null||t<prev);if(best)save.best[r.id]=t; // a 'too slow' run is not a best time
  if(medal<3){const pay=Math.round(r.pay*[1,.6,.35][medal]*payBonus());save.money+=pay;banner(`${names[medal]}!`,`${esc(r.title)} · ${fmtT(t)}${best?' · new best':''} · +${fmtKr(pay)} ${UNIT}`,medal===0?'rank':'pass');}
  else banner('Too slow',`${esc(r.title)} · ${fmtT(t)} · bronze is ${fmtT(r.par[2])}`,'fail');
  race=null;races.forEach(r=>r.armed=false);persist();routeFor=null;}

 // ---- sagas ----
 const frontier=()=>{const a=save.active;if(!a)return [];const q=byId[a.id],i=q.steps.findIndex((s,k)=>!a.done.includes(k));if(i<0)return [];if(!q.steps[i].any)return [i];const out=[];for(let k=i;k<q.steps.length&&q.steps[k].any;k++)if(!a.done.includes(k))out.push(k);return out;};
 const giverName=q=>CHARACTERS.find(c=>c.id===q.giver)?.name||q.giver;
 const loreQ=[];let loreOpen=false,journalOpen=false,tmapOpen=false;
 function showLore(q,card){loreQ.push([q,card]);if(!loreOpen)nextLore();}
 function nextLore(){const it=loreQ.shift();if(!it){loreOpen=false;lore.hidden=true;return;}const [q,[t,txt]]=it;loreOpen=true;$('cph-lore-kick').textContent=q.title;$('cph-lore-title').textContent=t;$('cph-lore-text').textContent=txt;lore.hidden=false;}
 $('cph-lore-go').onclick=()=>nextLore();
 function startSaga(id){const q=byId[id];save.active={id,done:[],t:q.limit||0,shown:-1};persist();routeFor=null;wayTo=null;banner('Saga started',`${esc(q.title)} · ${q.steps[0].clue?'find the X on the map':'follow the red beam'}`,'pick');} /* Holger's map has no beam to follow */
 function endSaga(win){const q=byId[save.active.id];if(win){save.done[q.id]=1;save.money+=q.pay;banner('Saga complete',`${esc(q.title)} · +${fmtKr(q.pay)} ${UNIT}`,'rank');}else banner('Saga failed',`${esc(q.title)} · talk to ${esc(giverName(q))} to try again`,'fail');save.active=null;persist();routeFor=null;}
 const api={
  era:ERA,
  money:()=>fmtKr(save.money)+' '+UNIT,
  spend:n=>{if(save.money<n)return false;save.money-=n;persist();return true;},
  sagaChoice:id=>{const q=byId[id];if(!q||save.done[id]||save.active?.id===id)return [];return [{id:`saga:${id}`,label:`Saga: ${q.title}`}];},
  sagaIntro:id=>{const q=byId[id];if(save.active&&save.active.id!==id)return {response:`Finish what you started first. ${byId[save.active.id].title} is still waiting.`,choices:[{id:'bye',label:'Right'}],expression:'friendly'};
   return {response:q.intro,choices:[{id:`accept:${id}`,label:`Accept · ${fmtKr(q.pay)} ${UNIT}${q.limit?` · ${Math.floor(q.limit/60)}:${String(q.limit%60).padStart(2,'0')} min`:''}`},{id:'bye',label:'Not now'}],expression:'friendly'};},
  sagaAccept:id=>{startSaga(id);return {response:byId[id].go,choices:[{id:'bye',label:'On my way'}],expression:'friendly'};},
 };
 connectCharacters(api);

 // ---- treasure map (Holger Danske): drawn from the city's own footprints and streets ----
 function drawClue(q,k){
  const s=q.steps[k],cv=document.createElement('canvas');cv.width=cv.height=560;const g=cv.getContext('2d');
  let seed=k*31+5;const r=()=>(seed=(seed*16807)%2147483647)/2147483647;const half=320,cx=s.p[0]+(r()-.5)*220,cz=s.p[1]+(r()-.5)*220;
  const S=(x,z)=>[20+(x-(cx-half))/(2*half)*520,20+(z-(cz-half))/(2*half)*520];
  g.fillStyle='#d9c39a';g.fillRect(0,0,560,560);
  const poly=(list,color)=>{g.fillStyle=color;for(const b of list||[]){const bb=b.bbox;if(!bb||bb[2]<cx-half||bb[0]>cx+half||bb[3]<cz-half||bb[1]>cz+half)continue;g.beginPath();for(const ring of b.rings||[])ring.forEach((p,i)=>{const [a,c]=S(p[0],p[1]);g[i?'lineTo':'moveTo'](a,c);});g.fill('evenodd');}};
  poly(cityData.water,'rgba(70,110,120,.5)');poly(cityData.roads,'rgba(245,232,200,.9)');poly(cityData.pavement,'rgba(235,220,185,.8)');
  g.fillStyle='rgba(95,60,30,.55)';
  for(const b of cityData.buildings||[]){const bb=b.bbox;if(!bb||bb[2]<cx-half||bb[0]>cx+half||bb[3]<cz-half||bb[1]>cz+half)continue;g.beginPath();for(const ring of b.rings.slice(0,1))ring.forEach((p,i)=>{const [a,c]=S(p[0],p[1]);g[i?'lineTo':'moveTo'](a,c);});g.fill();}
  g.globalCompositeOperation='multiply';g.fillStyle='#c9a46a';g.fillRect(0,0,560,560);g.globalCompositeOperation='source-over';
  for(let i=0;i<1400;i++){g.fillStyle=`rgba(80,50,20,${r()*.08})`;g.fillRect(r()*560,r()*560,1+r()*3,1+r()*3);}
  const vg=g.createRadialGradient(280,280,170,280,280,400);vg.addColorStop(0,'rgba(60,35,10,0)');vg.addColorStop(1,'rgba(60,35,10,.75)');g.fillStyle=vg;g.fillRect(0,0,560,560);
  const [X,Z]=S(s.p[0],s.p[1]);g.strokeStyle='#a3141c';g.lineWidth=7;g.beginPath();g.moveTo(X-15,Z-15);g.lineTo(X+15,Z+15);g.moveTo(X+15,Z-15);g.lineTo(X-15,Z+15);g.stroke();
  g.fillStyle='#3a2410';g.font='bold 18px Georgia,serif';g.textAlign='center';g.fillText('N ↑',510,46);g.textAlign='left';g.font='italic 20px Georgia,serif';g.fillText(`Part ${k+1} of ${q.steps.length}`,30,540);
  return cv;
 }
 function showTreasure(){const a=save.active;if(!a||!byId[a.id].steps.some(s=>s.clue)){toast(save.done?.holger?'You have already followed Ole\'s map.':'No treasure map yet. Ole at Gammel Strand has one.');return;}const q=byId[a.id],f=frontier().filter(k=>q.steps[k].clue);if(!f.length)return;const box=$('cph-tmap-canvas');box.replaceChildren(drawClue(q,f[0]));tmapOpen=true;tmap.hidden=false;}
 const closeTreasure=()=>{tmapOpen=false;tmap.hidden=true;};$('cph-tmap-close').onclick=closeTreasure;
 const warmth=d=>d<35?'hot!':d<100?'warm':d<250?'lukewarm':d<600?'cold':'freezing';

 // ---- journal (J) ----
 function renderJournal(){
  const rows=sagas.map(q=>{const done=!!save.done[q.id],act=save.active?.id===q.id;const cards=q.steps.map((s,k)=>[s,k]).filter(([s,k])=>s.card&&save.lore.includes(q.id+':'+k));
   return `<article class="cph-jq${done?' done':''}${act?' act':''}"><div class="cph-jh"><span>${q.limit?'Timed · ':''}${fmtKr(q.pay)} ${UNIT}</span></div><h3>${esc(q.title)}</h3><p class="cph-js">${done?'Complete':act?`In progress · ${save.active.done.length}/${q.steps.length}`:`Ask ${esc(giverName(q))}`}</p>${cards.map(([s])=>`<details><summary>${esc(s.card[0])}</summary><p>${esc(s.card[1])}</p></details>`).join('')}${!done&&!act?`<button data-way="${q.giver}">Show me the way</button>`:''}${act?`<button data-abandon="1">Abandon</button>`:''}</article>`;}).join('');
  const album=postcards.map(c=>{const got=save.cards[c.id];return `<figure class="cph-pc${got?'':' empty'}">${got?.img?`<img src="${got.img}" alt="">`:`<div class="cph-pc-blank">?</div>`}<figcaption>${esc(c.title)}</figcaption></figure>`;}).join('');
  journal.innerHTML=`<div class="cph-jcard" role="dialog" aria-modal="true" aria-label="Journal"><div class="cph-jtop"><div><p class="cph-kick">Stories from Danish history and folklore</p><h2>Sagas</h2></div><button id="cph-jclose">Close <kbd>J</kbd></button></div><div class="cph-jlist">${rows}</div><h2 class="cph-album-h cph-keyboard-only">Postcards · ${Object.keys(save.cards).length}/${postcards.length}</h2><p class="cph-js cph-keyboard-only">Find a landmark, face it and press N.</p><div class="cph-album cph-keyboard-only">${album}</div></div>`;
  $('cph-jclose').onclick=()=>toggleJournal(false);
  journal.querySelectorAll('[data-way]').forEach(b=>b.onclick=()=>{const c=people.find(p=>p.script===b.dataset.way);if(c){wayTo=[c.x,c.z];routeFor=null;toggleJournal(false);toast(`Route set to ${CHARACTERS.find(x=>x.id===c.script).name}`);}});
  journal.querySelectorAll('[data-abandon]').forEach(b=>b.onclick=()=>{save.active=null;wayTo=null;persist();routeFor=null;renderJournal();});
  if(!journal.contains(document.activeElement))$('cph-jclose').focus({preventScroll:true}); // also after Abandon redraws it
 }
 // Keyboard: the journal takes the focus (its Close button) and Tab cycles its own buttons. Its keys were all swallowed while it was open, so Show me the way, Abandon and the story cards could only be reached with a mouse.
 function toggleJournal(v){const was=journalOpen;journalOpen=v??!journalOpen;journal.hidden=!journalOpen;if(journalOpen)renderJournal();else if(was&&(journal.contains?.(document.activeElement)||document.activeElement===document.body))$('world')?.focus();}
 journal.addEventListener?.('keydown',e=>{if(e.key!=='Tab')return;const f=[...journal.querySelectorAll('button,summary')].filter(n=>n.getClientRects().length);if(!f.length)return;const i=f.indexOf(document.activeElement);e.preventDefault();e.stopPropagation();f[e.shiftKey?(i<=0?f.length-1:i-1):(i<0||i===f.length-1?0:i+1)].focus();});
 let wayTo=null;

 // ---- target for the GPS line: a walk to a character, the saga, or the job ----
 function target(){
  if(race&&race.countdown<=0)return {p:race.r.cps[race.k],kind:'race'};
  if(wayTo)return {p:wayTo,kind:'way'};
  if(state!=='b'&&save.active){const q=byId[save.active.id],f=frontier().filter(k=>!q.steps[k].clue);if(f.length){let best=f[0];for(const k of f)if(dist(q.steps[k].p,[player.x,player.z])<dist(q.steps[best].p,[player.x,player.z]))best=k;return {p:q.steps[best].p,kind:'saga'};}}
  return {p:state==='a'?job().A:job().B,kind:'job'};
 }
 function rebuild(){const t=target();routeFor=t.p;const G=mode==='car'?road:walk;const a=G.nearest(player.x,player.z);let b=G.nearestOpen(t.p[0],t.p[1],blocked),pts=G.route(a,b,blocked)||G.route(a,b);if(!pts){b=G.nearest(t.p[0],t.p[1]);pts=G.route(a,b,blocked)||G.route(a,b);} /* a one-way node that leads nowhere: the plain nearest; no way round a wall: through it, rather than no line */
  if(pts&&G===road&&dist(road.nodes[b],t.p)>25){const wa=walk.nearestOpen(...road.nodes[b],blocked),wb=walk.nearestOpen(t.p[0],t.p[1],blocked),tail=walk.route(wa,wb,blocked)||walk.route(wa,wb);if(tail)pts=[...pts,...tail];} /* a target off the roads (Købmagergade, the squares, the quays): the last stretch along the footways the car can also take, not straight over the block */
  if(pts&&G===walk&&blocked&&!walk.clear(b,t.p[0],t.p[1],blocked)){const rb=road.nearestOpen(t.p[0],t.p[1],blocked);if(road.clear(rb,t.p[0],t.p[1],blocked))for(let i=pts.length-1,s=25;i>=0;i--){if(i<pts.length-1&&(s+=dist(pts[i],pts[i+1]))<10)continue;s=0;const ra=road.nearest(pts[i][0],pts[i][1]);if(ra<0||dist(road.nodes[ra],pts[i])>40||!road.clear(ra,pts[i][0],pts[i][1],blocked))continue;const q=road.route(ra,rb,blocked);if(q){pts=[...pts.slice(0,i+1),...q];break;}}} /* on foot with no footway in clear sight of the target (Tivoli's gate, the Opera): the line went its last stretch through the houses; from the last point along it (every 10 m) with a street node in clear sight, along the streets instead */const on=pts&&trimStart(pts,player.x,player.z);line.set(on?[...(on.length&&dist(on[0],[player.x,player.z])>3?[[player.x,player.z]]:[]),...on,t.p]:null);}
 // The first route to a new target grew its whole tree in one frame (10-40 ms: a hitch at every pick-up and delivery).
 // The current and the next target's trees (both graphs; the pick-up times the delivery by the walk one) grow
 // in idle time instead, a slice at a time.
 let warmFor=[],warmJobs=[],warmQueued=false;
 function warmNext(p){if(!blocked||typeof requestIdleCallback!=='function')return;const next=race?race.r.cps[race.k+1]:state==='a'?job().B:save.active?null:jobs[(save.job+1)%jobs.length].A;
  if(p!==warmFor[0]||next!==warmFor[1]||mode!==warmFor[2]){warmFor=[p,next,mode];const G=mode==='car'?road:walk,H=G===road?walk:road;warmJobs=[];for(const q of [p,next])if(q)warmJobs.push({G,q,b:null},{G:H,q,b:null});}
  if(warmJobs.length&&!warmQueued){warmQueued=true;requestIdleCallback(runWarm);}}
 function runWarm(dl){warmQueued=false;while(warmJobs.length&&dl.timeRemaining()>2){const j=warmJobs[0];if(j.b===null){j.b=j.plain?j.G.nearest(j.q[0],j.q[1]):j.G.nearestOpen(j.q[0],j.q[1],blocked);continue;}if(j.G.warm(j.b,dl.timeRemaining()-1.5,!j.plain))warmJobs.shift();}}
 // The nearest graph node is often behind the car: the route then ran back to it and returned past the car
 // (a loop around the player). Start from the closest point of the route's first 60 m instead.
 function trimStart(pts,x,z){if(pts.length<2)return pts;let best=-1,bd=Infinity,bp=null,run=0;
  for(let i=0;i<pts.length-1&&run<60;i++){const [ax,az]=pts[i],[bx,bz]=pts[i+1],dx=bx-ax,dz=bz-az,L2=dx*dx+dz*dz||1,u=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/L2)),px=ax+dx*u,pz=az+dz*u,d=Math.hypot(px-x,pz-z);
   if(d<bd-.5){bd=d;best=i;bp=[px,pz];}run+=Math.sqrt(L2);}
  return best>0||bp&&best===0?[bp,...pts.slice(best+1)]:pts;}

 let hudClock=1;const setHtml=(el,h)=>{if(el&&el.__h!==h){el.__h=h;el.innerHTML=h;
   // Desktop: a card shows its story for 10 s when its heading changes, then only the heading and the next step (CSS .settled).
   const t=el.querySelector('h3')?.textContent||'';if(t!==el.__t){el.__t=t;el.classList.remove('settled');clearTimeout(el.__settle);el.__settle=setTimeout(()=>el.classList.add('settled'),10000);}}};
 function updateHud(){
  {const n=save.delivered||0,r=rankOf(n),next=RANKS[r+1],from=RANKS[r][1],pct=next?Math.round((n-from)/(next[1]-from)*100):100;
   setHtml($('cph-money'),`<b>${fmtKr(save.money)} ${UNIT}</b>${save.nisser?.length?` · nisser ${save.nisser.length}/${nisser.length}`:''}${save.pant?` · pant ${save.pant}`:''}<span class="cph-rank">${esc(RANKS[r][0])}${save.streak>1?` · streak ×${save.streak}`:''}<i style="--p:${pct}%"></i></span>`);}
  if(race){const r=race.r,b=save.best[r.id];setHtml($('cph-job'),`<p class="cph-kick">Race · checkpoint ${Math.min(race.k+1,r.cps.length)}/${r.cps.length}${TOUCH?'':' · <kbd>X</kbd> quit'}</p><h3>${esc(r.title)}</h3><p class="cph-race-time">${race.countdown>0?Math.ceil(race.countdown):fmtT(race.t)}</p><p>Gold ${fmtT(r.par[0])} · silver ${fmtT(r.par[1])} · bronze ${fmtT(r.par[2])}${b!=null?` · best ${fmtT(b)}`:''}</p>`);}
  else{
  const j=job(),t=state==='a'?j.A:j.B,d=line.points&&target().kind==='job'&&line.off<30?line.remaining():dist(t,[player.x,player.z]); // the line may lead to a saga step or a character instead; a line left behind (a teleport or start switch, until the lazy rebuild lands) gives the straight distance, not the old line's 140 m
  setHtml($('cph-job'),`<p class="cph-kick">Job ${save.job%jobs.length+1}/${jobs.length}</p><h3>${esc(j.t)}</h3><p>${esc(j.d)}</p><p class="cph-go">${state==='a'?'Pick up at':'Deliver to'} <b>${esc(state==='a'?j.aName:j.bName)}</b> · ${d>1000?(d/1000).toFixed(1)+' km':Math.round(d/10)*10+' m'}${state==='b'?` · <span class="${timer<15?'cph-low':''}">${Math.max(0,timer).toFixed(0)} s</span>`:''}</p>`);
  }
  {let near=null,nd=Infinity;for(const c of postcards){if(save.cards[c.id])continue;const d=dist(c.p,[player.x,player.z]);if(d<200&&d<nd){nd=d;near=c;}}
   const h=$('cph-card-hint');if(h){h.hidden=!near;if(near)setHtml(h,document.body.classList.contains('touch')?`<span aria-hidden="true">📷</span><span class="cph-sr">Take a postcard of ${esc(near.title)}</span>`:`Postcard view nearby: <b>${esc(near.title)}</b> · face it and press <kbd>N</kbd>`);}}
  const sg=$('cph-saga');if(!save.active){sg.hidden=true;return;}sg.hidden=false;
  const q=byId[save.active.id],f=frontier();
  setHtml(sg,`<p class="cph-kick">${TOUCH?`Saga${q.steps.some(s=>s.clue)?' · tap for the map':''}`:`Saga · <kbd>J</kbd> journal${q.steps.some(s=>s.clue)?' · <kbd>K</kbd> map':''}`}</p><h3>${esc(q.title)}</h3><ol>${q.steps.map((s,k)=>{const dn=save.active.done.includes(k),c=f.includes(k),dd=dist(s.p,[player.x,player.z]);return `<li class="${dn?'d':c?'c':''}">${esc(s.name)}${c?` <span>${s.clue?warmth(dd):dd>1000?(dd/1000).toFixed(1)+' km':Math.round(dd/10)*10+' m'}</span>`:''}</li>`;}).join('')}</ol>${q.limit?`<p class="cph-timer ${save.active.t<30?'cph-low':''}">${Math.max(0,save.active.t).toFixed(0)} s</p>`:''}`);
 }

 // The morning paper: once per session, the first time the game runs.
 const PAPER={m:{name:'Morgenavisen København',date:()=>new Date().toLocaleDateString('da-DK',{weekday:'long',day:'numeric',month:'long',year:'numeric'}),
   items:[['Harbour baths open late as the warm spell holds','Islands Brygge and Kalvebod Bølge stay open until ten. Lifeguards ask swimmers to keep clear of the canal boats.'],
    ['Courier shortage: restaurants turn to cargo bikes','From Nyhavn to Christianshavn, kitchens are paying riders who know the bridges. Ask at the yellow beam.'],
    ['Old map found in a herring barrel','A retired fisherman at Gammel Strand says it shows the way to Holger Danske. Nobody believes him. Everybody wants to see it.'],
    ['Night watch on Rundetårn','The tower stays open after dark this week. The view over the lamps on their wires is worth the ramp.']]},
  h:{name:'Kiøbenhavns Adresse-Contoirs Efterretninger',date:()=>'Anno 1760',
   items:[['The new palaces at Amalienborg near completion','Four noble houses around one octagonal square. Builders on the marble church next door ask coachmen to mind the scaffolding.'],
    ['Errand boys wanted','Merchants at Nyhavn and the Exchange pay in good skilling for quick feet and a closed mouth.'],
    ['Fire watch doubled','After the great fire of 1728 the watchmen sing every hour. Householders are reminded: no open candles in the hayloft.'],
    ['A ship of the Asiatic Company lies at Christianshavn','Tea, silk and porcelain from Canton. The auction will be announced at the Exchange.']]}};
 let paperShown=false;
 function showPaper(){
  paperShown=true;try{if(sessionStorage.getItem('cph-paper-'+ERA))return;sessionStorage.setItem('cph-paper-'+ERA,'1');}catch{}
  const P=PAPER[ERA==='h'?'h':'m'],el=document.createElement('div');el.id='cph-paper';
  el.innerHTML=`<div class="cph-paper-card" role="dialog"><p class="cph-paper-date">${esc(P.date())}</p><h2>${esc(P.name)}</h2><div class="cph-paper-cols">${P.items.map(([h,b])=>`<article><h3>${esc(h)}</h3><p>${esc(b)}</p></article>`).join('')}</div><button>Read later <kbd>Esc</kbd></button></div>`;
  document.body.append(el);const close=()=>{el.remove();removeEventListener('keydown',onKey,true);};const onKey=e=>{if(['Escape','Enter','Space'].includes(e.code)){e.preventDefault();e.stopPropagation();close();}};
  el.querySelector('button').onclick=close;addEventListener('keydown',onKey,true);setTimeout(()=>{if(el.isConnected)close();},14000);
 }
 function update(dt,actor,travelMode,{running=true,cinematic=false}={}){ // cinematic: ?cinematic drives by, it collects nothing
  filming=cinematic;
  player=actor;started=running;if(!actor)return;
  // (The morning paper no longer opens by itself at the start: players found the pop-up confusing. paper() still shows it.)
  {save.nisser??=[];const {m,q,v,one,zero}=NT,now=performance.now()/1000;
   for(const n of nisser){const got=save.nisser.includes(n.i);if(!got&&running&&!cinematic&&Math.hypot(n.p[0]-actor.x,n.p[1]-actor.z)<2.6){save.nisser.push(n.i);save.money+=ERA==='h'?24:150;persist();banner('Nisse found!',`${save.nisser.length} of ${nisser.length} · +${ERA==='h'?24:150} ${UNIT}`,'pass');}
    nisseMesh.setMatrixAt(n.i,m.compose(v.set(n.p[0],groundAt(n.p[0],n.p[1])+.05+Math.abs(Math.sin(now*2+n.i))*.12,n.p[1]),q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP,now*.8+n.i),save.nisser.includes(n.i)?zero:one));}
   nisseMesh.instanceMatrix.needsUpdate=true;}
  if(pant){const n=pant.update(dt,actor,{collect:running&&!cinematic});if(n){const before=save.pant||0;save.pant=before+n;save.money+=n*PANT_KR;persist();clink();
    const t=PANT_TITLES.find(([k])=>before<k&&save.pant>=k);if(t)banner(t[1],`${save.pant} cans · ${fmtKr(save.pant*PANT_KR)} ${UNIT} in pant`,'pass');}}
  if(travelMode!==mode){mode=travelMode;routeFor=null;}
  const here=[actor.x,actor.z];
  // races
  const now=performance.now();
  races.forEach((r,i)=>{const m=mkStart[i];m.visible=!race&&state!=='b'&&running;m.position.set(r.start[0],groundAt(...r.start),r.start[1]);
   const d=dist(here,r.start);if(d>30)r.armed=true;if(m.visible&&r.armed&&d<7){r.armed=false;startRace(r);}});
  mkCp.visible=mkCp2.visible=false;
  if(race&&running){
   if(race.countdown>0){if(travelMode==='car'&&actor)actor.speed*=Math.exp(-4*dt); /* brought to the line: rolling through the countdown was a free head start */const before=Math.ceil(race.countdown);race.countdown-=dt;const after=Math.ceil(race.countdown);if(after!==before)banner(after>0?String(after):'Go!','',after>0?'pick':'pass');}
   else{race.t+=dt;const r=race.r,cp=r.cps[race.k];
    mkCp.visible=true;mkCp.position.set(cp[0],groundAt(...cp),cp[1]);mkCp.children[1].scale.setScalar(1.4+Math.sin(now/200)*.1);
    const nx=r.cps[race.k+1];if(nx){mkCp2.visible=true;mkCp2.position.set(nx[0],groundAt(...nx),nx[1]);}
    if(dist(here,cp)<14){race.k++;routeFor=null;if(race.k>=r.cps.length)finishRace();else chime('pick');}
    else if(race&&race.t>r.par[2]*2)finishRace();}
  }
  // job
  const j=job();
  if(race){mkA.visible=mkB.visible=false;}
  else{
  if(running)chainHold-=dt;
  if(state==='b'&&running){timer-=dt;if(timer<=0){banner('Job failed',`Too slow: ${esc(j.t)}. Streak lost.`,'fail');save.streak=0;save.job++;state='a';persist();routeFor=null;}}
  const t=state==='a'?j.A:j.B;
  if(running&&dist(here,t)<9&&!(state==='a'&&chainHold>0)){ /* a job picked up where the last one was delivered (Den Sorte Diamant) waits a moment: its banner replaced "Delivered!" the next frame */
   if(state==='a'){state='b';wayTo=null;hopped=false;const wa=walk.nearest(...j.A),wb=walk.nearestOpen(...j.B,blocked),len=(walk.route(wa,wb,blocked)||walk.route(wa,walk.nearest(...j.B))||[]).reduce((s,p,i,a)=>i?s+dist(p,a[i-1]):0,0)||dist(j.A,j.B)*1.4; /* timed along the way round the houses, as the GPS line goes: the plain shortest walk cut through the Black Diamond and gave Ice lollies 248 s for a 1.9 km ride (7.7 m/s; a bike does 7) */timer=Math.round(len/6+35);banner('Picked up',`Deliver to <b>${esc(j.bName)}</b> in ${timer} s`,'pick');routeFor=null;}
   else{const before=rankOf(save.delivered||0);save.delivered=(save.delivered||0)+1;save.streak=(save.streak||0)+1;
    const base=j.pay+(hopped?0:timer*4),streakBonus=save.streak>=3?Math.round(base*.25):0,pay=Math.round(base*payBonus())+streakBonus;save.money+=pay;save.job++;state='a';chainHold=2.5;persist();routeFor=null;
    const after=rankOf(save.delivered);
    if(after>before)banner(`Promoted: ${RANKS[after][0]}`,`+${fmtKr(pay)} ${UNIT} · jobs now pay +${after*10}%${RANKS[after+1]?` · next: ${esc(RANKS[after+1][0])} at ${RANKS[after+1][1]} deliveries`:''}`,'rank');
    else banner('Delivered!',`+${fmtKr(pay)} ${UNIT}${streakBonus?` · streak ×${save.streak} bonus +${fmtKr(streakBonus)}`:''}${timer>20&&!hopped?' · fast':''}`,'pass');}
  }
  mkA.visible=state==='a';mkB.visible=state==='b';mkA.position.set(j.A[0],groundAt(...j.A),j.A[1]);mkB.position.set(j.B[0],groundAt(...j.B),j.B[1]);
  }
  const pulse=1+Math.sin(performance.now()/300)*.08;mkA.children[1].scale.setScalar(pulse);mkB.children[1].scale.setScalar(pulse);
  // saga
  for(const b of mkQ)b.visible=false;
  if(save.active&&running&&!loreOpen){
   const q=byId[save.active.id];
   if(q.limit){save.active.t-=dt;if(save.active.t<=0)endSaga(false);}
   if(save.active){
    const f=frontier();f.filter(k=>!q.steps[k].clue).slice(0,5).forEach((k,i)=>{const s=q.steps[k];mkQ[i].visible=true;mkQ[i].position.set(s.p[0],groundAt(...s.p),s.p[1]);mkQ[i].children[1].scale.setScalar(pulse);});
    const clue=f.find(k=>q.steps[k].clue);if(clue!=null&&save.active.shown!==clue&&!journalOpen){save.active.shown=clue;showTreasure();}
    for(const k of f){if(trailer||cinematic)break;const s=q.steps[k];if(dist(s.p,here)>(s.r||11))continue;
     save.active.done.push(k);routeFor=null;
     if(s.card){if(!save.lore.includes(q.id+':'+k))save.lore.push(q.id+':'+k);showLore(q,s.card);}else if(s.toast)toast(`${s.toast[0]}. ${s.toast[1]}`);
     if(save.active.done.length>=q.steps.length)endSaga(true);persist();break;}
   }
  }
  // Beams fade as you reach them: standing inside one tinted the whole screen.
  for(const m of [mkA,mkB,mkCp,mkCp2,...mkQ,...mkStart])if(m.visible){const d=Math.hypot(m.position.x-here[0],m.position.z-here[1]),f=Math.min(1,Math.max(0,(d-12)/30));m.children[0].material.opacity=.18*f;m.children[0].visible=f>0;}
  if(wayTo&&dist(wayTo,here)<8){wayTo=null;routeFor=null;}
  // GPS line
  routeT-=dt;const tg=target();
  if(!routeFor||dist(routeFor,tg.p)>1||routeT<=0&&line.progress(actor.x,actor.z)>25){routeT=3;rebuild();}
  warmNext(tg.p);
  line.progress(actor.x,actor.z);
  hudClock+=dt;if(hudClock>.2){hudClock=0;updateHud();} // 5 Hz is plenty for distances and timers
 }

 function key(code){
  if(loreOpen){if(['Enter','Space','Escape','KeyG'].includes(code)){nextLore();return true;}return true;}
  if(tmapOpen){if(['KeyK','Escape','Enter'].includes(code))closeTreasure();return true;}
  if(journalOpen){if(code==='KeyJ'||code==='Escape')toggleJournal(false);return true;}
  if(code==='KeyX'&&race){banner('Race abandoned',esc(race.r.title),'fail');race=null;races.forEach(r=>r.armed=false);routeFor=null;return true;}
  if(code==='KeyJ'){toggleJournal(true);return true;}
  if(code==='KeyK'){showTreasure();return true;}
  return false;
 }
 const blocking=()=>loreOpen||journalOpen||tmapOpen;
 // ?cinematic (cinematic.js): show a saga as it starts, banner and red beam, without saving anything; end() puts back the
 // player's own state.
 let trailerSave=null;
 const trailerApi={saga(id){const q=byId[id];if(!q)return false;if(!trailer){trailer=true;trailerSave=JSON.stringify(save);}save.active={id,done:[],t:0,shown:-1};routeFor=null;banner('Saga started',`${esc(q.title)} · follow the red beam`,'pick');return true;},
  banner:(title,sub,kind)=>banner(title,sub,kind),
  end(){if(!trailer)return;try{save=JSON.parse(trailerSave);}catch{}trailer=false;trailerSave=null;routeFor=null;ban.hidden=true;}};
 // A map jump, reset or restart (main.js setStart): a race can't go on from somewhere else, and a delivery reached that way earns no time bonus.
 function teleported(){if(race){banner('Race abandoned',esc(race.r.title),'fail');race=null;routeFor=null;}races.forEach(r=>r.armed=false); /* arriving on a start (the map's Nørreport, Kongens Nytorv) started that race unasked: drive off 30 m and back to start it */if(wayTo){wayTo=null;routeFor=null;}if(state==='b')hopped=true;}
 return {teleported,setFurniture,trailer:trailerApi,paper:()=>{try{sessionStorage.removeItem('cph-paper-'+ERA);}catch{}showPaper();},photo,debug:()=>({race:race&&{id:race.r.id,k:race.k,t:race.t,c:race.countdown},armed:races.map(r=>r.armed),state,started,player:player&&[player.x,player.z]}),update,key,blocking,people,api,minimapTargets:()=>{const out=[];if(race){out.push({p:race.r.cps[race.k],color:ERA==='h'?'#e0a040':'#ff4fd8'});return out;}for(const r of races)if(state!=='b')out.push({p:r.start,color:ERA==='h'?'#b5462e':'#9b5de5',small:true});const j=job();out.push({p:state==='a'?j.A:j.B,color:state==='a'?'#f2b134':'#46c2b0'});if(save.active){const q=byId[save.active.id];for(const k of frontier())if(!q.steps[k].clue)out.push({p:q.steps[k].p,color:'#e0313e'});}return out;},route:()=>line.ahead()};
}
