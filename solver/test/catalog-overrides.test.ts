import assert from'node:assert/strict';import{test}from'node:test';import{catalogLevelId,originalCatalogId,checkedOverrides}from'../../games/shared/catalog.js';import{levelId}from'../src/production/store.js';
test('catalog revisions preserve canonical ids and resolve only explicitly versioned positions',async()=>{
 const child='11111111-1111-4111-a111-111111111111';const overrides=checkedOverrides({version:1,games:{racer:{'10':child}}});
 assert.equal(await originalCatalogId('racer',10),levelId('racer',10,1));assert.equal(await catalogLevelId('racer',10,overrides),child);assert.equal(await catalogLevelId('racer',11,overrides),levelId('racer',11,1));
 assert.throws(()=>checkedOverrides({version:1,games:{racer:{'1001':child}}}));assert.throws(()=>checkedOverrides({version:1,games:{racer:{'10':'bad'}}}));await assert.rejects(originalCatalogId('racer',1001));
});
