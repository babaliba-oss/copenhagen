// Creased normals for a building tile's merged shells (shell-normals.js), one array per shell
// range, computed here instead of on the main thread: 15-40 ms and several large scratch arrays per tile landing.
import {creasedNormalsArray} from './shell-normals.js';
self.onmessage=({data})=>{
 const {id,array,ranges}=data;
 try{const normals=ranges.map(([start,end])=>creasedNormalsArray(array,5,0,start,end));
  // positions of every range in one array: the tile's single shadow caster (main.js addShadowCasters)
  let total=0;for(const [a,b] of ranges)total+=b-a;const positions=new Float32Array(total*3);let o=0;
  for(const [a,b] of ranges)for(let v=a;v<b;v++){positions[o++]=array[v*5];positions[o++]=array[v*5+1];positions[o++]=array[v*5+2];}
  self.postMessage({id,normals,positions},[...normals.map(n=>n.buffer),positions.buffer]);}
 catch(error){self.postMessage({id,error:String(error?.message||error)});}
};
