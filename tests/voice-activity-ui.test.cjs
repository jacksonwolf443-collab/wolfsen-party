const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, f) => m._compile(ts.transpileModule(
  fs.readFileSync(f, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } },
).outputText, f);
require.extensions['.css'] = () => {};

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const capture = require('../src/voice-capture.ts');
const hardware = require('../src/voice-hardware.tsx');
const { VoiceActivity, VoiceStage } = require('../src/voice-activity.tsx');
const players = [
  { id: 'one', number: '01', name: '松鼠', active: 1, attendance: 'present' },
  { id: 'two', number: '02', name: '小鹿', active: 1, attendance: 'present' },
  { id: 'away', number: '03', name: '离场玩家', active: 1, attendance: 'away' },
];
const tone = (hz = 440) => ({
  sampleRate: 12_000,
  samples: Float32Array.from({ length: 3600 }, (_, index) => 0.15 * Math.sin(2 * Math.PI * hz * index / 12_000)),
});

async function setup(t, activity, { play = hardware.playVoiceRecording, start } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://party.test' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.confirm = () => true;
  const root = createRoot(document.getElementById('root'));
  const starts = [], writes = [];
  let current = tone(), fail = true;
  t.mock.method(capture, 'startVoiceCapture', async (device, onFrame, options) => {
    starts.push({ device, options });
    const handle = { inputDeviceId: 'actual-physical-mic', stop: async () => current, cancel() {} };
    if (start) return start(starts.length, onFrame, handle);
    for (let i = 0; i < 5; i++) onFrame({ hz: 440, db: -15, confidence: 1 });
    return handle;
  });
  t.mock.method(hardware, 'useVoiceHardware', () => ({
    inputs: [], outputs: [], inputId: 'requested-mic', outputId: 'chosen-speaker', error: '',
    checking: false, testing: false, outputError: '', setInputId() {}, setOutputId() {}, refresh() {}, unlock() {}, testOutput() {}, stopTest() {},
  }));
  t.mock.method(hardware, 'playVoiceRecording', play);
  window.partyDesktop = {
    async call(route, body) {
      if (route === 'game/win/list') return { ok: true, data: { events: [{ round: 2 }] } };
      assert.equal(route, 'game/win');
      writes.push(body);
      if (fail) {
        fail = false;
        throw new Error('connection lost after sending');
      }
      return { ok: true, data: { event: { status: 'active' } } };
    },
  };
  const ctx = { players, event: { id: 'birthday', resetEpoch: 4 }, refresh: async () => {}, busy: '', tell() {}, enterStage() {} };
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    delete global.window;
    delete global.document;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  });
  await act(async () => root.render(React.createElement(React.Fragment, null,
    React.createElement(VoiceActivity, { ctx, activity }),
    React.createElement(VoiceStage, { screen: { activity, mode: 'voice' } }),
  )));
  const button = text => [...document.querySelectorAll('.voice-activity button')].find(b => b.textContent.trim() === text);
  const click = async text => {
    assert.ok(button(text), text);
    assert.equal(button(text).disabled, false, text);
    await act(async () => button(text).click());
  };
  return { starts, writes, button, click, setClip: clip => { current = clip; } };
}

test('one checked-in player can win the pitch round and a retry reuses the exact award request', async t => {
  const ui = await setup(t, 10);
  assert.doesNotMatch(document.querySelector('.voice-activity').textContent, /离场玩家/);
  await ui.click('全选到场玩家');
  await act(async () => [...document.querySelectorAll('input[type="checkbox"]')][1].click());
  await ui.click('开始录音');
  assert.match(document.querySelector('.voice-stage').textContent, /440\.0/);
  await ui.click('停止并评分');
  await ui.click('确认获胜并加 1 分');
  await ui.click('重试确认并加分');
  assert.deepEqual(ui.writes[1], ui.writes[0]);
  assert.deepEqual(ui.writes[0].playerIds, ['one']);
  assert.equal(ui.writes[0].round, 3);
  assert.equal(ui.writes[0].activity, 10);
  assert.equal(ui.writes[0].resetEpoch, 4);
  assert.equal(ui.writes[0].version, 0);
  assert.ok(ui.writes[0].eventId);
  assert.match(document.querySelector('.voice-stage').textContent, /松鼠.*已加 1 分/);
  await ui.click('开始下一轮');
  assert.equal(ui.writes.length, 2);
  assert.match(document.querySelector('.voice-activity').textContent, /第 4 轮/);
});

