import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {waterAt,groundAt} from '../terrain.js';

// Havnebadet Islands Brygge: the harbour bath on the Amager quay, opposite Fisketorvet. Wooden decks on the
// harbour water frame the pools, white railings, a lifeguard hut and the blue-white diving tower, with
// bathers on the boards and swimmers in the water. Modern Copenhagen only, one merged mesh plus one crowd.
const QUAY_A=[-148,1620],QUAY_B=[-252,1760]; // the surveyed quay edge here (city.pack water, Sydhavnen)

const paint=(g,hex)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();for(const k of Object.keys(n.attributes))if(k!=='position'&&k!=='normal')n.deleteAttribute(k);const c=new THREE.Color(hex),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));return n;};

// Moored boats and other harbour clutter keep out of the bath (local frame, with a margin).
export function inHarbourBath(x,z,margin=6){
 const L=Math.hypot(QUAY_B[0]-QUAY_A[0],QUAY_B[1]-QUAY_A[1]),u=[(QUAY_B[0]-QUAY_A[0])/L,(QUAY_B[1]-QUAY_A[1])/L],n=[-u[1],u[0]],mid=[(QUAY_A[0]+QUAY_B[0])/2,(QUAY_A[1]+QUAY_B[1])/2];
 const dx=x-mid[0],dz=z-mid[1],a=dx*u[0]+dz*u[1],b=dx*n[0]+dz*n[1];return Math.abs(a)<32+margin&&b>-margin&&b<30+margin;
}
export function createHarbourBath({createPeople}={}){
 const group=new THREE.Group();group.name='Havnebadet Islands Brygge';
 const L=Math.hypot(QUAY_B[0]-QUAY_A[0],QUAY_B[1]-QUAY_A[1]),u=[(QUAY_B[0]-QUAY_A[0])/L,(QUAY_B[1]-QUAY_A[1])/L],n=[-u[1],u[0]]; // n points out over the water (west)
 const mid=[(QUAY_A[0]+QUAY_B[0])/2,(QUAY_A[1]+QUAY_B[1])/2],wl=waterAt(mid[0]+n[0]*12,mid[1]+n[1]*12)??-1.2,deck=wl+.75;
 // local (a along the quay, b out over the water) -> world
 const W=(a,b)=>[mid[0]+u[0]*a+n[0]*b,mid[1]+u[1]*a+n[1]*b];
 const yaw=Math.atan2(u[0],u[1]);
 const parts=[];
 const box=(a,b,y,la,lb,h,hex)=>{const g=new THREE.BoxGeometry(lb,h,la);g.rotateY(yaw); /* rotateY(yaw) turns local z onto the quay (u) and x onto -n */const [x,z]=W(a,b);g.translate(x,y+h/2,z);parts.push(paint(g,hex));};
 const WOOD='#9c7a55',WOOD2='#8a6a48',WHITE='#eef0ee',BLUE='#2f6fa8';
 // decks: an outer frame 64 x 28 m, a cross deck splitting off the children's pool, and the gangways
 const A0=-32,A1=32,B0=2,B1=30,T=3.2;
 box(0,B0+T/2,deck-.25,A1-A0,T,.25,WOOD);box(0,B1-T/2,deck-.25,A1-A0,T,.25,WOOD);
 box(A0+T/2,(B0+B1)/2,deck-.25,T,B1-B0,.25,WOOD);box(A1-T/2,(B0+B1)/2,deck-.25,T,B1-B0,.25,WOOD);
 box(-12,(B0+B1)/2,deck-.25,2.4,B1-B0,.25,WOOD2);box(10,(B0+B1)/2,deck-.25,2,B1-B0,.25,WOOD2); // children's pool, lane divider
 for(const a of [-22,6,24]){const q=groundAt(...W(a,-1));box(a,1,Math.min(q,deck)-.1,3.4,4.2,.22,WOOD2);}
 // a sunbathing terrace along the quay side
 box(0,B0-1.5,deck-.25,40,3,.25,WOOD);
 // pool edges: a blue line on the inner deck edges
 box(0,B0+T+.05,deck,A1-A0-2*T,.1,.03,BLUE);box(0,B1-T-.05,deck,A1-A0-2*T,.1,.03,BLUE);
 // white railing on the outer edges (posts every 2 m, top and mid rails)
 const rail=(a0,b0,a1,b1)=>{const len=Math.hypot(a1-a0,b1-b0),ca=(a1-a0)/len,cb=(b1-b0)/len;for(let s=0;s<=len;s+=2){box(a0+ca*s,b0+cb*s,deck,.07,.07,1.05,WHITE);}
  const g=(y,t)=>{const geo=new THREE.BoxGeometry(t,t,len);geo.rotateY(Math.atan2(u[0]*ca+n[0]*cb,u[1]*ca+n[1]*cb));const [x,z]=W((a0+a1)/2,(b0+b1)/2);geo.translate(x,y,z);parts.push(paint(geo,WHITE));};g(deck+1.05,.08);g(deck+.55,.05);};
 rail(A0,B0+2,A0,B1);rail(A1,B0+2,A1,B1);
 // diving tower at the outer corner: three platforms (1, 3 and 5 m) on white legs, blue boards
 const da=A1-8,db=B1-1.6;
 rail(A0,B1,da-2,B1);rail(da+2,B1,A1,B1); // outer rail, open where the boards reach out
 for(const [dx,dy] of [[-1.2,0],[1.2,0],[-1.2,-1.6],[1.2,-1.6]])box(da+dx,db+dy,deck,.22,.22,5.2,WHITE);
 for(const [h,len] of [[1,2.6],[3,3.2],[5,3.6]]){box(da,db+len/2-.4,deck+h,1.4,len,.12,BLUE);box(da,db+len-.45,deck+h+.12,1.5,.06,.9,WHITE);}
 box(da+1.6,db-.8,deck,.6,.08,5.2,WHITE); // ladder rail
 // lifeguard hut by the gangway: white box with a red roof band and a blue door
 box(-26,B0+T/2,deck,3,2.4,2.4,WHITE);box(-26,B0+T/2,deck+2.4,3.3,2.7,.25,'#c8323a');box(-24.45,B0+T/2,deck,.05,.9,1.9,BLUE);
 // flag pole with a Danish flag
 box(-28.5,B0+.6,deck,.1,.1,7,WHITE);box(-27.85,B0+.6,deck+6.1,1.3,.04,.85,'#c8102e');box(-27.85,B0+.6,deck+6.5,1.32,.05,.1,'#ffffff');box(-27.85,B0+.6,deck+6.1,.12,.05,.86,'#ffffff');
 const mesh=new THREE.Mesh(mergeGeometries(parts),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.82}));parts.forEach(g=>g.dispose());
 mesh.castShadow=true;mesh.receiveShadow=true;mesh.name='Harbour bath decks';group.add(mesh);
 // swimmers: heads and caps in the pools
 const heads=[],caps=['#e8452f','#f2c230','#2f6fa8','#ffffff','#1d1d1d'];let seed=7;const r=()=>(seed=(seed*16807)%2147483647)/2147483647;
 for(let i=0;i<22;i++){const a=A0+T+1+r()*(A1-A0-2*T-2),b=B0+T+1+r()*(B1-B0-2*T-2);if(Math.abs(a+12)<2||Math.abs(a-10)<1.6)continue;const [x,z]=W(a,b);
  const h=new THREE.SphereGeometry(.13,8,6);h.translate(x,wl+.08,z);heads.push(paint(h,r()<.5?caps[Math.floor(r()*caps.length)]:'#c99a78'));}
 if(heads.length){const sw=new THREE.Mesh(mergeGeometries(heads),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.5}));heads.forEach(g=>g.dispose());sw.name='Swimmers';group.add(sw);}
 // bathers on the boards (towels on the terrace, people standing about and queueing for the tower)
 const towels=[];for(let i=0;i<14;i++){const a=-18+r()*36,[x,z]=W(a,B0+1.2+r()*1.4);const g=new THREE.BoxGeometry(.9,.02,1.8);g.rotateY(yaw+Math.PI/2+(r()-.5)*.4);g.translate(x,deck,z);towels.push(paint(g,['#e8452f','#2f6fa8','#f2c230','#3aa17e','#f0f0f0'][i%5]));}
 const tw=new THREE.Mesh(mergeGeometries(towels),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95}));towels.forEach(g=>g.dispose());tw.name='Towels';tw.receiveShadow=true;group.add(tw);
 const people=[];const at=(a,b,extra={})=>{const [x,z]=W(a,b);people.push({x,z,heading:yaw+(r()-.5)*3,pose:r()<.5?'chat':'browse',groundY:deck-groundAt(x,z)+.02,talkable:false,...extra});};
 for(let i=0;i<10;i++)at(-20+r()*40,B0+T/2+(r()-.5)*1.6);
 for(let i=0;i<8;i++)at(A0+T/2+(r()-.5),B0+T+r()*(B1-B0-2*T));
 for(let i=0;i<4;i++)at(da-2.4-i*.9,B1-T/2+(r()-.5)*.6,{pose:'browse',heading:yaw}); // queueing for the tower along the outer deck
 const crowd=people.length&&createPeople?createPeople(people,{name:'Harbour bath bathers',center:{x:mid[0],z:mid[1]},seed:4242}):null;if(crowd)group.add(crowd.group);
 const obstacles=[]; // the bath is on the water: the car cannot reach it, walkers come by the gangways
 return {group,crowd,obstacles,center:{x:mid[0]+n[0]*16,z:mid[1]+n[1]*16},update(dt,player){crowd?.update(dt,player);}};
}
