const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');

require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);

function load() {
  const file = '../src/voice-analysis.ts';
  try {
    return require(file);
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND' || !error.message.includes(file)) throw error;
    assert.fail('the voice analysis module must be available');
  }
}

const rate = 48_000;

function noise(seed = 8) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 31 - 1;
  };
}

function recording(seconds, signal, sampleRate = rate) {
  return Float32Array.from({ length: Math.round(seconds * sampleRate) }, (_, index) => signal(index / sampleRate));
}

function tone(hz, amplitude = 0.3, duration = 0.047, sampleRate = rate) {
  return recording(duration, time => amplitude * Math.sin(2 * Math.PI * hz * time), sampleRate);
}

function phrase(pitches, lengths = [0.32, 0.27, 0.36], gap = 0.12, noiseLevel = 0, gain = 0.35) {
  const random = noise();
  const starts = [0, lengths[0] + gap, lengths[0] + lengths[1] + gap * 2];
  const duration = starts[2] + lengths[2];
  return recording(duration, time => {
    const slot = starts.findIndex((start, index) => time >= start && time < start + lengths[index]);
    const ambient = noiseLevel * random();
    if (slot < 0) return ambient;
    const position = time - starts[slot];
    const phase = 2 * Math.PI * pitches[slot] * position;
    const envelope = Math.min(1, position / 0.02, (lengths[slot] - position) / 0.02);
    return ambient + gain * envelope * (Math.sin(phase) + 0.28 * Math.sin(2 * phase));
  });
}

test('pitch estimates span low voices and high whistles across microphone sample rates', () => {
  const { pitchFrame, pitchNote } = load();
  for (const sampleRate of [8_000, 44_100, 48_000]) {
    for (const expected of [73, 196, 440, 784, 1397, 1760, 1825, 2200, 2286, 2350]) {
      const estimate = pitchFrame(tone(expected, 0.3, 0.047, sampleRate), sampleRate);
      assert.ok(Math.abs(estimate.hz - expected) / expected < 0.025, `${sampleRate} Hz: ${expected} measured as ${estimate.hz}`);
      assert.ok(estimate.confidence >= 0.85 && estimate.confidence <= 1);
    }
  }
  assert.equal(pitchNote(783.99), 'G5');
  assert.equal(pitchNote(440), 'A4');
  assert.equal(pitchNote(277.18), 'C#4');
  assert.ok(Math.abs(pitchFrame(tone(440, 0.1), rate).db - -23.01) < 0.2);
});

test('pitch rejects quiet tones, a transient, DC offset and aperiodic microphone noise', () => {
  const { pitchFrame } = load();
  const random = noise();
  const impulse = new Float32Array(Math.round(0.047 * rate));
  impulse[900] = 1;
  for (const signal of [tone(440, 0.0002), recording(0.047, () => 0.2), impulse, recording(0.047, () => 0.22 * random())]) {
    assert.equal(pitchFrame(signal, rate).hz, null);
  }
});

test('pitch retains the fundamental when a harmonic is louder', () => {
  const { pitchFrame } = load();
  const signal = recording(0.047, time => {
    const phase = 2 * Math.PI * 311 * time;
    return 0.15 * Math.sin(phase) + 0.52 * Math.sin(2 * phase) + 0.1 * Math.sin(3 * phase);
  });
  assert.ok(Math.abs(pitchFrame(signal, rate).hz - 311) < 4);
});

test('peak scoring waits for a stable group and ignores an isolated octave jump', () => {
  const { stablePeak } = load();
  assert.equal(stablePeak([784, null, 780, null, 1570, null]), null);
  assert.equal(stablePeak([420, 420, 420]), null);
  const sustained = [null, 437, 440, 442, 880, null, 516, 520, 523, 525, null];
  assert.ok(Math.abs(stablePeak(sustained) - 522) < 4);
  assert.ok(Math.abs(stablePeak([437, 440, 882, 442]) - 440) < 4);
  assert.equal(stablePeak([380, 470, 620, 810, 1020, 1300]), null);
});

test('clip analysis trims the quiet edges while keeping the internal pause and normalized waveform', () => {
  const { analyzeClip } = load();
  const signal = recording(2, time => {
    const sounding = time >= 0.4 && time < 0.75 || time >= 1.1 && time < 1.6;
    return sounding ? 0.35 * Math.sin(2 * Math.PI * 220 * time) : 0;
  });
  const clip = analyzeClip(signal, rate);
  assert.equal(clip.usable, true);
  assert.ok(Math.abs(clip.duration - 1.2) <= 0.03);
  assert.ok(clip.waveform.length >= 20);
  assert.ok(clip.waveform.every(peak => peak >= 0 && peak <= 1));
  assert.equal(Math.max(...clip.waveform), 1);
  assert.equal(clip.waveform[Math.round(clip.waveform.length * 0.43)], 0);
});

test('clip analysis rejects silence, DC offset, quiet background and isolated clicks', () => {
  const { analyzeClip, compareClips } = load();
  const random = noise();
  const click = new Float32Array(rate);
  click[5000] = 1;
  const reference = analyzeClip(phrase([220, 330, 262]), rate);
  for (const recording of [new Float32Array(rate), new Float32Array(rate).fill(0.5), Float32Array.from({ length: rate }, () => 0.0015 * random()), click]) {
    const quiet = analyzeClip(recording, rate);
    assert.equal(quiet.usable, false);
    assert.equal(compareClips(reference, quiet).score, 0);
  }
});

