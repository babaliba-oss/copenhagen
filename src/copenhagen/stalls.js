import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {groundAt} from '../terrain.js';
import {rangeInstances} from '../instance-range.js';

// 1760 market stalls on the squares (scripts/market-1760.py → stalls.json): a trestle table under a linen
// awning on poles, with barrels and baskets. Awning colours vary per stall. model: a stall model (Daniel's food stand,
// produce towards +Z, where the customer stands) drawn instead, where it loads.
const paint=(g,hex)=>{const n=g.index?g.toNonIndexed():g;if(n!==g)g.dispose();for(const k of Object.keys(n.attributes))if(k!=='position'&&k!=='normal')n.deleteAttribute(k);const c=new THREE.Color(hex),a=new Float32Array(n.attributes.position.count*3);for(let i=0;i<a.length;i+=3)a.set([c.r,c.g,c.b],i);n.setAttribute('color',new THREE.BufferAttribute(a,3));return n;};
const box=(w,h,d,x,y,z,hex)=>paint(new THREE.BoxGeometry(w,h,d).translate(x,y,z),hex);
// Where no stall stands (createStalls' skip): within 4.6 m of the road graph's lane lines (on a 20 m grid), where coaches drive
// (lane offset 1.6 + coach half width 1 + stall half size 1.3 + a little), or within RACE_CLEAR of a race's start: the start
// fires 7 m from the coach's centre, and a stall 10 m south-east of the Coachman's Dash's on Kongens Nytorv met the coach's
// nose first (7 m + the coach's 3.3 m front + the stall's 1.8 m half diagonal): coming in over the square from that side it never started.
export const RACE_CLEAR=12.2;
export function stallSkip(edges,starts=[]){const lanes=new Map(),C=20;
 for(const e of edges)for(let k=1;k<e.points.length;k++){const [ax,az]=e.points[k-1],[bx,bz]=e.points[k],L=Math.hypot(bx-ax,bz-az);for(let t=0;t<=L;t+=3){const x=ax+(bx-ax)*t/Math.max(L,1e-6),z=az+(bz-az)*t/Math.max(L,1e-6),key=Math.floor(x/C)+','+Math.floor(z/C);(lanes.get(key)||lanes.set(key,[]).get(key)).push([x,z]);}}
 return (x,z)=>{for(const p of starts)if(Math.hypot(p[0]-x,p[1]-z)<RACE_CLEAR)return true;for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const [px,pz] of lanes.get((Math.floor(x/C)+i)+','+(Math.floor(z/C)+j))||[])if(Math.hypot(px-x,pz-z)<4.6)return true;return false;};}
// skip(x,z): leave out a stall there (main.js: one standing on a traffic lane across a square, where coaches drive).
export function createStalls(data,{skip=()=>false,model=null}={}){
 const group=new THREE.Group();group.name='Market stalls';const list=(data?.stalls||[]).filter(([x,z])=>!skip(x,z));if(!list.length)return {group,obstacles:[],people:[]};
 const base=model||mergeGeometries([box(2.4,.08,1.1,0,.85,0,'#8a6b45'),...[[-1.1,-.45],[1.1,-.45],[-1.1,.45],[1.1,.45]].map(([x,z])=>box(.07,.85,.07,x,.42,z,'#5b4630')),
  ...[[-1.25,-.65],[1.25,-.65],[-1.25,.75],[1.25,.75]].map(([x,z])=>box(.06,2.3,.06,x,1.15,z,'#5b4630')),
  paint(new THREE.CylinderGeometry(.28,.24,.6,8).translate(-.7,.3,1.0),'#6b4a2e'),paint(new THREE.CylinderGeometry(.28,.24,.6,8).translate(-.1,.3,1.05),'#6b4a2e'),
  paint(new THREE.CylinderGeometry(.22,.16,.22,8).translate(.5,1.0,0),'#b08a55'),paint(new THREE.CylinderGeometry(.22,.16,.22,8).translate(-.4,1.0,-.1),'#b08a55'),box(.5,.18,.35,.0,.98,.2,'#c9a35c')]);
 const roof=model?null:paint(new THREE.BoxGeometry(2.8,.05,1.8).rotateX(-.22).translate(0,2.3,.05),'#ffffff');
 const mat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85}),a=new THREE.InstancedMesh(base,mat,list.length),b=roof&&new THREE.InstancedMesh(roof,mat,list.length);a.castShadow=true;if(b)b.castShadow=true;
 const m=new THREE.Matrix4(),q=new THREE.Quaternion(),UP=new THREE.Vector3(0,1,0),one=new THREE.Vector3(1,1,1),v=new THREE.Vector3(),col=new THREE.Color(),COLS=['#e9e3d4','#c9b48a','#8a3a2a','#3f5d45'];
 const people=[];
 list.forEach(([x,z,yaw,c],i)=>{m.compose(v.set(x,groundAt(x,z),z),q.setFromAxisAngle(UP,yaw),one);a.setMatrixAt(i,m);if(b){b.setMatrixAt(i,m);b.setColorAt(i,col.set(COLS[c%COLS.length]));}
  // the seller behind the table, a customer in front (heading faces the table)
  const s=Math.sin(yaw),co=Math.cos(yaw);people.push({x:x-s*.9,z:z-co*.9,heading:yaw+Math.PI,pose:'chat',walking:false,talkable:true});if(i%2===0)people.push({x:x+s*1.5,z:z+co*1.5,heading:yaw,pose:'chat',walking:false,talkable:true});});
 a.computeBoundingSphere();group.add(a);if(b){b.computeBoundingSphere();group.add(b);}
 const pts=list.map(([x,z])=>[x,z]),ranged=[a,b].filter(Boolean).map(mm=>rangeInstances(mm,pts,260)); /* drawn within 260 m */
 return {group,update:p=>{for(const r of ranged)r.update(p);},people,obstacles:list.map(([x,z],i)=>({id:`stall-${i}`,name:'market stall',rings:[[[x-1.3,z-1.3],[x+1.3,z-1.3],[x+1.3,z+1.3],[x-1.3,z+1.3]]],bbox:[x-1.3,z-1.3,x+1.3,z+1.3]}))};
}
