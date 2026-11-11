// Danish language option for the Copenhagen game. English is the source text and the fallback: the code and index.html
// stay English, and with Danish chosen the page's text is translated where it is shown, by looking the English up in
// one dictionary (src/i18n-da.js, loaded only then). A string with no entry stays English. docs/COPENHAGEN.md (Language).
//   key 'Car recovered.'                 a whole text, exactly as the code writes it
//   key 'Deliver to <1> in {n} s'        <1>, <2>: the elements inside a sentence (<b>, <kbd>), kept and put where the Danish has them
//   key 'Ask {}', '{n} cans', 'Press {k}'  {}: anything (looked up in turn), {n}: a number, {k}: a key's name; the Danish side names them {1}, {2}
// Parts joined with ' · ' are looked up one by one, and so is a text with elements before or after it ('<1> City map <2>').
export const LANGS=['en','da'],LANG_KEY='cph-lang';
// ?lang=da|en, else the saved choice, else a Danish browser, else English.
export function pickLang({search='',stored=null,nav=''}={}){
 const q=new URLSearchParams(search).get('lang');if(LANGS.includes(q))return q;
 if(LANGS.includes(stored))return stored;
 return /^da\b/i.test(nav||'')?'da':'en';
}
// Copenhagen only (today and 1760; no ?city= is Copenhagen): Helsinki keeps its English page.
export const forCity=(search='')=>/^copenhagen/i.test(new URLSearchParams(search).get('city')||'copenhagen');

let lang='en',exact=null,templates=[],cache=new Map();
export const currentLang=()=>lang;
const danishNumber=s=>s.includes(':')?s:s.replace(/[.,]/g,c=>c==='.'?',':'.'); // 1,500 kr -> 1.500 kr, 1.2 km -> 1,2 km; a time (1:23.4) stays as the clock on the card shows it
export function useDictionary(dict,code='da'){
 lang=dict?code:'en';cache=new Map();exact=dict?new Map(Object.entries(dict)):null;templates=[];
 for(const [k,v] of Object.entries(dict||{})){if(!/\{[nk]?\}/.test(k))continue;const kinds=[];
  const re=new RegExp('^'+k.replace(/[.*+?^$()|[\]\\]/g,'\\$&').replace(/\{([nk]?)\}/g,(m,n)=>{kinds.push(n);return n==='n'?'(\\d[\\d.,:]*)':n?'([A-Z][\\w-]*(?: [←↑↓→])?)':'(.+?)';})+'$');
  templates.push([re,v,kinds]);}
}
function lookup(s){
 const hit=exact.get(s);if(hit!==undefined)return hit;
 const edge=/^((?:<\d>|·|\s)*)(.*?)((?:<\d>|·|\s)*)$/.exec(s); /* '<1> City map <2>', '<1> · 3 deliveries' */if(edge&&(edge[1]||edge[3])&&edge[2]){const o=translate(edge[2]);if(o!==edge[2])return edge[1]+o+edge[3];}
 if(s.includes(' · ')){const parts=s.split(' · '),out=parts.map(translate);if(out.some((p,i)=>p!==parts[i]))return out.join(' · ');}
 for(const [re,v,kinds] of templates){const m=re.exec(s);if(m)return v.replace(/\{(\d)\}/g,(x,i)=>kinds[i-1]==='n'?danishNumber(m[i]):translate(m[i]));}
 return s;
}
const missed=new Set(),said=new Set(); // missed: English that had no entry (?lang=da in the console: __i18nMissed())
function translate(s){
 if(!exact||!/[A-Za-z]{2}/.test(s))return s;
 let out=cache.get(s);if(out===undefined){out=lookup(s);if(cache.size>4000)cache.clear();cache.set(s,out);if(out===s){if(missed.size<2000)missed.add(s);}else if(said.size<4000)said.add(out);}
 return out;
}
// t('English text'): the Danish for it, or the text itself. Spaces around it are kept; runs of spaces inside count as one.
export function t(text){
 if(!exact||typeof text!=='string')return text;
 const m=/^(\s*)([\s\S]*?)(\s*)$/.exec(text),s=m[2].replace(/\s+/g,' ');if(!s)return text;
 const out=translate(s);return out===s?text:m[1]+out+m[3];
}

