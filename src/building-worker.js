import * as THREE from 'three';
import {createModelledBuilding} from './building-detail.js';

// Facade interpretation and mesh construction used to block keyboard/camera
// updates as each new tile arrived. Do that work off the browser's main thread.

// Atlas pixels are sampled for wall colours and window evidence. Decoding here (from the encoded
// bytes) spares the main thread a synchronous canvas draw and readback per texture.
async function decodePixels(image){
 if(!(image instanceof ArrayBuffer))return image;
 const bitmap=await createImageBitmap(new Blob([image]),{premultiplyAlpha:'none',colorSpaceConversion:'none'});
 const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0);bitmap.close();
 const {data}=ctx.getImageData(0,0,canvas.width,canvas.height);return {data,width:canvas.width,height:canvas.height};
}

async function handle({id,array,parts,pixels}){
 try{
  const images={};for(const [file,image] of Object.entries(pixels||{}))images[file]=await decodePixels(image);
  const buildings=[],transfer=new Set(),heroes=new Set();
  for(const part of parts){
   const texture=part.texture?new THREE.Texture():null;
   const detail=createModelledBuilding(array,part,images[part.texture],texture,!heroes.has(part.ratu));heroes.add(part.ratu);
   const meshes=detail.meshes.map(m=>{
    const attributes={};for(const [name,a] of Object.entries(m.geometry.attributes)){attributes[name]={array:a.array,itemSize:a.itemSize,normalized:a.normalized};transfer.add(a.array.buffer);}
    const index=m.geometry.index?.array;if(index)transfer.add(index.buffer);
    const mat=m.material;
    return {attributes,index,shell:!!m.userData.shell,role:m.userData.role,provisional:!!m.userData.provisional,material:{color:mat.color.getHex(),roughness:mat.roughness,metalness:mat.metalness,side:mat.side,vertexColors:mat.vertexColors,textured:!!mat.map,signs:!!mat.userData?.signs}};
   });
   buildings.push({part,meshes,windows:detail.windows});texture?.dispose();detail.meshes.forEach(m=>{m.geometry.dispose();m.material.dispose();});
  }
  self.postMessage({id,buildings},[...transfer]);
 }catch(error){self.postMessage({id,error:String(error.stack||error)});}
}
// Tiles are processed strictly in arrival order; the main thread already sends nearest-first.
let chain=Promise.resolve();
self.onmessage=({data})=>{chain=chain.then(()=>handle(data));};