test('imitation locks the physical mic and original clip and requires an explicit choice for tied first place', async t => {
  const played = [];
  const ui = await setup(t, 11, { play: async (recording, outputId) => {
    played.push({ recording, outputId });
    return { stop() {}, ended: Promise.resolve() };
  } });
  await ui.click('全选到场玩家');
  const original = tone();
  ui.setClip(original);
  await ui.click('录制原声 A');
  await ui.click('停止并保存原声');
  await ui.click('播放原声 A');
  await ui.click('开始录音');
  await ui.click('停止并评分');
  assert.equal(ui.button('重录原声 A'), undefined);
  await ui.click('下一位待录');
  await ui.click('开始录音');
  await ui.click('停止并评分');
  assert.equal(ui.button('确认获胜并加 1 分').disabled, true);
  assert.deepEqual(ui.starts.map(x => x.device), ['requested-mic', 'actual-physical-mic', 'actual-physical-mic']);
  await ui.click('播放本次模仿');
  assert.deepEqual(played[0], { recording: original, outputId: 'chosen-speaker' });
  assert.equal(played.length, 2);
  const choices = [...document.querySelectorAll('input[type="radio"]')];
  assert.equal(choices.length, 2);
  await act(async () => choices[1].click());
  assert.equal(ui.button('确认获胜并加 1 分').disabled, false);
  await ui.click('重置本轮');
  assert.ok(ui.button('录制原声 A'));
  assert.equal(document.querySelectorAll('.voice-stage button').length, 0);
});

test('reset aborts an opening microphone and the next capture rejects silence then scores at the time limit', async t => {
  let finishOpening;
  let lateCancel = 0;
  const ui = await setup(t, 10, { start(attempt, onFrame, handle) {
    if (attempt === 1) return new Promise(resolve => {
      finishOpening = () => resolve({ ...handle, cancel() { lateCancel++; } });
    });
    for (let i = 0; i < 5; i++) onFrame(attempt === 2 ? { hz: null, db: -120 } : { hz: 440, db: -15 });
    return handle;
  } });
  await ui.click('全选到场玩家');
  await ui.click('开始录音');
  await ui.click('重置本轮');
  assert.equal(ui.starts[0].options.signal.aborted, true);
  await act(async () => finishOpening());
  assert.equal(lateCancel, 1);
  assert.equal(ui.button('停止并评分'), undefined);
  await ui.click('开始录音');
  await ui.click('停止并评分');
  assert.match(document.querySelector('.voice-activity [role="alert"]').textContent, /没有检测到稳定音高/);
  await ui.click('开始录音');
  assert.equal(ui.starts[2].options.maxSeconds, 12);
  await act(async () => ui.starts[2].options.onLimit());
  assert.match(document.querySelector('.voice-activity [role="status"]').textContent, /12 秒上限/);
  assert.equal(ui.button('重新录音').disabled, false);
  assert.equal(ui.writes.length, 0);
});

test('reference playback blocks imitation capture and resetting aborts pending playback', async t => {
  let signal, release;
  const ui = await setup(t, 11, { play: (_recording, _outputId, activeSignal) => {
    signal = activeSignal;
    return new Promise(resolve => { release = () => resolve({ stop() {}, ended: Promise.resolve() }); });
  } });
  await ui.click('全选到场玩家');
  await ui.click('录制原声 A');
  await ui.click('停止并保存原声');
  await ui.click('播放原声 A');
  assert.equal(ui.button('开始录音').disabled, true);
  await ui.click('重置本轮');
  assert.equal(signal.aborted, true);
  await act(async () => release());
  assert.equal(ui.starts.length, 1);
  assert.equal(ui.button('录制原声 A').disabled, false);
  assert.equal(ui.button('开始录音').disabled, true);
});
