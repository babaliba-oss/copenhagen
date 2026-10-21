import {periodShapes} from './period-roofs.js';
// Period roofs and party walls off the main thread (see period-roofs.js).
self.onmessage=({data:{id,array,parts}})=>{
 const roofs=periodShapes(array,parts);
 self.postMessage({id,roofs},roofs.map(r=>r.positions.buffer));
};
