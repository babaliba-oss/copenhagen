import test from 'node:test';
import assert from 'node:assert/strict';
// The EZ-Tree library requests its bark and leaf images when imported; give it an inert document in Node.
globalThis.document??={createElementNS:()=>({style:{},addEventListener(){},removeEventListener(){}})};
const {FAMILIES,FAMILY,treeTemplate,treeInstance,crownProfile,createSpeciesTrees,treeLevel}=await import('../src/tree-species.js');

test('every species family builds finite templates within the triangle budget per level', () => {
 const budget={near:2400,mid:450,far:200};
 for(const f of FAMILIES)for(const level of ['near','mid','far']){
  const g=treeTemplate(f,level,1),p=g.attributes.position;
  assert.ok(p.count/3<=budget[level],`${f} ${level}: ${p.count/3} triangles`);
  for(let i=0;i<p.array.length;i++)assert.ok(Number.isFinite(p.array[i]));
  g.computeBoundingBox();const b=g.boundingBox;
  assert.ok(b.min.y>=-.01&&b.max.y<=1.25,`${f} ${level} height ${b.max.y}`);
  // Crowns keep their width from level to level, so swapping levels does not pop.
  const near=treeTemplate(f,'near',1);near.computeBoundingBox();const nw=near.boundingBox.max.x-near.boundingBox.min.x;
  assert.ok(nw<=FAMILY[f].width*1.45+.12,`${f} near crown width ${nw}`);assert.ok(b.max.x-b.min.x<=nw*1.3+.06,`${f} ${level} crown width`);
  assert.ok(g.attributes.color,'vertex colours');
 }
});
test('silhouettes differ by family: spruce narrow to the ground, maple broad, columnar thin', () => {
 const w=f=>{const g=treeTemplate(f,'near',1);g.computeBoundingBox();return g.boundingBox.max.x-g.boundingBox.min.x;};
 assert.ok(w('maple')>w('lime')&&w('lime')>w('columnar'));
 assert.ok(FAMILY.spruce.base<.1&&FAMILY.pine.base>.5);
 assert.ok(crownProfile('vase',.9)>crownProfile('vase',.1),'vase crowns widen upwards');
});
test('register trees get their family, height and a young-tree form', () => {
 const lime=treeInstance({p:[0,0],species:'TILIA X VULGARIS (PUISTOLEHMUS)',height:16});
 assert.equal(lime.family,'lime');assert.ok(lime.height>15&&lime.height<17.5);
 const young=treeInstance({p:[0,0],species:'TILIA X VULGARIS (PUISTOLEHMUS)',height:5});
 assert.ok(young.width/young.height<lime.width/lime.height,'young street limes are slimmer');
 assert.equal(treeInstance({p:[1,2],family:'spruce',height:12}).family,'spruce');
});
test('one batched mesh per level; trees shown by distance', () => {
 const trees=[{p:[0,0],species:'ACER PLATANOIDES',height:14},{p:[300,0],species:'PICEA ABIES',height:18,conifer:true},{p:[700,0],species:'BETULA PENDULA',height:15},{p:[2000,0],species:'TILIA',height:10}];
 const s=createSpeciesTrees(trees);
 assert.equal(s.group.children.length,3);assert.equal(s.stats.drawCalls,3);
 s.update({x:0,z:0});assert.deepEqual(s.levels(),{near:1,mid:1,far:1});
 assert.equal(treeLevel(80),'near');assert.equal(treeLevel(100),'mid');assert.equal(treeLevel(1000),null); // near is 95 m (full EZ crowns)
});

test('the tree models stand with their root flare below the ground', async () => {
 const THREE=await import('three');const {unitParts,ROOT}=await import('../src/ez-trees.js');
 // a 2 m wide, 10 m tall model whose lowest 1.6 m is roots (the oak's proportions): the roots go under y = 0
 const bark=new THREE.BoxGeometry(2,10,2);bark.translate(0,5,0);const leaves=new THREE.BoxGeometry(6,4,6);leaves.translate(0,8,0);
 const box=new THREE.Box3().setFromBufferAttribute(bark.attributes.position).union(new THREE.Box3().setFromBufferAttribute(leaves.attributes.position));
 const parts=unitParts([{geometry:bark},{geometry:leaves}],box,1.6);
 assert.ok(Math.abs(parts[0].geometry.boundingBox.min.y- -.16)<1e-6,'the roots hang 16% of the height below the ground');
 assert.ok(Math.abs(parts[0].geometry.boundingBox.max.y-.84)<1e-6);assert.ok(Math.abs(parts[1].geometry.boundingBox.max.y-.84)<1e-6,'the crown comes down with the trunk');
 assert.ok(ROOT.oak>ROOT.linden&&ROOT.linden>0,'the oak has the bigger roots');
});

test('detailed crowns dissolve near the camera', async () => {
 const THREE=await import('three');const {createEzTrees,LEAF_NEAR}=await import('../src/ez-trees.js');
 const {group}=createEzTrees([{x:0,z:0,y:0,kind:3,width:6,height:10,yaw:0,tint:1}]);
 const leaves=group.children.find(m=>/\/1$/.test(m.name)),bark=group.children.find(m=>/\/0$/.test(m.name));
 assert.ok(leaves.material.userData.nearFade&&bark.material.userData.nearFade);
 const shader={fragmentShader:THREE.ShaderLib.physical.fragmentShader,uniforms:{}};
 leaves.material.onBeforeCompile(shader);assert.match(shader.fragmentShader,/length\(vViewPosition\)/);assert.match(shader.fragmentShader,/discard/);
 assert.ok(LEAF_NEAR.to<8,'the car, 8 m ahead of the lens, keeps the crowns over it');
});
