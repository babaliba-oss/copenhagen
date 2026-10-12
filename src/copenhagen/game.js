// Copenhagen game layer (ported from Grand Theft Ladcykel): delivery jobs with a GPS line that is eaten
// as you ride it, money, and sagas from Danish history and folklore given by named characters, with lore
// cards, a journal (J) and a hand-drawn treasure map (K). Runs on top of the shared engine: it only reads
// the player's position and travel mode, draws its own markers and HUD, and plugs its characters into the
// shared conversation system (characters.js).
import * as THREE from 'three';
import proj4 from 'proj4';
import {groundAt} from '../terrain.js';
import {JOBS,JOBS_1760,SAGAS,CHARACTERS} from './data.js';
import {connectCharacters} from './characters.js';
import './copenhagen.css';

const SAVE_KEY='cph-game-v1';
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtKr=n=>Math.round(n).toLocaleString('da-DK');let UNIT='kr'; // 1760: skilling (96 to the rigsdaler)
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);

// ---------- routing (A* over the city's walk or road graph) ----------
function makeGraph(g,undirected){
 const n=g.nodes.length,adj=Array.from({length:n},()=>[]);
 for(const e of g.edges){const len=e.length||e.points.reduce((s,p,i)=>i?s+dist(p,e.points[i-1]):0,0);adj[e.from].push({to:e.to,len,points:e.points});if(undirected)adj[e.to].push({to:e.from,len,points:[...e.points].reverse()});}
 const cell=new Map(),C=60;g.nodes.forEach((p,i)=>{if(!adj[i].length)return;const k=Math.floor(p[0]/C)+','+Math.floor(p[1]/C);if(!cell.has(k))cell.set(k,[]);cell.get(k).push(i);});
 function nearest(x,z){let best=-1,bd=1e18;for(let r=0;r<6&&best<0;r++)for(let i=-r;i<=r;i++)for(let j=-r;j<=r;j++){if(Math.max(Math.abs(i),Math.abs(j))!==r)continue;for(const k of cell.get((Math.floor(x/C)+i)+','+(Math.floor(z/C)+j))||[]){const d=(g.nodes[k][0]-x)**2+(g.nodes[k][1]-z)**2;if(d<bd){bd=d;best=k;}}}return best;}
 function route(a,b){
  if(a<0||b<0)return null;const gs=new Float64Array(n).fill(Infinity),came=new Int32Array(n).fill(-1),via=new Array(n),heap=[[0,a]];gs[a]=0;let it=0;
  const push=(f,v)=>{heap.push([f,v]);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p][0]<=heap[i][0])break;[heap[p],heap[i]]=[heap[i],heap[p]];i=p;}};
  const pop=()=>{const t=heap[0],l=heap.pop();if(heap.length){heap[0]=l;let i=0;for(;;){const L=i*2+1,R=L+1;let m=i;if(L<heap.length&&heap[L][0]<heap[m][0])m=L;if(R<heap.length&&heap[R][0]<heap[m][0])m=R;if(m===i)break;[heap[m],heap[i]]=[heap[i],heap[m]];i=m;}}return t;};
  while(heap.length&&it++<200000){const [f,v]=pop();if(v===b)break;if(f-dist(g.nodes[v],g.nodes[b])>gs[v]+1e-6)continue;
   for(const e of adj[v]){const ng=gs[v]+e.len;if(ng<gs[e.to]){gs[e.to]=ng;came[e.to]=v;via[e.to]=e;push(ng+dist(g.nodes[e.to],g.nodes[b]),e.to);}}}
  if(!Number.isFinite(gs[b]))return null;const pts=[];for(let v=b;v!==a;v=came[v]){const e=via[v];for(let i=e.points.length-1;i>0;i--)pts.push(e.points[i]);}pts.push(g.nodes[a]);return pts.reverse();
 }
 return {nearest,route,nodes:g.nodes};
}

