import {dataUrl} from './cities.js';
import {expandBusCorridors} from './wire-pack.js';
import {BusSimulation} from './bus-simulation.js';
import {createBusRenderer} from './bus-renderer.js';
import {createBusTerminal} from './bus-terminal.js';

export async function createBusSystem(scene,world,player){
 const response=await fetch(dataUrl('bus-corridors.json'));if(!response.ok)throw new Error(`Bus corridor load failed: ${response.status}`);const data=expandBusCorridors(await response.json());
 const simulation=new BusSimulation(data,world);simulation.reset(player);const renderer=createBusRenderer(simulation);scene.add(renderer.group);renderer.update(player);
 const terminal=createBusTerminal(data.stationStops||[],world);scene.add(terminal);
 return {simulation,renderer,terminal,reset(player,traffic){simulation.reset(player,traffic);renderer.update(player);},step(dt,player,traffic=[]){simulation.step(dt,player,traffic);renderer.update(player);},get obstacles(){return simulation.obstacles;},get bodies(){return simulation.bodies;},snapshot(){return simulation.snapshot();}};
}
