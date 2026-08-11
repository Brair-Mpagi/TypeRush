import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../sim/types';
import { Sfx } from './audio';

/**
 * jsdom has no WebAudio, which is itself worth testing: the game has to stay
 * playable, silently, when the API is missing or blocked. The rest is exercised
 * against a fake context that records what got scheduled.
 */

class FakeParam {
  setValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  setTargetAtTime = vi.fn();
  value = 0;
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  type = '';
  buffer: unknown = null;
  start = vi.fn();
  stop = vi.fn();
  connect = vi.fn((next: unknown) => next);
  disconnect = vi.fn();
}

class FakeAudioContext {
  static created = 0;
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  nodes: FakeNode[] = [];
  closed = false;

  constructor() {
    FakeAudioContext.created++;
  }
  private track(): FakeNode {
    const node = new FakeNode();
    this.nodes.push(node);
    return node;
  }
  createOscillator = () => this.track();
  createGain = () => this.track();
  createBiquadFilter = () => this.track();
  createBufferSource = () => this.track();
  createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) });
  resume = vi.fn(() => {
    this.state = 'running';
    return Promise.resolve();
  });
  close = vi.fn(() => {
    this.closed = true;
    return Promise.resolve();
  });
}

function withFakeAudio(): { last: () => FakeAudioContext } {
  const instances: FakeAudioContext[] = [];
  FakeAudioContext.created = 0;
  vi.stubGlobal(
    'AudioContext',
    class extends FakeAudioContext {
      constructor() {
        super();
        instances.push(this);
      }
    },
  );
  return { last: () => instances[instances.length - 1]! };
}

const typed = (correct: boolean): GameEvent => ({
  type: 'charTyped',
  wordId: 'w',
  key: 'a',
  correct,
  charIndex: 0,
  x: 10,
  y: 10,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Sfx', () => {
  it('stays silent and never throws when WebAudio is unavailable', () => {
    vi.stubGlobal('AudioContext', undefined);
    const sfx = new Sfx();
    sfx.resume();

    expect(() =>
      sfx.handleEvents([
        typed(true),
        typed(false),
        { type: 'wordCompleted', wordId: 'w', text: 'ship', points: 1, combo: 1, x: 0, y: 0 },
        { type: 'wordMissed', wordId: 'w', text: 'ship', x: 0, y: 0 },
        { type: 'levelChanged', level: 2, direction: 'up' },
        { type: 'gameOver', score: 10 },
      ]),
    ).not.toThrow();
  });

  it('does not open an audio context until a user gesture resumes it', () => {
    withFakeAudio();
    const sfx = new Sfx();
    expect(FakeAudioContext.created).toBe(0);

    sfx.resume();
    expect(FakeAudioContext.created).toBe(1);
  });

  it('opens no context at all while muted', () => {
    withFakeAudio();
    const sfx = new Sfx();
    sfx.setEnabled(false);
    sfx.resume();
    sfx.handleEvents([typed(true)]);

    expect(FakeAudioContext.created).toBe(0);
  });

  it('schedules a sound per event', () => {
    const audio = withFakeAudio();
    const sfx = new Sfx();
    sfx.resume();
    const before = audio.last().nodes.length;

    sfx.handleEvents([typed(true)]);
    expect(audio.last().nodes.length).toBeGreaterThan(before);
    expect(audio.last().nodes.some((n) => n.start.mock.calls.length > 0)).toBe(true);
  });

  it('rate-limits shots so a fast typist does not stack them', () => {
    const audio = withFakeAudio();
    const sfx = new Sfx();
    sfx.resume();
    const ctx = audio.last();

    const before = ctx.nodes.length;
    for (let i = 0; i < 10; i++) sfx.handleEvents([typed(true)]); // same currentTime
    const burst = ctx.nodes.length - before;

    ctx.currentTime += 1;
    sfx.handleEvents([typed(true)]);
    expect(ctx.nodes.length - before).toBeGreaterThan(burst);
  });

  it('gives a wrong key a different sound from a shot', () => {
    const audio = withFakeAudio();
    const sfx = new Sfx();
    sfx.resume();
    const ctx = audio.last();

    sfx.handleEvents([typed(true)]);
    const shot = ctx.nodes.find((n) => n.type === 'square');
    ctx.currentTime += 1;
    sfx.handleEvents([typed(false)]);
    const miss = ctx.nodes.find((n) => n.type === 'sine');

    expect(shot).toBeDefined();
    expect(miss).toBeDefined();
  });

  it('mutes and unmutes an already-open context without reopening it', () => {
    const audio = withFakeAudio();
    const sfx = new Sfx();
    sfx.resume();
    const ctx = audio.last();
    const master = ctx.nodes[0]!;

    sfx.setEnabled(false);
    expect(master.gain.setTargetAtTime).toHaveBeenCalledWith(0, expect.anything(), expect.anything());
    sfx.setEnabled(true);
    expect(master.gain.setTargetAtTime).toHaveBeenLastCalledWith(0.25, expect.anything(), expect.anything());
    expect(FakeAudioContext.created).toBe(1);
  });

  it('releases the audio hardware on dispose', () => {
    const audio = withFakeAudio();
    const sfx = new Sfx();
    sfx.resume();
    const ctx = audio.last();
    sfx.dispose();

    expect(ctx.close).toHaveBeenCalled();
    sfx.resume();
    expect(FakeAudioContext.created).toBe(2); // reopens cleanly for the next run
  });
});
