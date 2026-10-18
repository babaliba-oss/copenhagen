import {displayedSpeedKmh} from './physics.js';

export const dialAngle=speed=>-120+Math.max(0,Math.min(120,speed))*2;
export const smoothSpeed=(current,target,dt)=>current+(target-current)*(1-Math.exp(-Math.max(0,dt)*10));

export function createSpeedometer(doc=document){
 const el=id=>doc.getElementById(id),needle=el('speed-needle'),arc=el('speed-arc'),ticks=el('speed-ticks');
 const svgTag=(tag,attrs)=>{const n=doc.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs))n.setAttribute(key,value);return n;};
 const point=(angle,r)=>{const a=angle*Math.PI/180;return [120+Math.sin(a)*r,114-Math.cos(a)*r];};
 for(let speed=0;speed<=120;speed+=5){const angle=dialAngle(speed),major=speed%20===0,[x1,y1]=point(angle,85),[x2,y2]=point(angle,major?75:81);
  ticks.append(svgTag('line',{x1,y1,x2,y2,class:major?'major':'minor'}));
  if(major){const [x,y]=point(angle,65),label=svgTag('text',{x,y,'text-anchor':'middle','dominant-baseline':'middle'});label.textContent=speed;ticks.append(label);}
 }
 const motion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');let shown=0;
 return {update(car,dt,{mode='car'}={}){
  const target=mode==='car'?displayedSpeedKmh(car.speed):Math.abs(car.speed)*3.6;shown=motion?.matches?target:smoothSpeed(shown,target,dt);
  if(Math.abs(shown-target)<.05)shown=target;
  el('speed').textContent=String(Math.round(shown));needle.setAttribute('transform',`rotate(${dialAngle(shown)} 120 114)`);
  arc.setAttribute('stroke-dasharray',`${Math.min(100,shown/120*100)} 100`);
  el('drive-gear').textContent=mode==='car'?(car.speed<-.2?'R':Math.abs(car.speed)>.2?'D':'P'):mode==='walk'?'W':mode==='bike'?'B':'S';
 }};
}
