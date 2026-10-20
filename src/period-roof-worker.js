import {periodRoof} from './period-roofs.js';
// Period roofs off the main thread (see period-roofs.js).
self.onmessage=({data:{id,array,parts}})=>{
 const roofs=[];for(const p of parts){try{const positions=periodRoof(array,p);if(positions)roofs.push({colour:p.roofColor,positions});}catch{}} // one odd footprint keeps its flat roof; the tile's job still answers
 self.postMessage({id,roofs},roofs.map(r=>r.positions.buffer));
};
