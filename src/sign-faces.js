// Finnish road-sign faces for detected signs (Mapillary traffic-sign codes such as
// "regulatory--no-parking--g1"). signFace() is pure data so the city build and the tests
// can use it; drawSignFace() paints one face onto a 2D canvas cell for the runtime atlas.
// Colours follow the hand-built Helsinki signs: Finnish blue, yellow prohibitory fields, red rims.
import {danishSign,drawDanish} from './danish-signs.js';
export const SIGN_COLOURS={blue:'#0955ac',yellow:'#f3d43e',red:'#df4732',white:'#f5f5ef',black:'#15201e',grey:'#929b9d'};

// code (without the --gN variant) → face. Unknown codes fall back by family to a plate of the right shape.
const FACES={
 'regulatory--no-parking':{shape:'circle',style:'no-parking'},
 'regulatory--no-stopping':{shape:'circle',style:'no-stopping'},
 'regulatory--keep-right':{shape:'circle',style:'arrow',angle:-45},
 'regulatory--keep-left':{shape:'circle',style:'arrow',angle:45},
 'regulatory--pass-on-either-side':{shape:'circle',style:'arrow-split'},
 'regulatory--go-straight':{shape:'circle',style:'arrow',angle:0},
 'regulatory--turn-left':{shape:'circle',style:'arrow-turn',side:-1},
 'regulatory--turn-right':{shape:'circle',style:'arrow-turn',side:1},
 'regulatory--turn-left-ahead':{shape:'circle',style:'arrow-turn',side:-1},
 'regulatory--turn-right-ahead':{shape:'circle',style:'arrow-turn',side:1},
 'regulatory--go-straight-or-turn-left':{shape:'circle',style:'arrow-turn',side:-1,straight:true},
 'regulatory--go-straight-or-turn-right':{shape:'circle',style:'arrow-turn',side:1,straight:true},
 'regulatory--turn-left-or-right':{shape:'circle',style:'arrow-split'},
 'regulatory--roundabout':{shape:'circle',style:'roundabout'},
 'regulatory--no-entry':{shape:'circle',style:'no-entry'},
 'regulatory--stop':{shape:'octagon',style:'stop'},
 'regulatory--yield':{shape:'triangle-down',style:'yield'},
 'regulatory--one-way-left':{shape:'rect',style:'one-way',side:-1},
 'regulatory--one-way-right':{shape:'rect',style:'one-way',side:1},
 'regulatory--one-way-straight':{shape:'square',style:'one-way-up'},
 'regulatory--no-left-turn':{shape:'circle',style:'no-turn',side:-1},
 'regulatory--no-right-turn':{shape:'circle',style:'no-turn',side:1},
 'regulatory--no-u-turn':{shape:'circle',style:'no-turn',side:-1},
 'regulatory--no-motor-vehicles':{shape:'circle',style:'prohibitory'},
 'regulatory--no-vehicles':{shape:'circle',style:'prohibitory'},
 'regulatory--height-limit':{shape:'circle',style:'prohibitory',text:'3.5'},
 'regulatory--weight-limit':{shape:'circle',style:'prohibitory',text:'8t'},
 'regulatory--weight-limit-per-axle':{shape:'circle',style:'prohibitory',text:'8t'},
 'regulatory--pedestrians-only':{shape:'circle',style:'path',people:1,bikes:0},
 'regulatory--bicycles-only':{shape:'circle',style:'path',people:0,bikes:1},
 'regulatory--shared-path-pedestrians-and-bicycles':{shape:'circle',style:'path',people:1,bikes:1},
 'regulatory--shared-path-bicycles-and-pedestrians':{shape:'circle',style:'path',people:1,bikes:1},
 'regulatory--dual-path-bicycles-and-pedestrians':{shape:'circle',style:'path',people:1,bikes:1,split:true},
 'regulatory--dual-path-pedestrians-and-bicycles':{shape:'circle',style:'path',people:1,bikes:1,split:true},
 'information--pedestrians-crossing':{shape:'square',style:'crossing'},
 'information--parking':{shape:'square',style:'letter',text:'P'},
 'information--general-directions':{shape:'board',style:'directions'},
 'information--dead-end':{shape:'square',style:'dead-end'},
 'information--limited-access-road':{shape:'square',style:'blank'},
 'information--lodging':{shape:'square',style:'blank'},
 'information--end-of-built-up-area':{shape:'rect',style:'blank'},
 'warning--roadworks':{shape:'triangle',style:'warning',mark:'roadworks'},
 'warning--children':{shape:'triangle',style:'warning',mark:'people'},
 'warning--pedestrians-crossing':{shape:'triangle',style:'warning',mark:'people'},
 'warning--other-danger':{shape:'triangle',style:'warning',mark:'!'},
 'warning--two-way-traffic':{shape:'triangle',style:'warning',mark:'two-way'},
 'warning--traffic-signals':{shape:'triangle',style:'warning',mark:'signals'},
 'complementary--chevron-left':{shape:'small',style:'chevron',side:-1},
 'complementary--chevron-right':{shape:'small',style:'chevron',side:1},
 'complementary--turn-left':{shape:'small',style:'small-arrow',side:-1},
 'complementary--turn-right':{shape:'small',style:'small-arrow',side:1},
};
const speed=/^regulatory--maximum-speed-limit-(\d+)$/;
const FAMILY={regulatory:{shape:'circle',style:'prohibitory'},warning:{shape:'triangle',style:'warning',mark:'!'},information:{shape:'square',style:'blank'},complementary:{shape:'small',style:'text'}};