// ---------- the line on the street (eaten from behind as you ride it) ----------
function createRouteLine(scene){
 const u={uProg:{value:0}},mat=new THREE.MeshBasicMaterial({color:0xb46bff,transparent:true,opacity:.62,depthWrite:false,fog:false});
 mat.onBeforeCompile=sh=>{sh.uniforms.uProg=u.uProg;
  sh.vertexShader=sh.vertexShader.replace('void main() {','attribute float rd; varying float vRd;\nvoid main() { vRd = rd;');
  sh.fragmentShader=sh.fragmentShader.replace('void main() {','uniform float uProg; varying float vRd;\nvoid main() { if (vRd < uProg) discard;').replace('vec4 diffuseColor = vec4( diffuse, opacity );','vec4 diffuseColor = vec4( diffuse, opacity * clamp((vRd - uProg) / 6.0, 0.0, 1.0) );');};
 let mesh=null,pts=null,cum=null,seg=0;const out={points:null};
 out.set=points=>{if(mesh){scene.remove(mesh);mesh.geometry.dispose();mesh=null;}pts=points;out.points=points;seg=0;u.uProg.value=0;if(!points||points.length<2)return;
  cum=[0];for(let i=1;i<pts.length;i++)cum.push(cum[i-1]+dist(pts[i],pts[i-1]));
  const pos=[],rd=[];for(let i=0;i<pts.length-1;i++){const [ax,az]=pts[i],[bx,bz]=pts[i+1],l=dist(pts[i],pts[i+1]);if(l<.1)continue;const nx=-(bz-az)/l*.5,nz=(bx-ax)/l*.5,ya=groundAt(ax,az)+.22,yb=groundAt(bx,bz)+.22;
   pos.push(ax+nx,ya,az+nz,bx+nx,yb,bz+nz,bx-nx,yb,bz-nz,ax+nx,ya,az+nz,bx-nx,yb,bz-nz,ax-nx,ya,az-nz);rd.push(cum[i],cum[i+1],cum[i+1],cum[i],cum[i+1],cum[i]);}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('rd',new THREE.Float32BufferAttribute(rd,1));
  mesh=new THREE.Mesh(g,mat);mesh.renderOrder=3;mesh.frustumCulled=false;scene.add(mesh);};
 // Progress: project the player onto the next few segments; returns the distance off the line.
 out.progress=(x,z)=>{if(!pts||pts.length<2)return Infinity;let best=1e9,bi=seg,bt=0;
  for(let i=Math.max(0,seg-2);i<Math.min(pts.length-1,seg+40);i++){const [ax,az]=pts[i],[bx,bz]=pts[i+1],dx=bx-ax,dz=bz-az,l2=dx*dx+dz*dz||1,t=clamp(((x-ax)*dx+(z-az)*dz)/l2,0,1),d=Math.hypot(ax+dx*t-x,az+dz*t-z);if(d<best){best=d;bi=i;bt=t;}}
  if(best<30){seg=bi;u.uProg.value=cum[bi]+(cum[bi+1]-cum[bi])*bt-1.5;}return best;};
 out.remaining=()=>pts?Math.max(0,cum.at(-1)-u.uProg.value):0;
 out.ahead=()=>pts?pts.slice(seg):null;
 return out;
}

// ---------- beams over targets ----------
function beam(scene,color,h=80){
 const g=new THREE.Group();
 const col=new THREE.Mesh(new THREE.CylinderGeometry(2.4,2.4,h,20,1,true),new THREE.MeshBasicMaterial({color,transparent:true,opacity:.18,side:THREE.DoubleSide,depthWrite:false,fog:false}));col.position.y=h/2;
 const ring=new THREE.Mesh(new THREE.TorusGeometry(4.2,.28,6,36),new THREE.MeshBasicMaterial({color,fog:false}));ring.rotation.x=Math.PI/2;ring.position.y=.6;
 g.add(col,ring);g.visible=false;scene.add(g);return g;
}