test('a steady broadband noise floor cannot produce a valid imitation score', () => {
  const { analyzeClip, compareClips } = load();
  const roomA = noise(12);
  const roomB = noise(23);
  const reference = analyzeClip(recording(1.2, () => 0.07 * roomA()), rate);
  const attempt = analyzeClip(recording(1.2, () => 0.035 * roomB()), rate);
  assert.equal(reference.usable, false);
  assert.equal(attempt.usable, false);
  assert.equal(compareClips(reference, attempt).score, 0);
});

test('an intentional unvoiced sound and a quiet steady pitch remain usable', () => {
  const { analyzeClip } = load();
  const random = noise();
  const boundedHiss = recording(1.2, time => time > 0.04 && time < 1.16 ? 0.07 * random() : 0);
  const modulatedHiss = recording(1.2, time => 0.07 * (0.65 + 0.35 * Math.sin(10 * Math.PI * time)) * random());
  const quietTone = tone(196, 0.008, 1.2);
  for (const sound of [boundedHiss, modulatedHiss, quietTone]) {
    assert.equal(analyzeClip(sound, rate).usable, true);
  }
});

test('similarity is deterministic and tolerant of gain changes and low ambient noise', () => {
  const { analyzeClip, compareClips } = load();
  const pitches = [196, 330, 247];
  const reference = analyzeClip(phrase(pitches), rate);
  const same = compareClips(reference, analyzeClip(phrase(pitches), rate));
  assert.deepEqual(same, { score: 100, pitch: 100, rhythm: 100, timbre: 100, duration: 100 });
  const similar = analyzeClip(phrase(pitches, [0.32, 0.27, 0.36], 0.12, 0.018, 0.19), rate);
  const scored = compareClips(reference, similar);
  assert.ok(scored.score >= 85, JSON.stringify(scored));
  assert.deepEqual(scored, compareClips(reference, similar));
});

test('similarity distinguishes a different pitch contour at the same rhythm', () => {
  const { analyzeClip, compareClips } = load();
  const reference = analyzeClip(phrase([196, 330, 247]), rate);
  const wrong = compareClips(reference, analyzeClip(phrase([392, 220, 349]), rate));
  assert.ok(wrong.pitch < 65, JSON.stringify(wrong));
  assert.ok(wrong.score < 84, JSON.stringify(wrong));
});

test('local alignment matches the notes and timbre when the second onset shifts slightly', () => {
  const { analyzeClip, compareClips } = load();
  const pitches = [196, 330, 247];
  const reference = analyzeClip(phrase(pitches), rate);
  const shifted = compareClips(reference, analyzeClip(phrase(pitches, [0.37, 0.22, 0.36]), rate));
  assert.ok(shifted.pitch >= 98 && shifted.timbre >= 95, JSON.stringify(shifted));
  assert.ok(shifted.rhythm < 92, JSON.stringify(shifted));
});

test('similarity penalizes changed rhythm and duration separately', () => {
  const { analyzeClip, compareClips } = load();
  const pitches = [196, 330, 247];
  const reference = analyzeClip(phrase(pitches), rate);
  const differentRhythm = compareClips(reference, analyzeClip(phrase(pitches, [0.12, 0.7, 0.13]), rate));
  assert.ok(differentRhythm.rhythm < 75, JSON.stringify(differentRhythm));
  assert.ok(differentRhythm.duration >= 95, JSON.stringify(differentRhythm));
  const differentLength = compareClips(reference, analyzeClip(phrase(pitches, [0.64, 0.54, 0.72], 0.24), rate));
  assert.ok(differentLength.duration < 65, JSON.stringify(differentLength));
  assert.ok(differentLength.rhythm > differentRhythm.rhythm, JSON.stringify(differentLength));
});

test('similarity compares rhythm and timbre when both clips lack a stable pitch', () => {
  const { analyzeClip, compareClips } = load();
  function bursts(seed, brighter) {
    const random = noise(seed);
    let previous = 0;
    return recording(0.82, time => {
      const value = random();
      const colored = brighter ? value - previous : 0.5 * (value + previous);
      previous = value;
      const active = time < 0.22 || time > 0.34 && time < 0.53 || time > 0.65;
      return active ? colored * 0.22 : 0;
    });
  }
  const reference = analyzeClip(bursts(7, false), rate);
  const matching = compareClips(reference, analyzeClip(bursts(14, false), rate));
  const bright = compareClips(reference, analyzeClip(bursts(14, true), rate));
  const pitched = compareClips(reference, analyzeClip(tone(440, 0.3, 0.82), rate));
  assert.equal(reference.usable, true);
  assert.ok(matching.score >= 85, JSON.stringify(matching));
  assert.ok(bright.timbre < matching.timbre - 15, JSON.stringify({ matching, bright }));
  assert.ok(pitched.pitch < 50, JSON.stringify(pitched));
});

test('analysis ignores samples beyond the recording limit', () => {
  const { analyzeClip } = load();
  const long = tone(220, 0.2, 13);
  assert.ok(analyzeClip(long, rate).duration <= 12);
  assert.deepEqual(analyzeClip(long, rate), analyzeClip(long.subarray(0, rate * 12), rate));
});
