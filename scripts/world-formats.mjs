// Shared writers for the game's runtime formats, used by every data builder.
import earcut from 'earcut';
import {bounds} from '../src/geo.js';

// Pre-coloured ground surfaces in 600 m chunks: Float32 [x,y,z,r,g,b] per vertex
// (linear colour). Same colours and heights as Helsinki's scripts/prepare-world.mjs.
export function surfaceChunks(city){
 const chunks=new Map();
 function add(rings,color,y){
  if(!rings.length)return;const flat=[],holes=[];for(const [i,r] of rings.entries()){if(i)holes.push(flat.length/2);for(const p of r)flat.push(...p);}
  const tri=earcut(flat,holes,2),b=bounds(rings),key=`${Math.floor((b[0]+b[2])/600)},${Math.floor((b[1]+b[3])/600)}`;if(!chunks.has(key))chunks.set(key,[]);const v=chunks.get(key);
  const rgb=color.match(/\w\w/g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
  for(let i=0;i<tri.length;i+=3)for(const j of [tri[i],tri[i+2],tri[i+1]])v.push(flat[j*2],y,flat[j*2+1],...rgb);
 }
 for(const p of city.parks){let c='c3cbb0';if(/Nurm|niitt|Niit|mets|Mets|Kitumaa/.test(p.kind))c='b1c397';else if(/Pensas|Perenn|ruusu|kukka|istut|hein/.test(p.kind))c='91ad7a';else if(/vesi|allas|Lammikko|puro/.test(p.kind))c='abc8c9';else if(/kallio|kiv|muur/.test(p.kind))c='b6b9aa';else if(/käyt|Jalank|liikenne|Aukio|Polku|Erotettu|Portaat/.test(p.kind))c='ddd9cb';add(p.rings,c,.025);}
 for(const p of city.pavement)add(p.rings,/Silta/.test(p.kind)&&p.material==='Puu'?'a08c6e':/pyör|Pyör/.test(p.kind)?'c8b8a5':/Portaat|portaat/.test(p.kind)?'b9b8a9':'dfdcd1',.05);
 for(const p of city.roads)add(p.rings,/Koroke/.test(p.kind)?'dddacd':/Betonikivi/.test(p.material)?'c8c4ba':/Nupu|Noppa|kivi/.test(p.material)?'aaa99e':'919d98',.07); // concrete pavers (paving_stones) are pale small blocks, not granite setts
 for(const p of city.buildings)add(p.rings,'c9c6b9',.085);
 return chunks;
}
