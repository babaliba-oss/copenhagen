// Static geometry the CPU never reads again: drop its vertex arrays once they are on the GPU. A lost WebGL
// context stops the game and asks for a reload (game-resilience.js), so nothing has to be re-uploaded.
// Raycasts would read the freed arrays, so the mesh is taken out of them.
const free=function(){this.array=null;};
export function releaseAfterUpload(mesh){
 const g=mesh.geometry;if(!g.boundingSphere)g.computeBoundingSphere();if(!g.boundingBox)g.computeBoundingBox();
 for(const a of Object.values(g.attributes))a.onUpload(free);g.index?.onUpload(free);
 mesh.raycast=()=>{};return mesh;
}
