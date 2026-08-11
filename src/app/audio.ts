import type { GameEvent } from '../sim/types';

/**
 * Synthesised sound effects.
 *
 * Everything is generated from oscillators and a noise buffer, so the game
 * ships no audio assets and the whole layer costs a few hundred bytes. Like the
 * VFX layer it is a consumer of the simulation's event stream — it never feeds
 * anything back.
 *
 * Browsers refuse to start an AudioContext outside a user gesture, so the
 * context is created lazily on the first `resume()` (called from the Start
 * button) rather than at construction.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = true;
  /**
   * Rate-limits shot sounds so a fast typist doesn't stack a wall of clicks.
   * Starts at -Infinity so the very first shot of a run isn't swallowed by a
   * context whose clock is still near zero.
   */
  private lastShotAt = Number.NEGATIVE_INFINITY;

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(value ? 0.25 : 0, this.ctx.currentTime, 0.02);
    }
  }

  /** Call from a user gesture; safe to call repeatedly. */
  resume(): void {
    if (!this.enabled) return;
    const ctx = this.context();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  handleEvents(events: readonly GameEvent[]): void {
    if (!this.enabled) return;
    for (const event of events) {
      switch (event.type) {
        case 'charTyped':
          if (event.correct) this.shot();
          else this.thud();
          break;
        case 'wordCompleted':
          this.blast(event.text.length);
          break;
        case 'wordMissed':
          this.alarm();
          break;
        case 'levelChanged':
          // Only the promotion gets a fanfare; a demotion is not a reward.
          if (event.direction === 'up') this.chime();
          break;
        case 'gameOver':
          this.gameOver();
          break;
        default:
          break;
      }
    }
  }

  /** A short descending zap — the laser bolt leaving the ship. */
  private shot(): void {
    const ctx = this.context();
    if (!ctx) return;
    // Two shots inside 25ms are indistinguishable anyway, and stacking them clips.
    if (ctx.currentTime - this.lastShotAt < 0.025) return;
    this.lastShotAt = ctx.currentTime;

    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.07);
    gain.gain.setValueAtTime(0.09, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.09);
  }

  /** A dull low knock for a wrong key — audibly *not* a shot. */
  private thud(): void {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.12);
    gain.gain.setValueAtTime(0.16, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  /** Filtered noise burst — the enemy craft coming apart. Longer words hit lower. */
  private blast(wordLength: number): void {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    source.buffer = this.noiseBuffer();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2600 - Math.min(wordLength, 12) * 90, t);
    filter.frequency.exponentialRampToValueAtTime(180, t + 0.3);
    gain.gain.setValueAtTime(0.3, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    source.connect(filter).connect(gain).connect(this.master!);
    source.start(t);
    source.stop(t + 0.33);
  }

  /** Two-tone warning: something got through to the ship. */
  private alarm(): void {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [index, freq] of [330, 220].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = t + index * 0.12;
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      osc.connect(gain).connect(this.master!);
      osc.start(at);
      osc.stop(at + 0.18);
    }
  }

  /** Rising arpeggio on level-up. */
  private chime(): void {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [index, freq] of [523.25, 659.25, 783.99].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = t + index * 0.07;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, at);
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.16, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
      osc.connect(gain).connect(this.master!);
      osc.start(at);
      osc.stop(at + 0.24);
    }
  }

  /** Long descending sweep as the ship goes down. */
  private gameOver(): void {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.9);
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1);
    osc.connect(gain).connect(this.master!);
    osc.start(t);
    osc.stop(t + 1.05);

    this.blast(12);
  }

  private context(): AudioContext | null {
    if (this.ctx) return this.ctx;
    // globalThis rather than window: this must not throw where there is no DOM.
    const host = globalThis as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = host.AudioContext ?? host.webkitAudioContext;
    if (!Ctor) return null; // No WebAudio: the game is fully playable silent.
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.25 : 0;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  /** One second of white noise, reused by every explosion. */
  private noiseBuffer(): AudioBuffer {
    if (this.noise) return this.noise;
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    return buffer;
  }

  /** Releases the audio hardware when leaving the game. */
  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.noise = null;
  }
}
