'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {reserveScene,scenes} = require('../desktop/cover-scenes.cjs');
const {Store} = require('../desktop/store.cjs');

function memoryStore(groups) {
  return {
    data:{players:[],states:groups ? {pairs:{value:{groups}}} : {}},
    commit(fn) { return structuredClone(fn(this.data)); },
  };
}
function pair(index) { return {id:`group-${index}`,members:[`a-${index}`,`b-${index}`]}; }

test('catalog provides at least 80 visually different activities with contextual clothing', () => {
  assert.ok(scenes.length >= 80);
  for (const field of ['id','label','setting']) assert.equal(new Set(scenes.map(scene => scene[field])).size,scenes.length);
  for (const scene of scenes) {
    assert.ok(scene.clothing.length >= 8);
    assert.ok(scene.setting.length >= 20);
    assert.ok(!/极短寸头|贴头皮|肌肉|健美|黝黑|晒黑|buzz.?cut|muscular|tanned/i.test(`${scene.setting} ${scene.clothing}`));
  }
  for (const id of ['battlefield-comrades','diving-friends','wingsuit-team','skydiving-partners','alpine-ski','snowboard-park','office-partners','medical-team','kitchen-chefs','recording-duo','railway-engineers','space-crew','telescope-observers']) {
    assert.ok(scenes.some(scene => scene.id === id),`missing ${id}`);
  }
  assert.match(scenes.find(scene => scene.id === 'battlefield-comrades').clothing,/军装/);
  assert.match(scenes.find(scene => scene.id === 'diving-friends').clothing,/潜水服/);
});

test('40 equally interested groups receive 40 distinct scene reservations', async () => {
  const groups = Array.from({length:40},(_,index) => pair(index));
  const store = memoryStore(groups);
  store.data.players = groups.flatMap(group => group.members.map(id => ({id,interests:'潜水 运动 旅行'})));
  const requests = groups.map(group => Promise.resolve().then(() => {
    const result = reserveScene(store,{ids:group.members,groupId:group.id});
    assert.equal(store.data.coverSceneAssignments[group.id],result.id);
    return result;
  }));
  const chosen = await Promise.all(requests);
  assert.equal(new Set(chosen.map(scene => scene.id)).size,40);
  assert.equal(new Set(chosen.map(scene => scene.setting)).size,40);
  assert.equal(new Set(chosen.map(scene => scene.label)).size,40);
});

test('reservations survive reopening and exclude assignments of every other API group', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'cover-scenes-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  const firstStore = new Store(directory);
  const first = reserveScene(firstStore,{ids:['a','b'],groupId:'first'});
  const secondStore = new Store(directory);
  const second = reserveScene(secondStore,{ids:['c','d'],groupId:'second'});
  assert.notEqual(second.id,first.id);
  assert.equal(secondStore.data.coverSceneAssignments.first,first.id);
  assert.equal(new Store(directory).data.coverSceneAssignments.second,second.id);
});

test('regenerating a group changes its scene and respects other current groups sceneId', () => {
  const groups = [pair(1),pair(2)];
  const store = memoryStore(groups);
  const first = reserveScene(store,{ids:groups[0].members,groupId:groups[0].id});
  const reservedOther = scenes.find(scene => scene.id !== first.id);
  groups[1].sceneId = reservedOther.id;
  for (let attempt = 0; attempt < 200; attempt++) {
    const previous = store.data.coverSceneAssignments[groups[0].id];
    const next = reserveScene(store,{ids:groups[0].members,groupId:groups[0].id});
    assert.notEqual(next.id,previous);
    assert.notEqual(next.id,reservedOther.id);
  }
});

test('member order gives the same API reservation key and one current reservation', () => {
  const store = memoryStore();
  const first = reserveScene(store,{ids:['z','a']});
  const second = reserveScene(store,{ids:['a','z']});
  assert.notEqual(second.id,first.id);
  assert.deepEqual(Object.keys(store.data.coverSceneAssignments),['a|z']);
});

test('a member-only request recognizes its existing pair group and drops reservation aliases', () => {
  const group = pair(1), store = memoryStore([group]);
  store.data.coverSceneAssignments = {[group.members.slice().sort().join('|')]:scenes[0].id};
  const result = reserveScene(store,{ids:[...group.members].reverse()});
  assert.notEqual(result.id,scenes[0].id);
  assert.deepEqual(store.data.coverSceneAssignments,{[group.id]:result.id});
});

test('re-pairing removes orphan reservations while retaining all current group reservations', () => {
  const groups = [pair(1),pair(2)];
  const store = memoryStore(groups);
  store.data.coverSceneAssignments = {'old-group':scenes[0].id,[groups[1].id]:scenes[1].id};
  const result = reserveScene(store,{ids:groups[0].members,groupId:groups[0].id});
  assert.equal(store.data.coverSceneAssignments['old-group'],undefined);
  assert.equal(store.data.coverSceneAssignments[groups[1].id],scenes[1].id);
  assert.notEqual(result.id,scenes[1].id);
});

test('an exhausted catalog supplies 40 further visibly distinct combinations without recycling reservations', () => {
  const store = memoryStore();
  store.data.coverSceneAssignments = Object.fromEntries(scenes.map((scene,index) => [`reserved-${index}`,scene.id]));
  const results = Array.from({length:40},(_,index) => reserveScene(store,{ids:[`x${index}`,`y${index}`]}));
  assert.equal(new Set(results.map(scene => scene.id)).size,40);
  assert.equal(new Set(results.map(scene => scene.setting)).size,40);
  assert.equal(new Set(results.map(scene => scene.label)).size,40);
  assert.ok(results.every(scene => !scenes.some(base => base.id === scene.id)));
});

test('interests add preference tickets while keeping unrelated choices available', () => {
  const originalRandomInt = crypto.randomInt;
  try {
    const matchingStore = memoryStore();
    matchingStore.data.players = [{id:'a',interests:'潜水'},{id:'b',interests:'diving'}];
    let tickets = 0;
    crypto.randomInt = count => { tickets = count; return count - 1; };
    const preferred = reserveScene(matchingStore,{ids:['a','b']});
    assert.equal(preferred.id,'diving-friends');
    assert.equal(tickets,scenes.length + 4);
    crypto.randomInt = () => 0;
    const unrelatedStore = memoryStore();
    unrelatedStore.data.players = matchingStore.data.players;
    const unrelated = reserveScene(unrelatedStore,{ids:['a','b']});
    assert.equal(unrelated.id,scenes[0].id);
  } finally { crypto.randomInt = originalRandomInt; }
});

test('group IDs are stored as map entries even when their text is an object property name', () => {
  const store = memoryStore();
  const result = reserveScene(store,{ids:['a','b'],groupId:'__proto__'});
  assert.equal(Object.hasOwn(store.data.coverSceneAssignments,'__proto__'),true);
  assert.equal(store.data.coverSceneAssignments.__proto__,result.id);
  const next = reserveScene(store,{ids:['c','d'],groupId:'other'});
  assert.notEqual(next.id,result.id);
});

test('invalid input fails before changing any reservations', () => {
  const store = memoryStore();
  for (const ids of [undefined,[],['a'],['a','a'],['a','b','c'],['a',null]]) {
    assert.throws(() => reserveScene(store,{ids}),/两位不同/);
  }
  assert.equal(store.data.coverSceneAssignments,undefined);
});
