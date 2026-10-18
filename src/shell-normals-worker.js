// Creased normals for a building tile's merged shells (shell-normals.js), one array per shell
// range, computed here instead of on the main thread: 15-40 ms and several large scratch arrays per tile landing.
import {creasedNormalsArray} from './shell-normals.js';
self.onmessage=({data})=>{
 const {id,array,ranges}=data;
 try{const normals=ranges.map(([start,end])=>creasedNormalsArray(array,5,0,start,end));self.postMessage({id,normals},normals.map(n=>n.buffer));}
 catch(error){self.postMessage({id,error:String(error?.message||error)});}
};
