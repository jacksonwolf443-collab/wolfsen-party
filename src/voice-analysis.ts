export interface PitchFrame {
  hz: number | null;
  db: number;
  confidence: number;
}

interface VoiceFrame {
  level: number;
  pitch: number | null;
  spectrum: number[] | null;
}

export interface VoiceFeatures {
  waveform: number[];
  duration: number;
  usable: boolean;
  frames: VoiceFrame[];
}

export interface VoiceSimilarity {
  score: number;
  pitch: number;
  rhythm: number;
  timbre: number;
  duration: number;
}

const analysisRate = 12_000;
const minimumPitch = 65;
const maximumPitch = 2_500;
const maximumClipSeconds = 12;
const waveformBins = 96;
const fftSize = 1024;
const bandEdges = [140, 260, 430, 680, 1_050, 1_600, 2_350, 3_400, 4_600];
const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function clamp(value: number, low = 0, high = 1) {
  return Math.max(low, Math.min(high, value));
}

function stats(samples: Float32Array) {
  let sum = 0;
  let squares = 0;
  for (const sample of samples) {
    sum += sample;
    squares += sample * sample;
  }
  const mean = sum / samples.length;
  return { mean, rms: Math.sqrt(Math.max(0, squares / samples.length - mean * mean)) };
}

function decimate(samples: Float32Array, factor: number) {
  if (factor === 1) return samples;
  const reduced = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < reduced.length; i++) {
    let sum = 0;
    for (let j = 0; j < factor; j++) sum += samples[i * factor + j];
    reduced[i] = sum / factor;
  }
  return reduced;
}

function periodicity(samples: Float32Array, rate: number, mean: number) {
  const centered = samples.map(value => value - mean);
  const firstLag = Math.max(2, Math.floor(rate / maximumPitch));
  const lastLag = Math.min(Math.ceil(rate / minimumPitch), Math.floor(centered.length / 2) - 1);
  const correlations = new Float32Array(Math.max(0, lastLag + 2));

  // The same-lag energy normalization keeps a shorter overlap from favoring low notes.
  for (let lag = firstLag - 1; lag <= lastLag + 1; lag++) {
    let product = 0;
    let energy = 0;
    for (let i = 0; i < centered.length - lag; i++) {
      const a = centered[i];
      const b = centered[i + lag];
      product += a * b;
      energy += a * a + b * b;
    }
    correlations[lag] = energy > 0 ? 2 * product / energy : 0;
  }

  const peaks: { hz: number; confidence: number }[] = [];
  let strongest = 0;
  for (let lag = firstLag; lag <= lastLag; lag++) {
    const [left, center, right] = [correlations[lag - 1], correlations[lag], correlations[lag + 1]];
    if (center < 0.55 || center <= left || center < right) continue;
    // A cosine fit keeps peaks between samples from losing to a later period.
    const angle = Math.acos(clamp((left + right) / (2 * center), -1, 1));
    const phase = Math.atan2(right - left, 2 * center * Math.sin(angle));
    const shift = angle > 0 ? clamp(phase / angle, -0.5, 0.5) : 0;
    const hz = rate / (lag + shift);
    if (hz < minimumPitch || hz > maximumPitch) continue;
    const confidence = clamp(center / Math.cos(angle * shift));
    peaks.push({ hz, confidence });
    strongest = Math.max(strongest, confidence);
  }

  // The first near-best peak avoids selecting multiples of the true period.
  const minimumConfidence = Math.max(0.83, strongest * 0.95);
  return peaks.find(peak => peak.confidence >= minimumConfidence) ?? { hz: null, confidence: strongest };
}

export function pitchFrame(samples: Float32Array, sampleRate: number): PitchFrame {
  if (!Number.isFinite(sampleRate) || sampleRate < 4_000 || !samples.length) return { hz: null, db: -120, confidence: 0 };
  const frame = samples.subarray(Math.max(0, samples.length - Math.round(sampleRate * 0.055)));
  const { mean, rms } = stats(frame);
  if (!Number.isFinite(rms)) return { hz: null, db: -120, confidence: 0 };
  const db = Math.max(-120, 20 * Math.log10(rms));
  if (db < -52 || frame.length < sampleRate * 0.02) return { hz: null, db, confidence: 0 };
  const factor = Math.max(1, Math.round(sampleRate / analysisRate));
  return { db, ...periodicity(decimate(frame, factor), sampleRate / factor, mean) };
}

