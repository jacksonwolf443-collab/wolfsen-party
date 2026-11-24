'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store, createBackend } = require('../desktop/store.cjs');
const { createCheckedInPlayer } = require('./helpers/checked-in-player.cjs');

const invalid = error => error.status === 400;
const conflict = error => error.status === 409;

async function fixture(t) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'party-voice-scores-'));
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }));
  const store = new Store(path.join(profile, 'data'));
  const api = createBackend(store);
  const players = [];
  for (const [index, name] of ['松鼠', '小鹿', '老虎', '企鹅', '犀牛'].entries()) {
    const { player } = await createCheckedInPlayer(api, { number: String(index + 1), name, active: true });
    players.push(player);
  }
  const guard = () => ({ partyEventId: store.data.event.id, resetEpoch: store.data.resetEpoch ?? 0 });
  const win = (activity, playerId = players[0].id) => ({
    ...guard(), eventId: randomUUID(), activity, round: 1, playerIds: [playerId], task: '第1轮 · 结果', version: 0,
  });
  return { store, api, players, guard, win };
}

test('each voice game contributes one winner, one point and named score details across restart', async t => {
  const { store, api, players, win } = await fixture(t);
  const pitch = { ...win(10), task: '稳定最高音 · 880.0 Hz', recording: 'transient-raw-audio' };
  const imitation = { ...win(11), task: '模仿评分 · 93 分' };
  const [first, second] = await Promise.all([api('game/win', pitch), api('game/win', pitch)]);
  assert.equal(first.event.version, 1);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  await api('game/win', imitation);
  assert.deepEqual(store.data.players.map(player => player.score), [2, 0, 0, 0, 0]);
  assert.ok(!fs.readFileSync(store.file, 'utf8').includes(pitch.recording));

  const reopenedApi = createBackend(new Store(store.directory));
  const details = await reopenedApi('scores/detail', { playerId: players[0].id });
  assert.equal(details.score, 2);
  assert.deepEqual(details.entries.map(row => [row.source.kind, row.sourceLabel, row.task, row.delta]), [
    ['voiceImitation', '谁叫得最像 · 第1轮胜利', imitation.task, 1],
    ['voicePitch', '谁叫的最高 · 第1轮胜利', pitch.task, 1],
  ]);
  const summary = await reopenedApi('summary/list');
  const winner = summary.players.find(player => player.id === players[0].id);
  assert.equal(winner.wins, 2);
  assert.deepEqual(winner.winEvents.map(event => event.activity), ['谁叫的最高', '谁叫得最像']);
  assert.equal(winner.scoreLedger.total, 2);
  for (const [activity, eventId, activityName] of [[10, pitch.eventId, '谁叫的最高'], [11, imitation.eventId, '谁叫得最像']]) {
    const { events } = await reopenedApi('game/win/list', { activity });
    assert.deepEqual(events.map(event => [event.eventId, event.activityName, event.playerIds]), [[eventId, activityName, [players[0].id]]]);
  }
});

test('voice winner confirmation requires a UUID, a positive integer round and exactly one eligible player', async t => {
  const { store, api, players, win } = await fixture(t);
  const unchecked = (await api('players', { number: '99', name: '未签到' })).player;
  const inactive = (await createCheckedInPlayer(api, { number: '98', name: '不参与', active: false })).player;
  const invalidPatches = [
    { eventId: 'not-a-uuid' }, { round: undefined }, { round: '1' }, { round: 0 }, { round: 1.5 },
    { round: Number.MAX_SAFE_INTEGER + 1 }, { groupId: 'extra-group' },
    { playerIds: [] }, { playerIds: [players[0].id, players[0].id] }, { playerIds: [players[0].id, players[1].id] },
    { playerIds: [unchecked.id] }, { playerIds: [inactive.id] }, { playerIds: ['missing-player'] },
  ];
  for (const activity of [10, 11]) {
    const before = structuredClone(store.data);
    for (const patch of invalidPatches) await assert.rejects(api('game/win', { ...win(activity), ...patch }), invalid);
    await assert.rejects(api('game/win', { ...win(activity), resetEpoch: undefined }), conflict);
    await assert.rejects(api('game/win', { ...win(activity), partyEventId: undefined }), conflict);
    assert.deepEqual(store.data, before);
  }
});

