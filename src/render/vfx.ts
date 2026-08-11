import type { GameEvent, SessionState } from '../sim/types';
import { CHAR_WIDTH, FLOOR_Y, WORLD_HEIGHT, WORLD_WIDTH } from '../sim/types';

/**
 * Visual effects: starfield, projectiles, explosions, screen shake.
 *
 * All of this is presentation. It reacts to the event stream the simulation
 * already emits (§8) and never feeds back into it — a bullet in flight cannot
 * change what the player typed or when a word lands. Keeping it here means the
 * core stays headless-testable while the game gets to feel like a shooter.
 */

/** Where the player's ship sits, in world coordinates. */
export const SHIP_X = WORLD_WIDTH / 2;
export const SHIP_Y = WORLD_HEIGHT - 26;

const BULLET_SPEED = 1500;
const STAR_COUNT = 140;
const MAX_PARTICLES = 400;

export interface Star {
  x: number;
  y: number;
  /** 0.25 (far, dim, slow) → 1 (near, bright, fast). */
  depth: number;
}

export interface Bullet {
  x: number;
  y: number;
  /** The word it was fired at; the bullet re-aims each frame while it exists. */
  targetId: string;
  /** Index of the character it is meant to destroy — where it aims on the word. */
  charIndex: number;
  /** Last known target position, used if the word dies mid-flight. */
  aimX: number;
  aimY: number;
  life: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
}

export class Vfx {
  readonly stars: Star[] = [];
  readonly bullets: Bullet[] = [];
  readonly particles: Particle[] = [];

  /** Decaying screen-shake magnitude in world units. */
  shake = 0;
  /** Decaying red damage flash, 0–1. */
  damageFlash = 0;
  /** Muzzle-flash intensity at the ship's nose, 0–1. */
  muzzle = 0;
  /** Ship aim angle in radians; 0 points straight up. */
  aim = 0;

  private seed = 0x1a2b3c4d;

  constructor() {
    for (let i = 0; i < STAR_COUNT; i++) {
      this.stars.push({
        x: this.random() * WORLD_WIDTH,
        y: this.random() * WORLD_HEIGHT,
        depth: 0.25 + this.random() * 0.75,
      });
    }
  }

  /** Translates gameplay events into effects. */
  handleEvents(events: readonly GameEvent[]): void {
    for (const event of events) {
      switch (event.type) {
        case 'charTyped':
          if (event.correct) {
            this.fire(event.wordId, event.charIndex, event.x + CHAR_WIDTH / 2, event.y);
          } else {
            // A wrong key still fires — the shot goes wide, so errors read as errors.
            this.fire('', event.charIndex, event.x + 70, event.y - 50);
            this.shake = Math.max(this.shake, 2);
          }
          break;

        case 'wordCompleted':
          this.explode(event.x, event.y, 22 + event.text.length * 2, 190);
          this.shake = Math.max(this.shake, 4);
          break;

        case 'wordMissed':
          // The word got through: the hit lands on the ship, not out in space.
          this.explode(SHIP_X, SHIP_Y - 10, 40, 5);
          this.shake = Math.max(this.shake, 14);
          this.damageFlash = 1;
          break;

        case 'gameOver':
          this.explode(SHIP_X, SHIP_Y - 6, 90, 30);
          this.shake = Math.max(this.shake, 20);
          this.damageFlash = 1;
          break;

        default:
          break;
      }
    }
  }

  update(dt: number, state: SessionState, reducedMotion: boolean): void {
    this.updateStars(dt, reducedMotion);
    this.updateBullets(dt, state);
    this.updateParticles(dt);

    this.shake = decay(this.shake, dt, 6);
    this.damageFlash = decay(this.damageFlash, dt, 2.2);
    this.muzzle = decay(this.muzzle, dt, 9);
    this.aim = this.aimAt(state);
  }

  /** Drops every transient effect — used when a new session starts. */
  reset(): void {
    this.bullets.length = 0;
    this.particles.length = 0;
    this.shake = 0;
    this.damageFlash = 0;
    this.muzzle = 0;
    this.aim = 0;
  }

  private fire(targetId: string, charIndex: number, aimX: number, aimY: number): void {
    this.bullets.push({ x: SHIP_X, y: SHIP_Y - 14, targetId, charIndex, aimX, aimY, life: 1.2 });
    this.muzzle = 1;
  }

  private explode(x: number, y: number, count: number, hue: number): void {
    const budget = Math.min(count, MAX_PARTICLES - this.particles.length);
    for (let i = 0; i < budget; i++) {
      const angle = this.random() * Math.PI * 2;
      const speed = 60 + this.random() * 260;
      const life = 0.35 + this.random() * 0.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        maxLife: life,
        size: 1.5 + this.random() * 2.5,
        hue: hue + this.random() * 40 - 20,
      });
    }
  }

  private updateStars(dt: number, reducedMotion: boolean): void {
    if (reducedMotion) return;
    for (const star of this.stars) {
      star.y += star.depth * 40 * dt;
      if (star.y > WORLD_HEIGHT) {
        star.y -= WORLD_HEIGHT;
        star.x = this.random() * WORLD_WIDTH;
      }
    }
  }

  private updateBullets(dt: number, state: SessionState): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const bullet = this.bullets[i]!;
      const target = state.activeWords.find((w) => w.id === bullet.targetId);
      if (target) {
        // Re-aim at the moving word so shots track their target.
        bullet.aimX = charX(target.x, bullet.charIndex);
        bullet.aimY = target.y;
      }

      const dx = bullet.aimX - bullet.x;
      const dy = bullet.aimY - bullet.y;
      const distance = Math.hypot(dx, dy);
      const step = BULLET_SPEED * dt;
      bullet.life -= dt;

      if (distance <= step || bullet.life <= 0) {
        if (distance <= step) this.explode(bullet.aimX, bullet.aimY, 5, 190);
        this.bullets.splice(i, 1);
        continue;
      }
      bullet.x += (dx / distance) * step;
      bullet.y += (dy / distance) * step;
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 1.6 * dt; // drag, so bursts bloom and settle
      p.vy *= 1 - 1.6 * dt;
    }
  }

  /** The ship tracks whatever the player is currently shooting at. */
  private aimAt(state: SessionState): number {
    const target =
      state.activeWords.find((w) => w.id === state.lockedWordId) ??
      state.activeWords.reduce<SessionState['activeWords'][number] | null>(
        (best, w) => (!best || w.y > best.y ? w : best),
        null,
      );
    if (!target) return 0;
    const angle = Math.atan2(charX(target.x, target.text.length / 2) - SHIP_X, SHIP_Y - target.y);
    // Keep the barrel inside a believable arc rather than spinning to the sides.
    return Math.max(-1.1, Math.min(1.1, angle));
  }

  /** Deterministic noise, so effects never depend on Math.random(). */
  private random(): number {
    this.seed = (Math.imul(this.seed ^ (this.seed >>> 15), 1 | this.seed) + 0x6d2b79f5) | 0;
    return ((this.seed >>> 0) % 1000000) / 1000000;
  }
}

export function charX(wordX: number, charIndex: number): number {
  return wordX + charIndex * CHAR_WIDTH + CHAR_WIDTH / 2;
}

/** How close a word is to the ship, 0 (just spawned) → 1 (about to hit). */
export function threatOf(y: number): number {
  return Math.max(0, Math.min(1, y / FLOOR_Y));
}

function decay(value: number, dt: number, rate: number): number {
  return value <= 0 ? 0 : Math.max(0, value - value * rate * dt - rate * 0.05 * dt);
}