function semitones(hz: number) {
  return 12 * Math.log2(hz / 440);
}

export function pitchNote(hz: number) {
  if (!Number.isFinite(hz) || hz <= 0) return '—';
  const midi = Math.round(69 + semitones(hz));
  const note = noteNames[(midi % 12 + 12) % 12];
  return `${note}${Math.floor(midi / 12) - 1}`;
}

function median(sorted: readonly number[]) {
  const middle = Math.floor(sorted.length / 2);
  return (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2;
}

export function stablePeak(frames: readonly (number | null)[]) {
  let best: number | null = null;
  for (let end = 4; end <= frames.length; end++) {
    const window = frames.slice(end - 4, end)
      .filter((value): value is number => value !== null && Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    // Allow one missed or mistaken observation without rewarding an isolated high reading.
    for (let i = 0; i + 2 < window.length; i++) {
      const group = window.slice(i).filter(hz => hz <= window[i] * 1.08);
      if (group.length >= 3) best = Math.max(best ?? 0, median(group));
    }
  }
  return best;
}

const fftOrder = Uint16Array.from({ length: fftSize }, (_, index) => {
  let reversed = 0;
  for (let step = fftSize; step > 1; step >>= 1) {
    reversed = (reversed << 1) | (index & 1);
    index >>= 1;
  }
  return reversed;
});
const fftCos = Float64Array.from({ length: fftSize / 2 }, (_, i) => Math.cos(2 * Math.PI * i / fftSize));
const fftSin = Float64Array.from({ length: fftSize / 2 }, (_, i) => -Math.sin(2 * Math.PI * i / fftSize));

function spectrumOf(frame: Float32Array, rate: number, mean: number) {
  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  for (let i = 0; i < frame.length; i++) {
    const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (frame.length - 1));
    real[fftOrder[i]] = (frame[i] - mean) * window;
  }

  for (let width = 2; width <= fftSize; width *= 2) {
    const half = width / 2;
    const phaseStep = fftSize / width;
    for (let start = 0; start < fftSize; start += width) {
      for (let i = 0; i < half; i++) {
        const left = start + i;
        const right = left + half;
        const c = fftCos[i * phaseStep];
        const s = fftSin[i * phaseStep];
        const r = c * real[right] - s * imaginary[right];
        const m = s * real[right] + c * imaginary[right];
        real[right] = real[left] - r;
        imaginary[right] = imaginary[left] - m;
        real[left] += r;
        imaginary[left] += m;
      }
    }
  }

  const bands = new Array<number>(bandEdges.length + 1).fill(0);
  let total = 0;
  let band = 0;
  for (let bin = 1; bin < fftSize / 2; bin++) {
    const hz = bin * rate / fftSize;
    while (band < bandEdges.length && hz >= bandEdges[band]) band++;
    const energy = real[bin] ** 2 + imaginary[bin] ** 2;
    bands[band] += energy;
    total += energy;
  }
  return total > 0 ? bands.map(energy => Math.sqrt(energy / total)) : null;
}

function waveformPeaks(samples: Float32Array) {
  const peaks = Array.from({ length: waveformBins }, (_, bin) => {
    const from = Math.floor(bin * samples.length / waveformBins);
    const to = Math.floor((bin + 1) * samples.length / waveformBins);
    let peak = 0;
    for (let i = from; i < to; i++) {
      const amplitude = Math.abs(samples[i]);
      if (amplitude > peak) peak = amplitude;
    }
    return peak;
  });
  const max = Math.max(...peaks);
  return max > 0 ? peaks.map(peak => peak / max) : peaks;
}

export function analyzeClip(samples: Float32Array, sampleRate: number): VoiceFeatures {
  const empty = { waveform: [], duration: 0, usable: false, frames: [] };
  if (!Number.isFinite(sampleRate) || sampleRate < 4_000) return empty;
  const bounded = samples.subarray(0, Math.floor(sampleRate * maximumClipSeconds));
  const blockSize = Math.round(sampleRate * 0.01);
  const levels: number[] = [];
  for (let start = 0; start < bounded.length; start += blockSize) {
    levels.push(stats(bounded.subarray(start, start + blockSize)).rms);
  }
  const loudest = Math.max(0, ...levels);
  if (!Number.isFinite(loudest) || loudest < 0.003) return empty;

  const gate = Math.max(0.003, loudest * 0.085);
  const isActive = (level: number) => level >= gate;
  const first = levels.findIndex(isActive);
  let last = levels.length - 1;
  while (last > first && !isActive(levels[last])) last--;
  if (levels.filter(isActive).length < 7) return empty;
  const trimmed = bounded.subarray(first * blockSize, (last + 1) * blockSize);
  const duration = trimmed.length / sampleRate;
  if (duration < 0.1) return empty;

  const factor = Math.max(1, Math.round(sampleRate / analysisRate));
  const reduced = decimate(trimmed, factor);
  const rate = sampleRate / factor;
  const windowRadius = Math.round(rate * 0.023);
  const frameCount = Math.ceil(duration / 0.025);
  const frames = Array.from({ length: frameCount }, (_, index): VoiceFrame => {
    const center = Math.round((index + 0.5) * reduced.length / frameCount);
    const frame = reduced.subarray(Math.max(0, center - windowRadius), center + windowRadius);
    const { mean, rms } = stats(frame);
    if (rms < gate) return { level: 0, pitch: null, spectrum: null };
    const { hz } = periodicity(frame, rate, mean);
    return {
      level: clamp(rms / loudest),
      pitch: hz === null ? null : semitones(hz),
      spectrum: spectrumOf(frame, rate, mean),
    };
  });
  const fillsRecording = first < 3 && last >= levels.length - 3;
  if (fillsRecording && isStationaryNoise(levels, frames)) return empty;
  return { waveform: waveformPeaks(trimmed), duration, usable: true, frames };
}

function spectrumDifference(a: number[] | null, b: number[] | null) {
  if (!a || !b) return a === b ? 0 : 1;
  let overlap = 0;
  for (let i = 0; i < a.length; i++) overlap += a[i] * b[i];
  return clamp(1.3 * Math.sqrt(clamp(1 - overlap)));
}

function isStationaryNoise(levels: number[], frames: VoiceFrame[]) {
  if (frames.some(frame => frame.pitch !== null)) return false;
  const sorted = levels.slice().sort((a, b) => a - b);
  const quiet = sorted[Math.floor((sorted.length - 1) * 0.1)];
  const loud = sorted[Math.floor((sorted.length - 1) * 0.9)];
  if (quiet < loud * 0.75) return false;

  // Require both a broad spectrum and little spectral change across the recording.
  const spectra = frames.flatMap(frame => frame.spectrum ? [frame.spectrum] : []);
  if (!spectra.length) return false;
  const typical = spectra[0].map((_, band) =>
    Math.sqrt(spectra.reduce((sum, spectrum) => sum + spectrum[band] ** 2, 0) / spectra.length),
  );
  if (typical.filter(amplitude => amplitude >= 0.2).length < 4) return false;
  const similar = spectra.filter(spectrum => spectrumDifference(spectrum, typical) <= 0.28).length;
  return similar >= spectra.length * 0.9;
}

function pitchDifference(a: number | null, b: number | null, offset: number) {
  if (a === null || b === null) return a === b ? 0 : 1;
  const difference = b - a;
  return 0.7 * clamp(Math.abs(difference - offset) / 5) + 0.3 * clamp(Math.abs(difference) / 9);
}

function compareFrames(framesA: VoiceFrame[], framesB: VoiceFrame[], offset: number) {
  const count = framesA.length;
  const radius = Math.ceil(count * 0.08);
  const stride = count + 1;
  const costs = new Float64Array(stride * stride).fill(Infinity);
  const direction = new Uint8Array(costs.length);
  costs[0] = 0;
  for (let row = 1; row <= count; row++) {
    for (let column = Math.max(1, row - radius); column <= Math.min(count, row + radius); column++) {
      const a = framesA[row - 1];
      const b = framesB[column - 1];
      const index = row * stride + column;
      const diagonal = costs[index - stride - 1];
      const up = costs[index - stride] + 0.08;
      const left = costs[index - 1] + 0.08;
      const best = Math.min(diagonal, up, left);
      direction[index] = best === diagonal ? 0 : best === up ? 1 : 2;
      costs[index] = best
        + 0.55 * pitchDifference(a.pitch, b.pitch, offset)
        + 0.3 * Math.abs(a.level - b.level)
        + 0.15 * spectrumDifference(a.spectrum, b.spectrum);
    }
  }

  let pitchWeight = 0;
  let pitchError = 0;
  let timbreWeight = 0;
  let timbreError = 0;
  let row = count;
  let column = count;
  while (row > 0 && column > 0) {
    const a = framesA[row - 1];
    const b = framesB[column - 1];
    if (a.pitch !== null || b.pitch !== null) {
      const weight = Math.max(a.level, b.level);
      pitchWeight += weight;
      pitchError += weight * pitchDifference(a.pitch, b.pitch, offset);
    }
    const weight = Math.min(a.level, b.level);
    timbreWeight += weight;
    timbreError += weight * spectrumDifference(a.spectrum, b.spectrum);
    const move = direction[row * stride + column];
    if (move !== 2) row--;
    if (move !== 1) column--;
  }

  return {
    pitch: pitchWeight ? 1 - pitchError / pitchWeight : 1,
    timbre: timbreWeight ? 1 - timbreError / timbreWeight : 0,
  };
}

export function compareClips(reference: VoiceFeatures, attempt: VoiceFeatures): VoiceSimilarity {
  if (!reference.usable || !attempt.usable) return { score: 0, pitch: 0, rhythm: 0, timbre: 0, duration: 0 };
  // Limit alignment to nearby frames on a shared time grid. Rhythm is scored before alignment.
  const bins = waveformBins;
  const resample = (clip: VoiceFeatures) => Array.from({ length: bins }, (_, index) =>
    clip.frames[Math.floor((index + 0.5) * clip.frames.length / bins)],
  );
  const a = resample(reference);
  const b = resample(attempt);
  const voiced = (frames: VoiceFrame[]) => frames.flatMap(frame => frame.pitch === null ? [] : [frame.pitch]).sort((x, y) => x - y);
  const pitchesA = voiced(a);
  const pitchesB = voiced(b);
  const usePitch = Math.max(pitchesA.length, pitchesB.length) >= bins * 0.15;
  const offset = pitchesA.length && pitchesB.length ? clamp(median(pitchesB) - median(pitchesA), -6, 6) : 0;
  const aligned = compareFrames(a, b, offset);

  let levelError = 0;
  let levelTotal = 0;
  for (let i = 0; i < bins; i++) {
    levelError += Math.abs(a[i].level - b[i].level);
    levelTotal += Math.max(a[i].level, b[i].level);
  }
  const pitch = usePitch ? aligned.pitch : 1;
  const rhythm = levelTotal > 0 ? clamp(1 - 1.3 * levelError / levelTotal) : 0;
  const timbre = aligned.timbre;
  const duration = clamp(1 - 0.6 * Math.abs(Math.log2(attempt.duration / reference.duration)));
  const score = usePitch
    ? 0.42 * pitch + 0.28 * rhythm + 0.2 * timbre + 0.1 * duration
    : 0.4 * rhythm + 0.4 * timbre + 0.2 * duration;
  const percent = (value: number) => Math.round(clamp(value) * 100);
  return { score: percent(score), pitch: percent(pitch), rhythm: percent(rhythm), timbre: percent(timbre), duration: percent(duration) };
}
