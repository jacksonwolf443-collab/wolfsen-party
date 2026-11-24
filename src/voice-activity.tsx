import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AudioLines, LockKeyhole, Mic, Monitor, Play, RotateCcw, Square, Trophy, UsersRound } from 'lucide-react';
import { isEligible, type Player } from './domain';
import { api, Avatar, Button, Field, Panel, type Context } from './ui';
import { analyzeClip, compareClips, pitchNote, stablePeak, type PitchFrame, type VoiceFeatures, type VoiceSimilarity } from './voice-analysis.ts';
import { startVoiceCapture, voiceError, type VoiceRecording } from './voice-capture.ts';
import { playVoiceRecording, useVoiceHardware, VoiceHardwareControls } from './voice-hardware.tsx';

type VoiceGame = 10 | 11;
type Target = { kind: 'reference' } | { kind: 'player'; id: string };
type Readout = { hz: number | null; db: number; peak: number | null; trace: (number | null)[] };
type Clip = { recording: VoiceRecording; features: VoiceFeatures };
type Attempt = { kind: 'pitch'; reading: Readout } | { kind: 'imitation'; clip: Clip; score: VoiceSimilarity };
type AudioView = { target: Target; phase: 'opening' | 'recording' | 'finishing' | 'playing' };
type Capture = {
  kind: 'capture';
  target: Target;
  controller: AbortController;
  handle?: Awaited<ReturnType<typeof startVoiceCapture>>;
  reading: Readout;
  finishing: boolean;
  limitReached: boolean;
};
type Operation = Capture | { kind: 'play'; controller: AbortController };
type Award = { eventId: string; winnerId: string; winnerName: string; round: number; task: string };
type Feedback = { area: Target['kind'] | 'score'; text: string; error: boolean };
type StageRow = { id: string; name: string; number: string; value: number | null; rank: number; awarded: boolean };
type VoiceScreen = {
  round: number;
  status: string;
  currentName?: string;
  reading: Readout;
  referenceWave?: number[];
  attemptWave?: number[];
  similarity?: VoiceSimilarity;
  rows: StageRow[];
};

const games = {
  10: { name: '谁叫的最高', description: '同一轮逐人挑战，用能稳定识别的最高音高排名。', unit: 'Hz', code: 'PITCH CHALLENGE' },
  11: { name: '谁叫得最像', description: '先录一段原声 A，再用同一支麦克风逐人模仿。', unit: '分', code: 'ECHO CHALLENGE' },
};
const limitSeconds = 12;
const traceFrames = 191;
const referenceTarget = { kind: 'reference' } as const;
const emptyReading: Readout = { hz: null, db: -120, peak: null, trace: [] };

// The full-screen stage shares this renderer with the mounted host. It reads
// display summaries from memory without calling a recording or persistence API.
const screens = new Map<VoiceGame, VoiceScreen>();
const screenListeners = new Set<() => void>();
function subscribeScreen(listener: () => void) {
  screenListeners.add(listener);
  return () => { screenListeners.delete(listener); };
}
function publishScreen(activity: VoiceGame, screen?: VoiceScreen) {
  if (screen) screens.set(activity, screen);
  else screens.delete(activity);
  for (const listener of screenListeners) listener();
}

const matchingTarget = (target: Target, audio: AudioView | null) => audio?.target.kind === target.kind
  && (target.kind === 'reference' || (audio.target.kind === 'player' && audio.target.id === target.id));
const eligibleName = (player: Pick<Player, 'name' | 'number'>) => `#${player.number} ${player.name}`;
const toMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败，请重试。';
const points = (attempt?: Attempt) => !attempt ? null
  : attempt.kind === 'imitation' ? attempt.score.score
    : Math.round((attempt.reading.peak ?? 0) * 10) / 10;
const formatPoints = (value: number, activity: VoiceGame) => value.toFixed(activity === 10 ? 1 : 0);