test('voice round and event IDs prevent double awards, while versioned revoke and correction reconcile the same result', async t => {
  const { store, api, players, guard, win } = await fixture(t);
  const [first, second] = players;
  const pitch = win(10);
  await api('game/win', pitch);
  await assert.rejects(api('game/win', win(10, second.id)), conflict);
  await assert.rejects(api('game/win', { ...pitch, activity: 11, version: 1 }), conflict);
  await assert.rejects(api('game/win', { ...pitch, round: 2, version: 1 }), conflict);
  await api('players/attendance', { id: first.id, attendance: 'away', version: store.player(first.id).version });
  assert.equal((await api('game/win', { ...pitch, eventId: pitch.eventId.toUpperCase() })).duplicate, true);

  const revoke = { ...guard(), eventId: pitch.eventId, version: 1 };
  await assert.rejects(api('game/win/revoke', { ...revoke, resetEpoch: undefined }), conflict);
  assert.equal((await api('game/win/revoke', revoke)).event.status, 'revoked');
  assert.equal((await api('game/win/revoke', revoke)).duplicate, true);
  assert.deepEqual(store.data.players.map(player => player.score), [0, 0, 0, 0, 0]);
  await assert.rejects(api('game/win', win(10, second.id)), conflict);
  const correction = { ...pitch, playerIds: [second.id] };
  await assert.rejects(api('game/win', { ...correction, version: 1 }), conflict);
  const restored = await api('game/win', { ...correction, version: 2 });
  assert.equal(restored.event.status, 'active');
  assert.equal(restored.event.version, 3);
  assert.deepEqual(store.data.players.map(player => player.score), [0, 1, 0, 0, 0]);
});

test('clearing activity 10 retires its round and points while preserving activity 11, other games and manual points', async t => {
  const { store, api, players, guard, win } = await fixture(t);
  const pitch = win(10), imitation = win(11), story = win(2), delayed = { ...win(10), round: 2 };
  await api('game/win', pitch);
  await api('game/win', imitation);
  await api('game/win', story);
  await api('scores/adjust', { playerId: players[0].id, delta: 3, actionId: 'host-points' });
  await api('state', { kind: 'voicePitch', value: { round: 2 }, version: 0 }, 'PUT');
  await api('state', { kind: 'voiceImitation', value: { round: 2 }, version: 0 }, 'PUT');
  await api('state', { kind: 'screen', value: { activity: 10, mode: 'voice-pitch' }, version: 0 }, 'PUT');
  assert.equal((await api('reset/preview', { scope: 11 })).title, '清空谁叫得最像全部内容');
  const preview = await api('reset/preview', { scope: 'activity:10' });
  assert.equal(preview.title, '清空谁叫的最高全部内容');
  assert.equal(preview.counts.wins, 1);
  const result = await api('reset/confirm', { token: preview.token });
  assert.equal(result.eventId, pitch.partyEventId);
  assert.equal(result.resetEpoch, 1);
  assert.ok(fs.existsSync(path.join(result.backupPath, '完整备份.jungle')));
  assert.deepEqual(store.state('voicePitch'), { value: null, version: 2 });
  assert.deepEqual(store.state('voiceImitation'), { value: { round: 2 }, version: 1 });
  assert.deepEqual(store.state('screen'), { value: null, version: 2 });
  assert.equal(store.player(players[0].id).score, 5);
  assert.deepEqual((await api('game/win/list')).events.map(event => event.activity), [11, 2]);
  assert.deepEqual((await api('scores/detail', { playerId: players[0].id })).entries.map(row => row.source?.kind ?? row.type), ['manual', 'truth', 'voiceImitation']);
  assert.equal((await api('reset/preview', { scope: 9 })).scope, 'scores');

  await assert.rejects(api('game/win', delayed), conflict);
  await assert.rejects(api('game/win', { ...pitch, ...guard(), eventId: pitch.eventId.toUpperCase() }), conflict);
  await assert.rejects(api('game/win/revoke', { ...imitation, version: 1 }), conflict);
  await api('game/win', win(10));
  assert.equal(store.player(players[0].id).score, 6);
  const reopenedApi = createBackend(new Store(store.directory));
  await assert.rejects(reopenedApi('game/win', { ...pitch, ...guard() }), conflict);
  assert.equal((await reopenedApi('game/win/list', { activity: 10 })).events.length, 1);
});
