import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, Field } from './ui.tsx';
import { requestVoiceInput, voiceError, voiceWav, type VoiceRecording } from './voice-capture.ts';

type DevicePreferences = { inputId: string; outputId: string };
const storageKeys = { inputId: 'party.voice.inputId', outputId: 'party.voice.outputId' };

function savedDevice(key: string) {
  try { return window.localStorage.getItem(key) ?? ''; } catch { return ''; }
}

let preferences: DevicePreferences = { inputId: savedDevice(storageKeys.inputId), outputId: savedDevice(storageKeys.outputId) };
const subscribers = new Set<() => void>();

function subscribe(listener: () => void) {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}

function preferredDevices() {
  return preferences;
}

function setPreferredDevice(key: keyof DevicePreferences, id: string) {
  if (preferences[key] === id) return;
  preferences = { ...preferences, [key]: id };
  try { window.localStorage.setItem(storageKeys[key], id); } catch { /* Use the in-memory selection. */ }
  for (const listener of subscribers) listener();
}

const setInputId = (id: string) => setPreferredDevice('inputId', id);
const setOutputId = (id: string) => setPreferredDevice('outputId', id);

export function useVoiceHardware() {
  const selection = useSyncExternalStore(subscribe, preferredDevices, preferredDevices);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [testing, setTesting] = useState(false);
  const [outputError, setOutputError] = useState('');
  const refreshVersion = useRef(0);
  const permissionRequest = useRef<AbortController | null>(null);
  const playback = useRef<AbortController | null>(null);
  const stopTest = useCallback(() => playback.current?.abort(), []);

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    try {
      const media = navigator.mediaDevices;
      if (!media?.enumerateDevices) throw new DOMException('Audio devices unavailable', 'NotSupportedError');
      const result = await media.enumerateDevices();
      if (refreshVersion.current === version) {
        setDevices(result);
        setError('');
      }
    } catch (error) {
      if (refreshVersion.current === version) setError(voiceError(error));
    }
  }, []);

  useEffect(() => {
    const media = navigator.mediaDevices;
    void refresh();
    media?.addEventListener('devicechange', refresh);
    return () => {
      refreshVersion.current++;
      media?.removeEventListener('devicechange', refresh);
      permissionRequest.current?.abort();
      permissionRequest.current = null;
    };
  }, [refresh]);

  useEffect(() => () => stopTest(), [stopTest, selection.outputId]);

  async function testOutput() {
    if (playback.current) return;
    const controller = new AbortController();
    playback.current = controller;
    setOutputError('');
    setTesting(true);
    try {
      const sound = await playVoiceRecording(testTone(), selection.outputId, controller.signal);
      await sound.ended;
    } catch (error) {
      if (!controller.signal.aborted) setOutputError(voiceError(error, 'output'));
    } finally {
      playback.current = null;
      setTesting(false);
    }
  }

  async function unlock() {
    if (permissionRequest.current) return;
    const request = new AbortController();
    permissionRequest.current = request;
    setChecking(true);
    setError('');
    try {
      const stream = await requestVoiceInput('', request.signal);
      const stop = () => { for (const track of stream.getTracks()) track.stop(); };
      request.signal.addEventListener('abort', stop, { once: true });
      try {
        if (!request.signal.aborted) await refresh();
      } finally {
        request.signal.removeEventListener('abort', stop);
        stop();
      }
    } catch (error) {
      if (!request.signal.aborted) setError(voiceError(error));
    } finally {
      if (permissionRequest.current === request) {
        permissionRequest.current = null;
        setChecking(false);
      }
    }
  }

  return {
    ...selection, setInputId, refresh, unlock, checking, error, testing, outputError, testOutput, stopTest,
    setOutputId(id: string) { setOutputId(id); setOutputError(''); },
    inputs: devices.filter(device => device.kind === 'audioinput'),
    outputs: devices.filter(device => device.kind === 'audiooutput'),
  };
}

export type VoiceHardware = ReturnType<typeof useVoiceHardware>;

