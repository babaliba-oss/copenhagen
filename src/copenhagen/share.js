// Sharing: one plain line and a link to gtcopenhagen.com. No pictures.
export const SITE='https://gtcopenhagen.com/';
export const GAME_LINE='Grand Tour Copenhagen: drive, cycle and walk the real city, today and in 1760.';

// The link opens the right map (1760: ?city=) at a race's start (?race=) or a named start (?start=).
export function shareUrl({historic=false,race=null,start=null}={}){
 const u=new URL(SITE);if(historic)u.searchParams.set('city','copenhagen-1760');
 if(race)u.searchParams.set('race',race);else if(start)u.searchParams.set('start',start);
 return u.href;
}

// The share sheet where there is one, else the line and the link on the clipboard.
// Returns 'shared', 'copied', 'cancelled' (the sheet was closed) or 'failed'.
export async function shareOut({text,url},nav=globalThis.navigator,doc=globalThis.document){
 if(nav?.share){try{await nav.share({title:'Grand Tour Copenhagen',text,url});return 'shared';}catch(e){if(e?.name==='AbortError')return 'cancelled';}}
 const line=`${text} ${url}`;
 try{await nav.clipboard.writeText(line);return 'copied';}catch{}
 try{const t=doc.createElement('textarea');t.value=line;t.setAttribute('readonly','');t.style.cssText='position:fixed;opacity:0';doc.body.append(t);t.select();const ok=doc.execCommand('copy');t.remove();if(ok)return 'copied';}catch{} // no clipboard API (http, an old browser)
 return 'failed';
}
export const shareSaid=(how,url)=>how==='copied'?'Link copied.':how==='failed'?`Could not copy. The link: ${url}`:'';
