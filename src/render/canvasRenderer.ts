import { CHAR_WIDTH, FLOOR_Y, WORLD_HEIGHT, WORLD_WIDTH, type SessionState } from '../sim/types';

/**
 * Canvas 2D renderer (§12). It reads the simulation state and draws it; it
 * never mutates state and holds no game logic of its own.
 *
 * Screen-reader users are served by a parallel ARIA live layer in the UI
 * (§14) — canvas text is invisible to assistive tech.
 */

export interface RenderOptions {
  /** Suppresses ambient motion (drifting grid, glow pulse) for §14. */
  reducedMotion: boolean;
  /** Wall-clock seconds, used only for ambient animation. */
  time: number;
  paused: boolean;
}

const FONT_SIZE = 26;
const BG_TOP = '#0a0d1a';
const BG_BOTTOM = '#131a2e';
const TEXT_PENDING = '#e6ecff';
const TEXT_TYPED = '#4ade80';
const ACCENT = '#38bdf8';
const DANGER = '#f87171';

export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.ctx = ctx;
    this.resize();
  }

  /** Sizes the backing store to the device pixel ratio and recomputes the world transform. */
  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    // Fit the logical world into the canvas, letterboxing rather than stretching.
    this.scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
    this.offsetX = (width - WORLD_WIDTH * this.scale) / 2;
    this.offsetY = (height - WORLD_HEIGHT * this.scale) / 2;
  }

  render(state: SessionState, options: RenderOptions): void {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawBackdrop();

    ctx.setTransform(this.scale, 0, 0, this.scale, this.offsetX, this.offsetY);
    this.drawGrid(options);
    this.drawFloor(state, options);

    ctx.font = `600 ${FONT_SIZE}px "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace`;
    ctx.textBaseline = 'middle';
    for (const word of state.activeWords) {
      this.drawWord(state, word, options);
    }

    if (options.paused) this.drawPausedVeil();
  }

  private drawBackdrop(): void {
    const { ctx, canvas } = this;
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, BG_TOP);
    gradient.addColorStop(1, BG_BOTTOM);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  private drawGrid(options: RenderOptions): void {
    const { ctx } = this;
    const spacing = 50;
    const drift = options.reducedMotion ? 0 : (options.time * 12) % spacing;
    ctx.strokeStyle = 'rgba(120, 160, 255, 0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= WORLD_WIDTH; x += spacing) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD_HEIGHT);
    }
    for (let y = -spacing + drift; y <= WORLD_HEIGHT; y += spacing) {
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD_WIDTH, y);
    }
    ctx.stroke();
  }

  private drawFloor(state: SessionState, options: RenderOptions): void {
    const { ctx } = this;
    const closest = state.activeWords.reduce((max, w) => Math.max(max, w.y), 0);
    const threat = Math.max(0, Math.min(1, closest / FLOOR_Y));
    const pulse = options.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(options.time * 4);

    ctx.fillStyle = `rgba(248, 113, 113, ${0.05 + 0.18 * threat * pulse})`;
    ctx.fillRect(0, FLOOR_Y, WORLD_WIDTH, WORLD_HEIGHT - FLOOR_Y);
    ctx.strokeStyle = `rgba(248, 113, 113, ${0.35 + 0.5 * threat})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    ctx.lineTo(WORLD_WIDTH, FLOOR_Y);
    ctx.stroke();
  }

  private drawWord(state: SessionState, word: SessionState['activeWords'][number], options: RenderOptions): void {
    const { ctx } = this;
    const typed = word.text.slice(0, word.typedIndex);
    const rest = word.text.slice(word.typedIndex);
    const isLocked = state.lockedWordId === word.id;
    const danger = Math.max(0, Math.min(1, (word.y - FLOOR_Y * 0.65) / (FLOOR_Y * 0.35)));
    const width = word.text.length * CHAR_WIDTH;

    // Capsule behind the text keeps long words legible over the grid.
    ctx.fillStyle = isLocked ? 'rgba(56, 189, 248, 0.14)' : 'rgba(10, 14, 30, 0.55)';
    roundRect(ctx, word.x - 10, word.y - FONT_SIZE * 0.8, width + 20, FONT_SIZE * 1.6, 8);
    ctx.fill();

    if (isLocked) {
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (!options.reducedMotion && danger > 0.5) {
      ctx.shadowColor = DANGER;
      ctx.shadowBlur = 16 * danger;
    }

    ctx.fillStyle = TEXT_TYPED;
    ctx.fillText(typed, word.x, word.y);
    ctx.fillStyle = danger > 0.6 ? DANGER : TEXT_PENDING;
    ctx.fillText(rest, word.x + typed.length * CHAR_WIDTH, word.y);
    ctx.shadowBlur = 0;
  }

  private drawPausedVeil(): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(5, 8, 18, 0.72)';
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}