function PitchTrace({ trace }: { trace: Readout['trace'] }) {
  const levels = [2000, 1000, 500, 250, 125, 65];
  const x = (i: number) => 50 + (traceFrames - trace.length + i) * (538 / (traceFrames - 1));
  const y = (hz: number) => 126 - Math.log2(Math.max(65, Math.min(2500, hz)) / 65) / Math.log2(2500 / 65) * 118;
  let linked = false;
  const path = trace.map((hz, index) => {
    const previous = linked;
    linked = hz !== null;
    return hz === null ? '' : `${previous ? 'L' : 'M'}${x(index).toFixed(1)},${y(hz).toFixed(1)}`;
  }).join(' ');
  const last = trace.at(-1);
  return <svg className="voice-trace" role="img" aria-label="最近 8 秒实时音高曲线" viewBox="0 0 600 148">
    {levels.map(hz => <g key={hz}><line x1="50" x2="588" y1={y(hz)} y2={y(hz)} /><text x="42" y={y(hz) + 3} textAnchor="end">{hz}</text></g>)}
    {[50, 184.5, 319, 453.5, 588].map(at => <line key={at} x1={at} x2={at} y1="8" y2="126" />)}
    <path d={path} fill="none" />
    {last != null && <circle cx={x(trace.length - 1)} cy={y(last)} r="3.2" />}
    <text x="50" y="143">−8 秒</text><text x="319" y="143" textAnchor="middle">−4 秒</text><text x="588" y="143" textAnchor="end">现在</text>
  </svg>;
}

function Waveform({ values, label, variant = 'reference' }: { values?: number[]; label: string; variant?: 'reference' | 'attempt' }) {
  return <svg className={`voice-waveform ${variant}`} role="img" aria-label={label} viewBox="0 0 384 62" preserveAspectRatio="none">
    <line className="voice-wave-baseline" x1="0" x2="384" y1="31" y2="31" />
    {values?.map((value, i) => {
      const x = (i + 0.5) * 384 / values.length;
      const height = 0.7 + value * 26.3;
      return <line key={i} x1={x} x2={x} y1={31 - height} y2={31 + height} />;
    })}
  </svg>;
}

function LevelMeter({ db }: { db: number }) {
  const level = Math.max(0, Math.min(100, (db + 60) * 100 / 60));
  return <div className="voice-level">
    <div><span>响度 · RMS</span><strong>{db <= -120 ? '—' : db.toFixed(1)} <small>dBFS</small></strong></div>
    <meter min={0} max={100} low={20} high={85} optimum={63} value={level} aria-label="麦克风 RMS 响度" />
  </div>;
}

function PitchDisplay({ reading }: { reading: Readout }) {
  return <div className="voice-pitch-display">
    <div className="voice-metrics">
      <div className="voice-pitch-readout"><span>当前音高</span><strong>{reading.hz?.toFixed(1) ?? '—'} <small>Hz</small></strong></div>
      <div className="voice-pitch-readout"><span>当前音名</span><strong>{reading.hz === null ? '—' : pitchNote(reading.hz)}</strong></div>
      <div className="voice-pitch-readout peak"><span>稳定最高音</span><strong>{reading.peak?.toFixed(1) ?? '—'} <small>Hz</small></strong>{reading.peak !== null && <small>{pitchNote(reading.peak)}</small>}</div>
    </div>
    <PitchTrace trace={reading.trace} />
    <LevelMeter db={reading.db} />
  </div>;
}

function SimilarityBreakdown({ score }: { score: VoiceSimilarity }) {
  const dimensions = [
    ['音高', score.pitch], ['节奏', score.rhythm], ['音色', score.timbre], ['时长', score.duration],
  ] as const;
  return <div className="voice-breakdown">
    <div className="voice-similarity-total"><span>相似度</span><strong>{score.score}<small> / 100</small></strong></div>
    <div className="voice-similarity-details">{dimensions.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong><progress max={100} value={value} aria-label={label} /></div>)}</div>
  </div>;
}

