// Wall and roof colours for landmark buildings whose city-model colour is plainly wrong (sRGB 0-1, like the
// index). Checked against how the buildings look: Copenhagen City Hall, the Glyptotek and the Central
// Station are red brick, the Black Diamond is black granite and glass, Thorvaldsens Museum is ochre,
// the Royal Hotel a grey-green glass slab.
export const BUILDING_COLOURS={
 'kk-osm-relation-52142':{color:[.6,.27,.2],roofColor:[.36,.56,.47]},     // Københavns Rådhus
 'kk-osm-relation-1322262':{color:[.57,.27,.2],roofColor:[.36,.56,.47]},  // Ny Carlsberg Glyptotek
 'kk-osm-way-91260821':{color:[.58,.29,.21],roofColor:[.36,.38,.4]},      // Københavns Hovedbanegård
 'kk-osm-relation-12705750':{color:[.93,.9,.83]},                         // Magasin du Nord
 'kk-osm-relation-19856927':{color:[.13,.14,.15],roofColor:[.18,.19,.2]}, // Den Sorte Diamant
 'kk-osm-relation-2351676':{color:[.85,.66,.33]},                         // Thorvaldsens Museum
 'kk-osm-way-229215455':{color:[.43,.5,.5],roofColor:[.3,.32,.33]},     // Radisson Collection Royal Hotel (grey-green glass)
};
// Applies the overrides to a building index (tiles → parts) in place; returns how many parts changed.
export function applyBuildingColours(index,colours=BUILDING_COLOURS){
 let n=0;for(const t of index?.tiles||[])for(const p of t.parts){const o=colours[p.id];if(o){Object.assign(p,o);n++;}}
 return n;
}
