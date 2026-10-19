// Hot-dog stands (pølsevogne) in today's Copenhagen: two on Rådhuspladsen, Kongens Nytorv, Amagertorv on Strøget and by
// Torvehallerne. Each spot is open pavement (city.pack pavement, 2.6 m clear of roads, buildings and water, clear of the
// mapped furniture, trees and café tables), the counter turned to the square: [x, z, yaw]. Drawn and solid as mapped
// furniture (mapped-furniture.js, kind 'hotdog-stand'); model: Daniel's giant hot-dog stand (CC BY Ariel Stull).
export const HOTDOG_STANDS=[[-384.3,452,.34],[-417.8,463.4,-.79],[581.9,56.4,-.63],[96.4,144.8,-.22],[-397,-378.7,-.87]];
export const hotdogItems=()=>HOTDOG_STANDS.map(([x,z,yaw])=>({k:'hotdog-stand',x,z,yaw,src:'placed'}));
