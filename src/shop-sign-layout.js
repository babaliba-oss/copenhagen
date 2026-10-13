// Shop sign names and atlas layout: pure data, safe to import in the building worker.
export const SHOP_NAMES=[
 ['BAGERI','#f3ead6','#5a3a22'],['KAFFE','#2b2b2b','#f1e3c8'],['APOTEK','#1f6b4a','#ffffff'],['FRISØR','#111111','#f2f2f2'],
 ['VINBAR','#5a1f2a','#f3dcc0'],['SMØRREBRØD','#e9e1cf','#1f3a2c'],['BLOMSTER','#3c6b3a','#fdf6e8'],['BOGHANDEL','#1d2c4a','#e8d9b0'],
 ['CYKLER','#c8202a','#ffffff'],['PIZZA','#f2efe6','#b2321f'],['SUSHI','#151515','#e8e4da'],['KIOSK','#e2b33c','#1c1c1c'],
 ['OPTIKER','#ffffff','#22323c'],['ISBAR','#f4c6cf','#4a2430'],['GALLERI','#ebebeb','#202020'],['BRUGS','#1f4f8a','#ffffff']];
export const SIGN_COLS=4,SIGN_ROWS=4;
// UV rectangle of name i in the atlas: [u0,v0,u1,v1]
export function signCell(i){const k=i%SHOP_NAMES.length,c=k%SIGN_COLS,r=Math.floor(k/SIGN_COLS);return [c/SIGN_COLS,1-(r+1)/SIGN_ROWS,(c+1)/SIGN_COLS,1-r/SIGN_ROWS];}
