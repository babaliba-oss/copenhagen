// GTA-style car radio for today's Copenhagen. Stations stream royalty-free recordings (public domain, CC0 or
// CC BY, listed with their sources in public/radio-stations.json) straight from the public library that hosts
// them, in a plain <audio> element. Each station runs like a broadcast: its playlist loops on a clock that keeps
// going while you are out of the car, so getting back in finds it mid-song. L tunes to the next station (Shift+L
// back), "Radio off" is one of the stops; it plays only while you drive with the sound on. A station that cannot
// be reached (offline, a moved file) skips the track, and after a few misses shows "no signal" for a while.
// Getting in announces the station and what is on air (main.js shows it on the "now playing" card).
export const RADIO_OFF=0;

// The station you last chose comes back on your next drive (0: you switched the radio off); the very first drive
// tunes to station 1, GTA style. Storage can be missing or throw (private mode, blocked site data): that only
// forgets the choice.
export const RADIO_KEY='gtc.radio';
export function storedStation(storage){
 try{const v=(storage??globalThis.localStorage)?.getItem(RADIO_KEY);if(v!=null&&/^\d+$/.test(v))return +v;}catch{}
 return 1;
}
export function storeStation(station,storage){try{(storage??globalThis.localStorage)?.setItem(RADIO_KEY,String(station));}catch{}}

// Where in its playlist a station is at time t (seconds): the track and the offset into it. Tracks without a known
// length count as 4 minutes on the clock (they then simply play from the start).
export function stationPosition(station,t){
 const tracks=station.tracks||[];if(!tracks.length)return null;
 const len=tr=>tr.seconds>20?tr.seconds:240,total=tracks.reduce((s,tr)=>s+len(tr),0);
 let p=((t+(station.offset||0))%total+total)%total;
 for(let i=0;i<tracks.length;i++){const l=len(tracks[i]);if(p<l)return {index:i,offset:tracks[i].seconds>20?p:0};p-=l;}
 return {index:0,offset:0};
}

// initial: the station to start on (0 = Radio off), clamped to the stations there are; nothing plays until you drive.
export function createRadio({stations=[],banner=null,initial=RADIO_OFF,clock=()=>performance.now()/1000,audio=null,random=Math.random}={}){
 const list=stations.filter(s=>s.tracks?.length).map(s=>({...s,offset:random()*3600}));
 const player=audio||(typeof Audio!=='undefined'?new Audio():null);
 if(player){player.preload='auto';player.volume=0;}
 let loadAt=0,sounded=false,station=Math.max(0,Math.min(list.length,initial|0)),active=false,track=null,failures=0,silentUntil=0,volume=0,target=0,pendingSeek=0,tuned=null;
 const current=()=>station>0?list[station-1]:null;
 function show(text,sub=''){banner?.(text,sub);}
 function load(index,offset){
  const s=current();if(!s||!player)return;
  track={station:s,index};pendingSeek=offset>3?offset:0;tuned=s;loadAt=clock();sounded=false;
  player.src=s.tracks[index].url;player.load?.();
  const p=player.play?.();if(p?.catch)p.catch(()=>{}); // a refused play (no gesture yet) retries on the next update
 }
 // Always followed by announce(), which also says "No signal" while the station cannot be reached.
 function tune(){const s=current();if(!s){track=null;tuned=null;player?.pause?.();return;}
  if(clock()<silentUntil)return;
  const pos=stationPosition(s,clock());if(pos)load(pos.index,pos.offset);}
 const credit=tr=>`${tr.title}${tr.artist?' · '+tr.artist:''}${tr.licence&&!/public domain/i.test(tr.licence)?` (${tr.licence})`:''}`; // CC BY needs the credit on screen
 function nextTrack(){if(!track)return;const s=track.station,i=(track.index+1)%s.tracks.length;load(i,0);if(active)show(s.name,credit(s.tracks[i]));}
 if(player){
  player.addEventListener?.('loadedmetadata',()=>{if(pendingSeek&&Number.isFinite(player.duration)&&pendingSeek<player.duration-8){try{player.currentTime=pendingSeek;}catch{}}pendingSeek=0;});
  player.addEventListener?.('playing',()=>{failures=0;sounded=true;});
  player.addEventListener?.('ended',()=>nextTrack());
  player.addEventListener?.('error',()=>fail());
 }
 function fail(){{if(!track)return;failures++;
   if(failures>=3){silentUntil=clock()+45;failures=0;show(track.station.name,'No signal');track=null;player.pause?.();return;}
   setTimeout(()=>{if(track&&active)nextTrack();},800);}}
 // The station and what is on: the track loaded (it moves on after a failed one), else where the broadcast is.
 function announce(){const s=current();if(!s){show('Radio off');return;}
  if(clock()<silentUntil){show(s.name,'No signal');return;}
  const tr=track?.station===s?s.tracks[track.index]:s.tracks[stationPosition(s,clock())?.index];show(s.name,tr?credit(tr):s.genre||'');}
 return {
  get station(){return station;},
  get stations(){return list;},
  get playing(){return !!(active&&track&&player&&(sounded||!player.paused&&player.readyState>=3));}, // the track has sounded: until a station answers the game's own music plays instead (a buffering pause mid-song does not swap it back)
  // the track now on air (for the now-playing card and the credits line)
  nowPlaying(){return track?track.station.tracks[track.index]:null;},
  next(step=1){if(!list.length){show('No stations');return;}station=((station+step)%(list.length+1)+list.length+1)%(list.length+1);if(active)tune();announce();return station;},
  set(i){station=Math.max(0,Math.min(list.length,i|0));if(active)tune();announce();},
  // every frame: on (driving, sound on) or off; fades the volume and keeps the station tuned. Coming on announces
  // the station, so the card comes up with it (and with "Radio off" when that is the choice).
  update(dt,{on=false,level=.55}={}){
   if(on!==active){active=on;if(active){tune();announce();}else{track=null;tuned=null;}}
   else if(active&&!track&&station>0&&silentUntil&&clock()>=silentUntil){silentUntil=0;tune();announce();} // after a 'no signal' spell, try the station again
   target=active&&track?level:0;volume+=(target-volume)*Math.min(1,dt*3);
   if(player){player.volume=Math.max(0,Math.min(1,volume));if(!active&&volume<.01&&!player.paused)player.pause?.();
    if(active&&track&&player.paused&&player.readyState>=2){const p=player.play?.();if(p?.catch)p.catch(()=>{});}
    if(active&&track&&player.readyState>=3)loadAt=clock(); /* loadAt: the last moment the track had data */
    if(active&&track&&player.readyState<3&&clock()-loadAt>(sounded?30:20)){loadAt=clock();fail();}} // a host that never answers counts as a failure, not silence; it counts from the last data, not the load (a short buffer 12 s into a song skipped it, and three skips meant 45 s of 'No signal')
  },
  dispose(){player?.pause?.();if(player)player.src='';}
 };
}
