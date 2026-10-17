import {defineConfig} from 'vite';
import fs from 'node:fs';import zlib from 'node:zlib';import {compactCity} from './src/city-pack.js';import {compactMobility} from './src/mobility-pack.js';import path from 'node:path';import crypto from 'node:crypto';
// Data files are versioned by their content, not by the deploy: a deploy that only changes code no longer
// makes every returning player download the whole city again. Key: the file for top-level data files, the
// folder for tile folders (cities/<city>/<folder>/..., data/<folder>/...). See src/cache-bust.js.
function dataHashes(){
 const root='public',out={},groups=new Map();
 const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else{const rel=p.slice(root.length+1).split(path.sep).join('/'),parts=rel.split('/');
  const key=parts[0]==='cities'&&parts.length>3?parts.slice(0,3).join('/')+'/':parts[0]==='data'&&parts.length>2?parts.slice(0,2).join('/')+'/':rel;
  let h=groups.get(key);if(!h)groups.set(key,h=crypto.createHash('sha1'));h.update(rel);h.update(fs.readFileSync(p));}}};
 for(const d of ['cities','data','models','materials'])if(fs.existsSync(path.join(root,d)))walk(path.join(root,d));
 for(const [k,h] of groups)out[k]=h.digest('hex').slice(0,10);
 return out;
}
// Deployed city.pack and mobility.json files are compacted (src/city-pack.js, src/mobility-pack.js); public/ keeps the plain form for scripts and tests.
const compactPacks={name:'compact-city-packs',apply:'build',closeBundle(){
 const walk=d=>{if(!fs.existsSync(d))return;for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(e.name==='city.pack'){
  const raw=fs.readFileSync(p),json=raw[0]===31&&raw[1]===139?zlib.gunzipSync(raw):raw,city=compactCity(JSON.parse(json));if(city.packed!==2)continue;
  fs.writeFileSync(p,zlib.gzipSync(Buffer.from(JSON.stringify(city)),{level:9}));}
  else if(e.name==='mobility.json'){const m=compactMobility(JSON.parse(fs.readFileSync(p,'utf8')));if(m.packed===2)fs.writeFileSync(p,JSON.stringify(m));}}};
 walk('dist');}};
export default defineConfig(({command})=>({define:{__BUILD_ID__:JSON.stringify(Date.now().toString(36)),__DATA_HASHES__:command==='build'?JSON.stringify(dataHashes()):'null'},plugins:[compactPacks],build:{rollupOptions:{output:{manualChunks:{three:['three']}}}}}));
