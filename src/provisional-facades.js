// Explicitly provisional regular bays for otherwise completely blank source
// walls. Not applied to photographic façades or designated authored landmarks.
// These are placeholders, NOT a claim about real window positions.
export function provisionalWindows(face){
 const width=face.s1-face.s0,height=face.y1-face.y0;
 if(width<4||height<5.8||height>48||face.y0>2)return [];
 const columns=Math.min(32,Math.max(1,Math.floor(width/3.3))),rows=Math.min(9,Math.max(1,Math.floor(height/3.5)));
 const pitch=width/columns,floor=(height-.65)/rows,windows=[];
 for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
  const w=Math.min(1.5,pitch*.5),h=Math.min(2.2,floor*.55);
  const window={x:face.s0+(col+.5)*pitch-w/2,y:face.y0+.5+row*floor+(floor-h)*.5,w,h};
  // Test the reveal footprint, not just the face bounding rectangle. This keeps
  // bays out of roof slopes, courtyard gaps and disconnected coplanar walls.
  const covered=(s,y)=>(face.triangles||[]).some(({local:[a,b,c]})=>{
   const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-8)return false;
   const p=((b[1]-c[1])*(s-c[0])+(c[0]-b[0])*(y-c[1]))/den;
   const q=((c[1]-a[1])*(s-c[0])+(a[0]-c[0])*(y-c[1]))/den;
   return p>=-1e-6&&q>=-1e-6&&p+q<=1+1e-6;
  });
  if([0,.25,.5,.75,1].every(u=>[0,.25,.5,.75,1].every(v=>covered(window.x-.2+u*(w+.4),window.y-.2+v*(h+.4)))))windows.push(window);
 }
 return windows;
}

// Churches and towers (noFacade landmarks): no house front, but tall round-headed church windows, a few
// metres apart in one or two tiers, instead of a blank brick wall. Placeholders like the bays above.
export function churchWindows(face){
 const width=face.s1-face.s0,height=face.y1-face.y0;
 if(width<4||height<7||face.y0>3)return [];
 const usable=Math.min(height,30)-3,tiers=usable>16?2:1,columns=Math.min(16,Math.max(1,Math.floor(width/5))),pitch=width/columns,windows=[];
 const w=Math.min(1.5,pitch*.34),h=Math.min(6.5,usable/tiers*.62);
 const covered=(s,y)=>(face.triangles||[]).some(({local:[a,b,c]})=>{const den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(den)<1e-8)return false;
  const p=((b[1]-c[1])*(s-c[0])+(c[0]-b[0])*(y-c[1]))/den,q=((c[1]-a[1])*(s-c[0])+(a[0]-c[0])*(y-c[1]))/den;return p>=-1e-6&&q>=-1e-6&&p+q<=1+1e-6;});
 for(let t=0;t<tiers;t++)for(let col=0;col<columns;col++){const win={x:face.s0+(col+.5)*pitch-w/2,y:face.y0+2.4+t*(usable/tiers),w,h};
  if([0,.5,1].every(u=>[0,.5,1].every(v=>covered(win.x-.3+u*(w+.6),win.y-.3+v*(h+.6)))))windows.push(win);}
 return windows;
}