// "regulatory--no-parking--g1" → {code,face,shape,known}. face is the atlas key.
// Face keys are the code without its family unless two families share one (turn-left, pedestrians-crossing).
const KEYS=Object.keys(FACES).map(c=>c.split('--')[1]),faceKey=code=>{const [family,key]=code.split('--');return KEYS.filter(k=>k===key).length>1&&!/^(regulatory|information)$/.test(family)?`${family}-${key}`:key;};
export function signFace(value=''){
 if(/^FI:/i.test(value))return finnishSign(value);
 if(/^DK:/i.test(value))return danishSign(value); // Copenhagen's sign register (danish-signs.js)
 const code=String(value).replace(/--g\d+$/,'');
 const m=speed.exec(code);
 if(m)return {code,face:`speed-${m[1]}`,shape:'circle',style:'speed',text:m[1],known:true};
 if(FACES[code])return {code,face:faceKey(code),...FACES[code],known:true};
 const family=code.split('--')[0];
 if(/^complementary--(texts|text|distance|both-directions|detour)/.test(code))return {code,face:'complementary-text',...FAMILY.complementary,known:true};
 if(/^regulatory--.*texts?/.test(code))return {code,face:'regulatory-text',shape:'rect',style:'text-blue',known:true};
 if(/^warning--texts?/.test(code))return {code,face:'warning-text',shape:'rect',style:'text-yellow',known:true};
 const fallback=FAMILY[family]||{shape:'square',style:'blank'};
 return {code,face:`generic-${family in FAMILY?family:'plate'}`,...fallback,known:false};
}
// ---------- Finnish sign codes (Digiroad, OSM "FI:…") ----------
// Current numbering (1.6.2020) with the old numbers it replaced. A Mapillary code means the same face as
// the detection layer (so the two sources dedupe by face); otherwise a Finnish face drawn below.
const W=(mark,x)=>({shape:'triangle',style:'warning',mark,...x}),P=(icon,x)=>({shape:'circle',style:'prohibitory',icon,...x}),B=(icon,x)=>({shape:'square',style:'pictogram',icon,...x});
const PLATE={shape:'small',style:'text'},BOARD='information--general-directions';
const FI_SIGNS=[
 ['A1.1','111',W('curve',{side:1})],['A1.2','112',W('curve',{side:-1})],['A2.1','113',W('curves',{side:1})],['A2.2','114',W('curves',{side:-1})],['A3.1','115',W('hill',{side:-1})],['A3.2','116',W('hill',{side:1})],
 ['A4','121',W('narrows')],['A5','122','warning--two-way-traffic'],['A6','131',W('!')],['A7','132',W('!')],['A8','133',W('!')],['A9','141',W('bumps')],['A10','141a',W('bumps')],['A11','142','warning--roadworks'],['A12','143',W('!')],
 ['A13','144',W('slippery')],['A14','147',W('!')],['A15','151',W('crossing')],['A16','',W('person')],['A17','152','warning--children'],['A18','153',W('bike')],['A19','154',W('!')],['A20.1','155',W('elk')],['A20.2','156',W('elk')],['A20.3','',W('elk')],
 ['A21','161',W('junction')],['A22.1','162',W('side-road',{side:1})],['A22.2','163',W('side-road',{side:-1})],['A22.3','164',W('side-road',{side:1})],['A22.4','',W('side-road',{side:-1})],['A23','165','warning--traffic-signals'],['A24','166',W('roundabout')],['A25','167',W('tram')],
 ['A26','171',W('train')],['A27','172',W('gate')],['A29.1','176',{shape:'cross',style:'level-crossing'}],['A29.2','177',{shape:'cross',style:'level-crossing'}],['A30','181',W('!')],['A31','182',W('!')],['A32','183',W('!')],['A33','189','warning--other-danger'],
 ['B1','211',{shape:'diamond',style:'priority'}],['B2','212',{shape:'diamond',style:'priority-end'}],['B3','221',{shape:'square',style:'priority-oncoming'}],['B4','222',{shape:'circle',style:'give-way-oncoming'}],['B5','231','regulatory--yield'],['B6','232','regulatory--stop'],['B7','','regulatory--yield'],
 ['C1','311','regulatory--no-vehicles'],['C2','312',P('car')],['C3','313',P('truck')],['C4','314',P('truck')],['C5','315',P('tractor')],['C6','316',P('motorcycle')],['C7','317',P('!')],['C8','318',P('!')],['C9','319',P('bus')],['C10','321',P('moped')],
 ['C11','',P('bike')],['C12','322',P('bike')],['C13','323',P('person')],['C14','',P('person')],['C15','324',P('person')],['C16','325',P('!')],
 ['C17','331','regulatory--no-entry'],['C18','332','regulatory--no-left-turn'],['C19','333','regulatory--no-right-turn'],['C20','334','regulatory--no-u-turn'],
 ['C21','341',P('',{unit:'m'})],['C22','342',P('',{unit:'m'})],['C23','343',P('',{unit:'m'})],['C24','344',P('',{unit:'t'})],['C25','345',P('',{unit:'t'})],['C26','346',P('',{unit:'t'})],['C27','347',P('',{unit:'t'})],
 ['C28','351',{shape:'circle',style:'no-overtaking'}],['C29','352',{shape:'circle',style:'end',mark:'overtaking'}],['C30','353',{shape:'circle',style:'no-overtaking',truck:true}],['C31','354',{shape:'circle',style:'end',mark:'overtaking'}],
 ['C32','361','speed'],['C33','362',{shape:'circle',style:'end',mark:'speed'}],['C34','363',{shape:'square',style:'zone',mark:'speed'}],['C35','364',{shape:'square',style:'zone',mark:'speed',end:true}],['C36','365',{shape:'board',style:'lanes'}],
 ['C37','371','regulatory--no-stopping'],['C38','372','regulatory--no-parking'],['C39','373',{shape:'square',style:'zone',mark:'no-parking'}],['C40','374',{shape:'square',style:'zone',mark:'no-parking',end:true}],
 ['C41','375',B('',{text:'TAXI'})],['C42','376',B('',{text:'TAXI'})],['C43','',B('',{text:'⇅'})],['C44.1','381','regulatory--no-parking'],['C44.2','382','regulatory--no-parking'],['C45','391',P('',{text:'TULLI'})],['C46','392',P('',{text:'STOP'})],['C47','393',P('',{unit:'m'})],['C48','',P('car')],
 ['D1.1','411','regulatory--go-straight'],['D1.2','412','regulatory--turn-right'],['D1.3','413','regulatory--turn-left'],['D1.4','414','regulatory--go-straight-or-turn-right'],['D1.5','415','regulatory--go-straight-or-turn-left'],
 ['D1.6','','regulatory--turn-left-or-right'],['D1.7','','regulatory--turn-right'],['D1.8','','regulatory--turn-left'],['D1.9','','regulatory--turn-left-or-right'],
 ['D2','416','regulatory--roundabout'],['D3.1','417','regulatory--keep-right'],['D3.2','','regulatory--keep-left'],['D3.3','418','regulatory--pass-on-either-side'],
 ['D4','421','regulatory--pedestrians-only'],['D5','422','regulatory--bicycles-only'],['D6','423','regulatory--shared-path-pedestrians-and-bicycles'],['D7.1','424','regulatory--dual-path-pedestrians-and-bicycles'],['D7.2','425','regulatory--dual-path-bicycles-and-pedestrians'],
 ['D8','426',{shape:'circle',style:'min-speed',text:'⛷'}],['D9','427',{shape:'circle',style:'min-speed',text:''}],['D10','',{shape:'circle',style:'min-speed'}],['D11','',{shape:'circle',style:'min-speed',end:true}],
 ['E1','511','information--pedestrians-crossing'],['E2','521','information--parking'],['E3.1','520a','information--parking'],['E3.2','520b','information--parking'],['E3.3','','information--parking'],['E3.4','','information--parking'],['E3.5','','information--parking'],
 ['E4.1','521a','information--parking'],['E4.2','521b','information--parking'],['E4.3','521c','information--parking'],['E5','522',B('',{text:'M'})],
 ['E6','531',{shape:'stop',style:'stop-sign',icon:'bus'}],['E6','532',{shape:'stop',style:'stop-sign',icon:'bus'}],['E7','533',{shape:'stop',style:'stop-sign',icon:'tram'}],['E8','534',B('',{text:'TAXI'})],
 ['E9.1','541a',B('bus',{lane:true})],['E9.2','541b',B('bus',{lane:true})],['E10.1','542a',B('bus',{lane:true,end:true})],['E10.2','542b',B('bus',{lane:true,end:true})],['E11.1','543a',B('tram',{lane:true})],['E11.2','543b',B('tram',{lane:true})],
 ['E12.1','544a',B('tram',{lane:true,end:true})],['E12.2','544b',B('tram',{lane:true,end:true})],['E13.1','',B('bike',{lane:true})],['E13.2','',B('bike',{lane:true})],
 ['E14.1','551','regulatory--one-way-right'],['E14.2','','regulatory--one-way-straight'],['E15','561',{shape:'square',style:'motorway',green:true}],['E16','562',{shape:'square',style:'motorway',green:true,end:true}],
 ['E17','563',{shape:'square',style:'motorway',car:true,green:true}],['E18','564',{shape:'square',style:'motorway',car:true,green:true,end:true}],['E19','565',B('tunnel')],['E20','566',B('tunnel',{end:true})],['E21','567',B('',{text:'SOS'})],
 ['E22','571',{shape:'rect',style:'town'}],['E23','572',{shape:'rect',style:'town',end:true}],['E24','573',B('yard')],['E25','574',B('yard',{end:true})],['E26','575',B('people')],['E27','576',B('people',{end:true})],['E28','',B('bike',{street:true})],['E29','',B('bike',{street:true,end:true})],['E30','',B('merge')],
 ['F24.1','651','information--dead-end'],['F24.2','651a','information--dead-end'],['F24.3','652','information--dead-end'],['F25','653',{shape:'square',style:'advisory'}],
 ['F28','663',{shape:'small',style:'road-number',colour:'green'}],['F29','664',{shape:'small',style:'road-number',colour:'red'}],['F30','665',{shape:'small',style:'road-number',colour:'yellow'}],['F31','665a',{shape:'small',style:'road-number',colour:'white'}],['F32','666',{shape:'small',style:'road-number',colour:'white'}],['F33','',{shape:'small',style:'road-number',colour:'white'}],
 ['F46.1','677','information--parking'],['F46.2','677a','information--parking'],
 ['G','',{shape:'square',style:'service'}],['H','',PLATE],
];
const FI=new Map(),FI_OLD=new Map();
for(const [code,old,spec] of FI_SIGNS){if(!FI.has(code))FI.set(code,spec);if(old)FI_OLD.set(old,code);}
// "FI:C32[40]", "FI:361[40]", "C32" (+ value) → {new code, value}. Unknown codes fall back by series.
export function finnishCode(raw,value=''){
 const m=/^(?:FI:)?\s*([A-I]\d+(?:\.\d+)?|\d{3}\s?[a-z]?)(?:\[([^\]]*)\])?/i.exec(String(raw).trim());
 if(!m)return null;
 let code=m[1].replace(/\s/g,'').toUpperCase();if(/^\d/.test(code))code=FI_OLD.get(code.toLowerCase())||FI_OLD.get(code.replace(/[A-Z]$/,''))||`${' ABCDEFGH'[code[0]]||'H'}-${code}`; // unknown old number: its series
 return {code,value:String(m[2]??value??'').trim()};
}
const series=code=>({A:W('!'),B:{shape:'triangle-down',style:'yield'},C:P(''),D:{shape:'circle',style:'min-speed',text:''},E:B(''),F:{shape:'board',style:'directions'},G:{shape:'square',style:'service'},H:PLATE,I:null})[code[0]];
// Plate text from a sign value: dimensions in metres (Digiroad stores centimetres), masses in tonnes (kilograms).
function valueText(spec,value){
 const n=parseFloat(String(value).replace(',','.'));if(!Number.isFinite(n))return spec.text??'';
 if(spec.unit==='m')return String(+(n>30?n/100:n).toFixed(1));
 if(spec.unit==='t')return `${+(n>200?n/1000:n).toFixed(1)}t`;
 return String(Math.round(n));
}
export function finnishSign(raw,value){
 const fi=finnishCode(raw,value);if(!fi)return signFace('generic');
 const v=fi.value,canon=`FI:${fi.code}${v?`[${v}]`:''}`;let spec=FI.get(fi.code)??(FI.has(fi.code.split('.')[0])?FI.get(fi.code.split('.')[0]):undefined)??series(fi.code);
 if(spec===null)return {code:canon,fi:fi.code,face:'fi-device',shape:'small',style:'text',known:false,device:true};
 const known=FI.has(fi.code);
 if(spec==='speed'){const n=parseInt(v)||50;return {...signFace(`regulatory--maximum-speed-limit-${n}`),code:canon,fi:fi.code};}
 if(typeof spec==='string')return {...signFace(spec),code:canon,fi:fi.code};
 const text=/zone|end|min-speed/.test(spec.style)&&!spec.mark?.includes('parking')&&v?String(parseInt(v)||v):spec.unit?valueText(spec,v):spec.style==='road-number'?v.replace(/\D/g,''):spec.text;
 const face=known||spec.style==='road-number'?`fi-${fi.code.toLowerCase()}${text&&text!==spec.text?`-${text}`:''}`:`fi-${fi.code[0].toLowerCase()}-plate`; // unknown codes share one face per series
 return {code:canon,fi:fi.code,face,...spec,...(text?{text}:{}),known};
}
// Faces that are the same sign for deduplication: speed limits match whatever the number.
export const signFamily=face=>String(face).replace(/^speed-\d+$/,'speed').replace(/^fi-(c3[23]|c34|c35)-\d+$/,'fi-$1');

