import {periodRoof} from './period-roofs.js';
// Period roofs off the main thread (see period-roofs.js).
self.onmessage=({data:{id,array,parts}})=>{
 const roofs=[];for(const p of parts){const positions=periodRoof(array,p);if(positions)roofs.push({colour:p.roofColor,positions});}
 self.postMessage({id,roofs},roofs.map(r=>r.positions.buffer));
};
