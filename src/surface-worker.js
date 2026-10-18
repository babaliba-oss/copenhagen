import {setTerrain} from './terrain.js';
import {buildSurfaceTile,serialiseGeometry} from './surface-tiles.js';
// Ground surface tiles off the main thread (see surface-tiles.js).
let water=[],bridges=[];
self.onmessage=({data})=>{
 if('terrain' in data){setTerrain(data.terrain);return;}
 if(data.water){water=data.water;return;}
 if(data.bridges){bridges=data.bridges;return;}
 try{const {message,transfer}=serialiseGeometry(buildSurfaceTile(data.floats,water,bridges));self.postMessage({id:data.id,...message},transfer);}
 catch(e){self.postMessage({id:data.id,error:String(e?.stack||e)});}
};
