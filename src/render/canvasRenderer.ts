import {
  CHAR_WIDTH,
  FLOOR_Y,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type SessionState,
  type WordEntity,
} from '../sim/types';
import { charX, SHIP_X, SHIP_Y, threatOf, Vfx } from './vfx';

/**
 * Canvas 2D renderer (§12): a full-bleed space shooter.
 *
 * Words are enemy craft descending on the player's ship; typing shoots them.
 * The renderer reads simulation state and the event stream, and owns every bit
 * of the fiction — ships, lasers, explosions — so none of it can leak into the
 * core. Screen-reader users are served by the parallel ARIA layer in the UI
 * (§14), since canvas content is invisible to assistive tech.
 */

export interface RenderOptions {
  /** Suppresses ambient motion — drifting stars, glow pulse, shake (§14). */
  reducedMotion: boolean;
  /** Wall-clock seconds, used for ambient animation and effect timing. */
  time: number;
  paused: boolean;
}

const FONT_SIZE = 26;
const TEXT_DESTROYED = 'rgba(120, 145, 190, 0.45)';
const TEXT_PENDING = '#eef4ff';
const ACCENT = '#38bdf8';
const DANGER = '#f87171';
const SHIP_COLOR = '#7dd3fc';

export class CanvasRenderer {
  readonly vfx = new Vfx();