export async function playVoiceRecording(recording: VoiceRecording, outputId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const audio = new Audio();
  let objectUrl: string | undefined;
  let stopped = false;
  let resolveEnded: () => void;
  let rejectEnded: (error: Error) => void;
  const ended = new Promise<void>((resolve, reject) => {
    resolveEnded = resolve;
    rejectEnded = reject;
  });
  // A media error can occur before the caller receives its playback handle.
  void ended.catch(() => {});

  function finish(error?: Error) {
    if (stopped) return;
    stopped = true;
    signal?.removeEventListener('abort', stop);
    audio.removeEventListener('ended', stop);
    audio.removeEventListener('error', playbackError);
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (error) rejectEnded(error);
    else resolveEnded();
  }

  function stop() { finish(); }
  function playbackError() { finish(new Error('音频播放中断，请检查扬声器或耳机。')); }

  signal?.addEventListener('abort', stop, { once: true });
  audio.addEventListener('ended', stop);
  audio.addEventListener('error', playbackError);
  try {
    if (outputId) {
      if (typeof audio.setSinkId !== 'function') throw new DOMException('Audio output selection unavailable', 'NotSupportedError');
      await audio.setSinkId(outputId);
    }
    signal?.throwIfAborted();
    objectUrl = URL.createObjectURL(voiceWav(recording));
    audio.src = objectUrl;
    await audio.play();
    signal?.throwIfAborted();
    return { stop, ended };
  } catch (error) {
    stop();
    throw error;
  }
}

function DeviceOptions({ devices, selected, kind }: { devices: MediaDeviceInfo[]; selected: string; kind: 'input' | 'output' }) {
  const input = kind === 'input';
  const label = input ? '麦克风' : '输出设备';
  const named = devices.filter(device => device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications');
  return <>
    <option value="">{input ? 'Windows 默认麦克风' : 'Windows 默认输出'}</option>
    {selected && !named.some(device => device.deviceId === selected) && <option value={selected} disabled>已保存的{label}（暂不可用）</option>}
    {named.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${label} ${index + 1}`}</option>)}
  </>;
}

function testTone(): VoiceRecording {
  const sampleRate = 24_000;
  const count = sampleRate * 0.35;
  const fadeSamples = sampleRate * 0.025;
  return { sampleRate, samples: Float32Array.from({ length: count }, (_, index) => {
    const envelope = Math.min(1, index / fadeSamples, (count - 1 - index) / fadeSamples);
    return 0.14 * envelope * Math.sin(2 * Math.PI * 660 * index / sampleRate);
  }) };
}

export function VoiceHardwareControls({ hardware, disabled = false, inputLocked = false }: {
  hardware: VoiceHardware;
  disabled?: boolean;
  inputLocked?: boolean;
}) {
  const { inputs, outputs, inputId, outputId, checking, testing, outputError, stopTest } = hardware;
  useEffect(() => () => stopTest(), [stopTest]);
  useEffect(() => { if (disabled) stopTest(); }, [disabled, stopTest]);
  const busy = disabled || checking || testing;
  return <div className="voice-hardware">
    <div className="voice-device-selects">
      <Field label="输入设备 · 麦克风">
        <select value={inputId} disabled={busy || inputLocked} onChange={event => hardware.setInputId(event.target.value)}>
          <DeviceOptions devices={inputs} selected={inputId} kind="input" />
        </select>
      </Field>
      <Field label="输出设备 · 扬声器 / 耳机">
        <select value={outputId} disabled={busy} onChange={event => hardware.setOutputId(event.target.value)}>
          <DeviceOptions devices={outputs} selected={outputId} kind="output" />
        </select>
      </Field>
    </div>
    <div className="button-row">
      <Button variant="secondary" disabled={busy} onClick={() => void hardware.refresh()}>刷新设备</Button>
      <Button variant="secondary" disabled={busy} onClick={() => void hardware.unlock()}>{checking ? '正在检查麦克风…' : '允许麦克风并读取设备'}</Button>
      <Button variant="secondary" disabled={busy} onClick={() => void hardware.testOutput()}>{testing ? '正在播放测试音…' : '试听输出'}</Button>
    </div>
    {(hardware.error || outputError) && <p role="alert" className="notice error">{outputError || hardware.error}</p>}
  </div>;
}
