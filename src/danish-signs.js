// Danish road-sign faces for Københavns Kommune's sign register (k101 skilte_total: codes such as C55, E33, D15,3,
// scripts/kk-signs.py). danishSign() is pure data (the build and the tests use it); drawDanish() paints a face onto a 2D
// canvas cell for the runtime atlas (mapped-furniture.js signAtlas, through sign-faces.js). The faces are our own simple
// drawings after the shapes and colours of bekendtgørelse om vejafmærkning: warning triangles and prohibitory discs with
// a white field and a red rim, blue mandatory discs, blue information plates, white supplementary plates.
const C={blue:'#0f4d9a',red:'#d2232a',white:'#f7f7f2',black:'#16191a',yellow:'#f2c21b',grey:'#8c9496'};
const ring=(icon,x)=>({shape:'circle',style:'ring',icon,...x}),blue=(icon,x)=>({shape:'circle',style:'blue-disc',icon,...x});
const warn=(mark)=>({shape:'triangle',style:'dk-warning',mark}),info=(mark,x)=>({shape:'square',style:'blue-square',mark,...x});
const zone=(inner,x)=>({shape:'square',style:'dk-zone',inner,...x});
// The register's codes drawn as faces (the commonest cover ~90% of the city's standing main plates; see tests).
export const DK_SIGNS={
 A16:warn('roundabout'),A17:warn('crossing'),A18:warn('two-way'),A19:warn('signals'),A21:warn('bike'),A22:warn('children'),A31:warn('slippery'),A36:warn('bump'),A39:warn('roadworks'),A99:warn('!'),
 B11:{shape:'triangle-down',style:'dk-yield'},B13:{shape:'octagon',style:'dk-stop'},
 'C11,1':ring('no-right'),'C11,2':ring('no-left'),C12:ring('no-u'),C19:{shape:'circle',style:'dk-no-entry'},C21:ring(''),'C22,1':ring('car-moto'),'C22,2':ring('moto'),
 'C23,1':ring('truck'),'C23,2':ring('bus'),'C25,1':ring('bike'),'C25,2':ring('moped'),'C26,2':ring('person'),C55:ring('speed'),C56:{shape:'circle',style:'dk-end-speed'},
 C61:{shape:'circle',style:'dk-no-stop'},C62:{shape:'circle',style:'dk-no-park'},
 'D11,1':blue('arrow',{angle:0}),'D11,2':blue('arrow',{angle:90}),'D11,3':blue('arrow',{angle:-90}),'D11,4':blue('arrows',{angles:[0,90]}),'D11,5':blue('arrows',{angles:[0,-90]}),'D11,8':blue('arrows',{angles:[-90,90]}),
 'D15,2':blue('arrow',{angle:-135}),'D15,3':blue('arrow',{angle:135}),D16:blue('arrows',{angles:[-135,135]}),D21:blue('bike'),D22:blue('person'),
 D26:blue('shared'),'D26,1':blue('shared'),'D26,2':blue('split'),D27:blue('shared'),'D27,1':blue('shared'),
 E17:info('crossing'),E18:info('dead-end'),'E18,1':info('dead-end'),E19:info('up'),'E19,1':info('up'),'E19,2':info('side',{side:-1,shape:'rect'}),'E19,3':info('side',{side:1,shape:'rect'}),
 'E21,1':info('bike'),'E21,2':info('person'),E23:info('wheelchair'),E32:info('text',{text:'TAXI'}),E33:info('P'),'E33/E23':info('P',{wheelchair:true}),
 E47:info('cycle-street'),E48:info('cycle-street',{end:true}),E49:info('pedestrian'),E50:info('pedestrian',{end:true}),E51:info('living'),E52:info('living',{end:true}),
 E53:info('calm'),E54:info('calm',{end:true}),E70:info('info'),
 'E68,1':zone('P'),'E68,2':zone('no-stop'),'E68,3':zone('no-park'),'E68,4':zone('speed'),'E69,1':zone('P',{end:true}),'E69,2':zone('no-stop',{end:true}),'E69,3':zone('no-park',{end:true}),'E69,4':zone('speed',{end:true}),
 F11:{shape:'board',style:'dk-board'},
};
// Supplementary plates (undertavler) under a drawn main plate: arrows, a cyclist exempted, or lines of text.
const UNDER={text:{shape:'small',style:'dk-under'},left:{shape:'small',style:'dk-under',arrow:-1},right:{shape:'small',style:'dk-under',arrow:1},both:{shape:'small',style:'dk-under',arrow:2},bike:{shape:'small',style:'dk-under',bike:true}};
export function underKind(raw){
 const s=String(raw||'').toUpperCase();if(!s.trim())return null;
 if(/BEGGE RETNINGER|UC60/.test(s))return 'both';
 if(/V\.?PIL|,V\b|VENSTRE/.test(s))return 'left';if(/H\.?PIL|,H\b|HØJRE/.test(s))return 'right';
 if(/^\s*209\b|CYKEL/.test(s))return 'bike';
 return 'text';
}
// Register code -> its key in DK_SIGNS ('E33/E23(ny)' and 'E33,A5' are parking plates, 'E18.2' is 'E18,2').
export function danishCode(raw){
 let s=String(raw||'').toUpperCase().replace(/\s+/g,'').replace(/\./g,',');if(!s)return null;
 if(/^E33[/(]E23/.test(s))return 'E33/E23';
 if(DK_SIGNS[s])return s;
 const base=/^([A-Z]\d+(?:,\d+)?)/.exec(s)?.[1];if(base&&DK_SIGNS[base])return base;
 const bare=/^([A-Z]\d+)/.exec(s)?.[1];if(bare&&DK_SIGNS[bare])return bare;
 return s;
}
const number=t=>{const m=/(\d{1,3})/.exec(String(t||''));return m?m[1]:'';};
// "DK:C55[40km]" (or "C55", text) -> {code, dk, face, shape, style, ..., known}. Unknown codes: known false (not drawn).
export function danishSign(raw,text=''){
 const m=/^(?:DK:)?([^[]*)(?:\[([^\]]*)\])?$/i.exec(String(raw).trim());const code=danishCode(m?.[1]);const value=m?.[2]??text;
 if(/^U:/i.test(m?.[1]||'')){const k=String(m[1]).slice(2).toLowerCase();const spec=UNDER[k]||UNDER.text;return {code:`DK:U:${k}`,dk:'U',face:`dk-u-${k}`,...spec,known:true};}
 const spec=code&&DK_SIGNS[code];
 if(!spec)return {code:`DK:${code||''}`,dk:code||'',face:'dk-unknown',shape:'square',style:'blank',known:false};
 const needsNumber=spec.icon==='speed'||spec.inner==='speed'||spec.mark==='calm'||spec.style==='dk-end-speed';
 const n=needsNumber?number(value)||(spec.mark==='calm'?'':'40'):'';
 const key=code.toLowerCase().replace(/[,/]/g,'-');
 return {code:`DK:${code}${n?`[${n}]`:''}`,dk:code,face:`dk-${key}${n?`-${n}`:''}`,...spec,...(n?{text:n}:{}),known:true};
}

// Simple pictograms in a unit box (s: size), centred on (x, y).
function person(c,x,y,s,fill){c.fillStyle=fill;c.strokeStyle=fill;c.lineCap='round';c.beginPath();c.arc(x,y-s*.36,s*.1,0,Math.PI*2);c.fill();c.lineWidth=s*.12;c.beginPath();c.moveTo(x,y-s*.22);c.lineTo(x,y+s*.08);c.lineTo(x-s*.15,y+s*.42);c.moveTo(x,y+s*.08);c.lineTo(x+s*.16,y+s*.42);c.moveTo(x-s*.18,y-s*.02);c.lineTo(x,y-s*.16);c.lineTo(x+s*.18,y-s*.04);c.stroke();}
function bike(c,x,y,s,fill){c.strokeStyle=fill;c.lineWidth=s*.08;c.lineCap='round';for(const dx of [-.28,.28]){c.beginPath();c.arc(x+dx*s,y+s*.12,s*.19,0,Math.PI*2);c.stroke();}c.beginPath();c.moveTo(x-s*.28,y+s*.12);c.lineTo(x-s*.06,y-s*.18);c.lineTo(x+s*.18,y-s*.18);c.lineTo(x+s*.28,y+s*.12);c.moveTo(x-s*.06,y-s*.18);c.lineTo(x+s*.02,y+s*.12);c.lineTo(x+s*.18,y-s*.18);c.moveTo(x-s*.12,y-s*.26);c.lineTo(x,y-s*.26);c.stroke();}
function car(c,x,y,s,fill){c.fillStyle=fill;c.beginPath();c.moveTo(x-s*.46,y+s*.1);c.lineTo(x-s*.4,y-s*.06);c.lineTo(x-s*.22,y-s*.08);c.lineTo(x-s*.12,y-s*.26);c.lineTo(x+s*.18,y-s*.26);c.lineTo(x+s*.28,y-s*.08);c.lineTo(x+s*.46,y-s*.04);c.lineTo(x+s*.46,y+s*.1);c.closePath();c.fill();for(const dx of [-.26,.28]){c.beginPath();c.arc(x+dx*s,y+s*.12,s*.09,0,Math.PI*2);c.fill();}}
function moto(c,x,y,s,fill){c.strokeStyle=fill;c.fillStyle=fill;c.lineWidth=s*.07;for(const dx of [-.28,.28]){c.beginPath();c.arc(x+dx*s,y+s*.12,s*.13,0,Math.PI*2);c.stroke();}c.fillRect(x-s*.2,y-s*.1,s*.38,s*.12);c.fillRect(x-s*.05,y-s*.26,s*.08,s*.18);}
function truck(c,x,y,s,fill){c.fillStyle=fill;c.fillRect(x-s*.48,y-s*.28,s*.6,s*.38);c.fillRect(x+s*.14,y-s*.14,s*.32,s*.24);for(const dx of [-.32,.3]){c.beginPath();c.arc(x+dx*s,y+s*.13,s*.09,0,Math.PI*2);c.fill();}}
function bus(c,x,y,s,fill){c.fillStyle=fill;c.fillRect(x-s*.48,y-s*.3,s*.96,s*.4);c.fillStyle=C.white;for(let i=0;i<4;i++)c.fillRect(x-s*.42+i*s*.22,y-s*.24,s*.16,s*.12);c.fillStyle=fill;for(const dx of [-.3,.3]){c.beginPath();c.arc(x+dx*s,y+s*.12,s*.09,0,Math.PI*2);c.fill();}}
function wheelchair(c,x,y,s,fill){c.strokeStyle=fill;c.fillStyle=fill;c.lineWidth=s*.08;c.lineCap='round';c.beginPath();c.arc(x-s*.02,y-s*.38,s*.08,0,Math.PI*2);c.fill();c.beginPath();c.moveTo(x-s*.04,y-s*.26);c.lineTo(x-s*.04,y+s*.02);c.lineTo(x+s*.2,y+s*.02);c.lineTo(x+s*.3,y+s*.28);c.moveTo(x-s*.04,y-s*.14);c.lineTo(x+s*.14,y-s*.14);c.stroke();c.beginPath();c.arc(x-s*.04,y+s*.14,s*.2,-.6,Math.PI*1.4);c.stroke();}
// An arrow pointing up (angle 0), turned clockwise by angle degrees.
function arrow(c,cx,cy,len,angle,fill,w=len*.16){c.save();c.translate(cx,cy);c.rotate(angle*Math.PI/180);c.fillStyle=fill;c.fillRect(-w/2,-len*.12,w,len*.55);c.beginPath();c.moveTo(-w*1.7,-len*.1);c.lineTo(w*1.7,-len*.1);c.lineTo(0,-len*.5);c.closePath();c.fill();c.restore();}

// Paint face f (danishSign) into the plate box: centre (cx, cy), radius r, plate rect (bx, by, bw, bh). -> drawn
export function drawDanish(c,f,{cx,cy,r,bx,by,bw,bh}){
 const disc=(rad,fill)=>{c.beginPath();c.arc(cx,cy,rad,0,Math.PI*2);c.fillStyle=fill;c.fill();};
 const poly=(pts,fill)=>{c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();};
 const text=(t,size,fill,x=cx,y=cy)=>{c.fillStyle=fill;c.font=`700 ${size}px Arial, Helvetica, sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(t,x,y+size*.05);};
 const slash=(angle,col=C.red,w=r*.16)=>{c.save();c.translate(cx,cy);c.rotate(angle);c.fillStyle=col;c.fillRect(-w/2,-r*.8,w,r*1.6);c.restore();};
 const strike=(x0,y0,w,h,col)=>{c.save();c.beginPath();c.rect(x0,y0,w,h);c.clip();c.translate(x0+w/2,y0+h/2);c.rotate(-Math.atan2(h,w));c.fillStyle=col;c.fillRect(-w,-h*.05,w*2,h*.1);c.restore();};
 const st=f.style;
 if(st==='ring'||st==='dk-end-speed'){
  if(st==='dk-end-speed'){disc(r,C.black);disc(r*.94,C.white);text(f.text||'',r*.8,C.grey);c.save();c.beginPath();c.arc(cx,cy,r*.94,0,Math.PI*2);c.clip();for(const k of [-1,0,1]){c.save();c.translate(cx+k*r*.18,cy-k*r*.18);c.rotate(Math.PI/4);c.fillStyle=C.black;c.fillRect(-r,-r*.03,r*2,r*.06);c.restore();}c.restore();return true;}
  disc(r,C.red);disc(r*.78,C.white);const s=r*1.3,ic=f.icon;
  if(ic==='speed')text(f.text||'',r*(String(f.text).length>2?.66:.86),C.black);
  else if(ic==='car-moto'){car(c,cx,cy-r*.22,s*.62,C.black);moto(c,cx,cy+r*.3,s*.5,C.black);}
  else if(ic==='moto')moto(c,cx,cy,s*.8,C.black);else if(ic==='moped')moto(c,cx,cy,s*.7,C.black);
  else if(ic==='truck')truck(c,cx,cy,s*.8,C.black);else if(ic==='bus')bus(c,cx,cy,s*.8,C.black);
  else if(ic==='bike')bike(c,cx,cy,s*.85,C.black);else if(ic==='person')person(c,cx,cy+r*.04,s*.8,C.black);
  else if(ic==='no-left'||ic==='no-right'||ic==='no-u'){c.save();c.translate(cx,cy);if(ic==='no-right')c.scale(-1,1);c.strokeStyle=C.black;c.lineWidth=r*.15;c.beginPath();
   if(ic==='no-u'){c.moveTo(r*.25,r*.5);c.lineTo(r*.25,-r*.1);c.arc(0,-r*.1,r*.25,0,Math.PI,true);c.lineTo(-r*.25,r*.15);c.stroke();poly([[-r*.5,r*.1],[0,r*.1],[-r*.25,r*.45]],C.black);}
   else{c.moveTo(r*.15,r*.55);c.lineTo(r*.15,-r*.05);c.lineTo(-r*.22,-r*.05);c.stroke();poly([[-r*.52,-r*.05],[-r*.2,-r*.32],[-r*.2,r*.22]],C.black);}
   c.restore();slash(-Math.PI/4);}
  return true;}
 if(st==='dk-no-entry'){disc(r,C.white);disc(r*.95,C.red);c.fillStyle=C.white;c.fillRect(cx-r*.64,cy-r*.15,r*1.28,r*.3);return true;}
 if(st==='dk-no-stop'||st==='dk-no-park'){disc(r,C.red);disc(r*.78,C.blue);slash(Math.PI/4,C.red,r*.17);if(st==='dk-no-stop')slash(-Math.PI/4,C.red,r*.17);return true;}
 if(st==='blue-disc'){disc(r,C.white);disc(r*.95,C.blue);const ic=f.icon;
  if(ic==='arrow')arrow(c,cx,cy,r*1.5,f.angle||0,C.white);
  else if(ic==='arrows'){for(const a of f.angles){const k=a*Math.PI/180;arrow(c,cx+Math.sin(k)*r*.12,cy-Math.cos(k)*r*.12,r*1.15,a,C.white,r*.15);}}
  else if(ic==='bike')bike(c,cx,cy,r*1.2,C.white);else if(ic==='person')person(c,cx,cy,r*1.25,C.white);
  else if(ic==='shared'){person(c,cx,cy-r*.32,r*.68,C.white);bike(c,cx,cy+r*.36,r*.7,C.white);c.fillStyle=C.white;c.fillRect(cx-r*.55,cy-r*.02,r*1.1,r*.05);}
  else if(ic==='split'){person(c,cx-r*.38,cy,r*.75,C.white);bike(c,cx+r*.38,cy,r*.6,C.white);c.fillStyle=C.white;c.fillRect(cx-r*.03,cy-r*.75,r*.06,r*1.5);}
  return true;}
 if(st==='dk-warning'){const tri=k=>[[cx,cy-r*k],[cx+r*.98*k,cy+r*.72*k],[cx-r*.98*k,cy+r*.72*k]];poly(tri(1),C.red);poly(tri(.74),C.white);
  const y=cy+r*.2,s=r*.62,m=f.mark;c.save();c.strokeStyle=C.black;c.fillStyle=C.black;c.lineWidth=r*.09;c.lineCap='round';
  if(m==='bump'){c.beginPath();c.moveTo(cx-s*.75,y+s*.35);c.lineTo(cx-s*.35,y+s*.35);c.quadraticCurveTo(cx,y-s*.45,cx+s*.35,y+s*.35);c.lineTo(cx+s*.75,y+s*.35);c.stroke();}
  else if(m==='children'){person(c,cx-s*.22,y,s*.95,C.black);person(c,cx+s*.25,y+s*.1,s*.75,C.black);}
  else if(m==='crossing'){person(c,cx,y-s*.08,s*.95,C.black);for(let k=-2;k<=2;k++)c.fillRect(cx+k*s*.22-s*.07,y+s*.4,s*.14,s*.1);}
  else if(m==='bike')bike(c,cx,y,s*1.05,C.black);
  else if(m==='two-way'){arrow(c,cx-s*.2,y,s*1.1,0,C.black,s*.12);arrow(c,cx+s*.2,y,s*1.1,180,C.black,s*.12);}
  else if(m==='signals'){c.fillRect(cx-s*.16,y-s*.5,s*.32,s*.95);for(const [k,col] of [[0,C.red],[1,C.yellow],[2,'#2f9e57']]){c.beginPath();c.arc(cx,y-s*.33+k*s*.3,s*.1,0,Math.PI*2);c.fillStyle=col;c.fill();}}
  else if(m==='roundabout'){for(let k=0;k<3;k++){c.save();c.translate(cx,y);c.rotate(k*Math.PI*2/3);c.beginPath();c.arc(0,0,s*.38,-.3,1.4);c.stroke();c.restore();}}
  else if(m==='slippery'){car(c,cx,y-s*.15,s*.9,C.black);c.beginPath();c.moveTo(cx-s*.4,y+s*.45);c.bezierCurveTo(cx-s*.1,y+s*.15,cx-s*.3,y+s*.55,cx,y+s*.28);c.stroke();}
  else if(m==='roadworks'){person(c,cx-s*.1,y,s*.95,C.black);c.beginPath();c.moveTo(cx+s*.05,y-s*.02);c.lineTo(cx+s*.4,y+s*.35);c.stroke();poly([[cx+s*.2,y+s*.42],[cx+s*.62,y+s*.42],[cx+s*.42,y+s*.2]],C.black);}
  else text('!',r*.75,C.black,cx,y);
  c.restore();return true;}
 if(st==='dk-yield'){const tri=k=>[[cx,cy+r*k],[cx+r*.98*k,cy-r*.72*k],[cx-r*.98*k,cy-r*.72*k]];poly(tri(1),C.red);poly(tri(.72),C.white);return true;}
 if(st==='dk-stop'){const pts=k=>Array.from({length:8},(_,i)=>{const a=Math.PI/8+i*Math.PI/4;return [cx+Math.cos(a)*r*k,cy+Math.sin(a)*r*k];});poly(pts(1),C.white);poly(pts(.92),C.red);text('STOP',r*.48,C.white);return true;}
 if(st==='blue-square'||st==='dk-zone'||st==='dk-board'){
  const pw=bw*.97,ph=bh*.97,px=cx-pw/2,py=cy-ph/2,rim=Math.min(pw,ph)*.045,s=Math.min(pw,ph),zoneSign=st==='dk-zone';
  c.fillStyle=zoneSign?C.black:C.white;c.fillRect(px,py,pw,ph);c.fillStyle=zoneSign?C.white:C.blue;c.fillRect(px+rim,py+rim,pw-rim*2,ph-rim*2);
  const m=f.mark;
  if(zoneSign){const zx=cx,zy=cy-s*.1,zr=s*.27;
   if(f.inner==='P'){c.fillStyle=C.blue;c.fillRect(zx-zr,zy-zr,zr*2,zr*2);text('P',zr*1.5,C.white,zx,zy);}
   else{c.beginPath();c.arc(zx,zy,zr,0,Math.PI*2);c.fillStyle=C.red;c.fill();c.beginPath();c.arc(zx,zy,zr*.78,0,Math.PI*2);c.fillStyle=f.inner==='speed'?C.white:C.blue;c.fill();
    if(f.inner==='speed')text(f.text||'',zr*.9,C.black,zx,zy);
    else{for(const a of f.inner==='no-stop'?[1,-1]:[1]){c.save();c.translate(zx,zy);c.rotate(a*Math.PI/4);c.fillStyle=C.red;c.fillRect(-zr*.09,-zr*.78,zr*.18,zr*1.56);c.restore();}}}
   text('ZONE',s*.17,C.black,cx,py+ph*.82);
   if(f.end)strike(px+rim,py+rim,pw-rim*2,ph-rim*2,C.black);return true;}
  if(st==='dk-board'){c.fillStyle=C.white;for(let k=0;k<3;k++)c.fillRect(px+pw*.1,py+ph*(.2+k*.24),pw*(.58-k*.12),ph*.1);poly([[px+pw*.92,cy],[px+pw*.76,cy-ph*.22],[px+pw*.76,cy+ph*.22]],C.white);return true;}
  if(m==='P'){text('P',s*(f.wheelchair?.56:.74),C.white,cx,f.wheelchair?cy-s*.13:cy);if(f.wheelchair)wheelchair(c,cx,cy+s*.3,s*.36,C.white);}
  else if(m==='wheelchair')wheelchair(c,cx,cy,s*.8,C.white);
  else if(m==='crossing'){poly([[cx,py+s*.12],[cx+s*.42,py+s*.86],[cx-s*.42,py+s*.86]],C.white);person(c,cx,py+s*.56,s*.5,C.black);}
  else if(m==='dead-end'){c.fillStyle=C.white;c.fillRect(cx-s*.1,cy-s*.12,s*.2,s*.48);c.fillStyle=C.red;c.fillRect(cx-s*.28,cy-s*.32,s*.56,s*.16);}
  else if(m==='up')arrow(c,cx,cy+s*.05,s*.85,0,C.white,s*.16);
  else if(m==='side')arrow(c,cx,cy,pw*.8,90*f.side,C.white,ph*.2);
  else if(m==='bike')bike(c,cx,cy,s*.78,C.white);else if(m==='person')person(c,cx,cy,s*.8,C.white);
  else if(m==='text')text(f.text,s*.27,C.white);
  else if(m==='info'){text('i',s*.6,C.white,cx,cy-s*.04);}
  else if(m==='pedestrian'){person(c,cx-s*.15,cy,s*.62,C.white);person(c,cx+s*.16,cy+s*.06,s*.5,C.white);}
  else if(m==='living'){c.fillStyle=C.white;poly([[px+pw*.12,cy-s*.02],[px+pw*.28,cy-s*.25],[px+pw*.44,cy-s*.02]],C.white);c.fillRect(px+pw*.16,cy-s*.02,pw*.24,s*.3);person(c,cx+s*.12,cy+s*.04,s*.5,C.white);person(c,cx+s*.3,cy+s*.12,s*.34,C.white);}
  else if(m==='cycle-street'){bike(c,cx,cy-s*.12,s*.6,C.white);car(c,cx,cy+s*.26,s*.42,C.white);}
  else if(m==='calm'){c.strokeStyle=C.white;c.lineWidth=s*.07;c.beginPath();c.moveTo(px+pw*.14,cy-s*.05);c.lineTo(cx-s*.18,cy-s*.05);c.quadraticCurveTo(cx,cy-s*.42,cx+s*.18,cy-s*.05);c.lineTo(px+pw*.86,cy-s*.05);c.stroke();if(f.text)text(f.text,s*.3,C.white,cx,cy+s*.24);}
  if(f.end)strike(px+rim,py+rim,pw-rim*2,ph-rim*2,C.red);
  return true;}
 if(st==='dk-under'){c.fillStyle=C.black;c.fillRect(bx,by,bw,bh);c.fillStyle=C.white;c.fillRect(bx+bh*.07,by+bh*.07,bw-bh*.14,bh*.86);
  if(f.arrow){c.save();c.translate(cx,cy);c.strokeStyle=C.black;c.lineWidth=bh*.14;const sides=f.arrow===2?[-1,1]:[f.arrow];for(const sd of sides){c.beginPath();c.moveTo(0,0);c.lineTo(sd*bw*.28,0);c.stroke();poly([[sd*bw*.38,0],[sd*bw*.24,-bh*.28],[sd*bw*.24,bh*.28]],C.black);}c.restore();}
  else if(f.bike){bike(c,cx,cy,bh*.75,C.black);}
  else{c.fillStyle=C.black;for(let k=0;k<2;k++)c.fillRect(bx+bw*.14,by+bh*(.26+k*.32),bw*(.72-k*.22),bh*.14);}
  return true;}
 return false;
}