export function VoiceActivity({ ctx, activity }: { ctx: Context; activity: VoiceGame }) {
  return <VoiceRound key={`${activity}:${ctx.event?.id ?? ''}:${ctx.event?.resetEpoch ?? 0}`} ctx={ctx} activity={activity} />;
}

function VoiceRound({ ctx, activity }: { ctx: Context; activity: VoiceGame }) {
  const game = games[activity];
  const imitation = activity === 11;
  const hardware = useVoiceHardware();
  const [ids, setIds] = useState<string[]>([]);
  const [currentId, setCurrentId] = useState('');
  const [reference, setReference] = useState<Clip | null>(null);
  const [referenceLocked, setReferenceLocked] = useState(false);
  const [lockedMic, setLockedMic] = useState('');
  const [attempts, setAttempts] = useState<Record<string, Attempt>>({});
  const [audio, setAudio] = useState<AudioView | null>(null);
  const [live, setLive] = useState(emptyReading);
  const [round, setRound] = useState<number | null>(null);
  const [roundEventId, setRoundEventId] = useState(() => crypto.randomUUID());
  const [choice, setChoice] = useState('');
  const [proposal, setProposal] = useState<Award | null>(null);
  const [winner, setWinner] = useState<Award | null>(null);
  const [awarding, setAwarding] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const operation = useRef<Operation | null>(null);
  const awardLock = useRef(false);
  const mounted = useRef(false);

  const eligible = useMemo(() => ctx.players.filter(isEligible), [ctx.players]);
  const selected = useMemo(() => eligible.filter(player => ids.includes(player.id)), [eligible, ids]);
  const current = selected.find(player => player.id === currentId) ?? selected[0];
  const currentAttempt = current ? attempts[current.id] : undefined;
  const pitch = !audio && currentAttempt?.kind === 'pitch' ? currentAttempt.reading : live;
  const attemptClip = currentAttempt?.kind === 'imitation' ? currentAttempt.clip : null;
  const board = useMemo(() => {
    const rows = selected.map(player => ({ player, value: points(attempts[player.id]) }))
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    let rank = 1;
    return rows.map((row, index) => {
      if (index > 0 && row.value !== rows[index - 1].value) rank = index + 1;
      return { ...row, rank };
    });
  }, [selected, attempts]);
  const leaders = board.filter(row => row.value !== null && row.value === board[0]?.value);
  const candidate = leaders.length === 1 ? leaders[0] : leaders.find(row => row.player.id === choice);
  const nextPending = selected.find(player => player.id !== current?.id && !attempts[player.id]);
  const complete = board.length > 0 && board.every(row => row.value !== null);
  const lockedMicName = hardware.inputs.find(device => device.deviceId === lockedMic)?.label;
  const deviceBusy = hardware.checking || hardware.testing;
  const frozen = !!(winner || proposal || awarding || ctx.busy);
  const actionBlocked = !!audio || deviceBusy || frozen;
  const replayBlocked = !!audio || deviceBusy || awarding || !!ctx.busy;

  async function loadRound() {
    setHistoryError('');
    try {
      const result = await api('game/win/list', { activity });
      const latest = (result.events ?? []).reduce((highest: number, event: { round: number | string }) => {
        const number = Number(event.round);
        return Number.isSafeInteger(number) && number >= 1 ? Math.max(number, highest) : highest;
      }, 0);
      if (mounted.current) setRound(latest + 1);
    } catch (error) {
      if (mounted.current) setHistoryError(toMessage(error));
    }
  }

  useEffect(() => {
    mounted.current = true;
    void loadRound();
    return () => {
      mounted.current = false;
      operation.current?.controller.abort();
      operation.current = null;
      publishScreen(activity);
    };
  }, [activity]);

  const audioStatus = audio && {
    opening: '正在打开麦克风',
    finishing: '正在处理录音',
    recording: audio.target.kind === 'reference' ? '正在录制原声 A' : '正在录音',
    playing: audio.target.kind === 'reference' ? '正在播放原声 A' : '正在回听模仿',
  }[audio.phase];
  const status = winner ? `${winner.winnerName} 获胜 · 已加 1 分`
    : audioStatus ?? (complete ? '本轮录制完成 · 等待确认获胜者'
      : imitation && !reference ? '等待主持人录制原声 A' : '等待参赛者录音');
  useEffect(() => {
    if (round === null) return;
    publishScreen(activity, {
      round, status, currentName: current?.name, reading: pitch,
      referenceWave: reference?.features.waveform, attemptWave: attemptClip?.features.waveform,
      similarity: currentAttempt?.kind === 'imitation' ? currentAttempt.score : undefined,
      rows: board.map(({ player, value, rank }) => ({ id: player.id, name: player.name, number: player.number, value, rank, awarded: winner?.winnerId === player.id })),
    });
  }, [activity, round, status, current?.name, pitch, reference, attemptClip, currentAttempt, board, winner]);

  function clearOperation() {
    const active = operation.current;
    operation.current = null;
    active?.controller.abort();
    setAudio(null);
    setLive(emptyReading);
  }

  function captureError(active: Capture, error: unknown) {
    if (operation.current !== active) return;
    clearOperation();
    setFeedback({ area: active.target.kind, text: voiceError(error), error: true });
  }

  async function finishCapture(active: Capture) {
    if (operation.current !== active || !active.handle || active.finishing) return;
    active.finishing = true;
    setAudio({ target: active.target, phase: 'finishing' });
    try {
      const recording = await active.handle.stop();
      if (operation.current !== active) return;
      const target = active.target;
      if (!imitation && target.kind === 'player') {
        if (active.reading.peak === null) {
          setFeedback({ area: target.kind, text: '这次没有检测到稳定音高。请靠近麦克风，在安静环境中延长发声后重试。', error: true });
          return;
        }
        const attempt: Attempt = { kind: 'pitch', reading: active.reading };
        setAttempts(previous => ({ ...previous, [target.id]: attempt }));
      } else {
        const features = analyzeClip(recording.samples, recording.sampleRate);
        if (!features.usable) {
          setFeedback({ area: target.kind, text: '这次没有检测到有效声音。请在安静环境中靠近麦克风发声，并在结束后停顿片刻。', error: true });
          return;
        }
        const clip = { recording, features };
        if (target.kind === 'reference') setReference(clip);
        else if (reference) {
          const attempt: Attempt = { kind: 'imitation', clip, score: compareClips(reference.features, features) };
          setAttempts(previous => ({ ...previous, [target.id]: attempt }));
        }
      }
      if (active.handle.inputDeviceId && !lockedMic) {
        setLockedMic(active.handle.inputDeviceId);
        void hardware.refresh();
      }
      setChoice('');
      setFeedback({ area: target.kind, text: active.limitReached ? `已达到 ${limitSeconds} 秒上限，录音结果已保留。` : '录音结果已就绪。', error: false });
    } catch (error) {
      if (operation.current === active) setFeedback({ area: active.target.kind, text: voiceError(error), error: true });
    } finally {
      if (operation.current === active) clearOperation();
    }
  }

  async function record(target: Target) {
    if (operation.current || awardLock.current || actionBlocked || round === null) return;
    if (target.kind === 'reference' ? referenceLocked : imitation && !reference) return;
    const active: Capture = {
      kind: 'capture', target, controller: new AbortController(), reading: emptyReading, finishing: false, limitReached: false,
    };
    operation.current = active;
    setAudio({ target, phase: 'opening' });
    setFeedback(null);
    setLive(emptyReading);
    try {
      const handle = await startVoiceCapture(lockedMic || hardware.inputId, frame => {
        if (operation.current !== active || active.finishing) return;
        const { hz, db }: PitchFrame = frame;
        const trace = [...active.reading.trace.slice(1 - traceFrames), hz];
        const best = imitation ? null : stablePeak(trace.slice(-4));
        const peak = best === null ? active.reading.peak : Math.max(active.reading.peak ?? 0, best);
        active.reading = { hz, db, peak, trace };
        setLive(active.reading);
      }, {
        signal: active.controller.signal,
        maxSeconds: limitSeconds,
        onLimit: () => {
          active.limitReached = true;
          void finishCapture(active);
        },
        onError: error => captureError(active, error),
      });
      if (operation.current !== active) {
        handle.cancel();
        return;
      }
      if (imitation && !handle.inputDeviceId) {
        throw new Error('未能确认 Windows 默认麦克风对应的设备。请允许麦克风权限并在输入列表中选择一支具体麦克风。');
      }
      if (lockedMic && handle.inputDeviceId !== lockedMic) {
        throw new Error('本轮锁定的麦克风不可用。请重新连接原设备，或重置本轮后更换麦克风。');
      }
      active.handle = handle;
      if (imitation && target.kind === 'player') setReferenceLocked(true);
      if (active.limitReached) void finishCapture(active);
      else setAudio({ target, phase: 'recording' });
    } catch (error) {
      captureError(active, error);
    }
  }

  async function play(target: Target, clip: Clip) {
    if (operation.current || awardLock.current || replayBlocked) return;
    const active = { kind: 'play', controller: new AbortController() } as const;
    operation.current = active;
    setAudio({ target, phase: 'playing' });
    setFeedback(null);
    try {
      const playback = await playVoiceRecording(clip.recording, hardware.outputId, active.controller.signal);
      await playback.ended;
    } catch (error) {
      if (operation.current === active) setFeedback({ area: target.kind, text: voiceError(error, 'output'), error: true });
    } finally {
      if (operation.current === active) clearOperation();
    }
  }

  function resetRound() {
    if (awardLock.current || proposal || ctx.busy || deviceBusy) return;
    const message = winner
      ? '开始下一轮？本轮加分会保留，本轮录音和测量结果会清除。'
      : '重置本轮？本轮录音和测量结果会清除，可以重新选择麦克风。';
    if (!window.confirm(message)) return;
    clearOperation();
    setReference(null);
    setReferenceLocked(false);
    setLockedMic('');
    setAttempts({});
    setChoice('');
    setFeedback(null);
    if (winner) {
      setRound(winner.round + 1);
      setRoundEventId(crypto.randomUUID());
      setWinner(null);
    }
  }

  async function confirmWinner() {
    if (awardLock.current || operation.current || winner || deviceBusy || ctx.busy || round === null) return;
    const data = proposal ?? (complete && candidate && candidate.value !== null ? {
      eventId: roundEventId, round, winnerId: candidate.player.id, winnerName: candidate.player.name,
      task: `${game.name} · 第 ${round} 轮 · ${formatPoints(candidate.value, activity)} ${game.unit}`,
    } : null);
    if (!data) return;
    awardLock.current = true;
    setProposal(data);
    setAwarding(true);
    setFeedback(null);
    try {
      const result = await api('game/win', {
        partyEventId: ctx.event?.id, resetEpoch: ctx.event?.resetEpoch,
        eventId: data.eventId, activity, round: data.round, playerIds: [data.winnerId], task: data.task, version: 0,
      });
      if (result.event?.status !== 'active') throw new Error('积分状态未确认，请重试同一笔加分。');
      if (mounted.current) {
        setWinner(data);
        setProposal(null);
        setFeedback(null);
      }
    } catch (error) {
      if (mounted.current) {
        if ((error as { status?: number })?.status === 400) setProposal(null);
        setFeedback({ area: 'score', text: toMessage(error), error: true });
      }
      return;
    } finally {
      awardLock.current = false;
      if (mounted.current) setAwarding(false);
    }
    await ctx.refresh(true);
    if (mounted.current) ctx.tell(`${data.winnerName} 获胜，已加 1 分`);
  }

  function changePlayers(next: string[]) {
    setIds(next);
    setChoice('');
    setFeedback(null);
  }

  function changeCurrent(id: string) {
    setCurrentId(id);
    setLive(emptyReading);
    setFeedback(previous => previous?.area === 'score' ? previous : null);
  }

  function feedbackFor(area: Feedback['area']) {
    if (feedback?.area !== area) return null;
    return <p className={`notice voice-feedback${feedback.error ? ' error' : ''}`} role={feedback.error ? 'alert' : 'status'}>{feedback.text}</p>;
  }

  function recordControls(target: Target, disabled: boolean, previous: boolean, clip?: Clip | null) {
    const same = matchingTarget(target, audio);
    const isReference = target.kind === 'reference';
    if (same && audio.phase === 'recording') return <div className="button-row voice-transport">
      <Button variant="danger" onClick={() => { const active = operation.current; if (active?.kind === 'capture') void finishCapture(active); }}><Square size={15} />{isReference ? '停止并保存原声' : '停止并评分'}</Button>
      <Button variant="ghost" onClick={clearOperation}>取消录音</Button>
      {!imitation && ctx.enterStage && <Button variant="secondary" onClick={ctx.enterStage}><Monitor size={16} />投屏实时音高</Button>}
    </div>;
    if (same && audio.phase === 'opening') return <div className="button-row voice-transport">
      <span role="status">正在打开麦克风…</span><Button variant="ghost" onClick={clearOperation}>取消录音</Button>
    </div>;
    if (same && audio.phase === 'finishing') return <div className="voice-transport" role="status">正在处理录音…</div>;
    if (same && audio.phase === 'playing') return <div className="button-row voice-transport"><Button variant="secondary" onClick={clearOperation}><Square size={15} />停止播放</Button></div>;
    return <div className="button-row voice-transport">
      {(!isReference || !referenceLocked) && <Button disabled={disabled} onClick={() => void record(target)}>
        <Mic size={16} />{isReference ? previous ? '重录原声 A' : '录制原声 A' : previous ? '重新录音' : '开始录音'}
      </Button>}
      {clip && <Button variant="secondary" disabled={replayBlocked} onClick={() => void play(target, clip)}>
        <Play size={16} />{isReference ? '播放原声 A' : '播放本次模仿'}
      </Button>}
    </div>;
  }

  return <section className="voice-activity">
    <header className="voice-hero">
      <div className="voice-hero-mark"><AudioLines size={34} strokeWidth={1.5} /></div>
      <div><span className="eyebrow">MISSION {activity} / 11 · {game.code}</span><h1>{game.name}</h1><p>{game.description}</p></div>
      <div className="voice-hero-actions">
        <span className="voice-round-label">{round === null ? '准备本轮' : `第 ${round} 轮`}</span>
        {ctx.enterStage && <Button variant="secondary" onClick={ctx.enterStage}><Monitor size={16} />舞台展示</Button>}
      </div>
    </header>
    {historyError && <div className="notice error" role="alert"><span>本轮编号读取失败。{historyError}</span><Button variant="secondary" onClick={() => void loadRound()}>重新读取</Button></div>}
    <Panel title="声音设备" className="voice-device-panel" tag={lockedMic ? '本轮麦克风已锁定' : '先检查麦克风与播放设备'}>
      <VoiceHardwareControls hardware={hardware} inputLocked={!!lockedMic} disabled={!!audio || awarding} />
      {lockedMic && <p className="voice-help"><LockKeyhole size={14} />{lockedMicName ? `本轮麦克风为「${lockedMicName}」。` : '本轮后续录音使用同一支麦克风。'}需要换设备时，请重置本轮。</p>}
    </Panel>
    <Panel title="本轮参赛玩家" className="voice-player-panel" tag={`已选 ${selected.length} 人`}
      action={<div className="voice-roster-actions">
        <Button variant="ghost" disabled={actionBlocked || selected.length === eligible.length} onClick={() => changePlayers(eligible.map(player => player.id))}>全选到场玩家</Button>
        <Button variant="ghost" disabled={actionBlocked || !selected.length} onClick={() => changePlayers([])}>取消全选</Button>
      </div>}>
      {!eligible.length ? <p className="voice-help"><UsersRound size={17} />暂无到场玩家。请先到玩家档案办理签到。</p>
        : <div className="voice-roster" aria-label="选择到场参赛玩家">{eligible.map(player => <label key={player.id}>
          <input type="checkbox" checked={ids.includes(player.id)} disabled={actionBlocked} onChange={event => changePlayers(event.target.checked ? [...ids, player.id] : ids.filter(id => id !== player.id))} />
          <Avatar player={player} size={30} /><span>{player.name}<small>#{player.number}</small></span>
        </label>)}</div>}
    </Panel>
    <div className="voice-layout">
      <div className="voice-studio">
        {imitation && <Panel title="原声 A" className="voice-reference-panel" tag={referenceLocked ? '同一段原声已锁定' : reference ? '原声已录制' : '本轮统一参考'}>
          <Waveform values={reference?.features.waveform} label="原声 A 波形" />
          <p className="voice-help">{referenceLocked ? '所有人听同一段原声 A。重置本轮后可以换原声。' : reference ? '参赛者开始录音后会锁定这段原声。' : '录一段供本轮所有参赛者模仿的声音。'}</p>
          {recordControls(referenceTarget, actionBlocked || round === null, !!reference, reference)}
          {feedbackFor('reference')}
        </Panel>}
        <Panel title={imitation ? '录制模仿 B' : '音高监测'} className="voice-player-studio" tag={imitation ? '0–100 分' : '音高 · 音名 · 响度'}>
          <div className="voice-contestant">
            <Field label="当前录音玩家"><select value={current?.id ?? ''} disabled={!!audio || !selected.length || awarding} onChange={event => changeCurrent(event.target.value)}>
              {!selected.length && <option value="">请先选择到场玩家</option>}
              {selected.map(player => <option key={player.id} value={player.id}>{eligibleName(player)}</option>)}
            </select></Field>
            {nextPending && <Button variant="secondary" disabled={actionBlocked} onClick={() => changeCurrent(nextPending.id)}>下一位待录</Button>}
          </div>
          {imitation ? <>
            <Waveform values={attemptClip?.features.waveform} label="当前玩家模仿波形" variant="attempt" />
            {audio?.phase === 'recording' && <LevelMeter db={live.db} />}
            {currentAttempt?.kind === 'imitation' && <SimilarityBreakdown score={currentAttempt.score} />}
            {!reference && <p className="voice-help">录好原声 A 后即可开始模仿。</p>}
          </> : <PitchDisplay reading={pitch} />}
          {current && recordControls({ kind: 'player', id: current.id }, actionBlocked || round === null || imitation && !reference, !!currentAttempt, attemptClip)}
          {feedbackFor('player')}
          <p className="voice-help">{imitation ? '录音上限 12 秒。模仿前先听原声，播放结束后再录音。' : '录音上限 12 秒。请持续发声，排名按稳定最高音，响度仅供参考。'}</p>
        </Panel>
      </div>
      <Panel title="本轮排名" className="voice-board" tag={`${board.filter(row => row.value !== null).length} / ${board.length} 已评分`}>
        {!board.length && <p className="voice-help">勾选一位或多位到场玩家开始本轮。</p>}
        <ol className="voice-ranking">
          {board.map(({ player, value, rank }) => <li key={player.id} className={winner?.winnerId === player.id ? 'awarded' : ''}>
            <span className="voice-rank-number">{value === null ? '—' : rank}</span>
            <Avatar player={player} size={33} />
            <span className="voice-rank-player"><b>{player.name}</b><small>#{player.number}</small></span>
            <span className="voice-rank-score">{value === null ? '待录音' : <><b>{formatPoints(value, activity)}</b><small> {game.unit}</small></>}</span>
          </li>)}
        </ol>
        {complete && leaders.length > 1 && !winner && <fieldset className="voice-tie" disabled={actionBlocked}>
          <legend>最高成绩并列 · 请选择一位获胜者</legend>
          {leaders.map(({ player }) => <label key={player.id}><input type="radio" name="voice-tie" checked={choice === player.id} onChange={() => setChoice(player.id)} />{eligibleName(player)}</label>)}
        </fieldset>}
        {winner ? <p className="voice-winner" role="status"><Trophy size={21} /><span><strong>{winner.winnerName}</strong> 获胜 · 已加 1 分</span></p>
          : <Button className="voice-award-button" disabled={awarding || replayBlocked || round === null || (!proposal && (!complete || !candidate))}
            onClick={() => void confirmWinner()}><Trophy size={16} />{awarding ? '正在确认积分…' : proposal ? '重试确认并加分' : '确认获胜并加 1 分'}</Button>}
        {feedbackFor('score')}
        {!complete && board.length > 0 && <p className="voice-help">每位已选玩家都有有效成绩后，才可确认获胜者。</p>}
      </Panel>
    </div>
    <footer className="voice-footer">
      <p>录音与测量结果仅保留在当前活动页。切换活动或退出程序会清除临时内容，已确认的积分会保留。</p>
      <Button variant="secondary" disabled={round === null || !!proposal || awarding || deviceBusy || !!ctx.busy} onClick={resetRound}><RotateCcw size={16} />{winner ? '开始下一轮' : '重置本轮'}</Button>
    </footer>
  </section>;
}