export function createCopenhagenGame({scene,city,mobilityData,cityData,toast}){
 const proj=proj4('EPSG:4326',city.projection);
 const ll=([lat,lon])=>{const [x,y]=proj.forward([lon,lat]);return [x,-y];};
 const walk=makeGraph(mobilityData.walks,true),road=makeGraph(mobilityData.roads,false);
 const ERA=city.era===1760?'h':'m';UNIT=ERA==='h'?'sk.':'kr';const inEra=e=>(e||'m')===ERA||e==='b',cast=CHARACTERS.filter(c=>inEra(c.era));
 const jobs=(ERA==='h'?JOBS_1760:JOBS).map(j=>({...j,A:ll(j.a),B:ll(j.b),aName:j.a[2],bName:j.b[2]}));
 const sagas=SAGAS.filter(s=>inEra(s.era)).map(s=>({...s,steps:s.steps.map(st=>({...st,p:ll(st.at)}))}));
 const byId=Object.fromEntries(sagas.map(s=>[s.id,s]));
 const people=cast.map(c=>{const [x,z]=ll(c.at);return {id:`cph-${c.id}`,script:c.id,x,z,heading:0,pose:'chat',walking:false,talkable:true,...(c.look.height?{height:c.look.height}:{})};});

 // ---- save ----
 let save={money:0,job:0,done:{},lore:[],active:null};
 const KEY=SAVE_KEY+(ERA==='h'?'-1760':'');try{save={...save,...JSON.parse(localStorage.getItem(KEY)||'{}')};}catch{}
 if(save.active&&(!byId[save.active.id]||byId[save.active.id].limit))save.active=null; // timed sagas restart after a reload
 const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify(save));}catch{}};

 // ---- HUD ----
 const hud=document.createElement('div');hud.id='cph-hud';hud.innerHTML=`<div class="cph-money" id="cph-money"></div><div class="cph-card" id="cph-job"></div><div class="cph-card cph-saga" id="cph-saga" hidden></div>`;
 const lore=document.createElement('div');lore.id='cph-lore';lore.hidden=true;lore.innerHTML=`<div class="cph-lore-card" role="dialog"><div class="cph-kick" id="cph-lore-kick"></div><h2 id="cph-lore-title"></h2><p id="cph-lore-text"></p><button id="cph-lore-go">Continue <kbd>Enter</kbd></button></div>`;
 const journal=document.createElement('div');journal.id='cph-journal';journal.hidden=true;
 const tmap=document.createElement('div');tmap.id='cph-tmap';tmap.hidden=true;tmap.innerHTML=`<div class="cph-tmap-wrap"><div id="cph-tmap-canvas"></div><p>No GPS for this one. The saga card tells you if you’re getting warmer.</p><button id="cph-tmap-close">Put the map away <kbd>K</kbd></button></div>`;
 document.body.append(hud,lore,journal,tmap);
 const $=id=>document.getElementById(id);

 // ---- world markers ----
 const mkA=beam(scene,0xf2b134),mkB=beam(scene,0x46c2b0),mkQ=[0,1,2,3,4].map(()=>beam(scene,0xe0313e,100));
 const line=createRouteLine(scene);
 let state='a',timer=0,routeFor=null,routeT=0,player=null,mode='car',started=false;
 const job=()=>jobs[save.job%jobs.length];

 // ---- sagas ----
 const frontier=()=>{const a=save.active;if(!a)return [];const q=byId[a.id],i=q.steps.findIndex((s,k)=>!a.done.includes(k));if(i<0)return [];if(!q.steps[i].any)return [i];const out=[];for(let k=i;k<q.steps.length&&q.steps[k].any;k++)if(!a.done.includes(k))out.push(k);return out;};
 const giverName=q=>CHARACTERS.find(c=>c.id===q.giver)?.name||q.giver;
 const loreQ=[];let loreOpen=false,journalOpen=false,tmapOpen=false;
 function showLore(q,card){loreQ.push([q,card]);if(!loreOpen)nextLore();}
 function nextLore(){const it=loreQ.shift();if(!it){loreOpen=false;lore.hidden=true;return;}const [q,[t,txt]]=it;loreOpen=true;$('cph-lore-kick').textContent=q.title;$('cph-lore-title').textContent=t;$('cph-lore-text').textContent=txt;lore.hidden=false;}
 $('cph-lore-go').onclick=()=>nextLore();
 function startSaga(id){const q=byId[id];save.active={id,done:[],t:q.limit||0,shown:-1};persist();routeFor=null;toast(`${q.title}: saga started. Follow the red beam.`);}
 function endSaga(win){const q=byId[save.active.id];if(win){save.done[q.id]=1;save.money+=q.pay;toast(`Saga complete: ${q.title}. +${fmtKr(q.pay)} ${UNIT}`,{important:true});}else toast(`Saga failed: ${q.title}. Talk to ${giverName(q)} to try again.`,{important:true});save.active=null;persist();routeFor=null;}
 const api={
  era:ERA,
  money:()=>fmtKr(save.money)+' '+UNIT,
  spend:n=>{if(save.money<n)return false;save.money-=n;persist();return true;},
  sagaChoice:id=>{const q=byId[id];if(!q||save.done[id]||save.active?.id===id)return [];return [{id:`saga:${id}`,label:`Saga: ${q.title}`}];},
  sagaIntro:id=>{const q=byId[id];if(save.active&&save.active.id!==id)return {response:`Finish what you started first. ${byId[save.active.id].title} is still waiting.`,choices:[{id:'bye',label:'Right'}],expression:'friendly'};
   return {response:q.intro,choices:[{id:`accept:${id}`,label:`Accept · ${fmtKr(q.pay)} ${UNIT}${q.limit?` · ${Math.round(q.limit/60)} min`:''}`},{id:'bye',label:'Not now'}],expression:'friendly'};},
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
 function showTreasure(){const a=save.active;if(!a||!byId[a.id].steps.some(s=>s.clue)){toast('No treasure map yet. Ole at Gammel Strand has one.');return;}const q=byId[a.id],f=frontier().filter(k=>q.steps[k].clue);if(!f.length)return;const box=$('cph-tmap-canvas');box.replaceChildren(drawClue(q,f[0]));tmapOpen=true;tmap.hidden=false;}
 const closeTreasure=()=>{tmapOpen=false;tmap.hidden=true;};$('cph-tmap-close').onclick=closeTreasure;
 const warmth=d=>d<35?'hot!':d<100?'warm':d<250?'lukewarm':d<600?'cold':'freezing';

 // ---- journal (J) ----
 function renderJournal(){
  const rows=sagas.map(q=>{const done=!!save.done[q.id],act=save.active?.id===q.id;const cards=q.steps.map((s,k)=>[s,k]).filter(([s,k])=>s.card&&save.lore.includes(q.id+':'+k));
   return `<article class="cph-jq${done?' done':''}${act?' act':''}"><div class="cph-jh"><span>${q.limit?'Timed · ':''}${fmtKr(q.pay)} ${UNIT}</span></div><h3>${esc(q.title)}</h3><p class="cph-js">${done?'Complete':act?`In progress · ${save.active.done.length}/${q.steps.length}`:`Ask ${esc(giverName(q))}`}</p>${cards.map(([s])=>`<details><summary>${esc(s.card[0])}</summary><p>${esc(s.card[1])}</p></details>`).join('')}${!done&&!act?`<button data-way="${q.giver}">Show me the way</button>`:''}${act?`<button data-abandon="1">Abandon</button>`:''}</article>`;}).join('');
  journal.innerHTML=`<div class="cph-jcard" role="dialog"><div class="cph-jtop"><div><p class="cph-kick">Stories from Danish history and folklore</p><h2>Sagas</h2></div><button id="cph-jclose">Close <kbd>J</kbd></button></div><div class="cph-jlist">${rows}</div></div>`;
  $('cph-jclose').onclick=()=>toggleJournal(false);
  journal.querySelectorAll('[data-way]').forEach(b=>b.onclick=()=>{const c=people.find(p=>p.script===b.dataset.way);if(c){wayTo=[c.x,c.z];routeFor=null;toggleJournal(false);toast(`Route set to ${CHARACTERS.find(x=>x.id===c.script).name}`);}});
  journal.querySelectorAll('[data-abandon]').forEach(b=>b.onclick=()=>{save.active=null;persist();routeFor=null;renderJournal();});
 }
 function toggleJournal(v){journalOpen=v??!journalOpen;journal.hidden=!journalOpen;if(journalOpen)renderJournal();}
 let wayTo=null;

 // ---- target for the GPS line: a walk to a character, the saga, or the job ----
 function target(){
  if(wayTo)return {p:wayTo,kind:'way'};
  if(state!=='b'&&save.active){const q=byId[save.active.id],f=frontier().filter(k=>!q.steps[k].clue);if(f.length){let best=f[0];for(const k of f)if(dist(q.steps[k].p,[player.x,player.z])<dist(q.steps[best].p,[player.x,player.z]))best=k;return {p:q.steps[best].p,kind:'saga'};}}
  return {p:state==='a'?job().A:job().B,kind:'job'};
 }
 function rebuild(){const t=target();routeFor=t.p;const G=mode==='car'?road:walk;const a=G.nearest(player.x,player.z),b=G.nearest(t.p[0],t.p[1]);const pts=G.route(a,b);line.set(pts?[[player.x,player.z],...pts,t.p]:null);}

 function updateHud(){
  $('cph-money').textContent=fmtKr(save.money)+' '+UNIT;
  const j=job(),t=state==='a'?j.A:j.B,d=line.points?line.remaining():dist(t,[player.x,player.z]);
  $('cph-job').innerHTML=`<p class="cph-kick">Job ${save.job%jobs.length+1}/${jobs.length}</p><h3>${esc(j.t)}</h3><p>${esc(j.d)}</p><p class="cph-go">${state==='a'?'Pick up at':'Deliver to'} <b>${esc(state==='a'?j.aName:j.bName)}</b> · ${d>1000?(d/1000).toFixed(1)+' km':Math.round(d/10)*10+' m'}${state==='b'?` · <span class="${timer<15?'cph-low':''}">${Math.max(0,timer).toFixed(0)} s</span>`:''}</p>`;
  const sg=$('cph-saga');if(!save.active){sg.hidden=true;return;}sg.hidden=false;
  const q=byId[save.active.id],f=frontier();
  sg.innerHTML=`<p class="cph-kick">Saga · <kbd>J</kbd> journal${q.steps.some(s=>s.clue)?' · <kbd>K</kbd> map':''}</p><h3>${esc(q.title)}</h3><ol>${q.steps.map((s,k)=>{const dn=save.active.done.includes(k),c=f.includes(k),dd=dist(s.p,[player.x,player.z]);return `<li class="${dn?'d':c?'c':''}">${esc(s.name)}${c?` <span>${s.clue?warmth(dd):dd>1000?(dd/1000).toFixed(1)+' km':Math.round(dd/10)*10+' m'}</span>`:''}</li>`;}).join('')}</ol>${q.limit?`<p class="cph-timer ${save.active.t<30?'cph-low':''}">${Math.max(0,save.active.t).toFixed(0)} s</p>`:''}`;
 }

 function update(dt,actor,travelMode,{running=true}={}){
  player=actor;started=running;if(!actor)return;
  if(travelMode!==mode){mode=travelMode;routeFor=null;}
  const here=[actor.x,actor.z];
  // job
  const j=job();
  if(state==='b'&&running){timer-=dt;if(timer<=0){toast(`Too slow: ${j.t} failed.`);save.job++;state='a';persist();routeFor=null;}}
  const t=state==='a'?j.A:j.B;
  if(running&&dist(here,t)<9){
   if(state==='a'){state='b';const len=(walk.route(walk.nearest(...j.A),walk.nearest(...j.B))||[]).reduce((s,p,i,a)=>i?s+dist(p,a[i-1]):0,0)||dist(j.A,j.B)*1.4;timer=Math.round(len/6+35);toast(`Picked up. Deliver to ${j.bName} in ${timer} s.`);routeFor=null;}
   else{const pay=Math.round(j.pay+timer*4);save.money+=pay;save.job++;state='a';persist();toast(`Delivered! +${fmtKr(pay)} ${UNIT}`,{important:true});routeFor=null;}
  }
  mkA.visible=state==='a';mkB.visible=state==='b';mkA.position.set(j.A[0],groundAt(...j.A),j.A[1]);mkB.position.set(j.B[0],groundAt(...j.B),j.B[1]);
  const pulse=1+Math.sin(performance.now()/300)*.08;mkA.children[1].scale.setScalar(pulse);mkB.children[1].scale.setScalar(pulse);
  // saga
  for(const b of mkQ)b.visible=false;
  if(save.active&&running&&!loreOpen){
   const q=byId[save.active.id];
   if(q.limit){save.active.t-=dt;if(save.active.t<=0)endSaga(false);}
   if(save.active){
    const f=frontier();f.filter(k=>!q.steps[k].clue).slice(0,5).forEach((k,i)=>{const s=q.steps[k];mkQ[i].visible=true;mkQ[i].position.set(s.p[0],groundAt(...s.p),s.p[1]);mkQ[i].children[1].scale.setScalar(pulse);});
    const clue=f.find(k=>q.steps[k].clue);if(clue!=null&&save.active.shown!==clue&&!journalOpen){save.active.shown=clue;showTreasure();}
    for(const k of f){const s=q.steps[k];if(dist(s.p,here)>(s.r||11))continue;
     save.active.done.push(k);routeFor=null;
     if(s.card){if(!save.lore.includes(q.id+':'+k))save.lore.push(q.id+':'+k);showLore(q,s.card);}else if(s.toast)toast(`${s.toast[0]}. ${s.toast[1]}`);
     if(save.active.done.length>=q.steps.length)endSaga(true);persist();break;}
   }
  }
  if(wayTo&&dist(wayTo,here)<8){wayTo=null;routeFor=null;}
  // GPS line
  routeT-=dt;const tg=target();
  if(!routeFor||dist(routeFor,tg.p)>1||routeT<=0&&line.progress(actor.x,actor.z)>25){routeT=3;rebuild();}
  line.progress(actor.x,actor.z);
  updateHud();
 }

 function key(code){
  if(loreOpen){if(['Enter','Space','Escape','KeyG'].includes(code)){nextLore();return true;}return true;}
  if(tmapOpen){if(['KeyK','Escape','Enter'].includes(code))closeTreasure();return true;}
  if(journalOpen){if(code==='KeyJ'||code==='Escape')toggleJournal(false);return true;}
  if(code==='KeyJ'){toggleJournal(true);return true;}
  if(code==='KeyK'){showTreasure();return true;}
  return false;
 }
 const blocking=()=>loreOpen||journalOpen||tmapOpen;
 return {update,key,blocking,people,api,minimapTargets:()=>{const out=[];const j=job();out.push({p:state==='a'?j.A:j.B,color:state==='a'?'#f2b134':'#46c2b0'});if(save.active){const q=byId[save.active.id];for(const k of frontier())if(!q.steps[k].clue)out.push({p:q.steps[k].p,color:'#e0313e'});}return out;},route:()=>line.ahead()};
}
