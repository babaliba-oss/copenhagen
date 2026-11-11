// The Danish language option (src/i18n.js, src/i18n-da.js): which language is chosen, English as the fallback, every
// dictionary key still in the English source, and the start card, HUD, help, pause card, first-time prompts, jobs,
// ranks and races coming out Danish.
import {mainSource} from './helpers/main-source.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
const {pickLang,forCity,useDictionary,t,translateTree,english,currentLang}=await import('../src/i18n.js'),da=(await import('../src/i18n-da.js')).default;
const {JOBS,JOBS_1760,SAGAS,CHARACTERS}=await import('../src/copenhagen/data.js'),{PROMPT_IDS,promptText}=await import('../src/prompts.js'),{GAME_LINE,shareSaid}=await import('../src/copenhagen/share.js');
const read=f=>fs.readFileSync(f,'utf8'),game=read('src/copenhagen/game.js');
const danish=fn=>{useDictionary(da);try{return fn();}finally{useDictionary(null);}};

// A very small HTML tree: enough for index.html and for what the game writes with innerHTML.
const VOID=/^(meta|link|img|br|hr|input|path|circle)$/i,ent=s=>s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
const text=v=>({nodeType:3,nodeValue:v}),doc={createTextNode:text};
function element(tag,attrs={}){const e={nodeType:1,tagName:tag.toUpperCase(),attrs,childNodes:[],getAttribute:a=>e.attrs[a]??null,setAttribute:(a,v)=>{e.attrs[a]=v;},replaceChildren:(...n)=>{e.childNodes=n;}};return e;}
function parse(html){
 const root=element('root'),stack=[root],re=/<!--[\s\S]*?-->|<!doctype[^>]*>|<(script|style)\b[^>]*>[\s\S]*?<\/\1>|<\/([a-zA-Z0-9]+)\s*>|<([a-zA-Z0-9]+)((?:\s+[^\s=>\/]+(?:="[^"]*"|='[^']*')?)*)\s*(\/?)>|([^<]+)/gi;let m;
 while((m=re.exec(html))){const top=stack.at(-1);
  if(m[6]!==undefined)top.childNodes.push(text(ent(m[6])));
  else if(m[2]){if(stack.length>1)stack.pop();}
  else if(m[3]){const attrs={};for(const a of m[4].matchAll(/([^\s=]+)(?:="([^"]*)"|='([^']*)')?/g))attrs[a[1]]=ent(a[2]??a[3]??'');const e=element(m[3],attrs);top.childNodes.push(e);if(!m[5]&&!VOID.test(m[3]))stack.push(e);}}
 return root;
}
const texts=(n,out=[])=>{if(n.nodeType===3){const v=n.nodeValue.replace(/\s+/g,' ').trim();if(v)out.push(v);}else for(const k of n.childNodes)texts(k,out);return out;};
const shown=html=>danish(()=>{const r=parse(html);translateTree(r,doc);return texts(r).join(' ');});
// English left in a Danish text: the common words that no Danish sentence has.
const ENGLISH=/\b(the|and|you|your|with|press|tap|are|from|of|this|that|into|their|it)\b/i;

test('the language: ?lang= first, then the saved choice, then a Danish browser, else English',()=>{
 assert.equal(pickLang({search:'?lang=da',stored:'en',nav:'en-GB'}),'da');
 assert.equal(pickLang({search:'?city=copenhagen-1760&lang=en',stored:'da',nav:'da-DK'}),'en');
 assert.equal(pickLang({search:'?lang=sv',stored:'da',nav:'en'}),'da','an unknown ?lang= is no choice');
 assert.equal(pickLang({search:'',stored:'en',nav:'da-DK'}),'en');
 assert.equal(pickLang({search:'',stored:'xx',nav:'da'}),'da');assert.equal(pickLang({nav:'da-DK'}),'da');assert.equal(pickLang({nav:'DA'}),'da');
 assert.equal(pickLang({nav:'en-DK'}),'en');assert.equal(pickLang({nav:'de'}),'en');assert.equal(pickLang(),'en');assert.equal(pickLang({nav:undefined,stored:null}),'en');
 assert.ok(forCity('')&&forCity('?city=copenhagen')&&forCity('?city=copenhagen-1760&lang=da'));assert.ok(!forCity('?city=helsinki')&&!forCity('?city=tampere'),'Copenhagen only');
});

test('English is the source and the fallback: nothing changes without the dictionary, and an unknown text stays as it is with it',()=>{
 assert.equal(currentLang(),'en');assert.equal(t('Car recovered.'),'Car recovered.');assert.equal(t('Delivered!'),'Delivered!');
 const r=parse('<p>Hold <b>Go</b> to drive.</p>');translateTree(r,doc);assert.equal(texts(r).join(' '),'Hold Go to drive.');
 danish(()=>{assert.equal(currentLang(),'da');
  assert.equal(t('Car recovered.'),'Bilen er rettet op.');assert.equal(t('  Car recovered. '),'  Bilen er rettet op. ','the spaces around a text are kept');
  for(const s of ['A sentence nobody translated yet','Nyhavn','Dronning Louises Bro','W A S D','55.680° N · 12.576° E','1760','0.00',''])assert.equal(t(s),s);
  assert.equal(t('Nisse found! Nobody wrote this part.'),'Nisse found! Nobody wrote this part.');
  assert.equal(t(null),null);assert.equal(t(42),42);});
 assert.equal(t('Car recovered.'),'Car recovered.');
});

test('texts put together in the code: parts joined with " · ", names and numbers in a sentence, Danish numbers',()=>{danish(()=>{
 assert.equal(t('+1,250 kr · streak ×3 bonus +250 · fast'),'+1.250 kr · stime ×3, bonus +250 · hurtigt');
 assert.equal(t('Promoted: Bike courier'),'Forfremmet: Cykelbud');
 assert.equal(t('Next: Cargo rider in 3 deliveries · Postbox red paint'),'Næste: Ladcyklist om 3 leveringer · Postkasserød lak');
 assert.equal(t('Next: Runner in 1 delivery · a purse of 96 sk.'),'Næste: Løber om 1 levering · en pung med 96 sk.');
 assert.equal(t('Harbour Sprint · 1:23.4 · new best · +1,500 kr'),'Havnespurten · 1:23.4 · ny rekord · +1.500 kr');
 assert.equal(t('Gold 1:10.0 · silver 1:27.5 · bronze 1:52.0'),'Guld 1:10.0 · sølv 1:27.5 · bronze 1:52.0');
 assert.equal(t('Gold!'),'Guld!');assert.equal(t('1.2 km'),'1,2 km');assert.equal(t('Copenhagen 1760 can wait.'),'København 1760 kan vente.');
 assert.equal(t('Lantern lit. Vor Frue. Rebuilt after 1728.'),'Lygte tændt. Vor Frue. Genopbygget efter 1728.');
 assert.equal(t('Travelling in time drops your delivery. Press Y again to go anyway.'),'En tidsrejse afbryder det, du er i gang med (levering). Tryk Y igen for at rejse alligevel.');
 assert.equal(t('2 stars: the police are after you. Get out of their sight to lose them.'),'2 stjerner: politiet er efter dig. Kom ud af syne for at ryste dem af.');
 assert.equal(t('POLICE PURSUIT · 1 UNIT'),'POLITIJAGT · 1 VOGN');assert.equal(t('POLICE PURSUIT · 3 UNITS'),'POLITIJAGT · 3 VOGNE');
 assert.equal(t('Knocked over 3 bollards, bins and scooters'),'Væltede 3 pullerter, skraldespande og løbehjul');
 assert.equal(t('Press Y'),'Tryk Y');assert.equal(t('Press D-pad ↓'),'Tryk D-pad ↓');assert.equal(t('Press the button twice'),'Press the button twice','{k} takes a key name only');
});});

test('a sentence with elements in it keeps the elements and puts them where the Danish has them',()=>{danish(()=>{
 const r=parse('<p class="cph-go">Deliver to <b>Amalienborg</b> in 142 s</p><button id="map-btn"><span>⌘</span> City map <kbd>M</kbd></button><p>Press <kbd>N</kbd> for a postcard of <b>The Little Mermaid</b></p><p class="cph-kick">Race · checkpoint 2/5 · <kbd>X</kbd> quit</p>');
 const [go,btn,hint,kick]=r.childNodes,b=go.childNodes[1],kbd=btn.childNodes[2];translateTree(r,doc);
 assert.equal(texts(go).join(' '),'Lever til Amalienborg inden 142 s');assert.equal(go.childNodes[1],b,'the same <b>, not a copy');
 assert.equal(texts(btn).join(' '),'⌘ Bykort M');assert.equal(btn.childNodes.at(-1),kbd);
 assert.equal(texts(hint).join(' '),'Tryk N for et postkort af Den Lille Havfrue');assert.equal(texts(kick).join(' '),'Løb · checkpoint 2/5 · X afbryd');
 // what the code wrote can still be read (main.js: the 1760 help rows, the phone's card tabs)
 assert.equal(english(go),'Deliver to Amalienborg in 142 s');assert.match(english(kick),/race/i);assert.equal(english(btn),'⌘ City map M');
 const again=texts(r).join('|');translateTree(r,doc);assert.equal(texts(r).join('|'),again,'a second pass changes nothing');
 const dt=parse('<dt>Handbrake</dt>').childNodes[0];translateTree(dt,doc);assert.equal(dt.childNodes[0].nodeValue,'Håndbremse');assert.equal(english(dt),'Handbrake');
 dt.childNodes[0].nodeValue='Rein in';assert.equal(english(dt),'Rein in','a text the code has written since');
 assert.equal(english(null),'');
});});

// ---- the dictionary ----
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):/\.js$/.test(e.name)&&e.name!=='i18n-da.js'?[path.join(d,e.name)]:[]);
const raw=[read('index.html'),read('public/cities/index.json'),...walk('src').map(read)].join('\n').replace(/\\'/g,"'").replace(/&amp;/g,'&'),SOURCE=raw+'\n'+raw.replace(/\$\{[^{}]*\}/g,'');
// Keys the code puts together from pieces (game.js: the postcard hint and the "not a postcard yet" banner): checked by their pieces.
const PIECES={'{} is too close: back off a bit':['too close: back off a bit',' is '],'{} is behind you':['behind you',' is '],'{} is to your left':['to your ','left'],'{} is to your right':['to your ','right'],
 'Back up for <1>, then <2>':['Back up',' for <b>',', then <kbd>'],'Turn around for <1>, then <2>':['Turn ','around',' for <b>'],'Turn left for <1>, then <2>':['Turn ','left',' for <b>'],'Turn right for <1>, then <2>':['Turn ','right',' for <b>']};
test('every key is English that the game still shows: nothing orphaned',()=>{
 const gone=[];
 for(const key of Object.keys(da)){const parts=(PIECES[key]||key.split(/\{[nk]?\}|<\d>/).map(p=>p.trim())).filter(Boolean);
  for(const p of parts)if(!SOURCE.includes(p)&&!(p===p.toUpperCase()&&SOURCE.toUpperCase().includes(p)))gone.push(`${key}  [${p}]`);}
 assert.deepEqual(gone,[],'reworded or removed in the English source: update src/i18n-da.js');
});
test('the Danish side: its {1} and <1> match the key, no em dashes, and no Danish text is itself a key for something else',()=>{
 const src=read('src/i18n-da.js'),keys=[...src.matchAll(/(?:^|[,{])\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*:/gm)].map(m=>m[1]);
 assert.equal(new Set(keys).size,keys.length,'a key twice: '+keys.filter((k,i)=>keys.indexOf(k)!==i));assert.equal(keys.length,Object.keys(da).length);
 for(const [k,v] of Object.entries(da)){
  assert.equal(typeof v,'string',k);assert.ok(v.trim(),k);assert.ok(!/[—–]/.test(v)||/[—–]/.test(k)&&!/—/.test(v),`dash in: ${v}`);
  const holes=(k.match(/\{[nk]?\}/g)||[]).length,used=[...v.matchAll(/\{(\d)\}/g)].map(m=>+m[1]);
  assert.ok(used.every(i=>i>=1&&i<=holes)&&(!holes||used.length),`${k} -> ${v}`);
  assert.deepEqual((v.match(/<\d>/g)||[]).sort(),(k.match(/<\d>/g)||[]).sort(),`${k} -> ${v}`);
  assert.equal(/^\s/.test(k),/^\s/.test(v),k);assert.equal(/[.!?…]$/.test(k),/[.!?…]$/.test(v),`full stop: ${k} -> ${v}`);
  if(v in da&&!/\{/.test(v))assert.equal(da[v],v,`"${v}" (for "${k}") is also a key`);
 }
 assert.ok(!/—/.test(Object.values(da).join('')));
});
test('English players load nothing extra: the dictionary is only ever imported on demand',()=>{
 for(const f of walk('src')){const s=read(f);assert.ok(!/import[^;(]*from\s*['"][^'"]*i18n-da\.js['"]/.test(s),f);}
 assert.match(read('src/i18n.js'),/if\(chosen!=='da'\)return chosen;[\s\S]*import\('\.\/i18n-da\.js'\)/);
 assert.match(read('src/bootstrap.js'),/initLanguage\(\);[\s\S]*import\('\.\/main\.js'\)/,'chosen before the game loads');
 assert.match(mainSource,/track\('start',\{lang:currentLang\(\)\}\)/);
});

// ---- the surfaces ----
test('index.html in Danish: the start card, HUD, help, pause and busted cards have no English left',()=>{
 const body=read('index.html').replace(/[\s\S]*<body[^>]*>/,'').replace(/<\/body>[\s\S]*/,''),r=parse(body);
 const before=texts(r);danish(()=>translateTree(r,doc));const after=texts(r),same=new Set(before);
 // names, keys and units, and the texts main.js replaces at once (the street, the coordinates)
 const KEEP=/^(Grand Tour Copenhagen|Daniel Șfița|Lasse|worldhood|(GitHub|worldhood|Discord|OpenStreetMap) ↗|Nyhavn|Menu|Zoom|Hold|KM\/H|1760|1760 \/ horn \/ FPS|Shift|SHIFT|SPACE|ENTER|ESC|W A S D|N ↑|[A-Z]|[^A-Za-z]*|55\.680° N · 12\.576° E)$/;
 const left=after.filter(s=>same.has(s)&&!KEEP.test(s));assert.deepEqual(left,[]);
 const all=after.join(' | ');
 for(const s of ['Ud i byen','Dit startsted i København','Første job: følg den lilla linje hen til lyssøjlen.','Håndbremse','FRI KØRSEL','KM TILBAGELAGT','PARKERET OG KLAR','Find din egen vej.','København kan vente.','Kør videre','Del spillet','ANHOLDT','Start forfra','2,2 km omkring centrum af København.'])assert.ok(all.includes(s),s);
 assert.ok(!/\b(the|your|you|and|with|press|explore)\b/i.test(after.filter(s=>!KEEP.test(s)).join(' ')),'an English word in: '+after.filter(s=>!KEEP.test(s)&&/\b(the|your|you|and|with|press|explore)\b/i.test(s)).join(' | '));
 assert.equal(shown('<span>Enter a nearby car / ride</span><span>Board your coach</span><span>Rein in</span><span>Recover coach</span><span>Drive on / back up</span>').match(/[a-z]+/gi).some(w=>/^(the|your|coach|car)$/i.test(w)),false,'the 1760 help rows');
});
test('first-time prompts in Danish: every line, for keys, touch and a gamepad, today and in 1760',()=>{danish(()=>{
 const seen=new Set();
 for(const id of PROMPT_IDS)for(const device of ['keys','touch','pad'])for(const era of [0,1760])for(const mode of ['car','bike','walk']){
  const en=promptText(id,{device,era,mode}),out=t(en);assert.notEqual(out,en,en);assert.ok(!ENGLISH.test(out.replace(/\bBack\b|D-pad|WASD/g,'')),`${en} -> ${out}`);seen.add(out);}
 assert.ok(seen.has('WASD eller piletasterne for at køre. Følg den lillafarvede linje hen til lyssøjlen: dit første job.'));
 assert.ok(seen.has('RT for at køre kareten, LT for at bremse, venstre pind for at styre. Følg den guldfarvede linje hen til lyssøjlen: dit første job.'));
 assert.ok(seen.has('Kan du ikke køre helt hen til lyssøjlen? Tryk F for at stige ned, og gå.'));assert.ok(seen.has('Kan du ikke køre helt hen til lyssøjlen? Tryk Stå af, og gå.'));
});});
test('jobs, ranks, races, paints, sagas\' titles and steps, postcards and who the characters are: all Danish, both eras',()=>{danish(()=>{
 const need=s=>{const out=t(s);assert.notEqual(out,s,`no Danish for: ${s}`);return out;};
 for(const j of [...JOBS,...JOBS_1760]){need(j.t);const d=need(j.d);assert.ok(!ENGLISH.test(d),`${j.d} -> ${d}`);assert.ok(d.length<j.d.length*1.35+12,`much longer than the English: ${d}`);}
 const quoted=re=>[...game.match(re)[0].matchAll(/\['([^']+)',/g)].map(m=>m[1]);
 const ranks=quoted(/const RANKS=[^;]+;/);assert.equal(ranks.length,14);ranks.forEach(need);
 quoted(/export const PAINTS=[^;]+;/).forEach(need);
 for(const m of game.matchAll(/\{id:'[a-z-]+',title:'([^']+)',via/g))need(m[1]);
 for(const q of SAGAS){need(q.title);for(const s of q.steps)if(s.toast)assert.ok(!ENGLISH.test(need(`${s.toast[0]}. ${s.toast[1]}`)),s.toast.join('. '));}
 for(const c of CHARACTERS)if(c.id!=='bent')need(c.label);need(CHARACTERS.find(c=>c.label1760).label1760);
 const cards=[...game.matchAll(/\['[a-z0-9]+','[^']+',5[\d.]+,1[\d.]+,'([^']+)'\]/g)].map(m=>m[1]);assert.equal(cards.length,25);cards.forEach(c=>assert.ok(!ENGLISH.test(need(c)),c));
});});
test('the game layer\'s banners, cards and share lines in Danish',()=>{
 for(const [html,out] of [
  ['<h2>Picked up</h2><p>Deliver to <b>Marmorkirken</b> in 98 s</p>','Hentet Lever til Marmorkirken inden 98 s'],
  ['<h2>Delivered!</h2><p>+412 kr · fast</p>','Leveret! +412 kr · hurtigt'],
  ['<h2>Job failed</h2><p>Too slow: Cake for the choir. Streak lost.</p>','Job mislykket For langsom: Kage til koret. Stimen er brudt.'],
  ['<h2>Promoted: Bike courier</h2><p>+380 kr · jobs now pay +10% · new: Postbox red paint · next: Cargo rider at 5 deliveries</p>','Forfremmet: Cykelbud +380 kr · job giver nu +10 % · nyt: Postkasserød lak · næste: Ladcyklist ved 5 leveringer'],
  ['<h2>Saga started</h2><p>The King\'s Eye · follow the red beam</p>','Saga startet Kongens øje · følg den røde lyssøjle'],
  ['<h2>Saga failed</h2><p>Fire Watch · talk to Vægteren to try again</p>','Saga mislykket Brandvagt · tal med Vægteren for at prøve igen'],
  ['<h2>Nisse found!</h2><p>3 of 22 · +150 kr</p>','Nisse fundet! 3 af 22 · +150 kr'],
  ['<h2>Too slow</h2><p>Lakes Loop · 4:10.2 · bronze is 3:30.0</p>','For langsom Søerne rundt · 4:10.2 · bronze er 3:30.0'],
  ['<h2>Nice photo</h2><p>Not a postcard yet · Rådhuset is behind you</p>','Fint billede Ikke et postkort endnu · Rådhuset er bag dig'],
  ['<p class="cph-kick">Job 3/20</p><h3>Tivoli tickets</h3><p class="cph-go">Pick up at <b>Tivoli main gate</b> · 1.4 km</p>','Job 3/20 Tivolibilletter Afhentning: Tivolis hovedindgang · 1,4 km'],
  ['<div><b>1,500 kr</b> · nisser 3/22<span class="cph-rank">Newcomer · streak ×2<i></i></span><span class="cph-next">Next: Bike courier in 2 deliveries · Postbox red paint</span></div>','1.500 kr · nisser 3/22 Tilflytter · stime ×2 Næste: Cykelbud om 2 leveringer · Postkasserød lak'],
  ['<p class="cph-kick">Saga · <kbd>J</kbd> journal · <kbd>K</kbd> map</p><li class="c">The first X <span>lukewarm</span></li>','Saga · J journal · K kort Det første kryds lunken'],
  ['<button id="cph-lore-go">Continue <kbd>Enter</kbd></button><button>Share <kbd>O</kbd></button><button id="cph-jclose">Close <kbd>J</kbd></button>','Fortsæt Enter Del O Luk J'],
  ['<p class="cph-jrank"><b>Newcomer</b> · 1 delivery · Next: Bike courier in 1 delivery</p><p class="cph-js">In progress · 2/4</p><p class="cph-js">Ask Karen</p>','Tilflytter · 1 levering · Næste: Cykelbud om 1 levering I gang · 2/4 Spørg Karen'],
 ])assert.equal(shown(html),out);
 danish(()=>{
  assert.equal(t(GAME_LINE),'Grand Tour Copenhagen: kør, cykl og gå i det rigtige København, i dag og i 1760.');assert.equal(t(shareSaid('copied')),'Link kopieret.');
  assert.equal(t('Harbour Sprint in 1:23.4 (gold) in Grand Tour Copenhagen. Can you beat it?'),'Havnespurten på 1:23.4 (guld) i Grand Tour Copenhagen. Kan du slå den?');
  assert.equal(t('I finished the saga “Fire Watch” in Grand Tour Copenhagen, 1760.'),'Jeg har gennemført sagaen “Brandvagt” i Grand Tour Copenhagen, 1760.');
  assert.equal(t('Promoted to Cargo rider after 5 deliveries in Grand Tour Copenhagen.'),'Forfremmet til Ladcyklist efter 5 leveringer i Grand Tour Copenhagen.');});
});
