// Attribute-aware simplification for the Python model scripts (meshoptimizer, kept out of the game's dependencies):
//   npm i --no-save meshoptimizer@0.22.0   (or MESHOPT=<path to its meshopt_simplifier.module.js>)
//   echo '{"positions":[...],"attributes":[...],"stride":4,"weights":[...],"indices":[...],"targets":[1800,200],"lockBorder":false}' | node scripts/models/simplify.mjs
// Prints {"lods":[[indices...],...]}: each LOD is an index list into the same vertices (meshoptimizer only drops
// triangles and re-links corners, so every surviving vertex keeps its position, colour and other attributes).
const {MeshoptSimplifier:S}=await import(process.env.MESHOPT||'meshoptimizer');
let input='';for await(const chunk of process.stdin)input+=chunk;
const job=JSON.parse(input);await S.ready;S.useExperimentalFeatures=true; // simplifyWithAttributes is still flagged experimental in 0.22
const pos=new Float32Array(job.positions),attr=new Float32Array(job.attributes),idx=new Uint32Array(job.indices),k=job.stride;
const lods=job.targets.map(t=>{
 const [out,err]=S.simplifyWithAttributes(idx,pos,3,attr,k,job.weights,null,Math.min(idx.length,t*3),job.error??1,job.lockBorder?['LockBorder']:[]);
 process.stderr.write(`target ${t}: ${out.length/3} triangles, error ${err.toFixed(4)}\n`);
 return Array.from(out);
});
process.stdout.write(JSON.stringify({lods}));
