import test from 'node:test';
import assert from 'node:assert/strict';
import {markDuplicateParts} from '../src/building-dedupe.js';

test('a building carried twice keeps only its taller (or more detailed) copy', () => {
 const index={tiles:[{parts:[
  {id:'kk-osm-way-1',bbox:[0,0,20,30],height:21,count:900},
  {id:'kk-10-15',bbox:[.3,.2,20,29.8],height:19,count:30},          // the bare block copy: dropped
  {id:'kk-osm-way-2',bbox:[40,0,60,30],height:12,count:60},
  {id:'kk-50-15',bbox:[40,0,60,30],height:12.1,count:400},          // equal height: fewer vertices goes
  {id:'neighbour',bbox:[20,0,40,30],height:15,count:100},           // touching, not overlapping: kept
  {id:'kk-osm-way-3',bbox:[100,0,163,63],height:19.7,count:528},
  {id:'kk-110-30',bbox:[107,0,151,56],height:16,count:27},          // crude leftover inside it: dropped
  {id:'shed',bbox:[120,20,130,30],height:3,count:30},              // small courtyard house: kept
 ]}]};
 const marked=markDuplicateParts(index).map(p=>p.id).sort();
 assert.deepEqual(marked,['kk-10-15','kk-110-30','kk-osm-way-2']);
 assert.equal(index.tiles[0].parts.find(p=>p.id==='neighbour').duplicate,undefined);
});
