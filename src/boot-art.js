// Title art on the loading screen (Daniel's generated GTA-style illustrations, public/art/). Full screen behind
// the welcome card while the city loads, slow crossfade between pictures. It steps aside once the player
// flips through starting points (the 3D preview of the picked place shows instead) and is gone in play.
import './boot-art.css';
const SETS={today:['title-1','title-2','title-3','title-4','title-logo'],1760:['period-1','period-2','period-3','period-4','title-4']};
const PORTRAIT_ONLY=new Set(['title-logo']); // drawn only for upright phones (title-logo-portrait.webp)
export function installBootArt(doc=document){
 if(typeof window==='undefined')return;
 const q=new URLSearchParams(location.search),city=q.get('city')||'';let era=/1760/.test(city)?'1760':'today';
 try{const j=JSON.parse(sessionStorage.getItem('era-jump')||'null');if(j?.to)era=/1760/.test(j.to)?'1760':'today';}catch{}
 const upright=innerHeight>innerWidth*1.15,list=SETS[era].filter(id=>upright||!PORTRAIT_ONLY.has(id)),root=doc.createElement('div');root.id='boot-art';root.dataset.era=era;root.setAttribute('aria-hidden','true');
 const layers=[0,1].map(()=>{const d=doc.createElement('div');d.className='boot-art-layer';root.append(d);return d;});
 doc.querySelector('#app')?.prepend(root);
 let i=Math.floor(Math.random()*list.length),front=0,first=true;const tall=()=>innerHeight>innerWidth*1.15; // an upright phone: a <name>-portrait.webp drawn for it is used when there is one, else the 16:9 picture is fitted (boot-art.css)
 const wide=list.filter(id=>!PORTRAIT_ONLY.has(id)); // a phone turned on its side while loading: the upright-only picture has no 16:9 file (it asked for a missing title-logo.webp and that slot stayed blank)
 const show=n=>{const up=tall(),pool=up?list:wide,id=pool[n%pool.length],img=new Image();let src=up?`/art/${id}-portrait.webp`:`/art/${id}.webp`;img.onerror=()=>{if(/-portrait/.test(src)){src=`/art/${id}.webp`;img.src=src;}};img.onload=()=>{const back=layers[1-front];back.style.backgroundImage=`url(${src})`;back.style.setProperty('--art',`url(${src})`);back.dataset.fit=/-portrait/.test(src)?'portrait':'wide';if(first){back.style.transition='none';first=false;requestAnimationFrame(()=>requestAnimationFrame(()=>back.style.transition=''));} /* the first picture is there at once (a busy start-up thread used to hold its fade) */back.classList.add('on');layers[front].classList.remove('on');front=1-front;};img.src=src;};
 show(i);const timer=setInterval(()=>{if(!doc.body.classList.contains('booting')){clearInterval(timer);return;}if(list.length>1)show(++i);},6500);
 for(const id of ['start-prev','start-next'])doc.getElementById(id)?.addEventListener('click',()=>root.classList.add('aside'));
}
