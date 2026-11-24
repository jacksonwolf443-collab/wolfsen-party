import { pitchFrame, type PitchFrame } from './voice-analysis.ts';

export type VoiceRecording = { samples: Float32Array; sampleRate: number };

type CaptureOptions = {
  maxSeconds?: number;
  onLimit?: () => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
};

const captureLimitSeconds = 12;

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

export async function requestVoiceInput(deviceId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) throw new DOMException('Microphone capture unavailable', 'NotSupportedError');
  const request = devices.getUserMedia({ video: false, audio: {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    channelCount: { ideal: 1 },
    autoGainControl: false,
    noiseSuppression: false,
    echoCancellation: false,
  } });
  if (!signal) return request;

  // getUserMedia has no abort option. Release any stream granted after the caller leaves.
  return new Promise<MediaStream>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    request.then(stream => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) stopStream(stream);
      else resolve(stream);
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
    if (signal.aborted) abort();
  });
}

async function actualInputId(track: MediaStreamTrack, requestedId: string) {
  const { deviceId, groupId } = track.getSettings();
  if (deviceId && deviceId !== 'default' && deviceId !== 'communications') return deviceId;
  if (requestedId && requestedId !== 'default' && requestedId !== 'communications') return requestedId;

  // Chromium can report the default alias rather than a stable hardware ID.
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const candidates = devices.filter(device => device.kind === 'audioinput' && device.deviceId
    && device.deviceId !== 'default' && device.deviceId !== 'communications');
  const grouped = groupId ? candidates.filter(device => device.groupId === groupId) : [];
  if (grouped.length === 1) return grouped[0].deviceId;
  const named = track.label ? candidates.filter(device => device.label === track.label) : [];
  return named.length === 1 ? named[0].deviceId : '';
}

export async function startVoiceCapture(deviceId: string, onFrame: (frame: PitchFrame) => void, options: CaptureOptions = {}) {
  const { signal } = options;
  const stream = await requestVoiceInput(deviceId, signal);
  const track = stream.getAudioTracks()[0];
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  let muted: GainNode | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let closed: Promise<void> | undefined;
  let failure: Error | undefined;
  let discarded = false;

  function release() {
    if (closed) return closed;
    signal?.removeEventListener('abort', cancel);
    track?.removeEventListener('ended', disconnected);
    clearTimeout(timeout);
    if (processor) processor.onaudioprocess = null;
    source?.disconnect();
    processor?.disconnect();
    muted?.disconnect();
    stopStream(stream);
    closed = context && context.state !== 'closed' ? context.close().catch(() => {}) : Promise.resolve();
    return closed;
  }

  function cancel() {
    if (!closed) discarded = true;
    void release();
  }

  function fail(error: Error) {
    if (closed) return;
    failure = error;
    void release();
    options.onError?.(error);
  }

  function disconnected() {
    fail(new DOMException('Microphone disconnected', 'NotReadableError'));
  }

  function limit() {
    if (closed) return;
    void release();
    options.onLimit?.();
  }

  try {
    signal?.addEventListener('abort', cancel, { once: true });
    signal?.throwIfAborted();
    if (!track || track.readyState !== 'live') throw new DOMException('Microphone unavailable', 'NotReadableError');
    track.addEventListener('ended', disconnected, { once: true });
    const inputDeviceId = await actualInputId(track, deviceId);
    signal?.throwIfAborted();
    if (failure) throw failure;

    if (typeof AudioContext === 'undefined') throw new DOMException('Web Audio unavailable', 'NotSupportedError');
    const audioOptions: AudioContextOptions & { sinkId: { type: 'none' } } = { sinkId: { type: 'none' } };
    context = new AudioContext(audioOptions);
    const { sampleRate } = context;
    const maxSeconds = Number.isFinite(options.maxSeconds) && options.maxSeconds > 0
      ? Math.min(options.maxSeconds, captureLimitSeconds) : captureLimitSeconds;
    const samples = new Float32Array(Math.max(1, Math.floor(sampleRate * maxSeconds)));
    const frameStep = Math.round(sampleRate * 0.042);
    const frameSize = Math.round(sampleRate * 0.055);
    let nextFrame = frameStep;
    let captured = 0;
    let recording: VoiceRecording | undefined;

    // A muted ScriptProcessor keeps PCM capture working under the packaged file:// CSP.
    const bufferSize = 2 ** Math.max(8, Math.min(14, Math.round(Math.log2(sampleRate * 0.02))));
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(bufferSize, 1, 1);
    muted = context.createGain();
    muted.gain.value = 0;
    processor.onaudioprocess = event => {
      if (closed) return;
      try {
        const chunk = event.inputBuffer.getChannelData(0);
        const length = Math.min(chunk.length, samples.length - captured);
        samples.set(chunk.subarray(0, length), captured);
        captured += length;
        while (captured >= nextFrame && !closed) {
          const frame = samples.subarray(Math.max(0, nextFrame - frameSize), nextFrame);
          nextFrame += frameStep;
          onFrame(pitchFrame(frame, sampleRate));
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error('读取麦克风数据失败。'));
      }
      if (captured === samples.length) limit();
    };
    source.connect(processor);
    processor.connect(muted);
    muted.connect(context.destination);
    await context.resume();
    signal?.throwIfAborted();
    if (failure) throw failure;
    if (!closed) timeout = setTimeout(limit, maxSeconds * 1_000);

    return {
      inputDeviceId,
      async stop(): Promise<VoiceRecording> {
        await release();
        if (failure) throw failure;
        return recording ??= { samples: samples.slice(0, discarded ? 0 : captured), sampleRate };
      },
      cancel,
    };
  } catch (error) {
    await release();
    throw error;
  }
}

export function voiceWav({ samples, sampleRate }: VoiceRecording) {
  const sampleBytes = samples.length * 2;
  const bytes = new ArrayBuffer(44 + sampleBytes);
  const wav = new DataView(bytes);
  wav.setUint32(0, 0x52494646); // RIFF
  wav.setUint32(4, 36 + sampleBytes, true);
  wav.setUint32(8, 0x57415645); // WAVE
  wav.setUint32(12, 0x666d7420); // fmt
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, sampleRate, true);
  wav.setUint32(28, sampleRate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  wav.setUint32(36, 0x64617461); // data
  wav.setUint32(40, sampleBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    wav.setInt16(44 + i * 2, Math.round(sample * (sample < 0 ? 32_768 : 32_767)), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export function voiceError(error: unknown, mode: 'input' | 'output' = 'input'): string {
  const device = mode === 'input' ? '麦克风' : '扬声器或耳机';
  switch (error instanceof Error ? error.name : '') {
    case 'NotAllowedError':
    case 'SecurityError':
      return mode === 'input'
        ? '无法访问麦克风。请在 Windows「设置 → 隐私和安全性 → 麦克风」中开启麦克风访问和「允许桌面应用访问麦克风」，然后重试。'
        : '无法使用所选输出设备。请在 Windows「设置 → 系统 → 声音」中检查输出设备，然后重试。';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `未找到所选${device}。请检查连接、刷新设备列表并重新选择。`;
    case 'NotReadableError':
    case 'AbortError':
      return `${device}已断开或被占用。请检查连接，关闭占用设备的程序后重试。`;
    case 'NotSupportedError':
      return mode === 'input'
        ? '当前环境无法录音，请使用 Windows 桌面版并检查麦克风。'
        : '当前环境无法切换输出设备。请选择「Windows 默认输出」，或在 Windows 声音设置中更改输出。';
    default:
      return error instanceof Error && error.message ? error.message : `无法使用${device}，请检查设备连接后重试。`;
  }
}
