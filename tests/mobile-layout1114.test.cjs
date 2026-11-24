'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { Store, createBackend } = require('../desktop/store.cjs');
const { createMobileService } = require('../desktop/mobile-service.cjs');

async function waitFor(predicate, message) {
  for (let i = 0; i < 150; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(message);
}

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mobile-layout1114-'));
  const store = new Store(dir);
  const windows = [];
  const backend = createBackend(store);
  const mobile = createMobileService({ store, backend });
  t.after(async () => {
    for (const w of windows) w.close();
    await mobile.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  store.commit(data => {
    data.players = ['本人甲', '本人乙', '迟到丙'].map((name, i) => ({
      id: 'layout-' + i, name, number: String(i + 1), attendance: i < 2 ? 'present' : 'away',
      active: 1, version: 0, score: 0,
    }));
    return {};
  });
  await backend('state', { kind: 'taskBank', version: 0, value: ['讲一个故事'] });
  await backend('mission/start', { minutes: 20 });
  store.commit(data => { data.players[2].attendance = 'present'; return {}; });
  await backend('mission/supplement', { eventId: store.data.event.id, roundId: store.data.missionRound.id });
  const incomingTarget = store.data.missions.find(mission => mission.actor === 'layout-2').target;
  await mobile.start({ port: 0 });
  const status = await mobile.status();
  const base = 'http://127.0.0.1:' + status.port;
  const entry = new URL(status.url).hash;
  const html = await (await fetch(base + '/')).text();

  function openPhone({ removeSearch = false } = {}) {
    const dom = new JSDOM(html, { url: base + '/' + entry, runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window;
    windows.push(w);
    if (removeSearch) w.document.getElementById('search')?.closest('label').remove();
    w.fetch = (url, options) => fetch(base + url, options);
    w.confirm = () => assert.fail('Changing the selected participant requires no confirmation');
    w.eval(fs.readFileSync(path.join(__dirname, '../desktop/mobile/app.js'), 'utf8'));
    return w;
  }

  async function claim(w, id) {
    await waitFor(() => w.document.getElementById('player').options.length === 4, 'All three registered players should be selectable');
    w.document.getElementById('player').value = id;
    w.document.getElementById('join').click();
    await waitFor(() => !w.document.getElementById('cards').hidden && w.document.getElementById('self').textContent.includes(store.data.players.find(p => p.id === id).name), 'Claiming the selected participant should display their task');
  }

  return { store, backend, html, incomingTarget, openPhone, claim };
}

test('phone claim page has one participant selector and acceptance cards precede the outgoing task', { concurrency: false }, async t => {
  const f = await fixture(t);
  const dom = new JSDOM(f.html);
  t.after(() => dom.window.close());
  const document = dom.window.document;
  assert.equal(document.querySelector('#claim input'), null, 'The participant claim form should not display a search input');
  assert.ok(document.querySelector('#claim select#player'));
  assert.ok(document.querySelector('#claim button#join'));
  const incoming = document.getElementById('incomingList');
  const outgoing = document.getElementById('verify').closest('section');
  assert.ok(incoming.compareDocumentPosition(outgoing) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 'Acceptance cards should appear above My Task');
});

test('phone claiming, verification, refresh and reselecting work with no search element', { concurrency: false }, async t => {
  const f = await fixture(t);
  const w = f.openPhone({ removeSearch: true });
  await f.claim(w, f.incomingTarget);
  assert.equal(w.document.getElementById('search'), null);
  assert.deepEqual(Array.from(w.document.getElementById('player').options, option => option.textContent), [
    '请选择本人', '#1 本人甲', '#2 本人乙', '#3 迟到丙',
  ]);

  const outgoing = f.store.data.missions.find(mission => mission.actor === f.incomingTarget);
  w.document.getElementById('code').value = outgoing.code;
  w.document.getElementById('verify').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await waitFor(() => w.document.getElementById('outStatus').textContent.includes('已通过验收'), 'Submitting the assigned acceptance code should complete the task');
  assert.ok(f.store.data.missions.find(mission => mission.id === outgoing.id).completed_at);
  assert.equal(w.document.getElementById('verify').hidden, true);
  assert.equal(w.document.getElementById('code').value, '');
  assert.match(w.document.getElementById('message').textContent, /验收通过/);

  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await waitFor(() => w.document.getElementById('connection').textContent.includes('已连接'), 'Refreshing should retain the current participant');
  w.document.getElementById('retry').click();
  await waitFor(() => !w.document.getElementById('claim').hidden && w.document.getElementById('player').options.length === 4, 'Reselecting should reload the full participant list');
  const other = f.incomingTarget === 'layout-0' ? 'layout-1' : 'layout-0';
  await f.claim(w, other);
  assert.match(w.document.getElementById('acceptCode').textContent, /^\d{6}$/);
  assert.equal(w.document.getElementById('message').textContent, '');
});

test('each private incoming card leads with acceptance responsibility and survives data refresh', { concurrency: false }, async t => {
  const f = await fixture(t);
  const w = f.openPhone();
  await f.claim(w, f.incomingTarget);
  await waitFor(() => w.document.querySelectorAll('[data-incoming-card]').length === 2, 'Both assigned visitors should have private acceptance cards');
  const cards = Array.from(w.document.querySelectorAll('[data-incoming-card]'));
  for (const card of cards) {
    assert.equal(card.firstElementChild.textContent.trim(), '我负责验收');
    assert.match(card.children[1].textContent, /会来找你/);
    assert.match(card.querySelector('.bigcode').textContent, /^\d{6}$/);
  }
  const incoming = w.document.getElementById('incomingList');
  assert.ok(incoming.compareDocumentPosition(w.document.getElementById('verify').closest('section')) & w.Node.DOCUMENT_POSITION_FOLLOWING);

  const lateMission = f.store.data.missions.find(mission => mission.actor === 'layout-2');
  await f.backend('mission/verify', { actor: 'layout-2', code: lateMission.code });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await waitFor(() => w.document.querySelector('[data-incoming-card="' + lateMission.id + '"] [data-field="inStatus"]').textContent.includes('已通过验收'), 'Refreshing should update the matching visitor card');
  assert.equal(w.document.querySelectorAll('[data-incoming-card]').length, 2);
  assert.equal(w.document.querySelectorAll('[data-incoming-card] .bigcode').length, 2);
});