export function VoiceStage({ screen }: { screen: { activity?: number } }) {
  const activity = screen.activity === 11 ? 11 : 10;
  const view = useSyncExternalStore(subscribeScreen, () => screens.get(activity), () => undefined);
  const game = games[activity];
  return <section className="voice-stage">
    <header className="voice-stage-heading">
      <span className="eyebrow">MISSION {activity} · {game.code}</span>
      <h1>{game.name}</h1>
      <p>{view ? `第 ${view.round} 轮 · ${view.status}` : '等待主持人准备本轮'}</p>
    </header>
    {view && <div className="voice-stage-grid">
      <section className="voice-stage-display" aria-label="本轮声音图表">
        <h2>{view.currentName ?? '等候参赛者'}</h2>
        {activity === 10 ? <PitchDisplay reading={view.reading} /> : <>
          <div className="voice-stage-wave"><b>原声 A</b><Waveform values={view.referenceWave} label="舞台原声波形" /></div>
          <div className="voice-stage-wave"><b>模仿 B</b><Waveform values={view.attemptWave} label="舞台模仿波形" variant="attempt" /></div>
          {view.similarity && <SimilarityBreakdown score={view.similarity} />}
        </>}
      </section>
      <section className="voice-stage-results" aria-label="本轮排名">
        <h2>本轮排名</h2>
        {view.rows.length ? <ol className="voice-ranking">{view.rows.map(row => <li key={row.id} className={row.awarded ? 'awarded' : ''}>
          <span className="voice-rank-number">{row.value === null ? '—' : row.rank}</span>
          <span className="voice-rank-player"><b>{row.name}</b><small>#{row.number}</small></span>
          <span className="voice-rank-score">{row.value === null ? '待录音' : <><b>{formatPoints(row.value, activity)}</b><small> {game.unit}</small></>}</span>
        </li>)}</ol> : <p>等待主持人选择参赛玩家</p>}
      </section>
    </div>}
  </section>;
}