  private ctx: CanvasRenderingContext2D;
  private scale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private lastTime = 0;

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
    // Fit the logical world into the canvas, letterboxing rather than
    // stretching. The starfield is painted edge to edge underneath, so the
    // letterbox never reads as a border.
    this.scale = Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT);
    this.offsetX = (width - WORLD_WIDTH * this.scale) / 2;
    this.offsetY = (height - WORLD_HEIGHT * this.scale) / 2;
  }

  render(state: SessionState, options: RenderOptions): void {
    const dt = this.step(options.time, options.paused);
    if (!options.paused) this.vfx.update(dt, state, options.reducedMotion);

    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawSpace();

    const shake = options.reducedMotion ? 0 : this.vfx.shake;
    const shakeX = shake === 0 ? 0 : (Math.sin(options.time * 71) * shake) / 2;
    const shakeY = shake === 0 ? 0 : (Math.cos(options.time * 63) * shake) / 2;
    ctx.setTransform(
      this.scale,
      0,
      0,
      this.scale,
      this.offsetX + shakeX * this.scale,
      this.offsetY + shakeY * this.scale,
    );

    this.drawStars(options);
    this.drawDangerZone(state, options);
    this.drawLockBeam(state);

    ctx.font = `600 ${FONT_SIZE}px "JetBrains Mono", "SF Mono", Menlo, Consolas, monospace`;
    ctx.textBaseline = 'middle';
    for (const word of state.activeWords) this.drawEnemy(state, word, options);

    this.drawBullets();
    this.drawParticles();
    this.drawShip(state, options);
    this.drawDamageFlash();

    if (options.paused) this.drawPausedVeil();
  }

  /** Frame delta for effects, clamped like the simulation's own (§4). */
  private step(time: number, paused: boolean): number {
    const dt = this.lastTime === 0 ? 0 : Math.min(time - this.lastTime, 0.05);
    this.lastTime = time;
    return paused ? 0 : dt;
  }

  private drawSpace(): void {
    const { ctx, canvas } = this;
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#05070f');
    gradient.addColorStop(0.55, '#080d1c');
    gradient.addColorStop(1, '#0d1428');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  private drawStars(options: RenderOptions): void {
    const { ctx } = this;
    // Overdraw beyond the world box so the letterboxed edges stay starfield.
    const bleedX = this.offsetX / this.scale;
    const bleedY = this.offsetY / this.scale;
    for (const star of this.vfx.stars) {
      const twinkle = options.reducedMotion ? 1 : 0.75 + 0.25 * Math.sin(options.time * 2 + star.x);
      ctx.fillStyle = `rgba(190, 215, 255, ${star.depth * 0.55 * twinkle})`;
      const size = star.depth * 2;
      ctx.fillRect(star.x - bleedX, star.y - bleedY, size, size);
      ctx.fillRect(star.x + bleedX * 0.5, star.y + bleedY * 0.5, size, size);
    }
  }

  /** The line the enemies are trying to reach — the ship's own airspace. */
  private drawDangerZone(state: SessionState, options: RenderOptions): void {
    const { ctx } = this;
    const closest = state.activeWords.reduce((max, w) => Math.max(max, w.y), 0);
    const threat = threatOf(closest);
    const pulse = options.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(options.time * 4);

    ctx.fillStyle = `rgba(248, 113, 113, ${0.04 + 0.16 * threat * pulse})`;
    ctx.fillRect(0, FLOOR_Y, WORLD_WIDTH, WORLD_HEIGHT - FLOOR_Y);
    ctx.strokeStyle = `rgba(248, 113, 113, ${0.25 + 0.5 * threat})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    ctx.lineTo(WORLD_WIDTH, FLOOR_Y);
    ctx.stroke();
  }

  /** A faint targeting line to whatever the player has locked on to. */
  private drawLockBeam(state: SessionState): void {
    const target = state.activeWords.find((w) => w.id === state.lockedWordId);
    if (!target) return;
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 10]);
    ctx.beginPath();
    ctx.moveTo(SHIP_X, SHIP_Y - 14);
    ctx.lineTo(charX(target.x, target.text.length / 2), target.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawEnemy(state: SessionState, word: WordEntity, options: RenderOptions): void {
    const { ctx } = this;
    const destroyed = word.text.slice(0, word.typedIndex);
    const remaining = word.text.slice(word.typedIndex);
    const isLocked = state.lockedWordId === word.id;
    const threat = Math.max(0, Math.min(1, (word.y - FLOOR_Y * 0.6) / (FLOOR_Y * 0.4)));
    const width = word.text.length * CHAR_WIDTH;
    const centerX = word.x + width / 2;

    this.drawHull(centerX, word.y, width, isLocked, threat, options);

    ctx.fillStyle = TEXT_DESTROYED;
    ctx.fillText(destroyed, word.x, word.y);

    if (!options.reducedMotion) {
      ctx.shadowColor = isLocked ? ACCENT : threat > 0.5 ? DANGER : 'rgba(0,0,0,0)';
      ctx.shadowBlur = isLocked ? 12 : 14 * threat;
    }
    ctx.fillStyle = threat > 0.65 ? DANGER : isLocked ? ACCENT : TEXT_PENDING;
    ctx.fillText(remaining, word.x + destroyed.length * CHAR_WIDTH, word.y);
    ctx.shadowBlur = 0;

    if (isLocked) {
      // Marker under the next character to hit.
      const nextX = charX(word.x, word.typedIndex);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(nextX - CHAR_WIDTH / 2, word.y + FONT_SIZE * 0.62, CHAR_WIDTH, 2);
    }
  }

  /** The enemy craft carrying the word: a swept-back wedge pointing at the player. */
  private drawHull(
    centerX: number,
    y: number,
    width: number,
    isLocked: boolean,
    threat: number,
    options: RenderOptions,
  ): void {
    const { ctx } = this;
    const halfWidth = width / 2 + 14;
    const top = y - FONT_SIZE * 0.95;
    const bottom = y + FONT_SIZE * 0.95;

    ctx.beginPath();
    ctx.moveTo(centerX - halfWidth, top);
    ctx.lineTo(centerX + halfWidth, top);
    ctx.lineTo(centerX + halfWidth - 12, bottom);
    ctx.lineTo(centerX, bottom + 9); // nose, aimed down at the ship
    ctx.lineTo(centerX - halfWidth + 12, bottom);
    ctx.closePath();

    ctx.fillStyle = isLocked
      ? 'rgba(56, 189, 248, 0.16)'
      : `rgba(${12 + 40 * threat}, ${16 + 8 * threat}, 34, 0.72)`;
    ctx.fill();
    ctx.strokeStyle = isLocked
      ? 'rgba(56, 189, 248, 0.85)'
      : `rgba(${120 + 128 * threat}, ${150 - 40 * threat}, ${200 - 80 * threat}, ${0.25 + 0.35 * threat})`;
    ctx.lineWidth = isLocked ? 1.6 : 1;
    ctx.stroke();

    // Engine glow trailing behind the craft.
    if (!options.reducedMotion) {
      const flicker = 0.6 + 0.4 * Math.sin(options.time * 18 + centerX);
      ctx.fillStyle = `rgba(56, 189, 248, ${0.1 * flicker})`;
      ctx.fillRect(centerX - 8, top - 10 * flicker, 16, 10 * flicker);
    }
  }

  private drawBullets(): void {
    const { ctx } = this;
    ctx.lineCap = 'round';
    for (const bullet of this.vfx.bullets) {
      const dx = bullet.aimX - bullet.x;
      const dy = bullet.aimY - bullet.y;
      const length = Math.hypot(dx, dy) || 1;
      const tailX = bullet.x - (dx / length) * 16;
      const tailY = bullet.y - (dy / length) * 16;

      ctx.strokeStyle = 'rgba(125, 211, 252, 0.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(bullet.x, bullet.y);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  private drawParticles(): void {
    const { ctx } = this;
    for (const p of this.vfx.particles) {
      const fade = p.life / p.maxLife;
      ctx.fillStyle = `hsla(${p.hue}, 90%, ${55 + 25 * fade}%, ${fade})`;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size * fade + 0.5, p.size * fade + 0.5);
    }
  }

  private drawShip(state: SessionState, options: RenderOptions): void {
    const { ctx } = this;
    const hit = state.lives <= 0;

    ctx.save();
    ctx.translate(SHIP_X, SHIP_Y);
    ctx.rotate(options.reducedMotion ? 0 : this.vfx.aim * 0.25);

    // Thruster.
    if (!options.reducedMotion) {
      const flame = 10 + 6 * Math.abs(Math.sin(options.time * 22));
      ctx.fillStyle = 'rgba(56, 189, 248, 0.5)';
      ctx.beginPath();
      ctx.moveTo(-5, 8);
      ctx.lineTo(5, 8);
      ctx.lineTo(0, 8 + flame);
      ctx.closePath();
      ctx.fill();
    }

    ctx.beginPath();
    ctx.moveTo(0, -20); // nose
    ctx.lineTo(15, 10);
    ctx.lineTo(0, 3);
    ctx.lineTo(-15, 10);
    ctx.closePath();
    ctx.fillStyle = hit ? 'rgba(248, 113, 113, 0.5)' : 'rgba(14, 30, 52, 0.95)';
    ctx.fill();
    ctx.strokeStyle = hit ? DANGER : SHIP_COLOR;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Muzzle flash at the nose while firing.
    if (this.vfx.muzzle > 0.02) {
      ctx.fillStyle = `rgba(186, 230, 253, ${this.vfx.muzzle * 0.8})`;
      ctx.beginPath();
      ctx.arc(0, -22, 4 + 6 * this.vfx.muzzle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawDamageFlash(): void {
    if (this.vfx.damageFlash <= 0.01) return;
    const { ctx } = this;
    ctx.fillStyle = `rgba(248, 113, 113, ${0.28 * this.vfx.damageFlash})`;
    ctx.fillRect(-WORLD_WIDTH, -WORLD_HEIGHT, WORLD_WIDTH * 3, WORLD_HEIGHT * 3);
  }

  private drawPausedVeil(): void {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(5, 8, 18, 0.72)';
    ctx.fillRect(-WORLD_WIDTH, -WORLD_HEIGHT, WORLD_WIDTH * 3, WORLD_HEIGHT * 3);
  }
}
