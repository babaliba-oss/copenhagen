// No three.js here: the shell normals worker (shell-normals-worker.js) imports only this.
// Creased shell normals (shell-colors.js creasedShellNormals) on a flat array: vertices [start, end) of `array`, `stride` floats apart, position at `offset`. Pure
// typed-array work, so a worker can do it for a whole tile (shell-normals-worker.js) off the main thread.
export function creasedNormalsArray(array,stride,offset,start,end,crease=.6){
 const n=end-start,out=new Float32Array(n*3),limit=Math.cos(crease),X=i=>array[(start+i)*stride+offset],Y=i=>array[(start+i)*stride+offset+1],Z=i=>array[(start+i)*stride+offset+2];
 const tri=new Float32Array((n/3|0)*3);
 for(let t=0;t<n/3-.5;t++){const a=t*3;
  const ax=X(a),ay=Y(a),az=Z(a),ux=X(a+1)-ax,uy=Y(a+1)-ay,uz=Z(a+1)-az,vx=X(a+2)-ax,vy=Y(a+2)-ay,vz=Z(a+2)-az;
  let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const l=Math.hypot(nx,ny,nz)||1;tri[t*3]=nx/l;tri[t*3+1]=ny/l;tri[t*3+2]=nz/l;}
 // Group corners by position (5 cm grid) with hash chains: linear time. A point where very many triangles meet
 // (a fan, a degenerate spike) keeps its flat normals rather than an O(k²) average.
 let cap=1;while(cap<n*2)cap<<=1;const tk=new Float64Array(cap),th=new Int32Array(cap).fill(-1),ts=new Int32Array(cap),next=new Int32Array(n).fill(-1),slot=new Int32Array(n);
 for(let i=0;i<n;i++){const k=((Math.round(X(i)*20)+200000)*400000+(Math.round(Z(i)*20)+200000))*20000+(Math.round(Y(i)*20)+10000);
  let q=(Math.imul((k%2147483647)|0,0x9e3779b1)>>>0)&(cap-1);while(th[q]>=0&&tk[q]!==k)q=(q+1)&(cap-1); // open addressing
  tk[q]=k;next[i]=th[q];th[q]=i;ts[q]++;slot[i]=q;}
 for(let i=0;i<n;i++){const q=slot[i],h=th[q],t=i/3|0,ox=tri[t*3],oy=tri[t*3+1],oz=tri[t*3+2];let sx=ox,sy=oy,sz=oz;
  if(ts[q]<=48)for(let o=h;o>=0;o=next[o]){if(o===i)continue;const u=o/3|0,x=tri[u*3],y=tri[u*3+1],z=tri[u*3+2];if(x*ox+y*oy+z*oz>=limit){sx+=x;sy+=y;sz+=z;}}
  const l=Math.hypot(sx,sy,sz)||1;out[i*3]=sx/l;out[i*3+1]=sy/l;out[i*3+2]=sz/l;}
 return out;
}
