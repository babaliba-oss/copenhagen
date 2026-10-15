// The municipal model sometimes carries a building twice: once matched to OpenStreetMap (kk-osm-…) and once
// as a bare block (kk-<x>-<z>), with almost the same footprint. Both drawn, their coplanar walls z-fight into
// two-tone triangles and the cruder copy pokes through. Marks the copy to drop: of two parts whose bounding
// boxes overlap almost entirely (IoU ≥ iou, the dropped one ≥ 90 % inside the other), the lower one goes, or
// at equal height the one with fewer vertices; a crude leftover block inside a detailed part goes too.
// Returns the parts marked (p.duplicate = true).
export function markDuplicateParts(index,{iou=.85,cell=50}={}){
 const parts=index?.tiles?.flatMap(t=>t.parts)||[],grid=new Map(),key=(x,z)=>`${x},${z}`;
 const centre=p=>[Math.floor((p.bbox[0]+p.bbox[2])/2/cell),Math.floor((p.bbox[1]+p.bbox[3])/2/cell)];
 parts.forEach((p,i)=>{const [x,z]=centre(p),k=key(x,z);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);});
 const area=b=>Math.max(0,b[2]-b[0])*Math.max(0,b[3]-b[1]),marked=[];
 parts.forEach((p,i)=>{if(p.duplicate)return;const [cx,cz]=centre(p);
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const j of grid.get(key(cx+dx,cz+dz))||[]){
   if(j<=i||parts[j].duplicate||p.duplicate)continue;const q=parts[j],a=p.bbox,b=q.bbox;
   const both=Math.max(0,Math.min(a[2],b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[3],b[3])-Math.max(a[1],b[1]));
   const same=both/(area(a)+area(b)-both||1)>=iou;
   // A crude leftover block (a quarter of the vertices or fewer) lying inside a detailed part of the same
   // building and covering at least 40 % of it: the same building again, not a courtyard house.
   const [small,big]=area(a)<area(b)?[p,q]:[q,p];
   const leftover=!same&&both/(area(small.bbox)||1)>=.9&&area(small.bbox)>=.4*area(big.bbox)&&small.height<=big.height+.5&&(small.count||0)*4<=(big.count||0);
   if(!same&&!leftover)continue;
   const loser=leftover?small:Math.abs(p.height-q.height)>.3?(p.height<q.height?p:q):((p.count||0)<(q.count||0)?p:q);
   if(both/(area(loser.bbox)||1)<.9)continue;
   loser.duplicate=true;marked.push(loser);
  }
 });
 return marked;
}