// Physical plate size in metres (width, height) by shape.
export const PLATE_SIZE={circle:[.64,.64],diamond:[.78,.78],stop:[.66,.36],cross:[.9,.55],square:[.64,.64],triangle:[.9,.8],'triangle-down':[.9,.8],octagon:[.7,.7],rect:[.8,.4],board:[1.1,.5],small:[.64,.26]};

// Paint face f into a w×h canvas cell at (x0,y0). Only uses the 2D canvas API.
export function drawSignFace(c,f,x0,y0,w,h){
 // The plate's real proportions, centred in the cell (a 2:1 plate uses the middle half of a square cell).
 const [sw,sh]=PLATE_SIZE[f.shape]||[1,1],k=Math.min(w/sw,h/sh),bw=sw*k,bh=sh*k,bx=x0+(w-bw)/2,by=y0+(h-bh)/2;
 const C=SIGN_COLOURS,cx=x0+w/2,cy=y0+h/2,r=Math.min(bw,bh)/2*.96;
 c.save();c.lineJoin='round';c.lineCap='round';
 const poly=(pts,fill)=>{c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();};
 const disc=(rad,fill)=>{c.beginPath();c.arc(cx,cy,rad,0,Math.PI*2);c.fillStyle=fill;c.fill();};
 const text=(t,size,fill,y=cy)=>{c.fillStyle=fill;c.font=`700 ${size}px Arial, Helvetica, sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(t,cx,y+size*.04);};
 const arrow=(angle,len,fill,width=r*.18)=>{c.save();c.translate(cx,cy);c.rotate(angle*Math.PI/180);c.fillStyle=fill;c.fillRect(-width/2,-len*.15,width,len*.6);poly([[-width*1.6,-len*.15],[width*1.6,-len*.15],[0,-len*.55]],fill);c.restore();};
 const person=(x,y,s,fill)=>{c.fillStyle=fill;c.beginPath();c.arc(x,y-s*.42,s*.12,0,Math.PI*2);c.fill();c.strokeStyle=fill;c.lineWidth=s*.13;c.beginPath();c.moveTo(x,y-s*.28);c.lineTo(x+s*.04,y+s*.05);c.lineTo(x-s*.18,y+s*.42);c.moveTo(x+s*.04,y+s*.05);c.lineTo(x+s*.22,y+s*.4);c.moveTo(x-s*.2,y-s*.08);c.lineTo(x,y-s*.22);c.lineTo(x+s*.2,y-s*.02);c.stroke();};
 const bike=(x,y,s,fill)=>{c.strokeStyle=fill;c.lineWidth=s*.08;for(const dx of [-.28,.28]){c.beginPath();c.arc(x+dx*s,y+s*.15,s*.2,0,Math.PI*2);c.stroke();}c.beginPath();c.moveTo(x-s*.28,y+s*.15);c.lineTo(x-s*.05,y-s*.18);c.lineTo(x+s*.2,y-s*.18);c.lineTo(x+s*.28,y+s*.15);c.moveTo(x-s*.05,y-s*.18);c.lineTo(x+.02*s,y+s*.15);c.lineTo(x+s*.2,y-s*.18);c.stroke();};
 const ring=(field)=>{disc(r,C.red);disc(r*.78,field);};
 if(f.dk&&drawDanish(c,f,{cx,cy,r,bx,by,bw,bh})){c.restore();return;}
 if(drawFinnish(c,f,{C,cx,cy,r,bx,by,bw,bh,poly,disc,text,person,bike,arrow,ring})){c.restore();return;}
 if(f.shape==='circle'){
  if(f.style==='speed'||f.style==='prohibitory'){ring(C.yellow);if(f.text)text(f.text,r*(f.text.length>2?.62:.8),C.black);}
  else if(f.style==='no-parking'||f.style==='no-stopping'){ring(C.blue);c.save();c.translate(cx,cy);c.rotate(Math.PI/4);c.fillStyle=C.red;c.fillRect(-r*.1,-r*.8,r*.2,r*1.6);if(f.style==='no-stopping')c.fillRect(-r*.8,-r*.1,r*1.6,r*.2);c.restore();}
  else if(f.style==='no-entry'){disc(r,C.white);disc(r*.94,C.red);c.fillStyle=C.white;c.fillRect(cx-r*.62,cy-r*.15,r*1.24,r*.3);}
  else if(f.style==='no-turn'){ring(C.yellow);c.save();c.translate(cx,cy);c.scale(-f.side,1);c.strokeStyle=C.black;c.lineWidth=r*.15;c.beginPath();c.moveTo(r*.15,r*.55);c.lineTo(r*.15,-r*.05);c.lineTo(-r*.25,-r*.05);c.stroke();poly([[-r*.5,-r*.05],[-r*.22,-r*.3],[-r*.22,r*.2]],C.black);c.restore();c.save();c.translate(cx,cy);c.rotate(-Math.PI/4);c.fillStyle=C.red;c.fillRect(-r*.09,-r*.78,r*.18,r*1.56);c.restore();}
  else{disc(r,C.white);disc(r*.93,C.blue);
   if(f.style==='arrow')arrow(f.angle||0,r*1.6,C.white);
   else if(f.style==='arrow-split'){arrow(-40,r*1.5,C.white,r*.14);arrow(40,r*1.5,C.white,r*.14);}
   else if(f.style==='arrow-turn'){c.save();c.translate(cx,cy);c.scale(f.side,1);c.strokeStyle=C.white;c.lineWidth=r*.18;c.beginPath();c.moveTo(-r*.15,r*.6);c.lineTo(-r*.15,0);c.quadraticCurveTo(-r*.15,-r*.2,r*.15,-r*.2);c.stroke();poly([[r*.55,-r*.2],[r*.15,-r*.5],[r*.15,r*.1]],C.white);if(f.straight){c.beginPath();c.moveTo(-r*.15,0);c.lineTo(-r*.15,-r*.35);c.stroke();poly([[-r*.45,-r*.3],[r*.15,-r*.3],[-r*.15,-r*.7]],C.white);}c.restore();}
   else if(f.style==='roundabout'){for(let k=0;k<3;k++){c.save();c.translate(cx,cy);c.rotate(k*Math.PI*2/3);c.strokeStyle=C.white;c.lineWidth=r*.14;c.beginPath();c.arc(0,0,r*.45,-.2,1.5);c.stroke();poly([[r*.45*Math.cos(-.5)-r*.15,r*.45*Math.sin(-.5)],[r*.45*Math.cos(-.5)+r*.18,r*.45*Math.sin(-.5)],[r*.45*Math.cos(-.75),r*.45*Math.sin(-.75)-r*.12]],C.white);c.restore();}}
   else if(f.style==='path'){if(f.split){c.fillStyle=C.white;c.fillRect(cx-r*.03,cy-r*.75,r*.06,r*1.5);}
    if(f.people&&f.bikes){person(cx-r*(f.split?.4:0),cy-r*(f.split?0:.32),r*(f.split?.7:.55),C.white);bike(cx+r*(f.split?.42:0),cy+r*(f.split?0:.3),r*(f.split?.55:.6),C.white);}
    else if(f.people)person(cx,cy,r*1.1,C.white);else bike(cx,cy,r*1.1,C.white);}
  }
 }else if(f.shape==='octagon'){const pts=[];for(let k=0;k<8;k++){const a=Math.PI/8+k*Math.PI/4;pts.push([cx+Math.cos(a)*r,cy+Math.sin(a)*r]);}poly(pts,C.white);poly(pts.map(([x,y])=>[cx+(x-cx)*.92,cy+(y-cy)*.92]),C.red);text('STOP',r*.5,C.white);}
 else if(f.shape==='triangle'||f.shape==='triangle-down'){
  const down=f.shape==='triangle-down',s=down?-1:1,tri=k=>[[cx,cy-s*r*k],[cx+r*.98*k,cy+s*r*.72*k],[cx-r*.98*k,cy+s*r*.72*k]];
  poly(tri(1),C.red);poly(tri(.72),C.yellow);
  if(!down){const m=f.mark;if(m==='people'){person(cx-r*.15,cy+r*.15,r*.55,C.black);person(cx+r*.2,cy+r*.2,r*.45,C.black);}
   else if(m==='roadworks'){person(cx,cy+r*.15,r*.6,C.black);c.fillStyle=C.black;c.fillRect(cx-r*.35,cy+r*.48,r*.7,r*.08);}
   else if(m==='two-way'){arrow(0,r*.8,C.black,r*.1);c.save();c.translate(cx,cy+r*.15);c.rotate(Math.PI);c.translate(-cx,-cy);arrow(0,r*.8,C.black,r*.1);c.restore();}
   else if(m==='signals'){c.fillStyle=C.black;c.fillRect(cx-r*.13,cy-r*.25,r*.26,r*.75);for(const [k,col] of [[0,C.red],[1,C.yellow],[2,'#47b36b']]){c.beginPath();c.arc(cx,cy-r*.12+k*r*.24,r*.08,0,Math.PI*2);c.fillStyle=col;c.fill();}}
   else text('!',r*.7,C.black,cy+r*.18);}
 }else if(f.shape==='small'){
  // Complementary plate: white with a thin black rim.
  c.fillStyle=C.black;c.fillRect(bx,by,bw,bh);c.fillStyle=C.white;c.fillRect(bx+bh*.07,by+bh*.07,bw-bh*.14,bh*.86);
  if(f.style==='chevron'||f.style==='small-arrow'){c.save();c.translate(cx,cy);c.scale(f.side,1);c.strokeStyle=C.black;c.lineWidth=bh*.16;c.beginPath();c.moveTo(-bw*.2,0);c.lineTo(bw*.15,0);c.stroke();poly([[bw*.3,0],[bw*.12,-bh*.32],[bw*.12,bh*.32]],C.black);c.restore();}
  else{c.fillStyle=C.black;for(let k=0;k<2;k++)c.fillRect(bx+bw*.15,by+bh*(.27+k*.3),bw*(.7-k*.2),bh*.15);}
 }else{
  // Square, rect and board plates: blue information field with a white rim.
  const yellow=f.style==='text-yellow',field=yellow?C.yellow:C.blue;
  const pw=bw*.97,ph=bh*.97,px=cx-pw/2,py=cy-ph/2,rim=Math.min(pw,ph)*.045;
  c.fillStyle=yellow?C.red:C.white;c.fillRect(px,py,pw,ph);c.fillStyle=field;c.fillRect(px+rim,py+rim,pw-rim*2,ph-rim*2);
  const s=ph;
  if(f.style==='crossing'){poly([[cx,py+s*.14],[cx+s*.42,py+s*.86],[cx-s*.42,py+s*.86]],C.white);for(let k=-2;k<=2;k++){c.fillStyle=C.black;c.fillRect(cx+k*s*.11-s*.04,py+s*.74,s*.08,s*.06);}person(cx,py+s*.5,s*.5,C.black);}
  else if(f.style==='letter')text(f.text,s*.7,C.white);
  else if(f.style==='dead-end'){c.fillStyle=C.white;c.fillRect(cx-s*.08,cy-s*.05,s*.16,s*.38);c.fillStyle=C.red;c.fillRect(cx-s*.25,cy-s*.3,s*.5,s*.14);}
  else if(f.style==='one-way'){c.save();c.translate(cx,cy);c.scale(f.side,1);c.fillStyle=C.white;c.fillRect(-pw*.32,-s*.09,pw*.5,s*.18);poly([[pw*.36,0],[pw*.14,-s*.28],[pw*.14,s*.28]],C.white);c.restore();}
  else if(f.style==='one-way-up')arrow(0,s*.9,C.white,s*.14);
  else if(f.style==='directions'){c.fillStyle=C.white;for(let k=0;k<3;k++)c.fillRect(px+pw*.12,py+ph*(.22+k*.22),pw*(.55-k*.1),ph*.09);poly([[px+pw*.9,cy],[px+pw*.76,cy-ph*.2],[px+pw*.76,cy+ph*.2]],C.white);}
  else if(/^text/.test(f.style)){c.fillStyle=yellow?C.black:C.white;for(let k=0;k<2;k++)c.fillRect(px+pw*.15,py+ph*(.32+k*.24),pw*(.7-k*.2),ph*.1);}
 }
 c.restore();
}

// ---------- Finnish faces (drawn from the sign's description: shapes, colours, simple pictograms) ----------
function icon(c,name,x,y,s,fill){
 c.save();c.translate(x,y);c.fillStyle=fill;c.strokeStyle=fill;c.lineCap='round';c.lineJoin='round';
 const rect=(a,b,w,h)=>c.fillRect(a*s,b*s,w*s,h*s),wheel=(a,b,rr)=>{c.beginPath();c.arc(a*s,b*s,rr*s,0,Math.PI*2);c.fill();};
 if(name==='car'){c.beginPath();c.moveTo(-.48*s,.12*s);c.lineTo(-.4*s,-.08*s);c.lineTo(-.22*s,-.1*s);c.lineTo(-.12*s,-.28*s);c.lineTo(.2*s,-.28*s);c.lineTo(.3*s,-.1*s);c.lineTo(.48*s,-.06*s);c.lineTo(.48*s,.12*s);c.closePath();c.fill();wheel(-.27,.14,.1);wheel(.3,.14,.1);}
 else if(name==='truck'){rect(-.5,-.3,.62,.4);rect(.14,-.16,.3,.26);wheel(-.33,.14,.1);wheel(.3,.14,.1);}
 else if(name==='bus'||name==='tram'){const w=name==='tram'?.56:.5;rect(-w,-.3,w*2,.42);c.fillStyle='#f3d43e';for(let i=0;i<4;i++)rect(-w+.08+i*(w*2-.12)/4,-.22,(w*2-.12)/4-.06,.14);c.fillStyle=fill;
  if(name==='bus'){wheel(-.3,.14,.1);wheel(.3,.14,.1);}else{rect(-w,.12,w*2,.04);c.lineWidth=.04*s;c.beginPath();c.moveTo(-.1*s,-.3*s);c.lineTo(0,-.46*s);c.lineTo(.1*s,-.3*s);c.stroke();rect(-.25,-.48,.5,.03);}}
 else if(name==='tractor'){rect(-.2,-.3,.3,.3);rect(-.4,-.05,.7,.14);wheel(-.25,.12,.18);wheel(.28,.16,.11);}
 else if(name==='motorcycle'||name==='moped'){c.lineWidth=.07*s;for(const a of [-.3,.3]){c.beginPath();c.arc(a*s,.14*s,.14*s,0,Math.PI*2);c.stroke();}rect(-.22,-.12,.42,.12);if(name==='motorcycle')rect(-.06,-.3,.1,.2);}
 else if(name==='tunnel'){c.beginPath();c.moveTo(-.46*s,.4*s);c.lineTo(-.46*s,-.05*s);c.arc(0,-.05*s,.46*s,Math.PI,0);c.lineTo(.46*s,.4*s);c.closePath();c.fill();c.fillStyle='#0955ac';c.beginPath();c.moveTo(-.3*s,.4*s);c.lineTo(-.3*s,0);c.arc(0,0,.3*s,Math.PI,0);c.lineTo(.3*s,.4*s);c.closePath();c.fill();}
 else if(name==='yard'){c.beginPath();c.moveTo(-.45*s,-.05*s);c.lineTo(-.2*s,-.32*s);c.lineTo(.05*s,-.05*s);c.closePath();c.fill();rect(-.38,-.05,.36,.3);}
 else if(name==='merge'){c.lineWidth=.1*s;c.beginPath();c.moveTo(-.3*s,.4*s);c.lineTo(-.3*s,-.4*s);c.moveTo(.3*s,.4*s);c.quadraticCurveTo(.3*s,0,-.2*s,-.15*s);c.stroke();}
 else if(name==='elk'){c.beginPath();c.ellipse(0,0,.34*s,.16*s,0,0,Math.PI*2);c.fill();rect(-.28,0,.06,.36);rect(.22,0,.06,.36);rect(.3,-.24,.08,.26);c.beginPath();c.ellipse(.44*s,-.22*s,.12*s,.07*s,.4,0,Math.PI*2);c.fill();rect(.24,-.36,.2,.04);}
 else if(name==='train'){rect(-.5,-.28,.74,.38);rect(.24,-.12,.24,.22);rect(-.4,-.44,.14,.16);wheel(-.32,.14,.1);wheel(0,.14,.1);wheel(.32,.14,.1);}
 c.restore();
}
const EXTRA_MARKS=new Set(['curve','curves','hill','narrows','bumps','slippery','crossing','person','bike','elk','junction','side-road','roundabout','tram','train','gate']);
function drawFinnish(c,f,{C,cx,cy,r,bx,by,bw,bh,poly,disc,text,person,bike,arrow,ring}){
 const stripe=(colour,n=1,w=r*.12,angle=-Math.PI/4)=>{c.save();c.translate(cx,cy);c.rotate(angle);c.fillStyle=colour;for(let k=0;k<n;k++)c.fillRect(-r*.9,(k-(n-1)/2)*w*1.6-w/2,r*1.8,w);c.restore();};
 const clipDisc=rad=>{c.beginPath();c.arc(cx,cy,rad,0,Math.PI*2);c.clip();};
 const st=f.style;
 if(f.shape==='circle'){
  if(st==='prohibitory'&&f.icon){ring(C.yellow);if(f.icon==='!')text('!',r*.8,C.black);else if(f.icon==='person')person(cx,cy+r*.05,r*1,C.black);else if(f.icon==='bike')bike(cx,cy,r*1.05,C.black);else icon(c,f.icon,cx,cy,r*1.15,C.black);return true;}
  if(st==='no-overtaking'){ring(C.yellow);icon(c,'car',cx+r*.26,cy,r*.55,C.black);icon(c,f.truck?'truck':'car',cx-r*.26,cy,r*.55,C.red);return true;}
  if(st==='end'){disc(r,C.black);disc(r*.93,C.yellow);
   if(f.mark==='speed'&&f.text)text(f.text,r*(f.text.length>2?.62:.8),'#8a8f8c');else if(f.mark==='overtaking'){icon(c,'car',cx+r*.26,cy,r*.55,'#8a8f8c');icon(c,'car',cx-r*.26,cy,r*.55,'#8a8f8c');}
   c.save();clipDisc(r*.93);stripe(C.black,4,r*.07,Math.PI/4);c.restore();return true;}
  if(st==='give-way-oncoming'){ring(C.yellow);arrow(0,r*1.1,C.black,r*.12);c.save();c.translate(cx,cy);c.rotate(Math.PI);c.translate(-cx,-cy);c.translate(r*.28,0);arrow(0,r*1.1,C.red,r*.12);c.restore();return true;}
  if(st==='min-speed'){disc(r,C.white);disc(r*.93,C.blue);if(f.text)text(f.text,r*.75,C.white);if(f.end){c.save();clipDisc(r*.93);stripe(C.red,1,r*.14);c.restore();}return true;}
  return false;
 }
 if(f.shape==='triangle'&&EXTRA_MARKS.has(f.mark)){
  const tri=k=>[[cx,cy-r*k],[cx+r*.98*k,cy+r*.72*k],[cx-r*.98*k,cy+r*.72*k]];poly(tri(1),C.red);poly(tri(.72),C.yellow);
  const m=f.mark,y=cy+r*.18,s=r*.5,side=f.side||1;c.save();c.strokeStyle=C.black;c.fillStyle=C.black;c.lineWidth=r*.09;c.lineCap='round';
  if(m==='curve'||m==='curves'){c.translate(cx,y);c.scale(side,1);c.beginPath();c.moveTo(-s*.25,s*.55);if(m==='curve')c.quadraticCurveTo(-s*.25,-s*.2,s*.3,-s*.35);else{c.bezierCurveTo(-s*.25,0,s*.3,0,s*.15,-s*.25);c.quadraticCurveTo(0,-s*.45,-s*.15,-s*.45);}c.stroke();}
  else if(m==='hill'){c.translate(cx,y);c.scale(side,1);poly([[-s*.6,s*.45],[s*.6,s*.45],[s*.6,-s*.25]],C.black);}
  else if(m==='narrows'){c.beginPath();c.moveTo(cx-s*.45,y+s*.5);c.lineTo(cx-s*.2,y);c.lineTo(cx-s*.2,y-s*.5);c.moveTo(cx+s*.45,y+s*.5);c.lineTo(cx+s*.2,y);c.lineTo(cx+s*.2,y-s*.5);c.stroke();}
  else if(m==='bumps'){c.beginPath();c.moveTo(cx-s*.7,y+s*.35);c.quadraticCurveTo(cx-s*.35,y-s*.25,cx,y+s*.35);c.quadraticCurveTo(cx+s*.35,y-s*.25,cx+s*.7,y+s*.35);c.stroke();}
  else if(m==='slippery'){icon(c,'car',cx,y-s*.15,s*.9,C.black);c.beginPath();c.moveTo(cx-s*.4,y+s*.5);c.bezierCurveTo(cx-s*.1,y+s*.2,cx-s*.3,y+s*.6,cx,y+s*.3);c.moveTo(cx+s*.1,y+s*.5);c.bezierCurveTo(cx+s*.3,y+s*.2,cx+s*.2,y+s*.6,cx+s*.45,y+s*.3);c.stroke();}
  else if(m==='crossing'){person(cx,y-s*.1,s*1,C.black);for(let k=-2;k<=2;k++)c.fillRect(cx+k*s*.22-s*.07,y+s*.42,s*.14,s*.1);}
  else if(m==='person')person(cx,y,s*1.15,C.black);
  else if(m==='bike')bike(cx,y,s*1.1,C.black);
  else if(m==='elk')icon(c,'elk',cx-s*.1,y,s*1.1,C.black);
  else if(m==='junction'){c.fillRect(cx-r*.06,y-s*.6,r*.12,s*1.15);c.fillRect(cx-s*.55,y-r*.06,s*1.1,r*.12);}
  else if(m==='side-road'){c.fillRect(cx-r*.07,y-s*.6,r*.14,s*1.15);c.save();c.translate(cx,y);c.scale(side,1);c.fillRect(0,-r*.05-s*.1,s*.55,r*.1);c.restore();}
  else if(m==='roundabout'){for(let k=0;k<3;k++){c.save();c.translate(cx,y);c.rotate(k*Math.PI*2/3);c.beginPath();c.arc(0,0,s*.4,-.3,1.4);c.stroke();c.restore();}}
  else if(m==='tram')icon(c,'tram',cx,y,s*1.05,C.black);
  else if(m==='train')icon(c,'train',cx,y,s*1,C.black);
  else if(m==='gate'){c.fillRect(cx-s*.6,y-s*.05,s*1.2,s*.14);c.fillRect(cx-s*.6,y-s*.3,s*.12,s*.7);}
  c.restore();return true;
 }
 if(f.shape==='diamond'){const d=k=>[[cx,cy-r*k],[cx+r*k,cy],[cx,cy+r*k],[cx-r*k,cy]];poly(d(1),'#5f6668');poly(d(.95),C.white);poly(d(.6),C.yellow);
  if(st==='priority-end'){c.save();c.beginPath();d(.95).forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.clip();stripe(C.black,3,r*.08,Math.PI/4);c.restore();}return true;}
 if(f.shape==='cross'){for(const a of [.55,-.55]){c.save();c.translate(cx,cy);c.rotate(a);c.fillStyle=C.red;c.fillRect(-bw*.48,-bh*.17,bw*.96,bh*.34);c.fillStyle=C.white;c.fillRect(-bw*.45,-bh*.11,bw*.9,bh*.22);c.restore();}return true;}
 if(f.shape==='stop'){c.fillStyle=C.black;c.fillRect(bx,by,bw,bh);c.fillStyle=C.yellow;c.fillRect(bx+bh*.06,by+bh*.06,bw-bh*.12,bh*.88);icon(c,f.icon,cx,cy+bh*.05,bh*.95,C.black);return true;}
 if(f.shape==='small'&&st==='road-number'){const col={red:C.red,yellow:C.yellow,green:'#2f7d48',white:C.white}[f.colour]||C.white;c.fillStyle=C.black;c.fillRect(bx+bw*.15,by,bw*.7,bh);c.fillStyle=col;c.fillRect(bx+bw*.15+bh*.06,by+bh*.06,bw*.7-bh*.12,bh*.88);
  if(f.text){c.fillStyle=/red|green/.test(f.colour)?C.white:C.black;c.font=`700 ${bh*.7}px Arial, Helvetica, sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(f.text,cx,cy+bh*.04);}return true;}
 if(/^(square|rect|board)$/.test(f.shape)&&/^(pictogram|zone|priority-oncoming|motorway|town|advisory|service|lanes)$/.test(st)){
  const pw=bw*.97,ph=bh*.97,px=cx-pw/2,py=cy-ph/2,rim=Math.min(pw,ph)*.045,s=ph,field=f.green?'#2f7d48':st==='zone'?C.white:C.blue;
  c.fillStyle=st==='zone'?C.black:C.white;c.fillRect(px,py,pw,ph);c.fillStyle=field;c.fillRect(px+rim,py+rim,pw-rim*2,ph-rim*2);
  if(st==='pictogram'){
   if(f.text)text(f.text,s*(f.text.length>2?.3:.6),C.white);
   else if(f.icon==='people'){person(cx-s*.14,cy+s*.05,s*.6,C.white);person(cx+s*.16,cy+s*.08,s*.5,C.white);}
   else if(f.icon==='bike')bike(cx,cy+(f.lane?s*.1:0),s*.6,C.white);
   else if(f.icon==='yard'){icon(c,'yard',cx+s*.05,cy-s*.05,s*.8,C.white);person(cx+s*.2,cy+s*.12,s*.4,C.white);}
   else if(f.icon)icon(c,f.icon,cx,cy+(f.lane?s*.08:0),s*.75,C.white);
   if(f.lane){c.fillStyle=C.white;c.fillRect(px+pw*.1,py+ph*.12,pw*.8,s*.05);}
   if(f.street){c.fillStyle=C.white;c.font=`700 ${s*.11}px Arial, Helvetica, sans-serif`;c.textAlign='center';c.fillText('PYÖRÄKATU',cx,py+ph*.85);}
  }else if(st==='zone'){c.beginPath();c.arc(cx,cy-s*.08,s*.3,0,Math.PI*2);c.fillStyle=C.red;c.fill();c.beginPath();c.arc(cx,cy-s*.08,s*.23,0,Math.PI*2);c.fillStyle=f.mark==='no-parking'?C.blue:C.yellow;c.fill();
   if(f.mark==='no-parking'){c.save();c.translate(cx,cy-s*.08);c.rotate(Math.PI/4);c.fillStyle=C.red;c.fillRect(-s*.03,-s*.23,s*.06,s*.46);c.restore();}else if(f.text){c.fillStyle=C.black;c.font=`700 ${s*.22}px Arial, Helvetica, sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText(f.text,cx,cy-s*.07);}
   c.fillStyle=C.black;c.font=`700 ${s*.15}px Arial, Helvetica, sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('ALUE',cx,py+ph*.84);}
  else if(st==='priority-oncoming'){c.save();c.translate(-s*.14,0);arrow(0,s*.8,C.white,s*.08);c.restore();c.save();c.translate(cx+s*.14,cy);c.rotate(Math.PI);c.translate(-cx,-cy);arrow(0,s*.8,C.red,s*.08);c.restore();}
  else if(st==='motorway'){c.fillStyle=C.white;c.fillRect(cx-s*.32,cy-s*.05,s*.18,s*.42);c.fillRect(cx+s*.14,cy-s*.05,s*.18,s*.42);c.fillRect(cx-s*.36,cy-s*.18,s*.72,s*.12);if(f.car)icon(c,'car',cx,cy-s*.3,s*.5,C.white);}
  else if(st==='town'){c.fillStyle=C.white;for(const [a,h] of [[-.34,.3],[-.2,.42],[-.04,.24],[.12,.48],[.28,.32]])c.fillRect(cx+a*pw,cy+ph*.3-h*ph,pw*.12,h*ph);}
  else if(st==='advisory'){if(f.text)text(f.text,s*.5,C.white);}
  else if(st==='service'){c.fillStyle=C.white;c.fillRect(cx-s*.28,cy-s*.28,s*.56,s*.56);c.fillStyle=C.red;c.fillRect(cx-s*.06,cy-s*.2,s*.12,s*.4);c.fillRect(cx-s*.2,cy-s*.06,s*.4,s*.12);}
  else if(st==='lanes'){for(const a of [-.25,0,.25]){c.save();c.translate(a*pw,0);arrow(0,s*.7,C.white,s*.07);c.restore();}}
  if(f.end){c.save();c.beginPath();c.rect(px+rim,py+rim,pw-rim*2,ph-rim*2);c.clip();c.translate(cx,cy);c.rotate(-Math.atan2(ph,pw));c.fillStyle=C.red;c.fillRect(-pw,-s*.05,pw*2,s*.1);c.restore();}
  return true;
 }
 return false;
}
