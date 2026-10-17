// Title art on the loading screen (Daniel's generated GTA-style illustrations, public/art/). Full screen behind
// the welcome card while the city loads, slow crossfade between pictures. It steps aside once the player
// flips through starting points (the 3D preview of the picked place shows instead) and is gone in play.
import './boot-art.css';
const SETS={today:['title-1','title-2','title-3','title-4'],1760:['period-1','period-2','period-3','period-4','title-4']};
export function installBootArt(doc=document){
 if(typeof window==='undefined')return;
 const q=new URLSearchParams(location.search),city=q.get('city')||'';let era=/1760/.test(city)?'1760':'today';
 try{const j=JSON.parse(sessionStorage.getItem('era-jump')||'null');if(j?.to)era=/1760/.test(j.to)?'1760':'today';}catch{}
 const list=SETS[era],root=doc.createElement('div');root.id='boot-art';root.dataset.era=era;root.setAttribute('aria-hidden','true');
 const layers=[0,1].map(()=>{const d=doc.createElement('div');d.className='boot-art-layer';root.append(d);return d;});
 doc.querySelector('#app')?.prepend(root);
 let i=Math.floor(Math.random()*list.length),front=0,first=true;const show=n=>{const id=list[n%list.length],img=new Image();img.onload=()=>{const back=layers[1-front];back.style.backgroundImage=`url(/art/${id}.webp)`;if(first){back.style.transition='none';first=false;requestAnimationFrame(()=>requestAnimationFrame(()=>back.style.transition=''));} /* the first picture is there at once (a busy start-up thread used to hold its fade) */back.classList.add('on');layers[front].classList.remove('on');front=1-front;};img.src=`/art/${id}.webp`;};
 show(i);const timer=setInterval(()=>{if(!doc.body.classList.contains('booting')){clearInterval(timer);return;}if(list.length>1)show(++i);},6500);
 for(const id of ['start-prev','start-next'])doc.getElementById(id)?.addEventListener('click',()=>root.classList.add('aside'));
}