// ---- the page: every text node, sentence with markup in it and label under root, as it stands ----
const ATTRS=['title'], /* not aria-label: the code reads some of those back (the sound button's, the minimap's) */SKIP=/^(SCRIPT|STYLE|CANVAS|SVG|TEXTAREA)$/i,WORDS=/[A-Za-z]{2}/;
const wrote=new WeakMap(),source=new WeakMap(); // node -> the Danish written there (not looked up again), and the English it stood for
function textNode(n){const v=n.nodeValue;if(wrote.get(n)===v||!WORDS.test(v))return;const o=t(v);if(o!==v){wrote.set(n,o);source.set(n,v);n.nodeValue=o;}}
// The text as the code wrote it, for the few places that read the page back (main.js: the 1760 help rows, the phone's card tabs). English: textContent.
export function english(node){
 if(!node)return '';
 if(node.nodeType===3)return wrote.get(node)===node.nodeValue?source.get(node)??node.nodeValue:node.nodeValue;
 if(node.nodeType!==1)return '';
 const r=source.get(node),kids=node.childNodes;
 if(r&&r.now.length===kids.length&&r.now.every((n,i)=>n===kids[i]))return r.s.replace(/<(\d)>/g,(m,i)=>english(r.els[i-1]));
 let out='';for(const k of kids)out+=english(k);return out;
}
export function translateTree(node,doc=globalThis.document,deep=true){
 if(!exact||!node)return;
 if(node.nodeType===3)return textNode(node);
 if(node.nodeType!==1||SKIP.test(node.tagName))return;
 for(const a of ATTRS){const v=node.getAttribute(a);if(v){const o=t(v);if(o!==v)node.setAttribute(a,o);}}
 const kids=[...node.childNodes],els=kids.filter(k=>k.nodeType===1);
 if(els.length&&els.length<10&&kids.some(k=>k.nodeType===3&&WORDS.test(k.nodeValue))){ // a sentence with elements in it: 'Hold <1> to drive.'
  const s=kids.map(k=>k.nodeType===3?k.nodeValue:k.nodeType===1?`<${els.indexOf(k)+1}>`:'').join('').replace(/\s+/g,' ').trim();
  if(wrote.get(node)!==s){const o=translate(s),parts=o.split(/(<\d>)/).filter(Boolean),used=parts.filter(p=>/^<\d>$/.test(p)).map(p=>+p[1]);
   if(o!==s&&used.length===els.length&&els.every((e,i)=>used.includes(i+1))){const now=parts.map(p=>/^<\d>$/.test(p)?els[p[1]-1]:(said.size<4000&&said.add(p.trim()),doc.createTextNode(p)));for(const n of now)if(n.nodeType===3)wrote.set(n,n.nodeValue); /* Danish now: not looked up again (1,4 km would turn back into 1.4 km) */wrote.set(node,o);source.set(node,{s,els,now});node.replaceChildren(...now);}}
 }
 if(deep)for(const k of [...node.childNodes])translateTree(k,doc);
}
function watch(doc){
 translateTree(doc.body,doc);
 new MutationObserver(list=>{for(const r of list){
  if(r.type==='characterData')textNode(r.target);
  else if(r.type==='attributes'){const v=r.target.getAttribute(r.attributeName);if(v){const o=t(v);if(o!==v)r.target.setAttribute(r.attributeName,o);}}
  else{translateTree(r.target,doc,false);for(const n of r.addedNodes)if(n.isConnected)translateTree(n,doc);}
 }}).observe(doc.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRS});
}
// The EN / DA switch on the start card and the pause card: the choice is saved and the page loads again in it.
function addToggle(doc,win,active){
 for(const id of ['intro','pause-overlay']){const host=doc.getElementById(id);if(!host)continue;
  const box=doc.createElement('div');box.className='lang-toggle';box.setAttribute('role','group');box.setAttribute('aria-label','Language');
  box.innerHTML=LANGS.map(l=>`<button type="button" data-lang="${l}" lang="${l}" aria-pressed="${l===active}" title="${l==='da'?'Dansk':'English'}">${l.toUpperCase()}</button>`).join('');
  box.addEventListener('click',e=>{const l=e.target?.dataset?.lang;if(!l||l===active)return;try{win.localStorage.setItem(LANG_KEY,l);}catch{}
   const u=new URL(win.location.href);if(u.searchParams.has('lang'))u.searchParams.set('lang',l);win.location.replace(u.href);});
  host.insertBefore(box,host.querySelector('.pause-contact'));}
}
// Called once by bootstrap.js. English: nothing is loaded and nothing watches the page.
export function initLanguage(doc=globalThis.document,win=globalThis.window){
 if(!doc||!win||!forCity(win.location.search))return 'en';
 let stored=null;try{stored=win.localStorage.getItem(LANG_KEY);}catch{}
 const chosen=pickLang({search:win.location.search,stored,nav:win.navigator?.language});
 addToggle(doc,win,chosen);if(chosen!=='da')return chosen;
 doc.documentElement.lang='da';lang='da'; /* known at once (the start event); the words follow */
 import('./i18n-da.js').then(m=>{useDictionary(m.default,'da');win.__i18nMissed=()=>[...missed].filter(s=>!said.has(s));watch(doc);}).catch(()=>{lang='en';doc.documentElement.lang='en';}); // no dictionary (offline, a failed deploy): English
 return chosen;
}
