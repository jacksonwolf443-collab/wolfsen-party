const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = require.extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, file);

function load(file) {
  try {
    return require(file);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes(file)) throw error;
    assert.fail(`the audio module ${file} must be available`);
  }
}

test('voice WAV contains mono signed PCM with its original sample rate', async () => {
  const { voiceWav } = load('../src/voice-capture.ts');
  const wav = voiceWav({ samples: Float32Array.of(-2, -0.5, 0, 0.5, 2), sampleRate: 44_100 });
  const bytes = Buffer.from(await wav.arrayBuffer());
  assert.equal(wav.type, 'audio/wav');
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.readUInt32LE(4), 46);
  assert.equal(bytes.toString('ascii', 8, 16), 'WAVEfmt ');
  assert.equal(bytes.readUInt16LE(20), 1);
  assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readUInt32LE(24), 44_100);
  assert.equal(bytes.readUInt32LE(28), 88_200);
  assert.equal(bytes.readUInt16LE(32), 2);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.equal(bytes.toString('ascii', 36, 40), 'data');
  assert.equal(bytes.readUInt32LE(40), 10);
  assert.deepEqual([44, 46, 48, 50, 52].map(offset => bytes.readInt16LE(offset)), [-32_768, -16_384, 0, 16_384, 32_767]);
});

test('a pending microphone permission request releases a stream that arrives after cancellation', async t => {
  const { startVoiceCapture } = load('../src/voice-capture.ts');
  let grant;
  let stopped = false;
  t.mock.getter(globalThis, 'navigator', () => ({ mediaDevices: {
    getUserMedia: () => new Promise(resolve => { grant = resolve; }),
  } }));
  const controller = new AbortController();
  const started = startVoiceCapture('usb-mic', () => assert.fail('cancelled capture emitted a frame'), { signal: controller.signal });
  controller.abort();
  await assert.rejects(started, { name: 'AbortError' });
  grant({ getTracks: () => [{ stop: () => { stopped = true; } }] });
  await Promise.resolve();
  assert.equal(stopped, true);
});

test('a missing selected speaker never plays the clip through the default speaker', async t => {
  const { playVoiceRecording } = load('../src/voice-hardware.tsx');
  let chosenSink;
  let played = false;
  let restored = false;
  class Audio extends EventTarget {
    async setSinkId(id) { chosenSink = id; throw new DOMException('Device missing', 'NotFoundError'); }
    async play() { played = true; }
    pause() {}
    removeAttribute(name) { assert.equal(name, 'src'); }
    load() { restored = true; }
  }
  Object.defineProperty(globalThis, 'Audio', { value: Audio, configurable: true });
  t.after(() => delete globalThis.Audio);
  await assert.rejects(playVoiceRecording({ samples: Float32Array.of(0), sampleRate: 48_000 }, 'usb-speaker'), { name: 'NotFoundError' });
  assert.equal(chosenSink, 'usb-speaker');
  assert.equal(played, false);
  assert.equal(restored, true);
});
